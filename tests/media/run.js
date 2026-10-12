/* GymQuest demonstrations: media cache, gallery, codecs and offline behaviour in real headless Chrome.
   No accounts, no network outside 127.0.0.1. Usage:
     node tests/media/run.js                 # all scenarios
     node tests/media/run.js "gallery"       # regex filter on scenario names */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-media-work');
const PROFILES = path.join(WORK, 'profiles');
const PORT = 8126;
const BASE = 'http://localhost:' + PORT + '/';
const GONE = path.join(WORK, 'no-such-dir');
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextPort = 9810;
const browsers = [];
const checks = [];
const scenarios = [];

function check(name, cond, detail) {
  checks.push({ name, ok: !!cond, detail: cond ? undefined : detail });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (cond || detail === undefined ? '' : '  -> ' + String(JSON.stringify(detail)).slice(0, 600)));
  return !!cond;
}
function scenario(name, fn) { scenarios.push({ name, fn }); }

/* A copy of the app as it would be deployed (no tests/tools/docs), optionally with a different cache version. */
function makeBuild(name, versionSuffix) {
  const dir = path.join(WORK, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execSync("git ls-files -co --exclude-standard | grep -v -E '^(tests|supabase|docs|tools)/' | tar -cf - -T - | tar -xf - -C " + JSON.stringify(dir),
    { cwd: REPO, shell: '/bin/bash' });
  if (versionSuffix) {
    const f = path.join(dir, 'sw.js');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/const CACHE_VERSION = '([^']+)';/, "const CACHE_VERSION = '$1" + versionSuffix + "';"));
  }
  return dir;
}
function makeBuildFromCommit(name, commit) {
  const dir = path.join(WORK, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execSync('git archive ' + commit + ' | tar -x -C ' + JSON.stringify(dir), { cwd: REPO, shell: '/bin/bash' });
  return dir;
}
async function freshPage(name) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  return { b, p };
}
/* Install the app, then load it a second time so the service worker controls the page (a returning visit). */
async function openApp(p) {
  await p.navigate(BASE, { noReady: true });
  await waitFor(() => p.eval('!!navigator.serviceWorker.controller'), 30000, 'service worker control');
  await p.navigate(BASE, { noReady: true });
  await waitFor(() => p.eval("document.readyState === 'complete' && typeof openExerciseSheet === 'function'"), 30000, 'app ready');
  await p.eval("(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()");
}
const mediaEntrySize = (p, rel) => p.eval(`caches.open('gymquest-media').then((c) => c.match(new URL(${JSON.stringify(rel)}, location.href).href)).then(async (r) => r ? (await r.arrayBuffer()).byteLength : -1)`);
const fetchInfo = (p, rel, range) => p.eval(`fetch(${JSON.stringify(rel)}${range ? `, { headers: { Range: ${JSON.stringify(range)} } }` : ''})
  .then(async (r) => ({ s: r.status, cr: r.headers.get('Content-Range'), n: (await r.arrayBuffer()).byteLength }))
  .catch((e) => ({ s: -1, err: String(e) }))`);

/* ---------- scenarios ---------- */

