package surotvsk.gymapp.wear;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Zmena súhlasu telefónu. Nová konfigurácia, odvolané epochy a povinnosť doručiť odvolanie hodinkám sa
 * pripravia na KÓPII dokumentu a zapíšu JEDNÝM atómovým zápisom. Zlyhanie zápisu nezmení nič (ani pamäť);
 * odvolanie bez zapamätanej povinnosti doručenia (alebo naopak) tak nikdy nevznikne.
 */
public final class BindingRules {
    private BindingRules() {}

    /**
     * @param data aktuálny dokument telefónu (nemení sa)
     * @return nový, už zapísaný dokument; rovnaký objekt `data` ak sa nič nezmenilo
     * @throws JSONException s pevným kódom pri neplatnej žiadosti; JournalError("storage") pri zlyhaní zápisu
     */
    public static JSONObject configure(JSONObject data, JSONObject c, WearStore store) throws JSONException {
        WearProtocol.configuration(c);
        JSONObject next = new JSONObject(data.toString());
        JSONObject old = next.optJSONObject("configuration");
        boolean enabled = c.getBoolean("enabled");
        boolean changed = false;
        if (WearProtocol.same(old, c)) {
            // Opakované odvolanie: povinnosť doručenia musí existovať (pridá sa len ak chýba a nebola potvrdená).
            if (!enabled) changed = RevocationLedger.add(next, c);
        } else {
            JSONObject revoked = next.optJSONObject("revoked");
            if (revoked == null) { revoked = new JSONObject(); next.put("revoked", revoked); }
            if (enabled) {
                WearProtocol.require(!revoked.has(c.getString("epoch")), "new_consent_epoch_required");
                if (old != null && (!old.optString("workspace").equals(c.getString("workspace"))
                    || !old.optString("peer").equals(c.getString("peer")) || !old.optBoolean("enabled"))) {
                    WearProtocol.require(!old.optString("epoch").equals(c.getString("epoch")), "new_consent_epoch_required");
                }
            }
            boolean epochChanged = old != null && !old.optString("epoch").equals(c.getString("epoch"));
            if (epochChanged) revoked.put(old.getString("epoch"), true);
            if (!enabled) revoked.put(c.getString("epoch"), true);
            next.put("configuration", new JSONObject(c.toString()));
            if (old == null || epochChanged) next.put("seq", -1);
            // Povinnosť doručiť odvolanie vzniká v tom istom dokumente ako odpojenie.
            if (old != null && old.optBoolean("enabled") && (epochChanged || !enabled)) RevocationLedger.add(next, old);
            if (!enabled && !(old != null && !epochChanged && old.optString("peer").equals(c.getString("peer")))) RevocationLedger.add(next, c);
            changed = true;
        }
        if (!changed) return data;
        try { store.write(next); } catch (RuntimeException e) { throw new JournalError("storage", e); }
        return next;
    }
}
