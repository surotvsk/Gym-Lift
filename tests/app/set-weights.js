'use strict';
/* GymQuest — different weights per set during a workout (v63), in real headless Chrome.
   No accounts and no network: the app runs with empty Community config.

     node tests/app/set-weights.js

   Checks: every set shows its weight; changing set 2 carries over to the later sets (not the
   earlier ones) and survives a reload; the plan is unchanged; the saved history stores every
   set's weight, the planned weight and the heaviest completed set as `weight` (records use it);
   history and calendar show "60 · 65 · 65 kg"; editing the weight in history replaces the
   per-set weights; a workout without changes is saved exactly as before; 6 languages; RTL. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-weights');
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
  const b = new Browser('weights-' + Date.now().toString(36), 9870, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    /* Vlastný plán s jedným cvikom 4 × 8 × 60 kg – deterministický test. */
    await p.eval(`(() => {
      state.plans['wtest'] = { id: 'wtest', builtin: false, customName: 'Weight test', location: null,
        exercises: [{ id: 'cx-w1', name: 'Bench test', sets: 4, reps: 8, weight: 60 }, { id: 'cx-w2', name: 'Row test', sets: 2, reps: 10, weight: 40 }] };
      if (!state.planOrder.includes('wtest')) state.planOrder.push('wtest');
      selectedPlan = 'wtest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    const weights = () => p.eval(`Array.from(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-weight')).map((b) => b.textContent + (b.classList.contains('changed') ? '*' : ''))`);

    console.log('== per-set weight in the workout');
    check('every set shows the planned weight', J(await weights()) === J(['60', '60', '60', '60']), await weights());
    check('no workout running yet', (await p.eval('getSession()')) === null);
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-weight')[1].click(), true)`);
    check('tapping a weight opens the editor with the current weight', await p.eval(`!!document.querySelector('.set-weight-editor') && document.querySelector('.set-weight-input').value === '60'`));
    await p.eval(`(document.querySelector('.set-weight-editor .btn:nth-of-type(2)').click(), document.querySelector('.set-weight-editor .btn:nth-of-type(2)').click(), true)`);
    check('+2.5 twice → 65', (await p.eval(`document.querySelector('.set-weight-input').value`)) === '65');
    await p.eval(`(document.querySelector('.set-weight-ok').click(), true)`);
    await wait(200);
    check('set 2 and the later sets use 65, set 1 stays 60', J(await weights()) === J(['60', '65*', '65*', '65*']), await weights());
    check('changing a weight starts the workout', !!(await p.eval('getSession()')));
    check('the plan keeps 60 kg', (await p.eval(`state.plans['wtest'].exercises[0].weight`)) === 60);
    /* Séria 4 späť na 62,5 cez pole a Enter. */
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-weight')[3].click(), true)`);
    await p.eval(`(() => { const i = document.querySelector('.set-weight-input'); i.value = '62,5'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await wait(200);
    check('set 4 typed as 62,5 (comma) → 62.5', J(await weights()) === J(['60', '65*', '65*', '62.5*']), await weights());
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-weight')[0].click(), true)`);
    await p.eval(`(() => { const i = document.querySelector('.set-weight-input'); i.value = ''; document.querySelector('.set-weight-ok').click(); return true; })()`);
    check('an empty value is refused (editor stays open, nothing saved as 0)', (await p.eval(`!!document.querySelector('.set-weight-editor')`)) && J(await weights()) === J(['60', '65*', '65*', '62.5*']), await weights());
    await p.eval(`(() => { const i = document.querySelector('.set-weight-input'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    check('Esc closes the editor without a change', (await p.eval(`!document.querySelector('.set-weight-editor')`)) && J(await weights()) === J(['60', '65*', '65*', '62.5*']));
    /* Hotové série 1–3 (séria 4 nie). */
    for (const i of [0, 1, 2]) await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-btn')[${i}].click(), true)`);
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[1].querySelectorAll('.set-btn')[0].click(), true)`);
    await p.reload();
    await p.eval(`(switchTab('trening'), true)`); await wait(300);
    check('per-set weights survive a reload', J(await weights()) === J(['60', '65*', '65*', '62.5*']), await weights());
    const shot = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(WORK, 'shots', 'workout-en.png'), Buffer.from(shot.data, 'base64'));

    console.log('== saved history');
    await p.eval(`(finishWorkout(), confirmFinish(), true)`);
    await wait(300);
    const h = await p.eval(`state.history[state.history.length - 1].exercises.map((e) => ({ name: e.name, weight: e.weight, planned: e.plannedWeight, sw: e.setWeights, done: e.setsDone }))`);
    check('Bench: every set weight stored', J(h[0].sw) === J([60, 65, 65, 62.5]), h[0]);
    check('Bench: planned weight 60 kept', h[0].planned === 60, h[0]);
    check('Bench: weight = heaviest COMPLETED set (65, not the undone 62.5 or 60)', h[0].weight === 65, h[0]);
    check('Row (no change): saved exactly as before (no setWeights / plannedWeight)', h[1].weight === 40 && h[1].sw === undefined && h[1].planned === undefined, h[1]);
    check('the plan still says 60 kg', (await p.eval(`state.plans['wtest'].exercises[0].weight`)) === 60);
    check('records use the heaviest set (65 kg)', (await p.eval(`personalRecords().some((r) => r.name === 'Bench test' && r.weight === 65)`)), await p.eval(`personalRecords().filter((r) => r.name === 'Bench test')`));
    await p.eval(`(document.getElementById('modal-result').hidden = true, switchTab('pokrok'), renderPokrok(), true)`);
    await wait(300);
    const histText = await p.eval(`document.body.innerText`);
    check('Progress history shows "60 · 65 · 65 · 62.5 kg"', histText.includes('60 · 65 · 65 · 62.5 kg'), histText.slice(0, 0));
    const today = await p.eval('todayISO()');
    await p.eval(`(switchTab('kalendar'), openDay(${J(today)}), true)`);
    await wait(300);
    check('calendar day detail shows the per-set weights', (await p.eval(`document.getElementById('modal-day').innerText`)).includes('60 · 65 · 65 · 62.5 kg'));
    await p.eval(`(closeDay(), true)`);
    const prevW = await p.eval(`(previousWorkoutFor({ name: 'Bench test' }, '2099-01-01', 'wtest') || {}).weight`);
    check('the next workout compares with 65 kg (last top set)', prevW === 65, prevW);

    console.log('== editing history');
    const id = await p.eval(`state.history[state.history.length - 1].id`);
    await p.eval(`(openHistoryEdit(${J(id)}), saveHistoryEdit(), true)`);
    check('saving history without changes keeps the per-set weights', J(await p.eval(`state.history.find((w) => w.id === ${J(id)}).exercises[0].setWeights`)) === J([60, 65, 65, 62.5]));
    await p.eval(`(() => { openHistoryEdit(${J(id)}); const inp = document.querySelector('#he-exercises .he-ex-row input[data-f="weight"]'); inp.value = '70'; inp.dispatchEvent(new Event('input')); saveHistoryEdit(); return true; })()`);
    const edited = await p.eval(`state.history.find((w) => w.id === ${J(id)}).exercises[0]`);
    check('changing the weight in history replaces the per-set weights with one weight', edited.weight === 70 && edited.setWeights === undefined && edited.plannedWeight === undefined, edited);

    console.log('== languages');
    await p.eval(`(() => { switchTab('trening'); selectedPlan = 'wtest'; renderTrening(); return true; })()`);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('trening'), renderTrening(), true)`);
      await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-weight')[1].click(), true)`);
      const r = await p.eval(`({ note: document.querySelector('.set-weight-note').textContent, aria: document.querySelector('.set-weight').getAttribute('aria-label'), key: t('setWeight.note'), dir: document.documentElement.dir })`);
      check(lang + ': editor and labels translated', r.note === r.key && !/setWeight\./.test(r.note + r.aria), r);
      if (lang === 'ar') {
        check('ar: right-to-left', r.dir === 'rtl');
        const s2 = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'workout-ar.png'), Buffer.from(s2.data, 'base64'));
      }
      await p.eval(`(closeSetWeightEditor(), true)`);
    }
    await p.eval(`(setLang('en'), true)`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.eval(`(() => { switchTab('trening'); renderTrening(); document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-weight')[1].click(); document.querySelector('.set-weight-editor').scrollIntoView({ block: 'center' }); return true; })()`);
    await wait(300);
    check('390 px: no horizontal overflow with the editor open', await p.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
    const s3 = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(WORK, 'shots', 'workout-390-editor.png'), Buffer.from(s3.data, 'base64'));

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
