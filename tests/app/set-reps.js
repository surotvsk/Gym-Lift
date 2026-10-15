'use strict';
/* GymQuest — different reps per set during a workout (v68), and how a workout with per-side
   ("one side at a time") exercises and changed reps is shared. Real headless Chrome, no accounts
   and no network: the app runs with empty Community config.

     node tests/app/set-reps.js

   Checks: every set shows its reps; changing set 2 from 10 to 8 carries over to the later sets
   (not the earlier ones), also for both sides of a per-side exercise, and survives a reload;
   invalid values are refused; the plan is unchanged; the saved history stores every set's reps
   and keeps the planned reps; history and calendar show "3 × 10/8/8"; the shared item carries
   the reps and the per-side flag and its card says "2 sets per side" (not "4/2 sets"); saving
   the shared workout as a plan keeps "one side at a time"; editing reps in history replaces the
   per-set reps; a workout without changes is saved exactly as before; 6 languages; RTL; 390 px. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-reps');
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
  const b = new Browser('reps-' + Date.now().toString(36), 9871, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    /* Plán: Bench 3 × 10 × 60 kg, jednostranný Curl 2 série na stranu × 12 × 8 kg, Row 2 × 10 × 40 kg. */
    await p.eval(`(() => {
      state.plans['rtest'] = { id: 'rtest', builtin: false, customName: 'Reps test', location: null,
        exercises: [{ id: 'cx-r1', name: 'Bench test', sets: 3, reps: 10, weight: 60 },
          { id: 'cx-r2', name: 'Curl test', sets: 2, reps: 12, weight: 8, unilateral: true, startSide: 'left' },
          { id: 'cx-r3', name: 'Row test', sets: 2, reps: 10, weight: 40 }] };
      if (!state.planOrder.includes('rtest')) state.planOrder.push('rtest');
      selectedPlan = 'rtest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    const reps = (i) => p.eval(`Array.from(document.querySelectorAll('#exercise-list .exercise')[${i}].querySelectorAll('.set-reps')).map((b) => b.textContent + (b.classList.contains('changed') ? '*' : ''))`);
    const clickReps = (ex, i) => p.eval(`(document.querySelectorAll('#exercise-list .exercise')[${ex}].querySelectorAll('.set-reps')[${i}].click(), true)`);

    console.log('== per-set reps in the workout');
    check('every set shows the planned reps', J(await reps(0)) === J(['10×', '10×', '10×']), await reps(0));
    check('every set still has its weight button', (await p.eval(`document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-weight').length`)) === 3);
    check('per-side exercise: reps for each side of each set', J(await reps(1)) === J(['12×', '12×', '12×', '12×']), await reps(1));
    await clickReps(0, 1);
    check('tapping the reps opens the editor with the current reps', await p.eval(`!!document.querySelector('.set-reps-editor') && document.querySelector('.set-reps-input').value === '10'`));
    await p.eval(`(document.querySelector('.set-reps-editor .btn:nth-of-type(1)').click(), document.querySelector('.set-reps-editor .btn:nth-of-type(1)').click(), true)`);
    check('−1 twice → 8', (await p.eval(`document.querySelector('.set-reps-input').value`)) === '8');
    await p.eval(`(document.querySelector('.set-reps-ok').click(), true)`);
    await wait(200);
    check('set 2 and the later sets use 8, set 1 stays 10', J(await reps(0)) === J(['10×', '8×*', '8×*']), await reps(0));
    check('changing reps starts the workout', !!(await p.eval('getSession()')));
    check('the plan keeps 10 reps', (await p.eval(`state.plans['rtest'].exercises[0].reps`)) === 10);
    for (const bad of ['', '0', 'abc', '2.5', '1000']) {
      await clickReps(0, 0);
      await p.eval(`(() => { const i = document.querySelector('.set-reps-input'); i.value = ${J(bad)}; document.querySelector('.set-reps-ok').click(); return true; })()`);
      check('invalid value ' + J(bad) + ' is refused (editor stays open, nothing saved)', (await p.eval(`!!document.querySelector('.set-reps-editor')`)) && J(await reps(0)) === J(['10×', '8×*', '8×*']), await reps(0));
      await p.eval(`(closeSetWeightEditor(), true)`);
    }
    await clickReps(0, 0);
    await p.eval(`(() => { const i = document.querySelector('.set-reps-input'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    check('Esc closes the editor without a change', (await p.eval(`!document.querySelector('.set-reps-editor')`)) && J(await reps(0)) === J(['10×', '8×*', '8×*']));
    /* Jednostranný cvik: séria 2 (ľavá) → 10 opakovaní, platí pre obe strany série 2. */
    await clickReps(1, 2);
    await p.eval(`(() => { const i = document.querySelector('.set-reps-input'); i.value = '10'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await wait(200);
    check('per-side: set 2 → 10 reps on both sides, set 1 stays 12', J(await reps(1)) === J(['12×', '12×', '10×*', '10×*']), await reps(1));
    /* Hotové: Bench všetky 3, Curl obe strany oboch sérií, Row 1. */
    for (const i of [0, 1, 2]) await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-btn')[${i}].click(), true)`);
    for (const i of [0, 1, 2, 3]) await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[1].querySelectorAll('.set-btn')[${i}].click(), true)`);
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[2].querySelectorAll('.set-btn')[0].click(), true)`);
    await p.reload();
    await p.eval(`(switchTab('trening'), true)`); await wait(300);
    check('per-set reps survive a reload', J(await reps(0)) === J(['10×', '8×*', '8×*']) && J(await reps(1)) === J(['12×', '12×', '10×*', '10×*']), [await reps(0), await reps(1)]);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.eval(`(() => { document.querySelectorAll('#exercise-list .exercise')[0].scrollIntoView({ block: 'start' }); return true; })()`);
    await wait(300);
    check('390 px: set rows fit (no horizontal overflow)', await p.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
    let s = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(WORK, 'shots', 'workout-390.png'), Buffer.from(s.data, 'base64'));
    await clickReps(0, 1);
    await p.eval(`(document.querySelector('.set-reps-editor').scrollIntoView({ block: 'center' }), true)`);
    await wait(200);
    check('390 px: no horizontal overflow with the reps editor open', await p.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
    s = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(WORK, 'shots', 'workout-390-reps-editor.png'), Buffer.from(s.data, 'base64'));
    await p.eval(`(closeSetWeightEditor(), true)`);
    await p.c.send('Emulation.clearDeviceMetricsOverride');

    console.log('== saved history');
    await p.eval(`(finishWorkout(), confirmFinish(), true)`);
    await wait(300);
    const h = await p.eval(`state.history[state.history.length - 1].exercises.map((e) => ({ name: e.name, reps: e.reps, sr: e.setReps, done: e.setsDone, u: e.unilateral }))`);
    check('Bench: every set\'s reps stored, planned reps kept', J(h[0].sr) === J([10, 8, 8]) && h[0].reps === 10, h[0]);
    check('Curl (per side): reps per set stored, 4 side-sets done', J(h[1].sr) === J([12, 10]) && h[1].done === 4 && h[1].u === true, h[1]);
    check('Row (no change): saved exactly as before (no setReps)', h[2].sr === undefined && h[2].reps === 10, h[2]);
    check('the plan still says 10 reps', (await p.eval(`state.plans['rtest'].exercises[0].reps`)) === 10);
    await p.eval(`(document.getElementById('modal-result').hidden = true, switchTab('pokrok'), renderPokrok(), true)`);
    await wait(300);
    const histText = await p.eval(`document.body.innerText`);
    check('Progress history shows "3×10/8/8"', histText.includes('3×10/8/8 · 60 kg'), histText.slice(0, 0));
    const today = await p.eval('todayISO()');
    await p.eval(`(switchTab('kalendar'), openDay(${J(today)}), true)`);
    await wait(300);
    const day = await p.eval(`document.getElementById('modal-day').innerText`);
    check('calendar day detail shows "3 × 10/8/8" and "12/10 reps" for the per-side exercise', day.includes('3 × 10/8/8 · 60 kg') && day.includes('12/10 reps'), day);
    check('calendar: no share buttons while Community is off', await p.eval(`!document.querySelector('#modal-day .day-share')`));
    await p.eval(`(closeDay(), true)`);

    console.log('== sharing a workout with per-side exercises and changed reps');
    const a = await p.eval(`shareFromWorkout(state.history[state.history.length - 1])`);
    check('shared item carries the reps per set and the per-side flag', J(a.exercises[0].sr) === J([10, 8, 8]) && a.exercises[1].u === true && J(a.exercises[1].sr) === J([12, 10]) && a.exercises[1].d === 4 && a.exercises[2].sr === undefined, a.exercises);
    const card = await p.eval(`(() => { const d = document.createElement('div'); d.innerHTML = shareCardHtml(${J(a)}, 'msg', 1); document.body.appendChild(d); const tx = d.innerText; d.remove(); return tx; })()`);
    check('card: Bench "3/3 sets · 10/8/8 reps · 60 kg"', card.includes('3/3 sets · 10/8/8 reps · 60 kg'), card);
    check('card: per-side exercise says "2 sets per side", not "4/2 sets"', card.includes('2 sets per side · 12/10 reps · 8 kg') && !card.includes('4/2'), card);
    const partial = JSON.parse(J(a)); partial.exercises[1].d = 3;
    const card2 = await p.eval(`(() => { const d = document.createElement('div'); d.innerHTML = shareCardHtml(${J(partial)}, 'msg', 1); document.body.appendChild(d); const tx = d.innerText; d.remove(); return tx; })()`);
    check('card: an unfinished per-side exercise shows how many side-sets were done', card2.includes('2 sets per side (3/4 sets)'), card2);
    const old = { kind: 'workout', name: 'Old', exercises: [{ n: 'Dumbbell curl', s: 2, r: 15, w: 8, d: 4, u: true }] };
    const card3 = await p.eval(`(() => { const d = document.createElement('div'); d.innerHTML = shareCardHtml(${J(old)}, 'msg', 1); document.body.appendChild(d); const tx = d.innerText; d.remove(); return tx; })()`);
    check('card: an already shared workout (older app) also shows "2 sets per side"', card3.includes('2 sets per side · 15 reps · 8 kg') && !card3.includes('4/2'), card3);
    const planCard = await p.eval(`(() => { const d = document.createElement('div'); d.innerHTML = shareCardHtml(shareFromPlan(state.plans['rtest']), 'msg', 1); document.body.appendChild(d); const tx = d.innerText; d.remove(); return tx; })()`);
    check('plan card: "3 × 10 · 60 kg" and "2 sets per side · 12 reps · 8 kg"', planCard.includes('3 × 10 · 60 kg') && planCard.includes('2 sets per side · 12 reps · 8 kg'), planCard);
    const saved = await p.eval(`(() => { const name = shareSaveAsPlan(${J(a)}); const pl = Object.values(state.plans).find((x) => x.customName === name); return pl.exercises.map((e) => ({ sets: e.sets, reps: e.reps, u: e.unilateral === true })); })()`);
    check('Save to my plans keeps "one side at a time" (2 sets per side)', saved[1].u === true && saved[1].sets === 2 && saved[0].u === false && saved[0].reps === 10, saved);

    console.log('== editing history');
    const id = await p.eval(`state.history[state.history.length - 1].id`);
    await p.eval(`(openHistoryEdit(${J(id)}), saveHistoryEdit(), true)`);
    check('saving history without changes keeps the per-set reps', J(await p.eval(`state.history.find((w) => w.id === ${J(id)}).exercises[0].setReps`)) === J([10, 8, 8]));
    await p.eval(`(() => { openHistoryEdit(${J(id)}); const inp = document.querySelector('#he-exercises .he-ex-row input[data-f="reps"]'); inp.value = '12'; inp.dispatchEvent(new Event('input')); saveHistoryEdit(); return true; })()`);
    const edited = await p.eval(`state.history.find((w) => w.id === ${J(id)}).exercises[0]`);
    check('changing the reps in history replaces the per-set reps with one number', edited.reps === 12 && edited.setReps === undefined, edited);

    console.log('== languages');
    await p.eval(`(() => { switchTab('trening'); selectedPlan = 'rtest'; renderTrening(); return true; })()`);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('trening'), renderTrening(), true)`);
      await clickReps(0, 1);
      const r = await p.eval(`({ note: document.querySelector('.set-weight-note').textContent, aria: document.querySelector('.set-reps').getAttribute('aria-label'), title: document.querySelector('.set-reps').title,
        ed: document.querySelector('.set-reps-editor').getAttribute('aria-label') + document.querySelector('.set-reps-input').getAttribute('aria-label') + Array.from(document.querySelectorAll('.set-reps-editor .btn')).map((x) => x.getAttribute('aria-label') || '').join(''),
        unit: document.querySelector('.set-reps-editor .set-weight-unit').textContent, key: t('units.reps'), dir: document.documentElement.dir })`);
      check(lang + ': reps button and editor translated', r.unit === r.key && !/setReps\.|setWeight\./.test(r.note + r.aria + r.title + r.ed), r);
      const per = await p.eval(`(() => { const d = document.createElement('div'); d.innerHTML = shareCardHtml(${J(old)}, 'msg', 1); return d.innerText.includes(tPlural('unilateral.setsPerSide', 2)) && !/unilateral\./.test(d.innerText); })()`);
      check(lang + ': per-side card text translated', per);
      if (lang === 'ar') {
        check('ar: right-to-left', r.dir === 'rtl');
        const s2 = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'workout-ar.png'), Buffer.from(s2.data, 'base64'));
      }
      await p.eval(`(closeSetWeightEditor(), true)`);
    }
    await p.eval(`(setLang('en'), true)`);

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
