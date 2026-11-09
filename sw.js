// App files (html/css/js) are network-first so updates show up right away,
// falling back to the cache offline. Data and fonts are cache-first; app.js
// requests data with ?v=N, so bumping DATA_VERSION there fetches new copies.
// Hafs page fonts (verses.quran.foundation) are cached as pages are opened.
// Recitation audio: see audioResponse below.
const VERSION = 'quran-v148';
const TAFSIR = 'tafsir-saadi';
// recitation files saved by the app (or while listening); kept across versions.
// Hafs: aya files from everyayah.com; the other riwayat: surah files from
// mp3quran.net, saved only by the download in the settings
const AUDIO = 'audio-yasser-128';
const RIWAYA_AUDIO = 'audio-riwayat';
// the speech recogniser's code (transformers.js and its ONNX runtime, pinned
// versions from jsDelivr), kept across versions so التسميع works offline; the
// model itself is cached by transformers.js
const ASR = 'asr-lib';
// page fonts never change, so they live in their own cache across versions
const FONTS = 'qcf-v2-fonts';
// the Quran text files and local fonts also outlive app updates, so a phone that
// saved the mushaf for offline use keeps it
const MUSHAF = 'mushaf-data';
// downloaded speech models: transformers.js keeps Whisper in 'transformers-cache',
// mu-worker.js keeps Muaalem in 'muaalem-lab' (shared with the lab in
// quran-models, on the same site); they must outlive app updates too
const MODELS = ['transformers-cache', 'muaalem-lab'];
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'prayer.js', 'adhkar.js', 'listen.js', 'recite.js', 'word.js', 'asr-worker.js', 'match.js', 'mu.js', 'mu-worker.js', 'ctc.js', 'capture.js', 'install.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONTS && k !== ASR && k !== AUDIO && k !== RIWAYA_AUDIO && k !== TAFSIR && k !== MUSHAF && !MODELS.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'everyayah.com') {
    e.respondWith(audioResponse(e.request));
    return;
  }
  if (url.hostname === 'cdn.mp3quran.net') {
    // the app reads one aya at a time with a range of the surah's file
    e.respondWith(caches.open(RIWAYA_AUDIO).then(c => c.match(e.request.url)).then(hit => hit ? ranged(hit, e.request) : fetch(e.request)));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net' && /^\/npm\/(@huggingface\/transformers|onnxruntime-web)@/.test(url.pathname)) {
    e.respondWith(caches.open(ASR).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
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
  // the model repository on the same site: fetched as is (the worker keeps its own copy)
  if (!url.pathname.startsWith(new URL('./', location.href).pathname)) return;
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
  e.respondWith(caches.open(assets ? MUSHAF : VERSION).then(async c => {
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
      return isolate(res);
    } catch {
      const hit = await c.match(e.request, { ignoreSearch: true });
      return hit ? isolate(hit) : Response.error();
    }
  }));
});

// The app's own pages and scripts are served cross-origin isolated (static
// hosts such as GitHub Pages cannot send these headers), which lets the speech
// model use several CPU cores. 'credentialless' keeps other sites' audio and
// fonts loading as before; browsers that don't know it simply stay as they were.
function isolate(res) {
  if (res.type !== 'basic' && res.type !== 'default') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

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
  return ranged(hit, req);
}

// the part of a saved file a Range request asks for (a slice of its Blob,
// so a whole surah's file is not read into memory for one aya)
async function ranged(hit, req) {
  const range = req.headers.get('range');
  if (!range) return hit;
  const blob = await hit.blob();
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : 0;
  let end = m[2] ? +m[2] : size - 1;
  if (!m[1] && m[2]) { start = size - +m[2]; end = size - 1; } // suffix range
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
