// التسميع with Muaalem: runs one model candidate (file + backend) and reads recitation as it
// grows: whenever at least MIN_NEW s of new audio has come in (more on a slow device, see DUTY), the last WIN s
// are read again; output frames with RIGHT s of audio after them are final,
// the rest is shown as tentative.
//
// The page writes the microphone into a ring shared with this worker
// (SharedArrayBuffer), so each read takes everything heard up to that moment;
// without isolation it falls back to messages.
//
// in:  load {variant, ep, threads, shared: {ring, meta, time}} · rate {rate} · warm · start · audio {samples} · flush
//      · score {id, from, to, texts}
// out: progress {loaded, total} · ready {loadMs, ep, threads} · warmed {done, total} · text {final, tent, conf, alts (per character), ms, lag}
//      · scored {id, scores} · flushed · error {message}
import { tokens, score } from './ctc.js';

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';
const BASE = 'https://mahmoodana1.github.io/quran-models/'; // where the models live (mahmoodana1/quran-models)
const WIN = 4, RIGHT = 1, MIN_NEW = 0.25, RATE = 16000; // (the study, 480 readings: half the words wrongly marked of 2.5 / 0.5 / 0.25; a slower device reads less often by itself)
const FRAME = 640;   // samples per output frame (40 ms); windows start on this grid so frames line up
const MIN_WIN = 1.5; // s heard before anything is final (the very start needs context)
const MAX_WIN = 8;   // s: the longest window read when catching up
const CATCH = 6;     // s: the window read when a little behind
const QUANT = 5 * 640; // samples (0.2 s): windows end on this grid, so they come in few lengths
const SEC = RATE;      // while a window can't yet be its full length (the first seconds), on whole seconds:
                       // windows of 1 to 8 s, eight lengths in all (a GPU prepares each length it meets)
// how often it reads, the reader's choice (rate): the study found every 0.25 s or every 1.5 s
// the same (words marked, mistakes caught); reading more often only shows the words sooner
//   auto: every MIN_NEW s, but the model runs at most half the time: a slow phone reads less
//         often, and stays cool and its page responsive (never more than MAX_GAP s apart)
//   fast: every MIN_NEW s, or as often as the phone can
//   save: every SAVE_GAP s
const DUTY = 0.5, MAX_GAP = 3, SAVE_GAP = 1.5;
let rate = 'auto';
// on a slow device (a read over SLOW_MS), auto: the full reads at most DUTY_FULL of the time, and
// between them glances: reads of only the newest GLANCE s, which make nothing final, only show the
// words being said sooner (their frames from GLANCE_CTX s in, the model having heard a little
// before them; the earlier tentative ones kept), all at most DUTY_SHOW of the time. What is
// marked comes from the full reads only, as before (a little later)
const SLOW_MS = 300, DUTY_FULL = 0.4, DUTY_SHOW = 0.8, GLANCE_CTX = 0.4, GLANCE_MIN = 0.3;
let GLANCE = 2; // s (on a CPU 1.6: a GPU prepares each length, warm() whole seconds only)
let shortMs = 0, shownUpTo = 0; // how long a glance takes here, lately; up to when (s) the newest read went
const slow = () => rate === 'auto' && stepMs > SLOW_MS;
const gap = () => rate === 'save' ? SAVE_GAP : rate === 'fast' ? MIN_NEW
  : Math.max(MIN_NEW, Math.min(MAX_GAP, stepMs / 1000 / (slow() ? DUTY_FULL : DUTY)));
const glanceGap = () => Math.max(GLANCE_MIN, (shortMs || stepMs * 0.4) / 1000 / (DUTY_SHOW - DUTY_FULL));
const ALT = 0.1;     // a sound the model gives this much chance, besides its first choice, is kept as a runner-up
const now = () => performance.timeOrigin + performance.now(); // same clock as the page

let ort, fe, vocab, session, fromCache = false;
// the ring: meta[0] = samples written so far, time[0] = when the last ones came in
let ring = new Float32Array(RATE * 30), meta = new Int32Array(1), time = new Float64Array(1);
let base = 0;                                      // samples written before this recitation
let kept = [], keptP = [], keptA = [], keptL = [], readUpTo = 0;
let tid = [], tp = [], ta = []; // the tentative frames after the final ones (by absolute frame), as last read // final frames (by absolute frame number), how sure each was, its runner-ups, all its sounds' log-probabilities (ctc.js), and up to when (s)
const KEEP_L = 15000; // frames (10 min) whose log-probabilities are kept
let live = false, looping = null, stepMs = 0; // stepMs: how long a read takes here, lately

