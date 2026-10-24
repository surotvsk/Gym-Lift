/* GymQuest — upgrade from the previous release to the Bento redesign keeps every piece of data.
   LOCAL stack only, disposable test accounts only (GQ_CREDS_DIR cred-a / cred-b, GQ_TEST_IDS).

     node tests/sync/bento-upgrade.js [scenario-filter]

   The previous release (default: `git archive HEAD`, or GQ_OLD_ROOT / GQ_OLD_REF) is installed in a real
   headless Chrome profile and filled with synthetic data; the SAME profile and origin is then updated
   through its service worker to this build (and, for the rollback check, to a "revert" release: the
   previous code under a newer cache version). Before/after comparisons use the stored values
   themselves (every gymquest* localStorage key byte-for-byte, SHA-256 of every photo and media blob,
   IndexedDB database list, sync metadata) and, for accounts, the cloud backup row (revision, payload
   hash, history ids) and the stored files.

   Scenarios: guest with local data and an active workout (update, browser restart, offline start,
   rollback); signed-in with local + cloud data (update, no upload caused by the update, new edits sync,
   rollback); offline with unsynchronised edits (survive the update, upload once afterwards); restore of a
   cloud backup made by the old app into the new app; older stored formats (v1, v2, unreadable data)
   give identical results in both builds; export files move between the builds in both directions. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startServer, Browser, Observer, loadCreds, readPublicConfig, waitFor } = require('./lib');
const HELPERS = require('./helpers');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-bento-upgrade');
const PROFILES = path.join(WORK, 'profiles');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* Kanonický JSON (zoradené kľúče): porovnáva obsah, nie poradie kľúčov v objekte. */
const canon = (v) => J(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x));
const sameData = (a, b) => canon(JSON.parse(a)) === canon(JSON.parse(b));
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
let nextPort = 9640;
let pass = 0, fail = 0;
const report = [];   // before/after porovnania pre správu (bez tajomstiev)
let scenarioName = '';
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + String(typeof info === 'string' ? info : J(info)).slice(0, 900) : '')); }
  return ok;
}
const browsers = [];
async function launch(name) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  return { b, p };
}
async function R(p) { await p.ready(); await p.eval(HELPERS); }

/* ---------- builds ---------- */
function prepareBuilds() {
  const OLD = process.env.GQ_OLD_ROOT || path.join(WORK, 'old-build');
  if (!process.env.GQ_OLD_ROOT) {
    fs.rmSync(OLD, { recursive: true, force: true }); fs.mkdirSync(OLD, { recursive: true });
    require('child_process').execSync('git archive ' + (process.env.GQ_OLD_REF || 'HEAD') + ' | tar -x -C ' + J(OLD), { cwd: REPO, shell: '/bin/bash' });
  }
  /* "Revert" release: the previous code published again under a NEWER cache version (how a rollback ships). */
  const BACK = path.join(WORK, 'back-build');
  fs.rmSync(BACK, { recursive: true, force: true });
  fs.cpSync(OLD, BACK, { recursive: true });
  const newSw = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
  const newVer = Number(/CACHE_VERSION = 'v(\d+)'/.exec(newSw)[1]);
  const newQ = Number(/\?v=(\d+)/.exec(newSw)[1]);
  const backVer = 'v' + (newVer + 1), backQ = newQ + 1;
  let sw = fs.readFileSync(path.join(BACK, 'sw.js'), 'utf8').replace(/CACHE_VERSION = 'v\d+'/, "CACHE_VERSION = '" + backVer + "'").replace(/\?v=\d+/g, '?v=' + backQ);
  fs.writeFileSync(path.join(BACK, 'sw.js'), sw);
  fs.writeFileSync(path.join(BACK, 'index.html'), fs.readFileSync(path.join(BACK, 'index.html'), 'utf8').replace(/\?v=\d+/g, '?v=' + backQ));
  const oldVer = /CACHE_VERSION = '(v\d+)'/.exec(fs.readFileSync(path.join(OLD, 'sw.js'), 'utf8'))[1];
  return { OLD, BACK, oldVer, newVer: 'v' + newVer, backVer };
}

