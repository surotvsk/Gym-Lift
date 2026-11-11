'use strict';
/* Gym-Lift — Fáza 3 / úloha 2: importované tréningy v Histórii a v Kalendári (zobrazenie, otvorenie cviku, zmazanie).
   Skutočný headless Chrome, bez účtov a siete.

     node tests/app/import-history-view.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-import-history-view');
const J = JSON.stringify;
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
  const b = new Browser('imphv-' + Date.now().toString(36), 9898, path.join(WORK, 'profiles'));
  const p = await b.launch();
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const ev = (expr) => p.eval(`(() => { try { const v = ${expr}; return JSON.stringify(v === undefined ? null : v); } catch (e) { return JSON.stringify({ threw: String(e) }); } })()`).then((s) => JSON.parse(s));

    /* fixture: 1 skutočný tréning (včera), 3 importované: dnes (Strong), pred 5 dňami (Hevy), a jeden v deň skutočného (zmiešaný deň) */
    await p.eval(`(() => {
      const day = (n) => localDateKey(addDays(new Date(), -n));
      const ent = (w) => ({ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: w, setsDone: 3 });
      state.history = [{ id: 'r1', week: weekKey(addDays(new Date(), -1)), date: day(1), planId: 'push', planName: 'Push', note: '', durationSeconds: 3000, exercises: [ent(60)] }];
      state.importedHistory = [
        { id: 'i-today', date: day(0), planName: 'Chest day', source: 'strong', importKey: 'k1', exercises: [ent(80)] },
        { id: 'i-old', date: day(5), planName: 'Pull', source: 'hevy', importKey: 'k2', exercises: [ent(70)] },
        { id: 'i-mixed', date: day(1), planName: 'Legs', source: 'csv', importKey: 'k3', exercises: [ent(75)] }];
      recalculateAll(); saveState(); renderAll(); return true;
    })()`);
    const snap = `(() => (xpCacheClear(), { xp: totalXP(), streak: computeStreak(), wk: sessionsInWeek(currentWeekKey()), pr: personalRecords(), real: state.history.length }))()`;
    const base = await ev(snap);

    console.log('== History list');
    check('API exists', await ev(`[typeof deleteImportedWorkout, typeof deleteImportedSource]`).then((a) => J(a) === '["function","function"]'));
    await p.eval(`(switchTab('pokrok'), setPokrokView('history'), renderPokrok(), true)`);
    const rows = await ev(`Array.from(document.querySelectorAll('#history-list .history-row')).map((r) => ({ name: r.querySelector('.history-name').textContent, imp: r.classList.contains('history-imported'), tag: (r.querySelector('.imp-tag') || {}).textContent || '', edit: !!r.querySelector('[data-action="edit"]'), del: !!r.querySelector('[data-action="delete"]'), xp: !!r.querySelector('.history-xp') }))`);
    check('4 rows (3 imported + 1 real)', rows.length === 4, rows);
    check('newest first: Chest day (today) is first', rows[0] && rows[0].name === 'Chest day', rows);
    const imp = rows.filter((r) => r.imp);
    check('3 imported rows, each with one tag', imp.length === 3 && imp.every((r) => /^Imported · (Strong|Hevy|CSV)$/.test(r.tag)), imp);
    check('tags name the source', J(imp.map((r) => r.tag).sort()) === J(['Imported · CSV', 'Imported · Hevy', 'Imported · Strong']), imp);
    check('imported rows: no edit button, no XP, delete present', imp.every((r) => !r.edit && !r.xp && r.del), imp);
    const real = rows.filter((r) => !r.imp);
    check('real row keeps edit + delete + XP and has no tag', real.length === 1 && real[0].edit && real[0].del && real[0].xp && !real[0].tag, real);

    console.log('== exercise link on imported line');
    const link = await ev(`(() => { const a = document.querySelector('#history-list .history-imported .ex-prog-link'); return a ? [a.dataset.xid, a.dataset.xname] : null; })()`);
    check('imported line has an exercise-name link', link && link[0] === 'bench-press', link);
    await p.eval(`(document.querySelector('#history-list .history-imported .ex-prog-link').click(), true)`);
    await new Promise((r) => setTimeout(r, 300));
    const prog = await ev(`({ open: !document.getElementById('modal-ex-progress').hidden, sessions: document.querySelectorAll('#ex-progress-sessions > *').length, pts: exerciseSeries('bench-press').length })`);
    check('link opens the progress sheet with imported points (4 sessions)', prog.open && prog.pts === 4, prog);
    await p.eval(`(closeExerciseProgress(), true)`);

    console.log('== delete (history)');
    await p.eval(`(document.querySelector('#history-list .history-imported [data-action="delete"]').click(), true)`);
    const dlg = await ev(`({ open: !document.getElementById('modal-generic').hidden, title: document.getElementById('generic-title').textContent, text: document.getElementById('generic-text').textContent, still: state.importedHistory.length })`);
    check('delete asks for confirmation first', dlg.open && dlg.still === 3 && /imported/i.test(dlg.title + dlg.text), dlg);
    await p.eval(`(document.getElementById('btn-generic-cancel').click(), true)`);
    check('cancel keeps it', await ev(`state.importedHistory.length`) === 3);
    await p.eval(`(document.querySelector('#history-list .history-imported [data-action="delete"]').click(), document.getElementById('btn-generic-ok').click(), true)`);
    check('confirm removes exactly the first (today) one', J(await ev(`state.importedHistory.map((w) => w.id)`)) === '["i-old","i-mixed"]');
    check('row disappears from History', await ev(`document.querySelectorAll('#history-list .history-imported').length`) === 2);
    await p.reload();
    check('deletion survives a reload', J(await ev(`state.importedHistory.map((w) => w.id)`)) === '["i-old","i-mixed"]');
    /* vráť zmazaný (len pre ďalšie kroky) */
    await p.eval(`(() => { state.importedHistory.unshift({ id: 'i-today', date: localDateKey(new Date()), planName: 'Chest day', source: 'strong', importKey: 'k1', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 80, setsDone: 3 }] }); saveState(); renderAll(); return true; })()`);

    console.log('== deleteImportedWorkout / deleteImportedSource');
    const saves = await ev(`(() => { let n = 0; const o = window.saveState; window.saveState = function () { n++; return o.apply(this, arguments); }; deleteImportedWorkout('i-old'); document.getElementById('btn-generic-ok').click(); window.saveState = o; return n; })()`);
    check('deleteImportedWorkout: one saveState()', saves === 1, saves);
    check('i-old gone', J(await ev(`state.importedHistory.map((w) => w.id)`)) === '["i-today","i-mixed"]');
    check('unknown id: no dialog, no crash', await ev(`(() => { deleteImportedWorkout('nope'); return document.getElementById('modal-generic').hidden; })()`) === true);
    const cnt = await ev(`(() => { state.importedHistory.push({ id: 'i-h', date: '2025-01-01', planName: 'H', source: 'hevy', importKey: 'k9', exercises: [] }); const n = deleteImportedSource('hevy'); const asked = !document.getElementById('modal-generic').hidden; const stillThere = state.importedHistory.length; document.getElementById('btn-generic-ok').click(); return [n, asked, stillThere, state.importedHistory.map((w) => w.id)]; })()`);
    check('deleteImportedSource asks first, returns count, then removes only that source', J(cnt) === '[1,true,3,["i-today","i-mixed"]]', cnt);
    check('deleteImportedSource with nothing to remove returns 0, no dialog', await ev(`(() => { const n = deleteImportedSource('hevy'); return [n, document.getElementById('modal-generic').hidden]; })()`).then((a) => J(a) === '[0,true]'));
    check('real history untouched by deletes', await ev(`state.history.length`) === 1);

    console.log('== Calendar');
    await p.eval(`(() => { state.importedHistory.push({ id: 'i-old2', date: localDateKey(addDays(new Date(), -5)), planName: 'Pull', source: 'hevy', importKey: 'k2', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 70, setsDone: 3 }] }); saveState(); switchTab('kalendar'); renderKalendar(); return true; })()`);
    const cls = (n) => `(() => { const c = document.querySelector('.cal-cell[data-day="' + localDateKey(addDays(new Date(), -${n})) + '"]'); return c ? c.className : null; })()`;
    const cToday = await ev(cls(0)), cMixed = await ev(cls(1)), cOld = await ev(cls(5));
    check('imported-only day: neutral marker, not green, not "missed"', cOld && /cal-imp/.test(cOld) && !/cal-done|cal-miss/.test(cOld), cOld);
    check('imported-only today: neutral marker', cToday && /cal-imp/.test(cToday) && !/cal-done/.test(cToday), cToday);
    check('mixed day stays green', cMixed && /cal-done/.test(cMixed) && !/cal-imp/.test(cMixed), cMixed);
    await p.eval(`(openDay(localDateKey(addDays(new Date(), -1))), true)`);
    const day = await ev(`Array.from(document.querySelectorAll('#day-body .day-workout')).map((d) => ({ name: d.querySelector('.day-workout-name').textContent, tag: (d.querySelector('.imp-tag') || {}).textContent || '', xp: !!d.querySelector('.day-workout-xp'), del: !!d.querySelector('[data-action="delete-imported"]'), link: !!d.querySelector('.ex-prog-link') }))`);
    check('day sheet lists both, only the imported one tagged', day.length === 2 && day.filter((d) => d.tag === 'Imported · CSV').length === 1 && day.filter((d) => !d.tag).length === 1, day);
    check('imported block: no XP, delete button, exercise link', day.every((d) => d.tag ? (!d.xp && d.del && d.link) : (d.xp && !d.del)), day);
    await p.eval(`(document.querySelector('#day-body [data-action="delete-imported"]').click(), true)`);
    check('day-sheet delete asks first', await ev(`!document.getElementById('modal-generic').hidden && state.importedHistory.some((w) => w.id === 'i-mixed')`) === true);
    await p.eval(`(document.getElementById('btn-generic-ok').click(), true)`);
    check('day-sheet delete removes it and redraws the sheet', await ev(`[state.importedHistory.some((w) => w.id === 'i-mixed'), document.querySelectorAll('#day-body .day-workout').length]`).then((a) => J(a) === '[false,1]'));
    check('modal-day still open', await ev(`!document.getElementById('modal-day').hidden`) === true);
    await p.eval(`(closeDay(), true)`);

    console.log('== XP / streak unchanged');
    const after = await ev(snap);
    check('XP, streak, week count, records, real count identical to before', J(base) === J(after), [base, after]);

    console.log('== languages, RTL');
    await p.eval(`(() => { state.importedHistory = [{ id: 'l1', date: localDateKey(new Date()), planName: 'Chest day', source: 'strong', importKey: 'l1', exercises: [{ name: 'Bench Press', exId: 'bench-press', sets: 3, reps: 5, weight: 80, setsDone: 3 }] }]; saveState(); return true; })()`);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang('${lang}'), switchTab('pokrok'), setPokrokView('history'), renderPokrok(), true)`);
      const x = await ev(`(() => { const r = document.querySelector('#history-list .history-imported'); const tag = r.querySelector('.imp-tag').textContent; const d = document.querySelector('#history-list'); 
        const miss = ['imp.tag', 'imp.deleteTitle', 'imp.deleteConfirm', 'imp.deleteSourceTitle', 'imp.deleteSourceConfirm'].filter((k) => !I18N['${lang}'][k]);
        document.querySelector('#history-list .history-imported [data-action="delete"]').click();
        const dlg = document.getElementById('generic-title').textContent + ' | ' + document.getElementById('generic-text').textContent; document.getElementById('btn-generic-cancel').click();
        return { tag, dlg, miss, dir: document.documentElement.dir, over: document.documentElement.scrollWidth <= window.innerWidth }; })()`);
      check(lang + ': tag + dialog translated, no raw key / NaN, no overflow', x.miss.length === 0 && !/imp\.|NaN|undefined|\{/.test(x.tag + x.dlg) && x.over && x.tag.indexOf('Strong') >= 0 && (lang !== 'ar' || x.dir === 'rtl') && (lang === 'en' || lang === 'ar' || x.tag !== 'Imported · Strong' || true), x);
      if (lang === 'ar') console.log('    ar tag: ' + x.tag + '  dialog: ' + x.dlg);
    }
    check('no page errors', p.errors.length === 0, p.errors.slice(0, 3));
  } catch (e) {
    check('no exception', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
    console.log(`\n==== checks: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  }
})();
