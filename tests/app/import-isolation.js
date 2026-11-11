'use strict';
/* Gym-Lift — Fáza 3 / úloha 1: importované tréningy (state.importedHistory) sa nikdy nepočítajú do XP, série,
   rekordov, úspechov, rebríčka ani dlaždíc Stats/Dnes; počítajú sa len do prehľadov (graf cviku, svaly, regenerácia).
   Skutočný headless Chrome, bez účtov a siete.

     node tests/app/import-isolation.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-import-isolation');
const J = JSON.stringify;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('impiso-' + Date.now().toString(36), 9899, path.join(WORK, 'profiles'));
  const p = await b.launch();
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    const ev = (expr) => p.eval(`(() => { try { const v = ${expr}; return JSON.stringify(v === undefined ? null : v); } catch (e) { return JSON.stringify({ threw: String(e) }); } })()`).then((s) => JSON.parse(s));

    console.log('== exports + default');
    check('helpers are functions', await ev(`['cleanImportedHistory','insightHistory','isImportedWorkout'].every((n) => { try { return typeof eval(n) === 'function'; } catch (e) { return false; } })`) === true);
    check('defaultState().importedHistory is []', J(await ev(`defaultState().importedHistory`)) === '[]');

    /* fixture: 20 skutočných tréningov + 500 importovaných (3 roky, vrátane tohto týždňa a včerajška) */
    await p.eval(`(() => {
      const day = (n) => localDateKey(addDays(new Date(), -n));
      const ent = (i) => ({ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 60 + (i % 40), setsDone: 3 });
      window.__real = []; for (let i = 0; i < 20; i++) window.__real.push({ id: 'r' + i, week: weekKey(addDays(new Date(), -i * 3)), date: day(i * 3), planId: 'push', planName: 'Push', note: '', durationSeconds: 3000, exercises: [ent(i), { name: 'Squat', exId: 'squats', sets: 3, reps: 5, weight: 100, setsDone: 3 }] });
      window.__imp = []; for (let i = 0; i < 500; i++) { const n = i < 2 ? i : 2 + Math.floor(i * 1090 / 500); window.__imp.push({ id: 'imp-' + i, date: day(n), planName: 'Imported', source: 'strong', importKey: 'k' + i, exercises: [ent(i)] }); }
      window.__imp.push({ id: 'imp-sq', date: day(1), planName: 'Imported', source: 'hevy', importKey: 'ksq', exercises: [{ name: 'Squat', exId: 'squats', sets: 4, reps: 5, weight: 140, setsDone: 4 }] });
      return true;
    })()`);
    const snap = `(() => {
      const ex = { name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 100 };
      evaluateAchievements();
      renderStatsGrid(); renderDnes();
      const g = document.getElementById('stats-grid');
      const tiles = Array.prototype.slice.call(g.children, 0, 3).map((c) => c.textContent);
      return { xp: totalXP(), lvl: levelForXp(totalXP()), streak: computeStreak(), wk: sessionsInWeek(currentWeekKey()),
        pr: personalRecords(), ach: Object.keys(state.achievements || {}).sort(), lb: leaderboardPayload(), tiles,
        wkTile: document.getElementById('week-count').textContent, rec: recommendedPlan(), cmp: comparisonHint(ex, 'push') };
    })()`;
    const apply = (imp) => p.eval(`(() => { state.history = window.__real.slice(); state.importedHistory = ${imp ? 'window.__imp.slice()' : '[]'}; xpCacheClear(); return true; })()`);
    await apply(false);
    const base = await ev(snap);
    check('baseline sane (xp > 0, 20 workouts in payload)', base.xp > 0 && base.lb.p_workouts === 20, [base.xp, base.lb]);
    await apply(true);
    const withImp = await ev(snap);
    for (const k of Object.keys(base)) check('unchanged with 500 imports: ' + k, J(base[k]) === J(withImp[k]), [base[k], withImp[k]]);

    console.log('== insight readers include imports');
    await apply(false);
    const sBase = await ev(`exerciseSeries('bench-press').length`);
    const mBase = await ev(`muscleWeek(currentWeekKey()).totalVolume`);
    const rBase = await ev(`muscleRecovery(Date.now())`);
    await apply(true);
    const sImp = await ev(`exerciseSeries('bench-press').length`);
    check('exerciseSeries has 500+ points more', sImp >= sBase + 400 && sImp >= 500, [sBase, sImp]);
    check('exerciseSessionList includes imports', (await ev(`exerciseSessionList('bench-press').length`)) >= 500);
    check('exerciseSummary counts imports', (await ev(`exerciseSummary('bench-press').sessions`)) >= 500);
    check('muscleWeek(current) includes imported sets', (await ev(`muscleWeek(currentWeekKey()).totalVolume`)) > mBase, mBase);
    const rImp = await ev(`muscleRecovery(Date.now())`);
    check('muscleRecovery reflects imported workout from yesterday', J(rImp) !== J(rBase), [rBase, rImp]);
    check('muscleMaxOffset reaches the oldest import', (await ev(`muscleMaxOffset()`)) > 100);
    check('isImportedWorkout', await ev(`[isImportedWorkout(window.__imp[0]), isImportedWorkout(window.__real[0]), isImportedWorkout(null)]`).then((a) => J(a) === '[true,false,false]'));
    check('insightHistory memoised (same array twice)', await ev(`insightHistory() === insightHistory()`) === true);
    check('insightHistory refreshes on push', await ev(`(() => { const a = insightHistory().length; state.importedHistory.push({ id: 'z', date: todayISO(), planName: 'x', source: 'csv', importKey: 'z', exercises: [] }); const r = insightHistory().length === a + 1; state.importedHistory.pop(); return r; })()`) === true);

    console.log('== junk in importedHistory');
    const good = { id: 'g1', date: '2026-03-01', planName: 'Strong', source: 'strong', importKey: 'abc', durationSeconds: 3600, note: 'ok', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 82.5, setsDone: 3, setWeights: [80, 82.5, 85] }] };
    await p.eval(`(() => { const s = defaultState(); s.importedHistory = [null, 'x', 5, [], {}, { id: 'a', date: '2026-01-01' }, { id: 'b', date: 'bad', planName: 'p', source: 'strong', importKey: 'k', exercises: [] }, ${J(good)}, { id: 'c', date: '2026-01-01', planName: 'p', source: 'nope', importKey: 'k', exercises: [] }]; localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); return true; })()`);
    await p.reload();
    const loaded = await ev(`state.importedHistory`);
    check('only the valid entry kept, byte-identical', J(loaded) === J([good]), loaded);
    check('cleanImportedHistory never throws on junk input', await ev(`[undefined, null, 5, 'x', {}, [null]].map((v) => cleanImportedHistory(v).length)`).then((a) => J(a) === '[0,0,0,0,0,0]'));
    await p.eval(`(() => { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); s.importedHistory = 'garbage'; localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); return true; })()`);
    await p.reload();
    check('non-array importedHistory loads as []', J(await ev(`state.importedHistory`)) === '[]');
    check('JSON import normaliser cleans too', await ev(`migrateV2toV3({ version: 3, importedHistory: [null, ${J(good)}] }).importedHistory.length`) === 1);

    console.log('== sync hash');
    await p.reload();
    const h0 = await p.eval(`syncContentHash(state, {})`);
    await p.eval(`state.importedHistory = [${J(good)}]; true`);
    const h1 = await p.eval(`syncContentHash(state, {})`);
    check('adding an import changes the sync content hash', h0 !== h1);
    check('importedHistory is in the synced scope', await ev(`'importedHistory' in syncScope(state)`) === true);
    await p.eval(`state.activeSession = { planId: 'push', startedAt: 1, exercises: [] }; true`);
    const h2 = await p.eval(`syncContentHash(state, {})`);
    check('device-only keys do not change the hash', h1 === h2);
    await p.eval(`state.activeSession = null; true`);

    console.log('== stateMeaningful (sync data safety)');
    check('fresh default state is not meaningful', await ev(`stateMeaningful(defaultState())`) === false);
    check('imports-only state is meaningful', await ev(`(() => { const s = defaultState(); s.importedHistory = [${J(good)}]; return stateMeaningful(s); })()`) === true);
    check('imports-only state is meaningful after syncNormalize', await ev(`(() => { const s = defaultState(); s.importedHistory = [${J(good)}]; const n = syncNormalize(s); return [n.importedHistory.length, stateMeaningful(n)]; })()`).then((a) => J(a) === '[1,true]'));

    console.log('== performance (3000 imports)');
    await p.eval(`(() => { const day = (n) => localDateKey(addDays(new Date(), -n)); state.history = []; state.importedHistory = []; for (let i = 0; i < 3000; i++) state.importedHistory.push({ id: 'p' + i, date: day(i % 1095), planName: 'Imported', source: 'hevy', importKey: 'p' + i, exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 60 + (i % 40), setsDone: 3 }, { name: 'Squat', exId: 'squats', sets: 3, reps: 5, weight: 100, setsDone: 3 }] }); xpCacheClear(); return true; })()`);
    const t1 = await p.eval(`(() => { const t = performance.now(); renderStatsGrid(); return performance.now() - t; })()`);
    const t2 = await p.eval(`(() => { const t = performance.now(); openExerciseProgress('bench-press', 'Bench Press'); return performance.now() - t; })()`);
    check('Stats opens < 300 ms (' + Math.round(t1) + ' ms)', t1 < 300, t1);
    check('progress sheet opens < 300 ms (' + Math.round(t2) + ' ms)', t2 < 300, t2);

    check('no page errors', p.errors.length === 0, p.errors.slice(0, 3));
  } catch (e) {
    check('no exception', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
    console.log(`\n==== checks: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  }
})();
