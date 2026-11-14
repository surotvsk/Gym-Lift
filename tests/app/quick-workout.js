'use strict';
/* GymQuest — tréning z cviku ("Quick workout") a pridanie cviku do rozbehnutého tréningu (v97),
   v reálnom headless Chrome. Bez účtov a siete.

     GQ_TEST_PORT=8190 GQ_SHOTS=<priečinok> node tests/app/quick-workout.js

   Checks: list cviku (Exercises) ponúka "Start workout with this exercise"; ťuknutie otvorí kartu Tréning
   s 1 cvikom a názvom "Quick workout"; + Add exercise z knižnice (aj vlastný cvik) pridá ďalšie; po obnovení
   stránky sa tréning obnoví; Finish zapíše jeden záznam (planName "Quick workout", planId 'quick'),
   state.plans sa nezmení, 'quick' nepokazí odporúčaný plán ani úspechy; s rozbehnutým Push tréningom list
   ponúka "Add to current workout" a "Go to current workout" (nikdy nie Start), Add pridá cvik bez zmeny
   značiek a plán zostane nezmenený; konflikt s aktivitou; 6 jazykov. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-quick');
const SHOTS = process.env.GQ_SHOTS || path.join(WORK, 'shots');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('quick-' + Date.now().toString(36), 9891, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const ev = (x) => p.eval(x);
  const sheetBtns = () => ev(`Array.from(document.querySelectorAll('#exercise-body [data-sheet-action^="quick"]')).map((b) => b.dataset.sheetAction)`);
  const blocks = () => ev(`Array.from(document.querySelectorAll('#exercise-list .exercise .exercise-name')).map((n) => n.textContent)`);
  const shot = async (name) => {
    if (process.env.GQ_SCREENSHOTS === '0') return;
    const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(s.data, 'base64'));
  };
  try {
    await p.navigate(BASE);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
    await ev(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    let plansBefore = await ev(`JSON.stringify(state.plans)`);
    const histBefore = await ev(`state.history.length`);

    console.log('== sheet without a running workout');
    await ev(`(openLibrary('browse', null), openExerciseSheet('bench-press', 'browse'), true)`); await wait(200);
    check('sheet offers only Start', J(await sheetBtns()) === J(['quickstart']), await sheetBtns());
    check('Start label is quick.start', (await ev(`document.querySelector('[data-sheet-action="quickstart"]').textContent`)) === 'Start workout with this exercise');
    await shot('sheet-start-en-light');
    await ev(`(document.querySelector('[data-sheet-action="quickstart"]').click(), true)`); await wait(300);
    check('Workout tab with a quick session of 1 exercise', (await ev(`activeTab === 'trening' && !!state.activeSession && state.activeSession.planId === 'quick' && state.activeSession.quick.exercises.length === 1`)) === true);
    check('title is Quick workout', (await ev(`document.getElementById('plan-title').textContent`)) === 'Quick workout' && (await ev(`document.getElementById('tr-sess-plan').textContent.trim()`)) === 'Quick workout');
    check('one exercise block, library defaults 3x10, weight = first plan row with the exercise (v100)', J(await blocks()) === J(['Bench press']) && (await ev(`state.activeSession.quick.exercises[0].sets === 3 && state.activeSession.quick.exercises[0].reps === 10 && state.activeSession.quick.exercises[0].weight === (Object.values(state.plans).flatMap((pl) => pl.exercises).find((r) => r.id === 'bench-press') || { weight: 0 }).weight`)) === true);
    check('library and sheet closed, plans unchanged', (await ev(`document.getElementById('modal-library').hidden && document.getElementById('modal-exercise').hidden`)) === true && (await ev(`JSON.stringify(state.plans)`)) === plansBefore);
    check('plan chips cannot rebind a quick session', (await ev(`(() => { const c = document.querySelector('#plan-chips .chip'); if (c) c.click(); return state.activeSession.planId; })()`)) === 'quick');
    await ev(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelector('.set-btn').click(), true)`); await wait(100);
    check('mark a set', (await ev(`totalSetsDone()`)) === 1);
    await shot('quick-running-en-light');

    console.log('== other entry points never replace the quick view');
    await ev(`(startWorkoutNow(), true)`); await wait(300);
    check('startWorkoutNow keeps quick blocks, mark and enabled Finish', J(await blocks()) === J(['Bench press']) && (await ev(`totalSetsDone()`)) === 1 && (await ev(`selectedPlan`)) === 'quick' && (await ev(`!document.getElementById('btn-finish-workout').disabled`)) === true, [await blocks(), await ev(`selectedPlan`)]);
    await ev(`(switchTab('dnes'), document.getElementById('btn-start-workout').click(), true)`); await wait(300);
    check('Home Continue keeps quick blocks and mark', J(await blocks()) === J(['Bench press']) && (await ev(`totalSetsDone()`)) === 1 && (await ev(`selectedPlan`)) === 'quick', await blocks());
    await ev(`(pickLocationPlan(activePlanIds()[0]), true)`); await wait(300);
    check('pickLocationPlan keeps quick session', (await ev(`selectedPlan === 'quick' && state.activeSession.planId === 'quick'`)) === true && J(await blocks()) === J(['Bench press']));
    await ev(`(finishWorkout(), true)`); await wait(100);
    await ev(`(selectedPlan = 'push', confirmFinish(), true)`); await wait(300);
    check('Finish writes planId quick even if selectedPlan was overwritten', (await ev(`state.history[state.history.length - 1].planId`)) === 'quick' && (await ev(`state.activeSession`)) === null);
    await ev(`(document.getElementById('modal-result').hidden = true, state.history.pop(), startQuickWorkout('bench-press'), document.querySelector('#exercise-list .exercise .set-btn').click(), true)`); await wait(200);
    plansBefore = await ev(`JSON.stringify(state.plans)`);

    console.log('== + Add exercise (library and custom)');
    await ev(`(document.getElementById('btn-session-add-exercise').click(), true)`); await wait(200);
    check('library opens in add mode with hint', (await ev(`libraryMode === 'add' && !document.getElementById('modal-library').hidden && document.getElementById('library-body').textContent.includes(t('quick.addHint'))`)) === true);
    await ev(`(document.querySelector('#library-body .lib-row[data-exercise-id="squats"]') || document.querySelector('#library-body .lib-row')).click()`); await wait(200);
    const sq = await ev(`exerciseSheetId`);
    check('sheet in add ctx offers only Add to current', J(await sheetBtns()) === J(['quickadd']), await sheetBtns());
    await ev(`(document.querySelector('[data-sheet-action="quickadd"]').click(), true)`); await wait(300);
    check('second exercise added, first one keeps its mark', (await blocks()).length === 2 && (await ev(`totalSetsDone()`)) === 1 && (await ev(`state.activeSession.quick.exercises.length`)) === 2, await blocks());
    await ev(`(state.plans['qx'] = { id: 'qx', builtin: false, customName: 'Custom plan', location: null, exercises: [{ name: 'My cable thing', sets: 2, reps: 12, weight: 5 }] }, state.planOrder.push('qx'), openExerciseSheet('c:My cable thing', 'add'), true)`); await wait(200);
    check('custom exercise sheet offers Add', J(await sheetBtns()) === J(['quickadd']), await sheetBtns());
    await ev(`(document.querySelector('[data-sheet-action="quickadd"]').click(), true)`); await wait(300);
    check('custom exercise added (no library id)', (await blocks()).length === 3 && (await ev(`state.activeSession.quick.exercises[2].id === undefined && state.activeSession.quick.exercises[2].name === 'My cable thing'`)) === true, await blocks());
    await ev(`(delete state.plans['qx'], state.planOrder = state.planOrder.filter((x) => x !== 'qx'), saveState(), true)`);

    console.log('== reload restores');
    await p.reload(); await wait(400);
    await ev(`(switchTab('trening'), true)`); await wait(300);
    plansBefore = await ev(`JSON.stringify(state.plans)`);   // po načítaní sú plány normalizované
    check('after reload: quick session, 3 exercises, mark kept', J(await blocks()) === J(['Bench press', 'Squats', 'My cable thing']) && (await ev(`state.activeSession.planId === 'quick' && totalSetsDone()`)) === 1, await blocks());
    check('title after reload', (await ev(`document.getElementById('plan-title').textContent`)) === 'Quick workout');

    console.log('== sheet during a running workout never offers Start');
    await ev(`(openExerciseSheet('leg-press', 'browse'), true)`); await wait(200);
    check('Add to current + Go to current', J(await sheetBtns()) === J(['quickadd', 'quickgo']), await sheetBtns());
    await ev(`(closeExerciseSheet(), true)`);

    console.log('== finish');
    await ev(`(finishWorkout(), confirmFinish(), true)`); await wait(400);
    const h = await ev(`(() => { const w = state.history[state.history.length - 1]; return { n: state.history.length, planId: w.planId, planName: w.planName, ex: w.exercises.map((e) => e.name + ':' + e.setsDone) }; })()`);
    check('one history entry planName Quick workout, planId quick', h.n === histBefore + 1 && h.planId === 'quick' && h.planName === 'Quick workout', h);
    check('exercises recorded (3, first with 1 set done)', h.ex.length === 3 && h.ex[0] === 'Bench press:1', h.ex);
    check('plans unchanged, session cleared', (await ev(`JSON.stringify(state.plans)`)) === plansBefore && (await ev(`state.activeSession`)) === null, [(await ev(`JSON.stringify(state.plans)`)) === plansBefore, await ev(`J_(state.activeSession)`)]);
    check('selectedPlan back to a real plan', (await ev(`!!getPlan(selectedPlan) && selectedPlan !== 'quick'`)) === true);
    await ev(`(document.getElementById('modal-result').hidden = true, renderAll(), true)`);
    const safe = await ev(`(() => { try { recommendedPlan(); renderPokrok(); renderKalendar(); renderDnes(); evaluateAchievements && 0; return [historyPlanName(state.history[state.history.length - 1]), distinctPlanIdsInHistory(), staticAchievementDefs().length > 0]; } catch (e) { return 'ERR ' + e.message; } })()`);
    check('history/stat code survives a quick entry, name shown translated', Array.isArray(safe) && safe[0] === 'Quick workout' && safe[1] === 0, safe);
    await ev(`(setLang('sk'), true)`);
    check('history name follows language', (await ev(`historyPlanName(state.history[state.history.length - 1])`)) === 'Rýchly tréning');
    await ev(`(setLang('en'), true)`);

    console.log('== recommended plan skips quick entries');
    const rec = await ev(`(() => { const before = recommendedPlan(); state.history = state.history.filter((w) => w.planId !== 'quick'); const pure = recommendedPlan(); return [before, pure]; })()`);
    check('rotation identical with and without the quick entry', rec[0] === rec[1], rec);

    console.log('== running Push workout: add to current, nothing discarded');
    await ev(`(selectedPlan = 'push', ensureSession(), saveState(), switchTab('trening'), renderTrening(), true)`); await wait(300);
    await ev(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelector('.set-btn').click(), true)`); await wait(100);
    const marks = await ev(`J_ = JSON.stringify, JSON.stringify(state.activeSession.completedSets)`);
    const sid = await ev(`state.activeSession.id`);
    const nBefore = (await blocks()).length;
    await ev(`(openLibrary('browse', null), openExerciseSheet('bench-press', 'browse'), true)`); await wait(200);
    check('with Push running: Add to current + Go to current, no Start', J(await sheetBtns()) === J(['quickadd', 'quickgo']), await sheetBtns());
    await shot('sheet-running-en-light');
    await ev(`(document.querySelector('[data-sheet-action="quickgo"]').click(), true)`); await wait(200);
    check('Go to current: Workout tab, same session', (await ev(`activeTab === 'trening' && state.activeSession.id === ${J(sid)}`)) === true);
    await ev(`(openExerciseSheet('bench-press', 'browse'), document.querySelector('[data-sheet-action="quickadd"]').click(), true)`); await wait(300);
    check('exercise appended, same session, marks unchanged, plan unchanged', (await blocks()).length === nBefore + 1 && (await ev(`state.activeSession.id`)) === sid && (await ev(`JSON.stringify(state.activeSession.completedSets)`)) === marks && (await ev(`JSON.stringify(state.plans)`)) === plansBefore, await blocks());
    check('extra stored in extraExercises with its own key', (await ev(`state.activeSession.extraExercises.length === 1 && state.activeSession.extraExercises[0].sessionKey.indexOf('q_') === 0 && state.activeSession.planId === 'push'`)) === true);
    check('duplicate bench press is a separate block with no marks', (await ev(`(() => { const bl = document.querySelectorAll('#exercise-list .exercise'); return bl[bl.length - 1].querySelectorAll('.set-btn.done').length; })()`)) === 0);
    await p.reload(); await wait(400);
    await ev(`(switchTab('trening'), true)`); await wait(300);
    check('reload keeps extra exercise and marks', (await blocks()).length === nBefore + 1 && (await ev(`JSON.stringify(state.activeSession.completedSets)`)) === marks);
    await ev(`(document.querySelectorAll('#exercise-list .exercise')[${nBefore}].querySelector('.set-btn').click(), true)`); await wait(100);
    await ev(`(finishWorkout(), confirmFinish(), true)`); await wait(400);
    const h2 = await ev(`(() => { const w = state.history[state.history.length - 1]; return { planId: w.planId, ex: w.exercises.map((e) => e.name + ':' + e.setsDone) }; })()`);
    check('Push entry includes the extra exercise; plan stays unchanged', h2.planId === 'push' && h2.ex.length === nBefore + 1 && h2.ex[h2.ex.length - 1] === 'Bench press:1' && (await ev(`JSON.stringify(state.plans)`)) === plansBefore, h2);

    console.log('== editing another plan during a session does not change the session screen');
    await ev(`(document.getElementById('modal-result').hidden = true, closeEditor(), clearSession(), setLang('en'), selectedPlan = 'push', ensureSession(), saveState(), switchTab('trening'), renderTrening(), true)`); await wait(300);
    await ev(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelector('.set-btn').click(), true)`); await wait(100);
    const plA = await ev(`(() => { const pl = getPlan('push'); return { n: planExerciseCount(pl), names: Array.from(document.querySelectorAll('#exercise-list .exercise')).length }; })()`);
    const other = 'qb';
    await ev(`(state.plans['qb'] = { id: 'qb', builtin: false, customName: 'Other plan', location: null, exercises: [{ name: 'Only one', sets: 2, reps: 8, weight: 5 }] }, state.planOrder.push('qb'), saveState(), true)`);
    await ev(`(startEditPlan(${J(other)}), true)`); await wait(200);
    const sumTxt = async () => ev(`document.getElementById('summary-bar').textContent`);
    const cntEx = async () => ev(`document.querySelectorAll('#exercise-list .exercise').length`);
    check('while editing B the session screen still lists A and "1 of total(A)"', (await cntEx()) === plA.names && (await sumTxt()).includes('1 of ' + plA.n + ' '), [await cntEx(), plA, await sumTxt()]);
    await ev(`(closeEditor(), renderTrening(), true)`); await wait(200);
    check('after closing the editor: A exercises, "1 of total(A)", selectedPlan A', (await cntEx()) === plA.names && (await sumTxt()).includes('1 of ' + plA.n + ' ') && (await ev(`selectedPlan`)) === 'push', [await cntEx(), plA, await sumTxt()]);
    await ev(`(finishWorkout(), confirmFinish(), true)`); await wait(400);
    check('Finish writes planId A with its 1 set', (await ev(`(() => { const w = state.history[state.history.length - 1]; return w.planId === 'push' && w.exercises[0].setsDone === 1; })()`)) === true);
    await ev(`(document.getElementById('modal-result').hidden = true, delete state.plans['qb'], state.planOrder = state.planOrder.filter((x) => x !== 'qb'), saveState(), true)`);

    console.log('== Start while a workout exists is refused; activity conflict');
    await ev(`(document.getElementById('modal-result').hidden = true, selectedPlan = 'push', ensureSession(), saveState(), startQuickWorkout('squats'), true)`); await wait(200);
    check('startQuickWorkout with a session only goes to it', (await ev(`state.activeSession.planId === 'push' && !state.activeSession.quick`)) === true);
    await ev(`(clearSession(), saveState(), state.activeActivity = { id: 'a1', kind: 'run', startedAt: Date.now() }, saveState(), startQuickWorkout('squats'), true)`); await wait(200);
    check('activity running: conflict dialog, no session yet', (await ev(`!document.getElementById('modal-generic').hidden && state.activeSession === null && !!state.activeActivity`)) === true);
    await ev(`(document.getElementById('btn-generic-ok').click(), true)`); await wait(300);
    check('confirming the conflict starts the quick workout', (await ev(`!!state.activeSession && state.activeSession.planId === 'quick' && !state.activeActivity`)) === true, await ev(`J_({ s: state.activeSession && state.activeSession.planId, a: state.activeActivity })`));

    console.log('== old/corrupt shapes');
    await ev(`(clearSession(), saveState(), true)`);
    const norm = await ev(`(() => ({
      noQuick: normalizeActiveSession({ id: 'x', startedAt: Date.now(), planId: 'quick', completedSets: {}, actualFailureSets: {} }),
      badExtra: normalizeActiveSession({ id: 'x', startedAt: Date.now(), planId: 'push', extraExercises: [{ name: '' }, 5, { name: 'Ok', sets: 3, reps: 10, weight: 0, sessionKey: 'q_1' }] }).extraExercises.length,
      old: Object.keys(normalizeActiveSession({ id: 'x', startedAt: Date.now(), planId: 'push' })).indexOf('extraExercises'),
    }))()`);
    check('quick without exercises is dropped; invalid extras filtered; old shape has no extras', norm.noQuick === null && norm.badExtra === 1 && norm.old === -1, norm);

    console.log('== languages, RTL, dark');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await ev(`(setLang(${J(lang)}), selectedPlan = 'push', ensureSession(), openExerciseSheet('bench-press', 'browse'), true)`); await wait(150);
      const r = await ev(`(() => { const bs = Array.from(document.querySelectorAll('#exercise-body .quick-action')); return { txt: bs.map((x) => x.textContent), h: bs.map((x) => x.getBoundingClientRect().height),
        over: document.documentElement.scrollWidth > innerWidth + 1, dir: document.documentElement.dir, miss: ['quick.name','quick.start','quick.addToCurrent','quick.goToCurrent','quick.addExercise','quick.addHint'].filter((k) => t(k) === k) }; })()`);
      check(lang + ': both labels translated, >= 44 px, no overflow, no missing keys', r.txt.length === 2 && r.txt.every((x) => x && !/^quick\./.test(x)) && r.h.every((x) => x >= 44) && !r.over && !r.miss.length, r);
      if (lang === 'ar') check('ar: rtl', r.dir === 'rtl');
    }
    await ev(`(closeExerciseSheet(), clearSession(), saveState(), state.activeActivity = null, true)`);
    for (const [lang, theme] of [['en', 'light'], ['en', 'dark'], ['ar', 'light'], ['ar', 'dark']]) {
      await ev(`(setLang(${J(lang)}), setThemePref(${J(theme)}), clearSession(), closeSessionMenu(), closeLibrary(), closeExerciseSheet(), true)`);
      await ev(`(openExerciseSheet('bench-press', 'browse'), true)`); await wait(250);
      await shot('sheet-start-' + lang + '-' + theme);
      await ev(`(document.querySelector('[data-sheet-action="quickstart"]').click(), true)`); await wait(300);
      await ev(`(window.scrollTo(0, 0), true)`);
      await shot('quick-running-' + lang + '-' + theme);
      await ev(`(openExerciseSheet('bench-press', 'browse'), true)`); await wait(250);
      await shot('sheet-running-' + lang + '-' + theme);
      await ev(`(closeExerciseSheet(), true)`);
    }
    await ev(`(setLang('en'), setThemePref('light'), true)`);

    check('no exceptions', p.errors.length === 0, p.errors);
    check('no console errors', logs.length === 0, logs);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
