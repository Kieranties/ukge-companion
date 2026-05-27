// UKGE Companion service worker — cache-first for the dashboard so it
// keeps working on the NEC's flaky show-floor wifi.
const CACHE = 'ukge-companion-v3';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg', './icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        fetch(req).then((r) => {
          if (r && r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then((r) => {
        if (r && r.ok && new URL(req.url).origin === self.location.origin) {
          const clone = r.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return r;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
