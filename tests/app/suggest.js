'use strict';
/* Gym-Lift — suggestion engine (gym-basics phase 4, task 1), in real headless Chrome. No accounts, no network.

     node tests/app/suggest.js

   Pure function suggestNext(ex, planId, today): up / up2 / keep / reset / lessHelp / keepHelp / moreHelp
   or null. Plus suggestStep(ex) and the i18n reason strings (6 languages). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-suggest');
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
  const b = new Browser('suggest-' + Date.now().toString(36), 9874, path.join(WORK, 'profiles'));
  const p = await b.launch();
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    // fixtures: plan 'sp'; history entries with planId; dates are fixed, today is passed explicitly
    await p.eval(`(() => {
      window.T = '2026-11-11';
      state.plans.sp = { id: 'sp', name: 'SP', exercises: [] };
      state.plans.other = { id: 'other', name: 'Other', exercises: [] };
      window.hist = (list) => { state.history = list.map((w, i) => ({ id: 'h' + i, date: w.date, planId: w.planId || 'sp', planName: 'SP', exercises: w.exercises })); };
      window.bench = (over) => Object.assign({ exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100 }, over || {});
      window.exBench = () => ({ id: 'bench-press', builtin: true, name: 'Bench press', sets: 3, reps: 5, weight: 100 });
      return true;
    })()`);
    const S = (expr) => p.eval(`(() => { try { return ${expr}; } catch (e) { return 'THROW ' + e.message; } })()`);
    const set = (list) => p.eval(`(hist(${J(list)}), true)`);
    const W = (date, e) => ({ date, exercises: [e] });
    const bench = (over) => Object.assign({ exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100 }, over || {});
    const next = (exExpr) => S(`suggestNext(${exExpr || 'exBench()'}, 'sp', T)`);

    console.log('== barbell bench');
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100 })]);
    let r = await next();
    check('all reps hit, no RPE -> up 102.5, reps 5', r && r.kind === 'up' && r.weight === 102.5 && r.reps === 5, r);
    check('result carries reasonKey and vars', r && r.reasonKey === 'suggest.up' && r.vars && r.vars.kg === 102.5 && r.vars.reps === 5, r);
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setRpe: [7, 7, 7] })]);
    r = await next();
    check('RPE 7 -> up2 105', r && r.kind === 'up2' && r.weight === 105, r);
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setRpe: [9.5, 10, 9.5] })]);
    r = await next();
    check('RPE >= 9.5 -> keep 100', r && r.kind === 'keep' && r.weight === 100, r);
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setRpe: [8, 8, 8] })]);
    r = await next();
    check('RPE 8 -> up 102.5', r && r.kind === 'up' && r.weight === 102.5, r);

    console.log('== short of reps');
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setReps: [5, 5, 4] })]);
    r = await next();
    check('5,5,4 -> keep 100', r && r.kind === 'keep' && r.weight === 100, r);
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setReps: [5, 5, 4] }),
               W('2026-11-04', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setReps: [5, 4, 4] })]);
    r = await next();
    check('two short sessions in a row -> reset 90', r && r.kind === 'reset' && r.weight === 90, r);
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setReps: [5, 5, 4] }),
               W('2026-11-04', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100 })]);
    r = await next();
    check('short then hit -> not reset (up)', r && r.kind === 'up', r);
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100 }),
               W('2026-11-04', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setReps: [5, 5, 4] })]);
    r = await next();
    check('hit then short -> keep, not reset', r && r.kind === 'keep', r);
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setReps: [5, 5, 4] }),
               { date: '2026-11-03', planId: 'other', exercises: [{ exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100 }] },
               W('2026-11-04', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setReps: [5, 4, 4] })]);
    r = await next();
    check('another plan in between is ignored (still reset)', r && r.kind === 'reset', r);
    await set([W('2026-11-04', { exId: 'bench-press', name: 'Bench press', sets: 2, reps: 5, weight: 100 })]);
    r = await next();
    check('fewer sets done than planned -> keep', r && r.kind === 'keep', r);

    console.log('== step sizes');
    check('legs (squats) step 5', await S(`suggestStep({ id: 'squats', builtin: true, name: 'Squats' })`) === 5);
    check('glutes primary step 5', await S(`(() => { const g = EXERCISE_LIBRARY.find(e => e.primary === 'glutes' && e.equipment.includes('dumbbells')) || EXERCISE_LIBRARY.find(e => e.primary === 'glutes'); return suggestStep({ id: g.id, builtin: true, name: g.id }); })()`) === 5);
    check('dumbbell exercise step 2', await S(`suggestStep({ id: 'lateral-raises', builtin: true, name: 'x' })`) === 2);
    check('custom exercise step 2.5', await S(`suggestStep({ name: 'My custom lift' })`) === 2.5);
    check('junk never throws (step 2.5)', await S(`[suggestStep(null), suggestStep(undefined), suggestStep(5)].join()`) === '2.5,2.5,2.5');
    await set([W('2026-11-01', { exId: 'squats', name: 'Squats', sets: 3, reps: 5, weight: 100 })]);
    r = await S(`suggestNext({ id: 'squats', builtin: true, name: 'Squats', sets: 3, reps: 5, weight: 100 }, 'sp', T)`);
    check('squats 100 -> up 105', r && r.kind === 'up' && r.weight === 105, r);
    await set([W('2026-11-01', { exId: 'lateral-raises', name: 'Lateral raises', sets: 3, reps: 12, weight: 10 })]);
    r = await S(`suggestNext({ id: 'lateral-raises', builtin: true, name: 'Lateral raises', sets: 3, reps: 12, weight: 10 }, 'sp', T)`);
    check('dumbbell 10 -> up 12 (not plate-rounded)', r && r.kind === 'up' && r.weight === 12, r);
    await set([W('2026-11-01', { name: 'My lift', sets: 3, reps: 8, weight: 20 })]);
    r = await S(`suggestNext({ name: 'My lift', sets: 3, reps: 8, weight: 20 }, 'sp', T)`);
    check('custom exercise 20 -> up 22.5', r && r.kind === 'up' && r.weight === 22.5, r);

    console.log('== assisted pull-ups');
    const ex2 = `{ name: 'Pull-ups assisted', assisted: true, sets: 3, reps: 5, weight: 30 }`;
    await set([W('2026-11-01', { name: 'Pull-ups assisted', assisted: true, sets: 3, reps: 5, weight: 30 })]);
    r = await S(`suggestNext(${ex2}, 'sp', T)`);
    check('help 30, hit -> lessHelp 27.5', r && r.kind === 'lessHelp' && r.weight === 27.5 && r.reasonKey === 'suggest.lessHelp', r);
    await set([W('2026-11-01', { name: 'Pull-ups assisted', assisted: true, sets: 3, reps: 5, weight: 30, setReps: [5, 4, 5] })]);
    r = await S(`suggestNext(${ex2}, 'sp', T)`);
    check('assisted, short -> keepHelp 30', r && r.kind === 'keepHelp' && r.weight === 30, r);
    await set([W('2026-11-01', { name: 'Pull-ups assisted', assisted: true, sets: 3, reps: 5, weight: 30, setReps: [5, 4, 5] }),
               W('2026-11-04', { name: 'Pull-ups assisted', assisted: true, sets: 3, reps: 5, weight: 30, setReps: [4, 4, 4] })]);
    r = await S(`suggestNext(${ex2}, 'sp', T)`);
    check('assisted, two short -> moreHelp 33 -> 35 (x1.1 up to step)', r && r.kind === 'moreHelp' && r.weight === 35, r);
    await set([W('2026-11-01', { name: 'Pull-ups assisted', assisted: true, sets: 3, reps: 5, weight: 1 })]);
    r = await S(`suggestNext(${ex2}, 'sp', T)`);
    check('assisted help 1 -> lessHelp never below 0', r && r.kind === 'lessHelp' && r.weight >= 0, r);
    await set([W('2026-11-01', { name: 'Pull-ups assisted', assisted: true, sets: 3, reps: 5, weight: 30, setRpe: [6, 7, 7] })]);
    r = await S(`suggestNext(${ex2}, 'sp', T)`);
    check('assisted, easy (RPE<=7) -> lessHelp 25', r && r.kind === 'lessHelp' && r.weight === 25, r);

    console.log('== unilateral, per-set weights, warm-ups');
    const uni = (o) => Object.assign({ name: 'One-arm row', unilateral: true, sets: 2, reps: 8, weight: 20 }, o);
    const exUni = `{ name: 'One-arm row', sets: 2, reps: 8, weight: 20 }`;
    await set([W('2026-11-01', uni({ sidesDone: { left: [1, 2], right: [1, 2] } }))]);
    r = await S(`suggestNext(${exUni}, 'sp', T)`);
    check('both sides hit -> up 22.5', r && r.kind === 'up' && r.weight === 22.5, r);
    await set([W('2026-11-01', uni({ sidesDone: { left: [1, 2], right: [1] } }))]);
    r = await S(`suggestNext(${exUni}, 'sp', T)`);
    check('right side did only 1 of 2 sets -> keep', r && r.kind === 'keep' && r.weight === 20, r);
    await set([W('2026-11-01', uni({ sidesDone: { left: [1, 2], right: [1, 2] }, sideReps: { left: [8, 8], right: [8, 7] } }))]);
    r = await S(`suggestNext(${exUni}, 'sp', T)`);
    check('right side short of reps -> keep', r && r.kind === 'keep', r);
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, setWeights: [100, 105, 110] })]);
    r = await next();
    check('per-set weights [100,105,110]: top is 110 -> up 112.5', r && r.kind === 'up' && r.weight === 112.5, r);
    await set([W('2026-11-01', { exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: 100, warmups: [{ weight: 40, reps: 10 }, { weight: 60, reps: 5 }] })]);
    r = await next();
    check('warm-ups ignored -> up 102.5', r && r.kind === 'up' && r.weight === 102.5, r);

    console.log('== null cases and junk');
    await set([]);
    check('no history -> null', await next() === null);
    await set([{ date: '2026-11-01', planId: 'other', exercises: [bench()] }]);
    check('exercise only in another plan -> null', await next() === null);
    await p.eval(`(hist([]), state.importedHistory = [{ id: 'imp1', date: '2026-11-01', name: 'Imported', source: 'strong', key: 'k1', exercises: [{ name: 'Bench press', exId: 'bench-press', sets: 3, reps: 5, weight: 100 }] }], true)`);
    check('only an imported workout -> null', await next() === null);
    await set([W('2026-11-01', bench({ sets: 3, setsDone: 0 }))]);
    check('no done sets -> null', await next() === null);
    await set([W('2026-11-01', bench({ sets: 'x', weight: 'abc', reps: null }))]);
    check('junk entry -> null, no throw', await next() === null);
    await set([W('2026-11-11', bench())]);
    check('workout today is not "last" (before today only) -> null', await next() === null);
    check('junk exercises never throw', await S(`[suggestNext(null, 'sp', T), suggestNext({}, 'sp', T), suggestNext({ name: 5 }, 'nope', T), suggestNext(exBench(), undefined, T)].every(x => x === null)`));
    await set([W('2026-11-01', bench({ weight: 0 }))]);
    check('0 kg last session -> null (never a 0 kg suggestion)', await next() === null);

    console.log('== plates rounding');
    await p.eval(`(state.settings.plates = { bar: 15, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }, true)`);
    await set([W('2026-11-01', bench({ weight: 16 }))]);
    r = await S(`suggestNext(Object.assign(exBench(), { reps: 5 }), 'sp', T)`);
    check('15 kg bar, odd 16 -> up rounds down to buildable (>= 15, multiple of 2.5 above bar)', r && r.weight >= 15 && ((r.weight - 15) / 2.5) % 1 === 0 && r.weight <= 18.5, r);
    await set([W('2026-11-01', bench({ weight: 10 }))]);
    r = await next();
    check('top below the bar -> never below the bar (15)', r && r.weight >= 15, r);
    await set([W('2026-11-01', bench({ weight: 17, setReps: [5, 5, 4] }))]);
    r = await next();
    check('keep at an unbuildable 17 -> buildable 15..17', r && r.kind === 'keep' && r.weight >= 15 && r.weight <= 17, r);
    await set([W('2026-11-01', bench({ weight: 16, setReps: [5, 5, 4] })), W('2026-11-04', bench({ weight: 16, setReps: [5, 4, 4] }))]);
    r = await next();
    check('reset near the bar never below the bar', r && r.kind === 'reset' && r.weight >= 15, r);
    await p.eval(`(delete state.settings.plates, true)`);

    console.log('== reasons: 7 kinds, 6 languages');
    const kinds = ['up', 'up2', 'keep', 'reset', 'lessHelp', 'keepHelp', 'moreHelp'];
    const langs = ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar'];
    for (const l of langs) {
      const bad = await S(`(() => { const out = []; for (const k of ${J(kinds)}) { const s = I18N[${J(l)}]['suggest.' + k]; if (!s || s.indexOf('{kg}') < 0) out.push(k); } return out; })()`);
      check(l + ': all 7 reason strings exist and use {kg}', Array.isArray(bad) && bad.length === 0, bad);
    }
    const en = await S(`(() => { const o = {}; for (const k of ${J(kinds)}) o[k] = t('suggest.' + k, { kg: 102.5, reps: 5 }); return o; })()`);
    console.log('  en: ' + J(en));
    check('en strings render without placeholders left', Object.values(en).every((s) => typeof s === 'string' && !/[{}]/.test(s) && s.length > 5), en);
    check('each kind maps to reasonKey suggest.<kind>', await S(`(() => {
      const base = { sets: 3, reps: 5 };
      const mk = (w, rr, extra) => Object.assign({ exId: 'bench-press', name: 'Bench press', sets: 3, reps: 5, weight: w }, extra || {});
      const cases = [
        ['up', [mk(100)]], ['up2', [mk(100, 0, { setRpe: [7, 7, 7] })]], ['keep', [mk(100, 0, { setReps: [5, 5, 4] })]],
        ['reset', [mk(100, 0, { setReps: [5, 5, 4] }), mk(100, 0, { setReps: [5, 4, 4] })]]
      ];
      return cases.every(([k, es]) => { hist(es.map((e, i) => ({ date: '2026-11-0' + (i + 1), exercises: [e] }))); const r = suggestNext(exBench(), 'sp', T); return r && r.kind === k && r.reasonKey === 'suggest.' + k; });
    })()`));
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
