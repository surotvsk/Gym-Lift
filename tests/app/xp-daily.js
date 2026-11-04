'use strict';
/* GymQuest — nové XP a denný limit (v101, spec §4.1) v reálnom headless Chrome, bez účtov a siete.

     GQ_TEST_PORT=8190 node tests/app/xp-daily.js

   Checks: 15 sérií = 60 XP pre 1. a 2. tréning dňa, 3. = 0 (uložený so všetkými sériami); < 3 série = 0;
   aktivita 45 min = 22, 3. aktivita dňa = 0; tréning po polnoci patrí novému dňu; štítok Dokončiť = uložené xp;
   limit vysvetľuje okno "Save workout?" (6 jazykov); uložené xp sa nikdy neprepočíta (vrátenie 2. tréningu
   nezmení 3.; úprava histórie nechá xp). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-xpdaily');
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
  const b = new Browser('xpd-' + Date.now().toString(36), 9893, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const $ = (id) => `document.getElementById(${J(id)})`;
  /* Dokončí n sérií v pláne 'xtest' (5 cvikov x 3 série) a cez UI uloží tréning; vráti { label, xp, sets }. */
  const runWorkout = async (n, day) => {
    await p.eval(`(() => {
      todayISO = () => ${J(day)};
      state.plans['xtest'] = { id: 'xtest', builtin: false, customName: 'XP test', location: null,
        exercises: [1, 2, 3, 4, 5].map((k) => ({ id: 'cx-x' + k, name: 'Move ' + k, sets: 3, reps: 10, weight: 20 })) };
      if (!state.planOrder.includes('xtest')) state.planOrder.push('xtest');
      selectedPlan = 'xtest'; ensureSession(); saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    await p.eval(`(() => { let left = ${n};
      document.querySelectorAll('#exercise-list .exercise').forEach((ex) => ex.querySelectorAll('.set-btn').forEach((bt) => { if (left > 0) { bt.click(); left--; } }));
      return true; })()`);
    await wait(200);
    const done = await p.eval(`totalSetsDone()`);
    const label = await p.eval(`${$('tr-finish-xp')}.textContent`);
    await p.eval(`(${$('btn-finish-workout')}.click(), true)`);
    const text = await p.eval(`${$('confirm-text')}.textContent`);
    await p.eval(`(${$('btn-confirm-ok')}.click(), true)`);
    await wait(300);
    await p.eval(`(() => { const m = ${$('modal-result')}; if (m && !m.hidden) m.hidden = true; return true; })()`);
    const last = JSON.parse(await p.eval(`JSON.stringify(state.history[state.history.length - 1])`));
    return { done, label: parseInt(label.replace(/[^0-9]/g, ''), 10), text, xp: last.xp, sets: last.exercises.reduce((s, e) => s + e.setsDone, 0), id: last.id };
  };
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); state.history = []; state.activities = []; return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 700, deviceScaleFactor: 2, mobile: true });

    console.log('== Workouts');
    const w1 = await runWorkout(15, '2031-03-10');
    check('1st workout, 15 sets = 60 XP (label = saved)', w1.done === 15 && w1.xp === 60 && w1.label === 60 && /\+60 XP/.test(w1.text) && !/without XP/.test(w1.text), w1);
    const w2 = await runWorkout(15, '2031-03-10');
    check('2nd workout same day = 60 XP', w2.xp === 60 && w2.label === 60, w2);
    const w3 = await runWorkout(15, '2031-03-10');
    check('3rd workout same day = 0 XP, label +0, sheet explains, all sets saved', w3.xp === 0 && w3.label === 0 && /\+0 XP/.test(w3.text) && /saved without XP/.test(w3.text) && w3.sets === 15, w3);
    const w4 = await runWorkout(15, '2031-03-11');
    check('workout after midnight counts for the new day = 60 XP', w4.xp === 60, w4);
    const w5 = await runWorkout(2, '2031-03-12');
    check('< 3 sets = 0 XP, no limit text', w5.xp === 0 && w5.label === 0 && !/without XP/.test(w5.text), w5);
    const w6 = await runWorkout(2, '2031-03-12');
    const w7 = await runWorkout(15, '2031-03-12');
    check('0-XP workouts do not use up the limit', w7.xp === 60, [w6, w7]);

    console.log('== Stored xp is never recomputed');
    await p.eval(`(() => { state.history = state.history.filter((w) => w.id !== ${J(w2.id)}); recalculateAll(); saveState(); return true; })()`);
    check('undoing/removing the 2nd workout leaves the 3rd at 0', (await p.eval(`state.history.find((w) => w.id === ${J(w3.id)}).xp`)) === 0);
    await p.eval(`(() => { const w = state.history.find((x) => x.id === ${J(w1.id)}); w.xp = 99; recalculateAll(); saveState(); return true; })()`);
    check('recalculateAll keeps stored xp', (await p.eval(`state.history.find((x) => x.id === ${J(w1.id)}).xp`)) === 99);

    console.log('== Activities');
    const addAct = async (min, day) => {
      await p.eval(`(() => { openManualActivity(); const set = (id, v) => { document.getElementById(id).value = v; };
        set('act-h-h', ${Math.floor(min / 60)}); set('act-h-m', ${min % 60}); set('act-h-s', '0'); set('act-h-date', ${J(day)});
        saveManualActivity(); return true; })()`);
      await wait(150);
      await p.eval(`(() => { const m = ${$('modal-result')}; if (m && !m.hidden) m.hidden = true; return true; })()`);
      return p.eval(`state.activities[state.activities.length - 1].xp`);
    };
    const a1 = await addAct(45, '2031-04-01'), a2 = await addAct(45, '2031-04-01'), a3 = await addAct(45, '2031-04-01');
    check('activity of 45 min = 22 XP (twice), 3rd that day = 0', a1 === 22 && a2 === 22 && a3 === 0, [a1, a2, a3]);
    const a4 = await addAct(5, '2031-04-02'), a5 = await addAct(120, '2031-04-02');
    check('activity under 10 min = 0, 120 min = 30 (cap)', a4 === 0 && a5 === 30, [a4, a5]);
    check('activities do not use up the workout limit', (await p.eval(`xpForNewWorkout(15, '2031-04-01')`)) === 60);

    console.log('== Limit text in 6 languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      const v = await p.eval(`(setLang(${J(lang)}), t('xp.dailyLimit'))`);
      check('xp.dailyLimit exists in ' + lang, v && v !== 'xp.dailyLimit', v);
    }
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