/* ---------- in-page data ---------- */
/* Bohaté syntetické dáta (rovnaký dátový kód v starej aj novej verzii). */
const SEED_RICH = (tag) => `(async () => {
  const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click();
  setLang('sk');
  const pid = 'legs-${tag}';
  state.plans[pid] = { id: pid, builtin: false, customName: 'Moje nohy ${tag}', location: null,
    exercises: [{ id: 'squats', name: 'Squats', builtin: true, sets: 4, reps: 8, weight: 80, plannedFailureSets: [4] },
      { id: 'cx-curl-${tag}', name: 'Jednoručný zdvih', sets: 2, reps: 12, weight: 10, unilateral: true, startSide: 'left' }] };
  state.planOrder.push(pid);
  for (let i = 0; i < 9; i++) state.history.push({ id: '${tag}-h' + i, planId: pid, planName: 'Moje nohy ${tag}', date: '2026-09-' + String(10 + i * 2).padStart(2, '0'), xp: 40 + i,
    note: i === 3 ? 'Ťažký deň 💪 ${tag}' : '', durationSeconds: 2400 + i * 60,
    exercises: [{ name: 'Squats', exId: 'squats', sets: 4, reps: 8, weight: 80 + i, setsDone: 4, setWeights: [80, 80 + i, 80 + i, 75], plannedWeight: 80, setReps: [8, 8, 6, 6], drops: [{ weight: 60, reps: 8 }], actualFailureSets: [4], plannedFailureSets: [] },
      { name: 'Jednoručný zdvih', sets: 2, reps: 12, weight: 10, setsDone: 4, unilateral: true, startSide: 'left', sidesDone: { left: [1, 2], right: [1, 2] }, sidesFailure: { left: [], right: [2] }, actualFailureSets: [2], sideReps: { left: [12, 10], right: [12, 9] }, setReps: [12, 10] }] });
  state.measurements.push(cleanMeasurement({ id: '${tag}-m1', date: '2026-09-12', weightKg: 81.4, waistCm: 84 }), cleanMeasurement({ id: '${tag}-m2', date: '2026-10-01', weightKg: 80.2 }));
  state.settings.foodLogEnabled = true;
  state.foodLog = state.foodLog || {}; state.foodLog['2026-10-01'] = [{ id: '${tag}-f1', name: 'Ovsené vločky', kcal: 380, protein: 13, carbs: 60, fat: 7, qty: 1.5 }];
  state.activities = state.activities || [];
  state.activities.push({ id: '${tag}-a1', kind: 'run', date: '2026-09-20', startedAt: 1790000000000, endedAt: 1790001800000, activeSeconds: 1800, distanceKm: 5.2, note: 'Beh ${tag}', xp: 20 });
  state.settings.weeklyGoal = 4; state.excusedWeeks = ['2026-W38'];
  reconcileAchievements(); saveState();
  await window.__gq.addProgress('${tag}-ph1', 'front-${tag}');
  await window.__gq.addProgress('${tag}-ph2', 'side-${tag}');
  await window.__gq.addPersonal('${tag}-mv1', 'my-squat-${tag}', 'squats');
  renderAll(); return true; })()`;

/* Všetko, čo appka ukladá na zariadení. Kľúč motívu (gymquest_theme) je nový a len zariadenia – vynechaný. */
const SNAP_JS = `(async () => {
  const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^gymquest/.test(k) && k !== 'gymquest_theme') ls[k] = localStorage.getItem(k); }
  if (!mediaDb) mediaDb = await openMediaDb();
  const media = await window.__gq.mediaHashes();
  const progMeta = (await idbGetAll(PROGRESS_META_STORE)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const mediaMeta = (await idbGetAll(MEDIA_META_STORE)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  let dbs = null; try { dbs = (await indexedDB.databases()).map((d) => d.name).sort(); } catch (e) {}
  let kv = null; try { kv = (await syncDbAll('kv')).map((x) => x.k).sort(); } catch (e) {}
  return { ls, media, progMeta, mediaMeta, dbs, kv, stateKey: STORAGE_KEY, mediaDbName: MEDIA_DB_NAME,
    session: state.activeSession ? JSON.stringify(state.activeSession) : null,
    counts: { history: state.history.length, plans: Object.keys(state.plans).length, measurements: (state.measurements || []).length,
      activities: (state.activities || []).length, foodDays: Object.keys(state.foodLog || {}).length, achievements: Object.keys(state.achievements || {}).length,
      progress: progMeta.length, personal: mediaMeta.length },
    meta: (typeof wsSlot !== 'undefined' && wsSlot) ? syncMetaRead() : null,
    status: typeof syncStatusKey === 'function' ? syncStatusKey() : null }; })()`;

