'use strict';
/* Gym-Lift — vlastné svalové skupiny (v113), skutočný Chrome, iba syntetický hosť.

     GQ_SCREENSHOTS=0 GQ_TEST_PORT=8190 node tests/app/custom-muscles.js

   Editor Uložiť/otvoriť/obnoviť; spoločná identita; Auto verzus Iné; nemenná snímka tréningu
   a novej histórie; prepočet starej histórie bez prepisu; JSON import do čistého profilu.
   Bez screenshotov, účtov, presného počtu knižničných cvikov či zmeny dát používateľa. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const DEBUG_PORT = Number(process.env.GQ_DEBUG_PORT) || 9904;
const BASE = 'http://localhost:' + PORT + '/';
const workRoot = process.env.GQ_WORK || os.tmpdir();
fs.mkdirSync(workRoot, { recursive: true });
const WORK = fs.mkdtempSync(path.join(workRoot, 'gq-custom-muscles-'));
const emptyCfg = path.join(WORK, 'community-config.empty.js');
fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
/* Harness si konfiguráciu zachytí pri require, nie pri štarte servera. */
process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
process.env.GQ_SCREENSHOTS = '0';
const { startServer, Browser, waitFor } = require('../sync/lib');
const J = JSON.stringify;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info === undefined ? '' : ' -> ' + J(info))); }
}
function same(a, b) { return J(a) === J(b); }
const BACK = { primary: 'back', secondary: ['arms', 'core'] };
const LEGS = { primary: 'legs', secondary: ['glutes'] };
const OTHER = { primary: 'other', secondary: [] };

const SEED = `(() => {
  const s = defaultState();
  const row = (name, weight = 20) => ({ name, sets: 2, reps: 10, weight });
  s.plans = {
    ma: { id: 'ma', builtin: false, customName: 'Muscle A', location: null, exercises: [
      row('Workshop Arc'),
      { ...row('Bench Press', 40), id: 'bench-press', builtin: true, muscles: { primary: 'legs', secondary: [] } },
      row('Bench Press'),
      { ...row('Noisy Arc'), muscles: { primary: 'back', secondary: ['back', 'arms', 'arms', 'invalid', 'core'] } }
    ] },
    mb: { id: 'mb', builtin: false, customName: 'Muscle B', location: null, exercises: [row(' workshop  arc ', 30)] },
    mc: { id: 'mc', builtin: false, customName: 'Muscle C', location: null, exercises: [row('Placeholder')] },
    md: { id: 'md', builtin: false, customName: 'Blank session', location: null, exercises: [row('Blank Launch')] }
  };
  s.planOrder = ['ma', 'mb', 'mc', 'md'];
  s.settings.startersAdded = true;
  s.settings.exerciseMemory = {};
  s.settings.restPresets = [];
  s.settings.lang = 'en';
  s.history = [
    { id: 'old-unassigned', date: todayISO(), planId: 'ma', planName: 'Before assignment', xp: 0, note: '',
      exercises: [{ name: 'Workshop Arc', sets: 2, reps: 10, weight: 20, setsDone: 2 }] },
    { id: 'old-saved', date: todayISO(), planId: 'ma', planName: 'Saved assignment', xp: 0, note: '',
      exercises: [{ name: 'Workshop Arc', sets: 1, reps: 10, weight: 20, setsDone: 1,
        muscles: { primary: 'legs', secondary: ['core'] } }] }
  ];
  s.activeSession = null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  return JSON.stringify(s.history);
})()`;

