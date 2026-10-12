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

/* Opens every library exercise and checks each gallery item really loads, with one credit per item. */
async function checkExerciseGallery(p, id) {
  return p.eval(`(async () => {
    const id = ${JSON.stringify(id)};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const list = exerciseMediaList(libraryEntry(id));
    openExerciseSheet(id);
    await wait(250);
    const slides = Array.from(document.querySelectorAll('#media-track .media-slide'));
    const items = [];
    for (let i = 0; i < slides.length; i++) {
      goToMedia(i, false);
      const s = slides[i];
      const end = Date.now() + 20000;
      const img = s.querySelector('img'), vid = s.querySelector('video');
      if (vid) { vid.muted = true; vid.play().catch(() => {}); }
      while (Date.now() < end && !s.querySelector('.media-missing')
        && !(img && img.complete && img.naturalWidth > 0) && !(vid && vid.readyState >= 2)) await wait(100);
      if (vid) vid.pause();
      items.push({ kind: vid ? 'video' : (img ? 'img' : 'other'), ok: !s.querySelector('.media-missing') && ((img && img.naturalWidth > 0) || (vid && vid.readyState >= 2)) });
    }
    const none = !!document.querySelector('#modal-exercise .media-none');
    closeExerciseSheet();
    return { list: list.length, credits: list.filter((f) => f.credit && f.credit.creator && f.credit.license).length,
      firstIsVideo: list.length ? !!list[0].video : null, hasVideo: list.some((f) => f.video), slides: slides.length, items, none };
  })()`, 120000);
}

scenario('gallery', async () => {
  const a = makeBuild('build-gallery', '');
  const srv = await startServer(PORT, { a });
  srv.setRoot('a');
  try {
    const { p } = await freshPage('gallery');
    await openApp(p);
    const ids = await p.eval('EXERCISE_LIBRARY.map((e) => e.id)');
    for (const id of ids) {
      const g = await checkExerciseGallery(p, id);
      if (g.list === 0) { check(id + ': no media → only the media.none line', g.none && g.slides === 0, g); continue; }
      check(id + ': one slide per item, every item loads', g.slides === g.list && g.items.every((x) => x.ok), g);
      check(id + ': one credit (creator + licence) per item', g.credits === g.list, g);
      if (g.hasVideo) check(id + ': the video comes first', g.firstIsVideo === true, g);
    }
    check('no page exceptions', p.errors.length === 0, p.errors);
    check('no missing-translation warnings', !p.console.some((c) => /chýbajúce preklady/.test(c)), p.console.filter((c) => /chýbajúce/.test(c)));
  } finally { await srv.close(); }
});

scenario('offline first view', async () => {
  const a = makeBuild('build-offline', '');
  const srv = await startServer(PORT, { a, gone: GONE });
  srv.setRoot('a');
  try {
    const { p } = await freshPage('offline');
    await openApp(p);
    const seen = await checkExerciseGallery(p, 'bench-press');   // viewed once while online → stored
    check('bench-press video loads online', seen.items.length > 0 && seen.items[0].ok, seen);
    srv.setRoot('gone');
    await p.offline(true);
    const again = await checkExerciseGallery(p, 'bench-press');
    check('a demonstration viewed once plays offline', again.items[0] && again.items[0].ok, again);
    const fresh = await p.eval(`(async () => {
      openExerciseSheet('squats');
      const end = Date.now() + 20000;
      while (Date.now() < end && !document.querySelector('#media-track .media-offline')) await new Promise((r) => setTimeout(r, 100));
      const el = document.querySelector('#media-track .media-offline');
      const out = { shown: !!el, text: el ? el.textContent : null, expected: t('media.offlineFirst') };
      closeExerciseSheet();
      return out;
    })()`, 60000);
    check('never-viewed demonstration offline shows media.offlineFirst', fresh.shown && fresh.text.indexOf(fresh.expected) >= 0, fresh);
    await p.offline(false);
  } finally { await srv.close(); }
});

