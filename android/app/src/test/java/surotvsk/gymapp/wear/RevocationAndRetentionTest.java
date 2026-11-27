package surotvsk.gymapp.wear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import java.util.List;

/**
 * Regresie z kontroly: odvolanie väzby prežije nedostupné hodinky, platné šablóny sa nevytláčajú
 * (aj keď telefón publikuje veľa nových balíkov, kým sú hodinky preč) a UI odpovede sa riadi jedným pravidlom.
 */
public class RevocationAndRetentionTest {
    private static final String EPOCH = "epoch-1", WS = "ws-1", NODE = "phone-1";
    private static final long DAY = 24L * 3600 * 1000;
    private OfflineJournalTest.Env env; private JSONObject config;

    @Before public void setUp() throws Exception {
        env = new OfflineJournalTest.Env();
        config = new JSONObject().put("enabled", true).put("epoch", EPOCH).put("workspace", WS).put("peer", NODE).put("label", "Phone");
    }
    private static JSONObject config(String peer, String epoch, boolean enabled) throws Exception {
        return new JSONObject().put("enabled", enabled).put("epoch", epoch).put("workspace", WS).put("peer", peer).put("label", enabled ? "Watch" : "");
    }

    /* ---------- 1. odpojenie + povinnosť doručiť odvolanie = jeden atómový zápis ---------- */
    @Test public void unlinkAndItsRetryObligationAreOneAtomicWrite() throws Exception {
        OfflineJournalTest.MemoryStore disk = new OfflineJournalTest.MemoryStore();
        final JSONObject linked = BindingRules.configure(new JSONObject(), config("watch-1", "e-old", true), disk);
        int writes = disk.writes;
        disk.failWrites = true;                       // odpojenie pri zlyhaní úložiska: nič sa nezmení, ani povinnosť nevznikne osamote
        assertEquals("storage", assertThrows(JournalError.class, () -> BindingRules.configure(linked, config("watch-1", "e-old", false), disk)).code);
        assertTrue(linked.getJSONObject("configuration").getBoolean("enabled"));
        assertEquals(0, RevocationLedger.size(linked));
        disk.failWrites = false;
        BindingRules.configure(linked, config("watch-1", "e-old", false), disk);
        assertEquals(writes + 1, disk.writes);        // jediný zápis nesie aj vypnutú konfiguráciu, aj povinnosť
        JSONObject onDisk = new JSONObject(disk.content);   // reštart procesu
        assertFalse(onDisk.getJSONObject("configuration").getBoolean("enabled"));
        assertTrue(onDisk.getJSONObject("revoked").has("e-old"));
        assertEquals(1, RevocationLedger.pendingFor(onDisk, "watch-1").size());
        assertEquals(WS, RevocationLedger.pendingFor(onDisk, "watch-1").get(0).getString("workspace"));
    }

    @Test public void successfulMessageSendIsNotAnAckOnlyTheWatchConfirmationOrAdoptionClearsIt() throws Exception {
        OfflineJournalTest.MemoryStore disk = new OfflineJournalTest.MemoryStore();
        JSONObject data = BindingRules.configure(new JSONObject(), config("watch-1", "e-old", true), disk);
        data = BindingRules.configure(data, config("watch-1", "e-old", false), disk);
        // Opakované úspešné odoslania náhrobku (žiadna zmena dokumentu) povinnosť nezrušia.
        for (int i = 0; i < 5; i++) assertEquals(1, RevocationLedger.pendingFor(data, "watch-1").size());
        assertEquals(0, RevocationLedger.pendingFor(data, "other-watch").size());
        RevocationLedger.confirm(data, "watch-1", "e-unrelated");                 // iná epocha nič nepotvrdí
        assertEquals(1, RevocationLedger.pendingFor(data, "watch-1").size());
        assertFalse(RevocationLedger.isConfirmed(data, "e-old"));
        RevocationLedger.confirm(data, "watch-1", "e-old");                        // UNLINK od hodiniek po zmazaní
        assertEquals(0, RevocationLedger.pendingFor(data, "watch-1").size());
        assertTrue(RevocationLedger.isConfirmed(data, "e-old"));
        // Opakované odvolanie po potvrdení povinnosť nevzkriesi a nič nezapisuje.
        int writes = disk.writes;
        assertTrue(BindingRules.configure(data, config("watch-1", "e-old", false), disk) == data);
        assertEquals(writes, disk.writes);
        // Relink toho istého uzla: staré odvolanie ostáva, kým sa hodinky neozvú na novej epoche (prijali náhradu).
        JSONObject relinked = BindingRules.configure(
            BindingRules.configure(new JSONObject(), config("watch-2", "e-1", true), disk), config("watch-2", "e-2", true), disk);
        assertEquals(1, RevocationLedger.pendingFor(relinked, "watch-2").size());
        RevocationLedger.confirm(relinked, "watch-2", null);
        assertEquals(0, RevocationLedger.pendingFor(relinked, "watch-2").size());
    }