function deepDiff(a, b, pth, out) {
  if (J(a) === J(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) deepDiff(a[k], b[k], pth + '.' + k, out); }
  else out.push(pth + ': ' + String(J(a)).slice(0, 80) + ' → ' + String(J(b)).slice(0, 80));
  return out;
}
function lsDiff(before, after) {
  const keys = [...new Set([...Object.keys(before.ls), ...Object.keys(after.ls)])].filter((k) => before.ls[k] !== after.ls[k]);
  return keys.map((k) => { try { return k + deepDiff(JSON.parse(before.ls[k]), JSON.parse(after.ls[k]), '', []).join(' | '); } catch (e) { return k + ' (raw)'; } });
}
function fingerprint(s) {
  return { lsKeys: Object.keys(s.ls).length, lsHash: sha(J(Object.keys(s.ls).sort().map((k) => [k, s.ls[k]]))), media: Object.keys(s.media).length,
    mediaHash: sha(J(s.media)), counts: s.counts, dbs: s.dbs };
}
function compareSnaps(label, before, after, opts) {
  opts = opts || {};
  const d = lsDiff(before, after);
  const allowed = opts.allow ? d.filter((x) => !opts.allow.some((re) => re.test(x))) : d;
  check(label + ': every stored value is byte-identical (' + Object.keys(before.ls).length + ' localStorage keys)', allowed.length === 0, allowed);
  check(label + ': photos and personal media byte-identical (SHA-256 of ' + Object.keys(before.media).length + ' blobs) with the same metadata',
    J(before.media) === J(after.media) && J(before.progMeta) === J(after.progMeta) && J(before.mediaMeta) === J(after.mediaMeta), { b: before.media, a: after.media });
  check(label + ': counts, ids and the IndexedDB databases are the same', J(before.counts) === J(after.counts) && J(before.dbs) === J(after.dbs) && before.stateKey === after.stateKey, { b: [before.counts, before.dbs], a: [after.counts, after.dbs] });
  if (before.session !== null || after.session !== null) check(label + ': the active workout (session, set marks) is the same', before.session === after.session, { b: before.session, a: after.session });
  report.push({ scenario: scenarioName, step: label, before: fingerprint(before), after: fingerprint(after), changedKeys: d });
}

async function swUpdate(p, server, root, cacheName) {
  server.setRoot(root);
  await p.eval(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
  await waitFor(() => p.eval('swUpdateReady === true').catch(() => false), 90000, 'update ready (' + root + ')');
  const lu = p.loads;
  await p.eval('(applyUpdate(), true)');
  await waitFor(() => p.loads > lu, 60000, 'update reload');
  await R(p);
  const keys = await p.eval('caches.keys()');
  return keys.indexOf('gymquest-' + cacheName) >= 0 && keys.filter((k) => /^gymquest-v\d+$/.test(k)).length === 1 ? keys : (console.log('   caches', keys), keys);
}
async function installOld(name, server) {
  server.setRoot('old');
  const d = await launch(name);
  await d.p.navigate(BASE);
  await d.p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 120000);
  await d.p.reload(); await R(d.p);
  return d;
}
async function cloudState(obs) {
  const row = await obs.row();
  const files = (await obs.listAll(obs.creds.id)).sort();
  return { rev: row ? row.revision : null, payloadHash: row ? sha(J(row.payload)) : null, hist: row && row.payload && row.payload.history ? row.payload.history.map((h) => h.id).sort() : [], files };
}
const isBento = (p) => p.eval(`document.documentElement.hasAttribute('data-theme') && !!document.getElementById('bento-grid')`);
const oldUi = (p) => p.eval(`!document.getElementById('bento-grid')`);

