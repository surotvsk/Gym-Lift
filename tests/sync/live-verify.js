/* Live end-to-end verification of automatic account sync through the normal GymQuest UI.
   ONE disposable account (GQ_CREDS_DIR/cred-c.json, id listed in GQ_TEST_IDS); "devices" are separate,
   fresh Chrome profiles. Changes are made by clicking/typing in the app (plan editor, workout set
   buttons, Finish, measurement form, real file inputs for photos/media, Settings switches). The
   suite NEVER calls the app's sync functions: it waits for the app's own automatic triggers
   (change debounce, reconnect, focus) and checks the account's Supabase row and Storage objects
   with the account's own RLS-scoped session. Usage:
     $env:GQ_BASE = 'https://surotvsk.github.io/Gymquest/'   # or omit for the local build
     node tests/sync/live-verify.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, Observer, loadCreds, readPublicConfig, waitFor } = require('./lib');
const HELPERS = require('./helpers');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = process.env.GQ_BASE || 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-sync-work');
const PROFILES = path.join(WORK, 'profiles');
const PHOTO = path.join(REPO, 'media', 'push-up-1.jpg');
const MEDIA = path.join(REPO, 'media', 'cable-curl-1.jpg');
let nextPort = 9760;
const checks = [];
function check(name, cond, detail) {
  checks.push({ name, ok: !!cond });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (cond || detail === undefined ? '' : '  -> ' + String(JSON.stringify(detail)).slice(0, 700)));
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browsers = [];

async function R(p) { await p.ready(); await p.eval(HELPERS); }
async function device(name) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  await p.navigate(BASE);
  await p.eval(HELPERS);
  return { b, p };
}
async function relaunch(d, opts) {
  opts = opts || {};
  if (opts.offline) await d.p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 120000);
  d.p = await d.b.restart(true);
  if (opts.offline) await d.p.offline(true);
  await d.p.navigate(BASE); await d.p.eval(HELPERS);
}
const ui = (p, js) => p.eval(`(async () => { const $ = (s) => document.querySelector(s); const $$ = (s) => Array.from(document.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms) => { const end = Date.now() + (ms || 15000); while (Date.now() < end) { if (f()) return true; await wait(100); } throw new Error('ui wait timeout'); };
  const type = (el, v) => { el.focus(); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  ${js} })()`, 120000);
const local = (p) => p.eval(`(() => { const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); return s; })()`);
const lines = (p) => p.eval(`(() => { renderCloudBackupSetting(); return { local: document.getElementById('sync-local-line').textContent, cloud: document.getElementById('sync-cloud-line').textContent, key: syncStatusKey() }; })()`);
async function setupAndSignIn(d, creds) {
  await ui(d.p, `const ok = $('#btn-setup-ok'); if (ok && !$('#modal-setup').hidden) ok.click(); return true;`);
  /* Community is opt-in per device (Settings switch); then the normal sign-in form. */
  await ui(d.p, `state.settings.communityOptIn = true; persistState(); communityOpen(); await until(() => $('#community-email'));
    type($('#community-email'), ${JSON.stringify(creds.email)}); type($('#community-password'), ${JSON.stringify(creds.password)}); return true;`);
  try { await ui(d.p, `$('[data-community-action="signin"]').click(); await wait(5000); return true;`); }
  catch (e) { /* the app reloads into the account workspace */ }
  await R(d.p);
  const owner = await d.p.eval('wsSlot && wsSlot.owner');
  if (owner !== creds.id) throw new Error('UI sign-in did not bind the account workspace (owner=' + owner + ')');
  await ui(d.p, `const m = $('#modal-community'); if (m && !m.hidden) { const c = $('#modal-community .modal-close, #btn-community-close'); if (c) c.click(); else m.hidden = true; } return true;`);
}
/* Plan editor: open the selected plan, change exercise 1 (sets/weight), optionally move the plan, Save. */
async function editPlan(p, opts) {
  return ui(p, `$('.tab[data-tab="trening"]').click(); await wait(200);
    ${opts.planId ? `$('.chip-wrap[data-plan-id="${opts.planId}"] .chip').click(); await wait(200);` : ''}
    $('#btn-plan-rename').click(); await until(() => !$('#edit-panel').hidden && $('.edit-row'));
    const nums = $$('.edit-row[data-idx="0"] .edit-num');
    ${opts.sets ? `type(nums[0], ${opts.sets});` : ''}
    ${opts.weight !== undefined ? `type(nums[2], ${opts.weight});` : ''}
    ${opts.moveRight ? `$('#btn-plan-right').click(); await wait(200);` : ''}
    const id = editingPlan;
    $('#btn-edit-save').click(); await wait(300);
    return { id, order: state.planOrder.slice(), ex: state.plans[id].exercises[0] };`);
}
/* Workout: Start on Today, tick `n` set buttons, Finish → confirm. */
async function doWorkout(p, n, finish) {
  return ui(p, `$('.tab[data-tab="dnes"]').click(); await wait(150); $('#btn-start-workout').click(); await wait(400);
    const btns = $$('#exercise-list .set-btn:not([disabled])'); for (let i = 0; i < ${n}; i++) { btns[i].click(); await wait(120); }
    ${finish ? `$('#btn-finish-workout').click(); await until(() => !$('#modal-confirm').hidden); $('#btn-confirm-ok').click(); await wait(800);
    for (const id of ['modal-generic', 'modal-levelup', 'modal-achievement']) { const m = document.getElementById(id); if (m && !m.hidden) { const b = m.querySelector('.btn-primary'); if (b) b.click(); } }` : ''}
    return { hist: state.history.length, active: !!state.activeSession, plan: selectedPlan };`);
}
async function addMeasurementUI(p, kg) {
  return ui(p, `$('.tab[data-tab="pokrok"]').click(); await wait(200); $('#btn-add-measure').click(); await until(() => !$('#modal-measure').hidden && $('#m-weightKg'));
    type($('#m-weightKg'), ${kg}); $('#btn-measure-save').click(); await wait(300); return state.measurements.length;`);
}
async function setFile(p, selector, file) {
  const { root } = await p.c.send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await p.c.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await p.c.send('DOM.setFileInputFiles', { nodeId, files: [file] });
}
async function addPhotoUI(p) {
  await ui(p, `$('.tab[data-tab="pokrok"]').click(); await wait(200); return true;`);
  await setFile(p, '#file-progress-photos', PHOTO);
  return ui(p, `await until(() => !$('#modal-photo-add').hidden, 20000); $('#btn-photo-add-save').click();
    await until(() => progressMeta.length > 0, 20000); return progressMeta.length;`);
}
async function addPersonalMediaUI(p, exKey) {
  await ui(p, `openExerciseSheet(${JSON.stringify(exKey)}); await wait(300); return true;`);
  await setFile(p, '#file-media', MEDIA);
  return ui(p, `await until(() => personalMediaFor(${JSON.stringify(exKey)}).length > 0, 20000); closeExerciseSheet(); return personalMediaFor(${JSON.stringify(exKey)}).length;`);
}
async function cloudWait(obs, pred, ms, label) {
  const end = Date.now() + (ms || 45000);
  let row = null;
  while (Date.now() < end) { row = await obs.row(); if (row && pred(row)) return { ok: true, row, waited: ms - (end - Date.now()) }; await sleep(1500); }
  return { ok: false, row, label };
}
const hist = (row) => ((row && row.payload && row.payload.history) || []);
/* Key-order-independent equality; returns the differing paths (empty = identical). */
function diff(a, b, at, out) {
  out = out || []; at = at || '';
  if (a === b) return out;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) { out.push(at + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); return out; }
  for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) diff(a[k], b[k], at + '.' + k, out);
  return out;
}
const ex0 = (row, id) => row && row.payload && row.payload.plans && row.payload.plans[id] && row.payload.plans[id].exercises[0];

