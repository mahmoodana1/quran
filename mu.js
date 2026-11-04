'use strict';

// the microphone as it is: the browser's echo cancellation, noise suppression and
// gain control are made for calls, and take recitation's long held sounds (madd,
// ghunna) and echo for noise to remove; the model evens out loudness itself
const RAW_MIC = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };

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
  // every device starts on 4-bit, on whichever of the CPU or the GPU runs it faster;
  // the bigger ones (a little more exact, two or three times the download) are
  // there to choose in the settings
  const BASE_IDS = ['q4-cpu', 'q4-gpu'];
  const PROBE_X = 12; // a full update takes about this many times the stand-in
  const threads = () => Math.min(4, navigator.hardwareConcurrency || 4);
  const now = () => performance.timeOrigin + performance.now();

  // the candidate chosen for this device: { id, ms } (ms: expected per update)
  const choice = () => {
    let c = store.get('mu.choice', null);
    // a bigger model chosen for the device before 4-bit was the start (not by hand): its 4-bit
    if (c && !BASE_IDS.includes(c.id) && !store.get('mu.big', false)) {
      const id = c.id.endsWith('gpu') ? 'q4-gpu' : 'q4-cpu';
      store.set('mu.choice', c = { id, ms: store.get('mu.bench', null)?.times?.[id] ?? null, at: Date.now() });
    }
    return c && CANDS.find(x => x.id === c.id) ? c : null;
  };
  const cand = () => CANDS.find(x => x.id === choice()?.id);
  const mb = () => cand()?.mb ?? 126;

  // ---- timing the candidates on this device
  async function gpuInfo() {
    try { const a = navigator.gpu && await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); return a ? { f16: a.features.has('shader-f16') } : null; } catch { return null; }
  }
  // onStep(done, total); resolves with the fastest 4-bit candidate, which becomes
  // the choice unless keep (a choice made by hand stays); all: the bigger ones too
  async function probe(onStep, keep = false, all = false) {
    const gpu = await gpuInfo();
    const list = CANDS.filter(c => (all || BASE_IDS.includes(c.id)) && !(c.ep === 'webgpu' && (!gpu || (c.f16 && !gpu.f16))));
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
    const runs = list.filter(c => res[c.id] && !res[c.id].error), base = runs.filter(c => BASE_IDS.includes(c.id));
    const ok = base.length ? base : runs;
    if (!ok.length) throw new Error('no model runs on this device');
    // the fastest 4-bit (the CPU when the GPU is no faster)
    const best = ok.sort((a, b) => res[a.id].ms - res[b.id].ms)[0];
    // each candidate's time, for choosing by hand in the settings: ms per update, null (doesn't
    // run here), or none yet (not tested); times from an earlier test are kept
    const times = { ...store.get('mu.bench', null)?.times };
    for (const c of CANDS) if (list.includes(c) || !gpu && c.ep === 'webgpu') times[c.id] = res[c.id] && !res[c.id].error ? Math.round(res[c.id].ms * PROBE_X) : null;
    store.set('mu.bench', { at: Date.now(), times, best: best.id });
    if (!choice() || !keep) store.set('mu.choice', { id: best.id, ms: times[best.id], at: Date.now() });
    else if (times[choice().id] != null) store.set('mu.choice', { ...choice(), ms: times[choice().id] }); // its time, fresh
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
  // which variants are downloaded: { q8: true, … }
  async function savedVariants() {
    const out = {};
    try {
      const m = await manifest(), cache = await caches.open('muaalem-lab');
      for (const [k, v] of Object.entries(m.variants)) {
        let all = true;
        for (const p of v.parts) if (!(await cache.match(partUrl(p)))) { all = false; break; }
        out[k] = all;
      }
    } catch {}
    return out;
  }
  // use this candidate from now on (its time from the last test, if any)
  function use(id) {
    if (!CANDS.some(c => c.id === id) || choice()?.id === id) return;
    store.set('mu.big', !BASE_IDS.includes(id));
    store.set('mu.choice', { id, ms: store.get('mu.bench', null)?.times?.[id] ?? null, at: Date.now() });
    reset();
  }
  // delete a downloaded variant (the one in use by default)
  async function remove(variant = cand()?.variant) {
    if (variant === cand()?.variant) reset();
    if (!variant) return;
    try {
      const v = (await manifest()).variants[variant], cache = await caches.open('muaalem-lab');
      for (const p of v.parts) await cache.delete(partUrl(p));
    } catch {}
  }

  let worker = null, ready = false, loading = null, onText = null, onFlushed = null, onRecording = null, shared = null, info = null;
  let fails = 0, onLost = null;
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
    // (kept across a reload of the model, as the microphone writes into it)
    if (!shared) shared = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
      ? { ring: new Float32Array(new SharedArrayBuffer(4 * 16000 * 30)), meta: new Int32Array(new SharedArrayBuffer(4)), time: new Float64Array(new SharedArrayBuffer(8)) }
      : null;
    return loading = new Promise((resolve, reject) => {
      worker = new Worker('mu-worker.js', { type: 'module' });
      worker.onmessage = ({ data: d }) => {
        if (d.type === 'progress') progress?.(d.loaded / d.total);
        if (d.type === 'ready') { ready = true; info = d; resolve(); }
        if (d.type === 'text') { fails = 0; trackPace(d); onText?.(d); }
        if (d.type === 'flushed') { const f = onFlushed; onFlushed = null; f?.(); }
        if (d.type === 'recording') { const f = onRecording; onRecording = null; f?.(d.samples); }
        if (d.type === 'error') {
          if (!ready) { reset(); reject(new Error(d.message)); return; }
          console.warn('Muaalem:', d.message);
          if (++fails >= 3) recover();
        }
      };
      worker.onerror = e => { if (!ready) { reset(); reject(new Error(e.message || 'worker failed')); } };
      worker.postMessage({ type: 'load', variant: c.variant, ep: c.ep, threads: threads(), shared });
    });
  }

  // the model stopped working while listening (on phones, the GPU is sometimes
  // taken back): load it again, from the cache, and tell the page (onLost), which
  // goes on from where the reading was
  function recover() {
    fails = 0;
    const m = mic;
    mic = null;
    if (m) { m.on = false; m.unwatch?.(); release(m); }
    const f = onFlushed; onFlushed = null; f?.();
    reset();
    load().then(() => onLost?.(), () => onLost?.(new Error('model lost')));
  }

  // ---- the microphone, captured on the audio thread (capture.js)
  let actx = null, tapReady = null, mic = null;
  function context() {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    tapReady = actx.audioWorklet.addModule('capture.js');
  }
  // inside the tap that starts listening (phones only allow sound from a tap)
  function prime() {
    if (!actx || actx.state === 'closed') context();
    actx.resume();
  }
  // handler({ final, tent, ms, lag }) as the reading grows
  async function start(handler) {
    onText = handler;
    if (mic) return;
    prime();
    mic = { on: true };
    try { await capture(mic); } catch (e) { mic = null; throw e; }
    paceLog = [];
    worker.postMessage({ type: 'start' });
    watch(mic);
  }
  // the microphone into the tap; m: the listening it is for
  async function capture(m) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_MIC });
    if (!m.on) { stream.getTracks().forEach(t => t.stop()); return; }
    await tapReady;
    const clock0 = now() - actx.currentTime * 1000;
    const node = new AudioWorkletNode(actx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { shared, clock0 } });
    m.fed = Date.now();
    node.port.onmessage = e => { m.fed = Date.now(); if (!shared) worker?.postMessage({ type: 'audio', samples: e.data.samples, at: e.data.at }); };
    node.connect(actx.destination); // silent
    const src = actx.createMediaStreamSource(stream);
    src.connect(node);
    Object.assign(m, { stream, src, node });
  }
  function release(m) {
    m.node?.port.postMessage('stop'); m.src?.disconnect(); m.node?.disconnect(); m.stream?.getTracks().forEach(t => t.stop());
    m.node = m.src = m.stream = null;
  }
  // phones stop the microphone or the sound behind the page's back (a call,
  // another app, the screen locked, a recitation played): when nothing comes in
  // while listening, take the microphone again, on a new audio engine if needed
  function watch(m) {
    let seen = shared ? Atomics.load(shared.meta, 0) : 0, busy = false;
    const kick = () => { if (actx && actx.state !== 'running' && actx.state !== 'closed') actx.resume(); };
    const tap = () => kick();
    const vis = () => { if (!document.hidden) kick(); };
    document.addEventListener('pointerdown', tap, true);
    document.addEventListener('visibilitychange', vis);
    m.unwatch = () => { clearInterval(m.timer); document.removeEventListener('pointerdown', tap, true); document.removeEventListener('visibilitychange', vis); };
    m.timer = setInterval(async () => {
      if (!m.on || busy || document.hidden) return;
      if (shared) { const w = Atomics.load(shared.meta, 0); if (w !== seen) { seen = w; m.fed = Date.now(); } }
      // held by the phone (a call, another app): only a tap brings it back; no new engine
      if (actx.state === 'suspended' || actx.state === 'interrupted') {
        kick(); m.fed = Date.now();
        m.held ||= Date.now();
        if (Date.now() - m.held > 2500 && !m.told) { m.told = true; toast('اضغط على الشاشة ليعود الميكروفون'); }
        return;
      }
      m.held = 0; m.told = false;
      const dead = m.stream?.getAudioTracks().some(t => t.readyState === 'ended');
      if (!dead && actx.state === 'running' && Date.now() - m.fed < 1500) return;
      // a few times a minute at most: past that, something else is wrong and taking
      // the microphone again and again would only make it worse
      m.tries = (m.tries || []).filter(t => Date.now() - t < 60000);
      if (m.tries.length >= 3) return;
      m.tries.push(Date.now());
      busy = true;
      try {
        await new Promise(r => setTimeout(r, 300));
        if (!m.on) return;
        if (!dead && shared && Atomics.load(shared.meta, 0) !== seen) return; // it came back by itself
        release(m);
        if (actx.state === 'closed') { context(); actx.resume(); }
        await capture(m);
      } catch { /* tried again next time */ } finally { busy = false; m.fed = Date.now(); }
    }, 1000);
  }
  // the handler only (the same reading goes on: the found aya takes it over)
  const listen = handler => { onText = handler; };
  // stop listening; resolves once the last of it has been read
  function stop() {
    const m = mic;
    mic = null;
    if (!m) return Promise.resolve();
    m.on = false; m.unwatch?.();
    release(m);
    return new Promise(r => { onFlushed = r; worker.postMessage({ type: 'flush' }); });
  }

  // ---- the last minutes heard, as a WAV file (16 kHz, 16-bit), to share when
  // the recognition goes wrong; null when nothing was heard yet
  function recording() {
    if (!worker || !ready) return Promise.resolve(null);
    return new Promise(r => { onRecording = r; worker.postMessage({ type: 'recording' }); }).then(x => {
      if (!x || !x.length) return null;
      const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
      const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
      v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, x.length * 2, true);
      for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 0x7fff, true);
      return new Blob([buf], { type: 'audio/wav' });
    });
  }

  // ---- the reader's pace: sounds per second over the last PACE_WIN s read (a
  // pause counts little), followed as it changes; the references heard from the
  // PACE_N reciters nearest it are the ones that count (all, until it is known)
  const PACE_WIN = 12, PACE_N = 3;
  let paceLog = [], pace = 0, paceMask = 0;
  function trackPace(d) {
    if (!refs || d.end == null) return;
    const u = Match.units(d.final).length;
    if (paceLog.length && d.end < paceLog[paceLog.length - 1][0]) paceLog = [];
    paceLog.push([d.end, u]);
    while (d.end - paceLog[0][0] > PACE_WIN) paceLog.shift();
    let du = 0, act = 0;
    for (let i = 1; i < paceLog.length; i++) {
      const dt = paceLog[i][0] - paceLog[i - 1][0], dd = paceLog[i][1] - paceLog[i - 1][1];
      if (dd > 0) { du += dd; act += dt; } else act += Math.min(dt, 0.25);
    }
    if (act < 4 || du < 15) return;
    pace = du / act;
    const near = refs.r.map(([, p], i) => [Math.abs(p - pace), i]).sort((a, b) => a[0] - b[0]).slice(0, PACE_N);
    const mask = near.reduce((m, [, i]) => m | 1 << i, 0);
    if (mask !== paceMask) { paceMask = mask; cache.clear(); }
  }

  // ---- how each aya sounds: [phonetic script, word ranges, words starting with ٱ]
  // and, per aya, how real reciters reading it right were heard where the rules
  // alone would mark them, and who said it: { r: [[reciter, pace]], a: { ai: { wi: { heard: reciters (bits) } } } }
  // (data/refs-hafs.json; optional). Only the reciters nearest the reader's pace count.
  let phon = null, phonLoading = null, refs = null;
  function sounds() {
    return phonLoading ||= Promise.all([
      fetch(`data/phon-hafs.json?v=${DATA_VERSION}`).then(r => r.json()).then(d => { phon = d; }),
      fetch(`data/refs-hafs.json?v=${DATA_VERSION}p`).then(r => r.ok ? r.json() : null).then(d => { refs = d?.a ? d : null; }, () => {}),
    ]);
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
    const r = refs?.a[ai];
    if (r) {
      e.refs = [];
      for (const wi in r) if (wi >= w0) {
        const vs = Object.keys(r[wi]).filter(v => !paceMask || r[wi][v] & paceMask);
        if (vs.length) e.refs[wi - w0] = vs;
      }
    }
    if (cache.size > 400) cache.clear();
    cache.set(key, e);
    return e;
  }
  // two of them read one after the other
  function expect2(a, b) {
    const k = a.ph + '|' + b.ph;
    if (cache.has(k)) return cache.get(k);
    const n = a.ph.length, e = { ph: a.ph + b.ph, spans: a.spans.concat(b.spans.map(([x, y]) => [x + n, y + n])), wasl: a.wasl.concat(b.wasl.map(k => k + a.spans.length)) };
    if (a.refs || b.refs) { e.refs = []; a.refs?.forEach((v, i) => { e.refs[i] = v; }); b.refs?.forEach((v, i) => { e.refs[i + a.spans.length] = v; }); }
    cache.set(k, e);
    return e;
  }

  // ---- where in the Quran a reading is: its sounds reduced to their consonants
  // (with the sounds the model confuses as one), and the whole Quran as one run
  // of them; each three-letter run the reading shares with a place votes for
  // where the reading began there, and the places with most votes are checked
  // word by word (begun at any word, read on into the ayas after)
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
  // the Quran's skeleton, each of its letters' aya and word, each aya's first
  // word counted from the Quran's start, and where each three-letter run is
  let quran = null;
  function whole() {
    if (quran) return quran;
    const at = [], word0 = new Int32Array(phon.length + 1);
    let s = '', last = '', g = 0;
    phon.forEach(([ph, sp], ai) => {
      word0[ai] = g;
      for (let w = 0; w < sp.length / 2; w++, g++) {
        for (let k = sp[2 * w]; k < sp[2 * w + 1]; k++) {
          const c = ph[k];
          if (!LETTERS.test(c)) continue;
          const f = FOLD[c] || c;
          if (f === last) continue;
          s += f; last = f; at.push(g);
        }
      }
    });
    word0[phon.length] = g;
    const grams = new Map();
    for (let i = 0; i + 3 <= s.length; i++) {
      const k = s.slice(i, i + 3);
      let l = grams.get(k);
      if (!l) grams.set(k, l = []);
      l.push(i);
    }
    // a word counted from the Quran's start: its aya, and its place in it
    const where = g => { let lo = 0, hi = phon.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (word0[mid] <= g) lo = mid; else hi = mid - 1; } return [lo, g - word0[lo]]; };
    return quran = { s, at: Int32Array.from(at), word0, grams, where };
  }
  // what readers say before the aya: an isti'adha (in any of its usual forms)
  // and the basmala, both or one; the isti'adha's last word as said joined on too
  const ISTIADHA = [
    ['ءَعُۥۥذُ', 'بِللَااهِ', 'سسَمِۦۦعِ', 'لعَلِۦۦمِ', 'مِنَ', 'ششَيطَاانِ', 'ررَجِۦۦمِ', 'مِن', 'هَمزِهِۦۦ', 'وَنَفخِهِۦۦ', 'وَنَفثِه'],
    ['ءَعُۥۥذُ', 'بِللَااهِ', 'سسَمِۦۦعِ', 'لعَلِۦۦمِ', 'مِنَ', 'ششَيطَاانِ', 'ررَجِۦۦۦۦم'],
    ['ءَعُۥۥذُ', 'بِللَااهِ', 'لعَظِۦۦمِ', 'مِنَ', 'ششَيطَاانِ', 'ررَجِۦۦۦۦم'],
    ['ءَستَعِۦۦذُ', 'بِللَااهِ', 'مِنَ', 'ششَيطَاانِ', 'ررَجِۦۦۦۦم'],
    ['ءَعُۥۥذُ', 'بِللَااهِ', 'مِنَ', 'ششَيطَاانِ', 'ررَجِۦۦۦۦم'],
  ];
  const BASMALA = ['بِسمِ', 'للَااهِ', 'ررَحمَاانِ', 'ررَحِۦۦۦۦم'];
  const joined = f => f[f.length - 1] === 'ررَجِۦۦۦۦم' ? [...f.slice(0, -1), 'ررَجِۦۦمِ'] : f;
  // longest first: an isti'adha and a basmala are found as both, not as the isti'adha alone
  const OPENINGS = [
    ...ISTIADHA.flatMap(f => [[...f, ...BASMALA], [...joined(f), ...BASMALA]].map(w => [w, true])),
    ...ISTIADHA.flatMap(f => [f, joined(f)].map(w => [w, false])),
    [BASMALA, true],
  ].filter(([w], i, all) => all.findIndex(([v]) => v.join() === w.join()) === i).map(([words, basmala]) => {
    const e = { ph: '', spans: [], wasl: [], basmala };
    for (const w of words) { e.spans.push([e.ph.length, e.ph.length + w.length]); e.ph += w; }
    e.m = Match.units(e.ph).length; e.first = Match.text(Match.units(e.ph).slice(0, 1));
    return e;
  });
  // what an isti'adha or basmala said first takes: { cut: heard units (0: none),
  // basmala: it ends with one }, or null: one is being said, so wait for the rest;
  // noBasmala: the aya read is al-Fatiha's first, the basmala itself
  const HARAKA = /^[\u064B-\u0652\u06E5\u06E6]+$/;
  function opening(heard, noBasmala = false) {
    const U = Match.units(heard);
    for (const e of OPENINGS) {
      if (noBasmala && e.basmala) continue;
      if (U.length && Match.text(U.slice(0, 1)) !== e.first) continue; // its first sound, as itself (not فَ for its ءَ)
      if (U.length < e.m + 3) {
        // all that was heard is its beginning, said right
        const st = Match.words(e, heard, heard.length, false), said = st.filter(x => x.state !== 'todo');
        if (said.length && st[0].state !== 'todo' && st[0].at?.[0] <= 1 && said.every(x => x.state !== 'err') && said[said.length - 1].at?.[1] >= U.length - 3) return null;
        continue;
      }
      // the shortest start of the reading that is all of it, said right
      for (let x = -3; x <= 3; x++) {
        const pre = Match.text(U.slice(0, e.m + x)), st = Match.words(e, pre, pre.length, true);
        if (st.filter(y => y.state !== 'ok').length > (st.length >= 4 ? 1 : 0) || st[0].state !== 'ok' || st[st.length - 1].state !== 'ok') continue;
        // the last word's haraka, when it was joined on to the aya, goes with it
        let cut = st[st.length - 1].at[1];
        while (cut < U.length && HARAKA.test(Match.text(U.slice(cut, cut + 1)))) cut++;
        return { cut, basmala: e.basmala };
      }
    }
    return { cut: 0, basmala: false };
  }
  const BUCKET = 8;    // letters: starts this close vote together
  const COMMON = 4000; // a run found in more places than this says little
  // the places a reading most likely began, best first: [{ ai, w, g, fit, ok, err }]
  // (fit: how many of the heard sounds its words said right account for, so the
  // same reading fits the same text equally wherever it is; ok, err: its words
  // heard right and wrong there; g: the word counted from the Quran's start)
  function locate(heard, conf, alts, n = 10) {
    // an isti'adha or a basmala said first is set aside (the basmala is al-Fatiha's
    // first aya here, which would be found instead of the aya read after it)
    const lead = opening(heard);
    if (lead === null) return [];
    if (lead.cut > 0) {
      const U = Match.units(heard), rest = Match.text(U.slice(lead.cut));
      const found = locate(rest, conf && Match.unitConf(heard, conf).slice(lead.cut), alts && Match.unitAlts(heard, alts).slice(lead.cut), n);
      // al-Fatiha read from its start, its basmala and all: from its basmala
      if (lead.basmala) for (const x of found) if (x.ai === 1 && x.w === 0) Object.assign(x, { ai: 0, g: 0 });
      return found;
    }
    const q = whole(), h = skeleton(heard).slice(0, 160), votes = new Map();
    for (let i = 0; i + 3 <= h.length; i++) {
      const l = q.grams.get(h.slice(i, i + 3));
      if (!l || l.length > COMMON) continue;
      for (const p of l) { const b = Math.floor((p - i) / BUCKET); votes.set(b, (votes.get(b) || 0) + 1); }
    }
    const v = b => votes.get(b) || 0;
    const tops = [...votes.keys()].map(b => [b, v(b) + Math.max(v(b - 1), v(b + 1))]).sort((x, y) => y[1] - x[1]);
    const picked = [], out = [];
    for (const [b] of tops) {
      if (picked.length >= n) break;
      if (picked.some(c => Math.abs(c - b) <= 2)) continue;
      picked.push(b);
      // from a little before where the vote says, words enough for what was heard
      const p0 = Math.max(0, Math.min(q.s.length - 1, (b - 1) * BUCKET)), g0 = q.at[p0];
      const pEnd = Math.min(q.s.length - 1, p0 + BUCKET * 3 + Math.ceil(h.length * 1.5) + 16), g1 = q.at[pEnd] + 1;
      const ex = { ph: '', spans: [], wasl: [] }, words = [];
      for (let g = g0; g < g1;) {
        const [ai, w] = q.where(g), e = expect(ai, w), k = Math.min(e.spans.length, g1 - g), o = ex.ph.length;
        const cut = e.spans[k - 1][1];
        e.wasl.forEach(x => { if (x < k) ex.wasl.push(x + ex.spans.length); });
        for (let i = 0; i < k; i++) { ex.spans.push([e.spans[i][0] + o, e.spans[i][1] + o]); words.push(g + i); }
        ex.ph += e.ph.slice(0, cut);
        g += k;
      }
      const st = Match.words(ex, heard, heard.length, false, { freeLead: true, freeStart: true, conf, alts });
      const first = st.findIndex(x => x.state !== 'pre');
      if (first < 0) continue;
      const ok = st.filter(x => x.state === 'ok').length, err = st.filter(x => x.state === 'err').length;
      const said = new Uint8Array(heard.length + 1);
      for (const x of st) if (x.state === 'ok' && x.at) for (let k = x.at[0]; k < x.at[1]; k++) said[k] = 1;
      const g = words[first], [ai, w] = q.where(g);
      if (ai === 0) continue; // a basmala alone is not where a reading is
      out.push({ ai, w, g, fit: said.reduce((a, b) => a + b, 0), ok, err });
    }
    // the same place found from two votes: once, at its best
    out.sort((x, y) => y.fit - x.fit || x.err - y.err);
    return out.filter((x, i) => !out.slice(0, i).some(y => Math.abs(y.g - x.g) <= 1));
  }

  return {
    CANDS, BASE_IDS, choice, mb, probe, saved, savedVariants, use, bench: () => store.get('mu.bench', null), remove, load, prime, start, listen, stop, sounds, expect, expect2, locate, opening,
    ready: () => ready, listening: () => !!mic, pace: () => ({ pace, near: refs ? refs.r.filter((_, i) => paceMask & 1 << i).map(([r]) => r) : [] }), lost: f => { onLost = f; }, sound: () => actx, info: () => info, recording,
    reprobe: () => { store.set('mu.choice', null); reset(); },
  };
})();
