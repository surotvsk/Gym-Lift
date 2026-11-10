'use strict';
/* GymQuest Android — GymBars.navMode on the real emulator (emulator-5554 ONLY, never a phone).
   Switches the navigation overlay (threebutton / gestural) and reads html.nav-buttons in the WebView.
   Needs an APK built with EMPTY supabaseUrl/supabaseAnonKey (see tests/android/emulator-rest.js).
   Restores the gestural overlay (the emulator default) at the end. */
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { cdpConnect, waitFor } = require('../sync/lib');
const adbPath = path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
const pkg = 'surotvsk.gymapp', serial = 'emulator-5554';
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sh = (...args) => adb('shell', ...args);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '../../../claude-code/phase8/task1');
let c, ev, pass = 0, fail = 0;
function check(name, ok, info) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || info === undefined ? '' : '  -> ' + JSON.stringify(info))); ok ? pass++ : fail++; }
async function connect() {
  const socket = await waitFor(() => {
    const pid = sh('pidof', pkg).trim().split(' ')[0];
    return pid && sh('cat', '/proc/net/unix').includes('webview_devtools_remote_' + pid) && 'webview_devtools_remote_' + pid;
  }, 20000, 'WebView');
  adb('forward', 'tcp:9335', 'localabstract:' + socket);
  const page = await waitFor(async () => (await (await fetch('http://127.0.0.1:9335/json/list')).json()).find((x) => x.type === 'page'), 20000, 'page');
  c = await cdpConnect(page.webSocketDebuggerUrl);
  ev = async (expression) => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await waitFor(() => ev('typeof nativeNavMode === "function"'), 20000, 'app ready');
}
const hasClass = () => ev(`document.documentElement.classList.contains('nav-buttons')`);
async function mode(overlay) {
  sh('cmd', 'overlay', 'enable-exclusive', '--category', 'com.android.internal.systemui.navbar.' + overlay);
  await wait(2500);
  sh('input', 'keyevent', '3');   // domov → späť: resume
  await wait(800);
  sh('am', 'start', '-n', pkg + '/.MainActivity');
  await wait(1500);
}
(async () => {
  try {
    if (sh('getprop', 'ro.kernel.qemu').trim() !== '1') throw new Error('Only the designated emulator is allowed');
    const apk = path.resolve(__dirname, '../../android/app/build/outputs/apk/debug/app-debug.apk');
    const cfg = execFileSync('unzip', ['-p', apk, 'assets/public/community-config.js'], { encoding: 'utf8' });
    if (!/supabaseUrl:\s*['"]['"]/.test(cfg) || !/supabaseAnonKey:\s*['"]['"]/.test(cfg)) throw new Error('Refusing an APK with online backend configuration');
    adb('install', '-r', apk);
    sh('pm', 'clear', pkg);
    sh('cmd', 'overlay', 'enable-exclusive', '--category', 'com.android.internal.systemui.navbar.threebutton');
    await wait(2500);
    sh('am', 'start', '-n', pkg + '/.MainActivity');
    await connect();
    await ev(`(localStorage.setItem('gymquest_tutorial','{"v":1,"status":"done","at":0}'), true)`);
    await wait(1500);
    check('setting navigation_mode is 0 (3 buttons)', sh('settings', 'get', 'secure', 'navigation_mode').trim() === '0');
    check('3 buttons: html.nav-buttons is set', await waitFor(hasClass, 8000, 'class').catch(() => false));
    const g = await ev(`(() => { const b = document.querySelector('.tab-bar').getBoundingClientRect(); return { l: b.left, r: b.right, b: b.bottom, vw: document.documentElement.clientWidth, vh: innerHeight }; })()`);
    check('3 buttons: bar spans the width and sits on the bottom of the WebView', Math.abs(g.l) < 1 && Math.abs(g.r - g.vw) < 1 && Math.abs(g.b - g.vh) < 1, g);
    await ev(`(() => { const b = document.getElementById('btn-setup-ok'); if (b) b.click(); return true; })()`); await wait(800);
    try { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'emulator-threebutton.png'), execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'])); } catch (e) {}

    await mode('gestural');
    await connect();
    check('gesture: setting navigation_mode is 2', sh('settings', 'get', 'secure', 'navigation_mode').trim() === '2');
    check('gesture: html.nav-buttons is removed', await waitFor(async () => !(await hasClass()), 8000, 'class').catch(() => false));
    try { fs.writeFileSync(path.join(SHOTS, 'emulator-gesture.png'), execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'])); } catch (e) {}

    await mode('threebutton');
    await connect();
    check('3 buttons again: class is set after switching back', await waitFor(hasClass, 8000, 'class').catch(() => false));
  } catch (e) { check('suite ran without exception', false, String(e && e.stack || e)); }
  finally { try { sh('cmd', 'overlay', 'enable-exclusive', '--category', 'com.android.internal.systemui.navbar.gestural'); } catch (e) {} }
  console.log('\nPASS ' + pass + '  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})();
