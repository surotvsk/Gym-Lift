'use strict';
/* Gym-Lift — warm-up sets and the warm-up ramp (gym-basics, task 2), in real headless Chrome.
   No accounts and no network: the app runs with empty Community config.

     node tests/app/warmups.js

   Checks: warmupRamp maths (barbell / dumbbell / assisted); "+ Warm-up" and "Warm-up ramp" buttons;
   default weight and reps; edit / done / remove / max 6; reload; history ({ weight, reps } of the
   DONE warm-ups only), XP / sets / records unchanged; History + Calendar text; history edit keeps
   them; plan toggle auto-fills the ramp once; unilateral row has one list; 6 languages, RTL, 390 px,
   light and dark, no console errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-warmups');
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
  const b = new Browser('warmups-' + Date.now().toString(36), Number(process.env.GQ_DEBUG_PORT) || 9874, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { localStorage.setItem('gymquest_tutorial', '{"v":1,"status":"done","at":0}'); const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); if (tourOpen()) closeTour('skipped'); setLang('en'); return true; })()`);
    await p.eval(`(() => {
      state.plans['wtest'] = { id: 'wtest', builtin: false, customName: 'Warm-up test', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100 },
          { id: 'dumbbell-row', name: 'DB row', sets: 3, reps: 10, weight: 30 },
          { id: 'assisted-pull-ups', name: 'Assisted pull-ups', sets: 3, reps: 8, weight: 20 },
          { id: 'cx-w1', name: 'One-arm test', sets: 2, reps: 10, weight: 20, unilateral: true, startSide: 'left' }] };
      state.plans['wauto'] = { id: 'wauto', builtin: false, customName: 'Warm-up auto', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100, warmupRamp: true },
          { id: 'assisted-pull-ups', name: 'Assisted pull-ups', sets: 3, reps: 8, weight: 20, warmupRamp: true }] };
      for (const id of ['wtest', 'wauto']) if (!state.planOrder.includes(id)) state.planOrder.push(id);
      selectedPlan = 'wtest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    const rows = (i, w) => p.eval(`warmupRamp(getPlan('wtest').exercises[${i}], ${w})`);
    const exEl = (i) => `document.querySelectorAll('#exercise-list .exercise')[${i}]`;
    const ex0 = exEl(0);
    const practice = (el) => el.replace('#exercise-list .exercise', '#workout-phase-legacy .phase-legacy-exercise');
    /* The practice controls live in the Manage bottom sheet (#modal-practice) that only the visible launcher opens.
       The helpers start the workout through the real Start control and open the sheet through the real Manage button. */
    const modalOpen = () => p.eval(`(() => { const m = document.getElementById('modal-practice'); return !!m && !m.hidden && m.checkVisibility(); })()`);
    const ensureWorkout = async (planId) => {
      if (await p.eval('!!getSession()')) return;
      await p.eval(`(${planId ? 'selectedPlan = ' + J(planId) + ',' : ''} switchTab('trening'), renderTrening(), true)`);
      await p.eval(`(() => { const b = document.getElementById('tr-start'); if (!b || !b.checkVisibility()) throw new Error('Start control is not available'); b.click(); return true; })()`);
      await wait(250);
    };
    const openPractice = async () => {
      await ensureWorkout();
      if (await modalOpen()) return;
      const ok = await p.eval(`(() => { const b = document.getElementById('btn-practice-manage'); if (!b || !b.checkVisibility()) return false; b.focus(); b.click(); return true; })()`);
      if (!ok) throw new Error('Manage button is not visible');
      await wait(150);
    };
    const closePractice = async () => {
      if (!(await modalOpen())) return;
      await p.eval(`(document.getElementById('btn-practice-close').click(), true)`); await wait(120);
    };
    const press = async (k, code, vk, o) => {
      const text = o && o.text;
      await p.c.send('Input.dispatchKeyEvent', Object.assign({ type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }, o || {}));
      await p.c.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, o && o.modifiers ? { modifiers: o.modifiers } : {}));
    };
    const clickIn = async (el, sel, i) => {
      const central = /warmup/.test(sel);
      if (central) await openPractice();
      return p.eval(`(() => { const b = ${central ? practice(el) : el}.querySelectorAll(${J(sel)})[${i || 0}]; b.focus(); b.click(); return true; })()`);
    };
    /* Legacy practice actions moved centrally; exercise replacement remains in its action sheet. */
    const actIn = async (el, sel) => {
      if (/warmup/.test(sel)) { await openPractice(); return p.eval(`(() => { const b = ${practice(el)}.querySelector(${J(sel)}); b.focus(); b.click(); return true; })()`); }
      await closePractice();
      return p.eval(`(${el}.querySelector('.btn-ex-more').click(), document.querySelector('#modal-ex-actions ' + ${J(sel)}).click(), true)`);
    };
    const tickRamp = async (scope, idx, on) => {
      await openPractice();
      return p.eval(`(() => { const c = document.querySelectorAll(${J('#workout-phase-legacy ' + scope + ' .phase-legacy-ramp')})[${idx}]; if (c.checked !== ${on}) c.click(); return true; })()`);
    };
    const progressText = () => p.eval(`document.getElementById('practice-progress').textContent`);
    const peek = (el, sel, expr) => p.eval(`(() => { const b = ${practice(el)}.querySelector(${J(sel)}); return ${expr}; })()`);
    const warm = (el) => p.eval(`Array.from(${practice(el)}.querySelectorAll('.warmup-item')).map((d) => d.querySelector('.warmup-label').textContent + '|' + d.querySelector('.warmup-reps').textContent + '|' + d.querySelector('.warmup-weight').textContent + '|' + (d.querySelector('.warmup-done').classList.contains('done') ? 'done' : '-'))`);

    console.log('== practice launcher and Manage bottom sheet');
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
    const autoRestBefore = await p.eval(`state.settings.autoRest`);
    await p.eval(`(state.settings.autoRest = false, true)`);
    const inModal = `(() => { const m = document.getElementById('modal-practice'); return !!m && m.contains(document.activeElement); })()`;
    const launcherGone = `(() => { const l = document.getElementById('workout-practice-launcher'), m = document.getElementById('modal-practice'); return (!l || !l.checkVisibility()) && (!m || m.hidden || !m.checkVisibility()); })()`;
    check('without a workout there is no launcher and no sheet to see', await p.eval(`!getSession() && ${launcherGone}`));
    await ensureWorkout('wtest');
    check('starting a workout shows a compact launcher inside the session, sheet closed', await p.eval(`(() => {
      const l = document.getElementById('workout-practice-launcher'), b = document.getElementById('btn-practice-manage'), m = document.getElementById('modal-practice');
      return l.checkVisibility() && b.getBoundingClientRect().height >= 44 && l.getBoundingClientRect().height < 100
        && m.hidden;
    })()`));
    check('closed launcher hides every practice control while the working exercise stays visible without scrolling', await p.eval(`(() => {
      const first = document.querySelector('#exercise-list .exercise'), r = first.getBoundingClientRect();
      return first.checkVisibility() && r.top < innerHeight - 80 && !document.getElementById('modal-practice').checkVisibility()
        && Array.from(document.querySelectorAll('#workout-phase-legacy .btn-add-warmup, #workout-phase-legacy .btn-warmup-ramp, #workout-phase-legacy .warmup-done')).every((x) => !x.checkVisibility());
    })()`));
    check('the Manage button is really on top at its centre (nothing covers it)', await p.eval(`(() => { const b = document.getElementById('btn-practice-manage'), r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.top >= 0 && r.bottom <= innerHeight && !!e && b.contains(e); })()`));

    /* keyboard: Enter on the focused Manage button opens the sheet and moves focus into it */
    await p.eval(`(document.getElementById('btn-practice-manage').focus(), true)`);
    await press('Enter', 'Enter', 13, { text: '\r' });
    await wait(150);
    check('keyboard Enter on Manage opens the sheet, shows the controls and moves focus inside', (await modalOpen()) && await p.eval(`document.querySelector('#workout-phase-legacy .btn-add-warmup').checkVisibility() && ${inModal}`));
    /* Tab containment: Tab and Shift+Tab never leave the dialog (background launcher, exercises, tab bar stay unreachable) */
    const focusables = await p.eval(`Array.from(document.querySelectorAll('#modal-practice button, #modal-practice input, #modal-practice select, #modal-practice summary, #modal-practice [tabindex]:not([tabindex="-1"])')).filter((x) => !x.disabled && x.checkVisibility()).length`);
    let escaped = null;
    for (let k = 0; k < focusables + 3 && !escaped; k++) { await press('Tab', 'Tab', 9); if (!(await p.eval(inModal))) escaped = 'Tab #' + k; }
    for (let k = 0; k < focusables + 3 && !escaped; k++) { await press('Tab', 'Tab', 9, { modifiers: 8 }); if (!(await p.eval(inModal))) escaped = 'Shift+Tab #' + k; }
    check('Tab and Shift+Tab stay inside the open sheet', focusables >= 2 && !escaped, { focusables, escaped });

    /* adding, ramp and done re-render the rows: the sheet stays open and focus stays inside */
    await clickIn(ex0, '.btn-add-warmup');
    check('adding a row keeps the sheet open, focus inside, and the progress is 0/1', (await modalOpen()) && await p.eval(inModal) && (await progressText()) === await p.eval(`t('phase.legacyProgress', { done: 0, total: 1 })`));
    await clickIn(ex0, '.warmup-done');
    check('marking it done keeps the sheet open, focus inside, and the progress is 1/1', (await modalOpen()) && await p.eval(inModal) && (await progressText()) === await p.eval(`t('phase.legacyProgress', { done: 1, total: 1 })`));
    await clickIn(ex0, '.btn-warmup-ramp');
    const rampRows = await p.eval(`sessionWarmups(getPlan('wtest').exercises[0]).length`);
    check('the ramp keeps the sheet open and focus inside, and the progress counts every practice row', (await modalOpen()) && await p.eval(inModal) && rampRows >= 2 && (await progressText()) === await p.eval(`t('phase.legacyProgress', { done: 1, total: ${rampRows} })`), { rampRows, progress: await progressText() });

    /* progress stays separate from working sets and from the timed warm-up phase */
    await closePractice();
    await p.eval(`(document.querySelector('#exercise-list .sets .set-btn').click(), true)`); await wait(100);
    check('a working set does not change the practice progress', (await progressText()) === await p.eval(`t('phase.legacyProgress', { done: 1, total: ${rampRows} })`) && await p.eval(`totalSetsDone() === 1`));
    await p.eval(`(async () => { setWorkoutPhaseEnabled('warmup', true); await setWorkoutPhaseDone('warmup', true); return true; })()`); await wait(150);
    check('completing the timed warm-up phase does not change the practice progress or rows', (await progressText()) === await p.eval(`t('phase.legacyProgress', { done: 1, total: ${rampRows} })`) && await p.eval(`getSession().phases.warmup.done && sessionWarmups(getPlan('wtest').exercises[0]).filter((x) => x.done).length === 1 && totalSetsDone() === 1`));
    await p.eval(`(async () => { await setWorkoutPhaseDone('warmup', false); setWorkoutPhaseEnabled('warmup', false); return true; })()`); await wait(150);
    check('practice rows stay out of the working set count and the timed phase', await p.eval(`!getSession().phases.warmup.done && !getSession().phases.warmup.enabled && totalSetsDone() === 1 && !document.querySelector('#exercise-list .warmup-item')`));

    /* every way out closes the sheet and returns focus to the Manage button */
    const closers = [
      ['Escape', async () => { await press('Escape', 'Escape', 27); }],
      ['backdrop click', async () => {
        const hit = await p.eval(`(() => { const m = document.getElementById('modal-practice'); return document.elementFromPoint(6, 6) === m; })()`);
        if (!hit) throw new Error('the backdrop is not hit-testable at the top-left corner');
        await p.c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 6, y: 6, button: 'left', clickCount: 1 });
        await p.c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 6, y: 6, button: 'left', clickCount: 1 });
      }],
      ['native Back', async () => { check('native Back reports the sheet as closed', await p.eval(`nativeBack() === 'closed'`)); }],
      ['close button', async () => { await p.eval(`(document.getElementById('btn-practice-close').click(), true)`); }],
    ];
    for (const [name, close] of closers) {
      await openPractice();
      check(name + ': sheet is open before closing', (await modalOpen()) && await p.eval(inModal));
      await close(); await wait(150);
      check(name + ' closes the sheet and focus returns to Manage', !(await modalOpen()) && await p.eval(`document.activeElement === document.getElementById('btn-practice-manage')`), await p.eval(`document.activeElement && (document.activeElement.id || document.activeElement.tagName)`));
      check(name + ': the launcher is still there with its progress and the workout is unchanged', await p.eval(`document.getElementById('workout-practice-launcher').checkVisibility() && !!getSession() && totalSetsDone() === 1`));
    }
    check('Manage and keyboard focus work without the newer checkVisibility API', await p.eval(`(() => {
      const original = Element.prototype.checkVisibility, modal = document.getElementById('modal-practice'), manage = document.getElementById('btn-practice-manage');
      try {
        Element.prototype.checkVisibility = undefined;
        manage.focus(); manage.click();
        const opened = !modal.hidden && document.querySelector('#workout-phase-legacy .btn-add-warmup').getClientRects().length > 0;
        document.getElementById('btn-practice-close').focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        const trapped = modal.contains(document.activeElement) && document.activeElement.id !== 'btn-practice-close';
        document.getElementById('btn-practice-close').click();
        return opened && trapped && modal.hidden && document.activeElement === manage;
      } finally { Element.prototype.checkVisibility = original; }
    })()`));

    /* a closed sheet is never opened by rendering: new rows, same-session rerender, language rerender */
    await p.eval(`(addWarmup(getPlan('wtest').exercises[1]), renderTrening(), true)`); await wait(100);
    check('new practice rows while closed update the launcher progress without opening the sheet', !(await modalOpen()) && (await progressText()) === await p.eval(`t('phase.legacyProgress', { done: 1, total: ${rampRows + 1} })`));
    await p.eval(`(setLang('es'), renderTrening(), setLang('en'), renderTrening(), true)`); await wait(100);
    check('re-rendering the same session keeps a closed sheet closed', !(await modalOpen()) && await p.eval(`document.getElementById('workout-practice-launcher').checkVisibility()`));

    /* reload and a different session owner always start closed */
    await openPractice();
    await p.reload();
    await p.eval(`(switchTab('trening'), true)`); await wait(250);
    check('reload retains the practice data, shows the launcher and does not reopen the sheet', !(await modalOpen()) && await p.eval(`document.getElementById('workout-practice-launcher').checkVisibility() && sessionWarmups(getPlan('wtest').exercises[0])[0].done && totalSetsDone() === 1`) && (await progressText()) === await p.eval(`t('phase.legacyProgress', { done: 1, total: ${rampRows + 1} })`));
    await openPractice();
    await p.eval(`(() => { const oldId = getSession().id; clearSession(); selectedPlan = 'wtest'; ensureSession(getPlan('wtest')); window.__oldPracticeOwner = oldId; renderTrening(); return true; })()`); await wait(150);
    check('another workout (new session owner) closes the sheet instead of inheriting it', await p.eval(`getSession().id !== window.__oldPracticeOwner`) && !(await modalOpen()) && await p.eval(`document.getElementById('workout-practice-launcher').checkVisibility()`));
    await openPractice();
    await p.eval(`(clearSession(), saveState(), renderTrening(), true)`); await wait(150);
    check('ending the workout closes the sheet and removes the launcher', await p.eval(launcherGone));
    await ensureWorkout('wtest');
    check('a freshly started workout does not auto-open the sheet', !(await modalOpen()) && await p.eval(`document.getElementById('workout-practice-launcher').checkVisibility() && document.getElementById('practice-progress').textContent === t('phase.legacyOptional')`));
    await p.eval(`(state.settings.autoRest = ${J(autoRestBefore)}, clearSession(), selectedPlan = 'wtest', saveState(), renderTrening(), true)`);
    await p.c.send('Emulation.clearDeviceMetricsOverride');

    console.log('== ramp maths');
    let r = await rows(0, 100);
    check('bench at 100 → 20×10, 40×5, 60×3, 80×2', J(r) === J([{ w: 20, r: 10 }, { w: 40, r: 5 }, { w: 60, r: 3 }, { w: 80, r: 2 }]), r);
    r = await rows(0, 40);
    check('bench at 40: all < 40 and ≥ 20, strictly increasing, buildable, first row 20×10',
      r.length >= 2 && r.every((x, i) => x.w < 40 && x.w >= 20 && (i === 0 || x.w > r[i - 1].w)) && J(r[0]) === J({ w: 20, r: 10 })
      && (await p.eval(`warmupRamp(getPlan('wtest').exercises[0], 40).every((x) => platePlan(x.w).exact)`)), r);
    r = await rows(0, 20);
    check('working weight = bar → no ramp', J(r) === '[]', r);
    r = await rows(0, 0);
    check('working weight 0 → no ramp', J(r) === '[]', r);
    r = await rows(1, 30);
    check('dumbbell row at 30 → 12, 18, 24 (multiples of 2)', J(r.map((x) => x.w)) === J([12, 18, 24]) && r.every((x) => x.w % 2 === 0), r);
    r = await rows(2, 20);
    check('assisted row → no ramp', J(r) === '[]', r);
    r = await p.eval(`warmupRamp({ name: 'Custom lift', id: 'cx-zzz', sets: 3, reps: 5, weight: 100 }, 100).map((x) => x.w)`);
    check('custom exercise uses the barbell path', J(r) === J([20, 40, 60, 80]), r);
    r = await p.eval(`(() => { state.settings.plates = { bar: 15, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }; const w = warmupRamp(getPlan('wtest').exercises[0], 100).map((x) => x.w); delete state.settings.plates; return w; })()`);
    check('a 15 kg bar changes the first row to 15', r[0] === 15, r);

    console.log('== buttons');
    await openPractice();   // the controls only exist for an active workout, behind the Manage button
    check('bench has manual/ramp actions only in the leading practice section', (await peek(ex0, '.btn-add-warmup', 'b !== null')) && (await peek(ex0, '.btn-warmup-ramp', 'b !== null')) && await p.eval(`!document.querySelector('#exercise-list .btn-add-warmup, #exercise-list .btn-warmup-ramp')`));
    check('dumbbell row has both', (await peek(exEl(1), '.btn-add-warmup', 'b !== null')) && (await peek(exEl(1), '.btn-warmup-ramp', 'b !== null')));
    check('assisted row: "+ Warm-up" stays, no ramp button', (await peek(exEl(2), '.btn-add-warmup', 'b !== null')) && (await peek(exEl(2), '.btn-warmup-ramp', 'b === null')));
    check('labels are "+ Warm-up" and "Warm-up ramp"', J([await peek(ex0, '.btn-add-warmup', 'b.textContent'), await peek(ex0, '.btn-warmup-ramp', 'b.textContent')]) === J(['+ Warm-up', 'Warm-up ramp']));
    check('no warm-up rows before adding', J(await warm(ex0)) === '[]');

    console.log('== adding / editing');
    await actIn(ex0, '.btn-add-warmup');
    check('W1 added: 50 % of 100 = 50 kg × 5', J(await warm(ex0)) === J(['W1|5×|50|-']), await warm(ex0));
    check('the practice row is reachable in the sheet, not among working sets', await p.eval(`document.querySelector('#workout-phase-legacy .warmup-item').checkVisibility() && !document.querySelector('#exercise-list .warmup-item')`));
    check('phase-off keeps the unfinished practice row and working selectors separate', await p.eval(`!document.getElementById('phase-toggle-warmup').checked && !document.querySelector('#exercise-list .warmup-item') && !!document.querySelector('#workout-phase-legacy .warmup-item')`));
    /* úprava váhy na 42,5 (čiarka aj bodka) a opakovaní na 8 */
    await clickIn(ex0, '.warmup-weight', 0);
    check('weight editor opens with 50', await p.eval(`!!document.querySelector('.warmup-editor') && document.querySelector('.set-weight-input').value === '50'`));
    await p.eval(`(() => { const i = document.querySelector('.set-weight-input'); i.value = '42,25'; document.querySelector('.set-weight-ok').click(); return true; })()`);
    await wait(150);
    check('weight 42.25 is stored as entered (not rounded to 0.5)', J(await warm(ex0)) === J(['W1|5×|42.25|-']), await warm(ex0));
    check('saving weight returns focus to that row’s weight control inside the sheet', await p.eval(`document.activeElement === document.querySelector('#workout-phase-legacy .warmup-weight') && !document.getElementById('modal-practice').hidden`));
    await clickIn(ex0, '.warmup-reps', 0);
    await p.eval(`(() => { const i = document.querySelector('.set-reps-input'); i.value = '8'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await wait(150);
    check('reps changed to 8', J(await warm(ex0)) === J(['W1|8×|42.25|-']), await warm(ex0));
    check('saving reps returns focus to that row’s reps control inside the sheet', await p.eval(`document.activeElement === document.querySelector('#workout-phase-legacy .warmup-reps') && !document.getElementById('modal-practice').hidden`));
    await clickIn(ex0, '.warmup-reps', 0);
    await p.eval(`(() => { const i = document.querySelector('.set-reps-input'); i.value = '0'; document.querySelector('.set-reps-ok').click(); return true; })()`);
    check('invalid reps refused (editor stays open)', (await p.eval(`!!document.querySelector('.warmup-editor')`)) && J(await warm(ex0)) === J(['W1|8×|42.25|-']));
    await press('Escape', 'Escape', 27);
    check('Escape cancels the inline edit without closing the sheet or losing the row focus', await p.eval(`!document.querySelector('.warmup-editor') && !document.getElementById('modal-practice').hidden && document.activeElement === document.querySelector('#workout-phase-legacy .warmup-reps')`) && J(await warm(ex0)) === J(['W1|8×|42.25|-']));
    check('validator: negative / text / > 999 refused', await p.eval(`(() => { const e = getPlan('wtest').exercises[0]; return updateWarmup(e, 0, { w: -1 }) === false && updateWarmup(e, 0, { w: 1000 }) === false && updateWarmup(e, 0, { r: 1.5 }) === false && updateWarmup(e, 0, { w: NaN }) === false && sessionWarmups(e)[0].w === 42.25; })()`));
    await clickIn(ex0, '.warmup-done', 0);
    check('✓ toggles done', J(await warm(ex0)) === J(['W1|8×|42.25|done']), await warm(ex0));
    await clickIn(ex0, '.warmup-done', 0);
    for (let k = 0; k < 5; k++) await actIn(ex0, '.btn-add-warmup');
    check('6 warm-ups, then the central add button disappears', (await p.eval(`${practice(ex0)}.querySelectorAll('.warmup-item').length`)) === 6 && (await peek(ex0, '.btn-add-warmup', 'b === null')));
    check('the 7th add is refused', await p.eval(`addWarmup(getPlan('wtest').exercises[0]) === false`));
    for (let k = 0; k < 6; k++) await clickIn(ex0, '.warmup-remove', 0);
    check('✕ removes (back to none) and the add button returns', J(await warm(ex0)) === '[]' && (await peek(ex0, '.btn-add-warmup', 'b !== null')));
    check('empty session map is cleaned up', await p.eval(`!('warmups' in getSession())`));
    check('the plan is unchanged (no warm-up fields)', await p.eval(`!JSON.stringify(state.plans['wtest']).includes('warm')`));

    console.log('== ramp button / done are kept');
    await actIn(ex0, '.btn-warmup-ramp');
    check('ramp fills 4 rows', J(await warm(ex0)) === J(['W1|10×|20|-', 'W2|5×|40|-', 'W3|3×|60|-', 'W4|2×|80|-']), await warm(ex0));
    await clickIn(ex0, '.warmup-done', 0);
    await clickIn(ex0, '.warmup-done', 1);
    await clickIn(ex0, '.warmup-remove', 3);
    await actIn(ex0, '.btn-warmup-ramp');
    const afterRamp = await warm(ex0);
    check('re-applying the ramp keeps the DONE rows and replaces the rest', afterRamp.length >= 2 && afterRamp[0].endsWith('|done') && afterRamp[1].endsWith('|done') && afterRamp.slice(2).every((x) => x.endsWith('|-')) && afterRamp.length <= 6, afterRamp);
    await p.eval(`(() => { const e = getPlan('wtest').exercises[0]; const s = getSession(); s.warmups[exerciseSessionKey(e)] = [{ w: 20, r: 10, done: true }, { w: 40, r: 5, done: true }, { w: 60, r: 3, done: false }]; saveState(); renderTrening(); return true; })()`);
    /* 3 rozcvičky: 2 hotové, 1 nehotová; jedna hotová ťažšia než pracovná váha */
    await p.eval(`(updateWarmup(getPlan('wtest').exercises[0], 1, { w: 150 }), updateWarmup(getPlan('wtest').exercises[0], 1, { w: 40 }), true)`);

    console.log('== reload');
    await p.reload();
    await p.eval(`(selectedPlan = 'wtest', switchTab('trening'), renderTrening(), true)`); await wait(300);
    check('warm-ups survive a reload', J(await warm(ex0)) === J(['W1|10×|20|done', 'W2|5×|40|done', 'W3|3×|60|-']), await warm(ex0));

    console.log('== unilateral / other rows');
    await actIn(exEl(3), '.btn-add-warmup');
    check('unilateral row: ONE central warm-up list (not per side)', (await p.eval(`${practice(exEl(3))}.querySelectorAll('.warmup-item').length`)) === 1 && (await p.eval(`${practice(exEl(3))}.querySelectorAll('.warmups').length`)) === 1);
    await clickIn(exEl(3), '.warmup-remove', 0);
    await actIn(exEl(1), '.btn-warmup-ramp');
    check('dumbbell ramp renders 12 / 18 / 24', J(await p.eval(`Array.from(${practice(exEl(1))}.querySelectorAll('.warmup-weight')).map((x) => x.textContent)`)) === J(['12', '18', '24']));
    await clickIn(exEl(1), '.warmup-remove', 0); await clickIn(exEl(1), '.warmup-remove', 0); await clickIn(exEl(1), '.warmup-remove', 0);
    await actIn(exEl(2), '.btn-add-warmup');
    check('assisted manual practice works (floor of 50 % of 20 = 10)', J(await p.eval(`Array.from(${practice(exEl(2))}.querySelectorAll('.warmup-weight')).map((x) => x.textContent)`)) === J(['10']));
    await clickIn(exEl(2), '.warmup-remove', 0);

    console.log('== 390 px layout');
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await openPractice();
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), ${practice(ex0)}.querySelector('.warmups').scrollIntoView({ block: 'center' }), true)`);
      await wait(250);
      check('390 px ' + theme + ': no horizontal overflow', await p.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
      check('390 px ' + theme + ': the sheet stays inside the screen', await p.eval(`(() => { const r = document.querySelector('#modal-practice .modal-practice').getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; })()`));
      check('390 px ' + theme + ': central practice buttons are tappable (≥ 40 px) and inside the screen', await p.eval(`Array.from(${practice(ex0)}.querySelectorAll('.warmup-item button')).every((x) => { const r = x.getBoundingClientRect(); return r.height >= 40 && r.left >= 0 && r.right <= innerWidth + 1; })`));
      if (process.env.GQ_SCREENSHOTS !== '0') {
      const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'warmups-' + theme + '-390.png'), Buffer.from(s.data, 'base64'));
      }
    }
    await p.eval(`(document.documentElement.removeAttribute('data-theme'), true)`);
    await p.c.send('Emulation.clearDeviceMetricsOverride');
    await closePractice();

    console.log('== saved history');
    /* Hotové pracovné série bench-u 1–3. */
    for (const i of [0, 1, 2]) await p.eval(`(${ex0}.querySelectorAll('.sets .set-btn')[${i}].click(), true)`);
    const xpBefore = await p.eval(`workoutXpFor(totalSetsDone())`);
    await p.eval(`(updateWarmup(getPlan('wtest').exercises[0], 1, { w: 150 }), true)`);   // ťažšia než pracovná váha, hotová
    await p.eval(`(finishWorkout(), confirmFinish(), true)`);
    await wait(300);
    const h = await p.eval(`state.history[state.history.length - 1]`);
    check('only the 2 done warm-ups are saved ({ weight, reps })', J(h.exercises[0].warmups) === J([{ weight: 20, reps: 10 }, { weight: 150, reps: 5 }]), h.exercises[0].warmups);
    check('an exercise without warm-ups has none', h.exercises[1].warmups === undefined, h.exercises[1]);
    const stripped = await p.eval(`(() => { const c = JSON.parse(JSON.stringify(state.history[state.history.length - 1])); c.exercises.forEach((e) => delete e.warmups); return c; })()`);
    check('historyDoneSets equals the working sets only (3)', (await p.eval(`historyDoneSets(state.history[state.history.length - 1])`)) === 3 && (await p.eval(`historyDoneSets(${J(stripped)})`)) === 3);
    check('XP equals the same workout without warm-ups', h.xp === xpBefore && (await p.eval(`historyEntryXp(state.history[state.history.length - 1]) === historyEntryXp(${J(stripped)})`)), { xp: h.xp, xpBefore });
    const prA = await p.eval(`personalRecords()`);
    const prB = await p.eval(`(() => { const saved = state.history; state.history = saved.map((w) => { const c = JSON.parse(JSON.stringify(w)); c.exercises.forEach((e) => delete e.warmups); return c; }); const x = personalRecords(); state.history = saved; return x; })()`);
    check('personalRecords is unchanged by a 150 kg warm-up (bench PR stays 100)', J(prA) === J(prB) && prA.find((x) => x.name === 'Bench').weight === 100, prA);
    await p.eval(`(document.getElementById('modal-result').hidden = true, switchTab('pokrok'), setPokrokView('progress'), true)`);
    await wait(300);
    const text = 'Warm-up: 20 kg × 10 · 150 kg × 5';
    check('Progress history shows "' + text + '"', (await p.eval(`document.body.innerText`)).includes(text));
    await p.eval(`(switchTab('kalendar'), openDay(todayISO()), true)`);
    await wait(300);
    check('the Calendar day window shows the warm-ups', (await p.eval(`document.getElementById('modal-day').innerText`)).includes(text));
    await p.eval(`(closeDay(), true)`);
    check('cleanHistoryWarmups rejects junk', await p.eval(`cleanHistoryWarmups({ warmups: [{ weight: 'x', reps: 5 }] }) === null && cleanHistoryWarmups({}) === null && cleanHistoryWarmups({ warmups: [] }) === null && cleanHistoryWarmups({ warmups: new Array(7).fill({ weight: 20, reps: 5 }) }) === null`));
    check('historyWarmupsHtml escapes and is empty without warm-ups', await p.eval(`historyWarmupsHtml({}, 'div') === '' && historyWarmupsHtml({ warmups: [{ weight: 20, reps: 5 }] }, 'div').includes('warmup-note')`));
    const id = await p.eval(`state.history[state.history.length - 1].id`);
    await p.eval(`(() => { openHistoryEdit(${J(id)}); const inp = document.querySelector('#he-exercises .he-ex-row input[data-f="weight"]'); inp.value = '105'; inp.dispatchEvent(new Event('input')); saveHistoryEdit(); return true; })()`);
    check('editing the workout in history keeps its warm-ups', J(await p.eval(`state.history.find((w) => w.id === ${J(id)}).exercises[0].warmups`)) === J([{ weight: 20, reps: 10 }, { weight: 150, reps: 5 }]));
    await p.reload();
    check('history warm-ups survive a reload', J(await p.eval(`state.history[state.history.length - 1].exercises[0].warmups`)) === J([{ weight: 20, reps: 10 }, { weight: 150, reps: 5 }]));

    console.log('== plan toggle: automatic ramp');
    await p.eval(`(() => { selectedPlan = 'wauto'; switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    check('no session → nothing filled yet', await p.eval(`!getSession() && document.querySelectorAll('#workout-phase-legacy .warmup-item').length === 0`));
    check('no session → no launcher either', await p.eval(`!document.getElementById('workout-practice-launcher').checkVisibility()`));
    await ensureWorkout('wauto');
    const key =await p.eval(`exerciseSessionKey(getPlan('wauto').exercises[0])`);
    check('starting the session fills the central ramp and retains its exercise key', (await p.eval(`document.querySelectorAll('#workout-phase-legacy .phase-legacy-exercise')[0].querySelectorAll('.warmup-item').length`)) === 4 && (await p.eval(`getSession().warmupsInit[${J(key)}]`)) === true, await p.eval(`getSession().warmupsInit`));
    check('automatic ramp does not open the sheet or add working sets, and the launcher shows 0/4', !(await modalOpen()) && await p.eval(`totalSetsDone() === 0`) && (await progressText()) === await p.eval(`t('phase.legacyProgress', { done: 0, total: 4 })`));
    check('the assisted row with a remembered toggle gets no ramp', (await p.eval(`document.querySelectorAll('#workout-phase-legacy .phase-legacy-exercise')[1].querySelectorAll('.warmup-item').length`)) === 0);
    for (let k = 0; k < 4; k++) await clickIn(`document.querySelectorAll('#exercise-list .exercise')[0]`, '.warmup-remove', 0);
    await p.eval(`(renderTrening(), true)`);
    check('removing all and re-rendering does not refill', (await p.eval(`document.querySelectorAll('#workout-phase-legacy .warmup-item').length`)) === 0);
    await p.reload();
    await p.eval(`(selectedPlan = 'wauto', switchTab('trening'), renderTrening(), true)`); await wait(300);
    check('…nor after a reload (warmupsInit persisted)', (await p.eval(`document.querySelectorAll('#workout-phase-legacy .warmup-item').length`)) === 0 && (await p.eval(`getSession().warmupsInit[${J(key)}]`)) === true);
    /* The remembered ramp stays configurable in the plan editor before any workout exists (draft until Save). */
    await p.eval(`(() => { clearSession(); saveState(); selectedPlan = 'wauto'; startEditPlan('wauto'); return true; })()`);
    await wait(200);
    const editRamps = `Array.from(document.querySelectorAll('#edit-warmup-ramp .edit-ramp-pref'))`;
    check('before any workout the editor offers the remembered ramp for the bench row only (assisted row excluded)', await p.eval(`(() => { const c = ${editRamps}; return !getSession() && !document.getElementById('edit-warmup-ramp').hidden && c.length === 1 && c[0].checked && !document.querySelector('#edit-rows .edit-warmup-ramp'); })()`));
    await p.eval(`(() => { const c = ${editRamps}[0]; c.checked = false; c.dispatchEvent(new Event('change')); return true; })()`);
    check('unticking in the editor only changes the draft', await p.eval(`editDraft[0].warmupRamp !== true && getPlan('wauto').exercises[0].warmupRamp === true`));
    await p.eval(`(cancelEditPlan(), true)`);
    check('Cancel keeps the remembered ramp', await p.eval(`getPlan('wauto').exercises[0].warmupRamp === true`));
    await p.eval(`(() => { startEditPlan('wauto'); const c = ${editRamps}[0]; c.checked = false; c.dispatchEvent(new Event('change')); saveEditPlan(); return true; })()`);
    check('Save with the ramp off removes the field from the plan', await p.eval(`!('warmupRamp' in getPlan('wauto').exercises[0])`));
    await p.eval(`(() => { startEditPlan('wauto'); const c = ${editRamps}[0]; c.checked = true; c.dispatchEvent(new Event('change')); saveEditPlan(); return true; })()`);
    check('Save with the ramp on stores warmupRamp: true', await p.eval(`getPlan('wauto').exercises[0].warmupRamp === true`));
    await p.eval(`(clearSession(), saveState(), selectedPlan = 'wauto', ensureSession(getPlan('wauto')), switchTab('trening'), renderTrening(), true)`); await wait(300);
    check('the preference saved from the editor fills the leading ramp when the workout starts', (await p.eval(`document.querySelectorAll('#workout-phase-legacy .phase-legacy-exercise')[0].querySelectorAll('.warmup-item').length`)) === 4);

    console.log('== program workout: the remembered ramp is saved to the plan, not only the session snapshot');
    await p.eval(`(() => {
      clearSession(); saveState();
      state.plans['wprog'] = { id: 'wprog', builtin: false, customName: 'Program ramp', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100 }] };
      selectedPlan = 'wprog';
      const s = ensureSession(getPlan('wprog'));
      s.programPlan = cleanProgramSessionPlan(getPlan('wprog'), 'wprog', 'Program ramp');
      saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    check('a program workout renders from its own plan snapshot', await p.eval(`currentPlan() === getSession().programPlan && currentPlan().exercises[0] !== getPlan('wprog').exercises[0]`));
    await tickRamp('', 0, true);
    await wait(200);
    check('ticking the preference during a program workout persists it on the saved plan row', await p.eval(`getPlan('wprog').exercises[0].warmupRamp === true`));
    check('…while the session snapshot copy used for rendering shows the ticked state', await p.eval(`getSession().programPlan.exercises[0].warmupRamp === true && document.querySelector('#workout-phase-legacy .phase-legacy-ramp').checked`));
    await p.eval(`(clearSession(), saveState(), ensureSession(getPlan('wprog')), renderTrening(), true)`); await wait(300);
    check('a later workout of that plan starts with the remembered ramp', (await p.eval(`document.querySelectorAll('#workout-phase-legacy .phase-legacy-exercise')[0].querySelectorAll('.warmup-item').length`)) === 4);
    await p.eval(`(clearSession(), saveState(), delete state.plans['wprog'], true)`);

    console.log('== duplicate exercise: every occurrence is initialised and keeps its own ramp preference');
    await p.eval(`(() => {
      state.plans['wdup'] = { id: 'wdup', builtin: false, customName: 'Duplicate ramp', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 60 },
          { id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 80, warmupRamp: true }] };
      selectedPlan = 'wdup'; ensureSession(getPlan('wdup')); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    check('a ramp on only the later occurrence is still filled once at start', await p.eval(`(() => { const want = warmupRamp(getPlan('wdup').exercises[1], 80).length; return want > 0 && getSession().warmupsInit['bench-press'] === true && sessionWarmups(getPlan('wdup').exercises[1]).length === want; })()`));
    check('one shared practice section offers one preference per occurrence (off, on)', await p.eval(`(() => { const s = document.querySelectorAll('#workout-phase-legacy [data-exercise-key="bench-press"]'); return s.length === 1 && Array.from(s[0].querySelectorAll('.phase-legacy-ramp')).map((x) => x.checked).join() === 'false,true'; })()`));
    await tickRamp('[data-exercise-key="bench-press"]', 1, false);
    await wait(150);
    await tickRamp('[data-exercise-key="bench-press"]', 0, true);
    await wait(150);
    await closePractice();
    check('each occurrence stores its own preference', await p.eval(`(() => { const r = getPlan('wdup').exercises; return r[0].warmupRamp === true && !('warmupRamp' in r[1]); })()`));
    await p.eval(`(clearSession(), saveState(), delete state.plans['wdup'], true)`);
    check('sanitiser drops a junk session warm-up list', await p.eval(`(() => { const s = normalizeActiveSession({ id: 'x', startedAt: Date.now(), planId: 'wauto', completedSets: {}, actualFailureSets: {}, warmups: { a: [{ w: -1, r: 5 }, { w: 20, r: 5, done: true }], b: 'junk' }, warmupsInit: { a: true, b: 1 } }); return !!s && J2(s.warmups) === '{"a":[{"w":20,"r":5,"done":true}]}' && J2(s.warmupsInit) === '{"a":true}'; function J2(x) { return JSON.stringify(x); } })()`));

    console.log('== replacing an exercise');
    await ensureWorkout('wtest');
    await p.eval(`(${ex0}.querySelectorAll('.sets .set-btn')[0].click(), true)`);   // 1 hotová séria pred výmenou
    await actIn(ex0, '.btn-add-warmup');
    check('warm-ups are stored per exercise key in the running workout', J(await p.eval(`Object.keys(getSession().warmups || {})`)) === J(['bench-press']));
    await actIn(ex0, '.exercise-swap');
    await wait(200);
    await p.eval(`(applySubstitution('hammer-curl'), true)`);
    await wait(300);
    const slot = await p.eval(`exerciseSlots(getPlan('wtest'))[0].slot`);
    const subKey = await p.eval(`(() => { const st = substitutionSteps(${J(slot)}); return st.length ? String(st[st.length - 1].key) : null; })()`);
    check('the exercise was replaced', !!subKey && subKey !== 'bench-press', subKey);
    check('the closed original keeps its central practice rows locked, outside the working card', await p.eval(`(() => { const e = document.querySelector('#workout-phase-legacy [data-exercise-key="bench-press"]'); const c = document.querySelector('#exercise-list .exercise.exercise-closed'); return !!e && !!c && !c.querySelector('.warmup-item') && e.querySelectorAll('.warmup-item').length === 1 && Array.from(e.querySelectorAll('.warmup-item button')).every((x) => x.disabled) && !e.querySelector('.btn-add-warmup'); })()`));
    await actIn(`document.querySelectorAll('#exercise-list .exercise')[1]`, '.btn-add-warmup');
    await wait(200);
    check('the replacement gets its own warm-ups', (await p.eval(`(getSession().warmups[${J(subKey)}] || []).length`)) === 1);
    await p.eval(`(requestUndoSubstitution(${J(slot)}), true)`);
    await wait(300);
    if (await p.eval(`!document.getElementById('modal-generic').hidden`)) await p.eval(`(confirmGeneric(), true)`);
    await wait(200);
    check('undoing the replacement removes its warm-ups; the original keeps its own', await p.eval(`!(getSession().warmups || {})[${J(subKey)}] && ((getSession().warmups || {})['bench-press'] || []).length === 1`), await p.eval(`getSession().warmups`));

    console.log('== replaced exercise that only owns warm-up rows stays closed, named and locked');
    await openPractice();
    await p.eval(`(document.querySelector('#workout-phase-legacy [data-exercise-key="dumbbell-row"] .btn-add-warmup').click(), true)`); await wait(150);
    await actIn(exEl(1), '.exercise-swap'); await wait(200);
    await p.eval(`(applySubstitution('hammer-curl'), true)`); await wait(300);
    const slot1 = await p.eval(`exerciseSlots(getPlan('wtest'))[1].slot`);
    const subKey1 = await p.eval(`(() => { const st = substitutionSteps(${J(slot1)}); return st.length ? String(st[st.length - 1].key) : null; })()`);
    check('the second exercise was replaced before any working set was done', !!subKey1 && subKey1 !== 'dumbbell-row' && (await p.eval(`!document.querySelector('#exercise-list .exercise-closed')`)), subKey1);
    const closed = await p.eval(`(() => { const e = document.querySelector('#workout-phase-legacy [data-exercise-key="dumbbell-row"]'); const all = Array.from(document.querySelectorAll('#workout-phase-legacy .phase-legacy-exercise'));
      return { found: !!e, name: e ? e.querySelector('h4').textContent : '', expected: exerciseDisplayName(getPlan('wtest').exercises[1]), rows: e ? e.querySelectorAll('.warmup-item').length : -1,
        locked: !!e && Array.from(e.querySelectorAll('.warmup-item button')).every((b) => b.disabled), actions: !!e && !!e.querySelector('.btn-add-warmup, .btn-warmup-ramp, .phase-legacy-ramp'),
        rawTitle: all.some((s) => s.querySelector('h4').textContent === s.dataset.exerciseKey),
        replacementWritable: all.some((s) => s.dataset.exerciseKey === ${J(subKey1)} && !!s.querySelector('.btn-add-warmup')) }; })()`);
    check('the warm-up-only original keeps its resolved name and its rows, locked', closed.found && closed.name === closed.expected && closed.rows === 1 && closed.locked && !closed.actions, closed);
    check('no practice section is titled with an internal key', closed.rawTitle === false, closed);
    check('the replacement stays writable in its own section', closed.replacementWritable === true, closed);
    await p.eval(`(requestUndoSubstitution(${J(slot1)}), true)`);
    await wait(300);
    if (await p.eval(`!document.getElementById('modal-generic').hidden`)) await p.eval(`(confirmGeneric(), true)`);
    await wait(200);
    check('undoing reopens the original with its warm-up row writable again', await p.eval(`(() => { const e = document.querySelector('#workout-phase-legacy [data-exercise-key="dumbbell-row"]'); return !!e && e.querySelectorAll('.warmup-item').length === 1 && !!e.querySelector('.btn-add-warmup') && Array.from(e.querySelectorAll('.warmup-item button')).every((b) => !b.disabled); })()`));

    console.log('== languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('trening'), renderTrening(), true)`);
      const x = await p.eval(`(() => { const e = ${practice(ex0)}; return { add: e.querySelector('.btn-add-warmup').textContent, ramp: e.querySelector('.btn-warmup-ramp').textContent, label: e.querySelector('.warmup-label').textContent,
        aria: Array.from(e.querySelectorAll('.warmup-item button')).map((b) => b.getAttribute('aria-label')).join('|'), title: e.querySelector('.btn-add-warmup').title + e.querySelector('.btn-warmup-ramp').title,
        hist: historyWarmupsText(state.history[state.history.length - 1].exercises[0]), dir: document.documentElement.dir,
        miss: Object.keys(I18N.en).filter((k) => k.startsWith('warmup.') && I18N[${J(lang)}][k] === undefined) }; })()`);
      check(lang + ': warm-up texts translated, no missing warmup.* key', !/warmup\.|setReps\.|setWeight\./.test(x.add + x.ramp + x.label + x.aria + x.title + x.hist) && x.miss.length === 0 && x.add.length > 0 && x.ramp.length > 0 && x.hist.includes('20'), x);
      const ln = await p.eval(`(() => { const l = document.getElementById('workout-practice-launcher'), b = document.getElementById('btn-practice-manage'), h = document.querySelector('#modal-practice .sheet-head'), c = document.getElementById('btn-practice-close');
        return { visible: l.checkVisibility(), text: l.textContent.trim(), aria: (b.getAttribute('aria-label') || '') + (c.getAttribute('aria-label') || '') + (c.title || ''), head: h.textContent.trim(), overflow: l.scrollWidth > l.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
      check(lang + ': launcher and sheet header are translated and do not overflow', ln.visible && ln.text.length > 0 && ln.head.length > 0 && !/\b(phase|practice|warmup)\.[a-zA-Z]/.test(ln.text + ln.aria + ln.head) && !ln.overflow, ln);
      if (lang === 'ar') {
        check('ar: right-to-left', x.dir === 'rtl');
        await openPractice();
        await p.eval(`(${practice(ex0)}.querySelector('.warmups').scrollIntoView({ block: 'center' }), true)`);
        if (process.env.GQ_SCREENSHOTS !== '0') {
        const s2 = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'warmups-ar.png'), Buffer.from(s2.data, 'base64'));
        }
      }
    }
    await closePractice();
    await p.eval(`(setLang('en'), true)`);
    check('verifyI18n reports nothing missing for warmup.*', await p.eval(`LANG_CODES.every((l) => Object.keys(I18N.en).filter((k) => /^warmup\\./.test(k) && I18N[l][k] === undefined).length === 0)`));

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
