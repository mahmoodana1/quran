'use strict';

// The microphone and the recogniser behind التسميع. Audio is captured at
// 16 kHz and cut into phrases at the reader's pauses (as at a waqf); each
// phrase goes to asr-worker.js, which runs the Quran Whisper model in this
// browser. Nothing is sent anywhere.
const Listen = (() => {
  const MODEL = 'An0xity/whisper-base-ar-quran-onnx-timestamped';
  const MODEL_MB = 77;
  const RATE = 16000;
  const PAUSE = 0.7;     // s of quiet that ends a phrase
  const LONG = 7;        // s: past this, a breath (BREATH s) is enough
  const BREATH = 0.3;
  const MAX = 15;        // s: a longer phrase is cut here
  const PREROLL = 0.3;   // s kept from before the voice started
  const PARTIAL = 0.9;   // s of new voice between looks at the phrase so far

  let worker = null, ready = false, loading = null, onProgress = null;
  const files = {};      // model file -> [loaded, total] while downloading
  const waiting = new Map();
  let nextId = 0;

  function getWorker() {
    if (worker) return worker;
    worker = new Worker('asr-worker.js', { type: 'module' });
    worker.onmessage = ({ data: d }) => {
      if (d.type === 'progress') {
        files[d.file] = [d.loaded, d.total];
        const v = Object.values(files), got = v.reduce((s, x) => s + x[0], 0), all = v.reduce((s, x) => s + x[1], 0);
        onProgress?.(Math.min(1, got / Math.max(all, MODEL_MB * 1e6)));
      }
      if (d.type === 'ready') { ready = true; loading?.resolve(); }
      if (d.type === 'error') {
        if (d.id != null && waiting.has(d.id)) { waiting.get(d.id)(''); waiting.delete(d.id); }
        else { loading?.reject(new Error(d.message)); loading = null; }
      }
      if (d.type === 'text' && waiting.has(d.id)) { waiting.get(d.id)(d.text); waiting.delete(d.id); }
    };
    return worker;
  }

  // is the model saved in this browser?
  async function saved() {
    try {
      const keys = await (await caches.open('transformers-cache')).keys();
      return keys.filter(r => r.url.includes(MODEL) && r.url.endsWith('.onnx')).length >= 2;
    } catch { return false; }
  }

  // download (first time) or just load it from the cache
  function load(progress) {
    onProgress = progress;
    if (ready) return Promise.resolve();
    if (loading) return loading.promise;
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    loading = { promise, resolve, reject };
    getWorker().postMessage({ type: 'load' });
    return promise;
  }

  async function remove() {
    try {
      const c = await caches.open('transformers-cache');
      for (const r of await c.keys()) if (r.url.includes(MODEL)) await c.delete(r);
    } catch {}
    worker?.terminate();
    worker = null; ready = false; loading = null;
  }

  function transcribe(audio) {
    const id = nextId++;
    return new Promise(res => { waiting.set(id, res); getWorker().postMessage({ type: 'run', id, audio }, [audio.buffer]); });
  }

  // ---- the microphone

  let ctx = null, stream = null, node = null, src = null, mic = null;

  // make the audio context inside the tap that starts listening (iOS needs that)
  function prime() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      try { ctx = new AC({ sampleRate: RATE }); } catch { ctx = new AC(); }
    }
    ctx.resume?.();
  }

  // onPhrase(Float32Array at 16 kHz) at each pause, onVoice(true/false) as the
  // reader starts and stops, onPartial(the phrase so far) while they recite
  async function start(onPhrase, onVoice, onPartial) {
    prime();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    src = ctx.createMediaStreamSource(stream);
    node = ctx.createScriptProcessor(4096, 1, 1);
    const step = ctx.sampleRate / RATE;
    let floor = 0.01, voiced = false, quiet = 0, buf = [], pre = [], preLen = 0, fresh = 0;
    const joined = () => {
      const out = new Float32Array(buf.reduce((s, b) => s + b.length, 0));
      let o = 0;
      for (const b of buf) { out.set(b, o); o += b.length; }
      return out;
    };
    const flush = () => {
      if (buf.reduce((s, b) => s + b.length, 0) > RATE * 0.35) onPhrase(joined());
      buf = []; voiced = false; quiet = 0; fresh = 0;
      onVoice(false);
    };
    mic = { flush };
    node.onaudioprocess = e => {
      const x = e.inputBuffer.getChannelData(0);
      // to 16 kHz (linear) when the context runs at another rate; a copy
      // either way, as the browser reuses the input buffer
      let y;
      if (step === 1) y = new Float32Array(x);
      else {
        y = new Float32Array(Math.floor(x.length / step));
        for (let i = 0; i < y.length; i++) {
          const p = i * step, k = Math.floor(p), f = p - k;
          y[i] = x[k] * (1 - f) + (x[k + 1] ?? x[k]) * f;
        }
      }
      let e2 = 0;
      for (let i = 0; i < y.length; i++) e2 += y[i] * y[i];
      const rms = Math.sqrt(e2 / y.length);
      const loud = rms > Math.max(0.012, floor * 2.6);
      if (!voiced) floor = floor * 0.95 + Math.min(rms, 0.05) * 0.05;
      const dur = y.length / RATE;
      if (loud && !voiced) {
        voiced = true; quiet = 0;
        buf = pre.slice(); onVoice(true);
      }
      if (voiced) {
        buf.push(y);
        quiet = loud ? 0 : quiet + dur;
        const len = buf.reduce((s, b) => s + b.length, 0) / RATE;
        if (quiet >= (len >= LONG ? BREATH : PAUSE) || len >= MAX) flush();
        else if (onPartial && loud && (fresh += dur) >= PARTIAL) { fresh = 0; onPartial(joined()); }
      } else {
        pre.push(y); preLen += dur;
        while (preLen > PREROLL && pre.length > 1) preLen -= pre.shift().length / RATE;
      }
    };
    src.connect(node);
    node.connect(ctx.destination);
  }

  function stop() {
    node?.disconnect(); src?.disconnect();
    stream?.getTracks().forEach(t => t.stop());
    node = src = stream = mic = null;
  }

  return { MODEL_MB, saved, load, remove, transcribe, prime, start, stop, ready: () => ready, listening: () => !!stream };
})();
