package surotvsk.gymapp.wear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;
import java.util.UUID;

/** Tvar príkazu messageReply, redakcia trvalého nároku a nové voliteľné polia snapshotu. */
public class WearMessageProtocolTest {
    private static JSONObject command(String body) throws Exception {
        long now = 1_700_000_000_000L;
        return new JSONObject().put("v", 1).put("id", UUID.randomUUID().toString()).put("epoch", "e1").put("workspace", "w1")
            .put("sessionId", JSONObject.NULL).put("restId", JSONObject.NULL).put("type", "messageReply")
            .put("args", new JSONObject().put("conversationId", "conv-secret-77").put("body", body))
            .put("issuedAt", now).put("expiresAt", now + 10000);
    }

    @Test public void replyIsValidatedAndBoundedToTwoFieldsAnd280Chars() throws Exception {
        long now = 1_700_000_000_000L;
        WearProtocol.command(command("On my way"), now);
        WearProtocol.command(command("x".repeat(280)), now);
        assertThrows(JSONException.class, () -> WearProtocol.command(command("x".repeat(281)), now));
        assertThrows(JSONException.class, () -> WearProtocol.command(command("   "), now));
        JSONObject extra = command("hi"); extra.getJSONObject("args").put("sneaky", "x");
        assertThrows(JSONException.class, () -> WearProtocol.command(extra, now));
        JSONObject noConversation = command("hi"); noConversation.getJSONObject("args").remove("conversationId");
        assertThrows(JSONException.class, () -> WearProtocol.command(noConversation, now));
    }

    @Test public void persistedCommandNeverCarriesBodyOrConversationId() throws Exception {
        JSONObject redacted = WearProtocol.redacted(command("private text"));
        String persisted = redacted.toString();
        assertFalse(persisted.contains("private text"));
        assertFalse(persisted.contains("conv-secret-77"));
        assertEquals(0, redacted.getJSONObject("args").length());
        // Ostatné príkazy ostávajú nezmenené (v1 rest/start).
        JSONObject rest = new JSONObject(command("x").toString()).put("type", "restStart").put("args", new JSONObject().put("seconds", 60));
        assertEquals(60, WearProtocol.redacted(rest).getJSONObject("args").getInt("seconds"));
    }

    private static JSONObject snapshot() throws Exception {
        return new JSONObject("{\"v\":1,\"binding\":{\"enabled\":true,\"epoch\":\"e1\",\"workspace\":\"w1\",\"peer\":\"n\",\"label\":\"P\"},"
            + "\"seq\":1,\"createdAt\":1000,\"expiresAt\":31000,\"language\":\"en\",\"plans\":[],\"session\":null,\"rest\":null,\"calendar\":[]}");
    }

    @Test public void snapshotOffersOptionalGrantsJournalAndBoundedMessages() throws Exception {
        WearProtocol.snapshot(snapshot());   // staré telefóny: polia chýbajú
        JSONObject full = snapshot().put("grants", new JSONObject().put("offline", true).put("messages", true)).put("packRev", "pr")
            .put("journal", new org.json.JSONArray().put(new JSONObject().put("sessionId", "mk3j9x0a7b2").put("ackSeq", 4).put("status", "staged")))
            .put("messages", new org.json.JSONArray().put(new JSONObject().put("conversationId", "c1").put("name", "Eva").put("last", "hi")
                .put("unread", 2).put("at", 5).put("canSend", true)));
        WearProtocol.snapshot(full);
        JSONObject tooMany = snapshot();
        org.json.JSONArray many = new org.json.JSONArray();
        for (int i = 0; i < 11; i++) many.put(new JSONObject().put("conversationId", "c" + i).put("name", "n").put("last", "l")
            .put("unread", 0).put("at", 1).put("canSend", false));
        tooMany.put("messages", many);
        assertThrows(JSONException.class, () -> WearProtocol.snapshot(tooMany));
        JSONObject longName = snapshot().put("messages", new org.json.JSONArray().put(new JSONObject().put("conversationId", "c")
            .put("name", "n".repeat(61)).put("last", "l").put("unread", 0).put("at", 1).put("canSend", true)));
        assertThrows(JSONException.class, () -> WearProtocol.snapshot(longName));
        JSONObject badStatus = snapshot().put("journal", new org.json.JSONArray().put(new JSONObject().put("sessionId", "s").put("ackSeq", 1).put("status", "weird")));
        assertThrows(JSONException.class, () -> WearProtocol.snapshot(badStatus));
        JSONObject badGrant = snapshot().put("grants", new JSONObject().put("offline", "yes").put("messages", false));
        assertThrows(JSONException.class, () -> WearProtocol.snapshot(badGrant));
    }

    @Test public void revokedSnapshotCarriesNoMessagesGrantsOrJournal() throws Exception {
        JSONObject disabled = snapshot();
        disabled.getJSONObject("binding").put("enabled", false).put("peer", "").put("label", "");
        WearProtocol.snapshot(disabled);
        JSONObject withMessages = new JSONObject(disabled.toString()).put("messages", new org.json.JSONArray().put(new JSONObject()
            .put("conversationId", "c").put("name", "n").put("last", "l").put("unread", 0).put("at", 1).put("canSend", true)));
        assertThrows(JSONException.class, () -> WearProtocol.snapshot(withMessages));
        JSONObject withGrant = new JSONObject(disabled.toString()).put("grants", new JSONObject().put("offline", true).put("messages", false));
        assertThrows(JSONException.class, () -> WearProtocol.snapshot(withGrant));
    }
}
