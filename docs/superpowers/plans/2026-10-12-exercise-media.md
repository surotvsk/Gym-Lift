# Exercise library demonstrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every built-in library exercise shows a real, licensed, owner-approved demonstration. That means a video in WebM + MP4, or a 2–3 photo sequence of one person. Each demonstration downloads on first view, works offline afterwards and is never re-downloaded by app updates.

**Architecture:** The service worker gets a second, long-lived cache (`gymquest-media`) for `media/*`. It is filled on first view, answers `Range` requests with `206`, and is seeded from old versioned caches on update. The app renders videos with WebM + MP4 `<source>`s and shows the video before any photos. It shows a localized "connect once" message when a never-loaded item fails offline. A shell script produces every media file the same way, and a Commons search script plus a review-page builder support sourcing in owner-approved batches.

**Tech Stack:** Vanilla JS (no build), service worker Cache API, `ffmpeg` (libvpx-vp9, libopenh264), ImageMagick `magick`. Tests are Node scripts that drive headless Google Chrome over CDP (`tests/sync/lib.js`).

**Spec:** `docs/superpowers/specs/2026-10-12-exercise-media-design.md`

## Global Constraints

- Preference order per exercise: real video → 2–3 photo sequence of the **same person**, same variation, in movement order, captioned, with "Image 1 of 3" → existing `media.none` message. No drawn, schematic or AI-generated media.
- Every candidate shows the **exact** named exercise and equipment variation. It is checked visually from extracted frames and **approved by the owner** before use.
- Allowed licences: public domain / CC0, CC BY, CC BY-SA, Pexels licence, Pixabay licence. Creator, licence, licence URL and source page go in `MEDIA_CREDITS` and `media/CREDITS.md`.
- Video: one clean repetition (about 4–10 s), max 480 px high, 30 fps, no audio, WebM (VP9) + MP4 (H.264, `+faststart`), target about 2 MB per file, **hard cap 4 MB**, poster JPEG max 960 px wide.
- Photos: JPEG, longest side max 1200 px, all metadata stripped.
- Naming `media/<exercise-id>[-n].{webm,mp4,jpg}`. A file is never changed in place; a replacement gets a new name (`-v2`).
- Originals are downloaded outside the repository; only processed files are committed.
- Every user-visible string exists in all 6 languages (`sk`, `en`, `es`, `pt-BR`, `fr`, `ar`). Arabic wraps Latin runs in `⁦…⁩`.
- Every release bumps `CACHE_VERSION` in `sw.js` **and** the `?v=` numbers in `index.html` and `sw.js` `PRECACHE`. Do this as the last step before the release commit.
- Code comments in `script.js` / `sw.js` are in Slovak, matching the surrounding code.
- Commit locally after each task. **Push only when the owner says so.**

## Review Focus

1. **iPhone asks for a byte range of a video that is not cached yet.** Expected: the service worker fetches the whole file, stores it and answers `206` with the requested slice. Pinned in Task 1 ("uncached ranged request").
2. **A media URL that 404s** (typo, file not deployed). Expected: the 404 reaches the page (unavailable state) and is **never** stored, so a later deploy of that file works. Pinned in Task 1.
3. **Existing users updating from v52.** Expected: media already downloaded is moved into `gymquest-media`, and the update makes no `media/` requests. Pinned in Task 1 ("migration from v52").
4. **Offline, exercise never opened.** Expected: "Connect to the internet once to load this demonstration." instead of the generic unavailable text. An exercise opened before still plays offline. Pinned in Task 3.
5. **Exercise with a video and photos.** Expected: the credit under each item belongs to that item (credits array order = frames order), and no item lacks a credit. Pinned in Task 3 ("gallery") for every exercise.

---

## File Structure

| File | Responsibility |
|---|---|
| `sw.js` (modify) | `gymquest-media` cache: cache-first media, Range → 206, migration, media removed from `PRECACHE` |
| `script.js` (modify) | `framesForExercise` (video then photos), video `<source>`s, `mediaFailNode` / `mediaOfflineNode`, `media.offlineFirst` i18n, `EXERCISE_VIDEO_MEDIA[].mp4`, new entries per batch, `MEDIA_CREDITS` |
| `tests/sync/lib.js` (modify) | `startServer` records requested paths (`srv.requests`) and serves `.mp4` as `video/mp4` |
| `tests/media/run.js` (create) | Headless suite: scenarios `sw media cache`, `migration from v52`, `gallery`, `codecs`, `offline first view` |
| `tests/media/process-test.sh` (create) | Checks `tools/media/process.sh` outputs |
| `tests/media/README.md` (create) | How to run the media tests |
| `tools/media/process.sh` (create) | `video` / `mp4` / `photo` / `frames` processing |
| `tools/media/commons.js` (create) | Searches Wikimedia Commons and prints candidates with licence metadata |
| `tools/media/review.js` (create) | Builds the private review page (frames as data URIs) from a batch file |
| `tools/media/batches/batch-N.json` (create per batch) | Provenance: source, licence, trim, owner decision per exercise |
| `media/*` (add) | Processed files |
| `media/CREDITS.md`, `README.md` (modify) | Credits and the user-facing "Demonstrations" text |

---

## Task 1: Long-lived media cache in the service worker

**Files:**
- Modify: `tests/sync/lib.js` (function `startServer`, `TYPES`)
- Create: `tests/media/run.js`, `tests/media/README.md`
- Modify: `sw.js` (whole file outside `PRECACHE`; remove `media/*` from `PRECACHE`)

