package surotvsk.gymapp.wear;

import android.content.Context;
import android.os.SystemClock;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Súkromný snapshot žije iba v pamäti. Po odpojení čakáme na nový heartbeat.
 * Denník tréningu (WatchJournal) je jediná trvalá súkromná vec a prežije odpojenie aj reštart;
 * správy z konverzácií sa nikdy neukladajú.
 */
final class WatchLink {
    private static final long RESEND_MS = 5000, PACK_MISSING_MS = 30000, PACK_RENEW_MS = 600000, PACK_SOON_MS = 12L * 3600 * 1000;
    private static WatchLink instance;
    static synchronized WatchLink get(Context c) {
        if (instance == null) instance = new WatchLink(c.getApplicationContext());
        return instance;
    }
    final Context context;
    final WearDisk disk;
    private final WatchJournal journal;
    private JSONObject state;
    private JSONObject snapshot;
    private final Set<String> connected = new HashSet<>();
    private final List<Runnable> afterRefresh = new ArrayList<>();
    private final Map<String, Long> lastSend = new HashMap<>();
    private long connectionWall, snapshotDue, lastPackRequest;
    private String localNode = "";
    private long revision;
    private int outcome = R.string.command_idle;
    private boolean checking;
    private WatchLink(Context c) {
        context = c; disk = new WearDisk(c, "gymwear-link.json"); state = disk.readOrEmpty();
        final Context app = c;
        journal = new WatchJournal(new WearDisk(c, "gymwear-journal.json"), new WearEnv() {
            @Override public long wall() { return System.currentTimeMillis(); }
            @Override public int boot() { return WearProtocol.boot(app); }
            @Override public String uuid() { return UUID.randomUUID().toString(); }
        });
    }
    private void save() { disk.write(state); revision++; }
    private static void log(String what, RuntimeException e) {
        // Len kód: výnimky denníka nikdy nenesú obsah, ale ani jeho okolie nelogujeme.
        android.util.Log.w("GymWear", what + ": " + (e instanceof JournalError ? ((JournalError) e).code : e.getClass().getSimpleName()));
    }
    synchronized long revision() { checkPending(); checkFreshness(); return revision; }
    synchronized int outcome() { checkPending(); return outcome; }
    synchronized String language() { return snapshot == null ? "" : snapshot.optString("language"); }
    synchronized boolean linkedGeneration() { return !state.optString("epoch").isEmpty(); }
    synchronized boolean busy() { checkPending(); return state.optJSONObject("pending") != null; }
    synchronized JSONObject visible() {
        checkFreshness();
        return snapshot;
    }
    private void checkFreshness() {
        if (snapshot != null && (!connected.contains(state.optString("phone"))
            || SystemClock.elapsedRealtime() >= snapshotDue || System.currentTimeMillis() >= snapshot.optLong("expiresAt"))) {
            snapshot = null; revision++;
        }
    }
    private static boolean message(JSONObject pending) {
        JSONObject c = pending == null ? null : pending.optJSONObject("command");
        return c != null && "messageReply".equals(c.optString("type"));
    }
    private void checkPending() {
        JSONObject pending = state.optJSONObject("pending");
        if (pending != null && !WearProtocol.live(context, pending)) {
            boolean message = message(pending);
            state.remove("pending"); outcome = message ? R.string.message_unknown : R.string.command_timeout; save();
        }
    }
    synchronized void refresh() { refresh(null); }
    private void refresh(Runnable after) {
        if (after != null) afterRefresh.add(after);
        if (checking) return;
        checking = true;
        Wearable.getNodeClient(context).getLocalNode().addOnCompleteListener(local -> {
            synchronized (WatchLink.this) { if (local.isSuccessful()) localNode = local.getResult().getId(); }
            Wearable.getNodeClient(context).getConnectedNodes().addOnCompleteListener(task -> {
                synchronized (WatchLink.this) {
                    checking = false;
                    Set<String> next = new HashSet<>();
                    if (task.isSuccessful()) for (Node n : task.getResult()) next.add(n.getId());
                    boolean changed = !next.equals(connected);
                    if (changed) {
                        connected.clear(); connected.addAll(next);
                        connectionWall = System.currentTimeMillis(); snapshot = null; revision++;
                        lastSend.clear();
                    }
                    resendRevocations();
                    // Po opätovnom spojení sa nedoručená práca dosynchronizuje aj bez otvorenej obrazovky.
                    syncNow();
                    List<Runnable> queued = new ArrayList<>(afterRefresh); afterRefresh.clear();
                    for (Runnable r : queued) r.run();
                }
            });
        });
    }
    synchronized void disconnected(String node) {
        if (connected.remove(node)) { snapshot = null; connectionWall = System.currentTimeMillis(); revision++; }
    }
    /** Súkromný snapshot príde správou adresovanou len tomuto uzlu; odosielateľ sa overí voči aktuálnym spojeniam. */
    synchronized void snapshotMessage(String source, byte[] payload) {
        if (!localNode.isEmpty() && connected.contains(source)) accept(source, payload);
        else refresh(() -> accept(source, payload));
    }
    private synchronized void accept(String source, byte[] payload) {
        try {
            if (!connected.contains(source) || localNode.isEmpty()) return;
            JSONObject s = WearProtocol.parse(payload, WearProtocol.MAX_SNAPSHOT);
            WearProtocol.snapshot(s);
            JSONObject binding = s.getJSONObject("binding");
            String epoch = binding.getString("epoch");
            if (!binding.getString("peer").equals(localNode)) return;
            JSONObject revoked = state.optJSONObject("revoked");
            if (revoked != null && revoked.has(epoch)) return;
            String phone = state.optString("phone");
            if (!phone.isEmpty() && !phone.equals(source) && linkedGeneration()) return;
            if (!binding.getBoolean("enabled")) {
                if (epoch.equals(state.optString("epoch")) && source.equals(phone)) revoke();
                return;
            }
            long now = System.currentTimeMillis(), created = s.getLong("createdAt");
            if (created > now + 5000 || created < connectionWall - 1000 || s.getLong("expiresAt") <= now) return;
            boolean same = epoch.equals(state.optString("epoch"));
            if (same && (!binding.getString("workspace").equals(state.optString("workspace"))
                || s.getLong("seq") <= state.optLong("seq", -1))) return;
            // Súkromná práca starej väzby sa zahodí PRED prijatím novej; zlyhanie zápisu snapshot odmietne.
            if (journal.unreadable()) journal.reload();
            journal.bind(epoch, binding.getString("workspace"));
            if (!same) {
                snapshot = null;
                // Starú generáciu už nesmie obnoviť oneskorená správa.
                if (!state.optString("epoch").isEmpty()) {
                    if (revoked == null) { revoked = new JSONObject(); state.put("revoked", revoked); }
                    revoked.put(state.getString("epoch"), true);
                }
                state.remove("pending"); lastSend.clear();
            }
            state.put("phone", source).put("epoch", epoch).put("workspace", binding.getString("workspace"))
                .put("seq", s.getLong("seq"));
            save(); snapshot = s;
            snapshotDue = SystemClock.elapsedRealtime() + Math.min(60000, s.getLong("expiresAt") - now);
            JSONArray statuses = s.optJSONArray("journal");
            if (statuses != null) {
                try { if (journal.phoneStatuses(statuses)) revision++; }
                catch (RuntimeException e) { log("Journal status not applied", e); }
            }
            syncNow();
        } catch (Exception e) {
            if (e instanceof RuntimeException) log("Snapshot ignored", (RuntimeException) e);
            else android.util.Log.w("GymWear", "Snapshot ignored: " + e.getClass().getSimpleName());
        }
    }
    /** Balík plánov z telefónu (rovnaký uzol a väzba ako snapshot). */
    synchronized void packMessage(String source, byte[] payload) {
        try {
            if (!linkedGeneration() || !source.equals(state.optString("phone"))) return;
            JSONObject pack = WearProtocol.parse(payload, JournalRules.MAX_PACK_BYTES);
            if (journal.acceptPack(pack)) revision++;
        } catch (Exception e) {
            if (e instanceof RuntimeException) log("Pack ignored", (RuntimeException) e);
            else android.util.Log.w("GymWear", "Pack ignored: " + e.getClass().getSimpleName());
        }
    }
    /** JOURNAL_ACK: len od prepojeného telefónu; ACK nad odoslaným sa zahodí bez zmeny. */
    synchronized void journalAck(String source, byte[] payload) {
        try {
            if (!linkedGeneration() || !source.equals(state.optString("phone"))) return;
            JSONObject ack = WearProtocol.parse(payload, JournalRules.MAX_ACK_BYTES);
            JournalRules.ack(ack);
            // Rovnaké odmietnutie (alebo opakované ACK) nič nemení; okamžité opätovné odoslanie by vytvorilo slučku bez odstupu.
            if (journal.ack(ack)) { revision++; lastSend.remove(ack.getString("sessionId")); syncNow(); }
        } catch (Exception e) {
            if (e instanceof RuntimeException) log("Journal ack ignored", (RuntimeException) e);
            else android.util.Log.w("GymWear", "Journal ack ignored: " + e.getClass().getSimpleName());
        }
    }
    /** Odošle dávky nepotvrdených operácií a v prípade potreby vyžiada balík. Bez spojenia nerobí nič (práca ostáva uložená). */
    synchronized void syncNow() {
        if (journal.unreadable()) journal.reload();
        try {
            String phone = state.optString("phone");
            if (!linkedGeneration() || phone.isEmpty() || !connected.contains(phone)
                || !journal.epoch().equals(state.optString("epoch")) || journal.unreadable()) return;
            long elapsed = SystemClock.elapsedRealtime();
            Set<String> skip = new HashSet<>();
            for (Map.Entry<String, Long> e : lastSend.entrySet()) if (elapsed - e.getValue() < RESEND_MS) skip.add(e.getKey());
            for (JSONObject batch : journal.pendingBatches(skip)) {
                lastSend.put(batch.getString("sessionId"), elapsed);
                Wearable.getMessageClient(context).sendMessage(phone, WearProtocol.JOURNAL, WearProtocol.bytes(batch));
            }
            requestPack(phone, elapsed);
        } catch (Exception e) {
            if (e instanceof RuntimeException) log("Journal sync postponed", (RuntimeException) e);
            else android.util.Log.w("GymWear", "Journal sync postponed: " + e.getClass().getSimpleName());
        }
    }
    private void requestPack(String phone, long elapsed) throws Exception {
        JSONObject grants = snapshot == null ? null : snapshot.optJSONObject("grants");
        if (snapshot == null) {
            // Bez čerstvého snapshotu hodinky aspoň ozvú telefónu: ak väzbu medzitým odvolal, odpovie náhrobkom.
            if (elapsed - lastPackRequest < PACK_MISSING_MS) return;
            lastPackRequest = elapsed;
            JSONObject hello = new JSONObject().put("v", 1).put("epoch", state.getString("epoch")).put("workspace", state.getString("workspace"));
            Wearable.getMessageClient(context).sendMessage(phone, WearProtocol.PACK_REQUEST, WearProtocol.bytes(hello));
            return;
        }
        if (grants == null || !grants.optBoolean("offline") || snapshot.isNull("packRev")) return;
        JSONObject pack = journal.pack();
        long now = System.currentTimeMillis();
        boolean missing = pack == null || !pack.optString("packRev").equals(snapshot.optString("packRev"));
        boolean soon = !missing && pack.optLong("expiresAt") - now < PACK_SOON_MS;
        if (!(missing && elapsed - lastPackRequest >= PACK_MISSING_MS) && !(soon && elapsed - lastPackRequest >= PACK_RENEW_MS)) return;
        lastPackRequest = elapsed;
        JSONObject request = new JSONObject().put("v", 1).put("epoch", state.getString("epoch")).put("workspace", state.getString("workspace"));
        Wearable.getMessageClient(context).sendMessage(phone, WearProtocol.PACK_REQUEST, WearProtocol.bytes(request));
    }

