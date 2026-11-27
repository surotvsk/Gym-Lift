package surotvsk.gymapp;

import android.content.Context;
import android.os.SystemClock;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.tasks.Tasks;
import org.json.JSONArray;
import org.json.JSONObject;
import surotvsk.gymapp.wear.JournalError;
import surotvsk.gymapp.wear.PhoneInbox;
import surotvsk.gymapp.wear.BindingRules;
import surotvsk.gymapp.wear.RevocationLedger;
import surotvsk.gymapp.wear.WearDisk;
import surotvsk.gymapp.wear.WearEnv;
import surotvsk.gymapp.wear.WearProtocol;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Všetky operácie aj udalosti listenera sú v jednom sériovom rade. */
final class WearPhone {
    static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static WearPhone instance;
    static synchronized WearPhone get(Context c) {
        if (instance == null) instance = new WearPhone(c.getApplicationContext());
        return instance;
    }
    final Context context;
    private final WearDisk disk;
    private final PhoneInbox inbox;
    private JSONObject data;
    private WeakReference<GymWearPlugin> plugin = new WeakReference<>(null);
    /** Telo odpovede a ID konverzácie žijú LEN tu v pamäti; na disk ani do logu sa nedostanú. */
    private final Map<String, JSONObject> transientArgs = new HashMap<>();
    private WearPhone(Context c) {
        context = c; disk = new WearDisk(c, "gymwear-phone.json"); data = disk.read();
        final Context app = c;
        inbox = new PhoneInbox(new WearDisk(c, "gymwear-inbox.json"), new WearEnv() {
            @Override public long wall() { return System.currentTimeMillis(); }
            @Override public int boot() { return WearProtocol.boot(app); }
            @Override public String uuid() { return UUID.randomUUID().toString(); }
        });
    }
    void attach(GymWearPlugin p) { plugin = new WeakReference<>(p); }
    JSONObject configuration() { return data.optJSONObject("configuration"); }
    private JSONObject pending() throws Exception {
        if (!data.has("pending")) data.put("pending", new JSONObject());
        return data.getJSONObject("pending");
    }
    private JSONObject finals() throws Exception {
        if (!data.has("finals")) data.put("finals", new JSONObject());
        return data.getJSONObject("finals");
    }
    private String key(String node, String id) { return node + ":" + id; }
    private void save() { disk.write(data); }
    private boolean bound(String node, JSONObject command) {
        JSONObject c = configuration();
        return c != null && c.optBoolean("enabled") && node.equals(c.optString("peer"))
            && c.optString("epoch").equals(command.optString("epoch"))
            && c.optString("workspace").equals(command.optString("workspace"));
    }
    private JSONObject result(String id, String status, String error) throws Exception {
        JSONObject r = new JSONObject().put("id", id).put("status", status).put("seq", data.optLong("seq", 0));
        if (error != null) r.put("error", error);
        return r;
    }
    private void remember(String node, String id, JSONObject result) throws Exception {
        String key = key(node, id);
        pending().remove(key); transientArgs.remove(key);
        JSONObject results = finals();
        results.put(key, new JSONObject().put("node", node).put("result", result));
        JSONArray order = data.optJSONArray("finalOrder");
        if (order == null) { order = new JSONArray(); data.put("finalOrder", order); }
        order.put(key);
        while (order.length() > 200) results.remove(order.remove(0).toString());
        save();
    }
    void send(String node, JSONObject result) {
        Wearable.getMessageClient(context).sendMessage(node, WearProtocol.ACK, WearProtocol.bytes(result));
    }
    private void expire() throws Exception {
        JSONObject queue = pending(); JSONArray keys = queue.names();
        if (keys == null) return;
        for (int i = 0; i < keys.length(); i++) {
            String key = keys.getString(i);
            JSONObject r = queue.getJSONObject(key);
            JSONObject cmd = r.getJSONObject("command");
            boolean message = r.optBoolean("redacted"), emitted = r.optBoolean("emitted");
            // Po reštarte procesu telo odpovede neexistuje; nikdy sa nevykoná ani neodošle znova.
            boolean lost = message && !emitted && !transientArgs.containsKey(key);
            if (!WearProtocol.live(context, r) || !bound(r.getString("nodeId"), cmd) || lost) {
                JSONObject answer = message && emitted
                    ? result(cmd.getString("id"), "unknown", "delivery_unknown")
                    : result(cmd.getString("id"), "stale", lost ? "restarted" : "expired_or_revoked");
                remember(r.getString("nodeId"), cmd.getString("id"), answer);
                send(r.getString("nodeId"), answer);
            }
        }
    }
    private void scopeInbox(JSONObject config) {
        try { inbox.ensureScope(config); }
        catch (RuntimeException e) { android.util.Log.w("GymWear", "Inbox scope not updated: " + e.getMessage()); }
    }
    /** Atómový zápis kópie: pamäť sa zmení až po úspešnom zápise, takže odpojenie a povinnosť doručenia nikdy nerozídu. */
    private void mutate(java.util.function.Consumer<JSONObject> change) {
        JSONObject next;
        try { next = new JSONObject(data.toString()); } catch (org.json.JSONException e) { throw new IllegalStateException(e); }
        change.accept(next);
        disk.write(next);
        data = next;
    }
    void configure(JSONObject c) throws Exception {
        JSONObject old = configuration();
        JSONObject next;
        // Nová konfigurácia, odvolané epochy A povinnosť doručiť odvolanie hodinkám idú jedným zápisom dokumentu telefónu.
        try { next = BindingRules.configure(data, c, disk); }
        catch (JournalError e) { throw new Exception(e.code, e); }
        boolean changed = next != data;
        data = next;
        if (changed) {
            // Súkromná vyrovnávacia pamäť a nevybavená práca patria starej väzbe; zmizne s ňou.
            transientArgs.clear(); scopeInbox(c);
            expire();
        }
        // Povinnosť je už trvalá; odoslanie je len snaha a opakuje sa pri každom kontakte, kým hodinky nepotvrdia.
        if (old != null) deliverRevocations(old.optString("peer"));
        deliverRevocations(c.optString("peer"));
    }
    private JSONObject tombstone(JSONObject config) throws Exception {
        JSONObject binding = new JSONObject(config.toString()).put("enabled", false).put("label", "");
        long now = System.currentTimeMillis();
        return new JSONObject().put("v", 1).put("binding", binding).put("seq", Math.max(0, data.optLong("seq", 0)))
            .put("createdAt", now).put("expiresAt", now + 60000).put("language", "en")
            .put("plans", new JSONArray()).put("session", JSONObject.NULL).put("rest", JSONObject.NULL).put("calendar", new JSONArray());
    }
    private byte[] snapshotBytes(JSONObject snapshot) throws Exception {
        byte[] body = WearProtocol.bytes(snapshot);
        WearProtocol.require(body.length <= WearProtocol.MAX_SNAPSHOT, "snapshot_size");
        return body;
    }
    /**
     * Odoslanie náhrobku je len snaha: úspech MessageClient NIE JE potvrdenie hodiniek, preto sa povinnosť
     * nemaže. Zaniká až po UNLINK od hodiniek (použité odvolanie) alebo po kontakte na náhradnej väzbe.
     */
    private void sendTombstone(JSONObject config) {
        String peer = config.optString("peer");
        if (peer.isEmpty()) return;
        try {
            Wearable.getMessageClient(context).sendMessage(peer, WearProtocol.SNAPSHOT, snapshotBytes(tombstone(config)))
                .addOnFailureListener(e -> android.util.Log.w("GymWear", "Revocation not delivered; obligation kept"));
        } catch (Exception e) { android.util.Log.w("GymWear", "Revocation not sent; obligation kept"); }
    }
    /** Každý kontakt bývalého partnera (aj s hlavičkou starej väzby) dostane odvolanie, kým ho hodinky nepotvrdia. */
    void deliverRevocations(String node) {
        if (node == null || node.isEmpty()) return;
        try {
            for (JSONObject entry : RevocationLedger.pendingFor(data, node)) sendTombstone(entry);
        } catch (RuntimeException e) { android.util.Log.w("GymWear", "Revocation obligations unreadable: " + e.getMessage()); }
    }
    /** Hodinky sa ozvali na platnej väzbe: prijali náhradnú epochu, staré odvolania už netreba doručovať. */
    private void confirmAdopted(String node, JSONObject header) {
        try {
            if (!bound(node, header) || RevocationLedger.pendingFor(data, node).isEmpty()) return;
            mutate(next -> RevocationLedger.confirmAdopted(next, node, header));
        } catch (RuntimeException e) { android.util.Log.w("GymWear", "Revocation obligations not updated: " + e.getMessage()); }
    }
    private void sendUnlinkAck(String node, String epoch, String workspace) {
        try {
            JSONObject ack = new JSONObject().put("v", 1).put("epoch", epoch).put("workspace", workspace).put("ack", true);
            Wearable.getMessageClient(context).sendMessage(node, WearProtocol.UNLINK, WearProtocol.bytes(ack))
                .addOnFailureListener(e -> android.util.Log.w("GymWear", "Unlink ack not delivered; watch will repeat"));
        } catch (Exception e) { android.util.Log.w("GymWear", "Unlink ack not sent"); }
    }
    void peerConnected(String node) { deliverRevocations(node); }
    void publish(JSONObject input) throws Exception {
        WearProtocol.snapshot(input);
        JSONObject config = configuration();
        WearProtocol.require(WearProtocol.same(config, input.getJSONObject("binding")), "configuration_mismatch");
        WearProtocol.require(config.getBoolean("enabled"), "wear_disabled");
        long now = System.currentTimeMillis();
        WearProtocol.require(input.getLong("createdAt") <= now + 5000 && input.getLong("expiresAt") > now, "snapshot_expired");
        WearProtocol.require(input.getLong("seq") > data.optLong("seq", -1), "snapshot_sequence");
        // Súhlasy z JS sa zapamätajú; denník, packRev a povolenie správ určuje výhradne natívna schránka.
        JSONObject grants = input.optJSONObject("grants");
        inbox.grants(config, grants == null ? null : (Boolean) grants.optBoolean("offline"), grants != null && grants.optBoolean("messages"));
        JSONObject snapshot = new JSONObject(input.toString());
        boolean offline = inbox.offlineGranted(config), messages = inbox.messagesGranted(config);
        String rev = inbox.currentPackRev(config);
        snapshot.put("grants", new JSONObject().put("offline", offline).put("messages", messages))
            .put("packRev", rev == null ? JSONObject.NULL : rev).put("journal", inbox.snapshotJournal(config));
        if (!messages) snapshot.remove("messages");
        WearProtocol.snapshot(snapshot);
        byte[] body = snapshotBytes(snapshot);
        data.put("seq", snapshot.getLong("seq")); save();
        // Súkromný obsah ide len vybranému partnerovi; skutočná chyba prenosu sa vráti volajúcemu.
        try {
            Tasks.await(Wearable.getMessageClient(context).sendMessage(config.getString("peer"), WearProtocol.SNAPSHOT, body), 4, TimeUnit.SECONDS);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            throw new Exception("snapshot_not_delivered: " + cause.getMessage(), cause);
        } catch (TimeoutException e) {
            throw new Exception("snapshot_delivery_timeout", e);
        }
    }
    /** Trvalo uloží balík a šablóny PRED odoslaním; chýbajúce spojenie nie je chyba (hodinky si vyžiadajú balík pri pripojení). */
    void publishPack(JSONObject pack, JSONObject templates) throws Exception {
        JSONObject config = configuration();
        WearProtocol.require(config != null, "wear_disabled");
        try {
            JSONObject stored = inbox.publishPack(config, pack, templates);
            sendPack(config.getString("peer"), stored);
        } catch (JournalError e) { throw new Exception(e.code, e); }
    }
    private void sendPack(String node, JSONObject pack) {
        Wearable.getMessageClient(context).sendMessage(node, WearProtocol.PACK, WearProtocol.bytes(pack))
            .addOnFailureListener(e -> android.util.Log.w("GymWear", "Pack not delivered; watch will request it"));
    }
    JSONArray drain() throws Exception {
        expire(); JSONArray output = new JSONArray(); JSONObject queue = pending(); JSONArray keys = queue.names();
        if (keys != null) for (int i = 0; i < keys.length(); i++) {
            JSONObject e = event(queue.getJSONObject(keys.getString(i)));
            if (e != null) output.put(e);
        }
        return output;
    }
    JSONArray journals() throws Exception {
        JSONObject config = configuration();
        try { inbox.ensureScope(config); return inbox.drain(config); }
        catch (JournalError e) { throw new Exception(e.code, e); }
    }
    void journalResult(JSONObject result) throws Exception {
        try { inbox.result(configuration(), result); }
        catch (JournalError e) { throw new Exception(e.code, e); }
    }
    /**
     * Príkaz pre JS. Telo odpovede sa vydá NAJVIAC RAZ: najprv sa trvalo zapíše redigovaný nárok (emitted),
     * až potom sa telo odovzdá z pamäte. Opakovaný pokus, reštart alebo vypršanie = výsledok neznámy, nikdy nie nový insert.
     */
    JSONObject event(JSONObject receipt) throws Exception {
        JSONObject command = new JSONObject(receipt.getJSONObject("command").toString());
        if (receipt.optBoolean("redacted")) {
            String key = key(receipt.getString("nodeId"), command.getString("id"));
            JSONObject args = transientArgs.get(key);
            if (receipt.optBoolean("emitted") || args == null) return null;
            receipt.put("emitted", true);
            try { save(); } catch (RuntimeException e) { receipt.put("emitted", false); throw e; }
            transientArgs.remove(key);
            command.put("args", args);
        }
        return new JSONObject().put("nodeId", receipt.getString("nodeId"))
            .put("command", command).put("deadlineAt", receipt.getLong("deadlineAt"));
    }
    void validate(String node, String id, String epoch, String workspace) throws Exception {
        expire(); JSONObject r = pending().optJSONObject(key(node, id));
        WearProtocol.require(r != null && WearProtocol.live(context, r), "expired_or_unknown");
        JSONObject cmd = r.getJSONObject("command");
        WearProtocol.require(bound(node, cmd) && epoch.equals(cmd.getString("epoch"))
            && workspace.equals(cmd.getString("workspace")), "binding_mismatch");
    }
    void ack(String node, String id, JSONObject answer) throws Exception {
        JSONObject prior = finals().optJSONObject(key(node, id));
        if (prior != null) { send(node, prior.getJSONObject("result")); return; }
        JSONObject receipt = pending().optJSONObject(key(node, id));
        WearProtocol.require(receipt != null && bound(node, receipt.getJSONObject("command")), "unknown_receipt");
        WearProtocol.require(id.equals(answer.getString("id")), "ack_id");
        String status = answer.getString("status");
        WearProtocol.require(status.equals("queued") || status.equals("applied") || status.equals("rejected")
            || status.equals("stale") || status.equals("unknown"), "ack_status");
        JSONObject out = new JSONObject(answer.toString());
        // Odpoveď na správu nesie len pevný kód chyby, nikdy text servera, ktorý by mohol uniknúť obsah.
        if (receipt.optBoolean("redacted") && out.has("error")
            && !(out.get("error") instanceof String && surotvsk.gymapp.wear.JournalRules.isCode(out.getString("error")))) out.put("error", "error");
        WearProtocol.require(WearProtocol.number(out, "seq") >= 0 && WearProtocol.bytes(out).length <= 4096, "ack_result");
        if (!status.equals("queued")) remember(node, id, out);
        send(node, out);
    }
    void receive(String node, String path, byte[] bytes) {
        deliverRevocations(node);
        try {
            if (WearProtocol.UNLINK.equals(path)) { unlink(node, WearProtocol.parse(bytes, 2048)); return; }
            if (WearProtocol.JOURNAL.equals(path)) { journal(node, bytes); return; }
            if (WearProtocol.PACK_REQUEST.equals(path)) { packRequest(node, bytes); return; }
            if (!WearProtocol.COMMAND.equals(path)) return;
            JSONObject command = WearProtocol.parse(bytes, 4096);
            String id = command.optString("id");
            if (id.isEmpty() || id.length() > 36) return;
            // Cudzí uzol nedostane žiadne informácie o konfigurácii ani výsledkoch.
            if (!bound(node, command)) {
                send(node, result(id, "rejected", "binding_mismatch")); return;
            }
            confirmAdopted(node, command);
            JSONObject prior = finals().optJSONObject(key(node, id));
            if (prior != null) { send(node, prior.getJSONObject("result")); return; }
            expire();
            prior = finals().optJSONObject(key(node, id));
            if (prior != null) { send(node, prior.getJSONObject("result")); return; }
            if (pending().has(key(node, id))) { send(node, result(id, "queued", null)); return; }
            try { WearProtocol.command(command, System.currentTimeMillis()); }
            catch (Exception e) {
                JSONObject rejected = result(id, "rejected", "malformed_expired_or_clock_skew");
                remember(node, id, rejected); send(node, rejected); return;
            }
            boolean message = "messageReply".equals(command.getString("type"));
            if (message && !inbox.messagesGranted(configuration())) {
                JSONObject rejected = result(id, "rejected", "messages_off");
                remember(node, id, rejected); send(node, rejected); return;
            }
            if (pending().length() >= 32 || WearProtocol.boot(context) < 0) {
                JSONObject rejected = result(id, "rejected", "queue_unavailable");
                remember(node, id, rejected); send(node, rejected); return;
            }
            long now = System.currentTimeMillis(), elapsed = SystemClock.elapsedRealtime();
            long remaining = Math.min(10000, command.getLong("expiresAt") - now);
            // Trvalý nárok je redigovaný: bez tela odpovede a bez ID konverzácie.
            JSONObject receipt = new JSONObject().put("nodeId", node).put("command", WearProtocol.redacted(command))
                .put("deadlineAt", command.getLong("expiresAt")).put("receivedElapsed", elapsed)
                .put("dueElapsed", elapsed + remaining).put("boot", WearProtocol.boot(context))
                .put("redacted", message).put("emitted", false);
            if (message) transientArgs.put(key(node, id), new JSONObject(command.getJSONObject("args").toString()));
            try { pending().put(key(node, id), receipt); save(); }
            catch (RuntimeException e) { pending().remove(key(node, id)); transientArgs.remove(key(node, id)); throw e; }
            send(node, result(id, "queued", null));
            GymWearPlugin p = plugin.get();
            if (p != null && p.isForeground()) {
                JSONObject ev = event(receipt);
                if (ev != null) p.commandEvent(ev);
            }
        } catch (Exception e) {
            // Žiadny text výnimky: správa parsera by mohla niesť obsah príkazu.
            android.util.Log.w("GymWear", "Receipt not accepted: " + e.getClass().getSimpleName());
        }
    }
    private void journal(String node, byte[] bytes) throws Exception {
        JSONObject config = configuration();
        if (config == null || !config.optBoolean("enabled") || !node.equals(config.optString("peer"))) return;
        JSONObject batch = WearProtocol.parse(bytes, surotvsk.gymapp.wear.JournalRules.MAX_BATCH_BYTES);
        confirmAdopted(node, batch);
        PhoneInbox.Accepted accepted = inbox.accept(config, node, batch);
        if (accepted.ack != null) {
            Wearable.getMessageClient(context).sendMessage(node, WearProtocol.JOURNAL_ACK, WearProtocol.bytes(accepted.ack));
        }
        GymWearPlugin p = plugin.get();
        if (accepted.staged && p != null) p.journalEvent();
    }
    private void packRequest(String node, byte[] bytes) throws Exception {
        JSONObject request = WearProtocol.parse(bytes, 2048);
        WearProtocol.packRequest(request);
        if (!bound(node, request)) return;
        confirmAdopted(node, request);
        JSONObject pack = inbox.currentPack(configuration());
        if (pack != null) sendPack(node, pack);
    }
    private void unlink(String node, JSONObject request) throws Exception {
        String epoch = request.optString("epoch"), workspace = request.optString("workspace");
        // Hodinky potvrdili použité odvolanie (alebo sa samy odpojili): povinnosť zaniká a ACK dostanú aj pri opakovaní.
        if (RevocationLedger.has(data, node, epoch) || RevocationLedger.isConfirmed(data, epoch)) {
            mutate(next -> RevocationLedger.confirm(next, node, epoch));
            sendUnlinkAck(node, epoch, workspace);
        }
        if (!bound(node, request) || request.optInt("v") != 1) return;
        JSONObject c = new JSONObject(configuration().toString()).put("enabled", false);
        // Trvalé odvolanie musí predchádzať udalosti aj sieťovým operáciám.
        mutate(next -> {
            try {
                JSONObject revoked = next.optJSONObject("revoked");
                if (revoked == null) { revoked = new JSONObject(); next.put("revoked", revoked); }
                revoked.put(epoch, true); next.put("configuration", c);
                RevocationLedger.confirm(next, node, epoch);
            } catch (org.json.JSONException e) { throw new IllegalStateException(e); }
        });
        expire();
        sendUnlinkAck(node, epoch, workspace);
        transientArgs.clear(); scopeInbox(c);
        GymWearPlugin p = plugin.get();
        if (p != null) p.unlinkEvent(new JSONObject().put("nodeId", node).put("epoch", c.getString("epoch")));
        // Hodinky už väzbu odvolali samy; po súkromných snapshotoch cez správy nezostáva nič na prepísanie.
    }
}
