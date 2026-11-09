# similar ayas (mutashabihat) for memorizers: per Hafs aya, the other ayas worded much like it
# run from the repo root: python3 tools/similar.py
# out: data/similar-hafs.json  {h: [[h2, closeness %, longest shared run of words], ...]} (h: Hafs aya index)
import json, re, collections, time
U = json.load(open('data/hafs.json'))['utext']
def norm(t):
    t = re.sub(r'\s*[٠-٩]+\s*$', '', t)
    t = re.sub(r'[ً-ٰٟۖ-ۭـ]', '', t)
    t = re.sub('[ٱأإآ]', 'ا', t).replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي')
    return [w for w in t.split() if w]
W = [norm(t) for t in U]
gram = collections.defaultdict(set)
for i, w in enumerate(W):
    for k in range(len(w) - 2): gram[tuple(w[k:k + 3])].add(i)
def lcs(a, b):
    p = [0] * (len(b) + 1)
    for x in a:
        q = [0]
        for j, y in enumerate(b): q.append(p[j] + 1 if x == y else max(p[j + 1], q[j]))
        p = q
    return p[-1]
def run(a, b):
    best, p = 0, [0] * (len(b) + 1)
    for x in a:
        q = [0]
        for j, y in enumerate(b):
            v = p[j] + 1 if x == y else 0; q.append(v); best = max(best, v)
        p = q
    return best
out, t0 = {}, time.time()
for i, a in enumerate(W):
    cand = collections.Counter()
    for k in range(len(a) - 2):
        g = gram[tuple(a[k:k + 3])]
        if len(g) <= 60: cand.update(g)
    res = []
    for j in cand:
        if j == i: continue
        b = W[j]; r = run(a, b)
        if r < 3: continue
        l = lcs(a, b); close = l / max(len(a), len(b))
        # nearly the same aya, or a long phrase shared
        if close >= 0.5 or r >= 5 or (r >= 4 and r >= 0.6 * min(len(a), len(b))):
            res.append((j, round(100 * close), r))
    res.sort(key=lambda x: (-x[1], -x[2], x[0]))
    if res: out[i] = [list(x) for x in res[:8]] + ([[-1, len(res), 0]] if len(res) > 8 else [])
json.dump(out, open('data/similar-hafs.json', 'w'), separators=(',', ':'))
print(len(out), 'ayas with similar ones;', round(time.time() - t0), 's')
