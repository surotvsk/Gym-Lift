package surotvsk.gymapp.wear;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Spoločné pravidlá offline denníka: tvar balíka plánov, dávky, operácií a ich opakovanie.
 * Telefón aj hodinky používajú ten istý kód, takže nikdy nesúhlasia o tom, čo je platné.
 */
public final class JournalRules {
    public static final int MAX_OPS = 600, MAX_OP_BYTES = 65536, TERMINAL_RESERVE_BYTES = 1024, MAX_BATCH_OPS = 64,
        MAX_OUTSTANDING = 3, MAX_ID = 160, MAX_KEY = 512, MAX_NAME = 300, MAX_PLANS = 20, MAX_SLOTS = 60,
        MAX_SLOT_SETS = 100, MAX_PLAN_KEYS = 300, MAX_PACK_BYTES = 90000, MAX_TEMPLATE_BYTES = 131072,
        MAX_TEMPLATES_BYTES = 2097152, MAX_BATCH_BYTES = 65536, MAX_ACK_BYTES = 2048;
    public static final long PACK_TTL_MAX = 7L * 24 * 3600 * 1000;
    private static final Set<String> OP_KEYS = new HashSet<>(Arrays.asList("opId", "seq", "type", "setKey", "at", "boot"));
    private static final Set<String> BATCH_KEYS = new HashSet<>(Arrays.asList("v", "epoch", "workspace", "sessionId",
        "planId", "planRev", "packRev", "baselineRevision", "startedAt", "fromSeq", "ops"));
    private static final java.util.regex.Pattern UUID = java.util.regex.Pattern.compile(
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final java.util.regex.Pattern CODE = java.util.regex.Pattern.compile("[a-z0-9_]{1,64}");
    private JournalRules() {}

    public static boolean isUuid(String s) { return s != null && UUID.matcher(s).matches(); }
    /** Pôvodné ID relácie telefónu nie je UUID (base36); povolené sú bezpečné znaky bez oddeľovačov. */
    public static boolean isSessionId(String s) { return s != null && SESSION.matcher(s).matches(); }
    private static final java.util.regex.Pattern SESSION = java.util.regex.Pattern.compile("[A-Za-z0-9_-]{1,160}");
    public static boolean isCode(String s) { return s != null && CODE.matcher(s).matches(); }
    public static boolean terminal(String type) { return type.equals("finish") || type.equals("discard"); }
    public static int size(JSONObject o) { return WearProtocol.bytes(o).length; }

    /* ---------- balík plánov ---------- */
    private static void optionalNumber(JSONObject o, String key) throws JSONException {
        if (o.isNull(key)) return;
        Object n = o.get(key);
        WearProtocol.require(n instanceof Number && Double.isFinite(((Number) n).doubleValue())
            && ((Number) n).doubleValue() >= 0 && ((Number) n).doubleValue() <= 1000000, key);
    }
    private static void addKey(Set<String> keys, String key) throws JSONException {
        WearProtocol.require(key.length() <= MAX_KEY && !key.isEmpty() && keys.add(key), "set_key");
        WearProtocol.require(keys.size() <= MAX_PLAN_KEYS, "plan_keys");
    }
    /** Overí plán a vráti jeho kľúče v poradí zobrazenia. */
    public static Set<String> planKeys(JSONObject plan) throws JSONException {
        WearProtocol.text(plan, "planId", MAX_ID); WearProtocol.text(plan, "planRev", MAX_ID); WearProtocol.text(plan, "name", MAX_NAME);
        JSONArray slots = plan.getJSONArray("slots");
        WearProtocol.require(slots.length() >= 1 && slots.length() <= MAX_SLOTS, "slots");
        Set<String> keys = new LinkedHashSet<>(), slotKeys = new HashSet<>();
        for (int i = 0; i < slots.length(); i++) {
            JSONObject slot = slots.getJSONObject(i);
            WearProtocol.require(slotKeys.add(WearProtocol.text(slot, "slotKey", MAX_KEY)), "slot_key");
            WearProtocol.text(slot, "name", MAX_NAME, true);
            boolean sided = !slot.isNull("sides");
            if (sided) {
                JSONArray sides = slot.getJSONArray("sides");
                WearProtocol.require(sides.length() == 2 && "left".equals(sides.opt(0)) && "right".equals(sides.opt(1)), "sides");
            }
            JSONArray sets = slot.getJSONArray("sets");
            WearProtocol.require(sets.length() >= 1 && sets.length() <= MAX_SLOT_SETS, "sets");
            for (int j = 0; j < sets.length(); j++) {
                JSONObject set = sets.getJSONObject(j);
                long index = WearProtocol.number(set, "index");
                WearProtocol.require(index >= 0 && index <= 9999, "index");
                optionalNumber(set, "weight"); optionalNumber(set, "reps");
                if (sided) {
                    WearProtocol.require(!set.has("setKey"), "set_key");
                    JSONObject sk = set.getJSONObject("setKeys");
                    addKey(keys, WearProtocol.text(sk, "L", MAX_KEY)); addKey(keys, WearProtocol.text(sk, "R", MAX_KEY));
                } else {
                    WearProtocol.require(!set.has("setKeys"), "set_key");
                    addKey(keys, WearProtocol.text(set, "setKey", MAX_KEY));
                }
            }
        }
        return keys;
    }
    public static int totalSets(JSONObject plan) {
        int n = 0; JSONArray slots = plan.optJSONArray("slots");
        for (int i = 0; slots != null && i < slots.length(); i++) {
            JSONObject slot = slots.optJSONObject(i); JSONArray sets = slot == null ? null : slot.optJSONArray("sets");
            if (sets != null) n += sets.length();
        }
        return n;
    }
    public static void seed(JSONObject seed) throws JSONException {
        String sessionId = WearProtocol.text(seed, "sessionId", MAX_ID);
        WearProtocol.require(isSessionId(sessionId), "seed_session");
        String planId = WearProtocol.text(seed, "planId", MAX_ID), planRev = WearProtocol.text(seed, "planRev", MAX_ID);
        WearProtocol.text(seed, "baselineRevision", MAX_ID);
        WearProtocol.require(WearProtocol.number(seed, "startedAt") > 0, "seed_started");
        JSONObject plan = seed.getJSONObject("plan");
        Set<String> keys = planKeys(plan);
        WearProtocol.require(plan.getString("planId").equals(planId) && plan.getString("planRev").equals(planRev), "seed_plan");
        JSONObject done = seed.getJSONObject("completedSets");
        Iterator<String> it = done.keys();
        while (it.hasNext()) {
            String key = it.next();
            WearProtocol.require(keys.contains(key) && Boolean.TRUE.equals(done.get(key)), "seed_marks");
        }
    }
    /** @param skew povolená odchýlka createdAt do budúcnosti (ms). */
    public static void pack(JSONObject pack, long now, long skew) throws JSONException {
        WearProtocol.require(WearProtocol.number(pack, "v") == 1, "version");
        WearProtocol.text(pack, "epoch", MAX_ID); WearProtocol.text(pack, "workspace", MAX_ID); WearProtocol.text(pack, "packRev", MAX_ID);
        long created = WearProtocol.number(pack, "createdAt"), expires = WearProtocol.number(pack, "expiresAt");
        WearProtocol.require(created > 0 && created <= now + skew && expires > created && expires - created <= PACK_TTL_MAX, "pack_ttl");
        WearProtocol.require(pack.get("truncated") instanceof Boolean, "truncated");
        JSONArray plans = pack.getJSONArray("plans");
        WearProtocol.require(plans.length() <= MAX_PLANS, "pack_plans");
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < plans.length(); i++) {
            JSONObject plan = plans.getJSONObject(i); planKeys(plan);
            WearProtocol.require(ids.add(plan.getString("planId")), "plan_dup");
        }
        if (!pack.isNull("active")) seed(pack.getJSONObject("active"));
        else WearProtocol.require(pack.has("active"), "active");
    }

