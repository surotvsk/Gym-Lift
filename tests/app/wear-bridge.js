'use strict';
/* GymLift — phone Wear bridge consumer correctness, real headless Chrome, disposable profile.
   node tests/app/wear-bridge.js
   No accounts or real native transport. The GymWear boundary double implements the published
   interface; all workout, timer, persistence, rendering and workspace code is the actual app.
   Native monotonic receipt validation, actual pairing and watch rendering require device proof.
   Coverage: explicit peer consent, coherent private snapshots, calendar without a session,
   post-validation ownership/identity/deadline gates, absolute timer effects, durable original
   outcomes, interrupted pending fail-closed, storage failures, six languages and workspace revoke.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT || 8137);
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-wear-bridge');
const J = JSON.stringify;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (!ok && detail !== undefined ? ' -> ' + J(detail) : ''));
}
const NATIVE = `(() => {
  const copy = v => JSON.parse(JSON.stringify(v));
  const handlers = {};
  const test = window.wearTest = {
    active: false, nodes: [{ id: 'watch-left', name: 'Left watch' }, { id: 'watch-right', name: 'Right watch' }],
    snapshots: [], acks: [], queue: [], hold: false, validations: 0, validateOK: true, failConfigure: false,
    pack: JSON.parse(sessionStorage.getItem('wear_native_pack') || 'null'),
    journals: JSON.parse(sessionStorage.getItem('wear_native_inbox') || '[]'), results: [], failResult: false,
    storeInbox() { sessionStorage.setItem('wear_native_inbox', JSON.stringify(this.journals)); },
    stage(record) {
      this.journals = this.journals.filter(r => r.sessionId !== record.sessionId); this.journals.push(copy(record));
      this.storeInbox();
    },
    activate() { this.active = true; },
    emit(name, payload) { for (const fn of handlers[name] || []) fn(copy(payload)); },
    release() { const open = this.open; this.open = null; this.hold = false; if (open) open(); },
    receipt(type, args = {}) {
      const b = JSON.parse(localStorage.getItem('gymquest_wear_binding'));
      const s = getSession(), r = wearRestSnapshot(), now = Date.now();
      return { nodeId: b.peer, deadlineAt: now + 10000, command: { v: 1, id: crypto.randomUUID(),
        epoch: b.epoch, workspace: b.workspace, sessionId: s ? s.id : null,
        restId: r ? r.id : null, type, args, issuedAt: now, expiresAt: now + 10000 } };
    },
    async send(receipt) {
      this.emit('wearCommand', receipt);
      await wearCommandQueue;
      return copy(this.acks.filter(a => a.id === receipt.command.id).slice(-1)[0]);
    }
  };
  const plugin = {
    async status() { return { nodes: copy(test.nodes), configuration: JSON.parse(sessionStorage.getItem('wear_native_configuration') || 'null') }; },
    async configure({ configuration }) {
      if (test.failConfigure) throw new Error('configure_failed');
      if (configuration.enabled && !test.nodes.some(n => n.id === configuration.peer)) throw new Error('no_peer');
      sessionStorage.setItem('wear_native_configuration', JSON.stringify(configuration));
      test.queue = [];
      if (!configuration.enabled) {
        test.pack = null; test.journals = []; test.storeInbox(); sessionStorage.removeItem('wear_native_pack');
      }
      return {};
    },
    async publish({ snapshot }) {
      const config = JSON.parse(sessionStorage.getItem('wear_native_configuration') || 'null');
      if (!config || !config.enabled || snapshot.binding.epoch !== config.epoch || snapshot.binding.peer !== config.peer) throw new Error('wrong_binding');
      test.snapshots.push(copy(snapshot)); return {};
    },
    async publishPack(value) {
      test.pack = copy(value); sessionStorage.setItem('wear_native_pack', JSON.stringify(value)); return {};
    },
    async journalResult(result) {
      if (test.failResult) throw new Error('test_result_failure');
      const record = test.journals.find(r => r.sessionId === result.sessionId);
      if (!record || result.epoch !== record.epoch || result.workspace !== record.workspace) throw new Error('test_binding');
      if (result.appliedSeq !== record.ackSeq) throw new Error('test_sequence');
      record.resultStatus = result.status; record.appliedSeq = result.appliedSeq;
      test.results.push(copy(result));
      if (['imported', 'duplicate', 'discarded'].includes(result.status)) test.journals = test.journals.filter(r => r !== record);
      test.storeInbox(); return {};
    },
    async drain() {
      const commands = test.queue; test.queue = [];
      return { commands: copy(commands), journals: copy(test.journals) };
    },
    async validate() {
      test.validations++;
      if (test.hold) await new Promise(resolve => { test.open = resolve; });
      return { valid: test.validateOK };
    },
    async ack({ nodeId, id, result }) { test.acks.push({ nodeId, id, result: copy(result) }); return {}; },
    async addListener(name, callback) { (handlers[name] || (handlers[name] = [])).push(callback); return { remove() {} }; }
  };
  window.Capacitor = { isNativePlatform: () => test.active, Plugins: { GymWear: plugin } };
})();`;

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const cfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(cfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = cfg;
  const { startServer, Browser, waitFor } = require('../sync/lib');
  const server = await startServer(PORT, { new: REPO });
  const browser = new Browser('wear-' + Date.now().toString(36), 10114, path.join(WORK, 'profiles'));
  try {
    const p = await browser.launch();
    await p.c.send('Page.addScriptToEvaluateOnNewDocument', { source: NATIVE });
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.navigate(BASE);
    const ev = code => p.eval(code);
    const activate = () => ev(`(async () => { wearTest.activate(); await initWearBridge(); return true; })()`);
    const reload = async () => { await p.reload(); await activate(); };
    const link = async () => {
      await ev(`(async () => {
        await wearRefreshStatus(wearPlugin);
        document.getElementById('wear-peer').value = 'watch-right';
        document.getElementById('wear-consent').checked = true;
        document.getElementById('wear-peer').dispatchEvent(new Event('change'));
        document.getElementById('wear-link').click();
        return true;
      })()`);
      await waitFor(() => ev(`!!wearBinding && !wearBusy`), 3000, 'explicit consent linked');
      await wait(160);
    };
    const send = (type, args) => ev(`wearTest.send(wearTest.receipt(${J(type)}, ${J(args || {})}))`);
    const flush = () => ev(`(async () => { await new Promise(r => setTimeout(r, 160)); await wearNativeQueue; return true; })()`);
    const beginHeld = async (type, ttl = 10000) => {
      await ev(`(() => { wearTest.hold = true; wearTest.heldReceipt = wearTest.receipt(${J(type)}, { seconds: 15 }); wearTest.heldReceipt.command.expiresAt = Date.now() + ${ttl}; wearTest.heldReceipt.deadlineAt = wearTest.heldReceipt.command.expiresAt; wearTest.heldTask = wearTest.send(wearTest.heldReceipt); return true; })()`);
      await waitFor(() => ev(`!!wearTest.open`), 2000, 'native validation held');
    };
    const releaseHeld = () => ev(`(async () => { wearTest.release(); return await wearTest.heldTask; })()`);

    await ev(`(async () => { await initWearBridge(); await wearRevoke(); return true; })()`);
    check('browser has no watch section or watch storage', await ev(`document.getElementById('wear-setting').hidden && localStorage.getItem('gymquest_wear_binding') === null && localStorage.getItem('gymquest_wear_journal') === null`));
    await ev(`(() => { for (const m of document.querySelectorAll('.modal-backdrop')) m.hidden = true; setLang('en'); state.history = []; state.activeSession = null; state.activeActivity = null; saveState(); return true; })()`);
    await activate();
    check('native availability alone never consents', await ev(`!wearBinding && !document.getElementById('wear-setting').hidden && document.getElementById('wear-link').disabled && wearTest.snapshots.length === 0`));
    await ev(`(() => { document.getElementById('wear-peer').value = 'watch-right'; document.getElementById('wear-peer').dispatchEvent(new Event('change')); return true; })()`);
    check('selecting a real peer still requires explicit consent', await ev(`document.getElementById('wear-link').disabled && !wearBinding`));
    await link();
    const first = await ev(`wearTest.snapshots.slice(-1)[0]`);
    check('one coherent snapshot targets the selected node with opaque workspace and freshness', first && first.binding.peer === 'watch-right' && first.binding.enabled && first.binding.workspace !== 'legacy' && first.seq > 0 && first.expiresAt - first.createdAt === 60000 && first.language === 'en' && first.session === null && first.rest === null && Array.isArray(first.plans) && Array.isArray(first.calendar), first);
    check('wire binding never includes local owner identity', await ev(`(() => { const b = wearTest.snapshots.slice(-1)[0].binding; return Object.keys(b).sort().join(',') === 'enabled,epoch,label,peer,workspace' && !Object.prototype.hasOwnProperty.call(state, 'wearBinding'); })()`));

    await ev(`(() => { const id = activePlanIds()[0]; state.history.push({ id: 'wear-history', date: todayISO(), planId: id, planName: recordedPlanName(getPlan(id)), exercises: [] }); saveState(); return true; })()`);
    await flush();
    check('persisted calendar updates with no active session and no invented planned dates', await ev(`(() => { const s = wearTest.snapshots.slice(-1)[0]; return s.session === null && s.calendar.some(d => d.date === todayISO() && d.status === 'completed') && s.calendar.every(d => d.status === 'completed'); })()`));
    const count = await ev(`wearTest.snapshots.length`);
    await ev(`(persistState(), persistState(), persistState(), true)`); await flush();
    check('unchanged persists do not republish content', (await ev(`wearTest.snapshots.length`)) === count);
    await ev(`wearPublishNow(true)`);
    check('heartbeat refreshes TTL and sequence without changing content', await ev(`(() => { const a = wearTest.snapshots.slice(-2); return a.length === 2 && a[1].seq > a[0].seq && a[1].expiresAt >= a[0].expiresAt && JSON.stringify(a[0].calendar) === JSON.stringify(a[1].calendar); })()`));

    await ev(`(() => { wearTest.workoutReceipt = wearTest.receipt('startWorkout', { planId: activePlanIds()[0] }); return true; })()`);
    const workoutAck = await ev(`wearTest.send(wearTest.workoutReceipt)`);
    check('remote workout uses command identity and is durably visible in the workout UI', workoutAck.result.status === 'applied' && await ev(`(() => { const s = getSession(), disk = JSON.parse(localStorage.getItem(STORAGE_KEY)).activeSession; return s.id === wearTest.workoutReceipt.command.id && disk.id === s.id && activeTab === 'trening' && !!document.querySelector('#exercise-list .exercise'); })()`), workoutAck);
    await ev(`(sessionStorage.setItem('wear_original_workout', JSON.stringify({ receipt: wearTest.workoutReceipt, ack: wearTest.acks.slice(-1)[0] })), true)`);
    await reload();
    check('session and link survive reload without new consent on the same owner', await ev(`!!wearBinding && getSession().id === JSON.parse(sessionStorage.getItem('wear_original_workout')).receipt.command.id`));
    const duplicate = await ev(`wearTest.send(JSON.parse(sessionStorage.getItem('wear_original_workout')).receipt)`);
    check('durable duplicate returns the exact original result, not another workout', await ev(`JSON.stringify(${J(duplicate.result)}) === JSON.stringify(JSON.parse(sessionStorage.getItem('wear_original_workout')).ack.result) && getSession().startedAt === JSON.parse(localStorage.getItem(STORAGE_KEY)).activeSession.startedAt`), duplicate);

    const restAck = await send('restStart', { seconds: 90 });
    const rest = await ev(`({ id: timerPersistentId, endAt: timerEnd })`);
    check('remote rest start persists command-controlled identity and absolute deadline', restAck.result.status === 'applied' && rest.id === restAck.id && await ev(`(() => { const d = JSON.parse(localStorage.getItem(REST_TIMER_KEY)); return d.id === timerPersistentId && d.endAt === timerEnd; })()`), restAck);
    await ev(`(pauseRestTimer(), true)`);
    const paused = await ev(`({ id: timerPersistentId, left: timerPausedLeft })`);
    await reload();
    check('paused timer identity and remaining duration survive refresh', await ev(`timerPersistentId === ${J(paused.id)} && timerPausedLeft === ${paused.left} && !document.getElementById('timer-bar').hidden`));
    await ev(`(resumeRestTimer(), true)`);
    check('resume retains the persisted identity', (await ev(`timerPersistentId`)) === paused.id);
    await ev(`(() => { wearTest.addReceipt = wearTest.receipt('restAdd', { seconds: 15 }); wearTest.beforeAdd = timerEnd; return true; })()`);
    const add = await ev(`wearTest.send(wearTest.addReceipt)`);
    check('restAdd produces the absolute expected end time', add.result.status === 'applied' && await ev(`timerEnd === wearTest.beforeAdd + 15000`), add);
    const afterAdd = await ev(`timerEnd`);
    const repeatedAdd = await ev(`wearTest.send(wearTest.addReceipt)`);
    check('duplicate add returns original result without incrementing again', J(repeatedAdd.result) === J(add.result) && (await ev(`timerEnd`)) === afterAdd, repeatedAdd);
    await ev(`(wearTest.validateOK = false, true)`);
    const invalidNative = await send('restAdd', { seconds: 15 });
    check('native validation rejection never reaches timer effects', invalidNative.result.status === 'stale' && (await ev(`timerEnd`)) === afterAdd, invalidNative);
    await ev(`(wearTest.validateOK = true, true)`);
    const badDeadline = await ev(`(() => { const r = wearTest.receipt('restAdd', { seconds: 15 }); r.deadlineAt = Date.now() - 1; return wearTest.send(r); })()`);
    check('native receipt deadline is rechecked independently of envelope expiry', badDeadline.result.status === 'stale' && (await ev(`timerEnd`)) === afterAdd, badDeadline);
    const otherPeer = await ev(`(() => { const r = wearTest.receipt('restAdd', { seconds: 15 }); r.nodeId = 'watch-left'; return wearTest.send(r); })()`);
    check('another paired node cannot control the approved peer link', otherPeer.result.status === 'stale' && (await ev(`timerEnd`)) === afterAdd, otherPeer);
    await ev(`(async () => { const r = wearTest.receipt('restAdd', { seconds: 15 }); r.command.issuedAt -= 11000; r.command.expiresAt -= 11000; r.deadlineAt = r.command.expiresAt; wearTest.queue.push(r); await wearResume(wearPlugin); return true; })()`);
    check('foreground drain never renews an expired queued command', (await ev(`timerEnd`)) === afterAdd && await ev(`wearTest.acks.slice(-1)[0].result.status === 'stale'`));

    await beginHeld('restAdd');
    await ev(`(startTimer(120, null, true), true)`);
    const replacedEnd = await ev(`timerEnd`);
    const replaced = await releaseHeld();
    check('timer replacement during native validation rejects the old rest identity', replaced.result.status === 'stale' && (await ev(`timerEnd`)) === replacedEnd, replaced);
    await beginHeld('restAdd', 100);
    await wait(150);
    const expired = await releaseHeld();
    check('expiry during native validation never renews the ten-second request', expired.result.status === 'stale' && (await ev(`timerEnd`)) === replacedEnd, expired);
    await beginHeld('restAdd');
    await ev(`(() => { const reg = JSON.parse(localStorage.getItem(WS_REGISTRY_KEY)); reg.slots[wsSlot.id].owner = 'different-local-owner'; localStorage.setItem(WS_REGISTRY_KEY, JSON.stringify(reg)); return true; })()`);
    const wrongOwner = await releaseHeld();
    check('owner change on disk during validation fails closed', wrongOwner.result.status === 'stale' && (await ev(`timerEnd`)) === replacedEnd, wrongOwner);
    await ev(`(wsSaveRegistry(wsRegistry), true)`);
    await beginHeld('restAdd');
    await ev(`(appYielded = true, true)`);
    const yielded = await releaseHeld();
    check('yield during native validation cannot affect the timer', yielded.result.status === 'stale' && (await ev(`timerEnd`)) === replacedEnd, yielded);
    await ev(`(appYielded = false, true)`);

    await ev(`(() => { wearTest.pending = wearTest.receipt('restAdd', { seconds: 15 }); timerEnd += 15000; persistRestTimer(true); wearJournalPut({ key: wearCommandKey(wearTest.pending.nodeId, wearTest.pending.command), state: 'pending', intent: { id: timerPersistentId, endAt: timerEnd, pausedLeftMs: null } }); sessionStorage.setItem('wear_pending', JSON.stringify({ receipt: wearTest.pending, endAt: timerEnd })); return true; })()`);
    await reload();
    const interrupted = await ev(`wearTest.send(JSON.parse(sessionStorage.getItem('wear_pending')).receipt)`);
    check('crash after effects but before final journal never blindly reapplies', interrupted.result.status === 'unknown' && await ev(`timerEnd === JSON.parse(sessionStorage.getItem('wear_pending')).endAt`), interrupted);
    const interruptedAgain = await ev(`wearTest.send(JSON.parse(sessionStorage.getItem('wear_pending')).receipt)`);
    check('interrupted pending has a stable original unknown result', J(interruptedAgain.result) === J(interrupted.result), interruptedAgain);

    await ev(`(sessionStorage.setItem('gq_test_lsfail', JSON.stringify([REST_TIMER_KEY])), true)`);
    const unsaved = await send('restAdd', { seconds: 15 });
    check('unknown timer persistence never acknowledges applied', unsaved.result.status === 'unknown', unsaved);
    const afterUnsaved = await ev(`timerEnd`);
    await ev(`(sessionStorage.removeItem('gq_test_lsfail'), true)`);
    check('retry of an unknown outcome does not mutate again', await ev(`(async () => { const j = wearJournal().slice(-1)[0]; const before = timerEnd; const r = wearTest.receipt('restAdd', { seconds: 15 }); r.command.id = j.result.id; const a = await wearTest.send(r); return a.result.status === 'unknown' && timerEnd === before; })()`) && (await ev(`timerEnd`)) === afterUnsaved);
    await ev(`(sessionStorage.setItem('gq_test_lsfail', JSON.stringify([WEAR_JOURNAL_KEY])), true)`);
    const journalFailed = await send('restAdd', { seconds: 15 });
    check('pending journal failure prevents all effects', journalFailed.result.status === 'unknown' && (await ev(`timerEnd`)) === afterUnsaved, journalFailed);
    await ev(`(sessionStorage.removeItem('gq_test_lsfail'), true)`);

    const stopped = await send('restStop');
    check('remote stop durably clears the phone rest timer', stopped.result.status === 'applied' && await ev(`timerInterval === null && localStorage.getItem(REST_TIMER_KEY) === null && document.getElementById('timer-bar').hidden`), stopped);
    await ev(`(() => { getSession().phaseTimer = { status: 'running', phase: 'warmup' }; return true; })()`);
    const phaseConflict = await send('restStart', { seconds: 30 });
    check('active workout phase rejects restStart without async confirmation or false success', phaseConflict.result.status === 'rejected' && await ev(`timerInterval === null && document.getElementById('modal-confirm').hidden && getSession().phaseTimer.status === 'running'`), phaseConflict);
    await ev(`(delete getSession().phaseTimer, true)`);
    await send('restStart', { seconds: 60 });
    await ev(`(timerEnd = Date.now() - 1, finishRestTimer(timerSessionId, false), true)`); await flush();
    check('completion publishes a done rest snapshot outside the tick loop', await ev(`(() => { const r = wearTest.snapshots.slice(-1)[0].rest; return r && r.done && timerInterval === null && document.getElementById('timer-bar').classList.contains('done'); })()`));

    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await ev(`(setLang(${J(lang)}), openSettings(), true)`); await flush();
      check(lang + ': translated watch setting and fresh snapshot language', await ev(`(() => { const b = document.getElementById('wear-setting'), labels = [...b.querySelectorAll('[data-i18n]')]; return !b.hidden && labels.every(e => e.textContent.trim() && !e.textContent.startsWith('wear.')) && wearTest.snapshots.slice(-1)[0].language === ${J(lang)} && b.scrollWidth <= b.clientWidth + 1; })()`));
    }
    for (const theme of ['light', 'dark']) {
      await ev(`(setThemePref(${J(theme)}), true)`);
      check(theme + ': watch controls remain visible without horizontal overflow', await ev(`(() => { const b = document.getElementById('wear-setting'), s = getComputedStyle(document.getElementById('wear-peer')); return b.getBoundingClientRect().width > 0 && b.scrollWidth <= b.clientWidth + 1 && s.color !== s.backgroundColor; })()`));
    }
    await require('./wear-offline')({ ev, check, reload, flush, link, waitFor });

    const oldEpoch = await ev(`wearBinding.epoch`);
    await ev(`(async () => { const c = await wearPlugin.status(); c.configuration.enabled = false; sessionStorage.setItem('wear_native_configuration', JSON.stringify(c.configuration)); wearTest.emit('wearUnlinked', { nodeId: c.configuration.peer, epoch: c.configuration.epoch }); return true; })()`);
    await waitFor(() => ev(`wearBinding === null`), 2000, 'watch unlink revoked');
    check('watch unlink clears local authority', await ev(`wearRead(WEAR_BINDING_KEY, null).enabled === false`));
    await link();
    check('new consent creates a new generation', (await ev(`wearBinding.epoch`)) !== oldEpoch);
    await ev(`(() => { wearTest.failConfigure = true; const p = wearRevoke().then(() => false, () => true); wearTest.revokeTask = p; return true; })()`);
    check('revocation is synchronous even when native persistence fails', await ev(`wearBinding === null && !wearRead(WEAR_BINDING_KEY, null).enabled`));
    check('failed native revoke rejects rather than permitting an unconfirmed reload', await ev(`wearTest.revokeTask`));
    await ev(`(wearTest.failConfigure = false, true)`); await link();

    await ev(`(() => { const id = wsNewId('g'); wsRegistry.slots[id] = Object.assign({ id, owner: null, created: Date.now() }, wsSlotFields(id)); wsSaveRegistry(wsRegistry); window.__GQ_TEST__.arm('ws:beforeReload'); wearTest.switchTask = wsSwitchTo(id); return true; })()`);
    check('workspace switch revokes synchronously before any reload', await ev(`wearBinding === null && wearRead(WEAR_BINDING_KEY, null).enabled === false`));
    await ev(`window.__GQ_TEST__['_r_ws:beforeReload']`);
    check('native disabled configuration is durable before workspace reload', await ev(`(async () => !(await wearPlugin.status()).configuration.enabled)()`));
    await ev(`(window.__GQ_TEST__['_o_ws:beforeReload'](), true)`);
    await waitFor(() => p.ready(3000).then(() => true).catch(() => false), 5000, 'new workspace ready');
    await activate();
    check('another workspace never inherits watch consent', await ev(`!wearBinding && !wearRead(WEAR_BINDING_KEY, null).enabled && wearTest.snapshots.length === 0`));
    await link();
    await ev(`(() => { window.__GQ_TEST__.arm('tab:yield'); wearTest.yieldTask = appYield(); return true; })()`);
    check('appYield revokes immediately before quiescing or releasing the lock', await ev(`wearBinding === null && !wearRead(WEAR_BINDING_KEY, null).enabled`));
    check('no unhandled browser exceptions', p.errors.length === 0, p.errors);
  } catch (e) {
    check('no exception', false, String(e && e.stack || e));
  } finally {
    browser.killHard(true);
    await server.close();
    console.log(`\n==== checks: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  }
})();