    @Test public void seventeenAndMoreUnconfirmedRevocationsAreAllRetained() throws Exception {
        JSONObject root = new JSONObject();
        for (int i = 0; i < 40; i++) assertTrue(RevocationLedger.add(root, config("watch-1", "e-" + i, false)));
        assertFalse(RevocationLedger.add(root, config("watch-1", "e-3", false)));   // duplicita sa nepridá
        assertEquals(40, RevocationLedger.size(root));
        assertTrue(RevocationLedger.has(root, "watch-1", "e-0"));                    // najstaršia sa nevytlačila
        assertTrue(RevocationLedger.has(root, "watch-1", "e-39"));
    }

    @Test public void staleJournalHeaderCannotRetireAnOldEpochRevocation() throws Exception {
        OfflineJournalTest.MemoryStore disk = new OfflineJournalTest.MemoryStore();
        JSONObject data = BindingRules.configure(new JSONObject(), config("watch-1", "e-old", true), disk);
        data = BindingRules.configure(data, config("watch-1", "e-new", true), disk);
        JSONObject stale = new JSONObject().put("epoch", "e-old").put("workspace", WS);
        assertFalse(RevocationLedger.confirmAdopted(data, "watch-1", stale));
        assertTrue(RevocationLedger.has(data, "watch-1", "e-old"));
        JSONObject wrongWorkspace = new JSONObject().put("epoch", "e-new").put("workspace", "other");
        assertFalse(RevocationLedger.confirmAdopted(data, "watch-1", wrongWorkspace));
        JSONObject adopted = new JSONObject().put("epoch", "e-new").put("workspace", WS);
        assertFalse(RevocationLedger.confirmAdopted(data, "foreign-watch", adopted));
        assertTrue(RevocationLedger.has(data, "watch-1", "e-old"));
        assertTrue(RevocationLedger.confirmAdopted(data, "watch-1", adopted));
        assertFalse(RevocationLedger.has(data, "watch-1", "e-old"));
    }

    @Test public void unreadableJournalIsOverwrittenBeforeRevocationCanBeConfirmed() {
        OfflineJournalTest.MemoryStore disk = new OfflineJournalTest.MemoryStore();
        disk.content = "{\"v\":999,\"privateWorkout\":\"PRIVATE_CACHED_WORK\"}";
        WatchJournal journal = new WatchJournal(disk, env);
        assertTrue(journal.unreadable());
        String original = disk.content;
        disk.failWrites = true;
        assertEquals("storage", assertThrows(JournalError.class, journal::wipe).code);
        assertEquals(original, disk.content);
        assertTrue(journal.unreadable());
        disk.failWrites = false;
        journal.wipe();
        assertFalse(journal.unreadable());
        assertFalse(disk.content.contains("PRIVATE_CACHED_WORK"));
        WatchJournal restarted = new WatchJournal(disk, env);
        assertFalse(restarted.unreadable());
        assertEquals("", restarted.epoch());
        assertTrue(restarted.sessions().isEmpty());
        assertNull(restarted.pack());
    }

