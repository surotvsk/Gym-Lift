package surotvsk.gymapp.wear;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Trvalá schránka telefónu pre offline denník hodiniek: publikované balíky a ich dôveryhodné šablóny,
 * prijaté relácie a náhrobky. Telefón ostáva jediným kanonickým úložiskom; kým JS nezapíše históriu,
 * relácia zostáva tu aj s pôvodnou šablónou (nikdy sa nevytláča). ACK sa vydáva až po trvalom zápise.
 */
public final class PhoneInbox {
    private static final int MAX_TOMBSTONES = 200, SNAPSHOT_TOMBSTONES = 40;
    /** Po vypršaní balíka ostáva pôvodná šablóna ešte 30 dní, aby sa dala zotaviť už zaznamenaná práca hodiniek. */
    private static final long RECOVERY_MS = 30L * 24 * 3600 * 1000;
    private static final long DEFAULT_RETAINED_BYTES = 8L * 1024 * 1024;
    private final long maxRetained;
    private final WearStore store;
    private final WearEnv env;
    private JSONObject state;
    private boolean unreadable;

    /** Odpoveď na dávku: ack == null znamená mlčať (neznámy odosielateľ); staged=true ak pribudli nové operácie. */
    public static final class Accepted {
        public final JSONObject ack; public final boolean staged;
        Accepted(JSONObject ack, boolean staged) { this.ack = ack; this.staged = staged; }
    }