**Interfaces:**
- Produces: cache name `'gymquest-media'`; cache key = `origin + pathname` (no query); `srv.requests: string[]` (decoded request paths) from `startServer`; test helpers `makeBuild(name, versionSuffix)`, `makeBuildFromCommit(name, commit)`, `freshPage(name)`, `openApp(p)`, `check(name, cond, detail)`, `scenario(name, fn)` in `tests/media/run.js`.

- [ ] **Step 1: Let the test server record requests and serve MP4**

In `tests/sync/lib.js` add `'.mp4': 'video/mp4'` to `TYPES`, and record every path in `startServer`:

```js
function startServer(port, roots) {
  let current = 'new';
  const requests = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(u.pathname);
    requests.push(p);
    // … the rest of the handler stays exactly as it is …
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({
    requests,
    setRoot(r) { current = r; }, root() { return current; }, close() { return new Promise((r) => srv.close(r)); },
  })));
}
```

- [ ] **Step 2: Write the test harness and the failing service-worker scenarios**

Create `tests/media/run.js`:

```js
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
  const cur = makeBuild('build-cur', '');
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
```

Create `tests/media/README.md`:

````markdown
# Demonstration media tests

Real headless Google Chrome over the DevTools protocol (helpers from `tests/sync/lib.js`), a local
static server on port 8126, and copies of the app built from the working tree. No accounts and no
network beyond `127.0.0.1`.

```bash
node tests/media/run.js                 # all scenarios
node tests/media/run.js "gallery"       # one scenario (regex)
bash tests/media/process-test.sh        # tools/media/process.sh output checks
```

Results: `$GQ_WORK/media-results.json` (default `/tmp/gq-media-work`). The suite uses Google Chrome
(not Chromium) because it needs H.264 for the MP4 checks.
````

- [ ] **Step 3: Run the scenarios and confirm they fail**

Run: `node tests/media/run.js "sw media cache|migration"`
Expected: FAIL. With the current `sw.js`, `stored in gymquest-media …` fails (`-1`), the ranged request returns the full file, and the migration check fails.

- [ ] **Step 4: Implement the media cache in `sw.js`**

1. Delete every `'media/…'` line from `PRECACHE` (keep `index.html`, the `?v=` assets, `manifest.json` and the icons).
2. After `const CACHE_NAME = …` add:

```js
/* Ukážky cvikov (media/*) žijú v samostatnej, dlhodobej cache: stiahnu sa pri prvom
   zobrazení a aktualizácia appky ich nikdy nesťahuje znova. Súbor sa nikdy nemení
   na mieste – nová verzia ukážky dostane nový názov (-v2). */
const MEDIA_CACHE = CACHE_PREFIX + 'media';
function isMediaUrl(url) {
  return url.origin === self.location.origin && /\/media\/[^/]+\.(webm|mp4|jpe?g|png|webp)$/i.test(url.pathname);
}
const mediaKey = (url) => url.origin + url.pathname;
```

3. Replace the `activate` listener with:

```js
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const stale = names.filter((name) => name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME && name !== MEDIA_CACHE);
    // Migrácia: ukážky zo starších verzií sa presunú do dlhodobej cache, aby sa nesťahovali znova.
    try {
      const media = await caches.open(MEDIA_CACHE);
      for (const name of stale) {
        const old = await caches.open(name);
        for (const req of await old.keys()) {
          const url = new URL(req.url);
          if (!isMediaUrl(url) || await media.match(mediaKey(url))) continue;
          const res = await old.match(req);
          if (res && res.status === 200) await media.put(mediaKey(url), res);
        }
      }
    } catch (e) { /* migrácia je len úspora dát – pri chybe sa ukážky stiahnu pri ďalšom zobrazení */ }
    // Zmažú sa len staršie cache s naším prefixom (nikdy cache ukážok), nikdy nie všetko na doméne.
    await Promise.all(stale.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});
```

4. In the `fetch` listener, directly after the navigation block and **before** `if (!isPrecached(url.href)) return;`, add:

```js
  // Ukážky cvikov: dlhodobá cache, pri prvom zobrazení zo siete; Range (Safari) → 206.
  if (isMediaUrl(url)) {
    event.respondWith(serveMedia(request, url));
    return;
  }
```

5. Add below `serveFromCacheThenNetwork`:

```js
async function serveMedia(request, url) {
  const key = mediaKey(url);
  let res = null;
  try {
    const cache = await caches.open(MEDIA_CACHE);
    res = await cache.match(key);
    if (!res) {
      // Vždy celý súbor (bez Range), aby sa do cache nikdy neuložil len kúsok.
      const net = await fetch(key, { cache: 'no-store' });
      if (net.status !== 200) return net;            // 404 a pod. sa neukladá
      try { await cache.put(key, net.clone()); } catch (e) { /* plná kvóta: ukážka sa len neuloží */ }
      res = net;
    }
  } catch (e) {
    return Response.error();                         // offline a ešte nestiahnuté
  }
  const range = request.headers.get('range');
  return range ? rangeResponse(res, range) : res;
}

/* Safari načítava video po kúskoch (Range) a celú odpoveď 200 neprehrá. */
async function rangeResponse(res, header) {
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  let start = -1, end = -1;
  if (m && m[1] !== '') {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  } else if (m && m[2] !== '') {
    start = Math.max(0, size - Number(m[2]));        // posledných N bajtov
    end = size - 1;
  }
  if (start < 0 || start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
```

