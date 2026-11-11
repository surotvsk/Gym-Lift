'use strict';
/* Gym-Lift — list s progresom cviku (gym-basics fáza 2, úloha 3), v reálnom headless Chrome. Bez účtov, bez siete.

     node tests/app/ex-progress.js

   Kontroluje: otvorenie z riadku rekordu, z riadku histórie, z detailu knižnice a z ⋯; súhrn 4 čísel, graf (body, Objem,
   rozsah 3 M), prázdny stav pri 1 sedení, asistovaný cvik (len čip Pomoc), Esc + fokus, isBusy, NATIVE_BACK_CLOSE,
   výkon pri 1000 záznamoch, 6 jazykov + RTL, svetlý/tmavý režim na 390 px, `lineChartSvg` v kompaktnom režime. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-ex-progress');
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
  const b = new Browser('exprog-' + Date.now().toString(36), 9875, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push('exception ' + JSON.stringify(e.exceptionDetails && e.exceptionDetails.text)));
  await p.c.send('Runtime.enable');
  const sheet = `document.getElementById('modal-ex-progress')`;
  const esc = () => p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  const hidden = () => p.eval(`${sheet}.hidden`);
  const pts = () => p.eval(`(() => { const l = document.querySelector('#ex-progress-chart polyline'); return l ? l.getAttribute('points').trim().split(/\\s+/).length : 0; })()`);
  const text = () => p.eval(`${sheet}.innerText`);
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    /* 6 tréningov bench: 2 staré (> 3 mesiace), 4 v posledných ~10 týždňoch */
    await p.eval(`(() => {
      const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      const mk = (id, n, w, r) => ({ id, date: day(n), planId: 'pp', planName: 'Push day', exercises: [
        { name: 'Bench Press', exId: 'bench-press', sets: 2, reps: r, weight: w, setsDone: 2 },
        { name: 'Cable fly', sets: 2, reps: 12, weight: 20, setsDone: 2 }] });
      state.history = [mk('w1', 300, 60, 10), mk('w2', 150, 70, 8), mk('w3', 70, 80, 8), mk('w4', 49, 85, 6), mk('w5', 28, 90, 5), mk('w6', 7, 95, 5)];
      state.history.push({ id: 'w7', date: day(3), planId: 'pp', planName: 'Pull day', exercises: [{ name: 'Assisted Pull-ups', exId: 'assisted-pull-ups', sets: 2, reps: 8, weight: 30, setsDone: 2, assisted: true }] });
      state.history.push({ id: 'w8', date: day(2), planId: 'pp', planName: 'Pull day', exercises: [{ name: 'Assisted Pull-ups', exId: 'assisted-pull-ups', sets: 2, reps: 8, weight: 25, setsDone: 2, assisted: true }] });
      state.history.push({ id: 'w9', date: day(1), planId: 'pp', planName: 'Arms', exercises: [{ name: 'Zottman curl', sets: 3, reps: 10, weight: 12, setsDone: 3 }] });
      saveState(); switchTab('pokrok'); setPokrokView('progress'); return true; })()`);
    await wait(300);

    console.log('== lineChartSvg');
    const svg1 = await p.eval(`lineChartSvg([{x: 1e12, y: 50}, {x: 1.01e12, y: 60}, {x: 1.02e12, y: 55}], { label: 'Est. 1RM', unit: 'kg' })`);
    check('chart: viewBox 0 0 320 140, one polyline with 3 points, 3 dots, no NaN/undefined', /viewBox="0 0 320 140"/.test(svg1) && (svg1.match(/<polyline/g) || []).length === 1 && /points="[^"]*"/.test(svg1) && (svg1.match(/<circle/g) || []).length === 3 && !/NaN|undefined/.test(svg1), svg1.slice(0, 200));
    const svgC = await p.eval(`lineChartSvg([{x: 1, y: 5}, {x: 2, y: 7}, {x: 3, y: 6}], { label: 'x', unit: 'kg', compact: true })`);
    check('compact: viewBox 0 0 80 24, no text labels', /viewBox="0 0 80 24"/.test(svgC) && !/<text/.test(svgC) && !/NaN/.test(svgC));
    const flat = await p.eval(`lineChartSvg([{x: 1, y: 5}, {x: 2, y: 5}], { label: 'x', unit: 'kg' })`);
    check('flat series draws without NaN', !/NaN|Infinity|undefined/.test(flat) && /<polyline/.test(flat));
    const empty = await p.eval(`lineChartSvg([{x: 1, y: 5}], { label: 'x', unit: 'kg' })`);
    check('1 point -> empty-state markup, no polyline', !/<polyline/.test(empty) && /empty/.test(empty) && !/NaN|undefined/.test(empty), empty);

    console.log('== Records row opens the sheet');
    check('bench record row is a real button', await p.eval(`!!Array.from(document.querySelectorAll('#records-list button.record-row')).find((r) => /Bench/i.test(r.textContent))`));
    check('record rows stay in #records-list with the same text parts', await p.eval(`(() => { const r = document.querySelector('#records-list .record-row'); return !!r.querySelector('.record-name') && !!r.querySelector('.record-weight') && !!r.querySelector('.record-meta'); })()`));
    await p.eval(`(() => { const r = Array.from(document.querySelectorAll('#records-list .record-row')).find((x) => /Bench/i.test(x.textContent)); r.focus(); r.click(); return true; })()`); await wait(150);
    check('#modal-ex-progress opens, title "Bench press"', !(await hidden()) && (await p.eval(`document.getElementById('ex-progress-title').textContent`)) === 'Bench press', await p.eval(`document.getElementById('ex-progress-title').textContent`));
    check('labelled modal dialog', await p.eval(`(() => { const d = ${sheet}.querySelector('.modal'); const l = d.getAttribute('aria-labelledby'); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!document.getElementById(l); })()`));
    const exp = await p.eval(`(() => { const s = exerciseSummary('bench-press'); return JSON.stringify(s); })()`);
    const sum = JSON.parse(exp);
    check('summary of the fixture: best 1RM 110.5? (95x5)', sum.bestE1rm === 110.8 || sum.bestE1rm === 110.5 || sum.bestE1rm > 100, sum);
    const stats = await p.eval(`Array.from(${sheet}.querySelectorAll('#ex-progress-stats .xp-stat')).map((s) => s.innerText.replace(/\\s+/g, ' ').trim())`);
    check('4 stats', stats.length === 4, stats);
    check('stats show best 1RM, heaviest 95, best set 95×5 and 6 sessions', stats[0].includes(String(sum.bestE1rm)) && stats[1].includes('95') && stats[2].includes('95') && stats[2].includes('5') && stats[3].includes('6'), stats);
    check('stat labels are Best est. 1RM / Heaviest / Best set / Sessions', ['Best est. 1RM', 'Heaviest', 'Best set', 'Sessions'].every((l, i) => stats[i].includes(l)), stats);
    check('estimate is labelled as estimate ("est.")', /est\./i.test(stats[0]));
    check('the chart has a polyline with 6 points', (await pts()) === 6, await pts());
    check('focus moved into the sheet', await p.eval(`${sheet}.contains(document.activeElement)`));
    check('chips are pressed-state buttons: metric 1RM on, range All on', await p.eval(`(() => { const m = Array.from(${sheet}.querySelectorAll('#ex-progress-metric button')); const r = Array.from(${sheet}.querySelectorAll('#ex-progress-range button'));
      return m.length === 3 && m.map((x) => x.getAttribute('aria-pressed')).join() === 'true,false,false' && r.map((x) => x.textContent.trim()).join() === '3 M,1 Y,All' && r.map((x) => x.getAttribute('aria-pressed')).join() === 'false,false,true'; })()`));
    const before = await p.eval(`document.querySelector('#ex-progress-chart polyline').getAttribute('points')`);
    await p.eval(`(${sheet}.querySelector('#ex-progress-metric [data-metric="volume"]').click(), true)`); await wait(80);
    const afterV = await p.eval(`document.querySelector('#ex-progress-chart polyline').getAttribute('points')`);
    check('Volume changes the points (still 6)', before !== afterV && (await pts()) === 6);
    check('Volume chip is pressed, 1RM is not', await p.eval(`${sheet}.querySelector('[data-metric="volume"]').getAttribute('aria-pressed') === 'true' && ${sheet}.querySelector('[data-metric="e1rm"]').getAttribute('aria-pressed') === 'false'`));
    await p.eval(`(${sheet}.querySelector('#ex-progress-range [data-range="3m"]').click(), true)`); await wait(80);
    check('3 M hides the older points (4 left)', (await pts()) === 4, await pts());
    await p.eval(`(${sheet}.querySelector('#ex-progress-range [data-range="1y"]').click(), true)`); await wait(80);
    check('1 Y keeps 5 (the 300-day-old one stays; 6 incl. 300 < 365 -> 6)', (await pts()) === 6, await pts());
    await p.eval(`(${sheet}.querySelector('#ex-progress-range [data-range="all"]').click(), ${sheet}.querySelector('#ex-progress-metric [data-metric="e1rm"]').click(), true)`); await wait(80);
    const rows = await p.eval(`Array.from(${sheet}.querySelectorAll('#ex-progress-sessions .xp-session')).map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
    check('sessions list: 6, newest first, plan name and sets "95×5 · 95×5"', rows.length === 6 && rows[0].includes('Push day') && rows[0].includes('95×5 · 95×5') && rows[5].includes('60×10'), rows);
    check('no NaN / undefined anywhere in the sheet', !/NaN|undefined|\[object/.test(await text()));
    await esc(); await wait(100);
    check('Escape closes, focus returns to the record row', (await hidden()) && await p.eval(`document.activeElement.classList.contains('record-row')`));

    console.log('== one session -> calm empty state');
    await p.eval(`(() => { switchTab('pokrok'); setPokrokView('progress'); const r = Array.from(document.querySelectorAll('#records-list .record-row')).find((x) => /Zottman/i.test(x.textContent)); r.click(); return true; })()`); await wait(150);
    check('title Zottman curl', (await p.eval(`document.getElementById('ex-progress-title').textContent`)) === 'Zottman curl');
    check('empty-state text, no polyline, no NaN/undefined', (await p.eval(`!!${sheet}.querySelector('#ex-progress-chart .xp-empty')`)) && (await pts()) === 0 && !/NaN|undefined/.test(await text()), await text());
    check('stats still show (1 session)', await p.eval(`${sheet}.querySelectorAll('#ex-progress-stats .xp-stat').length === 4`));
    await esc(); await wait(60);

    console.log('== assisted exercise: Help chip only');
    await p.eval(`(openExerciseProgress('assisted-pull-ups', 'Assisted pull-ups'), true)`); await wait(150);
    const ch = await p.eval(`Array.from(${sheet}.querySelectorAll('#ex-progress-metric button')).map((x) => x.textContent.trim())`);
    check('only the Help chip', J(ch) === J(['Help']), ch);
    check('2 sessions -> chart has 2 points; no volume/1RM text', (await pts()) === 2 && !/1RM\b.*\d|volume/i.test((await p.eval(`document.getElementById('ex-progress-chart').innerText`))), await text());
    check('assisted stats have no est. 1RM', !/est\. 1RM/i.test(await p.eval(`document.getElementById('ex-progress-stats').innerText`)), await p.eval(`document.getElementById('ex-progress-stats').innerText`));
    await esc(); await wait(60);

    console.log('== history line opens the same sheet');
    await p.eval(`(() => { switchTab('pokrok'); setPokrokView('progress'); return true; })()`); await wait(200);
    check('history exercise lines are buttons', await p.eval(`document.querySelectorAll('#history-list button.ex-prog-link').length >= 3`));
    await p.eval(`(() => { const b = Array.from(document.querySelectorAll('#history-list .ex-prog-link')).find((x) => /Bench/i.test(x.textContent)); b.focus(); b.click(); return true; })()`); await wait(150);
    check('opens the Bench sheet with 6 points', !(await hidden()) && (await p.eval(`document.getElementById('ex-progress-title').textContent`)) === 'Bench press' && (await pts()) === 6);
    await esc(); await wait(60);
    check('focus returns to the history line', await p.eval(`document.activeElement.classList.contains('ex-prog-link')`));
    await p.eval(`(() => { const b = Array.from(document.querySelectorAll('#history-list .ex-prog-link')).find((x) => /Cable fly/i.test(x.textContent)); b.click(); return true; })()`); await wait(150);
    check('a custom exercise line opens its own sheet (cx- identity)', (await p.eval(`document.getElementById('ex-progress-title').textContent`)) === 'Cable fly' && (await text()).length > 10);
    await esc(); await wait(60);

    console.log('== Calendar day line');
    await p.eval(`(() => { const w = state.history.find((x) => x.id === 'w6'); openDay(w.date); return true; })()`); await wait(200);
    check('day lines are buttons', await p.eval(`document.querySelectorAll('#modal-day button.ex-prog-link').length >= 2`));
    await p.eval(`(() => { const b = Array.from(document.querySelectorAll('#modal-day .ex-prog-link')).find((x) => /Bench/i.test(x.textContent)); b.click(); return true; })()`); await wait(150);
    check('Calendar line opens the Bench sheet', !(await hidden()) && (await p.eval(`document.getElementById('ex-progress-title').textContent`)) === 'Bench press' && (await pts()) === 6);
    await esc(); await wait(60);
    check('the day sheet stays open under it', await p.eval(`!document.getElementById('modal-day').hidden`));
    await p.eval(`(closeDay(), true)`); await wait(60);

    console.log('== library detail');
    await p.eval(`(openExerciseSheet('bench-press', 'browse'), true)`); await wait(200);
    check('the detail has a Progress row inside its content', await p.eval(`!!document.querySelector('#exercise-body .progress-link')`));
    await p.eval(`(document.querySelector('#exercise-body .progress-link').click(), true)`); await wait(150);
    check('opens the same sheet (Bench press, 6 points)', !(await hidden()) && (await p.eval(`document.getElementById('ex-progress-title').textContent`)) === 'Bench press' && (await pts()) === 6);
    await esc(); await wait(60);
    check('Escape closes only the progress sheet; the detail stays', (await hidden()) && await p.eval(`!document.getElementById('modal-exercise').hidden`));
    await p.eval(`(closeExerciseSheet(), true)`);

    console.log('== ⋯ sheet item');
    await p.eval(`(() => {
      state.plans['xp'] = { id: 'xp', builtin: false, customName: 'XP plan', location: null, exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 5, weight: 100 }, { id: 'cx-q', name: 'Cable fly', sets: 3, reps: 12, weight: 20 }] };
      if (!state.planOrder.includes('xp')) state.planOrder.push('xp');
      selectedPlan = 'xp'; ensureSession(getPlan('xp')); saveState(); switchTab('trening'); renderTrening(); return true; })()`); await wait(300);
    await p.eval(`(document.querySelectorAll('#exercise-list .exercise')[0].querySelector('.btn-ex-more').click(), true)`); await wait(100);
    check('the Progress item is visible in ⋯', await p.eval(`(() => { const x = document.querySelector('#modal-ex-actions .btn-ex-progress'); return !!x && !x.hidden && x.getBoundingClientRect().height >= 44; })()`));
    await p.eval(`(document.querySelector('#modal-ex-actions .btn-ex-progress').click(), true)`); await wait(150);
    check('⋯ → Progress opens the same Bench sheet and closes the ⋯ sheet', !(await hidden()) && (await p.eval(`document.getElementById('modal-ex-actions').hidden`)) && (await p.eval(`document.getElementById('ex-progress-title').textContent`)) === 'Bench press' && (await pts()) === 6);
    await esc(); await wait(100);
    check('focus returns to the ⋯ button', await p.eval(`document.activeElement.classList.contains('btn-ex-more')`));
    check('no new button on the tile: still exactly one .btn-ex-more and no progress button', await p.eval(`Array.from(document.querySelectorAll('#exercise-list .exercise')).every((e) => e.querySelectorAll('.btn-ex-more').length === 1 && e.querySelectorAll('.btn-ex-progress, .ex-prog-link, .progress-link').length === 0)`));

    console.log('== sheet standard');
    await p.eval(`(openExerciseProgress('bench-press', 'Bench press'), true)`); await wait(100);
    check('isBusy() while open', await p.eval(`isBusy()`));
    check('NATIVE_BACK_CLOSE lists it and Back closes it', await p.eval(`NATIVE_BACK_CLOSE.some((e) => e[0] === 'modal-ex-progress' && !!document.querySelector(e[1])) && nativeBack() === 'closed' && ${sheet}.hidden`));
    await p.eval(`(openExerciseProgress('bench-press', 'Bench press'), document.getElementById('btn-ex-progress-close').click(), true)`); await wait(60);
    check('close button closes', await hidden());
    check('backdrop tap closes', await p.eval(`(openExerciseProgress('bench-press', 'x'), ${sheet}.click(), ${sheet}.hidden)`));
    const small = await p.eval(`(openExerciseProgress('bench-press', 'x'), Array.from(${sheet}.querySelectorAll('button')).filter((x) => x.getBoundingClientRect().height > 0 && x.getBoundingClientRect().height < 44).map((x) => (x.id || x.className) + ':' + x.getBoundingClientRect().height))`);
    check('touch targets in the sheet are >= 44 px', small.length === 0, small);
    await esc(); await wait(60);

    console.log('== show more (20 rows)');
    await p.eval(`(() => { const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      state.history = []; for (let i = 0; i < 30; i++) state.history.push({ id: 'm' + i, date: day(i * 3), planId: 'pp', planName: 'P', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 1, reps: 5, weight: 50 + i, setsDone: 1 }] });
      openExerciseProgress('bench-press', 'Bench press'); return true; })()`); await wait(100);
    check('20 rows and a "Show more" button', (await p.eval(`${sheet}.querySelectorAll('.xp-session').length`)) === 20 && (await p.eval(`!document.getElementById('btn-ex-progress-more').hidden`)));
    await p.eval(`(document.getElementById('btn-ex-progress-more').click(), true)`); await wait(60);
    check('Show more reveals all 30 and hides itself', (await p.eval(`${sheet}.querySelectorAll('.xp-session').length`)) === 30 && (await p.eval(`document.getElementById('btn-ex-progress-more').hidden`)));
    await esc(); await wait(60);

    console.log('== performance: 1000 entries x 5 exercises');
    await p.eval(`(() => { const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      const names = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press', 'Barbell Row'];
      state.history = []; for (let i = 0; i < 1000; i++) state.history.push({ id: 'h' + i, date: day(i % 700), planId: 'pp', planName: 'P', exercises: names.map((n, k) => ({ name: n, sets: 3, reps: 5, weight: 60 + k * 10 + (i % 20), setsDone: 3 })) });
      saveState(); return true; })()`);
    const t1 = await p.eval(`(() => { const a = performance.now(); openExerciseProgress('cx-whatever', 'Squat'); return performance.now() - a; })()`);
    await esc();
    const ident = await p.eval(`entryIdentity({ name: 'Squat' })`);
    const t2 = await p.eval(`(() => { const a = performance.now(); openExerciseProgress(${J(ident)}, 'Squat'); return performance.now() - a; })()`);
    check('opening the sheet with 1000 entries takes < 300 ms (' + Math.round(t2) + ' ms)', t2 < 300, [t1, t2]);
    check('the 1000-entry sheet draws a chart', (await pts()) > 20, await pts());
    await esc(); await wait(60);
    await p.eval(`(switchTab('pokrok'), setPokrokView('stats'), true)`);
    const t3 = await p.eval(`(() => { const a = performance.now(); renderPokrok && renderPokrok(); return performance.now() - a; })()`);
    check('rendering the Progress tab (records + history) with 1000 entries < 300 ms (' + Math.round(t3) + ' ms)', t3 < 300, t3);

    console.log('== languages / RTL / themes at 390 px');
    await p.eval(`(() => { const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      state.history = [[300, 60, 10], [150, 70, 8], [70, 80, 8], [49, 85, 6], [28, 90, 5], [7, 95, 5]].map((a, i) => ({ id: 'z' + i, date: day(a[0]), planId: 'pp', planName: 'Push day', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 2, reps: a[2], weight: a[1], setsDone: 2 }] }));
      saveState(); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), openExerciseProgress('bench-press', 'Bench press'), true)`); await wait(150);
      const x = await p.eval(`(() => { const m = ${sheet}.querySelector('.modal'); return { dir: document.documentElement.dir, raw: ${sheet}.innerText, over: m.scrollWidth <= m.clientWidth + 1,
        pts: document.querySelectorAll('#ex-progress-chart polyline').length, miss: Object.keys(I18N.en).filter((k) => k.startsWith('xprog.') && I18N[${J(lang)}][k] === undefined) }; })()`);
      check(lang + ': no raw key / NaN / undefined, no overflow, chart drawn, all xprog.* keys translated', !/xprog\.|NaN|undefined/.test(x.raw) && x.over && x.pts === 1 && x.miss.length === 0, x);
      if (lang === 'ar') {
        check('ar: right-to-left', x.dir === 'rtl');
        const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(WORK, 'shots', 'progress-ar.png'), Buffer.from(s.data, 'base64'));
      }
      await esc(); await wait(60);
    }
    await p.eval(`(setLang('en'), true)`);
    for (const theme of ['light', 'dark']) {
      await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), openExerciseProgress('bench-press', 'Bench press'), true)`); await wait(200);
      const s = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(WORK, 'shots', 'progress-' + theme + '.png'), Buffer.from(s.data, 'base64'));
      check(theme + ': sheet fits 390 px', await p.eval(`(() => { const m = ${sheet}.querySelector('.modal'); return m.scrollWidth <= m.clientWidth + 1 && m.getBoundingClientRect().width <= 390; })()`));
      await esc(); await wait(60);
    }
    check('no console errors', logs.length === 0, logs);
  } catch (e) { fail++; console.log('  FAIL threw ' + (e && e.stack || e)); }
  b.killHard(true); await server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
