"""When each aya starts in a recitation that has no published timing (Qunbul:
Ahmad Deban), from another recitation of the same surah in the same count of
ayat that has one (al-Bazzi: Okasha Kameny, timed by mp3quran.net). Both are
Ibn Kathir's reading, so the words are the same nearly everywhere.

For each surah:
1. both recordings are decoded (8 kHz mono) into loudness and MFCCs with
   their deltas, every 10 ms;
2. a banded DTW lines up the two recordings by sound (0.5 s steps, then
   0.1 s around that path), which says where each of the timed reciter's aya
   starts falls in the other recording;
3. a dynamic programme then puts each aya start in a pause of the recording
   (a pause is favoured by its length), near where the DTW puts it, with aya
   lengths in proportion to the timed reciter's.

Tried on recitations whose timing is known (al-Susi by Abdul Rashid Sufi
against al-Duri by al-Husary; Qalun by al-Hudhaifi against Qalun by
al-Husary; 34 surahs, 2490 ayat): the median error is under 0.1 s, 1.4% of
the starts are more than 1 s off and 0.7% more than 3 s. Where a recording's
pauses hardly show (fewer than its ayat: much of Deban's juz' 'Amma), step 3
only moves each DTW place to the quietest point within a second (on the same
test: median 0.4 s, 2.9% more than 1 s off, 0.6% more than 3 s).

    python3 tools/align.py data/audio/bazzi.json data/audio/qumbul.json [features-dir]

Another recording than Deban's: TGT=<folder of its NNN.mp3> (Maher al-Muaiqly's
murattal of 1424-25, against his own timed recording of 1440, read 133).

Needs curl, ffmpeg, numpy, numba and librosa. The output holds {"t": [...]}
in the format of data/audio/*.json; tools/recitations.py adds the rest.
"""
import json
import os
import subprocess
import sys

import librosa
import numba
import numpy as np

QUNBUL = 'https://cdn.mp3quran.net/audio/ahmad-deeban/r3/'
P = dict(gsig=150, alpha=1.0, wd=6.0, wa=1.0, weak=1.5, pos=0.4, thr=25)


# ---------------------------------------------------------------- features

def features(url, cache=None):
    """loudness (dB) and MFCC 1-13 with deltas, every 10 ms"""
    path = cache and os.path.join(cache, url.replace('https://', '').replace('/', '_') + '.npz')
    if path and os.path.exists(path):
        z = np.load(path)
        return z['db'], z['mf']
    for attempt in range(3):
        c = subprocess.Popen(['curl', '-sS', '--fail', '--retry', '3', url], stdout=subprocess.PIPE)
        p = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
                           stdin=c.stdout, capture_output=True)
        if c.wait() == 0 and p.returncode == 0:
            break
    else:
        raise RuntimeError('could not read ' + url)
    x = np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32)
    n = len(x) // 80
    db = 10 * np.log10((x[:n * 80].reshape(n, 80) ** 2).mean(1) + 1)
    mf = librosa.feature.mfcc(y=x / 32768, sr=8000, n_mfcc=14, n_fft=256, hop_length=80, n_mels=32)[1:, :n].T
    if path:
        np.savez(path, db=db.astype(np.float32), mf=mf.astype(np.float32))
    return db, mf


def with_deltas(mf):
    return np.hstack([mf, librosa.feature.delta(mf.T, width=9).T])


# ---------------------------------------------------------------- DTW

