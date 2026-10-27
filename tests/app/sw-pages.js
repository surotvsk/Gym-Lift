'use strict';
/* GymQuest — which page loads the service worker answers with the app (real headless Chrome).

     [GQ_TEST_PORT=8134] node tests/app/sw-pages.js

   After the app has installed its service worker, opening a separate page of the site must show
   that page, not the app: privacy.html (linked from the Google Play listing and from Android's
   Health Connect screen, often opened in the same browser) and design-concepts/. Opening the app
   itself still works offline from the cache. */
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT || 8124);
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-sw-pages');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, info) => { if (ok) pass++; else fail++; console.log((ok ? '  PASS ' : '  FAIL ') + n + (!ok && info !== undefined ? '  -> ' + JSON.stringify(info) : '')); };

(async () => {
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('swpages-' + Date.now().toString(36), 10095, path.join(WORK, 'profiles'));
  try {
    const p = await b.launch();
    await p.navigate(BASE);
    await waitFor(() => p.eval(`!!(navigator.serviceWorker && navigator.serviceWorker.controller)`), 30000, 'service worker controls the page')
      .catch(async () => { await p.navigate(BASE); await waitFor(() => p.eval(`!!navigator.serviceWorker.controller`), 30000, 'controller after reload'); });
    check('the app installed its service worker', await p.eval(`!!navigator.serviceWorker.controller`));

    await p.navigate(BASE + 'privacy.html', { noReady: true }); await wait(500);
    const priv = await p.eval(`({ contact: !!document.getElementById('contact-en'), app: !!document.getElementById('bento-grid'), title: document.title })`);
    check('privacy.html shows the privacy policy, not the app', priv.contact && !priv.app, priv);

    await p.navigate(BASE + 'design-concepts/index.html', { noReady: true }); await wait(500);
    check('design-concepts/ is not answered with the app', !(await p.eval(`!!document.getElementById('bento-grid')`)));

    await p.c.send('Network.enable');
    await p.c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await p.navigate(BASE, { noReady: true });
    await waitFor(() => p.eval(`!!document.getElementById('bento-grid')`), 20000, 'app offline').catch(() => {});
    check('offline: opening the app still works from the cache', await p.eval(`!!document.getElementById('bento-grid')`));
    await p.navigate(BASE + 'some/deep/link', { noReady: true });
    await waitFor(() => p.eval(`!!document.getElementById('bento-grid')`), 20000, 'deep link offline').catch(() => {});
    check('offline: any other address inside the app still opens the app', await p.eval(`!!document.getElementById('bento-grid')`));
    check('no page errors', p.errors.length === 0, p.errors.slice(0, 3));
  } catch (e) {
    check('no exception', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
    console.log(`\n==== checks: ${pass} passed, ${fail} failed ====`);
    process.exit(fail ? 1 : 0);
  }
})();
