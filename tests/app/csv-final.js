'use strict';
/* Gym-Lift — Fáza 3, oprava po záverečnej kontrole: vrstvenie dialógov a toastu (skutočný klik cez Input.dispatchMouseEvent
   po elementFromPoint), zlyhanie uloženia, export tých istých dní, stateMeaningful/demo, Esc, výkon, ochrana vzorcov, počty M2, M4.

     node tests/app/csv-final.js            (GQ_SHOTS_OUT = priečinok: uloží snímky 390 px) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-csv-final');
const FIX = path.join(REPO, 'tests', 'fixtures', 'csv');
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
  const b = new Browser('csvf-' + Date.now().toString(36), 9899, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  p.c.on('Runtime.exceptionThrown', (e) => logs.push('exception ' + J(e.exceptionDetails && e.exceptionDetails.text)));
  await p.c.send('Runtime.enable');
  const ev = (expr) => p.eval(`(async () => { try { const v = await (${expr}); return JSON.stringify(v === undefined ? null : v); } catch (e) { return JSON.stringify({ threw: String(e) }); } })()`).then((s) => { const v = JSON.parse(s); if (v && v.threw) { console.log('    threw: ' + v.threw); return false; } return v; });
  const shotsOut = process.env.GQ_SHOTS_OUT;
  const shot = async (name) => { if (process.env.GQ_SCREENSHOTS === '0' || !shotsOut) return; fs.mkdirSync(shotsOut, { recursive: true }); const s = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotsOut, name + '.png'), Buffer.from(s.data, 'base64')); };

  /* Skutočný klik: stred prvku -> elementFromPoint musí byť on sám (alebo jeho potomok) -> Input.dispatchMouseEvent. */
  const hit = (sel) => ev(`(() => { const el = document.querySelector(${J(sel)}); if (!el) return 'missing'; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h === el || el.contains(h) ? 'ok' : 'covered by ' + (h ? (h.id ? '#' + h.id : h.className || h.tagName) : 'null') + ' / ' + (h && h.closest('.modal-backdrop, .csv-toast') ? (h.closest('.modal-backdrop, .csv-toast').id) : '?'); })()`);
  const click = async (sel) => {
    const h = await hit(sel);
    if (h !== 'ok') { console.log('    click ' + sel + ': ' + h); return h; }
    await wait(60);
    const pt = await ev(`(() => { const r = document.querySelector(${J(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await p.c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
    await p.c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await p.c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await wait(150);
    return 'ok';
  };
  const key = async (k, code) => {
    await p.c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 });
    await p.c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 });
    await wait(120);
  };
  const hidden = (id) => ev(`document.getElementById(${J(id)}).hidden`);
  const pickFile = async (file) => {
    const r = await p.c.send('Runtime.evaluate', { expression: `document.getElementById('file-csv')` });
    await p.c.send('DOM.enable');
    await p.c.send('DOM.setFileInputFiles', { files: [file], objectId: r.result.objectId });
    await wait(700);
  };
  const seed = `(() => {
    const day = (n) => localDateKey(addDays(new Date(), -n));
    const ent = (nm, id, w) => ({ name: nm, exId: id, sets: 3, reps: 5, weight: w, setsDone: 3 });
    state.history = [{ id: 'r1', week: weekKey(addDays(new Date(), -1)), date: day(1), planId: 'push', planName: 'Push', note: '', durationSeconds: 3000, exercises: [ent('Bench Press', 'bench-press', 60)] }];
    state.importedHistory = [{ id: 'i0', date: day(2), planName: 'Chest day', source: 'strong', importKey: 'strong|k1|Chest day', exercises: [ent('Bench Press', 'bench-press', 80)] }];
    recalculateAll(); saveState(); renderAll(); return day(2); })()`;
  const closeAll = `(() => { for (const m of document.querySelectorAll('.modal-backdrop')) m.hidden = true; document.getElementById('csv-toast').hidden = true; if (activeTab === 'kalendar') document.getElementById('back-calendar').click(); window.scrollTo(0, 0); return true; })()`;

  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const impDay = await ev(seed);

    console.log('== C1: potvrdenie z listu dňa v Kalendári je navrchu (skutočný klik)');
    await p.eval(`(openCalendarPage(), true)`); await wait(400);
    check('klik na deň v kalendári', await click(`[data-day="${impDay}"]`) === 'ok');
    check('list dňa je otvorený', await ev(`!document.getElementById('modal-day').hidden`));
    check('klik na 🗑️ importovaného tréningu', await click('#modal-day [data-action="delete-imported"]') === 'ok');
    check('dialóg potvrdenia je zobrazený', await ev(`!document.getElementById('modal-generic').hidden`));
    check('elementFromPoint stredu OK je tlačidlo OK', await hit('#btn-generic-ok') === 'ok', await hit('#btn-generic-ok'));
    check('elementFromPoint stredu Zrušiť je tlačidlo Zrušiť', await hit('#btn-generic-cancel') === 'ok');
    await shot('day-delete-confirm-' + await ev(`document.documentElement.getAttribute('data-theme') || 'light'`));
    check('klik na OK zmaže import', await click('#btn-generic-ok') === 'ok' && await ev(`state.importedHistory.length`) === 0);
    check('list dňa sa prekreslil bez importu', await ev(`!document.querySelector('#modal-day [data-action="delete-imported"]')`));

    console.log('== C1: Odstrániť všetky z listu CSV + I4 Esc zavrie len dialóg');
    await ev(closeAll); await ev(seed);
    await p.eval(`(openSettings(), document.getElementById('settings-more').open = true, true)`); await wait(300);
    check('klik na CSV v Nastaveniach', await click('#btn-csv') === 'ok' && await ev(`!document.getElementById('modal-csv').hidden`));
    check('klik na Odstrániť všetky', await click('#csv-srcs button') === 'ok' && await ev(`!document.getElementById('modal-generic').hidden`));
    check('OK dialógu je navrchu nad listom CSV', await hit('#btn-generic-ok') === 'ok', await hit('#btn-generic-ok'));
    await key('Escape');
    check('I4: Esc zavrelo len dialóg, list CSV zostal', await hidden('modal-generic') && !await hidden('modal-csv') && !await hidden('modal-settings'));
    check('I4: nič sa nezmazalo', await ev(`state.importedHistory.length`) === 1);
    check('znova Odstrániť všetky + OK', await click('#csv-srcs button') === 'ok' && await click('#btn-generic-ok') === 'ok' && await ev(`state.importedHistory.length`) === 0);
    await key('Escape');
    check('Esc zavrie list CSV (Nastavenia zostanú, ako doteraz)', await hidden('modal-csv') && !await hidden('modal-settings'));

    console.log('== C2: toast Vrátiť import je nad listami (reálny tok Nastavenia -> CSV -> výber -> Potvrdiť)');
    await ev(closeAll); await ev(seed);
    await ev(`(state.importedHistory = [], saveState(), renderAll(), true)`);
    await p.eval(`(openSettings(), document.getElementById('settings-more').open = true, true)`); await wait(300);
    check('klik na CSV', await click('#btn-csv') === 'ok');
    await pickFile(path.join(FIX, 'hevy.csv'));
    check('náhľad sa zobrazil', await ev(`!document.getElementById('modal-csv-import').hidden && !document.getElementById('btn-csv-confirm').disabled`));
    await shot('import-preview-' + await ev(`document.documentElement.getAttribute('data-theme') || 'light'`));
    check('klik na Potvrdiť', await click('#btn-csv-confirm') === 'ok');
    check('importy pridané', await ev(`state.importedHistory.length`) === 2);
    check('list importu, list CSV aj Nastavenia sú zatvorené', await hidden('modal-csv-import') && await hidden('modal-csv') && await hidden('modal-settings'));
    check('toast je viditeľný', await ev(`!document.getElementById('csv-toast').hidden`));
    check('elementFromPoint stredu Vrátiť import je tlačidlo', await hit('#btn-csv-undo') === 'ok', await hit('#btn-csv-undo'));
    await shot('import-toast-' + await ev(`document.documentElement.getAttribute('data-theme') || 'light'`));
    /* aj keď sa nad toast otvorí list (Nastavenia), tlačidlo zostane dosiahnuteľné */
    await p.eval(`(openSettings(), true)`); await wait(200);
    check('toast je nad otvorenými Nastaveniami', await hit('#btn-csv-undo') === 'ok', await hit('#btn-csv-undo'));
    check('z-index toastu > 20 a < 40', await ev(`(() => { const z = +getComputedStyle(document.getElementById('csv-toast')).zIndex; return z > 20 && z < 40; })()`));
    check('klik na Vrátiť import vráti importy', await click('#btn-csv-undo') === 'ok' && await ev(`state.importedHistory.length`) === 0);
    await ev(closeAll);

    console.log('== I1: zlyhanie uloženia (kvóta) -> návrat späť, chyba, žiadny úspešný toast');
    await ev(`(state.importedHistory = [], saveState(), renderAll(), true)`);
    await ev(`(() => { window.__origSet = Storage.prototype.setItem; const lim = JSON.stringify(state).length + 100; Storage.prototype.setItem = function (k, v) { if (k === STORAGE_KEY && String(v).length > lim) throw new DOMException('quota', 'QuotaExceededError'); return window.__origSet.apply(this, arguments); }; return true; })()`);
    await p.eval(`(openSettings(), document.getElementById('settings-more').open = true, true)`); await wait(300);
    await click('#btn-csv'); await pickFile(path.join(FIX, 'hevy.csv'));
    await click('#btn-csv-confirm');
    check('I1: importy vrátené (0)', await ev(`state.importedHistory.length`) === 0, await ev(`state.importedHistory.length`));
    check('I1: úspešný toast sa neukázal', await hidden('csv-toast'));
    check('I1: zobrazená chyba v 6 jazykoch (sk/en/es/pt-BR/fr/ar kľúč)', await ev(`['sk','en','es','pt-BR','fr','ar'].every((l) => I18N[l] && I18N[l]['csv.errStorage'])`));
    check('I1: dialóg s chybou je navrchu', await ev(`!document.getElementById('modal-generic').hidden && /Nothing was imported/.test(document.getElementById('generic-text').textContent)`) && await hit('#btn-generic-ok') === 'ok', await ev(`document.getElementById('generic-text').textContent`));
    check('I1: uložený stav je bez importov', await ev(`JSON.parse(localStorage.getItem(STORAGE_KEY)).importedHistory.length`) === 0);
    await click('#btn-generic-ok');
    await ev(`(Storage.prototype.setItem = window.__origSet, true)`);
    await ev(closeAll);
    /* Späť pri zlyhaní uloženia */
    await ev(`(state.importedHistory = [], saveState(), renderAll(), true)`);
    await p.eval(`(openSettings(), true)`); await click('#btn-csv'); await pickFile(path.join(FIX, 'hevy.csv')); await click('#btn-csv-confirm');
    check('I1: import prešiel (2)', await ev(`state.importedHistory.length`) === 2);
    await ev(`(Storage.prototype.setItem = function (k, v) { if (k === STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError'); return window.__origSet.apply(this, arguments); }, true)`);
    await click('#btn-csv-undo');
    check('I1: pri zlyhaní Späť importy zostávajú (2) a toast "vrátené" sa neukázal', await ev(`state.importedHistory.length`) === 2 && !/undone/i.test(await ev(`document.getElementById('csv-toast-text').textContent`)));
    check('I1: undo chyba je hlásená', await ev(`!document.getElementById('modal-generic').hidden && /Nothing was/.test(document.getElementById('generic-text').textContent) === false || !document.getElementById('modal-generic').hidden`));
    await ev(`(Storage.prototype.setItem = window.__origSet, true)`);
    await ev(closeAll);
    await ev(`(state.importedHistory = [], saveState(), renderAll(), true)`);

    console.log('== I1: pevný strop ~4,5 MB vypne Potvrdiť s vysvetlením');
    check('konštanta stropu', await ev(`typeof CSV_HARD_CEILING_BYTES === 'number' && CSV_HARD_CEILING_BYTES === 4500000`));
    await ev(`(state.__pad = 'x'.repeat(4600000), true)`);
    await p.eval(`(openSettings(), true)`); await click('#btn-csv'); await pickFile(path.join(FIX, 'hevy.csv'));
    check('Potvrdiť je vypnuté nad stropom', await ev(`document.getElementById('btn-csv-confirm').disabled`));
    check('vysvetlenie je viditeľné', await ev(`!document.getElementById('csv-storage').hidden && /too large|storage/i.test(document.getElementById('csv-storage').textContent)`), await ev(`document.getElementById('csv-storage').textContent`));
    await ev(`(delete state.__pad, true)`);
    await ev(closeAll);

    console.log('== I2: vlastný export, dva rovnaké tréningy v ten istý deň');
    const exp = await ev(`(() => {
      const day = localDateKey(addDays(new Date(), -3));
      const ent = (w) => ({ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: w, setsDone: 3 });
      const at = (h, m) => { const d = new Date(); d.setDate(d.getDate() - 3); d.setHours(h, m, 0, 0); return d.getTime(); };
      state.history = [
        { id: 'a1', week: weekKey(addDays(new Date(), -3)), date: day, planId: 'push', planName: 'Push', note: '', durationSeconds: 3600, endedAt: at(10, 30), exercises: [ent(60)] },
        { id: 'a2', week: weekKey(addDays(new Date(), -3)), date: day, planId: 'push', planName: 'Push', note: '', durationSeconds: 1800, endedAt: at(19, 0), exercises: [ent(62.5)] },
        { id: 'a3', week: weekKey(addDays(new Date(), -3)), date: day, planId: 'pull', planName: 'Pull', note: '', durationSeconds: 0, exercises: [ent(40)] },
        { id: 'a4', week: weekKey(addDays(new Date(), -3)), date: day, planId: 'pull', planName: 'Pull', note: '', durationSeconds: 0, exercises: [ent(40)] }];
      state.importedHistory = []; saveState(); return buildCsvExport(); })()`);
    const csvPath = path.join(WORK, 'own-export.csv');
    fs.writeFileSync(csvPath, exp);
    const starts = exp.split('\r\n').slice(1).filter(Boolean).map((l) => l.split('","')[1]);
    console.log('    start_time hodnoty: ' + J(Array.from(new Set(starts))));
    check('I2: štyri rôzne časy štartu (ten istý deň a názov)', new Set(starts).size === 4, Array.from(new Set(starts)));
    await ev(`(state.history = [], state.importedHistory = [], saveState(), renderAll(), true)`);
    await p.eval(`(openSettings(), true)`); await click('#btn-csv'); await pickFile(csvPath);
    check('I2: re-import na čistom stave = 4 nové', await ev(`document.getElementById('csv-counts').textContent`) === '4 new · 0 already imported', await ev(`document.getElementById('csv-counts').textContent`));
    await ev(closeAll);
    /* na tom istom zariadení: obnov históriu */
    await ev(`(() => { const day = localDateKey(addDays(new Date(), -3)); const ent = (w) => ({ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: w, setsDone: 3 }); const at = (h, m) => { const d = new Date(); d.setDate(d.getDate() - 3); d.setHours(h, m, 0, 0); return d.getTime(); };
      state.history = [
        { id: 'a1', week: weekKey(addDays(new Date(), -3)), date: day, planId: 'push', planName: 'Push', note: '', durationSeconds: 3600, endedAt: at(10, 30), exercises: [ent(60)] },
        { id: 'a2', week: weekKey(addDays(new Date(), -3)), date: day, planId: 'push', planName: 'Push', note: '', durationSeconds: 1800, endedAt: at(19, 0), exercises: [ent(62.5)] },
        { id: 'a3', week: weekKey(addDays(new Date(), -3)), date: day, planId: 'pull', planName: 'Pull', note: '', durationSeconds: 0, exercises: [ent(40)] },
        { id: 'a4', week: weekKey(addDays(new Date(), -3)), date: day, planId: 'pull', planName: 'Pull', note: '', durationSeconds: 0, exercises: [ent(40)] }];
      saveState(); return true; })()`);
    await p.eval(`(openSettings(), true)`); await click('#btn-csv'); await pickFile(csvPath);
    check('I2: na tom istom zariadení 4 už v histórii', await ev(`document.getElementById('csv-in-history').textContent`) === '4 already in your history' && /^0 new/.test(await ev(`document.getElementById('csv-counts').textContent`)), await ev(`document.getElementById('csv-in-history').textContent + ' | ' + document.getElementById('csv-counts').textContent`));
    await ev(closeAll);

    console.log('== I3: stateMeaningful a ukážkové dáta s importmi');
    check('I3: demo + importy = zmysluplné', await ev(`(() => { const s = JSON.parse(JSON.stringify(defaultState())); s.demo = true; s.importedHistory = [{ id: 'x', date: '2024-01-01', planName: 'x', source: 'csv', importKey: 'csv|x', exercises: [] }]; return stateMeaningful(s); })()`));
    check('I3: demo bez importov nie je zmysluplné', await ev(`(() => { const s = JSON.parse(JSON.stringify(defaultState())); s.demo = true; return stateMeaningful(s); })()`) === false);
    await ev(`(state.history = [], state.demo = false, state.importedHistory = [{ id: 'x', date: '2024-01-01', planName: 'x', source: 'csv', importKey: 'csv|x', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 1, reps: 5, weight: 50, setsDone: 1 }] }], saveState(), true)`);
    await p.eval(`(openSettings(), document.getElementById('settings-more').open = true, true)`); await wait(300);
    await click('#btn-load-demo');
    check('I3: Načítať ukážkové dáta pri importoch ukáže "nie je možné", nenačíta demo', await ev(`!document.getElementById('modal-generic').hidden && document.getElementById('generic-title').textContent === I18N.en['settings.demoNone'] && state.demo !== true && state.history.length === 0`), await ev(`document.getElementById('generic-title').textContent`));
    await click('#btn-generic-ok'); await ev(closeAll);

    console.log('== M1: ochrana vzorcov aj pre TAB a CR');
    check('M1: csvQuote predpona pre TAB a CR', await ev(`[csvQuote('\\tx'), csvQuote('\\rx'), csvQuote('=x'), csvQuote('ok')].join('|')`) === `"'\tx"|"'\rx"|"'=x"|"ok"`);
    check('M1: csvUnguard odstráni predponu', await ev(`[csvUnguard("'\\tx", 'gymquest'), csvUnguard("'\\rx", 'gymquest'), csvUnguard("'=x", 'gymquest'), csvUnguard("'abc", 'gymquest'), csvUnguard("'\\tx", 'hevy')].join('|')`) === "\tx|\rx|=x|'abc|'\tx");
    check('M1: round trip názvu s TAB', await ev(`(() => { const day = localDateKey(addDays(new Date(), -5)); state.history = [{ id: 'z1', week: weekKey(addDays(new Date(), -5)), date: day, planId: 'zz-tab', planName: '\\tTab plan', note: '', durationSeconds: 0, exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 1, reps: 5, weight: 50, setsDone: 1 }] }]; state.importedHistory = []; const txt = buildCsvExport(); const p = parseCsv(txt); const res = csvToWorkouts(p.rows, detectCsvFormat(p.rows[0]), { delimiter: p.delimiter }); return res.workouts[0].planName; })()`) === '\tTab plan', await ev(`(() => { const p = parseCsv(buildCsvExport()); return J(p.rows[1].slice(0,2)); })()`.replace('J(', 'JSON.stringify(')));

    console.log('== M4: poškodený skutočný záznam nezhodí index');
    check('M4: csvRealHistoryIndex nehádže', await ev(`(() => { state.history = [{ id: 'bad', date: '2024-01-01', exercises: [null, 5] }, { id: 'ok', date: '2024-01-02', planName: 'A', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 1, reps: 5, weight: 50, setsDone: 1 }] }]; const idx = csvRealHistoryIndex(); return idx instanceof Map && idx.size >= 1; })()`));

    console.log('== M2: počty zahŕňajú importy');
    check('M2: helper bez importov nič nepridá', await ev(`impPlusLabel(0) === ''`));
    check('M2: helper s importmi vráti "(+3 imported)"', await ev(`impPlusLabel(3)`) === '(+3 imported)', await ev(`impPlusLabel(3)`));
    check('M2: text konfliktu obsahuje počty importov', await ev(`(() => { const s = syncConflictBodyText({ reason: 'diverged', cloudCount: 12, cloudImported: 4 }, 3, 2); return /12 workouts/.test(s) && /Imports: account 4, this device 2/.test(s); })()`), await ev(`syncConflictBodyText({ reason: 'diverged', cloudCount: 12, cloudImported: 4 }, 3, 2)`));
    check('M2: text konfliktu bez importov je nezmenený', await ev(`!/mports/.test(syncConflictBodyText({ reason: 'diverged', cloudCount: 12 }, 3, 0))`));
    check('M2: štítok kópie na obnovu', await ev(`syncRecoveryLabel({ kind: 'device-copy', counts: { history: 7, imported: 5 } })`) === 'This device (7 workouts) (+5 imported)', await ev(`syncRecoveryLabel({ kind: 'device-copy', counts: { history: 7, imported: 5 } })`));
    check('M2: štítok kópie bez importov', await ev(`syncRecoveryLabel({ kind: 'cloud-copy', counts: { history: 7 } })`) === 'Account version (7 workouts)');
    check('M2: syncEnterConflict ukladá cloudImported/localImported', await ev(`syncEnterConflict.toString().includes('cloudImported: impCount(payload)')`));
    check('M2: JSON import – varovanie pri menej importoch aj počet v potvrdení', await ev(`importConfirmText({ history: new Array(10), importedHistory: [1, 2, 3] }, 10, 7)`) === 'This will replace all current data (10 workouts). (+3 imported)<br>Imported workouts: 7 → 3.', await ev(`importConfirmText({ history: new Array(10), importedHistory: [1, 2, 3] }, 10, 7)`));
    check('M2: JSON import bez importov = pôvodný text', await ev(`importConfirmText({ history: new Array(10) }, 10, 0)`) === 'This will replace all current data (10 workouts).');
    check('M2: šesť jazykov pre nové kľúče', await ev(`['sk','en','es','pt-BR','fr','ar'].every((l) => ['imp.plus', 'imp.olderExtra', 'imp.conflictExtra', 'csv.errStorage', 'csv.tooBig', 'csv.errUndoStorage'].every((k) => I18N[l] && I18N[l][k]))`));

    console.log('== I5: výkon s 5 000 importmi');
    await ev(`(() => { state.history = []; state.importedHistory = []; for (let i = 0; i < 5000; i++) { const d = new Date(2012, 0, 1 + Math.floor(i * 1.1)); state.importedHistory.push({ id: 'imp-' + i, date: localDateKey(d), planName: 'W' + i, source: 'hevy', importKey: 'hevy|' + i, exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 8, weight: 60 + i % 20, setsDone: 3 }, { name: 'Squat', exId: 'squat', sets: 3, reps: 5, weight: 100, setsDone: 3 }] }); } renderAll(); return true; })()`);
    await p.eval(`(switchTab('pokrok'), setPokrokView('history'), true)`); await wait(300);
    const tHist = await ev(`(() => { const t0 = performance.now(); renderPokrok(); return Math.round(performance.now() - t0); })()`);
    const tCal = await ev(`(() => { const t0 = performance.now(); openCalendarPage(); const t = Math.round(performance.now() - t0); document.getElementById('back-calendar').click(); return t; })()`);
    console.log('    MERANIE renderPokrok (5000 importov): ' + tHist + ' ms; otvorenie Kalendára: ' + tCal + ' ms');
    check('I5: História do 150 ms', tHist <= 150, tHist);
    check('I5: Kalendár do 150 ms', tCal <= 150, tCal);
    check('I5: riadkov v Histórii nie je viac než 100 + tlačidlo "Show more"', await ev(`document.querySelectorAll('#history-list .history-row').length === 100 && !!document.querySelector('#history-list [data-history-more]')`));
    check('I5: Show more ukáže ďalších 100', await click('#history-list [data-history-more]') === 'ok' && await ev(`document.querySelectorAll('#history-list .history-row').length`) === 200);
    check('I5: isImportedWorkout je správne', await ev(`isImportedWorkout(state.importedHistory[4999]) && !isImportedWorkout({ id: 'x' })`));
    await ev(`(state.importedHistory = [], saveState(), true)`);

    check('žiadne chyby v konzole', logs.length === 0, logs.slice(0, 3));
  } catch (e) { fail++; console.log('ERR', e && e.stack || e); }
  b.killHard(true); await server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
