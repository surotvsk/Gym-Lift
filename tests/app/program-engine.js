'use strict';
/* Gym-Lift — program data + week engine (gym-basics phase 4, task 3), in real headless Chrome. No accounts, no network.

     node tests/app/program-engine.js

   PROGRAMS (static data), programWeek, programPrescription, startProgramState, cleanProgramState. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-program-engine');
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
  const b = new Browser('progeng-' + Date.now().toString(36), 9875, path.join(WORK, 'profiles'));
  const p = await b.launch();
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); window.J = JSON.stringify; return true; })()`);
    const S = (expr) => p.eval(`(() => { try { return ${expr}; } catch (e) { return 'THROW ' + e.message; } })()`);
    const langs = ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar'];

    console.log('== content validity');
    check('PROGRAMS has the 4 programs', await S(`PROGRAMS.map((x) => x.id).join(',')`) === 'beginner-full-body,push-pull-legs,upper-lower,strength-wave', await S(`PROGRAMS.map((x) => x.id).join(',')`));
    check('every row uses a library id, none assisted/retired', await S(`PROGRAMS.every((pr) => programVariants(pr).every((v) => v.days.every((d) => d.rows.every((r) => { const l = libraryEntry(r.exId); return l && !l.assisted && !l.retired; }))))`));
    check('progRow = program:day:index and unique per program', await S(`PROGRAMS.every((pr) => { const seen = new Set(); return programVariants(pr).every((v) => v.days.every((d) => d.rows.every((r, i) => { const ok = r.progRow === pr.id + ':' + d.id + ':' + i && !seen.has(r.progRow); seen.add(r.progRow); return ok; }))); })`));
    check('schedule length = daysPerWeek and uses known day ids', await S(`PROGRAMS.every((pr) => programVariants(pr).every((v) => v.schedule.length === v.daysPerWeek && v.schedule.every((id) => v.days.some((d) => d.id === id))))`));
    check('PPL 3day has 3 days, 6day has 6 days', await S(`(() => { const pr = PROGRAMS.find((x) => x.id === 'push-pull-legs'); const v = (id) => programVariants(pr).find((x) => x.id === id); return v('3day').days.length === 3 && v('3day').daysPerWeek === 3 && v('6day').days.length === 6 && v('6day').daysPerWeek === 6; })()`));
    check('upper-lower 4 days, wave 4 days, beginner 3/week', await S(`(() => { const g = (id) => PROGRAMS.find((x) => x.id === id); return g('upper-lower').daysPerWeek === 4 && g('upper-lower').days.length === 4 && g('strength-wave').daysPerWeek === 4 && g('strength-wave').days.length === 4 && g('beginner-full-body').daysPerWeek === 3; })()`));
    check('all programs 8 weeks; deloads per spec', await S(`(() => { const g = (id) => PROGRAMS.find((x) => x.id === id); return PROGRAMS.every((x) => x.weeks === 8) && g('beginner-full-body').deloadWeeks.length === 0 && J(g('push-pull-legs').deloadWeeks) === '[8]' && J(g('upper-lower').deloadWeeks) === '[8]' && J(g('strength-wave').deloadWeeks) === '[4,8]'; })()`));
    check('4-5 exercises per day (wave: 1 main + 2-3 assistance; hinge day 4 linear rows)', await S(`PROGRAMS.every((pr) => programVariants(pr).every((v) => v.days.every((d) => pr.kind === 'wave' ? (d.rows.filter((r) => r.main).length === (d.id === 'hinge' ? 0 : 1) && d.rows.length >= 3 && d.rows.length <= 4) : (d.rows.length >= 4 && d.rows.length <= 5))))`));
    check('wave has 3 TM main lifts (squat, bench, overhead press); day 4 is a linear hinge day with RDL, no TM', await S(`J(PROGRAMS.find((x) => x.id === 'strength-wave').days.map((d) => [d.id, (d.rows.find((r) => r.main) || {}).exId || null]))`) === J([['squat', 'squats'], ['bench', 'bench-press'], ['hinge', null], ['press', 'overhead-press']]));
    check('non-wave rows have 3 sets x 8-12 reps', await S(`PROGRAMS.filter((x) => x.kind === 'linear').every((pr) => programVariants(pr).every((v) => v.days.every((d) => d.rows.every((r) => r.sets === 3 && r.reps >= 8 && r.reps <= 12))))`));
    for (const l of langs) {
      const bad = await S(`(() => { const keys = []; for (const pr of PROGRAMS) { keys.push(pr.nameKey, pr.descKey); for (const v of programVariants(pr)) { if (v.nameKey) keys.push(v.nameKey); for (const d of v.days) keys.push(d.nameKey); } } return keys.filter((k) => !I18N[${J(l)}][k] || /Posted|undefined/.test(I18N[${J(l)}][k])); })()`);
      check(l + ': every name/desc/day key translated', Array.isArray(bad) && bad.length === 0, bad);
    }
    check('no person/brand names in English strings', await S(`!/wendler|starting strength|stronglifts|5x5|nsuns|jim|reddit|\\bppl\\b/i.test(Object.keys(I18N.en).filter((k) => k.indexOf('prog.') === 0 && k.indexOf('prog.short.') !== 0).map((k) => I18N.en[k]).join(' '))`));   // prog.short.* = krátka predpona názvu plánu (napr. PPL, podľa zadania úlohy 4)

    console.log('== week maths');
    await p.eval(`(() => { window.P = (start, extra) => Object.assign({ id: 'push-pull-legs', variant: '3day', startedAt: start, weekShift: 0, plans: {} }, extra || {}); return true; })()`);
    const W = (start, today, extra, id) => S(`(() => { const w = programWeek(Object.assign(P(${J(start)}), ${J(extra || {})}, ${id ? J({ id }) : '{}'}), ${J(today)}); return w && [w.week, w.total, w.deload, w.finished].join(','); })()`);
    check('Wed start: same week is week 1', await W('2026-11-11', '2026-11-11') === '1,8,false,false');
    check('Wed start: Sunday of same week still week 1', await W('2026-11-11', '2026-11-15') === '1,8,false,false');
    check('Wed start: next Monday is week 2', await W('2026-11-11', '2026-11-16') === '2,8,false,false');
    check('week 8 is a deload for PPL', await W('2026-11-11', '2026-12-28') === '8,8,true,false');
    check('week 9 of 8 is finished, clamped to 8', await W('2026-11-11', '2027-01-04') === '8,8,false,true');
    check('far future is finished', await W('2026-11-11', '2031-01-04') === '8,8,false,true');
    check('today before start clamps to week 1', await W('2026-11-11', '2026-10-01') === '1,8,false,false');
    check('repeat (weekShift -1) lowers the week', await W('2026-11-11', '2026-11-16', { weekShift: -1 }) === '1,8,false,false' && await W('2026-11-11', '2026-11-23', { weekShift: -1 }) === '2,8,false,false');
    check('skip (weekShift +1) raises the week', await W('2026-11-11', '2026-11-16', { weekShift: 1 }) === '3,8,false,false');
    check('skip past the end is finished', await W('2026-11-11', '2026-12-28', { weekShift: 1 }) === '8,8,false,true');
    check('wave deload weeks 4 and 8', await W('2026-11-11', '2026-11-30', {}, 'strength-wave') === '4,8,true,false' && await W('2026-11-11', '2026-12-28', {}, 'strength-wave') === '8,8,true,false');
    check('beginner never deloads', await W('2026-11-11', '2026-12-28', {}, 'beginner-full-body') === '8,8,false,false');
    const tz = await S(`Intl.DateTimeFormat().resolvedOptions().timeZone`);
    console.log('  timezone: ' + tz);
    check('DST (EU spring, US spring, EU fall, US fall) does not shift the count',
      await W('2026-03-25', '2026-03-30') === '2,8,false,false' && await W('2026-03-25', '2026-04-05') === '2,8,false,false' && await W('2026-03-25', '2026-04-06') === '3,8,false,false' &&
      await W('2026-03-04', '2026-03-09') === '2,8,false,false' && await W('2026-03-04', '2026-03-08') === '1,8,false,false' &&
      await W('2026-10-21', '2026-10-26') === '2,8,false,false' && await W('2026-10-28', '2026-11-02') === '2,8,false,false' && await W('2026-10-28', '2026-11-01') === '1,8,false,false');
    check('year boundary (ISO week 53 / week 1)', await W('2026-12-28', '2027-01-04') === '2,8,false,false' && await W('2026-12-30', '2027-01-03') === '1,8,false,false');
    check('default today uses todayISO (never throws)', await S(`(() => { const w = programWeek(P(todayISO())); return w.week === 1 && !w.finished; })()`));

    console.log('== prescriptions');
    await p.eval(`(() => {
      window.rowOf = (progId, variant, dayId, i) => { const pr = PROGRAMS.find((x) => x.id === progId); const v = programVariants(pr).find((x) => x.id === (variant || x.id)) || programVariants(pr)[0]; return v.days.find((d) => d.id === dayId).rows[i]; };
      window.prog = (id, variant, extra) => Object.assign({ id, variant, startedAt: '2026-11-11', weekShift: 0, plans: { push: 'p-push', pull: 'p-pull', legs: 'p-legs', fullA: 'p-fa', fullB: 'p-fb', upperA: 'p-ua', 'squat': 'p-sq', bench: 'p-bn', hinge: 'p-hg', press: 'p-op' }, tm: {} }, extra || {});
      window.planRow = (tpl, w) => ({ id: tpl.exId, builtin: true, name: 'x', sets: 3, reps: 8, weight: w, progRow: tpl.progRow });
      return true;
    })()`);
    const D = await S(`(() => PROGRAMS.find((x) => x.id === 'push-pull-legs').variants[0].days.map((d) => d.id).join(','))()`);
    check('PPL 3day day ids push,pull,legs', D === 'push,pull,legs', D);
    const PR = (progExpr, planId, rowExpr, today) => S(`programPrescription(${progExpr}, ${J(planId)}, ${rowExpr}, ${J(today)})`);
    let r = await PR(`prog('push-pull-legs','3day')`, 'p-push', `planRow(rowOf('push-pull-legs','3day','push',0), 100)`, '2026-11-11');
    check('linear week 1: sets/reps from the template, no weight, no deload', r && r.sets === 3 && r.reps === 8 && r.weight === undefined && r.deload === false, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-push', `planRow(rowOf('push-pull-legs','3day','push',0), 100)`, '2026-12-28');
    check('PPL deload week 8: 3 sets -> 2, 100 kg (barbell) -> 60 kg', r && r.sets === 2 && r.weight === 60 && r.deload === true && r.reps === 8, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-legs', `planRow(rowOf('push-pull-legs','3day','legs',2), 100)`, '2026-12-28');
    check('deload non-barbell leg press: 60 kg', r && r.weight === 60 && r.sets === 2, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-legs', `planRow(rowOf('push-pull-legs','3day','legs',2), 47)`, '2026-12-28');
    check('deload rounds down to the step (47 -> 28.2 -> 25 for legs, step 5)', r && r.weight === 25, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-push', `planRow(rowOf('push-pull-legs','3day','push',0), 25)`, '2026-12-28');
    check('deload barbell never below the bar (25 kg -> bar 20)', r && r.weight === 20, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-push', `planRow(rowOf('push-pull-legs','3day','push',0), 0)`, '2026-12-28');
    check('deload with no weight: sets only, weight undefined', r && r.sets === 2 && r.weight === undefined, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-push', `planRow(rowOf('push-pull-legs','3day','push',0), 100)`, '2027-01-04');
    check('finished program prescribes nothing', r === null, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-push', `Object.assign(planRow(rowOf('push-pull-legs','3day','push',0), 100), { progRow: undefined })`, '2026-11-11');
    check('row without progRow -> null', r === null, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-pull', `planRow(rowOf('push-pull-legs','3day','push',0), 100)`, '2026-11-11');
    check('progRow of another day / plan mismatch -> null', r === null, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-push', `Object.assign(planRow(rowOf('push-pull-legs','3day','push',0), 100), { progRow: 'upper-lower:push:0' })`, '2026-11-11');
    check('progRow of another program -> null', r === null, r);

    const TM = (tm) => `prog('strength-wave', null, { tm: ${J(tm)} })`;
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-11-23');
    check('wave week 3 TM 100: weights [75,85,95], reps [5,3,1]', r && J(r.setWeights) === '[75,85,95]' && J(r.setReps) === '[5,3,1]' && r.sets === 3 && r.deload === false && r.pctLabel === '75/85/95%', r);
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-11-11');
    check('wave week 1: 3x5 at 65/75/85', r && J(r.setWeights) === '[65,75,85]' && J(r.setReps) === '[5,5,5]', r);
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-11-16');
    check('wave week 2: 3x3 at 70/80/90', r && J(r.setWeights) === '[70,80,90]' && J(r.setReps) === '[3,3,3]', r);
    r = await PR(TM({ squats: 100 }), 'p-sq', `planRow(rowOf('strength-wave', null, 'squat', 0), 80)`, '2026-12-07');
    const expSq = await S(`J([65, 75, 85].map((x) => roundToPlates(105 * x / 100)))`);
    check('wave 2 week 1 squat TM 100 -> 105 x 65/75/85, tmUsed 105', r && J(r.setWeights) === expSq && r.tmUsed === 105, [r, expSq]);
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-12-07');
    check('wave 2 bench TM 100 -> 102.5; wave 1 tmUsed 100', r && r.tmUsed === 102.5, r);
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-11-11');
    check('wave 1 tmUsed equals entered TM', r && r.tmUsed === 100, r);
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-11-30');
    check('wave week 4 deload: 40/50/60', r && J(r.setWeights) === '[40,50,60]' && r.deload === true, r);
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-12-07');
    check('wave week 5 restarts the wave (like week 1)', r && J(r.setWeights) === '[65,75,85]' && r.deload === false, r);
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-12-28');
    check('wave week 8 deload', r && J(r.setWeights) === '[40,50,60]' && r.deload === true, r);
    r = await PR(TM({ 'bench-press': 101 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-11-23');
    const exp = await S(`J([0.75, 0.85, 0.95].map((x) => roundToPlates(101 * x)))`);
    check('wave weights go through roundToPlates (TM 101)', r && J(r.setWeights) === exp, [r && r.setWeights, exp]);
    r = await PR(TM({ 'bench-press': 20 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-11-30');
    check('wave weights never below the bar (TM 20, deload)', r && Array.isArray(r.setWeights) && r.setWeights.every((w) => w >= 20), r);
    r = await PR(TM({}), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-11-23');
    check('TM missing -> null weights (caller asks for a TM), reps still given', r && r.weight === null && r.setWeights === null && J(r.setReps) === '[5,3,1]' && r.sets === 3, r);
    r = await PR(TM({ 'bench-press': 0 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 0), 80)`, '2026-11-23');
    check('TM 0 / NaN / negative -> null weights', r && r.weight === null && r.setWeights === null, r);
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 1), 30)`, '2026-11-23');
    check('wave assistance row is linear (3 sets, no weight)', r && r.sets === 3 && r.setWeights === undefined && r.weight === undefined && r.deload === false, r);
    r = await PR(TM({ 'bench-press': 100 }), 'p-bn', `planRow(rowOf('strength-wave', null, 'bench', 1), 30)`, '2026-11-30');
    check('wave assistance in deload week 4: 2 sets, 60 %', r && r.sets === 2 && r.weight === 18 && r.deload === true, r);

    r = await PR(TM({ 'romanian-deadlift': 100 }), 'p-hg', `planRow(rowOf('strength-wave', null, 'hinge', 0), 100)`, '2026-11-23');
    check('hinge day RDL is linear 3x8: no setWeights, no TM weight', r && r.sets === 3 && r.reps === 8 && r.setWeights === undefined && r.tmUsed === undefined && r.weight === undefined && r.deload === false, r);
    r = await PR(TM({}), 'p-hg', `planRow(rowOf('strength-wave', null, 'hinge', 0), 100)`, '2026-11-30');
    check('hinge day RDL deload week 4: 2 sets, 60 kg', r && r.sets === 2 && r.weight === 60 && r.deload === true, r);
    r = await PR(`prog('push-pull-legs','3day')`, 'p-push', `planRow(rowOf('push-pull-legs','3day','push',0), 62.5)`, '2026-12-28');
    const exp375 = await S(`roundToPlates(62.5 * 0.6)`);
    check('barbell deload 62.5 -> 37.5 via plates, not below the bar', r && r.weight === exp375 && r.weight === 37.5 && r.weight >= 20, [r, exp375]);

    console.log('== state');
    let st = await S(`startProgramState('push-pull-legs', '6day', null, { pushA: 'p1', pullA: 'p2', bogus: 'x' })`);
    check('startProgramState shape', st && st.id === 'push-pull-legs' && st.variant === '6day' && /^\d{4}-\d{2}-\d{2}$/.test(st.startedAt) && st.weekShift === 0 && st.plans.pushA === 'p1' && st.plans.bogus === undefined && st.endedAt === null && st.tm === undefined, st);
    st = await S(`startProgramState('strength-wave', null, { 'squats': 120, 'bench-press': 90, 'junk': 5, 'overhead-press': -5 }, {})`);
    check('wave state keeps tm for its main lifts only', st && st.tm && st.tm.squats === 120 && st.tm['bench-press'] === 90 && st.tm.junk === undefined && st.tm['overhead-press'] === undefined && st.tm['romanian-deadlift'] === undefined, st);
    check('unknown program / bad variant -> null', await S(`startProgramState('nope', null, null, {})`) === null && await S(`startProgramState('push-pull-legs', 'nope', null, {})`) === null);
    check('PPL without variant defaults to 3day', await S(`startProgramState('push-pull-legs', null, null, {}).variant`) === '3day');
    for (const [label, expr] of [
      ['upper-lower fresh', `startProgramState('upper-lower', null, null, { upperA: 'x' })`],
      ['wave with tm for the 3 lifts', `startProgramState('strength-wave', null, { squats: 120, 'bench-press': 90, 'overhead-press': 55 }, { squat: 'a', bench: 'b', hinge: 'c', press: 'd' })`],
      ['PPL 6day with all plans', `startProgramState('push-pull-legs', '6day', null, { pushA: 'a', pullA: 'b', legsA: 'c', pushB: 'd', pullB: 'e', legsB: 'f' })`],
      ['weekShift -3 with endedAt', `Object.assign(startProgramState('push-pull-legs', '3day', null, { push: 'a' }), { weekShift: -3, endedAt: '2026-12-01' })`],
      ['future field pausedAt (and nested unknown)', `Object.assign(startProgramState('upper-lower', null, null, { upperA: 'x' }), { pausedAt: '2026-11-20', future: { a: [1, 2] } })`],
    ]) {
      check('round-trips byte-identically: ' + label, await S(`(() => { const s = ${expr}; const j = JSON.stringify(s); return JSON.stringify(cleanProgramState(JSON.parse(j))) === j && j.length > 20; })()`));
    }
    check('unknown top-level fields are kept, known fields still validated', await S(`(() => { const c = cleanProgramState({ id: 'upper-lower', startedAt: '2026-11-11', weekShift: 999, pausedAt: 'x', plans: { upperA: 'a', zzz: 'b' } }); return c.pausedAt === 'x' && c.weekShift === 20 && JSON.stringify(c.plans) === '{"upperA":"a"}'; })()`));
    check('wave tm keeps only the 3 main lifts (RDL dropped)', await S(`J(cleanProgramState({ id: 'strength-wave', startedAt: '2026-11-11', tm: { squats: 100, 'bench-press': 80, 'overhead-press': 50, 'romanian-deadlift': 120 } }).tm)`) === J({ squats: 100, 'bench-press': 80, 'overhead-press': 50 }));
    const junk = [null, undefined, 5, 'x', [], {}, { id: 5 }, { id: 'nope' }, { id: 'push-pull-legs', variant: 'zzz', startedAt: '2026-11-11' }, { id: 'upper-lower', startedAt: 'nope' }, { id: 'upper-lower', startedAt: '2026-13-45' }, { id: 'upper-lower', startedAt: '2026-11-11', weekShift: 'a', plans: 5, tm: 'x' }];
    for (let i = 0; i < junk.length; i++) {
      const v = await S(`(() => { const c = cleanProgramState(${J(junk[i]) || 'undefined'}); return c === null ? 'null' : J(c); })()`);
      const expectNull = i < 11;
      check('junk #' + i + ' -> ' + (expectNull ? 'null' : 'sanitised object'), expectNull ? v === 'null' : (v !== 'null' && JSON.parse(v).weekShift === 0 && JSON.stringify(JSON.parse(v).plans) === '{}'), v);
    }
    check('weekShift clamped and rounded', await S(`cleanProgramState({ id: 'upper-lower', startedAt: '2026-11-11', weekShift: 999 }).weekShift`) === 20 && await S(`cleanProgramState({ id: 'upper-lower', startedAt: '2026-11-11', weekShift: -999 }).weekShift`) === -20);
    check('plans keep only known days with string ids', await S(`J(cleanProgramState({ id: 'upper-lower', startedAt: '2026-11-11', plans: { upperA: 'a', lowerA: 3, zzz: 'b' } }).plans)`) === J({ upperA: 'a' }));
    check('programWeek / programPrescription never throw on junk', await S(`(() => { const bad = [null, undefined, 5, 'x', [], {}, { id: 'push-pull-legs' }, { id: 'x', startedAt: 'y' }, { id: 'strength-wave', startedAt: 'zz', tm: 5 }]; for (const j of bad) { programWeek(j); programWeek(j, 'junk'); programPrescription(j, 'p', null); programPrescription(j, null, {}); programPrescription(j, 'p', { progRow: 5 }); } programWeek(prog('push-pull-legs', '3day'), 5); programWeek(prog('push-pull-legs', '3day'), null); programPrescription(prog('strength-wave', null, { tm: { 'bench-press': 'abc' } }), 'p-bn', { progRow: 'strength-wave:bench:0', weight: 'x' }, 'bad'); return true; })()`) === true);
    check('programWeek on junk -> null', await S(`programWeek(5) === null && programWeek({ id: 'zz' }) === null`) === true);
    check('no exceptions on page', p.errors.length === 0, p.errors);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
