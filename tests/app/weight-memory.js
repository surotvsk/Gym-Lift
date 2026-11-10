'use strict';
/* GymQuest — spoločná pracovná váha po Dokončiť + snímka rozbehnutého tréningu (v100, spec §3.1, §3.3, §3.4),
   v reálnom headless Chrome. Bez účtov a siete (prázdna Community konfigurácia).

     GQ_TEST_PORT=8190 node tests/app/weight-memory.js

   Checks: Dokončiť zapíše váhu iba do plánu tréningu (váha patrí plánu, rozhodnutie vlastníka 2026-11-10;
   strana/asistencia sú spoločné) aj do settings.exerciseMemory (predvoľba pre nový riadok / rýchly tréning); história drží skutočné váhy; Zahodiť nič nemení; snímka: zmena plánu zvonka
   počas tréningu nezmení rozbehnutý tréning (ani cez syncApply-ekvivalent), starší tréning bez snímky sa správa ako doteraz;
   rýchly tréning s vlastným cvikom zapíše pamäť; completedMainSets == setWeights z histórie; po obnovení stránky všetko ostane;
   žiadny zápis, keď sa nič nezmenilo. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-weightmemory');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const b = new Browser('wm-' + Date.now().toString(36), 9891, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const E = (code) => p.eval(code);
  const setup = `(() => {
    state.plans['wpush'] = { id: 'wpush', builtin: false, customName: 'W Push', location: null,
      exercises: [{ id: 'bench-press', name: 'Bench Press', sets: 3, reps: 8, weight: 60 },
                  { id: 'cx-x', name: 'My Curl', sets: 2, reps: 10, weight: 20 }] };
    state.plans['wfull'] = { id: 'wfull', builtin: false, customName: 'W Full', location: null,
      exercises: [{ id: 'bench-press', name: 'Bench Press', sets: 4, reps: 5, weight: 60 },
                  { name: ' my  curl ', sets: 3, reps: 12, weight: 20 }] };
    for (const id of ['wpush', 'wfull']) if (!state.planOrder.includes(id)) state.planOrder.push(id);
    backfillState(); saveState(); return true; })()`;
  const start = (id) => E(`(() => { selectedPlan = ${J(id)}; ensureSession(getPlan(${J(id)})); saveState(); switchTab('trening'); renderTrening(); return true; })()`);
  const rowW = (pid, i) => E(`state.plans[${J(pid)}].exercises[${i}].weight`);
  const wi = (pid) => `state.plans[${J(pid)}]`;
  const shownWeights = (idx) => E(`(() => { const ex = document.querySelectorAll('#exercise-list .exercise')[${idx}]; return ex ? Array.from(ex.querySelectorAll('.set-weight')).map((e) => (e.value !== undefined && e.value !== '' ? e.value : e.textContent).trim()) : null; })()`);
  const finish = () => E(`(() => { document.getElementById('modal-confirm').hidden = false; confirmFinish(); return true; })()`);
  try {
    await p.navigate(BASE);
    await E(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await E(setup);

    console.log('== Finish applies the working weight to its own plan only (weight per plan)');
    await start('wpush');
    await E(`(() => { const [a] = ${wi('wpush')}.exercises; setSetWeight(a, 1, 62.5); setSetWeight(a, 2, 62.5);
      toggleSetMark('done', a, 0, true); toggleSetMark('done', a, 1, true); toggleSetMark('done', a, 2, true); saveState(); return true; })()`);
    const seqBefore = await E(`syncMetaRead().seq`);
    await finish();
    const after = await E(`({ push: ${wi('wpush')}.exercises[0].weight, full: ${wi('wfull')}.exercises[0].weight,
      fullSets: ${wi('wfull')}.exercises[0].sets, fullReps: ${wi('wfull')}.exercises[0].reps, pushSets: ${wi('wpush')}.exercises[0].sets,
      mem: state.settings.exerciseMemory['bench-press'], hist: state.history[state.history.length - 1].exercises[0],
      sess: getSession() })`);
    check('Push bench row = 62.5', after.push === 62.5, after.push);
    check('Full Body bench row keeps its own 60 (weight is per plan)', after.full === 60, after.full);
    check('Full Body sets/reps unchanged (4 x 5)', after.fullSets === 4 && after.fullReps === 5, after);
    check('exerciseMemory[bench-press] = 62.5 with at', after.mem && after.mem.weight === 62.5 && Math.abs(after.mem.at - Date.now()) < 60000, after.mem);
    check('history still 60/62.5/62.5', J(after.hist.setWeights) === J([60, 62.5, 62.5]), after.hist.setWeights);
    check('session cleared', after.sess === null);
    check('untouched curl (no sets done) unchanged in both plans', (await rowW('wpush', 1)) === 20 && (await rowW('wfull', 1)) === 20);
    const seqAfter = await E(`syncMetaRead().seq`);
    check('change counter advanced (syncs)', seqAfter > seqBefore, { seqBefore, seqAfter });
    await start('wfull');
    check('next session in Full Body shows its own 60 in all 4 sets', await E(`[0,1,2,3].every((i) => effectiveSetWeight(${wi('wfull')}.exercises[0], i) === 60)`), await shownWeights(0));

    console.log('== Snapshot: outside change during a running session');
    check('session has a snapshot for the exercises', await E(`!!getSession().snapshot && getSession().snapshot['bench-press#0'].weight === 60`));
    await E(`(() => { ${wi('wfull')}.exercises[0].weight = 80; ${wi('wpush')}.exercises[0].weight = 80; saveState(); renderTrening(); return true; })()`);
    check('plan row changed from "another device" to 80', (await rowW('wfull', 0)) === 80);
    check('running session still shows 60 (effectiveSetWeight)', await E(`[0,1,2,3].every((i) => effectiveSetWeight(${wi('wfull')}.exercises[0], i) === 60)`));
    const shown = J(await shownWeights(0));
    check('running session DOM shows no 80', shown.indexOf('80') < 0, shown);
    check('slot exercise carries the snapshot weight', await E(`exerciseSlots(currentPlan())[0].ex.weight === 60`));
    check('snapshot survives normalize (reload path)', await E(`normalizeActiveSession(JSON.parse(JSON.stringify(getSession()))).snapshot['bench-press#0'].weight === 60`));
    check('normalizer drops invalid snapshot entries', await E(`(() => { const s = JSON.parse(JSON.stringify(getSession())); s.snapshot = { a: { weight: 'x' }, b: { weight: 5, unilateral: 1 }, c: 7 }; const n = normalizeActiveSession(s).snapshot; return JSON.stringify(n) === JSON.stringify({ b: { weight: 5 } }); })()`));
    // starší tréning bez snímky: správanie ako doteraz (živý riadok plánu)
    await E(`(() => { delete getSession().snapshot; renderTrening(); return true; })()`);
    check('legacy session without snapshot falls back to live plan row (80)', await E(`[0,1,2,3].every((i) => effectiveSetWeight(${wi('wfull')}.exercises[0], i) === 80)`));
    // per-set override still wins with snapshot
    await E(`(() => { ${wi('wfull')}.exercises[0].weight = 62.5; clearSession(); ensureSession(getPlan('wfull')); ${wi('wfull')}.exercises[0].weight = 70;
      setSetWeight(${wi('wfull')}.exercises[0], 1, 65); return true; })()`);
    check('per-set override wins; other sets stay on snapshot', await E(`[0,1,2,3].map((i) => effectiveSetWeight(${wi('wfull')}.exercises[0], i)).join()`) === '62.5,65,65,65');
    console.log('== Discard changes nothing');
    const snapPlans = await E(`JSON.stringify([state.plans, state.settings.exerciseMemory])`);
    await E(`(() => { clearSession(); saveState(); return true; })()`);
    check('discard (clearSession) leaves plans and memory untouched', (await E(`JSON.stringify([state.plans, state.settings.exerciseMemory])`)) === snapPlans);

    console.log('== completedMainSets == history setWeights');
    await E(`(() => { ${wi('wpush')}.exercises[0].weight = 60; ${wi('wfull')}.exercises[0].weight = 60;
      ${wi('wpush')}.exercises.push({ id: 'cx-u', name: 'Uni Row', sets: 2, reps: 10, weight: 20, unilateral: true, startSide: 'right' }); backfillState(); saveState(); return true; })()`);
    await start('wpush');
    const cmp = await E(`(() => {
      const plan = currentPlan(); const sess = getSession();
      const [a, , u] = exerciseSlots(plan).map((s) => s.ex);
      sess.setDelta = { [exerciseSessionKey(a)]: 1 };                       // + Add set => 4 série
      setSetWeight(a, 1, 65); toggleSetMark('done', a, 2, true);            // hotová séria 3 pred zmenou skoršieho
      setSetWeight(a, 0, 70);                                               // zámok: séria 3 si drží 65
      toggleSetMark('done', a, 0, true); toggleSetMark('done', a, 3, true);
      setSetWeight(u, 0, 25, 'right'); toggleSetMark('done', u, 0, true, 'right'); toggleSetMark('done', u, 0, true, 'left'); toggleSetMark('done', u, 1, true, 'right');
      addExerciseToSession('c:Quick Extra'); const extra = exerciseSlots(plan)[3].ex;
      setSetWeight(extra, 1, 15); toggleSetMark('done', extra, 1, true); toggleSetMark('done', extra, 2, true);
      const out = [];
      for (const ex of [a, u, extra]) {
        const mine = completedMainSets(ex, sess).map((r) => r.weight);
        const e = historyExerciseEntry(ex, sess);
        let theirs;
        if (e.sidesDone) theirs = ['left', 'right'].flatMap((sd) => e.sidesDone[sd].map((n) => e.sideWeights ? e.sideWeights[sd][n - 1] : e.weight));
        else theirs = e.sidesDone ? [] : (e.setWeights ? [] : null);
        if (!e.sidesDone) { const doneN = []; for (let i = 0; i < sessionSetCount(ex); i++) if (setMark('done', ex, i)) doneN.push(i); theirs = doneN.map((i) => (e.setWeights ? e.setWeights[i] : e.weight)); }
        out.push({ name: ex.name, mine: mine.slice().sort(), theirs: theirs.slice().sort(), n: sessionSetCount(ex) });
      }
      return out; })()`);
    for (const c of cmp) check('completedMainSets weights == history setWeights: ' + c.name, J(c.mine) === J(c.theirs) && c.mine.length > 0, c);
    check('+ Add set made 4 sets for the bench', cmp[0].n === 4, cmp[0]);
    await E(`(() => { clearSession(); saveState(); return true; })()`);


    console.log('== Duplicate rows of one exercise in a plan (slot snapshot, first row only)');
    await E(`(() => { state.plans['dA'] = { id: 'dA', builtin: false, customName: 'Dup A', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench Press', sets: 2, reps: 5, weight: 60 }, { id: 'bench-press', name: 'Bench Press', sets: 2, reps: 5, weight: 80 }] };
      state.plans['dB'] = { id: 'dB', builtin: false, customName: 'Dup B', location: null, exercises: [{ id: 'bench-press', name: 'Bench Press', sets: 3, reps: 8, weight: 60 }] };
      for (const id of ['dA', 'dB']) if (!state.planOrder.includes(id)) state.planOrder.push(id);
      for (const id of Object.keys(state.plans)) if (id !== 'dA' && id !== 'dB') for (const r of state.plans[id].exercises || []) if (r.id === 'bench-press') r.weight = 1;
      saveState(); return true; })()`);
    await start('dA');
    check('second slot keeps its own planned 80 (snapshot per slot)', await E(`(() => { const s = exerciseSlots(currentPlan()); return s[0].ex.weight === 60 && s[1].ex.weight === 80 && effectiveSetWeight(state.plans['dA'].exercises[1], 0) === 80; })()`));
    await E(`(() => { const s = exerciseSlots(currentPlan()).map((x) => x.ex);
      setSetWeight(s[0], 0, 62.5);   // poznámka: značky a výnimky sérií duplicity zdieľajú kľúč cviku (existujúci návrh)
      for (const ex of s) { toggleSetMark('done', ex, 0, true); toggleSetMark('done', ex, 1, true); } return true; })()`);
    await finish();
    const dup = await E(`({ a0: state.plans['dA'].exercises[0].weight, a1: state.plans['dA'].exercises[1].weight, b: state.plans['dB'].exercises[0].weight,
      mem: state.settings.exerciseMemory['bench-press'].weight, h: state.history[state.history.length - 1].exercises.map((e) => ({ sw: e.setWeights, pw: e.plannedWeight, w: e.weight })) })`);
    check('A slot1 = 62.5, A slot2 stays 80, B keeps its own 60, memory 62.5', dup.a0 === 62.5 && dup.a1 === 80 && dup.b === 60 && dup.mem === 62.5, dup);
    check('history records both slots with their own planned weight (60 / 80)', dup.h.length === 2 && dup.h[0].pw === 60 && dup.h[1].pw === 80 && J(dup.h[0].sw) === J([62.5, 62.5]), dup.h);

    console.log('== Quick workout / library start uses the remembered weight');
    await E(`(() => { startQuickWorkout('bench-press'); return true; })()`);
    check('quick bench starts at the remembered 62.5', await E(`exerciseSlots(currentPlan())[0].ex.weight === 62.5 && effectiveSetWeight(exerciseSlots(currentPlan())[0].ex, 0) === 62.5`));
    await E(`(() => { clearSession(); saveState(); startQuickWorkout('c:Never Seen'); return true; })()`);
    check('unknown custom exercise starts at 0', await E(`exerciseSlots(currentPlan())[0].ex.weight === 0`));
    await E(`(() => { clearSession(); saveState(); return true; })()`);
    console.log('== Unilateral startSide right + quick workout memory');
    await E(`(() => { ${wi('wpush')}.exercises.pop(); saveState(); return true; })()`);
    await E(`(() => { startQuickWorkout('c:Garage Fly'); return true; })()`);
    const q = await E(`(() => { const ex = exerciseSlots(currentPlan())[0].ex; setSetWeight(ex, 0, 12); toggleSetMark('done', ex, 0, true); toggleSetMark('done', ex, 1, true); toggleSetMark('done', ex, 2, true); return ex.name; })()`);
    await finish();
    const mem = await E(`state.settings.exerciseMemory[exerciseIdentity({ name: 'Garage Fly' })]`);
    check('quick workout custom exercise wrote memory (' + q + ')', mem && mem.weight === 12 && typeof mem.at === 'number', mem);

    console.log('== No write when nothing changes');
    const s1 = await E(`syncMetaRead().seq`);
    const r1 = await E(`rememberExerciseDefaults('bench-press', { weight: 63 }, 1)`);
    const r2 = await E(`rememberExerciseDefaults('bench-press', { weight: 63 }, 2)`);
    const s2 = await E(`syncMetaRead().seq`);
    check('first call changes (62.5 -> 63)', r1 === true);
    check('second identical call: no change, no counter bump', r2 === false && s2 === s1 + 1, { r1, r2, s1, s2 });
    check('unchanged call keeps old at', await E(`state.settings.exerciseMemory['bench-press'].at`) === 1);

    console.log('== Plan editor sets the shared values (Task 4)');
    await E(`(() => { clearSession(); state.plans['wpush'].exercises = [{ id: 'bench-press', name: 'Bench Press', sets: 3, reps: 8, weight: 60 },
        { id: 'dumbbell-curl', name: 'Dumbbell Curl', sets: 3, reps: 10, weight: 12 }];
      state.plans['wfull'].exercises = [{ id: 'bench-press', name: 'Bench Press', sets: 4, reps: 5, weight: 60 },
        { id: 'dumbbell-curl', name: 'Dumbbell Curl', sets: 2, reps: 12, weight: 12 }, { id: 'bench-press', name: 'Bench Press', sets: 2, reps: 15, weight: 40 }];
      state.settings.exerciseMemory = {}; saveState(); switchTab('trening'); return true; })()`);
    const edit = (pid, fn) => E(`(() => { startEditPlan(${J(pid)}); const rows = () => document.querySelectorAll('#edit-rows .edit-row'); ${fn}; return true; })()`);
    const typeNum = (i, k, v) => `(() => { const el = rows()[${i}].querySelectorAll('.edit-num')[${k}]; el.value = ${J(String(v))}; el.dispatchEvent(new Event('input', { bubbles: true })); })();`;
    const save = () => E(`(() => { const s0 = syncMetaRead().seq; saveEditPlan(); return syncMetaRead().seq - s0; })()`);
    await edit('wpush', typeNum(0, 2, 70));
    const bump = await save();
    check('editor save is one change-counter bump', bump === 1, bump);
    check('Push edit to 70 does not touch Full Body (stays 60)', await rowW('wpush', 0) === 70 && await rowW('wfull', 0) === 60);
    check('later duplicate bench row in Full Body keeps its own 40', await rowW('wfull', 2) === 40);
    check('memory bench = 70', await E(`state.settings.exerciseMemory['bench-press'].weight`) === 70);
    await edit('wpush', typeNum(0, 0, 5) + typeNum(0, 1, 3));
    await save();
    const f = await E(`${wi('wfull')}.exercises[0]`);
    check('sets/reps do not propagate (Full Body stays 4 x 5)', f.sets === 4 && f.reps === 5 && await E(`${wi('wpush')}.exercises[0].sets`) === 5);
    const snapRows = () => E(`JSON.stringify([state.plans['wpush'].exercises, state.plans['wfull'].exercises, state.settings.exerciseMemory])`);
    const atBefore = await E(`state.settings.exerciseMemory['bench-press'].at`);
    const rowsBefore = await snapRows();
    await new Promise((r) => setTimeout(r, 20));
    await edit('wpush', `0`);
    await save();
    check('unchanged editor save: memory .at and every plan row unchanged', await E(`state.settings.exerciseMemory['bench-press'].at`) === atBefore && await snapRows() === rowsBefore);
    await edit('wfull', typeNum(2, 2, 45));
    await save();
    check('edit of a later duplicate row stays local (Push 70, first Full Body row 60, dup 45)', await rowW('wpush', 0) === 70 && await rowW('wfull', 0) === 60 && await rowW('wfull', 2) === 45);
    await edit('wpush', `(() => { const c = rows()[1].querySelector('.edit-unilateral'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); rows()[1].querySelector('.side-chip[data-side="right"]').click(); })();`);
    await save();
    const cu = await E(`({ u: ${wi('wfull')}.exercises[1].unilateral, s: ${wi('wfull')}.exercises[1].startSide, mem: state.settings.exerciseMemory[exerciseRowIdentity(state.plans['wpush'].exercises[1])], sets: ${wi('wfull')}.exercises[1].sets })`);
    check('unilateral + start side right reach the other plan; sets stay 2', cu.u === true && cu.s === 'right' && cu.sets === 2, cu);
    check('memory has unilateral + startSide', cu.mem && cu.mem.unilateral === true && cu.mem.startSide === 'right', cu.mem);
    await edit('wfull', `(() => { const c = rows()[1].querySelector('.edit-unilateral'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })();`);
    await save();
    check('turning it off clears unilateral/startSide in Push and memory', await E(`(() => { const e = ${wi('wpush')}.exercises[1]; const m = state.settings.exerciseMemory[exerciseRowIdentity(state.plans['wpush'].exercises[1])]; return e.unilateral === undefined && e.startSide === undefined && m.unilateral === undefined && m.startSide === undefined; })()`));
    console.log('== Task 4 fix round: seeding, cancel, rename, start side, running session, assisted');
    await E(`(() => { state.plans['wlegs'] = { id: 'wlegs', builtin: false, customName: 'W Legs', location: null, exercises: [{ id: 'squat', name: 'Squat', sets: 3, reps: 5, weight: 100 }] };
      if (!state.planOrder.includes('wlegs')) state.planOrder.push('wlegs'); saveState(); return true; })()`);
    await edit('wlegs', `addLibraryExerciseToDraft('bench-press')`);
    check('library add seeds the remembered 70 kg (draft row)', await E(`editDraft[1].weight`) === 70);
    check('note visible on the seeded row', await E(`!document.querySelectorAll('#edit-rows .edit-row')[1].querySelector('.edit-shared-note').hidden`));
    await E(`(() => { const el = document.querySelectorAll('#edit-rows .edit-row')[1].querySelectorAll('.edit-num')[2]; el.value = '80'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await save();
    check('seeded row changed to 80 stays in Legs (Push 70, Full Body 60, dup 45); memory 80', await rowW('wpush', 0) === 70 && await rowW('wfull', 0) === 60 && await rowW('wfull', 2) === 45 && await rowW('wlegs', 1) === 80 && await E(`state.settings.exerciseMemory['bench-press'].weight`) === 80);
    await edit('wlegs', `addLibraryExerciseToDraft('dumbbell-curl'); 0`);
    const seeded = await E(`(() => { const r = editDraft[2]; return r ? [r.weight, r.unilateral] : null; })()`);
    await E(`cancelEditPlan()`);
    const fullState = () => E(`JSON.stringify([state.plans, state.settings.exerciseMemory])`);
    const stBeforeEdit = await fullState();
    await edit('wlegs', typeNum(1, 2, 99));
    await E(`cancelEditPlan()`);
    check('cancel/discard editor: no propagation, nothing changed', await fullState() === stBeforeEdit && await rowW('wpush', 0) === 70);
    await E(`(() => { ${wi('wpush')}.exercises.push({ name: 'Cable Thing', sets: 3, reps: 10, weight: 33 }); backfillState(); rememberExerciseDefaults(exerciseIdentity({ name: 'Cable Thing' }), { weight: 33 }, 5); return true; })()`);
    const rename = (i, name, commit = true) => `(() => { const el = document.querySelectorAll('#edit-rows .edit-row')[${i}].querySelector('.edit-name'); el.value = ${J(name)}; el.dispatchEvent(new Event('input', { bubbles: true })); ${commit ? "el.dispatchEvent(new Event('change', { bubbles: true }));" : ''} })();`;
    await edit('wlegs', rename(0, 'cable  THING'));
    check('rename row into an existing identity seeds its remembered weight (33) in draft and field', await E(`editDraft[0].weight === 33 && document.querySelectorAll('#edit-rows .edit-row')[0].querySelectorAll('.edit-num')[2].value === '33'`));
    check('renamed first row shows the note', await E(`document.querySelectorAll('#edit-rows .edit-row')[0].querySelector('.edit-shared-note').hidden === false`));
    await E(`(() => { document.getElementById('btn-add-exercise').click(); return true; })()`);
    await E(rename(2, 'Cable Thing'));
    check('later duplicate of the same identity in the draft shows no note, first still does', await E(`(() => { const n = Array.from(document.querySelectorAll('#edit-rows .edit-row')).map((r) => r.querySelector('.edit-shared-note').hidden); return n[0] === false && n[2] === true; })()`));
    await E(`cancelEditPlan()`);
    console.log('== Seeding happens on name commit only, never over a typed value');
    await E(`(() => { rememberExerciseDefaults(exerciseIdentity({ name: 'Squat' }), { weight: 100, unilateral: true, startSide: 'right' }, 6); return true; })()`);
    const memKeys0 = await E(`Object.keys(state.settings.exerciseMemory).sort().join(',')`);
    await edit('wlegs', `document.getElementById('btn-add-exercise').click()`);
    await E(rename(2, 'Squat', false));
    await E(rename(2, 'Squat J', false));
    await E(rename(2, 'Squat Jump'));
    check('typing Squat then " Jump" (commit at the end) keeps defaults, no leak', await E(`(() => { const d = editDraft[2]; return d.weight === 0 && d.unilateral === undefined && d.startSide === undefined; })()`), await E(`J = JSON.stringify; JSON.stringify(editDraft[2])`));
    await E(rename(2, 'Squat Jump'));
    await E(`(() => { const el = document.querySelectorAll('#edit-rows .edit-row')[2].querySelectorAll('.edit-num'); el[0].value = '3'; el[1].value = '8'; el[0].dispatchEvent(new Event('input', { bubbles: true })); el[1].dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await save();
    check('save of Squat Jump writes no exerciseMemory entry for it', await E(`Object.keys(state.settings.exerciseMemory).sort().join(',')`) === memKeys0, await E(`Object.keys(state.settings.exerciseMemory).join(',')`));
    await E(`(() => { ${wi('wlegs')}.exercises.pop(); saveState(); return true; })()`);
    await edit('wlegs', `document.getElementById('btn-add-exercise').click()`);
    await E(rename(2, 'Squat', false));
    await E(rename(2, 'Squat'));
    check('commit "Squat" with no prior edits seeds 100 + unilateral right', await E(`(() => { const d = editDraft[2]; return d.weight === 100 && d.unilateral === true && d.startSide === 'right'; })()`));
    await E(`cancelEditPlan()`);
    await edit('wlegs', `document.getElementById('btn-add-exercise').click()`);
    await E(`(() => { const el = document.querySelectorAll('#edit-rows .edit-row')[2].querySelectorAll('.edit-num')[2]; el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await E(rename(2, 'cable thing'));
    check('weight typed first (60) survives a name commit whose memory is 33', await E(`editDraft[2].weight === 60 && document.querySelectorAll('#edit-rows .edit-row')[2].querySelectorAll('.edit-num')[2].value === '60'`));
    await save();
    check('the typed 60 goes to memory; the other plan keeps its own 33', await rowW('wpush', 2) === 33 && await E(`state.settings.exerciseMemory[exerciseIdentity({ name: 'Cable Thing' })].weight`) === 60);
    await E(`(() => { ${wi('wlegs')}.exercises.pop(); saveState(); return true; })()`);
    await E(`cancelEditPlan()`);
    await edit('wpush', `(() => { rows()[1].querySelector('.side-chip[data-side="right"]'); })();`);
    await E(`(() => { cancelEditPlan(); ${wi('wpush')}.exercises[1].unilateral = true; ${wi('wpush')}.exercises[1].startSide = 'left'; ${wi('wfull')}.exercises[1].unilateral = true; ${wi('wfull')}.exercises[1].startSide = 'left'; saveState(); return true; })()`);
    await edit('wpush', `rows()[1].querySelector('.side-chip[data-side="right"]').click()`);
    await save();
    check('start-side-only change propagates', await E(`${wi('wfull')}.exercises[1].startSide === 'right' && ${wi('wfull')}.exercises[1].unilateral === true`));
    await E(`(() => { ${wi('wpush')}.exercises[0].assisted = true; saveState(); return true; })()`);
    await edit('wpush', typeNum(1, 0, 4));
    await save();
    check('assisted survives saveEditPlan', await E(`${wi('wpush')}.exercises[0].assisted === true`));
    await E(`(() => { delete ${wi('wpush')}.exercises[0].assisted; saveState(); return true; })()`);
    console.log('== Edit plan B while a session runs on plan A');
    await start('wpush');
    const runBefore = await E(`[0, 1, 2].map((i) => effectiveSetWeight(exerciseSlots(currentPlan())[0].ex, i))`);
    await edit('wfull', typeNum(0, 2, 90));
    await save();
    const runAfter = await E(`[0, 1, 2].map((i) => effectiveSetWeight(exerciseSlots(currentPlan())[0].ex, i))`);
    check('running session on Push keeps its weights', J(runBefore) === J(runAfter), { runBefore, runAfter });
    check('Full Body row updated to 90, Push keeps its own weight', await rowW('wfull', 0) === 90 && await rowW('wpush', 0) !== 90);
    await E(`(() => { clearSession(); saveState(); return true; })()`);

    console.log('== Shared note');
    await edit('wpush', `0`);
    const note = (i) => E(`(() => { const n = document.querySelectorAll('#edit-rows .edit-row')[${i}].querySelector('.edit-shared-note'); return !!n && !n.hidden && n.getBoundingClientRect().height > 0 && n.textContent; })()`);
    check('note visible for bench (in 2 plans) in English', (await note(0)) === 'This weight is only for this plan. One-side and assisted settings apply to all your plans.', await note(0));
    await E(`(() => { state.plans['wpush'].exercises.push({ name: 'Solo Move', sets: 2, reps: 5, weight: 5 }); backfillState(); cancelEditPlan(); startEditPlan('wpush'); return true; })()`);
    check('note hidden for an exercise in only one plan', (await note(2)) === false, await note(2));
    await E(`(() => { cancelEditPlan(); return true; })()`);
    await E(`(() => { const mem = state.settings.exerciseMemory; let all = true; for (const l of ['sk','en','es','pt-BR','fr','ar']) { setLang(l); if (t('shared.note') === 'shared.note' || !t('shared.note')) all = false; } setLang('en'); return all; })()`).then((ok) => check('shared.note exists in 6 languages', ok === true));

    console.log('== Plan edited during a running workout: the newer explicit edit wins at Finish');
    const reset = (mem) => E(`(() => { clearSession(); ${wi('wpush')}.exercises[0].weight = 60; ${wi('wfull')}.exercises[0].weight = 60;
      state.settings.exerciseMemory = ${mem}; saveState(); return true; })()`);
    const doSets = (w) => E(`(() => { const [a] = ${wi('wpush')}.exercises; for (let i = 0; i < 3; i++) { setSetWeight(a, i, ${w}); toggleSetMark('done', a, i, true); } saveState(); return true; })()`);
    await reset('{}');
    await start('wpush');
    await doSets(62.5);
    await edit('wpush', typeNum(0, 2, 70));
    await save();
    check('session records the edited identity', await E(`getSession().editedIdentities && getSession().editedIdentities.includes('bench-press')`));
    check('running session still shows its start weights (62.5 done sets, 60 snapshot)', await E(`getSession().snapshot['bench-press#0'].weight === 60`));
    await finish();
    check('Finish keeps the edited 70 in Push and memory (62.5 not written); Full Body keeps 60', await rowW('wpush', 0) === 70 && await rowW('wfull', 0) === 60 && await E(`state.settings.exerciseMemory['bench-press'].weight`) === 70);
    check('normalizer keeps editedIdentities, drops junk', await E(`(() => { const s = { id: 'x', startedAt: 5, planId: 'wpush', completedSets: {}, actualFailureSets: {}, editedIdentities: ['a', 'a', 5, '', 'b'] }; return JSON.stringify(normalizeActiveSession(s).editedIdentities) === JSON.stringify(['a', 'b']); })()`));
    const noteTxt = await E(`(() => { const out = []; for (const l of ['sk','en','es','pt-BR','fr','ar']) { setLang(l); out.push(t('trening.planSaved')); } setLang('en'); return out; })()`);
    check('planSaved note differs and is set in 6 languages', new Set(noteTxt).size === 6 && noteTxt.every((x) => x && x !== 'trening.planSaved'), noteTxt);

    console.log('== Undo this workout restores the remembered weights');
    const undo = () => E(`(() => { requestUndoWorkout(); document.getElementById('btn-generic-ok').click(); return true; })()`);
    const histN = () => E(`state.history.length`);
    await reset('{}');
    await start('wpush');
    await doSets(600);
    const h0 = await histN();
    await finish();
    check('mistyped 600 was remembered', await rowW('wpush', 0) === 600 && await E(`state.settings.exerciseMemory['bench-press'].weight`) === 600);
    const he = await E(`state.history[state.history.length - 1]`);
    check('history entry holds memoryBefore null, memoryAfter 600 and the old row weight', he.memoryBefore && he.memoryBefore['bench-press'] === null && he.memoryAfter['bench-press'].weight === 600 && he.memoryRowBefore['bench-press'].wpush === 60 && he.memoryRowBefore['bench-press'].wfull === 60, he);
    await undo();
    check('Undo: plans back to 60, no memory entry, history entry gone', await rowW('wpush', 0) === 60 && await rowW('wfull', 0) === 60
      && await E(`state.settings.exerciseMemory['bench-press'] === undefined`) && await histN() === h0);
    await reset('{ "bench-press": { weight: 60, at: 7 } }');
    await start('wpush');
    await doSets(600);
    await finish();
    await undo();
    check('Undo with an earlier memory entry restores it (60, at 7)', await rowW('wfull', 0) === 60 && await E(`JSON.stringify(state.settings.exerciseMemory['bench-press'])`) === J({ weight: 60, at: 7 }));
    await reset('{}');
    await start('wpush');
    await doSets(600);
    await finish();
    await edit('wpush', typeNum(0, 2, 65));
    await save();
    await undo();
    check('Finish, then edit to 65, then Undo: 65 stays in Push and memory; Full Body keeps 60', await rowW('wpush', 0) === 65 && await rowW('wfull', 0) === 60 && await E(`state.settings.exerciseMemory['bench-press'].weight`) === 65 && await histN() === h0);
    check('history normalizer validates memory fields', await E(`(() => { const f = { memoryBefore: { a: null, b: { weight: 5, at: 3 }, c: { weight: 'x' }, d: 4 }, memoryAfter: { a: null, e: { weight: 1000 }, f: { weight: 2 } }, memoryRowBefore: { g: { p: 5, q: 'z' }, h: 5, i: { p: -1 } } };
      return JSON.stringify([cleanMemoryTrail(f.memoryBefore, 'memoryBefore'), cleanMemoryTrail(f.memoryAfter, 'memoryAfter'), cleanMemoryTrail(f.memoryRowBefore, 'memoryRowBefore')]) === JSON.stringify([{ a: null, b: { weight: 5, at: 3 } }, { f: { weight: 2 } }, { g: { p: 5 } }]); })()`));

    console.log('== exerciseMemory read paths ignore out-of-range weights');
    await E(`(() => { clearSession(); state.settings.exerciseMemory = { 'bench-press': { weight: 5000, at: 1 } }; ${wi('wfull')}.exercises[0].weight = 55; saveState(); return true; })()`);
    check('exerciseSharedSource ignores 5000 (falls back to another plan row)', await E(`(() => { const s = exerciseSharedSource('bench-press', 'wlegs'); return s && s.weight !== 5000; })()`));
    check('quickExerciseCopy ignores 5000', await E(`quickExerciseCopy('bench-press').weight !== 5000`));
    await E(`(() => { state.settings.exerciseMemory = { 'bench-press': { weight: null, at: 1 } }; return true; })()`);
    check('null / non-finite weight ignored too', await E(`exerciseMemoryEntry('bench-press') === null && quickExerciseCopy('bench-press').weight !== 0 * 1 - 1`));
    await E(`(() => { state.settings.exerciseMemory = {}; saveState(); return true; })()`);

    console.log('== Reload keeps everything');
    const before = await E(`JSON.stringify([state.plans['wfull'].exercises, state.settings.exerciseMemory])`);
    await p.navigate(BASE);
    await wait(500);
    check('plans + exerciseMemory survive reload', (await E(`JSON.stringify([state.plans['wfull'].exercises, state.settings.exerciseMemory])`)) === before);
    check('no exceptions', p.errors.length === 0, p.errors);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
