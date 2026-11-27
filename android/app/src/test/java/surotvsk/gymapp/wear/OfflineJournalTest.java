package surotvsk.gymapp.wear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import java.util.List;
import java.util.UUID;

/**
 * Skutočné hrany medzi hodinkami a telefónom: dávky z WatchJournal idú priamo do PhoneInbox
 * (rovnaký kód ako v produkcii) a ACK z PhoneInbox späť do WatchJournal. Nahradené je len úložisko
 * (pamäť s vypnutím zápisu) a hodiny; žiadny prenos sa nenapodobňuje.
 */
public class OfflineJournalTest {
    /** Úložisko s rovnakou zárukou ako AtomicFile: neúspešný zápis nechá starý obsah. */
    static final class MemoryStore implements WearStore {
        String content = ""; boolean failWrites; int writes;
        @Override public JSONObject read() {
            try { return content.isEmpty() ? new JSONObject() : new JSONObject(content); } catch (Exception e) { throw new IllegalStateException("wear_storage_read", e); }
        }
        @Override public void write(JSONObject value) {
            if (failWrites) throw new IllegalStateException("wear_storage_write");
            content = value.toString(); writes++;
        }
    }
    static final class Env implements WearEnv {
        long now = 1_700_000_000_000L; int boot = 7; long counter = 1;
        @Override public long wall() { return now; }
        @Override public int boot() { return boot; }
        @Override public String uuid() { return new UUID(0xABCDL, counter++).toString(); }
    }

    private static final String EPOCH = "epoch-1", WS = "ws-1", NODE = "phone-1";
    private Env env; private MemoryStore watchStore, phoneStore;
    private WatchJournal watch; private PhoneInbox inbox; private JSONObject config;

    @Before public void setUp() throws Exception {
        env = new Env(); watchStore = new MemoryStore(); phoneStore = new MemoryStore();
        watch = new WatchJournal(watchStore, env); inbox = new PhoneInbox(phoneStore, env);
        config = new JSONObject().put("enabled", true).put("epoch", EPOCH).put("workspace", WS).put("peer", NODE).put("label", "Phone");
        watch.bind(EPOCH, WS);
    }

    /* ---------- pomocné tvary ---------- */
    static JSONObject plan(String id, String rev) throws Exception {
        JSONObject bench = new JSONObject().put("slotKey", "s1").put("name", "Bench").put("sides", JSONObject.NULL).put("sets", new JSONArray()
            .put(new JSONObject().put("index", 0).put("setKey", "k-b0").put("weight", 60).put("reps", 8))
            .put(new JSONObject().put("index", 1).put("setKey", "k-b1").put("weight", 62.5).put("reps", 6)));
        JSONObject row = new JSONObject().put("slotKey", "s2").put("name", "Row").put("sides", new JSONArray().put("left").put("right")).put("sets", new JSONArray()
            .put(new JSONObject().put("index", 0).put("setKeys", new JSONObject().put("L", "k-rL0").put("R", "k-rR0")).put("weight", 20).put("reps", 10)));
        return new JSONObject().put("planId", id).put("planRev", rev).put("name", "Push").put("slots", new JSONArray().put(bench).put(row));
    }
    JSONObject pack(String rev, JSONObject active) throws Exception {
        return new JSONObject().put("v", 1).put("epoch", EPOCH).put("workspace", WS).put("packRev", rev).put("createdAt", env.now)
            .put("expiresAt", env.now + 7L * 24 * 3600 * 1000).put("plans", new JSONArray().put(plan("plan-1", "rev-1")))
            .put("active", active == null ? JSONObject.NULL : active).put("truncated", false);
    }
    static JSONObject templates(boolean active) throws Exception {
        JSONObject t = new JSONObject().put("rev-1", new JSONObject().put("canonical", "original-template"));
        if (active) t.put("active", new JSONObject().put("canonical", "active-template"));
        return t;
    }
    /** Telefón publikuje balík a hodinky ho prijmú (rovnaký objekt, aký ide po MessageClient). */
    void publish(JSONObject active) throws Exception {
        JSONObject sent = inbox.publishPack(config, pack("pack-1", active), templates(active != null));
        assertTrue(watch.acceptPack(sent));
    }
    /** Jeden kolobeh sync: dávky z hodiniek -> telefón -> ACK späť. Vracia počet ACK. */
    int sync() {
        int acks = 0;
        for (JSONObject batch : watch.pendingBatches(null)) {
            PhoneInbox.Accepted a = inbox.accept(config, NODE, batch);
            if (a.ack != null) { watch.ack(a.ack); acks++; }
        }
        return acks;
    }
    static JSONObject result(String id, String status, long applied) throws Exception {
        return new JSONObject().put("epoch", EPOCH).put("workspace", WS).put("sessionId", id).put("status", status).put("appliedSeq", applied);
    }

