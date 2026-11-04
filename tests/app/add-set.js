'use strict';
/* GymQuest — "+ Add set" a "Remove last set" počas tréningu (v97), v reálnom headless Chrome.
   Bez účtov a siete: appka beží s prázdnou Community konfiguráciou.

     GQ_TEST_PORT=8190 node tests/app/add-set.js

   Checks: + Add set → 4 riadky pri pláne s 3 sériami; nová séria dostane váhu a opakovania poslednej
   (aj keď mala vlastné výnimky), ostatné série sa nezmenia; plán zostane 3; po obnovení stránky 4 riadky;
   Finish uloží 4 série; Remove last set bez dialógu pri nedotknutej sérii, s potvrdením pri hotovej
   (Cancel ponechá, Confirm zmaže len jej značky a výnimky); nikdy pod 1 sériu; jednostranný cvik pridá
   sériu pre obe strany; drop série ostanú za poslednou sériou; stará session bez `setDelta` funguje; 6 jazykov. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-addset');
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
  const b = new Browser('addset-' + Date.now().toString(36), 9890, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const ex = (i) => `document.querySelectorAll('#exercise-list .exercise')[${i}]`;
  const rows = (i) => p.eval(`${ex(i)}.querySelectorAll('.set-item:not(.drop-item)').length`);
  const sq = (i) => p.eval(`Array.from(${ex(i)}.querySelectorAll('.set-item:not(.drop-item)')).map((it) => it.querySelector('input.set-reps').value + '/' + (it.querySelector('input.set-weight').value || 'BW'))`);
  const click = (i, sel, n) => p.eval(`(${ex(i)}.querySelectorAll(${J(sel)})[${n || 0}].click(), true)`);
  const dialogOpen = () => p.eval(`!document.getElementById('modal-generic').hidden`);
  const setup = async () => {
    await p.eval(`(() => {
      state.plans['atest'] = { id: 'atest', builtin: false, customName: 'Add set test', location: null,
        exercises: [{ id: 'cx-a1', name: 'Bench test', sets: 3, reps: 8, weight: 60 },
          { id: 'cx-a2', name: 'Curl test', sets: 2, reps: 10, weight: 10, unilateral: true },
          { id: 'cx-a3', name: 'Row test', sets: 1, reps: 10, weight: 40 }] };
      if (!state.planOrder.includes('atest')) state.planOrder.push('atest');
      selectedPlan = 'atest'; ensureSession(); saveState(); switchTab('trening'); renderTrening(); return true; })()`);
    await wait(300);
  };
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await setup();

    console.log('== add a set');
    check('plan has 3 rows, buttons present', (await rows(0)) === 3 && (await p.eval(`!!${ex(0)}.querySelector('.set-add') && !!${ex(0)}.querySelector('.set-remove')`)));
    check('Add set button text (en)', (await p.eval(`${ex(0)}.querySelector('.set-add').textContent`)) === '+ Add set');
    /* Séria 3 s vlastnými výnimkami: 70 kg, 6 opakovaní. */
    await p.eval(`(setSetWeight(selectedPlanEx(0), 2, 70), setSetReps(selectedPlanEx(0), 2, 6), true)`.replace(/selectedPlanEx\(0\)/g, `getPlan('atest').exercises[0]`));
    await p.eval(`(renderTrening(), true)`);
    const before = await sq(0);
    check('set 3 shows 6/70', before[2] === '6/70' && before[0] === '8/60' && before[1] === '8/60', before);
    await click(0, '.set-add');
    await wait(150);
    const after = await sq(0);
    check('4 rows after + Add set', (await rows(0)) === 4, after);
    check('new set copies set 3 effective values (6/70), others unchanged', after[3] === '6/70' && J(after.slice(0, 3)) === J(before), after);
    check('plan still has sets: 3', (await p.eval(`state.plans['atest'].exercises[0].sets`)) === 3);
    check('other exercises untouched', (await rows(2)) === 1);
    check('session stores setDelta +1 for bench', (await p.eval(`state.activeSession.setDelta['cx-a1']`)) === 1);
    check('summary counts the new set in the total (3+4+1 per... = 3+2*2+1+1)', (await p.eval(`planExerciseCount(getPlan('atest'))`)) === 9);

    console.log('== reload keeps it');
    await p.reload();
    await p.eval(`(switchTab('trening'), true)`); await wait(300);
    check('4 rows after reload', (await rows(0)) === 4);
    check('values after reload', J(await sq(0)) === J(after), await sq(0));

    console.log('== remove untouched extra set (no dialog)');
    await click(0, '.set-remove'); await wait(150);
    check('no dialog, back to 3 rows', !(await dialogOpen()) && (await rows(0)) === 3);
    check('setDelta removed again', (await p.eval(`state.activeSession.setDelta`)) === undefined);
    check('set 3 override untouched by removal', (await sq(0))[2] === '6/70');

    console.log('== remove completed set (confirm)');
    await click(0, '.set-add'); await wait(150);
    await click(0, '.set-btn.sq', 3);                      // 4. séria hotová
    await click(0, '.set-fail', 3);                        // + zlyhanie
    await p.eval(`(setSetWeight(getPlan('atest').exercises[0], 3, 75), renderTrening(), true)`);
    await click(0, '.set-btn.sq', 0);                      // 1. séria hotová (nesmie sa dotknúť)
    await click(0, '.set-remove'); await wait(150);
    check('confirm dialog opens, mentions set 4', (await dialogOpen()) && /Remove set 4\?/.test(await p.eval(`document.getElementById('generic-text').textContent`)), await p.eval(`document.getElementById('generic-text').textContent`));
    check('still 4 rows while dialog is open', (await rows(0)) === 4);
    await p.eval(`(document.getElementById('btn-generic-cancel').click(), true)`); await wait(100);
    check('Cancel keeps the set and its marks', (await rows(0)) === 4 && (await p.eval(`setMark('done', getPlan('atest').exercises[0], 3)`)) === true);
    await click(0, '.set-remove'); await wait(100);
    await p.eval(`(document.getElementById('btn-generic-ok').click(), true)`); await wait(150);
    check('Confirm removes it (3 rows)', (await rows(0)) === 3);
    const sk = await p.eval(`(() => { const s = state.activeSession; const k = 'cx-a1:3';
      return { done: !!s.completedSets[k], fail: !!s.actualFailureSets[k], w: s.setWeights && s.setWeights[k], r: s.setReps && s.setReps[k],
        set1: !!s.completedSets['cx-a1:0'], w3: s.setWeights && s.setWeights['cx-a1:2'], r3: s.setReps && s.setReps['cx-a1:2'] }; })()`);
    check('its done/failure marks and overrides are cleared', !sk.done && !sk.fail && sk.w === undefined && sk.r === undefined, sk);
    check('set 1 done mark and set 3 overrides remain', sk.set1 && sk.w3 === 70 && sk.r3 === 6, sk);

    console.log('== minimum one set');
    check('Row test (1 set): Remove disabled', await p.eval(`${ex(2)}.querySelector('.set-remove').disabled`));
    check('removeLastSessionSet refuses at 1', (await p.eval(`removeLastSessionSet(getPlan('atest').exercises[2])`)) === false && (await rows(2)) === 1);
    await p.eval(`(addSessionSet(getPlan('atest').exercises[2]), removeLastSessionSet(getPlan('atest').exercises[2]), removeLastSessionSet(getPlan('atest').exercises[2]), renderTrening(), true)`);
    check('still 1 set after extra removes', (await rows(2)) === 1 && (await p.eval(`sessionSetCount(getPlan('atest').exercises[2])`)) === 1);
    check('plan can shrink: 3-set bench can drop to 2 and 1 in session only', await p.eval(`(() => { const e = getPlan('atest').exercises[0]; state.activeSession.completedSets['cx-a1:0'] = false; delete state.activeSession.completedSets['cx-a1:0'];
      removeLastSessionSet(e); removeLastSessionSet(e); const n = sessionSetCount(e); const refused = removeLastSessionSet(e); const keep = state.plans['atest'].exercises[0].sets === 3;
      addSessionSet(e); addSessionSet(e); return n === 1 && refused === false && keep && sessionSetCount(e) === 3; })()`));
    await p.eval(`(renderTrening(), true)`);

    console.log('== unilateral exercise');
    check('Curl: 2 sets x 2 sides = 4 rows', (await rows(1)) === 4);
    await click(1, '.set-btn.sq', 3);                      // 2. séria, pravá strana hotová
    await click(1, '.set-add'); await wait(150);
    check('Curl: +1 set = 6 rows (a pair)', (await rows(1)) === 6);
    check('Curl: new rows are 3L and 3R', (await p.eval(`Array.from(${ex(1)}.querySelectorAll('.set-item')).slice(4).map((i) => i.querySelector('.set-label').textContent.replace(/\\s+/g, ' ')).join('|')`)).length > 0);
    check('Curl: planExerciseCount counts both sides', (await p.eval(`planExerciseCount(getPlan('atest'))`)) === 3 + 6 + 1);
    await click(1, '.set-remove'); await wait(150);
    check('Curl: untouched pair removed without dialog', !(await dialogOpen()) && (await rows(1)) === 4);
    await click(1, '.set-add'); await wait(100);
    await click(1, '.set-btn.sq', 5);                      // 3. série pravá hotová
    await click(1, '.set-remove'); await wait(100);
    check('Curl: completed side asks to confirm', await dialogOpen());
    await p.eval(`(document.getElementById('btn-generic-ok').click(), true)`); await wait(150);
    check('Curl: removed, 4 rows, left/right marks of set 3 cleared', (await rows(1)) === 4 && (await p.eval(`Object.keys(state.activeSession.completedSets).filter((k) => k.indexOf('cx-a2:2') === 0).length`)) === 0);
    check('Curl: set 2 right mark kept', (await p.eval(`state.activeSession.completedSets['cx-a2:1:R']`)) === true);

    console.log('== drop sets stay after the last set');
    await p.eval(`(setSetWeight(getPlan('atest').exercises[0], 2, 70), setSetReps(getPlan('atest').exercises[0], 2, 6), renderTrening(), true)`);
    await click(0, '.set-add'); await wait(100);
    await p.eval(`(addDrop(getPlan('atest').exercises[0]), renderTrening(), true)`);
    const drop = await p.eval(`(() => { const e = document.querySelectorAll('#exercise-list .exercise')[0]; const d = state.activeSession.drops['cx-a1'][0];
      const items = e.querySelectorAll('.set-item:not(.drop-item)'); const pos = (a, c) => !!(a.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { w: d.w, r: d.r, after: pos(items[items.length - 1], e.querySelector('.drop-item')) }; })()`);
    check('drop starts from the 4th (last) set (6 reps, 70*0.8 → 55)', drop.r === 6 && drop.w === 55 && drop.after, drop);

    console.log('== finish: history has 4 sets');
    await click(0, '.set-btn.sq', 3);
    await click(0, '.set-btn.sq', 0);
    await p.eval(`(finishWorkout(), confirmFinish(), true)`); await wait(300);
    const h = await p.eval(`(() => { const w = state.history[state.history.length - 1]; return w.exercises.map((e) => ({ n: e.name, sets: e.sets, done: e.setsDone, sw: e.setWeights, sr: e.setReps })); })()`);
    check('bench: sets 4, 2 done, per-set weights/reps have 4 entries', h[0].sets === 4 && h[0].done === 2 && J(h[0].sw) === J([60, 60, 70, 70]) && J(h[0].sr) === J([8, 8, 6, 6]), h[0]);
    check('curl: sets 2 (extra pair was removed), 1 side done', h[1].sets === 2 && h[1].done === 1, h[1]);
    check('plan still sets: 3 after finish', (await p.eval(`state.plans['atest'].exercises[0].sets`)) === 3);
    check('session cleared', (await p.eval(`getSession()`)) === null);

    console.log('== old session shape (v96, no setDelta)');
    await p.eval(`(state.plans['atest'].exercises[0].weight = 60, saveState(), true)`);   // v100: dokončený tréning vyššie už zapísal pracovnú váhu do plánu
    await p.eval(`(() => { state.activeSession = { id: 'old1', startedAt: Date.now() - 60000, planId: 'atest', planName: 'Add set test',
      completedSets: { 'cx-a1:0': true, 'cx-a1:1': true }, actualFailureSets: { 'cx-a1:1': true }, setWeights: { 'cx-a1:1': 65 } };
      selectedPlan = 'atest'; saveState(); return true; })()`);
    await p.reload();
    await p.eval(`(switchTab('trening'), true)`); await wait(300);
    check('old session: planned count (3), marks and override kept', (await rows(0)) === 3 && (await p.eval(`state.activeSession.completedSets['cx-a1:1']`)) === true && (await sq(0))[2] === '8/65', await sq(0));
    await click(0, '.set-add'); await wait(100);
    check('old session: + Add set works', (await rows(0)) === 4);
    await click(0, '.set-remove'); await wait(100);
    await p.eval(`(finishWorkout(), confirmFinish(), true)`); await wait(300);
    const o = await p.eval(`(() => { const e = state.history[state.history.length - 1].exercises[0]; return { sets: e.sets, done: e.setsDone, sw: e.setWeights, f: e.actualFailureSets }; })()`);
    check('old session finishes with 3 sets, 2 done, failure and weights kept', o.sets === 3 && o.done === 2 && J(o.sw) === J([60, 65, 65]) && J(o.f) === J([2]), o);

    console.log('== languages');
    await setup();
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), renderTrening(), true)`); await wait(150);
      const r = await p.eval(`(() => ({ add: document.querySelector('.set-add').textContent, rem: document.querySelector('.set-remove').textContent,
        conf: t('session.removeSetConfirm', { n: 3 }), dir: document.documentElement.dir, h: document.querySelector('.set-add').getBoundingClientRect().height,
        over: document.documentElement.scrollWidth > innerWidth + 1 }))()`);
      check(lang + ': labels, confirm text, 44 px target, no overflow', r.add && r.rem && !/^session\./.test(r.add + r.rem + r.conf) && r.conf.includes('3') && r.h >= 44 && !r.over, r);
      if (lang === 'ar') check('ar: rtl', r.dir === 'rtl');
    }
    await p.eval(`(setLang('en'), true)`);
    const shot = await p.c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(WORK, 'shots', 'add-set-en.png'), Buffer.from(shot.data, 'base64'));

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
