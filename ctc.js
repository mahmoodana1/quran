// How well a recitation's sounds, as the phonetic model heard them frame by frame (its
// log-probabilities, mu-worker.js), fit a text: the best path of the text through them (CTC,
// Viterbi). The text being known, an aya can be asked "said as written, or with these two words
// the other way round, or without this one?", each reading scored on the same frames, the best one
// winning by its margin. A fast reading the model writes out garbled still ranks so (the right
// text keeps the most likely path), where its first choices, matched letter by letter, don't.
//
// Each sound of the text is one step, held for as many frames as it is, or said again after a
// blank (a madd's run, a doubled letter: ررَ, ۦۦۦۦ, their lengths left out of it). The frames
// given may begin before the text and end after it (the aya's bounds are known only roughly): those
// are anything (each its likeliest sound, less FILL), so each reading finds where it lies.
// A reader may go back over words (to any word before, from the end of one, at a cost: BACK), in
// each reading alike: else a reading repeated fits the text poorly, and another better.
// A word given as null is any sounds at all (ANY: each frame its likeliest sound, less ANY_COST): the
// written word fitting about as well as that was said as written, not merely better than nothing.
export const FILL = 1, BACK = 10, ANY = -1, ANY_COST = 1;

// the words' sounds, by the model's ids (a sound repeated, once), and where each word begins
export function tokens(words, ids) {
  const out = [], starts = [];
  for (const w of words) {
    starts.push(out.length);
    if (w == null) { out.push(ANY); continue; }
    for (const c of w) {
      const v = ids.get(c);
      if (v != null && v !== out[out.length - 1]) out.push(v);
    }
  }
  // (a word whose first sound ran into the one before begins there)
  out.starts = starts.map(s => Math.min(s, Math.max(0, out.length - 1)));
  return out;
}

// L(t): the frame t's log-probabilities (blank = 0); frames [t0, t1); y: tokens()
export function score(L, t0, t1, y) {
  const N = y.length, S = 2 * N + 1, NEG = -1e30;
  if (!N || t1 <= t0) return NEG;
  // states: 2j blank before the (j+1)th sound, 2j+1 that sound
  const starts = y.starts || [0], W = starts.length;
  // the last sound of each word (state), and the word each sound ends, if any
  const ends = starts.map((s, i) => 2 * ((i + 1 < W ? starts[i + 1] : N) - 1) + 1);
  let a = new Float64Array(S).fill(NEG), b = new Float64Array(S);
  const back = new Float64Array(W);
  let pre = 0, post = NEG; // the frames before the text, and after it
  for (let t = t0; t < t1; t++) {
    const l = L(t);
    let top = l[0], said = -1e30;
    for (let v = 1; v < l.length; v++) { if (l[v] > top) top = l[v]; if (l[v] > said) said = l[v]; }
    const at = v => v === ANY ? said - ANY_COST : l[v];
    // going back: from the end of word j (its last sound, or the blank after it) to any word i <= j
    let m = NEG;
    for (let i = W - 1; i >= 0; i--) {
      const e = ends[i];
      if (e >= 1) m = Math.max(m, a[e], e + 1 < S ? a[e + 1] : NEG);
      back[i] = m - BACK;
    }
    b.fill(NEG);
    for (let s = 0; s < S; s++) {
      let m = a[s];
      if (s > 0 && a[s - 1] > m) m = a[s - 1];
      if (s & 1) {
        if (s > 1 && a[s - 2] > m) m = a[s - 2];
        if (s + 1 < S && a[s + 1] > m) m = a[s + 1]; // said again, after a blank
      }
      if (s <= 1 && pre > m) m = pre; // (begun here)
      if (m > NEG) b[s] = m + (s & 1 ? at(y[s >> 1]) : l[0]);
    }
    // (the word gone back to begins with its first sound, or the blank before it)
    for (let i = 0; i < W; i++) {
      const s = 2 * starts[i] + 1;
      if (back[i] > NEG / 2) {
        if (back[i] + at(y[starts[i]]) > b[s]) b[s] = back[i] + at(y[starts[i]]);
        if (back[i] + l[0] > b[s - 1]) b[s - 1] = back[i] + l[0];
      }
    }
    // (ended before this frame)
    post = Math.max(post, a[S - 1], a[S - 2]) + top - FILL;
    pre += top - FILL;
    [a, b] = [b, a];
  }
  const best = Math.max(post, a[S - 1], a[S - 2]);
  return best;
}

