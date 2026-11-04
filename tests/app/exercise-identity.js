'use strict';
/* GymQuest — stabilná identita cviku (v100), v reálnom headless Chrome. Bez účtov a siete.

     GQ_TEST_PORT=8190 node tests/app/exercise-identity.js

   Kontroly: knižničné riadky ("Dips") si nechajú id; vlastné "My Curl" vo viacerých plánoch (aj " my  curl ")
   dostanú rovnaké cx- id, "Assisted dips" iné; existujúce cx- id sa ponechá; cudzie id sa nahradí; opakovaný
   backfill nič nemení; dva čerstvé prehliadače s rovnakým uloženým stavom spočítajú rovnaké id; syncContentHash
   je po druhom načítaní rovnaký; história sa nemení; rozbehnutý tréning cez aktualizáciu zachová značky
   vlastného cviku (aj pri cudzom id); "vs minule" nájde starú históriu vlastného cviku; editor plánu ukladá
   rovnaké id novým aj premenovaným riadkom. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-identity');
const J = JSON.stringify;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

/* Stav uložený "starou" verziou: vlastné riadky bez id, jedno cudzie id, jedno existujúce cx- id. */
const SEED = `(() => {
  const s = defaultState();
  s.plans.pa = { id: 'pa', builtin: false, customName: 'A', location: null, exercises: [
    { id: 'dips', builtin: true, name: 'Dips', sets: 3, reps: 10, weight: 0 },
    { name: 'My Curl', sets: 3, reps: 10, weight: 12 },
    { id: 'legacy-1', name: 'Foo press', sets: 2, reps: 8, weight: 30 },
    { id: 'cx-keepme', name: 'Kept one', sets: 2, reps: 8, weight: 5 }] };
  s.plans.pb = { id: 'pb', builtin: false, customName: 'B', location: null, exercises: [
    { name: 'My Curl', sets: 4, reps: 8, weight: 14 },
    { name: 'Assisted dips', sets: 3, reps: 8, weight: 20 }] };
  s.plans.pc = { id: 'pc', builtin: false, customName: 'C', location: null, exercises: [
    { name: ' my  curl ', sets: 2, reps: 12, weight: 10 }, { name: '   ', sets: 1, reps: 1, weight: 0 }] };
  s.settings.restPresets = [60, 90, 120].map((n) => ({ id: 'rp' + n, seconds: n, name: '' }));   // inak ich každé zariadenie vygeneruje náhodne
  s.planOrder.push('pa', 'pb', 'pc');
  s.history = [{ id: 'h1', planId: 'pb', planName: 'B', date: '2026-10-01', xp: 30, note: '', exercises: [
    { name: 'My Curl', sets: 4, reps: 8, weight: 13, setsDone: 4 }, { name: 'Assisted dips', sets: 3, reps: 8, weight: 18, setsDone: 3 }] }];
  s.activeSession = { id: 'sess1', startedAt: Date.now() - 600000, planId: 'pa', planName: 'A',
    completedSets: { 'c:My Curl:0': true, 'c:My Curl:1': true, 'legacy-1:0': true, 'dips:0': true },
    actualFailureSets: { 'legacy-1:1': true }, setDelta: { 'legacy-1': 1, 'c:My Curl': 1 },
    drops: { 'legacy-1': [{ w: 20, r: 8, done: false }] } };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  return true; })()`;
