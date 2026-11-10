'use strict';
/* Gym-Lift — jedno "⋯" menu akcií na cvik (gym-basics fáza 2, úloha 1), v reálnom headless Chrome. Bez účtov, bez siete.

     node tests/app/ex-actions.js

   Kontroluje: každá dlaždica v tréningu má presne jedno .btn-ex-more; dlaždica nemá tlačidlá
   Drop / Rozcvička / Rad / Kotúče / Vymeniť; list má položky v poradí; každá položka robí to isté
   ako predtým a list sa zavrie; Esc + fokus; isBusy() a NATIVE_BACK_CLOSE; riadky editora majú zatvorené
   details.edit-more; "pokojná" dlaždica na 390 px; 6 jazykov, RTL, svetlý a tmavý režim. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-ex-actions');
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
  const b = new Browser('exact-' + Date.now().toString(36), 9874, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const exEl = (i) => `document.querySelectorAll('#exercise-list .exercise')[${i}]`;
  const sheet = `document.getElementById('modal-ex-actions')`;
  const items = () => p.eval(`Array.from(${sheet}.querySelectorAll('#ex-actions-list button:not([hidden])')).map((x) => x.className.split(' ').find((c) => /^(btn-|exercise-swap)/.test(c)))`);
  const open = async (i) => { await p.eval(`(${exEl(i)}.querySelector('.btn-ex-more').click(), true)`); await wait(80); };
  const sheetHidden = () => p.eval(`${sheet}.hidden`);
  const esc = () => p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.eval(`(() => {
      state.plans['xtest'] = { id: 'xtest', builtin: false, customName: 'Actions test', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100 },
          { id: 'dumbbell-row', name: 'DB row', sets: 3, reps: 10, weight: 30 },
          { id: 'assisted-pull-ups', name: 'Assisted pull-ups', sets: 3, reps: 8, weight: 20 },
          { id: 'cx-x1', name: 'Barbell hip thrust', sets: 3, reps: 8, weight: 80, group: 'gA' },
          { id: 'cx-x2', name: 'Face pull', sets: 3, reps: 12, weight: 20, group: 'gA' }] };
      if (!state.planOrder.includes('xtest')) state.planOrder.push('xtest');
      selectedPlan = 'xtest'; ensureSession(getPlan('xtest')); saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(400);

    console.log('== tile: one ⋯, no secondary buttons');
    check('every tile has exactly one .btn-ex-more', await p.eval(`Array.from(document.querySelectorAll('#exercise-list .exercise')).every((e) => e.querySelectorAll('.btn-ex-more').length === 1)`));
    check('no tile has .btn-add-drop / .btn-add-warmup / .btn-warmup-ramp / .btn-plates / swap', await p.eval(`document.querySelectorAll('#exercise-list :is(.btn-add-drop, .btn-add-warmup, .btn-warmup-ramp, .btn-plates, .exercise-swap)').length === 0`));
    check('⋯ is the last button of the set-count row (3 buttons)', await p.eval(`Array.from(document.querySelectorAll('#exercise-list .exercise')).every((e) => { const r = e.querySelector('.set-count-row'); const bs = r ? Array.from(r.querySelectorAll('button')) : []; return bs.length === 3 && bs[2].classList.contains('btn-ex-more'); })`));
    check('aria-label "More actions for {name}"', await p.eval(`${exEl(0)}.querySelector('.btn-ex-more').getAttribute('aria-label')`) === 'More actions for Bench press');
    check('.ex-mini is not rendered while empty', await p.eval(`document.querySelectorAll('#exercise-list .ex-mini').length === 0`));
    check('#modal-ex-actions is a labelled modal dialog', await p.eval(`(() => { const d = document.querySelector('#modal-ex-actions .modal'); const l = d.getAttribute('aria-labelledby'); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!l && !!document.getElementById(l); })()`));

    console.log('== sheet items');
    await open(0);
    check('bench: + Warm-up, ramp, + Drop set, Plates, Swap (in order)', J(await items()) === J(['btn-add-warmup', 'btn-warmup-ramp', 'btn-add-drop', 'btn-plates', 'exercise-swap']), await items());
    check('the Progress item is hidden until wired', await p.eval(`(() => { const x = ${sheet}.querySelector('.btn-ex-progress'); return !x || x.hidden; })()`));
    check('labels', J(await p.eval(`Array.from(${sheet}.querySelectorAll('#ex-actions-list button:not([hidden])')).map((x) => x.textContent.trim())`)) === J(['+ Warm-up', 'Warm-up ramp', '+ Drop set', 'Plates', 'Replace exercise']));
    check('sheet is in isBusy() and Back closes it', await p.eval(`(() => { const ok = isBusy(); return ok && nativeBack() === 'closed' && ${sheet}.hidden; })()`));
    check('NATIVE_BACK_CLOSE lists it', await p.eval(`NATIVE_BACK_CLOSE.some((e) => e[0] === 'modal-ex-actions' && !!document.querySelector(e[1]))`));
    await open(1);
    check('dumbbell row: no Plates item', J(await items()) === J(['btn-add-warmup', 'btn-warmup-ramp', 'btn-add-drop', 'exercise-swap']), await items());
    await esc();
    await open(2);
    check('assisted row: no ramp, no Plates', J(await items()) === J(['btn-add-warmup', 'btn-add-drop', 'exercise-swap']), await items());
    await esc();

    console.log('== each item does what the old button did, then closes the sheet');
    await open(0);
    await p.eval(`(${sheet}.querySelector('.btn-add-warmup').click(), true)`); await wait(150);
    check('+ Warm-up adds a warm-up row', (await p.eval(`${exEl(0)}.querySelectorAll('.warmup-item').length`)) === 1);
    check('the sheet closed', await sheetHidden());
    await open(0);
    await p.eval(`(${sheet}.querySelector('.btn-warmup-ramp').click(), true)`); await wait(150);
    check('Warm-up ramp fills the ramp (4 rows for 100 kg)', (await p.eval(`${exEl(0)}.querySelectorAll('.warmup-item').length`)) === 4);
    check('the sheet closed (ramp)', await sheetHidden());
    await open(0);
    await p.eval(`(${sheet}.querySelector('.btn-add-drop').click(), true)`); await wait(150);
    check('+ Drop set adds a drop row, .ex-mini appears', (await p.eval(`${exEl(0)}.querySelectorAll('.drop-item').length`)) === 1 && (await p.eval(`!!${exEl(0)}.querySelector('.ex-mini .drop-item')`)));
    check('the sheet closed (drop)', await sheetHidden());
    await open(0);
    await p.eval(`(${sheet}.querySelector('.btn-plates').click(), true)`); await wait(150);
    check('Plates opens #modal-plates prefilled with the working weight', await p.eval(`!document.getElementById('modal-plates').hidden && document.getElementById('plate-target').value === '100'`), await p.eval(`document.getElementById('plate-target').value`));
    check('the sheet closed (plates)', await sheetHidden());
    await p.eval(`(document.getElementById('btn-plates-close').click(), true)`); await wait(100);
    check('closing the plate calculator returns focus to the ⋯ button', await p.eval(`document.activeElement && document.activeElement.classList.contains('btn-ex-more')`));
    await open(0);
    await p.eval(`(${sheet}.querySelector('.exercise-swap').click(), true)`); await wait(200);
    check('Replace opens the library picker in replace mode', await p.eval(`!document.getElementById('modal-library').hidden`));
    check('the sheet closed (swap)', await sheetHidden());
    await p.eval(`(closeLibrary(), true)`);
    for (let k = 0; k < 4; k++) { await open(0); await p.eval(`(${sheet}.querySelector('.btn-add-drop').click(), true)`); await wait(100); }
    await open(0);
    check('at the drop limit the Drop item is gone', !(await items()).includes('btn-add-drop'), await items());
    await esc();

    console.log('== Escape and focus');
    await p.eval(`(${exEl(1)}.querySelector('.btn-ex-more').focus(), ${exEl(1)}.querySelector('.btn-ex-more').click(), true)`); await wait(100);
    check('opening moves focus into the sheet', await p.eval(`${sheet}.contains(document.activeElement)`));
    await esc(); await wait(100);
    check('Escape closes the sheet', await sheetHidden());
    check('focus returns to .btn-ex-more', await p.eval(`document.activeElement && document.activeElement.classList.contains('btn-ex-more') && ${exEl(1)}.contains(document.activeElement)`));
    await p.eval(`(${exEl(1)}.querySelector('.btn-ex-more').click(), document.getElementById('btn-ex-actions-close').click(), true)`); await wait(100);
    check('the close button also closes and restores focus', (await sheetHidden()) && await p.eval(`document.activeElement.classList.contains('btn-ex-more')`));

    console.log('== plan editor rows');
    await p.eval(`(startEditPlan('xtest'), true)`); await wait(300);
    const rows = `Array.from(document.querySelectorAll('#edit-list .edit-row, .edit-row'))`;
    check('every editor row has a closed details.edit-more', await p.eval(`${rows}.length === 5 && ${rows}.every((r) => { const d = r.querySelector('details.edit-more'); return d && !d.open; })`));
    check('the ramp checkbox lives inside details.edit-more', await p.eval(`${rows}.filter((r) => !r.querySelector('.edit-assisted:checked')).every((r) => !!r.querySelector('details.edit-more .edit-warmup-ramp'))`));
    check('the link button lives inside details.edit-more', await p.eval(`${rows}.some((r) => !!r.querySelector('details.edit-more .edit-link')) && ${rows}.every((r) => !r.querySelector(':scope > .edit-link'))`));
    check('the group label stays visible with the details closed', await p.eval(`(() => { const l = document.querySelector('.edit-group-label'); return !!l && l.getBoundingClientRect().height > 0; })()`));
    check('the summary reads "More options"', await p.eval(`document.querySelector('details.edit-more > summary').textContent.trim()`) === 'More options');
    check('pre-phase-1 controls stay outside (sets to failure, both sides)', await p.eval(`${rows}.every((r) => !r.querySelector('details.edit-more .edit-unilateral') && !!r.querySelector('.edit-unilateral'))`));
    check('opening the details shows the link button', await p.eval(`(() => { const d = document.querySelector('details.edit-more'); d.open = true; return d.querySelector('.edit-link').getBoundingClientRect().height > 0; })()`));
    await p.eval(`(document.getElementById('btn-edit-cancel').click(), true)`); await wait(300);

    console.log('== calm tile at 390 px (no drops)');
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.eval(`(state.plans['xtest'].exercises = [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100 }], true)`);
    await p.eval(`(() => { const s = getSession(); if (s) { s.drops = {}; s.warmups = {}; } selectedPlan = 'xtest'; renderTrening(); return true; })()`); await wait(300);
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), true)`);
      const g = await p.eval(`(() => { const e = document.querySelector('#exercise-list .exercise'); const r = e.querySelector('.set-count-row'); const rr = r.getBoundingClientRect();
        const after = Array.from(e.children).slice(Array.from(e.children).indexOf(r) + 1).filter((c) => c.querySelector && (c.matches('button') || c.querySelector('button')));
        return { n: r.querySelectorAll('button').length, h: rr.height, after: after.map((c) => c.className), more: r.querySelector('.btn-ex-more').getBoundingClientRect().width,
          over: document.documentElement.scrollWidth <= innerWidth + 1, fits: r.scrollWidth <= r.clientWidth + 1 }; })()`);
      check(theme + ': set-count row has 3 buttons, ≤ 56 px, nothing after it, fits', g.n === 3 && g.h <= 56 && g.after.length === 0 && g.over && g.fits && g.more >= 44, g);
      const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'tile-' + theme + '.png'), Buffer.from(s.data, 'base64'));
    }

    console.log('== languages / RTL');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), renderTrening(), true)`); await wait(100);
      await open(0);
      const x = await p.eval(`({ dir: document.documentElement.dir, aria: document.querySelector('.btn-ex-more').getAttribute('aria-label'), close: document.getElementById('btn-ex-actions-close').getAttribute('aria-label'),
        title: document.getElementById('ex-actions-title').textContent, raw: ${sheet}.textContent + document.querySelector('.btn-ex-more').getAttribute('aria-label'),
        n: ${sheet}.querySelectorAll('#ex-actions-list button:not([hidden])').length,
        over: ${sheet}.querySelector('.modal').scrollWidth <= ${sheet}.querySelector('.modal').clientWidth + 1,
        miss: Object.keys(I18N.en).filter((k) => k.startsWith('exactions.') && I18N[${J(lang)}][k] === undefined) })`);
      check(lang + ': translated, 5 items, no raw key, no overflow, no missing exactions.* key', x.n === 5 && !/exactions\./.test(x.raw) && x.title.length > 0 && x.over && x.miss.length === 0 && x.aria.length > 5, x);
      if (lang === 'ar') {
        check('ar: right-to-left', x.dir === 'rtl');
        const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'sheet-ar.png'), Buffer.from(s.data, 'base64'));
      }
      await esc(); await wait(60);
    }
    await p.eval(`(setLang('en'), true)`);
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), renderTrening(), true)`); await wait(150);
      await open(0); await wait(150);
      const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'sheet-' + theme + '.png'), Buffer.from(s.data, 'base64'));
      check(theme + ': sheet items are ≥ 44 px tall', await p.eval(`Array.from(${sheet}.querySelectorAll('#ex-actions-list button:not([hidden])')).every((x) => x.getBoundingClientRect().height >= 44)`));
      await esc(); await wait(60);
    }
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