(async () => {
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('custom-muscles', DEBUG_PORT, path.join(WORK, 'profiles'));
  const importedBrowser = new Browser('custom-muscles-import', DEBUG_PORT + 1, path.join(WORK, 'profiles'));
  try {
    const p = await b.launch();
    const E = (code) => p.eval(code);
    await p.navigate(BASE);
    const originalHistory = await E(SEED);
    await p.reload();
    await E(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); switchTab('trening'); return true; })()`);
    const open = (pid) => E(`(switchTab('trening'), startEditPlan(${J(pid)}), true)`);
    const save = () => E(`(() => { document.getElementById('btn-edit-save').click(); return { closed: editingPlan === null, error: document.getElementById('edit-error').textContent }; })()`);
    const primary = (idx, value) => E(`(() => {
      const row = document.querySelectorAll('#edit-rows .edit-row')[${idx}];
      const more = row.querySelector('.edit-more'); if (!more.open) more.querySelector('summary').click();
      const el = row.querySelector('.edit-muscle-primary'); el.value = ${J(value)};
      el.dispatchEvent(new Event('change', { bubbles: true })); return el.value;
    })()`);
    const helper = (idx, muscle) => E(`(() => { const el = document.querySelectorAll('#edit-rows .edit-row')[${idx}].querySelector('[data-muscle="${muscle}"]'); el.click(); return { checked: el.checked, disabled: el.disabled }; })()`);
    const controls = (idx) => E(`(() => {
      const row = document.querySelectorAll('#edit-rows .edit-row')[${idx}];
      return { hidden: row.querySelector('.edit-muscles').hidden, primary: row.querySelector('.edit-muscle-primary').value,
        helpers: Array.from(row.querySelectorAll('[data-muscle]'), el => ({ muscle: el.dataset.muscle, checked: el.checked, disabled: el.disabled })) };
    })()`);
    const planMeta = (pid, idx = 0) => E(`state.plans[${J(pid)}].exercises[${idx}].muscles || null`);
    const oldRaw = () => E(`JSON.stringify(state.history.filter(w => w.id === 'old-unassigned' || w.id === 'old-saved'))`);
    const week = () => E(`muscleWeek(currentWeekKey())`);
    const closeEditor = () => E(`(document.getElementById('btn-edit-cancel').click(), true)`);
    const start = (pid) => E(`(selectedPlan = ${J(pid)}, ensureSession(getPlan(${J(pid)})), saveState(), switchTab('trening'), true)`);
    const finishFirst = () => E(`(() => {
      const ex = exerciseSlots(currentPlan())[0].ex;
      for (let i = 0; i < sessionSetCount(ex); i++) toggleSetMark('done', ex, i, true);
      saveState(); renderTrening(); finishWorkout(); document.getElementById('btn-confirm-ok').click();
      const w = state.history[state.history.length - 1]; document.getElementById('btn-result-close').click();
      return { id: w.id, entry: w.exercises[0], session: getSession() };
    })()`);

    console.log('== editor, helpers and shared identity');
    check('loading does not rewrite the historical records', await oldRaw() === originalHistory);
    let wk = await week();
    check('unknown old record starts in Other; saved record keeps its group', wk.sets.other === 2 && wk.sets.legs === 1 && wk.sets.core === 0.5, wk.sets);
    await open('ma');
    const builtin = await controls(1), custom = await controls(2);
    check('built-in controls are hidden, same-named custom controls are available', builtin.hidden && !custom.hidden, { builtin, custom });
    check('blank primary disables all helper choices', custom.primary === '' && custom.helpers.every(h => h.disabled && !h.checked), custom);
    await primary(0, 'back');
    await helper(0, 'arms'); await helper(0, 'core');
    await helper(0, 'arms'); await helper(0, 'arms');
    await primary(0, 'arms');
    let c = await controls(0);
    check('promoting a helper removes it and disables self-selection', c.primary === 'arms' && c.helpers.some(h => h.muscle === 'arms' && h.disabled && !h.checked) && c.helpers.some(h => h.muscle === 'core' && h.checked), c);
    await primary(0, 'back'); await helper(0, 'arms');
    const saved = await save();
    check('actual Save closes the editor', saved.closed, saved);
    check('Save preserves one primary and unique helpers', same(await planMeta('ma'), BACK), await planMeta('ma'));
    check('loaded duplicate/invalid/self helpers are cleaned by editor Save', same(await planMeta('ma', 3), BACK), await planMeta('ma', 3));
    const identity = await E(`state.plans.ma.exercises[0].id`);
    check('normalized custom names share assignment, not plan-local weight', await E(`state.plans.mb.exercises[0].id === ${J(identity)} && state.plans.mb.exercises[0].weight === 30`) && same(await planMeta('mb'), BACK));
    check('shared memory includes the saved classification', same(await E(`state.settings.exerciseMemory[${J(identity)}].muscles`), BACK));
    check('built-in muscle calculation ignores custom override metadata', await E(`(() => { const sh = muscleShare(state.plans.ma.exercises[1]); return sh.chest === 1 && !sh.legs; })()`));
    await p.reload(); await open('mb'); c = await controls(0);
    check('reopen after reload shows primary and exactly the selected helpers', c.primary === 'back' && same(c.helpers.filter(h => h.checked).map(h => h.muscle), ['arms', 'core']), c);
    await closeEditor();

    await open('mc');
    await E(`(() => { const el = document.querySelector('#edit-rows .edit-name'); el.value = 'Workshop Arc'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    c = await controls(0);
    check('typing an existing custom identity prefills its assignment', c.primary === 'back' && c.helpers.filter(h => h.checked).length === 2, c);
    await save();
    check('new plan row saves the same shared identity and groups', await E(`state.plans.mc.exercises[0].id === ${J(identity)}`) && same(await planMeta('mc'), BACK));

    console.log('== Auto, explicit Other and canonical built-ins');
    await open('ma'); await primary(2, 'legs'); await save();
    check('explicit custom assignment beats an exact library-name match', await E(`muscleShare(state.plans.ma.exercises[2]).legs === 1 && !muscleShare(state.plans.ma.exercises[2]).chest`));
    await open('ma'); await primary(2, 'other'); await save(); await open('ma');
    c = await controls(2);
    check('explicit Other survives Save/reopen and disables helpers', c.primary === 'other' && c.helpers.every(h => h.disabled && !h.checked), c);
    await closeEditor();
    check('Other suppresses exact-name fallback', same(await E(`muscleShare(state.plans.ma.exercises[2])`), { other: 1 }));
    await open('ma'); await primary(2, ''); await save();
    check('clearing assignment restores exact-name Auto, not a stale shared assignment', await E(`(() => { const sh = muscleShare(state.plans.ma.exercises[2]); return sh.chest === 1 && !sh.legs && !sh.other; })()`));
    await open('ma'); await primary(0, 'other'); await save();
    check('Other propagates to existing custom rows', same(await planMeta('mb'), OTHER) && same(await planMeta('mc'), OTHER));
    await open('ma'); await primary(0, ''); await save(); await p.reload();
    check('clearing an unknown custom assignment survives reload as Auto/Other', await E(`!state.plans.ma.exercises[0].muscles && !state.settings.exerciseMemory[${J(identity)}].muscles`) && same(await E(`muscleShare(state.plans.ma.exercises[0])`), { other: 1 }));
    check('all assignment edits leave raw old history untouched', await oldRaw() === originalHistory);

    console.log('== old history reclassifies only on read');
    await open('ma'); await primary(0, 'back'); await helper(0, 'arms'); await helper(0, 'core'); await save();
    wk = await week();
    check('old unassigned sets and volume use current primary/helpers', wk.sets.back === 2 && wk.sets.arms === 1 && wk.sets.core === 1.5 && wk.volume.back === 400 && wk.volume.arms === 200 && wk.sets.legs === 1 && !wk.sets.other, wk);
    await E(`(openMuscles(), document.getElementById('muscles-breakdown').open = true, renderMuscleBreakdown(), true)`);
    const trace = await E(`Array.from(document.querySelectorAll('.mu-trace-row'), row => ({ name: row.querySelector('h4').textContent, text: row.innerText, contribution: row.querySelector('.mu-contribution').textContent }))`);
    check('visible breakdown shows reclassified old record and separately saved record', trace.some(r => r.name === 'Workshop Arc' && /Back: 2/.test(r.contribution) && /Arms: 1/.test(r.contribution)) && trace.some(r => /Legs: 1/.test(r.contribution)), trace);
    await E(`(closeMuscles(), true)`);
    check('reading aggregates and breakdown does not rewrite history', await oldRaw() === originalHistory);

    console.log('== assigned session freezes across edit, reload and completion');
    await start('ma');
    check('new session captures explicit classification', same(await E(`exerciseSlots(currentPlan())[0].ex.muscles`), BACK));
    await open('mb'); await primary(0, 'legs'); await helper(0, 'arms'); await helper(0, 'core'); await helper(0, 'glutes'); await save();
    check('live assignment changes across plans during the session', same(await planMeta('ma'), LEGS));
    await open('ma'); await primary(2, 'other'); await save();
    check('exact-name Auto session freezes derived groups despite later explicit Other', await E(`(() => { const sh = muscleShare(exerciseSlots(currentPlan())[2].ex); return sh.chest === 1 && !sh.other; })()`));
    check('running slot still has its original contribution', same(await E(`muscleShare(exerciseSlots(currentPlan())[0].ex)`), { back: 1, arms: 0.5, core: 0.5 }));
    await p.reload();
    check('normalized session preserves the frozen assignment', same(await E(`exerciseSlots(currentPlan())[0].ex.muscles`), BACK));
    const completed = await finishFirst();
    check('completion stores the session assignment and ends session', same(completed.entry.muscles, BACK) && completed.entry.setsDone === 2 && completed.session === null, completed);
    check('completed custom exact-name row freezes derived groups; built-in keeps canonical id', await E(`(() => {
      const rows = state.history.find(w => w.id === ${J(completed.id)}).exercises;
      return rows[2].muscles && rows[2].muscles.primary === 'chest' && !rows[2].exId
        && rows[1].exId === 'bench-press' && !rows[1].muscles;
    })()`));
    const completedRaw = await E(`JSON.stringify(state.history.find(w => w.id === ${J(completed.id)}))`);
    await open('ma'); await primary(0, 'chest'); await helper(0, 'glutes'); await save();
    wk = await week();
    check('old unassigned history follows new group; completed and saved history stay fixed', wk.sets.chest === 2 && wk.sets.back === 2 && wk.sets.legs === 1 && wk.sets.arms === 1 && wk.sets.core === 1.5, wk.sets);
    check('neither old records nor completed record are rewritten', await oldRaw() === originalHistory && await E(`JSON.stringify(state.history.find(w => w.id === ${J(completed.id)}))`) === completedRaw);

    console.log('== blank-start session and explicit new-history Other stay fixed');
    await start('md');
    check('unknown Auto is frozen as Other at session start', same(await E(`muscleShare(exerciseSlots(currentPlan())[0].ex)`), { other: 1 }));
    await open('md'); await primary(0, 'arms'); await save(); await p.reload();
    check('later assignment does not leak into blank-start snapshot after normalize', same(await E(`muscleShare(exerciseSlots(currentPlan())[0].ex)`), { other: 1 }));
    const blank = await finishFirst();
    check('completion saves explicit Other rather than future live lookup', same(blank.entry.muscles, OTHER), blank.entry);
    await open('md'); await primary(0, 'core'); await save(); await p.reload();
    check('new Other history remains Other after another edit/reload', same(await E(`muscleShare(state.history.find(w => w.id === ${J(blank.id)}).exercises[0])`), { other: 1 }));
    check('old historical bytes are still unchanged', await oldRaw() === originalHistory);

    console.log('== backup import into a separate guest profile');
    /* Záloha zámerne vynecháva session; jej normalizácia je otestovaná obnovením vyššie. */
    await start('md');
    const backup = await E(`backupPayload()`);
    const payload = JSON.parse(backup);
    check('backup excludes running session but includes custom plan and memory metadata', !Object.prototype.hasOwnProperty.call(payload, 'activeSession') && payload.plans.ma.exercises[0].muscles.primary === 'chest' && payload.settings.exerciseMemory[identity].muscles.primary === 'chest');
    const p2 = await importedBrowser.launch();
    await p2.navigate(BASE);
    await p2.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p2.eval(`(() => {
      const transfer = new DataTransfer(); transfer.items.add(new File([${J(backup)}], 'custom-muscles.json', { type: 'application/json' }));
      const input = document.getElementById('file-import'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true })); return true;
    })()`);
    await waitFor(() => p2.eval(`typeof pendingImport !== 'undefined' && !!pendingImport && !document.getElementById('modal-generic').hidden`), 10000, 'JSON import confirmation');
    await p2.eval(`(document.getElementById('btn-generic-ok').click(), true)`);
    await p2.reload();
    const roundTrip = await p2.eval(`({
      assignment: state.plans.ma.exercises[0].muscles,
      memory: state.settings.exerciseMemory[${J(identity)}].muscles,
      oldRaw: JSON.stringify(state.history.filter(w => w.id === 'old-unassigned' || w.id === 'old-saved')),
      completedRaw: JSON.stringify(state.history.find(w => w.id === ${J(completed.id)})),
      other: state.history.find(w => w.id === ${J(blank.id)}).exercises[0].muscles,
      shares: muscleShare(state.history.find(w => w.id === ${J(blank.id)}).exercises[0]),
      sets: muscleWeek(currentWeekKey()).sets, session: getSession()
    })`);
    check('actual JSON import/normalize preserves plan and shared-memory metadata', same(roundTrip.assignment, { primary: 'chest', secondary: [] }) && same(roundTrip.memory, roundTrip.assignment), roundTrip);
    check('backup round trip preserves historical data without rewriting it', roundTrip.oldRaw === originalHistory && roundTrip.completedRaw === completedRaw);
    check('backup round trip preserves explicit Other and read-time reclassification', same(roundTrip.other, OTHER) && same(roundTrip.shares, { other: 1 }) && roundTrip.sets.chest === 2 && roundTrip.sets.back === 2 && roundTrip.sets.other === 2 && roundTrip.session === null, roundTrip);
    await p2.eval(`(switchTab('trening'), startEditPlan('ma'), true)`);
    check('imported assignment reopens in actual editor', await p2.eval(`document.querySelector('.edit-muscle-primary').value === 'chest' && document.querySelectorAll('#edit-rows .edit-row:first-child [data-muscle]:checked').length === 0`));
    check('no browser exceptions in either isolated profile', p.errors.length === 0 && p2.errors.length === 0, { main: p.errors, imported: p2.errors });
  } catch (e) {
    check('no exception', false, String(e && e.stack || e));
  } finally {
    b.killHard(true); importedBrowser.killHard(true);
    await server.close();
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
