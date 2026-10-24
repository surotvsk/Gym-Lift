'use strict';
/* GymQuest — updating an installed app to the Bento design (v78) keeps every piece of data.
   Real headless Chrome, no accounts. The previous release (git HEAD~N tree, GQ_OLD_ROOT, default:
   exported from git ref GQ_OLD_REF or HEAD) is installed and filled with data, then updated through
   its service worker to this build.

     node tests/app/bento-update.js

   Checks: plans, workout history (incl. per-set / per-side values, drop sets), calendar, measurements,
   food log, settings, rest timers, excused weeks, achievements, the workspace registry and sync
   metadata, progress photos and personal exercise media (IndexedDB, byte-for-byte) are identical after
   the update; the new design is active; nothing is lost after a second reload; no errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-bento-update');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const OLD = process.env.GQ_OLD_ROOT || path.join(WORK, 'old-build');
  if (!process.env.GQ_OLD_ROOT) {
    fs.rmSync(OLD, { recursive: true, force: true }); fs.mkdirSync(OLD, { recursive: true });
    require('child_process').execSync('git archive ' + (process.env.GQ_OLD_REF || 'HEAD') + ' | tar -x -C ' + JSON.stringify(OLD), { cwd: REPO, shell: '/bin/bash' });
  }
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { old: OLD, new: REPO });
  const b = new Browser('bupd-' + Date.now().toString(36), 9876, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const HELPERS = require(REPO + '/tests/sync/helpers');
  /* všetko, čo appka ukladá: localStorage (okrem čisto technických kľúčov) + médiá v IndexedDB */
  const snapshot = () => p.eval(`(async () => {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^gymquest/.test(k) && k !== 'gymquest_theme') ls[k] = localStorage.getItem(k); }
    if (!mediaDb) mediaDb = await openMediaDb();
    const media = await window.__gq.mediaHashes();
    const prog = (await idbGetAll(PROGRESS_META_STORE)).map((m) => m.id).sort();
    return { ls, media, prog, cacheKeys: await caches.keys() }; })()`);
  try {
    server.setRoot('old');
    await p.navigate(BASE);
    await p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 120000);
    await p.reload(); await p.eval(HELPERS);
    const oldVer = await p.eval(`(caches.keys()).then((k) => k.join(','))`);
    check('the previous release is installed and controls the page (' + oldVer + ')', await p.eval('!!navigator.serviceWorker.controller') && /gymquest-v\d+/.test(oldVer));
    check('the previous release has no Bento design yet', !(await p.eval(`document.documentElement.hasAttribute('data-theme')`)));

    console.log('== a full set of user data in the old app');
    await p.eval(`(async () => {
      const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click();
      setLang('sk');
      state.plans['my-legs'] = { id: 'my-legs', builtin: false, customName: 'Moje nohy', location: null,
        exercises: [{ id: 'squats', name: 'Squats', builtin: true, sets: 4, reps: 8, weight: 80 }, { id: 'cx-curl', name: 'Jednoručný bicepsový zdvih', sets: 2, reps: 12, weight: 10, unilateral: true, startSide: 'left' }] };
      state.planOrder.push('my-legs');
      for (let i = 0; i < 9; i++) state.history.push({ id: 'h' + i, planId: 'my-legs', planName: 'Moje nohy', date: '2026-09-' + String(10 + i * 2).padStart(2, '0'), xp: 40 + i, note: i === 3 ? 'Ťažký deň 💪' : '', durationSeconds: 2400 + i * 60,
        exercises: [{ name: 'Squats', exId: 'squats', sets: 4, reps: 8, weight: 80 + i, setsDone: 4, setWeights: [80, 80 + i, 80 + i, 75], plannedWeight: 80, setReps: [8, 8, 6, 6], drops: [{ weight: 60, reps: 8 }], actualFailureSets: [4], plannedFailureSets: [] },
          { name: 'Jednoručný bicepsový zdvih', sets: 2, reps: 12, weight: 10, setsDone: 4, unilateral: true, startSide: 'left', sidesDone: { left: [1, 2], right: [1, 2] }, sidesFailure: { left: [], right: [2] }, actualFailureSets: [2], sideReps: { left: [12, 10], right: [12, 9] }, setReps: [12, 10] }] });
      state.measurements.push(cleanMeasurement({ id: 'm1', date: '2026-09-12', weightKg: 81.4 }), cleanMeasurement({ id: 'm2', date: '2026-10-01', weightKg: 80.2 }));
      state.settings.weeklyGoal = 4; state.excusedWeeks = ['2026-W38'];
      reconcileAchievements(); saveState();
      await window.__gq.addProgress('photo1', 'front-week6');
      await window.__gq.addPersonal('vid1', 'my-squat', 'squats');
      renderAll(); return true; })()`);
    await wait(500);
    /* stav po bežnom načítaní STAREJ verzie (tá pri štarte dopĺňa prázdne polia a cieľ týždňa) */
    await p.reload(); await p.eval(HELPERS); await wait(500);
    const before = await snapshot();
    check('data saved in the old app (plans, 9 workouts, measurements, a progress photo, personal media)',
      /Moje nohy/.test(before.ls[await p.eval('STORAGE_KEY')]) && before.prog.length === 1 && Object.keys(before.media).length === 2, { prog: before.prog, media: Object.keys(before.media) });

    console.log('== update to the Bento design through the service worker');
    server.setRoot('new');
    await p.eval(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
    await waitFor(() => p.eval('swUpdateReady === true').catch(() => false), 60000, 'update ready');
    const lu = p.loads;
    await p.eval('(applyUpdate(), true)');
    await waitFor(() => p.loads > lu, 60000, 'update reload');
    await p.ready(); await p.eval(HELPERS);
    const keys = await p.eval('caches.keys()');
    check('the new build runs from its own cache (v78), the old cache is removed', keys.indexOf('gymquest-v78') >= 0 && keys.filter((k) => /^gymquest-v\d+$/.test(k)).length === 1, keys);
    check('the Bento design is active (light by default on a light phone)', (await p.eval(`document.documentElement.getAttribute('data-theme')`)) === 'light' && (await p.eval(`getComputedStyle(document.body).fontFamily`)).includes('Space Grotesk'));
    const after = await snapshot();
    const diff = Object.keys(Object.assign({}, before.ls, after.ls)).filter((k) => before.ls[k] !== after.ls[k]);
    const deepDiff = (a, b, pth, out) => { if (J(a) === J(b)) return out; if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) deepDiff(a[k], b[k], pth + '.' + k, out); } else out.push(pth + ': ' + J(a) + ' → ' + J(b)); return out; };
    const paths = diff.map((k) => { try { return k + deepDiff(JSON.parse(before.ls[k]), JSON.parse(after.ls[k]), '', []).join(' | '); } catch (e) { return k; } });
    console.log('   changed:', J(paths).slice(0, 1500));
    check('every stored value is exactly the same after the update (state, registry, sync metadata, settings)', diff.length === 0, paths);
    check('progress photo and personal exercise media are byte-for-byte the same', J(after.media) === J(before.media) && J(after.prog) === J(before.prog), { before: before.media, after: after.media });
    const shown = await p.eval(`(() => { switchTab('trening'); const plans = Array.from(document.querySelectorAll('.plan-chips .chip')).map((c) => c.textContent); switchTab('pokrok'); setPokrokView('progress'); const hist = document.body.innerText; return { plans, hist: hist.includes('Moje nohy') && hist.includes('Ťažký deň'), n: state.history.length, sides: historyRepsValue(state.history[0].exercises[1]), drops: historyDropsText(state.history[0].exercises[0]) }; })()`);
    check('the user\'s own plan is there, ready to train (no need to create it again)', shown.plans.some((x) => /Moje nohy/.test(x)), shown.plans);
    check('all 9 workouts with notes, per-side reps and drop sets are shown', shown.hist && shown.n === 9 && /12\/10.*12\/9/.test(shown.sides) && /60 kg × 8/.test(shown.drops), shown);
    const cal = await p.eval(`(() => { switchTab('kalendar'); viewYear = 2026; viewMonth = 8; renderKalendar(); return document.querySelectorAll('.cal-cell.cal-done').length; })()`);
    check('the calendar still marks the workout days (September: 9 days)', cal === 9, cal);
    await p.reload(); await p.eval(HELPERS);
    const again = await snapshot();
    check('after another reload everything is still identical', Object.keys(before.ls).every((k) => before.ls[k] === again.ls[k]) && J(again.media) === J(before.media));
    check('no exceptions', p.errors.length === 0, p.errors);
    check('no console errors', logs.length === 0, logs);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
