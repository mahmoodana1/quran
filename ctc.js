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
export const FILL = 1, BACK = 10;

// the words' sounds, by the model's ids (a sound repeated, once), and where each word begins
export function tokens(words, ids) {
  const out = [], starts = [];
  for (const w of words) {
    starts.push(out.length);
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
    let top = l[0];
    for (let v = 1; v < l.length; v++) if (l[v] > top) top = l[v];
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
      if (m > NEG) b[s] = m + l[s & 1 ? y[s >> 1] : 0];
    }
    // (the word gone back to begins with its first sound, or the blank before it)
    for (let i = 0; i < W; i++) {
      const s = 2 * starts[i] + 1;
      if (back[i] > NEG / 2) {
        if (back[i] + l[y[starts[i]]] > b[s]) b[s] = back[i] + l[y[starts[i]]];
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
