/* Gym-Lift — gym-basics fáza 1: spätná kompatibilita nových polí so staršími verziami cez účet.
   LOCAL stack only, disposable test account (GQ_CREDS_DIR cred-a, GQ_TEST_IDS).

     node tests/sync/gym-basics-roundtrip.js

   Staré buildy (default: GQ_OLD_REFS='f9590a9,821a538' = v106 a Android Play build v95; GQ_OLD_REFS="a,b" prepíše).
   Tok pre každý starý build:
   1. NOVÉ zariadenie zapíše: plán s dvojicou v supersete (group) + warmupRamp, dokončený tréning s warmups, setRpe,
      jednostranným cvikom (sideRpe) a group, a settings.plates (bar 15) + settings.effort 'rir'; nahrá do účtu;
   2. STARÝ build sa prihlási do rovnakého účtu, načíta ho, premenuje INÝ plán, pridá obyčajný tréning a nahrá;
   3. NOVÉ zariadenie sa znovu zosynchronizuje (aj po reštarte, aj čerstvé zariadenie): žiadny konflikt, záznamy histórie
      s novými poľami bajt po bajte rovnaké, settings.plates/effort, group/warmupRamp plánu nedotknuté, celkové XP rovnaké,
      zmena zo starého zariadenia je prítomná.
   Každé zariadenie má vlastný server/port (vlastný origin = vlastné úložisko = "iné zariadenie"). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, Observer, loadCreds, readPublicConfig, waitFor } = require('./lib');
const HELPERS = require('./helpers');

const REPO = path.resolve(__dirname, '..', '..');
const NEW_PORT = 8124, OLD_PORT = 8143;
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-basics-roundtrip');
const PROFILES = path.join(WORK, 'profiles');
const J = JSON.stringify;
/* Kanonický JSON (zoradené kľúče): porovnáva obsah, nie poradie kľúčov. */
const canon = (v) => J(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x));
let nextPort = 9680;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + String(typeof info === 'string' ? info : J(info)).slice(0, 3000) : '')); }
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


/* Nové polia, ktoré musia prežiť cestu cez starý build (kanonicky, bez poradia kľúčov). */
const CORE = `(() => {
  const plans = {}; for (const id of Object.keys(state.plans)) { const pl = state.plans[id]; plans[id] = (pl.exercises || []).map((e) => ({ id: e.id || null, name: e.name, weight: e.weight, sets: e.sets, reps: e.reps, group: e.group === undefined ? null : e.group, warmupRamp: e.warmupRamp === true, unilateral: e.unilateral === true })); }
  const hist = state.history.filter((h) => h.id !== 'old-w1').map((h) => JSON.parse(JSON.stringify(h)));
  return JSON.stringify({ plans, hist, plates: state.settings.plates === undefined ? null : state.settings.plates, effort: state.settings.effort === undefined ? null : state.settings.effort }); })()`;

const SEED_NEW = `(async () => {
  const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click();
  setLang('sk');
  state.plans['gb1'] = { id: 'gb1', builtin: false, customName: 'GB Superset', location: null,
    exercises: [{ id: 'bench-press', name: 'Bench Press', builtin: true, sets: 3, reps: 5, weight: 60, group: 'g1', warmupRamp: true },
      { name: 'Rad s činkou', sets: 3, reps: 8, weight: 40, group: 'g1' },
      { name: 'Jednoručný veslo', sets: 2, reps: 12, weight: 14, unilateral: true, startSide: 'left' }] };
  state.plans['gb2'] = { id: 'gb2', builtin: false, customName: 'GB Other', location: null, exercises: [{ name: 'Iný cvik', sets: 3, reps: 10, weight: 10 }] };
  for (const id of ['gb1', 'gb2']) if (!state.planOrder.includes(id)) state.planOrder.push(id);
  state.settings.plates = { bar: 15, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
  setEffortMode('rir');
  backfillState(); saveState();
  selectedPlan = 'gb1'; ensureSession(getPlan('gb1')); saveState(); switchTab('trening'); renderTrening();
  const [a, b, c] = state.plans.gb1.exercises;
  setSetWeight(a, 0, 60); setSetWeight(a, 1, 60); setSetWeight(a, 2, 62.5);
  for (const ex of [a, b]) for (let i = 0; i < 3; i++) toggleSetMark('done', ex, i, true);
  for (const side of ['left', 'right']) for (let i = 0; i < 2; i++) toggleSetMark('done', c, i, true, side);
  addWarmup(a); addWarmup(a); updateWarmup(a, 0, { done: true }); updateWarmup(a, 1, { done: true, w: 40, r: 3 });
  setSetRpe(a, 0, undefined, 8); setSetRpe(a, 2, undefined, 9.5); setSetRpe(b, 1, undefined, 7);
  setSetRpe(c, 0, 'left', 8.5); setSetRpe(c, 1, 'right', 9);
  saveState();
  document.getElementById('modal-confirm').hidden = false; confirmFinish();
  return true; })()`;

