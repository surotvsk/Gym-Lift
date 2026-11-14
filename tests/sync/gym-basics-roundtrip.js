/* Gym-Lift — gym-basics fázy 1–4: spätná kompatibilita nových polí so staršími verziami cez účet.
   LOCAL stack only, disposable test account (GQ_CREDS_DIR cred-a, GQ_TEST_IDS).

     node tests/sync/gym-basics-roundtrip.js

   Staré buildy (default: GQ_OLD_REFS='f9590a9,821a538' = v106 a Android Play build v95; GQ_OLD_REFS="a,b" prepíše).
   Tok pre každý starý build:
   1. NOVÉ zariadenie zapíše: plán s dvojicou v supersete (group) + warmupRamp, dokončený tréning s warmups, setRpe,
      jednostranným cvikom (sideRpe) a group, a settings.plates (bar 15) + settings.effort 'rir'; nahrá do účtu;
   2. STARÝ build sa prihlási do rovnakého účtu, načíta ho, premenuje INÝ plán, pridá obyčajný tréning a nahrá;
   3. NOVÉ zariadenie sa znovu zosynchronizuje (aj po reštarte, aj čerstvé zariadenie): žiadny konflikt, záznamy histórie
      s novými poľami bajt po bajte rovnaké, settings.plates/effort, group/warmupRamp plánu nedotknuté, celkové XP rovnaké,
      zmena zo starého zariadenia je prítomná.
   4. (Review Focus 2) STARÝ build navyše UPRAVÍ cez vlastné uloženie: plán gb1 (zmení opakovania riadku v editore plánu) a záznam
      histórie s warmups/setRpe/sideRpe (zmení počet sérií v úprave histórie). Po zosynchronizovaní nové zariadenie: žiadny konflikt,
      rovnaké celkové XP ako čerstvé zariadenie z rovnakých dát, plán gb1 platný (group/warmupRamp smú zmiznúť; riadky, série,
      opakovania a váhy ostanú), upravený záznam sa vykreslí bez chýb (cleanHistorySetRpe znesie zlú dĺžku setRpe).
   5. (Fáza 3) NOVÉ zariadenie má navyše 50 importovaných tréningov (state.importedHistory, z CSV cez csvToWorkouts). Starý build ich
      drží v pamäti, nechá ich nedotknuté pri úprave plánu/histórie aj pri nahraní; po zosynchronizovaní sú na cloude aj na novom
      zariadení rovnaké (nové zariadenie: bajt po bajte, cloud: kanonicky, jsonb preusporiada kľúče) a XP sa importmi nezmení
      (kontrola v starom builde odstráni aj importedHistory).
   6. (Fáza 4) NOVÉ zariadenie spustí reálny Beginner full body. state.program a progRow jeho plánov ostanú kanonicky
      rovnaké po načítaní, úprave nesúvisiacich plánov a synchronizácii starého buildu, aj po reštarte a na čerstvom zariadení.
      showSuggestions = false ostáva len na novom zariadení; cloud ho nikdy neobsahuje. XP kontrola odstráni aj program/progRow.
   Každé zariadenie má vlastný server/port (vlastný origin = vlastné úložisko = "iné zariadenie"). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, Observer, loadCreds, readPublicConfig, waitFor } = require('./lib');
const HELPERS = require('./helpers');

const REPO = path.resolve(__dirname, '..', '..');
const NEW_PORT = 8124, OLD_PORT = 8143;
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-basics-roundtrip');
const PROFILES = path.join(WORK, 'profiles');
const J = JSON.stringify;
/* Kanonický JSON (zoradené kľúče): porovnáva obsah, nie poradie kľúčov. */
const canon = (v) => J(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x));
let nextPort = 9680;
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + String(typeof info === 'string' ? info : J(info)).slice(0, 3000) : '')); }
  return ok;
}
/* Porovnáva aj väzbu značiek na riadky a plány, nielen množinu progRow. */
function checkProgram(name, value, baseline) {
  const ids = Object.values(baseline.program.plans);
  const rows = (data) => ids.map((id) => {
    const plan = data && data.plans && data.plans[id];
    return (Array.isArray(plan) ? plan : (plan && plan.exercises) || []).map((e) => [e.id, e.progRow]);
  });
  check(name, canon(value && value.program) === canon(baseline.program) && canon(rows(value)) === canon(rows(baseline)));
}
function checkSuggestionsPrivate(name, payload) {
  check(name, !!payload && !!payload.settings && !Object.prototype.hasOwnProperty.call(payload.settings, 'showSuggestions') && !Object.prototype.hasOwnProperty.call(payload, 'showSuggestions'));
}
const browsers = [];
async function launch(name) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  return { b, p };
}
async function R(p) { await p.ready(); await p.eval(HELPERS); }


