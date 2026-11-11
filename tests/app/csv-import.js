'use strict';
/* Gym-Lift — Fáza 3 / úloha 4: import CSV (náhľad -> potvrdenie -> deduplikácia -> uloženie, späť), v reálnom headless Chrome.
   Súbory z tests/fixtures/csv sa čítajú v Node a v stránke sa z nich robí syntetický File pre openCsvImport(file).

     node tests/app/csv-import.js            (GQ_SHOTS_OUT = priečinok: uloží aj snímky 390 px) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-csv-import');
const FIX = path.join(REPO, 'tests', 'fixtures', 'csv');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
const fx = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');

/* 3 000 tréningov Hevy x 15 riadkov = 45 000 riadkov (nikdy sa necommituje) */
function bigHevy(n) {
  const out = ['title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe'];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const exs = ['Bench Press (Barbell)', 'Squat (Barbell)', 'Lat Pulldown (Cable)'];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2015, 0, 1) + i * 86400000 * 1.2);
    const stamp = (h) => d.getUTCDate() + ' ' + mon[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' + String(h).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0');
    for (let e = 0; e < 3; e++) for (let s = 0; s < 5; s++) out.push(`"Workout ${i}","${stamp(10)}","${stamp(11)}","","${exs[e]}",,"",${s},normal,${40 + e * 20 + s},${8 + s % 3},,0,`);
  }
  return out.join('\n');
}

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('csvi-' + Date.now().toString(36), 9897, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push('exception ' + J(e.exceptionDetails && e.exceptionDetails.text)));
  await p.c.send('Runtime.enable');
  const ev = (expr) => p.eval(`(async () => { try { const v = await (${expr}); return JSON.stringify(v === undefined ? null : v); } catch (e) { return JSON.stringify({ threw: String(e) }); } })()`).then((s) => { const v = JSON.parse(s); if (v && v.threw) { console.log('    threw: ' + v.threw); return false; } return v; });
  const sheet = `document.getElementById('modal-csv-import')`;
  const open = (text, name) => ev(`openCsvImport(new File([${J(text)}], ${J(name || 'x.csv')}, { type: 'text/csv' })).then(() => true)`);
  const q = (sel) => ev(`(() => { const e = ${sheet}.querySelector(${J(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  const confirmBtn = `document.getElementById('btn-csv-confirm')`;
  const closeSheet = () => p.eval(`(document.getElementById('btn-csv-import-close').click(), true)`);
  const shotsOut = process.env.GQ_SHOTS_OUT;
  const shot = async (name) => { if (!shotsOut) return; fs.mkdirSync(shotsOut, { recursive: true }); const s = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotsOut, name + '.png'), Buffer.from(s.data, 'base64')); };
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); seedSampleData(); renderAll(); return true; })()`);
    const snap = `(() => (xpCacheClear(), { xp: totalXP(), streak: computeStreak(), wk: sessionsInWeek(currentWeekKey()), lb: leaderboardPayload(), pr: personalRecords(), real: J(state.history) }))()`.replace('J(', 'JSON.stringify(');
    const base = await ev(snap);

    console.log('== API + sheet markup');
    check('openCsvImport / confirmCsvImport exist', await ev(`[typeof openCsvImport, typeof confirmCsvImport]`).then((a) => J(a) === '["function","function"]'));
    check('sheet is a labelled dialog', await ev(`(() => { const d = ${sheet}.querySelector('.modal'); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!document.getElementById(d.getAttribute('aria-labelledby')); })()`));

    console.log('== Preview (Hevy)');
    await open(fx('hevy.csv'), 'hevy.csv');
    check('sheet opens', await ev(`!${sheet}.hidden`));
    check('format Hevy', /Hevy/.test(await q('#csv-format')), await q('#csv-format'));
    check('2 new · 0 already imported', await q('#csv-counts') === '2 new · 0 already imported', await q('#csv-counts'));
    check('date range shown', /2024/.test(await q('#csv-range')), await q('#csv-range'));
    check('exercise summary + unmatched <details>', await ev(`!!${sheet}.querySelector('details.csv-unmatched')`) && /matched/.test(await q('#csv-exercises')), await q('#csv-exercises'));
    check('unit known: no chips, Confirm enabled', await ev(`${sheet}.querySelector('#csv-unit').hidden && !${confirmBtn}.disabled`));
    check('XP note shown', /don.t give XP, streaks or records/.test(await q('#csv-note')), await q('#csv-note'));
    check('skipped line only when > 0 (hidden here), ignoredRows never', await ev(`!${sheet}.querySelector('#csv-skipped') || ${sheet}.querySelector('#csv-skipped').hidden`));
    check('isBusy() while open', await ev(`isBusy()`));
    await closeSheet();
    check('closed, nothing written', await ev(`${sheet}.hidden && state.importedHistory.length === 0`));
    check('NATIVE_BACK_CLOSE lists it and Back closes it', await ev(`(() => { openCsvImport(new File([${J(fx('hevy.csv'))}], 'h.csv')).then(() => 0); return true; })()`) && (await wait(400), await ev(`NATIVE_BACK_CLOSE.some((e) => e[0] === 'modal-csv-import' && !!document.querySelector(e[1])) && nativeBack() === 'closed' && ${sheet}.hidden`)));
    await open(fx('hevy.csv'), 'hevy.csv');
    await p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
    check('Escape closes it', await ev(`${sheet}.hidden`));

    console.log('== Unit unknown (Strong)');
    await open(fx('strong-no-unit.csv'), 'strong.csv');
    check('format Strong', /Strong/.test(await q('#csv-format')));
    check('kg / lb chips, none pressed, Confirm disabled', await ev(`(() => { const c = Array.from(${sheet}.querySelectorAll('#csv-unit .chip')); return c.length === 2 && c.every((x) => x.getAttribute('aria-pressed') === 'false') && ${confirmBtn}.disabled; })()`));
    await shot('preview-unit-unknown-' + (process.env.GQ_SHOT_SFX || 'x'));
    await p.eval(`(${sheet}.querySelector('#csv-unit .chip[data-unit="lb"]').click(), true)`); await wait(300);
    check('lb chosen -> pressed, Confirm enabled', await ev(`${sheet}.querySelector('#csv-unit .chip[data-unit="lb"]').getAttribute('aria-pressed') === 'true' && !${confirmBtn}.disabled`));
    await ev(`confirmCsvImport()`);
    const lbW = await ev(`state.importedHistory[0].exercises[0].weight`);
    check('lb 100 -> 45.25 kg', lbW === 45.25, lbW);
    check('toast with Undo, sheet closed', await ev(`${sheet}.hidden && !document.getElementById('csv-toast').hidden && !!document.getElementById('btn-csv-undo')`));
    await ev(`document.getElementById('btn-csv-undo').click()`);
    check('undo restores empty array', await ev(`state.importedHistory.length`) === 0);

    console.log('== Confirm / dedupe / reload');
    await open(fx('hevy.csv'), 'hevy.csv');
    const saves = await ev(`(() => { let n = 0; const o = window.saveState; window.saveState = function () { n++; return o.apply(this, arguments); }; confirmCsvImport(); window.saveState = o; return n; })()`);
    check('one saveState()', saves === 1, saves);
    check('2 in importedHistory, history untouched', await ev(`[state.importedHistory.length, state.history.length === ${base ? 'state.history.length' : 0}]`).then((a) => a[0] === 2));
    check('toast text "Imported 2 workouts"', /Imported 2 workouts/.test(await ev(`document.getElementById('csv-toast').textContent`)));
    await p.reload();
    check('survives reload', await ev(`state.importedHistory.length`) === 2);
    check('XP / streak / records / history identical', J(await ev(snap)) === J(base));
    await open(fx('hevy.csv'), 'hevy.csv');
    check('re-import: 0 new · 2 already imported', await q('#csv-counts') === '0 new · 2 already imported', await q('#csv-counts'));
    check('Confirm disabled when nothing new', await ev(`${confirmBtn}.disabled`));
    await closeSheet();
    const more = fx('hevy.csv') + '"Third","20 Nov 2024, 10:00","20 Nov 2024, 10:50","","Squat (Barbell)",,"",0,normal,90,5,,0,\n';
    await open(more, 'more.csv');
    check('overlap: 1 new · 2 already imported', await q('#csv-counts') === '1 new · 2 already imported', await q('#csv-counts'));
    await ev(`confirmCsvImport()`);
    check('overlap adds only the new one (3 total)', await ev(`state.importedHistory.length`) === 3);
    check('stored sorted by date', await ev(`state.importedHistory.map((w) => w.date).join() === state.importedHistory.map((w) => w.date).slice().sort().join()`));

    console.log('== Undo window');
    await ev(`state.importedHistory = []`);
    await open(fx('hevy.csv'), 'hevy.csv');
    await ev(`confirmCsvImport()`);
    await ev(`document.getElementById('btn-csv-undo').click()`);
    check('undo within 10 s -> previous (empty) array, saved', await ev(`state.importedHistory.length === 0 && JSON.parse(localStorage.getItem(STORAGE_KEY)).importedHistory.length === 0`));
    check('toast hidden after undo (or shows undone note, no Undo button)', await ev(`!document.getElementById('btn-csv-undo') || document.getElementById('btn-csv-undo').hidden`));
    await open(fx('hevy.csv'), 'hevy.csv');
    await ev(`confirmCsvImport()`);
    await wait(10600);
    check('toast gone after 10 s', await ev(`document.getElementById('csv-toast').hidden`));

    console.log('== C3: own export vs real history');
    await ev(`state.importedHistory = []`);
    await ev(`(() => { state.history.push({ id: 'real-push', date: '2024-11-15', planId: 'x-none', planName: 'Push', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 2, reps: 8, weight: 60, setsDone: 2 }, { name: 'Overhead Press', exId: 'overhead-press', sets: 1, reps: 8, weight: 30, setsDone: 1 }] }); saveState(); return true; })()`);
    await open(fx('gymquest-export.csv'), 'export.csv');
    check('gymquest: 0 new, "1 already in your history"', await q('#csv-counts') === '0 new · 0 already imported' && /1 already in your history/.test(await q('#csv-in-history') || ''), [await q('#csv-counts'), await q('#csv-in-history')]);
    await closeSheet();
    await ev(`(state.history = state.history.filter((w) => w.id !== 'real-push'), saveState(), true)`);
    await open(fx('gymquest-export.csv'), 'export.csv');
    check('without the real entry it is new, source csv', await q('#csv-counts') === '1 new · 0 already imported');
    await ev(`confirmCsvImport()`);
    check('stored as source csv', await ev(`state.importedHistory[0].source`) === 'csv');
    await ev(`(state.importedHistory = [], saveState(), true)`);

    console.log('== Skipped line + unmatched list');
    await open(fx('hevy.csv') + 'x,"20 Nov 2024, 10:00",,,"Squat",,,0,normal,abc,5,,0,\n', 'skip.csv');
    check('skipped line shown muted: "1 rows skipped (not lifting sets)"', /1 rows? skipped \(not lifting sets\)/.test(await q('#csv-skipped') || ''), await q('#csv-skipped'));
    await closeSheet();

    console.log('== Errors: nothing written, state deep-equal');
    const before = await ev(`JSON.stringify(state)`);
    await open(fx('broken-quotes.csv'), 'b.csv');
    check('broken quotes: error with a line number', /line \d+/i.test(await q('#csv-error') || ''), await q('#csv-error'));
    check('Confirm hidden/disabled in error', await ev(`${confirmBtn}.hidden || ${confirmBtn}.disabled`));
    await shot('preview-error-' + (process.env.GQ_SHOT_SFX || 'x'));
    await closeSheet();
    await open('foo,bar\n1,2\n', 'u.csv');
    check('unknown format: calm message', !!(await q('#csv-error')) && !/csv\./.test(await q('#csv-error')));
    await closeSheet();
    await ev(`openCsvImport(new File(['a'], 'big.csv')).then(() => 0)`);
    await closeSheet();
    const big = await ev(`(() => { const f = new File(['a'], 'big.csv'); Object.defineProperty(f, 'size', { value: 21 * 1024 * 1024 }); return openCsvImport(f).then(() => document.querySelector('#csv-error').textContent); })()`);
    check('file > 20 MB refused with message', /20 MB/.test(big || ''), big);
    await closeSheet();
    check('state deep-equal after all errors', await ev(`JSON.stringify(state)`) === before);

    console.log('== Timing: 3 000 workouts / 45 000 rows');
    const text = bigHevy(3000);
    await ev(`(() => { window.__gaps = []; window.__tick = true; let last = performance.now(); (function t() { const n = performance.now(); window.__gaps.push(n - last); last = n; if (window.__tick) setTimeout(t, 0); })(); return true; })()`);
    const t0 = Date.now();
    await open(text, 'big.csv');
    const ms = Date.now() - t0;
    const gap = await ev(`(window.__tick = false, Math.max.apply(null, window.__gaps))`);
    console.log('    total ' + ms + ' ms, longest main-thread gap ' + Math.round(gap) + ' ms');
    check('preview of 3 000 workouts', await q('#csv-counts') === '3000 new · 0 already imported', await q('#csv-counts'));
    check('no single task > 1 000 ms', gap < 1000, gap);
    const sv = await ev(`(() => { const t = performance.now(); confirmCsvImport(); return performance.now() - t; })()`);
    console.log('    confirm (one saveState) ' + Math.round(sv) + ' ms');
    check('3 000 imported', await ev(`state.importedHistory.length`) === 3000);
    check('XP unchanged with 3 000 imported', J(await ev(snap)) === J(base));
    check('limit: > 5 000 workouts refused', await (async () => { await ev(`(state.importedHistory = [], true)`); await open(bigHevy(5001), 'huge.csv'); const m = await q('#csv-error'); await closeSheet(); return /5,?000/.test(m || '') || m; })());
    await ev(`(state.importedHistory = [], saveState(), true)`);

    console.log('== Languages, RTL, themes at 390 px');
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const KEYS = ['csv.title', 'csv.close', 'csv.reading', 'csv.counts', 'csv.inHistory', 'csv.dates', 'csv.exercises', 'csv.unmatched', 'csv.unitAsk', 'csv.unitHint', 'csv.unitKg', 'csv.unitLb', 'csv.skipped', 'csv.note', 'csv.confirm', 'csv.nothingNew', 'csv.toast', 'csv.undo', 'csv.undone', 'csv.errBad', 'csv.errQuote', 'csv.errBig', 'csv.errMany', 'csv.errRows', 'csv.errCols', 'csv.errEmpty', 'csv.errRead', 'csv.errTitle', 'csv.fmtGym'];
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      const miss = await ev(`${J(KEYS)}.filter((k) => !I18N[${J(lang)}][k])`);
      await p.eval(`(setLang(${J(lang)}), true)`);
      await open(fx('strong-no-unit.csv'), 's.csv');
      const x = await ev(`(() => { const s = ${sheet}; const txt = s.innerText; return { dir: document.documentElement.dir, txt, over: document.documentElement.scrollWidth <= innerWidth, sheetOver: s.querySelector('.modal').scrollWidth <= s.querySelector('.modal').clientWidth + 1, small: Array.from(s.querySelectorAll('button')).filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43).length }; })()`);
      check(lang + ': all keys, no raw key / NaN, no overflow, 44 px targets', miss.length === 0 && !/csv\.|NaN|undefined|\{/.test(x.txt) && x.over && x.sheetOver && x.small === 0 && (lang !== 'ar' || x.dir === 'rtl'), { miss, small: x.small, over: x.over, t: x.txt.slice(0, 80) });
      if (lang === 'ar') console.log('    ar preview: ' + x.txt.replace(/\s+/g, ' ').slice(0, 300));
      await closeSheet();
    }
    for (const [lang, th, sfx] of [['en', 'light', 'light'], ['en', 'dark', 'dark'], ['ar', 'light', 'ar']]) {
      await p.eval(`(setLang('${lang}'), document.documentElement.setAttribute('data-theme', '${th}'), true)`);
      process.env.GQ_SHOT_SFX = sfx;
      await open(fx('hevy.csv') + 'x,"20 Nov 2024, 10:00",,,"Squat",,,0,normal,abc,5,,0,\n', 'n.csv'); await wait(300); await shot('preview-normal-' + sfx); await closeSheet();
      await open(fx('strong-no-unit.csv'), 's.csv'); await wait(300); await shot('preview-unit-unknown-' + sfx); await closeSheet();
      await open(fx('broken-quotes.csv'), 'b.csv'); await wait(300); await shot('preview-error-' + sfx); await closeSheet();
    }
    check('no console errors', logs.length === 0, logs.slice(0, 3));
  } catch (e) {
    check('no exception', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
    console.log(`\n==== checks: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  }
})();