async function roundtrip({ ref, newSrv, oldSrv, A, obsA }) {
  const label = ref;
  /* --- 1. nové zariadenie zapíše a nahrá --- */
  const n = await launch('gb-new-' + label);
  await n.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(n.p);
  try { await n.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(n.p);
  await n.p.eval(SEED_NEW);
  await n.p.eval('__gq.syncNow()');
  const core0 = JSON.parse(await n.p.eval(CORE));
  const xp0 = await n.p.eval('totalXP()');
  const c0 = await obsA.row();
  const h0 = core0.hist[0] || {};
  const e0 = h0.exercises || [];
  check('[' + label + '] new device seeded: history entry has warmups, setRpe, sideRpe and group', core0.hist.length === 1 && Array.isArray(e0[0].warmups) && e0[0].warmups.length === 2 && J(e0[0].setRpe) === J([8, null, 9.5]) && e0[2] && e0[2].sideRpe && e0[2].sideRpe.left[0] === 8.5 && e0[2].sideRpe.right[1] === 9 && !!e0[0].group && e0[0].group === e0[1].group, h0);
  check('[' + label + '] new device seeded: plan keeps group + warmupRamp, settings.plates.bar 15, effort rir', core0.plans.gb1[0].group === 'g1' && core0.plans.gb1[1].group === 'g1' && core0.plans.gb1[0].warmupRamp === true && core0.plates && core0.plates.bar === 15 && core0.effort === 'rir', core0);
  const p0 = c0 && c0.payload;
  check('[' + label + '] uploaded: payload carries the new fields', !!p0 && p0.plans.gb1.exercises[0].group === 'g1' && p0.plans.gb1.exercises[0].warmupRamp === true && canon(p0.history[0]) === canon(core0.hist[0]) && p0.settings.plates.bar === 15 && p0.settings.effort === 'rir', p0 && p0.settings);
  const s0 = await n.p.eval('__gq.snap()');
  check('[' + label + '] new device is synced with nothing pending', s0.status === 'sync.st.synced' && s0.dirty === false, s0.status);

  /* --- 2. starý build načíta účet, zmení INÝ plán, pridá obyčajný tréning, nahrá --- */
  oldSrv.setRoot('old');
  const o = await launch('gb-old-' + label);
  await o.p.navigate('http://localhost:' + OLD_PORT + '/');
  await o.p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 120000);
  await o.p.reload(); await R(o.p);
  const oldVer = await o.p.eval(`(() => { const s = document.querySelector('script[src*="script.js?v="]'); return s ? s.getAttribute('src') : null; })()`);
  try { await o.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(o.p);
  await waitFor(async () => (await o.p.eval('__gq.snap()')).plans.includes('gb1'), 90000, 'old device loaded the account');
  const oldSnap = await o.p.eval('__gq.snap()');
  check('[' + label + '] old build (' + oldVer + ') loaded the account: both plans + the workout present', oldSnap.plans.includes('gb1') && oldSnap.plans.includes('gb2') && oldSnap.hist.length === 1, { plans: oldSnap.plans, hist: oldSnap.hist });
  const oldSees = await o.p.eval(`(() => ({ h: JSON.parse(JSON.stringify(state.history[0])), plates: state.settings.plates || null, effort: state.settings.effort || null, g: state.plans.gb1.exercises.map((e) => [e.group || null, e.warmupRamp === true]) }))()`);
  check('[' + label + '] old build keeps the new fields in memory', canon(oldSees.h) === canon(core0.hist[0]) && canon(oldSees.plates) === canon(core0.plates) && oldSees.effort === 'rir' && J(oldSees.g) === J([['g1', true], ['g1', false], [null, false]]), oldSees);
  const oldXp = await o.p.eval(`typeof totalXP === 'function' ? totalXP() : null`);
  await o.p.eval(`(() => { state.plans.gb2.customName = 'GB Other (z mobilu)'; saveState(); return true; })()`);
  await o.p.eval(`__gq.addWorkout('old-w1', '2026-10-25')`);
  await o.p.eval('__gq.syncNow()');
  const so = await o.p.eval('__gq.snap()');
  const c1 = await obsA.row();
  check('[' + label + '] old build uploaded exactly one new revision, synced, no conflict', c1.revision === c0.revision + 1 && so.status === 'sync.st.synced' && !(so.meta && so.meta.conflict), { rev: [c0.revision, c1.revision], st: so.status });
  const hx = c1.payload.history.find((h) => h.id === core0.hist[0].id);
  check('[' + label + '] cloud payload: history entry with warmups/setRpe/sideRpe/group is byte-identical after the old upload', !!hx && canon(hx) === canon(core0.hist[0]), { cloud: hx, orig: core0.hist[0] });
  check('[' + label + '] cloud payload: settings.plates + settings.effort intact', canon(c1.payload.settings.plates) === canon(core0.plates) && c1.payload.settings.effort === 'rir', c1.payload.settings);
  check('[' + label + '] cloud payload: superset plan keeps group + warmupRamp (old device did not edit it); the old change is present', c1.payload.plans.gb1.exercises[0].group === 'g1' && c1.payload.plans.gb1.exercises[1].group === 'g1' && c1.payload.plans.gb1.exercises[0].warmupRamp === true && c1.payload.plans.gb2.customName === 'GB Other (z mobilu)' && c1.payload.history.some((h) => h.id === 'old-w1'), c1.payload.plans.gb1);
  check('[' + label + '] old build: no page errors', o.p.errors.length === 0, o.p.errors);
  o.b.killHard(true);

  /* --- 3. nové zariadenie sa znovu zosynchronizuje --- */
  await n.p.eval('__gq.syncNow()');
  const n1 = await n.p.eval('__gq.snap()');
  const core1 = JSON.parse(await n.p.eval(CORE));
  check('[' + label + '] new device pulled the old device change (plan name + the old workout), no conflict, synced', n1.hist.includes('old-w1') && (await n.p.eval(`state.plans.gb2.customName`)) === 'GB Other (z mobilu)' && n1.status === 'sync.st.synced' && !(n1.meta && n1.meta.conflict), { st: n1.status, hist: n1.hist });
  check('[' + label + '] new device: history entries with the new fields are byte-identical', canon(core1.hist) === canon(core0.hist), { a: core0.hist, b: core1.hist });
  check('[' + label + '] new device: settings.plates and settings.effort intact', canon(core1.plates) === canon(core0.plates) && core1.effort === 'rir', { plates: core1.plates, effort: core1.effort });
  check('[' + label + '] new device: superset plan group/warmupRamp intact', J(core1.plans.gb1) === J(core0.plans.gb1), { a: core0.plans.gb1, b: core1.plans.gb1 });
  const oldW = await n.p.eval(`historyEntryXp(state.history.find((h) => h.id === 'old-w1'))`);
  const xp1 = await n.p.eval('totalXP()');
  check('[' + label + '] new device: total XP = XP before + the old workout (new fields never change XP)', xp1 === xp0 + oldW, { xp0, oldW, xp1 });
  n.p = await n.b.restart(true); await n.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(n.p);
  await n.p.eval('__gq.syncNow()');
  check('[' + label + '] new device after restart: same data, synced, same XP', J(JSON.parse(await n.p.eval(CORE))) === J(core1) && (await n.p.eval('__gq.snap()')).status === 'sync.st.synced' && (await n.p.eval('totalXP()')) === xp1);
  const f = await launch('gb-fresh-' + label);
  await f.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(f.p);
  try { await f.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(f.p);
  await waitFor(async () => (await f.p.eval('__gq.snap()')).hist.includes('old-w1'), 90000, 'fresh device loaded');
  const fresh = JSON.parse(await f.p.eval(CORE));
  check('[' + label + '] a fresh new device gets identical history, plans and settings, and the same total XP', J(fresh.hist) === J(core1.hist) && J(fresh.plans.gb1) === J(core1.plans.gb1) && canon(fresh.plates) === canon(core1.plates) && fresh.effort === 'rir' && (await f.p.eval('totalXP()')) === xp1);
  /* Starý build (pred v101) počíta XP inak (uložené xp, nie odvodené) — len informácia, nie chyba nových polí. */
  console.log('  INFO [' + label + '] total XP: new device ' + xp0 + ', old build ' + oldXp + (oldXp === xp0 ? ' (equal)' : ' (older XP formula, not caused by the new fields)'));
  check('[' + label + '] new devices: no page errors', n.p.errors.length === 0 && f.p.errors.length === 0, [n.p.errors, f.p.errors]);
  const cEnd = await obsA.row();
  check('[' + label + '] new device pulling uploaded nothing (cloud revision unchanged since the old upload)', cEnd.revision === c1.revision, [c1.revision, cEnd.revision]);
}

(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  const cfg = readPublicConfig(REPO);
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(cfg.url)) { console.log('REFUSING: not the local stack'); process.exit(2); }
  const refs = (process.env.GQ_OLD_REFS || 'f9590a9,821a538').split(',').map((s) => s.trim()).filter(Boolean);
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
    console.log('\n== old build ' + ref + ' (' + ver + ') <-> gym-basics, account round trip');
    try { await obsA.reset(); await roundtrip({ ref: ref + '/' + ver, newSrv, oldSrv, A, obsA }); }
    catch (e) { fail++; console.log('  FAIL scenario error: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    while (browsers.length) { const b = browsers.pop(); try { b.killHard(true); } catch (e) {} }
    await oldSrv.close();
  }
  try { await obsA.reset(); } catch (e) {}
  await newSrv.close();
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
