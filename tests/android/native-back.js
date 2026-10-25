'use strict';
/* GymQuest Android — hardware Back button (App 'backButton'), headless Chrome + fake Capacitor.

     node tests/android/native-back.js

   Every sheet/dialog in index.html is in NATIVE_BACK_CLOSE and Back closes it (the first-run setup
   stays open); stacked sheets close one at a time (top first); sub-views go back before the tab
   (Progress sub-view → stats, Calendar → out, plan editor → closed, Community back stack);
   any tab other than Today → Today; on Today Back puts the app in the background
   (App.minimizeApp, never exitApp), also with a running workout, which stays intact. */
const { counter, startServerOnce, openApp, closeAll, nativeCalls, clearNativeCalls, fireNative } = require('./lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    const { p, errors } = await openApp({ name: 'nback', debugPort: 9933, native: true });
    await wait(1500);
    const back = async () => { await fireNative(p, 'App', 'backButton', { canGoBack: false }); await wait(150); };
    const visible = (id) => p.eval(`!document.getElementById(${JSON.stringify(id)}).hidden`);
    const hideAll = () => p.eval(`(document.querySelectorAll('.modal-backdrop').forEach((m) => { m.hidden = true; }), true)`);

    check('backButton listener registered', await p.eval(`(window.__nativeListeners['App.backButton'] || []).length === 1`));

    const ids = await p.eval(`Array.from(document.querySelectorAll('.modal-backdrop')).map((m) => m.id)`);
    const missing = await p.eval(`Array.from(document.querySelectorAll('.modal-backdrop')).map((m) => m.id)
      .filter((id) => !NATIVE_BACK_CLOSE.some((e) => e[0] === id))`);
    check('every sheet/dialog (' + ids.length + ') is in NATIVE_BACK_CLOSE', ids.length >= 20 && missing.length === 0, missing);

    for (const id of ids) {
      if (id === 'modal-setup') continue;
      await hideAll();
      await p.eval(`(switchTab('dnes'), document.getElementById(${JSON.stringify(id)}).hidden = false, true)`);
      await clearNativeCalls(p);
      await back();
      const still = await visible(id);
      const min = await nativeCalls(p, 'App', 'minimizeApp');
      check('Back closes ' + id, !still && min.length === 0, { still, min: min.length });
    }

    await hideAll();
    await p.eval(`(document.getElementById('modal-setup').hidden = false, true)`);
    await clearNativeCalls(p);
    check('first-run setup: nativeBack() is blocked', await p.eval(`nativeBack() === 'blocked'`));
    await back();
    check('first-run setup stays open, app not minimized', await visible('modal-setup') && (await nativeCalls(p, 'App', 'minimizeApp')).length === 0);
    await hideAll();

    await p.eval(`(openLibrary(), openExerciseSheet('bench-press'), true)`);
    await wait(300);
    await back();
    check('stacked: exercise closes first, library stays', !(await visible('modal-exercise')) && await visible('modal-library'));
    await back();
    check('stacked: then library closes', !(await visible('modal-library')));

    await p.eval(`(openSettings(), openLanguagePicker(), true)`);
    await back();
    check('language picker over settings: picker closes, settings stay', !(await visible('modal-lang')) && await visible('modal-settings'));
    await back();
    check('then settings close', !(await visible('modal-settings')));

    await p.eval(`(switchTab('pokrok'), setPokrokView('body'), true)`);
    await back();
    check('Progress sub-view → stats', await p.eval(`activeTab === 'pokrok' && pokrokView === 'stats'`));
    await back();
    check('Progress → Today', await p.eval(`activeTab === 'dnes'`));

    await p.eval(`(switchTab('kalendar'), true)`);
    await back();
    check('Calendar → out of calendar', await p.eval(`activeTab !== 'kalendar'`));
    await p.eval(`(switchTab('dnes'), true)`);

    await p.eval(`(startEditPlan(activePlanIds()[0]), true)`);
    await wait(200);
    check('plan editor open', await p.eval(`editingPlan !== null`));
    await back();
    check('Back closes the plan editor', await p.eval(`editingPlan === null`));
    await hideAll();

    await p.eval(`(switchTab('komunita'), communityView = 'user', communityBack = [{ view: 'feed', user: null, post: null, chat: null }], true)`);
    await back();
    check('Community back stack: user → feed', await p.eval(`activeTab === 'komunita' && communityView === 'feed' && communityBack.length === 0`));
    await back();
    check('Community → Today', await p.eval(`activeTab === 'dnes'`));

    /* fotka z Community na celú obrazovku (nie je .modal-backdrop) */
    await p.eval(`(() => { const b = document.createElement('div'); b.id = 'community-lightbox'; b.className = 'community-lightbox';
      b.setAttribute('role', 'dialog'); b.innerHTML = '<img alt="">'; document.body.appendChild(b); switchTab('komunita'); communityView = 'feed'; return true; })()`);
    await clearNativeCalls(p);
    await back();
    check('Back closes the Community photo viewer first (tab unchanged)', await p.eval(`document.getElementById('community-lightbox').hidden && activeTab === 'komunita'`));
    await back();
    check('then Community → Today', await p.eval(`activeTab === 'dnes'`));

    await clearNativeCalls(p);
    await back();
    check('Today: Back minimizes the app', (await nativeCalls(p, 'App', 'minimizeApp')).length === 1);
    check('never exitApp', (await nativeCalls(p, 'App', 'exitApp')).length === 0);

    await p.eval(`(ensureSession(getPlan(activePlanIds()[0])), saveState(), switchTab('trening'), true)`);
    const sid = await p.eval(`JSON.stringify(getSession())`);
    await p.eval(`(openSettings(), true)`);
    await back();
    check('workout running: Back closes settings only', !(await visible('modal-settings')) && await p.eval(`activeTab === 'trening'`));
    await back();
    check('workout tab → Today, workout kept', await p.eval(`activeTab === 'dnes'`) && await p.eval(`JSON.stringify(getSession())`) === sid);
    await clearNativeCalls(p);
    await back();
    check('Today with running workout: minimized (not exited), workout intact',
      (await nativeCalls(p, 'App', 'minimizeApp')).length === 1 && (await nativeCalls(p, 'App', 'exitApp')).length === 0
      && await p.eval(`JSON.stringify(getSession())`) === sid);

    check('no console errors', errors.length === 0, errors.slice(0, 5));
  } catch (e) {
    check('no exception in test', false, String(e && e.stack || e));
  } finally {
    closeAll();
    server.close();
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  }
})();