    /* ---------- 2. platné šablóny a semienka sa nevytláčajú ---------- */
    private JSONObject seed(String id, String base) throws Exception {
        return new JSONObject().put("sessionId", id).put("planId", "plan-1").put("planRev", "rev-1").put("baselineRevision", base)
            .put("startedAt", env.now - 60000).put("plan", OfflineJournalTest.plan("plan-1", "rev-1"))
            .put("completedSets", new JSONObject().put("k-b0", true));
    }
    private JSONObject pack(String packRev, String planRev, JSONObject active) throws Exception {
        return new JSONObject().put("v", 1).put("epoch", EPOCH).put("workspace", WS).put("packRev", packRev).put("createdAt", env.now)
            .put("expiresAt", env.now + 7 * DAY).put("plans", new JSONArray().put(OfflineJournalTest.plan("plan-1", planRev)))
            .put("active", active == null ? JSONObject.NULL : active).put("truncated", false);
    }
    private JSONObject templates(String planRev, boolean active) throws Exception {
        JSONObject t = new JSONObject().put(planRev, new JSONObject().put("canonical", "template-" + planRev));
        if (active) t.put("active", new JSONObject().put("canonical", "active-template"));
        return t;
    }
    private String sync(WatchJournal watch, PhoneInbox inbox) {
        String last = "";
        for (JSONObject batch : watch.pendingBatches(null)) {
            JSONObject ack = inbox.accept(config, NODE, batch).ack;
            last = ack.optString("status") + ":" + ack.optString("error", "");
            watch.ack(ack);
        }
        return last;
    }

    @Test public void phoneEditingManyTimesWhileTheWatchIsAwayNeverLosesTheOriginalSeed() throws Exception {
        PhoneInbox inbox = new PhoneInbox(new OfflineJournalTest.MemoryStore(), env);
        WatchJournal watch = new WatchJournal(new OfflineJournalTest.MemoryStore(), env);
        watch.bind(EPOCH, WS);
        assertTrue(watch.acceptPack(inbox.publishPack(config, pack("pack-0", "rev-1", seed("mk3j9x0a7b2", "base-0")), templates("rev-1", true))));
        // Hodinky sú preč: telefón upraví tréning 12-krát (viac než pôvodných 8 semienok) a publikuje nové balíky.
        for (int i = 1; i <= 12; i++)
            inbox.publishPack(config, pack("pack-" + i, "rev-" + (i + 1), seed("mk3j9x0a7b2", "base-" + i)), templates("rev-" + (i + 1), true));
        String id = watch.continueActive();
        watch.toggle(id, "k-b1");
        assertEquals("staged:", sync(watch, inbox));
        JSONObject record = inbox.drain(config).getJSONObject(0);
        assertEquals("base-0", record.getString("baselineRevision"));
        assertEquals("active-template", record.getJSONObject("template").getString("canonical"));
    }

    @Test public void originalPlanTemplateSurvivesManyNewPacksAndStillStagesAfterExpiry() throws Exception {
        PhoneInbox inbox = new PhoneInbox(new OfflineJournalTest.MemoryStore(), env);
        WatchJournal watch = new WatchJournal(new OfflineJournalTest.MemoryStore(), env);
        watch.bind(EPOCH, WS);
        assertTrue(watch.acceptPack(inbox.publishPack(config, pack("pack-0", "rev-1", null), templates("rev-1", false))));
        for (int i = 1; i <= 15; i++) inbox.publishPack(config, pack("pack-" + i, "rev-edit-" + i, null), templates("rev-edit-" + i, false));
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0"); watch.finish(id);
        env.now += 9 * DAY;                      // balík vypršal, kým boli hodinky preč; zaznamenaná práca ostáva
        assertEquals("staged:", sync(watch, inbox));
        assertEquals("template-rev-1", inbox.drain(config).getJSONObject(0).getJSONObject("template").getString("canonical"));
        // Nový štart z vypršaného balíka hodinky už nedovolia.
        assertThrows(JournalError.class, () -> watch.startPlan("plan-1"));
    }

    @Test public void fullInboxRefusesNewPublishesInsteadOfEvictingValidTemplatesAndFreesOnlyExpiredOnes() throws Exception {
        PhoneInbox small = new PhoneInbox(new OfflineJournalTest.MemoryStore(), env, 6000);
        WatchJournal watch = new WatchJournal(new OfflineJournalTest.MemoryStore(), env);
        watch.bind(EPOCH, WS);
        assertTrue(watch.acceptPack(small.publishPack(config, pack("pack-0", "rev-1", null), templates("rev-1", false))));
        JournalError refused = null;
        for (int i = 1; i <= 30 && refused == null; i++) {
            try { small.publishPack(config, pack("pack-" + i, "rev-edit-" + i, null), templates("rev-edit-" + i, false)); }
            catch (JournalError e) { refused = e; }
        }
        assertEquals("archive_full", refused == null ? "" : refused.code);
        // Žiadny platný záznam sa nestratil: práca z pôvodného balíka sa ešte prijme.
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0"); watch.finish(id);
        assertEquals("staged:", sync(watch, small));
        // Po vypršaní sa miesto uvoľní len z vypršaných záznamov a publikovanie opäť prejde.
        env.now += 8 * DAY;
        small.publishPack(config, pack("pack-new", "rev-fresh", null), templates("rev-fresh", false));
        assertEquals("pack-new", small.currentPackRev(config));
    }

