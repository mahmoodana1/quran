// App files (html/css/js) are network-first so updates show up right away,
// falling back to the cache offline. Data and fonts are cache-first; app.js
// requests data with ?v=N, so bumping DATA_VERSION there fetches new copies.
// Hafs page fonts (verses.quran.foundation) are cached as pages are opened.
// Recitation audio: see audioResponse below.
const VERSION = 'quran-v20';
const TAFSIR = 'tafsir-saadi';
// recitation files saved by the app (or while listening); kept across versions
const AUDIO = 'audio-yasser-128';
// page fonts never change, so they live in their own cache across versions
const FONTS = 'qcf-v2-fonts';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'prayer.js', 'manifest.webmanifest', 'icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONTS && k !== AUDIO && k !== TAFSIR).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'everyayah.com') {
    e.respondWith(audioResponse(e.request));
    return;
  }
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
  if (/\/data\/tafsir\//.test(url.pathname)) {
    // tafsir files live in their own cache, kept across app updates
    e.respondWith(caches.open(TAFSIR).then(async c => {
      const key = url.origin + url.pathname;
      const hit = await c.match(key);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(key, res.clone());
      return res;
    }));
    return;
  }
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

// Serve a saved recitation file, honouring Range requests (Safari's <audio>
// always asks for ranges). Unsaved files come from the network and, when the
// full file is fetched, are saved for next time.
async function audioResponse(req) {
  const cache = await caches.open(AUDIO);
  const hit = await cache.match(req.url);
  if (!hit) {
    if (req.headers.has('range')) {
      // fetch the whole file once in the background so it's offline next time
      fetch(req.url, { mode: 'cors' }).then(r => r.ok && cache.put(req.url, r)).catch(() => {});
      return fetch(req);
    }
    const res = await fetch(req.url, { mode: 'cors' });
    if (res.ok) cache.put(req.url, res.clone());
    return res;
  }
  const range = req.headers.get('range');
  if (!range) return hit;
  const buf = await hit.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : 0;
  let end = m[2] ? +m[2] : size - 1;
  if (!m[1] && m[2]) { start = size - +m[2]; end = size - 1; } // suffix range
  end = Math.min(end, size - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
