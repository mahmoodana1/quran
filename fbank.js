// The model's input, made here: 80 log-mel bands every 10 ms as Kaldi makes them (25 ms povey
// windows of the samples as 16-bit, DC removed, pre-emphasis 0.97, 512-point spectrum, mel 20 Hz to
// 8 kHz), which is what SeamlessM4TFeatureExtractor does; then each band brought to zero mean and
// unit variance over the stretch given, and frames joined two by two: [T, 160], 50 a second.
//
// Each 10 ms frame depends only on its own samples, so a stream keeps the ones it has made
// (Mel): a read makes only the frames that are new.
const N = 400, HOP = 160, FFT = 512, BINS = 80, HALF = FFT / 2 + 1;

const WINDOW = new Float32Array(N);
for (let i = 0; i < N; i++) WINDOW[i] = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)), 0.85);

// the mel bands: triangles in mel, over the spectrum's bins; each band's first bin and weights
const FILTERS = (() => {
  const mel = f => 1127 * Math.log(1 + f / 700), lo = mel(20), hi = mel(8000), out = [];
  const edge = m => lo + (hi - lo) * m / (BINS + 1);
  for (let m = 0; m < BINS; m++) {
    const l = edge(m), c = edge(m + 1), r = edge(m + 2), w = [];
    let first = -1;
    for (let k = 0; k < HALF; k++) {
      const x = mel(k * 16000 / FFT), v = Math.max(0, Math.min((x - l) / (c - l), (r - x) / (r - c)));
      if (v > 0) { if (first < 0) first = k; w[k - first] = v; }
    }
    out.push({ first, w: Float32Array.from(w, v => v || 0) });
  }
  return out;
})();

// the 512-point spectrum's power, in place (re, im: Float64Array(512))
const REV = new Uint16Array(FFT), COS = new Float64Array(FFT / 2), SIN = new Float64Array(FFT / 2);
for (let i = 0; i < FFT; i++) { let r = 0; for (let b = 0; b < 9; b++) r |= ((i >> b) & 1) << (8 - b); REV[i] = r; }
for (let i = 0; i < FFT / 2; i++) { COS[i] = Math.cos(2 * Math.PI * i / FFT); SIN[i] = -Math.sin(2 * Math.PI * i / FFT); }
const re = new Float64Array(FFT), im = new Float64Array(FFT), buf = new Float64Array(N);
function fft() {
  for (let size = 2; size <= FFT; size <<= 1) {
    const half = size >> 1, step = FFT / size;
    for (let s = 0; s < FFT; s += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step], sn = SIN[k * step], a = s + k, b = a + half;
        const xr = re[b] * c - im[b] * sn, xi = re[b] * sn + im[b] * c;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

// one frame: the 400 samples get(i), i from `at`, into out[o .. o + 80)
export function frame(get, at, out, o) {
  let mean = 0;
  for (let i = 0; i < N; i++) { buf[i] = get(at + i) * 32768; mean += buf[i]; }
  mean /= N;
  for (let i = 0; i < N; i++) buf[i] -= mean;
  for (let i = N - 1; i > 0; i--) buf[i] -= 0.97 * buf[i - 1];
  buf[0] *= 1 - 0.97;
  re.fill(0); im.fill(0);
  for (let i = 0; i < N; i++) re[REV[i]] = buf[i] * WINDOW[i];
  fft();
  for (let k = 0; k < HALF; k++) re[k] = re[k] * re[k] + im[k] * im[k];
  for (let m = 0; m < BINS; m++) {
    const { first, w } = FILTERS[m];
    let e = 0;
    for (let k = 0; k < w.length; k++) e += w[k] * re[first + k];
    out[o + m] = Math.log(Math.max(e, 1.192092955078125e-07));
  }
}

// the frames of a stream, each made once: frame f is of samples [160 f, 160 f + 400) (get(i): sample i)
// kept: how many frames back are held
export class Mel {
  constructor(get, kept = 1024) { this.get = get; this.kept = kept; this.ring = new Float32Array(kept * BINS); this.from = 0; this.to = 0; }
  // frames [a, b) made and held (a no earlier than b - kept)
  fill(a, b) {
    if (a < this.from || a > this.to) this.from = this.to = a; // (a jump: what was held is of no use)
    for (; this.to < b; this.to++) frame(this.get, this.to * HOP, this.ring, (this.to % this.kept) * BINS);
    this.from = Math.max(this.from, this.to - this.kept);
  }
  // the model's input for frames [a, b) (b - a even), each band normalized over frames [n0, n1): Float32Array((b - a) / 2 * 160)
  // (frames past `real`, not heard yet: silence's, as if the samples were zeros)
  features(a, b, n0 = a, n1 = b) {
    this.fill(Math.min(a, n0), Math.max(b, n1));
    const R = this.ring, K = this.kept, mean = new Float64Array(BINS), sd = new Float64Array(BINS), n = n1 - n0;
    for (let f = n0; f < n1; f++) { const o = (f % K) * BINS; for (let m = 0; m < BINS; m++) mean[m] += R[o + m]; }
    for (let m = 0; m < BINS; m++) mean[m] /= n;
    for (let f = n0; f < n1; f++) { const o = (f % K) * BINS; for (let m = 0; m < BINS; m++) { const d = R[o + m] - mean[m]; sd[m] += d * d; } }
    for (let m = 0; m < BINS; m++) sd[m] = 1 / Math.sqrt(sd[m] / Math.max(1, n - 1) + 1e-7);
    const out = new Float32Array((b - a) * BINS);
    for (let f = a; f < b; f++) { const o = (f % K) * BINS, p = (f - a) * BINS; for (let m = 0; m < BINS; m++) out[p + m] = (R[o + m] - mean[m]) * sd[m]; }
    return out;
  }
}

// samples -> the model's input, as the feature extractor gives it for them alone: { data, dims: [1, T, 160] }
export function features(x) {
  const frames = Math.max(0, 1 + Math.floor((x.length - N) / HOP)) & ~1;
  const mel = new Mel(i => x[i], Math.max(2, frames));
  return { data: mel.features(0, frames), dims: [1, frames / 2, 2 * BINS] };
}
export const FRAMES = { N, HOP, BINS };