    @Test public void expiredTemplatesAreReleasedOnlyAfterTheRecoveryWindow() throws Exception {
        PhoneInbox inbox = new PhoneInbox(new OfflineJournalTest.MemoryStore(), env);
        WatchJournal watch = new WatchJournal(new OfflineJournalTest.MemoryStore(), env);
        watch.bind(EPOCH, WS);
        assertTrue(watch.acceptPack(inbox.publishPack(config, pack("pack-0", "rev-1", null), templates("rev-1", false))));
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0"); watch.finish(id);
        env.now += 20 * DAY;                     // vypršané, ale v okne obnovy
        inbox.publishPack(config, pack("pack-x", "rev-x", null), templates("rev-x", false));
        assertEquals("staged:", sync(watch, inbox));
        env.now += 40 * DAY;                     // za oknom obnovy: pôvodná šablóna sa uvoľní a zabudnutá relácia sa neprijme potichu
        inbox.publishPack(config, pack("pack-y", "rev-y", null), templates("rev-y", false));
        WatchJournal late = new WatchJournal(new OfflineJournalTest.MemoryStore(), env);
        late.bind(EPOCH, WS);
        late.acceptPack(pack("pack-0", "rev-1", null));
        env.now -= 55 * DAY;
        String lateId = late.startPlan("plan-1");
        late.toggle(lateId, "k-b1"); late.finish(lateId);
        env.now += 55 * DAY;
        String result = sync(late, inbox);
        assertTrue(result.startsWith("rejected:"));
        assertFalse(late.sessions().isEmpty());           // hodinky prácu zachovajú na kontrolu
    }

    /* ---------- 5. editor odpovede ---------- */
    @Test public void replyEditorIsAllowedOnlyWhileTheChatIsFreshAndWritable() throws Exception {
        JSONArray chats = new JSONArray()
            .put(new JSONObject().put("conversationId", "c1").put("name", "Eva").put("last", "hi").put("unread", 0).put("at", 1).put("canSend", true))
            .put(new JSONObject().put("conversationId", "c2").put("name", "Bo").put("last", "yo").put("unread", 1).put("at", 2).put("canSend", false));
        assertTrue(ReplyGuard.allowed(chats, "c1"));
        assertFalse(ReplyGuard.allowed(chats, "c2"));          // nová informácia: už sa neodpovedá
        assertFalse(ReplyGuard.allowed(chats, "gone"));        // konverzácia zmizla
        assertFalse(ReplyGuard.allowed(null, "c1"));           // odpojenie, vypršaný snapshot, stratený súhlas alebo odvolanie
        assertFalse(ReplyGuard.allowed(chats, ""));
    }

    @Test public void retainedLimitCountsEncodedBytesNotStringUnits() throws Exception {
        // Šablóna z 3-bajtových znakov: 400 znakov = 1200 bajtov. Limit 5000 B sa musí naplniť skôr než pri počítaní znakov.
        String wide = "漢".repeat(400);
        PhoneInbox small = new PhoneInbox(new OfflineJournalTest.MemoryStore(), env, 5000);
        int refusedAt = 0;
        for (int i = 1; i <= 12 && refusedAt == 0; i++) {
            JSONObject t = new JSONObject().put("rev-w" + i, new JSONObject().put("canonical", wide));
            try { small.publishPack(config, pack("pack-w" + i, "rev-w" + i, null), t); }
            catch (JournalError e) { assertEquals("archive_full", e.code); refusedAt = i; }
        }
        assertTrue("refused at " + refusedAt, refusedAt >= 2 && refusedAt <= 3);
    }
}