// The reading as a path through the words of a stretch of text (the ayas around the one being
// said): each word said in turn, or the reader going on from another place — the next word, a
// few words on, a word or two back, or the first word of any aya (ayas left out, gone back to) —
// with other sounds (ANY) between words where no word fits. One best path over all the frames, so
// a place is known by the words that follow it too: ayas of two words that begin alike are told
// apart by what comes after, which letters matched one aya at a time can't do.
// L(t): frame t's log-probabilities · words: each its sounds (tokens of one word, no starts) ·
// start[k]: word k begins an aya. -> [{ w, t, done } | { g: frames, t, after }] in order (t: frame)
export const P_GC = 4, P_IN = 3, P_SIL = 8, P_SKIP = 8, P_SKIPW = 1, P_JUMP = 9, P_BACK = 6;
export function path(L, t0, t1, words, start) {
  const T = t1 - t0, n = words.length, NEG = -1e30, base = [];
  if (T <= 0 || !n) return [];
  let S = 0;
  for (const y of words) { base.push(S); S += 2 * y.length; } // word k: sound j at base+2j+1, the blank before it (j > 0) at base+2j
  const P0 = S, G0 = S + n + 1; S += 2 * (n + 1); // place p = i + 1: silence after word i, other sounds after word i
  const X = words.map((y, k) => base[k] + 2 * y.length - 1);
  const merged = words.map((y, k) => k > 0 && y.length > 1 && y[0] === words[k - 1][words[k - 1].length - 1]);
  // from which places a word is gone to, and at what cost (from a word or the silence after it; from other sounds)
  const src = [], cst = [], cgs = [];
  const cost = (i, k) => k === i + 1 ? 0 : k <= i ? (start[k] || i - k <= 2 ? P_BACK : -1) : start[k] ? Math.min(P_JUMP, P_SKIP + P_SKIPW * (k - i - 1)) : k - i <= 4 ? P_SKIP + P_SKIPW * (k - i - 1) : -1;
  for (let k = 0; k < n; k++) {
    const s = [], c = [], g = [];
    for (let i = -1; i < n; i++) { const x = cost(i, k); if (x < 0) continue; s.push(i + 1); c.push(x); g.push(k === i + 2 ? 0 : x); }
    src.push(s); cst.push(c); cgs.push(g);
  }
  let a = new Float64Array(S).fill(NEG), b = new Float64Array(S).fill(NEG);
  const bp = new Int32Array(T * S);
  a[P0] = 0;
  for (let t = 0; t < T; t++) {
    const l = L(t0 + t), B = t * S;
    let top = l[0];
    for (let v = 1; v < l.length; v++) if (l[v] > top) top = l[v];
    const sound = top > l[0], lb = l[0] - (sound ? P_SIL : 0), gc = sound ? P_GC : 0;
    for (let k = 0; k < n; k++) {
      const y = words[k], s0 = base[k], ss = src[k], cc = cst[k], cg = cgs[k];
      let m = NEG, from = -1;
      for (let q = 0; q < ss.length; q++) {
        const p = ss[q], x = p > 0 ? X[p - 1] : -1;
        if (x >= 0 && a[x] - cc[q] > m) { m = a[x] - cc[q]; from = x; }
        if (a[P0 + p] - cc[q] > m) { m = a[P0 + p] - cc[q]; from = P0 + p; }
        if (a[G0 + p] - cg[q] > m) { m = a[G0 + p] - cg[q]; from = G0 + p; }
      }
      for (let j = 0; j < y.length; j++) {
        const s = s0 + 2 * j + 1;
        let v = a[s], f = s;
        if (j === 0) { if (m > v) { v = m; f = from; } }
        else {
          if (a[s - 1] > v) { v = a[s - 1]; f = s - 1; }
          if (y[j] !== y[j - 1] && a[s - 2] > v) { v = a[s - 2]; f = s - 2; }
          if (j === 1 && merged[k] && a[X[k - 1]] > v) { v = a[X[k - 1]]; f = X[k - 1]; } // (its first sound ran into the word before)
          const u = a[s - 1] > a[s - 2] ? s - 1 : s - 2;
          b[s - 1] = a[u] + l[0]; bp[B + s - 1] = u;
        }
        b[s] = v + l[y[j]]; bp[B + s] = f;
      }
    }
    for (let p = 0; p <= n; p++) {
      const x = p > 0 ? X[p - 1] : -1, ps = P0 + p, gs = G0 + p;
      let v = a[ps], f = ps;
      if (x >= 0 && a[x] > v) { v = a[x]; f = x; }
      b[ps] = v + lb; bp[B + ps] = f;
      let g = a[gs], gf = gs;
      if (v - P_IN > g) { g = v - P_IN; gf = f; }
      b[gs] = g + top - gc; bp[B + gs] = gf;
    }
    [a, b] = [b, a];
  }
  // (the reading may end in the middle of a word: the one being said)
  let end = P0;
  for (let s = 0; s < S; s++) if (a[s] > a[end]) end = s;
  const at = new Int32Array(T);
  for (let t = T - 1, s = end; t >= 0; t--) { at[t] = s; s = bp[t * S + s]; }
  const wordOf = s => { let k = n - 1; while (k > 0 && base[k] > s) k--; return k; };
  const segs = [];
  for (let t = 0; t < T; t++) {
    const s = at[t], last = segs[segs.length - 1];
    if (s >= G0) { if (last && last.g != null && last.after === s - G0 - 1) last.g++; else segs.push({ g: 1, after: s - G0 - 1, t: t0 + t }); }
    else if (s < P0) {
      const k = wordOf(s), first = s <= base[k] + 1 && t > 0 && at[t - 1] !== s && (at[t - 1] < base[k] || at[t - 1] > X[k]);
      if (!last || last.w !== k || (first && last.done)) segs.push({ w: k, t: t0 + t });
      if (s === X[k]) segs[segs.length - 1].done = true;
    }
  }
  return segs;
}