scenario('sw media cache', async () => {
  const a = makeBuild('build-a', '');
  const bdir = makeBuild('build-b', '-next');
  const srv = await startServer(PORT, { a, b: bdir, gone: GONE });
  srv.setRoot('a');
  try {
    const { p } = await freshPage('swmedia');
    await openApp(p);
    const f = 'media/squats-poster.jpg';
    const size = fs.statSync(path.join(a, f)).size;
    const r1 = await fetchInfo(p, f);
    check('first fetch of a media file returns the whole file', r1.s === 200 && r1.n === size, { r1, size });
    check('stored in gymquest-media with the full size', (await mediaEntrySize(p, f)) === size);
    const rg = await fetchInfo(p, f, 'bytes=10-109');
    check('ranged request answered 206 with the right slice', rg.s === 206 && rg.n === 100 && rg.cr === 'bytes 10-109/' + size, rg);
    const tail = await fetchInfo(p, f, 'bytes=-50');
    check('suffix range (last 50 bytes) answered 206', tail.s === 206 && tail.n === 50 && tail.cr === 'bytes ' + (size - 50) + '-' + (size - 1) + '/' + size, tail);
    const bad = await fetchInfo(p, f, 'bytes=999999999-');
    check('range beyond the file answered 416', bad.s === 416, bad);
    const v = 'media/lunges.webm';
    const vsize = fs.statSync(path.join(a, v)).size;
    const ur = await fetchInfo(p, v, 'bytes=0-1');
    check('uncached ranged request: 206 slice, whole file stored', ur.s === 206 && ur.n === 2 && (await mediaEntrySize(p, v)) === vsize, { ur, vsize });
    const miss = await fetchInfo(p, 'media/no-such-file.jpg');
    check('a missing media file returns 404 and is not cached', miss.s === 404 && (await mediaEntrySize(p, 'media/no-such-file.jpg')) === -1, miss);
    srv.setRoot('gone');
    const off = await fetchInfo(p, f);
    check('cached media is served when the server cannot deliver it', off.s === 200 && off.n === size, off);
    srv.setRoot('b');
    srv.requests.length = 0;
    await p.eval('navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)');
    await waitFor(() => p.eval('navigator.serviceWorker.getRegistration().then((r) => !!r.waiting)'), 60000, 'new worker installed');
    await p.eval("navigator.serviceWorker.getRegistration().then((r) => { r.waiting.postMessage({ type: 'SKIP_WAITING' }); return true; })");
    await waitFor(() => p.eval("caches.keys().then((k) => k.some((n) => /-next$/.test(n)) && k.filter((n) => /^gymquest-v/.test(n)).length === 1)"), 60000, 'new version active');
    await sleep(1500);   // the app reloads itself after controllerchange
    await waitFor(() => p.eval("document.readyState === 'complete'"), 30000, 'reloaded');
    check('media cache survives the update', (await mediaEntrySize(p, f)) === size);
    const mediaHits = srv.requests.filter((x) => x.indexOf('/media/') >= 0);
    check('the update did not download any media', mediaHits.length === 0, mediaHits);
  } finally { await srv.close(); }
});

scenario('migration from v52', async () => {
  const old = makeBuildFromCommit('build-v52', '7d56ce0');   // v52: media precached in gymquest-v52
  const cur = makeBuild('build-cur', '-next');   // a different cache version, as a real release has
  const srv = await startServer(PORT, { old, cur });
  srv.setRoot('old');
  try {
    const { p } = await freshPage('migrate');
    await openApp(p);
    check('v52 installed with media in its versioned cache', await p.eval("caches.open('gymquest-v52').then((c) => c.match(new URL('media/bench-press.webm', location.href).href)).then((r) => !!r)"));
    srv.setRoot('cur');
    srv.requests.length = 0;
    await p.eval('navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)');
    await waitFor(() => p.eval('navigator.serviceWorker.getRegistration().then((r) => !!r.waiting)'), 60000, 'new worker installed');
    await p.eval("navigator.serviceWorker.getRegistration().then((r) => { r.waiting.postMessage({ type: 'SKIP_WAITING' }); return true; })");
    await waitFor(() => p.eval("caches.keys().then((k) => !k.includes('gymquest-v52') && k.includes('gymquest-media'))"), 60000, 'migrated');
    await sleep(1500);
    await waitFor(() => p.eval("document.readyState === 'complete'"), 30000, 'reloaded');
    const size = fs.statSync(path.join(old, 'media/bench-press.webm')).size;
    check('media from v52 moved into gymquest-media', (await mediaEntrySize(p, 'media/bench-press.webm')) === size);
    const mediaHits = srv.requests.filter((x) => x.indexOf('/media/') >= 0);
    check('updating from v52 downloaded no media', mediaHits.length === 0, mediaHits);
  } finally { await srv.close(); }
});

/* ---------- runner ---------- */
(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  for (const sc of scenarios) {
    if (filter && !filter.test(sc.name)) continue;
    console.log('\n== ' + sc.name);
    try { await sc.fn(); } catch (e) { check('scenario error: ' + sc.name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    while (browsers.length) { const b = browsers.pop(); try { await b.closeGraceful(); } catch (e) { b.killHard(true); } }
  }
  const pass = checks.filter((c) => c.ok).length, fail = checks.length - pass;
  fs.writeFileSync(path.join(WORK, 'media-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, checks }, null, 2));
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