const DUMP = `(async () => ({ plans: JSON.stringify(state.plans), hist: JSON.stringify(state.history),
  sess: JSON.stringify(state.activeSession), hash: await syncContentHash(state, {}) }))()`;

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const tag = Date.now().toString(36);
  const b1 = new Browser('ident1-' + tag, 9892, path.join(WORK, 'profiles'));
  const b2 = new Browser('ident2-' + tag, 9893, path.join(WORK, 'profiles'));
  try {
    const p = await b1.launch();
    await p.navigate(BASE);
    await p.eval(SEED);
    const histBefore = await p.eval(`JSON.stringify(JSON.parse(localStorage.getItem(STORAGE_KEY)).history)`);
    await p.reload();
    const ids = () => p.eval(`(() => { const o = {}; for (const id of ['pa','pb','pc']) o[id] = state.plans[id].exercises.map((e) => e.id || null); return o; })()`);
    const a = await ids();
    const curl = a.pa[1];
    console.log('== identity');
    check('library row keeps its id', a.pa[0] === 'dips', a.pa);
    check('custom "My Curl" gets a cx- id', /^cx-[0-9a-z]+$/.test(curl), curl);
    check('same name in another plan -> same id', a.pb[0] === curl, a);
    check('" my  curl " (spaces, case) -> same id', a.pc[0] === curl, a);
    check('"Assisted dips" gets a different cx- id', /^cx-/.test(a.pb[1]) && a.pb[1] !== curl && a.pb[1] !== 'dips', a.pb);
    check('existing cx- id is kept', a.pa[3] === 'cx-keepme', a.pa);
    check('foreign id is replaced by the deterministic cx- id', /^cx-/.test(a.pa[2]) && a.pa[2] !== 'legacy-1' && a.pa[2] === await p.eval(`exerciseIdentity({ name: 'Foo press' })`), a.pa);
    check('empty name -> no id (identity null)', a.pc[1] === null && await p.eval(`exerciseIdentity({ name: '  ' }) === null`), a.pc);
    check('exerciseIdentity(library row) = library id', await p.eval(`exerciseIdentity({ id: 'dips', name: 'x' }) === 'dips'`));
    check('id matches the documented formula (FNV-1a base36)', await p.eval(`(() => { let h = 0x811c9dc5; for (const c of 'my curl') { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return exerciseIdentity({ name: 'My Curl' }) === 'cx-' + h.toString(36); })()`));

    console.log('== idempotent + hash + history');
    const d1 = JSON.parse(await p.eval(`(async () => JSON.stringify(await ${DUMP}))()`));
    await p.eval(`(backfillState(), backfillState(), true)`);
    const d2 = JSON.parse(await p.eval(`(async () => JSON.stringify(await ${DUMP}))()`));
    check('backfill twice changes nothing (plans)', d1.plans === d2.plans);
    await p.eval(`saveState()`);
    await p.reload();
    const d3 = JSON.parse(await p.eval(`(async () => JSON.stringify(await ${DUMP}))()`));
    check('plans identical after another load', d1.plans === d3.plans);
    check('syncContentHash equal after second load (no false dirty)', d1.hash === d3.hash, [d1.hash, d3.hash]);
    check('history untouched', d3.hist === histBefore, d3.hist);

    console.log('== running session across the update');
    const m = await p.eval(`(() => { const sess = state.activeSession; const curlRow = state.plans.pa.exercises[1]; const fooRow = state.plans.pa.exercises[2];
      return { keyCurl: exerciseSessionKey(curlRow), keyFoo: exerciseSessionKey(fooRow), doneCurl: countDoneSets(curlRow), doneFoo: countDoneSets(fooRow),
        doneDips: countDoneSets(state.plans.pa.exercises[0]), setsFoo: sessionSetCount(fooRow), setsCurl: sessionSetCount(curlRow),
        dropsFoo: (sess.drops['c:Foo press'] || []).length, fail: JSON.stringify(sess.actualFailureSets), completed: JSON.stringify(sess.completedSets),
        oldKeysGone: !('legacy-1:0' in sess.completedSets) && !('legacy-1' in sess.setDelta) && !('legacy-1' in sess.drops) }; })()`);
    check('custom exercise session key stays c:<name> (marks kept)', m.keyCurl === 'c:My Curl' && m.doneCurl === 2, m);
    check('existing non-derived cx- id keeps being its own session key', await p.eval(`exerciseSessionKey(state.plans.pa.exercises[3]) === 'cx-keepme'`));
    check('library marks kept', m.doneDips === 1, m);
    check('foreign-id exercise: marks moved to the new key', m.keyFoo === 'c:Foo press' && m.doneFoo === 1 && m.oldKeysGone, m);
    check('foreign-id exercise: set delta, drops and failure marks moved', m.setsFoo === 3 && m.dropsFoo === 1 && /c:Foo press:1/.test(m.fail), m);
    check('custom exercise set delta kept', m.setsCurl === 4, m);
    const marked = await p.eval(`(() => { const row = state.plans.pa.exercises[1]; toggleSetMark('done', row, 2, true); return countDoneSets(row); })()`);
    check('new mark on a custom exercise adds to the old ones', marked === 3, marked);

    console.log('== history matching by name');
    const prev = await p.eval(`(() => { const r = state.plans.pb.exercises[0]; const f = previousWorkoutFor(r, '2026-11-01', 'pb'); const r2 = state.plans.pb.exercises[1]; const f2 = previousWorkoutFor(r2, '2026-11-01', 'pb');
      return { w: f && f.weight, w2: f2 && f2.weight }; })()`);
    check('previousWorkoutFor finds the old history of a custom exercise', prev.w === 13 && prev.w2 === 18, prev);
    const recs = await p.eval(`(() => { try { return typeof computeRecords === 'function' ? Object.keys(computeRecords() || {}).length : -1; } catch (e) { return String(e); } })()`);
    check('records still compute without error', typeof recs === 'number', recs);

    console.log('== NFC and hash collision');
    check('NFC: composed and decomposed accents give the same id', await p.eval(`exerciseIdentity({ name: 'Zdv\u00edhanie caf\u00e9' }) === exerciseIdentity({ name: 'Zdvi\u0301hanie cafe\u0301' })`));
    const col = await p.eval(`(() => { const orig = window.stableHash; window.stableHash = () => 'zz';
      try {
        state.plans.pc.exercises = [{ name: 'Alpha', sets: 1, reps: 1, weight: 0, id: 'cx-zz' }, { name: 'beta', sets: 1, reps: 1, weight: 0, id: 'cx-zz' }, { name: ' ALPHA ', sets: 1, reps: 1, weight: 0 }, { name: 'gamma', sets: 1, reps: 1, weight: 0 }];
        state.planOrder = state.planOrder.filter((x) => x !== 'pc').concat('pc');
        backfillState(); const first = state.plans.pc.exercises.map((e) => e.id);
        backfillState(); const second = state.plans.pc.exercises.map((e) => e.id);
        return { first, second };
      } finally { window.stableHash = orig; } })()`);
    check('colliding different names get -2, -3 suffixes in order; same name shares the id', J(col.first) === J(['cx-zz', 'cx-zz-2', 'cx-zz', 'cx-zz-3']), col);
    check('collision handling is idempotent', J(col.first) === J(col.second), col);

    console.log('== plan editor');
    const ed = await p.eval(`(() => { state.activeSession = null; startEditPlan('pa');
      editDraft.push({ name: '  Brand New  ', sets: 3, reps: 10, weight: 0, plannedFailureSets: [] });
      const inp = document.querySelectorAll('.edit-name')[1]; inp.value = 'My Curl 2'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('edit-plan-name').value = 'A'; saveEditPlan();
      const ex = state.plans.pa.exercises;
      return { fresh: ex[ex.length - 1].id, expectFresh: exerciseIdentity({ name: 'brand new' }), renamed: ex[1].id, expectRenamed: exerciseIdentity({ name: 'My Curl 2' }), dips: ex[0].id, kept: ex[3].id, expectKept: exerciseIdentity({ name: 'Kept one' }) }; })()`);
    check('new custom row from the editor gets the deterministic id', ed.fresh && ed.fresh === ed.expectFresh, ed);
    check('renamed custom row follows its new name', ed.renamed === ed.expectRenamed && ed.renamed !== curl, ed);
    check('library row and untouched cx- row keep their ids on editor save', ed.dips === 'dips' && ed.kept === 'cx-keepme', ed);
    const sugg = await p.eval(`(() => customExercisesMatching('').map((x) => x.name.toLowerCase()).sort())()`);
    check('customExercisesMatching offers each identity once', new Set(sugg).size === sugg.length && sugg.filter((n) => n.replace(/\\s+/g, ' ').trim() === 'my curl').length <= 1, sugg);
    check('no page errors (browser 1)', p.errors.length === 0, p.errors.slice(0, 3));

    console.log('== second fresh browser, same saved state');
    const p2 = await b2.launch();
    await p2.navigate(BASE);
    await p2.eval(SEED);
    await p2.reload();
    await p2.eval(`saveState()`);
    await p2.reload();
    const a2 = await p2.eval(`(() => { const o = {}; for (const id of ['pa','pb','pc']) o[id] = state.plans[id].exercises.map((e) => e.id || null); return o; })()`);
    check('two devices compute identical ids', J(a2) === J(a), [a, a2]);
    const h2 = await p2.eval(`(async () => syncContentHash(state, {}))()`);
    check('...and the same content hash', h2 === d1.hash, [h2, d1.hash]);
    check('no page errors (browser 2)', p2.errors.length === 0, p2.errors.slice(0, 3));
  } catch (e) {
    check('no exception', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b1.killHard(true); b2.killHard(true);
    await server.close();
    console.log(`\n==== checks: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  }
})();