(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  const server = process.env.GQ_BASE ? null : await startServer(PORT, { new: REPO });
  const cfg = readPublicConfig(REPO);
  const C = loadCreds('c');
  const obs = await new Observer(cfg, C).login();
  try {
    await obs.reset();   // this disposable account's synthetic backup data only
    console.log('\n== 1. plan/exercise change: saved locally, synced automatically while online');
    const d1 = await device('d1');
    await setupAndSignIn(d1, C);
    const s0 = await d1.p.eval('__gq.snap()');
    check('signed in: account workspace active, sync on by default (not "off")', s0.owner === C.id && s0.status !== 'sync.st.off', { owner: s0.owner, st: s0.status });
    check('empty account + fresh device: nothing uploaded', (await obs.row()) === null);
    const e1 = await editPlan(d1.p, { sets: 4, weight: 62.5, moveRight: true });
    const l1 = await local(d1.p);
    check('saved on this device immediately (localStorage has the edit and the new plan order)', l1.plans[e1.id].exercises[0].weight === 62.5 && l1.plans[e1.id].exercises[0].sets === 4 && JSON.stringify(l1.planOrder) === JSON.stringify(e1.order), { ex: l1.plans[e1.id].exercises[0], order: l1.planOrder });
    const ln1 = await lines(d1.p);
    check('"Saved on this device" and the account line are separate', ln1.local.length > 0 && ln1.cloud.length > 0 && ln1.local !== ln1.cloud, ln1);
    let w = await cloudWait(obs, (r) => { const x = ex0(r, e1.id); return x && x.weight === 62.5 && x.sets === 4; }, 45000);
    check('synced to Supabase automatically (no Sync now): weight, sets and plan order', w.ok && JSON.stringify(w.row.payload.planOrder) === JSON.stringify(e1.order), { ok: w.ok, order: w.row && w.row.payload.planOrder });
    if (w.ok) console.log('    (cloud updated ~' + Math.round(w.waited / 1000) + ' s after Save)');
    check('UI then reports "synced"', (await lines(d1.p)).key === 'sync.st.synced', await lines(d1.p));

    console.log('\n== 2. completed workout + measurement + photo + personal media: saved locally, synced automatically');
    const wk = await doWorkout(d1.p, 2, true);
    const l2 = await local(d1.p);
    check('workout saved on the device (history entry, sets done, no running session)', l2.history.length === 1 && l2.history[0].exercises.some((x) => x.setsDone === 2) && !l2.activeSession, { n: l2.history.length, wk });
    await addMeasurementUI(d1.p, 81.5);
    await addPhotoUI(d1.p);
    await addPersonalMediaUI(d1.p, 'cable-curl');
    const sMedia = await d1.p.eval('__gq.snap()');
    w = await cloudWait(obs, (r) => hist(r).length === 1 && (r.payload.measurements || []).length === 1
      && ((r.payload.media || {}).progress || []).length === 1 && ((r.payload.media || {}).personal || []).length === 1, 60000);
    const h0 = w.row && hist(w.row)[0];
    check('cloud has the completed workout automatically, identical to the device record (date/calendar, plan, sets done, sets, reps, weight)',
      w.ok && h0 && h0.date && diff(h0, l2.history[0]).length === 0 && h0.exercises.some((x) => x.setsDone === 2), h0 && diff(h0, l2.history[0]));
    check('cloud has achievements/motivation, goal and the measurement', w.ok && Object.keys(w.row.payload.achievements || {}).length > 0 && w.row.payload.settings && w.row.payload.settings.weeklyGoal > 0 && w.row.payload.measurements[0].weightKg === 81.5, w.row && { ach: Object.keys(w.row.payload.achievements || {}).length, m: w.row.payload.measurements });
    const files = await obs.listAll(C.id);
    const refs = []; const mm = (w.row && w.row.payload.media) || {};
    for (const e of [].concat(mm.progress || [], mm.personal || [])) { if (e.ref) refs.push(e.ref); if (e.thumbRef) refs.push(e.thumbRef); }
    check('photo and personal media objects exist in Storage for every manifest reference', refs.length >= 2 && refs.every((r) => files.indexOf(C.id + '/' + r) >= 0), { refs, files: files.length });
    check('cloud payload never contains a running workout/activity', !('activeSession' in (w.row ? w.row.payload : {})) && !('activeActivity' in (w.row ? w.row.payload : {})));
    const revAfter2 = w.row && w.row.revision;

    console.log('\n== 3. offline edits survive a full browser restart');
    await d1.p.offline(true);
    await sleep(500);
    const e3 = await editPlan(d1.p, { weight: 65 });
    await doWorkout(d1.p, 3, true);
    const ln3 = await lines(d1.p);
    check('offline: saved on device, account line says offline/pending (not synced)', ln3.key === 'sync.st.offlinePending' && ln3.local !== ln3.cloud, ln3);
    await relaunch(d1, { offline: true });
    const l3 = await local(d1.p);
    const s3 = await d1.p.eval('__gq.snap()');
    check('after full restart (offline): both edits still there and still pending', l3.plans[e3.id].exercises[0].weight === 65 && l3.history.length === 2 && s3.dirty === true, { w: l3.plans[e3.id].exercises[0].weight, h: l3.history.length, dirty: s3.dirty });
    check('cloud untouched while offline', (await obs.row()).revision === revAfter2);

    console.log('\n== 4. reconnect: pending offline changes sync automatically');
    await d1.p.offline(false);
    const online = await d1.p.eval('navigator.onLine');
    w = await cloudWait(obs, (r) => hist(r).length === 2 && ex0(r, e3.id).weight === 65, 30000);
    let how = 'browser online event';
    if (!w.ok) {
      /* Headless network emulation may not deliver the 'online' event; deliver the same event the browser sends. */
      how = 'online event delivered by the test (navigator.onLine=' + online + ')';
      await d1.p.eval(`window.dispatchEvent(new Event('online')), true`);
      w = await cloudWait(obs, (r) => hist(r).length === 2 && ex0(r, e3.id).weight === 65, 30000);
    }
    check('after reconnect the offline workout and plan edit reached the account (' + how + ')', w.ok, w.row && { h: hist(w.row).length });
    check('no conflict, status synced', (await d1.p.eval('__gq.snap()')).status === 'sync.st.synced');
    const rev4 = w.row && w.row.revision;

    console.log('\n== 5. fresh second device loads everything automatically after online sign-in');
    const d2 = await device('d2');
    await setupAndSignIn(d2, C);
    const l5 = await local(d2.p);
    const s5 = await d2.p.eval('__gq.snap()');
    check('device 2: plans (exercise settings + order) loaded', l5.plans[e3.id].exercises[0].weight === 65 && l5.plans[e3.id].exercises[0].sets === 4 && JSON.stringify(l5.planOrder) === JSON.stringify(e1.order), { ex: l5.plans[e3.id].exercises[0], order: l5.planOrder });
    check('device 2: workouts/calendar, measurement, achievements loaded', l5.history.length === 2 && l5.measurements.length === 1 && Object.keys(l5.achievements || {}).length === Object.keys((await obs.row()).payload.achievements || {}).length, { h: l5.history.length, m: l5.measurements.length });
    check('device 2: progress photo and personal media byte-identical', s5.media && Object.keys(s5.media).length === 2 && Object.keys(sMedia.media).every((k) => s5.media[k] === sMedia.media[k]), { d1: sMedia.media, d2: s5.media });
    check('device 2: synced, no conflict, loading did not upload', s5.status === 'sync.st.synced' && !s5.meta.conflict && (await obs.row()).revision === rev4, { st: s5.status, rev: (await obs.row()).revision, rev4 });

    console.log('\n== 6. empty/default state never overwrites populated cloud data');
    try {
      await ui(d2.p, `$('#btn-settings').click(); await wait(200); $('#btn-reset-data').click(); await until(() => !$('#modal-generic').hidden);
        $('#btn-generic-ok').click(); await wait(300); await until(() => !$('#modal-generic').hidden); $('#btn-generic-ok').click(); await wait(3000); return true;`);
    } catch (e) { /* reset reloads the page */ }
    await R(d2.p);
    const r6 = await obs.row();
    const l6 = await local(d2.p);
    check('"Reset data" on device 2 did not upload an empty state (revision and history unchanged)', r6.revision === rev4 && hist(r6).length === 2, { rev: r6.revision, h: hist(r6).length });
    check('device 2 re-loaded the account instead', l6 && l6.history.length === 2, l6 && l6.history.length);

    console.log('\n== 7. pending local changes are not silently overwritten by a cloud pull');
    await d1.p.offline(true);
    await sleep(500);
    const e7 = await editPlan(d1.p, { weight: 70 });
    await doWorkout(d2.p, 1, true);
    w = await cloudWait(obs, (r) => hist(r).length === 3, 45000);
    check('device 2 workout synced automatically (cloud newer)', w.ok);
    const rev7 = w.row && w.row.revision;
    await d1.p.offline(false);
    await d1.p.eval(`window.dispatchEvent(new Event('online')), true`);
    await waitFor(() => d1.p.eval(`!!syncMetaRead().conflict`).catch(() => false), 45000, 'conflict').catch(() => null);
    const l7 = await local(d1.p);
    const s7 = await d1.p.eval('__gq.snap()');
    check('device 1 keeps its pending edit (weight 70) and gets an explicit choice, not a silent pull', l7.plans[e7.id].exercises[0].weight === 70 && !!s7.meta.conflict && s7.syncModal && l7.history.length === 2, { w: l7.plans[e7.id].exercises[0].weight, conflict: s7.meta.conflict, modal: s7.syncModal, h: l7.history.length });
    check('cloud not overwritten by device 1 either', (await obs.row()).revision === rev7 && hist(await obs.row()).length === 3);
    await ui(d1.p, `const b = $('[data-sync-action="keep-cloud"]'); b.click(); await wait(300);
      const ok = $('#btn-generic-ok'); if (ok && !$('#modal-generic').hidden) ok.click(); await wait(2500); return true;`).catch(() => null);
    await R(d1.p);
    const s7b = await d1.p.eval('__gq.snap()');
    check('after choosing "Keep account": device 1 has the account data and a recovery copy of its own version', s7b.hist.length === 3 && !s7b.meta.conflict && s7b.recovery.some((r) => r.kind === 'device-copy'), { h: s7b.hist.length, rec: s7b.recovery });

    console.log('\n== 8. a running workout is not interrupted by a cross-device pull; synced after completion');
    const run = await doWorkout(d1.p, 1, false);
    const before = await d1.p.eval(`({ s: JSON.stringify(state.activeSession), started: state.activeSession && state.activeSession.startedAt, done: totalSetsDone(), plan: selectedPlan })`);
    check('workout running on device 1 (1 set ticked)', run.active && before.done === 1, before);
    const e8 = await editPlan(d2.p, { sets: 5, planId: before.plan });   // device 2 edits the very plan running on device 1
    check('device 2 edited the plan that is running on device 1', e8.id === before.plan, { e8: e8.id, running: before.plan });
    w = await cloudWait(obs, (r) => ex0(r, e8.id).sets === 5, 45000);
    check('device 2 change synced', w.ok);
    const loadsBefore = d1.p.loads;
    let pulled = false;
    for (let i = 0; i < 4 && !pulled; i++) {
      await sleep(11000);   // focus trigger is throttled to once per 10 s
      await d1.p.eval(`window.dispatchEvent(new Event('focus')), true`);
      pulled = await waitFor(() => d1.p.eval(`state.plans[${JSON.stringify(e8.id)}].exercises[0].sets === 5`).catch(() => false), 15000, 'pull').then(() => true).catch(() => false);
    }
    const after = await d1.p.eval(`({ s: JSON.stringify(state.activeSession), started: state.activeSession && state.activeSession.startedAt, done: totalSetsDone(), plan: selectedPlan,
      doneBtns: document.querySelectorAll('#exercise-list .set-btn.done').length, modal: !document.getElementById('modal-sync').hidden })`);
    check('device 1 pulled device 2\'s change automatically (on returning to the app)', pulled);
    check('running workout untouched: same session, start time, ticked set, still on screen, no reload/dialog', after.s === before.s && after.started === before.started && after.done === 1 && after.doneBtns === 1 && !after.modal && d1.p.loads === loadsBefore, { before, after, reloads: d1.p.loads - loadsBefore });
    check('the running workout was not uploaded to the account', !('activeSession' in (await obs.row()).payload));
    await ui(d1.p, `const btns = $$('#exercise-list .set-btn:not([disabled]):not(.done)'); btns[0].click(); await wait(150);
      $('#btn-finish-workout').click(); await until(() => !$('#modal-confirm').hidden); $('#btn-confirm-ok').click(); await wait(800); return true;`);
    w = await cloudWait(obs, (r) => hist(r).length === 4, 45000);
    const l8 = await local(d1.p);
    const mine = l8.history[l8.history.length - 1];
    const last = w.row && hist(w.row).find((h) => h.id === mine.id);
    check('after Finish the workout synced automatically, identical to the device record (2 sets done, the plan now has 5 sets)',
      w.ok && !!last && diff(last, mine).length === 0 && last.planId === before.plan && last.exercises[0].setsDone === 2 && last.exercises[0].sets === 5, last ? diff(last, mine) : null);

    /* Device 2 catches up on returning to the app (focus), before its sync is switched off. */
    let caught = false;
    for (let i = 0; i < 4 && !caught; i++) {
      await sleep(11000);
      await d2.p.eval(`window.dispatchEvent(new Event('focus')), true`);
      caught = await waitFor(() => d2.p.eval(`state.history.length === 4`).catch(() => false), 15000, 'd2 pull').then(() => true).catch(() => false);
    }
    check('device 2 received device 1\'s finished workout automatically', caught);

    console.log('\n== 9. sync switched off: shown clearly, local saving continues');
    await ui(d2.p, `$('#btn-settings').click(); await wait(200); $('#btn-cloud-backup').click(); await wait(300); return true;`);
    const ln9 = await lines(d2.p);
    const st9 = await ui(d2.p, `return { sw: $('#btn-cloud-backup').getAttribute('aria-checked'), state: $('#cloud-state').textContent };`);
    check('Settings shows sync off (switch, state text, account line) and the separate local line', ln9.key === 'sync.st.off' && st9.sw === 'false' && ln9.local !== ln9.cloud, { ln9, st9 });
    await ui(d2.p, `$('#modal-settings .btn-secondary[data-i18n="common.close"], #btn-settings-close') && ($('#btn-settings-close') || $('#modal-settings .btn-secondary[data-i18n="common.close"]')).click(); return true;`).catch(() => null);
    const rev9 = (await obs.row()).revision;
    const e9 = await editPlan(d2.p, { weight: 75 });
    await sleep(12000);
    check('with sync off: change saved on the device, nothing uploaded', (await local(d2.p)).plans[e9.id].exercises[0].weight === 75 && (await obs.row()).revision === rev9);
    await ui(d2.p, `$('#btn-settings').click(); await wait(200); $('#btn-cloud-backup').click(); await wait(300); return true;`);
    w = await cloudWait(obs, (r) => ex0(r, e9.id).weight === 75, 45000);
    check('switching sync back on uploads the pending change automatically', w.ok);
    check('no page exceptions on either device', d1.p.errors.length === 0 && d2.p.errors.length === 0, d1.p.errors.concat(d2.p.errors));
  } catch (e) {
    check('scenario error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  }
  while (browsers.length) { const b = browsers.pop(); try { await b.closeGraceful(); } catch (e) { b.killHard(true); } }
  /* After the browsers are closed (no device can upload again): leave the permanent account clean, as run.js does. */
  try { await obs.reset(); } catch (e) { console.log('  WARN final reset failed: ' + String(e && e.message || e)); }
  if (server) await server.close();
  const pass = checks.filter((c) => c.ok).length, fail = checks.length - pass;
  fs.writeFileSync(path.join(WORK, 'live-verify-results.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, pass, fail, checks }, null, 2));
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