/* Nové polia, ktoré musia prežiť cestu cez starý build (kanonicky, bez poradia kľúčov). */
const CORE = `(() => {
  const plans = {}; for (const id of Object.keys(state.plans)) { const pl = state.plans[id]; plans[id] = (pl.exercises || []).map((e) => ({ id: e.id || null, name: e.name, weight: e.weight, sets: e.sets, reps: e.reps, group: e.group === undefined ? null : e.group, warmupRamp: e.warmupRamp === true, unilateral: e.unilateral === true, progRow: e.progRow === undefined ? null : e.progRow })); }
  const hist = state.history.filter((h) => h.id !== 'old-w1').map((h) => JSON.parse(JSON.stringify(h)));
  return JSON.stringify({ plans, hist, program: state.program || null, imp: JSON.stringify(state.importedHistory || []), plates: state.settings.plates === undefined ? null : state.settings.plates, effort: state.settings.effort === undefined ? null : state.settings.effort }); })()`;

const SEED_NEW = `(async () => {
  const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click();
  setLang('sk');
  state.plans['gb1'] = { id: 'gb1', builtin: false, customName: 'GB Superset', location: null,
    exercises: [{ id: 'bench-press', name: 'Bench Press', builtin: true, sets: 3, reps: 5, weight: 60, group: 'g1', warmupRamp: true },
      { name: 'Rad s činkou', sets: 3, reps: 8, weight: 40, group: 'g1' },
      { name: 'Jednoručný veslo', sets: 2, reps: 12, weight: 14, unilateral: true, startSide: 'left' }] };
  state.plans['gb2'] = { id: 'gb2', builtin: false, customName: 'GB Other', location: null, exercises: [{ name: 'Iný cvik', sets: 3, reps: 10, weight: 10 }] };
  for (const id of ['gb1', 'gb2']) if (!state.planOrder.includes(id)) state.planOrder.push(id);
  state.settings.plates = { bar: 15, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
  setEffortMode('rir');
  backfillState(); saveState();
  /* Fáza 3: 50 importovaných tréningov (Hevy CSV -> csvToWorkouts), pred ukončením tréningu, aby ich xp0 už obsahovalo. */
  const xpBefore = totalXP();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const lines = ['title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe'];
  for (let i = 0; i < 50; i++) {
    const d = new Date(2024, 0, 1 + i * 3), ds = String(d.getDate()).padStart(2, '0') + ' ' + mon[d.getMonth()] + ' ' + d.getFullYear();
    for (const [ex, w] of [['Bench Press (Barbell)', 60 + i % 7], ['Squat (Barbell)', 80 + i % 5]])
      for (let s2 = 0; s2 < 3; s2++) lines.push('"Import ' + i + '","' + ds + ', 18:00","' + ds + ', 19:00","","' + ex + '",,"",' + s2 + ',normal,' + w + ',' + (8 + s2) + ',,0,');
  }
  const pc = parseCsv(lines.join('\\n') + '\\n'), conv = csvToWorkouts(pc.rows, 'hevy', { delimiter: pc.delimiter });
  state.importedHistory = cleanImportedHistory(conv.workouts);
  window.__impN = state.importedHistory.length; window.__impXpSame = totalXP() === xpBefore;
  saveState();
  selectedPlan = 'gb1'; ensureSession(getPlan('gb1')); saveState(); switchTab('trening'); renderTrening();
  const [a, b, c] = state.plans.gb1.exercises;
  setSetWeight(a, 0, 60); setSetWeight(a, 1, 60); setSetWeight(a, 2, 62.5);
  for (const ex of [a, b]) for (let i = 0; i < 3; i++) toggleSetMark('done', ex, i, true);
  for (const side of ['left', 'right']) for (let i = 0; i < 2; i++) toggleSetMark('done', c, i, true, side);
  addWarmup(a); addWarmup(a); updateWarmup(a, 0, { done: true }); updateWarmup(a, 1, { done: true, w: 40, r: 3 });
  setSetRpe(a, 0, undefined, 8); setSetRpe(a, 2, undefined, 9.5); setSetRpe(b, 1, undefined, 7);
  setSetRpe(c, 0, 'left', 8.5); setSetRpe(c, 1, 'right', 9);
  saveState();
  document.getElementById('modal-confirm').hidden = false; confirmFinish();
  /* Skutočný štart vytvorí plány aj značky; predchádzajúce fixture tréningy nemení. */
  const xpBeforeProgram = totalXP(), historyBeforeProgram = JSON.stringify(state.history);
  if (!startProgram('beginner-full-body', null, null)) throw new Error('Program fixture failed to start');
  window.__programXpSame = totalXP() === xpBeforeProgram && JSON.stringify(state.history) === historyBeforeProgram;
  state.settings.showSuggestions = false;
  saveState();
  return true; })()`;

