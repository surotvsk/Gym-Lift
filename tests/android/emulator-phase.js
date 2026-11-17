'use strict';
/* GymQuest Android - Warm-up/Stretching phases on the designated emulator only: native service, ongoing notification,
   media-stream gong with the screen off, completion after waking, Stop. APK with empty Community config, synthetic data.
   Serial: GQ_EMULATOR_SERIAL (default emulator-5554). Build first: android debug APK with an empty community-config.js. */
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const REPO = path.resolve(__dirname, '../..');
const { cdpConnect, waitFor } = require('../sync/lib');
const adbPath = path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
const pkg = 'surotvsk.gymapp', serial = process.env.GQ_EMULATOR_SERIAL || 'emulator-5554';
const adb = (...a) => execFileSync(adbPath, ['-s', serial, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sh = (...a) => adb('shell', ...a);
const wait = ms => new Promise(r => setTimeout(r, ms));
let c, ev, pass = 0, fail = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || d === undefined ? '' : ' -> ' + JSON.stringify(d))); ok ? pass++ : fail++; };
const gong = () => sh('dumpsys', 'audio').split('\n').some(l => /type:android\.media\.MediaPlayer/.test(l) && /usage=USAGE_MEDIA/.test(l));
const phaseService = () => sh('dumpsys', 'activity', 'services', pkg).includes('GymPhaseService');
const note = () => sh('dumpsys', 'notification', '--noredact').split('\n').some(l => /NotificationRecord/.test(l) && l.includes(pkg) && /id=6211\b/.test(l));
async function launch() {
  sh('input', 'keyevent', '224'); sh('wm', 'dismiss-keyguard');
  sh('am', 'start', '-n', pkg + '/.MainActivity');
  const socket = await waitFor(() => { const pid = sh('pidof', pkg).trim().split(' ')[0]; return sh('cat', '/proc/net/unix').includes('webview_devtools_remote_' + pid) && 'webview_devtools_remote_' + pid; }, 30000, 'WebView');
  adb('forward', 'tcp:9336', 'localabstract:' + socket);
  const page = await waitFor(async () => (await (await fetch('http://127.0.0.1:9335/json/list')).json()).find(t => t.type === 'page'), 30000, 'page');
  c = await cdpConnect(page.webSocketDebuggerUrl);
  ev = async expression => { const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await waitFor(() => ev('typeof startWorkoutPhase === "function"'), 30000, 'app ready');
  await ev(`(() => { localStorage.setItem('gymquest_tutorial','{"v":1,"status":"done","at":0}'); const b = document.getElementById('btn-setup-ok'); if (b && !document.getElementById('modal-setup').hidden) b.click(); closeTour('yield'); return true; })()`);
}
(async () => {
  try {
    if (sh('getprop', 'ro.kernel.qemu').trim() !== '1') throw new Error('emulator only');
    const apk = REPO + '/android/app/build/outputs/apk/debug/app-debug.apk';
    const cfg = execFileSync('unzip', ['-p', apk, 'assets/public/community-config.js'], { encoding: 'utf8' });
    if (!/supabaseUrl:\s*['"]['"]/.test(cfg)) throw new Error('refusing online config');
    adb('install', '-r', apk);
    sh('pm', 'clear', pkg);
    sh('pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS');
    await launch();
    check('empty Community config in test build', await ev('!GYMQUEST_COMMUNITY.supabaseUrl'));
    const caps = await ev('workoutPhaseCapabilities().then(v => JSON.stringify(v))').catch(e => String(e));
    console.log('capabilities', caps);
    await ev(`(() => {
      clearSession(); stopTimer(); state.history = []; state.settings.restSound = true; state.settings.workoutPhases = cleanWorkoutPhasePreferences(null);
      state.plans.phaseTest = { id: 'phaseTest', builtin: false, customName: 'Phase regression', location: null, exercises: [{ id: 'bench-press', name: 'Bench', sets: 3, reps: 8, weight: 20 }] };
      if (!state.planOrder.includes('phaseTest')) state.planOrder.push('phaseTest');
      selectedPlan = 'phaseTest'; ensureSession(getPlan(selectedPlan)); saveState(); switchTab('trening'); renderTrening();
      setWorkoutPhaseEnabled('warmup', true);
      getSession().phases.warmup.config = { workSeconds: 3, restSeconds: 2, rounds: 3, activityIds: [] };
      renderWorkoutPhases(); return true; })()`);
    const started = await ev(`(async () => { await startWorkoutPhase('warmup'); await workoutPhaseReconcile(); const t = getSession().phaseTimer; return t && { status: t.status, stage: t.stage, owner: !!t.ownerId, rounds: t.rounds }; })()`);
    check('phase starts natively', started && started.status === 'running', started);
    check('native phase foreground service runs', phaseService());
    check('ongoing phase notification posted', note());
    sh('input', 'keyevent', '3'); sh('input', 'keyevent', '223');
    let sawGong = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 16000) { if (gong()) sawGong = true; await wait(300); }
    check('gong plays on media stream while screen is off', sawGong);
    check('service gone after natural completion', !phaseService());
    await launch();
    await ev('workoutPhaseReconcile()');
    const end = await ev(`(() => { const s = getSession(), p = s.phaseTimer; return { status: p && p.status, done: s.phases.warmup.done, method: s.phases.warmup.completionMethod }; })()`);
    check('native completion reconciled after waking', end.status === 'completed' && end.done === true && end.method === 'timer', end);
    // Rest vs phase exclusivity
    await ev(`(async () => { setWorkoutPhaseEnabled('stretching', true); getSession().phases.stretching.config = { workSeconds: 30, restSeconds: 5, rounds: 2, activityIds: [] }; await startWorkoutPhase('stretching'); await workoutPhaseReconcile(); return true; })()`);
    check('second phase running', phaseService());
    await ev(`(async () => { await workoutPhaseCommand('stop'); await workoutPhaseReconcile(); return true; })()`).catch(e => console.log('stop cmd', e.message));
    await wait(800);
    check('Stop removes service and notification', !phaseService() && !note());
    const errs = await ev('(window.__errs || []).length').catch(() => 0);
    check('no recorded app errors', errs === 0, errs);
  } catch (e) { console.log('ERROR', e.stack || e.message); fail++; }
  finally {
    try { sh('am', 'force-stop', pkg); sh('input', 'keyevent', '224'); adb('forward', '--remove', 'tcp:9336'); } catch (_) {}
    if (c) c.close();
    console.log(`==== checks: ${pass} passed, ${fail} failed ====`);
  }
  process.exit(fail ? 1 : 0);
})();
