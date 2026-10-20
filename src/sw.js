// MentorFlow service worker: precache the app shell, serve cache-first, works from any subpath.
const VERSION = '__BUILD_VERSION__';
const CACHE = 'mentorflow-' + VERSION;
const ASSETS = __ASSET_LIST__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mentorflow-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // App shell: always answer navigations with cached index.html (offline-safe), refresh in background.
    e.respondWith(caches.match('./index.html', { ignoreSearch: true }).then(cached => {
      const net = fetch(req).then(res => { if (res.ok && new URL(res.url).pathname.endsWith('/')) caches.open(CACHE).then(c => c.put('./index.html', res.clone())); return res; }).catch(() => cached);
      return cached || net;
    }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => cached || fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
