'use strict';
/* Len vyhradený emulátor: syntetické dáta, APK s prázdnou Community konfiguráciou.
   Žiadny fyzický telefón, účty ani produkčné volania. */
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const { cdpConnect, waitFor } = require('../sync/lib');
const adbPath = path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
const pkg = 'surotvsk.gymapp', serial = 'emulator-5554';
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sh = (...args) => adb('shell', ...args);
const wait = ms => new Promise(r => setTimeout(r, ms));
let c, ev, pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
const alert = () => sh('dumpsys', 'notification', '--noredact').split('\n').some(l => /NotificationRecord/.test(l) && l.includes(pkg) && /id=6202\b/.test(l));
async function launch() {
  sh('input', 'keyevent', '224');
  sh('am', 'start', '-n', pkg + '/.MainActivity');
  const socket = await waitFor(() => {
    const pid = sh('pidof', pkg).trim().split(' ')[0];
    return sh('cat', '/proc/net/unix').includes('webview_devtools_remote_' + pid) && 'webview_devtools_remote_' + pid;
  }, 20000, 'WebView');
  adb('forward', 'tcp:9334', 'localabstract:' + socket);
  const page = await waitFor(async () => (await (await fetch('http://127.0.0.1:9334/json/list')).json()).find(t => t.type === 'page'), 20000, 'page');
  c = await cdpConnect(page.webSocketDebuggerUrl);
  ev = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await waitFor(() => ev('typeof startTimer === "function"'), 20000, 'app ready');
  await ev(`(() => { localStorage.setItem('gymquest_rest_alarm_asked','1'); localStorage.setItem('gymquest_tutorial','{"v":1,"status":"done","at":0}'); const b = document.getElementById('btn-setup-ok'); if (b && !document.getElementById('modal-setup').hidden) b.click(); closeTour('yield'); state.settings.restSound = true; return true; })()`);
}
async function timer(code) { await ev(code + '; nativeRestQueue'); }
(async () => {
  try {
    if (sh('getprop', 'ro.kernel.qemu').trim() !== '1') throw new Error('Only the designated emulator is allowed');
    const apk = path.resolve(__dirname, '../../android/app/build/outputs/apk/debug/app-debug.apk');
    const cfg = execFileSync('unzip', ['-p', apk, 'assets/public/community-config.js'], { encoding: 'utf8' });
    if (!/supabaseUrl:\s*['"]['"]/.test(cfg) || !/supabaseAnonKey:\s*['"]['"]/.test(cfg)) throw new Error('Refusing an APK with online backend configuration');
    adb('install', '-r', apk);
    sh('pm', 'clear', pkg);
    sh('pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS');
    sh('appops', 'set', pkg, 'SCHEDULE_EXACT_ALARM', 'allow');
    await launch();
    check('test build has no online backend', await ev('!GYMQUEST_COMMUNITY.supabaseUrl && !GYMQUEST_COMMUNITY.supabaseAnonKey'));
    if (!await ev('!GYMQUEST_COMMUNITY.supabaseUrl')) throw new Error('Refusing online test build');
    await timer('startTimer(3)');
    check('short timer starts foreground countdown', sh('dumpsys', 'activity', 'services', pkg).includes('GymRestService'));
    sh('input', 'keyevent', '3'); sh('input', 'keyevent', '223');
    await wait(4300);
    check('screen-off background timer posts alert', alert());
    await launch(); await timer('startTimer(3); pauseRestTimer()'); await wait(4000);
    check('paused timer does not alert', !alert());
    await timer('startTimer(2); startTimer(5)'); await wait(2800);
    check('replaced timer cannot alert early', !alert());
    await wait(3000); check('replacement alerts once due', alert());
    await timer('startTimer(180)'); await wait(300);
    check('long timer does not use short foreground service', !sh('dumpsys', 'activity', 'services', pkg).includes('GymRestService'));
    await timer('stopTimer()');
    check('stop removes notifications', !alert());
    sh('appops', 'set', pkg, 'SCHEDULE_EXACT_ALARM', 'deny');
    await launch();
    const result = await ev(`Capacitor.Plugins.GymRest.schedule({id:'denied',endAt:Date.now()+3000,title:'Test rest',body:'Done',sound:true})`);
    check('denied exact-alarm access reports fallback', result.exact === false);
    sh('input', 'keyevent', '3'); sh('input', 'keyevent', '223'); await wait(4300);
    check('short fallback alerts with screen off', alert());
    await launch(); await timer('stopTimer()');
    sh('dumpsys', 'battery', 'unplug'); sh('cmd', 'power', 'set-mode', '1');
    check('battery saver enabled for the test', sh('settings', 'get', 'global', 'low_power').trim() === '1');
    await timer('startTimer(3)');
    sh('input', 'keyevent', '3'); sh('input', 'keyevent', '223'); await wait(4300);
    check('short fallback alerts in battery saver', alert());
    sh('cmd', 'power', 'set-mode', '0'); sh('dumpsys', 'battery', 'reset');
    await launch(); await timer('stopTimer()');
    sh('pm', 'revoke', pkg, 'android.permission.POST_NOTIFICATIONS');
    await launch();
    const denied = await ev(`Capacitor.Plugins.GymRest.schedule({id:'no-notifications',endAt:Date.now()+3000,title:'Test rest',body:'Done',sound:true})`);
    check('revoked notifications reported unavailable', denied.notifications === false);
    await wait(4000); check('revoked notification permission is respected', !alert());
  } finally {
    try { sh('am', 'force-stop', pkg); sh('appops', 'set', pkg, 'SCHEDULE_EXACT_ALARM', 'allow'); sh('pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS'); sh('cmd', 'power', 'set-mode', '0'); sh('dumpsys', 'battery', 'reset'); sh('input', 'keyevent', '224'); adb('forward', '--remove', 'tcp:9334'); } catch (_) {}
    if (c) c.close();
    console.log(`==== checks: ${pass} passed, ${fail} failed ====`);
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