    public PhoneInbox(WearStore store, WearEnv env) { this(store, env, DEFAULT_RETAINED_BYTES); }
    /** @param maxRetained strop dôveryhodných šablón/balíkov/semienok; nad ním publikovanie odmietne (backpressure), nič platné sa nevytlačí. */
    public PhoneInbox(WearStore store, WearEnv env, long maxRetained) {
        this.maxRetained = maxRetained;
        this.store = store; this.env = env;
        JSONObject read;
        try { read = store.read(); } catch (RuntimeException e) { read = null; unreadable = true; }
        if (read == null || read.length() == 0) state = fresh();
        else if (read.optInt("v") != 1 || read.optJSONObject("sessions") == null) { state = fresh(); unreadable = true; }
        else state = read;
    }
    private static JSONObject fresh() {
        try {
            return new JSONObject().put("v", 1).put("scope", JSONObject.NULL).put("offline", false).put("messages", false)
                .put("pack", JSONObject.NULL).put("packs", new JSONObject()).put("packOrder", new JSONArray())
                .put("archive", new JSONObject()).put("seeds", new JSONObject()).put("seedOrder", new JSONArray())
                .put("sessions", new JSONObject()).put("order", new JSONArray())
                .put("tombstones", new JSONObject()).put("tombOrder", new JSONArray());
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }
    private static JSONObject copy(JSONObject o) {
        try { return new JSONObject(o.toString()); } catch (JSONException e) { throw new IllegalStateException(e); }
    }
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
    private static boolean enabled(JSONObject config) { return config != null && config.optBoolean("enabled"); }
    private static boolean bound(JSONObject config, String node, String epoch, String workspace) {
        return enabled(config) && (node == null || node.equals(config.optString("peer")))
            && config.optString("epoch").equals(epoch) && config.optString("workspace").equals(workspace);
    }
    private static boolean sameScope(JSONObject scope, JSONObject config) {
        return scope != null && enabled(config) && scope.optString("epoch").equals(config.optString("epoch"))
            && scope.optString("workspace").equals(config.optString("workspace"));
    }
    private static boolean empty(JSONObject s) {
        return s.optJSONObject("sessions").length() == 0 && s.isNull("pack") && s.optJSONObject("packs").length() == 0
            && s.optJSONObject("seeds").length() == 0 && s.optJSONObject("tombstones").length() == 0;
    }
    private static void scope(Tx tx, JSONObject config) throws JSONException {
        JSONObject scope = tx.s.optJSONObject("scope");
        if (sameScope(scope, config)) return;
        boolean had = scope != null || !empty(tx.s) || tx.s.optBoolean("offline") || tx.s.optBoolean("messages");
        if (!had && !enabled(config)) return;
        JSONObject next = fresh();
        if (enabled(config)) next.put("scope", new JSONObject().put("epoch", config.getString("epoch")).put("workspace", config.getString("workspace")));
        for (String k : new String[]{"scope", "offline", "messages", "pack", "packs", "packOrder", "archive", "seeds", "seedOrder",
            "sessions", "order", "tombstones", "tombOrder"}) tx.s.put(k, next.get(k));
        tx.dirty = true;
    }
    /** Pri zmene väzby, odvolaní alebo odpojení zmizne všetko, čo patrilo starej epoche (volajúci varoval používateľa). */
    public void ensureScope(JSONObject config) { commit(tx -> { scope(tx, config); return null; }); }
    public synchronized boolean unreadable() { return unreadable; }

    /* ---------- súhlasy ---------- */
    /** Voliteľný offline súhlas sa mení len ak ho snapshot nesie; správy sú vždy podľa posledného snapshotu. */
    public void grants(JSONObject config, Boolean offline, boolean messages) {
        commit(tx -> {
            scope(tx, config);
            if (!enabled(config)) return null;
            if (offline != null && offline != tx.s.optBoolean("offline")) { tx.s.put("offline", offline); tx.dirty = true; }
            if (messages != tx.s.optBoolean("messages")) { tx.s.put("messages", messages); tx.dirty = true; }
            return null;
        });
    }
    public synchronized boolean messagesGranted(JSONObject config) {
        return sameScope(state.optJSONObject("scope"), config) && state.optBoolean("messages");
    }
    public synchronized boolean offlineGranted(JSONObject config) {
        return sameScope(state.optJSONObject("scope"), config) && state.optBoolean("offline");
    }

    /* ---------- balík ---------- */
    /** Skutočné bajty zakódované na disk (UTF-8), nie jednotky Java reťazca. */
    private static long retained(JSONObject s) {
        return utf8(s.optJSONObject("archive")) + utf8(s.optJSONObject("seeds")) + utf8(s.optJSONObject("packs"));
    }
    private static long utf8(JSONObject o) { return o.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length; }
    /** Starší záznam bez expirácie sa nikdy nevytláča. */
    private static long seedExpiry(JSONObject seed) { return seed.optLong("expiresAt", Long.MAX_VALUE / 4); }
    /**
     * Platné (nevypršané) balíky, ich šablóny a semienka sa NIKDY nevytláčajú: hodinky mohli podľa nich už vydať prácu.
     * Vypršané záznamy sa držia ďalších 30 dní na zotavenie; pri nedostatku miesta sa uvoľňujú najstaršie vypršané.
     * @return false ak sa limit dodržať nedá bez zahodenia platného záznamu (volajúci publikovanie odmietne).
     */
    private boolean gc(JSONObject s, long now) throws JSONException {
        JSONObject packs = s.getJSONObject("packs"), seeds = s.getJSONObject("seeds");
        JSONArray order = s.getJSONArray("packOrder"), seedOrder = s.getJSONArray("seedOrder");
        JSONArray keptPacks = new JSONArray(), keptSeeds = new JSONArray();
        for (int i = 0; i < order.length(); i++) {
            String rev = order.getString(i);
            if (packs.getJSONObject(rev).getLong("expiresAt") + RECOVERY_MS > now) keptPacks.put(rev); else packs.remove(rev);
        }
        for (int i = 0; i < seedOrder.length(); i++) {
            String key = seedOrder.getString(i);
            if (seedExpiry(seeds.getJSONObject(key)) + RECOVERY_MS > now) keptSeeds.put(key); else seeds.remove(key);
        }
        s.put("packOrder", keptPacks).put("seedOrder", keptSeeds);
        prune(s);
        while (retained(s) > maxRetained) {
            keptPacks = s.getJSONArray("packOrder"); keptSeeds = s.getJSONArray("seedOrder");
            boolean evicted = false;
            for (int i = 0; i < keptSeeds.length() && !evicted; i++) {
                String key = keptSeeds.getString(i);
                if (seedExpiry(seeds.getJSONObject(key)) <= now) { seeds.remove(key); keptSeeds.remove(i); evicted = true; }
            }
            for (int i = 0; i < keptPacks.length() && !evicted; i++) {
                String rev = keptPacks.getString(i);
                if (packs.getJSONObject(rev).getLong("expiresAt") <= now) { packs.remove(rev); keptPacks.remove(i); evicted = true; prune(s); }
            }
            if (!evicted) return false;
        }
        return true;
    }
    private static void prune(JSONObject s) throws JSONException {
        Set<String> live = new LinkedHashSet<>(); JSONObject packs = s.getJSONObject("packs");
        Iterator<String> it = packs.keys();
        while (it.hasNext()) { JSONArray revs = packs.getJSONObject(it.next()).getJSONArray("planRevs"); for (int i = 0; i < revs.length(); i++) live.add(revs.getString(i)); }
        JSONObject archive = s.getJSONObject("archive"), keep = new JSONObject();
        for (String rev : live) if (archive.has(rev)) keep.put(rev, archive.get(rev));
        s.put("archive", keep);
    }
    /**
     * Uloží balík aj šablóny atómovo PRED odoslaním na hodinky. Šablóny sú súkromné pre telefón;
     * na hodinky ide len balík, ktorý táto metóda vráti.
     */
    public JSONObject publishPack(JSONObject config, JSONObject pack, JSONObject templates) {
        return commit(tx -> {
            long now = env.wall();
            if (!enabled(config)) throw new JournalError("wear_disabled");
            JournalRules.pack(pack, now, 60000);
            if (!bound(config, null, pack.getString("epoch"), pack.getString("workspace"))) throw new JournalError("configuration_mismatch");
            if (JournalRules.size(pack) > JournalRules.MAX_PACK_BYTES) throw new JournalError("pack_size");
            if (pack.getLong("expiresAt") <= now) throw new JournalError("pack_expired");
            scope(tx, config);
            JSONArray plans = pack.getJSONArray("plans"); JSONObject archive = tx.s.getJSONObject("archive");
            JSONArray revs = new JSONArray(); JSONObject planMap = new JSONObject(); int total = 0;
            for (int i = 0; i < plans.length(); i++) {
                JSONObject plan = plans.getJSONObject(i); String rev = plan.getString("planRev");
                JSONObject template = templates == null ? null : templates.optJSONObject(rev);
                if (template == null) throw new JournalError("template_missing");
                int size = (int) utf8(template);
                if (size > JournalRules.MAX_TEMPLATE_BYTES) throw new JournalError("template_size");
                total += size;
                JSONObject known = archive.optJSONObject(rev);
                if (known != null && !known.getString("planId").equals(plan.getString("planId"))) throw new JournalError("plan_rev_conflict");
                if (known == null) archive.put(rev, new JSONObject().put("planId", plan.getString("planId")).put("plan", copy(plan)).put("template", copy(template)));
                revs.put(rev); planMap.put(plan.getString("planId"), rev);
            }
            JSONObject activeTemplate = null;
            if (!pack.isNull("active")) {
                activeTemplate = templates == null ? null : templates.optJSONObject("active");
                if (activeTemplate == null) throw new JournalError("template_missing");
                total += (int) utf8(activeTemplate);
                if (utf8(activeTemplate) > JournalRules.MAX_TEMPLATE_BYTES) throw new JournalError("template_size");
            }
            if (total > JournalRules.MAX_TEMPLATES_BYTES) throw new JournalError("templates_size");
            String packRev = pack.getString("packRev");
            JSONObject packs = tx.s.getJSONObject("packs"), record = packs.optJSONObject(packRev);
            if (record == null) {
                packs.put(packRev, new JSONObject().put("createdAt", pack.getLong("createdAt")).put("expiresAt", pack.getLong("expiresAt"))
                    .put("planRevs", revs).put("plans", planMap));
                tx.s.getJSONArray("packOrder").put(packRev);
            } else {
                record.put("createdAt", Math.max(record.getLong("createdAt"), pack.getLong("createdAt")))
                    .put("expiresAt", Math.max(record.getLong("expiresAt"), pack.getLong("expiresAt")));
            }
            JSONObject current = tx.s.optJSONObject("pack");
            if (current == null || current.getString("packRev").equals(packRev) || pack.getLong("createdAt") >= current.getLong("createdAt"))
                tx.s.put("pack", copy(pack));
            if (activeTemplate != null) {
                JSONObject seed = pack.getJSONObject("active"); String id = seed.getString("sessionId");
                String key = id + "|" + seed.getString("baselineRevision");
                JSONObject seeds = tx.s.getJSONObject("seeds"), known = seeds.optJSONObject(key);
                if (known != null) known.put("expiresAt", Math.max(seedExpiry(known), pack.getLong("expiresAt")));
                else if (!tx.s.getJSONObject("sessions").has(id) && !tx.s.getJSONObject("tombstones").has(id)) {
                    seeds.put(key, new JSONObject().put("seed", copy(seed)).put("template", copy(activeTemplate))
                        .put("packRev", packRev).put("expiresAt", pack.getLong("expiresAt")));
                    tx.s.getJSONArray("seedOrder").put(key);
                }
            }
            // Backpressure: platné záznamy sa nevytláčajú; ak sa nezmestia, publikovanie sa odmietne a nič sa nezapíše.
            if (!gc(tx.s, now)) throw new JournalError("archive_full");
            tx.s.put("offline", true);
            tx.dirty = true;
            return copy(pack);
        });
    }
    /** Uložený balík na odoslanie (aj na PACK_REQUEST); null ak nie je alebo vypršal. */
    public synchronized JSONObject currentPack(JSONObject config) {
        JSONObject pack = state.optJSONObject("pack");
        if (pack == null || !sameScope(state.optJSONObject("scope"), config) || !state.optBoolean("offline")
            || pack.optLong("expiresAt") <= env.wall()) return null;
        return copy(pack);
    }
    public synchronized String currentPackRev(JSONObject config) {
        JSONObject pack = currentPack(config); return pack == null ? null : pack.optString("packRev");
    }

    /* ---------- dávky z hodiniek ---------- */
    private static JSONObject ack(JSONObject config, String sessionId, long seq, String status, String error) throws JSONException {
        JSONObject a = new JSONObject().put("v", 1).put("epoch", config.getString("epoch")).put("workspace", config.getString("workspace"))
            .put("sessionId", sessionId).put("ackSeq", seq).put("status", status);
        if (error != null) a.put("error", error);
        return a;
    }
    private static Accepted reject(JSONObject config, String id, long seq, String error) throws JSONException {
        return new Accepted(ack(config, id, seq, "rejected", error), false);
    }
    private static Set<String> keys(JSONObject plan) throws JSONException { return JournalRules.planKeys(plan); }

    /** Prijme dávku od uzla `node`. Nikdy nepotvrdí dáta, ktoré sa nepodarilo trvalo uložiť. */
    public Accepted accept(JSONObject config, String node, JSONObject batch) {
        // Tvar sa overí mimo transakcie: neplatná dávka nemá čo meniť (ani zakladať rozsah).
        String id;
        try {
            JournalRules.batch(batch);
            if (JournalRules.size(batch) > JournalRules.MAX_BATCH_BYTES) return null2();
            id = batch.getString("sessionId");
            if (!bound(config, node, batch.getString("epoch"), batch.getString("workspace"))) return null2();
        } catch (JSONException e) { return null2(); }
        try {
            return commit(tx -> {
                Accepted a = acceptIn(tx, config, batch, id);
                // Odmietnutá dávka nesmie nechať čiastočné zmeny (napr. prázdnu reláciu alebo prefix operácií).
                if (a.ack != null && "rejected".equals(a.ack.optString("status"))) tx.dirty = false;
                return a;
            });
        } catch (JournalError e) {
            try {
                String code = e.code.equals("storage") ? "storage_failed" : JournalRules.isCode(e.code) ? e.code : "rejected";
                return reject(config, id, 0, code);
            } catch (JSONException ignored) { return null2(); }
        }
    }
    private static Accepted null2() { return new Accepted(null, false); }

    private Accepted acceptIn(Tx tx, JSONObject config, JSONObject b, String id) throws JSONException {
        scope(tx, config);
        if (!tx.s.optBoolean("offline")) return reject(config, id, 0, "offline_off");
        JSONObject tomb = tx.s.getJSONObject("tombstones").optJSONObject(id);
        if (tomb != null) return reject(config, id, tomb.getLong("ackSeq"), "retired_" + tomb.getString("status"));
        JSONArray ops = b.getJSONArray("ops");
        long from = b.getLong("fromSeq");
        JSONObject sessions = tx.s.getJSONObject("sessions"), rec = sessions.optJSONObject(id);
        if (rec == null) {
            if (from != 1) return new Accepted(ack(config, id, 0, "gap", null), false);
            if (!"start".equals(ops.getJSONObject(0).optString("type"))) return reject(config, id, 0, "op_start");
            if (sessions.length() >= JournalRules.MAX_OUTSTANDING) return reject(config, id, 0, "inbox_full");
            rec = open(tx.s, b, id);
            if (rec == null) return reject(config, id, 0, "unknown_plan");
            sessions.put(id, rec); tx.s.getJSONArray("order").put(id); tx.dirty = true;
        } else {
            if (!rec.getString("planId").equals(b.getString("planId")) || !rec.getString("planRev").equals(b.getString("planRev"))
                || !rec.getString("packRev").equals(b.getString("packRev")) || rec.getLong("startedAt") != b.getLong("startedAt")
                || !rec.get("baselineRevision").toString().equals(b.get("baselineRevision").toString())) return reject(config, id, rec.getLong("ackSeq"), "header_mismatch");
        }
        long have = rec.getLong("ackSeq");
        if (from > have + 1) return new Accepted(ack(config, id, have, "gap", null), false);
        JSONArray stored = rec.getJSONArray("ops");
        Set<String> planKeys = keys(rec.getJSONObject("plan"));
        JournalRules.Replay replay = new JournalRules.Replay(new LinkedHashSet<String>());
        // Stav po už prijatých operáciách: základné značky + prehratie.
        JSONObject base = rec.getJSONObject("base"); Iterator<String> bi = base.keys();
        while (bi.hasNext()) replay.marks.add(bi.next());
        for (int i = 0; i < stored.length(); i++) replay.apply(stored.getJSONObject(i), planKeys);
        boolean staged = false;
        for (int i = 0; i < ops.length(); i++) {
            JSONObject op = ops.getJSONObject(i); long seq = op.getLong("seq");
            if (seq <= have) {
                if (!JournalRules.sameOp(stored.getJSONObject((int) seq - 1), op)) return reject(config, id, have, "op_mismatch");
                continue;
            }
            if (!"open".equals(replay.state) && !"new".equals(replay.state)) return reject(config, id, have, "after_terminal");
            try { replay.apply(op, planKeys); } catch (JSONException e) { return reject(config, id, have, JournalRules.isCode(e.getMessage()) ? e.getMessage() : "op_invalid"); }
            int bytes = rec.getInt("opBytes") + JournalRules.size(op);
            if (stored.length() + 1 > JournalRules.MAX_OPS || bytes > JournalRules.MAX_OP_BYTES) return reject(config, id, have, "journal_full");
            stored.put(copy(op)); rec.put("opBytes", bytes).put("ackSeq", seq); staged = true;
        }
        if (staged) {
            rec.put("state", replay.state.equals("new") ? "open" : replay.state);
            // Nová práca od hodiniek znovu otvára posúdenie: JS musí operácie prehrať.
            if (!"conflict".equals(rec.optString("result"))) rec.put("result", "staged");
            tx.dirty = true;
        }
        return new Accepted(ack(config, id, rec.getLong("ackSeq"), "staged", null), staged);
    }
    /** Nová relácia z dôveryhodného balíka; null ak plán/revízia/základ nie je známy. */
    private JSONObject open(JSONObject s, JSONObject b, String id) throws JSONException {
        JSONObject plan, template, base = new JSONObject(); Object baselineRevision = b.get("baselineRevision");
        if (b.isNull("baselineRevision")) {
            if (!JournalRules.isUuid(id)) return null;
            JSONObject entry = s.getJSONObject("archive").optJSONObject(b.getString("planRev"));
            if (entry == null || !entry.getString("planId").equals(b.getString("planId"))) return null;
            JSONObject packRecord = s.getJSONObject("packs").optJSONObject(b.getString("packRev"));
            if (packRecord != null) {
                if (!b.getString("planRev").equals(packRecord.getJSONObject("plans").optString(b.getString("planId")))) return null;
                // Nový štart platí najviac do konca platnosti balíka (7 dní).
                if (b.getLong("startedAt") > packRecord.getLong("expiresAt") + 300000) return null;
            }
            plan = entry.getJSONObject("plan"); template = entry.getJSONObject("template");
        } else {
            JSONObject entry = s.getJSONObject("seeds").optJSONObject(id + "|" + b.getString("baselineRevision"));
            if (entry == null) return null;
            JSONObject seed = entry.getJSONObject("seed");
            if (!seed.getString("planId").equals(b.getString("planId")) || !seed.getString("planRev").equals(b.getString("planRev"))
                || seed.getLong("startedAt") != b.getLong("startedAt")) return null;
            plan = seed.getJSONObject("plan"); template = entry.getJSONObject("template"); base = seed.getJSONObject("completedSets");
        }
        return new JSONObject().put("sessionId", id).put("planId", b.getString("planId")).put("planRev", b.getString("planRev"))
            .put("packRev", b.getString("packRev")).put("baselineRevision", baselineRevision).put("startedAt", b.getLong("startedAt"))
            .put("plan", copy(plan)).put("template", copy(template)).put("base", copy(base)).put("ops", new JSONArray())
            .put("opBytes", 0).put("ackSeq", 0).put("state", "open").put("result", "staged").put("appliedSeq", 0);
    }

    /* ---------- JS ---------- */
    /** Všetky neuvoľnené relácie s pôvodnou dôveryhodnou šablónou (aj po reštarte procesu). */
    public synchronized JSONArray drain(JSONObject config) {
        JSONArray out = new JSONArray();
        if (!sameScope(state.optJSONObject("scope"), config)) return out;
        JSONArray order = state.optJSONArray("order");
        try {
            for (int i = 0; i < order.length(); i++) {
                JSONObject r = state.getJSONObject("sessions").getJSONObject(order.getString(i));
                out.put(new JSONObject().put("epoch", config.getString("epoch")).put("workspace", config.getString("workspace"))
                    .put("sessionId", r.getString("sessionId")).put("planId", r.getString("planId")).put("planRev", r.getString("planRev"))
                    .put("packRev", r.getString("packRev")).put("baselineRevision", r.get("baselineRevision"))
                    .put("startedAt", r.getLong("startedAt")).put("ackSeq", r.getLong("ackSeq")).put("status", r.getString("state"))
                    .put("ops", copyArray(r.getJSONArray("ops"))).put("template", copy(r.getJSONObject("template")))
                    .put("resultStatus", r.getString("result")).put("appliedSeq", r.getLong("appliedSeq")));
            }
        } catch (JSONException e) { throw new JournalError("state_corrupt", e); }
        return out;
    }
    private static JSONArray copyArray(JSONArray a) throws JSONException { return new JSONArray(a.toString()); }
    public synchronized boolean hasWork(JSONObject config) {
        return sameScope(state.optJSONObject("scope"), config) && state.optJSONObject("sessions").length() > 0;
    }

    /** Výsledok od JS po kanonickom zápise. Terminálny výsledok vytvorí náhrobok a uvoľní šablónu. */
    public void result(JSONObject config, JSONObject r) {
        commit(tx -> {
            String epoch = WearProtocol.text(r, "epoch", 160), workspace = WearProtocol.text(r, "workspace", 160);
            String id = WearProtocol.text(r, "sessionId", 160), status = WearProtocol.text(r, "status", 16);
            long applied = WearProtocol.number(r, "appliedSeq");
            if (!bound(config, null, epoch, workspace) || !sameScope(tx.s.optJSONObject("scope"), config)) throw new JournalError("binding");
            String error = null;
            if (r.has("error") && !r.isNull("error")) {
                error = WearProtocol.text(r, "error", 64);
                if (!JournalRules.isCode(error)) throw new JournalError("error_code");
            }
            boolean terminal = status.equals("imported") || status.equals("duplicate") || status.equals("discarded");
            if (!terminal && !status.equals("active") && !status.equals("staged") && !status.equals("conflict")) throw new JournalError("status");
            JSONObject rec = tx.s.getJSONObject("sessions").optJSONObject(id);
            if (rec == null) {
                JSONObject tomb = tx.s.getJSONObject("tombstones").optJSONObject(id);
                if (tomb != null && terminal && tomb.getString("status").equals(status)) return null;
                throw new JournalError("unknown_session");
            }
            if (applied < 0 || applied > rec.getLong("ackSeq")) throw new JournalError("applied_seq");
            if (!terminal) {
                if (applied < rec.getLong("appliedSeq")) throw new JournalError("applied_regressed");
                rec.put("result", status).put("appliedSeq", applied);
                if (error != null) rec.put("error", error); else rec.remove("error");
                tx.dirty = true; return null;
            }
            // imported/duplicate = kanonická história zodpovedá celej dokončenej relácii.
            if (applied != rec.getLong("ackSeq")) throw new JournalError("applied_seq");
            if (!status.equals("discarded") && !"finished".equals(rec.getString("state"))) throw new JournalError("not_finished");
            tx.s.getJSONObject("sessions").remove(id);
            JSONArray order = tx.s.getJSONArray("order"), next = new JSONArray();
            for (int i = 0; i < order.length(); i++) if (!id.equals(order.getString(i))) next.put(order.getString(i));
            tx.s.put("order", next);
            JSONObject tombs = tx.s.getJSONObject("tombstones"); JSONArray tombOrder = tx.s.getJSONArray("tombOrder");
            tombs.put(id, new JSONObject().put("status", status).put("ackSeq", rec.getLong("ackSeq"))); tombOrder.put(id);
            while (tombOrder.length() > MAX_TOMBSTONES) { tombs.remove(tombOrder.getString(0)); tombOrder.remove(0); }
            // Rozpracované semienko tejto relácie už nikdy nezačne novú.
            JSONObject seeds = tx.s.getJSONObject("seeds"); JSONArray so = tx.s.getJSONArray("seedOrder"), nextSeeds = new JSONArray();
            for (int i = 0; i < so.length(); i++) {
                if (so.getString(i).startsWith(id + "|")) seeds.remove(so.getString(i)); else nextSeeds.put(so.getString(i));
            }
            tx.s.put("seedOrder", nextSeeds);
            tx.dirty = true; return null;
        });
    }

    /** Pole pre snapshot.journal: nevybavené relácie a posledné náhrobky (terminálny stav pre hodinky). */
    public synchronized JSONArray snapshotJournal(JSONObject config) {
        JSONArray out = new JSONArray();
        if (!sameScope(state.optJSONObject("scope"), config)) return out;
        try {
            JSONArray order = state.getJSONArray("order");
            for (int i = 0; i < order.length(); i++) {
                JSONObject r = state.getJSONObject("sessions").getJSONObject(order.getString(i));
                JSONObject e = new JSONObject().put("sessionId", r.getString("sessionId")).put("ackSeq", r.getLong("ackSeq")).put("status", r.getString("result"));
                if (r.has("error")) e.put("error", r.getString("error"));
                out.put(e);
            }
            JSONArray tombOrder = state.getJSONArray("tombOrder");
            for (int i = Math.max(0, tombOrder.length() - SNAPSHOT_TOMBSTONES); i < tombOrder.length(); i++) {
                JSONObject t = state.getJSONObject("tombstones").optJSONObject(tombOrder.getString(i));
                if (t != null) out.put(new JSONObject().put("sessionId", tombOrder.getString(i)).put("ackSeq", t.getLong("ackSeq")).put("status", t.getString("status")));
            }
        } catch (JSONException e) { throw new JournalError("state_corrupt", e); }
        return out;
    }
}
