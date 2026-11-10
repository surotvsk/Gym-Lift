'use strict';
/* Gym-Lift — supersets and circuits (gym-basics, task 4), in real headless Chrome.
   No accounts and no network: the app runs with empty Community config.

     node tests/app/supersets.js

   Checks: normalizeGroups / supersetInfo / nextInGroup / isLastInGroup; plan editor (link, unlink, circuit label,
   drag away, delete middle); plan save and reload; workout wrapper, focus on the next member, swap keeps the
   bracket; history entries and brackets (History + Calendar); XP / sets / records unchanged; ungrouped plan has
   no wrapper; 6 languages, RTL bracket side, 390 px, light and dark, no console errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-supersets');
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
  const b = new Browser('supersets-' + Date.now().toString(36), 9875, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.eval(`(() => {
      const rows = () => [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100 },
        { id: 'dumbbell-row', name: 'DB row', sets: 3, reps: 10, weight: 30 },
        { id: 'hammer-curl', name: 'Hammer curl', sets: 3, reps: 10, weight: 12 },
        { id: 'cx-sstest', name: 'Cable test', sets: 3, reps: 12, weight: 25 }];
      state.plans['sstest'] = { id: 'sstest', builtin: false, customName: 'SS test', location: null, exercises: rows() };
      state.plans['ssplain'] = { id: 'ssplain', builtin: false, customName: 'SS plain', location: null, exercises: rows() };
      for (const id of ['sstest', 'ssplain']) if (!state.planOrder.includes(id)) state.planOrder.push(id);
      selectedPlan = 'sstest'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
    const ev = (code) => p.eval(code);
    const eg = () => ev(`editDraft.map((r) => r.group || null)`);
    const editRows = () => `document.querySelectorAll('#edit-rows .edit-row')`;
    const labels = () => ev(`Array.from(${editRows()}).map((r) => { const l = r.querySelector('.edit-group-label'); return l ? l.textContent : ''; })`);
    const link = (i) => ev(`(${editRows()}[${i}].querySelector('.edit-link').click(), true)`);
    const same = (a) => a.length > 1 && a.every((x) => x && x === a[0]);

    console.log('== pure helpers');
    check('normalizeGroups removes a lone member, junk and non-adjacent groups; keeps a pair', await ev(`(() => {
      const r = [{ group: 'a' }, { group: 'a' }, { group: 'b' }, {}, { group: 'a' }, { group: 5 }, { group: null }, null, { group: 'c' }, { group: 'c' }];
      const ch = normalizeGroups(r);
      return ch === true && r[0].group === 'a' && r[1].group === 'a' && !('group' in r[2]) && !('group' in r[4]) && !('group' in r[5]) && !('group' in r[6]) && r[8].group === 'c' && r[9].group === 'c' && normalizeGroups(r) === false; })()`));
    check('normalizeGroups never throws on junk', await ev(`(() => { try { normalizeGroups(null); normalizeGroups(undefined); normalizeGroups('x'); normalizeGroups([1, 'a', undefined, { group: {} }]); return true; } catch (e) { return false; } })()`));
    check('supersetInfo: labels in order of appearance, circuit when size >= 3', await ev(`(() => {
      const plan = { id: 'x', exercises: [{ name: 'a', group: 'p' }, { name: 'b', group: 'p' }, { name: 'c' }, { name: 'd', group: 'q' }, { name: 'e', group: 'q' }, { name: 'f', group: 'q' }] };
      const m = supersetInfo(plan);
      const g = (i) => m.get(i) && [m.get(i).label, m.get(i).pos, m.get(i).size, m.get(i).kind].join('/');
      return g(0) === 'A/0/2/superset' && g(1) === 'A/1/2/superset' && !m.has(2) && g(3) === 'B/0/3/circuit' && g(5) === 'B/2/3/circuit'; })()`));
    check('nextInGroup / isLastInGroup', await ev(`(() => {
      const plan = { id: 'x', exercises: [{ name: 'a', group: 'p' }, { name: 'b', group: 'p' }, { name: 'c' }] };
      return nextInGroup(plan, 0) === 1 && nextInGroup(plan, 1) === null && nextInGroup(plan, 2) === null && isLastInGroup(plan, 0) === false && isLastInGroup(plan, 1) === true && isLastInGroup(plan, 2) === true; })()`));
    check('normalizeGroups gives a second run that reuses an id a fresh id; Link with next cannot merge them', await ev(`(() => {
      const r = [{ group: 'g' }, { group: 'g' }, {}, { group: 'g' }, { group: 'g' }];
      const ch = normalizeGroups(r);
      const sep = ch === true && r[0].group === 'g' && r[1].group === 'g' && r[3].group && r[3].group !== 'g' && r[3].group === r[4].group;
      const again = normalizeGroups(r) === false;
      linkWithNext(r, 1);   // 1 a 2 sa spoja, ale beh 3-4 zostane samostatný
      const noMerge = r[2].group === r[1].group && r[3].group !== r[1].group;
      return sep && again && noMerge; })()`));
    check('linkWithNext / unlinkRow on plain rows', await ev(`(() => {
      const r = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
      linkWithNext(r, 0); const two = r[0].group && r[0].group === r[1].group && !r[2].group;
      linkWithNext(r, 1); const three = r[0].group === r[1].group && r[1].group === r[2].group && !!r[0].group;
      unlinkRow(r, 0); const cut = !r[0].group && r[1].group && r[1].group === r[2].group;
      unlinkRow(r, 1); const none = r.every((x) => !x.group);
      return two && three && cut && none; })()`));

    console.log('== plan editor');
    await ev(`(startEditPlan('sstest'), true)`); await wait(200);
    check('every row has a link button; none is grouped yet', (await ev(`${editRows()}.length`)) === 4 && (await ev(`Array.from(${editRows()}).slice(0, 3).every((r) => !!r.querySelector('.edit-link'))`)) && (await eg()).every((g) => !g));
    check('the button text is "Link with next"', (await ev(`${editRows()}[0].querySelector('.edit-link').textContent`)) === 'Link with next');
    await link(0);
    let g = await eg();
    check('linking row 0 with row 1 gives both the same group', same(g.slice(0, 2)) && !g[2] && !g[3], g);
    check('the editor shows the label "Superset A" once, on the first member only', J((await labels())) === J(['Superset A', '', '', '']), await labels());
    check('row 0 now offers "Unlink"', (await ev(`${editRows()}[0].querySelector('.edit-link').textContent`)) === 'Unlink');
    await link(1);
    g = await eg();
    check('linking row 1 with row 2 makes all three one group', same(g.slice(0, 3)) && !g[3], g);
    check('the label reads "Circuit A"', J(await labels()) === J(['Circuit A', '', '', '']), await labels());
    await link(0);   // Unlink row 0 → cut after row 0
    g = await eg();
    check('unlinking row 0 clears the left-over single member and keeps the pair 1-2', !g[0] && same(g.slice(1, 3)) && J(await labels()) === J(['', 'Superset A', '', '']), g);
    await link(1);   // Unlink row 1 → both clear
    check('unlinking again clears the rest', (await eg()).every((x) => !x));
    await link(0); await link(1);
    /* mazanie prostredného cviku okruhu: zvyšné dva sú nalepené a ostanú spojené */
    await ev(`(${editRows()}[1].querySelector('.btn-icon-danger').click(), true)`); await wait(150);
    await ev(`(document.getElementById('btn-generic-ok').click(), true)`); await wait(150);
    g = await eg();
    check('deleting the middle of a 3-circuit keeps the remaining 2 linked', g.length === 3 && same(g.slice(0, 2)) && !g[2] && J(await labels()) === J(['Superset A', '', '']), g);
    /* pretiahnutie riadku 1 na koniec rozbije susednosť */
    await ev(`(() => {
      const c = document.getElementById('edit-rows'); const rows = c.querySelectorAll('.edit-row');
      const ev1 = (type, y, target) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientY: y }));
      ev1('pointerdown', 0, rows[1].querySelector('.drag-handle'));
      const last = c.querySelectorAll('.edit-row')[2].getBoundingClientRect();
      ev1('pointermove', last.top + last.height / 2, c);
      ev1('pointerup', 0, c);
      return true; })()`);
    await wait(150);
    g = await eg();
    check('dragging row 1 away breaks the run: nobody is grouped', g.length === 3 && g.every((x) => !x), g);
    await ev(`(cancelEditPlan(), true)`);

    console.log('== saving the plan');
    await ev(`(startEditPlan('sstest'), true)`); await wait(150);
    await link(0); await link(1);
    await ev(`(saveEditPlan(), true)`);
    g = await ev(`getPlan('sstest').exercises.map((r) => r.group || null)`);
    check('saved plan rows keep the group (circuit of 3)', same(g.slice(0, 3)) && !g[3], g);
    await ev(`(startEditPlan('sstest'), true)`); await wait(150);
    await link(1); await ev(`(saveEditPlan(), true)`);
    g = await ev(`getPlan('sstest').exercises.map((r) => r.group || null)`);
    check('unlink + save: pair 0-1 stays, the cut-off single row is cleaned', same(g.slice(0, 2)) && !g[2] && !g[3], g);
    await ev(`(() => { getPlan('sstest').exercises[3].group = getPlan('sstest').exercises[2].group = 'zz'; getPlan('sstest').exercises[1].group = 5; saveState(); return true; })()`);
    await p.reload();
    g = await ev(`getPlan('sstest').exercises.map((r) => r.group || null)`);
    check('state load removes invalid groups only (junk 5 dropped, adjacent pair 2-3 kept)', !g[0] && !g[1] && g[2] === 'zz' && g[3] === 'zz', g);
    await ev(`(() => { const r = getPlan('sstest').exercises; delete r[2].group; delete r[3].group; r[0].group = r[1].group = 'gx'; saveState(); selectedPlan = 'sstest'; switchTab('trening'); renderTrening(); return true; })()`);

    console.log('== in a workout');
    await ev(`(ensureSession(getPlan('sstest')), renderTrening(), true)`); await wait(300);
    const wrapInfo = await ev(`(() => { const w = document.querySelectorAll('#exercise-list .superset'); return { n: w.length, ex: w[0] ? w[0].querySelectorAll('.exercise').length : -1,
      label: w[0] ? w[0].querySelector('.superset-label').textContent : '', total: document.querySelectorAll('#exercise-list .exercise').length,
      outside: Array.from(document.querySelectorAll('#exercise-list > .exercise')).length }; })()`);
    check('one .superset wrapper holds exactly the 2 grouped blocks, labelled "Superset A"', wrapInfo.n === 1 && wrapInfo.ex === 2 && wrapInfo.label === 'Superset A' && wrapInfo.total === 4 && wrapInfo.outside === 2, wrapInfo);
    const blk = (i) => `document.querySelectorAll('#exercise-list .exercise')[${i}]`;
    await ev(`(${blk(0)}.querySelectorAll('.sets .set-btn')[0].click(), true)`);
    check('completing set 1 of member 1 focuses set 1 of member 2', await ev(`document.activeElement === ${blk(1)}.querySelectorAll('.sets .set-btn')[0]`), await ev(`document.activeElement && document.activeElement.className`));
    await ev(`(document.activeElement.blur(), ${blk(1)}.querySelectorAll('.sets .set-btn')[0].click(), true)`);
    check('completing set 1 of the LAST member does not move focus into another exercise', await ev(`document.activeElement === document.body`), await ev(`document.activeElement.className`));
    await ev(`(${blk(0)}.querySelectorAll('.sets .set-btn')[1].click(), true)`);
    check('set 2 of member 1 focuses set 2 of member 2', await ev(`document.activeElement === ${blk(1)}.querySelectorAll('.sets .set-btn')[1]`));
    await ev(`(${blk(0)}.querySelectorAll('.sets .set-btn')[1].click(), true)`);   // un-tick: no jump
    await ev(`(${blk(0)}.querySelectorAll('.sets .set-btn')[1].click(), true)`);
    /* výmena člena 1 počas tréningu */
    await ev(`(${blk(0)}.querySelector('.btn-ex-more').click(), document.querySelector('#modal-ex-actions .exercise-swap').click(), true)`); await wait(200);
    await ev(`(applySubstitution('machine-chest-press'), true)`); await wait(300);
    const swapInfo = await ev(`(() => { const w = document.querySelectorAll('#exercise-list .superset'); return { n: w.length, ex: w[0] ? w[0].querySelectorAll('.exercise').length : -1, closed: w[0] ? w[0].querySelectorAll('.exercise-closed').length : -1,
      total: document.querySelectorAll('#exercise-list .exercise').length, names: w[0] ? Array.from(w[0].querySelectorAll('.exercise-name')).map((x) => x.textContent) : [] }; })()`);
    check('the replacement stays inside the wrapper (original closed + replacement + member 2)', swapInfo.n === 1 && swapInfo.ex === 3 && swapInfo.closed === 1 && swapInfo.total === 5, swapInfo);
    const subIdx = await ev(`Array.from(document.querySelectorAll('#exercise-list .exercise')).findIndex((e) => !e.classList.contains('exercise-closed') && e.dataset.slot === '0')`);
    check('the replacement block has set-done focus chain to member 2 (slot 1)', subIdx >= 0 && (await ev(`(() => { document.querySelectorAll('#exercise-list .exercise')[${subIdx}].querySelectorAll('.sets .set-btn')[2].click(); const t = document.activeElement; return !!t.closest('.exercise') && t.closest('.exercise').dataset.slot === '1' && t.classList.contains('set-btn'); })()`)));
    /* skončiť: história */
    await ev(`(document.querySelectorAll('#exercise-list .exercise')[${subIdx}].querySelectorAll('.sets .set-btn')[2].click(), true)`);
    const xpBefore = await ev(`workoutXpFor(totalSetsDone())`);
    const doneBefore = await ev(`totalSetsDone()`);
    await ev(`(finishWorkout(), confirmFinish(), true)`); await wait(300);
    const h = await ev(`state.history[state.history.length - 1]`);
    const gs = h.exercises.map((e) => e.group || null);
    check('history entries carry group (original, replacement and member 2), the ungrouped rows do not', typeof gs[0] === 'string' && gs[0] === gs[1] && gs[1] === gs[2] && gs[0] === 'gx', gs);
    check('history entries of ungrouped rows have no group field', h.exercises.slice(3).every((e) => !('group' in e)), h.exercises.map((e) => e.name));
    const stripped = await ev(`(() => { const c = JSON.parse(JSON.stringify(state.history[state.history.length - 1])); c.exercises.forEach((e) => delete e.group); return c; })()`);
    check('XP and sets done are the same as without groups', h.xp === xpBefore && (await ev(`historyDoneSets(state.history[state.history.length - 1]) === ${doneBefore} && historyDoneSets(${J(stripped)}) === ${doneBefore} && historyEntryXp(state.history[state.history.length - 1]) === historyEntryXp(${J(stripped)})`)), { xp: h.xp, xpBefore });
    check('personal records are the same as without groups', await ev(`(() => { const a = JSON.stringify(personalRecords()); const saved = state.history; state.history = saved.map((w) => { const c = JSON.parse(JSON.stringify(w)); c.exercises.forEach((e) => delete e.group); return c; }); const b = JSON.stringify(personalRecords()); state.history = saved; return a === b; })()`));
    await ev(`(document.getElementById('modal-result').hidden = true, switchTab('pokrok'), setPokrokView('progress'), true)`); await wait(300);
    const histBr = await ev(`(() => { const x = document.querySelectorAll('#history-list .hist-superset'); return { n: x.length, label: x[0] ? x[0].querySelector('.hist-superset-label').textContent : '' }; })()`);
    check('History list shows one bracket "Superset A" (2 slots, not "Circuit A") around the 3 adjacent entries (original + replacement + member 2)', histBr.n === 1 && histBr.label === 'Superset A', histBr);
    await ev(`(switchTab('kalendar'), openDay(todayISO()), true)`); await wait(300);
    const calBr = await ev(`(() => { const x = document.querySelectorAll('#modal-day .hist-superset'); return { n: x.length, label: x[0] ? x[0].querySelector('.hist-superset-label').textContent : '', inside: x[0] ? x[0].querySelectorAll('.day-ex').length : 0 }; })()`);
    check('Calendar day view shows the same "Superset A" bracket around 3 entries', calBr.n === 1 && calBr.label === 'Superset A' && calBr.inside === 3, calBr);
    await ev(`(closeDay(), true)`);
    const id = await ev(`state.history[state.history.length - 1].id`);
    await ev(`(() => { openHistoryEdit(${J(id)}); const inp = document.querySelector('#he-exercises .he-ex-row input[data-f="weight"]'); inp.value = '105'; inp.dispatchEvent(new Event('input')); saveHistoryEdit(); return true; })()`);
    check('editing the workout in history keeps group', J(await ev(`state.history.find((w) => w.id === ${J(id)}).exercises.map((e) => e.group || null)`)) === J(gs));
    check('entries that do not sit next to each other get no bracket', await ev(`(() => { const html = historyGroupWrap([{ group: 'a' }, {}, { group: 'a' }], ['x', 'y', 'z'], ''); return !html.includes('hist-superset'); })()`));
    check('a pair is a "Superset" in history', await ev(`historyGroupWrap([{ group: 'a' }, { group: 'a' }], ['x', 'y'], '').includes('Superset A')`));
    check('history: original + replacement + member 2 = 2 slots → one "Superset A" wrapper around all 3; 3 real slots → "Circuit A"', await ev(`(() => {
      const two = historyGroupWrap([{ group: 'a' }, { group: 'a', substitutedFor: 'X' }, { group: 'a' }], ['x', 'y', 'z'], '');
      const three = historyGroupWrap([{ group: 'a' }, { group: 'a' }, { group: 'a', substitutedFor: 'X' }, { group: 'a' }], ['w', 'x', 'y', 'z'], '');
      return two.includes('Superset A') && !two.includes('Circuit') && (two.match(/hist-superset"/g) || []).length === 1 && two.indexOf('x') < two.indexOf('</div>') && two.indexOf('z') < two.indexOf('</div>')
        && three.includes('Circuit A') && (three.match(/hist-superset"/g) || []).length === 1; })()`));
    check('no group → output is exactly as before', await ev(`historyGroupWrap([{}, {}], ['x', 'y'], '<br>') === 'x<br>y' && historyGroupWrap([{}, {}], ['x', 'y'], '') === 'xy'`));

    console.log('== focus mapping with one-sided and two-sided members');
    await ev(`(clearSession(), true)`);
    await ev(`(() => {
      state.plans['ssmix'] = { id: 'ssmix', builtin: false, customName: 'SS mix', location: null, exercises: [
        { id: 'cx-mixa', name: 'Bi A', sets: 3, reps: 8, weight: 20, group: 'm1' },
        { id: 'cx-mixu', name: 'Uni B', sets: 3, reps: 8, weight: 10, unilateral: true, startSide: 'left', group: 'm1' },
        { id: 'cx-mixv', name: 'Uni C', sets: 3, reps: 8, weight: 10, unilateral: true, startSide: 'right', group: 'm1' },
        { id: 'cx-mixs', name: 'Short D', sets: 1, reps: 8, weight: 10, group: 'm1' }] };
      state.planOrder.push('ssmix'); selectedPlan = 'ssmix'; switchTab('trening'); saveState(); ensureSession(getPlan('ssmix')); renderTrening(); return true; })()`); await wait(250);
    const sb = (m, k) => `document.querySelectorAll('#exercise-list .exercise')[${m}].querySelectorAll('.sets .set-item')[${k}].querySelector('.set-btn')`;
    const click = (m, k) => ev(`(document.activeElement.blur(), ${sb(m, k)}.click(), true)`);
    const focused = (m, k) => ev(`document.activeElement === ${sb(m, k)}`);
    await click(0, 1);   // bilateral set 2 → unilateral B: set 2, first side (left) = item 2
    check('bilateral set 2 → unilateral set 2, first side (item index 2, not R1)', await focused(1, 2), await ev(`document.activeElement.closest('.set-item') && document.activeElement.closest('.set-item').textContent.slice(0, 6)`));
    await click(1, 3);   // B: set 2 right → C (start right): set 2 right = item 2
    check('unilateral R2 → unilateral set 2, same side (right)', await focused(2, 2));
    await click(1, 2);   // B L2 → C: set 2 left = item 3
    check('unilateral L2 → unilateral set 2, same side (left)', await focused(2, 3));
    await click(2, 3);   // C L2 → short bilateral D has 1 set → no focus move
    check('target member with fewer sets: focus does not move', await ev(`document.activeElement === document.body`), await ev(`document.activeElement.className`));
    await ev(`(document.activeElement.blur(), true)`);
    await ev(`(clearSession(), true)`);
    await ev(`(() => { const r = getPlan('ssmix').exercises; r.reverse(); r.forEach((x) => { x.group = 'm2'; }); saveState(); ensureSession(getPlan('ssmix')); renderTrening(); return true; })()`); await wait(250);
    await click(2, 5);   // order now D(1 set), C, B, A: B (index 2) is unilateral; set bilateral A is last. B R3 → A set 3
    check('unilateral R3 → bilateral set 3 (not flat index 5)', await focused(3, 2), await ev(`document.activeElement.className`));
    await ev(`(clearSession(), true)`);

    console.log('== plan without groups');
    await ev(`(() => { selectedPlan = 'ssplain'; switchTab('trening'); renderTrening(); return true; })()`); await wait(200);
    await ev(`(ensureSession(getPlan('ssplain')), renderTrening(), true)`); await wait(200);
    check('no .superset in the DOM, 4 blocks as direct children, no data-slot', await ev(`document.querySelectorAll('#exercise-list .superset').length === 0 && document.querySelectorAll('#exercise-list > .exercise').length === 4 && !document.querySelector('#exercise-list [data-slot]')`));
    await ev(`(document.activeElement.blur(), document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.sets .set-btn')[0].click(), true)`);
    check('completing a set in an ungrouped plan moves no focus (nothing focused)', await ev(`document.activeElement === document.body`), await ev(`document.activeElement.className`));
    await ev(`(clearSession(), saveState(), true)`);

    console.log('== looks: 6 languages, RTL, 390 px, themes');
    await ev(`(() => { selectedPlan = 'sstest'; switchTab('trening'); renderTrening(); ensureSession(getPlan('sstest')); renderTrening(); return true; })()`); await wait(300);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const texts = {};
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await ev(`(setLang(${J(lang)}), renderTrening(), true)`);
      const x = await ev(`(() => { const w = document.querySelector('#exercise-list .superset'); const cs = getComputedStyle(w); const rtl = document.documentElement.dir === 'rtl';
        return { label: w.querySelector('.superset-label').textContent, link: t('superset.link'), unlink: t('superset.unlink'), circuit: t('superset.circuit', { l: 'A' }),
          startW: parseFloat(cs.borderInlineStartWidth), left: parseFloat(cs.borderLeftWidth), right: parseFloat(cs.borderRightWidth), rtl,
          overflow: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
      texts[lang] = x.label + '|' + x.link + '|' + x.unlink + '|' + x.circuit;
      const bracketSide = x.rtl ? (x.right > 0 && x.left === 0) : (x.left > 0 && x.right === 0);
      check(lang + ': label translated, bracket on the ' + (x.rtl ? 'right' : 'left') + ', no overflow at 390 px', !/superset\.|circuit\./.test(texts[lang]) && x.label.includes('A') && x.startW > 0 && bracketSide && !x.overflow, x);
    }
    check('texts differ in all 6 languages', new Set(Object.values(texts)).size === 6, texts);
    await ev(`(setLang('en'), true)`);
    check('verifyI18n: nothing missing for superset.* / circuit.*', await ev(`LANG_CODES.every((l) => ['superset.label', 'superset.circuit', 'superset.link', 'superset.unlink'].every((k) => I18N[l][k] !== undefined))`));
    for (const theme of ['light', 'dark']) {
      await ev(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), document.querySelector('#exercise-list .superset').scrollIntoView({ block: 'center' }), true)`); await wait(250);
      check(theme + ' 390 px: wrapper inside the screen, no overflow', await ev(`(() => { const r = document.querySelector('#exercise-list .superset').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; })()`));
      const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'supersets-' + theme + '-390.png'), Buffer.from(s.data, 'base64'));
    }
    await ev(`(document.documentElement.removeAttribute('data-theme'), true)`);
    /* editor v arabčine: bracket je na pravej strane */
    await ev(`(clearSession(), setLang('ar'), startEditPlan('sstest'), true)`); await wait(200);
    check('ar plan editor: bracket border on the right', await ev(`(() => { const r = document.querySelector('#edit-rows .edit-row.in-group'); if (!r) return false; const cs = getComputedStyle(r); return parseFloat(cs.borderRightWidth) > 2 && parseFloat(cs.borderLeftWidth) <= 2 || parseFloat(cs.borderInlineStartWidth) > 2; })()`));
    await ev(`(setLang('en'), cancelEditPlan(), true)`);
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