    /* ---------- denník: UI volá tieto metódy; zmena sa najprv zapíše na disk ---------- */
    synchronized WatchJournal journal() { return journal; }
    synchronized String startPlan(String planId) { String id = journal.startPlan(planId); revision++; syncNow(); return id; }
    synchronized String continueActive() { String id = journal.continueActive(); revision++; syncNow(); return id; }
    synchronized void toggle(String sessionId, String key) { journal.toggle(sessionId, key); revision++; syncNow(); }
    synchronized void finishSession(String sessionId) { journal.finish(sessionId); revision++; lastSend.remove(sessionId); syncNow(); }
    synchronized void discardSession(String sessionId) { journal.discard(sessionId); revision++; lastSend.remove(sessionId); syncNow(); }
    /** Používateľ vedome opúšťa prácu, ktorú telefón odmietol; vždy po potvrdení v UI. */
    synchronized void dropReview(String sessionId) { journal.dropReview(sessionId); revision++; lastSend.remove(sessionId); }
    synchronized int unsynced() { return journal.outstanding(); }
    synchronized boolean grant(String name) {
        JSONObject g = snapshot == null ? null : snapshot.optJSONObject("grants");
        return g != null && g.optBoolean(name);
    }
    /** Súhlas na správy platí len pri čerstvom snapshote; pamäť konverzácií sa tým nikdy nepredlžuje. */
    synchronized JSONArray messages() {
        visible();
        return snapshot != null && grant("messages") ? snapshot.optJSONArray("messages") : null;
    }

