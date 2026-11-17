'use strict';
/* Optional workout phases: real guest UI, persistence, timer ownership and derived rewards.
   No accounts, production access or screenshots. Run only after client integration:
   GQ_SCREENSHOTS=0 GQ_TEST_PORT=8194 node tests/app/workout-phases.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');
const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8194;
const WORK = process.env.GQ_WORK || fs.mkdtempSync(path.join(os.tmpdir(), 'gq-workout-phases-'));
const J = JSON.stringify;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail === undefined ? '' : ' -> ' + J(detail))); }
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const config = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(config, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = config;
  const server = await startServer(PORT, { new: REPO });
  const browser = new Browser('phases-' + Date.now().toString(36), 9894, path.join(WORK, 'profiles'));
  let page;
  try {
    page = await browser.launch();
    await page.navigate('http://localhost:' + PORT + '/');
    const ev = expression => page.eval(expression);
    const click = selector => ev(`(() => { const e = document.querySelector(${J(selector)}); if (!e) throw new Error('Missing control: ' + ${J(selector)}); e.click(); return true; })()`);
    await ev(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); state.settings.autoRest = false; state.settings.restSound = false; return true; })()`);
    const fixture = async () => ev(`(() => {
      clearSession(); stopTimer(); state.history = []; state.activities = []; state.achievements = {}; xpCacheClear();
      state.settings.workoutPhases = cleanWorkoutPhasePreferences(null);
      state.plans.phaseTest = { id: 'phaseTest', builtin: false, customName: 'Phase regression', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 8, weight: 20 }] };
      if (!state.planOrder.includes('phaseTest')) state.planOrder.push('phaseTest');
      selectedPlan = 'phaseTest'; ensureSession(getPlan(selectedPlan)); saveState(); switchTab('trening'); renderTrening();
      document.getElementById('modal-result').hidden = true;
      return true;
    })()`);
    const mark = kind => ev(`(async () => { setWorkoutPhaseEnabled(${J(kind)}, true); await setWorkoutPhaseDone(${J(kind)}, true); return getSession().phases[${J(kind)}].done; })()`);
    const saveWorkout = async () => {
      const id = await ev('getSession().id');
      await ev(`(() => { document.querySelectorAll('#exercise-list .set-btn').forEach(b => { if (!b.classList.contains('done')) b.click(); }); return true; })()`);
      const replay = await ev('JSON.stringify(getSession())');
      const preview = await ev(`Number(document.getElementById('tr-finish-xp').textContent.replace(/[^0-9]/g, ''))`);
      await click('#btn-finish-workout');
      await click('#btn-confirm-ok');
      const saved = await ev(`(() => { const w = state.history.find(w => w.id === ${J(id)}); return w && { id: w.id, xp: historyEntryXp(w), sets: historyDoneSets(w), phases: w.phases, stored: w.xp }; })()`);
      await click('#btn-result-close');
      return { id, preview, saved, replay };
    };

    console.log('== First/last cards, manual completion and no set inflation');
    await fixture();
    await click('#phase-toggle-warmup');
    await click('#phase-toggle-stretching');
    check('enabled cards bracket only the working exercise list', await ev(`(() => {
      const first = document.getElementById('workout-phase-warmup'), last = document.getElementById('workout-phase-stretching'), list = document.getElementById('exercise-list');
      return first.getClientRects().length > 0 && last.getClientRects().length > 0
        && !!(first.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(list.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !list.contains(first) && !list.contains(last) && !first.matches('.exercise') && !last.matches('.exercise');
    })()`));
    await click('#workout-phase-warmup [data-phase-complete]');
    await click('#workout-phase-stretching [data-phase-complete]');
    check('phase-only completion cannot save or award working XP', await ev(`getSession().phases.warmup.done && getSession().phases.stretching.done && totalSetsDone() === 0 && document.getElementById('btn-finish-workout').disabled`));
    const first = await saveWorkout();
    check('saved durable session ID, exactly three working sets and 46 XP', first.saved && first.saved.id === first.id && first.saved.sets === 3 && first.saved.xp === 46 && first.preview === 46, first);
    check('both first eligible phase badges earned once', await ev(`!!state.achievements.phaseWarmup1 && !!state.achievements.phaseStretch1`));
    check('replaying a finalized session cannot append or award workout XP twice', await ev(`(() => { const before = JSON.stringify(state.history); state.activeSession = ${first.replay}; renderTrening(); finishWorkout(); confirmFinish(); document.getElementById('modal-result').hidden = true; return JSON.stringify(state.history) === before && workoutXP() === 46; })()`));
    await ev(`(lastWorkoutId = ${J(first.id)}, requestUndoWorkout(), confirmGeneric(), true)`);
    check('Undo removes workout XP but preserves both permanent 25-XP phase rewards and no session', await ev(`(() => { const earned = state.achievements, warmup = earned.phaseWarmup1, stretching = earned.phaseStretch1, before = totalXP(); delete earned.phaseWarmup1; delete earned.phaseStretch1; const delta = before - totalXP(); earned.phaseWarmup1 = warmup; earned.phaseStretch1 = stretching; return state.history.length === 0 && !getSession() && workoutXP() === 0 && !!warmup && !!stretching && delta === 50; })()`));

    console.log('== Daily cap, malformed metadata and history edits');
    const rewards = await ev(`(() => {
      const done = kind => ({ enabled: true, config: defaultWorkoutPhaseConfig(), done: true, completedAt: Date.now(), completionMethod: 'manual' });
      const entry = (id, sets, phases) => ({ id, date: '2031-03-10', planId: 'phaseTest', exercises: [{ name: 'Bench', id: 'bench-press', sets: Math.max(3, sets), setsDone: sets, reps: 8, weight: 20 }], phases });
      const phases = { v: 1, warmup: done('warmup'), stretching: done('stretching') };
      const a = entry('a', 2, phases), b = entry('b', 3, phases), c = entry('c', 3, phases), d = entry('d', 3, phases);
      state.history = [a,b,c,d]; state.achievements = {}; xpCacheClear();
      const initial = state.history.map(historyEntryXp);
      b.exercises[0].setsDone = 2; recalculateAll();
      const afterEdit = state.history.map(historyEntryXp);
      const bad = JSON.parse(JSON.stringify(phases)); bad.warmup.completedAt = 1e100; bad.stretching.completionMethod = 'invented';
      const malformed = workoutEntryBaseXp(entry('bad', 3, bad));
      const old = entry('old',3,undefined); delete old.phases;
      const oldXp = historyEntryXp(old);
      return { initial, afterEdit, malformed, oldXp };
    })()`);
    check('only first two positive workouts consume daily slots including phase bonus', J(rewards.initial) === J([0,46,46,0]), rewards);
    check('in-place history edit frees the slot before achievement evaluation', J(rewards.afterEdit) === J([0,0,46,46]), rewards);
    check('impossible timestamp/method cannot grant phase XP; old detached entry keeps base', rewards.malformed === 36 && rewards.oldXp === 36, rewards);
    await fixture();
    await ev(`(() => { const mk = id => ({ id, date: todayISO(), exercises: [{ name: 'Bench', weight: 20, sets: 3, setsDone: 3, reps: 8 }] }); state.history = [mk('prior1'), mk('prior2')]; xpCacheClear(); return true; })()`);
    await mark('warmup');
    const capped = await saveWorkout();
    check('third eligible workout saves phase but gets neither phase XP nor first badge', capped.saved && capped.saved.xp === 0 && capped.saved.phases.warmup.done && !(await ev(`!!state.achievements.phaseWarmup1`)), capped);

    console.log('== Timer arithmetic at boundaries and monotonic clock');
    const timing = await ev(`(() => {
      const config = { workSeconds: 60, restSeconds: 30, rounds: 2, activityIds: [] };
      const sess = { id: 'clock-fixture', phases: { v:1, warmup: { enabled:true, config, done:false } } };
      const t0 = 200000;
      const run = newBrowserWorkoutPhaseTimer(sess,'warmup',t0);
      const pause = pauseBrowserWorkoutPhase(run, config, t0 + 65000, true, 65000);
      const resumed = resumeBrowserWorkoutPhase(pause,t0+100000);
      const finish = browserWorkoutPhaseAt(run,config,t0+150000,true,150000);
      const gap = browserWorkoutPhaseAt(run,config,t0+150000,false,150000);
      const sampled = browserWorkoutPhaseAt(run,config,t0+50000,true,50000);
      const back = browserWorkoutPhaseAt(sampled,config,t0+40000,true);
      const liveClockChange = browserWorkoutPhaseAt(sampled,config,t0+40000,true,1000);
      const forged = Object.assign({},run,{status:'completed',stage:null,remainingMs:0,stageEndAt:0});
      const badTransition = Object.assign({},run,{lastTransition:1});
      return { pause, resumed, finish, gap, back, liveClockChange,
        forgedAccepted: !!cleanWorkoutPhaseTimer(forged,sess.phases), badTransitionAccepted:!!cleanWorkoutPhaseTimer(badTransition,sess.phases) };
    })()`);
    check('pause crossing work boundary preserves only remaining 25s rest', timing.pause.stage === 'rest' && timing.pause.remainingMs === 25000 && timing.pause.status === 'paused', timing.pause);
    check('resume retains current segment and remaining deadline', timing.resumed.stage === 'rest' && timing.resumed.stageEndAt === 325000, timing.resumed);
    check('natural completion has final identity but known execution gap is not completion', timing.finish.status === 'completed' && timing.finish.lastTransition === 3 && timing.finish.segmentIndex === 2 && timing.gap.status === 'interrupted', timing);
    check('backward wall clock cannot extend countdown or fake completion', timing.back.status === 'interrupted' && timing.liveClockChange.status === 'running' && timing.liveClockChange.remainingMs === 9000, timing.liveClockChange);
    check('forged completed snapshot and mismatched active transition rejected', !timing.forgedAccepted && !timing.badTransitionAccepted, timing);

    if (process.env.GQ_PHASE_CASES) {
      const cases = JSON.parse(fs.readFileSync(process.env.GQ_PHASE_CASES, 'utf8'));
      for (const row of cases.timers) {
        const actual = await ev(`(() => {
          const row = ${J(row)}, config = {workSeconds:row.work,restSeconds:row.rest,rounds:row.rounds,activityIds:[]};
          const sess = {id:'matrix',phases:{v:1,warmup:{enabled:true,config,done:false}}};
          const start = 200000, bad = [];
          let timer = newBrowserWorkoutPhaseTimer(sess,'warmup',start), elapsed = 0, sampled = 0;
          for (const stage of row.segments) {
            timer = browserWorkoutPhaseAt(timer,config,start+elapsed,true,elapsed-sampled);
            sampled = elapsed;
            if (timer.status !== 'running' || timer.stage !== stage) bad.push({elapsed,stage,actual:timer.stage,status:timer.status});
            elapsed += (stage === 'work' ? row.work : row.rest) * 1000;
          }
          timer = browserWorkoutPhaseAt(timer,config,start+elapsed,true,elapsed-sampled);
          return {bad,elapsed,status:timer.status,round:timer.round,segmentIndex:timer.segmentIndex,remainingMs:timer.remainingMs};
        })()`);
        check('timer consumer '+row.work+'/'+row.rest+'/'+row.rounds+' has exactly the configured sequence and no trailing rest',
          actual.bad.length===0 && actual.elapsed===row.totalSec*1000 && actual.status==='completed'
          && actual.round===row.rounds && actual.segmentIndex===2*row.rounds-2 && actual.remainingMs===0,actual);
      }
      for (const row of cases.xp) {
        const actual = await ev(`(() => {
          const row = ${J(row)}, date = '2031-04-01';
          const ex = n => [{name:'Bench',weight:20,sets:Math.max(3,n),setsDone:n,reps:8}];
          const done = {enabled:true,config:defaultWorkoutPhaseConfig(),done:true,completedAt:Date.now(),completionMethod:'manual'};
          const phases = {v:1};
          if (row.phasesDone>0) phases.warmup=JSON.parse(JSON.stringify(done));
          if (row.phasesDone>1) phases.stretching=JSON.parse(JSON.stringify(done));
          const current = {id:'matrix-current',date,exercises:ex(row.workingSets),phases};
          state.history = Array.from({length:row.eligibleOrdinal-1},(_,i)=>({id:'matrix-prior-'+i,date,exercises:ex(3)})).concat(current);
          state.achievements={}; xpCacheClear(); reconcileAchievements();
          return {xp:historyEntryXp(current),badge:!!state.achievements.phaseWarmup1 || !!state.achievements.phaseStretch1};
        })()`);
        check('XP consumer '+row.workingSets+' sets/'+row.phasesDone+' phases/ordinal '+row.eligibleOrdinal,
          actual.xp===row.expectXp && actual.badge===row.badgeEligible,actual);
      }
    }

    console.log('== Real browser timer, cancellation, reload and automatic Rest');
    await fixture();
    await ev(`(() => { setWorkoutPhaseEnabled('warmup',true); getSession().phases.warmup.config = {workSeconds:1,restSeconds:0,rounds:2,activityIds:[]}; renderWorkoutPhases(); return true; })()`);
    await click('#workout-phase-warmup [data-phase-action="start"]');
    check('phase owns timer; enabled automatic set Rest cannot replace it', await ev(`(() => { const run = getSession().phaseTimer.runId; state.settings.autoRest = true; const accepted = maybeAutoRest(currentPlan(),0); state.settings.autoRest = false; return accepted === false && getSession().phaseTimer.runId === run && workoutPhaseLive() && timerInterval === null; })()`));
    await sleep(2400);
    check('two zero-rest work periods finish naturally without trailing rest', await ev(`getSession().phaseTimer.status === 'completed' && getSession().phaseTimer.segmentIndex === 2 && getSession().phases.warmup.done && getSession().phases.warmup.completionMethod === 'timer'`));
    await ev(`(async () => { await setWorkoutPhaseDone('warmup',false); getSession().phases.warmup.config = {workSeconds:1,restSeconds:1,rounds:3,activityIds:[]}; renderWorkoutPhases(); return true; })()`);
    await click('#workout-phase-warmup [data-phase-action="start"]');
    await ev(`(setWorkoutPhaseEnabled('warmup',false), true)`);
    await sleep(1200);
    check('disabled phase cannot be resurrected by queued timer callbacks', await ev(`!getSession().phases.warmup.enabled && !getSession().phases.warmup.done && !getSession().phases.warmup.completedAt && !workoutPhaseLive()`));
    await ev(`(() => { setWorkoutPhaseEnabled('warmup',true); getSession().phases.warmup.config = {workSeconds:20,restSeconds:1,rounds:2,activityIds:[]}; renderWorkoutPhases(); return true; })()`);
    await click('#workout-phase-warmup [data-phase-action="start"]');
    await page.reload();
    await ev(`(switchTab('trening'),renderTrening(),true)`);
    check('browser reload interrupts rather than fabricating reliable background timing', await ev(`getSession().phaseTimer.status === 'interrupted' && !getSession().phases.warmup.done`));

    console.log('== Legacy data, six locales and actual small-screen layout');
    await fixture();
    await ev(`(() => { const s=getSession(); s.warmups={'bench-press':[{w:10,r:8,done:true},{w:15,r:5,done:false}]}; saveState(); renderTrening(); return true; })()`);
    check('legacy warmups remain accessible first even when timed phase is off', await ev(`(() => { const legacy=document.getElementById('workout-phase-legacy'),list=document.getElementById('exercise-list'); return !!legacy && legacy.querySelectorAll('.warmup-item').length===2 && !!(legacy.compareDocumentPosition(list)&Node.DOCUMENT_POSITION_FOLLOWING) && !getSession().phases.warmup.done && !list.querySelector('.warmup-item'); })()`));
    await page.reload();
    check('old completed/unfinished rows survive reload without awarding phase completion', await ev(`getSession().warmups['bench-press'][0].done && !getSession().warmups['bench-press'][1].done && !getSession().phases.warmup.done`));
    await page.c.send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:2,mobile:true});
    for (const lang of ['en','sk','es','pt-BR','fr','ar']) {
      for (const theme of ['light','dark']) {
        const layout=await ev(`(() => { setLang(${J(lang)}); document.documentElement.setAttribute('data-theme',${J(theme)}); setWorkoutPhaseEnabled('warmup',true); setWorkoutPhaseEnabled('stretching',true); switchTab('trening'); renderTrening(); const cards=['workout-phase-warmup','workout-phase-stretching'].map(id=>document.getElementById(id)); return {overflow:document.documentElement.scrollWidth>innerWidth+1,missing:cards.some(e=>/phase\\.[a-zA-Z]/.test(e.textContent)),rtl:document.documentElement.dir,visible:cards.every(e=>e.getClientRects().length>0),controls:cards.flatMap(e=>[...e.querySelectorAll('button,input[type=checkbox]')]).filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().left>=-1&&e.getBoundingClientRect().right<=innerWidth+1)}; })()`);
        check(lang+' '+theme+': visible translated cards and no horizontal overflow',layout.visible&&!layout.missing&&!layout.overflow&&layout.controls&&(lang!=='ar'||layout.rtl==='rtl'),layout);
      }
    }
    check('no uncaught browser exceptions',page.errors.length===0,page.errors);
  } catch (error) {
    check('scenario completed',false,String(error.stack||error));
  } finally {
    browser.killHard(true);
    await server.close();
  }
  console.log('\n==== phase checks: '+passed+' passed, '+failed+' failed ====');
  process.exitCode=failed?1:0;
})();