- [ ] **Step 5: Run the scenarios and confirm they pass**

Run: `node --check sw.js && node tests/media/run.js "sw media cache|migration"`
Expected: all PASS, `0 failed`.

- [ ] **Step 6: Run the existing smoke check of the sync suite (lib.js changed)**

Run: `node -e "require('./tests/sync/lib.js')" && node --check tests/sync/run.js tests/sync/live-verify.js`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add sw.js tests/sync/lib.js tests/media/run.js tests/media/README.md
git commit -m "Media: long-lived gymquest-media cache with Range support and migration"
```

---

## Task 2: Media processing script

**Files:**
- Create: `tools/media/process.sh`
- Test: `tests/media/process-test.sh`

**Interfaces:**
- Produces: `tools/media/process.sh video <input> <id> <start-s> <end-s> [poster-s]` → `<id>.webm`, `<id>.mp4`, `<id>-poster.jpg`; `… mp4 <input> <id>` → `<id>.mp4`; `… photo <input> <name>` → `<name>.jpg`; `… frames <input> <out-dir> [start end]` → `frame-1.jpg … frame-6.jpg`. Output dir is `$GQ_MEDIA_OUT` (default `media/`). The script exits non-zero if any file is over 4 MB.

- [ ] **Step 1: Write the failing test**

Create `tests/media/process-test.sh`:

```bash
#!/usr/bin/env bash
# Checks tools/media/process.sh: codecs, size cap, no audio, max 480 px, faststart MP4, stripped photos.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
T="$REPO/tools/media/process.sh"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
fail=0
ok() { echo "  PASS $1"; }
no() { echo "  FAIL $1"; fail=1; }
probe() { ffprobe -v error -select_streams "$2" -show_entries "$3" -of csv=p=0 "$1" | head -1; }

GQ_MEDIA_OUT="$OUT" bash "$T" video "$REPO/media/lunges.webm" t-lunge 2 8 >/dev/null
[ "$(probe "$OUT/t-lunge.webm" v:0 stream=codec_name)" = vp9 ] && ok "webm is VP9" || no "webm is VP9"
[ "$(probe "$OUT/t-lunge.mp4" v:0 stream=codec_name)" = h264 ] && ok "mp4 is H.264" || no "mp4 is H.264"
for f in t-lunge.webm t-lunge.mp4; do
  [ -z "$(probe "$OUT/$f" a stream=codec_name)" ] && ok "$f has no audio" || no "$f has no audio"
  h=$(probe "$OUT/$f" v:0 stream=height); [ "$h" -le 480 ] && ok "$f height $h <= 480" || no "$f height $h <= 480"
  s=$(stat -c %s "$OUT/$f"); [ "$s" -le 4194304 ] && ok "$f $s bytes <= 4 MB" || no "$f $s bytes <= 4 MB"
done
python3 - "$OUT/t-lunge.mp4" <<'EOF' && ok "mp4 has moov before mdat (faststart)" || no "mp4 has moov before mdat (faststart)"
import sys; b = open(sys.argv[1], 'rb').read(); sys.exit(0 if 0 <= b.find(b'moov') < b.find(b'mdat') else 1)
EOF
[ -s "$OUT/t-lunge-poster.jpg" ] && ok "poster written" || no "poster written"

GQ_MEDIA_OUT="$OUT" bash "$T" mp4 "$REPO/media/incline-dumbbell-press.webm" t-long >/dev/null
s=$(stat -c %s "$OUT/t-long.mp4"); [ "$s" -le 4194304 ] && ok "94 s clip MP4 fits the cap ($s bytes)" || no "94 s clip MP4 fits the cap ($s bytes)"

magick -size 3000x2000 xc:gray -set comment "camera data" "$OUT/in.jpg"
GQ_MEDIA_OUT="$OUT" bash "$T" photo "$OUT/in.jpg" t-photo >/dev/null
dims=$(magick identify -format '%w %h' "$OUT/t-photo.jpg"); [ "$dims" = "1200 800" ] && ok "photo resized to 1200x800" || no "photo resized ($dims)"
[ -z "$(magick identify -format '%c' "$OUT/t-photo.jpg")" ] && ok "photo metadata stripped" || no "photo metadata stripped"

bash "$T" frames "$REPO/media/lunges.webm" "$OUT/frames" 2 8 >/dev/null
[ "$(ls "$OUT/frames" | grep -c '^frame-[1-6]\.jpg$')" = 6 ] && ok "6 review frames" || no "6 review frames"

if bash "$T" bogus 2>/dev/null; then no "unknown command rejected"; else ok "unknown command rejected"; fi
exit $fail
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bash tests/media/process-test.sh`
Expected: FAIL (script `tools/media/process.sh` does not exist; `bash: …process.sh: No such file`).

- [ ] **Step 3: Write `tools/media/process.sh`**

```bash
#!/usr/bin/env bash
# GymQuest demonstration media: every file is produced the same way.
#   process.sh video  <input> <exercise-id> <start-s> <end-s> [poster-s]  -> <id>.webm, <id>.mp4, <id>-poster.jpg
#   process.sh mp4    <input> <exercise-id>                              -> <id>.mp4 (MP4 copy of an existing video)
#   process.sh photo  <input> <name>                                     -> <name>.jpg (max 1200 px, no metadata)
#   process.sh frames <input> <out-dir> [start-s end-s]                  -> frame-1.jpg … frame-6.jpg (for review)
# Output goes to $GQ_MEDIA_OUT (default: the repository's media/ folder). Fails if a file exceeds 4 MB.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${GQ_MEDIA_OUT:-$HERE/../../media}"
MAX_BYTES=4194304
SCALE="scale=-2:trunc(min(480\,ih)/2)*2,fps=30"

