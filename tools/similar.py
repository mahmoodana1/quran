# similar ayas (mutashabihat lafziyya) for memorizers: per Hafs aya, the other ayas worded like it,
# the same or nearly (a letter, a word, a conjunction, the order, apart), short ones too (الم, حم)
# run from the repo root: python3 tools/similar.py
# out: data/similar-hafs.json  {h: [[h2, closeness %, longest shared run of words], ...]} (h: Hafs aya index)
import json, re, collections, time
U = json.load(open('data/hafs.json'))['utext']
def norm(t):
    t = re.sub(r'\s*[٠-٩]+\s*$', '', t)
    t = re.sub(r'[ً-ٰٟۖ-ۭـ]', '', t)
    t = re.sub('[ٱأإآ]', 'ا', t).replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي')
    return [w for w in t.split() if w]
W = [norm(t) for t in U]
def bare(w): return w[1:] if len(w) > 3 and w[0] in 'وف' else w
def one(a, b):
    # one letter apart (يعملون / تعملون, ربك / ربكم)
    if abs(len(a) - len(b)) > 1 or min(len(a), len(b)) < 3: return False
    if len(a) == len(b): return sum(x != y for x, y in zip(a, b)) == 1
    if len(a) > len(b): a, b = b, a
    return any(b[:k] + b[k + 1:] == a for k in range(len(b)))
def near(x, y):
    # the same word, or one a memorizer mixes up with it: and/so (و، ف) apart, or a letter
    if x == y: return 1
    bx, by = bare(x), bare(y)
    return .8 if bx == by or one(bx, by) else 0
def lcs(a, b):
    p = [0] * (len(b) + 1)
    for x in a:
        q = [0]
        for j, y in enumerate(b): q.append(max(p[j] + near(x, y), p[j + 1], q[j]))
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
same = collections.defaultdict(list)
for i, w in enumerate(W): same[' '.join(bare(x) for x in w)].append(i)
gram = collections.defaultdict(set)
for i, w in enumerate(W):
    b = [bare(x) for x in w]
    for k in range(len(b) - 1): gram[tuple(b[k:k + 2])].add(i)
out, t0 = {}, time.time()
for i, a in enumerate(W):
    ab = [bare(x) for x in a]
    cand = collections.Counter(j for j in same[' '.join(ab)] if j != i)
    for k in range(len(ab) - 1):
        g = gram[tuple(ab[k:k + 2])]
        if len(g) <= 120: cand.update(g)
    res = []
    for j in cand:
        if j == i: continue
        b = W[j]; r = run(a, b); l = lcs(a, b); close = l / max(len(a), len(b))
        short = min(len(a), len(b))
        if close >= .99: res.append((j, 100, r)); continue  # the same aya, or said with و / ف apart
        if short <= 2: continue  # (two words shared is no likeness, a whole short aya is)
        # nearly the same aya, or a long phrase shared
        if close >= .6 or (close >= .5 and r >= 3) or r >= 5 or (r >= 4 and r >= .6 * short):
            res.append((j, min(99, round(100 * close)), r))
    res.sort(key=lambda x: (-x[1], -x[2], x[0]))
    if res: out[i] = [list(x) for x in res[:12]] + ([[-1, len(res), 0]] if len(res) > 12 else [])
json.dump(out, open('data/similar-hafs.json', 'w'), separators=(',', ':'))
print(len(out), 'ayas with similar ones;', round(time.time() - t0), 's')
