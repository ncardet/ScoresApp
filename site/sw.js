// Service worker: offline app shell + cached logos. Live data (ESPN) is cached by the app itself
// in IndexedDB so it can label stale data ("showing data from 10:42am").
//
// BUILD is replaced with the commit SHA by the deploy workflow, so every deploy refreshes caches.
const BUILD = '__BUILD__';
const SHELL = `sideline-shell-${BUILD}`;
const IMAGES = 'sideline-img-v1';
const MAX_IMAGES = 400;

const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

// Install: the core shell, then everything listed in precache.json (generated at deploy time),
// so the app opens offline even right after the first visit.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(CORE);
    try {
      const res = await fetch('precache.json', { cache: 'no-store' });
      const { files = [] } = await res.json();
      // Individually, so one missing file does not abort the install.
      await Promise.all(files.map((f) => cache.add(f).catch(() => {})));
    } catch { /* no list: runtime caching fills in */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('sideline-shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function trimImages() {
  const c = await caches.open(IMAGES);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await c.delete(k);
}

/** Cache first, refresh in the background (code, config, calibration). */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, { ignoreSearch: false });
  const fetching = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await fetching) || new Response('Offline', { status: 503 });
}

/** Network first with a cached fallback (pages, the morning brief). */
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || (fallbackUrl && (await cache.match(fallbackUrl))) || new Response('Offline', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, 'index.html'));
    return;
  }
  if (url.origin === self.location.origin) {
    if (/\/data\/(brief|ratings)/.test(url.pathname)) event.respondWith(networkFirst(request));
    else event.respondWith(staleWhileRevalidate(request));
    return;
  }
  // Team logos and flags: cache first (opaque responses are fine for <img>).
  if (/(^|\.)espncdn\.com$/.test(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGES);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res.ok || res.type === 'opaque') { cache.put(request, res.clone()); trimImages(); }
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
  }
  // Everything else (ESPN / OpenF1 APIs) goes straight to the network.
});
