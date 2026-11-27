'use strict';
/* Run by wear-bridge.js in real Chrome. GymWear and Community network boundaries below are
   explicitly disposable doubles, NOT proof of Android persistence, RLS or real phone/watch pairing.
   Canonical phone state, history, XP, localStorage, consent and review UI are the actual app. */
module.exports = async function ({ ev, check, reload, flush, link, waitFor }) {
  const install = () => ev(`(() => {
    window.offlineFixture = {
      record(active = false, finished = true) {
        const published = wearTest.pack, pack = published.pack;
        const plan = active ? pack.active.plan : pack.plans.find(p => p.planId === 'wear-offline-test');
        const template = published.templates[active ? 'active' : plan.planRev];
        const now = Date.now(), sessionId = active ? pack.active.sessionId : crypto.randomUUID();
        const record = { epoch: pack.epoch, workspace: pack.workspace, sessionId,
          planId: plan.planId, planRev: plan.planRev, packRev: pack.packRev,
          baselineRevision: active ? pack.active.baselineRevision : null,
          startedAt: active ? pack.active.startedAt : now - 60000,
          status: finished ? 'finished' : 'open', ackSeq: 0, template: wearCopy(template), ops: [] };
        this.add(record, 'start');
        this.add(record, 'mark', template.rows[0].keys[0].key);
        if (finished) this.add(record, 'finish');
        return record;
      },
      add(record, type, setKey) {
        record.ops.push({ opId: crypto.randomUUID(), seq: record.ops.length + 1, type,
          at: Date.now(), ...(setKey ? { setKey } : {}) });
        record.ackSeq = record.ops.length;
        record.status = type === 'finish' ? 'finished' : type === 'discard' ? 'discarded' : 'open';
      },
      async consume(record) { wearTest.stage(record); await wearResume(wearPlugin); },
      async publish() { wearPackContent = ''; await wearPublishNow(true); },
      disk() { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
    };
    return true;
  })()`);
  await install();
  check('offline and Messages grants default OFF and cannot change while linked', await ev(`!wearBinding.grants.offline && !wearBinding.grants.messages && document.getElementById('wear-offline').disabled && document.getElementById('wear-messages').disabled && wearTest.pack === null`));
  await ev(`(async () => { await wearRevoke(); document.getElementById('wear-offline').checked = true;
    state.activeSession = null; stopTimer(); state.program = null;
    state.plans['wear-offline-test'] = { id: 'wear-offline-test', customName: 'Recorded original', exercises: [
      { id: 'cx-offline', name: 'Twin row', sets: 2, reps: 8, weight: 20, unilateral: true },
      { id: 'cx-offline', name: 'Twin row', sets: 2, reps: 10, weight: 30, unilateral: true }
    ] }; state.planOrder.push('wear-offline-test'); saveState(); return true; })()`);
  await link(); await flush();
  check('opt-in publishes bounded seven-day plans and phone-only canonical templates', await ev(`(() => {
    const p = wearTest.pack; return !!p && p.pack.expiresAt - p.pack.createdAt === 7 * 86400000
      && new TextEncoder().encode(JSON.stringify(p.pack)).length <= 90000 && p.templates
      && !JSON.stringify(p.pack).includes('planFingerprint') && p.pack.active === null;
  })()`));
  check('duplicate rows and left/right sets have eight distinct opaque exact keys', await ev(`(() => {
    const p = wearTest.pack.pack.plans.find(p => p.planId === 'wear-offline-test');
    const keys = p.slots.flatMap(s => s.sets.flatMap(x => [x.setKeys.L, x.setKeys.R]));
    return p.slots.length === 2 && keys.length === 8 && new Set(keys).size === 8 && keys.every(k => /^[a-f0-9]{64}$/.test(k));
  })()`));
  await ev(`(async () => { window.packBefore = wearTest.pack.pack.packRev; await offlineFixture.publish(); return true; })()`);
  check('unchanged content has stable revisions when TTL is renewed', await ev(`packBefore === wearTest.pack.pack.packRev`));
  await ev(`(async () => {
    state.plans['wear-too-large'] = { id: 'wear-too-large', customName: 'Too many exact keys', exercises: [
      { id: 'cx-large', name: 'Large row', sets: 99, reps: 8, weight: 10, unilateral: true },
      { id: 'cx-large', name: 'Large row', sets: 99, reps: 8, weight: 20, unilateral: true }
    ] }; state.planOrder.push('wear-too-large'); await offlineFixture.publish(); return true;
  })()`);
  check('oversized plan is omitted WHOLE with an explicit truncated flag, never shortened sets', await ev(`wearTest.pack.pack.truncated === true && !wearTest.pack.pack.plans.some(p => p.planId === 'wear-too-large') && wearTest.pack.pack.plans.some(p => p.planId === 'wear-offline-test')`));
  await ev(`(async () => { delete state.plans['wear-too-large']; state.planOrder = state.planOrder.filter(id => id !== 'wear-too-large'); await offlineFixture.publish(); return true; })()`);
  await ev(`(async () => { window.noMessageGrant = await wearTest.send(wearTest.receipt('messageReply', { conversationId: '22222222-2222-4222-8222-222222222222', body: 'not allowed' })); return true; })()`);
  check('offline consent alone does not grant Messages', await ev(`noMessageGrant.result.status === 'stale' && noMessageGrant.result.error === 'grant_required'`));

  await ev(`(async () => { window.provisional = offlineFixture.record(false, false); await offlineFixture.consume(provisional); return true; })()`);
  check('offline new start remains provisional, visible and durable without replacing phone state', await ev(`getSession() === null && wearTest.journals.some(r => r.sessionId === provisional.sessionId && r.resultStatus === 'staged') && document.getElementById('wear-review').textContent.includes(t('wear.staged')) && !state.history.some(w => w.id === provisional.sessionId)`));
  await ev(`(async () => { offlineFixture.add(provisional, 'mark', provisional.template.rows[1].keys[1].key); offlineFixture.add(provisional, 'finish');
    selectedPlan = activePlanIds().find(id => id !== 'wear-offline-test'); ensureSession(getPlan(selectedPlan));
    window.unrelated = JSON.stringify(getSession()); saveState(); await offlineFixture.consume(provisional); return true; })()`);
  check('finished import preserves unrelated active session in memory AND durable canonical write', await ev(`JSON.stringify(getSession()) === unrelated && JSON.stringify(offlineFixture.disk().activeSession) === unrelated && state.history.filter(w => w.id === provisional.sessionId).length === 1`));
  check('canonical history keeps both original duplicate rows and independent side marks', await ev(`(() => { const w = state.history.find(w => w.id === provisional.sessionId); return w.exercises.length === 2 && w.exercises[0].sidesDone.left.join() === '1' && w.exercises[0].sidesDone.right.length === 0 && w.exercises[1].sidesDone.right.join() === '1' && w.exercises[1].sidesDone.left.length === 0 && w.exercises[1].weight === 30; })()`));
  await ev(`(window.xpBeforeReplay = totalXP(), window.historyBeforeReplay = JSON.stringify(state.history), true)`);
  await ev(`(async () => { await offlineFixture.consume(provisional); return true; })()`);
  check('same UUID replay returns duplicate with exactly one history entry and no second XP', await ev(`totalXP() === xpBeforeReplay && JSON.stringify(state.history) === historyBeforeReplay && wearTest.results.slice(-1)[0].status === 'duplicate'`));

  await ev(`(async () => { await offlineFixture.publish(); window.changed = offlineFixture.record(); state.plans['wear-offline-test'].exercises[0].weight = 99; saveState(); await offlineFixture.consume(changed); return true; })()`);
  check('intervening plan change creates retained native conflict, never silent remapping', await ev(`wearTest.journals.some(r => r.sessionId === changed.sessionId && r.resultStatus === 'conflict') && !state.history.some(w => w.id === changed.sessionId) && document.getElementById('wear-review').textContent.includes(t('wear.conflict'))`));
  await reload(); await install();
  check('conflict and localized Review survive a real page reload', await ev(`wearPendingRecords.size > 0 && document.getElementById('wear-review').querySelectorAll('button').length === 2`));
  for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
    await ev(`(setLang(${JSON.stringify(lang)}), renderWearSetting(), true)`);
    check(lang + ': actual Review, permissions and privacy copy are localized', await ev(`(() => {
      const labels = [...document.querySelectorAll('#wear-setting [data-i18n]')];
      const review = document.getElementById('wear-review');
      return labels.every(e => e.textContent.trim() && !e.textContent.startsWith('wear.'))
        && review.textContent.includes(t('wear.conflict')) && review.querySelector('button').textContent === t('wear.recorded')
        && !review.textContent.includes('wear.');
    })()`));
  }
  await ev(`(setLang('en'), true)`);
  await ev(`(() => { window.changed = wearTest.journals.find(r => r.resultStatus === 'conflict'); document.querySelector('#wear-review button').click(); return true; })()`);
  check('Import as recorded requires the real confirmation UI', await ev(`!document.getElementById('modal-generic').hidden && !state.history.some(w => w.id === changed.sessionId)`));
  await ev(`(document.getElementById('btn-generic-ok').click(), true)`);
  await waitFor(() => ev(`state.history.some(w => w.id === changed.sessionId)`), 3000, 'review import');
  check('review imports ORIGINAL entire template, preserving edited plan and unrelated workout', await ev(`(() => { const w = state.history.find(w => w.id === changed.sessionId); return w.exercises.length === 2 && w.exercises[0].weight === 20 && state.plans['wear-offline-test'].exercises[0].weight === 99 && getSession() && getSession().planId !== 'wear-offline-test'; })()`));

  await ev(`(async () => { await offlineFixture.publish(); window.deleted = offlineFixture.record(); delete state.plans['wear-offline-test']; saveState(); await offlineFixture.consume(deleted); return true; })()`);
  check('deleted plan also retains original data for review', await ev(`wearTest.journals.some(r => r.sessionId === deleted.sessionId && r.resultStatus === 'conflict') && !state.history.some(w => w.id === deleted.sessionId)`));
  await ev(`(() => { const bs = document.querySelectorAll('#wear-review button'); bs[bs.length - 1].click(); return true; })()`);
  check('Discard asks for confirmation before changing the durable queue', await ev(`!document.getElementById('modal-generic').hidden && wearTest.journals.some(r => r.sessionId === deleted.sessionId)`));
  await ev(`(document.getElementById('btn-generic-ok').click(), true)`);
  await waitFor(() => ev(`wearTest.journals.length === 0`), 3000, 'confirmed discard');
  check('confirmed discard retires only that recording, adds no history', await ev(`!state.history.some(w => w.id === deleted.sessionId) && wearTest.results.slice(-1)[0].status === 'discarded'`));

  await ev(`(async () => { state.activeSession = null; state.plans['wear-offline-test'] = wearCopy(deleted.template.plan); saveState(); await offlineFixture.publish();
    window.failedRecord = offlineFixture.record(); window.beforeFailure = JSON.stringify([state.history, state.achievements, state.goalHistory, state.settings.exerciseMemory, state.activeSession]);
    sessionStorage.setItem('gq_test_lsfail', JSON.stringify([STORAGE_KEY])); await offlineFixture.consume(failedRecord); return true; })()`);
  check('failed canonical storage rolls back history, achievements, goal, memory, session and retains native journal', await ev(`JSON.stringify([state.history, state.achievements, state.goalHistory, state.settings.exerciseMemory, state.activeSession]) === beforeFailure && wearTest.journals.some(r => r.sessionId === failedRecord.sessionId) && !wearTest.results.some(r => r.sessionId === failedRecord.sessionId && r.status === 'imported')`));
  await ev(`(async () => { sessionStorage.removeItem('gq_test_lsfail'); await wearResume(wearPlugin); return true; })()`);
  check('retained journal imports successfully once storage recovers', await ev(`state.history.filter(w => w.id === failedRecord.sessionId).length === 1 && wearTest.results.slice(-1)[0].status === 'imported'`));
  await ev(`(async () => { await offlineFixture.publish(); window.lostResult = offlineFixture.record(); wearTest.failResult = true; await offlineFixture.consume(lostResult); window.afterLostXP = totalXP(); wearTest.failResult = false; await wearResume(wearPlugin); return true; })()`);
  check('crash window after canonical save before native result is UUID-deduplicated', await ev(`state.history.filter(w => w.id === lostResult.sessionId).length === 1 && totalXP() === afterLostXP && wearTest.results.slice(-1)[0].status === 'duplicate'`));
  await ev(`(async () => {
    selectedPlan = 'wear-offline-test'; ensureSession(getPlan(selectedPlan)); saveState(); await offlineFixture.publish();
    window.cleanupRecord = offlineFixture.record(true, true);
    window.cleanupPhoneBefore = JSON.stringify(getSession()); window.cleanupWriteAttempts = 0;
    window.cleanupStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === STORAGE_KEY) {
        const next = JSON.parse(value);
        if (next.activeSession === null && next.history.some(w => w.id === cleanupRecord.sessionId)) {
          cleanupWriteAttempts++; throw new DOMException('Disposable cleanup-write failure', 'QuotaExceededError');
        }
      }
      return cleanupStorageWrite.call(this, key, value);
    };
    window.cleanupFailureWrite = Storage.prototype.setItem;
    await offlineFixture.consume(cleanupRecord); window.cleanupXP = totalXP(); return true;
  })()`);
  check('cleanup write failure AFTER canonical save retains active session and inbox without terminal success', await ev(`cleanupWriteAttempts >= 1 && state.history.filter(w => w.id === cleanupRecord.sessionId).length === 1 && offlineFixture.disk().history.filter(w => w.id === cleanupRecord.sessionId).length === 1 && JSON.stringify(getSession()) === cleanupPhoneBefore && JSON.stringify(offlineFixture.disk().activeSession) === cleanupPhoneBefore && wearTest.journals.some(r => r.sessionId === cleanupRecord.sessionId) && !wearTest.results.some(r => r.sessionId === cleanupRecord.sessionId && ['imported', 'duplicate'].includes(r.status))`));
  await ev(`(async () => { Storage.prototype.setItem = cleanupStorageWrite; await wearResume(wearPlugin); return true; })()`);
  check('cleanup retry durably clears only the finished session and UUID-deduplicates history and XP once', await ev(`getSession() === null && offlineFixture.disk().activeSession === null && state.history.filter(w => w.id === cleanupRecord.sessionId).length === 1 && totalXP() === cleanupXP && !wearTest.journals.some(r => r.sessionId === cleanupRecord.sessionId) && wearTest.results.slice(-1)[0].status === 'duplicate'`));
  await ev(`(async () => {
    selectedPlan = 'wear-offline-test'; ensureSession(getPlan(selectedPlan)); saveState(); await offlineFixture.publish();
    window.cleanupRecord = offlineFixture.record(true, true);
    Storage.prototype.setItem = cleanupFailureWrite; await offlineFixture.consume(cleanupRecord);
    Storage.prototype.setItem = cleanupStorageWrite;
    getSession().setReps = { [cleanupRecord.template.rows[0].keys[0].local]: 15 }; saveState();
    window.newerCleanupPhone = JSON.stringify(getSession()); window.newerCleanupXP = totalXP();
    await wearResume(wearPlugin); return true;
  })()`);
  check('UUID replay after cleanup failure preserves newer matching phone edits as a durable conflict', await ev(`JSON.stringify(getSession()) === newerCleanupPhone && JSON.stringify(offlineFixture.disk().activeSession) === newerCleanupPhone && state.history.filter(w => w.id === cleanupRecord.sessionId).length === 1 && totalXP() === newerCleanupXP && wearTest.journals.some(r => r.sessionId === cleanupRecord.sessionId && r.resultStatus === 'conflict') && !wearTest.results.some(r => r.sessionId === cleanupRecord.sessionId && ['imported', 'duplicate'].includes(r.status))`));
  await ev(`(async () => { await wearResolveReview(cleanupRecord.sessionId, true); state.activeSession = null; saveState(); return true; })()`);

  await ev(`(async () => { selectedPlan = 'wear-offline-test'; ensureSession(getPlan(selectedPlan)); saveState(); await offlineFixture.publish(); window.continuation = offlineFixture.record(true, false); window.seedId = getSession().id; await offlineFixture.consume(continuation); return true; })()`);
  check('active seed retains exact phone UUID and partial journal updates only that session', await ev(`getSession().id === seedId && getSession().completedSets[continuation.template.rows[0].keys[0].local] === true && offlineFixture.disk().activeSession.id === seedId && wearTest.results.slice(-1)[0].status === 'active'`));
  await reload(); await install();
  check('partial replay after reload keeps session and durable reconciliation marker', await ev(`getSession().wearJournal && wearTest.results.slice(-1)[0].status === 'active' && wearTest.journals.length === 1`));
  await ev(`(async () => { window.continuation = wearCopy(wearTest.journals[0]); getSession().setReps = { [continuation.template.rows[0].keys[0].local]: 12 }; saveState(); window.editedPhone = JSON.stringify(getSession()); offlineFixture.add(continuation, 'mark', continuation.template.rows[1].keys[0].key); await offlineFixture.consume(continuation); return true; })()`);
  check('intervening phone edit conflicts durably without overwriting newer active values', await ev(`JSON.stringify(getSession()) === editedPhone && wearTest.journals[0].resultStatus === 'conflict' && wearTest.results.slice(-1)[0].status === 'conflict'`));
  await ev(`(async () => { window.beforeOpenDiscardResults = wearTest.results.length; await wearResolveReview(continuation.sessionId, true); return true; })()`);
  check('open Review discard is disabled AND direct resolution refuses to tombstone a live watch prefix', await ev(`document.querySelectorAll('#wear-review button').length === 2 && [...document.querySelectorAll('#wear-review button')].every(b => b.disabled) && wearTest.results.length === beforeOpenDiscardResults && wearTest.journals.some(r => r.sessionId === continuation.sessionId && r.status === 'open') && JSON.stringify(getSession()) === editedPhone`));
  await ev(`(async () => { offlineFixture.add(continuation, 'discard'); await offlineFixture.consume(continuation); await offlineFixture.publish(); window.badKey = offlineFixture.record(false, true); badKey.ops[1].setKey = 'unknown-key'; await offlineFixture.consume(badKey); return true; })()`);
  check('unknown exact set key is retained as conflict, never silently dropped', await ev(`!state.history.some(w => w.id === badKey.sessionId) && wearTest.journals[0].resultStatus === 'conflict'`));
  await ev(`(async () => { await wearResolveReview(badKey.sessionId, true); window.staleBinding = offlineFixture.record(); staleBinding.epoch = crypto.randomUUID(); const before = JSON.stringify(state); await wearConsumeRecord(wearPlugin, staleBinding, false); return before === JSON.stringify(state); })()`).then(ok => check('revoked epoch cannot import or touch canonical state', ok));
  await ev(`(async () => { window.gapRecord = offlineFixture.record(); gapRecord.ops[1].seq = 4; await offlineFixture.consume(gapRecord); return true; })()`);
  check('journal sequence gap never commits a partial or silently shortened workout', await ev(`!state.history.some(w => w.id === gapRecord.sessionId) && wearTest.journals.some(r => r.sessionId === gapRecord.sessionId && r.resultStatus === 'conflict')`));
  await ev(`(async () => { await wearResolveReview(gapRecord.sessionId, true); return true; })()`);

  /* Community boundary double; no account signup, real backend or network insertion. */
  await ev(`(async () => { await wearRevoke(); state.activeSession = null; saveState();
    window.messageOriginalOwner = wsSlot.owner; window.messageOriginalOpt = state.settings.communityOptIn;
    window.messageOriginalClient = communityClientRef; window.messageOriginalConfig = window.GYMQUEST_COMMUNITY;
    window.messageOriginalProfile = communityProfile;
    window.messageBoundary = { uid: '11111111-1111-4111-8111-111111111111', cid: '22222222-2222-4222-8222-222222222222',
      inserts: [], allow: true, fail: false, hold: false, release: null,
      rows() { return [{ conversation_id: this.cid, other_name: 'Disposable network double', last_body: 'MEMORY_PREVIEW_SECRET', unread: 1, last_message_at: new Date().toISOString(), can_send: this.allow }]; } };
    wsSlot.owner = messageBoundary.uid; wsRegistry.slots[wsSlot.id].owner = messageBoundary.uid; wsSaveRegistry(wsRegistry);
    communityProfile = { id: messageBoundary.uid }; state.settings.communityOptIn = true;
    window.GYMQUEST_COMMUNITY = { supabaseUrl: 'http://localhost:59999', supabaseAnonKey: 'disposable-boundary-double' };
    communityClientRef = { auth: { getSession: async () => ({ data: { session: { user: { id: messageBoundary.uid } } } }) },
      async rpc(name) { if (name !== 'chat_list') return { data: null }; if (messageBoundary.hold) { messageBoundary.hold = false; await new Promise(r => { messageBoundary.release = r; }); } return { data: messageBoundary.rows() }; },
      from(table) { if (table !== 'messages') throw new Error('unexpected_boundary_table'); return { insert(row) { messageBoundary.inserts.push(wearCopy(row)); return { select() { return { async single() { if (messageBoundary.fail) throw new Error('server text must never persist'); return { data: { ...row, id: 123, created_at: new Date().toISOString() } }; } }; } }; } }; }
    };
    document.getElementById('wear-messages').checked = true; return true;
  })()`);
  await link();
  await ev(`(async () => { await wearPublishNow(true); return true; })()`);
  check('explicit current-account grant publishes small memory-only inbox previews', await ev(`wearTest.snapshots.slice(-1)[0].messages[0]?.last === 'MEMORY_PREVIEW_SECRET' && !Object.values(localStorage).join('').includes('MEMORY_PREVIEW_SECRET') && !Object.values(sessionStorage).join('').includes('MEMORY_PREVIEW_SECRET')`));
  await ev(`(async () => { window.reply = wearTest.receipt('messageReply', { conversationId: messageBoundary.cid, body: 'REPLY_PRIVATE_BODY' }); window.replyAck = await wearTest.send(reply); await wearTest.send(reply); return true; })()`);
  check('online reply makes exactly one real send-helper insertion attempt, redacts disk and duplicate results', await ev(`replyAck.result.status === 'applied' && messageBoundary.inserts.length === 1 && !localStorage.getItem(WEAR_JOURNAL_KEY).includes('REPLY_PRIVATE_BODY') && !localStorage.getItem(WEAR_JOURNAL_KEY).includes(messageBoundary.cid) && !JSON.stringify(wearTest.acks).includes('REPLY_PRIVATE_BODY')`));
  await ev(`(async () => { messageBoundary.fail = true; window.unknownReply = wearTest.receipt('messageReply', { conversationId: messageBoundary.cid, body: 'UNKNOWN_PRIVATE_BODY' }); window.unknownAck = await wearTest.send(unknownReply); await wearTest.send(unknownReply); messageBoundary.fail = false; return true; })()`);
  check('unknown delivery never retries and exposes only a fixed error code', await ev(`unknownAck.result.status === 'unknown' && unknownAck.result.error === 'delivery_unknown' && messageBoundary.inserts.length === 2 && !localStorage.getItem(WEAR_JOURNAL_KEY).includes('UNKNOWN_PRIVATE_BODY') && !localStorage.getItem(WEAR_JOURNAL_KEY).includes('server text')`));
  await ev(`(async () => { messageBoundary.allow = false; window.denied = await wearTest.send(wearTest.receipt('messageReply', { conversationId: messageBoundary.cid, body: 'denied' })); messageBoundary.allow = true; return true; })()`);
  check('fresh Community can_send false blocks insertion', await ev(`denied.result.status === 'rejected' && denied.result.error === 'conversation_unavailable' && messageBoundary.inserts.length === 2`));
  await ev(`(async () => { window.tooLong = await wearTest.send(wearTest.receipt('messageReply', { conversationId: messageBoundary.cid, body: 'x'.repeat(281) })); return true; })()`);
  check('reply limit rejects more than 280 characters before any send', await ev(`tooLong.result.error === 'invalid_message' && messageBoundary.inserts.length === 2`));
  await ev(`(async () => { sessionStorage.setItem('gq_test_lsfail', JSON.stringify([WEAR_JOURNAL_KEY])); window.claimFailed = await wearTest.send(wearTest.receipt('messageReply', { conversationId: messageBoundary.cid, body: 'claim failure' })); sessionStorage.removeItem('gq_test_lsfail'); return true; })()`);
  check('durable redacted claim failure prevents all message inserts', await ev(`claimFailed.result.status === 'unknown' && messageBoundary.inserts.length === 2`));
  await flush();
  await ev(`(() => { messageBoundary.hold = true; window.heldReply = wearTest.send(wearTest.receipt('messageReply', { conversationId: messageBoundary.cid, body: 'held private reply' })); return true; })()`);
  await waitFor(() => ev(`!!messageBoundary.release`), 2000, 'message permission read held');
  check('redacted pending claim is durable BEFORE server permission await', await ev(`wearJournal().slice(-1)[0].state === 'pending' && !JSON.stringify(wearJournal()).includes('held private reply') && !JSON.stringify(wearJournal()).includes(messageBoundary.cid)`));
  await ev(`(async () => { const reg = wearRead(WS_REGISTRY_KEY, null); reg.slots[wsSlot.id].owner = 'other-owner'; wsSaveRegistry(reg); messageBoundary.hold = false; messageBoundary.release(); window.heldReplyAck = await heldReply; return true; })()`);
  check('account ownership change during await prevents insertion', await ev(`heldReplyAck.result.status !== 'applied' && messageBoundary.inserts.length === 2`));
  await ev(`(async () => { await wearRevoke(); wsSlot.owner = messageOriginalOwner; wsRegistry.slots[wsSlot.id].owner = messageOriginalOwner; wsSaveRegistry(wsRegistry);
    state.settings.communityOptIn = messageOriginalOpt; communityClientRef = messageOriginalClient; communityProfile = messageOriginalProfile; window.GYMQUEST_COMMUNITY = messageOriginalConfig;
    saveState(); document.getElementById('wear-messages').checked = false; return true; })()`);
  await link();
  check('relink restores OFF defaults and old message access cannot survive ownership reset', await ev(`!wearBinding.grants.messages && !wearBinding.grants.offline && wearTest.pack === null && wearTest.snapshots.slice(-1)[0].messages.length === 0`));
};
