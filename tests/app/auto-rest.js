'use strict';
/* Gym-Lift — "Start rest automatically" (gym-basics, task 5), in real headless Chrome.
   No accounts and no network: the app runs with empty Community config.

     node tests/app/auto-rest.js

   Checks: off by default; on → first preset (60 s); remembers the last started preset; superset → only
   after the last member; unilateral → only after the last side; un-marking never starts; a running timer
   is not restarted; device-only keys (sync content hash unchanged); switch in Settings under the
   rest-sound card; 6 languages, RTL, no console errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-auto-rest');
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
  const b = new Browser('autorest-' + Date.now().toString(36), 9875, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    const setup = (group) => p.eval(`(() => {
      state.plans['artest'] = { id: 'artest', builtin: false, customName: 'Auto rest test', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100${group ? ", group: 'gx'" : ''} },
          { id: 'dumbbell-row', name: 'DB row', sets: 3, reps: 10, weight: 30${group ? ", group: 'gx'" : ''} },
          { id: 'cx-ar1', name: 'One-arm test', sets: 2, reps: 10, weight: 20, unilateral: true, startSide: 'left' }] };
      if (!state.planOrder.includes('artest')) state.planOrder.push('artest');
      selectedPlan = 'artest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await setup(false);
    await wait(300);
    const exEl = (i) => `document.querySelectorAll('#exercise-list .exercise')[${i}]`;
    const sets = (i) => `${exEl(i)}.querySelectorAll('.set-item:not(.drop-item)')`;
    const tick = (i, n) => p.eval(`(${sets(i)}[${n}].querySelector('.set-btn').click(), true)`);
    const running = () => p.eval(`timerInterval !== null && !document.getElementById('timer-bar').hidden`);
    const secs = () => p.eval(`Math.round(timerTotalMs / 1000)`);
    const reset = () => p.eval(`(() => { stopTimer(); return true; })()`);
    const setAuto = (v) => p.eval(`(state.settings.autoRest = ${v}, true)`);

    console.log('== default: off');
    check('setting is off by default', await p.eval(`state.settings.autoRest !== true`));
    await tick(0, 0);
    check('marking a set starts no timer', !(await running()));
    check('timer bar stays hidden', await p.eval(`document.getElementById('timer-bar').hidden === true`));
    check('switch is off in Settings', await p.eval(`document.getElementById('btn-auto-rest').getAttribute('aria-checked') === 'false'`));
    check('the card sits under the rest-sound card and before effort', await p.eval(`(() => { const a = document.getElementById('btn-rest-sound'), s = document.getElementById('btn-auto-rest'), e = document.getElementById('effort-chips');
      return !!(a.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(s.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING); })()`));
    check('autoRest and lastRestPresetId are device settings', await p.eval(`DEVICE_SETTING_KEYS.includes('autoRest') && DEVICE_SETTING_KEYS.includes('lastRestPresetId')`));

    console.log('== on: ungrouped row');
    await p.eval(`(document.getElementById('btn-auto-rest').click(), true)`);
    check('the switch turns autoRest on', await p.eval(`state.settings.autoRest === true && document.getElementById('btn-auto-rest').getAttribute('aria-checked') === 'true'`));
    await tick(0, 1);
    check('marking a set starts the first preset (60 s)', (await running()) && (await secs()) === 60, await secs());
    const ids = await p.eval(`restPresets().map((x) => x.id + ':' + x.seconds)`);
    console.log('  presets ' + J(ids));
    console.log('== running timer is not restarted');
    await p.eval(`(timerEnd -= 20000, true)`);
    const endBefore = await p.eval(`timerEnd`);
    await tick(0, 2);
    check('a running timer is left alone', (await p.eval(`timerEnd`)) === endBefore);
    await reset();

    console.log('== un-mark never starts');
    await tick(0, 2);   // un-mark set 3
    check('un-marking starts nothing', !(await running()));
    await tick(0, 2);   // mark again → starts
    check('marking again starts the timer', await running());
    await reset();

    console.log('== remembers the last preset');
    await p.eval(`(() => { const x = restPresets().find((q) => q.seconds === 90); startTimer(x.seconds, x.id); return true; })()`);
    check('starting the 90 s preset stores lastRestPresetId', await p.eval(`state.settings.lastRestPresetId === restPresets().find((q) => q.seconds === 90).id`));
    await reset();
    await tick(0, 2);   // un-mark
    await tick(0, 2);   // mark
    check('next auto start uses 90 s', (await running()) && (await secs()) === 90, await secs());
    await reset();
    await p.eval(`(state.settings.lastRestPresetId = 'gone', true)`);
    await tick(0, 2); await tick(0, 2);
    check('unknown remembered preset falls back to the first', (await secs()) === 60, await secs());
    await reset();
    check('a custom start without preset id keeps the remembered id', await p.eval(`(() => { const id = state.settings.lastRestPresetId; startTimer(45); const same = state.settings.lastRestPresetId === id; stopTimer(); return same; })()`));

    console.log('== unilateral: only after the last side');
    await reset();
    // set 1 left (rows: 1L, 1R, 2L, 2R)
    const uni = await p.eval(`${sets(2)}.length`);
    check('unilateral row has 4 side rows', uni === 4, uni);
    await tick(2, 0);
    check('first side done: no rest', !(await running()));
    await tick(2, 1);
    check('second side done: rest starts', await running());
    await reset();
    await tick(2, 1);   // un-mark right side
    check('un-marking the right side starts nothing', !(await running()));
    await reset();

    console.log('== superset');
    await setup(true);
    await wait(300);
    await tick(0, 0);
    check('member 1 done: no rest', !(await running()));
    await tick(1, 0);
    check('member 2 (last) done: rest starts', await running());
    await reset();

    console.log('== off again / no session');
    await setAuto(false);
    await tick(1, 1);
    check('off: nothing starts', !(await running()));
    await setAuto(true);
    check('maybeAutoRest without a session starts nothing', await p.eval(`(() => { const s = getSession; window.__gs = s; getSession = () => null; maybeAutoRest(currentPlan() || getPlan(selectedPlan), 0); getSession = window.__gs; return timerInterval === null; })()`));

    console.log('== sync: device-only');
    const h0 = await p.eval(`syncLocalPayloadHash()`);
    await p.eval(`(() => { state.settings.autoRest = !state.settings.autoRest; state.settings.lastRestPresetId = 'zzz'; return true; })()`);
    const h1 = await p.eval(`syncLocalPayloadHash()`);
    check('toggling autoRest / lastRestPresetId does not change the uploaded content hash', h0 === h1, [h0, h1]);
    await p.eval(`(state.settings.effort = 'rpe', true)`);
    const h2 = await p.eval(`syncLocalPayloadHash()`);
    check('control: a synced setting does change it', h2 !== h1);
    await p.eval(`(state.settings.effort = 'off', true)`);
    check('the keys are in the device-settings blob', await p.eval(`(() => { saveState(); const d = JSON.parse(localStorage.getItem(DEVICE_SETTINGS_KEY)); return 'autoRest' in d && 'lastRestPresetId' in d; })()`));
    await p.eval(`(state.settings.autoRest = true, saveState(), true)`);
    await p.navigate(BASE);
    await wait(300);
    check('autoRest survives a reload', await p.eval(`state.settings.autoRest === true && document.getElementById('btn-auto-rest').getAttribute('aria-checked') === 'true'`));

    console.log('== languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), true)`);
      const x = await p.eval(`(() => ({ title: document.querySelector('[data-i18n="settings.autoRest"]').textContent, hint: document.querySelector('[data-i18n="settings.autoRestHint"]').textContent,
        state: document.getElementById('auto-rest-state').textContent, dir: document.documentElement.dir,
        miss: Object.keys(I18N.en).filter((k) => k.startsWith('settings.autoRest') && I18N[${J(lang)}][k] === undefined) }))()`);
      check(lang + ': auto-rest texts translated', !/settings\./.test(x.title + x.hint) && x.title.length > 0 && x.hint.length > 0 && x.miss.length === 0, x);
      if (lang === 'ar') check('ar: right-to-left', x.dir === 'rtl');
    }
    await p.eval(`(setLang('en'), true)`);
    check('verifyI18n: nothing missing', await p.eval(`LANG_CODES.every((l) => Object.keys(I18N.en).filter((k) => /^settings\\.autoRest/.test(k) && I18N[l][k] === undefined).length === 0)`));

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
