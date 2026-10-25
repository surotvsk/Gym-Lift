'use strict';
/* GymQuest Android — native mode basics, in headless Chrome with a fake Capacitor.

     node tests/android/native-core.js

   Web (no Capacitor): isNativeApp() false, service worker registers, "Check for updates" visible —
   unchanged. Android (fake Capacitor): isNativeApp() true, no service worker, no update banner or
   update setting, exercise videos use only the bundled MP4, the splash screen is hidden once after
   the first render; no console errors in either mode. */
const { counter, startServerOnce, openApp, closeAll, nativeCalls } = require('./lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;

async function videoSources(p) {
  await p.eval(`(openLibrary(), openExerciseSheet('bench-press'), true)`);
  await wait(800);
  return p.eval(`Array.from(document.querySelectorAll('#modal-exercise video source')).map((s) => s.getAttribute('src'))`);
}

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    /* ---- web ---- */
    const web = await openApp({ name: 'ncore-web', debugPort: 9931 });
    await wait(1500);
    check('web: isNativeApp() is false', await web.p.eval(`typeof isNativeApp === 'function' && isNativeApp() === false`));
    check('web: service worker registered', await web.p.eval(`navigator.serviceWorker.getRegistrations().then((r) => r.length > 0)`));
    await web.p.eval(`(openSettings(), true)`).catch(() => {});
    await wait(300);
    check('web: update setting shown', await web.p.eval(`!document.getElementById('app-update-block').hidden`));
    const webSrc = await videoSources(web.p);
    check('web: video has WebM + MP4 sources', webSrc.some((s) => /\.webm$/.test(s)) && webSrc.some((s) => /\.mp4$/.test(s)), webSrc);
    check('web: no console errors', web.errors.length === 0, web.errors);
    web.b.killHard(true);

    /* ---- Android ---- */
    const an = await openApp({ name: 'ncore-android', debugPort: 9932, native: true });
    await wait(1500);
    check('android: isNativeApp() is true', await an.p.eval(`isNativeApp() === true`));
    check('android: nativePlugin returns the plugin', await an.p.eval(`!!nativePlugin('StatusBar') && nativePlugin('Nope') !== undefined`));
    check('android: no service worker', await an.p.eval(`navigator.serviceWorker.getRegistrations().then((r) => r.length === 0)`));
    await an.p.eval(`(swUpdateReady = true, refreshUpdateBanner(), true)`);
    check('android: update banner stays hidden', await an.p.eval(`document.getElementById('update-banner').hidden`));
    await an.p.eval(`(swUpdateReady = false, refreshUpdateBanner(), true)`);
    await an.p.eval(`(openSettings(), true)`).catch(() => {});
    await wait(300);
    check('android: update setting hidden', await an.p.eval(`document.getElementById('app-update-block').hidden`));
    await an.p.eval(`(document.getElementById('modal-settings').hidden = true, true)`);
    const anSrc = await videoSources(an.p);
    check('android: video uses only MP4', anSrc.length === 1 && /\.mp4$/.test(anSrc[0]), anSrc);
    const hides = await nativeCalls(an.p, 'SplashScreen', 'hide');
    check('android: splash hidden exactly once', hides.length === 1, hides);
    check('android: no console errors', an.errors.length === 0, an.errors);
    an.b.killHard(true);
  } catch (e) {
    check('no exception in test', false, String(e && e.stack || e));
  } finally {
    closeAll();
    server.close();
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  }
})();
