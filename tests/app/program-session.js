'use strict';
/* Predpis programu v reálnom prehliadači: snímka pri štarte, úpravy používateľa, história a XP.
   Spustenie z worktree: ../../../../claude-code/gym-basics/t.sh tests/app/program-session.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');
const REPO = path.resolve(__dirname, '..', '..');
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-program-session');
const J = JSON.stringify;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info === undefined ? '' : ' -> ' + J(info))); }
}
(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const cfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(cfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = cfg;
  const server = await startServer(8124, { new: REPO });
  const browser = new Browser('programsession-' + Date.now().toString(36), 9884, path.join(WORK, 'profiles'));
  const p = await browser.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const ev = (s) => p.eval(s);
  const tile = "document.querySelector('#exercise-list .exercise')";
  const values = () => ev(`({ weights: Array.from(${tile}.querySelectorAll('input.set-weight'), x => Number(x.value)), reps: Array.from(${tile}.querySelectorAll('input.set-reps'), x => Number(x.value)) })`);
  const chip = () => ev(`(${tile}.querySelector('.sugg-chip') || {}).textContent || null`);
  const setup = (id = 'push-pull-legs', week = 1, extra = '') => ev(`(() => {
    closeSuggestSheet(); document.getElementById('modal-result').hidden = true;
    state.activeSession = null; state.history = []; state.importedHistory = [];
    state.settings.showSuggestions = true; state.settings.autoRest = false;
    state.settings.plates = { bar: 20, plates: [20, 10, 5, 2.5, 1.25] };
    const def = programById(${J(id)}), variant = programVariants(def)[0];
    const day = variant.days.find(d => d.id === ${J(id === 'strength-wave' ? 'bench' : 'push')});
    const rows = programPlanRows(day); rows.forEach(r => { r.weight = 100; });
    state.plans.ps = { id: 'ps', builtin: false, customName: 'Program session', location: null, exercises: rows };
    if (!state.planOrder.includes('ps')) state.planOrder.push('ps');
    state.program = startProgramState(def.id, variant.id, { 'bench-press': 100, squats: 100, 'overhead-press': 100 }, { [day.id]: 'ps' });
    state.program.weekShift = ${week - 1}; selectedPlan = 'ps';
    ${extra}
    recalculateAll(); saveState(); switchTab('trening'); renderTrening(); return true;
  })()`);
  const start = () => ev(`(document.getElementById('tr-start').click(), true)`);
  try {
    await p.navigate('http://localhost:8124/');
    await ev(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    console.log('== capture once and linear suggestions');
    await setup('push-pull-legs', 1, `rows[0].sets = 5; rows[0].reps = 2;
      rows.push({ id: 'cx-plain', name: 'Plain', sets: 4, reps: 7, weight: 30 });
      state.history = [{ id: 'previous', date: localDateKey(addDays(new Date(), -3)), week: weekKey(addDays(new Date(), -3)), planId: 'ps', exercises: [{ exId: 'bench-press', name: rows[0].name, sets: 3, reps: 8, weight: 100, setsDone: 3 }] }];`);
    const plans = await ev('JSON.stringify(state.plans.ps)');
    await ev(`(window.__prescribe = programPrescription, window.__calls = 0, programPrescription = (...args) => { window.__calls++; return window.__prescribe(...args); }, true)`);
    await start();
    check('template replaces session sets/reps only', J(await values()) === J({ weights: [100, 100, 100], reps: [8, 8, 8] }), await values());
    check('plan remains byte-identical at start', await ev('JSON.stringify(state.plans.ps)') === plans);
    check('linear chip combines program target and normal suggestion', /Program: 3×8.*Try 102.5 kg/.test(await chip()), await chip());
    check('normal suggestion is not automatically applied', (await values()).weights.every(w => w === 100));
    const calls = await ev('window.__calls');
    await ev('(ensureSession(currentPlan()), renderTrening(), renderTrening(), true)');
    check('prescription evaluated once per row only at start', calls === 6 && await ev('window.__calls') === calls, calls);
    await ev(`(programPrescription = window.__prescribe, true)`);
    check('row without progRow stays ordinary', await ev(`(() => { const ex = sessionExercises(currentPlan()).at(-1); return sessionSetCount(ex) === 4 && ex.reps === 7 && effectiveSetWeight(ex, 0) === 30 && !chipInfo(ex, {}, currentPlan()); })()`));
    await ev(`(${tile}.querySelector('.sugg-chip').click(), document.getElementById('btn-suggest-use').click(), true)`);
    check('linear Use applies normal suggestion to unfinished sets', (await values()).weights.every(w => w === 102.5));
    check('linear chip hides when normal target matches', await chip() === null);
    check('D5 explicit hide suppresses default fallback', await ev(`(() => { const provider = chipProgramProvider; chipProgramProvider = () => ({ hide: true }); const ex = sessionExercises(currentPlan())[0]; setSetWeight(ex, 0, 90); const hidden = chipInfo(ex, {}, currentPlan()) === null; chipProgramProvider = provider; return hidden; })()`));

    console.log('== deload, plan edits, refresh');
    await setup('push-pull-legs', 8); await start();
    check('deload reduces 3 sets to 2 at 60%', J(await values()) === J({ weights: [60, 60], reps: [8, 8] }), await values());
    check('initial deload target remains explainable', /Deload.*60/.test(await chip()), await chip());
    const snapshot = await ev('JSON.stringify(getSession().snapshot)');
    await ev(`(() => { const ex = sessionExercises(currentPlan())[0]; setSetWeight(ex, 1, 65); setSetReps(ex, 1, 6);
      state.plans.ps.exercises[0].sets = 8; state.plans.ps.exercises[0].reps = 20; state.plans.ps.exercises[0].weight = 200;
      delete state.plans.ps.exercises[0].progRow; state.program.weekShift = 0; saveState(); renderTrening(); return true; })()`);
    check('plan/week edits cannot replace active prescription or user edits', J(await values()) === J({ weights: [60, 65], reps: [8, 6] }), await values());
    check('raw plan callers read snapshot set count and reps', await ev(`sessionSetCount(state.plans.ps.exercises[0]) === 2 && effectiveSetReps(state.plans.ps.exercises[0], 0) === 8`));
    await p.reload(); await ev(`(switchTab('trening'), renderTrening(), true)`);
    check('refresh preserves exact snapshot metadata', await ev('JSON.stringify(getSession().snapshot)') === snapshot);
    check('refresh preserves user values', J(await values()) === J({ weights: [60, 65], reps: [8, 6] }), await values());
    check('explanation remains deload after program week changed', /Deload.*60/.test(await chip()), await chip());
    await ev(`(state.program = null, renderTrening(), true)`);
    check('ending program does not remove running prescription', /Deload.*60/.test(await chip()));

    console.log('== wave per-set defaults and explicit Use');
    await setup('strength-wave', 3); await start();
    check('wave week 3 uses 75/85/95 and 5/3/1', J(await values()) === J({ weights: [75, 85, 95], reps: [5, 3, 1] }), await values());
    await ev(`(${tile}.querySelector('.sugg-chip').click(), true)`);
    check('wave explanation contains frozen week, percentages and TM', await ev(`['3/8', '75/85/95%', '100 kg'].every(s => document.getElementById('suggest-text').textContent.includes(s))`));
    await ev('(closeSuggestSheet(), true)');
    await ev(`(() => { const ex = sessionExercises(currentPlan())[0]; toggleSetMark('done', ex, 2, true); setSetWeight(ex, 0, 80); setSetReps(ex, 0, 7); renderTrening(); return true; })()`);
    check('user changes carry forward but completed later set stays locked', J(await values()) === J({ weights: [80, 80, 95], reps: [7, 7, 1] }), await values());
    await ev(`(${tile}.querySelector('.sugg-chip').click(), document.getElementById('btn-suggest-use').click(), true)`);
    check('Use restores each unfinished wave weight and reps, preserves done set', J(await values()) === J({ weights: [75, 85, 95], reps: [5, 3, 1] }), await values());
    await ev(`(() => { const ex = sessionExercises(currentPlan())[0]; addSessionSet(ex); renderTrening(); return true; })()`);
    check('user-added set inherits last actual wave set', J(await values()) === J({ weights: [75, 85, 95, 95], reps: [5, 3, 1, 1] }), await values());
    await ev(`(() => { const ex = sessionExercises(currentPlan())[0]; removeLastSessionSet(ex); toggleSetMark('done', ex, 0, true); toggleSetMark('done', ex, 1, true); renderTrening(); return true; })()`);
    check('all done hides program chip without normal fallback', await chip() === null);
    await ev('(finishWorkout(), confirmFinish(), true)');
    const history = await ev('state.history.at(-1).exercises[0]');
    check('finish records actual per-set wave values', J(history.setWeights) === J([75, 85, 95]) && J(history.setReps) === J([5, 3, 1]) && history.setsDone === 3 && history.weight === 95, history);
    check('program finish earns ordinary 3-set workout XP', await ev('workoutXP()') === 36, await ev('workoutXP()'));

    console.log('== second wave TM and malformed legacy states');
    await setup('strength-wave', 7); await start();
    await ev(`(state.program.tm['bench-press'] = 250, state.program.weekShift = 0, renderTrening(), ${tile}.querySelector('.sugg-chip').click(), true)`);
    check('wave 2 explanation uses captured tmUsed 102.5, not current TM', await ev(`document.getElementById('suggest-text').textContent.includes('102.5 kg') && !document.getElementById('suggest-text').textContent.includes('250')`));
    await ev('(closeSuggestSheet(), saveState(), true)'); await p.reload(); await ev(`(switchTab('trening'), renderTrening(), ${tile}.querySelector('.sugg-chip').click(), true)`);
    check('wave 2 TM survives reload', await ev(`document.getElementById('suggest-text').textContent.includes('102.5 kg')`));
    await ev('(closeSuggestSheet(), true)');
    await setup('strength-wave', 3, `state.program.tm = {};`); await start();
    check('missing TM never creates zero or NaN weights', (await values()).weights.every(w => w === 100));
    check('missing TM suppresses misleading ordinary suggestion', await chip() === null);
    await setup('strength-wave', 3, `state.settings.plates = { bar: 15, plates: [20, 10, 5, 2.5] }; state.program.tm['bench-press'] = 10;`); await start();
    check('small TM rounds to plates and never below bar', (await values()).weights.every(w => w === 15));
    check('invalid snapshot fields are discarded without losing valid old weight', await ev(`(() => { const raw = JSON.parse(JSON.stringify(getSession())); const key = Object.keys(raw.snapshot)[0]; raw.snapshot[key] = { weight: 42, sets: -1, reps: 'oops', setWeights: [NaN], setReps: [-1], program: { week: NaN } }; const s = normalizeActiveSession(raw).snapshot[key]; return s.weight === 42 && s.sets === undefined && s.reps === undefined && s.setWeights === undefined && s.program === undefined; })()`));
    await setup('push-pull-legs', 8); await start();
    await ev(`(() => { const s = getSession(); Object.values(s.snapshot).forEach(v => { for (const k of Object.keys(v)) if (!['weight', 'unilateral', 'startSide', 'assisted'].includes(k)) delete v[k]; }); saveState(); return true; })()`);
    await p.reload(); await ev('(switchTab("trening"), renderTrening(), true)');
    check('old sessions never gain program fields on reload', (await values()).weights.every(w => w === 60) && (await values()).weights.length === 3 && await chip() === null);
    await setup('push-pull-legs', 8, `state.program = null;`); await start();
    check('ordinary session keeps plan sets/reps/weight', J(await values()) === J({ weights: [100, 100, 100], reps: [8, 8, 8] }));

    console.log('== unilateral, accessories and implicit session start');
    await setup('strength-wave', 3, `rows[0].unilateral = true; rows[0].startSide = 'right';`);
    await start();
    check('wave defaults apply independently to both sides', J(await values()) === J({ weights: [75, 75, 85, 85, 95, 95], reps: [5, 5, 3, 3, 1, 1] }), await values());
    await ev(`(() => { const ex = sessionExercises(currentPlan())[0]; setSetWeight(ex, 0, 70, 'right'); setSetReps(ex, 0, 4, 'right'); toggleSetMark('done', ex, 0, true, 'right'); renderTrening(); ${tile}.querySelector('.sugg-chip').click(); document.getElementById('btn-suggest-use').click(); return true; })()`);
    check('Use respects a completed side and restores every other side', J(await values()) === J({ weights: [70, 75, 85, 85, 95, 95], reps: [4, 5, 3, 3, 1, 1] }), await values());
    await setup('push-pull-legs', 8);
    await ev(`(${tile}.querySelector('.set-btn').click(), true)`);
    check('first set tap also captures and renders deload immediately', J(await values()) === J({ weights: [60, 60], reps: [8, 8] }), await values());
    check('dumbbell accessory uses rounded deload, not barbell minimum', await ev(`(() => { const ex = sessionExercises(currentPlan())[2]; return sessionSetCount(ex) === 2 && effectiveSetWeight(ex, 0) === 60; })()`));
    await setup('strength-wave', 3, `rows[0].assisted = true; rows[0].weight = 30;`); await start();
    check('assisted wave row never receives lifting-TM percentages', (await values()).weights.every(w => w === 30) && await chip() === null);

    console.log('== Task 4 review regressions');
    await setup('strength-wave', 3);
    check('template tag cannot prescribe a different exercise identity', await ev(`(() => { const row = { ...state.plans.ps.exercises[0], id: 'incline-dumbbell-press' }; return programPrescription(state.program, 'ps', row) === null; })()`));
    await ev(`(startEditPlan('ps'), editDraft[0].weight = 77.5, editDraft[0].sets = 5, editDraft[0].reps = 6, editDraft.reverse(), saveEditPlan(), true)`);
    check('numeric edits and reorder preserve program tags', await ev(`state.plans.ps.exercises.every(r => typeof r.progRow === 'string') && state.plans.ps.exercises.at(-1).progRow === 'strength-wave:bench:0'`));
    await ev(`(() => { startEditPlan('ps'); const inp = document.querySelector('#edit-rows .edit-row:last-child .edit-name'); inp.value = 'Renamed lift'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); saveEditPlan(); return true; })()`);
    check('renaming removes stale progRow and prevents TM prescription', await ev(`(() => { const row = state.plans.ps.exercises.at(-1); return row.name === 'Renamed lift' && row.progRow === undefined && programPrescription(state.program, 'ps', row) === null; })()`));
    check('new program rows preserve assisted memory', await ev(`(() => { const old = state.settings.exerciseMemory; state.settings.exerciseMemory = { 'bench-press': { weight: 30, unilateral: true, startSide: 'right', assisted: true } }; const row = programPlanRows(programById('strength-wave').days[1])[0]; state.settings.exerciseMemory = old; return row.assisted === true && row.unilateral === true && row.startSide === 'right' && row.weight === 30; })()`));
    await ev(`(state.program = null, openPrograms(), programsGoTm('strength-wave', null, false), true)`);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      const form = await ev(`(() => { const inp = document.querySelector('input.programs-tm[data-ex="bench-press"]'); inp.value = '123.5'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); inp.setSelectionRange(1, 4); setLang(${J(lang)}); const next = document.querySelector('input.programs-tm[data-ex="bench-press"]'); return { value: next.value, focus: document.activeElement === next, start: next.selectionStart, end: next.selectionEnd, title: document.getElementById('programs-title').textContent === t('programs.tmTitle'), aria: next.getAttribute('aria-label') === t('programs.tmLabel', { name: exerciseDisplayName({ id: 'bench-press' }) }), note: document.querySelector('#programs-body .programs-desc').textContent === t('programs.tmNote') }; })()`);
      check(lang + ': TM translation keeps typed values, focus and selection', form.value === '123.5' && form.focus && form.start === 1 && form.end === 4 && form.title && form.aria && form.note, form);
    }
    await ev(`(closePrograms(), setLang('en'), true)`);

    console.log('== six languages, themes and uncluttered why sheet');
    await setup('strength-wave', 3); await start();
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      for (const theme of ['light', 'dark']) {
        await ev(`(setLang(${J(lang)}), document.documentElement.setAttribute('data-theme', ${J(theme)}), renderTrening(), true)`);
        const ui = await ev(`(() => { const tile = ${tile}, c = tile.querySelector('.sugg-chip'); const h = tile.getBoundingClientRect().height;
          state.settings.showSuggestions = false; renderTrening(); const off = ${tile}.getBoundingClientRect().height;
          state.settings.showSuggestions = true; renderTrening(); const chip = ${tile}.querySelector('.sugg-chip'); chip.click();
          const m = document.getElementById('modal-suggest'), r = m.querySelector('.modal').getBoundingClientRect();
          return { text: c.textContent, reason: document.getElementById('suggest-text').textContent, clean: h === off, count: ${tile}.querySelectorAll('.compare-hint .sugg-chip').length, fit: r.left >= -1 && r.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1, dialog: !!m.querySelector('[role="dialog"][aria-modal="true"]'), focus: m.contains(document.activeElement), rtl: document.documentElement.dir === 'rtl' }; })()`);
        check(lang + '/' + theme + ': translated single chip, stable tile, sheet fits and focuses', ui.clean && ui.count === 1 && ui.fit && ui.dialog && ui.focus && !/programSession\./.test(ui.text + ui.reason) && ui.reason.includes('100'), ui);
        if (lang === 'ar') check('Arabic text and RTL', ui.rtl && /[؀-ۿ]/.test(ui.reason), ui);
        await ev(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
        check(lang + '/' + theme + ': Escape closes and restores chip focus', await ev(`document.getElementById('modal-suggest').hidden && document.activeElement === ${tile}.querySelector('.sugg-chip')`));
      }
    }
    check('no browser exceptions', p.errors.length === 0, p.errors);
    check('no console errors', logs.length === 0, logs);
  } catch (e) { check('exception', false, String(e && e.stack || e)); }
  finally { browser.killHard(true); await server.close(); }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