@numba.njit(cache=True)
def _dtw(A, B, lo, hi):
    """banded DTW (row i spans columns lo[i]..hi[i]-1), cosine distance;
    the path as (row, column) pairs"""
    N, M = A.shape[0], B.shape[0]
    W = 0
    for i in range(N):
        W = max(W, hi[i] - lo[i])
    INF = 1e30
    prev = np.full(M + 1, INF)
    cur = np.full(M + 1, INF)
    dirs = np.zeros((N, W), dtype=np.int8)
    for i in range(N):
        for j in range(M + 1):
            cur[j] = INF
        for j in range(lo[i], hi[i]):
            d = 0.0
            for k in range(A.shape[1]):
                d += A[i, k] * B[j, k]
            c = 1.0 - d
            if i == 0 and j == 0:
                cur[j] = c
                continue
            best = INF
            arg = 0
            if i > 0 and j > 0 and prev[j - 1] < best:
                best = prev[j - 1]
                arg = 1
            if i > 0 and prev[j] < best:
                best = prev[j]
                arg = 2
            if j > 0 and cur[j - 1] < best:
                best = cur[j - 1]
                arg = 3
            cur[j] = best + c * (2.0 if arg == 1 else 1.0)
            dirs[i, j - lo[i]] = arg
        for j in range(M + 1):
            prev[j] = cur[j]
    path = np.zeros((N + M, 2), dtype=np.int64)
    i, j, n = N - 1, M - 1, 0
    while True:
        path[n, 0] = i
        path[n, 1] = j
        n += 1
        if i == 0 and j == 0:
            break
        a = dirs[i, j - lo[i]] if lo[i] <= j < hi[i] else 1
        if a == 1:
            i -= 1
            j -= 1
        elif a == 2:
            i -= 1
        elif a == 3:
            j -= 1
        else:
            break
        if i < 0 or j < 0:
            break
    return path[:n][::-1]


def _pool(mf, k):
    n = len(mf) // k
    x = mf[:n * k].reshape(n, k, -1).mean(1)
    x = (x - x.mean(0)) / (x.std(0) + 1e-6)
    return (x / (np.linalg.norm(x, axis=1, keepdims=True) + 1e-6)).astype(np.float64)


def mapping(mfa, mfb, coarse=50, fine=10, band=0.15, win=100):
    """for each 10*fine ms step of b, the matching 10 ms frame of a"""
    A, B = _pool(mfa, coarse), _pool(mfb, coarse)
    N, M = len(A), len(B)
    c = np.arange(N) * (M / N)
    w = int(band * M) + 60
    lo = np.clip(c - w, 0, M - 1).astype(np.int64)
    hi = np.clip(c + w + 1, 1, M).astype(np.int64)
    lo[0], hi[-1] = 0, M
    p = _dtw(A, B, lo, hi)
    A2, B2 = _pool(mfa, fine), _pool(mfb, fine)
    r = coarse // fine
    N2, M2 = len(A2), len(B2)
    cm = np.array([p[p[:, 0] == i, 1].mean() for i in range(N)])
    ctr = np.interp((np.arange(N2) + 0.5) / r - 0.5, np.arange(N), cm) * r + r / 2
    lo2 = np.clip(ctr - win, 0, M2 - 1).astype(np.int64)
    hi2 = np.clip(ctr + win + 1, 1, M2).astype(np.int64)
    lo2[0], hi2[-1] = 0, M2
    lo2 = np.minimum.accumulate(lo2[::-1])[::-1]
    hi2 = np.maximum.accumulate(hi2)
    p2 = _dtw(A2, B2, lo2, hi2)
    a_of_b = np.full(M2, np.nan)
    for j in range(M2):
        m = p2[:, 1] == j
        if m.any():
            a_of_b[j] = np.median(p2[m, 0])
    idx = np.arange(M2)
    ok = ~np.isnan(a_of_b)
    return np.interp(idx, idx[ok], a_of_b[ok]) * fine, fine


# ---------------------------------------------------------------- pauses

def silences(db, thr):
    L, floor = np.percentile(db, 90), np.percentile(db, 3)
    sil = db < max(L - thr, floor + 0.35 * (L - floor))
    runs, i, n = [], 0, len(db)
    while i < n:
        if sil[i]:
            j = i
            while j < n and sil[j]:
                j += 1
            if j - i >= 12:
                runs.append((i, j))
            i = j
        else:
            i += 1
    return runs, sil


def snap(db, guide, w):
    """each of `guide` (10 ms frames) moved to the quietest 100 ms within w,
    and within 40% of the way to the next and previous ones"""
    sm = np.convolve(db, np.ones(10) / 10, mode='same')
    out, prev = [], -1
    gs = np.asarray(guide, dtype=float)
    for k, g in enumerate(gs):
        wl = min(w, 0.4 * (g - gs[k - 1])) if k else w
        wr = min(w, 0.4 * (gs[k + 1] - g)) if k + 1 < len(gs) else w
        a, b = max(prev + 1, int(round(g - wl))), min(len(sm), int(round(g + wr)) + 1)
        prev = a + int(np.argmin(sm[a:b])) if b > a else prev + 1
        out.append(prev)
    return out


