package surotvsk.gymapp;

import android.content.Context;
import android.os.SystemClock;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.tasks.Tasks;
import org.json.JSONArray;
import org.json.JSONObject;
import surotvsk.gymapp.wear.WearDisk;
import surotvsk.gymapp.wear.WearProtocol;
import java.lang.ref.WeakReference;
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
    private JSONObject data;
    private WeakReference<GymWearPlugin> plugin = new WeakReference<>(null);
    private WearPhone(Context c) {
        context = c; disk = new WearDisk(c, "gymwear-phone.json"); data = disk.read();
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
        pending().remove(key);
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
            JSONObject r = queue.getJSONObject(keys.getString(i));
            JSONObject cmd = r.getJSONObject("command");
            if (!WearProtocol.live(context, r) || !bound(r.getString("nodeId"), cmd)) {
                JSONObject answer = result(cmd.getString("id"), "stale", "expired_or_revoked");
                remember(r.getString("nodeId"), cmd.getString("id"), answer);
                send(r.getString("nodeId"), answer);
            }
        }
    }
    void configure(JSONObject c) throws Exception {
        WearProtocol.configuration(c);
        JSONObject old = configuration();
        if (WearProtocol.same(old, c)) {
            if (!c.getBoolean("enabled")) revokeRemote(c);
            return;
        }
        JSONObject revoked = data.optJSONObject("revoked");
        if (revoked == null) { revoked = new JSONObject(); data.put("revoked", revoked); }
        if (c.getBoolean("enabled")) {
            WearProtocol.require(!revoked.has(c.getString("epoch")), "new_consent_epoch_required");
            if (old != null && (!old.optString("workspace").equals(c.getString("workspace"))
                || !old.optString("peer").equals(c.getString("peer")) || !old.optBoolean("enabled"))) {
                WearProtocol.require(!old.optString("epoch").equals(c.getString("epoch")), "new_consent_epoch_required");
            }
        }
        if (old != null && !old.optString("epoch").equals(c.getString("epoch"))) revoked.put(old.getString("epoch"), true);
        if (!c.getBoolean("enabled")) revoked.put(c.getString("epoch"), true);
        data.put("configuration", new JSONObject(c.toString()));
        if (old == null || !old.optString("epoch").equals(c.getString("epoch"))) data.put("seq", -1);
        save();
        expire();
        // Trvalé lokálne odvolanie je autorita. Náhrobok je len snaha; offline hodinky vypršia podľa TTL.
        boolean epochChanged = old != null && !old.optString("epoch").equals(c.getString("epoch"));
        if (old != null && (epochChanged || !c.getBoolean("enabled"))) revokeRemote(old);
        if (!c.getBoolean("enabled") && !(old != null && !epochChanged && old.optString("peer").equals(c.getString("peer"))))
            revokeRemote(c);
    }
    private JSONObject tombstone(JSONObject config) throws Exception {
        JSONObject binding = new JSONObject(config.toString()).put("enabled", false);
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
    /** Náhrobok pre bývalého schváleného partnera; chyba doručenia nikdy nevracia lokálne odvolanie. */
    private void revokeRemote(JSONObject config) {
        String peer = config.optString("peer");
        if (peer.isEmpty()) return;
        try {
            Wearable.getMessageClient(context).sendMessage(peer, WearProtocol.SNAPSHOT, snapshotBytes(tombstone(config)))
                .addOnFailureListener(e -> android.util.Log.w("GymWear", "Revocation not delivered; watch snapshot expires by TTL", e));
        } catch (Exception e) { android.util.Log.w("GymWear", "Revocation not sent; watch snapshot expires by TTL", e); }
    }
    void publish(JSONObject snapshot) throws Exception {
        WearProtocol.snapshot(snapshot);
        JSONObject config = configuration();
        WearProtocol.require(WearProtocol.same(config, snapshot.getJSONObject("binding")), "configuration_mismatch");
        WearProtocol.require(config.getBoolean("enabled"), "wear_disabled");
        long now = System.currentTimeMillis();
        WearProtocol.require(snapshot.getLong("createdAt") <= now + 5000 && snapshot.getLong("expiresAt") > now, "snapshot_expired");
        WearProtocol.require(snapshot.getLong("seq") > data.optLong("seq", -1), "snapshot_sequence");
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
    JSONArray drain() throws Exception {
        expire(); JSONArray output = new JSONArray(); JSONObject queue = pending(); JSONArray keys = queue.names();
        if (keys != null) for (int i = 0; i < keys.length(); i++) {
            JSONObject r = queue.getJSONObject(keys.getString(i));
            output.put(event(r));
        }
        return output;
    }
    JSONObject event(JSONObject receipt) throws Exception {
        return new JSONObject().put("nodeId", receipt.getString("nodeId"))
            .put("command", receipt.getJSONObject("command")).put("deadlineAt", receipt.getLong("deadlineAt"));
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
        WearProtocol.require(WearProtocol.number(answer, "seq") >= 0 && WearProtocol.bytes(answer).length <= 4096, "ack_result");
        if (!status.equals("queued")) remember(node, id, new JSONObject(answer.toString()));
        send(node, answer);
    }
    void receive(String node, String path, byte[] bytes) {
        try {
            if (WearProtocol.UNLINK.equals(path)) { unlink(node, WearProtocol.parse(bytes, 2048)); return; }
            if (!WearProtocol.COMMAND.equals(path)) return;
            JSONObject command = WearProtocol.parse(bytes, 4096);
            String id = command.optString("id");
            if (id.isEmpty() || id.length() > 36) return;
            // Cudzí uzol nedostane žiadne informácie o konfigurácii ani výsledkoch.
            if (!bound(node, command)) {
                send(node, result(id, "rejected", "binding_mismatch")); return;
            }
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
            if (pending().length() >= 32 || WearProtocol.boot(context) < 0) {
                JSONObject rejected = result(id, "rejected", "queue_unavailable");
                remember(node, id, rejected); send(node, rejected); return;
            }
            long now = System.currentTimeMillis(), elapsed = SystemClock.elapsedRealtime();
            long remaining = Math.min(10000, command.getLong("expiresAt") - now);
            JSONObject receipt = new JSONObject().put("nodeId", node).put("command", command)
                .put("deadlineAt", command.getLong("expiresAt")).put("receivedElapsed", elapsed)
                .put("dueElapsed", elapsed + remaining).put("boot", WearProtocol.boot(context));
            pending().put(key(node, id), receipt); save();
            send(node, result(id, "queued", null));
            GymWearPlugin p = plugin.get();
            if (p != null) p.commandEvent(event(receipt));
        } catch (Exception e) { android.util.Log.w("GymWear", "Receipt not accepted", e); }
    }
    private void unlink(String node, JSONObject request) throws Exception {
        if (!bound(node, request) || request.optInt("v") != 1) return;
        JSONObject c = new JSONObject(configuration().toString()).put("enabled", false);
        // Trvalé odvolanie musí predchádzať udalosti aj sieťovým operáciám.
        JSONObject revoked = data.optJSONObject("revoked");
        if (revoked == null) { revoked = new JSONObject(); data.put("revoked", revoked); }
        revoked.put(c.getString("epoch"), true); data.put("configuration", c); save(); expire();
        GymWearPlugin p = plugin.get();
        if (p != null) p.unlinkEvent(new JSONObject().put("nodeId", node).put("epoch", c.getString("epoch")));
        // Hodinky už väzbu odvolali samy; po súkromných snapshotoch cez správy nezostáva nič na prepísanie.
    }
}