    /* ---------- hlavný tok ---------- */
    @Test public void cachedPlanStartsOfflineSurvivesRebootAndSyncsLeftRightWithoutDuplicateClaim() throws Exception {
        publish(null);
        // Telefón je preč: štart, značky oboch strán, reštart (nový objekt nad tým istým súborom), dokončenie.
        String id = watch.startPlan("plan-1");
        assertTrue(watch.toggle(id, "k-b0"));
        assertTrue(watch.toggle(id, "k-rL0"));
        env.boot = 8;
        WatchJournal rebooted = new WatchJournal(watchStore, env);
        JSONObject s = rebooted.session(id);
        assertEquals(2, WatchJournal.done(s));
        assertTrue(s.getJSONObject("marks").has("k-rL0") && !s.getJSONObject("marks").has("k-rR0"));
        watch = rebooted;
        assertTrue(watch.toggle(id, "k-rR0"));
        watch.finish(id);
        assertEquals("finished", watch.session(id).getString("state"));
        // Pripojenie: ACK znamená len "uložené na telefóne", nie história.
        assertEquals(1, sync());
        JSONObject staged = watch.session(id);
        assertEquals("staged", WatchJournal.status(staged));
        assertEquals(staged.getLong("nextSeq") - 1, staged.getLong("ackSeq"));
        // Opakovaný kolobeh nič nezduplikuje.
        assertEquals(0, sync());
        JSONArray drained = inbox.drain(config);
        assertEquals(1, drained.length());
        JSONObject record = drained.getJSONObject(0);
        assertEquals("finished", record.getString("status"));
        assertEquals(5, record.getJSONArray("ops").length());   // start, 3 značky, finish
        assertEquals("original-template", record.getJSONObject("template").getString("canonical"));
        // JS zapísal históriu: terminálny výsledok sa smie len pri úplnom ackSeq.
        assertThrows(JournalError.class, () -> inbox.result(config, result(id, "imported", record.getLong("ackSeq") - 1)));
        inbox.result(config, result(id, "imported", record.getLong("ackSeq")));
        assertEquals(0, inbox.drain(config).length());
        // Hodinky sa dozvedia o importe zo snapshot.journal a reláciu uvoľnia až vtedy.
        assertEquals(1, watch.sessions().size());
        assertTrue(watch.phoneStatuses(inbox.snapshotJournal(config)));
        assertEquals(0, watch.sessions().size());
        assertEquals("imported", watch.recent().getJSONObject(0).getString("status"));
        // Oneskorená dávka po importe nevzkriesi históriu: telefón odpovie náhrobkom.
        assertEquals("rejected", lateReplay(id));
    }
    private String lateReplay(String id) throws Exception {
        // Dávka vyrobená pred importom (rovnaké operácie) – simulácia oneskoreného doručenia.
        JSONObject batch = new JSONObject().put("v", 1).put("epoch", EPOCH).put("workspace", WS).put("sessionId", id)
            .put("planId", "plan-1").put("planRev", "rev-1").put("packRev", "pack-1").put("baselineRevision", JSONObject.NULL)
            .put("startedAt", env.now).put("fromSeq", 1).put("ops", new JSONArray().put(new JSONObject().put("opId", new UUID(1, 1).toString())
                .put("seq", 1).put("type", "start").put("at", env.now)));
        JSONObject ack = inbox.accept(config, NODE, batch).ack;
        assertTrue(ack.getString("error").startsWith("retired_"));
        return ack.getString("status");
    }

