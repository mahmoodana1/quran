'use strict';

// التسميع for Hafs: Muaalem, a Quran recitation model that writes what the
// reader actually said, harakat and all (mu-worker.js runs it, match.js lines
// it up with the aya). The model files live in mahmoodana1/quran-models; the
// copy downloaded once is kept in the browser's cache (shared with the lab
// there, which is on the same site), so it works offline after that.
//
// Before anything is downloaded, each kind of model (8-bit, 4-bit, fp16; on
// the CPU or the GPU) is timed on this device with a stand-in of a few hundred
// KB, and the fastest is the one offered.
const Mu = (() => {
  const BASE = 'https://mahmoodana1.github.io/quran-models/';
  const CANDS = [
    { id: 'q8-cpu', variant: 'q8', ep: 'wasm', mb: 126 },
    { id: 'q8-gpu', variant: 'q8', ep: 'webgpu', mb: 126 },
    { id: 'fp16-gpu', variant: 'fp16', ep: 'webgpu', mb: 234, f16: true },
    { id: 'q4-cpu', variant: 'q4', ep: 'wasm', mb: 86 },
    { id: 'q4-gpu', variant: 'q4', ep: 'webgpu', mb: 86 },
  ];
  const PROBE_X = 12; // a full update takes about this many times the stand-in
  const threads = () => Math.min(4, navigator.hardwareConcurrency || 4);
  const now = () => performance.timeOrigin + performance.now();

  // the candidate chosen for this device: { id, ms } (ms: expected per update)
  const choice = () => { const c = store.get('mu.choice', null); return c && CANDS.find(x => x.id === c.id) ? c : null; };
  const cand = () => CANDS.find(x => x.id === choice()?.id);
  const mb = () => cand()?.mb ?? 126;

  // ---- timing the candidates on this device
  async function gpuInfo() {
    try { const a = navigator.gpu && await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); return a ? { f16: a.features.has('shader-f16') } : null; } catch { return null; }
  }
  // onStep(done, total); resolves with the chosen candidate
  async function probe(onStep) {
    const gpu = await gpuInfo();
    const list = CANDS.filter(c => !(c.ep === 'webgpu' && (!gpu || (c.f16 && !gpu.f16))));
    const res = {};
    await new Promise(resolve => {
      const w = new Worker('mu-worker.js', { type: 'module' });
      w.onmessage = ({ data: d }) => {
        if (d.type === 'probed') { res[d.id] = d; onStep?.(Object.keys(res).length, list.length); }
        if (d.type === 'probedAll') { w.terminate(); resolve(); }
      };
      w.onerror = () => { w.terminate(); resolve(); };
      w.postMessage({ type: 'probe', list: list.map(({ id, variant, ep }) => ({ id, variant, ep })), threads: threads() });
    });
    const ok = list.filter(c => res[c.id] && !res[c.id].error);
    if (!ok.length) throw new Error('no model runs on this device');
    const fastest = Math.min(...ok.map(c => res[c.id].ms));
    // the fastest; within 10% of it, the smaller download
    const best = ok.filter(c => res[c.id].ms <= fastest * 1.1).sort((a, b) => a.mb - b.mb || res[a.id].ms - res[b.id].ms)[0];
    store.set('mu.choice', { id: best.id, ms: Math.round(res[best.id].ms * PROBE_X), at: Date.now() });
    return best;
  }

  // ---- the model on this device
  let man = null;
  const manifest = async () => man ||= await (await fetch(BASE + 'muaalem/manifest.json', { cache: 'no-cache' })).json();
  const partUrl = p => BASE + p.path + '?h=' + p.sha256.slice(0, 12); // the worker caches under these
  async function saved() {
    const c = cand();
    if (!c) return false;
    try {
      const v = (await manifest()).variants[c.variant], cache = await caches.open('muaalem-lab');
      for (const p of v.parts) if (!(await cache.match(partUrl(p)))) return false;
      return true;
    } catch { return false; }
  }
  async function remove() {
    const c = cand();
    reset();
    if (!c) return;
    try {
      const v = (await manifest()).variants[c.variant], cache = await caches.open('muaalem-lab');
      for (const p of v.parts) await cache.delete(partUrl(p));
    } catch {}
  }

  let worker = null, ready = false, loading = null, onText = null, onFlushed = null, shared = null, info = null;
  function reset() {
    worker?.terminate();
    worker = null; ready = false; loading = null;
  }
  // download (first time) or load from the cache; progress(0..1)
  function load(progress) {
    if (ready) return Promise.resolve();
    if (loading) return loading;
    const c = cand();
    if (!c) return Promise.reject(new Error('no model chosen'));
    shared = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
      ? { ring: new Float32Array(new SharedArrayBuffer(4 * 16000 * 30)), meta: new Int32Array(new SharedArrayBuffer(4)), time: new Float64Array(new SharedArrayBuffer(8)) }
      : null;
    return loading = new Promise((resolve, reject) => {
      worker = new Worker('mu-worker.js', { type: 'module' });
      worker.onmessage = ({ data: d }) => {
        if (d.type === 'progress') progress?.(d.loaded / d.total);
        if (d.type === 'ready') { ready = true; info = d; resolve(); }
        if (d.type === 'text') onText?.(d);
        if (d.type === 'flushed') { const f = onFlushed; onFlushed = null; f?.(); }
        if (d.type === 'error' && !ready) { reset(); reject(new Error(d.message)); }
      };
      worker.onerror = e => { if (!ready) { reset(); reject(new Error(e.message || 'worker failed')); } };
      worker.postMessage({ type: 'load', variant: c.variant, ep: c.ep, threads: threads(), shared });
    });
  }

  // ---- the microphone, captured on the audio thread (capture.js)
  let actx = null, tapReady = null, mic = null;
  // inside the tap that starts listening (phones only allow sound from a tap)
  function prime() {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      tapReady = actx.audioWorklet.addModule('capture.js');
    }
    actx.resume();
  }
  // handler({ final, tent, ms, lag }) as the reading grows
  async function start(handler) {
    onText = handler;
    if (mic) return;
    prime();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await tapReady;
    const clock0 = now() - actx.currentTime * 1000;
    const node = new AudioWorkletNode(actx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { shared, clock0 } });
    if (!shared) node.port.onmessage = e => worker?.postMessage({ type: 'audio', samples: e.data.samples, at: e.data.at });
    node.connect(actx.destination); // silent
    const src = actx.createMediaStreamSource(stream);
    src.connect(node);
    mic = { stream, src, node };
    worker.postMessage({ type: 'start' });
  }
  // the handler only (the same reading goes on: the found aya takes it over)
  const listen = handler => { onText = handler; };
  // stop listening; resolves once the last of it has been read
  function stop() {
    const m = mic;
    mic = null;
    if (!m) return Promise.resolve();
    m.node.port.postMessage('stop'); m.src.disconnect(); m.node.disconnect(); m.stream.getTracks().forEach(t => t.stop());
    return new Promise(r => { onFlushed = r; worker.postMessage({ type: 'flush' }); });
  }

  // ---- how each aya sounds: [phonetic script, word ranges, words starting with ٱ]
  let phon = null, phonLoading = null;
  function sounds() {
    return phonLoading ||= fetch(`data/phon-hafs.json?v=${DATA_VERSION}`).then(r => r.json()).then(d => { phon = d; });
  }
  const cache = new Map();
  // what aya ai should sound like from its word w0 on (as match.js takes it)
  function expect(ai, w0 = 0) {
    const key = ai + ':' + w0;
    if (cache.has(key)) return cache.get(key);
    const [ph, sp, wasl] = phon[ai], o = sp[w0 * 2];
    const spans = [];
    for (let i = w0 * 2; i < sp.length; i += 2) spans.push([sp[i] - o, sp[i + 1] - o]);
    const e = { ph: ph.slice(o), spans, wasl: wasl.filter(k => k >= w0).map(k => k - w0) };
    if (cache.size > 400) cache.clear();
    cache.set(key, e);
    return e;
  }
  // two of them read one after the other
  function expect2(a, b) {
    const k = a.ph + '|' + b.ph;
    if (cache.has(k)) return cache.get(k);
    const n = a.ph.length, e = { ph: a.ph + b.ph, spans: a.spans.concat(b.spans.map(([x, y]) => [x + n, y + n])), wasl: a.wasl.concat(b.wasl.map(k => k + a.spans.length)) };
    cache.set(k, e);
    return e;
  }

  // ---- which aya a reading is from: sounds reduced to their consonants (with
  // the sounds the model confuses as one), then shared three-letter runs
  const FOLD = { 'ں': 'ن', 'م': 'ن', '۾': 'ن', 'ط': 'ت', 'ض': 'د', 'ص': 'س', 'ث': 'س', 'ز': 'ذ', 'ظ': 'ذ', 'ك': 'ق', 'ع': 'ء', 'ح': 'ه' };
  const LETTERS = /[ءبتثجحخدذرزسشصضطظعغفقكلمنهويں۾]/;
  function skeleton(ph) {
    let out = '';
    for (const c of ph) {
      if (!LETTERS.test(c)) continue;
      const f = FOLD[c] || c;
      if (out[out.length - 1] !== f) out += f;
    }
    return out;
  }
  let grams = null;
  function index() {
    if (grams) return grams;
    grams = new Map();
    phon.forEach(([ph], ai) => {
      const s = skeleton(ph), seen = new Set();
      for (let i = 0; i + 3 <= s.length; i++) {
        const g = s.slice(i, i + 3);
        if (seen.has(g)) continue;
        seen.add(g);
        let l = grams.get(g);
        if (!l) grams.set(g, l = []);
        l.push(ai);
      }
    });
    return grams;
  }
  // the ayas a reading most likely starts, best first: [{ ai, score }]
  function candidates(heard, n = 8) {
    const s = skeleton(heard), idx = index(), hits = new Map(), mine = new Set();
    for (let i = 0; i + 3 <= s.length; i++) mine.add(s.slice(i, i + 3));
    for (const g of mine) for (const ai of idx.get(g) || []) hits.set(ai, (hits.get(ai) || 0) + 1);
    return [...hits].map(([ai, h]) => ({ ai, score: h / Math.max(1, mine.size) })).sort((a, b) => b.score - a.score).slice(0, n);
  }

  return {
    CANDS, choice, mb, probe, saved, remove, load, prime, start, listen, stop, sounds, expect, expect2, candidates,
    ready: () => ready, listening: () => !!mic, info: () => info,
    reprobe: () => { store.set('mu.choice', null); reset(); },
  };
})();