die() { echo "process.sh: $*" >&2; exit 1; }
check_size() {
  local n; n=$(stat -c %s "$1")
  [ "$n" -le "$MAX_BYTES" ] || die "$1 is $n bytes (limit $MAX_BYTES)"
  echo "$1 $n bytes"
}
duration() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
# MP4 bitrate in kbit/s: at most 900, lower for long clips so the file stays under ~3.6 MB.
mp4_kbps() { awk -v d="$1" 'BEGIN { k = int(3.6 * 8 * 1024 / (d > 0 ? d : 1)); print (k > 900 ? 900 : (k < 150 ? 150 : k)) }'; }

enc_webm() {   # <out> <ffmpeg input args…>
  local out="$1"; shift
  ffmpeg -nostdin -v error -y "$@" -an -vf "$SCALE" -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p "$out"
  check_size "$out"
}
enc_mp4() {    # <out> <kbps> <ffmpeg input args…>
  local out="$1" kbps="$2"; shift 2
  ffmpeg -nostdin -v error -y "$@" -an -vf "$SCALE" -c:v libopenh264 -b:v "${kbps}k" -pix_fmt yuv420p -movflags +faststart "$out"
  check_size "$out"
}

case "${1:-}" in
  video)
    [ $# -ge 5 ] || die "usage: video <input> <id> <start-s> <end-s> [poster-s]"
    in="$2"; id="$3"; s="$4"; e="$5"
    ps="${6:-$(awk -v a="$s" -v b="$e" 'BEGIN { print (a + b) / 2 }')}"
    mkdir -p "$OUT"
    enc_webm "$OUT/$id.webm" -ss "$s" -to "$e" -i "$in"
    enc_mp4 "$OUT/$id.mp4" "$(mp4_kbps "$(awk -v a="$s" -v b="$e" 'BEGIN { print b - a }')")" -ss "$s" -to "$e" -i "$in"
    ffmpeg -nostdin -v error -y -ss "$ps" -i "$in" -frames:v 1 -vf "scale=min(960\,iw):-2" -q:v 4 "$OUT/$id-poster.jpg"
    check_size "$OUT/$id-poster.jpg"
    ;;
  mp4)
    [ $# -eq 3 ] || die "usage: mp4 <input> <id>"
    mkdir -p "$OUT"
    enc_mp4 "$OUT/$3.mp4" "$(mp4_kbps "$(duration "$2")")" -i "$2"
    ;;
  photo)
    [ $# -eq 3 ] || die "usage: photo <input> <name>"
    mkdir -p "$OUT"
    magick "$2" -auto-orient -strip -resize '1200x1200>' -quality 82 "$OUT/$3.jpg"
    check_size "$OUT/$3.jpg"
    ;;
  frames)
    [ $# -ge 3 ] || die "usage: frames <input> <out-dir> [start-s end-s]"
    in="$2"; dir="$3"; s="${4:-0}"; e="${5:-$(duration "$2")}"
    mkdir -p "$dir"
    for i in 1 2 3 4 5 6; do
      t=$(awk -v a="$s" -v b="$e" -v i="$i" 'BEGIN { print a + (i - 0.5) * (b - a) / 6 }')
      ffmpeg -nostdin -v error -y -ss "$t" -i "$in" -frames:v 1 -vf "scale=480:-2" -q:v 5 "$dir/frame-$i.jpg"
    done
    echo "$dir: 6 frames"
    ;;
  *)
    die "usage: video | mp4 | photo | frames (see the header of this file)"
    ;;
esac
```

Then `chmod +x tools/media/process.sh tests/media/process-test.sh`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bash tests/media/process-test.sh`
Expected: every line `PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add tools/media/process.sh tests/media/process-test.sh
git commit -m "Media: processing script (WebM + MP4, poster, photos, review frames)"
```

---

## Task 3: Gallery: WebM + MP4 sources, video before photos, offline-first message

**Files:**
- Modify: `script.js`, specifically `framesForExercise` (around line 1350), the video and image branches in `mountMediaGallery` (around line 11709), `mediaMissingNode` (around line 11559), and the I18N blocks (insert after `'media.unavailable'` in each of the 6 languages).
- Modify: `style.css` (the `.media-missing` block): no new rule needed, because `.media-offline` reuses `.media-missing`.
- Test: `tests/media/run.js`, adding scenarios `gallery` and `offline first view`.

**Interfaces:**
- Consumes: `gymquest-media` cache (Task 1).
- Produces: frame object `{ video: true, src, mp4, poster, caption: 'media.video' }`; `EXERCISE_VIDEO_MEDIA[id] = { src, mp4, poster }` (`mp4` optional until Task 4); `mediaFailNode()`; `mediaOfflineNode()`; i18n key `media.offlineFirst`.

- [ ] **Step 1: Add the failing scenarios to `tests/media/run.js`** (insert before the runner)

```js
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
```

- [ ] **Step 2: Run and confirm the failures**

