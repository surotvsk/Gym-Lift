/* ===== GymQuest service worker =====
   Versioned precache with an explicit, user-driven update.

   IMPORTANT: bump CACHE_VERSION on every deployment. Changing script.js/style.css
   without changing this file leaves the old worker installed and the cache intact,
   so no update would ever be offered.
   Bump it and the new worker installs, re-fetches everything and deletes the old cache. */

const CACHE_VERSION = 'v52';
const CACHE_PREFIX = 'gymquest-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

/* Ukážky cvikov (media/*) žijú v samostatnej, dlhodobej cache: stiahnu sa pri prvom
   zobrazení a aktualizácia appky ich nikdy nesťahuje znova. Súbor sa nikdy nemení
   na mieste – nová verzia ukážky dostane nový názov (-v2). */
const MEDIA_CACHE = CACHE_PREFIX + 'media';
function isMediaUrl(url) {
  return url.origin === self.location.origin && /\/media\/[^/]+\.(webm|mp4|jpe?g|png|webp)$/i.test(url.pathname);
}
const mediaKey = (url) => url.origin + url.pathname;

/* Presne tie URL, ktoré odkazuje index.html – vrátane "?v=".
   Cache kľúč je celá URL, takže "style.css" a "style.css?v=27" sú dve rôzne položky. */
const PRECACHE = [
  'index.html',
  'style.css?v=56',
  'script.js?v=56',
  'community-config.js?v=56',
  'vendor/supabase-js.js?v=56',
  'manifest.json',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
];

/* Zoznam precache URL sa počíta až pri prvej požiadavke – na najvyššej úrovni
   skriptu by akákoľvek chyba zhodila celý worker ešte pred registráciou listenerov. */
let precacheUrls = null;
function isPrecached(href) {
  if (!precacheUrls) {
    precacheUrls = new Set(PRECACHE.map((url) => new URL(url, self.location.href).href));
  }
  return precacheUrls.has(href);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // cache: 'reload' obchádza HTTP cache prehliadača, aby sa počas inštalácie
      // neuložili staré bajty. addAll je atomické – pri chybe sa neuloží nič.
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
    } catch (err) {
      console.error('GymQuest SW: precache zlyhal:', err);
      throw err;   // inštalácia musí zlyhať, aby sa neuložila polovičná appka
    }
  })());
});

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

/* Aktivácia na požiadanie z tlačidla "Aktualizovať". */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  // Verzia pre Nastavenia → Aktualizácie aplikácie
  if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: CACHE_VERSION });
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // žiadne cudzie zdroje

  // Navigácia (otvorenie appky, obnovenie stránky): z cache, aby fungovala aj offline.
  if (request.mode === 'navigate') {
    event.respondWith(serveFromCacheThenNetwork('index.html', request));
    return;
  }

  // Ukážky cvikov: dlhodobá cache, pri prvom zobrazení zo siete; Range (Safari) → 206.
  if (isMediaUrl(url)) {
    event.respondWith(serveMedia(request, url));
    return;
  }

  // Ostatné požiadavky sa riešia len ak patria medzi precache súbory;
  // všetko iné ide priamo na sieť a nikdy sa neukladá, aby cache nerástla.
  if (!isPrecached(url.href)) return;
  event.respondWith(serveFromCacheThenNetwork(request, request));
});

async function serveFromCacheThenNetwork(cacheKey, request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch (e) {
    return Response.error();
  }
}

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
