'use strict';
/* Gym-Lift — Programs UI (gym-basics phase 4, task 4), in real headless Chrome. No accounts, no network.

     node tests/app/programs-ui.js

   One "Programs" tile in the Workout picker opens ONE sheet with three views: list -> detail -> (wave) training
   maxes, and the active-program view instead of the list while state.program is set. Starting creates one custom
   plan per day (rows carry progRow), sets state.program and offers to change the weekly goal (generic confirm).
   "Week n/N" / "Deload week" is only appended to existing text (Today next-up, Workout session label).
   Sheet standard: dialog role, Escape chain, focus in/restore, isBusy, NATIVE_BACK_CLOSE, 44 px, aria-pressed. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-programs-ui');
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
  const b = new Browser('programsui-' + Date.now().toString(36), 9877, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const ev = (s) => p.eval(s);
  const click = (sel) => ev(`(() => { const e = document.querySelector(${J(sel)}); if (!e) return false; e.click(); return true; })()`);
  const esc = () => ev(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  const boot = async () => {
    await p.navigate(BASE);
    await ev(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await wait(200);
  };
  const open = (v) => ev(`typeof state.program === 'undefined' ? null : (state.program && ${v} ? 1 : 0)`);
  const sheetOpen = () => ev(`!document.getElementById('modal-programs').hidden`);
  const body = () => ev(`document.getElementById('programs-body').innerText`);
  const todayShift = (weeks) => `localDateKey(addDays(new Date(), -7 * ${weeks}))`;
  try {
    await boot();
    await ev(`(() => { state.settings.weeklyGoal = 4; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(200);

    console.log('== the tile');
    check('exactly one new tile (#btn-programs-tile) in the Workout picker tiles', await ev(`document.querySelectorAll('#tr-pick .tr-tiles #btn-programs-tile').length === 1 && document.querySelectorAll('#tr-pick .tr-tiles > button').length === 6`));
    check('tile is a >= 44 px button with a translated label', await ev(`(() => { const e = document.getElementById('btn-programs-tile'); const r = e.getBoundingClientRect(); return r.height >= 44 && e.textContent.trim() === 'Programs'; })()`));
    check('Today has no new tile or line for programs', await ev(`!document.querySelector('#bento-grid [id*="program"], #screen-dnes [id*="program"]')`));

    console.log('== list');
    const xp0 = await ev(`JSON.stringify([workoutXP(), state.history, state.achievements, state.importedHistory])`);
    const plans0 = await ev(`Object.keys(state.plans).length`);
    await ev(`(document.getElementById('btn-programs-tile').focus(), document.getElementById('btn-programs-tile').click(), true)`);
    await wait(150);
    check('sheet opens with role=dialog + aria-modal + labelled title', await ev(`(() => { const d = document.querySelector('#modal-programs .modal'); return !document.getElementById('modal-programs').hidden && d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!document.getElementById(d.getAttribute('aria-labelledby')); })()`));
    check('focus moves into the sheet', await ev(`document.getElementById('modal-programs').contains(document.activeElement)`));
    check('isBusy while open', await ev(`isBusy()`));
    check('list shows the 4 programs as buttons', await ev(`JSON.stringify(Array.from(document.querySelectorAll('#programs-body [data-program]')).map((e) => e.dataset.program)) === JSON.stringify(['beginner-full-body', 'push-pull-legs', 'upper-lower', 'strength-wave'])`), await ev(`document.getElementById('programs-body').innerHTML.slice(0, 300)`));
    check('cards show level, days a week and length', /Beginner[^\n]*3 workouts a week[^\n]*8 weeks/.test(await body()), await body());
    check('PPL card says 3 or 6 workouts', /3 or 6 workouts a week/.test(await body()), await body());
    check('card targets are >= 44 px', await ev(`Array.from(document.querySelectorAll('#programs-body [data-program]')).every((e) => e.getBoundingClientRect().height >= 44)`));

    console.log('== detail (PPL)');
    await click('#programs-body [data-program="push-pull-legs"]');
    await wait(100);
    check('detail has the description, outline and a Start button', /Pushing, pulling and leg days/.test(await body()) && /Weeks 1–7: build · Week 8: deload/.test(await body()) && !!(await ev(`document.getElementById('btn-programs-start')`)), await body());
    check('variant chips: 3 days (pressed) and 6 days, aria-pressed', await ev(`(() => { const c = Array.from(document.querySelectorAll('#programs-body [data-variant]')); return c.length === 2 && c[0].getAttribute('aria-pressed') === 'true' && c[1].getAttribute('aria-pressed') === 'false' && c.every((x) => x.getBoundingClientRect().height >= 44); })()`));
    check('3-day detail lists 3 day plans with their exercises', await ev(`document.querySelectorAll('#programs-body .programs-day').length === 3 && /Bench press/i.test(document.getElementById('programs-body').innerText)`));
    await click('#programs-body [data-variant="6day"]');
    check('6-day chip shows 6 day plans', (await ev(`document.querySelectorAll('#programs-body .programs-day').length`)) === 6);
    await click('#programs-body [data-variant="3day"]');
    check('back button returns to the list', (await click('#btn-programs-back'), await ev(`document.querySelectorAll('#programs-body [data-program]').length`)) === 4);
    await click('#programs-body [data-program="push-pull-legs"]');

    console.log('== start 3-day PPL (goal 4 -> confirm)');
    check('Start is enabled', await ev(`!document.getElementById('btn-programs-start').disabled`));
    await click('#btn-programs-start');
    await wait(200);
    const st = await ev(`JSON.stringify(state.program)`);
    check('state.program is set (PPL, 3day, today, no shift)', await ev(`!!state.program && state.program.id === 'push-pull-legs' && state.program.variant === '3day' && state.program.startedAt === todayISO() && state.program.weekShift === 0`), st);
    const made = await ev(`(() => { const ids = ['push', 'pull', 'legs'].map((d) => state.program.plans[d]); return { ids, names: ids.map((i) => planNameOf(i)), tail: state.planOrder.slice(-3), custom: ids.every((i) => state.plans[i] && state.plans[i].builtin === false), rows: ids.map((i) => state.plans[i].exercises.map((r) => r.progRow)) }; })()`);
    check('3 custom plans created, named "PPL · Push/Pull/Legs"', J(made.names) === JSON.stringify(['PPL · Push', 'PPL · Pull', 'PPL · Legs']) && made.custom, made);
    check('plans are in planOrder in day order', J(made.tail) === J(made.ids), made);
    check('rows carry progRow <program>:<day>:<index>', made.rows[0][0] === 'push-pull-legs:push:0' && made.rows[2][4] === 'push-pull-legs:legs:4' && made.rows.every((r) => r.length === 5 && r.every((x) => typeof x === 'string')), made.rows);
    check('rows are library exercises with sets/reps, weight 0 without memory', await ev(`(() => { const r = state.plans[state.program.plans.push].exercises[0]; return r.id === 'bench-press' && r.builtin === true && r.sets === 3 && r.reps === 8 && r.weight === 0; })()`));
    check('goal confirmation (generic) is shown above the sheet, mentions 3 and 4', await ev(`(() => { const g = document.getElementById('modal-generic'); return !g.hidden && /3/.test(document.getElementById('generic-text').textContent) && /4/.test(document.getElementById('generic-text').textContent); })()`));
    check('goal not changed until OK', (await ev(`weeklyGoal()`)) === 4);
    await click('#btn-generic-ok');
    await wait(150);
    check('OK changes the weekly goal to 3', (await ev(`weeklyGoal()`)) === 3);
    check('sheet now shows the active program view (no list)', /Week 1 of 8/.test(await body()) && (await ev(`document.querySelectorAll('#programs-body [data-program]').length`)) === 0, await body());
    check('starting changed no XP / history / achievements', (await ev(`JSON.stringify([workoutXP(), state.history, state.achievements, state.importedHistory])`)) === xp0);
    await boot();
    check('program and goal survive a reload', await ev(`!!state.program && state.program.id === 'push-pull-legs' && weeklyGoal() === 3 && Object.keys(state.plans).length === ${plans0} + 3`));

    console.log('== Today next-up and session label (append only)');
    await ev(`(() => { const last = state.planOrder.filter((i) => !Object.values(state.program.plans).includes(i)).slice(-1)[0];
      state.history = [{ id: 'hp1', week: weekKey(new Date()), date: todayISO(), planId: last, planName: 'x', note: '', durationSeconds: 100, exercises: [] }];
      saveState(); switchTab('dnes'); renderAll(); return true; })()`);
    const next = await ev(`document.getElementById('dnes-next-plan').textContent`);
    check('next-up meta ends with " · Week 1/8"', / · Week 1\/8$/.test(next), next);
    check('no extra element was added to the next-up tile', await ev(`document.getElementById('dnes-next-plan').children.length === 0 && !document.querySelector('#bento-grid .prog-line')`));
    await ev(`(selectedPlan = state.program.plans.push, bentoTrainMode(), true)`);
    check('Workout session label ends with " · Week 1/8"', / · Week 1\/8/.test(await ev(`document.getElementById('tr-sess-plan').textContent`)), await ev(`document.getElementById('tr-sess-plan').textContent`));
    await ev(`(selectedPlan = 'push', bentoTrainMode(), true)`);
    check('a plan outside the program gets nothing appended', !/Week/.test(await ev(`document.getElementById('tr-sess-plan').textContent`)));
    await ev(`(state.history = [], saveState(), true)`);

    console.log('== active view: repeat / skip');
    await ev(`(switchTab('trening'), selectedPlan = state.planOrder[0], renderTrening(), document.getElementById('btn-programs-tile').focus(), document.getElementById('btn-programs-tile').click(), true)`);
    await wait(150);
    check('active view: week 1 offers Skip but not Repeat, plus End program', await ev(`!document.getElementById('btn-programs-repeat') && !!document.getElementById('btn-programs-skip') && !!document.getElementById('btn-programs-end')`));
    await click('#btn-programs-skip');
    await wait(100);
    check('Skip ahead: weekShift 1, label "Week 2 of 8"', (await ev(`state.program.weekShift`)) === 1 && /Week 2 of 8/.test(await body()), await body());
    check('Repeat appears from week 2', await ev(`!!document.getElementById('btn-programs-repeat')`));
    await click('#btn-programs-repeat');
    check('Repeat this week: weekShift back to 0, "Week 1 of 8"', (await ev(`state.program.weekShift`)) === 0 && /Week 1 of 8/.test(await body()), await body());
    check('day rows show the plan names', /PPL · Push/.test(await body()) && /PPL · Legs/.test(await body()));
    await click('#btn-programs-close');
    await ev(`(state.program.startedAt = ${todayShift(7)}, saveState(), renderAll(), true)`);
    await ev(`(document.getElementById('btn-programs-tile').click(), true)`);
    await wait(100);
    check('last week: no Skip ahead, Repeat offered, "Deload week" shown', await ev(`!document.getElementById('btn-programs-skip') && !!document.getElementById('btn-programs-repeat')`) && /Week 8 of 8/.test(await body()) && /Deload week/.test(await body()), await body());
    await click('#btn-programs-close');
    await ev(`(switchTab('dnes'), selectedPlan = state.program.plans.push, bentoTrainMode(), true)`);
    check('deload week appends " · Deload week"', / · Deload week/.test(await ev(`document.getElementById('tr-sess-plan').textContent`)));

    console.log('== deleting a program plan');
    await ev(`(removePlan(state.program.plans.pull), saveState(), renderAll(), true)`);
    await ev(`(document.getElementById('btn-programs-tile').click(), true)`);
    await wait(100);
    check('the removed day is shown as removed, no crash', /Removed/.test(await body()) && /PPL · Push/.test(await body()), await body());
    await click('#btn-programs-close');

    console.log('== finished state');
    await ev(`(state.program.startedAt = ${todayShift(10)}, saveState(), renderAll(), document.getElementById('btn-programs-tile').click(), true)`);
    await wait(100);
    check('finished: "Program finished", Start again and End, no Repeat/Skip', /Program finished/.test(await body()) && await ev(`!!document.getElementById('btn-programs-again') && !!document.getElementById('btn-programs-end') && !document.getElementById('btn-programs-skip') && !document.getElementById('btn-programs-repeat')`), await body());
    await click('#btn-programs-close');
    await ev(`(switchTab('dnes'), selectedPlan = state.program.plans.push, bentoTrainMode(), true)`);
    check('finished program: nothing appended to the session label', !/Week|Deload/.test(await ev(`document.getElementById('tr-sess-plan').textContent`)));
    const nPlans = await ev(`Object.keys(state.plans).length`);
    await ev(`(document.getElementById('btn-programs-tile').click(), true)`);
    await wait(100);
    await click('#btn-programs-again');
    await wait(200);
    await ev(`(document.getElementById('btn-generic-cancel').click(), true)`);
    check('Start again restarts at week 1 and reuses the existing plans (+1 recreated for the removed day)', await ev(`state.program.startedAt === todayISO() && state.program.weekShift === 0`) && (await ev(`Object.keys(state.plans).length`)) === nPlans + 1, await ev(`JSON.stringify(state.program)`));

    console.log('== End (confirmed)');
    const planIds = await ev(`JSON.stringify(Object.values(state.program.plans))`);
    await click('#btn-programs-end');
    await wait(100);
    check('End asks for confirmation (generic)', await ev(`!document.getElementById('modal-generic').hidden`));
    await click('#btn-generic-cancel');
    check('cancel keeps the program', await ev(`!!state.program`));
    await click('#btn-programs-end');
    await click('#btn-generic-ok');
    await wait(150);
    check('End clears state.program, plans and history remain', await ev(`!state.program`) && (await ev(`Object.values(${planIds}).every((i) => !!state.plans[i])`)) && (await ev(`JSON.stringify([workoutXP(), state.history, state.achievements, state.importedHistory])`)) === xp0);
    check('after End the sheet shows the list again', (await ev(`document.querySelectorAll('#programs-body [data-program]').length`)) === 4);

    console.log('== strength wave: training maxes');
    await ev(`(state.settings.exerciseMemory = { 'squats': { weight: 100 }, 'bench-press': { weight: 80 } }, state.settings.weeklyGoal = 3, saveState(), true)`);
    await click('#programs-body [data-program="strength-wave"]');
    check('wave detail has a Next button, no variant chips', await ev(`!!document.getElementById('btn-programs-start') && document.querySelectorAll('#programs-body [data-variant]').length === 0`));
    await click('#btn-programs-start');
    await wait(100);
    const tm = await ev(`JSON.stringify(Array.from(document.querySelectorAll('#programs-body input.programs-tm')).map((i) => [i.dataset.ex, i.value]))`);
    const want = await ev(`JSON.stringify([['squats', String(roundToPlates(110, plateSettings()))], ['bench-press', String(roundToPlates(88, plateSettings()))], ['overhead-press', '']])`);
    check('3 inputs prefilled 1.1 x remembered weight (plate-rounded) or empty', tm === want, [tm, want]);
    check('Start is disabled until all 3 are > 0', await ev(`document.getElementById('btn-programs-start').disabled === true`));
    await ev(`(() => { const i = document.querySelector('#programs-body input.programs-tm[data-ex="overhead-press"]'); i.value = '0'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    check('still disabled at 0', await ev(`document.getElementById('btn-programs-start').disabled === true`));
    await ev(`(() => { const i = document.querySelector('#programs-body input.programs-tm[data-ex="overhead-press"]'); i.value = '50'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    check('enabled once all are > 0', await ev(`document.getElementById('btn-programs-start').disabled === false`));
    check('inputs have accessible names and 44 px height', await ev(`Array.from(document.querySelectorAll('#programs-body input.programs-tm')).every((i) => (i.getAttribute('aria-label') || '').length > 5 && i.getBoundingClientRect().height >= 43.5)`));
    await click('#btn-programs-start');
    await wait(200);
    check('wave started: tm has the 3 lifts, 4 plans created', await ev(`state.program.id === 'strength-wave' && state.program.tm['overhead-press'] === 50 && Object.keys(state.program.tm).length === 3 && Object.keys(state.program.plans).length === 4`), await ev(`JSON.stringify(state.program)`));
    check('goal 3 vs 4 workouts: confirm shown; declining leaves the goal', await ev(`!document.getElementById('modal-generic').hidden`) && (await click('#btn-generic-cancel'), (await ev(`weeklyGoal()`)) === 3 && !!(await ev(`state.program`))));
    check('wave plan rows have progRow and the main flag stays in the data, not the plan', await ev(`state.plans[state.program.plans.squat].exercises[0].progRow === 'strength-wave:squat:0'`));
    await click('#btn-programs-close');

    console.log('== editing a program plan keeps progRow');
    await ev(`(startEditPlan(state.program.plans.squat), true)`);
    await ev(`(document.getElementById('btn-edit-save').click(), true)`);
    check('saving the plan editor keeps progRow on rows', await ev(`state.plans[state.program.plans.squat].exercises.every((r) => typeof r.progRow === 'string' && r.progRow.indexOf('strength-wave:squat:') === 0)`));
    await ev(`(state.program = null, saveState(), true)`);

    console.log('== state normalisation on load');
    await ev(`(state.program = { id: 'nope', startedAt: 'x' }, persistState(), true)`);
    await boot();
    check('invalid state.program is dropped on load', await ev(`!state.program`));
    await ev(`(state.program = { id: 'upper-lower', variant: null, startedAt: todayISO(), weekShift: 0, plans: {}, future: { a: 1 } }, persistState(), true)`);
    await boot();
    check('valid state.program survives load with unknown fields kept', await ev(`!!state.program && state.program.id === 'upper-lower' && state.program.future.a === 1`));
    await ev(`(state.program = null, saveState(), true)`);

    console.log('== sheet standard');
    await ev(`(switchTab('trening'), true)`);
    await ev(`(document.getElementById('btn-programs-tile').focus(), document.getElementById('btn-programs-tile').click(), true)`);
    await wait(100);
    await esc();
    check('Escape closes the sheet', await ev(`document.getElementById('modal-programs').hidden`));
    check('focus returns to the tile', await ev(`document.activeElement === document.getElementById('btn-programs-tile')`));
    check('Escape chain: generic confirm closes first', await ev(`(() => {
      document.getElementById('btn-programs-tile').click();
      const g = document.getElementById('modal-generic'); g.hidden = false;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const ok = g.hidden && !document.getElementById('modal-programs').hidden;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return ok && document.getElementById('modal-programs').hidden; })()`));
    check('Android Back: modal-programs is in NATIVE_BACK_CLOSE; Back steps from detail to list then closes', await ev(`(() => {
      const e = NATIVE_BACK_CLOSE.find((x) => x[0] === 'modal-programs');
      document.getElementById('btn-programs-tile').click();
      document.querySelector('#programs-body [data-program="upper-lower"]').click();
      const a = nativeBack(); const list = document.querySelectorAll('#programs-body [data-program]').length === 4 && !document.getElementById('modal-programs').hidden;
      const c = nativeBack(); const closed = document.getElementById('modal-programs').hidden;
      return !!e && e[1] === '#btn-programs-close' && list && closed; })()`));
    check('backdrop tap closes the sheet', await ev(`(() => { document.getElementById('btn-programs-tile').click(); const m = document.getElementById('modal-programs'); m.click(); return m.hidden; })()`));
    check('close and back targets are >= 44 px', await ev(`(() => { document.getElementById('btn-programs-tile').click(); document.querySelector('#programs-body [data-program]').click(); const r = ['btn-programs-close', 'btn-programs-back'].every((id) => { const x = document.getElementById(id).getBoundingClientRect(); return x.width >= 43.5 && x.height >= 43.5; }); document.getElementById('btn-programs-close').click(); return r; })()`));

    console.log('== 6 languages, light and dark, RTL, no overflow');
    await ev(`(state.settings.weeklyGoal = 3, state.program = null, saveState(), true)`);
    const langs = ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar'];
    for (const lang of langs) {
      for (const th of ['light', 'dark']) {
        await ev(`(setLang('${lang}'), document.documentElement.setAttribute('data-theme', '${th}'), state.program = null, renderAll(), switchTab('trening'), true)`);
        await wait(120);
        const checkView = async (label) => {
          const info = await ev(`(() => { const m = document.getElementById('modal-programs'); const d = m.querySelector('.modal'); const r = d.getBoundingClientRect(); const txt = d.innerText;
            return { open: !m.hidden, fit: r.left >= -0.5 && r.right <= innerWidth + 0.5, raw: /(^|\\s)(programs|prog)\\.[a-zA-Z]/.test(txt), over: document.documentElement.scrollWidth > innerWidth + 1, inner: d.scrollWidth > d.clientWidth + 1, rtl: getComputedStyle(document.documentElement).direction === 'rtl', ar: /[؀-ۿ]/.test(txt), len: txt.length }; })()`);
          check(lang + '/' + th + ' ' + label + ': fits, translated, no raw keys', info.open && info.fit && !info.raw && !info.over && !info.inner && info.len > 20 && (lang !== 'ar' || (info.rtl && info.ar)), info);
        };
        await ev(`(document.getElementById('btn-programs-tile').click(), true)`);
        await wait(80);
        await checkView('list');
        await ev(`(document.querySelector('#programs-body [data-program="push-pull-legs"]').click(), true)`);
        await checkView('detail');
        await ev(`(document.getElementById('btn-programs-back').click(), document.querySelector('#programs-body [data-program="strength-wave"]').click(), document.getElementById('btn-programs-start').click(), true)`);
        await checkView('tm');
        await ev(`(document.getElementById('btn-programs-close').click(), true)`);
        await ev(`(state.program = startProgramState('upper-lower', null, null, {}), saveState(), renderAll(), true)`);
        await ev(`(document.getElementById('btn-programs-tile').click(), true)`);
        await checkView('active');
        await ev(`(document.getElementById('btn-programs-close').click(), state.program = null, true)`);
      }
    }
    await ev(`(setLang('en'), document.documentElement.removeAttribute('data-theme'), true)`);
    const names = await ev(`(() => { const out = []; for (const l of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) { setLang(l); for (const pr of PROGRAMS) for (const v of programVariants(pr)) for (const d of v.days) out.push(programPlanName(pr, d).length); } setLang('en'); return Math.max.apply(null, out); })()`);
    check('generated plan names fit the 40-character editor limit in every language', names <= 40, names);
    const keys = ['programs.tile', 'programs.title', 'programs.close', 'programs.back', 'programs.levelBeginner', 'programs.levelIntermediate', 'programs.daysWeekOne', 'programs.daysWeekOther', 'programs.daysEither', 'programs.weeksOne', 'programs.weeksOther', 'programs.weekOne', 'programs.weekRange', 'programs.kindBuild', 'programs.kindDeload', 'programs.start', 'programs.next', 'programs.variants', 'programs.workouts', 'programs.tmTitle', 'programs.tmNote', 'programs.tmLabel', 'programs.weekOf', 'programs.weekShort', 'programs.deloadWeek', 'programs.repeat', 'programs.skip', 'programs.end', 'programs.removed', 'programs.finished', 'programs.finishedNote', 'programs.startAgain', 'programs.endShort', 'programs.endTitle', 'programs.endText', 'programs.endOk', 'programs.goalTitle', 'programs.goalText', 'programs.goalOk', 'programs.goalKeep', 'prog.short.beginner-full-body', 'prog.short.push-pull-legs', 'prog.short.upper-lower', 'prog.short.strength-wave'];
    check('every programs key exists in all six languages', await ev(`${J(keys)}.filter((k) => !['sk','en','es','pt-BR','fr','ar'].every((l) => typeof BASICS_I18N[l][k] === 'string' && BASICS_I18N[l][k].length > 0))`).then((m) => m.length === 0 ? true : false), await ev(`${J(keys)}.filter((k) => !['sk','en','es','pt-BR','fr','ar'].every((l) => typeof BASICS_I18N[l][k] === 'string' && BASICS_I18N[l][k].length > 0))`));
    check('Arabic plural forms exist (one/two/few/many/other) for days and weeks', await ev(`['programs.daysWeek', 'programs.weeks'].every((b) => ['One', 'Two', 'Few', 'Many', 'Other'].every((s) => typeof BASICS_I18N.ar[b + s] === 'string'))`));
    check('no console errors', logs.length === 0, logs);
  } catch (e) {
    fail++;
    console.log('  FAIL exception: ' + (e && e.stack || e));
  }
  b.killHard && b.killHard(true);
  await server.close();
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