Run: `node tests/media/run.js "gallery|offline first"`
Expected: FAIL on `never-viewed demonstration offline shows media.offlineFirst` (no `.media-offline` element exists yet). The `gallery` checks pass for the current data (they pin today's behaviour before the refactor).

- [ ] **Step 3: Implement in `script.js`**

Replace `framesForExercise` with:

```js
/* Rámy cviku: najprv video (ak je), potom fotografie (ak sú). Bez skutočnej fotky či videa
   vráti null a rozhranie ukáže krátku správu – NIKDY sa nekreslí náhradná schéma.
   Poradie MEDIA_CREDITS[id] musí zodpovedať poradiu týchto rámov. */
function framesForExercise(entry) {
  if (!entry) return null;
  const frames = [];
  const video = EXERCISE_VIDEO_MEDIA[entry.id];
  if (video) frames.push({ video: true, src: video.src, mp4: video.mp4 || '', poster: video.poster, caption: 'media.video' });
  const photos = EXERCISE_PHOTO_MEDIA[entry.id];
  if (photos && photos.length) photos.forEach((p) => frames.push(Object.assign({}, p)));
  return frames.length ? { frames } : null;
}
```

Below `mediaMissingNode` add:

```js
/* Ukážka sa ešte nikdy nestiahla a zariadenie je offline: čestná správa, čo urobiť. */
function mediaOfflineNode() {
  const box = document.createElement('div');
  box.className = 'media-missing media-offline';
  box.innerHTML = '<span class="media-missing-icon" aria-hidden="true">📶</span>'
    + '<strong>' + esc(t('media.offlineFirst')) + '</strong>';
  return box;
}

/* Zlyhanie ukážky: offline → "pripoj sa raz", inak "ukážka nie je k dispozícii". */
function mediaFailNode() {
  return navigator.onLine === false ? mediaOfflineNode() : mediaMissingNode();
}
```

In `mountMediaGallery`, replace the video branch body (from `const video = document.createElement('video');` to `slide.appendChild(frame);`) with:

```js
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-label', mediaAlt(it));
      if (it.poster) video.poster = it.poster;
      const fail = () => { slide.innerHTML = ''; slide.appendChild(mediaFailNode()); };
      video.addEventListener('error', fail);
      /* WebM pre väčšinu prehliadačov, MP4 pre staršie iPhony. Chyba <source> nespustí
         'error' na <video>, preto sa sleduje posledný zdroj. */
      const sources = [[it.src, 'video/webm'], [it.mp4, 'video/mp4']].filter((s) => s[0]);
      sources.forEach((s, i) => {
        const el = document.createElement('source');
        el.src = s[0];
        el.type = s[1];
        if (i === sources.length - 1) el.addEventListener('error', fail);
        video.appendChild(el);
      });
      frame.appendChild(video);
      slide.appendChild(frame);
```

In the image branch replace `slide.appendChild(mediaMissingNode());` with `slide.appendChild(mediaFailNode());`.

Add `media.offlineFirst` after `'media.unavailable'` in each language block:

```js
    'media.offlineFirst': 'Na načítanie tejto ukážky sa raz pripoj na internet.',                    // sk
    'media.offlineFirst': 'Connect to the internet once to load this demonstration.',                 // en
    'media.offlineFirst': 'Conéctate a internet una vez para cargar esta demostración.',              // es
    'media.offlineFirst': 'Conecte-se à internet uma vez para carregar esta demonstração.',           // pt-BR
    'media.offlineFirst': 'Connectez-vous une fois à Internet pour charger cette démonstration.',     // fr
    'media.offlineFirst': 'اتصل بالإنترنت مرة واحدة لتحميل هذا العرض.',                                // ar
```

(Each line goes into its own language's block. Drop the trailing `// lang` comments when inserting.)

- [ ] **Step 4: Run and confirm everything passes**

Run: `node --check script.js && node tests/media/run.js`
Expected: all scenarios PASS, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add script.js tests/media/run.js
git commit -m "Media: WebM + MP4 sources, video before photos, offline first-view message"
```

---

## Task 4: MP4 copies of the 11 existing videos, docs, and release Batch 0

**Files:**
- Add: `media/{bench-press,squats,overhead-press,bent-over-rows,bicep-curls,pull-ups,lunges,superman,machine-chest-press,incline-dumbbell-press,leg-extension}.mp4`
- Modify: `script.js` (`EXERCISE_VIDEO_MEDIA`), `media/CREDITS.md`, `README.md` ("Demonstrations" and "Video format and offline"), `sw.js` + `index.html` (version bump)
- Test: `tests/media/run.js`, adding scenario `codecs`

**Interfaces:**
- Consumes: `tools/media/process.sh mp4` (Task 2), `mp4` field (Task 3).

- [ ] **Step 1: Add the failing `codecs` scenario** (insert before the runner)

```js
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
```

- [ ] **Step 2: Run and confirm it fails**

Run: `node tests/media/run.js "codecs"`
Expected: FAIL. Eleven `has an MP4 copy` checks fail.

- [ ] **Step 3: Produce the MP4 files**

```bash
for id in bench-press squats overhead-press bent-over-rows bicep-curls pull-ups lunges superman machine-chest-press incline-dumbbell-press leg-extension; do
  bash tools/media/process.sh mp4 "media/$id.webm" "$id"
done
```

Expected: 11 lines `…/media/<id>.mp4 <n> bytes`, each `<n> <= 4194304`.

- [ ] **Step 4: Wire them into `EXERCISE_VIDEO_MEDIA`**

Add `mp4: 'media/<id>.mp4'` to each of the 11 entries, e.g.:

```js
  'bench-press': { src: 'media/bench-press.webm', mp4: 'media/bench-press.mp4', poster: 'media/bench-press-poster.jpg' },
```

- [ ] **Step 5: Document**

`media/CREDITS.md`, below the Videos table, add: "Each `*.mp4` is an H.264 copy of the matching `*.webm`, made with `tools/media/process.sh mp4`, and is covered by the same author and licence." Also replace "precached by the app's own service worker" with "cached by the app's own service worker the first time it is shown".

`README.md` → "Video format and offline": replace the paragraph with:

```markdown
**Video format and offline.** Every video comes as **WebM (VP9)** and **MP4 (H.264)**; the browser
picks the one it can play, so older iPhones get the MP4. Demonstrations are **downloaded the first
time you open that exercise** and then kept on the device in their own cache, so they work offline from
then on, and app updates never download them again. Opening an exercise for the first time while offline
shows *Connect to the internet once to load this demonstration.*
```

In "Demonstrations: what is here, and what is not", replace "every file is served from this repository and cached by the service worker" with "every file is served from this repository and kept by the service worker after its first view".

- [ ] **Step 6: Release bump and full run**

Bump `CACHE_VERSION` (`v52` → `v53`) and every `?v=56` → `?v=57` in `sw.js` and `index.html`.
Run: `node --check script.js && node --check sw.js && bash tests/media/process-test.sh && node tests/media/run.js`
Expected: all PASS, `0 failed`.

- [ ] **Step 7: Commit (push only after the owner says so; then the owner opens 3 exercises on the iPhone, plays a video, and reopens one offline)**

```bash
git add media/*.mp4 script.js media/CREDITS.md README.md sw.js index.html tests/media/run.js
git commit -m "Media batch 0: MP4 copies of the 11 videos, on-first-view media cache (v53)"
```

---

## Task 5: Sourcing tools: Commons search and review page

**Files:**
- Create: `tools/media/commons.js`, `tools/media/review.js`, `tools/media/batches/README.md`
- Test: a manual run with a known file (Step 2 / Step 4)

**Interfaces:**
- Produces: `node tools/media/commons.js "<query>" [video|image] [limit]` prints JSON lines `{ title, url, page, mime, width, height, duration, size, license, licenseUrl, artist }`; `node tools/media/review.js <batch.json> <out.html>`; the batch-file schema below.

Batch file schema (`tools/media/batches/batch-N.json`):

```json
{
  "batch": 1,
  "exercises": [
    {
      "id": "romanian-deadlift",
      "candidates": [
        {
          "kind": "video",
          "page": "https://commons.wikimedia.org/wiki/File:…",
          "file": "/tmp/gq-originals/rdl.webm",
          "creator": "…", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
          "trim": { "start": 3.2, "end": 9.8, "poster": 6.0 },
          "framesDir": "/tmp/gq-review/romanian-deadlift-1",
          "note": "barbell, side view, one clean rep"
        }
      ],
      "decision": null
    }
  ]
}
```

`decision` is set from the owner's reply. It is `{ "use": <candidate index>, "approvedOn": "YYYY-MM-DD" }`, or `{ "use": null, "reason": "…" }` when nothing correct was found.

- [ ] **Step 1: Write `tools/media/commons.js`**

```js
/* Searches Wikimedia Commons (File namespace) and prints candidates with licence metadata as JSON lines.
   node tools/media/commons.js "romanian deadlift" video 20 */
'use strict';
const [query, kind = 'video', limit = '20'] = process.argv.slice(2);
if (!query) { console.error('usage: commons.js "<query>" [video|image] [limit]'); process.exit(2); }
const API = 'https://commons.wikimedia.org/w/api.php';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
(async () => {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: String(limit),
    gsrsearch: query + (kind === 'video' ? ' filetype:video' : ' filetype:bitmap'),
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata|mediatype', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
  });
  const r = await fetch(API + '?' + params, { headers: { 'User-Agent': 'GymQuest-media-sourcing/1.0 (https://surotvsk.github.io/Gymquest/)' } });
  const data = await r.json();
  const pages = Object.values((data.query && data.query.pages) || {});
  for (const pg of pages) {
    const ii = (pg.imageinfo || [])[0] || {};
    const md = ii.extmetadata || {};
    console.log(JSON.stringify({
      title: pg.title, url: ii.url, page: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(pg.title.replace(/ /g, '_')),
      mime: ii.mime, width: ii.width, height: ii.height, duration: ii.duration || null, size: ii.size,
      license: md.LicenseShortName ? md.LicenseShortName.value : null, licenseUrl: md.LicenseUrl ? md.LicenseUrl.value : null,
      artist: md.Artist ? strip(md.Artist.value) : null,
    }));
  }
  if (!pages.length) console.error('no results');
})().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 2: Verify it against a file whose licence we know**

