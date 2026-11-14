'use strict';
/* GymQuest — nová tabuľka úspechov (v101, spec §4.3) v reálnom headless Chrome, bez účtov a siete.

     GQ_TEST_PORT=8190 [GQ_SHOTS=<priečinok>] node tests/app/achievements-v2.js

   Kontroluje presné hranice každého úspechu (start3 deň 14 áno / 15 nie, pr1 nie z prvého tréningu, asistované
   30 -> 25 je rekord, steady5, back, rest5 s restUsed z Dokončiť, goal1 nie z ospravedlneného týždňa, séria, ...),
   že starý odznak (fourplans) zostane zobrazený bez XP, že nič sa neodomkne dvakrát, že čistá inštalácia nič
   neodomkne, dátumy odomknutia z histórie a XP súčet len z novej tabuľky. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-ach2');
const SHOTS = process.env.GQ_SHOTS || '';
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(path.join(WORK, 'profiles'), { recursive: true });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('ach2-' + Date.now().toString(36), 9894, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push(String(e.exceptionDetails.exception && e.exceptionDetails.exception.description || e.exceptionDetails.text)));
  const E = (x) => p.eval(x);
  const shot = async (file) => {
    if (process.env.GQ_SCREENSHOTS === '0' || !SHOTS) return;
    const s = await p.c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(s.data, 'base64'));
  };
  /* Nastaví históriu (zoznam { d: dátum, ex: [...], ...extra }) a vráti mapu odomknutých id -> dátum. */
  let seq = 0;
  const run = async (hist, extra) => {
    const list = hist.map((h) => Object.assign({ id: 'h' + String(++seq).padStart(5, '0'), planId: 'push', planName: 'Push', xp: 0, note: '',
      exercises: h.ex || [{ name: 'Bench', exId: 'bench-press', sets: 3, reps: 8, weight: 50, setsDone: 3 }] },
      Object.assign({}, h, { ex: undefined })));
    return JSON.parse(await E(`(() => { state.history = ${J(list)}; state.activities = []; state.achievements = {}; state.excusedWeeks = []; state.goalHistory = {};
      state.measurements = []; state.settings.weeklyGoal = 2;
      ${extra || ''}
      return JSON.stringify(evaluateAchievements()); })()`));
  };
  const day = (base, n) => { const d = new Date(base + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const B = '2025-01-06';   // pondelok
  const ex = (name, weight, more) => Object.assign({ name, sets: 3, reps: 8, weight, setsDone: 3 }, more || {});
  const has = (m, id) => Object.prototype.hasOwnProperty.call(m, id);
  const ids = (m) => Object.keys(m).filter((k) => !k.startsWith('ms-')).sort();

  try {
    await p.navigate(BASE);
    await E(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 844, deviceScaleFactor: 2, mobile: true });

    console.log('== Table and XP');
    const defs = JSON.parse(await E(`JSON.stringify(staticAchievementDefs().map((d) => [d.id, d.xp]))`));
    const want = { first: 25, start3: 50, goal1: 50, goal4: 100, goal12: 250, goal26: 400, streak4: 150, streak8: 300, streak12: 450, streak26: 800,
      w10: 100, w25: 200, w50: 350, w100: 600, w250: 1000, pr1: 50, pr10: 150, pr25: 300, steady5: 100, back: 50, rest5: 25, ownplan: 25,
      fullbody: 25, explorer10: 50, body4: 50, together: 50, balanced10: 25 };
    check('27 ids with exactly the spec XP', defs.length === 27 && defs.every(([id, xp]) => want[id] === xp), defs);
    const v1 = JSON.parse(await E(`JSON.stringify(ACHIEVEMENTS_V1_XP)`));
    check('ACHIEVEMENTS_V1_XP = old table (25 ids, key values)', Object.keys(v1).length === 25 && v1.first === 25 && v1.hundred === 750 && v1.pr10 === 300 && v1.fourplans === 100 && v1.xp200 === 0 && v1.missedweek === 150 && v1.weeklygoal1 === 75, v1);
    check('fresh install unlocks nothing', Object.keys(await run([])).length === 0);

    console.log('== Workout counts');
    let m = await run([{ date: B }]);
    check('1 workout -> first only', J(ids(m)) === J(['first']), ids(m));
    m = await run(Array.from({ length: 9 }, (_, i) => ({ date: day(B, i * 3) })));
    check('9 workouts -> no w10', !has(m, 'w10'));
    m = await run(Array.from({ length: 10 }, (_, i) => ({ date: day(B, i * 3) })));
    check('10 workouts -> w10 dated by the 10th', has(m, 'w10') && m.w10 === day(B, 27) && !has(m, 'w25'), m.w10);
    for (const n of [25, 50, 100, 250]) {
      const a = await run(Array.from({ length: n - 1 }, (_, i) => ({ date: day(B, i) })));
      const c = await run(Array.from({ length: n }, (_, i) => ({ date: day(B, i) })));
      check('w' + n + ': ' + (n - 1) + ' no / ' + n + ' yes', !has(a, 'w' + n) && has(c, 'w' + n) && c['w' + n] === day(B, n - 1));
    }

    console.log('== start3 boundary');
    m = await run([{ date: B }, { date: day(B, 5) }, { date: day(B, 14) }]);
    check('start3: day 0/5/14 -> yes (dated day 14)', has(m, 'start3') && m.start3 === day(B, 14), m);
    m = await run([{ date: B }, { date: day(B, 5) }, { date: day(B, 15) }]);
    check('start3: day 0/5/15 -> no', !has(m, 'start3'));
    m = await run([{ date: B }, { date: B }, { date: B }]);
    check('start3: 3 workouts on day 0 -> yes', has(m, 'start3'));

    console.log('== Weekly goals (goal 2/week) and streak');
    const weeks = (n, per, skip) => { const h = []; for (let w = 0; w < n; w++) { if (skip && skip.includes(w)) continue; for (let k = 0; k < per; k++) h.push({ date: day(B, w * 7 + k) }); } return h; };
    m = await run(weeks(1, 1));
    check('goal1: 1 workout in the week (goal 2) -> no', !has(m, 'goal1'));
    m = await run(weeks(1, 2));
    check('goal1: 2 workouts -> yes, dated the 2nd workout', has(m, 'goal1') && m.goal1 === day(B, 1), m);
    m = await run(weeks(3, 2));
    check('goal4: 3 weeks no', !has(m, 'goal4'));
    m = await run(weeks(4, 2));
    check('goal4: 4 weeks yes (also streak4)', has(m, 'goal4') && has(m, 'streak4') && m.streak4 === day(B, 22), m);
    m = await run(weeks(4, 2), `state.excusedWeeks = [weekKey(parseDate(${J(day(B, 7))}))];`);
    check('goal: an excused week with the goal met does not count (3 weeks -> no goal4)', !has(m, 'goal4'));
    m = await run(weeks(1, 1), `state.excusedWeeks = [weekKey(parseDate(${J(B)}))];`);
    check('goal1 not from an excused week', !has(m, 'goal1'));
    m = await run(weeks(12, 2));
    check('goal12 + streak8 + streak12 at 12 weeks, no streak26', has(m, 'goal12') && has(m, 'streak8') && has(m, 'streak12') && !has(m, 'streak26'), ids(m));
    m = await run(weeks(11, 2));
    check('11 weeks -> no goal12, no streak12', !has(m, 'goal12') && !has(m, 'streak12') && has(m, 'streak8'));
    m = await run(weeks(26, 2));
    check('26 weeks -> goal26 + streak26', has(m, 'goal26') && has(m, 'streak26'), ids(m));
    m = await run(weeks(26, 2), `state.excusedWeeks = [weekKey(parseDate(${J(day(B, 7 * 25))}))];`);
    m = await run(weeks(8, 2, [3]));
    check('streak is broken by a missed week (3 weeks, then 4 weeks -> streak4 on the 2nd run, no streak8)', has(m, 'streak4') && !has(m, 'streak8'), m);
    m = await run(weeks(8, 2, [3]), `state.excusedWeeks = [weekKey(parseDate(${J(day(B, 21))}))];`);
    check('an excused week keeps the streak but does not extend it (7 met weeks -> no streak8)', !has(m, 'streak8') && has(m, 'streak4'));

    console.log('== Review fixes: activities, source plans, performance, stateMeaningful');
    m = await run([{ date: B }], `state.activities = [{ id: 'a1', type: 'run', date: ${J(day(B, 1))}, minutes: 30, xp: 15 }];`);
    check('goal1: workout + activity in one week (goal 2) -> yes, dated the activity', has(m, 'goal1') && m.goal1 === day(B, 1), m);
    m = await run([], `state.activities = [{ id: 'a1', type: 'run', date: ${J(day(B, 1))}, minutes: 30, xp: 15 }, { id: 'a2', type: 'run', date: ${J(day(B, 2))}, minutes: 30, xp: 15 }];`);
    check('goal1: activity-only week meets the goal', has(m, 'goal1') && !has(m, 'first'), m);
    m = await run([{ date: B }], `state.activities = [];`);
    check('goal1: 1 workout alone still no', !has(m, 'goal1'));
    m = await run([{ date: B, planId: 'cp' }], `state.plans.cp = { id: 'cp', builtin: false, customName: 'Copy', source: { kind: 'post', ref: 'x', at: '2025-01-01' }, exercises: [] };`);
    check('ownplan: a plan copied from a friend/post (source) does not count', !has(m, 'ownplan'));
    const t0 = JSON.parse(await E(`(() => {
      const h = []; for (let i = 0; i < 1000; i++) { const d = new Date(Date.UTC(2005, 0, 3 + i * 7 + (i % 3), 12)); h.push({ id: 'p' + String(i).padStart(5, '0'), planId: 'push', planName: 'Push', date: d.toISOString().slice(0, 10), xp: 0, note: '', exercises: [{ name: 'Bench', exId: 'bench-press', sets: 3, reps: 8, weight: 20 + (i % 40), setsDone: 3 }] }); }
      state.history = h; state.activities = []; state.achievements = {}; state.excusedWeeks = []; state.goalHistory = {};
      const a = performance.now(); const r = evaluateAchievements(); const ms = performance.now() - a;
      return JSON.stringify({ ms, n: Object.keys(r).length }); })()`));
    check('1000 workouts over ~1000 weeks: evaluateAchievements < 300 ms', t0.ms < 300 && t0.n > 5, t0);
    const sm = JSON.parse(await E(`(() => {
      const fresh = defaultState(); fresh.achievements = { fourplans: '2025-01-01', customplan: '2025-01-01', customex5: '2025-01-01' };
      const withHist = defaultState(); withHist.achievements = { five: '2025-01-01' };
      return JSON.stringify({ plansOnly: stateMeaningful(fresh), orphan: stateMeaningful(withHist) }); })()`));
    check('stateMeaningful: pristine + plan-only old badges -> not meaningful', sm.plansOnly === false, sm);
    check('stateMeaningful: a stored history-based badge without history stays meaningful', sm.orphan === true, sm);

    console.log('== Personal records');
    m = await run([{ date: B, ex: [ex('Bench', 50, { exId: 'bench-press' })] }]);
    check('pr1: first session = baseline, no PR', !has(m, 'pr1'));
    m = await run([{ date: B, ex: [ex('Bench', 50, { exId: 'bench-press' })] }, { date: day(B, 3), ex: [ex('Bench', 50, { exId: 'bench-press' })] }]);
    check('pr1: same weight again -> no', !has(m, 'pr1'));
    m = await run([{ date: B, ex: [ex('Bench', 50, { exId: 'bench-press' })] }, { date: day(B, 3), ex: [ex('Bench', 52.5, { exId: 'bench-press' })] }]);
    check('pr1: heavier -> yes, dated the second session', has(m, 'pr1') && m.pr1 === day(B, 3), m);
    m = await run([{ date: B, ex: [ex('Bench', 50, { exId: 'bench-press' })] }, { date: day(B, 3), ex: [ex('Bench', 60, { exId: 'bench-press' })] }, { date: day(B, 6), ex: [ex('Bench', 55, { exId: 'bench-press' })] }]);
    check('pr1: lighter after a record is not a PR (only 1 PR)', has(m, 'pr1') && !has(m, 'pr10'));
    m = await run([{ date: B, ex: [ex('Bench', 50, { exId: 'bench-press' })] }, { date: day(B, 3), ex: [ex('Bench', 60, { exId: 'bench-press' })] }, { date: day(B, 6), ex: [ex('Bench', 55, { exId: 'bench-press' })] }, { date: day(B, 9), ex: [ex('Bench', 57, { exId: 'bench-press' })] }]);
    check('pr1: 55/57 after a 60 record are no PRs', !has(m, 'pr10'));
    m = await run([{ date: B, ex: [ex('Dips', 30, { assisted: true })] }, { date: day(B, 3), ex: [ex('Dips', 25, { assisted: true })] }]);
    check('assisted 30 -> 25 is a PR', has(m, 'pr1') && m.pr1 === day(B, 3), m);
    m = await run([{ date: B, ex: [ex('Dips', 25, { assisted: true })] }, { date: day(B, 3), ex: [ex('Dips', 30, { assisted: true })] }]);
    check('assisted 25 -> 30 (more help) is no PR', !has(m, 'pr1'));
    m = await run([{ date: B, ex: [ex('Move', 20, { setsDone: 0 })] }, { date: day(B, 3), ex: [ex('Move', 40, { setsDone: 0 })] }]);
    check('exercise with 0 completed sets is no PR', !has(m, 'pr1'));
    const prHist = (n) => Array.from({ length: n + 1 }, (_, i) => ({ date: day(B, i * 2), ex: [ex('Squat', 40 + i * 2.5, { exId: 'squats' })] }));
    m = await run(prHist(9));
    check('pr10: 9 PRs no', has(m, 'pr1') && !has(m, 'pr10'));
    m = await run(prHist(10));
    check('pr10: 10 PRs yes (dated the 10th PR)', has(m, 'pr10') && m.pr10 === day(B, 20) && !has(m, 'pr25'), m);
    m = await run(prHist(24));
    check('pr25: 24 no', !has(m, 'pr25'));
    m = await run(prHist(25));
    check('pr25: 25 yes', has(m, 'pr25'));

    console.log('== steady5');
    const steady = (k) => { const h = [{ date: B, ex: ['A', 'B', 'C', 'D', 'E'].map((n) => ex(n, 20)) }];
      h.push({ date: day(B, 3), ex: ['A', 'B', 'C', 'D', 'E'].slice(0, k).map((n) => ex(n, 25)) }); return h; };
    m = await run(steady(4));
    check('steady5: 4 exercises increased -> no', !has(m, 'steady5'));
    m = await run(steady(5));
    check('steady5: 5 different exercises increased -> yes', has(m, 'steady5') && m.steady5 === day(B, 3), m);
    m = await run([{ date: B, ex: [ex('A', 20)] }, { date: day(B, 1), ex: [ex('A', 21)] }, { date: day(B, 2), ex: [ex('A', 22)] }, { date: day(B, 3), ex: [ex('A', 23)] }, { date: day(B, 4), ex: [ex('A', 24)] }, { date: day(B, 5), ex: [ex('A', 25)] }]);
    check('steady5: the same exercise 5 times is not 5 exercises', !has(m, 'steady5'));

    console.log('== back');
    m = await run([{ date: B }, { date: day(B, 14) }, { date: day(B, 21) }]);
    check('back: gap 14 + 2nd workout after 7 days -> yes', has(m, 'back') && m.back === day(B, 21), m);
    m = await run([{ date: B }, { date: day(B, 13) }, { date: day(B, 15) }]);
    check('back: gap 13 -> no', !has(m, 'back'));
    m = await run([{ date: B }, { date: day(B, 14) }, { date: day(B, 22) }]);
    check('back: 2nd workout after 8 days -> no', !has(m, 'back'));
    m = await run([{ date: B }, { date: day(B, 14) }]);
    check('back: only the first workout after the break -> no', !has(m, 'back'));
    m = await run([{ date: B }, { date: day(B, 20) }, { date: day(B, 20) }]);
    check('back: two workouts on the day after the break -> yes', has(m, 'back'));

    console.log('== rest5, plans, explorer, balanced, together, body4');
    m = await run(Array.from({ length: 4 }, (_, i) => ({ date: day(B, i), restUsed: true })));
    check('rest5: 4 workouts with restUsed -> no', !has(m, 'rest5'));
    m = await run(Array.from({ length: 5 }, (_, i) => ({ date: day(B, i), restUsed: i !== 2 })));
    check('rest5: 4 of 5 -> no', !has(m, 'rest5'));
    m = await run(Array.from({ length: 6 }, (_, i) => ({ date: day(B, i), restUsed: i !== 2 })));
    check('rest5: 5 workouts with restUsed (dated the 5th)', has(m, 'rest5') && m.rest5 === day(B, 5), m);
    m = await run([{ date: B }], `state.plans.push.builtin === true;`);
    check('built-in plan -> no ownplan, no fullbody', !has(m, 'ownplan') && !has(m, 'fullbody'));
    m = await run([{ date: B, planId: 'mine' }], `state.plans.mine = { id: 'mine', builtin: false, customName: 'Mine', exercises: [] };`);
    check('ownplan: own plan -> yes, no fullbody', has(m, 'ownplan') && !has(m, 'fullbody'));
    m = await run([{ date: B, planId: 'fb' }], `state.plans.fb = { id: 'fb', builtin: false, customName: 'FB', fullBody: true, exercises: [] };`);
    check('fullbody: Full Body plan -> yes', has(m, 'fullbody') && has(m, 'ownplan'));
    m = await run([{ date: B, planId: 'quick' }]);
    check('quick workout -> no ownplan', !has(m, 'ownplan'));
    const names = (n) => Array.from({ length: n }, (_, i) => ex('E' + i, 10));
    m = await run([{ date: B, ex: names(9) }]);
    check('explorer10: 9 exercises -> no', !has(m, 'explorer10'));
    m = await run([{ date: B, ex: names(6) }, { date: day(B, 2), ex: names(10) }]);
    check('explorer10: 10 different exercises over workouts -> yes, dated 2nd', has(m, 'explorer10') && m.explorer10 === day(B, 2), m);
    m = await run([{ date: B, ex: [ex('A', 10, { unilateral: true }), ex('B', 10, { unilateral: true }), ex('C', 10, { unilateral: true }), ex('D', 10, { unilateral: true }), ex('E', 10, { unilateral: true })] },
      { date: day(B, 1), ex: [ex('A', 10, { unilateral: true }), ex('B', 10, { unilateral: true }), ex('C', 10, { unilateral: true }), ex('D', 10, { unilateral: true }), ex('E', 10, { unilateral: true, setsDone: 0 })] }]);
    check('balanced10: 9 finished one-side exercises (one with 0 sets) -> no', !has(m, 'balanced10'));
    m = await run([{ date: B, ex: [1, 2, 3, 4, 5].map((i) => ex('U' + i, 10, { unilateral: true })) }, { date: day(B, 1), ex: [1, 2, 3, 4, 5].map((i) => ex('V' + i, 10, { unilateral: true })) }]);
    check('balanced10: 10 one-side exercises -> yes', has(m, 'balanced10') && m.balanced10 === day(B, 1));
    m = await run([{ date: B }, { date: day(B, 2), trainedWith: 'Alex' }]);
    check('together: finished train-together workout -> yes (dated)', has(m, 'together') && m.together === day(B, 2), m);
    const meas = (dates) => `state.measurements = ${J(dates.map((d, i) => ({ id: 'm' + i, date: d, weightKg: 80, note: '' })))};`;
    m = await run([], meas([B, day(B, 1), day(B, 7), day(B, 14)]));
    check('body4: 4 entries in 3 weeks -> no', !has(m, 'body4'));
    m = await run([], meas([B, day(B, 1), day(B, 7), day(B, 14), day(B, 21)]));
    check('body4: 4 different weeks -> yes (dated 4th week)', has(m, 'body4') && m.body4 === day(B, 21), m);
    m = await run([], `state.measurements = [{ id: 'z', date: '${B}', waistCm: 80, note: '' }, { id: 'y', date: '${day(B, 7)}', waistCm: 80, note: '' }, { id: 'x', date: '${day(B, 14)}', waistCm: 80, note: '' }, { id: 'w', date: '${day(B, 21)}', waistCm: 80, note: '' }];`);
    check('body4: waist-only entries are not body weight', !has(m, 'body4'));

    console.log('== Never twice, old badges, XP');
    const r = JSON.parse(await E(`(() => {
      state.history = []; state.achievements = {};
      const mk = (d) => ({ id: uid(), planId: 'push', planName: 'Push', date: d, xp: 0, note: '', exercises: [{ name: 'Bench', exId: 'bench-press', sets: 3, reps: 8, weight: 50, setsDone: 3 }] });
      state.history = [mk('2025-01-06')];
      reconcileAchievements();
      const first = Object.assign({}, state.achievements);
      state.achievements.first = '2020-02-02';            // starý odznak s uloženým dátumom
      state.achievements.fourplans = '2024-05-05';       // starý odznak mimo novej tabuľky
      state.achievements.consistent2 = '2024-06-06';
      state.history.push(mk('2025-01-07'), mk('2025-01-08'));
      reconcileAchievements(); reconcileAchievements();
      return JSON.stringify({ first, a: state.achievements, xp: achievementXP(), keys: Object.keys(state.achievements) });
    })()`));
    check('old id equal to a new id keeps its stored date', r.a.first === '2020-02-02', r.a.first);
    check('start3 added on re-evaluation, once, dated from history', r.a.start3 === '2025-01-08' && r.keys.filter((k) => k === 'start3').length === 1, r.a);
    check('old fourplans / consistent2 stay in state.achievements', r.a.fourplans === '2024-05-05' && r.a.consistent2 === '2024-06-06');
    check('achievementXP = new table only (first 25 + start3 50 + goal1 50; old badges 0)', r.xp === 125 && r.a.goal1 === '2025-01-07', r);
    check('earned old XP never counted: stored legacy XP is only in ACHIEVEMENTS_V1_XP', v1.fourplans === 100 && v1.consistent2 === 125);

    console.log('== Screen: "Earlier badges"');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      const v = await E(`(setLang(${J(lang)}), [t('ach2.earlier'), t('ach2.first'), t('ach2.goal', { n: 4 }), t('ach2.balancedDesc')])`);
      check('ach2 texts in ' + lang, v.every((x) => x && !/^ach2\./.test(x)), v);
    }
    await E(`(() => { setLang('en'); state.history = []; state.achievements = { first: '2025-01-06', fourplans: '2024-05-05', 'ms-Bench-50': '2025-01-06' }; state.history = [{ id: 'h1', planId: 'push', planName: 'Push', date: '2025-01-06', xp: 60, note: '', exercises: [{ name: 'Bench', exId: 'bench-press', sets: 3, reps: 8, weight: 50, setsDone: 3 }] }]; saveState(); renderAll(); bentoGo('motivation'); return true; })()`);
    await wait(300);
    const scr = JSON.parse(await E(`(() => JSON.stringify({
      head: (document.getElementById('achievements-earlier') || {}).textContent,
      earlier: [...document.querySelectorAll('#achievements-list .achievement.earlier')].map((e) => ({ id: e.dataset.achievementId, xp: !!e.querySelector('.achievement-xp') })),
      news: document.querySelectorAll('#achievements-list .achievement[data-achievement-id]:not(.earlier)').length,
      firstXp: !!document.querySelector('#achievements-list [data-achievement-id="first"] .achievement-xp'),
      firstUnlocked: document.querySelector('#achievements-list [data-achievement-id="first"]').classList.contains('unlocked'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }))()`));
    check('fourplans shown under "Earlier badges" with no XP', scr.head === 'Earlier badges' && scr.earlier.length === 1 && scr.earlier[0].id === 'fourplans' && !scr.earlier[0].xp, scr);
    check('new table shows 27 achievements, first unlocked with XP', scr.news === 27 && scr.firstXp && scr.firstUnlocked, scr);
    check('no horizontal overflow', !scr.overflow);
    await E(`(() => { const l = document.getElementById('achievements-list'); l.scrollIntoView(); return true; })()`);
    for (const [lang, theme] of [['en', 'light'], ['en', 'dark'], ['ar', 'light'], ['ar', 'dark']]) {
      await E(`(() => { setLang(${J(lang)}); setThemePref(${J(theme)}); renderAll(); bentoGo('motivation'); return true; })()`);
      await wait(300);
      await E(`(() => { const h = document.getElementById('achievements-earlier'); (h || document.getElementById('achievements-list')).scrollIntoView({ block: 'start' }); return true; })()`);
      await wait(150);
      await shot('achievements-' + lang + '-' + theme + '.png');
    }

    console.log('== restUsed from the rest timer, Finish and normalizers');
    const rr = JSON.parse(await E(`(() => {
      setThemePref('light'); setLang('en');
      state.history = []; state.achievements = {}; state.activeSession = null;
      state.plans['rt'] = { id: 'rt', builtin: false, customName: 'RT', exercises: [{ id: 'cx-r1', name: 'Move', sets: 3, reps: 8, weight: 20 }] };
      state.planOrder.push('rt'); selectedPlan = 'rt'; ensureSession(); saveState();
      const before = getSession().restUsed === true;
      startTimer(60, null);
      const during = getSession().restUsed === true;
      const norm = normalizeActiveSession(JSON.parse(JSON.stringify(getSession()))).restUsed === true;
      const bad = normalizeActiveSession(Object.assign(JSON.parse(JSON.stringify(getSession())), { restUsed: 'yes' })).restUsed;
      return JSON.stringify({ before, during, norm, bad: bad === undefined });
    })()`));
    check('restUsed set when a rest timer starts in a session, survives normalizer, junk dropped', rr.before === false && rr.during && rr.norm && rr.bad, rr);
    await E(`(() => { switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    await E(`(() => { document.querySelectorAll('#exercise-list .exercise .set-btn').forEach((bt, i) => { if (i < 3) bt.click(); }); return true; })()`);
    await wait(200);
    await E(`(() => { document.getElementById('btn-finish-workout').click(); document.getElementById('btn-confirm-ok').click(); return true; })()`);
    await wait(400);
    const fin = JSON.parse(await E(`JSON.stringify({ n: state.history.length, rest: state.history[state.history.length - 1].restUsed, sess: state.activeSession })`));
    check('Finish records restUsed:true on the history entry', fin.n === 1 && fin.rest === true && fin.sess === null, fin);
    await E(`(() => { const m = document.getElementById('modal-result'); if (m && !m.hidden) m.hidden = true; return true; })()`);
    const noRest = JSON.parse(await E(`(() => {
      state.activeSession = null; selectedPlan = 'rt'; ensureSession(); stopTimer(); const had = getSession().restUsed; return JSON.stringify({ had: had === undefined }); })()`));
    check('a session without rest timer has no restUsed', noRest.had);
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
