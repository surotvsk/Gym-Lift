'use strict';
/* Gym-Lift — Prehľad, fáza 2 / úloha 2: série z histórie, odhad 1RM, rad cviku (čisté funkcie), v reálnom headless Chrome.
   Bez účtov a siete.

     node tests/app/insight-data.js

   Kontroly: historyWorkingSets (obyčajný, po sériách, jednostranný, zlyhanie, RPE, rozcvičky/drop série mimo),
   historyDropSets, e1rm (Epley po 0.5, hranice), entryIdentity, exerciseSeries / exerciseSummary (spojenie
   názvov, asistované, spojenie viacerých záznamov v jednom tréningu), odolnosť voči zlým dátam,
   personalRecords() nezmenené, endedAt pri novom ukončení a starý záznam bez endedAt. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-insight-data');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const b = new Browser('insight-' + Date.now().toString(36), 9898, path.join(WORK, 'profiles'));
  const p = await b.launch();
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    const ev = (expr) => p.eval(`(() => { try { return JSON.stringify(${expr}); } catch (e) { return JSON.stringify({ threw: String(e) }); } })()`).then((s) => JSON.parse(s));
    const same = (a, b2) => J(a) === J(b2);

    console.log('== exports exist');
    check('all helpers are functions', await p.eval(`['historyWorkingSets','historyDropSets','e1rm','entryIdentity','exerciseSeries','exerciseSummary'].every((n) => typeof window[n] === 'function' || (function(){ try { return typeof eval(n) === 'function'; } catch (e) { return false; } })())`));

    console.log('== e1rm');
    check('e1rm(100, 8) = 126.5', (await ev(`e1rm(100, 8)`)) === 126.5);
    check('e1rm(80, 1) = 80', (await ev(`e1rm(80, 1)`)) === 80);
    check('e1rm(100, 13) = null', (await ev(`e1rm(100, 13)`)) === null);
    check('e1rm(100, 12) is a number (upper bound)', (await ev(`e1rm(100, 12)`)) === 140);
    check('e1rm(0, 5) = null, negative weight null, reps 0 null', (await ev(`[e1rm(0, 5), e1rm(-5, 5), e1rm(50, 0)]`)).every((v) => v === null));
    check('e1rm junk = null', (await ev(`[e1rm('a', 5), e1rm(50, NaN), e1rm(null, null), e1rm(), e1rm(Infinity, 5)]`)).every((v) => v === null));

    console.log('== historyWorkingSets');
    const plain = { name: 'Bench', exId: 'bench-press', sets: 3, reps: 8, weight: 100, setsDone: 3 };
    check('plain 3x8 @100', same(await ev(`historyWorkingSets(${J(plain)})`), [1, 2, 3].map((n) => ({ set: n, side: null, weight: 100, reps: 8, rpe: null, failure: false }))));
    const per = { name: 'Bench', exId: 'bench-press', sets: 3, reps: 8, weight: 110, setsDone: 2, setWeights: [100, 105, 110], setReps: [8, 6, 4], setRpe: [8, null, 9.5] };
    check('per-set values; sets 1 and 3 done (marked by their RPE), set 2 skipped',
      same(await ev(`historyWorkingSets(${J(per)})`), [{ set: 1, side: null, weight: 100, reps: 8, rpe: 8, failure: false }, { set: 3, side: null, weight: 110, reps: 4, rpe: 9.5, failure: false }]));
    const fail1 = { name: 'X', sets: 3, reps: 5, weight: 50, setsDone: 3, actualFailureSets: [3] };
    check('failure flag from actualFailureSets', same((await ev(`historyWorkingSets(${J(fail1)})`)).map((s) => s.failure), [false, false, true]));
    const prefix = { name: 'X', sets: 4, reps: 5, weight: 50, setsDone: 2 };
    check('setsDone 2 of 4 without marks -> sets 1 and 2', same((await ev(`historyWorkingSets(${J(prefix)})`)).map((s) => s.set), [1, 2]));
    const failFill = { name: 'X', sets: 4, reps: 5, weight: 50, setsDone: 2, actualFailureSets: [4] };
    check('a failure mark counts as done and takes a slot', same((await ev(`historyWorkingSets(${J(failFill)})`)).map((s) => s.set), [1, 4]));
    const uni = { name: 'Curl', exId: 'x', unilateral: true, sets: 2, reps: 10, weight: 20, setsDone: 3, sidesDone: { left: [1, 2], right: [1] },
      setWeights: [20, 22], sideWeights: { left: [20, 22], right: [18, 19] }, setReps: [10, 10], sideReps: { left: [10, 9], right: [8, 8] },
      sideRpe: { left: [8, null], right: [9, null] }, sidesFailure: { left: [2], right: [] } };
    check('unilateral: 3 sets with sides, per-side weights and reps', same(await ev(`historyWorkingSets(${J(uni)})`), [
      { set: 1, side: 'left', weight: 20, reps: 10, rpe: 8, failure: false },
      { set: 2, side: 'left', weight: 22, reps: 9, rpe: null, failure: true },
      { set: 1, side: 'right', weight: 18, reps: 8, rpe: 9, failure: false }]));
    const uni2 = { name: 'Curl', unilateral: true, sets: 2, reps: 10, weight: 20, setsDone: 2, sidesDone: { left: [1], right: [2] } };
    check('unilateral without per-side values uses weight x reps', same((await ev(`historyWorkingSets(${J(uni2)})`)).map((s) => [s.set, s.side, s.weight, s.reps]), [[1, 'left', 20, 10], [2, 'right', 20, 10]]));
    const mix = { name: 'Squat', sets: 2, reps: 5, weight: 100, setsDone: 2, warmups: [{ weight: 40, reps: 10 }, { weight: 60, reps: 5 }], drops: [{ weight: 80, reps: 6 }] };
    check('warm-ups and drops are never working sets', same((await ev(`historyWorkingSets(${J(mix)})`)).map((s) => s.weight), [100, 100]));
    check('setsDone 0 -> []', same(await ev(`historyWorkingSets(${J({ name: 'X', sets: 3, reps: 5, weight: 40, setsDone: 0 })})`), []));
    check('old entry without setsDone: all sets count', (await ev(`historyWorkingSets(${J({ name: 'X', sets: 3, reps: 5, weight: 40 })})`)).length === 3);
    check('invalid per-set array (wrong length) falls back to weight x reps', same((await ev(`historyWorkingSets(${J({ name: 'X', sets: 3, reps: 5, weight: 40, setsDone: 3, setWeights: [1, 2] })})`)).map((s) => s.weight), [40, 40, 40]));

    console.log('== historyDropSets');
    check('drops listed via cleanHistoryDrops', same(await ev(`historyDropSets(${J(mix)})`), [{ weight: 80, reps: 6 }]));
    check('no drops / junk -> []', same(await ev(`[historyDropSets({}), historyDropSets(null), historyDropSets({ drops: [{ weight: 'x', reps: 1 }] })]`), [[], [], []]));

    console.log('== junk never throws');
    const junk = [null, undefined, 0, 'x', [], {}, { sets: 'a', setsDone: 'b', weight: 'c', reps: 'd' }, { name: 'X', sets: 3, reps: 5, weight: 'heavy', setsDone: 3 },
      { name: 'X', setsDone: 3, sets: 3, weight: 50, reps: 'many' }, { name: 'X', sets: 3, weight: 50, reps: 5, setsDone: 3, setWeights: 'abc', sideWeights: 7, drops: 'q', warmups: null },
      { unilateral: true, sets: 2, sidesDone: 'x' }, { unilateral: true, sets: 2, reps: 5, weight: 5, sidesDone: { left: 'a', right: null } }];
    const jr = await ev(`${J(junk)}.map((e) => { try { const r = historyWorkingSets(e); const d = historyDropSets(e); const id = entryIdentity(e); return Array.isArray(r) && Array.isArray(d) ? r.length : 'bad'; } catch (x) { return 'threw'; } })`);
    check('junk entries -> arrays, no throw', jr.every((v) => typeof v === 'number'), jr);
    check('string numbers are rejected', (await ev(`historyWorkingSets({ name: 'X', sets: 3, reps: 5, weight: 'heavy', setsDone: 3 }).length`)) === 0 && (await ev(`historyWorkingSets({ name: 'X', sets: 3, reps: 'many', weight: 50, setsDone: 3 }).length`)) === 0);

    console.log('== entryIdentity');
    check('built-in exId wins', (await ev(`entryIdentity({ name: 'Anything', exId: 'bench-press' })`)) === 'bench-press');
    check('custom: normalised name -> cx- id (equals exerciseIdentity)', (await ev(`entryIdentity({ name: '  môj   ZDVIH ' })`)) === (await ev(`exerciseIdentity({ name: 'Môj zdvih' })`)) && /^cx-/.test(await ev(`entryIdentity({ name: 'Môj zdvih' })`)));
    check('unknown exId falls back to the name identity', (await ev(`entryIdentity({ name: 'Foo', exId: 'nope' })`)) === (await ev(`exerciseIdentity({ name: 'Foo' })`)));
    check('junk -> null', same(await ev(`[entryIdentity(null), entryIdentity({}), entryIdentity({ name: '  ' })]`), [null, null, null]));

    console.log('== exerciseSeries / exerciseSummary');
    await p.eval(`(() => {
      state.history = [
        { id: 'w3', planId: 'pb', planName: 'B', date: '2026-10-20', xp: 30, note: '', endedAt: 1760000000000, exercises: [
          { name: 'Bench press', exId: 'bench-press', sets: 3, reps: 8, weight: 100, setsDone: 3 }] },
        { id: 'w1', planId: 'pa', planName: 'A', date: '2026-10-01', xp: 30, note: '', exercises: [
          { name: 'Tlak na lavičke', exId: 'bench-press', sets: 3, reps: 8, weight: 100, setsDone: 3, warmups: [{ weight: 40, reps: 8 }], drops: [{ weight: 60, reps: 10 }] },
          { name: 'Môj zdvih', sets: 2, reps: 5, weight: 50, setsDone: 2 },
          { name: 'Assisted dips', exId: 'assisted-dips', sets: 3, reps: 8, weight: 30, setsDone: 3, assisted: true, setWeights: [30, 25, 20] }] },
        { id: 'w2', planId: 'pa', planName: 'A', date: '2026-10-10', xp: 30, note: '', exercises: [
          { name: 'Bench press', exId: 'bench-press', sets: 3, reps: 8, weight: 110, setsDone: 3, setWeights: [100, 105, 110], setReps: [8, 6, 4] },
          { name: 'Bench press', exId: 'bench-press', sets: 1, reps: 10, weight: 80, setsDone: 1 },
          { name: '  môj   ZDVIH ', sets: 2, reps: 5, weight: 55, setsDone: 2 }] },
      ];
      return true; })()`);
    const ser = await ev(`exerciseSeries('bench-press')`);
    check('bench-press: 3 points in plan/language-agnostic, sorted by date', ser.length === 3 && same(ser.map((s) => s.date), ['2026-10-01', '2026-10-10', '2026-10-20']), ser);
    check('plain point: e1rm 126.5, topWeight 100, volume 2400 + drops 600 = 3000, 3 sets, bestSet 100x8',
      ser[0].e1rm === 126.5 && ser[0].topWeight === 100 && ser[0].volume === 3000 && ser[0].sets === 3 && same(ser[0].bestSet, { weight: 100, reps: 8 }) && ser[0].assisted === false && ser[0].workoutId === 'w1', ser[0]);
    check('merged point (two entries one workout): sets 4, volume = 800+630+440+800, topWeight 110, best e1rm',
      ser[1].sets === 4 && ser[1].volume === 800 + 630 + 440 + 800 && ser[1].topWeight === 110 && ser[1].e1rm === 126.5 && ser[1].workoutId === 'w2', ser[1]);
    const cus = await ev(`exerciseSeries(entryIdentity({ name: 'Môj zdvih' }))`);
    check('custom "Môj zdvih" and "  môj   ZDVIH " give one series', cus.length === 2 && cus[0].topWeight === 50 && cus[1].topWeight === 55, cus);
    const ass = await ev(`exerciseSeries('assisted-dips')`);
    check('assisted: e1rm and volume null, topWeight = least help (20)', ass.length === 1 && ass[0].e1rm === null && ass[0].volume === null && ass[0].topWeight === 20 && ass[0].assisted === true && ass[0].sets === 3, ass);
    check('unknown / empty identity -> []', same(await ev(`[exerciseSeries('nope'), exerciseSeries(null), exerciseSeries('')]`), [[], [], []]));
    const sum = await ev(`exerciseSummary('bench-press')`);
    check('summary: bestE1rm 126.5, heaviest 110, bestSet 100x8, bestVolume 2670 or 3000 max, sessions 3',
      sum.bestE1rm === 126.5 && sum.heaviest === 110 && same(sum.bestSet, { weight: 100, reps: 8 }) && sum.bestVolume === 3000 && sum.sessions === 3, sum);
    check('summary of assisted: no 1RM / volume, sessions 1', same(await ev(`(() => { const s = exerciseSummary('assisted-dips'); return [s.bestE1rm, s.bestVolume, s.sessions]; })()`), [null, null, 1]));
    check('summary of nothing is empty, not NaN', same(await ev(`exerciseSummary('nope')`), { bestE1rm: null, heaviest: null, bestSet: null, bestVolume: null, sessions: 0 }));

    console.log('== derived data is read-only');
    const rec1 = await ev(`personalRecords()`);
    const snap = await p.eval(`JSON.stringify(state.history)`);
    await ev(`(exerciseSeries('bench-press'), exerciseSummary('bench-press'), true)`);
    check('personalRecords() unchanged by the helpers, history not mutated', same(rec1, await ev(`personalRecords()`)) && snap === (await p.eval(`JSON.stringify(state.history)`)));
    check('personalRecords() ignores endedAt and does not include warm-up weights', rec1.every((r) => r.weight !== 40));

    const jw = await ev(`(() => { const keep = state.history; state.history = keep.concat([null, { id: 'bad', date: 5, exercises: 'x' }, { id: 'bad2', date: '2026-10-11' }, { id: 'bad3', date: '2026-10-12', exercises: [null, 'x', { name: 'Bench press', exId: 'bench-press', sets: 'a' }] }]);
      try { return exerciseSeries('bench-press').length; } finally { state.history = keep; } })()`);
    check('junk workouts add no points and do not throw', jw === 3, jw);

    console.log('== endedAt');
    await p.eval(`(() => {
      state.history = [{ id: 'old', planId: 'pa', planName: 'A', date: '2026-10-01', xp: 10, note: '', exercises: [{ name: 'Bench press', exId: 'bench-press', sets: 3, reps: 8, weight: 100, setsDone: 3 }] }];
      state.plans['itest'] = { id: 'itest', builtin: false, customName: 'Insight test', location: null, exercises: [{ id: 'bench-press', name: 'Bench', sets: 2, reps: 5, weight: 100 }] };
      if (!state.planOrder.includes('itest')) state.planOrder.push('itest');
      selectedPlan = 'itest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    await p.eval(`(document.querySelector('#exercise-list .exercise .set-item:not(.drop-item) .set-btn').click(), true)`);
    const t0 = Date.now();
    await p.eval(`(finishWorkout(), confirmFinish(), true)`);
    await wait(300);
    const last = await ev(`state.history[state.history.length - 1]`);
    check('a new finish gets a finite endedAt within 5 s of now', Number.isFinite(last.endedAt) && last.endedAt > 0 && Math.abs(last.endedAt - Date.now()) < 5000 && last.endedAt >= t0 - 5000, last.endedAt);
    check('endedAt survives save and reload', await (async () => { await p.reload(); await wait(300); return (await ev(`state.history[state.history.length - 1].endedAt`)) === last.endedAt; })());
    check('the old entry without endedAt still loads and renders', await (async () => {
      await p.eval(`(switchTab('historia') , true)`).catch(() => {});
      await p.eval(`(typeof renderHistory === 'function' && renderHistory(), true)`).catch(() => {});
      return (await ev(`state.history[0].endedAt === undefined && state.history[0].id === 'old'`)) === true;
    })());
    check('no exceptions', p.errors.length === 0, p.errors);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
