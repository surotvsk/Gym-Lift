'use strict';
/* GymQuest Android — status bar follows the app theme (headless Chrome + fake Capacitor).

     node tests/android/native-theme.js

   Light → StatusBar style LIGHT (dark icons) + background #E9E8E4; Dark → style DARK (light icons)
   + #0E0E0F; System follows prefers-color-scheme both ways; every theme-chip change re-applies;
   web mode makes no native calls. */
const { counter, startServerOnce, openApp, closeAll, nativeCalls, clearNativeCalls } = require('./lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;

async function lastBar(p) {
  const style = await nativeCalls(p, 'StatusBar', 'setStyle');
  const bg = await nativeCalls(p, 'StatusBar', 'setBackgroundColor');
  return { style: style.length && style[style.length - 1].args[0].style, color: bg.length && bg[bg.length - 1].args[0].color };
}

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    const { p, errors } = await openApp({ name: 'ntheme', debugPort: 9934, native: true });
    await wait(1000);
    check('startup applies the bar once at least', (await nativeCalls(p, 'StatusBar', 'setStyle')).length >= 1);

    await clearNativeCalls(p);
    await p.eval(`(setThemePref('light'), true)`);
    let b = await lastBar(p);
    check('light: style LIGHT + #E9E8E4', b.style === 'LIGHT' && /^#e9e8e4$/i.test(b.color), b);

    await clearNativeCalls(p);
    await p.eval(`(setThemePref('dark'), true)`);
    b = await lastBar(p);
    check('dark: style DARK + #0E0E0F', b.style === 'DARK' && /^#0e0e0f$/i.test(b.color), b);

    for (const scheme of ['dark', 'light']) {
      await p.c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await clearNativeCalls(p);
      await p.eval(`(setThemePref('system'), true)`);
      await wait(100);
      b = await lastBar(p);
      check('system (' + scheme + '): style ' + scheme.toUpperCase(), b.style === scheme.toUpperCase(), b);
    }

    /* telefón sa prepne do tmavého režimu, kým appka beží na "Systém" */
    await clearNativeCalls(p);
    await p.c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await wait(200);
    b = await lastBar(p);
    check('system: phone switches to dark while running → bar DARK', b.style === 'DARK', b);

    await p.eval(`(openSettings(), true)`);
    await clearNativeCalls(p);
    await p.eval(`(document.querySelector('#theme-chips [data-theme-choice="dark"]').click(), true)`);
    b = await lastBar(p);
    check('theme chip click re-applies the bar', b.style === 'DARK', b);

    check('no console errors', errors.length === 0, errors.slice(0, 5));
    closeAll();

    const web = await openApp({ name: 'ntheme-web', debugPort: 9935 });
    await wait(800);
    await web.p.eval(`(setThemePref('dark'), true)`);
    check('web: no Capacitor, no errors', await web.p.eval(`typeof window.Capacitor === 'undefined'`) && web.errors.length === 0, web.errors);
  } catch (e) {
    check('no exception in test', false, String(e && e.stack || e));
  } finally {
    closeAll();
    server.close();
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  }
})();
