'use strict';
/* Gym-Lift — plate calculator (gym-basics, task 1), in real headless Chrome. No accounts, no network.

     node tests/app/plates.js

   Checks: platePlan / roundToPlates maths; the "Plates" button on barbell and custom rows but not
   on assisted rows; the sheet opens with the working weight; bar change is live and persists;
   plate settings are synced (not device-only); 6 languages; RTL; 390 px light + dark. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-plates');
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
  const b = new Browser('plates-' + Date.now().toString(36), 9873, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);

    console.log('== maths');
    const plan = (target, cfg) => p.eval(`platePlan(${target}, ${cfg || 'PLATE_DEFAULT'})`);
    let r = await plan(100);
    check('100 → [25,15], total 100, exact', J(r) === J({ perSide: [25, 15], total: 100, exact: true }), r);
    r = await plan(101);
    check('101 → total 100, not exact', r.total === 100 && r.exact === false, r);
    r = await plan(61.25);
    check('61.25 → total 60, not exact', r.total === 60 && r.exact === false, r);
    r = await plan(15);
    check('15 (< bar) → total 20, not exact, no plates', r.total === 20 && r.exact === false && r.perSide.length === 0, r);
    r = await plan(140, `{ bar: 20, plates: PLATE_DEFAULT.plates, pairs: { '25': 1, '20': 0 } }`);
    check('pairs {25:1, 20:0}: 140 → [25,15,10,5,2.5,1.25], total 137.5', J(r.perSide) === J([25, 15, 10, 5, 2.5, 1.25]) && r.total === 137.5, r);
    r = await plan(200);
    check('unlimited pairs: 200 → 4 × 25 kg-ish stack, exact', r.exact && r.total === 200 && J(r.perSide) === J([25, 25, 25, 15]), r);
    check('roundToPlates(101) = 100; roundToPlates(10) = 0; roundToPlates(20) = 20',
      (await p.eval(`[roundToPlates(101, PLATE_DEFAULT), roundToPlates(10, PLATE_DEFAULT), roundToPlates(20, PLATE_DEFAULT)]`)).join() === '100,0,20');
    check('plateSettings() falls back to the default and is always valid', J(await p.eval(`(() => { delete state.settings.plates; return plateSettings(); })()`)) === J({ bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }));
    check('a corrupt stored value never throws and falls back', await p.eval(`(() => { state.settings.plates = { bar: 'x', plates: 5 }; const s = plateSettings(); delete state.settings.plates; return s.bar === 20; })()`));
    check('backfillState deletes invalid plates', await p.eval(`(() => { state.settings.plates = 'junk'; backfillState(); return !('plates' in state.settings); })()`));
    check('plates are synced (not in DEVICE_SETTING_KEYS)', !(await p.eval(`DEVICE_SETTING_KEYS.includes('plates')`)));

    console.log('== button');
    await p.eval(`(() => {
      state.plans['ptest'] = { id: 'ptest', builtin: false, customName: 'Plate test', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 82.5 },
          { id: 'cx-p1', name: 'Curl test', sets: 3, reps: 10, weight: 30 },
          { id: 'cx-p2', name: 'Assisted test', sets: 3, reps: 8, weight: 20, assisted: true },
          { id: 'lateral-raises', name: 'Raises', sets: 3, reps: 12, weight: 8 }] };
      if (!state.planOrder.includes('ptest')) state.planOrder.push('ptest');
      selectedPlan = 'ptest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    const has = (i) => p.eval(`!!document.querySelectorAll('#exercise-list .exercise')[${i}].querySelector('.ex-mini .btn-plates')`);
    check('bench press (library barbell) has the button', await has(0));
    check('custom Curl test has the button', await has(1));
    check('assisted row has no button', !(await has(2)));
    check('dumbbell library exercise has no button', !(await has(3)));
    check('button label is translated', (await p.eval(`document.querySelector('.btn-plates').textContent`)) === 'Plates');

    console.log('== sheet');
    await p.eval(`(document.querySelector('.btn-plates').click(), true)`);
    await wait(200);
    check('sheet opens', await p.eval(`!document.getElementById('modal-plates').hidden`));
    check('target prefilled with 82.5', (await p.eval(`document.getElementById('plate-target').value`)) === '82.5');
    check('per-side text is "25 · 5 · 1.25"', (await p.eval(`document.getElementById('plate-per-side').textContent`)) === '25 · 5 · 1.25');
    check('exact result says so', (await p.eval(`document.getElementById('plate-closest').textContent`)) === 'Exact: 82.5 kg');
    check('drawing has a bar and 3 discs', await p.eval(`document.querySelectorAll('#plate-draw .plate-disc').length === 3 && document.querySelectorAll('#plate-draw .plate-bar').length === 1`));
    await p.eval(`(() => { const i = document.getElementById('plate-target'); i.value = '83'; i.dispatchEvent(new Event('input')); return true; })()`);
    check('inexact target shows the closest possible weight', (await p.eval(`document.getElementById('plate-closest').textContent`)) === 'Closest possible: 82.5 kg');
    await p.eval(`(document.querySelector('#plate-bars [data-bar="15"]').click(), true)`);
    check('changing the bar to 15 updates the result live', (await p.eval(`document.getElementById('plate-per-side').textContent`)) === '25 · 5 · 2.5 · 1.25' && (await p.eval(`document.getElementById('plate-closest').textContent`)) === 'Closest possible: 82.5 kg', await p.eval(`document.getElementById('plate-per-side').textContent`));
    check('the 15 chip is pressed', await p.eval(`document.querySelector('#plate-bars [data-bar="15"]').getAttribute('aria-pressed') === 'true'`));
    await p.eval(`(document.querySelector('#plate-toggles [data-kg="25"]').click(), true)`);
    check('toggling a plate off excludes it', (await p.eval(`document.getElementById('plate-per-side').textContent`)).split(' · ')[0] === '20' && !(await p.eval(`plateSettings().plates.includes(25)`)));
    await p.eval(`(document.querySelector('#plate-toggles [data-kg="25"]').click(), true)`);
    await p.reload();
    await p.eval(`(selectedPlan = 'ptest', switchTab('trening'), renderTrening(), true)`); await wait(300);
    check('bar 15 persists after a reload (state.settings.plates.bar)', (await p.eval(`state.settings.plates && state.settings.plates.bar`)) === 15, await p.eval(`state.settings.plates`));
    check('the sheet is closed after the reload', await p.eval(`document.getElementById('modal-plates').hidden`));
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[1].querySelector('.btn-plates').click(), true)`);
    const cv = await p.eval(`({ w: document.getElementById('plate-target').value, bar: document.querySelector('#plate-bars [data-bar="15"]').classList.contains('active') })`);
    check('custom row opens with its weight (30) and the saved bar', cv.w === '30' && cv.bar, cv);
    await p.eval(`(document.getElementById('btn-plates-close').click(), true)`);
    check('close button closes the sheet', await p.eval(`document.getElementById('modal-plates').hidden`));
    check('Back closes the sheet', await p.eval(`(openPlateCalc(60), nativeBack() === 'closed' && document.getElementById('modal-plates').hidden)`));

    console.log('== languages / layout');
    await p.eval(`(state.settings.plates = { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }, true)`);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), openPlateCalc(82.5), true)`);
      const x = await p.eval(`({ title: document.querySelector('#modal-plates h3').textContent, want: t('plates.title'), closest: document.getElementById('plate-closest').textContent,
        dir: document.documentElement.dir, miss: Object.keys(I18N.en).filter((k) => k.startsWith('plates.') && I18N[${J(lang)}][k] === undefined) })`);
      check(lang + ': sheet title translated, no missing plates.* key', x.title === x.want && !/plates\./.test(x.title + x.closest) && x.miss.length === 0, x);
      if (lang === 'ar') check('ar: right-to-left', x.dir === 'rtl');
      await p.eval(`(closePlateCalc(), true)`);
    }
    await p.eval(`(setLang('en'), true)`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), openPlateCalc(187.5), true)`);
      await wait(250);
      check('390 px ' + theme + ': no horizontal overflow', await p.eval(`document.documentElement.scrollWidth <= innerWidth + 1 && (() => { const m = document.querySelector('#modal-plates .modal'); return m.scrollWidth <= m.clientWidth + 1; })()`));
      const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'plates-' + theme + '.png'), Buffer.from(s.data, 'base64'));
      await p.eval(`(closePlateCalc(), true)`);
    }
    await p.eval(`(document.documentElement.removeAttribute('data-theme'), true)`);
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
