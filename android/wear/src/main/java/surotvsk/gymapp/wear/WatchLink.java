package surotvsk.gymapp.wear;

import android.content.Context;
import android.os.SystemClock;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Súkromný snapshot žije iba v pamäti. Po odpojení čakáme na nový heartbeat. */
final class WatchLink {
    private static WatchLink instance;
    static synchronized WatchLink get(Context c) {
        if (instance == null) instance = new WatchLink(c.getApplicationContext());
        return instance;
    }
    final Context context;
    final WearDisk disk;
    private JSONObject state;
    private JSONObject snapshot;
    private final Set<String> connected = new HashSet<>();
    private final List<Runnable> afterRefresh = new ArrayList<>();
    private long connectionWall, snapshotDue;
    private String localNode = "";
    private long revision;
    private int outcome = R.string.command_idle;
    private boolean checking;
    private WatchLink(Context c) { context = c; disk = new WearDisk(c, "gymwear-link.json"); state = disk.read(); }
    private void save() { disk.write(state); revision++; }
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
    private void checkPending() {
        JSONObject pending = state.optJSONObject("pending");
        if (pending != null && !WearProtocol.live(context, pending)) {
            state.remove("pending"); outcome = R.string.command_timeout; save();
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
                    }
                    resendRevocations();
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
                if (epoch.equals(state.optString("epoch")) && source.equals(phone)) revoke(false);
                return;
            }
            long now = System.currentTimeMillis(), created = s.getLong("createdAt");
            if (created > now + 5000 || created < connectionWall - 1000 || s.getLong("expiresAt") <= now) return;
            boolean same = epoch.equals(state.optString("epoch"));
            if (same && (!binding.getString("workspace").equals(state.optString("workspace"))
                || s.getLong("seq") <= state.optLong("seq", -1))) return;
            if (!same) {
                snapshot = null;
                // Starú generáciu už nesmie obnoviť oneskorená správa.
                if (!state.optString("epoch").isEmpty()) {
                    if (revoked == null) { revoked = new JSONObject(); state.put("revoked", revoked); }
                    revoked.put(state.getString("epoch"), true);
                }
                state.remove("pending");
            }
            state.put("phone", source).put("epoch", epoch).put("workspace", binding.getString("workspace"))
                .put("seq", s.getLong("seq"));
            save(); snapshot = s;
            snapshotDue = SystemClock.elapsedRealtime() + Math.min(60000, s.getLong("expiresAt") - now);
        } catch (Exception e) { android.util.Log.w("GymWear", "Snapshot ignored", e); }
    }
    synchronized void unlink() throws Exception { revoke(true); }
    private void revoke(boolean notifyPhone) throws Exception {
        String epoch = state.optString("epoch"), phone = state.optString("phone");
        if (!epoch.isEmpty()) {
            JSONObject revoked = state.optJSONObject("revoked");
            if (revoked == null) { revoked = new JSONObject(); state.put("revoked", revoked); }
            revoked.put(epoch, true);
            if (notifyPhone) {
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
            JSONObject pending = new JSONObject().put("command", command).put("node", node)
                .put("deadlineAt", now + 10000).put("receivedElapsed", elapsed).put("dueElapsed", elapsed + 10000)
                .put("boot", WearProtocol.boot(context));
            state.put("pending", pending); outcome = R.string.command_waiting; save();
            Wearable.getMessageClient(context).sendMessage(node, WearProtocol.COMMAND, WearProtocol.bytes(command))
                .addOnFailureListener(e -> {
                    synchronized (WatchLink.this) {
                        JSONObject current = state.optJSONObject("pending");
                        if (current != null && command.optString("id").equals(current.optJSONObject("command").optString("id"))) {
                            // Chyba doručenia nepotvrdzuje, že telefón nevykonal príkaz.
                            state.remove("pending"); outcome = R.string.command_unknown; save();
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
            if (status.equals("queued")) { outcome = R.string.command_queued; revision++; return; }
            if (status.equals("applied")) outcome = R.string.command_applied;
            else if (status.equals("stale")) outcome = R.string.command_stale;
            else if (status.equals("rejected")) outcome = R.string.request_rejected;
            else if (status.equals("unknown")) outcome = R.string.command_unknown;
            else return;
            state.remove("pending"); save();
        } catch (Exception e) { android.util.Log.w("GymWear", "Ack ignored", e); }
    }
}
