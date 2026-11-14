'use strict';
/* Živé rozpoznávanie a výslovná oprava minulých sérií Iné, skutočný Chrome, iba syntetický hosť.

   GQ_SCREENSHOTS=0 GQ_TEST_PORT=8190 node tests/app/exercise-recognition.js

   Bez screenshotov, účtov, presného počtu knižničných cvikov či kontrol zdrojového zapojenia. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const DEBUG_PORT = Number(process.env.GQ_DEBUG_PORT) || 9916;
const BASE = 'http://localhost:' + PORT + '/';
const workRoot = process.env.GQ_WORK || os.tmpdir();
fs.mkdirSync(workRoot, { recursive: true });
const WORK = fs.mkdtempSync(path.join(workRoot, 'gq-exercise-recognition-'));
const emptyCfg = path.join(WORK, 'community-config.empty.js');
fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
process.env.GQ_SCREENSHOTS = '0';
const { startServer, Browser, waitFor } = require('../sync/lib');
const J = JSON.stringify;
const BACK = { primary: 'back', secondary: ['arms', 'core'] };
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info === undefined ? '' : ' -> ' + J(info))); }
}
function same(a, b) { return J(a) === J(b); }

const SEED = `(() => {
  const s = defaultState();
  const row = (name, weight = 37.5) => ({ name, sets: 2, reps: 10, weight });
  s.plans = {
    live: { id: 'live', builtin: false, customName: 'Recognition lab', location: null, exercises: [
      { ...row('Prior Manual Arc'), muscles: { primary: 'legs', secondary: ['glutes'] } },
      { ...row('Bench Press', 42.5), id: 'bench-press', builtin: true }
    ] },
    archive: { id: 'archive', builtin: false, customName: 'Archive lab', location: null,
      exercises: [row('Archive Orbit')] },
    duplicate: { id: 'duplicate', builtin: false, customName: 'Archive duplicate', location: null,
      exercises: [row(' archive  orbit ', 55)] },
    explicit: { id: 'explicit', builtin: false, customName: 'Explicit Other', location: null,
      exercises: [{ ...row('Bench Press', 22.5), muscles: { primary: 'other', secondary: [] } }] }
  };
  s.planOrder = ['live', 'archive', 'duplicate', 'explicit'];
  s.settings.startersAdded = true;
  s.settings.exerciseMemory = {};
  s.settings.exerciseMuscleCorrections = {};
  s.settings.restPresets = [];
  s.settings.lang = 'en';
  s.settings.autoRest = false;
  s.activeSession = null;
  s.history = [
    { id: 'archive-missing', date: todayISO(), planId: 'archive', planName: 'Before groups', xp: 17, note: 'keep missing',
      exercises: [{ name: 'Archive Orbit', sets: 2, setsDone: 2, reps: 10, weight: 37.5 }] },
    { id: 'archive-v113', date: todayISO(), planId: 'archive', planName: 'v113 Other', xp: 23, note: 'keep Other',
      exercises: [{ name: 'Archive Orbit', sets: 3, setsDone: 3, reps: 8, weight: 40,
        muscles: { primary: 'other', secondary: [] } }] },
    { id: 'archive-previous', date: localDateKey(addDays(new Date(), -14)), planId: 'archive', planName: 'Earlier Other', xp: 13, note: 'keep earlier',
      exercises: [{ name: 'Archive Orbit', sets: 2, setsDone: 2, reps: 9, weight: 30,
        muscles: { primary: 'other', secondary: [] } }] },
    { id: 'archive-saved', date: todayISO(), planId: 'archive', planName: 'Frozen legs', xp: 11, note: 'keep saved',
      exercises: [{ name: 'Archive Orbit', sets: 1, setsDone: 1, reps: 12, weight: 25,
        muscles: { primary: 'legs', secondary: ['core'] } }] },
    { id: 'explicit-known', date: todayISO(), planId: 'explicit', planName: 'Deliberate Other', xp: 31, note: '',
      exercises: [{ name: 'Bench Press', sets: 4, setsDone: 4, reps: 6, weight: 22.5,
        muscles: { primary: 'other', secondary: [] } }] },
    { id: 'archive-cancel', date: todayISO(), planId: 'archive', planName: 'Do not save', xp: 7, note: '',
      exercises: [{ name: 'No Save Archive', sets: 1, setsDone: 1, reps: 5, weight: 9 }] }
  ];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  return JSON.stringify(s.history);
})()`;

/* Posúvanie je dovolené; odrezaný text ani vodorovné pretečenie ovládacích prvkov nie. */
const FIT = `(el) => {
  if (!el || !el.getClientRects().length) return false;
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect(), css = getComputedStyle(el);
  if (css.visibility === 'hidden' || css.display === 'none' || r.width <= 0 || r.height <= 0
    || r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) return false;
  if (el.clientWidth && el.scrollWidth > el.clientWidth + 1) return false;
  if (el.clientHeight && el.scrollHeight > el.clientHeight + 1 && ['hidden', 'clip'].includes(css.overflowY)) return false;
  for (let a = el.parentElement; a; a = a.parentElement) {
    const c = getComputedStyle(a), ar = a.getBoundingClientRect();
    if (['hidden', 'clip'].includes(c.overflowX) && (r.left < ar.left - 1 || r.right > ar.right + 1)) return false;
    if (['hidden', 'clip'].includes(c.overflowY) && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1)) return false;
  }
  return true;
}`;