scenario('codecs', async () => {
  const a = makeBuild('build-codecs', '');
  const srv = await startServer(PORT, { a });
  srv.setRoot('a');
  try {
    const { p } = await freshPage('codecs');
    await openApp(p);
    const videos = await p.eval('Object.entries(EXERCISE_VIDEO_MEDIA).map(([id, v]) => ({ id, webm: v.src, mp4: v.mp4 || "" }))');
    const plays = (src, type) => p.eval(`(async () => {
      const v = document.createElement('video'); v.muted = true; v.preload = 'auto';
      const s = document.createElement('source'); s.src = ${JSON.stringify(src)}; s.type = ${JSON.stringify(type)}; v.appendChild(s);
      document.body.appendChild(v);
      const end = Date.now() + 30000;
      while (v.readyState < 2 && !v.error && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
      const ok = v.readyState >= 2; v.remove(); return ok;
    })()`, 60000);
    for (const v of videos) {
      check(v.id + ': WebM plays', await plays(v.webm, 'video/webm'));
      check(v.id + ': has an MP4 copy', !!v.mp4, v);
      if (v.mp4) check(v.id + ': MP4 plays', await plays(v.mp4, 'video/mp4'));
      if (v.mp4) check(v.id + ': MP4 <= 4 MB', fs.statSync(path.join(a, v.mp4)).size <= 4194304);
    }
  } finally { await srv.close(); }
});

scenario('batch 1', async () => {
  const a = makeBuild('build-batch1', '');
  const srv = await startServer(PORT, { a });
  srv.setRoot('a');
  try {
    const { p } = await freshPage('batch1');
    await openApp(p);
    const names = await p.eval(`(() => { const out = {}; for (const l of ['en', 'sk', 'ar']) { setLang(l); out[l] = t('exercise.single-arm-dumbbell-triceps-extension'); } setLang('en'); return out; })()`);
    check('renamed to "Dumbbell triceps extension" (owner, 2026-10-12)', names.en === 'Dumbbell triceps extension', names);
    check('renamed in Slovak and Arabic too', names.sk === 'Tricepsová extenzia s jednoručkou' && names.ar === 'تمرين الترايسبس بالدمبل', names);
    const g = await checkExerciseGallery(p, 'single-arm-dumbbell-triceps-extension');
    check('dumbbell triceps extension: video loads and is credited', g.list === 1 && g.firstIsVideo && g.items.length === 1 && g.items[0].ok && g.credits === 1, g);
  } finally { await srv.close(); }
});

scenario('batch 2+3', async () => {
  /* Owner approved all 19 videos on 2026-10-12: the video is the first (main) demonstration; existing photos stay after it. */
  const approved = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/media/batches/batch-23.json'), 'utf8'))
    .exercises.filter((e) => e.decision && e.decision.use === 0).map((e) => e.id);
  check('19 approved exercises in batch-23.json', approved.length === 19, approved);
  const a = makeBuild('build-batch23', '');
  const srv = await startServer(PORT, { a });
  srv.setRoot('a');
  try {
    const { p } = await freshPage('batch23');
    await openApp(p);
    for (const id of approved) {
      const g = await checkExerciseGallery(p, id);
      check(id + ': video is the main demonstration, plays, every item credited', g.firstIsVideo === true && g.items.length === g.list && g.items.every((x) => x.ok) && g.credits === g.list, g);
    }
  } finally { await srv.close(); }
});

/* Review I1 (2026-10-12): when the media cache cannot store a file (full storage / eviction), ranged
   requests must go to the network as ranges instead of downloading the whole file every time. */
scenario('media cache full', async () => {
  const a = makeBuild('build-full', '');
  const srv = await startServer(PORT, { a });
  srv.setRoot('a');
  try {
    const { b, p } = await freshPage('cachefull');
    await openApp(p);
    const list = await (await fetch('http://127.0.0.1:' + b.port + '/json/list')).json();
    const sw = list.find((t) => t.type === 'service_worker');
    const { cdpConnect } = require('../sync/lib');
    const c = await cdpConnect(sw.webSocketDebuggerUrl);
    await c.send('Runtime.evaluate', { expression: `Cache.prototype.put = function () { return Promise.reject(new DOMException('full', 'QuotaExceededError')); }; true` });
    c.close();
    const v = 'media/lunges.webm';
    const size = fs.statSync(path.join(a, v)).size;
    srv.sent.length = 0;
    const r1 = await fetchInfo(p, v, 'bytes=0-1');
    const r2 = await fetchInfo(p, v, 'bytes=1000-1999');
    const r3 = await fetchInfo(p, v, 'bytes=5000-5999');
    const got = srv.sent.filter((x) => x.path === '/' + v);
    const total = got.reduce((n, x) => n + x.bytes, 0);
    check('ranged requests still answered 206 with the right slices', r1.s === 206 && r1.n === 2 && r2.s === 206 && r2.n === 1000 && r3.s === 206 && r3.n === 1000, { r1, r2, r3 });
    check('after a failed store, later ranges are not whole-file downloads (at most one full download)', got.filter((x) => !x.range).length <= 1 && total <= size + 4000, { got, size });
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