    synchronized void unlink() throws Exception {
        revoke();
    }
    private void revoke() throws Exception {
        // Potvrdenie odvolania smie odísť až po úspešnom prepísaní aj poškodeného denníka.
        journal.wipe();
        lastSend.clear();
        String epoch = state.optString("epoch"), phone = state.optString("phone");
        if (!epoch.isEmpty()) {
            JSONObject revoked = state.optJSONObject("revoked");
            if (revoked == null) { revoked = new JSONObject(); state.put("revoked", revoked); }
            revoked.put(epoch, true);
            // Potvrdenie pre telefón (UNLINK danej epochy) sa opakuje pri každom pripojení, kým nepríde jeho ACK.
            {
                JSONObject revocations = state.optJSONObject("revocations");
                if (revocations == null) { revocations = new JSONObject(); state.put("revocations", revocations); }
                revocations.put(epoch, new JSONObject().put("node", phone).put("v", 1).put("epoch", epoch)
                    .put("workspace", state.optString("workspace")));
            }
        }
        snapshot = null; state.remove("pending"); state.remove("epoch"); state.remove("workspace"); state.remove("seq");
        outcome = R.string.command_idle; save(); resendRevocations();
    }
    private void resendRevocations() {
        JSONObject revocations = state.optJSONObject("revocations");
        JSONArray keys = revocations == null ? null : revocations.names();
        if (keys == null) return;
        for (int i = 0; i < keys.length(); i++) {
            JSONObject r = revocations.optJSONObject(keys.optString(i));
            if (r != null && connected.contains(r.optString("node")))
                Wearable.getMessageClient(context).sendMessage(r.optString("node"), WearProtocol.UNLINK, WearProtocol.bytes(r));
        }
    }
    /** ACK telefónu na UNLINK: potvrdenie bolo prijaté, ďalšie opakovanie netreba. */
    synchronized void unlinkAck(String source, byte[] payload) {
        try {
            JSONObject ack = WearProtocol.parse(payload, 2048);
            if (WearProtocol.number(ack, "v") != 1 || !Boolean.TRUE.equals(ack.opt("ack"))) return;
            String epoch = WearProtocol.text(ack, "epoch", 160);
            JSONObject revocations = state.optJSONObject("revocations");
            JSONObject entry = revocations == null ? null : revocations.optJSONObject(epoch);
            if (entry == null || !source.equals(entry.optString("node"))) return;
            revocations.remove(epoch); save();
        } catch (Exception e) { android.util.Log.w("GymWear", "Unlink ack ignored: " + e.getClass().getSimpleName()); }
    }
    /** Odpoveď na správu: text ide len v pamäti odoslanej správy; na disk sa zapíše redigovaný príkaz. */
    synchronized boolean submitMessage(String conversationId, String body) {
        boolean allowed = ReplyGuard.allowed(messages(), conversationId);
        if (!allowed || body.trim().isEmpty() || body.length() > WearProtocol.MAX_REPLY) { outcome = R.string.command_unavailable; revision++; return false; }
        try { return submit("messageReply", new JSONObject().put("conversationId", conversationId).put("body", body)); }
        catch (Exception e) { outcome = R.string.command_unavailable; revision++; return false; }
    }
    synchronized boolean submit(String type, JSONObject args) {
        try {
            JSONObject s = visible();
            if (s == null || busy() || WearProtocol.boot(context) < 0) { outcome = R.string.command_unavailable; revision++; return false; }
            long now = System.currentTimeMillis(), elapsed = SystemClock.elapsedRealtime();
            JSONObject session = s.optJSONObject("session"), rest = s.optJSONObject("rest");
            JSONObject command = new JSONObject().put("v", 1).put("id", UUID.randomUUID().toString())
                .put("epoch", state.getString("epoch")).put("workspace", state.getString("workspace"))
                .put("sessionId", session == null ? JSONObject.NULL : session.getString("id"))
                .put("restId", rest == null ? JSONObject.NULL : rest.getString("id"))
                .put("type", type).put("args", args).put("issuedAt", now).put("expiresAt", now + 10000);
            WearProtocol.command(command, now);
            String node = state.getString("phone");
            // Trvalý záznam čakajúceho príkazu nikdy nenesie text odpovede ani ID konverzácie.
            JSONObject pending = new JSONObject().put("command", WearProtocol.redacted(command)).put("node", node)
                .put("deadlineAt", now + 10000).put("receivedElapsed", elapsed).put("dueElapsed", elapsed + 10000)
                .put("boot", WearProtocol.boot(context));
            state.put("pending", pending); outcome = R.string.command_waiting; save();
            Wearable.getMessageClient(context).sendMessage(node, WearProtocol.COMMAND, WearProtocol.bytes(command))
                .addOnFailureListener(e -> {
                    synchronized (WatchLink.this) {
                        JSONObject current = state.optJSONObject("pending");
                        if (current != null && command.optString("id").equals(current.optJSONObject("command").optString("id"))) {
                            // Chyba doručenia nepotvrdzuje, že telefón nevykonal príkaz.
                            state.remove("pending"); outcome = message(current) ? R.string.message_unknown : R.string.command_unknown; save();
                        }
                    }
                });
            return true;
        } catch (Exception e) { outcome = R.string.command_unavailable; revision++; return false; }
    }
    synchronized void ack(String node, byte[] bytes) {
        try {
            checkPending();
            JSONObject pending = state.optJSONObject("pending");
            if (pending == null || !node.equals(pending.getString("node"))) return;
            JSONObject result = WearProtocol.parse(bytes, 4096);
            if (!result.getString("id").equals(pending.getJSONObject("command").getString("id"))) return;
            WearProtocol.require(WearProtocol.number(result, "seq") >= 0, "seq");
            String status = result.getString("status");
            boolean message = message(pending);
            if (status.equals("queued")) { outcome = R.string.command_queued; revision++; return; }
            if (status.equals("applied")) outcome = message ? R.string.message_sent : R.string.command_applied;
            else if (status.equals("stale")) outcome = message ? R.string.message_not_sent : R.string.command_stale;
            else if (status.equals("rejected")) outcome = message ? R.string.message_not_sent : R.string.request_rejected;
            else if (status.equals("unknown")) outcome = message ? R.string.message_unknown : R.string.command_unknown;
            else return;
            state.remove("pending"); save();
        } catch (Exception e) { android.util.Log.w("GymWear", "Ack ignored: " + e.getClass().getSimpleName()); }
    }
}