async function fetchParts(variant) {
  const man = await (await fetch(BASE + 'muaalem/manifest.json', { cache: 'no-cache' })).json();
  const v = man.variants[variant];
  const cache = await caches.open('muaalem-lab');
  const out = new Uint8Array(v.bytes);
  let at = 0, loaded = 0;
  fromCache = true;
  for (const p of v.parts) {
    const url = BASE + p.path + '?h=' + p.sha256.slice(0, 12);
    let res = await cache.match(url);
    if (!res) {
      fromCache = false;
      const net = await fetch(url);
      if (!net.ok) throw new Error(`${p.path}: HTTP ${net.status}`);
      const reader = net.body.getReader(), chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        postMessage({ type: 'progress', loaded: loaded + got, total: v.bytes, net: true });
      }
      const blob = new Blob(chunks);
      await cache.put(url, new Response(blob));
      res = new Response(blob);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    out.set(buf, at); at += buf.length; loaded += buf.length;
    postMessage({ type: 'progress', loaded, total: v.bytes });
  }
  return out;
}

async function load({ variant, ep, threads, shared }) {
  if (shared) ({ ring, meta, time } = shared);
  const t0 = performance.now();
  ort = await import(ORT + 'ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths = ORT;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? threads : 1;
  const { AutoFeatureExtractor, env } = await import(TJS);
  env.allowLocalModels = true; env.allowRemoteModels = false; env.localModelPath = BASE;
  fe = await AutoFeatureExtractor.from_pretrained('muaalem');
  vocab = (await (await fetch(BASE + 'muaalem/phoneme_vocab.json')).json()).id_to_char;
  const bytes = await fetchParts(variant);
  const t1 = performance.now();
  session = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' });
  if (ep === 'wasm') GLANCE = 1.6;
  await ids(new Float32Array(RATE * WIN)); // warm up (shader compilation on the GPU)
  postMessage({ type: 'ready', fromCache, loadMs: performance.now() - t1, totalMs: performance.now() - t0, ep, threads: ort.env.wasm.numThreads });
}

// the most likely sound of each frame, and how sure the model was of it (softmax)
async function ids(x) {
  const f = (await fe(x)).input_features;
  const lg = (await session.run({ input_features: new ort.Tensor('float32', f.data, f.dims) })).logits;
  const d = await lg.getData(), [, T, V] = lg.dims, o = new Int32Array(T), p = new Float32Array(T), alt = new Array(T), lp = new Array(T);
  for (let t = 0; t < T; t++) {
    let b = 0;
    for (let v = 1; v < V; v++) if (d[t * V + v] > d[t * V + b]) b = v;
    let z = 0, top = d[t * V];
    for (let v = 0; v < V; v++) { z += Math.exp(d[t * V + v] - d[t * V + b]); if (d[t * V + v] > top) top = d[t * V + v]; }
    o[t] = b; p[t] = 1 / z;
    // (each sound's log-probability, blank's too)
    const l = lp[t] = new Float32Array(V);
    let zz = 0;
    for (let v = 0; v < V; v++) zz += Math.exp(d[t * V + v] - top);
    zz = top + Math.log(zz);
    for (let v = 0; v < V; v++) l[v] = d[t * V + v] - zz;
    // the other sounds the model gave a fair chance here (not blank)
    let a = '';
    for (let v = 1; v < V; v++) if (v !== b && Math.exp(d[t * V + v] - d[t * V + b]) / z >= ALT) a += vocab[v];
    alt[t] = a;
  }
  o.p = p; o.alt = alt; o.lp = lp;
  return o;
}

// frames -> text, with each character's confidence (the surest of its frames), the other
// sounds the model considered there, and the frame it starts on (at: how long a madd is held)
function decode(list, probs, alts) {
  let out = '', prev = -1;
  const conf = [], alt = [], at = [];
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (b !== prev && b !== 0) { out += vocab[b]; conf.push(probs[k]); alt.push(alts[k] || ''); at.push(k); }
    else if (b === prev && b !== 0) {
      conf[conf.length - 1] = Math.max(conf[conf.length - 1], probs[k]);
      for (const c of alts[k] || '') if (!alt[alt.length - 1].includes(c)) alt[alt.length - 1] += c;
    }
    prev = b;
  }
  return { out, conf, alt, at };
}

