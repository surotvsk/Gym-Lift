'use strict';
/* Gym-Lift — Fáza 3 / úloha 3: CSV parser, rozpoznanie formátu (Strong / Hevy / Gym-Lift) a mapovanie na importované tréningy.
   Čisté funkcie v reálnom headless Chrome; súbory (tests/fixtures/csv) sa čítajú v Node a posielajú sa do stránky ako text.

     node tests/app/csv-parse.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-csv-parse');
const FIX = path.join(REPO, 'tests', 'fixtures', 'csv');
const J = JSON.stringify;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
const fx = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('csvp-' + Date.now().toString(36), 9899, path.join(WORK, 'profiles'));
  const p = await b.launch();
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);
    const ev = (expr) => p.eval(`(() => { try { const v = ${expr}; return JSON.stringify(v === undefined ? null : v); } catch (e) { return JSON.stringify({ threw: String(e), code: e && e.code, line: e && e.line, name: e && e.name }); } })()`).then((s) => JSON.parse(s));
    /* Celý import cez fixture: parse -> detekcia -> mapovanie. */
    const run = (name, opts) => ev(`(() => { const r = parseCsv(${J(fx(name))}); const f = detectCsvFormat(r.rows[0]); const o = csvToWorkouts(r.rows, f, ${J(opts || { unit: null })}); return { delimiter: r.delimiter, format: f, rows: r.rows.length, o }; })()`);

    /* ---- parseCsv ---- */
    const q = await ev(`parseCsv('a,"b,c","d""e","f\\ng"\\nx,y,z,w\\n')`);
    check('parseCsv: quoted comma, "" escape, embedded newline', q && J(q.rows) === J([['a', 'b,c', 'd"e', 'f\ng'], ['x', 'y', 'z', 'w']]) && q.delimiter === ',', q);
    const bc = await ev(`parseCsv('\\uFEFFa,b\\r\\n1,2\\r\\n\\r\\n')`);
    check('parseCsv: BOM + CRLF + empty trailing lines', bc && J(bc.rows) === J([['a', 'b'], ['1', '2']]), bc);
    const sc = await ev(`parseCsv('a;b;c\\n1;"2;x";3,5\\n')`);
    check('parseCsv: ; delimiter detected from header (commas stay in data)', sc && sc.delimiter === ';' && J(sc.rows) === J([['a', 'b', 'c'], ['1', '2;x', '3,5']]), sc);
    const noNl = await ev(`parseCsv('a,b\\n1,2')`);
    check('parseCsv: no trailing newline, trailing delimiter', noNl && J(noNl.rows) === J([['a', 'b'], ['1', '2']]) && J((await ev(`parseCsv('a,b\\n1,')`)).rows) === J([['a', 'b'], ['1', '']]));
    const bq = await ev(`parseCsv(${J(fx('broken-quotes.csv'))})`);
    check('broken-quotes.csv throws CsvError with the line of the open quote', bq && bq.threw && bq.name === 'CsvError' && bq.code === 'unterminated-quote' && bq.line === 3, bq);
    const bq2 = await ev(`parseCsv('a,b\\n1,"x\\ny\\nz')`);
    check('unterminated quote after an embedded newline reports the opening line', bq2 && bq2.line === 2 && bq2.name === 'CsvError', bq2);

    /* ---- Ochrana pred patologickým vstupom ---- */
    const t0 = Date.now();
    const huge = await ev(`(() => { const s = 'a,b\\n"' + 'x'.repeat(8e6) + '",1\\n'; const r = parseCsv(s); return { n: r.rows.length, len: r.rows[1][0].length }; })()`);
    check('one huge quoted field parses (linear)', huge && huge.n === 2 && huge.len === 8e6, huge);
    const commas = await ev(`(() => { try { parseCsv(','.repeat(1e7)); return 'no throw'; } catch (e) { return e.name + ':' + e.code; } })()`);
    check('10 MB of commas is refused fast', commas === 'CsvError:too-many-columns', commas);
    const many = await ev(`(() => { try { parseCsv('a,b\\n' + '1,2\\n'.repeat(200001)); return 'no throw'; } catch (e) { return e.name + ':' + e.code; } })()`);
    check('200,001 rows is refused inside the parser', many === 'CsvError:too-many-rows', many);
    const okMax = await ev(`parseCsv('a,b\\n' + '1,2\\n'.repeat(199999)).rows.length`);
    check('exactly 200,000 rows (header + 199,999) is accepted', okMax === 200000, okMax);
    const nl = await ev(`parseCsv('\\n'.repeat(5e6)).rows.length`);
    check('5 million empty lines is fast and yields no rows', nl === 0, nl);
    const unterm = await ev(`(() => { try { parseCsv('a,b\\n"' + 'x'.repeat(8e6)); return 'no throw'; } catch (e) { return e.code + ':' + e.line; } })()`);
    check('huge unterminated quote throws CsvError quickly', unterm === 'unterminated-quote:2', unterm);
    check('pathological inputs finished within 20 s', Date.now() - t0 < 20000, Date.now() - t0);

    /* ---- Detekcia ---- */
    for (const [n, f] of [['strong-kg-comma.csv', 'strong'], ['strong-lb-semicolon-decimal-comma.csv', 'strong'], ['strong-no-unit.csv', 'strong'],
      ['hevy.csv', 'hevy'], ['hevy-supersets-rpe-warmup-drop.csv', 'hevy'], ['gymquest-export.csv', 'gymquest'], ['bom-crlf.csv', 'strong']]) {
      const r = await run(n);
      check('detect ' + n + ' -> ' + f, r && r.format === f, r && r.format);
    }
    check('detect: unknown header -> null', (await ev(`detectCsvFormat(['foo', 'bar', 'baz'])`)) === null);
    check('detect: empty / non-array -> null', (await ev(`[detectCsvFormat([]), detectCsvFormat(null), detectCsvFormat(undefined)]`)).every((v) => v === null));
    check('detect: header with spaces/case still matches', (await ev(`detectCsvFormat([' DATE ', 'workout name', 'Exercise Name', 'Set Order', 'Weight', 'Reps'])`)) === 'strong');

    /* ---- Strong, kg, čiarka ---- */
    const sk = await run('strong-kg-comma.csv');
    const w = sk.o.workouts;
    check('Strong kg: 2 workouts, unit kg detected from the column', w.length === 2 && sk.o.unitDetected === 'kg', [w.length, sk.o.unitDetected]);
    check('Strong kg: date, title, source, importKey, duration', w[0].date === '2024-03-04' && w[0].planName === 'Push Day' && w[0].source === 'strong'
      && w[0].importKey === 'strong|2024-03-04 18:00:12|Push Day' && w[0].durationSeconds === 3900 && w[1].durationSeconds === 2880 && w[1].date === '2024-03-06', w[0]);
    const bench = w[0].exercises[0];
    check('Strong kg: bench press matched, 3 working sets + 1 warm-up', bench.exId === 'bench-press' && bench.sets === 3 && J(bench.setWeights) === '[60,70,70]' && J(bench.setReps) === '[8,6,5]'
      && bench.setsDone === 3 && J(bench.doneSets) === '[1,2,3]' && J(bench.warmups) === J([{ weight: 40, reps: 10 }]) && bench.weight === 70, bench);
    check('Strong kg: RPE of set 3 -> setRpe', J(bench.setRpe) === '[null,null,9]', bench.setRpe);
    check('Strong kg: file order of exercises', J(w[0].exercises.map((e) => e.exId || e.name)) === J(['bench-press', 'overhead-press', 'Zercher Squat', 'plank']), w[0].exercises.map((e) => e.exId || e.name));
    const plank = w[0].exercises[3];
    check('Strong kg: plank with 60 s -> durationSeconds, reps 0', plank.exId === 'plank' && plank.durationSeconds === 60 && J(plank.setReps) === '[0]', plank);
    const row = w[1].exercises[1];
    check('Strong kg: Rest Timer row ignored; failure + drop mapped', row.exId === 'bent-over-rows' && row.sets === 3 && J(row.setWeights) === '[60,60,60]' && J(row.actualFailureSets) === '[3]'
      && J(row.drops) === J([{ weight: 40, reps: 8 }]) && J(row.setRpe) === '[null,null,10]', row);
    check('Strong kg: Zercher Squat unmatched and kept as a custom name', J(sk.o.unmatched) === '["Zercher Squat"]' && !w[0].exercises[2].exId && w[0].exercises[2].name === 'Zercher Squat', sk.o.unmatched);
    check('Strong kg: skippedRows counts the Rest Timer row', sk.o.skippedRows === 1, sk.o.skippedRows);

    /* ---- Strong, lb, ; a desatinná čiarka ---- */
    const sl = await run('strong-lb-semicolon-decimal-comma.csv');
    const lw = sl.o.workouts;
    check('Strong lb: delimiter ; and unit lb detected', sl.delimiter === ';' && sl.o.unitDetected === 'lb' && lw.length === 2, [sl.delimiter, sl.o.unitDetected, lw.length]);
    const lb = lw[0].exercises.find((e) => e.exId === 'bench-press');
    check('Strong lb: 225 lb -> 102 kg, 135,5 lb -> 61.5 kg', lb && J(lb.setWeights) === '[102,61.5]' && J(lb.setReps) === '[5,8]', lb);
    check('Strong lb: RPE 8,5 with decimal comma', J(lb.setRpe) === '[null,8.5]', lb && lb.setRpe);
    check('Strong lb: Workout Duration column, 44m', lw[0].durationSeconds === 2640, lw[0].durationSeconds);
    check('Strong lb: 185 lb -> 84 kg', lw[1].exercises[0].setWeights[0] === 84, lw[1].exercises[0].setWeights);

    /* ---- Strong bez stĺpca s jednotkou ---- */
    const sn = await run('strong-no-unit.csv');
    check('Strong no unit: unitDetected null, values kept as kg by default', sn.o.unitDetected === null && sn.o.workouts[0].exercises[0].setWeights[0] === 100 && sn.o.workouts.length === 2, sn.o);
    const snl = await run('strong-no-unit.csv', { unit: 'lb' });
    check('Strong no unit + opts.unit lb: converted (100 lb -> 45.25 kg, 200 lb -> 90.75)', snl.o.workouts[0].exercises[0].setWeights[0] === 45.25 && snl.o.workouts[0].exercises[1].setWeights[0] === 90.75 && snl.o.unitDetected === null, snl.o.workouts[0].exercises.map((e) => e.setWeights));
    check('Strong no unit: library matches via aliases', J(sn.o.workouts.flatMap((x) => x.exercises.map((e) => e.exId))) === J(['squats', 'leg-press', 'bicep-curls', 'hammer-curl']), sn.o.workouts.flatMap((x) => x.exercises.map((e) => e.exId)));

    /* ---- BOM + CRLF ---- */
    const bm = await run('bom-crlf.csv');
    check('BOM + CRLF fixture: 1 workout, 3 exercises-rows parsed, header clean', bm.rows === 4 && bm.o.workouts.length === 1 && bm.o.workouts[0].exercises.length === 2
      && bm.o.workouts[0].exercises[0].exId === 'squats' && bm.o.workouts[0].exercises[1].exId === 'dips', bm);

    /* ---- Hevy ---- */
    const hv = await run('hevy.csv');
    const hw = hv.o.workouts;
    check('Hevy: 2 workouts, kg detected, date from "15 Nov 2024, 18:02"', hw.length === 2 && hv.o.unitDetected === 'kg' && hw[0].date === '2024-11-15' && hw[1].date === '2024-11-17' && hw[0].source === 'hevy'
      && hw[0].importKey === 'hevy|15 Nov 2024, 18:02|Morning workout', hw[0]);
    check('Hevy: duration = end - start (63 min)', hw[0].durationSeconds === 3780 && hw[1].durationSeconds === 3000, [hw[0].durationSeconds, hw[1].durationSeconds]);
    check('Hevy: sets, RPE 8.5, empty weight/reps with duration_seconds (plank)', J(hw[0].exercises[0].setWeights) === '[60,70]' && J(hw[0].exercises[0].setRpe) === '[null,8.5]' && hw[0].exercises[2].exId === 'plank'
      && hw[0].exercises[2].durationSeconds === 90 && hw[0].exercises[1].exId === 'lat-pulldown', hw[0].exercises);
    const hs = await run('hevy-supersets-rpe-warmup-drop.csv');
    const ex = hs.o.workouts[0].exercises;
    check('Hevy: date "Oct 13, 2026, 9:50 PM" -> 2026-10-13, duration 55 min', hs.o.workouts[0].date === '2026-10-13' && hs.o.workouts[0].durationSeconds === 3300, hs.o.workouts[0]);
    check('Hevy: warmup, normal+failure, dropset map to warmups / sets / actualFailureSets / drops', ex[0].exId === 'bench-press' && J(ex[0].warmups) === J([{ weight: 40, reps: 10 }]) && ex[0].sets === 2
      && J(ex[0].setWeights) === '[80,80]' && J(ex[0].setReps) === '[6,4]' && J(ex[0].actualFailureSets) === '[2]' && J(ex[0].drops) === J([{ weight: 60, reps: 8 }]) && J(ex[0].setRpe) === '[8,10]', ex[0]);
    check('Hevy: superset id 0 on two consecutive exercises -> shared group, the third has none', ex[0].group && ex[0].group === ex[1].group && !ex[2].group && ex[1].setRpe && ex[1].setRpe[0] === 7.5, ex.map((e) => e.group));
    const hl = await ev(`(() => { const r = parseCsv(${J(fx('hevy.csv').replace('weight_kg', 'weight_lbs'))}); const o = csvToWorkouts(r.rows, detectCsvFormat(r.rows[0]), { unit: null }); return { f: detectCsvFormat(r.rows[0]), u: o.unitDetected, w: o.workouts[0].exercises[0].setWeights }; })()`);
    check('Hevy weight_lbs header: detected as lb and converted (60 lb -> 27.25)', hl.f === 'hevy' && hl.u === 'lb' && J(hl.w) === '[27.25,31.75]', hl);

    /* ---- Gym-Lift export ---- */
    const gq = await run('gymquest-export.csv');
    check('Gym-Lift export: source csv, 1 workout, library exercises matched, kg', gq.o.workouts.length === 1 && gq.o.workouts[0].source === 'csv' && gq.o.workouts[0].exercises[0].exId === 'bench-press'
      && gq.o.workouts[0].exercises[1].exId === 'overhead-press' && gq.o.unitDetected === 'kg' && J(gq.o.workouts[0].exercises[0].setRpe) === '[null,8]', gq.o.workouts[0]);

    /* ---- Zhoda názvov ---- */
    const mt = await ev(`({ a: matchExercise('Bench Press (Barbell)'), b: matchExercise('Drepy'), c: matchExercise('  BENCH   press '), d: matchExercise('Zercher Squat'), e: matchExercise('Sentadillas'), f: matchExercise(''), g: matchExercise(null) })`);
    check('match: Bench Press (Barbell) -> bench-press', mt.a.exId === 'bench-press', mt.a);
    check('match: Slovak library name -> id', mt.b.exId === 'squats', mt.b);
    check('match: case- and space-insensitive', mt.c.exId === 'bench-press', mt.c);
    check('match: other language (es)', mt.e.exId === 'squats', mt.e);
    check('match: unknown -> exId null + original name', mt.d.exId === null && mt.d.name === 'Zercher Squat', mt.d);
    check('match: empty / null never throws', mt.f.exId === null && mt.g.exId === null, [mt.f, mt.g]);
    const al = await ev(`(() => { const bad = Object.entries(CSV_EXERCISE_ALIASES).filter(([k, id]) => !BUILTIN_EXERCISE_IDS.has(id)); const ids = new Set(Object.values(CSV_EXERCISE_ALIASES)); return { bad, n: Object.keys(CSV_EXERCISE_ALIASES).length, covered: EXERCISE_LIBRARY.filter((e) => !ids.has(e.id)).map((e) => e.id) }; })()`);
    check('aliases: every target is a library id', al.bad.length === 0, al.bad);
    check('aliases: library exercises without any alias are only the ones with no Strong/Hevy name', al.covered.length <= 6, al.covered);
    for (const [name, id] of [['Squat (Barbell)', 'squats'], ['Romanian Deadlift (Barbell)', 'romanian-deadlift'], ['Pull Up (Assisted)', 'assisted-pull-ups'], ['Push Up', 'push-up'], ['Lat Pulldown (Cable)', 'lat-pulldown']]) {
      const m = await ev(`matchExercise(${J(name)})`);
      check('alias ' + name + ' -> ' + id, m && m.exId === id, m);
    }

    /* ---- Platnosť importovaných tréningov ---- */
    const all = await ev(`(() => { const out = []; const files = ${J(['strong-kg-comma.csv', 'strong-lb-semicolon-decimal-comma.csv', 'strong-no-unit.csv', 'hevy.csv', 'hevy-supersets-rpe-warmup-drop.csv', 'gymquest-export.csv', 'bom-crlf.csv'].map(fx))};
      for (const text of files) { const r = parseCsv(text); const o = csvToWorkouts(r.rows, detectCsvFormat(r.rows[0]), { unit: null }); out.push(...o.workouts); }
      const cleaned = cleanImportedHistory(out);
      const ids = new Set(out.map((x) => x.id));
      return { n: out.length, kept: cleaned.length, unique: ids.size, sets: out.map((x) => x.exercises.map((e) => historyWorkingSets(e).length === e.sets)).flat(), drops: out.flatMap((x) => x.exercises.map((e) => e.drops ? historyDropSets(e).length === e.drops.length : true)),
        ws: historyWorkingSets(out[0].exercises[0]).map((s) => [s.weight, s.reps, s.rpe, s.failure]), keys: new Set(out.map((x) => x.importKey)).size };
    })()`);
    check('every produced workout passes cleanImportedHistory with unique ids and keys', all.n === 11 && all.kept === all.n && all.unique === all.n && all.keys === all.n, all);
    check('historyWorkingSets returns every working set of every exercise; drops valid', all.sets.every(Boolean) && all.drops.every(Boolean), all);
    check('historyWorkingSets of the first exercise: weights, reps, rpe, failure flag', J(all.ws) === '[[60,8,null,false],[70,6,null,false],[70,5,9,false]]', all.ws);

    /* ---- Odpad ---- */
    const g = await ev(`(() => { const res = []; const junk = ['', ' ', '\\u0000\\u0001\\u0002,\\uFFFD\\n\\u0000;;"', 'PK\\u0003\\u0004\\u0014\\u0000\\u0006\\u0000', '"', ',,,,\\n,,,,', 'Date,Workout Name\\n1,2', 'a'.repeat(1e5)];
      for (const s of junk) { try { const r = parseCsv(s); const f = detectCsvFormat(r.rows[0] || []); const o = csvToWorkouts(r.rows, f, { unit: null }); res.push(Array.isArray(o.workouts) && o.workouts.length === 0 ? 'ok' : 'bad:' + JSON.stringify(o)); } catch (e) { res.push(e.name === 'CsvError' ? 'csverr' : 'THREW ' + e); } }
      /* nepravdivé vstupy priamo do csvToWorkouts */
      for (const args of [[null, 'strong'], [[], 'hevy'], [[['x']], 'strong'], [[['Date', 'Exercise Name'], ['2024-01-01']], 'strong'], [[['Date']], 'bogus'], [undefined, undefined]]) { try { const o = csvToWorkouts(args[0], args[1], undefined); res.push(o.workouts.length === 0 ? 'ok' : 'bad'); } catch (e) { res.push('THREW ' + e); } }
      return res; })()`);
    check('garbage / empty input: clean empty result or CsvError, never another exception', Array.isArray(g) && g.every((x) => x === 'ok' || x === 'csverr'), g);
    const bad = await ev(`(() => { const r = parseCsv('Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\\nnot-a-date,X,1m,Bench Press,1,60,5,0,0,,,\\n2024-01-02 10:00:00,X,1m,Bench Press,1,-5,5,0,0,,,\\n2024-01-02 10:00:00,X,1m,Bench Press,1,abc,5,0,0,,,\\n2024-01-02 10:00:00,X,1m,,1,60,5,0,0,,,\\n2024-01-02 10:00:00,X,1m,Bench Press,1,60,5,0,0,,,'); const o = csvToWorkouts(r.rows, 'strong', { unit: null }); return { w: o.workouts.length, sk: o.skippedRows, sets: o.workouts[0] && o.workouts[0].exercises[0].sets }; })()`);
    check('bad rows (date, negative / non-numeric weight, no exercise) are skipped and counted', bad.w === 1 && bad.sk === 4 && bad.sets === 1, bad);
  } catch (e) {
    check('no exception', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
    console.log(`\n==== checks: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  }
})();
