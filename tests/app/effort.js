'use strict';
/* Gym-Lift — effort rating RPE / RIR (gym-basics, task 3), in real headless Chrome.
   No accounts and no network: the app runs with empty Community config.

     node tests/app/effort.js

   Checks: off by default (no chip); RPE / RIR chip on done sets only, picker (9 RPE / 5 RIR options),
   locale decimal separator, survives a reload, un-marking keeps the rating; finish → entry.setRpe /
   entry.sideRpe, XP and sets unchanged; History + Calendar text; history edit keeps it; settings sync
   key; session sanitiser, key migration, substitution undo; 6 languages, RTL, 390 px, light and dark,
   no console errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-effort');
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
  const b = new Browser('effort-' + Date.now().toString(36), 9875, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.eval(`(() => {
      state.plans['etest'] = { id: 'etest', builtin: false, customName: 'Effort test', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100 },
          { id: 'cx-e1', name: 'One-arm test', sets: 2, reps: 10, weight: 20, unilateral: true, startSide: 'left' }] };
      if (!state.planOrder.includes('etest')) state.planOrder.push('etest');
      selectedPlan = 'etest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    const exEl = (i) => `document.querySelectorAll('#exercise-list .exercise')[${i}]`;
    const ex0 = exEl(0), ex1 = exEl(1);
    const mainSets = (el) => `${el}.querySelectorAll('.set-item:not(.drop-item)')`;
    const tickSet = (el, i) => p.eval(`(${mainSets(el)}[${i}].querySelector('.set-btn').click(), true)`);
    const chipText = (el, i) => p.eval(`(() => { const c = ${mainSets(el)}[${i}].querySelector('.set-effort'); return c ? c.textContent.trim() : null; })()`);
    const chipCount = () => p.eval(`document.querySelectorAll('.set-effort').length`);
    const pick = async (el, i, val) => {
      await p.eval(`(${mainSets(el)}[${i}].querySelector('.set-effort').click(), true)`);
      await wait(100);
      return p.eval(`(() => { const o = document.querySelector('#modal-effort .effort-opt[data-rpe="${val}"]'); if (!o) return false; o.click(); return true; })()`);
    };
    const setMode = async (m) => { await p.eval(`(document.querySelector('#effort-chips [data-effort="${m}"]').click(), true)`); await wait(150); };

    console.log('== default: off');
    check('setting reads off', await p.eval(`effortMode() === 'off'`));
    await tickSet(ex0, 0);
    check('no .set-effort anywhere while off', (await chipCount()) === 0);
    check('the Off chip is pressed in Settings', await p.eval(`document.querySelector('#effort-chips [data-effort="off"]').getAttribute('aria-pressed') === 'true'`));
    check('invalid values read as off', await p.eval(`(() => { const s = state.settings.effort; const r = ['x', 5, null, {}, 'RPE'].every((v) => { state.settings.effort = v; return effortMode() === 'off'; }); if (s === undefined) delete state.settings.effort; else state.settings.effort = s; return r; })()`));
    check('the card sits after the rest-sound card in Settings', await p.eval(`!!(document.getElementById('btn-rest-sound').compareDocumentPosition(document.getElementById('effort-chips')) & Node.DOCUMENT_POSITION_FOLLOWING)`));
    check('effort is a synced setting (not a device setting)', await p.eval(`!DEVICE_SETTING_KEYS.includes('effort')`));

    console.log('== RPE mode');
    await setMode('rpe');
    check('switching stores state.settings.effort = rpe', await p.eval(`state.settings.effort === 'rpe'`));
    check('done set 1 has a chip reading "RPE"', (await chipText(ex0, 0)) === 'RPE', await chipText(ex0, 0));
    check('not-done set 2 has no chip', (await chipText(ex0, 1)) === null);
    await p.eval(`(${mainSets(ex0)}[0].querySelector('.set-effort').click(), true)`);
    await wait(100);
    check('tapping the chip opens #modal-effort with 9 RPE options (6 … 10)', await p.eval(`(() => { const m = document.getElementById('modal-effort'); const o = Array.from(m.querySelectorAll('.effort-opt')).map((x) => x.dataset.rpe); return !m.hidden && o.join(',') === '6,6.5,7,7.5,8,8.5,9,9.5,10'; })()`));
    check('options are ≥ 44 px tall', await p.eval(`Array.from(document.querySelectorAll('#modal-effort .effort-opt')).every((x) => x.getBoundingClientRect().height >= 44)`), await p.eval(`Array.from(document.querySelectorAll('#modal-effort .effort-opt')).map((x) => Math.round(x.getBoundingClientRect().height))`));
    await p.eval(`(document.querySelector('#modal-effort .effort-opt[data-rpe="8.5"]').click(), true)`);
    await wait(150);
    check('picking 8.5 closes the sheet and the chip reads "RPE 8.5"', (await chipText(ex0, 0)) === 'RPE 8.5' && await p.eval(`document.getElementById('modal-effort').hidden`), await chipText(ex0, 0));
    check('stored as sess.setRpe[key] = 8.5', await p.eval(`getSession().setRpe['bench-press:0'] === 8.5`));
    check('getSetRpe reads it', await p.eval(`getSetRpe(getPlan('etest').exercises[0], 0) === 8.5`));
    await p.eval(`(setLang('fr'), renderTrening(), true)`);
    check('fr: chip reads "RPE 8,5"', (await chipText(ex0, 0)) === 'RPE 8,5', await chipText(ex0, 0));
    await p.eval(`(setLang('en'), renderTrening(), true)`);

    console.log('== RIR mode');
    await setMode('rir');
    check('RIR mode: the same set reads "RIR 1.5"', (await chipText(ex0, 0)) === 'RIR 1.5', await chipText(ex0, 0));
    await p.eval(`(setLang('fr'), renderTrening(), true)`);
    check('fr: chip reads "RIR 1,5"', (await chipText(ex0, 0)) === 'RIR 1,5', await chipText(ex0, 0));
    await p.eval(`(setLang('en'), renderTrening(), true)`);
    check('effortText maths: RIR 0, 4+, 3.5, RPE 10', await p.eval(`[effortText(10), effortText(6), effortText(6.5), effortText(7)].join('|')`) === 'RIR 0|RIR 4+|RIR 3.5|RIR 3');
    await p.eval(`(${mainSets(ex0)}[0].querySelector('.set-effort').click(), true)`);
    await wait(100);
    check('RIR picker has 5 options: 0, 1, 2, 3, 4+ (stored 10, 9, 8, 7, 6)', await p.eval(`(() => { const o = Array.from(document.querySelectorAll('#modal-effort .effort-opt')); return o.map((x) => x.textContent.trim()).join(',') === '0,1,2,3,4+' && o.map((x) => x.dataset.rpe).join(',') === '10,9,8,7,6'; })()`));
    await p.eval(`(document.querySelector('#modal-effort .effort-opt[data-rpe="8"]').click(), true)`);
    await wait(150);
    check('picking RIR 2 stores RPE 8 and reads "RIR 2"', (await chipText(ex0, 0)) === 'RIR 2' && await p.eval(`getSession().setRpe['bench-press:0'] === 8`));
    await p.eval(`(document.querySelector('#effort-chips [data-effort="rpe"]').click(), true)`);

    console.log('== reload / un-mark');
    await p.reload();
    await p.eval(`(selectedPlan = 'etest', switchTab('trening'), renderTrening(), true)`); await wait(300);
    check('the mode and the rating survive a reload', (await chipText(ex0, 0)) === 'RPE 8' && await p.eval(`effortMode() === 'rpe'`), await chipText(ex0, 0));
    await tickSet(ex0, 0);
    check('un-marking hides the chip but keeps the rating', (await chipText(ex0, 0)) === null && await p.eval(`getSession().setRpe['bench-press:0'] === 8`));
    await tickSet(ex0, 0);
    check('re-marking shows it again', (await chipText(ex0, 0)) === 'RPE 8');
    await p.eval(`(${mainSets(ex0)}[0].querySelector('.set-effort').click(), true)`);
    await wait(100);
    check('the picker has a Clear button; the current value is pressed', await p.eval(`!!document.querySelector('#modal-effort .effort-clear') && document.querySelector('#modal-effort .effort-opt[data-rpe="8"]').getAttribute('aria-pressed') === 'true'`));
    await p.eval(`(document.querySelector('#modal-effort .effort-clear').click(), true)`);
    await wait(150);
    check('Clear removes the rating (chip back to "RPE")', (await chipText(ex0, 0)) === 'RPE' && await p.eval(`!getSession().setRpe`));
    await pick(ex0, 0, '8.5');
    await p.eval(`(${mainSets(ex0)}[0].querySelector('.set-effort').click(), true)`);
    await wait(100);
    check('the picker closes with its ✕ button and Android Back', await p.eval(`(() => { const m = document.getElementById('modal-effort'); const was = !m.hidden; document.getElementById('btn-effort-close').click(); return was && m.hidden; })()`));

    console.log('== unilateral');
    await tickSet(ex1, 0); await tickSet(ex1, 1);
    check('per-side rows each get a chip', (await p.eval(`${mainSets(ex1)}.length`)) === 4 && (await p.eval(`${ex1}.querySelectorAll('.set-effort').length`)) === 2);
    await pick(ex1, 0, '9');
    check('left side of set 1 is stored under :L', await p.eval(`getSession().setRpe['cx-e1:0:L'] === 9`), await p.eval(`getSession().setRpe`));
    check('the right side is unrated', (await chipText(ex1, 1)) === 'RPE');

    console.log('== settings sheet');
    await p.eval(`(openSettings && openSettings(), true)`);
    check('settings card has 3 chips (Off / RPE / RIR) with translated labels', await p.eval(`Array.from(document.querySelectorAll('#effort-chips button')).map((x) => x.textContent.trim()).join('|')`) === 'Off|RPE|RIR');
    await p.eval(`(document.getElementById('btn-settings-close').click(), true)`);

    console.log('== finish');
    await tickSet(ex0, 1); await tickSet(ex0, 2);
    const xpBefore = await p.eval(`workoutXpFor(totalSetsDone())`);
    await p.eval(`(finishWorkout(), confirmFinish(), true)`);
    await wait(300);
    const h = await p.eval(`state.history[state.history.length - 1]`);
    check('entry.setRpe is [8.5, null, null] for the 3-set row (one rated)', J(h.exercises[0].setRpe) === J([8.5, null, null]), h.exercises[0]);
    check('unilateral: sideRpe.left[0] === 9 and setRpe absent', h.exercises[1].sideRpe && h.exercises[1].sideRpe.left[0] === 9 && h.exercises[1].sideRpe.right[0] === null && h.exercises[1].setRpe === undefined, h.exercises[1]);
    const stripped = await p.eval(`(() => { const c = JSON.parse(JSON.stringify(state.history[state.history.length - 1])); c.exercises.forEach((e) => { delete e.setRpe; delete e.sideRpe; }); return c; })()`);
    check('historyDoneSets is identical with and without ratings', (await p.eval(`historyDoneSets(state.history[state.history.length - 1])`)) === (await p.eval(`historyDoneSets(${J(stripped)})`)));
    check('XP is identical with and without ratings', h.xp === xpBefore && (await p.eval(`historyEntryXp(state.history[state.history.length - 1]) === historyEntryXp(${J(stripped)})`)), { xp: h.xp, xpBefore });
    check('records are identical with and without ratings', await p.eval(`(() => { const a = JSON.stringify(personalRecords()); const saved = state.history; state.history = saved.map((w) => { const c = JSON.parse(JSON.stringify(w)); c.exercises.forEach((e) => { delete e.setRpe; delete e.sideRpe; }); return c; }); const b = JSON.stringify(personalRecords()); state.history = saved; return a === b; })()`));
    check('an unrated workout has neither field', await p.eval(`(() => { const e = { name: 'X', sets: 2, reps: 5, weight: 10 }; const entry = historyExerciseEntry(e, { completedSets: { 'cx-nope:0': true }, actualFailureSets: {} }); return !('setRpe' in entry) && !('sideRpe' in entry); })()`));

    console.log('== history text');
    await p.eval(`(document.getElementById('modal-result').hidden = true, switchTab('pokrok'), setPokrokView('progress'), true)`);
    await wait(300);
    check('Progress history shows "RPE 8.5" in RPE mode', (await p.eval(`document.body.innerText`)).includes('RPE 8.5'));
    await p.eval(`(switchTab('kalendar'), openDay(todayISO()), true)`);
    await wait(300);
    check('the Calendar day window shows "RPE 8.5"', (await p.eval(`document.getElementById('modal-day').innerText`)).includes('RPE 8.5'));
    await p.eval(`(closeDay(), true)`);
    await p.eval(`(setEffortMode('rir'), true)`);
    const rirLine = await p.eval(`historyEffortText(state.history[state.history.length - 1].exercises[0])`);
    check('in RIR mode the history line reads "RIR 1.5"', rirLine.includes('RIR 1.5') && !rirLine.includes('RPE'), rirLine);
    await p.eval(`(setEffortMode('off'), true)`);
    check('in Off mode the history line is empty (data kept)', (await p.eval(`historyEffortHtml(state.history[state.history.length - 1].exercises[0], 'div')`)) === '' && await p.eval(`!!state.history[state.history.length - 1].exercises[0].setRpe`));
    await p.eval(`(setEffortMode('rpe'), true)`);
    check('unilateral history line names the side', (await p.eval(`historyEffortText(state.history[state.history.length - 1].exercises[1])`)).includes('RPE 9'));
    check('cleanHistoryEffort rejects junk', await p.eval(`cleanHistorySetRpe({ sets: 2, setRpe: [5, 8] }) === null && cleanHistorySetRpe({ sets: 2, setRpe: [8.2, null] }) === null && cleanHistorySetRpe({ sets: 2, setRpe: [null, null] }) === null && cleanHistorySetRpe({ sets: 2 }) === null && cleanHistorySetRpe({ sets: 2, setRpe: [9, null] }) !== null`));
    const id = await p.eval(`state.history[state.history.length - 1].id`);
    await p.eval(`(() => { openHistoryEdit(${J(id)}); const inp = document.querySelector('#he-exercises .he-ex-row input[data-f="weight"]'); inp.value = '105'; inp.dispatchEvent(new Event('input')); saveHistoryEdit(); return true; })()`);
    check('saveHistoryEdit keeps setRpe and sideRpe', await p.eval(`(() => { const e = state.history.find((w) => w.id === ${J(id)}).exercises; return JSON.stringify(e[0].setRpe) === '[8.5,null,null]' && e[1].sideRpe.left[0] === 9; })()`));
    await p.reload();
    check('history ratings survive a reload', await p.eval(`state.history[state.history.length - 1].exercises[0].setRpe[0] === 8.5`));

    console.log('== session sanitiser / migration / substitution');
    check('sanitiser keeps only 6–10 in steps of 0.5 on valid keys', await p.eval(`(() => { const s = normalizeActiveSession({ id: 'x', startedAt: Date.now(), planId: 'etest', completedSets: {}, actualFailureSets: {}, setRpe: { 'a:0': 8.5, 'a:1': 5, 'a:2': 10.5, 'a:3': 7.2, 'a:4': '8', 'bad': 8, 'b:0:L': 6 } }); return !!s && JSON.stringify(s.setRpe) === JSON.stringify({ 'a:0': 8.5, 'b:0:L': 6 }); })()`));
    check('sanitiser drops an all-junk map (no empty field)', await p.eval(`(() => { const s = normalizeActiveSession({ id: 'x', startedAt: Date.now(), planId: 'etest', completedSets: {}, actualFailureSets: {}, setRpe: { 'a:0': 3 } }); return !!s && !('setRpe' in s); })()`));
    check('migrateSessionKeys moves setRpe keys', await p.eval(`(() => { const s = { setRpe: { 'old:0': 8, 'old:1:R': 9, 'keep:0': 7 } }; migrateSessionKeys(s, { old: 'new' }); return JSON.stringify(s.setRpe) === JSON.stringify({ 'new:0': 8, 'new:1:R': 9, 'keep:0': 7 }); })()`));
    check('invalid state.settings.effort is dropped by the loader', await p.eval(`(() => { state.settings.effort = 'nope'; backfillState(); const r = !('effort' in state.settings); state.settings.effort = 'rpe'; return r; })()`));
    check('a valid import keeps effort', await p.eval(`(() => { const keep = state; const n = migrateV2toV3(JSON.parse(JSON.stringify(Object.assign({}, state, { settings: Object.assign({}, state.settings, { effort: 'rir' }) })))); state = keep; return n.settings.effort === 'rir'; })()`));
        await p.eval(`(setEffortMode('rpe'), true)`);
    await p.eval(`(() => { state.activeSession = null; saveState(); selectedPlan = 'etest'; switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    await tickSet(ex0, 0);
    await p.eval(`(renderTrening(), true)`);   // session started by the tick → the swap button needs a render
    await pick(ex0, 0, '7');
    await p.eval(`(${ex0}.querySelector('.exercise-swap').click(), true)`);
    await wait(200);
    await p.eval(`(applySubstitution('hammer-curl'), true)`);
    await wait(300);
    const slot = await p.eval(`exerciseSlots(getPlan('etest'))[0].slot`);
    const subKey = await p.eval(`(() => { const st = substitutionSteps(${J(slot)}); return st.length ? String(st[st.length - 1].key) : null; })()`);
    check('the exercise was replaced', !!subKey && subKey !== 'bench-press', subKey);
    await tickSet(exEl(1), 0);
    await pick(exEl(1), 0, '9');
    check('the replacement has its own rating key', await p.eval(`getSession().setRpe[${J(subKey + ':0')}] === 9 && getSession().setRpe['bench-press:0'] === 7`), await p.eval(`getSession().setRpe`));
    await p.eval(`(requestUndoSubstitution(${J(slot)}), true)`);
    await wait(300);
    if (await p.eval(`!document.getElementById('modal-generic').hidden`)) await p.eval(`(confirmGeneric(), true)`);
    await wait(200);
    check('undo drops the replacement ratings, the original keeps its own', await p.eval(`(() => { const m = getSession().setRpe || {}; return !Object.keys(m).some((k) => k.indexOf(${J(subKey + ':')}) === 0) && m['bench-press:0'] === 7; })()`), await p.eval(`getSession().setRpe`));

    console.log('== Android Back');
    check('modal-effort is in NATIVE_BACK_CLOSE', await p.eval(`NATIVE_BACK_CLOSE.some((x) => x[0] === 'modal-effort')`));

    console.log('== history edit refits the ratings when the set count changes');
    const refit = (sets0, rpe0, sets1) => p.eval(`(() => {
      const id = 'he-refit-' + Math.random().toString(36).slice(2, 6);
      state.history.push({ id, date: '2026-01-05', planId: 'etest', planName: 'Effort test', xp: 0, durationMin: 10,
        exercises: [{ name: 'Refit test', sets: ${sets0}, reps: 5, weight: 50, setsDone: ${sets0}, setRpe: ${J(rpe0)} }] });
      openHistoryEdit(id);
      const inp = document.querySelector('#he-exercises .he-ex-row input[data-f="sets"]');
      inp.value = '${sets1}'; inp.dispatchEvent(new Event('input'));
      saveHistoryEdit();
      const e = state.history.find((w) => w.id === id).exercises[0];
      state.history = state.history.filter((w) => w.id !== id);
      return e.setRpe === undefined ? null : e.setRpe;
    })()`);
    check('3 → 2 sets drops the 3rd rating', J(await refit(3, [7, 8, 9], 2)) === J([7, 8]), await refit(3, [7, 8, 9], 2));
    check('2 → 3 sets pads with null', J(await refit(2, [7, 8], 3)) === J([7, 8, null]));
    check('3 → 1 set where only the dropped sets were rated removes setRpe', (await refit(3, [null, 8, 9], 1)) === null);
    await p.eval(`(document.getElementById('modal-history-edit').hidden = true, true)`);

    console.log('== picker: selected state, keyboard, focus');
    await p.eval(`(selectedPlan = 'etest', switchTab('trening'), renderTrening(), true)`); await wait(300);
    await p.eval(`(() => { const c = ${mainSets(ex0)}[0].querySelector('.set-effort'); if (!c) ${mainSets(ex0)}[0].querySelector('.set-btn').click(); return true; })()`); await wait(200);
    await p.eval(`(window.__chip = (el) => {
      const lum = (c) => { const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
      const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
      const cs = getComputedStyle(el), bg = rgb(cs.backgroundColor), fg = rgb(cs.color);
      const L1 = lum(fg), L2 = lum(bg);
      return { bg: cs.backgroundColor, contrast: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) };
    }, true)`);
    await p.eval(`(setEffortMode('rpe'), ${mainSets(ex0)}[0].querySelector('.set-effort').focus(), ${mainSets(ex0)}[0].querySelector('.set-effort').click(), true)`);
    await wait(150);
    check('opening the picker focuses its first option', await p.eval(`document.activeElement === document.querySelector('#effort-options .effort-opt')`), await p.eval(`document.activeElement.className`));
    check('isBusy() is true with the picker open (no other cause)', await p.eval(`(() => { const g = window.getSession, t0 = window.totalSetsDone, ed = editingPlan; window.getSession = () => null; window.totalSetsDone = () => 0; editingPlan = null; const open = isBusy(); document.getElementById('modal-effort').hidden = true; const closed = isBusy(); document.getElementById('modal-effort').hidden = false; window.getSession = g; window.totalSetsDone = t0; editingPlan = ed; return open === true && closed === false; })()`));
    await p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
    await wait(100);
    check('Escape closes the picker', await p.eval(`document.getElementById('modal-effort').hidden`));
    check('closing restores focus to the chip that opened it', await p.eval(`document.activeElement === ${mainSets(ex0)}[0].querySelector('.set-effort')`), await p.eval(`document.activeElement.className`));
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), ${mainSets(ex0)}[0].querySelector('.set-effort').click(), true)`);
      await wait(100);
      await p.eval(`(document.querySelector('#effort-options .effort-opt[data-rpe="8"]').click(), ${mainSets(ex0)}[0].querySelector('.set-effort').click(), true)`);   // vyberie 8 a znova otvorí
      await wait(100);
      const on = await p.eval(`window.__chip(document.querySelector('#effort-options .effort-opt[aria-pressed="true"]'))`);
      const off = await p.eval(`window.__chip(document.querySelector('#effort-options .effort-opt[aria-pressed="false"]'))`);
      check(theme + ': the selected rating has a different background than the others', on.bg !== off.bg, { on, off });
      check(theme + ': selected rating text contrast >= 4.5', on.contrast >= 4.5, on);
      await p.eval(`(document.getElementById('btn-effort-close').click(), true)`);
    }
    await p.eval(`(document.documentElement.removeAttribute('data-theme'), true)`);

    console.log('== 390 px layout');
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.eval(`(renderTrening(), true)`);
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), ${ex0}.querySelector('.set-effort').scrollIntoView({ block: 'center' }), true)`);
      await wait(250);
      check('390 px ' + theme + ': no horizontal overflow', await p.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
      check('390 px ' + theme + ': chips are tappable (≥ 40 px) and inside the screen', await p.eval(`Array.from(document.querySelectorAll('.set-effort')).every((x) => { const r = x.getBoundingClientRect(); return r.height >= 40 && r.left >= 0 && r.right <= innerWidth + 1; })`));
      const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'effort-' + theme + '-390.png'), Buffer.from(s.data, 'base64'));
      await p.eval(`(${ex0}.querySelector('.set-effort').click(), true)`);
      await wait(200);
      check('390 px ' + theme + ': picker fits the screen', await p.eval(`(() => { const m = document.querySelector('#modal-effort .modal'); const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; })()`));
      const s3 = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'effort-picker-' + theme + '-390.png'), Buffer.from(s3.data, 'base64'));
      await p.eval(`(document.querySelector('#modal-effort .effort-opt').click(), true)`);
      await wait(100);
    }
    await p.eval(`(document.documentElement.removeAttribute('data-theme'), true)`);
    await p.c.send('Emulation.clearDeviceMetricsOverride');

    console.log('== languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), switchTab('trening'), renderTrening(), true)`);
      await p.eval(`(${ex0}.querySelector('.set-effort').click(), true)`);
      await wait(100);
      const x = await p.eval(`(() => { const m = document.getElementById('modal-effort'); const r = { title: m.querySelector('h3').textContent, clear: m.querySelector('.effort-clear').textContent,
        aria: Array.from(m.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || '').join('|'), chip: document.querySelector('.set-effort').textContent,
        card: document.querySelector('[data-i18n="settings.effort"]').textContent, hint: document.querySelector('[data-i18n="settings.effortHint"]').textContent, dir: document.documentElement.dir,
        miss: Object.keys(I18N.en).filter((k) => k.startsWith('effort.') && I18N[${J(lang)}][k] === undefined) }; document.getElementById('modal-effort').hidden = true; return r; })()`);
      check(lang + ': effort texts translated, no missing effort.* key', !/effort\.|settings\.effort/.test(x.title + x.clear + x.aria + x.chip + x.card + x.hint) && x.miss.length === 0 && x.title.length > 0 && x.clear.length > 0, x);
      if (lang === 'ar') {
        check('ar: right-to-left', x.dir === 'rtl');
        await p.eval(`(${ex0}.querySelector('.set-effort').scrollIntoView({ block: 'center' }), true)`);
        const s2 = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'effort-ar.png'), Buffer.from(s2.data, 'base64'));
      }
    }
    await p.eval(`(setLang('en'), true)`);
    check('verifyI18n reports nothing missing for effort.*', await p.eval(`LANG_CODES.every((l) => Object.keys(I18N.en).filter((k) => /^(effort\\.|settings\\.effort)/.test(k) && I18N[l][k] === undefined).length === 0)`));

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