const written = () => Atomics.load(meta, 0);

// samples [from, to) of the recitation, out of the ring
// (past what was heard, upto: silence; the last read is made up to a whole length so)
function slice(from, to, upto = to) {
  const out = new Float32Array(to - from), R = ring.length;
  for (let i = from; i < Math.min(to, upto); i++) out[i - from] = ring[(base + i) % R];
  return out;
}

// read the newest window; final reads to the very end (the reader stopped)
async function step(final) {
  const n = written() - base, heardAt = time[0];
  // windows of a few lengths only (a GPU prepares buffers and programs for each length it
  // is given, and keeps them: lengths of every size can fill a phone's memory, and the page
  // is then closed and loaded again): read up to the last whole QUANT; the last WIN s, or from the
  // start while less was heard; when reading fell behind (a slow or busy device), from just
  // before the last final frame, in a window of CATCH s or MAX_WIN s, so nothing goes unread
  // (the last read, final, made up to the grid with silence: under 0.2 s, or a second at the start)
  const to = (g, x) => (final ? Math.ceil(x / g) : Math.floor(x / g)) * g;
  let e = to(QUANT, n), st = e - WIN * RATE;
  const behind = Math.max(0, (kept.length - Math.round(0.5 * RATE / FRAME)) * FRAME);
  if (behind < st) st = e - (e - behind <= CATCH * RATE ? CATCH : MAX_WIN) * RATE;
  if (st < 0) { e = to(SEC, n); st = 0; } // all heard so far, in whole seconds
  if (!final && (e <= 0 || e / RATE <= readUpTo)) return false; // nothing new on the grid yet
  const f0 = st / FRAME;
  const t0 = performance.now();
  const o = await ids(slice(st, e, n));
  const ms = performance.now() - t0;
  stepMs = stepMs ? 0.7 * stepMs + 0.3 * ms : ms;
  const upto = final ? o.length : e - st < MIN_WIN * RATE ? 0 : Math.max(0, o.length - Math.round(RIGHT * RATE / FRAME));
  for (let k = kept.length - f0; k < upto; k++) if (k >= 0) { kept[f0 + k] = o[k]; keptP[f0 + k] = o.p[k]; keptA[f0 + k] = o.alt[k]; keptL[f0 + k] = o.lp[k]; }
  // frames before f0 that were never made final (can't happen once WIN > RIGHT) stay blank
  for (let k = 0; k < kept.length; k++) { kept[k] ??= 0; keptP[k] ??= 1; keptA[k] ??= ''; }
  for (let k = keptL.length - KEEP_L - 200; k >= 0 && keptL[k]; k--) keptL[k] = null;
  post(o, f0, final, ms, heardAt, e);
  return true;
}
// a glance (slow()): the newest GLANCE s read, its frames from GLANCE_CTX s in taken for the tentative ones
async function glance() {
  const n = written() - base, heardAt = time[0], e = Math.floor(n / QUANT) * QUANT, st = e - GLANCE * RATE;
  if (st < 0 || e / RATE <= shownUpTo) return false;
  const t0 = performance.now();
  const o = await ids(slice(st, e, n));
  const ms = performance.now() - t0;
  shortMs = shortMs ? 0.7 * shortMs + 0.3 * ms : ms;
  const f0 = st / FRAME, from = Math.max(Math.round(GLANCE_CTX * RATE / FRAME), kept.length - f0);
  tid.length = tp.length = ta.length = Math.min(tid.length, f0 + from);
  for (let k = from; k < o.length; k++) { tid[f0 + k] = o[k]; tp[f0 + k] = o.p[k]; ta[f0 + k] = o.alt[k]; }
  post(null, 0, false, ms, heardAt, e, true);
  return true;
}
// scores asked for (score), each given once its frames are all final (or the reading is over)
let asked = [];
function scoreAsked() {
  if (!asked.length) return;
  const ids = new Map(vocab.map((c, i) => [c, i]).filter(([, i]) => i > 0)), L = t => keptL[t] || BLANK;
  asked = asked.filter(d => {
    if (live && d.to > kept.length) return true;
    const from = Math.max(0, d.from), to = Math.min(d.to, kept.length);
    postMessage({ type: 'scored', id: d.id, scores: d.texts.map(x => keptL[from] ? score(L, from, to, tokens(x, ids)) : null) });
    return false;
  });
}
// the text so far, final and tentative
// (o: the read's frames from f0, for the tentative ones after the final; none, final or silence;
// short: of a glance(), which reads less: up to when the model read doesn't move, nor its pace)
function post(o, f0, final, ms, heardAt, e, short = false) {
  if (!short) {
    tid = []; tp = []; ta = [];
    if (o && !final) for (let k = Math.max(0, kept.length - f0); k < o.length; k++) { tid[f0 + k] = o[k]; tp[f0 + k] = o.p[k]; ta[f0 + k] = o.alt[k]; }
    readUpTo = e / RATE;
  }
  shownUpTo = e / RATE;
  const tent = [], tentP = [], tentA = [];
  for (let k = kept.length; k < tid.length; k++) { tent.push(tid[k] ?? 0); tentP.push(tp[k] ?? 1); tentA.push(ta[k] ?? ''); }
  // lag: from when the newest sample read came in, to its letters being out
  const fin = decode(kept, keptP, keptA).out, all = decode(kept.concat(tent), keptP.concat(tentP), keptA.concat(tentA)); // together, so a letter on the seam isn't doubled
  postMessage({ type: 'text', final: fin, tent: all.out.slice(fin.length), conf: all.conf, alts: all.alt, at: all.at, ms, lag: now() - heardAt, end: short ? undefined : e / RATE });
  scoreAsked();
}

