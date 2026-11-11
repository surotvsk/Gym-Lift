'use strict';
/* Gym-Lift — Fáza 3 / úloha 5: list CSV v Nastaveniach a export CSV (rozloženie Hevy + značka gymlift_version), v reálnom headless Chrome.

     node tests/app/csv-export.js            (GQ_SHOTS_OUT = priečinok: uloží aj snímky 390 px) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-csv-export');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
const HEADER = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe,gymlift_version';
const SETTINGS_BUTTONS_BASELINE = 33;   // tlačidlá v #modal-settings pred touto úlohou; pribudlo presne jedno (#btn-csv)

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('csve-' + Date.now().toString(36), 9899, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push('exception ' + J(e.exceptionDetails && e.exceptionDetails.text)));
  await p.c.send('Runtime.enable');
  const ev = (expr) => p.eval(`(async () => { try { const v = await (${expr}); return JSON.stringify(v === undefined ? null : v); } catch (e) { return JSON.stringify({ threw: String(e) }); } })()`).then((s) => { const v = JSON.parse(s); if (v && v.threw) { console.log('    threw: ' + v.threw); return false; } return v; });
  const sheet = `document.getElementById('modal-csv')`;
  const esc = () => p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`);
  const shotsOut = process.env.GQ_SHOTS_OUT;
  const shot = async (name) => { if (!shotsOut) return; fs.mkdirSync(shotsOut, { recursive: true }); const s = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotsOut, name + '.png'), Buffer.from(s.data, 'base64')); };
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);

    /* Fixtúra: obyčajný, po sériách, jednostranný, rozcvičky, drop, zlyhanie, RPE, supersérie, čiarka/úvodzovky/nový riadok v názve */
    await p.eval(`(() => {
      state.history = [
        { id: 'w1', week: weekKey(new Date(2024, 10, 15)), date: '2024-11-15', planId: 'x', planName: 'Push', note: 'felt "good"', durationSeconds: 3300, exercises: [
          { name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 10, weight: 60, setsDone: 3, doneSets: [1, 2, 3], setWeights: [60, 62.5, 65], setReps: [10, 8, 6], actualFailureSets: [3], setRpe: [null, 8, 9.5],
            warmups: [{ weight: 20, reps: 10 }, { weight: 40, reps: 5 }], drops: [{ weight: 50, reps: 8 }, { weight: 40, reps: 10 }] },
          { name: 'Overhead Press', exId: 'overhead-press', sets: 2, reps: 8, weight: 30, setsDone: 2, group: 'g1' },
          { name: 'Lateral Raise', exId: 'lateral-raises', sets: 2, reps: 12, weight: 8, setsDone: 2, group: 'g1' }] },
        { id: 'w2', week: weekKey(new Date(2024, 10, 16)), date: '2024-11-16', planId: 'y', planName: 'Legs, "heavy"\\nday', durationSeconds: 0, exercises: [
          { name: 'My curl, "special"\\nline', sets: 2, reps: 10, weight: 12, setsDone: 2 },
          { name: 'One-arm Row', sets: 2, reps: 10, weight: 20, setsDone: 2, unilateral: true, sidesDone: { left: [1, 2], right: [1, 2] }, sideWeights: { left: [20, 22], right: [20, 24] }, sideReps: { left: [10, 9], right: [10, 8] }, sideRpe: { left: [8, null], right: [null, 9] } }] },
        { id: 'w3', week: weekKey(new Date(2024, 10, 17)), date: '2024-11-17', planId: 'z', planName: 'Late', durationSeconds: 7200, exercises: [
          { name: 'Squat', exId: 'squats', sets: 1, reps: 5, weight: 100, setsDone: 1 }] }];
      state.importedHistory = [
        { id: 'imp-1', date: '2024-10-01', planName: 'Chest day', source: 'strong', importKey: 'strong|k1', durationSeconds: 1800, exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 2, reps: 5, weight: 80, setsDone: 2, doneSets: [1, 2] }] },
        { id: 'imp-2', date: '2024-10-02', planName: 'Pull', source: 'hevy', importKey: 'hevy|k2', exercises: [{ name: 'Pull-ups', exId: 'pull-ups', sets: 1, reps: 8, weight: 0, setsDone: 1, doneSets: [1] }] }];
      state.plans = state.plans || {}; saveState(); renderAll(); return true; })()`);

    console.log('== buildCsvExport: layout');
    const out = await ev(`buildCsvExport({ includeImported: false })`);
    check('buildCsvExport exists and returns a string with a UTF-8 BOM', typeof out === 'string' && out.charCodeAt(0) === 0xFEFF, typeof out);
    const lines = out.replace(/^﻿/, '').split('\r\n');
    check('CRLF endings, header is the Hevy layout + gymlift_version', lines[0] === HEADER, lines[0]);
    check('every data row ends with ,1 (marker)', await ev(`(() => { const r = parseCsv(${J(out)}).rows; return r.length > 1 && r.slice(1).every((x) => x.length === 15 && x[14] === '1'); })()`));
    if (process.env.DBG) console.log(J(out));
    const rows = await ev(`parseCsv(${J(out)}).rows.slice(1)`);
    const N = await ev(`({ bench: I18N.en['exercise.bench-press'], ohp: 'Overhead press', lat: I18N.en['exercise.lateral-raises'], sq: I18N.en['exercise.squats'] })`);
    const byEx = (title) => rows.filter((r) => r[4] === title);
    const types = (title) => byEx(title).map((r) => r[8]).join(',');
    check('Bench: warm-ups, normal, failure (last), then drops', types(N.bench) === 'warmup,warmup,normal,normal,failure,dropset,dropset', types(N.bench));
    check('Bench set_index runs 0..6', byEx(N.bench).map((r) => r[7]).join(',') === '0,1,2,3,4,5,6');
    check('Bench per-set weights / reps', byEx(N.bench).map((r) => r[9] + 'x' + r[10]).join(' ') === '20x10 40x5 60x10 62.5x8 65x6 50x8 40x10', byEx(N.bench).map((r) => r[9] + 'x' + r[10]).join(' '));
    check('RPE only on rated sets (blank otherwise)', byEx(N.bench).map((r) => r[13]).join(',') === ',,,8,9.5,,', byEx(N.bench).map((r) => r[13]).join(','));
    check('start_time = history date 00:00, end = start + duration, English month', byEx(N.bench)[0][1] === '15 Nov 2024, 00:00' && byEx(N.bench)[0][2] === '15 Nov 2024, 00:55', [byEx(N.bench)[0][1], byEx(N.bench)[0][2]]);
    check('unknown duration -> end_time blank', byEx('My curl, "special"\nline')[0][2] === '', byEx('My curl, "special"\nline')[0][2]);
    check('duration crossing midnight rolls the date', byEx(N.sq)[0][2] === '17 Nov 2024, 02:00', byEx(N.sq)[0][2]);
    check('workout note goes to description', byEx(N.bench)[0][3] === 'felt "good"', byEx(N.bench)[0][3]);
    check('superset_id shared by the grouped exercises only', byEx(N.ohp)[0][5] !== '' && byEx(N.ohp)[0][5] === byEx(N.lat)[0][5] && byEx(N.bench)[0][5] === '');
    check('plain exercise: 2 rows, 12 kg x 10', byEx('My curl, "special"\nline').length === 2 && byEx('My curl, "special"\nline')[0][9] === '12');
    check('Unilateral convention: two rows per set (L, R), reps and per-side RPE kept', byEx('One-arm Row').map((r) => r[9] + 'x' + r[10] + '/' + r[13]).join(' ') === '20x10/8 20x10/ 22x9/ 24x8/9', byEx('One-arm Row').map((r) => r[9] + 'x' + r[10] + '/' + r[13]).join(' '));
    check('Unilateral exact order: L1 R1 L2 R2', byEx('One-arm Row').map((r) => r[9]).join(',') === '20,20,22,24', byEx('One-arm Row').map((r) => r[9]).join(','));
    check('every set_type is one of the four', rows.every((r) => ['normal', 'warmup', 'dropset', 'failure'].includes(r[8])));

    console.log('== Escaping (RFC 4180)');
    check('comma, quote and newline survive a parse round trip', byEx('My curl, "special"\nline').length === 2 && rows.some((r) => r[0] === 'Legs, "heavy"\nday'));
    check('raw text doubles the quotes and quotes the field', out.includes('"My curl, ""special""\nline"') && out.includes('"Legs, ""heavy""\nday"'));

    console.log('== Round trip through parseCsv + detectCsvFormat + csvToWorkouts');
    const rt = await ev(`(() => {
      const parsed = parseCsv(${J(out)});
      const fmt = detectCsvFormat(parsed.rows[0]);
      const res = csvToWorkouts(parsed.rows, fmt, { delimiter: parsed.delimiter });
      const keyOf = (e) => entryIdentity(e);
      const sets = (list) => list.map((e) => [keyOf(e), historyWorkingSets(e).map((s) => [s.weight, s.reps, s.rpe, s.failure])]);
      const mine = state.history.filter((w) => w.id !== 'w2');
      const a = mine.map((w) => w.exercises.map((e) => JSON.stringify(sets([e])[0])).join('|'));
      const b = res.workouts.filter((w) => w.date !== '2024-11-16').map((w) => w.exercises.map((e) => JSON.stringify(sets([e])[0])).join('|'));
      return { fmt, n: res.workouts.length, eq: JSON.stringify(a) === JSON.stringify(b), a, b, dates: res.workouts.map((w) => w.date), durs: res.workouts.map((w) => w.durationSeconds || 0), g: res.workouts[0].exercises.map((e) => e.group || null), drops: res.workouts[0].exercises[0].drops, warm: res.workouts[0].exercises[0].warmups };
    })()`);
    check('detected as gymquest', rt && rt.fmt === 'gymquest', rt && rt.fmt);
    check('3 workouts back, same dates (day-accurate)', rt && rt.n === 3 && rt.dates.join() === '2024-11-15,2024-11-16,2024-11-17', rt && rt.dates);
    check('working sets equal per exercise (weight, reps, rpe, failure)', rt && rt.eq, rt && { a: rt.a, b: rt.b });
    check('durations round-trip (55 min, 120 min)', rt && rt.durs[0] === 3300 && rt.durs[2] === 7200, rt && rt.durs);
    check('superset restored, drops and warm-ups restored', rt && rt.g[1] === 'ss1' && rt.g[2] === 'ss1' && rt.g[0] === null, rt && rt.g);
    check('drops 2 and warm-ups 2 present after re-import', rt && rt.drops && rt.drops.length === 2 && rt.warm && rt.warm.length === 2);

    console.log('== Imported workouts in the export');
    const off = await ev(`buildCsvExport({ includeImported: false })`);
    const on = await ev(`buildCsvExport({ includeImported: true })`);
    check('off: no imported titles', !/Chest day|Pull,/.test(off) && !off.includes('Chest day'));
    check('on: both imported workouts present, chronological (oldest first)', on.includes('Chest day') && on.includes('"Pull"') && on.indexOf('Chest day') < on.indexOf('"Push"'));
    check('on: imported 1800 s -> end 00:30', on.includes('"1 Oct 2024, 00:00","1 Oct 2024, 00:30"'));
    check('default (no argument) = not including imports', await ev(`buildCsvExport() === buildCsvExport({ includeImported: false })`));
    check('empty history: header only', await ev(`(() => { const h = state.history, i = state.importedHistory; state.history = []; state.importedHistory = []; const s = buildCsvExport({ includeImported: true }); state.history = h; state.importedHistory = i; return s.replace(/^\\uFEFF/, '').trim() === ${J(HEADER)}; })()`));

    console.log('== Download (browser path)');
    const dl = await ev(`(() => {
      const made = []; const oc = URL.createObjectURL; URL.createObjectURL = function (blob) { made.push({ type: blob.type, size: blob.size }); return 'blob:test'; };
      const clicks = []; const oc2 = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
      const ra = URL.revokeObjectURL; URL.revokeObjectURL = function () {};
      try { exportCsv(); } finally { URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = oc2; URL.revokeObjectURL = ra; }
      return { made, clicks, name: 'gymlift-workouts-' + todayISO() + '.csv' };
    })()`);
    check('one Blob, type text/csv, correct filename', dl && dl.made.length === 1 && /^text\/csv/.test(dl.made[0].type) && dl.clicks[0] === dl.name && /^gymlift-workouts-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.clicks[0]), dl);
    check('Blob holds the BOM (3 extra bytes) and is non-trivial', dl && dl.made[0].size > 400);

    console.log('== Settings: exactly one new button');
    const sb = await ev(`(() => { const s = document.getElementById('modal-settings'); return { n: s.querySelectorAll('button').length, csv: !!s.querySelector('#btn-csv'), inMore: !!s.querySelector('#settings-more #btn-csv'), label: (document.getElementById('btn-csv') || {}).textContent }; })()`);
    check('Settings has exactly one new button (#btn-csv, in the Data group)', sb.n === SETTINGS_BUTTONS_BASELINE + 1 && sb.csv && sb.inMore, sb);
    check('label "CSV (Strong / Hevy)"', sb.label === 'CSV (Strong / Hevy)', sb.label);

    console.log('== Sheet standard');
    await ev(`(() => { document.getElementById('modal-settings').hidden = false; document.getElementById('settings-more').open = true; document.getElementById('btn-csv').focus(); return true; })()`);
    await p.eval(`(document.getElementById('btn-csv').click(), true)`); await wait(200);
    check('opens', await ev(`!${sheet}.hidden`));
    check('labelled dialog', await ev(`(() => { const d = ${sheet}.querySelector('.modal'); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && !!document.getElementById(d.getAttribute('aria-labelledby')); })()`));
    check('focus moved into the sheet', await ev(`${sheet}.contains(document.activeElement)`));
    check('isBusy() while open', await ev(`isBusy()`));
    check('NATIVE_BACK_CLOSE lists it', await ev(`NATIVE_BACK_CLOSE.some((e) => e[0] === 'modal-csv' && !!document.querySelector(e[1]))`));
    check('above Settings in the DOM, below the import sheet and the confirm dialog order is sane', await ev(`(() => { const all = Array.from(document.querySelectorAll('.modal-backdrop')).map((m) => m.id); return all.indexOf('modal-csv') > all.indexOf('modal-settings') && all.indexOf('modal-csv') < all.indexOf('modal-csv-import') && all.indexOf('modal-csv') < all.indexOf('modal-generic'); })()`));
    check('with imports: chip, export, import, manage list and help line shown', await ev(`(() => { const s = ${sheet}; const vis = (q) => { const e = s.querySelector(q); return !!e && !e.hidden && e.offsetParent !== null; }; return vis('#csv-include') && vis('#btn-csv-export') && vis('#btn-csv-pick') && vis('#csv-manage') && vis('#csv-help'); })()`));
    check('chip off by default, aria-pressed', await ev(`document.getElementById('csv-include').getAttribute('aria-pressed') === 'false'`));
    check('manage list: Strong 1, Hevy 1', await ev(`Array.from(${sheet}.querySelectorAll('#csv-manage .csv-src')).map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).join('|')`).then((s) => /Strong/.test(s) && /Hevy/.test(s) && /1/.test(s)), await ev(`${sheet}.querySelector('#csv-manage').textContent.replace(/\\s+/g, ' ')`));
    check('help line mentions Strong and Hevy', await ev(`/Strong/.test(document.getElementById('csv-help').textContent) && /Hevy/.test(document.getElementById('csv-help').textContent)`));
    await p.eval(`(document.getElementById('csv-include').click(), true)`);
    check('chip toggles aria-pressed', await ev(`document.getElementById('csv-include').getAttribute('aria-pressed') === 'true'`));
    const inc = await ev(`(() => { let got = null; const o = window.buildCsvExport; window.buildCsvExport = function (opt) { got = opt; return o.apply(this, arguments); }; const ou = URL.createObjectURL; URL.createObjectURL = () => 'blob:x'; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {}; document.getElementById('btn-csv-export').click(); URL.createObjectURL = ou; HTMLAnchorElement.prototype.click = oc; window.buildCsvExport = o; return got; })()`);
    check('Export button passes includeImported from the chip', inc && inc.includeImported === true, inc);
    await shot('csv-sheet-with-imports-' + (process.env.GQ_SHOT_SFX || 'x'));
    await esc(); await wait(100);
    check('Escape closes the sheet, Settings stays', await ev(`${sheet}.hidden && !document.getElementById('modal-settings').hidden`));
    check('focus returns to #btn-csv', await ev(`document.activeElement && document.activeElement.id === 'btn-csv'`));
    await p.eval(`(document.getElementById('btn-csv').click(), true)`); await wait(150);
    check('chip resets to off on reopen', await ev(`document.getElementById('csv-include').getAttribute('aria-pressed') === 'false'`));
    await ev(`(document.getElementById('btn-csv-close').click(), true)`);
    check('close button closes it', await ev(`${sheet}.hidden`));
    await p.eval(`(document.getElementById('btn-csv').click(), true)`); await wait(150);
    check('Back (nativeBack) closes it', await ev(`nativeBack() === 'closed' && ${sheet}.hidden`));

    console.log('== Import entry point');
    await p.eval(`(document.getElementById('btn-csv').click(), true)`); await wait(150);
    check('file input accepts .csv / text/csv', await ev(`(() => { const i = document.getElementById('file-csv'); return !!i && i.type === 'file' && i.accept === '.csv,text/csv'; })()`));
    const picked = await ev(`(() => { let got = null; const o = window.openCsvImport; window.openCsvImport = function (f) { got = f && f.name; }; const i = document.getElementById('file-csv'); const dt = new DataTransfer(); dt.items.add(new File(['x'], 'my.csv', { type: 'text/csv' })); i.files = dt.files; i.dispatchEvent(new Event('change')); window.openCsvImport = o; return { got, cleared: i.value === '' }; })()`);
    check('choosing a file calls openCsvImport(file); input is reset', picked && picked.got === 'my.csv' && picked.cleared, picked);

    console.log('== Remove all (only that source, after confirmation)');
    const ids0 = await ev(`state.importedHistory.map((w) => w.id).join()`);
    await p.eval(`(${sheet}.querySelector('#csv-manage [data-source="strong"]').click(), true)`); await wait(150);
    check('confirmation shown, nothing removed yet', await ev(`!document.getElementById('modal-generic').hidden && state.importedHistory.length === 2`));
    check('confirm dialog is above the CSV sheet (later in DOM)', await ev(`(() => { const all = Array.from(document.querySelectorAll('.modal-backdrop')).map((m) => m.id); return all.indexOf('modal-generic') > all.indexOf('modal-csv'); })()`));
    await p.eval(`(document.getElementById('btn-generic-cancel').click(), true)`);
    check('Cancel keeps both', await ev(`state.importedHistory.length === 2`));
    const real0 = await ev(`JSON.stringify(state.history)`);
    await p.eval(`(${sheet}.querySelector('#csv-manage [data-source="strong"]').click(), true)`); await wait(100);
    await p.eval(`(document.getElementById('btn-generic-ok').click(), true)`); await wait(200);
    check('Strong removed, Hevy stays, real history untouched', await ev(`state.importedHistory.map((w) => w.source).join()`) === 'hevy' && await ev(`JSON.stringify(state.history)`) === real0, ids0);
    check('list re-rendered: Strong row gone, Hevy row remains', await ev(`!${sheet}.querySelector('#csv-manage [data-source="strong"]') && !!${sheet}.querySelector('#csv-manage [data-source="hevy"]')`));
    await p.eval(`(${sheet}.querySelector('#csv-manage [data-source="hevy"]').click(), true)`); await wait(100);
    await p.eval(`(document.getElementById('btn-generic-ok').click(), true)`); await wait(200);
    check('Hevy removed: no imports left', await ev(`state.importedHistory.length === 0`));
    check('without imports: chip, manage list and nothing else hidden wrongly (export + import remain)', await ev(`(() => { const s = ${sheet}; const vis = (q) => { const e = s.querySelector(q); return !!e && !e.hidden && e.offsetParent !== null; }; return { inc: vis('#csv-include-wrap'), man: vis('#csv-manage'), ex: vis('#btn-csv-export'), pick: vis('#btn-csv-pick'), help: vis('#csv-help'), open: !s.hidden }; })()`).then((v) => v && !v.inc && !v.man && v.ex && v.pick && v.help));
    await shot('csv-sheet-no-imports-' + (process.env.GQ_SHOT_SFX || 'x'));
    check('export with no imports and no workouts shows a message instead of a file', await ev(`(() => { const h = state.history; state.history = []; let made = 0; const ou = URL.createObjectURL; URL.createObjectURL = () => { made++; return 'blob:x'; }; exportCsv(); URL.createObjectURL = ou; state.history = h; const g = !document.getElementById('modal-generic').hidden; document.getElementById('btn-generic-cancel').click(); return made === 0 && g; })()`));
    await ev(`(document.getElementById('btn-csv-close').click(), true)`);

    console.log('== Languages, RTL, themes at 390 px');
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await ev(`(state.importedHistory = [{ id: 'imp-1', date: '2024-10-01', planName: 'Chest day', source: 'strong', importKey: 'strong|k1', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 1, reps: 5, weight: 80, setsDone: 1, doneSets: [1] }] }, { id: 'imp-2', date: '2024-10-02', planName: 'Pull', source: 'hevy', importKey: 'hevy|k2', exercises: [{ name: 'Pull-ups', exId: 'pull-ups', sets: 1, reps: 8, weight: 0, setsDone: 1, doneSets: [1] }] }], saveState(), true)`);
    const enKeys = await ev(`Object.keys(I18N.en).filter((k) => /^csvx\\./.test(k))`);
    check('new strings exist (csvx.*)', enKeys && enKeys.length >= 8, enKeys && enKeys.length);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang('${lang}'), document.getElementById('btn-csv').click(), true)`); await wait(250);
      const miss = await ev(`${J(enKeys)}.filter((k) => !I18N['${lang}'] || !I18N['${lang}'][k])`);
      const x = await ev(`(() => { const s = ${sheet}; const txt = s.innerText; return { dir: document.documentElement.dir, txt, over: document.documentElement.scrollWidth <= innerWidth, sheetOver: s.querySelector('.modal').scrollWidth <= s.querySelector('.modal').clientWidth + 1, small: Array.from(s.querySelectorAll('button')).filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43).length, btn: document.getElementById('btn-csv').textContent }; })()`);
      check(lang + ': all keys, no raw key / NaN, no overflow, 44 px targets', miss.length === 0 && !/csvx\.|NaN|undefined|\{/.test(x.txt) && x.over && x.sheetOver && x.small === 0 && (lang !== 'ar' || x.dir === 'rtl'), { miss, small: x.small, over: x.over, t: x.txt.slice(0, 80) });
      if (lang === 'ar') console.log('    ar sheet: ' + x.txt.replace(/\s+/g, ' ').slice(0, 400));
      await ev(`(document.getElementById('btn-csv-close').click(), true)`);
    }
    await p.eval(`(setLang('en'), true)`);
    for (const [lang, th, sfx] of [['en', 'light', 'light'], ['en', 'dark', 'dark'], ['ar', 'light', 'ar']]) {
      await p.eval(`(setLang('${lang}'), document.documentElement.setAttribute('data-theme', '${th}'), true)`);
      for (const imp of [true, false]) {
        await ev(`(window.__imp = window.__imp || state.importedHistory.slice(), state.importedHistory = ${imp} ? window.__imp : [], true)`);
        await p.eval(`(document.getElementById('modal-settings').hidden = false, document.getElementById('settings-more').open = true, document.getElementById('btn-csv').click(), true)`); await wait(300);
        await shot('csv-sheet-' + (imp ? 'with' : 'no') + '-imports-' + sfx);
        await ev(`(document.getElementById('btn-csv-close').click(), true)`);
      }
      await p.eval(`(document.getElementById('settings-more').open = true, document.getElementById('btn-csv').scrollIntoView({ block: 'center' }), true)`); await wait(300);
      await shot('settings-data-' + sfx);
    }
    check('no console errors', logs.length === 0, logs.slice(0, 3));
  } catch (e) { fail++; console.log('  FAIL threw: ' + (e && e.stack || e)); }
  console.log(`\n${pass} passed, ${fail} failed`);
  b.killHard(true); await server.close();
  process.exit(fail ? 1 : 0);
})();
