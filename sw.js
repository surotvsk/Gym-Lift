/* ===== GymQuest service worker =====
   Versioned precache with an explicit, user-driven update.

   IMPORTANT: bump CACHE_VERSION on every deployment. Changing script.js/style.css
   without changing this file leaves the old worker installed and the cache intact,
   so no update would ever be offered.
   Bump it and the new worker installs, re-fetches everything and deletes the old cache. */

const CACHE_VERSION = 'v48';
const CACHE_PREFIX = 'gymquest-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

/* Presne tie URL, ktoré odkazuje index.html – vrátane "?v=".
   Cache kľúč je celá URL, takže "style.css" a "style.css?v=27" sú dve rôzne položky. */
const PRECACHE = [
  'index.html',
  'style.css?v=52',
  'script.js?v=52',
  'community-config.js?v=52',
  'vendor/supabase-js.js?v=52',
  'manifest.json',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'media/bench-press.webm',
  'media/bench-press-poster.jpg',
  'media/squats.webm',
  'media/squats-poster.jpg',
  'media/overhead-press.webm',
  'media/overhead-press-poster.jpg',
  'media/bent-over-rows.webm',
  'media/bent-over-rows-poster.jpg',
  'media/bicep-curls.webm',
  'media/bicep-curls-poster.jpg',
  'media/pull-ups.webm',
  'media/pull-ups-poster.jpg',
  'media/lunges.webm',
  'media/lunges-poster.jpg',
  'media/lateral-raises-1.jpg',
  'media/lateral-raises-2.jpg',
  'media/lateral-raises-3.jpg',
  'media/push-up-1.jpg',
  'media/dips-1.jpg',
  'media/plank-1.jpg',
  'media/cable-rows-1.jpg',
  'media/leg-press-1.jpg',
  'media/burpee-1.jpg',
  'media/superman.webm',
  'media/superman-poster.jpg',
  'media/machine-chest-press.webm',
  'media/machine-chest-press-poster.jpg',
  'media/incline-dumbbell-press.webm',
  'media/incline-dumbbell-press-poster.jpg',
  'media/leg-extension.webm',
  'media/leg-extension-poster.jpg',
  'media/cable-curl-1.jpg',
  'media/cable-curl-2.jpg',
  'media/pec-deck-1.jpg',
  'media/pec-deck-2.jpg',
  'media/front-raise-1.jpg',
  'media/lat-pulldown-1.jpg',
  'media/lat-pulldown-2.jpg',
  'media/hack-squat-1.jpg',
  'media/hack-squat-2.jpg',
  'media/abductor-machine-1.jpg',
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
    // Zmažú sa len staršie cache s naším prefixom, nikdy nie všetko na doméne.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

/* Aktivácia na požiadanie z tlačidla "Aktualizovať". */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
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