// before a session: each length of window it will read (step()) read once, so a GPU has
// prepared all it needs for them now, while the reader waits on a screen saying so
async function warm() {
  const lens = [];
  for (let e = SEC; e <= MAX_WIN * RATE; e += SEC) lens.push(e); // (step(): 1 to 8 s, whole seconds)
  const x = new Float32Array(MAX_WIN * RATE);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 0.031) * 0.02 * Math.sin(i * 0.0007); // quiet, not silent
  for (let i = 0; i < lens.length; i++) {
    await ids(x.subarray(0, lens[i]));
    postMessage({ type: 'warmed', done: i + 1, total: lens.length });
  }
}

// keep reading while the recitation goes on
// the last REC_MAX s of what was heard (across pauses and sessions), for a
// recording the reader can share when the recognition goes wrong
const REC_MAX = 300;
let rec = [], recLen = 0, recUpTo = 0; // blocks of samples, how many, and how far into the ring
function record() {
  const w = written(), from = Math.max(recUpTo, w - ring.length + 1);
  if (w > from) {
    const b = new Float32Array(w - from);
    for (let i = from; i < w; i++) b[i - from] = ring[i % ring.length];
    rec.push(b); recLen += b.length;
    while (recLen - rec[0].length > REC_MAX * RATE) recLen -= rec.shift().length;
  }
  recUpTo = w;
}

// the reader silent (a pause, a breath): no need to read it. Each 0.1 s's level against the
// room's own (the quietest of the last 10 s); once it has been quiet SIL_PAD s past the last final
// frame, the frames up to SIL_PAD s before now are made final as blank, the model left idle (a
// slow phone catches up meanwhile). SIL_PAD either side: a soft sound beginning or ending a word
const LV = 1600, SIL_X = 2, SIL_MIN = 0.002, SIL_PAD = 0.5, SIL_LEN = 0.8;
const BLANK = new Float32Array(43).fill(-30); BLANK[0] = 0;
let lv = [], lvAt = 0, loudEnd = 0;
function levels() {
  const w = written(), R = ring.length;
  if (w - lvAt > R - LV) lvAt = w - R + LV;
  for (; lvAt + LV <= w; lvAt += LV) {
    let e = 0;
    for (let i = lvAt; i < lvAt + LV; i += 4) { const x = ring[i % R]; e += x * x; }
    const r = Math.sqrt(e / (LV / 4));
    lv.push(r); if (lv.length > 100) lv.shift();
    if (r > Math.max(Math.min(...lv) * SIL_X, SIL_MIN)) loudEnd = lvAt + LV;
  }
}
function silence() {
  levels();
  const pad = SIL_PAD * RATE, upto = Math.floor((lvAt - base - pad) / FRAME);
  if (loudEnd - base + pad > kept.length * FRAME || upto - kept.length < SIL_LEN * RATE / FRAME) return false;
  for (let k = kept.length; k < upto; k++) { kept[k] = 0; keptP[k] = 1; keptA[k] = ''; keptL[k] = BLANK; }
  post(null, kept.length, false, undefined, time[0], lvAt - base);
  return true;
}
// quiet since the last final frame: nothing to read
const still = () => loudEnd - base + SIL_PAD * RATE <= kept.length * FRAME;

