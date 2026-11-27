package surotvsk.gymapp.wear;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/**
 * Povinnosť doručiť odvolanie väzby hodinkám (peer + epocha + pracovný priestor). Záznamy žijú priamo v dokumente
 * telefónu vedľa konfigurácie, takže sa zapisujú ROVNAKÝM atómovým zápisom ako odpojenie (nikdy nie po ňom).
 * Záznam sa NEvytláča a nemaže sa pri úspešnom odoslaní správy; zmizne len keď hodinky potvrdia použité odvolanie
 * (UNLINK danej epochy po trvalom zmazaní) alebo keď sa ozvú na novej väzbe (prijali náhradnú epochu).
 * Metódy menia len odovzdaný objekt; zápis robí volajúci.
 */
public final class RevocationLedger {
    private static final String PENDING = "pendingRevocations", DONE = "revocationsDone", DONE_ORDER = "revocationsDoneOrder";
    private static final int MAX_DONE = 200;
    private RevocationLedger() {}

    private static JSONArray pending(JSONObject root) throws JSONException {
        JSONArray a = root.optJSONArray(PENDING);
        if (a == null) { a = new JSONArray(); root.put(PENDING, a); }
        return a;
    }
    private static boolean done(JSONObject root, String epoch) {
        JSONObject d = root.optJSONObject(DONE); return d != null && d.has(epoch);
    }
    /** Pridá povinnosť. Nič sa nevytláča; vracia true ak sa dokument zmenil. */
    public static boolean add(JSONObject root, JSONObject config) {
        try {
            String peer = config.optString("peer"), epoch = config.optString("epoch");
            if (peer.isEmpty() || epoch.isEmpty() || done(root, epoch)) return false;
            JSONArray entries = pending(root);
            for (int i = 0; i < entries.length(); i++) {
                JSONObject e = entries.getJSONObject(i);
                if (e.getString("peer").equals(peer) && e.getString("epoch").equals(epoch)) return false;
            }
            entries.put(new JSONObject().put("peer", peer).put("epoch", epoch).put("workspace", config.getString("workspace")));
            return true;
        } catch (JSONException e) { throw new JournalError("rejected", e); }
    }
    /** Čakajúce odvolania pre uzol (kópie). */
    public static List<JSONObject> pendingFor(JSONObject root, String node) {
        List<JSONObject> out = new ArrayList<>();
        JSONArray entries = root.optJSONArray(PENDING);
        for (int i = 0; entries != null && i < entries.length(); i++) {
            JSONObject e = entries.optJSONObject(i);
            if (e != null && node.equals(e.optString("peer"))) {
                try { out.add(new JSONObject(e.toString())); } catch (JSONException x) { throw new JournalError("rejected", x); }
            }
        }
        return out;
    }
    public static boolean has(JSONObject root, String node, String epoch) {
        for (JSONObject e : pendingFor(root, node)) if (e.optString("epoch").equals(epoch)) return true;
        return false;
    }
    /** Potvrdené (už nič nehrozí): odvolanie už hodinky použili alebo prijali novú väzbu. */
    public static boolean isConfirmed(JSONObject root, String epoch) { return done(root, epoch); }
    /** Iba správa na aktuálnej schválenej väzbe dokazuje prijatie náhradnej epochy. */
    public static boolean confirmAdopted(JSONObject root, String node, JSONObject header) {
        JSONObject config = root.optJSONObject("configuration");
        if (config == null || header == null || !config.optBoolean("enabled")
            || !node.equals(config.optString("peer"))
            || !config.optString("epoch").equals(header.optString("epoch"))
            || !config.optString("workspace").equals(header.optString("workspace"))) return false;
        return confirm(root, node, null);
    }
    /**
     * @param epoch konkrétna odvolaná epocha, alebo null = hodinky sa ozvali na NOVEJ väzbe, takže prijali náhradnú epochu.
     * @return true ak sa dokument zmenil
     */
    public static boolean confirm(JSONObject root, String node, String epoch) {
        try {
            JSONArray old = root.optJSONArray(PENDING), next = new JSONArray();
            boolean changed = false;
            JSONObject d = root.optJSONObject(DONE); JSONArray order = root.optJSONArray(DONE_ORDER);
            if (d == null) { d = new JSONObject(); root.put(DONE, d); }
            if (order == null) { order = new JSONArray(); root.put(DONE_ORDER, order); }
            for (int i = 0; old != null && i < old.length(); i++) {
                JSONObject e = old.getJSONObject(i);
                if (e.getString("peer").equals(node) && (epoch == null || e.getString("epoch").equals(epoch))) {
                    if (!d.has(e.getString("epoch"))) { d.put(e.getString("epoch"), true); order.put(e.getString("epoch")); }
                    changed = true;
                } else next.put(e);
            }
            // Už potvrdená epocha sa pri opakovanom UNLINK nezabudne (znovu sa nepridá); najstaršie potvrdené sa smú zabudnúť.
            if (epoch != null && !d.has(epoch)) { d.put(epoch, true); order.put(epoch); changed = true; }
            while (order.length() > MAX_DONE) { d.remove(order.getString(0)); order.remove(0); }
            if (changed) root.put(PENDING, next);
            return changed;
        } catch (JSONException e) { throw new JournalError("rejected", e); }
    }
    public static int size(JSONObject root) {
        JSONArray a = root.optJSONArray(PENDING); return a == null ? 0 : a.length();
    }
}
