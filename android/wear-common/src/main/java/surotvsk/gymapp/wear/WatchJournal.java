package surotvsk.gymapp.wear;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/**
 * Trvalý denník tréningu na hodinkách: uložený balík plánov a zhmotnené relácie s operáciami.
 * Každá zmena sa vykoná na kópii, zapíše atómovo a až potom nahradí pamäťový stav, takže
 * zlyhanie zápisu nikdy nezmení to, čo vidí UI, a nezničí neprijatú prácu.
 * Telefón ostáva jediným kanonickým úložiskom histórie; ACK znamená len "uložené na telefóne".
 */
public final class WatchJournal {
    private static final int RECENT = 5, TOMBSTONES = 100;
    private final WearStore store;
    private final WearEnv env;
    private JSONObject state;
    private boolean unreadable;

    public WatchJournal(WearStore store, WearEnv env) {
        this.store = store; this.env = env;
        JSONObject read;
        try { read = store.read(); } catch (RuntimeException e) { read = null; unreadable = true; }
        if (read == null) { state = fresh(); return; }
        if (read.length() == 0) state = fresh();
        else if (read.optInt("v") != 1 || read.optJSONObject("sessions") == null || read.optJSONArray("order") == null) {
            state = fresh(); unreadable = true;
        } else state = read;
    }
    private static JSONObject fresh() {
        try {
            return new JSONObject().put("v", 1).put("epoch", "").put("workspace", "").put("pack", JSONObject.NULL)
                .put("sessions", new JSONObject()).put("order", new JSONArray()).put("tombstones", new JSONObject())
                .put("tombOrder", new JSONArray()).put("recent", new JSONArray());
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }
    private static JSONObject copy(JSONObject o) {
        try { return new JSONObject(o.toString()); } catch (JSONException e) { throw new IllegalStateException(e); }
    }
    private static void reset(JSONObject s) throws JSONException {
        s.put("pack", JSONObject.NULL).put("sessions", new JSONObject()).put("order", new JSONArray())
            .put("tombstones", new JSONObject()).put("tombOrder", new JSONArray()).put("recent", new JSONArray());
    }

    /** Zmena na kópii; dirty=false znamená, že sa nič nezapisuje. */
    private static final class Tx { final JSONObject s; boolean dirty; Tx(JSONObject s) { this.s = s; } }
    private interface Change<T> { T apply(Tx tx) throws Exception; }
    private synchronized <T> T commit(Change<T> change) {
        if (unreadable) throw new JournalError("storage_unreadable");
        Tx tx = new Tx(copy(state)); T result;
        try { result = change.apply(tx); }
        catch (JournalError e) { throw e; }
        catch (JSONException e) { throw new JournalError(JournalRules.isCode(e.getMessage()) ? e.getMessage() : "rejected", e); }
        catch (RuntimeException e) { throw e; }
        catch (Exception e) { throw new JournalError("rejected", e); }
        if (tx.dirty) {
            try { store.write(tx.s); } catch (RuntimeException e) { throw new JournalError("storage", e); }
            state = tx.s;
        }
        return result;
    }

    /* ---------- väzba ---------- */
    public synchronized boolean unreadable() { return unreadable; }
    public synchronized String epoch() { return state.optString("epoch"); }
    /** Nová epocha alebo pracovný priestor zahodí súkromnú vyrovnávaciu pamäť aj relácie starej väzby. */
    public void bind(String epoch, String workspace) {
        commit(tx -> {
            if (!epoch.equals(tx.s.optString("epoch")) || !workspace.equals(tx.s.optString("workspace"))) {
                reset(tx.s); tx.s.put("epoch", epoch).put("workspace", workspace); tx.dirty = true;
            }
            return null;
        });
    }
    /** Odpojenie: súkromné dáta pre túto väzbu zmiznú (volajúci predtým varoval pred nesynchronizovanou prácou). */
    public synchronized void wipe() {
        JSONObject next = fresh();
        try { store.write(next); } catch (RuntimeException e) { throw new JournalError("storage", e); }
        state = next;
        unreadable = false;
    }

    /* ---------- balík plánov ---------- */
    /** @return true ak sa uložený balík zmenil. Balík inej väzby alebo starší než uložený sa ignoruje. */
    public boolean acceptPack(JSONObject pack) {
        return commit(tx -> {
            JournalRules.pack(pack, env.wall(), 600000);
            if (tx.s.optString("epoch").isEmpty() || !tx.s.optString("epoch").equals(pack.getString("epoch"))
                || !tx.s.optString("workspace").equals(pack.getString("workspace"))) throw new JournalError("binding");
            if (pack.getLong("expiresAt") <= env.wall()) throw new JournalError("pack_expired");
            JSONObject current = tx.s.optJSONObject("pack");
            if (current != null) {
                JSONObject old = current.getJSONObject("pack");
                if (old.getString("packRev").equals(pack.getString("packRev"))) {
                    if (pack.getLong("expiresAt") <= old.getLong("expiresAt")) return false;
                    old.put("createdAt", pack.getLong("createdAt")).put("expiresAt", pack.getLong("expiresAt"));
                    tx.dirty = true; return true;
                }
                if (pack.getLong("createdAt") < old.getLong("createdAt")) return false;
            }
            tx.s.put("pack", new JSONObject().put("pack", copy(pack)).put("receivedAt", env.wall()));
            tx.dirty = true; return true;
        });
    }
    public synchronized JSONObject pack() {
        JSONObject wrapper = state.optJSONObject("pack");
        return wrapper == null ? null : wrapper.optJSONObject("pack");
    }
    /** Nový štart je možný len pred koncom platnosti balíka (najviac 7 dní od vytvorenia). */
    public synchronized boolean packUsable() {
        JSONObject p = pack(); return p != null && env.wall() < p.optLong("expiresAt");
    }

    /* ---------- relácie ---------- */
    private static JSONObject op(String id, long seq, String type, String key, long at, int boot) throws JSONException {
        JSONObject o = new JSONObject().put("opId", id).put("seq", seq).put("type", type);
        if (key != null) o.put("setKey", key);
        o.put("at", at);
        if (boot >= 0) o.put("boot", boot);
        return o;
    }
    private void admit(JSONObject s) {
        if (s.optString("epoch").isEmpty()) throw new JournalError("not_linked");
        JSONObject sessions = s.optJSONObject("sessions");
        Iterator<String> it = sessions.keys();
        while (it.hasNext()) if ("open".equals(sessions.optJSONObject(it.next()).optString("state"))) throw new JournalError("open_exists");
        if (sessions.length() >= JournalRules.MAX_OUTSTANDING) throw new JournalError("too_many");
    }
    private String create(Tx tx, JSONObject plan, String sessionId, String packRev, Object baselineRevision, long startedAt,
                          JSONObject base) throws JSONException {
        JSONObject s = tx.s;
        JournalRules.planKeys(plan);
        JSONObject first = op(env.uuid(), 1, "start", null, env.wall(), env.boot());
        JSONObject session = new JSONObject().put("sessionId", sessionId).put("planId", plan.getString("planId"))
            .put("planRev", plan.getString("planRev")).put("packRev", packRev).put("baselineRevision", baselineRevision)
            .put("startedAt", startedAt).put("plan", copy(plan)).put("base", copy(base)).put("marks", copy(base))
            .put("ops", new JSONArray().put(first)).put("opBytes", JournalRules.size(first)).put("nextSeq", 2)
            .put("ackSeq", 0).put("highestSent", 0).put("state", "open").put("phone", "none").put("review", false)
            .put("error", "").put("provisional", baselineRevision == JSONObject.NULL);
        s.getJSONObject("sessions").put(sessionId, session);
        s.getJSONArray("order").put(sessionId);
        tx.dirty = true; return sessionId;
    }
    /** Štart z uloženého plánu; funguje bez telefónu. */
    public String startPlan(String planId) {
        return commit(tx -> {
            admit(tx.s);
            JSONObject pack = pack();
            if (pack == null || env.wall() >= pack.getLong("expiresAt")) throw new JournalError("pack_expired");
            JSONArray plans = pack.getJSONArray("plans");
            for (int i = 0; i < plans.length(); i++) {
                JSONObject plan = plans.getJSONObject(i);
                if (plan.getString("planId").equals(planId))
                    return create(tx, plan, env.uuid(), pack.getString("packRev"), JSONObject.NULL, env.wall(), new JSONObject());
            }
            throw new JournalError("unknown_plan");
        });
    }
    /** Pokračovanie rozbehnutého tréningu z telefónu: rovnaké UUID, základné značky, väzba na verziu základu. */
    public String continueActive() {
        return commit(tx -> {
            admit(tx.s);
            JSONObject pack = pack();
            if (pack == null || env.wall() >= pack.getLong("expiresAt") || pack.isNull("active")) throw new JournalError("pack_expired");
            JSONObject seed = pack.getJSONObject("active");
            String id = seed.getString("sessionId");
            if (tx.s.getJSONObject("sessions").has(id) || tx.s.getJSONObject("tombstones").has(id)) throw new JournalError("session_known");
            return create(tx, seed.getJSONObject("plan"), id, pack.getString("packRev"), seed.getString("baselineRevision"),
                seed.getLong("startedAt"), seed.getJSONObject("completedSets"));
        });
    }
    private void append(JSONObject session, JSONObject op, boolean terminal) throws JSONException {
        JSONArray ops = session.getJSONArray("ops");
        int bytes = session.getInt("opBytes") + JournalRules.size(op);
        int countAfter = ops.length() + 1;
        // Rezerva: bežná operácia nesmie zjesť miesto pre záverečné finish/discard.
        if (terminal ? (countAfter > JournalRules.MAX_OPS || bytes > JournalRules.MAX_OP_BYTES)
            : (countAfter > JournalRules.MAX_OPS - 1 || bytes > JournalRules.MAX_OP_BYTES - JournalRules.TERMINAL_RESERVE_BYTES))
            throw new JournalError("journal_full");
        ops.put(op); session.put("opBytes", bytes).put("nextSeq", session.getLong("nextSeq") + 1);
    }
    private JSONObject open(Tx tx, String id) throws JSONException {
        JSONObject session = tx.s.getJSONObject("sessions").optJSONObject(id);
        if (session == null) throw new JournalError("unknown_session");
        if (!"open".equals(session.getString("state"))) throw new JournalError("not_open");
        return session;
    }
    /** Označí alebo zruší značku jedného setu (vrátane strany L/R). Vracia true ak je set po zmene označený. */
    public boolean toggle(String sessionId, String setKey) {
        return commit(tx -> {
            JSONObject session = open(tx, sessionId);
            Set<String> keys = JournalRules.planKeys(session.getJSONObject("plan"));
            if (!keys.contains(setKey)) throw new JournalError("unknown_key");
            JSONObject marks = session.getJSONObject("marks");
            boolean marked = marks.has(setKey);
            append(session, op(env.uuid(), session.getLong("nextSeq"), marked ? "unmark" : "mark", setKey, env.wall(), env.boot()), false);
            if (marked) marks.remove(setKey); else marks.put(setKey, true);
            tx.dirty = true; return !marked;
        });
    }
    public void finish(String sessionId) {
        commit(tx -> {
            JSONObject session = open(tx, sessionId);
            if (session.getJSONObject("marks").length() == 0) throw new JournalError("nothing_done");
            append(session, op(env.uuid(), session.getLong("nextSeq"), "finish", null, env.wall(), env.boot()), true);
            session.put("state", "finished"); tx.dirty = true; return null;
        });
    }
    /** Zahodenie. Relácia, o ktorej telefón nikdy nepočul, zmizne hneď; inak sa terminálna operácia pošle. */
    public void discard(String sessionId) {
        commit(tx -> {
            JSONObject session = open(tx, sessionId);
            if (session.getLong("highestSent") == 0) { remove(tx.s, sessionId); tx.dirty = true; return null; }
            append(session, op(env.uuid(), session.getLong("nextSeq"), "discard", null, env.wall(), env.boot()), true);
            session.put("state", "discarded"); tx.dirty = true; return null;
        });
    }
    private static void remove(JSONObject s, String id) throws JSONException {
        s.getJSONObject("sessions").remove(id);
        JSONArray order = s.getJSONArray("order"), next = new JSONArray();
        for (int i = 0; i < order.length(); i++) if (!id.equals(order.getString(i))) next.put(order.getString(i));
        s.put("order", next);
    }

    /* ---------- čítanie pre UI (objekty sa po zverejnení nemenia) ---------- */
    public synchronized List<JSONObject> sessions() {
        List<JSONObject> out = new ArrayList<>(); JSONArray order = state.optJSONArray("order");
        for (int i = 0; order != null && i < order.length(); i++) {
            JSONObject s = state.optJSONObject("sessions").optJSONObject(order.optString(i));
            if (s != null) out.add(s);
        }
        return out;
    }
    public synchronized JSONObject session(String id) { return state.optJSONObject("sessions").optJSONObject(id); }
    public synchronized JSONObject openSession() {
        for (JSONObject s : sessions()) if ("open".equals(s.optString("state"))) return s;
        return null;
    }
    public synchronized int outstanding() { return state.optJSONObject("sessions").length(); }
    public synchronized JSONArray recent() { return state.optJSONArray("recent"); }
    public static int done(JSONObject session) { return session.optJSONObject("marks").length(); }
    public static int total(JSONObject session) { return JournalRules.totalSets(session.optJSONObject("plan")); }
    public static int totalKeys(JSONObject session) {
        try { return JournalRules.planKeys(session.getJSONObject("plan")).size(); } catch (JSONException e) { return 0; }
    }
    /** local = telefón o tom ešte nepočul; waiting = časť operácií čaká; staged = telefón má všetko; conflict/review. */
    public static String status(JSONObject s) {
        if (s.optBoolean("review")) return "review";
        if ("conflict".equals(s.optString("phone"))) return "conflict";
        long last = s.optLong("nextSeq") - 1, ack = s.optLong("ackSeq");
        if (ack >= last) return "staged";
        return ack == 0 ? "local" : "waiting";
    }
    static boolean transientError(String error) { return "inbox_full".equals(error) || "storage_failed".equals(error); }

    /* ---------- synchronizácia ---------- */
    /**
     * Dávky pre relácie, ktorým chýba potvrdenie. highestSent sa zapíše PRED odoslaním, takže ACK
     * nad tým, čo hodinky skutočne poslali, sa dá odmietnuť. Pri zlyhaní zápisu sa nič neposiela.
     */
    public List<JSONObject> pendingBatches(Set<String> skip) {
        return commit(tx -> {
            List<JSONObject> out = new ArrayList<>(); JSONArray order = tx.s.getJSONArray("order");
            if (tx.s.optString("epoch").isEmpty()) return out;
            for (int i = 0; i < order.length(); i++) {
                String id = order.getString(i);
                if (skip != null && skip.contains(id)) continue;
                JSONObject s = tx.s.getJSONObject("sessions").getJSONObject(id);
                long last = s.getLong("nextSeq") - 1, ack = s.getLong("ackSeq");
                if (ack >= last) continue;
                if (s.optBoolean("review") && !transientError(s.optString("error"))) continue;
                long to = Math.min(last, ack + JournalRules.MAX_BATCH_OPS);
                JSONArray ops = new JSONArray(), all = s.getJSONArray("ops");
                for (long k = ack; k < to; k++) ops.put(copy(all.getJSONObject((int) k)));
                out.add(new JSONObject().put("v", 1).put("epoch", tx.s.getString("epoch")).put("workspace", tx.s.getString("workspace"))
                    .put("sessionId", id).put("planId", s.getString("planId")).put("planRev", s.getString("planRev"))
                    .put("packRev", s.getString("packRev")).put("baselineRevision", s.get("baselineRevision"))
                    .put("startedAt", s.getLong("startedAt")).put("fromSeq", ack + 1).put("ops", ops));
                if (to > s.getLong("highestSent")) { s.put("highestSent", to); tx.dirty = true; }
            }
            return out;
        });
    }
    private void retire(Tx tx, String id, String status) throws JSONException {
        JSONObject s = tx.s.getJSONObject("sessions").getJSONObject(id);
        JSONArray recent = tx.s.getJSONArray("recent"), next = new JSONArray();
        next.put(new JSONObject().put("sessionId", id).put("name", s.getJSONObject("plan").getString("name"))
            .put("status", status).put("at", env.wall()));
        for (int i = 0; i < recent.length() && next.length() < RECENT; i++) next.put(recent.get(i));
        tx.s.put("recent", next);
        remove(tx.s, id);
        JSONObject tombs = tx.s.getJSONObject("tombstones"); JSONArray order = tx.s.getJSONArray("tombOrder");
        tombs.put(id, status); order.put(id);
        while (order.length() > TOMBSTONES) { tombs.remove(order.getString(0)); order.remove(0); }
        tx.dirty = true;
    }
    /** Terminálny výsledok od telefónu (JS po kanonickom zápise). Relácia sa uvoľní len ak sú všetky jej operácie zahrnuté. */
    private void terminal(Tx tx, String id, String status, long ackSeq) throws JSONException {
        JSONObject s = tx.s.getJSONObject("sessions").optJSONObject(id);
        if (s == null) return;
        boolean closedLocally = !"open".equals(s.getString("state"));
        if (closedLocally && ackSeq >= s.getLong("nextSeq") - 1 && ackSeq <= s.getLong("highestSent")) { retire(tx, id, status); return; }
        if (!s.optBoolean("review") || !"phone_closed_early".equals(s.optString("error"))) {
            s.put("review", true).put("error", "phone_closed_early"); tx.dirty = true;
        }
    }
    /** JOURNAL_ACK. @return true ak sa stav zmenil. Nevalidný ACK (nad highestSent, cudzia väzba) vyhodí výnimku a nič nezmení. */
    public boolean ack(JSONObject ack) {
        return commit(tx -> {
            JournalRules.ack(ack);
            if (tx.s.optString("epoch").isEmpty() || !tx.s.optString("epoch").equals(ack.getString("epoch"))
                || !tx.s.optString("workspace").equals(ack.getString("workspace"))) throw new JournalError("binding");
            String id = ack.getString("sessionId"), status = ack.getString("status");
            JSONObject s = tx.s.getJSONObject("sessions").optJSONObject(id);
            if (s == null) return false;
            long seq = ack.getLong("ackSeq");
            if (seq > s.getLong("highestSent")) throw new JournalError("ack_beyond_sent");
            String error = ack.optString("error", "");
            if (status.equals("rejected")) {
                if (error.startsWith("retired_")) { terminal(tx, id, error.substring(8), seq); return tx.dirty; }
                if (s.optBoolean("review") && error.equals(s.optString("error"))) return false;
                s.put("review", true).put("error", error.isEmpty() ? "rejected" : error); tx.dirty = true; return true;
            }
            if (status.equals("gap")) {
                if (seq == s.getLong("ackSeq")) return false;
                s.put("ackSeq", seq); tx.dirty = true; return true;
            }
            boolean changed = seq > s.getLong("ackSeq") || s.optBoolean("review") || "none".equals(s.optString("phone"));
            if (!changed) return false;
            s.put("ackSeq", Math.max(seq, s.getLong("ackSeq"))).put("review", false).put("error", "");
            if ("none".equals(s.optString("phone"))) s.put("phone", "staged");
            tx.dirty = true; return true;
        });
    }
    /** snapshot.journal od telefónu: staged/active/conflict sú neterminálne, imported/duplicate/discarded relaciu uvoľnia. */
    public boolean phoneStatuses(JSONArray entries) {
        return commit(tx -> {
            for (int i = 0; entries != null && i < entries.length() && i < 60; i++) {
                JSONObject e = entries.optJSONObject(i);
                if (e == null) continue;
                String id = e.optString("sessionId"), status = e.optString("status");
                JSONObject s = tx.s.getJSONObject("sessions").optJSONObject(id);
                if (s == null) continue;
                long seq = e.optLong("ackSeq", -1);
                if (seq < 0 || seq > s.getLong("highestSent")) continue;
                if (status.equals("imported") || status.equals("duplicate") || status.equals("discarded")) { terminal(tx, id, status, seq); continue; }
                if (!status.equals("staged") && !status.equals("active") && !status.equals("conflict")) continue;
                boolean change = false;
                if (seq > s.getLong("ackSeq")) { s.put("ackSeq", seq); change = true; }
                if (!status.equals(s.optString("phone"))) { s.put("phone", status); change = true; }
                if (s.optBoolean("review")) { s.put("review", false).put("error", ""); change = true; }
                if (change) tx.dirty = true;
            }
            return tx.dirty;
        });
    }
}
