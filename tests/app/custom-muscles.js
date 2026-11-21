'use strict';
/* Gym-Lift — vlastné svalové skupiny (v113), skutočný Chrome, iba syntetický hosť.

     GQ_SCREENSHOTS=0 GQ_TEST_PORT=8190 node tests/app/custom-muscles.js

   Editor Uložiť/otvoriť/obnoviť; spoločná identita; Auto verzus Iné; nemenná snímka bežiaceho tréningu;
   dokončený tréning s nevyriešeným Auto (Iné + musclesAuto:true) nasleduje neskoršie zaradenie cez
   stabilné customId, výslovné Iné (musclesAuto:false) nikdy; staré nemarkované Iné opravuje
   exerciseMuscleCorrections.legacyWorkoutIds; prepočet histórie bez prepisu; JSON import do čistého profilu.
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
/* Súčty sérií bez závislosti od poradia kľúčov. */
function sameSets(a, b) {
  const ka = Object.keys(a || {}).sort(), kb = Object.keys(b || {}).sort();
  return same(ka, kb) && ka.every((k) => Math.abs(a[k] - b[k]) < 1e-9);
}
const gain = (after, before, k) => (after.sets[k] || 0) - (before.sets[k] || 0);
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
    md: { id: 'md', builtin: false, customName: 'Blank session', location: null, exercises: [row('Blank Launch')] },
    me: { id: 'me', builtin: false, customName: 'Late label', location: null, exercises: [row('Late Label Move', 25)] },
    mr: { id: 'mr', builtin: false, customName: 'Retained id', location: null, exercises: [{ ...row('Retained Move', 35), id: 'cx-retained-7' }] },
    mt: { id: 'mt', builtin: false, customName: 'Assisted custom', location: null, exercises: [{ ...row('Dips', 15), assisted: true }] },
    mo: { id: 'mo', builtin: false, customName: 'Explicit Other', location: null, exercises: [row('Explicit Other Move')] },
    mq: { id: 'mq', builtin: false, customName: 'Resumed legacy', location: null, exercises: [row('Resumed Move')] },
    mx: { id: 'mx', builtin: false, customName: 'Mixed identity', location: null, exercises: [{ ...row('Mixed Move'), id: 'cx-mixed' }] }
  };
  s.planOrder = ['ma', 'mb', 'mc', 'md', 'me', 'mr', 'mt', 'mo', 'mq', 'mx'];
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

    const wf = (id) => `state.history.find(w => w.id === ${J(id)})`;
    const rawOf = (id) => E(`JSON.stringify(${wf(id)})`);
    const shareOf = (id, i = 0) => E(`(() => { const w = ${wf(id)}; return muscleShare(w.exercises[${i}], w); })()`);
    const bareShareOf = (id, i = 0) => E(`muscleShare(${wf(id)}.exercises[${i}])`);
    const snap = () => E(`(() => { const ex = exerciseSlots(currentPlan())[0].ex; return { muscles: ex.muscles, auto: ex.musclesAuto, share: muscleShare(ex) }; })()`);
    const corr = (identity) => E(`(state.settings.exerciseMuscleCorrections || {})[${J(identity)}] || null`);
    const weekOf = (date) => E(`muscleWeek(weekKey(parseDate(${J(date)})))`);

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
    check('real snapshot carries no Auto marker', completed.entry.musclesAuto === undefined && !!completed.entry.customId, completed.entry);
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

    console.log('== blank-start session: unresolved Auto is frozen while running, completed history follows the assignment');
    await start('md');
    let s = await snap();
    check('unresolved Auto snapshot stores Other + musclesAuto:true and reads Other', same(s.muscles, OTHER) && s.auto === true && same(s.share, { other: 1 }), s);
    await open('md'); await primary(0, 'arms'); await save(); await p.reload();
    s = await snap();
    check('assignment made during the session does not leak into the running snapshot after normalize', same(s.muscles, OTHER) && s.auto === true && same(s.share, { other: 1 }), s);
    const blank = await finishFirst();
    const blankIdentity = await E(`exerciseRowIdentity(state.plans.md.exercises[0])`);
    check('completion stores Other + musclesAuto:true with the stable customId', same(blank.entry.muscles, OTHER) && blank.entry.musclesAuto === true && blank.entry.customId === blankIdentity, { entry: blank.entry, blankIdentity });
    const blankRaw = await rawOf(blank.id);
    check('completed entry follows the assignment made during the session', same(await shareOf(blank.id), { arms: 1 }), await shareOf(blank.id));
    check('without the workout argument the same entry still reads its frozen Other', same(await bareShareOf(blank.id), { other: 1 }));
    await open('md'); await primary(0, 'core'); await save(); await p.reload();
    check('assignment after completion is followed through customId, also after reload', same(await shareOf(blank.id), { core: 1 }), await shareOf(blank.id));
    check('following the assignment never rewrites the stored entry', await rawOf(blank.id) === blankRaw && await oldRaw() === originalHistory);

    console.log('== main repro: unknown exercise completed BEFORE the editor assigns Core with a chest helper');
    const labels = await E(`({ core: muscleLabel('core'), chest: muscleLabel('chest') })`);
    /* Otvorí Svaly vrátane zoznamu nezaradených a rozpisu, zosnímkuje zoznam, mapu aj rozpis a zatvorí ich. */
    const mainUi = () => E(`(() => {
      openMuscles();
      document.getElementById('muscles-unassigned').open = true;
      document.getElementById('muscles-breakdown').open = true;
      renderMuscles();
      const ui = {
        unassigned: Array.from(document.querySelectorAll('.mu-unassigned-row h4'), h => h.textContent),
        names: Array.from(document.querySelectorAll('#muscles-list .mu-name'), n => n.textContent),
        map: document.getElementById('muscles-map').innerHTML,
        recovery: muscleRecovery(Date.now()),
        trace: Array.from(document.querySelectorAll('.mu-trace-row'), row => ({ name: row.querySelector('h4').textContent, contribution: row.querySelector('.mu-contribution').textContent }))
      };
      closeMuscles();
      return ui;
    })()`);
    const preMain = await week();
    await start('me');
    s = await snap();
    check('unknown plan row starts as unresolved Auto (Other + musclesAuto:true)', same(s.muscles, OTHER) && s.auto === true && same(s.share, { other: 1 }), s);
    const me = await finishFirst();
    const meIdentity = await E(`exerciseRowIdentity(state.plans.me.exercises[0])`);
    check('completed unknown exercise is saved as Other + musclesAuto:true with customId', same(me.entry.muscles, OTHER) && me.entry.musclesAuto === true && me.entry.customId === meIdentity && me.entry.setsDone === 2, { entry: me.entry, meIdentity });
    const meRaw = await rawOf(me.id);
    const beforeMain = await week(), uiBefore = await mainUi();
    check('before assignment the sets are Other and listed as unassigned', gain(beforeMain, preMain, 'other') === 2 && gain(beforeMain, preMain, 'core') === 0 && uiBefore.unassigned.includes('Late Label Move'), { sets: beforeMain.sets, ui: uiBefore.unassigned });
    check('before assignment the breakdown shows the entry under Other', uiBefore.trace.some(r => r.name === 'Late Label Move' && !r.contribution.includes(labels.core + ':')), uiBefore.trace);
    await open('me'); await primary(0, 'core'); await helper(0, 'chest'); await save();
    check('editor Save stores Core + chest helper on the plan row under the same identity', same(await planMeta('me'), { primary: 'core', secondary: ['chest'] }) && await E(`exerciseRowIdentity(state.plans.me.exercises[0])`) === meIdentity, await planMeta('me'));
    const afterMain = await week(), uiAfter = await mainUi();
    check('weekly totals move from Other to Core (1) and chest helper (½) without touching other groups', gain(afterMain, beforeMain, 'core') === 2 && gain(afterMain, beforeMain, 'chest') === 1 && gain(afterMain, beforeMain, 'other') === -2 && gain(afterMain, beforeMain, 'back') === 0, { before: beforeMain.sets, after: afterMain.sets });
    check('volume list shows Core and Chest and the entry left the unassigned list', uiAfter.names.includes(labels.core) && uiAfter.names.includes(labels.chest) && !uiAfter.unassigned.includes('Late Label Move'), uiAfter);
    check('body map recovery changed for the newly mapped groups', uiAfter.map !== uiBefore.map && uiAfter.recovery.core < uiBefore.recovery.core && uiAfter.recovery.chest < uiBefore.recovery.chest, { before: uiBefore.recovery, after: uiAfter.recovery });
    check('breakdown shows the new contribution Core 2 and Chest 1', uiAfter.trace.some(r => r.name === 'Late Label Move' && r.contribution.includes(labels.core + ': 2') && r.contribution.includes(labels.chest + ': 1')), uiAfter.trace);
    check('completed entry reads Core + chest helper with the workout and Other without it', same(await shareOf(me.id), { core: 1, chest: 0.5 }) && same(await bareShareOf(me.id), { other: 1 }), await shareOf(me.id));
    check('raw history is identical (entry, old records) without adding a correction record', await rawOf(me.id) === meRaw && await oldRaw() === originalHistory && await corr(meIdentity) === null);
    await p.reload();
    const reloadedMain = await week(), uiReloaded = await mainUi();
    check('after reload totals, list, breakdown and raw entry are unchanged', sameSets(reloadedMain.sets, afterMain.sets) && same(await shareOf(me.id), { core: 1, chest: 0.5 }) && await rawOf(me.id) === meRaw
      && uiReloaded.names.includes(labels.core) && uiReloaded.trace.some(r => r.name === 'Late Label Move' && r.contribution.includes(labels.core + ': 2')), uiReloaded.trace);

    console.log('== backup import into a separate guest profile');
    /* Záloha zámerne vynecháva session; jej normalizácia je otestovaná obnovením vyššie. */
    await start('md');
    const backup = await E(`backupPayload()`);
    const payload = JSON.parse(backup);
    check('backup excludes running session but includes custom plan and memory metadata', !Object.prototype.hasOwnProperty.call(payload, 'activeSession') && payload.plans.ma.exercises[0].muscles.primary === 'chest' && payload.settings.exerciseMemory[identity].muscles.primary === 'chest');
    const expectedSets = (await week()).sets;
    check('backup carries completed Auto entries as stored (Other + musclesAuto:true)', payload.history.find(w => w.id === blank.id).exercises[0].musclesAuto === true && payload.history.find(w => w.id === me.id).exercises[0].musclesAuto === true);
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
      blankAuto: state.history.find(w => w.id === ${J(blank.id)}).exercises[0].musclesAuto,
      blankRaw: JSON.stringify(state.history.find(w => w.id === ${J(blank.id)})),
      shares: (() => { const w = state.history.find(w => w.id === ${J(blank.id)}); return muscleShare(w.exercises[0], w); })(),
      bareShares: muscleShare(state.history.find(w => w.id === ${J(blank.id)}).exercises[0]),
      meRaw: JSON.stringify(state.history.find(w => w.id === ${J(me.id)})),
      meShare: (() => { const w = state.history.find(w => w.id === ${J(me.id)}); return muscleShare(w.exercises[0], w); })(),
      sets: muscleWeek(currentWeekKey()).sets, session: getSession()
    })`);
    check('actual JSON import/normalize preserves plan and shared-memory metadata', same(roundTrip.assignment, { primary: 'chest', secondary: [] }) && same(roundTrip.memory, roundTrip.assignment), roundTrip);
    check('backup round trip preserves historical data without rewriting it', roundTrip.oldRaw === originalHistory && roundTrip.completedRaw === completedRaw && roundTrip.blankRaw === blankRaw && roundTrip.meRaw === meRaw, roundTrip);
    check('backup round trip keeps Auto entries stored as Other and reads them through the imported assignment', same(roundTrip.other, OTHER) && roundTrip.blankAuto === true
      && same(roundTrip.shares, { core: 1 }) && same(roundTrip.bareShares, { other: 1 }) && same(roundTrip.meShare, { core: 1, chest: 0.5 }), roundTrip);
    check('backup round trip reproduces the weekly totals (nothing left in Other)', sameSets(roundTrip.sets, expectedSets) && roundTrip.sets.chest === 3 && roundTrip.sets.back === 2 && !roundTrip.sets.other && roundTrip.session === null, { imported: roundTrip.sets, expected: expectedSets });
    await p2.eval(`(switchTab('trening'), startEditPlan('ma'), true)`);
    check('imported assignment reopens in actual editor', await p2.eval(`document.querySelector('.edit-muscle-primary').value === 'chest' && document.querySelectorAll('#edit-rows .edit-row:first-child [data-muscle]:checked').length === 0`));

    console.log('== separate arm assignments through editor, reload and completion');
    await finishFirst();
    await open('md'); await primary(0, 'biceps'); await helper(0, 'triceps'); await save();
    await p.reload(); await open('md'); c = await controls(0);
    check('biceps main and triceps helper survive editor Save and reload independently', c.primary === 'biceps' && same(c.helpers.filter(h => h.checked).map(h => h.muscle), ['triceps']), c);
    await closeEditor();
    const beforeArms = await week();
    await start('md');
    const armWorkout = await finishFirst(), afterArms = await week();
    check('completed custom sets retain separate arm muscles and weighted totals', same(armWorkout.entry.muscles, { primary: 'biceps', secondary: ['triceps'] }) && afterArms.sets.biceps - (beforeArms.sets.biceps || 0) === 2 && afterArms.sets.triceps - (beforeArms.sets.triceps || 0) === 1, { entry: armWorkout.entry, sets: afterArms.sets });
    /* Okrajové prípady bežia až po hlavných sekciách, každý na vlastnom pláne a vlastnom záznamníku;
       absolútne týždenné súčty sa po nich už nekontrolujú. */
    console.log('== edge: retained cx- id differs from the name hash');
    await start('mr');
    s = await snap();
    const retained = await finishFirst();
    const nameHash = await E(`exerciseIdentity({ name: 'Retained Move' })`);
    check('retained cx- id is the stable customId and differs from the name hash', s.auto === true && retained.entry.customId === 'cx-retained-7' && nameHash !== 'cx-retained-7'
      && same(retained.entry.muscles, OTHER) && retained.entry.musclesAuto === true, { snap: s, entry: retained.entry, nameHash });
    const retainedRaw = await rawOf(retained.id);
    await open('mr'); await primary(0, 'legs'); await helper(0, 'glutes'); await save();
    check('editor keeps the retained id and stores the assignment under it', await E(`state.plans.mr.exercises[0].id === 'cx-retained-7' && !!state.settings.exerciseMemory['cx-retained-7'] && state.settings.exerciseMemory['cx-retained-7'].muscles.primary === 'legs' && !(${J(nameHash)} in state.settings.exerciseMemory && state.settings.exerciseMemory[${J(nameHash)}].muscles)`));
    await p.reload();
    check('completed entry follows the assignment through the retained id after reload, raw unchanged', same(await shareOf(retained.id), { legs: 1, glutes: 0.5 }) && await rawOf(retained.id) === retainedRaw, await shareOf(retained.id));

    console.log('== edge: custom assisted Dips snapshot survives reload without built-in remapping');
    await start('mt');
    await p.reload();
    const dipsSnap = await E(`(() => { const ex = exerciseSlots(currentPlan())[0].ex; return { builtin: !!(ex.id && BUILTIN_EXERCISE_IDS.has(ex.id)), assisted: ex.assisted === true, name: ex.name }; })()`);
    check('resumed custom Dips snapshot stays custom and assisted', !dipsSnap.builtin && dipsSnap.assisted && dipsSnap.name === 'Dips', dipsSnap);
    const dips = await finishFirst();
    const dipsRaw = await rawOf(dips.id), dipsShare = await shareOf(dips.id);
    check('completed custom Dips keeps the assisted flag and customId without exId', dips.entry.exId === undefined && dips.entry.assisted === true && !!dips.entry.customId && dips.entry.name === 'Dips', dips.entry);
    await p.reload();
    check('Dips entry is byte-identical after reload, still without exId, still assisted, same muscles', await rawOf(dips.id) === dipsRaw && same(await shareOf(dips.id), dipsShare)
      && await E(`(() => { const e = ${wf(dips.id)}.exercises[0]; return e.exId === undefined && historyEntryAssisted(e); })()`));

    console.log('== edge: explicit Other never follows the editor, including Other -> Auto -> real');
    await open('mo'); await primary(0, 'other'); await save();
    check('explicit Other is stored on the plan row', same(await planMeta('mo'), OTHER), await planMeta('mo'));
    await start('mo');
    s = await snap();
    check('explicit Other snapshot is marked musclesAuto:false and reads Other', same(s.muscles, OTHER) && s.auto === false && same(s.share, { other: 1 }), s);
    const explicit = await finishFirst();
    const explicitIdentity = await E(`exerciseRowIdentity(state.plans.mo.exercises[0])`);
    check('completed explicit Other is saved Other + musclesAuto:false', same(explicit.entry.muscles, OTHER) && explicit.entry.musclesAuto === false && explicit.entry.customId === explicitIdentity, explicit.entry);
    const explicitRaw = await rawOf(explicit.id);
    await open('mo'); await primary(0, ''); await save();
    check('clearing the assignment returns the row to unresolved Auto', await E(`!state.plans.mo.exercises[0].muscles`));
    await open('mo'); await primary(0, 'legs'); await save();
    await p.reload();
    check('explicit-Other history stays Other after Other -> Auto -> real and reload, without a correction', same(await shareOf(explicit.id), { other: 1 }) && await rawOf(explicit.id) === explicitRaw && await corr(explicitIdentity) === null);

    console.log('== edge: resumed old session snapshot (Other without musclesAuto) keeps the absence and is corrected later');
    await start('mq');
    await E(`(() => { const ex = exerciseSlots(currentPlan())[0].ex, snapshot = sessionSnapshotFor(ex); snapshot.muscles = { primary: 'other', secondary: [] }; delete snapshot.musclesAuto; saveState(); return true; })()`);
    await p.reload();
    s = await snap();
    check('old snapshot without the marker stays without it after normalize', same(s.muscles, OTHER) && s.auto === undefined && same(s.share, { other: 1 }), s);
    const resumed = await finishFirst();
    const resumedIdentity = await E(`exerciseRowIdentity(state.plans.mq.exercises[0])`);
    check('completion retains the absence of musclesAuto', same(resumed.entry.muscles, OTHER) && !('musclesAuto' in resumed.entry) && resumed.entry.customId === resumedIdentity, resumed.entry);
    const resumedRaw = await rawOf(resumed.id);
    check('before assignment the unmarked Other reads Other', same(await shareOf(resumed.id), { other: 1 }));
    await open('mq'); await primary(0, 'back'); await helper(0, 'arms'); await save();
    const resumedCorr = await corr(resumedIdentity);
    check('editor assignment needs no extra correction record for old Other', resumedCorr === null, resumedCorr);
    check('the unmarked Other entry is corrected on read without rewriting it', same(await shareOf(resumed.id), { back: 1, arms: 0.5 }) && await rawOf(resumed.id) === resumedRaw, await shareOf(resumed.id));
    await p.reload();
    check('automatic legacy classification survives reload', same(await shareOf(resumed.id), { back: 1, arms: 0.5 }));

    console.log('== edge: mixed workout, same identity, legacy + explicit false, existing manual correction with the same profile');
    const mixedDate = await E(`localDateKey(addDays(new Date(), -21))`);
    await E(`(() => {
      const date = ${J(mixedDate)};
      const entry = (extra) => Object.assign({ name: 'Mixed Move', customId: 'cx-mixed', sets: 2, reps: 10, weight: 10, setsDone: 2, muscles: { primary: 'other', secondary: [] } }, extra);
      state.history.push(
        { id: 'mixed-w', date, planId: 'mx', planName: 'Mixed fixture', xp: 0, note: '', exercises: [entry({}), entry({ musclesAuto: false })] },
        { id: 'manual-w', date, planId: 'mx', planName: 'Manual fixture', xp: 0, note: '', exercises: [entry({})] });
      state.settings.exerciseMuscleCorrections = { 'cx-mixed': { primary: 'core', secondary: ['chest'], workoutIds: ['manual-w'] } };
      saveState(); return true;
    })()`);
    const mixedRaw = await rawOf('mixed-w'), manualRaw = await rawOf('manual-w');
    let mx = await weekOf(mixedDate);
    check('before the editor: manual workout uses its correction, mixed workout is entirely Other', mx.sets.core === 2 && mx.sets.chest === 1 && mx.sets.other === 4, mx.sets);
    await open('mx'); await primary(0, 'core'); await helper(0, 'chest'); await save();
    const mixedCorr = await corr('cx-mixed');
    check('automatic recovery leaves the explicit manual correction scope unchanged', same(mixedCorr, { primary: 'core', secondary: ['chest'], workoutIds: ['manual-w'] }), mixedCorr);
    mx = await weekOf(mixedDate);
    check('only the legacy entry of the mixed workout is corrected; the explicit-false entry stays Other', mx.sets.core === 4 && mx.sets.chest === 2 && mx.sets.other === 2, mx.sets);
    check('per-entry shares: legacy follows, explicit false does not, manual stays corrected', same(await shareOf('mixed-w', 0), { core: 1, chest: 0.5 }) && same(await shareOf('mixed-w', 1), { other: 1 }) && same(await shareOf('manual-w'), { core: 1, chest: 0.5 }));
    await p.reload();
    check('mixed fixtures are never rewritten and the result survives reload', await rawOf('mixed-w') === mixedRaw && await rawOf('manual-w') === manualRaw && sameSets((await weekOf(mixedDate)).sets, mx.sets));

    console.log('== existing assignment before upgrade: old name-only Other recovers without another editor save');
    const beforeExisting = await week();
    await E(`(() => {
      state.history.push({ id: 'preassigned-w', date: todayISO(), planId: 'mx', planName: 'Already assigned', xp: 0, note: '',
        exercises: [{ name: 'Mixed Move', sets: 2, reps: 10, weight: 10, setsDone: 2, muscles: { primary: 'other', secondary: [] } }] });
      saveState(); return true;
    })()`);
    const existingRaw = await rawOf('preassigned-w');
    await p.reload();
    const afterExisting = await week();
    check('old name-only Other finds the existing exact-name plan assignment, including a retained id', same(await shareOf('preassigned-w'), { core: 1, chest: 0.5 }), await shareOf('preassigned-w'));
    check('existing sets and volume recover automatically without rewriting history', gain(afterExisting, beforeExisting, 'core') === 2 && gain(afterExisting, beforeExisting, 'chest') === 1
      && afterExisting.volume.core - (beforeExisting.volume.core || 0) === 200 && afterExisting.volume.chest - (beforeExisting.volume.chest || 0) === 100
      && await rawOf('preassigned-w') === existingRaw, afterExisting);
    check('automatic recovery does not expand manual correction scope', same(await corr('cx-mixed'), mixedCorr));
    await E(`(() => {
      state.plans.ambiguous = { id: 'ambiguous', builtin: false, customName: 'Distinct exercises', exercises: [
        { id: 'cx-distinct-one', name: 'Same old label', sets: 2, reps: 10, weight: 10, muscles: { primary: 'core', secondary: [] } },
        { id: 'cx-distinct-two', name: 'Same old label', sets: 2, reps: 10, weight: 10, muscles: { primary: 'chest', secondary: [] } }] };
      state.history.push({ id: 'ambiguous-w', date: todayISO(), exercises: [
        { name: 'Same old label', sets: 2, setsDone: 2, reps: 10, weight: 10, muscles: { primary: 'other', secondary: [] } }] });
      return true;
    })()`);
    check('legacy name matching never guesses between distinct retained identities', same(await shareOf('ambiguous-w'), { other: 1 }));

    console.log('== detailed lower-body groups through completion, assignment, reload and import');
    const lowerGroups = ['glutes', 'thighs', 'calves', 'abductors', 'adductors'];
    const lowerWorkouts = [];
    for (const [index, group] of lowerGroups.entries()) {
      const pid = 'lower-' + group, secondary = lowerGroups[(index + 1) % lowerGroups.length];
      await E(`(() => { const id=${J(pid)}; state.plans[id]={id,builtin:false,customName:id,exercises:[{name:id+' custom',sets:2,reps:10,weight:20}]}; state.planOrder.push(id); saveState(); return true; })()`);
      await start(pid);
      const workout = await finishFirst(), raw = await rawOf(workout.id);
      await open(pid); await primary(0, group); await helper(0, secondary); await save();
      const expected = { [group]: 1, [secondary]: 0.5 };
      check(group + ': assigning a main/helper group updates completed Other without rewriting it', same(await shareOf(workout.id), expected) && await rawOf(workout.id) === raw, await shareOf(workout.id));
      lowerWorkouts.push({ id: workout.id, raw, expected, pid, group, secondary });
    }
    await p.reload();
    for (const item of lowerWorkouts) {
      check(item.group + ': assignment and helper survive reload in the same completed workout', same(await shareOf(item.id), item.expected) && await rawOf(item.id) === item.raw, await shareOf(item.id));
    }
    check('old saved general Legs is preserved, not guessed into a detailed group', await oldRaw() === originalHistory && await E(`(() => { const w=state.history.find(w=>w.id==='old-saved'); return JSON.stringify(muscleShare(w.exercises[0],w))===JSON.stringify({legs:1,core:0.5}); })()`));
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const lang of ['en', 'sk', 'es', 'pt-BR', 'fr', 'ar']) {
      await E(`(setLang(${J(lang)}), true)`); await open('lower-adductors');
      const pickerLayout = await E(`(() => {
        const row=document.querySelector('#edit-rows .edit-row'), more=row.querySelector('.edit-more');
        if(!more.open)more.querySelector('summary').click();
        const picker=row.querySelector('.edit-muscle-primary'), options=Array.from(picker.options);
        return {translated:${J(lowerGroups)}.every(code=>options.some(o=>o.value===code&&o.textContent===muscleLabel(code)&&!o.textContent.startsWith('muscle.'))),
          fit:Array.from(row.querySelectorAll('.edit-muscles label')).every(label=>{const r=label.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}),
          warning:Array.from(row.querySelectorAll('.edit-muscles > p')).some(p=>p.checkVisibility()&&p.textContent.length>0),rtl:document.documentElement.dir,overflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      check(lang + ': lower-body main/helper controls and compatibility warning fit narrow screens', pickerLayout.translated && pickerLayout.fit && pickerLayout.warning && !pickerLayout.overflow && (lang !== 'ar' || pickerLayout.rtl === 'rtl'), pickerLayout);
      await closeEditor();
    }
    await p.c.send('Emulation.clearDeviceMetricsOverride'); await E(`(setLang('en'), openLibrary('browse'), true)`);
    const expectedLibrary = { glutes: 'hip-thrust', thighs: 'squats', calves: 'calf-raises', abductors: 'abductor-machine', adductors: 'adductor-machine' };
    for (const [group, id] of Object.entries(expectedLibrary)) {
      await E(`(document.querySelector('[data-chip-group="muscle"][data-chip-value="${group}"]').click(), true)`);
      check(group + ': library filter returns its corresponding exercise', await E(`libraryResults().some(e=>e.id===${J(id)})`));
    }
    await E(`(document.querySelector('[data-chip-group="muscle"][data-chip-value="legs"]').click(), true)`);
    check('broad Legs filter includes all four detailed groups', await E(`['squats','calf-raises','abductor-machine','adductor-machine'].every(id=>libraryResults().some(e=>e.id===id))`));
    check('Full body selection keeps one shared Legs slot plus its existing Glutes slot', await E(`(() => {const entries=fullBodySpread(libraryAll());return entries.filter(e=>e.primary==='legs'||LEG_DETAIL_CODES.includes(e.primary)).length===1&&entries.filter(e=>e.primary==='glutes').length===1;})()`));
    check('lower-body progression steps stay unchanged after library reclassification', await E(`['squats','calf-raises','abductor-machine','adductor-machine','hip-thrust'].every(id=>suggestStep({id})===5)&&suggestStep({id:'bench-press'})===2.5`));
    const wave = await E(`(() => {
      const def=programById('strength-wave'),variant=programVariants(def)[0],plans={},tm={};
      variant.days.forEach(d=>{plans[d.id]='wave-'+d.id;d.rows.filter(r=>r.main).forEach(r=>tm[r.exId]=100);});
      const program={id:def.id,variant:variant.id,startedAt:todayISO(),weekShift:4,plans,tm};
      const prescription=day=>{const tpl=variant.days.find(d=>d.id===day).rows.find(r=>r.main);return programPrescription(program,plans[day],{id:tpl.exId,progRow:tpl.progRow,sets:3,reps:8,weight:100});};
      return {lower:prescription('squat'),upper:prescription('bench')};
    })()`);
    check('wave week-five increment remains +5 for thighs and +2.5 for the upper-body lift', wave.lower && wave.upper && wave.lower.tmUsed === 105 && wave.upper.tmUsed === 102.5, wave);
    await E(`(closeLibrary(), true)`);
    const lowerBackup = await E(`backupPayload()`);
    await p2.eval(`(document.getElementById('btn-edit-cancel').click(), true)`);
    await p2.eval(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([${J(lowerBackup)}],'lower-body.json',{type:'application/json'}));const input=document.getElementById('file-import');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await waitFor(() => p2.eval(`!!pendingImport && !document.getElementById('modal-generic').hidden`), 10000, 'lower-body import confirmation');
    await p2.eval(`(document.getElementById('btn-generic-ok').click(),true)`); await p2.reload();
    for (const item of lowerWorkouts) {
      const imported = await p2.eval(`(() => {const w=state.history.find(w=>w.id===${J(item.id)});return {share:muscleShare(w.exercises[0],w),raw:JSON.stringify(w),groups:state.plans[${J(item.pid)}].exercises[0].muscles};})()`);
      check(item.group + ': backup/import retains assignment, helpers and the immutable workout', same(imported.share, item.expected) && imported.raw === item.raw && same(imported.groups, { primary: item.group, secondary: [item.secondary] }), imported);
    }

    console.log('== quick start/add retain a custom exercise identity and its detailed muscles');
    await open('mr'); await primary(0, 'calves'); await save();
    await E(`(startQuickWorkout('c:Retained Move'), true)`);
    check('quick start freezes the retained custom id and Calves assignment', await E(`(() => {const ex=getSession().quick.exercises[0];return ex.id==='cx-retained-7'&&ex.muscles.primary==='calves'&&ex.muscles.secondary.includes('glutes');})()`));
    await p.reload();
    check('quick session normalization retains the custom id and assignment', await E(`(() => {const ex=exerciseSlots(currentPlan())[0].ex;return ex.id==='cx-retained-7'&&muscleShare(ex).calves===1;})()`));
    const quickRetained = await finishFirst();
    check('quick completion stores the retained id rather than a name hash', quickRetained.entry.customId === 'cx-retained-7' && quickRetained.entry.muscles.primary === 'calves' && same(await shareOf(quickRetained.id), { calves: 1, glutes: 0.5 }), quickRetained);
    await start('md');
    check('quick-add accepts the unique retained exercise', await E(`addExerciseToSession('c:Retained Move')`));
    await p.reload();
    check('quick-add retains its identity, classification and separate completion key after reload', await E(`(() => {
      const ex=exerciseSlots(currentPlan()).map(slot=>slot.ex).find(ex=>ex.id==='cx-retained-7');
      if(!ex||muscleShare(ex).calves!==1)return false;
      toggleSetMark('done',ex,0,true);saveState();renderTrening();return true;
    })()`));
    const addedRetained = await finishFirst();
    check('completed added exercise has the same retained identity and contributes its actual working set', await E(`(() => {
      const w=${wf(addedRetained.id)},ex=w.exercises.find(ex=>ex.customId==='cx-retained-7');
      return !!ex&&ex.setsDone===1&&muscleShare(ex,w).calves===1&&muscleSetTotals(ex).sets===1;
    })()`));
    const ambiguousQuick = await E(`(() => {
      const history=JSON.stringify(state.history);startQuickWorkout('c:Same old label');
      return {refused:!getSession(),unchanged:JSON.stringify(state.history)===history,message:!document.getElementById('modal-generic').hidden};
    })()`);
    check('ambiguous quick start explains the issue without choosing an identity or creating a workout', ambiguousQuick.refused && ambiguousQuick.unchanged && ambiguousQuick.message, ambiguousQuick);
    await E(`(document.getElementById('btn-generic-ok').click(),true)`);
    await start('md');
    const ambiguousAdd = await E(`(() => {
      const before=JSON.stringify(getSession()),accepted=addExerciseToSession('c:Same old label');
      return {accepted,unchanged:JSON.stringify(getSession())===before,message:!document.getElementById('modal-generic').hidden};
    })()`);
    check('ambiguous quick-add explains the issue without mutating a running workout', !ambiguousAdd.accepted && ambiguousAdd.unchanged && ambiguousAdd.message, ambiguousAdd);
    await E(`(document.getElementById('btn-generic-ok').click(),true)`);
    await finishFirst();
    const activityBefore = await E(`(startActivity('run'), JSON.stringify(getActiveActivity()))`);
    await E(`(startQuickWorkout('c:Same old label'), document.getElementById('btn-generic-ok').click(), true)`);
    check('ambiguous quick start never asks to discard or clears an ongoing activity', await E(`JSON.stringify(getActiveActivity()) === ${J(activityBefore)} && !getSession()`));
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
