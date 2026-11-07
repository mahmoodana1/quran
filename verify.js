'use strict';

// A second opinion in Hafs: the phonetic model (mu.js) hears a fast reading poorly
// (and a reader may hurry for a few words at any pace), swallowing whole words;
// deepdml's Quran Whisper tiny hears it far better, as words (without harakat). Each
// aya with a word marked left out or another is heard by it too, once done, and such
// a word that it heard in its place is not a mistake. It never marks anything itself: it writes the text it
// knows when unsure, so it is trusted only to say a word was there.
// Downloaded in the background when a recitation begins (about 110 MB, once), in its
// own worker (asr-worker.js), off the main thread; until it is ready, nothing is checked.
const Verify = (() => {
  const MODEL = 'deepdml/whisper-tiny-ar-quran-mix-norm';
  const DTYPE = { encoder_model: 'fp32', decoder_model_merged: 'q8' };
  const SURE = 0.6; // how like the word it heard must be (1 - edit distance / length)
  let worker = null, ready = false, failed = false, nextId = 0;
  const waiting = new Map();

  function load() {
    if (worker || failed) return;
    worker = new Worker('asr-worker.js', { type: 'module' });
    worker.onmessage = ({ data: d }) => {
      if (d.type === 'ready') ready = true;
      if (d.type === 'error') {
        if (d.id != null && waiting.has(d.id)) { waiting.get(d.id)(''); waiting.delete(d.id); }
        else { failed = true; worker?.terminate(); worker = null; waiting.forEach(r => r('')); waiting.clear(); }
      }
      if (d.type === 'text' && waiting.has(d.id)) { waiting.get(d.id)(d.text); waiting.delete(d.id); }
    };
    worker.postMessage({ type: 'load', model: MODEL, dtype: DTYPE });
  }

  // its text for 16 kHz audio ('' when not ready, or it failed); one at a time, in order
  // the voice in it, without the quiet either side (on silence it writes text of its own)
  function voiced(a) {
    const N = 1600, r = [];
    for (let i = 0; i + N <= a.length; i += N) { let e = 0; for (let k = i; k < i + N; k += 4) e += a[k] * a[k]; r.push(Math.sqrt(e / (N / 4))); }
    const top = Math.max(...r, 0), on = r.map(x => x > Math.max(top * 0.08, 0.004));
    const i0 = on.indexOf(true), i1 = on.lastIndexOf(true);
    if (i0 < 0) return null;
    return a.subarray(Math.max(0, (i0 - 3) * N), Math.min(a.length, (i1 + 5) * N));
  }
  // (begun in the middle of a word, it goes astray for the whole of it: the audio given begins up to
  // lead s early, and is cut at its quietest moment there, the pause before the aya)
  function quietest(a, lead) {
    const N = 1600;
    let best = 0, low = Infinity;
    for (let i = 0; i + N <= Math.min(a.length, lead * 16000); i += N / 2) {
      let e = 0;
      for (let k = i; k < i + N; k += 4) e += a[k] * a[k];
      if (e < low) { low = e; best = i + N / 2; }
    }
    return a.subarray(best);
  }
  let queue = Promise.resolve();
  function hear(audio, lead = 0) {
    audio = audio && voiced(lead ? quietest(audio, lead) : audio);
    if (!ready || !audio?.length) return Promise.resolve('');
    audio = audio.slice(); // (its own buffer, to hand over)
    const long = audio.length > 16000 * 29 ? { chunk_length_s: 30, stride_length_s: 5 } : {};
    const run = () => new Promise(r => {
      if (!worker) return r('');
      const id = ++nextId;
      waiting.set(id, r);
      worker.postMessage({ type: 'run', id, audio, opts: { max_new_tokens: 220, no_repeat_ngram_size: 4, ...long } }, [audio.buffer]);
    });
    return (queue = queue.then(run, run));
  }

  // the letters only, as it writes them (the Uthmani script's marks, the small alif and the
  // madd letters it leaves out; one form of alif, of ya, of hamza)
  const norm = w => w.normalize('NFC')
    .replace(/[ً-ٰٟۖ-ۭـۥۦ]/g, '')
    .replace(/[ٱأإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ؤئ]/g, 'ء')
    .replace(/[^ء-ي]/g, '');
  function like(a, b) {
    if (!a || !b) return 0;
    const n = a.length, m = b.length, d = Array.from({ length: n + 1 }, (_, i) => [i, ...Array(m).fill(0)]);
    for (let j = 1; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return 1 - d[n][m] / Math.max(n, m);
  }
  // which of the words (the aya's, in order) it heard: the two lined up in order, each word
  // with the heard word most like it (or two run together, as it often writes them)
  function heard(words, text) {
    const E = words.map(norm), H = text.split(/\s+/).map(norm).filter(Boolean);
    const n = E.length, m = H.length, S = (i, j) => { const s = like(E[i], H[j]); return s >= SURE ? s : 0; };
    const f = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      const two = j > 1 && like(E[i - 1], H[j - 2] + H[j - 1]) >= SURE ? f[i - 1][j - 2] + 1 : 0;
      f[i][j] = Math.max(f[i - 1][j], f[i][j - 1], f[i - 1][j - 1] + S(i - 1, j - 1), two);
    }
    const out = new Set();
    for (let i = n, j = m; i > 0 && j > 0;) {
      const s = S(i - 1, j - 1);
      if (s && f[i][j] === f[i - 1][j - 1] + s) { out.add(i - 1); i--; j--; }
      else if (j > 1 && like(E[i - 1], H[j - 2] + H[j - 1]) >= SURE && f[i][j] === f[i - 1][j - 2] + 1) { out.add(i - 1); i--; j -= 2; }
      else if (f[i][j] === f[i - 1][j]) i--;
      else j--;
    }
    // (words run together in what it wrote, ولم يجعل له as one: two or three of them, whose
    // joined letters are like one it wrote, which none of them alone is)
    for (let i = 0; i < n; i++) if (!out.has(i)) for (let j = 0; j < m; j++) {
      if ([i, i + 1, i + 2].some(x => x < n && like(E[x], H[j]) >= SURE)) continue;
      const k = [2, 3].find(c => i + c <= n && like(E.slice(i, i + c).join(''), H[j]) >= SURE);
      if (k) { for (let x = i; x < i + k; x++) out.add(x); break; }
    }
    return out;
  }

  return { load, hear, heard, norm, ready: () => ready };
})();
