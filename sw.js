// App files (html/css/js) are network-first so updates show up right away,
// falling back to the cache offline. Data and fonts are cache-first; app.js
// requests data with ?v=N, so bumping DATA_VERSION there fetches new copies.
// Hafs page fonts (verses.quran.foundation) are cached as pages are opened.
// Recitation audio streams from everyayah.com.
const VERSION = 'quran-v5';
// page fonts never change, so they live in their own cache across versions
const FONTS = 'qcf-v2-fonts';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'verses.quran.foundation') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  const assets = /\/(data|fonts)\//.test(url.pathname);
  e.respondWith(caches.open(VERSION).then(async c => {
    if (assets) {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch {
      return (await c.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  }));
});
