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
const PORT = 8124;
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
  const b = new Browser('warmups-' + Date.now().toString(36), 9874, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
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
    const clickIn = (el, sel, i) => p.eval(`(${el}.querySelectorAll(${J(sel)})[${i || 0}].click(), true)`);
    const warm = (el) => p.eval(`Array.from(${el}.querySelectorAll('.warmup-item')).map((d) => d.querySelector('.warmup-label').textContent + '|' + d.querySelector('.warmup-reps').textContent + '|' + d.querySelector('.warmup-weight').textContent + '|' + (d.querySelector('.warmup-done').classList.contains('done') ? 'done' : '-'))`);

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
    check('bench has "+ Warm-up" and "Warm-up ramp" in .ex-mini', await p.eval(`!!${ex0}.querySelector('.ex-mini .btn-add-warmup') && !!${ex0}.querySelector('.ex-mini .btn-warmup-ramp')`));
    check('dumbbell row has both', await p.eval(`!!${exEl(1)}.querySelector('.ex-mini .btn-add-warmup') && !!${exEl(1)}.querySelector('.ex-mini .btn-warmup-ramp')`));
    check('assisted row: "+ Warm-up" stays, no ramp button', await p.eval(`!!${exEl(2)}.querySelector('.ex-mini .btn-add-warmup') && !${exEl(2)}.querySelector('.btn-warmup-ramp')`));
    check('labels are "+ Warm-up" and "Warm-up ramp"', J(await p.eval(`[${ex0}.querySelector('.btn-add-warmup').textContent, ${ex0}.querySelector('.btn-warmup-ramp').textContent]`)) === J(['+ Warm-up', 'Warm-up ramp']));
    check('no warm-up rows before adding', J(await warm(ex0)) === '[]');

    console.log('== adding / editing');
    await clickIn(ex0, '.btn-add-warmup');
    check('W1 added: 50 % of 100 = 50 kg × 5', J(await warm(ex0)) === J(['W1|5×|50|-']), await warm(ex0));
    check('adding a warm-up starts the workout', !!(await p.eval('getSession()')));
    check('the warm-up block sits above the working sets', await p.eval(`(() => { const e = ${ex0}; const w = e.querySelector('.warmups'); const s = e.querySelector('.sets'); return !!w && !!(w.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); })()`));
    check('the .warmups block is before the first set row', await p.eval(`(() => { const e = ${ex0}; const w = e.querySelector('.warmup-item'); const s = e.querySelector('.sets .set-item'); return !!(w.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); })()`));
    /* úprava váhy na 42,5 (čiarka aj bodka) a opakovaní na 8 */
    await clickIn(ex0, '.warmup-weight', 0);
    check('weight editor opens with 50', await p.eval(`!!document.querySelector('.warmup-editor') && document.querySelector('.set-weight-input').value === '50'`));
    await p.eval(`(() => { const i = document.querySelector('.set-weight-input'); i.value = '42,25'; document.querySelector('.set-weight-ok').click(); return true; })()`);
    await wait(150);
    check('weight 42.25 is stored as entered (not rounded to 0.5)', J(await warm(ex0)) === J(['W1|5×|42.25|-']), await warm(ex0));
    await clickIn(ex0, '.warmup-reps', 0);
    await p.eval(`(() => { const i = document.querySelector('.set-reps-input'); i.value = '8'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await wait(150);
    check('reps changed to 8', J(await warm(ex0)) === J(['W1|8×|42.25|-']), await warm(ex0));
    await clickIn(ex0, '.warmup-reps', 0);
    await p.eval(`(() => { const i = document.querySelector('.set-reps-input'); i.value = '0'; document.querySelector('.set-reps-ok').click(); return true; })()`);
    check('invalid reps refused (editor stays open)', (await p.eval(`!!document.querySelector('.warmup-editor')`)) && J(await warm(ex0)) === J(['W1|8×|42.25|-']));
    await p.eval(`(closeSetWeightEditor(), true)`);
    check('validator: negative / text / > 999 refused', await p.eval(`(() => { const e = getPlan('wtest').exercises[0]; return updateWarmup(e, 0, { w: -1 }) === false && updateWarmup(e, 0, { w: 1000 }) === false && updateWarmup(e, 0, { r: 1.5 }) === false && updateWarmup(e, 0, { w: NaN }) === false && sessionWarmups(e)[0].w === 42.25; })()`));
    await clickIn(ex0, '.warmup-done', 0);
    check('✓ toggles done', J(await warm(ex0)) === J(['W1|8×|42.25|done']), await warm(ex0));
    await clickIn(ex0, '.warmup-done', 0);
    for (let k = 0; k < 5; k++) await clickIn(ex0, '.btn-add-warmup');
    check('6 warm-ups, then the add button disappears', (await p.eval(`${ex0}.querySelectorAll('.warmup-item').length`)) === 6 && !(await p.eval(`!!${ex0}.querySelector('.btn-add-warmup')`)));
    check('the 7th add is refused', await p.eval(`addWarmup(getPlan('wtest').exercises[0]) === false`));
    for (let k = 0; k < 6; k++) await clickIn(ex0, '.warmup-remove', 0);
    check('✕ removes (back to none) and the add button returns', J(await warm(ex0)) === '[]' && (await p.eval(`!!${ex0}.querySelector('.btn-add-warmup')`)));
    check('empty session map is cleaned up', await p.eval(`!('warmups' in getSession())`));
    check('the plan is unchanged (no warm-up fields)', await p.eval(`!JSON.stringify(state.plans['wtest']).includes('warm')`));

    console.log('== ramp button / done are kept');
    await clickIn(ex0, '.btn-warmup-ramp');
    check('ramp fills 4 rows', J(await warm(ex0)) === J(['W1|10×|20|-', 'W2|5×|40|-', 'W3|3×|60|-', 'W4|2×|80|-']), await warm(ex0));
    await clickIn(ex0, '.warmup-done', 0);
    await clickIn(ex0, '.warmup-done', 1);
    await clickIn(ex0, '.warmup-remove', 3);
    await clickIn(ex0, '.btn-warmup-ramp');
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
    await clickIn(exEl(3), '.btn-add-warmup');
    check('unilateral row: ONE warm-up list (not per side)', (await p.eval(`${exEl(3)}.querySelectorAll('.warmup-item').length`)) === 1 && (await p.eval(`${exEl(3)}.querySelectorAll('.warmups').length`)) === 1);
    await clickIn(exEl(3), '.warmup-remove', 0);
    await clickIn(exEl(1), '.btn-warmup-ramp');
    check('dumbbell ramp renders 12 / 18 / 24', J(await p.eval(`Array.from(${exEl(1)}.querySelectorAll('.warmup-weight')).map((x) => x.textContent)`)) === J(['12', '18', '24']));
    await clickIn(exEl(1), '.warmup-remove', 0); await clickIn(exEl(1), '.warmup-remove', 0); await clickIn(exEl(1), '.warmup-remove', 0);
    await clickIn(exEl(2), '.btn-add-warmup');
    check('assisted "+ Warm-up" works (floor of 50 % of 20 = 10)', J(await p.eval(`Array.from(${exEl(2)}.querySelectorAll('.warmup-weight')).map((x) => x.textContent)`)) === J(['10']));
    await clickIn(exEl(2), '.warmup-remove', 0);

    console.log('== 390 px layout');
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), ${ex0}.querySelector('.warmups').scrollIntoView({ block: 'center' }), true)`);
      await wait(250);
      check('390 px ' + theme + ': no horizontal overflow', await p.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
      check('390 px ' + theme + ': warm-up buttons are tappable (≥ 40 px) and inside the screen', await p.eval(`Array.from(${ex0}.querySelectorAll('.warmup-item button')).every((x) => { const r = x.getBoundingClientRect(); return r.height >= 40 && r.left >= 0 && r.right <= innerWidth + 1; })`));
      const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'warmups-' + theme + '-390.png'), Buffer.from(s.data, 'base64'));
    }
    await p.eval(`(document.documentElement.removeAttribute('data-theme'), true)`);
    await p.c.send('Emulation.clearDeviceMetricsOverride');

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
    check('no session → nothing filled yet', await p.eval(`!getSession() && document.querySelectorAll('#exercise-list .warmup-item').length === 0`));
    await p.eval(`(ensureSession(getPlan('wauto')), renderTrening(), true)`);
    await wait(300);
    const key = await p.eval(`exerciseSessionKey(getPlan('wauto').exercises[0])`);
    check('starting the session fills the ramp (4 rows) and marks sess.warmupsInit', (await p.eval(`document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.warmup-item').length`)) === 4 && (await p.eval(`getSession().warmupsInit[${J(key)}]`)) === true, await p.eval(`getSession().warmupsInit`));
    check('the assisted row with the toggle gets no ramp', (await p.eval(`document.querySelectorAll('#exercise-list .exercise')[1].querySelectorAll('.warmup-item').length`)) === 0);
    for (let k = 0; k < 4; k++) await clickIn(`document.querySelectorAll('#exercise-list .exercise')[0]`, '.warmup-remove', 0);
    await p.eval(`(renderTrening(), true)`);
    check('removing all and re-rendering does not refill', (await p.eval(`document.querySelectorAll('#exercise-list .warmup-item').length`)) === 0);
    await p.reload();
    await p.eval(`(selectedPlan = 'wauto', switchTab('trening'), renderTrening(), true)`); await wait(300);
    check('…nor after a reload (warmupsInit persisted)', (await p.eval(`document.querySelectorAll('#exercise-list .warmup-item').length`)) === 0 && (await p.eval(`getSession().warmupsInit[${J(key)}]`)) === true);
    /* editor plánu: prepínač */
    await p.eval(`(() => { state.activeSession = null; saveState(); selectedPlan = 'wauto'; startEditPlan('wauto'); return true; })()`);
    await wait(200);
    check('plan editor: toggle on for the bench row, hidden for the assisted row', await p.eval(`(() => { const r = document.querySelectorAll('#edit-rows .edit-row'); const c = r[0].querySelector('.edit-warmup-ramp'); return !!c && c.checked && r[1].querySelector('.edit-warmup-box').hidden && !r[0].querySelector('.edit-warmup-box').hidden; })()`));
    await p.eval(`(() => { const c = document.querySelectorAll('#edit-rows .edit-row')[0].querySelector('.edit-warmup-ramp'); c.checked = false; c.dispatchEvent(new Event('change')); saveEditPlan(); return true; })()`);
    check('turning the toggle off removes the field from the plan', await p.eval(`!('warmupRamp' in getPlan('wauto').exercises[0])`), await p.eval(`getPlan('wauto').exercises[0]`));
    await p.eval(`(() => { startEditPlan('wauto'); const c = document.querySelectorAll('#edit-rows .edit-row')[0].querySelector('.edit-warmup-ramp'); c.checked = true; c.dispatchEvent(new Event('change')); saveEditPlan(); return true; })()`);
    check('turning it on stores warmupRamp: true', await p.eval(`getPlan('wauto').exercises[0].warmupRamp === true`));
    check('sanitiser drops a junk session warm-up list', await p.eval(`(() => { const s = normalizeActiveSession({ id: 'x', startedAt: Date.now(), planId: 'wauto', completedSets: {}, actualFailureSets: {}, warmups: { a: [{ w: -1, r: 5 }, { w: 20, r: 5, done: true }], b: 'junk' }, warmupsInit: { a: true, b: 1 } }); return !!s && J2(s.warmups) === '{"a":[{"w":20,"r":5,"done":true}]}' && J2(s.warmupsInit) === '{"a":true}'; function J2(x) { return JSON.stringify(x); } })()`));

    console.log('== replacing an exercise');
    await p.eval(`(() => { selectedPlan = 'wtest'; switchTab('trening'); renderTrening(); return true; })()`);
    await p.eval(`(${ex0}.querySelectorAll('.sets .set-btn')[0].click(), true)`);   // 1 hotová séria pred výmenou
    await clickIn(ex0, '.btn-add-warmup');
    check('warm-ups are stored per exercise key in the running workout', J(await p.eval(`Object.keys(getSession().warmups || {})`)) === J(['bench-press']));
    await p.eval(`(${ex0}.querySelector('.exercise-swap').click(), true)`);
    await wait(200);
    await p.eval(`(applySubstitution('hammer-curl'), true)`);
    await wait(300);
    const slot = await p.eval(`exerciseSlots(getPlan('wtest'))[0].slot`);
    const subKey = await p.eval(`(() => { const st = substitutionSteps(${J(slot)}); return st.length ? String(st[st.length - 1].key) : null; })()`);
    check('the exercise was replaced', !!subKey && subKey !== 'bench-press', subKey);
    check('the closed original keeps its warm-up, locked', await p.eval(`(() => { const e = document.querySelector('#exercise-list .exercise.exercise-closed'); return !!e && e.querySelectorAll('.warmup-item').length === 1 && Array.from(e.querySelectorAll('.warmup-item button')).every((x) => x.disabled) && !e.querySelector('.btn-add-warmup'); })()`));
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[1].querySelector('.btn-add-warmup').click(), true)`);
    await wait(200);
    check('the replacement gets its own warm-ups', (await p.eval(`(getSession().warmups[${J(subKey)}] || []).length`)) === 1);
    await p.eval(`(requestUndoSubstitution(${J(slot)}), true)`);
    await wait(300);
    if (await p.eval(`!document.getElementById('modal-generic').hidden`)) await p.eval(`(confirmGeneric(), true)`);
    await wait(200);
    check('undoing the replacement removes its warm-ups; the original keeps its own', await p.eval(`!(getSession().warmups || {})[${J(subKey)}] && ((getSession().warmups || {})['bench-press'] || []).length === 1`), await p.eval(`getSession().warmups`));

    console.log('== languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('trening'), renderTrening(), true)`);
      const x = await p.eval(`(() => { const e = ${ex0}; return { add: e.querySelector('.btn-add-warmup').textContent, ramp: e.querySelector('.btn-warmup-ramp').textContent, label: e.querySelector('.warmup-label').textContent,
        aria: Array.from(e.querySelectorAll('.warmup-item button')).map((b) => b.getAttribute('aria-label')).join('|'), title: e.querySelector('.btn-add-warmup').title + e.querySelector('.btn-warmup-ramp').title,
        hist: historyWarmupsText(state.history[state.history.length - 1].exercises[0]), dir: document.documentElement.dir,
        miss: Object.keys(I18N.en).filter((k) => k.startsWith('warmup.') && I18N[${J(lang)}][k] === undefined) }; })()`);
      check(lang + ': warm-up texts translated, no missing warmup.* key', !/warmup\.|setReps\.|setWeight\./.test(x.add + x.ramp + x.label + x.aria + x.title + x.hist) && x.miss.length === 0 && x.add.length > 0 && x.ramp.length > 0 && x.hist.includes('20'), x);
      if (lang === 'ar') {
        check('ar: right-to-left', x.dir === 'rtl');
        await p.eval(`(${ex0}.querySelector('.warmups').scrollIntoView({ block: 'center' }), true)`);
        const s2 = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'warmups-ar.png'), Buffer.from(s2.data, 'base64'));
      }
    }
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
