package surotvsk.gymapp.wear;

import org.json.JSONArray;
import org.json.JSONObject;

/** Jediné pravidlo, kedy smie hodinkové UI držať editor/potvrdenie odpovede a kedy ju smie odoslať. */
public final class ReplyGuard {
    private ReplyGuard() {}
    /**
     * @param chats aktuálne pamäťové konverzácie (null = chýba čerstvé pripojenie, súhlas na správy alebo väzba)
     * @return true len ak konverzácia stále existuje a pripúšťa odpoveď
     */
    public static boolean allowed(JSONArray chats, String conversationId) {
        if (chats == null || conversationId == null || conversationId.isEmpty()) return false;
        for (int i = 0; i < chats.length(); i++) {
            JSONObject chat = chats.optJSONObject(i);
            if (chat != null && conversationId.equals(chat.optString("conversationId")) && chat.optBoolean("canSend")) return true;
        }
        return false;
    }
}