(async () => {
  const server = await startServer(PORT, { new: REPO });
  const browser = new Browser('recognition', DEBUG_PORT, path.join(WORK, 'profiles'));
  const importedBrowser = new Browser('recognition-import', DEBUG_PORT + 1, path.join(WORK, 'profiles'));
  try {
    const p = await browser.launch();
    const E = code => p.eval(code);
    const click = selector => E(`(() => { const el = document.querySelector(${J(selector)}); if (!el) throw new Error('Missing control: ' + ${J(selector)}); el.click(); return true; })()`);
    const open = pid => E(`(() => { selectedPlan = ${J(pid)}; switchTab('trening'); renderTrening(); document.getElementById('btn-plan-rename').click(); return true; })()`);
    const save = () => click('#btn-edit-save');
    const cancel = () => click('#btn-edit-cancel');
    const rowSelector = '#edit-rows .edit-row:first-child';
    const typeName = async name => {
      await E(`(() => { const el = document.querySelector(${J(rowSelector + ' .edit-name')}); el.focus(); el.select(); return true; })()`);
      if (name) await p.c.send('Input.insertText', { text: name });
      else {
        await p.c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await p.c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      }
    };
    const status = () => E(`(() => {
      const row = document.querySelector(${J(rowSelector)}), el = row.querySelector('.edit-recognition');
      const fit = ${FIT};
      return { state: el && el.dataset.state, text: el && el.innerText,
        visible: fit(el), focused: document.activeElement === row.querySelector('.edit-name'),
        primary: row.querySelector('.edit-muscle-primary').value,
        helpers: Array.from(row.querySelectorAll('[data-muscle]:checked'), x => x.dataset.muscle),
        weight: Number(row.querySelectorAll('.edit-num')[2].value),
        labels: { chest: muscleLabel('chest'), arms: muscleLabel('arms'), shoulders: muscleLabel('shoulders'),
          back: muscleLabel('back'), core: muscleLabel('core'), other: muscleLabel('other') } };
    })()`);
    const primary = (root, value) => E(`(() => {
      const el = document.querySelector(${J(root)}).querySelector('.edit-muscle-primary');
      el.value = ${J(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); return el.value;
    })()`);
    const helper = (root, muscle) => click(root + ' [data-muscle="' + muscle + '"]');
    const snapshot = () => E(`JSON.stringify({ plans: state.plans, history: state.history, memory: state.settings.exerciseMemory, corrections: state.settings.exerciseMuscleCorrections })`);
    const oldRaw = () => E(`JSON.stringify(state.history.filter(w => w.id.startsWith('archive-') || w.id === 'explicit-known'))`);
    const openMusclesUI = () => E(`(() => { switchTab('pokrok'); setPokrokView('stats'); renderStatsGrid(); document.querySelector('#stats-grid [data-go="muscles"]').click(); return true; })()`);
    const expandReview = () => E(`(() => { const el = document.querySelector('#modal-muscles .mu-unassigned'); if (!el) throw new Error('Missing Other review'); if (!el.open) el.querySelector('summary').click(); return true; })()`);
    const reviewIndex = name => E(`Array.from(document.querySelectorAll('#modal-muscles .mu-unassigned-row')).findIndex(el => el.innerText.includes(${J(name)}))`);
    /* Dočasný atribút namiesto závislosti od vnútorného rozloženia zoznamu. */
    const review = async name => {
      const index = await reviewIndex(name);
      if (index < 0) throw new Error('Missing unassigned identity: ' + name);
      await E(`(() => { document.querySelectorAll('[data-regression-review]').forEach(el => el.removeAttribute('data-regression-review')); document.querySelectorAll('#modal-muscles .mu-unassigned-row')[${index}].setAttribute('data-regression-review', 'current'); return true; })()`);
      return '#modal-muscles [data-regression-review="current"]';
    };
    const counts = () => E(`(() => { const out = {}; for (const row of document.querySelectorAll('#muscles-list .mu-row')) {
      const label = row.querySelector('.mu-name').textContent;
      const code = ['chest','back','shoulders','arms','legs','glutes','core','other'].find(m => muscleLabel(m) === label);
      out[code] = Number(row.querySelector('.mu-val bdi').textContent.replace(/\\s/g, ''));
    } return out; })()`);

    await p.navigate(BASE);
    const originalHistory = await E(SEED);
    await p.reload();
    await E(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    const initial = await E(`({ id: state.plans.live.exercises[0].id, builtin: state.plans.live.exercises[1] })`);
    check('initial load leaves historical bytes unchanged', await oldRaw() === originalHistory);

    console.log('== live recognition before blur');
    await open('live');
    await typeName('Bench Press');
    let s = await status();
    check('known typed name immediately shows main and helper muscles while still focused', s.focused && s.visible && s.state === 'recognized' && ['chest','arms','shoulders'].every(m => s.text.includes(s.labels[m])), s);
    check('recognition does not inherit prior manual muscles or replace the entered weight', s.primary === '' && s.helpers.length === 0 && s.weight === 37.5, s);
    check('typing has not changed saved identity, metadata, built-in ID, or weights', await E(`state.plans.live.exercises[0].id === ${J(initial.id)} && state.plans.live.exercises[0].name === 'Prior Manual Arc' && JSON.stringify(state.plans.live.exercises[1]) === ${J(J(initial.builtin))}`));
    await typeName('Bench Press (Barbell)');
    s = await status();
    check('equipment-qualified alias is recognized immediately without taking over identity or weight', s.focused && s.visible && s.state === 'recognized' && s.text.includes(s.labels.chest) && s.text.includes(s.labels.arms) && s.weight === 37.5, s);
    await save();
    check('saving a recognized alias does not silently convert its custom ID or replace its weight', await E(`(() => { const row = state.plans.live.exercises[0]; return /^cx-/.test(row.id) && row.id !== 'bench-press' && !row.builtin && row.weight === 37.5 && !row.muscles && state.plans.live.exercises[1].id === 'bench-press'; })()`));
    await p.reload(); await open('live');
    await typeName('Bench Press (levitating)');
    s = await status();
    check('unsupported equipment modifier remains unknown rather than guessed', s.state === 'unknown' && s.visible && s.focused && s.primary === '', s);
    for (const name of ['Bench Press insurance', 'Not Bench Press', 'Bench Pres', 'Workshop Unmapped Orbit']) {
      await typeName(name); s = await status();
      check('false positive stays unknown: ' + name, s.focused && s.visible && s.state === 'unknown' && s.primary === '' && !s.helpers.length, s);
    }
    const unknownText = s.text;
    await click(rowSelector + ' .edit-muscle-action');
    check('direct assignment action opens More and focuses the actual primary picker', await E(`(() => { const row = document.querySelector(${J(rowSelector)}); const fit = ${FIT}; return row.querySelector('.edit-more').open && document.activeElement === row.querySelector('.edit-muscle-primary') && fit(row.querySelector('.edit-muscle-primary')) && fit(row.querySelector('[data-muscle="arms"]').parentElement); })()`));
    await primary(rowSelector, 'back'); await helper(rowSelector, 'arms'); await helper(rowSelector, 'core');
    s = await status();
    check('manual primary/helpers immediately replace unknown feedback', s.state === 'manual' && s.visible && ['back','arms','core'].every(m => s.text.includes(s.labels[m])) && s.text !== unknownText, s);
    await typeName('Different Unmapped Orbit'); s = await status();
    check('renaming an already edited draft does not leak its previous manual assignment', s.focused && s.state === 'unknown' && s.primary === '' && s.helpers.length === 0, s);
    await typeName(''); s = await status();
    check('empty name clears the recognition result and manual metadata', s.state === 'empty' && s.primary === '' && s.helpers.length === 0, s);
    await typeName('Finished Manual Orbit');
    await click(rowSelector + ' .edit-muscle-action');
    await primary(rowSelector, 'back'); await helper(rowSelector, 'arms'); await helper(rowSelector, 'core');
    await save();
    const manualId = await E(`state.plans.live.exercises[0].id`);
    check('Save keeps typed exercise custom and preserves entered weight and explicit muscles', /^cx-/.test(manualId) && manualId !== 'bench-press' && await E(`state.plans.live.exercises[0].weight === 37.5 && JSON.stringify(state.plans.live.exercises[0].muscles) === ${J(J(BACK))} && state.plans.live.exercises[1].id === 'bench-press'`));
    await p.reload(); await open('live'); s = await status();
    check('manual feedback and controls persist after reload', s.state === 'manual' && s.primary === 'back' && same(s.helpers, ['arms','core']) && s.text.includes(s.labels.back), s);
    await typeName('  FINISHED  manual orbit  '); s = await status();
    check('case/spacing-only input preserves the same manual identity and muscles', s.focused && s.state === 'manual' && s.primary === 'back' && same(s.helpers, ['arms','core']) && s.weight === 37.5, s);
    await cancel();
    const beforeFinished = await E(`muscleWeek(currentWeekKey()).sets`);
    await E(`(selectedPlan = 'live', switchTab('trening'), renderTrening(), document.getElementById('tr-start').click(), true)`);
    await click('#exercise-list .exercise:first-child .set-btn');
    await E(`(document.querySelectorAll('#exercise-list .exercise:first-child .set-btn')[1].click(), true)`);
    await click('#btn-finish-workout'); await click('#btn-confirm-ok');
    await waitFor(() => E(`!document.getElementById('modal-result').hidden && !getSession()`), 10000, 'finished manual workout');
    const finished = await E(`({ entry: state.history[state.history.length - 1].exercises[0], sets: muscleWeek(currentWeekKey()).sets })`);
    check('actual completed sets save the manual snapshot and contribute weighted primary/helpers', finished.entry.setsDone === 2 && same(finished.entry.muscles, BACK) && finished.entry.weight === 37.5 && finished.sets.back - (beforeFinished.back || 0) === 2 && finished.sets.arms - (beforeFinished.arms || 0) === 1 && finished.sets.core - (beforeFinished.core || 0) === 1, finished);
    await click('#btn-result-close');

    console.log('== explicit Other versus Auto');
    await open('explicit'); s = await status();
    check('explicit Other is manual even for a known name, never auto-guessed', s.primary === 'other' && s.state === 'manual' && s.text.includes(s.labels.other), s);
    await click(rowSelector + ' .edit-muscle-action');
    await primary(rowSelector, ''); s = await status();
    check('Auto restores recognized main/helpers without storing a manual override', s.primary === '' && s.state === 'recognized' && s.text.includes(s.labels.chest) && s.helpers.length === 0, s);
    await save(); await p.reload(); await open('explicit'); s = await status();
    check('Auto survives Save/reload while deliberate historical Other stays frozen', s.primary === '' && s.state === 'recognized' && await E(`(() => { const w = state.history.find(w => w.id === 'explicit-known'); return muscleShare(w.exercises[0], w).other === 1; })()`), s);
    await click(rowSelector + ' .edit-muscle-action'); await primary(rowSelector, 'other'); await save();
    await p.reload(); await open('explicit'); s = await status();
    check('choosing Other survives Save/reload and clears/disables helpers', s.primary === 'other' && s.state === 'manual' && s.helpers.length === 0 && await E(`Array.from(document.querySelectorAll(${J(rowSelector + ' [data-muscle]')})).every(el => el.disabled)`), s);
    await cancel();

    console.log('== narrow, increased text, six locales, RTL');
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
    await E(`(() => { const style = document.createElement('style'); style.id = 'regression-large-text'; style.textContent = '.edit-recognition,.edit-muscle-action,.edit-muscles label,.edit-muscles legend,.edit-muscle-primary,.mu-unassigned summary,.mu-unassigned-row label,.mu-assignment-save{font-size:20px!important;line-height:1.5!important}'; document.head.appendChild(style); document.documentElement.style.fontSize = '125%'; return true; })()`);
    const localeTexts = [];
    for (const lang of ['sk','en','es','pt-BR','fr','ar']) {
      await E(`(setLang(${J(lang)}), true)`); await open('live');
      await typeName('Dumbbell bench press'); s = await status();
      check(lang + ': live main/helpers fit at 320px and increased text before blur', s.focused && s.visible && s.state === 'recognized' && ['chest','arms','shoulders'].every(m => s.text.includes(s.labels[m])), s);
      await typeName('Locale Unmapped Orbit'); s = await status();
      localeTexts.push(s.text);
      check(lang + ': unknown message is visible and translated, with no raw keys', s.visible && s.state === 'unknown' && !!s.text && !/muscles\.|recognition\.|undefined|NaN/.test(s.text), s);
      await click(rowSelector + ' .edit-muscle-action');
      check(lang + ': primary/helper controls and direct action remain reachable and unclipped', await E(`(() => { const fit = ${FIT}, row = document.querySelector(${J(rowSelector)}); return row.querySelector('.edit-more').open && fit(row.querySelector('.edit-muscle-action')) && fit(row.querySelector('.edit-muscle-primary')) && Array.from(row.querySelectorAll('[data-muscle]')).every(el => fit(el.parentElement)) && document.documentElement.dir === ${J(lang === 'ar' ? 'rtl' : 'ltr')}; })()`));
      await primary(rowSelector, 'back'); await helper(rowSelector, 'arms'); s = await status();
      check(lang + ': manual feedback remains visible with local primary/helper labels', s.state === 'manual' && s.visible && s.text.includes(s.labels.back) && s.text.includes(s.labels.arms), s);
      await cancel();
      await openMusclesUI(); await expandReview();
      const r = await review('Archive Orbit');
      check(lang + ': historical correction picker and Save fit increased-text narrow layout', await E(`(() => { const fit = ${FIT}, row = document.querySelector(${J(r)}); return fit(document.querySelector('.mu-unassigned summary')) && fit(row.querySelector('.edit-muscle-primary')) && fit(row.querySelector('.mu-assignment-save')) && Array.from(row.querySelectorAll('[data-muscle]')).every(el => fit(el.parentElement)); })()`));
      await click('#btn-muscles-close');
    }
    check('unknown feedback is localized distinctly in all six languages', new Set(localeTexts).size === 6, localeTexts);
    await E(`(document.getElementById('regression-large-text').remove(), document.documentElement.style.fontSize = '', setLang('en'), true)`);
    await p.c.send('Emulation.clearDeviceMetricsOverride');

    console.log('== historical Other review, explicit Save only');
    await openMusclesUI(); await expandReview();
    let c = await counts();
    check('historical missing and v113 Other sets remain in Other before correction', c.other === 10 && c.legs === 1 && c.core === 1.5 && c.back === 2, c);
    const rows = await E(`Array.from(document.querySelectorAll('.mu-unassigned-row'), el => el.innerText)`);
    check('review groups missing and v113 Other records into one custom identity', rows.filter(text => text.includes('Archive Orbit')).length === 1, rows);
    const beforeNoSave = await snapshot();
    let r = await review('Archive Orbit');
    await primary(r, 'back'); await helper(r, 'arms'); await helper(r, 'core');
    check('changing review pickers without Save does not mutate plans, memory, or history', await snapshot() === beforeNoSave);
    await click('#btn-muscles-close'); await p.reload();
    check('closing without Save and reloading leaves data untouched', await snapshot() === beforeNoSave);
    await openMusclesUI(); await expandReview(); r = await review('Archive Orbit');
    check('unsaved picker choices do not survive reopening', await E(`document.querySelector(${J(r)}).querySelector('.edit-muscle-primary').value === ''`));
    const beforeCorrection = await E(`({ history: JSON.stringify(state.history), weights: Object.fromEntries(Object.entries(state.plans).map(([id, p]) => [id, p.exercises.map(e => e.weight)])), rememberedWeights: Object.fromEntries(Object.entries(state.settings.exerciseMemory).map(([id, entry]) => [id, entry.weight])), xp: state.history.map(w => w.xp), totalVolume: muscleWeek(currentWeekKey()).totalVolume })`);
    await primary(r, 'back'); await helper(r, 'arms'); await helper(r, 'core');
    await click(r + ' .mu-assignment-save');
    c = await counts();
    check('Save immediately removes five Other sets and adds full primary plus half helpers', c.other === 5 && c.back === 7 && c.arms === 3.5 && c.core === 4 && c.legs === 1, c);
    const correction = await E(`(() => { const row = state.plans.archive.exercises[0], id = row.id, knownWorkout = state.history.find(w => w.id === 'explicit-known'); return { id, correction: state.settings.exerciseMuscleCorrections[id], primary: row.muscles, duplicate: state.plans.duplicate.exercises[0].muscles, history: JSON.stringify(state.history), weights: Object.fromEntries(Object.entries(state.plans).map(([id, p]) => [id, p.exercises.map(e => e.weight)])), rememberedWeights: Object.fromEntries(Object.entries(state.settings.exerciseMemory).map(([id, entry]) => [id, entry.weight])), xp: state.history.map(w => w.xp), totalVolume: muscleWeek(currentWeekKey()).totalVolume, saved: state.history.find(w => w.id === 'archive-saved').exercises[0].muscles, known: muscleShare(knownWorkout.exercises[0], knownWorkout) }; })()`);
    const expectedCorrection = { ...BACK, workoutIds: correction.correction.workoutIds };
    check('correction is independent of weight memory, scoped to existing Other workouts across weeks, and updates current defaults', same(correction.correction, expectedCorrection) && same(correction.correction.workoutIds.slice().sort(), ['archive-missing','archive-previous','archive-v113']) && same(correction.primary, BACK) && same(correction.duplicate, BACK), correction);
    check('historical bytes, row/remembered weights, XP and unweighted volume are unchanged', correction.history === beforeCorrection.history && same(correction.weights, beforeCorrection.weights) && same(correction.rememberedWeights, beforeCorrection.rememberedWeights) && same(correction.xp, beforeCorrection.xp) && correction.totalVolume === beforeCorrection.totalVolume, correction);
    check('non-Other saved snapshot and deliberately Other known exercise are untouched', same(correction.saved, { primary: 'legs', secondary: ['core'] }) && same(correction.known, { other: 1 }) && await oldRaw() === originalHistory, correction);
    await click('#btn-muscles-prev'); await click('#btn-muscles-prev');
    const previousWeekCorrection = await counts();
    check('one explicit Save also corrects existing Other workouts outside the displayed week', previousWeekCorrection.back === 2 && previousWeekCorrection.arms === 1 && previousWeekCorrection.core === 1 && !previousWeekCorrection.other, previousWeekCorrection);
    await click('#btn-muscles-next'); await click('#btn-muscles-next');
    await click('#btn-muscles-close'); await p.reload(); await openMusclesUI();
    check('Other correction survives reload in the visible weighted totals', same(await counts(), c), await counts());
    check('reload preserves correction map and raw historical bytes', await E(`JSON.stringify(state.settings.exerciseMuscleCorrections[${J(correction.id)}]) === ${J(J(expectedCorrection))} && JSON.stringify(state.history) === ${J(beforeCorrection.history)}`));
    await click('#btn-muscles-close');

    console.log('== backup round trip into a fresh isolated guest');
    const backup = await E(`backupPayload()`);
    const payload = JSON.parse(backup);
    check('backup contains correction metadata without changing history or weights', same(payload.settings.exerciseMuscleCorrections[correction.id], expectedCorrection) && J(payload.history) === beforeCorrection.history && payload.plans.archive.exercises[0].weight === 37.5 && payload.plans.duplicate.exercises[0].weight === 55);
    const p2 = await importedBrowser.launch(); await p2.navigate(BASE);
    await p2.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); const transfer = new DataTransfer(); transfer.items.add(new File([${J(backup)}], 'recognition.json', { type: 'application/json' })); const input = document.getElementById('file-import'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(() => p2.eval(`typeof pendingImport !== 'undefined' && !!pendingImport && !document.getElementById('modal-generic').hidden`), 10000, 'backup import confirmation');
    await p2.eval(`(document.getElementById('btn-generic-ok').click(), true)`); await p2.reload();
    const roundTrip = await p2.eval(`({ correction: state.settings.exerciseMuscleCorrections[${J(correction.id)}], history: JSON.stringify(state.history), sets: muscleWeek(currentWeekKey()).sets, saved: state.history.find(w => w.id === 'archive-saved').exercises[0].muscles })`);
    check('real backup import preserves Other correction, weighted totals and untouched snapshots', same(roundTrip.correction, expectedCorrection) && roundTrip.history === beforeCorrection.history && roundTrip.sets.other === 5 && roundTrip.sets.back === 7 && roundTrip.sets.arms === 3.5 && roundTrip.sets.core === 4 && same(roundTrip.saved, { primary: 'legs', secondary: ['core'] }), roundTrip);

    console.log('== correction survives a real workout weight Undo');
    await open('archive'); await typeName('No Save Archive'); await save();
    await E(`(selectedPlan = 'archive', switchTab('trening'), renderTrening(), document.getElementById('tr-start').click(), true)`);
    await click('#exercise-list .exercise:first-child .set-btn');
    await click('#btn-finish-workout'); await click('#btn-confirm-ok');
    await waitFor(() => E(`!document.getElementById('modal-result').hidden && !getSession()`), 10000, 'Undo fixture workout');
    const undoWorkout = await E(`({ id: state.history[state.history.length - 1].id, identity: state.plans.archive.exercises[0].id, raw: JSON.stringify(state.history[state.history.length - 1]) })`);
    await click('#btn-result-close'); await openMusclesUI(); await expandReview();
    r = await review('No Save Archive'); await primary(r, 'shoulders'); await helper(r, 'arms');
    await click(r + ' .mu-assignment-save'); await click('#btn-muscles-close');
    check('review corrects the just-finished Other snapshot without changing its bytes or default snapshot interpretation', await E(`(() => { const entry = state.history.find(w => w.id === ${J(undoWorkout.id)}); return JSON.stringify(entry) === ${J(undoWorkout.raw)} && muscleShare(entry.exercises[0]).other === 1 && muscleShare(entry.exercises[0], entry).shoulders === 1; })()`));
    /* Otvoríme pôvodný výsledkový list; Späť a jeho potvrdenie sú skutočné ovládače. */
    await E(`(showResultModal(), true)`); await click('#btn-result-undo'); await click('#btn-generic-ok');
    await p.reload();
    check('Undo removes only its workout and preserves the independent historical correction map', await E(`(() => { const meta = state.settings.exerciseMuscleCorrections[${J(undoWorkout.identity)}]; return !state.history.some(w => w.id === ${J(undoWorkout.id)}) && meta.primary === 'shoulders' && JSON.stringify(meta.secondary) === '["arms"]' && meta.workoutIds.includes('archive-cancel') && JSON.stringify(state.settings.exerciseMuscleCorrections[${J(correction.id)}]) === ${J(J(expectedCorrection))}; })()`));
    check('Undo leaves original historical bytes and corrected missing-history contribution intact', await oldRaw() === originalHistory && await E(`(() => { const w = state.history.find(w => w.id === 'archive-cancel'); return muscleShare(w.exercises[0], w).shoulders === 1; })()`));

    console.log('== future explicit Other does not inherit an old correction');
    await openMusclesUI(); const beforeFutureOther = await counts(); await click('#btn-muscles-close');
    await open('duplicate'); await click(rowSelector + ' .edit-muscle-action'); await primary(rowSelector, 'other'); await save();
    await E(`(selectedPlan = 'duplicate', switchTab('trening'), renderTrening(), document.getElementById('tr-start').click(), true)`);
    await click('#exercise-list .exercise:first-child .set-btn');
    await click('#btn-finish-workout'); await click('#btn-confirm-ok');
    await waitFor(() => E(`!document.getElementById('modal-result').hidden && !getSession()`), 10000, 'future deliberate Other workout');
    const futureOther = await E(`(() => { const w = state.history[state.history.length - 1], old = state.history.find(w => w.id === 'archive-v113'); return { id: w.id, muscles: w.exercises[0].muscles, share: muscleShare(w.exercises[0], w), previous: muscleShare(old.exercises[0], old), correction: state.settings.exerciseMuscleCorrections[${J(correction.id)}] }; })()`);
    check('new deliberately Other snapshot stays Other while previously corrected Other stays classified', same(futureOther.muscles, { primary: 'other', secondary: [] }) && same(futureOther.share, { other: 1 }) && futureOther.previous.back === 1 && !futureOther.correction.workoutIds.includes(futureOther.id) && same(futureOther.correction, expectedCorrection), futureOther);
    await click('#btn-result-close'); await p.reload(); await openMusclesUI();
    const afterFutureOther = await counts();
    check('reload visibly adds the future set to Other, not to the old correction groups', afterFutureOther.other === beforeFutureOther.other + 1 && afterFutureOther.back === beforeFutureOther.back && afterFutureOther.arms === beforeFutureOther.arms && afterFutureOther.core === beforeFutureOther.core, { before: beforeFutureOther, after: afterFutureOther });
    check('future Other and scoped correction survive backup without rewriting original history', await oldRaw() === originalHistory && await E(`(() => { const payload = JSON.parse(backupPayload()), w = payload.history.find(w => w.id === ${J(futureOther.id)}), meta = payload.settings.exerciseMuscleCorrections[${J(correction.id)}]; return w.exercises[0].muscles.primary === 'other' && !meta.workoutIds.includes(w.id) && JSON.stringify(meta) === ${J(J(expectedCorrection))}; })()`));
    await click('#btn-muscles-close');
    check('no exceptions in either isolated browser', p.errors.length === 0 && p2.errors.length === 0, { main: p.errors, imported: p2.errors });
  } catch (e) {
    check('no exception', false, String(e && e.stack || e));
  } finally {
    browser.killHard(true); importedBrowser.killHard(true);
    await server.close();
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
