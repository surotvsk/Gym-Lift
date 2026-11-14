/* GymQuest — Phase 8: nové polia merania (krk, telesný tuk %) cez STARÚ verziu appky (v105 = Android vc4/vc5 v Play).
   LOCAL stack only, disposable test account (GQ_CREDS_DIR cred-a, GQ_TEST_IDS).

     node tests/sync/old-bodyfat-roundtrip.js        (GQ_OLD_REFS="b33623d" prepíše starú verziu)

   1. zariadenie s TÝMTO buildom uloží meranie s neckCm + bodyFatPct (cez kalkulačku) a nahrá účet;
   2. zariadenie so STARÝM buildom sa prihlási, načíta účet, zmení nesúvisiace pole a nahrá;
   3. dôkaz straty na úrovni záznamu: starý klient zahodí neckCm/bodyFatPct zo záznamu (v pamäti aj v nahratom
      stave), ale settings.measureExtra zostane;
   4. TOTO zariadenie sa zosynchronizuje: hodnoty sú späť na záznamoch, žiadny konflikt; čerstvé zariadenie
      z účtu ich má tiež; po zmazaní záznamu starým klientom zrkadlo zanikne.
   Každé zariadenie má vlastný server/port (vlastný origin = vlastné úložisko). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, Observer, loadCreds, readPublicConfig, waitFor } = require('./lib');
const HELPERS = require('./helpers');

const REPO = path.resolve(__dirname, '..', '..');
const NEW_PORT = 8172, OLD_PORT = 8173;
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-old-bodyfat');
const PROFILES = path.join(WORK, 'profiles');
const J = JSON.stringify;
let nextPort = 9780;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + String(typeof info === 'string' ? info : J(info)).slice(0, 1500) : '')); }
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
const BF = `(() => JSON.stringify(state.measurements.map((m) => [m.id, m.date, m.neckCm === undefined ? null : m.neckCm, m.bodyFatPct === undefined ? null : m.bodyFatPct, m.waistCm, m.weightKg])))()`;

(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  const cfg = readPublicConfig(REPO);
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(cfg.url)) { console.log('REFUSING: not the local stack'); process.exit(2); }
  const ref = (process.env.GQ_OLD_REFS || 'b33623d').split(',')[0].trim();
  const A = loadCreds('a');
  const obsA = await new Observer(cfg, A).login();
  const newSrv = await startServer(NEW_PORT, { new: REPO });
  const OLD = path.join(WORK, 'old-' + ref);
  fs.rmSync(OLD, { recursive: true, force: true }); fs.mkdirSync(OLD, { recursive: true });
  require('child_process').execSync('git archive ' + ref + ' | tar -x -C ' + J(OLD), { cwd: REPO, shell: '/bin/bash' });
  const ver = /CACHE_VERSION = '(v\d+)'/.exec(fs.readFileSync(path.join(OLD, 'sw.js'), 'utf8'))[1];
  const oldSrv = await startServer(OLD_PORT, { old: OLD });
  oldSrv.setRoot('old');
  console.log('\n== old build ' + ref + ' (' + ver + ') <-> this build, body fat / neck round trip');
  try {
    await obsA.reset();
    /* --- 1. tento build uloží a nahrá --- */
    const n = await launch('bf-new');
    await n.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(n.p);
    try { await n.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
    await R(n.p);
    await n.p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); switchTab('pokrok'); setPokrokView('body'); return true; })()`);
    const fill = (p, o) => p.eval(`(() => { const o = ${J(o)}; for (const k of Object.keys(o)) { const el = document.getElementById('bf-' + k); el.value = o[k]; el.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
    await fill(n.p, { date: '2026-11-01', sex: 'male', height: '180', neck: '38', waist: '85' });
    await n.p.eval(`(document.getElementById('btn-bf-save').click(), true)`);
    await n.p.eval(`(document.activeElement && document.activeElement.blur(), renderPokrok(), true)`);
    await fill(n.p, { date: '2026-11-08', sex: 'male', height: '180', neck: '37', waist: '83' });
    await n.p.eval(`(document.getElementById('btn-bf-save').click(), true)`);
    await n.p.eval(`(state.measurements.find((m) => m.date === '2026-11-08').weightKg = 79.5, saveState(), true)`);
    await n.p.eval('__gq.syncNow()');
    const mine = JSON.parse(await n.p.eval(BF));
    check('this build saved 2 measurements with neck + body fat', mine.length === 2 && mine.every((r) => r[2] > 0 && r[3] >= 3), mine);
    const c0 = await obsA.row();
    const p0 = c0 && c0.payload;
    check('uploaded payload: records carry neckCm/bodyFatPct AND settings.measureExtra mirrors them', !!p0 && p0.measurements.every((m) => m.neckCm > 0 && m.bodyFatPct >= 3) && !!p0.settings.measureExtra && Object.keys(p0.settings.measureExtra).length === 2 && p0.measurements.every((m) => p0.settings.measureExtra[m.id].bodyFatPct === m.bodyFatPct && p0.settings.measureExtra[m.id].neckCm === m.neckCm), p0 && { m: p0.measurements, x: p0.settings.measureExtra });
    const s0 = await n.p.eval('__gq.snap()');
    check('this build synced, nothing pending', s0.status === 'sync.st.synced' && s0.dirty === false, s0.status);

    /* --- 2. starý build načíta, zmení nesúvisiace pole, nahrá --- */
    const o = await launch('bf-old');
    await o.p.navigate('http://localhost:' + OLD_PORT + '/');
    await o.p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 120000);
    await o.p.reload(); await R(o.p);
    try { await o.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
    await R(o.p);
    await waitFor(async () => (await o.p.eval('__gq.snap()')).plans !== undefined && JSON.parse(await o.p.eval(BF)).length === 2, 90000, 'old device loaded the account');
    const oldSees = JSON.parse(await o.p.eval(BF));
    check('PREMISE: the old build (v105 code) dropped neckCm and bodyFatPct from the records it loaded (loss at record level)', oldSees.length === 2 && oldSees.every((r) => r[2] === null && r[3] === null) && oldSees.every((r, i) => r[4] === mine[i][4] && r[5] === mine[i][5]), oldSees);
    check('old build: settings.measureExtra is untouched in its memory', await o.p.eval(`Object.keys(state.settings.measureExtra || {}).length === 2`));
    await o.p.eval(`__gq.addWorkout('old-bf-w1', '2026-10-25')`);
    await o.p.eval('__gq.syncNow()');
    const so = await o.p.eval('__gq.snap()');
    const c1 = await obsA.row();
    check('old build uploaded exactly one new revision, synced, no conflict', c1.revision === c0.revision + 1 && so.status === 'sync.st.synced' && !(so.meta && so.meta.conflict), { rev: [c0.revision, c1.revision], st: so.status });
    check('PREMISE: cloud records no longer carry the new fields after the old upload', c1.payload.measurements.every((m) => m.neckCm === undefined && m.bodyFatPct === undefined));
    check('SURVIVAL: cloud settings.measureExtra is identical after the old upload', J(c1.payload.settings.measureExtra) === J(p0.settings.measureExtra), c1.payload.settings.measureExtra);
    check('old build: no page errors', o.p.errors.length === 0, o.p.errors);

    /* --- 3. tento build sa znovu zosynchronizuje --- */
    await n.p.eval('__gq.syncNow()');
    const n1 = await n.p.eval('__gq.snap()');
    const back = JSON.parse(await n.p.eval(BF));
    check('this build pulled the old device change, synced, no conflict', n1.hist.includes('old-bf-w1') && n1.status === 'sync.st.synced' && !(n1.meta && n1.meta.conflict), { st: n1.status });
    check('this build: neckCm + bodyFatPct restored exactly on the records (same ids, values, waist, weight)', J(back) === J(mine), { back, mine });
    check('this build: values show in history and chart chips again', await n.p.eval(`/Body fat/.test(document.getElementById('body-history').textContent) && [...document.querySelectorAll('#body-metric-chips .metric-chip')].some((c) => c.dataset.field === 'bodyFatPct')`));
    await n.p.eval('__gq.syncNow()');
    const c2 = await obsA.row();
    check('after the restore the cloud has the fields on the records again (self-healing upload) or at least the mirror', c2.payload.measurements.every((m) => m.bodyFatPct >= 3) || !!c2.payload.settings.measureExtra, c2.revision);
    check('this build: no page errors', n.p.errors.length === 0, n.p.errors);

    /* čerstvé zariadenie z účtu */
    const f = await launch('bf-fresh');
    await f.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(f.p);
    try { await f.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
    await R(f.p);
    await waitFor(async () => JSON.parse(await f.p.eval(BF)).length === 2, 90000, 'fresh device loaded the account');
    check('a fresh device from the account has the same neck + body fat values', J(JSON.parse(await f.p.eval(BF))) === J(mine), await f.p.eval(BF));

    /* --- 4. starý klient zmaže záznam: zrkadlo sa upratuje --- */
    await o.p.eval('__gq.syncNow()');
    await o.p.eval(`(state.measurements = state.measurements.filter((m) => m.date !== '2026-11-01'), saveState(), true)`);
    await o.p.eval('__gq.syncNow()');
    await n.p.eval('__gq.syncNow()');
    const after = JSON.parse(await n.p.eval(BF));
    check('old build deleted one measurement: this build shows one left, with its values intact', after.length === 1 && after[0][1] === '2026-11-08' && after[0][3] === mine[1][3] && after[0][2] === mine[1][2], after);
    check('the mirror lost the deleted record (no orphan)', await n.p.eval(`Object.keys(state.settings.measureExtra || {}).length === 1`));
    o.b.killHard(true);
  } catch (e) { fail++; console.log('  FAIL scenario error: ' + String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
  while (browsers.length) { const b = browsers.pop(); try { b.killHard(true); } catch (e) {} }
  await oldSrv.close();
  try { await obsA.reset(); } catch (e) {}
  await newSrv.close();
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
