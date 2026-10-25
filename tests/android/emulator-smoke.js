'use strict';
/* GymQuest Android — smoke test on a REAL device or emulator (debug build), over adb + the WebView's
   DevTools socket. Needs exactly one device in `adb devices`.

     npm run android:sync && (cd android && JAVA_HOME=~/.local/share/jdk/jdk-21.0.13+9 ./gradlew assembleDebug)
     node tests/android/emulator-smoke.js

   Checks: install + cold start to Today ≤ 3 s; running as the native app (no service worker); all
   tabs in light and dark; airplane mode: a full workout is saved and an exercise video plays from the
   bundle; the hardware Back key walks sheet → tab → Today → background; export opens Android's share
   sheet; a local reminder fires; Health Connect availability is reported; installed size. Screenshots
   go to $GQ_WORK/android-shots (store listing material). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { cdpConnect, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const ADB = process.env.ADB || path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
const APK = process.env.GQ_APK || path.join(REPO, 'android/app/build/outputs/apk/debug/app-debug.apk');
const PKG = 'surotvsk.gymapp';
const SHOTS = path.join(process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-android'), 'android-shots');
const PORT = 9333;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let pass = 0, fail = 0;
const check = (n, ok, info) => { if (ok) pass++; else fail++; console.log((ok ? '  PASS ' : '  FAIL ') + n + (!ok && info !== undefined ? '  -> ' + J(info) : '')); };
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sh = (cmd) => adb('shell', cmd);

async function connectWebView() {
  const sock = await waitFor(() => {
    const m = /@?(webview_devtools_remote_\d+)/.exec(sh('cat /proc/net/unix'));
    return m ? m[1] : null;
  }, 20000, 'webview devtools socket');
  adb('forward', 'tcp:' + PORT, 'localabstract:' + sock);
  const list = await waitFor(async () => {
    const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    return l.find((t) => t.type === 'page') ? l : null;
  }, 20000, 'webview page');
  const c = await cdpConnect(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  };
  return { c, ev };
}
function shot(name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), execFileSync(ADB, ['exec-out', 'screencap', '-p']));
}

(async () => {
  try {
    const devs = adb('devices').split('\n').filter((l) => /\tdevice$/.test(l));
    check('exactly one device connected', devs.length === 1, devs);
    if (devs.length !== 1) throw new Error('connect one phone (USB debugging) or start an emulator');

    adb('install', '-r', APK);
    sh('pm clear ' + PKG);
    const t0 = Date.now();
    sh('am start -W -n ' + PKG + '/.MainActivity');
    let w = await connectWebView();
    await waitFor(() => w.ev(`typeof activeTab !== 'undefined' && !!document.getElementById('screen-dnes')`), 15000, 'app start');
    const startMs = Date.now() - t0;
    check('cold start to Today ≤ 3 s (' + startMs + ' ms)', startMs <= 3000);
    check('running as the native app', await w.ev(`isNativeApp() === true`));
    check('no service worker', await w.ev(`navigator.serviceWorker.getRegistrations().then((r) => r.length === 0)`));
    await w.ev(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); seedSampleData(); saveState(); renderAll(); return true; })()`);

    for (const theme of ['light', 'dark']) {
      await w.ev(`(setThemePref(${J(theme)}), true)`);
      for (const tab of ['dnes', 'trening', 'pokrok', 'kalendar', 'ty']) {
        await w.ev(`(switchTab(${J(tab)}), window.scrollTo(0, 0), true)`);
        await wait(400);
        shot(theme + '-' + tab);
      }
    }
    check('all tabs rendered in light and dark (screenshots)', fs.readdirSync(SHOTS).length >= 10);

    sh('cmd connectivity airplane-mode enable');
    await wait(1500);
    const before = await w.ev(`state.history.length`);
    await w.ev(`(() => { const plan = getPlan(activePlanIds()[0]); selectedPlan = plan.id; const s = ensureSession(plan);
      s.completedSets[setSessionKey(plan.exercises[0], 0)] = true; saveState(); finishWorkout(); confirmFinish(); return true; })()`);
    check('airplane mode: workout saved', (await w.ev(`state.history.length`)) === before + 1);
    await w.ev(`(document.getElementById('modal-result').hidden = true, openLibrary(), openExerciseSheet('bench-press'), true)`);
    const video = await waitFor(() => w.ev(`(() => { const v = document.querySelector('#modal-exercise video'); return v && v.readyState >= 2 ? v.currentSrc : null; })()`), 10000, 'video').catch(() => null);
    check('airplane mode: bundled MP4 video loads', !!video && /\.mp4$/.test(video), video);
    sh('cmd connectivity airplane-mode disable');

    sh('input keyevent 4');
    await wait(400);
    check('Back: exercise sheet closes first', await w.ev(`document.getElementById('modal-exercise').hidden && !document.getElementById('modal-library').hidden`));
    sh('input keyevent 4'); await wait(300);
    await w.ev(`(switchTab('pokrok'), true)`);
    sh('input keyevent 4'); await wait(300);
    check('Back: tab → Today', await w.ev(`activeTab === 'dnes'`));
    sh('input keyevent 4'); await wait(800);
    check('Back on Today: app goes to background', !/mResumedActivity.*surotvsk\.gymapp|topResumedActivity.*surotvsk\.gymapp/.test(sh('dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity"')));

    sh('am start -n ' + PKG + '/.MainActivity');
    w = await connectWebView();
    await w.ev(`(exportData(), true)`);
    await wait(1500);
    check('export opens the share sheet', /ChooserActivity|chooser|IntentResolver/i.test(sh('dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity"')));
    shot('share-sheet');
    sh('input keyevent 4');

    await w.ev(`Capacitor.Plugins.LocalNotifications.requestPermissions()`);
    await w.ev(`Capacitor.Plugins.LocalNotifications.schedule({ notifications: [{ id: 3999, title: 'GymQuest', body: 'smoke reminder', channelId: 'reminders', schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true } }] })`);
    await wait(12000);
    check('a local reminder fires', /smoke reminder|id=3999/.test(sh('dumpsys notification --noredact')));

    const hc = await w.ev(`Capacitor.Plugins.GymHealth.isAvailable().then((r) => r.available, () => 'error')`);
    check('Health Connect availability reported (' + hc + ')', hc === true || hc === false);

    const apkPath = sh('pm path ' + PKG).trim().replace(/^package:/, '');
    const size = Number(sh('stat -c %s ' + apkPath).trim());
    check('installed APK size ' + (size / 1048576).toFixed(1) + ' MB (< 60 MB debug)', size > 0 && size < 60 * 1048576);
    console.log('  screenshots: ' + SHOTS);
  } catch (e) {
    check('no exception', false, String(e && (e.stderr || e.stack) || e).slice(0, 800));
  } finally {
    try { adb('forward', '--remove', 'tcp:' + PORT); } catch (e) {}
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