    @Test public void stagedIsNotImportedAndConflictOrReviewKeepsWork() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0"); watch.finish(id); sync();
        assertEquals("staged", WatchJournal.status(watch.session(id)));
        inbox.result(config, result(id, "conflict", 0));
        watch.phoneStatuses(inbox.snapshotJournal(config));
        assertEquals("conflict", WatchJournal.status(watch.session(id)));
        assertNotNull(watch.session(id));
    }

    @Test public void phoneClosedEarlyKeepsOpenWatchWorkForReview() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0"); sync();
        JSONArray entry = new JSONArray().put(new JSONObject().put("sessionId", id).put("ackSeq", 2).put("status", "imported"));
        watch.phoneStatuses(entry);
        JSONObject s = watch.session(id);
        assertNotNull(s);
        assertEquals("review", WatchJournal.status(s));
        assertEquals("open", s.getString("state"));
    }

    /* ---------- bezpečnosť dávok ---------- */
    @Test public void gapsAreNeverAcceptedAndMismatchedRepeatsAreRejected() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0"); watch.toggle(id, "k-b1");
        JSONObject batch = watch.pendingBatches(null).get(0);
        // Dávka od seq 2 bez štartu = diera.
        JSONObject gapped = new JSONObject(batch.toString());
        JSONArray ops = gapped.getJSONArray("ops"); JSONArray tail = new JSONArray();
        for (int i = 1; i < ops.length(); i++) tail.put(ops.get(i));
        gapped.put("ops", tail).put("fromSeq", 2);
        JSONObject gap = inbox.accept(config, NODE, gapped).ack;
        assertEquals("gap", gap.getString("status"));
        assertEquals(0, gap.getLong("ackSeq"));
        assertEquals(0, inbox.drain(config).length());
        // Správna dávka sa prijme, presná kópia je idempotentná, upravená je odmietnutá bez straty.
        assertEquals("staged", inbox.accept(config, NODE, batch).ack.getString("status"));
        assertEquals("staged", inbox.accept(config, NODE, new JSONObject(batch.toString())).ack.getString("status"));
        JSONObject tampered = new JSONObject(batch.toString());
        tampered.getJSONArray("ops").getJSONObject(1).put("setKey", "k-b1");
        JSONObject bad = inbox.accept(config, NODE, tampered).ack;
        assertEquals("rejected", bad.getString("status"));
        assertEquals("op_mismatch", bad.getString("error"));
        assertEquals(3, inbox.drain(config).getJSONObject(0).getJSONArray("ops").length());
    }

    @Test public void unknownKeysForeignBindingAndHeaderTamperingAreRefused() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0");
        JSONObject batch = watch.pendingBatches(null).get(0);
        JSONObject unknownKey = new JSONObject(batch.toString());
        unknownKey.getJSONArray("ops").getJSONObject(1).put("setKey", "not-in-plan");
        assertEquals("rejected", inbox.accept(config, NODE, unknownKey).ack.getString("status"));
        assertEquals(0, inbox.drain(config).length());           // žiadna čiastočná relácia
        assertNull(inbox.accept(config, "other-node", batch).ack); // cudzí uzol nedostane nič
        JSONObject oldEpoch = new JSONObject(batch.toString()).put("epoch", "old");
        assertNull(inbox.accept(config, NODE, oldEpoch).ack);
        JSONObject wrongPlan = new JSONObject(batch.toString()).put("planRev", "rev-evil");
        assertEquals("unknown_plan", inbox.accept(config, NODE, wrongPlan).ack.getString("error"));
        JSONObject extra = new JSONObject(batch.toString()).put("template", new JSONObject());
        assertNull(inbox.accept(config, NODE, extra).ack);
        assertEquals("staged", inbox.accept(config, NODE, batch).ack.getString("status"));
        JSONObject header = new JSONObject(batch.toString()).put("startedAt", env.now + 5);
        assertEquals("header_mismatch", inbox.accept(config, NODE, header).ack.getString("error"));
    }

    @Test public void ackBeyondWhatWasSentIsRejectedAndChangesNothing() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0");
        JSONObject ack = new JSONObject().put("v", 1).put("epoch", EPOCH).put("workspace", WS).put("sessionId", id)
            .put("ackSeq", 2).put("status", "staged");
        assertThrows(JournalError.class, () -> watch.ack(ack));    // nič nebolo odoslané (highestSent = 0)
        assertEquals(0, watch.session(id).getLong("ackSeq"));
        watch.pendingBatches(null);
        assertTrue(watch.ack(ack));
        assertEquals(2, watch.session(id).getLong("ackSeq"));
    }

    @Test public void inboxBackpressureRefusesFourthSessionWithoutAcking() throws Exception {
        publish(null);
        for (int i = 0; i < 3; i++) {
            String id = watch.startPlan("plan-1");
            watch.toggle(id, "k-b0"); watch.finish(id);
        }
        assertEquals(3, sync());
        assertEquals(3, inbox.drain(config).length());
        assertThrows(JournalError.class, () -> watch.startPlan("plan-1"));      // aj hodinky majú limit 3
        // Priamo vynútený štvrtý z iného zdroja: telefón odmietne s transientným kódom.
        JSONObject fourth = new JSONObject().put("v", 1).put("epoch", EPOCH).put("workspace", WS).put("sessionId", new UUID(9, 9).toString())
            .put("planId", "plan-1").put("planRev", "rev-1").put("packRev", "pack-1").put("baselineRevision", JSONObject.NULL)
            .put("startedAt", env.now).put("fromSeq", 1).put("ops", new JSONArray().put(new JSONObject().put("opId", new UUID(2, 2).toString())
                .put("seq", 1).put("type", "start").put("at", env.now)));
        assertEquals("inbox_full", inbox.accept(config, NODE, fourth).ack.getString("error"));
        assertEquals(3, inbox.drain(config).length());
    }

    /* ---------- úložisko a limity ---------- */
    @Test public void failedWatchWriteNeverChangesVisibleProgressOrDropsPriorWork() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0");
        watchStore.failWrites = true;
        JournalError e = assertThrows(JournalError.class, () -> watch.toggle(id, "k-b1"));
        assertEquals("storage", e.code);
        assertEquals(1, WatchJournal.done(watch.session(id)));
        assertThrows(JournalError.class, () -> watch.finish(id));
        assertEquals("open", watch.session(id).getString("state"));
        watchStore.failWrites = false;
        assertTrue(watch.toggle(id, "k-b1"));
        assertEquals(2, WatchJournal.done(new WatchJournal(watchStore, env).session(id)));
    }

    @Test public void highestSentIsPersistedBeforeSendingAndFailureSendsNothing() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0");
        watchStore.failWrites = true;
        assertThrows(JournalError.class, () -> watch.pendingBatches(null));
        watchStore.failWrites = false;
        List<JSONObject> batches = watch.pendingBatches(null);
        assertEquals(1, batches.size());
        assertEquals(2, new WatchJournal(watchStore, env).session(id).getLong("highestSent"));
    }

    @Test public void phoneStorageFailureNeverAcksAndLeavesNoState() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0");
        JSONObject batch = watch.pendingBatches(null).get(0);
        phoneStore.failWrites = true;
        JSONObject ack = inbox.accept(config, NODE, batch).ack;
        assertEquals("rejected", ack.getString("status"));
        assertEquals("storage_failed", ack.getString("error"));
        phoneStore.failWrites = false;
        assertEquals(0, inbox.drain(config).length());
        // Odmietnutie z dôvodu úložiska je prechodné: hodinky ukážu kontrolu, kým telefón nepotvrdí uloženie.
        watch.ack(ack);
        assertEquals("review", WatchJournal.status(watch.session(id)));
        JSONObject stagedAck = inbox.accept(config, NODE, batch).ack;
        assertEquals("staged", stagedAck.getString("status"));
        watch.ack(stagedAck);
        assertEquals("staged", WatchJournal.status(watch.session(id)));
    }

    @Test public void terminalCapacityIsReservedWhenTheLogFills() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b1");                       // trvalo označený set, takže finish je vždy možný
        JournalError full = null;
        for (int i = 0; i < 700 && full == null; i++) {
            try { watch.toggle(id, "k-b0"); } catch (JournalError e) { full = e; }
        }
        assertNotNull(full);
        assertEquals("journal_full", full.code);
        watch.finish(id);                               // rezerva pre terminálnu operáciu
        assertEquals("finished", watch.session(id).getString("state"));
        assertTrue(watch.sessions().isEmpty() || !"open".equals(watch.session(id).getString("state")));
        assertTrue(watch.session(id) == null || watch.session(id).getJSONArray("ops").length() <= JournalRules.MAX_OPS);
    }

    @Test public void oversizedOrMalformedPacksAreRefusedByBothSides() throws Exception {
        JSONObject tooLong = pack("p", null);
        tooLong.getJSONArray("plans").getJSONObject(0).put("name", "x".repeat(301));
        assertThrows(JournalError.class, () -> inbox.publishPack(config, tooLong, templates(false)));
        JSONObject ttl = pack("p", null).put("expiresAt", env.now + 8L * 24 * 3600 * 1000);
        assertThrows(JournalError.class, () -> inbox.publishPack(config, ttl, templates(false)));
        JSONObject noTemplate = pack("p", null);
        assertEquals("template_missing", assertThrows(JournalError.class, () -> inbox.publishPack(config, noTemplate, new JSONObject())).code);
        JSONObject dupKey = pack("p", null);
        dupKey.getJSONArray("plans").getJSONObject(0).getJSONArray("slots").getJSONObject(0).getJSONArray("sets").getJSONObject(1).put("setKey", "k-b0");
        assertThrows(JournalError.class, () -> inbox.publishPack(config, dupKey, templates(false)));
        assertThrows(JournalError.class, () -> watch.acceptPack(tooLong));
        assertNull(watch.pack());
    }

    @Test public void expiredPackBlocksNewStartsButNeverRecordedWork() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0"); watch.finish(id);
        env.now += 8L * 24 * 3600 * 1000;
        assertFalse(watch.packUsable());
        assertThrows(JournalError.class, () -> watch.startPlan("plan-1"));
        assertEquals("finished", watch.session(id).getString("state"));   // zaznamenaná práca nevyprší
        JSONObject renewed = pack("pack-1", null);
        assertTrue(watch.acceptPack(renewed));                              // rovnaký packRev obnoví TTL
        assertTrue(watch.packUsable());
    }

    /* ---------- pokračovanie tréningu z telefónu ---------- */
    @Test public void phoneSessionContinuesWithExactLegacyIdBaselineAndOnlyMatchingSeed() throws Exception {
        String legacy = "mk3j9x0a7b2";   // pôvodné ID telefónu nie je UUID
        JSONObject seed = new JSONObject().put("sessionId", legacy).put("planId", "plan-1").put("planRev", "rev-1")
            .put("baselineRevision", "base-9").put("startedAt", env.now - 600000).put("plan", plan("plan-1", "rev-1"))
            .put("completedSets", new JSONObject().put("k-b0", true));
        publish(seed);
        String id = watch.continueActive();
        assertEquals(legacy, id);
        assertEquals(1, WatchJournal.done(watch.session(id)));
        assertTrue(watch.toggle(id, "k-b1"));
        assertFalse(watch.toggle(id, "k-b0"));                    // odznačenie základnej značky je operácia unmark
        assertEquals(1, sync());
        JSONObject record = inbox.drain(config).getJSONObject(0);
        assertEquals(legacy, record.getString("sessionId"));
        assertEquals("base-9", record.getString("baselineRevision"));
        assertEquals("active-template", record.getJSONObject("template").getString("canonical"));
        assertEquals("open", record.getString("status"));
        // Seed s iným základom (alebo vymyslené UUID) telefón neprijme.
        JSONObject fake = new JSONObject().put("v", 1).put("epoch", EPOCH).put("workspace", WS).put("sessionId", "legacy-forged")
            .put("planId", "plan-1").put("planRev", "rev-1").put("packRev", "pack-1").put("baselineRevision", "base-9")
            .put("startedAt", env.now - 600000).put("fromSeq", 1).put("ops", new JSONArray().put(new JSONObject()
                .put("opId", new UUID(3, 3).toString()).put("seq", 1).put("type", "start").put("at", env.now)));
        assertEquals("unknown_plan", inbox.accept(config, NODE, fake).ack.getString("error"));
        // Nový štart s ne-UUID ID je odmietnutý (len presný dôveryhodný seed smie niesť pôvodné ID).
        JSONObject freshLegacy = new JSONObject(fake.toString()).put("baselineRevision", JSONObject.NULL);
        assertEquals("unknown_plan", inbox.accept(config, NODE, freshLegacy).ack.getString("error"));
    }

    /* ---------- väzba ---------- */
    @Test public void newEpochOrUnlinkClearsScopedCachesAndInbox() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0"); watch.finish(id); sync();
        assertEquals(1, inbox.drain(config).length());
        watch.bind("epoch-2", WS);
        assertNull(watch.pack());
        assertTrue(watch.sessions().isEmpty());
        JSONObject next = new JSONObject(config.toString()).put("epoch", "epoch-2");
        inbox.ensureScope(next);
        assertEquals(0, inbox.drain(next).length());
        assertNull(inbox.currentPack(next));
        // Odvolanie telefónu zmaže všetko a vypne aj súhlas.
        inbox.ensureScope(new JSONObject(next.toString()).put("enabled", false));
        assertFalse(inbox.offlineGranted(next));
        watch.wipe();
        assertEquals("", watch.epoch());
    }

    @Test public void resultsRequireCurrentBindingAndAppliedSeqWithinDurable() throws Exception {
        publish(null);
        String id = watch.startPlan("plan-1");
        watch.toggle(id, "k-b0"); sync();
        assertThrows(JournalError.class, () -> inbox.result(config, result(id, "active", 99)));
        JSONObject wrong = result(id, "active", 1).put("epoch", "other");
        assertThrows(JournalError.class, () -> inbox.result(config, wrong));
        inbox.result(config, result(id, "active", 2));
        assertEquals("active", inbox.drain(config).getJSONObject(0).getString("resultStatus"));
        assertThrows(JournalError.class, () -> inbox.result(config, result(id, "active", 1)));
        assertThrows(JournalError.class, () -> inbox.result(config, result(id, "imported", 2)));   // ešte nie je dokončená
        watch.toggle(id, "k-b1"); sync();
        assertThrows(JournalError.class, () -> inbox.result(config, result(id, "discarded", 2)));  // medzitým pribudla práca
        inbox.result(config, result(id, "discarded", 3));
        assertEquals(0, inbox.drain(config).length());
        inbox.result(config, result(id, "discarded", 3));   // opakovanie po strate odpovede je idempotentné
    }
}
