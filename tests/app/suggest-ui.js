'use strict';
/* Gym-Lift — suggestion chip, "why" sheet and "Show suggestions" setting (gym-basics phase 4, task 2),
   in real headless Chrome. No accounts, no network.

     node tests/app/suggest-ui.js

   The chip lives INSIDE .compare-hint (no new row, tile height unchanged). Tapping it opens a sheet with the
   reason and a "Use" button; Use sets only the NOT-done sets of the running session. Setting is device-only,
   default on. Sheet standard: dialog role, Escape chain, focus, Android Back. 6 languages, RTL, 390 px. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-suggest-ui');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('suggestui-' + Date.now().toString(36), 9876, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    /* Plán 'sg': bench 3×5×100 (história: všetko splnené), nový cvik bez histórie, jednostranný cvik s históriou. */
    const setup = () => p.eval(`(() => {
      const d = (n) => localDateKey(addDays(new Date(), -n));
      state.plans.sg = { id: 'sg', builtin: false, customName: 'Suggest UI', location: null, exercises: [
        { id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100 },
        { id: 'cx-new', name: 'Brand new lift', sets: 3, reps: 8, weight: 20 },
        { id: 'cx-uni', name: 'One-arm test', sets: 2, reps: 10, weight: 20, unilateral: true, startSide: 'left' }] };
      if (!state.planOrder.includes('sg')) state.planOrder.push('sg');
      state.history = [{ id: 'hs1', week: weekKey(addDays(new Date(), -3)), date: d(3), planId: 'sg', planName: 'Suggest UI', note: '', durationSeconds: 3000, exercises: [
        { name: 'Bench', exId: 'bench-press', sets: 3, reps: 5, weight: 100, setsDone: 3 },
        { name: 'One-arm test', exId: 'cx-uni', sets: 2, reps: 10, weight: 20, setsDone: 4, unilateral: true, sidesDone: { left: [1, 2], right: [1, 2] } }] }];
      state.activeSession = null;
      state.settings.showSuggestions = undefined;
      recalculateAll(); selectedPlan = 'sg'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await setup();
    await wait(300);
    const exEl = (i) => `document.querySelectorAll('#exercise-list .exercise')[${i}]`;
    const chipOf = (i) => p.eval(`(() => { const c = ${exEl(i)}.querySelector('.compare-hint .sugg-chip'); return c ? c.textContent.trim() : null; })()`);
    const weights = (i) => p.eval(`Array.from(${exEl(i)}.querySelectorAll('input.set-weight')).map((x) => x.value)`);
    const tick = (i, n) => p.eval(`(${exEl(i)}.querySelectorAll('.set-item:not(.drop-item)')[${n}].querySelector('.set-btn').click(), true)`);
    const tileH = (i) => p.eval(`${exEl(i)}.getBoundingClientRect().height`);

    console.log('== not running: no chip');
    check('no workout yet: no chip on any tile', (await chipOf(0)) === null && (await chipOf(1)) === null);
    await tick(0, 0);
    await wait(300);
    check('first tap starts the workout', !!(await p.eval('getSession()')));

    console.log('== chip in a running session');
    check('bench shows "Try 102.5 kg"', (await chipOf(0)) === 'Try 102.5 kg', await chipOf(0));
    check('a new exercise (no history) has no chip', (await chipOf(1)) === null);
    check('chip is a button inside .compare-hint, no extra row (hint stays first child)', await p.eval(`(() => { const t = ${exEl(0)}; const c = t.querySelector('.compare-hint .sugg-chip'); return !!c && c.tagName === 'BUTTON' && t.firstElementChild.classList.contains('compare-hint') && t.querySelectorAll('.sugg-chip').length === 1; })()`));
    check('the comparison text is still in the hint', await p.eval(`${exEl(0)}.querySelector('.compare-hint').textContent.length > 'Try 102.5 kg'.length`));
    const hit = await p.eval(`(() => { const c = ${exEl(0)}.querySelector('.sugg-chip'); const r = c.getBoundingClientRect(); const x = r.left + r.width / 2; const out = {}; for (const dy of [-20, 20]) { const e = document.elementFromPoint(x, r.top + r.height / 2 + dy); out[dy] = e === c ? 'chip' : (e && (e.className || e.tagName)); } out.h = r.height; return out; })()`);
    check('tap area is at least 44 px tall (hit test 20 px above and below the chip centre)', hit[-20] === 'chip' && hit[20] === 'chip', hit);
    const hWith = await tileH(0);
    check('chip has an accessible name', await p.eval(`(() => { const c = ${exEl(0)}.querySelector('.sugg-chip'); return (c.getAttribute('aria-label') || c.textContent).length > 3 && c.getAttribute('aria-haspopup') === 'dialog'; })()`));

    console.log('== clean UI: tile height unchanged with versus without the chip');
    await p.eval(`(state.settings.showSuggestions = false, renderTrening(), true)`);
    await wait(200);
    const hWithout = await tileH(0);
    check('tile height with chip == without chip (' + hWith + ' vs ' + hWithout + ')', Math.abs(hWith - hWithout) < 0.5, [hWith, hWithout]);
    check('setting off: no chip', (await chipOf(0)) === null);
    await p.eval(`(state.settings.showSuggestions = undefined, renderTrening(), true)`);
    await wait(200);
    check('undefined means on (default)', (await chipOf(0)) === 'Try 102.5 kg');

    console.log('== why sheet');
    await p.eval(`(${exEl(0)}.querySelector('.sugg-chip').focus(), ${exEl(0)}.querySelector('.sugg-chip').click(), true)`);
    await wait(200);
    check('sheet opens with role dialog, aria-modal and a title', await p.eval(`(() => { const m = document.getElementById('modal-suggest'); const d = m.querySelector('[role=dialog]'); return !m.hidden && !!d && d.getAttribute('aria-modal') === 'true' && !!document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim(); })()`));
    check('sheet shows the reason sentence', await p.eval(`document.getElementById('suggest-text').textContent === t('suggest.up', { kg: 102.5, reps: 5 })`), await p.eval(`document.getElementById('suggest-text').textContent`));
    check('"Use 102.5 kg" button and a close button', await p.eval(`document.getElementById('btn-suggest-use').textContent.trim() === 'Use 102.5 kg' && !!document.getElementById('btn-suggest-close')`));
    check('focus moves into the sheet', await p.eval(`document.getElementById('modal-suggest').contains(document.activeElement)`));
    check('targets are >= 44 px', await p.eval(`['btn-suggest-use', 'btn-suggest-close'].every((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.height >= 43.5 && r.width >= 43.5; })`));
    check('nothing changed yet (never automatic)', J(await weights(0)) === J(['100', '100', '100']), await weights(0));
    await p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
    check('Escape closes the sheet', await p.eval(`document.getElementById('modal-suggest').hidden`));
    check('focus returns to the chip', await p.eval(`document.activeElement === ${exEl(0)}.querySelector('.sugg-chip')`));
    check('Escape chain: generic confirm stays above the sheet', await p.eval(`(() => {
      ${exEl(0)}.querySelector('.sugg-chip').click();
      const g = document.getElementById('modal-generic'); g.hidden = false;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const ok = g.hidden && !document.getElementById('modal-suggest').hidden;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return ok && document.getElementById('modal-suggest').hidden; })()`));
    check('Android Back: modal-suggest is in NATIVE_BACK_CLOSE and isBusy while open', await p.eval(`(() => { const e = NATIVE_BACK_CLOSE.find((x) => x[0] === 'modal-suggest'); ${exEl(0)}.querySelector('.sugg-chip').click(); const busy = isBusy(); document.getElementById('btn-suggest-close').click(); return !!e && e[1] === '#btn-suggest-close' && busy && !isBusy() || (!!e && busy); })()`));
    check('backdrop tap closes the sheet', await p.eval(`(() => { ${exEl(0)}.querySelector('.sugg-chip').click(); const m = document.getElementById('modal-suggest'); m.click(); return m.hidden; })()`));

    console.log('== Use');
    await p.eval(`(${exEl(0)}.querySelector('.sugg-chip').click(), document.getElementById('btn-suggest-use').click(), true)`);
    await wait(300);
    check('sheet closed after Use', await p.eval(`document.getElementById('modal-suggest').hidden`));
    check('done set stays 100, not-done sets become 102.5', J(await weights(0)) === J(['100', '102.5', '102.5']), await weights(0));
    check('the plan row weight is unchanged', (await p.eval(`state.plans.sg.exercises[0].weight`)) === 100);
    check('chip disappears once the sets match the suggestion', (await chipOf(0)) === null);

    console.log('== all done: hidden');
    await p.eval(`(state.activeSession.setWeights = {}, state.activeSession.setWeightLocks = {}, renderTrening(), true)`);
    await wait(200);
    check('chip is back after weights reset', (await chipOf(0)) === 'Try 102.5 kg', await chipOf(0));
    await tick(0, 1); await tick(0, 2);
    await wait(200);
    check('all sets done: chip hidden', (await chipOf(0)) === null);

    console.log('== unilateral: per side');
    check('one-arm tile shows a chip', (await chipOf(2)) !== null, await chipOf(2));
    await p.eval(`(${exEl(2)}.querySelector('.sugg-chip').click(), document.getElementById('btn-suggest-use').click(), true)`);
    await wait(300);
    const uniOk = await p.eval(`(() => { const ex = state.plans.sg.exercises[2]; const out = []; for (let i = 0; i < 2; i++) for (const s of ['left', 'right']) out.push(effectiveSetWeight(ex, i, s)); return out; })()`);
    check('every not-done slot (both sides) got the suggestion', uniOk.every((w) => w > 20) && uniOk.every((w) => w === uniOk[0]), uniOk);

    console.log('== sync: device-only');
    const h0 = await p.eval(`syncLocalPayloadHash()`);
    await p.eval(`(state.settings.showSuggestions = false, true)`);
    const h1 = await p.eval(`syncLocalPayloadHash()`);
    check('toggling showSuggestions does not change the uploaded content hash', h0 === h1, [h0, h1]);
    check('showSuggestions is in DEVICE_SETTING_KEYS', await p.eval(`DEVICE_SETTING_KEYS.includes('showSuggestions')`));
    check('control: a synced setting does change the hash', await p.eval(`(() => { const a = syncLocalPayloadHash(); state.settings.effort = state.settings.effort === 'rpe' ? 'off' : 'rpe'; const bb = syncLocalPayloadHash(); state.settings.effort = 'off'; return a !== bb; })()`));

    console.log('== settings switch');
    await p.eval(`(state.settings.showSuggestions = undefined, renderShowSuggestionsSetting(), true)`);
    check('switch is on by default', await p.eval(`document.getElementById('btn-show-suggestions').getAttribute('aria-checked') === 'true' && document.getElementById('show-suggestions-state').textContent === 'On'`));
    check('switch card is after the effort card', await p.eval(`(() => { const a = document.getElementById('set-effort-t').closest('section'); const s = document.getElementById('btn-show-suggestions').closest('section'); return a.nextElementSibling === s; })()`));
    await p.eval(`(document.getElementById('btn-show-suggestions').click(), true)`);
    check('tapping turns it off and saves it', await p.eval(`state.settings.showSuggestions === false && document.getElementById('btn-show-suggestions').getAttribute('aria-checked') === 'false'`));
    check('the device-settings blob carries it', await p.eval(`(() => { saveState(); return JSON.parse(localStorage.getItem(DEVICE_SETTINGS_KEY)).showSuggestions === false; })()`));
    await p.eval(`(document.getElementById('btn-show-suggestions').click(), true)`);
    check('tapping again turns it on', await p.eval(`state.settings.showSuggestions === true`));

    console.log('== program hook (task 5)');
    await p.eval(`(state.activeSession.setWeights = {}, state.activeSession.setWeightLocks = {}, state.activeSession.completedSets = {}, renderTrening(), true)`);
    await wait(200);
    check('chipInfo exists and returns text / sheetText / apply for a suggestion', await p.eval(`(() => { const ex = state.plans.sg.exercises[0]; const i = chipInfo(ex, {}, state.plans.sg); return !!i && typeof i.text === 'string' && typeof i.sheetText === 'string' && typeof i.apply === 'function'; })()`));
    await p.eval(`(window.__calls = 0, chipProgramProvider = (ex) => ex.id === 'bench-press' ? { text: 'Week 2: 92.5 kg', sheetText: 'Program says 92.5 kg.', apply: () => { window.__calls++; } } : null, renderTrening(), true)`);
    await wait(200);
    check('a program provider overrides the chip text', (await chipOf(0)) === 'Week 2: 92.5 kg', await chipOf(0));
    await p.eval(`(${exEl(0)}.querySelector('.sugg-chip').click(), true)`);
    check('and the sheet sentence', await p.eval(`document.getElementById('suggest-text').textContent === 'Program says 92.5 kg.'`));
    await p.eval(`(document.getElementById('btn-suggest-use').click(), true)`);
    check('Use calls the provider apply', (await p.eval('window.__calls')) === 1);
    await p.eval(`(chipProgramProvider = null, renderTrening(), true)`);

    console.log('== provider failures (fix round 1)');
    await p.eval(`(chipProgramProvider = () => { throw new Error('boom'); }, renderTrening(), true)`);
    await wait(200);
    check('a throwing provider falls back to the default suggestion (chip stays)', (await chipOf(0)) === 'Try 102.5 kg', await chipOf(0));
    await p.eval(`(chipProgramProvider = () => null, renderTrening(), true)`);
    await wait(200);
    check('a provider returning null falls back to the default suggestion', (await chipOf(0)) === 'Try 102.5 kg', await chipOf(0));
    await p.eval(`(chipProgramProvider = null, true)`);

    console.log('== one rounding (plate set giving x.25 / x.75)');
    await p.eval(`(() => {
      state.settings.plates = { bar: 20, plates: [20, 10, 5, 2.5, 1.25, 0.625] };
      state.history[0].exercises[0].weight = 101.25; state.plans.sg.exercises[0].weight = 101.25;
      state.activeSession.setWeights = {}; state.activeSession.setWeightLocks = {}; state.activeSession.completedSets = {};
      saveState(); renderTrening(); return true; })()`);
    await wait(250);
    const raw = await p.eval(`suggestNext(state.plans.sg.exercises[0], 'sg').weight`);
    const stored = await p.eval(`cleanSetWeightValue(${raw})`);
    check('control: engine suggests a weight that is not a 0.5 multiple (' + raw + ')', raw !== stored, [raw, stored]);
    check('chip shows the stored value', (await chipOf(0)) === 'Try ' + stored + ' kg', await chipOf(0));
    await p.eval(`(${exEl(0)}.querySelector('.sugg-chip').click(), true)`);
    const same = await p.eval(`({ sentence: document.getElementById('suggest-text').textContent, use: document.getElementById('btn-suggest-use').textContent.trim() })`);
    check('sentence and button show the same stored value, never the raw one', same.sentence.indexOf(stored + ' kg') >= 0 && same.sentence.indexOf(String(raw)) < 0 && same.use === 'Use ' + stored + ' kg', same);
    await p.eval(`(document.getElementById('btn-suggest-use').click(), true)`);
    await wait(250);
    check('applied weights are the stored value', J(await weights(0)) === J([String(stored), String(stored), String(stored)]), await weights(0));
    await p.eval(`(delete state.settings.plates, state.history[0].exercises[0].weight = 100, state.plans.sg.exercises[0].weight = 100, state.activeSession.setWeights = {}, state.activeSession.setWeightLocks = {}, saveState(), renderTrening(), true)`);

    console.log('== focus after Use / replaced opener');
    await wait(200);
    await p.eval(`(${exEl(0)}.querySelector('.sugg-chip').click(), document.getElementById('btn-suggest-use').click(), true)`);
    await wait(250);
    check('after Use focus is on the first changed weight input of that exercise', await p.eval(`document.activeElement === ${exEl(0)}.querySelectorAll('input.set-weight')[0]`), await p.eval(`document.activeElement.className`));
    await p.eval(`(state.activeSession.setWeights = {}, state.activeSession.setWeightLocks = {}, renderTrening(), ${exEl(0)}.querySelector('.sugg-chip').click(), renderTrening(), true)`);
    await wait(200);
    check('opener replaced while open: sheet still open', await p.eval(`!document.getElementById('modal-suggest').hidden`));
    await p.eval(`(document.getElementById('btn-suggest-close').click(), true)`);
    check('focus goes to the new chip of the same exercise', await p.eval(`document.activeElement === ${exEl(0)}.querySelector('.sugg-chip') && document.activeElement.isConnected`));
    await p.eval(`(${exEl(0)}.querySelector('.sugg-chip').click(), state.settings.showSuggestions = false, renderTrening(), document.getElementById('btn-suggest-close').click(), true)`);
    check('no chip left: focus falls back to the tile', await p.eval(`document.activeElement === ${exEl(0)}`));
    await p.eval(`(state.settings.showSuggestions = undefined, renderTrening(), true)`);

    console.log('== decimal format policy (D4)');
    await p.eval(`(setLang('fr'), renderTrening(), true)`);
    await wait(200);
    check('in-session chip and weight fields keep the dot format even in fr (like history weights)', await p.eval(`(() => { const c = ${exEl(0)}.querySelector('.sugg-chip'); return !!c && /102\.5/.test(c.textContent) && !/102,5/.test(c.textContent) && historyWeightText({ weight: 102.5, sets: 1 }).indexOf('102.5') >= 0; })()`));
    await p.eval(`(setLang('en'), true)`);

    console.log('== languages, RTL, themes at 390 px');
    const langs = ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar'];
    for (const lang of langs) {
      for (const th of ['light', 'dark']) {
        await p.eval(`(setLang('${lang}'), document.documentElement.setAttribute('data-theme', '${th}'), state.activeSession.setWeights = {}, state.activeSession.setWeightLocks = {}, state.activeSession.completedSets = {}, renderTrening(), true)`);
        await wait(250);
        const info = await p.eval(`(() => { const t0 = ${exEl(0)}; const c = t0.querySelector('.sugg-chip'); if (!c) return { none: true };
          const r = c.getBoundingClientRect(), tr = t0.getBoundingClientRect(); const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
          return { text: c.textContent.trim(), inside: r.left >= tr.left - 0.5 && r.right <= tr.right + 0.5, h: tr.height, rtl, over: document.documentElement.scrollWidth > innerWidth + 1, hasKey: /chip|suggest\\./.test(c.textContent) }; })()`);
        check(lang + '/' + th + ': chip visible, inside the tile, no overflow, no raw key', !info.none && info.inside && !info.over && !info.hasKey && /102\.5/.test(info.text), info);
        if (lang === 'ar' && th === 'light') check('ar: RTL document and Arabic chip text', info.rtl && /[؀-ۿ]/.test(info.text), info);
        await p.eval(`(${exEl(0)}.querySelector('.sugg-chip').click(), true)`);
        await wait(150);
        const sheet = await p.eval(`(() => { const m = document.getElementById('modal-suggest'); const d = m.querySelector('.modal'); const r = d.getBoundingClientRect(); return { open: !m.hidden, text: document.getElementById('suggest-text').textContent, use: document.getElementById('btn-suggest-use').textContent.trim(), title: document.getElementById('suggest-title').textContent.trim(), fit: r.left >= -0.5 && r.right <= innerWidth + 0.5 }; })()`);
        check(lang + '/' + th + ': sheet translated and fits', sheet.open && sheet.fit && sheet.text.length > 10 && /102\.5/.test(sheet.use) && sheet.title.length > 0 && !/suggest\./.test(sheet.text + sheet.use + sheet.title), sheet);
        await p.eval(`(document.getElementById('btn-suggest-close').click(), true)`);
      }
    }
    await p.eval(`(setLang('en'), document.documentElement.removeAttribute('data-theme'), true)`);
    check('every chip/sheet key exists in all six languages', await p.eval(`['suggest.chipUp','suggest.chipKeep','suggest.chipReset','suggest.chipLessHelp','suggest.chipKeepHelp','suggest.chipMoreHelp','suggest.sheetTitle','suggest.use','suggest.useAria','suggest.close','suggest.chipAria','settings.showSuggestions','settings.showSuggestionsHint'].every((k) => ['sk','en','es','pt-BR','fr','ar'].every((l) => typeof BASICS_I18N[l][k] === 'string' && BASICS_I18N[l][k].length > 1))`));
    check('no console errors', logs.length === 0, logs);
  } catch (e) {
    fail++;
    console.log('  FAIL exception: ' + (e && e.stack || e));
  }
  b.killHard && b.killHard(true);
  await server.close();
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