async function loop() {
  while (live) {
    record();
    if (silence()) await new Promise(r => setTimeout(r, 15));
    else if (!still() && (written() - base) / RATE - readUpTo >= gap()) {
      try { if (await step(false) === false) await new Promise(r => setTimeout(r, 15)); } catch (e) { postMessage({ type: 'error', message: String(e.stack || e) }); await new Promise(r => setTimeout(r, 200)); }
    }
    else if (slow() && !still() && (written() - base) / RATE - shownUpTo >= glanceGap()) {
      try { if (await glance() === false) await new Promise(r => setTimeout(r, 15)); } catch (e) { postMessage({ type: 'error', message: String(e.stack || e) }); await new Promise(r => setTimeout(r, 200)); }
    }
    else await new Promise(r => setTimeout(r, 15));
  }
}

// time each candidate on this device with its probe (the first two encoder
// layers, weights filled in on load: a few hundred KB instead of the model)
async function probe({ list, threads }) {
  ort ||= await import(ORT + 'ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths = ORT;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? threads : 1;
  const feats = new Float32Array(125 * 160);
  for (let i = 0; i < feats.length; i++) feats[i] = Math.sin(i * 0.37) * 1.5; // 2.5 s worth of input
  const x = new ort.Tensor('float32', feats, [1, 125, 160]);
  for (const c of list) {
    try {
      const t0 = performance.now();
      const s = await ort.InferenceSession.create(BASE + `muaalem/probe/${c.variant}.onnx`, { executionProviders: [c.ep], graphOptimizationLevel: 'all' });
      const run = async () => { const o = await s.run({ input_features: x }); for (const v of Object.values(o)) { await v.getData(); v.dispose?.(); } };
      for (let i = 0; i < 3; i++) await run(); // warm up (GPU shaders compile here)
      const load = performance.now() - t0, ms = [];
      for (let i = 0; i < 7; i++) { const t = performance.now(); await run(); ms.push(performance.now() - t); }
      ms.sort((a, b) => a - b);
      await s.release?.();
      postMessage({ type: 'probed', id: c.id, ms: ms[3], load });
    } catch (e) {
      postMessage({ type: 'probed', id: c.id, error: String(e.message || e).slice(0, 160) });
    }
  }
  postMessage({ type: 'probedAll' });
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'probe') await probe(data);
    if (data.type === 'rate') rate = data.rate;
    if (data.type === 'warm') await warm();
    if (data.type === 'load') await load(data);
    if (data.type === 'recording') {
      record();
      const out = new Float32Array(recLen);
      let at = 0;
      for (const b of rec) { out.set(b, at); at += b.length; }
      postMessage({ type: 'recording', samples: out }, [out.buffer]);
    }
    if (data.type === 'start') {
      live = false; await looping;
      scoreAsked(); // (any still waiting: on what the last stretch heard)
      recUpTo = Math.max(recUpTo, written()); // what came in while not listening isn't kept
      base = written(); kept = []; keptP = []; keptA = []; keptL = []; readUpTo = 0; shownUpTo = 0; tid = []; tp = []; ta = [];
      lvAt = loudEnd = base;
      live = true; looping = loop();
    }
    // how well each of the texts fits the recitation's frames [from, to) (ctc.js), once they are final
    if (data.type === 'score') { asked.push(data); scoreAsked(); }
    if (data.type === 'audio') { // no shared memory: the page sends the samples
      const s = data.samples, w = written();
      for (let i = 0; i < s.length; i++) ring[(w + i) % ring.length] = s[i];
      time[0] = data.at; meta[0] = w + s.length;
    }
    if (data.type === 'flush') {
      live = false; await looping;
      record();
      if (written() - base > 0) await step(true);
      scoreAsked();
      postMessage({ type: 'flushed' });
    }
  } catch (e) {
    postMessage({ type: 'error', message: String(e.message || e) });
  }
};