Run: `node tools/media/commons.js "Muscle Strengthening at the Gym Leg Extension" video 5`
Expected: a line whose `page` ends in `Muscle_Strengthening_at_the_Gym_-_Leg_Extension.webm` and whose `license` is `Public domain`.

- [ ] **Step 3: Write `tools/media/review.js`**

```js
/* Builds the private review page for one batch: for every exercise and candidate, 6 frames
   (video) or the photos themselves, plus source, licence and the planned trim. Images are
   embedded as data: URIs so the page works as a single published file.
   node tools/media/review.js tools/media/batches/batch-1.json /tmp/gq-review/batch-1.html */
'use strict';
const fs = require('fs');
const path = require('path');
const [batchFile, outFile] = process.argv.slice(2);
if (!batchFile || !outFile) { console.error('usage: review.js <batch.json> <out.html>'); process.exit(2); }
const batch = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataUri = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64');
const imagesFor = (c) => c.kind === 'video'
  ? [1, 2, 3, 4, 5, 6].map((i) => path.join(c.framesDir, 'frame-' + i + '.jpg')).filter((f) => fs.existsSync(f))
  : (c.photos || []).filter((f) => fs.existsSync(f));
const sections = batch.exercises.map((ex) => {
  const cands = ex.candidates.length ? ex.candidates.map((c, n) => `
    <article class="cand">
      <h3>Option ${n + 1} · ${esc(c.kind === 'video' ? 'Video' : (c.photos || []).length + ' photos')}</h3>
      <div class="frames">${imagesFor(c).map((f, i) => `<figure><img src="${dataUri(f)}" alt="${esc(ex.id)} option ${n + 1} frame ${i + 1}"><figcaption>${i + 1}</figcaption></figure>`).join('')}</div>
      <dl>
        <dt>Creator</dt><dd>${esc(c.creator)}</dd>
        <dt>Licence</dt><dd>${esc(c.license)}</dd>
        <dt>Source</dt><dd><a href="${esc(c.page)}">${esc(c.page)}</a></dd>
        ${c.trim ? `<dt>Clip</dt><dd>${esc(c.trim.start)} s – ${esc(c.trim.end)} s</dd>` : ''}
        ${c.note ? `<dt>Note</dt><dd>${esc(c.note)}</dd>` : ''}
      </dl>
    </article>`).join('') : '<p class="none">No correct, legally usable match found. This exercise keeps its current state.</p>';
  return `<section><h2>${esc(ex.id)}</h2>${cands}</section>`;
}).join('');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `<title>GymQuest media review – batch ${esc(batch.batch)}</title>
<style>
:root { --bg: #f6f7f9; --fg: #16181d; --dim: #5b6270; --line: #dde1e7; --card: #fff; --accent: #e8572e; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #14161a; --fg: #eef0f3; --dim: #a3aab6; --line: #2a2e36; --card: #1c1f25; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #14161a; --fg: #eef0f3; --dim: #a3aab6; --line: #2a2e36; --card: #1c1f25; color-scheme: dark; }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding-block: 24px; padding-inline: 16px; }
section { border-top: 1px solid var(--line); padding-block: 16px; }
.cand { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-block: 12px; }
.frames { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
figure { margin: 0; } img { width: 100%; border-radius: 6px; display: block; }
figcaption { color: var(--dim); font-size: 12px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 10px 0 0; }
dt { color: var(--dim); } dd { margin: 0; overflow-wrap: anywhere; }
a { color: var(--accent); } .none { color: var(--dim); }
</style>
<main><h1>Batch ${esc(batch.batch)}: pick one option per exercise, or none</h1>
<p>Reply in chat, e.g. “romanian-deadlift: option 1; adductor-machine: none”.</p>${sections}</main>
`);
console.log('wrote ' + outFile);
```

- [ ] **Step 4: Verify the review builder with the existing lunges video**

```bash
mkdir -p /tmp/gq-review && bash tools/media/process.sh frames media/lunges.webm /tmp/gq-review/lunges-1 2 8
cat > /tmp/gq-review/test-batch.json <<'EOF'
{ "batch": 0, "exercises": [ { "id": "lunges", "candidates": [ { "kind": "video", "page": "https://commons.wikimedia.org/wiki/File:Forward_lunge_training.webm", "creator": "Skhulile Mthiyane", "license": "CC BY-SA 4.0", "trim": { "start": 2, "end": 8 }, "framesDir": "/tmp/gq-review/lunges-1" } ], "decision": null } ] }
EOF
node tools/media/review.js /tmp/gq-review/test-batch.json /tmp/gq-review/test.html && grep -c 'data:image/jpeg;base64' /tmp/gq-review/test.html
```

Expected: `wrote /tmp/gq-review/test.html`, then `6`.

- [ ] **Step 5: Document the batch files** in `tools/media/batches/README.md`. Copy the schema above, plus: "One file per batch. It records where every demonstration came from, the trim used and the owner's decision, so any file in `media/` can be re-made with `tools/media/process.sh`."

- [ ] **Step 6: Commit**

```bash
git add tools/media/commons.js tools/media/review.js tools/media/batches/README.md
git commit -m "Media: Commons search and batch review page tools"
```

---

## Task 6: Ship one content batch (run once for batch 1, then batch 2, then batch 3)

Batch membership (from the spec):
- **Batch 1:** `dumbbell-pullover`, `cable-pullover`, `single-arm-dumbbell-triceps-extension`, `single-arm-cable-triceps-extension`, `romanian-deadlift`, `adductor-machine`
- **Batch 2:** `leg-curls`, `calf-raises`, `band-chest-press`, `band-pulldown`, `band-row`, `dumbbell-row`, `pike-push-up`, `band-shoulder-press`, `hammer-curl`, `diamond-push-up`, `band-bicep-curl`, `bodyweight-squat`, `split-squat`, `step-up`, `glute-bridge`, `hip-thrust`, `single-leg-glute-bridge`, `dead-bug`
- **Batch 3 (video only, photos stay after it):** `lateral-raises`, `cable-curl`, `pec-deck`, `lat-pulldown`, `hack-squat`, `dips`, `cable-rows`, `leg-press`, `push-up`, `plank`, `burpee`, `front-raise`, `abductor-machine`

**Files:**
- Create: `tools/media/batches/batch-N.json`
- Add: `media/<id>.webm`, `media/<id>.mp4`, `media/<id>-poster.jpg`, or `media/<id>-1.jpg … -3.jpg`
- Modify: `script.js` (`EXERCISE_VIDEO_MEDIA`, `EXERCISE_PHOTO_MEDIA`, `MEDIA_CREDITS`), `media/CREDITS.md`, `README.md` ("Demonstrations"), `sw.js` + `index.html` (version bump)

**Interfaces:**
- Consumes: `process.sh` (Task 2), `commons.js` / `review.js` (Task 5), the gallery contract (Task 3): `MEDIA_CREDITS[id]` order equals `[video credit, ...photo credits]`.

- [ ] **Step 1: Find candidates for every exercise in the batch**

For each id, in this order, stopping when correct matches exist:
1. `node tools/media/commons.js "<English name>" video 20`, then `… image 20`. Try 2–3 phrasings (e.g. "romanian deadlift", "RDL barbell", "stiff leg deadlift"). Also search the CDC series: `node tools/media/commons.js "Muscle Strengthening at the Gym" video 50` and `… at Home …`.
2. Use the WebSearch tool on pexels.com/videos and pixabay.com/videos (the free licence lets the app redistribute; record the page URL and creator).
3. Download each plausible candidate with `curl -L -o /tmp/gq-originals/<id>-<n>.<ext> "<url>"`. Never into the repository.

Reject candidates whose licence is not in the allowed list (e.g. CC BY-NC, CC BY-ND, "all rights reserved", unknown).

- [ ] **Step 2: Extract and look at the frames of every candidate**

Videos: `bash tools/media/process.sh frames /tmp/gq-originals/<file> /tmp/gq-review/<id>-<n> [start end]`, then **Read every frame image**. Photos: Read each photo.
Keep a candidate only if every frame shows the exact exercise and equipment variation (e.g. *single-arm cable* triceps extension, not a two-arm rope pushdown), with one person and a clean repetition. Choose `trim.start` / `trim.end` covering one clean repetition (about 4–10 s) and a `poster` time inside it.
Write all candidates into `tools/media/batches/batch-N.json`, including ones with `"candidates": []` when nothing correct was found.

- [ ] **Step 3: Build and publish the review page, then wait for the owner**

`node tools/media/review.js tools/media/batches/batch-N.json /tmp/gq-review/batch-N.html`. Load the `artifact-design` skill, then publish the page with the Artifact tool as a private artifact (`icon: "image"`), and give the owner the link.
**Stop here until the owner replies.** Record each answer in `decision`.

- [ ] **Step 4: Write the failing expectation**

For each approved exercise, the `gallery` scenario will check it loads and has credits. First add the data entries **without** the files, so the test fails:

```js
// EXERCISE_VIDEO_MEDIA (approved video):
  'romanian-deadlift': { src: 'media/romanian-deadlift.webm', mp4: 'media/romanian-deadlift.mp4', poster: 'media/romanian-deadlift-poster.jpg' },
// or EXERCISE_PHOTO_MEDIA (approved 2–3 photo sequence, captions from the existing keys):
  'adductor-machine': [
    { src: 'media/adductor-machine-1.jpg', caption: 'media.start' },
    { src: 'media/adductor-machine-2.jpg', caption: 'media.squeeze' },
    { src: 'media/adductor-machine-3.jpg', caption: 'media.top' },
  ],
// MEDIA_CREDITS — one object per frame, video first (copy creator/licence/licenseUrl/page from batch-N.json):
  'romanian-deadlift': [{ creator: '…', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', source: 'https://commons.wikimedia.org/wiki/File:…' }],
```

Before using a caption key, check that it exists in all 6 languages: `grep -c "'media.squeeze':" script.js` must print `6`. If not, add it to all 6 blocks.
For a batch-3 exercise, **prepend** the video credit to its existing `MEDIA_CREDITS` array.

Run: `node tests/media/run.js "gallery"`
Expected: FAIL for exactly the newly added ids (`every item loads` false, because the files are missing).

- [ ] **Step 5: Produce the files**

Videos: `bash tools/media/process.sh video /tmp/gq-originals/<file> <id> <start> <end> <poster>`
Photos: `bash tools/media/process.sh photo /tmp/gq-originals/<file> <id>-<n>`
Then Read `media/<id>-poster.jpg` (or each photo) once more to confirm the processed output is right.

- [ ] **Step 6: Run everything and confirm it passes**

Run: `node --check script.js && node tests/media/run.js`
Expected: all PASS, `0 failed`. The `gallery` checks for the batch now pass, including `the video comes first` for batch 3.

- [ ] **Step 7: Credits, README, release**

- `media/CREDITS.md`: one table row per new file (file, exercise, creator, licence, source page).
- `README.md` → "Demonstrations": update the counts and lists of exercises with a video, a photo sequence, or still no demonstration (the latter from the batch's `"use": null` decisions).
- Bump `CACHE_VERSION` and `?v=` (next numbers after the previous release).
- Run: `node --check sw.js && node tests/media/run.js` → `0 failed`.

- [ ] **Step 8: Commit (push only after the owner says so; then the owner checks 2–3 of the batch's exercises on the iPhone)**

```bash
git add media/ script.js media/CREDITS.md README.md sw.js index.html tools/media/batches/batch-N.json
git commit -m "Media batch N: demonstrations for <count> exercises (vXX)"
```
