'use strict';
/* GymQuest — clear buttons in the reset / undo / delete workout confirmations (v71), in real
   headless Chrome. No accounts and no network (empty Community config).

     node tests/app/confirm-labels.js

   Before v71 these dialogs showed "Cancel" on BOTH buttons. Checks: Reset workout? →
   "Reset workout" / "Back to workout"; Undo workout? → "Undo this workout" / "Keep workout";
   Delete workout? → "Delete" / "Keep workout"; the two buttons always differ; the second button
   keeps everything, the first one does the action; other dialogs still say "Cancel";
   6 languages; RTL; 390 px. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-confirm');
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
  const b = new Browser('confirm-' + Date.now().toString(36), 9873, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const dialog = () => p.eval(`({ open: !document.getElementById('modal-generic').hidden, title: document.getElementById('generic-title').textContent,
    ok: document.getElementById('btn-generic-ok').textContent, cancel: document.getElementById('btn-generic-cancel').textContent })`);
  const markSet = () => p.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-btn')[0].click(), true)`);
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.eval(`(() => {
      state.plans['ctest'] = { id: 'ctest', builtin: false, customName: 'Confirm test', location: null,
        exercises: [{ id: 'cx-c1', name: 'Press test', sets: 3, reps: 10, weight: 40 }] };
      if (!state.planOrder.includes('ctest')) state.planOrder.push('ctest');
      selectedPlan = 'ctest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);

    console.log('== Reset workout?');
    await markSet();
    await p.eval(`(document.getElementById('btn-reset-session').click(), true)`);
    let d = await dialog();
    check('the dialog opens with title "Reset workout?"', d.open && d.title === 'Reset workout?', d);
    check('orange button: "Reset workout"; other button: "Back to workout" (not "Cancel" twice)', d.ok === 'Reset workout' && d.cancel === 'Back to workout' && d.ok !== d.cancel, d);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await wait(300);
    let s = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(WORK, 'shots', 'reset-390.png'), Buffer.from(s.data, 'base64'));
    check('390 px: both buttons fit side by side without overflow', await p.eval(`(() => { const a = document.getElementById('btn-generic-ok'), c = document.getElementById('btn-generic-cancel'); const m = document.querySelector('#modal-generic .modal'); return a.scrollWidth <= a.clientWidth + 1 && c.scrollWidth <= c.clientWidth + 1 && m.scrollWidth <= m.clientWidth + 1; })()`));
    await p.c.send('Emulation.clearDeviceMetricsOverride');
    await p.eval(`(document.getElementById('btn-generic-cancel').click(), true)`);
    await wait(200);
    check('"Back to workout" closes the dialog and keeps the workout (marked set still there)', !(await dialog()).open && (await p.eval(`!!getSession() && totalSetsDone() === 1`)));
    await p.eval(`(document.getElementById('btn-reset-session').click(), true)`);
    await p.eval(`(document.getElementById('btn-generic-ok').click(), true)`);
    await wait(200);
    check('"Reset workout" clears the workout (no session, no marked sets)', !(await dialog()).open && (await p.eval(`getSession() === null && totalSetsDone() === 0`)));
    check('resetting writes nothing to history', (await p.eval(`state.history.filter((w) => w.planId === 'ctest').length`)) === 0);

    console.log('== Undo workout? (after finishing)');
    await markSet();
    await p.eval(`(finishWorkout(), confirmFinish(), true)`);
    await wait(300);
    const hist = () => p.eval(`state.history.filter((w) => w.planId === 'ctest').length`);
    check('the workout is saved', (await hist()) === 1);
    await p.eval(`(document.getElementById('btn-result-undo').click(), true)`);
    d = await dialog();
    check('Undo: "Undo this workout" / "Keep workout"', d.open && d.title === 'Undo workout?' && d.ok === 'Undo this workout' && d.cancel === 'Keep workout', d);
    await p.eval(`(document.getElementById('btn-generic-cancel').click(), true)`);
    check('"Keep workout" keeps it in history', (await hist()) === 1);
    await p.eval(`(document.getElementById('btn-result-undo').click(), document.getElementById('btn-generic-ok').click(), true)`);
    await wait(200);
    check('"Undo this workout" removes it', (await hist()) === 0);

    console.log('== Delete workout? (Progress history)');
    await p.eval(`(() => { switchTab('trening'); selectedPlan = 'ctest'; renderTrening(); return true; })()`);
    await markSet();
    await p.eval(`(finishWorkout(), confirmFinish(), document.getElementById('modal-result').hidden = true, true)`);
    await wait(300);
    const id = await p.eval(`state.history.filter((w) => w.planId === 'ctest')[0].id`);
    await p.eval(`(switchTab('pokrok'), renderPokrok(), true)`);
    await wait(300);
    await p.eval(`(requestDeleteWorkout(${J(id)}), true)`);
    d = await dialog();
    check('Delete: "Delete" / "Keep workout"', d.open && d.title === 'Delete workout?' && d.ok === 'Delete' && d.cancel === 'Keep workout', d);
    await p.eval(`(document.getElementById('btn-generic-cancel').click(), true)`);
    check('"Keep workout" keeps it', (await hist()) === 1);
    const delBtns = await p.eval(`document.querySelectorAll('[data-action="delete"]').length`);
    check('the history list has delete buttons', delBtns >= 1, delBtns);
    await p.eval(`(document.querySelectorAll('[data-action="delete"]')[0].click(), true)`);
    d = await dialog();
    check('the real 🗑 button opens the same clear dialog', d.ok === 'Delete' && d.cancel === 'Keep workout', d);
    await p.eval(`(document.getElementById('btn-generic-ok').click(), true)`);
    await wait(200);
    check('"Delete" deletes it', (await hist()) === 0);

    console.log('== other dialogs still say "Cancel"');
    await p.eval(`(showGeneric('Some other question', t('common.ok'), null, ''), true)`);
    d = await dialog();
    check('a later dialog without its own label shows "Cancel" again', d.cancel === 'Cancel' && d.ok === 'OK', d);
    await p.eval(`(closeGeneric(), true)`);

    console.log('== languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('trening'), selectedPlan = 'ctest', renderTrening(), true)`);
      await markSet();
      await p.eval(`(document.getElementById('btn-reset-session').click(), true)`);
      const r1 = await dialog();
      const keys = await p.eval(`({ ok: t('trening.resetSession'), cancel: t('trening.backToWorkout'), keep: t('history.keepWorkout'), undo: t('trening.undo'), del: t('common.delete'), dir: document.documentElement.dir })`);
      check(lang + ': reset dialog buttons translated and different', r1.ok === keys.ok && r1.cancel === keys.cancel && r1.ok !== r1.cancel && !/\./.test(r1.ok + r1.cancel), { r1, keys });
      if (lang === 'ar') {
        check('ar: right-to-left', keys.dir === 'rtl');
        const s2 = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'reset-ar.png'), Buffer.from(s2.data, 'base64'));
      }
      await p.eval(`(document.getElementById('btn-generic-ok').click(), true)`);
      check(lang + ': undo/delete labels translated', keys.keep !== 'history.keepWorkout' && keys.undo !== keys.keep && keys.del !== keys.keep);
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