    /* ---------- dávky a operácie ---------- */
    public static void op(JSONObject op) throws JSONException {
        Iterator<String> it = op.keys();
        while (it.hasNext()) WearProtocol.require(OP_KEYS.contains(it.next()), "op_field");
        WearProtocol.require(isUuid(WearProtocol.text(op, "opId", 36)), "opId");
        long seq = WearProtocol.number(op, "seq");
        WearProtocol.require(seq >= 1 && seq <= MAX_OPS, "seq");
        String type = WearProtocol.text(op, "type", 16);
        boolean keyed = type.equals("mark") || type.equals("unmark");
        WearProtocol.require(keyed || type.equals("start") || terminal(type), "op_type");
        if (keyed) WearProtocol.text(op, "setKey", MAX_KEY); else WearProtocol.require(!op.has("setKey"), "op_key");
        WearProtocol.require(WearProtocol.number(op, "at") > 0, "at");
        if (op.has("boot")) { long boot = WearProtocol.number(op, "boot"); WearProtocol.require(boot >= 0 && boot <= Integer.MAX_VALUE, "boot"); }
    }
    public static boolean sameOp(JSONObject a, JSONObject b) {
        return a.optString("opId").equals(b.optString("opId")) && a.optLong("seq") == b.optLong("seq")
            && a.optString("type").equals(b.optString("type")) && a.optString("setKey").equals(b.optString("setKey"))
            && a.optLong("at") == b.optLong("at") && a.has("boot") == b.has("boot") && a.optLong("boot") == b.optLong("boot");
    }
    public static void batch(JSONObject b) throws JSONException {
        Iterator<String> it = b.keys();
        while (it.hasNext()) WearProtocol.require(BATCH_KEYS.contains(it.next()), "batch_field");
        WearProtocol.require(WearProtocol.number(b, "v") == 1, "version");
        WearProtocol.text(b, "epoch", MAX_ID); WearProtocol.text(b, "workspace", MAX_ID);
        WearProtocol.require(isSessionId(WearProtocol.text(b, "sessionId", MAX_ID)), "sessionId");
        WearProtocol.text(b, "planId", MAX_ID); WearProtocol.text(b, "planRev", MAX_ID); WearProtocol.text(b, "packRev", MAX_ID);
        WearProtocol.nullableId(b, "baselineRevision");
        WearProtocol.require(WearProtocol.number(b, "startedAt") > 0, "startedAt");
        long from = WearProtocol.number(b, "fromSeq");
        WearProtocol.require(from >= 1 && from <= MAX_OPS, "fromSeq");
        JSONArray ops = b.getJSONArray("ops");
        WearProtocol.require(ops.length() >= 1 && ops.length() <= MAX_BATCH_OPS, "ops");
        for (int i = 0; i < ops.length(); i++) {
            JSONObject o = ops.getJSONObject(i); op(o);
            WearProtocol.require(o.getLong("seq") == from + i, "op_seq");
        }
    }
    public static void ack(JSONObject a) throws JSONException {
        WearProtocol.require(WearProtocol.number(a, "v") == 1, "version");
        WearProtocol.text(a, "epoch", MAX_ID); WearProtocol.text(a, "workspace", MAX_ID);
        WearProtocol.require(isSessionId(WearProtocol.text(a, "sessionId", MAX_ID)), "sessionId");
        long seq = WearProtocol.number(a, "ackSeq");
        WearProtocol.require(seq >= 0 && seq <= MAX_OPS, "ackSeq");
        String status = WearProtocol.text(a, "status", 16);
        WearProtocol.require(status.equals("staged") || status.equals("gap") || status.equals("rejected"), "ack_status");
        if (a.has("error")) WearProtocol.require(isCode(WearProtocol.text(a, "error", 64)), "error");
    }