async function roundtrip({ ref, newSrv, oldSrv, A, obsA }) {
  const label = ref;
  /* --- 1. nové zariadenie zapíše a nahrá --- */
  const n = await launch('gb-new-' + label);
  await n.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(n.p);
  try { await n.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(n.p);
  await n.p.eval(SEED_NEW);
  await n.p.eval('__gq.syncNow()');
  const core0 = JSON.parse(await n.p.eval(CORE));
  const xp0 = await n.p.eval('totalXP()');
  const c0 = await obsA.row();
  const h0 = core0.hist[0] || {};
  const e0 = h0.exercises || [];
  check('[' + label + '] new device seeded: history entry has warmups, setRpe, sideRpe and group', core0.hist.length === 1 && Array.isArray(e0[0].warmups) && e0[0].warmups.length === 2 && J(e0[0].setRpe) === J([8, null, 9.5]) && e0[2] && e0[2].sideRpe && e0[2].sideRpe.left[0] === 8.5 && e0[2].sideRpe.right[1] === 9 && !!e0[0].group && e0[0].group === e0[1].group, h0);
  check('[' + label + '] new device seeded: plan keeps group + warmupRamp, settings.plates.bar 15, effort rir', core0.plans.gb1[0].group === 'g1' && core0.plans.gb1[1].group === 'g1' && core0.plans.gb1[0].warmupRamp === true && core0.plates && core0.plates.bar === 15 && core0.effort === 'rir', core0);
  const p0 = c0 && c0.payload;
  check('[' + label + '] uploaded: payload carries the new fields', !!p0 && p0.plans.gb1.exercises[0].group === 'g1' && p0.plans.gb1.exercises[0].warmupRamp === true && canon(p0.history[0]) === canon(core0.hist[0]) && p0.settings.plates.bar === 15 && p0.settings.effort === 'rir', p0 && p0.settings);
  /* Fáza 2: endedAt (záznam) a doneSets (cviky) zapísané novým ukončením musia prežiť staré buildy nezmenené. */
  const END0 = h0.endedAt, DS0 = e0.map((x) => (x.doneSets === undefined ? null : x.doneSets));
  check('[' + label + '] new device seeded: entry has a numeric endedAt and exact doneSets on the exercises', Number.isFinite(END0) && END0 > 0 && J(DS0[0]) === J([1, 2, 3]) && J(DS0[1]) === J([1, 2, 3]), { END0, DS0 });
  const IMP0 = core0.imp, impN = await n.p.eval('window.__impN');
  check('[' + label + '] new device seeded: 50 valid imported workouts in importedHistory, adding them left totalXP unchanged', impN === 50 && JSON.parse(IMP0).length === 50 && (await n.p.eval('window.__impXpSame')) === true && JSON.parse(IMP0).every((w) => w.source === 'hevy' && w.importKey), { impN });
  check('[' + label + '] uploaded: payload carries importedHistory (50, canonical equal)', !!p0 && Array.isArray(p0.importedHistory) && p0.importedHistory.length === 50 && canon(p0.importedHistory) === canon(JSON.parse(IMP0)), p0 && p0.importedHistory && p0.importedHistory.length);
  const programPlans = core0.program && Object.values(core0.program.plans);
  check('[' + label + '] real program start creates two tagged day plans without changing XP or history', !!programPlans && core0.program.id === 'beginner-full-body' && programPlans.length === 2 && programPlans.every((id) => core0.plans[id].length === 5 && core0.plans[id].every((e) => typeof e.progRow === 'string' && e.progRow.startsWith('beginner-full-body:'))) && (await n.p.eval('window.__programXpSame')) === true);
  if (!programPlans || programPlans.length !== 2) throw new Error('Missing program fixture');
  checkProgram('[' + label + '] uploaded: program and tagged rows equal the new device', p0, core0);
  check('[' + label + '] suggestions explicitly disabled on the source device', (await n.p.eval('state.settings.showSuggestions')) === false);
  checkSuggestionsPrivate('[' + label + '] new upload excludes showSuggestions', p0);
  const s0 = await n.p.eval('__gq.snap()');
  check('[' + label + '] new device is synced with nothing pending', s0.status === 'sync.st.synced' && s0.dirty === false, s0.status);

  /* --- 2. starý build načíta účet, zmení INÝ plán, pridá obyčajný tréning, nahrá --- */
  oldSrv.setRoot('old');
  const o = await launch('gb-old-' + label);
  await o.p.navigate('http://localhost:' + OLD_PORT + '/');
  await o.p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 120000);
  await o.p.reload(); await R(o.p);
  const oldVer = await o.p.eval(`(() => { const s = document.querySelector('script[src*="script.js?v="]'); return s ? s.getAttribute('src') : null; })()`);
  try { await o.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(o.p);
  await waitFor(async () => (await o.p.eval('__gq.snap()')).plans.includes('gb1'), 90000, 'old device loaded the account');
  const oldSnap = await o.p.eval('__gq.snap()');
  check('[' + label + '] old build (' + oldVer + ') loaded the account: both plans + the workout present', oldSnap.plans.includes('gb1') && oldSnap.plans.includes('gb2') && oldSnap.hist.length === 1, { plans: oldSnap.plans, hist: oldSnap.hist });
  const oldSees = await o.p.eval(`(() => ({ h: JSON.parse(JSON.stringify(state.history[0])), plates: state.settings.plates || null, effort: state.settings.effort || null, g: state.plans.gb1.exercises.map((e) => [e.group || null, e.warmupRamp === true]) }))()`);
  check('[' + label + '] old build keeps the new fields in memory', canon(oldSees.h) === canon(core0.hist[0]) && canon(oldSees.plates) === canon(core0.plates) && oldSees.effort === 'rir' && J(oldSees.g) === J([['g1', true], ['g1', false], [null, false]]), oldSees);
  const oldImp = await o.p.eval(`JSON.stringify(state.importedHistory || null)`);
  check('[' + label + '] old build keeps importedHistory (50) untouched in memory (unknown top-level field survives load)', oldImp !== 'null' && JSON.parse(oldImp).length === 50 && canon(JSON.parse(oldImp)) === canon(JSON.parse(IMP0)), oldImp && oldImp.slice(0, 200));
  checkProgram('[' + label + '] old build loads canonical program and every progRow unchanged', JSON.parse(await o.p.eval(CORE)), core0);
  const oldXp = await o.p.eval(`typeof totalXP === 'function' ? totalXP() : null`);
  /* Kontrola v starom builde: bez nových polí (len v pamäti, bez uloženia; stav sa hneď vráti) je totalXP rovnaké. */
  const ctl = await o.p.eval(`(() => {
    const hSave = JSON.stringify(state.history), pSave = JSON.stringify(state.plans), iSave = state.importedHistory, programSave = state.program;
    const before = totalXP();
    delete state.importedHistory;
    delete state.program;
    for (const h of state.history) for (const e of (h.exercises || [])) { delete e.warmups; delete e.setRpe; delete e.sideRpe; delete e.group; }
    for (const id of Object.keys(state.plans)) for (const e of (state.plans[id].exercises || [])) { delete e.group; delete e.warmupRamp; delete e.progRow; }
    const after = totalXP();
    state.history = JSON.parse(hSave); state.plans = JSON.parse(pSave); if (iSave !== undefined) state.importedHistory = iSave;
    if (programSave !== undefined) state.program = programSave;
    return { before, after, restored: JSON.stringify(state.history) === hSave && JSON.stringify(state.plans) === pSave && state.program === programSave && state.importedHistory === iSave }; })()`);
  check('[' + label + '] control inside the old build: totalXP is equal with and without the new fields (they never move XP)', ctl.before === ctl.after && ctl.restored && typeof ctl.before === 'number', ctl);
  if (/\/v106$/.test(label)) check('[' + label + '] v106: old build totalXP right after loading equals the new device (xp0)', oldXp === xp0, { oldXp, xp0 });
  await o.p.eval(`(() => { state.plans.gb2.customName = 'GB Other (z mobilu)'; saveState(); return true; })()`);
  /* (a) staré uloženie plánu: zmena opakovaní prvého riadku plánu gb1 cez jeho vlastný editor */
  const planEdit = await o.p.eval(`(() => { startEditPlan('gb1'); editDraft[0].reps = 6; saveEditPlan(); const r = getPlan('gb1').exercises;
    return { reps: r.map((e) => e.reps), groups: r.map((e) => e.group || null), ramp: r.map((e) => e.warmupRamp === true), editing: editingPlan }; })()`);
  check('[' + label + '] old build edited plan gb1 through its own plan editor (reps 5 -> 6, saved)', planEdit.reps[0] === 6 && planEdit.reps[1] === 8 && planEdit.editing === null, planEdit);
  console.log('  INFO [' + label + '] after its own plan save the old build holds groups ' + J(planEdit.groups) + ', warmupRamp ' + J(planEdit.ramp));
  /* (b) staré uloženie histórie: počet sérií prvého cviku záznamu s warmups/setRpe 3 -> 4 */
  const histEdit = await o.p.eval(`(() => { const id = state.history[0].id; openHistoryEdit(id);
    const inp = document.querySelector('#he-exercises .he-ex-row input[data-f="sets"]'); inp.value = '4'; inp.dispatchEvent(new Event('input'));
    saveHistoryEdit();
    const e = state.history.find((w) => w.id === id).exercises; return { id, sets: e.map((x) => x.sets), keys: Object.keys(e[0]).sort().join(',') }; })()`);
  check('[' + label + '] old build edited the history entry through its own history editor (sets 3 -> 4, saved)', histEdit.sets[0] === 4, histEdit);
  console.log('  INFO [' + label + '] after its own history save the entry 0 keys are: ' + histEdit.keys);
  await o.p.eval(`__gq.addWorkout('old-w1', '2026-10-25')`);
  await o.p.eval('__gq.syncNow()');
  const so = await o.p.eval('__gq.snap()');
  const oldXp1 = await o.p.eval(`totalXP()`);
  const c1 = await obsA.row();
  check('[' + label + '] old build uploaded exactly one new revision, synced, no conflict', c1.revision === c0.revision + 1 && so.status === 'sync.st.synced' && !(so.meta && so.meta.conflict), { rev: [c0.revision, c1.revision], st: so.status });
  checkProgram('[' + label + '] old build preserves program and progRow after unrelated edits and sync', JSON.parse(await o.p.eval(CORE)), core0);
  checkProgram('[' + label + '] old upload preserves canonical program and progRow', c1.payload, core0);
  checkSuggestionsPrivate('[' + label + '] old upload excludes showSuggestions', c1.payload);
  const hx = c1.payload.history.find((h) => h.id === core0.hist[0].id);
  check('[' + label + '] cloud payload: the edited history entry is present with 4 sets for exercise 0 and the same exercises (names, count)', !!hx && hx.exercises[0].sets === 4 && J(hx.exercises.map((e) => e.name)) === J(core0.hist[0].exercises.map((e) => e.name)), hx);
  const hx2 = hx || {};
  check('[' + label + '] cloud payload after the old build: endedAt unchanged, doneSets unchanged on every exercise (old build kept them)', hx2.endedAt === END0 && J((hx2.exercises || []).map((x) => (x.doneSets === undefined ? null : x.doneSets))) === J(DS0), { endedAt: hx2.endedAt, END0, ds: (hx2.exercises || []).map((x) => x.doneSets) });
  check('[' + label + '] cloud payload after the old build: importedHistory byte-identical in content (50, canonical equal to the new device value)', Array.isArray(c1.payload.importedHistory) && c1.payload.importedHistory.length === 50 && canon(c1.payload.importedHistory) === canon(JSON.parse(IMP0)), c1.payload.importedHistory && c1.payload.importedHistory.length);
  check('[' + label + '] cloud payload: settings.plates + settings.effort intact', canon(c1.payload.settings.plates) === canon(core0.plates) && c1.payload.settings.effort === 'rir', c1.payload.settings);
  const gx = c1.payload.plans.gb1.exercises;
  check('[' + label + '] cloud payload: edited plan gb1 is valid (rows, sets, weights intact; reps edited; group/warmupRamp may be gone); the other old changes are present', gx.length === 3 && J(gx.map((e) => [e.name, e.sets, e.weight])) === J([['Bench Press', 3, 60], ['Rad s činkou', 3, 40], ['Jednoručný veslo', 2, 14]]) && gx[0].reps === 6 && gx[1].reps === 8 && gx[2].reps === 12 && c1.payload.plans.gb2.customName === 'GB Other (z mobilu)' && c1.payload.history.some((h) => h.id === 'old-w1'), gx);
  check('[' + label + '] old build: no page errors', o.p.errors.length === 0, o.p.errors);
  o.b.killHard(true);

  /* --- 3. nové zariadenie sa znovu zosynchronizuje --- */
  await n.p.eval('__gq.syncNow()');
  const n1 = await n.p.eval('__gq.snap()');
  const core1 = JSON.parse(await n.p.eval(CORE));
  checkProgram('[' + label + '] new device pulls canonical program and progRow unchanged', core1, core0);
  check('[' + label + '] pulling keeps source suggestions disabled', (await n.p.eval('state.settings.showSuggestions')) === false);
  check('[' + label + '] new device pulled the old device change (plan name + the old workout), no conflict, synced', n1.hist.includes('old-w1') && (await n.p.eval(`state.plans.gb2.customName`)) === 'GB Other (z mobilu)' && n1.status === 'sync.st.synced' && !(n1.meta && n1.meta.conflict), { st: n1.status, hist: n1.hist });
  check('[' + label + '] new device: history equals the cloud (the edited entry came back unchanged by the pull)', canon(core1.hist.find((h) => h.id === core0.hist[0].id)) === canon(c1.payload.history.find((h) => h.id === core0.hist[0].id)), core1.hist);
  const hn = core1.hist.find((h) => h.id === core0.hist[0].id) || {};
  check('[' + label + '] new device after pulling: endedAt and doneSets unchanged', hn.endedAt === END0 && J((hn.exercises || []).map((x) => (x.doneSets === undefined ? null : x.doneSets))) === J(DS0), { endedAt: hn.endedAt, END0 });
  check('[' + label + '] new device: settings.plates and settings.effort intact', canon(core1.plates) === canon(core0.plates) && core1.effort === 'rir', { plates: core1.plates, effort: core1.effort });
  check('[' + label + '] new device: plan gb1 valid after the old edit (no conflict; reps 6, other rows unchanged)', core1.plans.gb1.length === 3 && core1.plans.gb1[0].reps === 6 && J(core1.plans.gb1.map((e) => [e.name, e.sets, e.weight])) === J([['Bench Press', 3, 60], ['Rad s činkou', 3, 40], ['Jednoručný veslo', 2, 14]]), core1.plans.gb1);
  /* upravený záznam sa na novom zariadení vykreslí (História + Kalendár) bez chýb stránky; setRpe zlej dĺžky nespadne */
  const errs0 = n.p.errors.length;
  const rendered = await n.p.eval(`(() => { const e = state.history.find((h) => h.id === ${J(core0.hist[0].id)});
    switchTab('pokrok'); setPokrokView('progress'); const a = document.body.innerText.length;
    switchTab('kalendar'); openDay(e.date); const d = document.getElementById('modal-day').innerText; closeDay();
    return { a, d: d.length, sets: e.exercises[0].sets, rpeLen: Array.isArray(e.exercises[0].setRpe) ? e.exercises[0].setRpe.length : null, cleaned: cleanHistorySetRpe(e.exercises[0]) }; })()`);
  check('[' + label + '] new device renders the edited history entry (History + Calendar) without page errors', rendered.sets === 4 && rendered.d > 0 && n.p.errors.length === errs0, rendered);
  const oldW = await n.p.eval(`historyEntryXp(state.history.find((h) => h.id === 'old-w1'))`);
  const xp1 = await n.p.eval('totalXP()');
  check('[' + label + '] new device: total XP is a finite number computed from the synced data (checked against a fresh device below)', Number.isFinite(xp1), { xp0, oldW, xp1 });
  n.p = await n.b.restart(true); await n.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(n.p);
  await n.p.eval('__gq.syncNow()');
  check('[' + label + '] new device after pulling: importedHistory content-identical to what it wrote (canonical equal, 50 entries), and equal to the cloud', canon(JSON.parse(core1.imp)) === canon(JSON.parse(IMP0)) && JSON.parse(core1.imp).length === 50 && canon(JSON.parse(core1.imp)) === canon(c1.payload.importedHistory), { len: JSON.parse(core1.imp).length, a: core1.imp.slice(0, 160), b: IMP0.slice(0, 160) });
  console.log('  INFO [' + label + '] importedHistory raw string identical after pull: ' + (core1.imp === IMP0) + ' (the server stores jsonb, which may reorder keys; content is canonical-equal)');
  check('[' + label + '] new device: imports never counted - history still has exactly the real entries (no imp- ids), XP finite', core1.hist.every((h) => !/^imp-/.test(h.id)) && JSON.parse(core1.imp).every((w) => /^imp-/.test(w.id)));
  check('[' + label + '] new device after restart: same data, synced, same XP', J(JSON.parse(await n.p.eval(CORE))) === J(core1) && (await n.p.eval('__gq.snap()')).status === 'sync.st.synced' && (await n.p.eval('totalXP()')) === xp1);
  checkProgram('[' + label + '] restarted new device retains canonical program and progRow', JSON.parse(await n.p.eval(CORE)), core0);
  check('[' + label + '] restarted source retains its private suggestion setting', (await n.p.eval('state.settings.showSuggestions')) === false);
  const f = await launch('gb-fresh-' + label);
  await f.p.navigate('http://localhost:' + NEW_PORT + '/'); await R(f.p);
  try { await f.p.eval(`__gq.signIn(${J(A.email)}, ${J(A.password)})`, 120000); } catch (e) {}
  await R(f.p);
  await waitFor(async () => (await f.p.eval('__gq.snap()')).hist.includes('old-w1'), 90000, 'fresh device loaded');
  const fresh = JSON.parse(await f.p.eval(CORE));
  checkProgram('[' + label + '] fresh device receives canonical program and progRow', fresh, core0);
  check('[' + label + '] fresh device keeps default suggestions on, not the source setting', (await f.p.eval('suggestionsOn()')) === true);
  check('[' + label + '] a fresh new device gets identical history, plans and settings, and the same total XP', J(fresh.hist) === J(core1.hist) && J(fresh.plans.gb1) === J(core1.plans.gb1) && canon(fresh.plates) === canon(core1.plates) && fresh.effort === 'rir' && fresh.imp === core1.imp && (await f.p.eval('totalXP()')) === xp1);
  /* Starý build (pred v101) počíta XP inak (uložené xp, nie odvodené) — len informácia, nie chyba nových polí. */
  if (/\/v106$/.test(label)) check('[' + label + '] v106: after its upload the old build totalXP equals the new device (xp1)', oldXp1 === xp1, { oldXp1, xp1 });
  /* v95: absolútna hodnota XP sa líši, lebo vzorec XP v v95 je staršie než v101 (odvodené XP); kontrola vyššie dokazuje, že nové polia XP nehýbu. */
  console.log('  INFO [' + label + '] total XP: new device ' + xp0 + ', old build ' + oldXp + (oldXp === xp0 ? ' (equal)' : ' (older XP formula, not caused by the new fields)'));
  check('[' + label + '] new devices: no page errors', n.p.errors.length === 0 && f.p.errors.length === 0, [n.p.errors, f.p.errors]);
  const cEnd = await obsA.row();
  check('[' + label + '] new device pulling uploaded nothing (cloud revision unchanged since the old upload)', cEnd.revision === c1.revision, [c1.revision, cEnd.revision]);
  checkSuggestionsPrivate('[' + label + '] final cloud payload excludes showSuggestions', cEnd.payload);
  checkProgram('[' + label + '] final cloud payload retains canonical program and progRow', cEnd.payload, core0);
}

(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  const cfg = readPublicConfig(REPO);
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(cfg.url)) { console.log('REFUSING: not the local stack'); process.exit(2); }
  const refs = (process.env.GQ_OLD_REFS || 'f9590a9,821a538').split(',').map((s) => s.trim()).filter(Boolean);
  const A = loadCreds('a');
  const obsA = await new Observer(cfg, A).login();
  const newSrv = await startServer(NEW_PORT, { new: REPO });
  for (const ref of refs) {
    const OLD = path.join(WORK, 'old-' + ref);
    fs.rmSync(OLD, { recursive: true, force: true }); fs.mkdirSync(OLD, { recursive: true });
    require('child_process').execSync('git archive ' + ref + ' | tar -x -C ' + J(OLD), { cwd: REPO, shell: '/bin/bash' });
    const ver = /CACHE_VERSION = '(v\d+)'/.exec(fs.readFileSync(path.join(OLD, 'sw.js'), 'utf8'))[1];
    const oldSrv = await startServer(OLD_PORT, { old: OLD });
    oldSrv.setRoot('old');
    console.log('\n== old build ' + ref + ' (' + ver + ') <-> gym-basics, account round trip');
    try { await obsA.reset(); await roundtrip({ ref: ref + '/' + ver, newSrv, oldSrv, A, obsA }); }
    catch (e) { fail++; console.log('  FAIL scenario error: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    while (browsers.length) { const b = browsers.pop(); try { b.killHard(true); } catch (e) {} }
    await oldSrv.close();
  }
  try { await obsA.reset(); } catch (e) {}
  await newSrv.close();
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
