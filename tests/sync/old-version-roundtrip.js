/* GymQuest — Phase 3 (v100): spätná kompatibilita so staršími verziami cez účet.
   LOCAL stack only, disposable test account (GQ_CREDS_DIR cred-a, GQ_TEST_IDS).

     node tests/sync/old-version-roundtrip.js

   Tok pre každú starú verziu (default: Android Play build v95 = 821a538 a v90 = 5b20048; GQ_OLD_REFS="a,b" prepíše):
   1. zariadenie s TÝMTO buildom (v100) zapíše stav: vlastné cviky (identita z názvu), asistovaný riadok,
      settings.exerciseMemory a pamätanú váhu po skutočnom Dokončiť, a nahrá ho do účtu;
   2. zariadenie so STARÝM buildom sa prihlási do rovnakého účtu, načíta ho, zmení nesúvisiace pole
      (názov plánu + nový tréning) a nahrá;
   3. v100 sa znovu zosynchronizuje (aj po reštarte): všetky id, asistované príznaky, váhy a exerciseMemory
      sú nedotknuté, žiadny konflikt, zmena zo starého zariadenia je prítomná.
   Každé zariadenie má vlastný server/port (vlastný origin = vlastné úložisko = "iné zariadenie"). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, Observer, loadCreds, readPublicConfig, waitFor } = require('./lib');
const HELPERS = require('./helpers');

const REPO = path.resolve(__dirname, '..', '..');
const NEW_PORT = 8124, OLD_PORT = 8143;
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-old-roundtrip');
const PROFILES = path.join(WORK, 'profiles');
const J = JSON.stringify;
/* Kanonický JSON (zoradené kľúče): porovnáva obsah, nie poradie kľúčov. */
const canon = (v) => J(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x));
let nextPort = 9680;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + String(typeof info === 'string' ? info : J(info)).slice(0, 1200) : '')); }
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

/* Stav, ktorý musí prežiť cestu cez starú verziu (kanonicky, bez poradia kľúčov). */
const CORE = `(() => {
  const plans = {}; for (const id of Object.keys(state.plans)) { const pl = state.plans[id]; plans[id] = (pl.exercises || []).map((e) => ({ id: e.id || null, name: e.name, weight: e.weight, sets: e.sets, reps: e.reps, assisted: e.assisted === true, unilateral: e.unilateral === true, startSide: e.startSide || null })); }
  const mem = JSON.parse(JSON.stringify(state.settings.exerciseMemory || null));
  const hist = state.history.map((h) => ({ id: h.id, xp: h.xp, ex: (h.exercises || []).map((e) => ({ n: e.name, id: e.exId || null, sw: e.setWeights || null, a: e.assisted === true })) }));
  return JSON.stringify({ plans, mem, hist, ach: JSON.parse(JSON.stringify(state.achievements || {})) }); })()`;

/* Pripraví stav vo v100: identita z názvu (rovnaký názov v dvoch plánoch s inou veľkosťou/medzerami),
   asistovaný riadok, pamätaná váha po skutočnom Dokončiť. */
const SEED_NEW = `(async () => {
  const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click();
  setLang('sk');
  state.plans['rt1'] = { id: 'rt1', builtin: false, customName: 'RT Tlak', location: null,
    exercises: [{ name: 'Môj zdvih', sets: 3, reps: 10, weight: 20 }, { id: 'assisted-pull-ups', name: 'Assisted pull-ups (machine)', builtin: true, assisted: true, sets: 3, reps: 6, weight: 30 },
      { name: 'Jednoručný veslo', sets: 2, reps: 12, weight: 14, unilateral: true, startSide: 'right' }] };
  state.plans['rt2'] = { id: 'rt2', builtin: false, customName: 'RT Full', location: null,
    exercises: [{ name: '  môj   ZDVIH ', sets: 4, reps: 8, weight: 20 }, { id: 'bench-press', name: 'Bench Press', builtin: true, sets: 5, reps: 5, weight: 60 }] };
  for (const id of ['rt1', 'rt2']) if (!state.planOrder.includes(id)) state.planOrder.push(id);
  backfillState(); saveState();
  /* skutočné Dokončiť: Môj zdvih 47.5, 47.5, 50 -> pracovná váha 47.5; asistovaný 24/24/22 -> 24 (najnižšia pomoc použitá v ≥ 2 sériách) */
  selectedPlan = 'rt1'; ensureSession(getPlan('rt1')); saveState(); switchTab('trening'); renderTrening();
  const [a, as] = state.plans.rt1.exercises;
  setSetWeight(a, 0, 47.5); setSetWeight(a, 1, 47.5); setSetWeight(a, 2, 50);
  setSetWeight(as, 0, 24); setSetWeight(as, 1, 24); setSetWeight(as, 2, 22);
  for (const ex of [a, as]) for (let i = 0; i < 3; i++) toggleSetMark('done', ex, i, true);
  saveState();
  document.getElementById('modal-confirm').hidden = false; confirmFinish();
  return true; })()`;

