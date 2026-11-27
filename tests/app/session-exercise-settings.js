'use strict';
/* Gym-Lift — nastavenia cviku počas tréningu (LIVE SETTINGS), v reálnom headless Chrome. Bez účtov, bez siete.

     node tests/app/session-exercise-settings.js

   Kontroluje: položka „Exercise settings“ v ⋯ liste; list #modal-ex-settings (6 jazykov, RTL, svetlý/tmavý režim);
   zmena režimu ako nový krok reťazca (kind 'settings') so ZOSTÁVAJÚCOU prácou; odcvičené série zostávajú
   nedotknuté; blokáda rozpracovaného páru ľavá/pravá pre každú zmenu reťazca (nastavenia aj výmena) bez zmeny
   stavu, aj po obnovení stránky; Späť len pre neodcvičený krok; duplicity, cviky pridané počas tréningu
   a vlastný cvik; história (segmenty jedného logického cviku), XP, svaly, úspechy a nezmenený plán;
      knižnicová výmena funguje ďalej; neúspešný zápis dokončenia a opakovanie bez straty a duplicít; duplicitné riadky plánu
      so samostatným sledovaním; segmenty len s rozcvičkami / dropmi; pamätaná váha len zo zlučiteľných segmentov; Späť
      nasledovníka blokovaný pri rozpracovanom páre aj pri neskorom potvrdení. Escape / Späť / isBusy sa overujú cez integráciu rodiča
      (sekcia „parent integration“). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-ex-settings');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('exset-' + Date.now().toString(36), Number(process.env.GQ_DEBUG_PORT) || 9881, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  let expectedStorageFailure = false;
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => {
    if (e.entry.level !== 'error' || /favicon/.test(e.entry.url || '')) return;
    if (expectedStorageFailure && /Nepodarilo sa uložiť dáta/.test(e.entry.text || '')) return;
    logs.push(e.entry.text);
  });

  const LANGS = ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar'];
  const modal = `document.getElementById('modal-ex-settings')`;
  const active = (row) => `(() => { const l = Array.from(document.querySelectorAll('#exercise-list .exercise[data-row="${row}"]:not(.exercise-closed)')); return l[l.length - 1]; })()`;
  const clickSet = (row, i) => p.eval(`(${active(row)}.querySelectorAll('.sets .set-item:not(.drop-item) .set-btn')[${i}].click(), true)`);
  const openActions = async (row) => { await p.eval(`(${active(row)}.querySelector('.btn-ex-more').click(), true)`); await wait(80); };
  const openSettings = async (row) => { await openActions(row); await p.eval(`(document.querySelector('#modal-ex-actions .btn-ex-settings').click(), true)`); await wait(100); };
  const typeIn = (id, v) => p.eval(`(() => { const i = document.getElementById(${J(id)}); i.value = ${J(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const press = (id) => p.eval(`(document.getElementById(${J(id)}).click(), true)`);
  const esc = () => p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  const sessJson = () => p.eval(`JSON.stringify(getSession())`);
  const slotsOf = () => p.eval(`exerciseSlots(currentPlan()).map((s) => s.slot)`);
  const exOf = (i) => `chainCurrentEx(exerciseSlots(currentPlan())[${i}])`;
  const mark = (i, idx, side) => p.eval(`(toggleSetMark('done', ${exOf(i)}, ${idx}, true, ${J(side)}), true)`);
  /* Zmena nastavení slotu z predvolených hodnôt editora s prepísanými poľami. */
  const applyTo = (i, patch) => p.eval(`(() => {
    const info = exerciseSlots(currentPlan())[${i}];
    const d = exSettingsDefaults(chainCurrentEx(info));
    return applySessionExerciseSettings(info.slot, Object.assign({ unilateral: d.unilateral, startSide: d.startSide, remaining: d.remaining, reps: d.reps, weight: d.weight, assisted: d.assisted }, ${J(patch)}));
  })()`);
  const stepsOf = (slot) => p.eval(`JSON.stringify((getSession().substituted || {})[${J(slot)}] || [])`).then((s) => JSON.parse(s));
  const history = () => p.eval(`JSON.stringify(state.history[state.history.length - 1].exercises.map((e) => ({ name: e.name, exId: e.exId, customId: e.customId, sets: e.sets, reps: e.reps, done: e.setsDone, uni: e.unilateral === true, start: e.startSide,
    seg: e.segment ? e.segment.id + ':' + e.segment.n + '/' + e.segment.of : null, doneSets: e.doneSets || null, sidesDone: e.sidesDone || null, sideReps: e.sideReps || null, substitutedFor: e.substitutedFor, replacedBy: e.replacedBy, replacedAfterSets: e.replacedAfterSets })))`).then((s) => JSON.parse(s));

  try {
    await p.navigate(BASE);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.eval(`(() => {
      state.plans['xtest'] = { id: 'xtest', builtin: false, customName: 'Settings test', location: null,
        exercises: [{ id: 'leg-press', name: 'Leg press', sets: 3, reps: 10, weight: 100 },
          { name: 'Custom split squat', sets: 3, reps: 8, weight: 20, unilateral: true, startSide: 'left' },
          { id: 'dumbbell-row', name: 'DB row', sets: 2, reps: 10, weight: 30 },
          { id: 'dumbbell-row', name: 'DB row', sets: 2, reps: 10, weight: 30 }] };
      if (!state.planOrder.includes('xtest')) state.planOrder.push('xtest');
      state.history = []; state.demo = false;   // XP a denný limit sa merajú od čistej histórie
      selectedPlan = 'xtest'; ensureSession(getPlan('xtest')); saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    // Compare against the same canonical plan shape restored during the later reload.
    await p.navigate(BASE);
    await p.eval(`(switchTab('trening'), renderTrening(), true)`);
    await wait(400);
    const SL = await slotsOf();
    const planBefore = await p.eval(`JSON.stringify(state.plans.xtest)`);

    console.log('== catalogue and action sheet');
    const miss = await p.eval(`(() => { const out = []; for (const l of ${J(LANGS)}) for (const k of Object.keys(I18N.en).filter((x) => x.startsWith('exsettings.'))) {
      if (I18N[l][k] === undefined) { out.push(l + ':' + k); continue; }
      for (const ph of (I18N.en[k].match(/\\{\\w+\\}/g) || [])) if (!I18N[l][k].includes(ph)) out.push(l + ':' + k + ph); } return out; })()`);
    check('every exsettings.* key exists in all six languages with the same placeholders', miss.length === 0, miss);
    await openActions(0);
    check('⋯ sheet offers Exercise settings after Replace and before Progress (leg press: no Plates)', await p.eval(`Array.from(document.querySelectorAll('#ex-actions-list button:not([hidden])')).map((x) => x.className.split(' ').find((c) => /^(btn-|exercise-swap)/.test(c))).join()`) === 'btn-add-drop,exercise-swap,btn-ex-settings,btn-ex-progress');
    await p.eval(`(closeExerciseActions(), true)`);

    console.log('== sheet: languages, RTL, themes');
    for (const lang of LANGS) {
      await p.eval(`(setLang(${J(lang)}), renderTrening(), true)`); await wait(100);
      await openSettings(0);
      const x = await p.eval(`(() => { const m = ${modal}, d = m.querySelector('.modal'); return { open: !m.hidden, dir: document.documentElement.dir, raw: m.textContent, title: document.getElementById('ex-settings-title').textContent,
        close: document.getElementById('btn-ex-settings-close').getAttribute('aria-label'), over: d.scrollWidth <= d.clientWidth + 1, label: document.getElementById('ex-settings-sets-label').textContent,
        save: document.getElementById('btn-ex-settings-save').textContent }; })()`);
      check(lang + ': sheet opens translated, no raw key, no overflow', x.open && !/exsettings\./.test(x.raw) && x.title.length > 0 && x.close.length > 3 && x.over && x.label.length > 3 && x.save.length > 3, x);
      if (lang === 'ar') check('ar: right-to-left', x.dir === 'rtl');
      await press('btn-ex-settings-close'); await wait(50);
    }
    await p.eval(`(setLang('en'), renderTrening(), true)`); await wait(100);
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), true)`);
      await openSettings(0);
      const g = await p.eval(`(() => { const m = ${modal}, d = m.querySelector('.modal'); const bs = Array.from(d.querySelectorAll('button')).filter((x) => x.id !== 'btn-ex-settings-close' && x.getBoundingClientRect().height > 0);
        return { over: d.scrollWidth <= d.clientWidth + 1, tall: bs.every((x) => x.getBoundingClientRect().height >= 44), n: bs.length }; })()`);
      check(theme + ': controls are ≥ 44 px, nothing overflows at 390 px', g.over && g.tall && g.n >= 8, g);
      if (process.env.GQ_SCREENSHOTS === '1') {
        const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'settings-' + theme + '.png'), Buffer.from(s.data, 'base64'));
      }
      await press('btn-ex-settings-close'); await wait(50);
    }

    console.log('== parent integration: Escape, Back, isBusy, focus');
    await openSettings(0);
    check('open sheet counts as busy and takes focus', await p.eval(`isBusy() && ${modal}.contains(document.activeElement) && sessionExerciseSettingsOpen()`));
    await esc(); await wait(60);
    check('Escape closes it and focus returns to the ⋯ of the same exercise', await p.eval(`${modal}.hidden && !sessionExerciseSettingsOpen() && document.activeElement.classList.contains('btn-ex-more') && ${active(0)}.contains(document.activeElement)`));
    await p.eval(`(closeSessionExerciseSettings(), true)`);   // ďalšie scenáre nesmú závisieť od integrácie rodiča
    await openSettings(0);
    check('Back closes it', await p.eval(`nativeBack() === 'closed' && ${modal}.hidden`));
    await p.eval(`(closeSessionExerciseSettings(), true)`);

    console.log('== A: bilateral 2 of 3 done → one side at a time, start right');
    await clickSet(0, 0); await clickSet(0, 1); await wait(80);
    const doneA = await p.eval(`JSON.stringify(getSession().completedSets)`);
    await openSettings(0);
    const a0 = await p.eval(`({ name: document.getElementById('ex-settings-name').textContent, done: document.getElementById('ex-settings-done').textContent, sets: document.getElementById('ex-settings-sets').value,
      label: document.getElementById('ex-settings-sets-label').textContent, bothOn: document.getElementById('ex-settings-mode-both').getAttribute('aria-pressed'), sideHidden: document.getElementById('ex-settings-side-box').hidden,
      save: document.getElementById('btn-ex-settings-save').disabled, alert: document.getElementById('ex-settings-alert').dataset.kind, focusIn: ${modal}.contains(document.activeElement) })`);
    check('opens on the real values: remaining = 3 − 2 done, labelled REMAINING, both sides, Save disabled until a change', /^leg press$/i.test(a0.name) && /2/.test(a0.done) && a0.sets === '1' && a0.label === 'Remaining sets' && a0.bothOn === 'true' && a0.sideHidden && a0.save && a0.alert === 'nochange' && a0.focusIn, a0);
    await press('ex-settings-mode-one');
    const a1 = await p.eval(`({ label: document.getElementById('ex-settings-sets-label').textContent, sideHidden: document.getElementById('ex-settings-side-box').hidden, save: document.getElementById('btn-ex-settings-save').disabled })`);
    check('one side at a time: label says per side, start side appears, Save enabled', a1.label === 'Remaining sets per side' && !a1.sideHidden && !a1.save, a1);
    await press('ex-settings-side-right');
    await press('btn-ex-settings-save'); await wait(200);
    const stepsA = await stepsOf(SL[0]);
    check('a single additive settings step; the sheet closed', stepsA.length === 1 && stepsA[0].kind === 'settings' && await p.eval(`${modal}.hidden`));
    check('step carries identity and remaining work only (1 set per side, start right, reps/weight kept)', stepsA[0].ex.id === 'leg-press' && stepsA[0].ex.name === 'Leg press' && stepsA[0].ex.sets === 1 && stepsA[0].ex.unilateral === true && stepsA[0].ex.startSide === 'right' && stepsA[0].ex.reps === 10 && stepsA[0].ex.weight === 100 && stepsA[0].ex.sessionKey && stepsA[0].key === stepsA[0].ex.sessionKey && stepsA[0].ex.sessionKey !== 'leg-press', stepsA[0]);
    check('completed marks untouched and nothing copied into the successor key', await p.eval(`JSON.stringify(getSession().completedSets)`) === doneA);
    check('the plan row stays two-sided and untouched', await p.eval(`JSON.stringify(state.plans.xtest)`) === planBefore);
    check('focus returns to the ⋯ of the same exercise', await p.eval(`document.activeElement.classList.contains('btn-ex-more') && ${active(0)}.contains(document.activeElement)`));
    const viewA = await p.eval(`(() => { const bl = Array.from(document.querySelectorAll('#exercise-list .exercise[data-row="0"]')); const closed = bl.filter((x) => x.classList.contains('exercise-closed')); const act = bl.filter((x) => !x.classList.contains('exercise-closed'));
      return { n: bl.length, closedItems: closed[0] && closed[0].querySelectorAll('.sets .set-item').length, closedDone: closed[0] && closed[0].querySelectorAll('.set-item.set-done').length, closedLocked: closed[0] && closed[0].querySelectorAll('.set-btn:not(:disabled)').length,
        activeItems: act[0].querySelectorAll('.sets .set-item').length, first: act[0].querySelector('.sets .set-item .set-btn').getAttribute('aria-label'), undo: !!act[0].querySelector('.btn-undo-swap'), undoText: act[0].querySelector('.btn-undo-swap') && act[0].querySelector('.btn-undo-swap').textContent }; })()`);
    check('read-only closed block keeps the 2 done sets (no phantom third set); active block shows R then L', viewA.n === 2 && viewA.closedItems === 2 && viewA.closedDone === 2 && viewA.closedLocked === 0 && viewA.activeItems === 2 && /Right/i.test(viewA.first), viewA);
    check('an unperformed successor offers "Undo settings change"', viewA.undo && viewA.undoText === 'Undo settings change', viewA);

    console.log('== A: half-completed pair blocks EVERY chain edit with no state change');
    await clickSet(0, 0); await wait(80);   // iba pravá strana páru 1
    const frozen = await sessJson();
    await p.eval(`(setSetReps(${exOf(0)}, 0, 9, 'left'), true)`);   // rozpracovaná hodnota ľavej strany
    check('a performed successor can no longer be undone from the UI', await p.eval(`(() => { const undo = ${active(0)}.querySelector('.btn-undo-swap'); return !undo || undo.hidden; })()`));
    check('per-set reps editing still works while the pair is half done', await p.eval(`effectiveSetReps(${exOf(0)}, 0, 'left') === 9`));
    const frozen2 = await sessJson();
    await openSettings(0);
    const h0 = await p.eval(`({ kind: document.getElementById('ex-settings-alert').dataset.kind, text: document.getElementById('ex-settings-alert').textContent, save: document.getElementById('btn-ex-settings-save').disabled, off: document.getElementById('ex-settings-fields').disabled })`);
    check('sheet says finish the current left/right pair first, fields and Save disabled', h0.kind === 'pair' && /Finish the current left\/right pair first \(set 1\)/.test(h0.text) && h0.save && h0.off, h0);
    await press('btn-ex-settings-save'); await wait(60);
    await press('btn-ex-settings-close'); await wait(60);
    for (const [label, patch] of [['start-side only', { startSide: 'left' }], ['count only', { remaining: 3 }], ['mode', { unilateral: false }]]) {
      const r = await applyTo(0, patch);
      check('blocked (' + label + '): reason pair, nothing written', r.ok === false && r.reason === 'pair' && JSON.stringify(r.sets) === '[1]' && await sessJson() === frozen2, r);
    }
    check('the draft reps are kept and nothing else changed by the attempts', frozen2 !== frozen && JSON.parse(frozen2).setReps && Object.keys(JSON.parse(frozen2).setReps).length === 1);
    await openActions(0);
    await p.eval(`(document.querySelector('#modal-ex-actions .exercise-swap').click(), true)`); await wait(150);
    check('Replace from the ⋯ sheet explains the block and does not open the library', await p.eval(`!document.getElementById('modal-generic').hidden && document.getElementById('modal-library').hidden && /left\\/right pair first/.test(document.getElementById('generic-text').textContent)`));
    await p.eval(`(closeGeneric(), true)`);
    await p.eval(`(openLibrary('replace', { slot: ${J(SL[0])}, base: 'leg-press', ex: ${exOf(0)} }), applySubstitution('hammer-curl'), true)`); await wait(100);
    check('library replacement is blocked too: no step added, nothing changed', await sessJson() === frozen2 && await p.eval(`!document.getElementById('modal-generic').hidden`));
    await p.eval(`(closeGeneric(), closeLibrary(), requestUndoSubstitution(${J(SL[0])}), true)`);
    check('Undo cannot discard performed successor work', await sessJson() === frozen2);

    console.log('== A: reload keeps the block');
    await p.reload();
    await p.eval(`(switchTab('trening'), renderTrening(), true)`); await wait(300);
    check('after reload the session, step and marks are restored', await p.eval(`!!getSession() && JSON.stringify(getSession().completedSets)`) === JSON.stringify(JSON.parse(frozen2).completedSets) && (await stepsOf(SL[0]))[0].kind === 'settings');
    const beforeBlocked = await sessJson();
    const r0 = await applyTo(0, { startSide: 'left' });
    check('still blocked after reload (pair half done), nothing written', r0.ok === false && r0.reason === 'pair' && await sessJson() === beforeBlocked, r0);
    check('reload kept the step shape (kind, key, unilateral, start side)', await p.eval(`(() => { const s = getSession().substituted[${J(SL[0])}][0]; return s.kind === 'settings' && s.ex.unilateral === true && s.ex.startSide === 'right' && s.ex.sessionKey === s.key && s.ex.id === 'leg-press'; })()`));

    console.log('== A: finish the counterpart, then apply remaining work');
    await clickSet(0, 1); await wait(80);
    await openSettings(0);
    const c0 = await p.eval(`({ kind: document.getElementById('ex-settings-alert').dataset.kind, sets: document.getElementById('ex-settings-sets').value, save: document.getElementById('btn-ex-settings-save').disabled, off: document.getElementById('ex-settings-fields').disabled })`);
    check('pair complete: no invented work — "all planned sets are done", count empty, Save disabled', c0.kind === 'complete' && c0.sets === '' && c0.save && !c0.off, c0);
    const beforeStep2 = await p.eval(`JSON.stringify(getSession().substituted[${J(SL[0])}][0]) + '|' + JSON.stringify(getSession().completedSets) + '|' + JSON.stringify(getSession().setReps)`);
    await typeIn('ex-settings-sets', '2'); await typeIn('ex-settings-reps', '12');
    await press('ex-settings-mode-both');
    check('typing a remaining count enables Save', await p.eval(`!document.getElementById('btn-ex-settings-save').disabled`));
    await press('btn-ex-settings-save'); await wait(200);
    const stepsA2 = await stepsOf(SL[0]);
    check('second step: bilateral, 2 remaining, 12 reps, weight 100; earlier step byte-identical', stepsA2.length === 2 && stepsA2[1].kind === 'settings' && stepsA2[1].ex.sets === 2 && stepsA2[1].ex.reps === 12 && stepsA2[1].ex.weight === 100 && stepsA2[1].ex.unilateral === undefined
      && stepsA2[1].ex.sessionKey !== stepsA2[0].ex.sessionKey && await p.eval(`JSON.stringify(getSession().substituted[${J(SL[0])}][0]) + '|' + JSON.stringify(getSession().completedSets) + '|' + JSON.stringify(getSession().setReps)`) === beforeStep2, stepsA2);
    check('closed blocks show only performed work (2 sets, then 1 left/right pair), active block has 2 sets', await p.eval(`(() => { const bl = Array.from(document.querySelectorAll('#exercise-list .exercise[data-row="0"]')); return bl.length === 3 && bl[0].querySelectorAll('.set-item').length === 2 && bl[1].querySelectorAll('.set-item').length === 2 && bl[2].querySelectorAll('.set-item').length === 2 && bl[0].classList.contains('exercise-closed') && bl[1].classList.contains('exercise-closed') && !bl[2].classList.contains('exercise-closed'); })()`));
    await clickSet(0, 0); await clickSet(0, 1); await wait(80);
    check('the remaining work completes (6 done on this exercise)', await p.eval(`exerciseSegments(exerciseSlots(currentPlan())[0]).reduce((n, s) => n + countDoneSets(s.ex), 0)`) === 6);

    console.log('== B: custom unilateral exercise: 2 complete pairs of 3 → bilateral; half pair blocks');
    await mark(1, 0, 'left'); await mark(1, 0, 'right'); await mark(1, 1, 'left');
    await p.eval(`(renderTrening(), true)`);
    const frozenB = await sessJson();
    const b1 = await applyTo(1, { startSide: 'right' });
    const b2 = await applyTo(1, { unilateral: false });
    check('half pair (set 2): start-side and mode edits are blocked, nothing written', b1.reason === 'pair' && b2.reason === 'pair' && await sessJson() === frozenB, [b1, b2]);
    await mark(1, 1, 'right');
    const doneB = await p.eval(`JSON.stringify(getSession().completedSets)`);
    check('defaults after two complete pairs: remaining = 3 − 2 = 1', await p.eval(`exSettingsDefaults(${exOf(1)}).remaining === 1 && exSettingsDefaults(${exOf(1)}).state.done.length === 2`));
    const b3 = await applyTo(1, { unilateral: false });
    const stepsB = await stepsOf(SL[1]);
    check('unilateral → bilateral creates 1 bilateral set, not 3', b3.ok === true && stepsB.length === 1 && stepsB[0].ex.sets === 1 && stepsB[0].ex.unilateral === undefined && stepsB[0].ex.name === 'Custom split squat', stepsB);
    check('custom identity and muscles are carried, completed pairs untouched', await p.eval(`(() => { const row = getPlan('xtest').exercises[1]; const s = getSession().substituted[${J(SL[1])}][0].ex; return s.id === row.id && !!s.muscles && exerciseRowIdentity(s) === exerciseRowIdentity(row) && JSON.stringify(getSession().completedSets) === ${J(doneB)}; })()`));
    await mark(1, 0, null);

    console.log('== C: undo of an unperformed successor, duplicates');
    const c1 = await applyTo(2, { unilateral: true, remaining: 2 });
    await p.eval(`(renderTrening(), true)`); await wait(100);
    check('duplicate slot #0 gets its own chain; slot #1 is untouched', c1.ok === true && (await stepsOf(SL[2])).length === 1 && (await stepsOf(SL[3])).length === 0);
    await p.eval(`(setSetReps(${exOf(2)}, 0, 7, 'left'), renderTrening(), true)`); await wait(80);
    check('successor with a draft shows Undo', await p.eval(`!!${active(2)}.querySelector('.btn-undo-swap')`));
    const keyC = (await stepsOf(SL[2]))[0].key;
    await p.eval(`(${active(2)}.querySelector('.btn-undo-swap').click(), true)`); await wait(100);
    check('undo with a draft asks first (only unperformed work can be discarded)', await p.eval(`!document.getElementById('modal-generic').hidden && /nothing recorded is lost/.test(document.getElementById('generic-text').textContent) && (getSession().substituted || {})[${J(SL[2])}] !== undefined`));
    await p.eval(`(confirmGeneric(), true)`); await wait(100);
    check('confirmed: step and its draft are gone, the earlier segment is active again', await p.eval(`(getSession().substituted || {})[${J(SL[2])}] === undefined && !JSON.stringify(getSession().setReps || {}).includes(${J(keyC)}) && ${active(2)}.querySelectorAll('.sets .set-item').length === 2`));
    await applyTo(2, { unilateral: true, remaining: 2 });
    await p.eval(`(renderTrening(), true)`); await wait(80);
    await p.eval(`(${active(2)}.querySelector('.btn-undo-swap').click(), true)`); await wait(100);
    check('undo without any draft is immediate', await p.eval(`document.getElementById('modal-generic').hidden && (getSession().substituted || {})[${J(SL[2])}] === undefined`));
    const c3 = await applyTo(3, { unilateral: true, remaining: 2 });
    await mark(3, 0, 'left'); await mark(3, 0, 'right');
    check('duplicate slot #1: its own successor key; the other slot is untouched', c3.ok === true && (await stepsOf(SL[3])).length === 1 && (await stepsOf(SL[2])).length === 0 && await p.eval(`exerciseSegments(exerciseSlots(currentPlan())[2]).length === 1 && exerciseSegments(exerciseSlots(currentPlan())[2])[0].kind === 'plan'`));

    console.log('== D: exercise added during the workout keeps one extra');
    await p.eval(`(addExerciseToSession('hammer-curl'), true)`); await wait(200);
    await mark(4, 0, null);
    const d1 = await applyTo(4, { unilateral: true });
    const slotsD = await slotsOf();
    check('extra changes through the chain: still exactly one extra, one step on its slot', d1.ok === true && await p.eval(`getSession().extraExercises.length === 1`) && (await stepsOf(slotsD[4])).length === 1 && slotsD.length === 5);
    check('extra: 3 − 1 done = 2 remaining per side', (await stepsOf(slotsD[4]))[0].ex.sets === 2);
    await mark(4, 0, 'left'); await mark(4, 0, 'right');
    await p.eval(`(renderTrening(), true)`);

    console.log('== rewards: totals, XP, muscles, achievements, plan');
    const sums = await p.eval(`({ done: totalSetsDone(), total: planExerciseCount(currentPlan()) })`);
    check('done 16 (6 + 5 + 0 + 2 + 3); total counts each logical exercise once (22)', sums.done === 16 && sums.total === 22, sums);
    await p.eval(`(finishWorkout(), true)`);
    check('confirm dialog reports 16 of 22', await p.eval(`!document.getElementById('modal-confirm').hidden && /16/.test(document.getElementById('confirm-text').textContent) && /22/.test(document.getElementById('confirm-text').textContent)`));
    await p.eval(`(confirmFinish(), true)`); await wait(200);
    const hist = await history();
    check('history: 9 entries (3 + 2 + 1 + 1 + 2) in chain order', hist.length === 9 && J(hist.map((e) => e.done)) === J([2, 2, 2, 4, 1, 0, 2, 1, 2]), hist.map((e) => e.name + ':' + e.done));
    check('leg press: 3 segments share one logical id with their own flags', hist[0].seg === SL[0] + '~0:1/3' && hist[1].seg === SL[0] + '~0:2/3' && hist[2].seg === SL[0] + '~0:3/3'
      && hist[0].sets === 2 && J(hist[0].doneSets) === '[1,2]' && !hist[0].uni && hist[1].uni && hist[1].start === 'right' && hist[1].sets === 1 && J(hist[1].sidesDone) === J({ left: [1], right: [1] }) && !hist[2].uni && hist[2].reps === 12 && hist[2].sets === 2, hist.slice(0, 3));
    check('per-side reps typed before the counterpart was finished are recorded', J(hist[1].sideReps) === J({ left: [9], right: [10] }), hist[1]);
    check('custom split squat: capped first segment, stable custom identity on both', hist[3].sets === 2 && hist[3].uni && J(hist[3].sidesDone) === J({ left: [1, 2], right: [1, 2] }) && hist[3].seg === SL[1] + '~0:1/2' && hist[4].seg === SL[1] + '~0:2/2' && hist[4].sets === 1 && !hist[4].uni && !!hist[3].customId && hist[3].customId === hist[4].customId, hist.slice(3, 5));
    check('duplicates: slot #0 untouched (0 done, no segment), slot #1 one logical entry', hist[5].done === 0 && hist[5].seg === null && hist[6].seg === SL[3] + '~0:1/1' && hist[6].uni && hist[6].done === 2, hist.slice(5, 7));
    check('extra: two segments of the same logical exercise', hist[7].exId === 'hammer-curl' && hist[8].exId === 'hammer-curl' && hist[7].seg === slotsD[4] + '~0:1/2' && hist[8].seg === slotsD[4] + '~0:2/2' && hist[7].sets === 1 && hist[8].uni && hist[8].sets === 2, hist.slice(7));
    const rew = await p.eval(`(() => { const w = state.history[state.history.length - 1]; return { sum: historyDoneSets(w), xp: w.xp, derived: historyEntryXp(w), expected: workoutXpFor(16), working: [0, 1, 2].map((i) => muscleSetTotals(w.exercises[i]).working), session: getSession() }; })()`);
    check('XP comes from actual completed work (16 sets → 62), not segments', rew.sum === 16 && rew.xp === 62 && rew.derived === 62 && rew.expected === 62 && rew.session === null, rew);
    check('muscle load: bilateral full + unilateral half per segment (2 + 1 + 2)', J(rew.working) === '[2,1,2]', rew.working);
    const afterPlan = await p.eval(`JSON.stringify(state.plans.xtest)`);
    const rememberedLegPress = await p.eval(`state.settings.exerciseMemory['leg-press']`);
    check('plan is unchanged and the remembered weight carries no settings', afterPlan === planBefore && rememberedLegPress.weight === 100 && !rememberedLegPress.unilateral && !rememberedLegPress.startSide && !rememberedLegPress.assisted, { before: JSON.parse(planBefore), after: JSON.parse(afterPlan), memory: rememberedLegPress });
    const ach = await p.eval(`(() => {
      const mk = (seg) => Array.from({ length: 5 }, (_, i) => ({ id: 'sx' + i, date: '2026-03-0' + (2 + i), planId: 'xtest', exercises: [0, 1].map((k) => Object.assign({ name: 'Split', sets: 2, setsDone: 2, weight: 20, unilateral: true }, seg ? { segment: { id: 'x#0~0', n: k + 1, of: 2 } } : {})) }));
      return { segmented: achievementReach(mk(true)).balanced10 || null, separate: achievementReach(mk(false)).balanced10 || null };
    })()`);
    check('achievements: one logical unilateral exercise counts once per workout, separate ones twice', ach.segmented === null && ach.separate !== null, ach);
    check('group bracket: later segments of a slot do not add a superset member', await p.eval(`historyGroupWrap([{ group: 'a' }, { group: 'a', segment: { n: 2 } }, { group: 'a' }], ['x', 'y', 'z'], '') === historyGroupWrap([{ group: 'a' }, { group: 'a', substitutedFor: 'X' }, { group: 'a' }], ['x', 'y', 'z'], '')`));
    await p.eval(`(document.getElementById('btn-result-close').click(), true)`);

    console.log('== E: library replacement still works, and chains with a settings step after it');
    await p.eval(`(ensureSession(getPlan('xtest')), saveState(), switchTab('trening'), renderTrening(), true)`); await wait(200);
    await mark(0, 0, null);
    await p.eval(`(renderTrening(), true)`); await wait(100);
    await openActions(0);
    await p.eval(`(document.querySelector('#modal-ex-actions .exercise-swap').click(), true)`); await wait(150);
    check('Replace opens the library in replace mode (no pair is half done)', await p.eval(`!document.getElementById('modal-library').hidden && document.getElementById('modal-generic').hidden`));
    await p.eval(`(applySubstitution('hammer-curl'), true)`); await wait(150);
    const slotsE = await slotsOf();
    const e1 = await stepsOf(slotsE[0]);
    check('replacement is a normal step without kind', e1.length === 1 && e1[0].kind === undefined && e1[0].ex.id === 'hammer-curl', e1);
    await mark(0, 0, null);
    const e2 = await applyTo(0, { unilateral: true, remaining: 2 });
    await mark(0, 0, 'left'); await mark(0, 0, 'right');
    await p.eval(`(finishWorkout(), confirmFinish(), true)`); await wait(200);
    const histE = (await history()).slice(0, 3);
    check('settings after a replacement stay in the replacement group; only its first segment says it replaced', e2.ok === true && histE.length === 3
      && histE[0].exId === 'leg-press' && histE[0].done === 1 && histE[0].replacedAfterSets === 1 && typeof histE[0].replacedBy === 'string' && histE[0].seg === null
      && histE[1].exId === 'hammer-curl' && histE[1].substitutedFor === 'Leg press' && histE[1].seg === slotsE[0] + '~1:1/2' && histE[1].sets === 1 && histE[1].done === 1
      && histE[2].exId === 'hammer-curl' && histE[2].substitutedFor === undefined && histE[2].seg === slotsE[0] + '~1:2/2' && histE[2].uni && histE[2].done === 2, histE);

    /* Spoločná príprava: čistá história, nový plán a rozbehnutá session (výsledkové okno predošlého tréningu sa zatvorí). */
    const setupPlan = (id, rows) => p.eval(`(() => {
      const r = document.getElementById('modal-result'); if (r) r.hidden = true;
      if (getSession()) { clearSession(); stopTimer(); }
      state.plans[${J(id)}] = { id: ${J(id)}, builtin: false, customName: ${J(id)}, location: null, exercises: ${J(rows)} };
      if (!state.planOrder.includes(${J(id)})) state.planOrder.push(${J(id)});
      state.history = []; state.demo = false;
      selectedPlan = ${J(id)}; ensureSession(getPlan(${J(id)})); saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    const finishNow = () => p.eval(`(finishWorkout(), confirmFinish(), true)`).then(() => wait(200));
    const lastHist = () => p.eval(`JSON.stringify(state.history[state.history.length - 1].exercises.map((e) => ({ done: e.setsDone, uni: e.unilateral === true, as: e.assisted === true, seg: e.segment ? e.segment.n + '/' + e.segment.of : null,
      w: (e.warmups || []).map((d) => d.weight), d: (e.drops || []).map((d) => d.weight), sw: e.setWeights || null, sr: e.setReps || null })))`).then((s) => JSON.parse(s));

    console.log('== F: a failed write keeps the session; the retry saves exactly once and loses nothing');
    await setupPlan('xfail', [{ id: 'leg-press', name: 'Leg press', sets: 3, reps: 10, weight: 100 }]);
    await p.eval(`(setSetWeight(${exOf(0)}, 0, 110), true)`);
    await mark(0, 0, null); await mark(0, 1, null);
    const snapF = () => p.eval(`JSON.stringify({ session: getSession(), plan: state.plans.xfail, mem: state.settings.exerciseMemory || null, ach: state.achievements, goals: state.goalHistory, hist: state.history.length })`);
    const f0 = await snapF();
    expectedStorageFailure = true;
    await p.eval(`(() => { window.__gqSet = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError'); return window.__gqSet.apply(this, arguments); }; return true; })()`);
    await p.eval(`(finishWorkout(), document.getElementById('confirm-note').value = 'keep me', confirmFinish(), confirmFinish(), true)`);
    const f1 = await p.eval(`({ confirmOpen: !document.getElementById('modal-confirm').hidden, err: !document.getElementById('confirm-error').hidden, result: !document.getElementById('modal-result').hidden,
      warn: !document.getElementById('app-storage-warning').hidden, note: document.getElementById('confirm-note').value, stored: JSON.parse(localStorage.getItem(STORAGE_KEY)).history.length })`);
    check('failed write: no history entry; session, plan, memory, achievements and goal are exactly as before', await snapF() === f0 && JSON.parse(f0).hist === 0);
    check('failed write: the dialog stays open with the typed note and a visible storage error, no result screen', f1.confirmOpen && f1.err && !f1.result && f1.warn && f1.note === 'keep me' && f1.stored === 0, f1);
    await p.eval(`(Storage.prototype.setItem = window.__gqSet, true)`);
    expectedStorageFailure = false;
    await p.eval(`(confirmFinish(), true)`); await wait(250);
    const f2 = await p.eval(`(() => { const w = state.history[state.history.length - 1], stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return { n: state.history.length, sessId: ${J(JSON.parse(f0).session.id)}, id: w && w.id, sets: w && historyDoneSets(w), xp: w && w.xp, expected: workoutXpFor(2), session: getSession(), confirmHidden: document.getElementById('modal-confirm').hidden,
        result: !document.getElementById('modal-result').hidden, warn: !document.getElementById('app-storage-warning').hidden, note: w && w.note, storedN: stored.history.length, storedSession: stored.activeSession,
        planW: state.plans.xfail.exercises[0].weight, memW: state.settings.exerciseMemory['leg-press'].weight }; })()`);
    check('retry saves once with the recorded sets, XP and the typed note, then clears the session and shows the result', f2.n === 1 && f2.id === f2.sessId && f2.sets === 2 && f2.xp === f2.expected && f2.session === null && f2.confirmHidden && f2.result && !f2.warn && f2.note === 'keep me', f2);
    check('retry persisted history and the cleared session, and applied the remembered weight (110) exactly once', f2.storedN === 1 && f2.storedSession === null && f2.planW === 110 && f2.memW === 110, f2);
    await p.eval(`(confirmFinish(), true)`);
    check('a stray confirm afterwards writes nothing', await p.eval(`state.history.length`) === 1);

    console.log('== G: duplicate plan rows track independently (marks, values, warm-ups, drops, reload, history, XP)');
    const DUP = [{ id: 'dumbbell-row', name: 'DB row', sets: 2, reps: 10, weight: 30 }, { id: 'dumbbell-row', name: 'DB row', sets: 2, reps: 10, weight: 30 }];
    await setupPlan('xdup', DUP);
    const planDup = await p.eval(`JSON.stringify(state.plans.xdup)`);
    const keysG = await p.eval(`exerciseSlots(currentPlan()).map((s) => exerciseSessionKey(s.ex))`);
    check('duplicate rows get distinct tracking keys; the first keeps the original one', keysG.length === 2 && keysG[0] === 'dumbbell-row' && !!keysG[1] && keysG[1] !== keysG[0], keysG);
    const doneEach = () => p.eval(`[0, 1].map((i) => countDoneSets(chainCurrentEx(exerciseSlots(currentPlan())[i])))`);
    await mark(0, 0, null);
    check('a mark on one duplicate does not show on the other and counts once', J(await doneEach()) === '[1,0]' && await p.eval(`totalSetsDone()`) === 1);
    const g1 = await applyTo(0, { unilateral: true, remaining: 1 });
    const predecessor = () => p.eval(`(() => { const s = getSession(), k = ${J(keysG[0])}, out = {};
      for (const f of ['completedSets', 'actualFailureSets', 'setWeights', 'setReps', 'setWeightLocks', 'setRepsLocks', 'setRpe']) out[f] = Object.keys(s[f] || {}).filter((x) => x.indexOf(k + ':') === 0).sort().map((x) => x + '=' + s[f][x]);
      out.drops = (s.drops || {})[k] || null; out.warm = (s.warmups || {})[k] || null; out.delta = (s.setDelta || {})[k] || 0;
      return JSON.stringify(out); })()`);
    const pred0 = await predecessor();
    await p.eval(`(() => { const ex = ${exOf(1)}; setSetWeight(ex, 0, 40); setSetReps(ex, 1, 8); toggleSetMark('done', ex, 0, true); toggleSetMark('done', ex, 1, true);
      addWarmup(ex); updateWarmup(ex, 0, { done: true }); addDrop(ex); updateDrop(ex, 0, { done: true }); return true; })()`);
    check('the closed predecessor of one duplicate is byte-identical while the other duplicate marks and edits', g1.ok === true && await predecessor() === pred0 && JSON.parse(pred0).completedSets.length === 1);
    check('the other duplicate holds its own values, warm-up and drop; the predecessor keeps 30 kg and no extras', await p.eval(`(() => { const orig = exerciseSlots(currentPlan())[0].ex, other = ${exOf(1)};
      return effectiveSetWeight(other, 0) === 40 && effectiveSetReps(other, 1) === 8 && sessionWarmups(other).length === 1 && sessionDrops(other).length === 1
        && effectiveSetWeight(orig, 0) === 30 && effectiveSetReps(orig, 1) === 10 && sessionWarmups(orig).length === 0 && sessionDrops(orig).length === 0 && countDoneSets(orig) === 1; })()`));
    await mark(0, 0, 'left'); await mark(0, 0, 'right');
    check('the plan rows were never touched', await p.eval(`JSON.stringify(state.plans.xdup)`) === planDup);
    const reloadView = () => p.eval(`JSON.stringify({ keys: exerciseSlots(currentPlan()).map((s) => exerciseSessionKey(s.ex)), done: totalSetsDone(), marks: getSession().completedSets, weights: getSession().setWeights })`);
    const beforeReload = await reloadView();
    await p.reload();
    await p.eval(`(switchTab('trening'), renderTrening(), true)`); await wait(300);
    check('keys and marks are identical after a reload', await reloadView() === beforeReload && await predecessor() === pred0);
    const planDup2 = await p.eval(`JSON.stringify(state.plans.xdup)`);   // kanonický tvar plánu po načítaní
    await finishNow();
    const histG = await lastHist();
    const rewG = await p.eval(`(() => { const w = state.history[state.history.length - 1]; return { sum: historyDoneSets(w), xp: w.xp, derived: historyEntryXp(w), expected: workoutXpFor(5), plan: JSON.stringify(state.plans.xdup) }; })()`);
    check('history: the closed predecessor (1), its unilateral successor (2) and the other duplicate (2) are separate, nothing counted twice', J(histG.map((e) => e.done)) === '[1,2,2]' && histG[0].seg === '1/2' && histG[1].seg === '2/2' && histG[1].uni && histG[2].seg === null, histG);
    check('the other duplicate recorded its own weights, reps, warm-up and drop', J(histG[2].sw) === '[40,40]' && J(histG[2].sr) === '[10,8]' && histG[2].w.length === 1 && histG[2].d.length === 1 && histG[0].w.length === 0 && histG[0].d.length === 0 && histG[0].sw === null, histG);
    check('XP counts 5 sets once and the plan is unchanged by the finish', rewG.sum === 5 && rewG.xp === rewG.expected && rewG.derived === rewG.xp && rewG.plan === planDup2, rewG);

    await setupPlan('xdup', DUP);
    await p.eval(`(() => { const s = getSession(); s.completedSets['dumbbell-row:0'] = true; s.completedSets['dumbbell-row:1'] = true; saveState(); return true; })()`);
    await p.reload();
    await p.eval(`(switchTab('trening'), renderTrening(), true)`); await wait(300);
    check('legacy shared marks stay once on the first occurrence and are never fanned out to the later one', J(await doneEach()) === '[2,0]' && await p.eval(`totalSetsDone()`) === 2);
    await p.eval(`(addExerciseToSession('dumbbell-row'), true)`); await wait(200);
    await mark(2, 0, null);
    check('a duplicate added during the workout has its own key and marks', J(await p.eval(`[0, 1, 2].map((i) => countDoneSets(chainCurrentEx(exerciseSlots(currentPlan())[i])))`)) === '[2,0,1]' && await p.eval(`exerciseSessionKey(exerciseSlots(currentPlan())[2].ex).indexOf('q_') === 0`));

    console.log('== H: segments with only warm-ups / drops stay in history with their own flags, unmerged and untruncated');
    const lim = await p.eval(`({ w: WARMUP_MAX, d: DROP_MAX })`);
    await setupPlan('xextra', [{ id: 'leg-press', name: 'Leg press', sets: 3, reps: 10, weight: 100 }]);
    const extrasOf = (kind, base) => p.eval(`(() => { const ex = ${exOf(0)}, add = ${kind === 'warm' ? 'addWarmup' : 'addDrop'}, upd = ${kind === 'warm' ? 'updateWarmup' : 'updateDrop'}; let made = 0;
      for (let k = 0; k < ${lim.w + lim.d + 2}; k++) if (add(ex)) made++;
      for (let k = 0; k < made; k++) upd(ex, k, { w: ${base} + k, r: 5 + k, done: true }); return made; })()`);
    const madeWarm1 = await extrasOf('warm', 10), madeDrop1 = await extrasOf('drop', 30);
    const h1 = await applyTo(0, { unilateral: true, assisted: true, remaining: 2 });
    await mark(0, 0, 'left'); await mark(0, 0, 'right');
    await p.eval(`(() => { const ex = ${exOf(0)}; addDrop(ex); updateDrop(ex, 0, { w: 60, r: 5, done: true }); return true; })()`);
    const h2 = await applyTo(0, { unilateral: false, assisted: false, remaining: 1 });
    const madeWarm3 = await extrasOf('warm', 70);
    await mark(0, 0, null);
    await finishNow();
    const histH = await lastHist();
    const rewH = await p.eval(`(() => { const w = state.history[state.history.length - 1]; return { sum: historyDoneSets(w), xp: w.xp, expected: workoutXpFor(3), derived: historyEntryXp(w) }; })()`);
    check('both settings changes applied and every segment performed its extras up to its own limit', h1.ok === true && h2.ok === true && madeWarm1 === lim.w && madeWarm3 === lim.w && madeDrop1 === lim.d, { h1, h2, madeWarm1, madeWarm3, madeDrop1, lim });
    check('the extras-only first segment is kept with zero main sets, its own flags and exactly its own extras', histH.length === 3 && histH[0].done === 0 && !histH[0].uni && !histH[0].as && histH[0].seg === '1/3'
      && J(histH[0].w) === J(Array.from({ length: lim.w }, (_, k) => 10 + k)) && J(histH[0].d) === J(Array.from({ length: lim.d }, (_, k) => 30 + k)), histH[0]);
    check('the assisted one-sided segment keeps its own flags and its own single drop, not the earlier extras', histH[1].done === 2 && histH[1].uni && histH[1].as && histH[1].seg === '2/3' && histH[1].w.length === 0 && J(histH[1].d) === '[60]', histH[1]);
    check('the last segment keeps all of its own warm-ups: nothing merged into it, nothing truncated', histH[2].done === 1 && !histH[2].uni && !histH[2].as && histH[2].seg === '3/3' && J(histH[2].w) === J(Array.from({ length: lim.w }, (_, k) => 70 + k)) && histH[2].d.length === 0, histH[2]);
    check('extras never count as sets or XP (3 main sets only)', rewH.sum === 3 && rewH.xp === rewH.expected && rewH.derived === rewH.xp, rewH);

    console.log('== I: the remembered weight comes only from segments compatible with the plan row');
    const memOf = () => p.eval(`JSON.stringify([state.plans.xmem.exercises[0].weight, (state.settings.exerciseMemory || {})['leg-press'] || null])`);
    const seedMem = (w) => p.eval(`(() => { state.settings.exerciseMemory = state.settings.exerciseMemory || {}; state.settings.exerciseMemory['leg-press'] = { weight: ${w}, at: 1 }; saveState(); return true; })()`);
    await setupPlan('xmem', [{ id: 'leg-press', name: 'Leg press', sets: 3, reps: 10, weight: 100 }]);
    await seedMem(100);
    const mem0 = await memOf();
    const i1 = await applyTo(0, { assisted: true, weight: 30, remaining: 3 });
    await mark(0, 0, null); await mark(0, 1, null); await mark(0, 2, null);
    await finishNow();
    check('only an assisted successor performed work: resistance plan weight and memory stay untouched (30 is help, not load)', i1.ok === true && await memOf() === mem0, [mem0, await memOf()]);
    await setupPlan('xmem', [{ id: 'leg-press', name: 'Leg press', sets: 3, reps: 10, weight: 100 }]);
    await seedMem(100);
    const i2 = await applyTo(0, { weight: 110, remaining: 3 });
    await mark(0, 0, null); await mark(0, 1, null); await mark(0, 2, null);
    await finishNow();
    const m2 = JSON.parse(await memOf());
    check('a compatible successor still updates plan row and memory (normal behaviour kept)', i2.ok === true && m2[0] === 110 && m2[1].weight === 110, m2);
    await setupPlan('xmem', [{ id: 'leg-press', name: 'Leg press', sets: 3, reps: 10, weight: 90 }]);
    await seedMem(90);
    const mem3 = await memOf();
    await mark(0, 0, null);
    const i3 = await applyTo(0, { unilateral: true, weight: 120, remaining: 2 });
    await mark(0, 0, 'left'); await mark(0, 0, 'right'); await mark(0, 1, 'left'); await mark(0, 1, 'right');
    await finishNow();
    check('a one-sided successor never sets the weight of a two-sided plan row: only the compatible first segment counts (90)', i3.ok === true && await memOf() === mem3, [mem3, await memOf()]);

    console.log('== J: Undo of any successor is blocked on a half pair, also when the state changes before the confirmation');
    await setupPlan('xpair', [{ id: 'leg-press', name: 'Leg press', sets: 3, reps: 10, weight: 100 }]);
    const slotJ = (await slotsOf())[0];
    await applyTo(0, { unilateral: true, remaining: 3 });
    await p.eval(`(openLibrary('replace', { slot: ${J(slotJ)}, base: 'leg-press', ex: ${exOf(0)} }), applySubstitution('hammer-curl'), true)`); await wait(150);
    check('the chain is: settings step, then a one-sided replacement', J((await stepsOf(slotJ)).map((s) => [s.kind || 'replace', s.ex.id, s.ex.unilateral === true])) === J([['settings', 'leg-press', true], ['replace', 'hammer-curl', true]]));
    await mark(0, 0, 'left');
    const undoGone = async () => { await p.eval(`(renderTrening(), true)`); return p.eval(`(() => { const u = ${active(0)}.querySelector('.btn-undo-swap'); return !u || u.hidden; })()`); };
    const frozenJ = await sessJson();
    await p.eval(`(requestUndoSubstitution(${J(slotJ)}), true)`);
    check('half-completed replacement: Undo does nothing, asks nothing, and the button is not offered', await sessJson() === frozenJ && await p.eval(`document.getElementById('modal-generic').hidden`) && await undoGone());
    await mark(0, 0, 'right');
    await p.eval(`(requestUndoSubstitution(${J(slotJ)}), true)`); await wait(80);
    check('a complete pair: Undo asks for confirmation as before', await p.eval(`!document.getElementById('modal-generic').hidden && /hammer curl/i.test(document.getElementById('generic-text').textContent)`));
    await mark(0, 1, 'left');   // medzi otázkou a potvrdením vznikne rozpracovaný pár
    const lateJ = await sessJson();
    await p.eval(`(confirmGeneric(), true)`); await wait(100);
    check('late half pair: the confirmation re-checks the live successor and discards nothing', await sessJson() === lateJ && J((await stepsOf(slotJ)).map((s) => s.ex.id)) === J(['leg-press', 'hammer-curl']));
    await mark(0, 1, 'right');
    await p.eval(`(requestUndoSubstitution(${J(slotJ)}), true)`); await wait(80);
    await p.eval(`(confirmGeneric(), true)`); await wait(100);
    check('with only complete pairs the ordinary replacement Undo still works: the replacement and its marks are gone', J((await stepsOf(slotJ)).map((s) => s.ex.id)) === J(['leg-press']) && await p.eval(`Object.keys(getSession().completedSets).length === 0`));
    await p.eval(`(setSetReps(${exOf(0)}, 0, 7, 'left'), requestUndoSubstitution(${J(slotJ)}), true)`); await wait(80);
    check('a settings successor with only drafts asks before discarding them', await p.eval(`!document.getElementById('modal-generic').hidden && /nothing recorded is lost/.test(document.getElementById('generic-text').textContent)`));
    await mark(0, 0, 'left');   // medzi otázkou a potvrdením sa na kroku niečo odcvičilo
    const lateS = await sessJson();
    await p.eval(`(confirmGeneric(), true)`); await wait(100);
    check('late performed work on a settings step is never discarded', await sessJson() === lateS && (await stepsOf(slotJ)).length === 1);

    check('no exceptions', p.errors.length === 0, p.errors);
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
