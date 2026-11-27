package surotvsk.gymapp.wear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

/** Zdieľaný protokol hodiniek proti skutočnému tvaru z JS (wearRevoke, wearRestSnapshot, wearBuildPayload). */
public class WearProtocolTest {
    private static String config(boolean enabled, String peer, String label) {
        return "{\"enabled\":" + enabled + ",\"epoch\":\"e1\",\"workspace\":\"w1\",\"peer\":" + peer + ",\"label\":" + label + "}";
    }

    private static JSONObject snapshot(String binding, String rest) throws JSONException {
        return new JSONObject("{\"v\":1,\"binding\":" + binding + ",\"seq\":3,\"createdAt\":1000,\"expiresAt\":31000,"
            + "\"language\":\"en\",\"plans\":[],\"session\":null,\"rest\":" + rest + ",\"calendar\":[]}");
    }

    private static final String ENABLED = config(true, "\"watch-1\"", "\"Pixel Watch\"");
    private static final String RUNNING = "{\"id\":\"r1\",\"endAt\":5000,\"pausedLeftMs\":null,\"totalMs\":60000,\"done\":false}";

    @Test
    public void disabledConfigurationAcceptsTheEmptyPeerAndLabelThatJsSends() throws Exception {
        // Čerstvé zariadenie: wearRevoke() bez starej väzby posiela peer '' aj label ''.
        WearProtocol.configuration(new JSONObject(config(false, "\"\"", "\"\"")));
        // Odvolanie po spárovaní nesie bývalý peer a prázdny label.
        WearProtocol.configuration(new JSONObject(config(false, "\"watch-1\"", "\"\"")));
    }

    @Test
    public void enabledConfigurationStillRequiresPeerAndLabel() {
        assertThrows(JSONException.class, () -> WearProtocol.configuration(new JSONObject(config(true, "\"\"", "\"Pixel Watch\""))));
        assertThrows(JSONException.class, () -> WearProtocol.configuration(new JSONObject(config(true, "\"watch-1\"", "\"\""))));
    }

    @Test
    public void disabledConfigurationStillRejectsMissingWrongTypeAndOversizedFields() {
        String tooLong = "\"" + "x".repeat(161) + "\"";
        assertThrows(JSONException.class, () -> WearProtocol.configuration(new JSONObject(config(false, "null", "\"\""))));
        assertThrows(JSONException.class, () -> WearProtocol.configuration(new JSONObject(config(false, "\"\"", "7"))));
        assertThrows(JSONException.class, () -> WearProtocol.configuration(new JSONObject(config(false, tooLong, "\"\""))));
        assertThrows(JSONException.class, () -> WearProtocol.configuration(new JSONObject(config(false, "\"\"", tooLong))));
        assertThrows(JSONException.class, () -> WearProtocol.configuration(
            new JSONObject("{\"enabled\":false,\"epoch\":\"e1\",\"workspace\":\"w1\",\"peer\":\"\"}")));
        assertThrows(JSONException.class, () -> WearProtocol.configuration(
            new JSONObject("{\"enabled\":\"false\",\"epoch\":\"e1\",\"workspace\":\"w1\",\"peer\":\"\",\"label\":\"\"}")));
        // Epocha a pracovný priestor ostávajú povinné aj pri odvolaní.
        assertThrows(JSONException.class, () -> WearProtocol.configuration(new JSONObject(
            "{\"enabled\":false,\"epoch\":\"\",\"workspace\":\"w1\",\"peer\":\"\",\"label\":\"\"}")));
        assertThrows(JSONException.class, () -> WearProtocol.configuration(new JSONObject(
            "{\"enabled\":false,\"epoch\":\"e1\",\"workspace\":\"\",\"peer\":\"\",\"label\":\"\"}")));
    }

    @Test
    public void snapshotAcceptsRunningRestWithNullPausedLeft() throws Exception {
        WearProtocol.snapshot(snapshot(ENABLED, RUNNING));
    }

    @Test
    public void snapshotKeepsPausedRestMillisecondsIncludingZero() throws Exception {
        JSONObject paused = snapshot(ENABLED, "{\"id\":\"r1\",\"endAt\":5000,\"pausedLeftMs\":42000,\"totalMs\":60000,\"done\":false}");
        WearProtocol.snapshot(paused);
        assertEquals(42000L, paused.getJSONObject("rest").getLong("pausedLeftMs"));
        WearProtocol.snapshot(snapshot(ENABLED, "{\"id\":\"r1\",\"endAt\":5000,\"pausedLeftMs\":0,\"totalMs\":60000,\"done\":false}"));
    }

    @Test
    public void snapshotRejectsInvalidPausedLeft() {
        String head = "{\"id\":\"r1\",\"endAt\":5000,";
        String tail = ",\"totalMs\":60000,\"done\":false}";
        for (String bad : new String[] {"\"pausedLeftMs\":-1", "\"pausedLeftMs\":1.5", "\"pausedLeftMs\":\"100\"",
                "\"pausedLeftMs\":true", "\"x\":0"}) {
            assertThrows(bad, JSONException.class, () -> WearProtocol.snapshot(snapshot(ENABLED, head + bad + tail)));
        }
    }

    @Test
    public void disabledSnapshotMayCarryEmptyPeerButNoPrivateContent() throws Exception {
        String disabled = config(false, "\"\"", "\"\"");
        WearProtocol.snapshot(snapshot(disabled, "null"));
        JSONException error = assertThrows(JSONException.class, () -> WearProtocol.snapshot(snapshot(disabled, RUNNING)));
        assertTrue(error.getMessage().contains("disabled_private_content"));
    }

    @Test
    public void sameComparesAllConfigurationFieldsIncludingEmptyDisabledOnes() throws Exception {
        JSONObject a = new JSONObject(config(false, "\"\"", "\"\""));
        assertTrue(WearProtocol.same(a, new JSONObject(config(false, "\"\"", "\"\""))));
        assertTrue(!WearProtocol.same(a, new JSONObject(config(false, "\"watch-1\"", "\"\""))));
        assertTrue(!WearProtocol.same(a, null));
    }
}
