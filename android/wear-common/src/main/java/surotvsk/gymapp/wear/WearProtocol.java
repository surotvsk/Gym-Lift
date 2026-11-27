package surotvsk.gymapp.wear;

import android.content.Context;
import android.os.SystemClock;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Spoločný protokol; žiadne účty, tokeny ani náhradný transport. */
public final class WearProtocol {
    public static final String SNAPSHOT = "/gymlift/snapshot";
    public static final String COMMAND = "/gymlift/cmd";
    public static final String ACK = "/gymlift/ack";
    public static final String UNLINK = "/gymlift/unlink";
    public static final String PACK = "/gymlift/pack";
    public static final String PACK_REQUEST = "/gymlift/pack-req";
    public static final String JOURNAL = "/gymlift/journal";
    public static final String JOURNAL_ACK = "/gymlift/journal-ack";
    public static final int MAX_REPLY = 280, MAX_MESSAGES = 10;
    /** Súkromný snapshot ide jednou správou MessageClient (limit Data Layer ~100 KB); 90000 B nechá rezervu. */
    public static final int MAX_SNAPSHOT = 90000;
    private WearProtocol() {}
    public static int boot(Context c) {
        return Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT, -1);
    }
    public static JSONObject parse(byte[] data, int max) throws JSONException {
        require(data != null && data.length > 0 && data.length <= max, "payload_size");
        return new JSONObject(new String(data, StandardCharsets.UTF_8));
    }
    public static byte[] bytes(JSONObject o) { return o.toString().getBytes(StandardCharsets.UTF_8); }
    public static void require(boolean ok, String error) throws JSONException {
        if (!ok) throw new JSONException(error);
    }
    public static String text(JSONObject o, String key, int max) throws JSONException {
        return text(o, key, max, false);
    }
    public static String text(JSONObject o, String key, int max, boolean allowEmpty) throws JSONException {
        Object value = o.get(key);
        require(value instanceof String && (allowEmpty || !((String) value).isEmpty()) && ((String) value).length() <= max, key);
        return (String) value;
    }
    public static long number(JSONObject o, String key) throws JSONException {
        Object n = o.get(key);
        require(n instanceof Number && ((Number) n).doubleValue() == ((Number) n).longValue(), key);
        return ((Number) n).longValue();
    }
    public static void nullableId(JSONObject o, String key) throws JSONException {
        require(o.has(key), key);
        if (!o.isNull(key)) text(o, key, 160);
    }
    /** Zapnutý súhlas má neprázdny peer aj label; vypnutý (odvolanie) smie niesť prázdne reťazce, nie null ani iný typ. */
    public static void configuration(JSONObject c) throws JSONException {
        Object enabled = c.get("enabled");
        require(enabled instanceof Boolean, "enabled");
        text(c, "epoch", 160);
        text(c, "workspace", 160);
        text(c, "peer", 160, !(Boolean) enabled);
        text(c, "label", 160, !(Boolean) enabled);
    }
    public static boolean same(JSONObject a, JSONObject b) {
        return a != null && b != null && a.optBoolean("enabled") == b.optBoolean("enabled")
            && a.optString("epoch").equals(b.optString("epoch"))
            && a.optString("workspace").equals(b.optString("workspace"))
            && a.optString("peer").equals(b.optString("peer"))
            && a.optString("label").equals(b.optString("label"));
    }
    public static void command(JSONObject c, long now) throws JSONException {
        require(number(c, "v") == 1, "version");
        String id = text(c, "id", 36);
        require(UUID.fromString(id).toString().equalsIgnoreCase(id), "id");
        text(c, "epoch", 160); text(c, "workspace", 160);
        nullableId(c, "sessionId"); nullableId(c, "restId");
        String type = text(c, "type", 32);
        JSONObject args = c.getJSONObject("args");
        switch (type) {
            case "startWorkout": text(args, "planId", 160); break;
            case "restStart": case "restAdd":
                long seconds = number(args, "seconds");
                require(seconds > 0 && seconds <= 86400, "seconds"); break;
            case "restStop": break;
            case "messageReply":
                text(args, "conversationId", 160);
                require(text(args, "body", MAX_REPLY).trim().length() > 0 && args.length() == 2, "body"); break;
            default: throw new JSONException("command_type");
        }
        long issued = number(c, "issuedAt"), expires = number(c, "expiresAt");
        require(issued <= now + 5000 && issued >= now - 10000, "clock_skew");
        require(expires > now && expires > issued && expires - issued <= 10000, "expired");
    }
    public static boolean live(Context context, JSONObject receipt) {
        long now = System.currentTimeMillis(), elapsed = SystemClock.elapsedRealtime();
        return boot(context) >= 0 && receipt.optInt("boot", -2) == boot(context)
            && elapsed >= receipt.optLong("receivedElapsed", Long.MAX_VALUE)
            && elapsed < receipt.optLong("dueElapsed", 0)
            && now < receipt.optLong("deadlineAt", 0);
    }
    public static void snapshot(JSONObject s) throws JSONException {
        require(number(s, "v") == 1, "version");
        JSONObject binding = s.getJSONObject("binding"); configuration(binding);
        require(number(s, "seq") >= 0, "seq");
        long created = number(s, "createdAt"), expires = number(s, "expiresAt");
        require(created > 0 && expires > created && expires - created <= 60000, "snapshot_ttl");
        text(s, "language", 16);
        JSONArray plans = s.getJSONArray("plans"), calendar = s.getJSONArray("calendar");
        require(plans.length() <= 300 && calendar.length() <= 730, "snapshot_count");
        for (int i = 0; i < plans.length(); i++) {
            JSONObject p = plans.getJSONObject(i);
            text(p, "id", 160); text(p, "name", 300);
            require(number(p, "sets") >= 0 && p.get("recommended") instanceof Boolean, "plan");
        }
        require(s.has("session") && s.has("rest"), "state");
        if (!s.isNull("session")) {
            JSONObject session = s.getJSONObject("session");
            text(session, "id", 160); text(session, "planId", 160); text(session, "planName", 300);
            require(session.get("exerciseName") instanceof String && session.getString("exerciseName").length() <= 300, "exerciseName");
            require(number(session, "done") >= 0 && number(session, "total") >= session.getLong("done"), "progress");
        }
        if (!s.isNull("rest")) {
            JSONObject rest = s.getJSONObject("rest"); text(rest, "id", 160);
            // pausedLeftMs: null = odpočet beží, nezáporné ms = pozastavený (tvar z JS wearRestSnapshot).
            require(rest.has("pausedLeftMs"), "pausedLeftMs");
            if (!rest.isNull("pausedLeftMs")) require(number(rest, "pausedLeftMs") >= 0, "pausedLeftMs");
            require(number(rest, "endAt") >= 0 && number(rest, "totalMs") >= 0
                && rest.get("done") instanceof Boolean, "rest");
        }
        for (int i = 0; i < calendar.length(); i++) {
            JSONObject day = calendar.getJSONObject(i);
            String date = text(day, "date", 10);
            require(date.matches("\\d{4}-\\d{2}-\\d{2}"), "date");
            try { java.time.LocalDate.parse(date); } catch (RuntimeException e) { throw new JSONException("date"); }
            String status = text(day, "status", 16);
            require(status.equals("completed") || status.equals("planned"), "calendar_status");
            text(day, "title", 300);
        }
        optionalOffline(s, binding.getBoolean("enabled"));
        if (!binding.getBoolean("enabled")) {
            require(plans.length() == 0 && calendar.length() == 0 && s.isNull("session") && s.isNull("rest"), "disabled_private_content");
        }
    }
    /** Telo príkazu messageReply sa nikdy neukladá: trvalý záznam nesie len prázdne args. */
    public static JSONObject redacted(JSONObject command) throws JSONException {
        JSONObject copy = new JSONObject(command.toString());
        if ("messageReply".equals(copy.optString("type"))) copy.put("args", new JSONObject());
        return copy;
    }
    /** Voliteľné polia offline/správ; staré telefóny ich nenesú (predvolene vypnuté, prázdne). */
    private static void optionalOffline(JSONObject s, boolean enabled) throws JSONException {
        if (s.has("grants")) {
            JSONObject g = s.getJSONObject("grants");
            require(g.get("offline") instanceof Boolean && g.get("messages") instanceof Boolean, "grants");
            require(enabled || (!g.getBoolean("offline") && !g.getBoolean("messages")), "disabled_private_content");
        }
        if (s.has("packRev") && !s.isNull("packRev")) text(s, "packRev", 160);
        if (s.has("journal")) {
            JSONArray journal = s.getJSONArray("journal");
            require(journal.length() <= 80 && (enabled || journal.length() == 0), "journal");
            for (int i = 0; i < journal.length(); i++) {
                JSONObject e = journal.getJSONObject(i);
                require(JournalRules.isSessionId(text(e, "sessionId", 160)), "journal");
                long seq = number(e, "ackSeq");
                require(seq >= 0 && seq <= JournalRules.MAX_OPS, "journal");
                String status = text(e, "status", 16);
                require(status.equals("active") || status.equals("staged") || status.equals("conflict")
                    || status.equals("imported") || status.equals("duplicate") || status.equals("discarded"), "journal");
                if (e.has("error")) require(JournalRules.isCode(text(e, "error", 64)), "journal");
            }
        }
        if (s.has("messages")) {
            JSONArray messages = s.getJSONArray("messages");
            require(messages.length() <= MAX_MESSAGES && (enabled || messages.length() == 0), "messages");
            for (int i = 0; i < messages.length(); i++) {
                JSONObject m = messages.getJSONObject(i);
                text(m, "conversationId", 160); text(m, "name", 60, true); text(m, "last", 160, true);
                require(number(m, "unread") >= 0 && number(m, "at") >= 0 && m.get("canSend") instanceof Boolean, "messages");
            }
        }
    }
    public static void packRequest(JSONObject r) throws JSONException {
        require(number(r, "v") == 1, "version");
        text(r, "epoch", 160); text(r, "workspace", 160);
    }
}