    /* ---------- prehrávanie ---------- */
    /** Stav jednej relácie pri prehrávaní operácií. */
    public static final class Replay {
        public final Set<String> marks;
        public String state = "new";
        public int next = 1;
        public Replay(Set<String> base) { marks = new HashSet<>(base); }
        public void apply(JSONObject op, Set<String> planKeys) throws JSONException {
            WearProtocol.require(op.getInt("seq") == next, "op_seq");
            String type = op.getString("type");
            if (state.equals("finished") || state.equals("discarded")) throw new JSONException("after_terminal");
            if (type.equals("start")) {
                WearProtocol.require(state.equals("new") && next == 1, "op_start");
                state = "open";
            } else {
                WearProtocol.require(state.equals("open"), "op_state");
                switch (type) {
                    case "mark":
                        WearProtocol.require(planKeys.contains(op.getString("setKey")) && marks.add(op.getString("setKey")), "op_mark"); break;
                    case "unmark":
                        WearProtocol.require(planKeys.contains(op.getString("setKey")) && marks.remove(op.getString("setKey")), "op_unmark"); break;
                    case "finish": WearProtocol.require(!marks.isEmpty(), "op_empty"); state = "finished"; break;
                    default: state = "discarded";
                }
            }
            next++;
        }
    }
}