def place(db, ref, guide, p=P):
    """aya starts (10 ms frames) in pauses near `guide`, with lengths like ref's"""
    N, n = len(ref), len(db)
    runs, sil = silences(db, p['thr'])
    sp = np.where(~sil)[0]
    first, last = int(sp[0]), int(sp[-1]) + 1
    if len(runs) < N:
        # a noisy or echoing recording, whose pauses hardly show: the DTW's
        # places, each moved to the quietest point within a second
        return [int(x) * 10 for x in snap(db, guide, 100)], last * 10
    # candidates: in each pause (weighted by its length), and the quietest
    # points where ayat are joined without one
    cand = [(a + int(p['pos'] * (b - a)), b - a) for a, b in runs if a > first and b < last]
    sm = np.convolve(db, np.ones(10) / 10, mode='same')
    taken = np.zeros(n, dtype=bool)
    for a, b in runs:
        taken[max(0, a - 30):b + 30] = True
    cand += [(i, 0) for i in range(first + 30, last - 30, 5) if not taken[i] and sm[i] == sm[i - 30:i + 30].min()]
    cand.sort()
    t = np.array([first] + [c for c, _ in cand], dtype=float)
    w = np.array([0] + [x for _, x in cand], dtype=float)
    bonus = np.where(w > 0, p['alpha'] * np.log1p(w / 10.0), -p['weak'])
    bonus[0] = 0
    rs = np.array([s for s, _ in ref], dtype=float) / 10
    re_ = np.array([e for _, e in ref], dtype=float) / 10
    rd = re_ - rs
    scale = (last - first) / (re_[-1] - rs[0] * 0.5)
    exp = np.asarray(guide, dtype=float)
    INF = 1e18

    def dur(d, e):
        r = np.log(np.maximum(d, 1) / e)
        return p['wd'] * r * r

    def pull(x):
        return p['wa'] * (x / p['gsig']) ** 2

    cost = pull(t - exp[0]) - bonus
    cost[t > first + 0.5 * (last - first)] = INF
    backs = []
    for k in range(1, N):
        e = rd[k - 1] * scale
        lo = np.searchsorted(t, t - 2.8 * e - 150)
        hi = np.searchsorted(t, t - 0.35 * e, side='right')
        new = np.full(len(t), INF)
        arg = np.zeros(len(t), dtype=np.int64)
        anch = pull(t - exp[k]) - bonus
        for i in range(len(t)):
            a, b = lo[i], hi[i]
            if b <= a:
                continue
            c = cost[a:b] + dur(t[i] - t[a:b], e)
            m = int(np.argmin(c))
            new[i] = c[m] + anch[i]
            arg[i] = a + m
        backs.append(arg)
        cost = new
    fin = cost + dur(last - t, rd[-1] * scale)
    i = int(np.argmin(fin))
    if fin[i] >= INF / 2:
        # no path (lengths too far from the reference's): the DTW's places
        starts = np.maximum.accumulate(np.round(exp)).astype(int)
        return [int(x) * 10 for x in starts], last * 10
    B = [i]
    for arg in reversed(backs):
        i = int(arg[i])
        B.append(i)
    B.reverse()
    return [int(t[i]) * 10 for i in B], last * 10


def align_surah(tgt_url, ref_url, ref_rows, cache=None):
    db, mf = features(tgt_url, cache)
    _, rmf = features(ref_url, cache)
    a_of_b, f = mapping(with_deltas(mf), with_deltas(rmf))
    rs = np.array([s for s, _ in ref_rows], dtype=float) / 10
    guide = np.interp(rs / f, np.arange(len(a_of_b)), a_of_b)
    starts, end = place(db, ref_rows, guide)
    assert all(a < b for a, b in zip(starts, starts[1:] + [end])), 'aya starts out of order'
    return starts + [end]


if __name__ == '__main__':
    ref = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    cache = sys.argv[3] if len(sys.argv) > 3 else None
    done = json.load(open(out))['t'] if os.path.exists(out) else []
    T = list(done)
    for s in range(len(T) + 1, 115):
        t = ref['t'][s - 1]
        rows = list(zip(t[:-1], t[1:]))
        T.append(align_surah(f"{os.environ.get('TGT', QUNBUL)}{s:03d}.mp3", f"{ref['url']}{s:03d}.mp3", rows, cache))
        json.dump({'t': T}, open(out, 'w'), separators=(',', ':'))
        print(s, len(rows), 'ayat', flush=True)