/* ============================ scenarios ============================ */
const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('guest: local data + active workout → update → restart → offline start → rollback', async ({ server, B: builds }) => {
  const d = await installOld('guest', server);
  check('old release (' + builds.oldVer + ') installed and controlling, no Bento yet', await d.p.eval('!!navigator.serviceWorker.controller') && await oldUi(d.p));
  await d.p.eval(SEED_RICH('g'));
  /* rozbehnutý tréning so značkami sérií */
  await d.p.eval(`(() => { selectedPlan = 'legs-g'; startWorkoutNow(); const b = document.querySelectorAll('#exercise-list .set-btn'); b[0].click(); b[1].click(); return true; })()`);
  await d.p.reload(); await R(d.p);
  const before = await d.p.eval(SNAP_JS);
  check('old app holds the data (9 workouts, 2 photos, 1 personal media, an active workout)', before.counts.history >= 9 && before.counts.progress === 2 && before.counts.personal === 1 && !!before.session, before.counts);

  /* Počas rozbehnutého tréningu sa aplikácia NIKDY sama neobnoví: nová verzia čaká, kým používateľ
     tréning dokončí alebo appku zavrie. Tu ju používateľ zavrie a znovu otvorí. */
  server.setRoot('new');
  await d.p.eval(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
  await waitFor(() => d.p.eval('swUpdateReady === true').catch(() => false), 90000, 'update ready');
  check('update is ready but no update offer is shown during the workout', await d.p.eval(`document.getElementById('update-banner').hidden`));
  const l0 = d.p.loads;
  await d.p.eval('(applyUpdate(), true)'); await wait(4000);
  check('even when forced, the page does not reload during the active workout (old version keeps running)', d.p.loads === l0 && await oldUi(d.p) && await d.p.eval('pendingUpdateReload === true'));
  d.p = await d.b.restart(true); await d.p.navigate(BASE); await R(d.p);
  const keysG = await d.p.eval('caches.keys()');
  check('after closing and reopening the app the redesign (' + builds.newVer + ') runs from its own cache', keysG.indexOf('gymquest-' + builds.newVer) >= 0 && keysG.filter((k) => /^gymquest-v\d+$/.test(k)).length === 1, keysG);
  check('the Bento redesign is running', await isBento(d.p));
  compareSnaps('guest update', before, await d.p.eval(SNAP_JS));
  const ui = await d.p.eval(`(() => { renderAll(); switchTab('dnes'); const next = document.getElementById('bt-next-label').textContent; switchTab('trening');
    const tiles = [...document.querySelectorAll('.plan-chips .chip-name')].map((x) => x.textContent);
    const done = document.querySelectorAll('#exercise-list .set-btn.done').length; switchTab('pokrok'); setPokrokView('progress');
    const hist = document.getElementById('history-list').innerText; return { next, tiles, done, hist: hist.includes('Moje nohy g') }; })()`);
  check('UI shows the data: own plan tile, workout in progress on Today with its 2 done sets, history', ui.tiles.includes('Moje nohy g') && /Prebieha/.test(ui.next) && ui.done === 2 && ui.hist, ui);

  d.p = await d.b.restart(true); await d.p.navigate(BASE); await R(d.p);
  compareSnaps('guest after browser restart', before, await d.p.eval(SNAP_JS));
  d.p = await d.b.restart(true); await d.p.offline(true); await d.p.navigate(BASE); await R(d.p);
  check('opens offline from the cache in the redesign', await isBento(d.p));
  compareSnaps('guest offline start', before, await d.p.eval(SNAP_JS));
  await d.p.offline(false);

  server.setRoot('back');
  await d.p.eval(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
  await waitFor(() => d.p.eval('swUpdateReady === true').catch(() => false), 90000, 'rollback ready');
  const l1 = d.p.loads; await d.p.eval('(applyUpdate(), true)'); await wait(3000);
  check('the redesign also never reloads during the active workout', d.p.loads === l1 && await isBento(d.p));
  d.p = await d.b.restart(true); await d.p.navigate(BASE); await R(d.p);
  check('rollback: the previous code shipped as ' + builds.backVer + ' runs after reopening', (await d.p.eval('caches.keys()')).indexOf('gymquest-' + builds.backVer) >= 0);
  check('the previous design is running again', await oldUi(d.p));
  compareSnaps('guest rollback', before, await d.p.eval(SNAP_JS));
  const old = await d.p.eval(`(() => { switchTab('trening'); return { chips: [...document.querySelectorAll('.plan-chips .chip')].map((c) => c.textContent), done: document.querySelectorAll('#exercise-list .set-btn.done').length, hist: state.history.length }; })()`);
  check('previous version shows the same plans, the active workout (2 done sets) and history', old.chips.some((c) => /Moje nohy g/.test(c)) && old.done === 2 && old.hist === before.counts.history, old);
  check('no page errors in any build', d.p.errors.length === 0, d.p.errors);
});

scenario('signed-in: local + cloud data → update (no upload caused) → new edit syncs → rollback', async ({ server, A, obsA, B: builds }) => {
  const d = await installOld('acct', server);
  try { await d.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(d.p);
  await d.p.eval(SEED_RICH('s'));
  await d.p.eval('__gq.syncNow()');
  await d.p.reload(); await R(d.p); await d.p.eval('__gq.syncNow()');
  const s0 = await d.p.eval('__gq.snap()');
  const c0 = await cloudState(obsA);
  check('old app signed in, synced to the cloud (revision ' + c0.rev + ', ' + c0.files.length + ' stored files)', s0.status === 'sync.st.synced' && s0.owner === A.id && c0.hist.includes('s-h0') && c0.files.length >= 3, { st: s0.status, c0: { rev: c0.rev, n: c0.files.length } });
  const before = await d.p.eval(SNAP_JS);

  await swUpdate(d.p, server, 'new', builds.newVer);
  check('redesign running in the same account workspace', await isBento(d.p) && (await d.p.eval('wsSlot && wsSlot.owner')) === A.id);
  await d.p.eval('__gq.syncNow()'); await wait(1500);
  const after = await d.p.eval(SNAP_JS);
  compareSnaps('account update', before, after, { allow: [/^gymquest_sync@[^.]*\.lastSyncAt: \d+ → \d+$/] });
  const s1 = await d.p.eval('__gq.snap()');
  const c1 = await cloudState(obsA);
  check('still "synced", nothing pending, no conflict', s1.status === 'sync.st.synced' && s1.dirty === false && !(s1.meta && s1.meta.conflict), s1.status);
  check('the update did not upload anything: same cloud revision, payload hash and files', c1.rev === c0.rev && c1.payloadHash === c0.payloadHash && J(c1.files) === J(c0.files), { c0: [c0.rev, c0.payloadHash], c1: [c1.rev, c1.payloadHash] });
  report.push({ scenario: scenarioName, step: 'cloud before/after update', before: { rev: c0.rev, payload: c0.payloadHash, files: c0.files.length, history: c0.hist.length }, after: { rev: c1.rev, payload: c1.payloadHash, files: c1.files.length, history: c1.hist.length } });

  await d.p.eval(`__gq.addWorkout('s-new', '2026-10-20')`);
  await d.p.eval('__gq.syncNow()');
  const c2 = await cloudState(obsA);
  check('a workout saved in the redesign syncs: exactly one new revision with old + new history', c2.rev === c0.rev + 1 && c2.hist.includes('s-new') && c0.hist.every((h) => c2.hist.includes(h)), { rev: [c0.rev, c2.rev], n: c2.hist.length });
  const mid = await d.p.eval(SNAP_JS);

  await swUpdate(d.p, server, 'back', builds.backVer);
  check('rollback build running', await oldUi(d.p));
  compareSnaps('account rollback', mid, await d.p.eval(SNAP_JS), { allow: [/^gymquest_sync@[^.]*\.lastSyncAt: \d+ → \d+$/] });
  await d.p.eval('__gq.syncNow()'); await wait(1000);
  const s3 = await d.p.eval('__gq.snap()');
  const c3 = await cloudState(obsA);
  check('after rollback: synced, no upload, no conflict', s3.status === 'sync.st.synced' && c3.rev === c2.rev && c3.payloadHash === c2.payloadHash, { st: s3.status, rev: c3.rev });
  check('no page errors', d.p.errors.length === 0, d.p.errors);
});

scenario('offline: unsynchronised edits made in the old app survive the update and upload once', async ({ server, A, obsA, B: builds }) => {
  const d = await installOld('off', server);
  try { await d.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(d.p);
  await d.p.eval(SEED_RICH('o'));
  await d.p.eval('__gq.syncNow()');
  const c0 = await cloudState(obsA);
  await d.p.offline(true);
  await d.p.eval(`__gq.addWorkout('o-offline', '2026-10-21')`);
  await d.p.eval(`__gq.addMeasurement('o-m-off', 79.6)`);
  const s0 = await d.p.eval('__gq.snap()');
  check('offline edits saved locally and pending in the old app', s0.hist.includes('o-offline') && s0.dirty === true, { st: s0.status, dirty: s0.dirty });
  /* Späť online, ale server účtov je stále nedostupný (edity zostanú čakať), aplikácia sa medzitým aktualizuje. */
  const cfg = readPublicConfig(REPO);
  await d.p.c.send('Network.setBlockedURLs', { urls: [cfg.url + '/*'] });
  await d.p.offline(false);
  await d.p.reload(); await R(d.p);   // stav po bežnom načítaní STAREJ verzie (tá pri štarte dopĺňa prázdne polia)
  const before = await d.p.eval(SNAP_JS);
  await swUpdate(d.p, server, 'new', builds.newVer);
  const after = await d.p.eval(SNAP_JS);
  compareSnaps('offline-pending update', before, after);
  const s1 = await d.p.eval('__gq.snap()');
  check('pending edits are still there and still marked as not uploaded', s1.hist.includes('o-offline') && s1.dirty === true, { dirty: s1.dirty, st: s1.status });
  check('the cloud was not touched while the account server was unreachable', (await cloudState(obsA)).rev === c0.rev);
  await d.p.c.send('Network.setBlockedURLs', { urls: [] });
  await d.p.eval(`window.dispatchEvent(new Event('online')), true`);
  await d.p.eval('__gq.syncNow()');
  const s2 = await d.p.eval('__gq.snap()');
  const c2 = await cloudState(obsA);
  check('reconnected: the offline workout and measurement uploaded in exactly one revision, no conflict', c2.rev === c0.rev + 1 && c2.hist.includes('o-offline') && s2.status === 'sync.st.synced' && !(s2.meta && s2.meta.conflict), { rev: [c0.rev, c2.rev], st: s2.status });
  report.push({ scenario: scenarioName, step: 'cloud', before: { rev: c0.rev, history: c0.hist.length }, after: { rev: c2.rev, history: c2.hist.length } });
  check('no page errors', d.p.errors.length === 0, d.p.errors);
});

scenario('restore: a cloud backup made by the old app loads completely into the redesign', async ({ server, A, obsA, B: builds }) => {
  const d = await installOld('rs-old', server);
  try { await d.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(d.p);
  await d.p.eval(SEED_RICH('r'));
  await d.p.eval('__gq.syncNow()');
  await d.p.reload(); await R(d.p); await d.p.eval('__gq.syncNow()');   // stav po bežnom načítaní starej verzie
  const DATA = `(() => { const s = state; return JSON.stringify({ history: s.history, plans: s.plans, planOrder: s.planOrder, measurements: s.measurements, foodLog: s.foodLog,
    activities: s.activities, excusedWeeks: s.excusedWeeks, achievements: s.achievements, goal: s.settings.weeklyGoal, food: s.settings.foodLogEnabled }); })()`;
  const src = await d.p.eval(DATA);
  const srcMedia = await d.p.eval('__gq.mediaHashes()');
  const c0 = await cloudState(obsA);
  server.setRoot('new');
  const n = await launch('rs-new');
  await n.p.navigate(BASE); await R(n.p);
  check('fresh device runs the redesign', await isBento(n.p));
  try { await n.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(n.p);
  await waitFor(async () => { const s = await n.p.eval('__gq.snap()'); return s.hist.includes('r-h0') && Object.keys(s.media).length === Object.keys(srcMedia).length; }, 90000, 'account loaded');
  const got = await n.p.eval(DATA);
  check('signing in loads the whole backup: plans, history, measurements, food, activities, achievements, settings', sameData(got, src), deepDiff(JSON.parse(src), JSON.parse(got), '', []).slice(0, 8));
  check('every photo and personal media file restored byte-for-byte (' + Object.keys(srcMedia).length + ' files)', J(await n.p.eval('__gq.mediaHashes()')) === J(srcMedia));
  try { await n.p.eval('(async () => { syncLoadFromAccount(); for (let i = 0; i < 4; i++) { await syncChain; await new Promise((r) => setTimeout(r, 200)); } return true; })()', 120000); } catch (e) { /* aplikácia sa mohla po obnove znovu načítať */ }
  await wait(1500); await R(n.p);
  check('"Load from account" reports success', /obnoven|restored/i.test(String(await n.p.eval('syncNotice || ""'))) || (await n.p.eval('__gq.snap()')).status === 'sync.st.synced');
  const got2 = await n.p.eval(DATA);
  check('"Load from account" in the redesign restores the same data again', sameData(got2, src) && J(await n.p.eval('__gq.mediaHashes()')) === J(srcMedia), deepDiff(JSON.parse(src), JSON.parse(got2), '', []).slice(0, 8));
  check('restoring did not change the cloud backup', (await cloudState(obsA)).payloadHash === c0.payloadHash);
  report.push({ scenario: scenarioName, step: 'restore', before: { dataHash: sha(canon(JSON.parse(src))), media: Object.keys(srcMedia).length }, after: { dataHash: sha(canon(JSON.parse(await n.p.eval(DATA)))), media: Object.keys(await n.p.eval('__gq.mediaHashes()')).length } });
  check('no page errors', n.p.errors.length === 0 && d.p.errors.length === 0, [n.p.errors, d.p.errors]);
});

scenario('older formats and export files give identical results in the old and the new build', async ({ server }) => {
  const fixtures = {
    v1: { version: 1, plans: { push: { name: 'Push', exercises: [{ name: 'Bench press', sets: 3, reps: 8, weight: 50 }] } }, history: [{ id: 'v1h', date: '2026-05-04', planId: 'push', xp: 20, exercises: [{ name: 'Bench press', sets: 3, reps: 8, weight: 50 }] }], excusedWeeks: ['2026-W10'] },
    v2: { version: 2, plans: { push: { id: 'push', name: 'Tlak', exercises: [{ name: 'Bench press', sets: 4, reps: 6, weight: 70 }] } }, planOrder: null, history: [{ id: 'v2h', date: '2026-06-01', planId: 'push', xp: 20, exercises: [{ name: 'Bench press', sets: 4, reps: 6, weight: 70 }] }], excusedWeeks: [], settings: { weeklyGoal: 2, lang: 'en' }, achievements: {}, demo: false },
    unreadable: '{"version":3,"plans":{"push"',
  };
  const results = {};
  for (const root of ['old', 'new']) {
    for (const [name, fx] of Object.entries(fixtures)) {
      server.setRoot(root);
      const d = await launch('fmt-' + root + '-' + name);
      await d.p.navigate(BASE); await R(d.p);
      await d.p.eval(`(() => { localStorage.setItem('gymquest', ${J(typeof fx === 'string' ? fx : J(fx))}); localStorage.removeItem('gymquest_workspaces'); return true; })()`);
      await d.p.reload(); await R(d.p);
      await d.p.eval('(saveState(), true)');   // prvý zápis: nečitateľné dáta sa musia najprv odložiť bokom
      const out = await d.p.eval(`(() => { const o = {}; for (const k of ['gymquest', 'gymquest_unreadable', 'gymquest_real']) o[k] = localStorage.getItem(k); let s = null; try { s = JSON.parse(o.gymquest || 'null'); } catch (e) { s = null; }
        return { raw: s ? null : o.gymquest, state: s && { version: s.version, plans: s.plans, planOrder: s.planOrder, history: s.history, excusedWeeks: s.excusedWeeks, achievements: s.achievements, goal: s.settings && s.settings.weeklyGoal }, unreadable: o.gymquest_unreadable }; })()`);
      results[root + ':' + name] = out;
      d.b.killHard(true);
    }
  }
  for (const name of Object.keys(fixtures)) {
    check('stored ' + name + ' data: the redesign produces exactly what the old app produces', J(results['old:' + name]) === J(results['new:' + name]), { old: results['old:' + name], neu: results['new:' + name] });
  }
  check('unreadable stored data is set aside unchanged, never overwritten (both builds)', results['new:unreadable'].unreadable === fixtures.unreadable && results['old:unreadable'].unreadable === fixtures.unreadable, results['new:unreadable']);
  check('v1 data keeps its workout and excused week after migration', /v1h/.test(J(results['new:v1'].state.history)) && results['new:v1'].state.excusedWeeks.includes('2026-W10'));

  /* Export ↔ import medzi verziami (oba smery). */
  const EXPORT = `(() => { let captured = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { captured = b; return 'blob:x'; };
    HTMLAnchorElement.prototype.click = function () {}; exportData(); URL.createObjectURL = orig; return captured.text(); })()`;
  const IMPORT = (text) => `(async () => { importFile(new File([${J(text)}], 'backup.json', { type: 'application/json' }));
    for (let i = 0; i < 100 && document.getElementById('modal-generic').hidden; i++) await new Promise((r) => setTimeout(r, 50));
    document.getElementById('btn-generic-ok').click(); await new Promise((r) => setTimeout(r, 300));
    const s = state; return JSON.stringify({ history: s.history, plans: s.plans, planOrder: s.planOrder, measurements: s.measurements, foodLog: s.foodLog, activities: s.activities, excusedWeeks: s.excusedWeeks, achievements: s.achievements }); })()`;
  const PICK = (text) => { const s = JSON.parse(text); return J({ history: s.history, plans: s.plans, planOrder: s.planOrder, measurements: s.measurements, foodLog: s.foodLog, activities: s.activities, excusedWeeks: s.excusedWeeks, achievements: s.achievements }); };
  const files = {};
  for (const from of ['old', 'new']) {
    server.setRoot(from);
    const a = await launch('exp-' + from);
    await a.p.navigate(BASE); await R(a.p);
    await a.p.eval(SEED_RICH('x' + from));
    files[from] = await a.p.eval(EXPORT);
    a.b.killHard(true);
  }
  for (const from of ['old', 'new']) {
    const into = {};
    for (const to of ['old', 'new']) {
      server.setRoot(to);
      const b = await launch('imp-' + from + '-' + to);
      await b.p.navigate(BASE); await R(b.p);
      await b.p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);
      into[to] = await b.p.eval(IMPORT(files[from]));
      b.b.killHard(true);
    }
    const fileHist = JSON.parse(files[from]).history.map((h) => h.id).join();
    check('export file from the ' + from + ' build: importing it into the old and the new build gives identical data', into.old === into.new, { old: sha(into.old), neu: sha(into.new), d: deepDiff(JSON.parse(into.old), JSON.parse(into.new), '', []).slice(0, 5) });
    check('export file from the ' + from + ' build: every workout id comes back', JSON.parse(into.new).history.map((h) => h.id).join() === fileHist);
    report.push({ scenario: scenarioName, step: 'export from ' + from, before: { fileHash: sha(PICK(files[from])), workouts: fileHist.split(',').length }, after: { importedIntoOld: sha(into.old), importedIntoNew: sha(into.new) } });
  }
});

/* ---------------------------- runner ---------------------------- */
(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  const builds = prepareBuilds();
  console.log('builds: old ' + builds.oldVer + ', new ' + builds.newVer + ', rollback ' + builds.backVer);
  const server = await startServer(PORT, { old: builds.OLD, new: REPO, back: builds.BACK });
  const cfg = readPublicConfig(REPO);
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(cfg.url)) { console.log('REFUSING: not the local stack'); process.exit(2); }
  const A = loadCreds('a');
  const obsA = await new Observer(cfg, A).login();
  const filter = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
  for (const sc of scenarios) {
    if (filter && !filter.test(sc.name)) continue;
    scenarioName = sc.name;
    console.log('\n== ' + sc.name);
    try { await obsA.reset(); await sc.fn({ server, A, obsA, B: builds }); }
    catch (e) { fail++; console.log('  FAIL scenario error: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    while (browsers.length) { const b = browsers.pop(); try { b.killHard(true); } catch (e) {} }
  }
  try { await obsA.reset(); } catch (e) {}
  await server.close();
  fs.writeFileSync(path.join(WORK, 'comparison.json'), J({ at: new Date().toISOString(), builds: { old: builds.oldVer, new: builds.newVer, rollback: builds.backVer }, pass, fail, report }, null, 2));
  console.log('\ncomparison report: ' + path.join(WORK, 'comparison.json'));
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