const scenarios = [];
async function roundtrip({ ref, oldRoot, newSrv, oldSrv, A, obsA }) {
  const label = ref;
  /* --- 1. v100 zapíše a nahrá --- */
  const n = await launch('rt-new-' + label);
  await n.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(n.p);
  try { await n.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(n.p);
  await n.p.eval(SEED_NEW);
  await n.p.eval('__gq.syncNow()');
  const core0 = JSON.parse(await n.p.eval(CORE));
  const c0 = await obsA.row();
  const ids0 = core0.plans.rt1.map((e) => e.id).concat(core0.plans.rt2.map((e) => e.id));
  check('[' + label + '] v100 seeded: custom ids are cx-*, same name in 2 plans = same id', /^cx-/.test(core0.plans.rt1[0].id) && core0.plans.rt1[0].id === core0.plans.rt2[0].id && /^cx-/.test(core0.plans.rt1[2].id), ids0);
  check('[' + label + '] v100 seeded: assisted row keeps its flag; exerciseMemory has custom + assisted + unilateral values', core0.plans.rt1[1].assisted === true && !!core0.mem && Object.keys(core0.mem).length >= 2, core0.mem);
  check('[' + label + '] new app seeded: remembered weight 47.5 (custom) in the trained plan only (v106: weight per plan, rt2 keeps 20), assisted 24 (24/24/22: the lowest assistance used in 2 sets)', core0.plans.rt1[0].weight === 47.5 && core0.plans.rt2[0].weight === 20 && core0.plans.rt1[1].weight === 24 && core0.mem[core0.plans.rt1[0].id].weight === 47.5, { rt1: core0.plans.rt1.map((e) => e.weight), rt2: core0.plans.rt2.map((e) => e.weight) });
  const p0 = c0 && c0.payload;
  check('[' + label + '] uploaded: payload carries the plan ids, assisted flag and settings.exerciseMemory', !!p0 && p0.plans.rt1.exercises[1].assisted === true && p0.plans.rt1.exercises[0].id === core0.plans.rt1[0].id && !!p0.settings && canon(p0.settings.exerciseMemory) === canon(core0.mem), p0 && p0.settings && p0.settings.exerciseMemory);
  const s0 = await n.p.eval('__gq.snap()');
  check('[' + label + '] v100 is synced with nothing pending', s0.status === 'sync.st.synced' && s0.dirty === false, s0.status);

  /* --- 2. starý build načíta účet, zmení nesúvisiace pole, nahrá --- */
  oldSrv.setRoot('old');
  const o = await launch('rt-old-' + label);
  await o.p.navigate('http://localhost:' + OLD_PORT + '/');
  await o.p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 120000);
  await o.p.reload(); await R(o.p);
  const oldVer = await o.p.eval(`(() => { const s = document.querySelector('script[src*="script.js?v="]'); return s ? s.getAttribute('src') : null; })()`);
  try { await o.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(o.p);
  await waitFor(async () => (await o.p.eval('__gq.snap()')).plans.includes('rt1'), 90000, 'old device loaded the account');
  const oldSnap = await o.p.eval('__gq.snap()');
  check('[' + label + '] old build (' + oldVer + ') loaded the v100 account: plans + workout present', oldSnap.plans.includes('rt1') && oldSnap.plans.includes('rt2') && oldSnap.hist.length === 1, { plans: oldSnap.plans, hist: oldSnap.hist });
  const oldSees = JSON.parse(await o.p.eval(CORE));
  check('[' + label + '] old build keeps the unknown fields in memory (ids, assisted, exerciseMemory)', canon(oldSees.plans) === canon(core0.plans) && canon(oldSees.mem) === canon(core0.mem), Object.keys(core0.plans).map((pid) => core0.plans[pid].map((e, i) => (J(e) === J(oldSees.plans[pid] && oldSees.plans[pid][i]) ? null : [pid, i, e, oldSees.plans[pid] && oldSees.plans[pid][i]])).filter(Boolean)));
  await o.p.eval(`(() => { state.plans.rt2.customName = 'RT Full (z mobilu)'; saveState(); return true; })()`);
  await o.p.eval(`__gq.addWorkout('old-w1', '2026-10-25')`);
  await o.p.eval('__gq.syncNow()');
  const so = await o.p.eval('__gq.snap()');
  const c1 = await obsA.row();
  check('[' + label + '] old build uploaded exactly one new revision, synced, no conflict', c1.revision === c0.revision + 1 && so.status === 'sync.st.synced' && !(so.meta && so.meta.conflict), { rev: [c0.revision, c1.revision], st: so.status });
  check('[' + label + '] cloud payload still has ids, assisted flag, weights and exerciseMemory (old upload did not strip them)',
    c1.payload.plans.rt1.exercises[1].assisted === true && c1.payload.plans.rt1.exercises[0].id === core0.plans.rt1[0].id && c1.payload.plans.rt1.exercises[0].weight === 47.5 && c1.payload.plans.rt1.exercises[1].weight === 24 && canon(c1.payload.settings.exerciseMemory) === canon(core0.mem) && c1.payload.plans.rt2.customName === 'RT Full (z mobilu)' && c1.payload.history.some((h) => h.id === 'old-w1'),
    { mem: c1.payload.settings && c1.payload.settings.exerciseMemory, rt1: c1.payload.plans.rt1.exercises });
  check('[' + label + '] old build: no page errors', o.p.errors.length === 0, o.p.errors);
  o.b.killHard(true);

  /* --- 3. v100 sa znovu synchronizuje --- */
  await n.p.eval('__gq.syncNow()');
  const n1 = await n.p.eval('__gq.snap()');
  const core1 = JSON.parse(await n.p.eval(CORE));
  const expectPlans = JSON.parse(J(core0.plans));
  const diffs = [];
  for (const pid of Object.keys(expectPlans)) for (let i = 0; i < expectPlans[pid].length; i++) if (J(expectPlans[pid][i]) !== J(core1.plans[pid][i])) diffs.push([pid, i, expectPlans[pid][i], core1.plans[pid][i]]);
  check('[' + label + '] v100 pulled the old device change (plan name + the old workout), no conflict, synced', n1.hist.includes('old-w1') && (await n.p.eval(`state.plans.rt2.customName`)) === 'RT Full (z mobilu)' && n1.status === 'sync.st.synced' && !(n1.meta && n1.meta.conflict), { st: n1.status, hist: n1.hist });
  check('[' + label + '] v100: every exercise row (id, name, weight, sets, reps, assisted, unilateral, side) is unchanged', diffs.length === 0 && J(Object.keys(core1.plans).sort()) === J(Object.keys(core0.plans).sort()), diffs.slice(0, 3));
  check('[' + label + '] v100: exerciseMemory identical (values and "at")', canon(core1.mem) === canon(core0.mem), { a: core0.mem, b: core1.mem });
  check('[' + label + '] v100: workout history (set weights, ids) intact', J(core1.hist.filter((h) => h.id !== 'old-w1')) === J(core0.hist), { a: core0.hist, b: core1.hist });
  check('[' + label + '] v100: custom ids still match identity of the name, assisted row still assisted', await n.p.eval(`exerciseIdentity(state.plans.rt1.exercises[0]) === state.plans.rt1.exercises[0].id && exerciseIdentity(state.plans.rt2.exercises[0]) === state.plans.rt1.exercises[0].id && state.plans.rt1.exercises[1].assisted === true`));
  /* úspechy (id -> dátum): nič z v101 stavu sa cez starý build nestratí ani nepreddatuje */
  const achLost = (from, to) => Object.keys(from).filter((k) => to[k] !== from[k]);
  check('[' + label + '] v101: every achievement from before the old-build round trip is still there with the same date (' + Object.keys(core0.ach).length + ')', achLost(core0.ach, core1.ach).length === 0, { lost: achLost(core0.ach, core1.ach) });
  /* po reštarte (čistý štart z uloženého stavu) a čerstvé zariadenie v100 z účtu */
  n.p = await n.b.restart(true); await n.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(n.p);
  await n.p.eval('__gq.syncNow()');
  check('[' + label + '] v100 after restart: same data, synced', J(JSON.parse(await n.p.eval(CORE))) === J(core1) && (await n.p.eval('__gq.snap()')).status === 'sync.st.synced');
  const f = await launch('rt-fresh-' + label);
  await f.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(f.p);
  try { await f.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(f.p);
  await waitFor(async () => (await f.p.eval('__gq.snap()')).hist.includes('old-w1'), 90000, 'fresh v100 device loaded');
  const fresh = JSON.parse(await f.p.eval(CORE));
  check('[' + label + '] v101 XP is derived: the old-build workout (stored xp 20, 3 sets) counts 36 and stored xp stays 20; fresh device has the same total', (await n.p.eval(`historyEntryXp(state.history.find((h) => h.id === 'old-w1'))`)) === 36 && (await n.p.eval(`state.history.find((h) => h.id === 'old-w1').xp`)) === 20 && (await n.p.eval('totalXP()')) === (await f.p.eval('totalXP()')));
  check('[' + label + '] a fresh device: earlier achievements present with the same dates, and equal to the restarted v101 device (idempotent)', achLost(core0.ach, fresh.ach).length === 0 && J(Object.keys(fresh.ach).sort()) === J(Object.keys(core1.ach).sort()), { fresh: fresh.ach, core1: core1.ach });
  check('[' + label + '] a fresh v100 device loading the account gets the same plans, memory and history', J(fresh.plans) === J(core1.plans) && canon(fresh.mem) === canon(core1.mem), { a: core1.mem, b: fresh.mem });
  check('[' + label + '] v100 devices: no page errors', n.p.errors.length === 0 && f.p.errors.length === 0, [n.p.errors, f.p.errors]);
  const cEnd = await obsA.row();
  check('[' + label + '] v100 pulling uploaded nothing (cloud revision unchanged since the old upload)', cEnd.revision === c1.revision, [c1.revision, cEnd.revision]);
}

(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  const cfg = readPublicConfig(REPO);
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(cfg.url)) { console.log('REFUSING: not the local stack'); process.exit(2); }
  const refs = (process.env.GQ_OLD_REFS || '821a538,5b20048').split(',').map((s) => s.trim()).filter(Boolean);
  const A = loadCreds('a');
  const obsA = await new Observer(cfg, A).login();
  const newSrv = await startServer(NEW_PORT, { new: REPO });
  for (const ref of refs) {
    const OLD = path.join(WORK, 'old-' + ref);
    fs.rmSync(OLD, { recursive: true, force: true }); fs.mkdirSync(OLD, { recursive: true });
    require('child_process').execSync('git archive ' + ref + ' | tar -x -C ' + J(OLD), { cwd: REPO, shell: '/bin/bash' });
    const ver = /CACHE_VERSION = '(v\d+)'/.exec(fs.readFileSync(path.join(OLD, 'sw.js'), 'utf8'))[1];
    const oldSrv = await startServer(OLD_PORT, { old: OLD });
    oldSrv.setRoot('old');
    console.log('\n== old build ' + ref + ' (' + ver + ') <-> v100, account round trip');
    try { await obsA.reset(); await roundtrip({ ref: ref + '/' + ver, oldRoot: OLD, newSrv, oldSrv, A, obsA }); }
    catch (e) { fail++; console.log('  FAIL scenario error: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    while (browsers.length) { const b = browsers.pop(); try { b.killHard(true); } catch (e) {} }
    await oldSrv.close();
  }
  try { await obsA.reset(); } catch (e) {}
  await newSrv.close();
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
