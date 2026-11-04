# data/words/<sura>.json and data/words/index.json: what the word long-pressed
# in Hafs means, and what it is, from the Quranpedia.net dumps (version below):
#   meanings.json.gz   غريب القرآن: word meanings per aya, from four books
#   morphology.json.gz the Quranic Arabic Corpus (corpus.quran.com, GNU GPL):
#                      each word's root, lemma and grammar
# (https://quranpedia.net/dumps; free to use in apps; republished here with
# credit to Quranpedia.net and the dump's version, as its license asks)
#   python tools/words.py data/hafs.json meanings.json.gz morphology.json.gz data/words
#
# <sura>.json: { aya: { w: [[root, lemma, grammar, lemma key] per mushaf word], g: [[from, to, book, meaning]] } }
#   (g: a word or phrase explained, as mushaf word indices [from, to])
# index.json: { books: [[name, author]], lemmas: { lemma: [ai * 256 + wi, …] }, roots: { root: count },
#   source: … }
import gzip, json, os, re, sys, collections

HAFS, MEAN, MORPH, OUT = sys.argv[1:5]
d = json.load(open(HAFS))
mean = json.load(gzip.open(MEAN))
morph = json.load(gzip.open(MORPH))
BOOKS = [491, 1424, 208, 327]  # السراج first: the plainest; then مخلوف, ابن الجوزي, ابن الهائم

MARKS = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')
def skel(t):
    # letters only, without the long vowels and hamza seats that Uthmani and
    # common spelling write differently (الصلوة / الصلاة)
    t = MARKS.sub('', t)
    t = re.sub('[ٱأإآ]', 'ا', t).replace('ى', 'ي').replace('ة', 'ه')
    return re.sub('[اويءؤئ]', '', t)

def words_of(ai):
    t = re.sub(r'\s*[٠-٩]+$', '', d['utext'][ai].strip()).split(' ')
    return [x for x in t if x]

M = {(x['surah'], x['ayah']): x['morphology']['words'] for x in morph['data']}
G = {(x['surah'], x['ayah']): x['meanings'] for x in mean['data']}
names = {}
for x in mean['data']:
    for m in x['meanings']: names[m['book_info']['id']] = [m['book_info']['name'], m['book_info']['author']]

out = collections.defaultdict(dict)
lemmas = collections.defaultdict(list)
roots = collections.Counter()
stats = collections.Counter()
for ai, (s, a, *_) in enumerate(d['ayas']):
    toks = words_of(ai)
    n = len(toks)
    W = [[w] for w in M.get((s, a), [])]
    # the mushaf writes some two words as one (يَبْنَؤُمَّ): join the pair it joins
    while len(W) > n:
        sk = [skel(t) for t in toks]
        k = next((k for k in range(len(W) - 1) if k < n and skel(''.join(x['text'] for x in W[k] + W[k + 1])) == sk[k]), None)
        if k is None: k = min(range(len(W) - 1), key=lambda k: sum(len(x['text']) for x in W[k] + W[k + 1]))
        W[k:k + 2] = [W[k] + W[k + 1]]
        stats['joined'] += 1
    if len(W) < n: stats['short'] += 1; W += [[]] * (n - len(W))
    ws = []
    for wi, parts in enumerate(W):
        stems = [g for x in parts for g in x['segments'] if g['role'] == 'stem']
        root = '+'.join(g['root'] for g in stems if g['root'])
        lemma = '+'.join(g['lemma'] for g in stems if g['lemma'])
        gram = ' + '.join(g['description'] for g in stems if g['description'])
        slug = next((g['lemma_slug'] for g in stems if g['lemma_slug']), '')
        ws.append([root, lemma, gram, slug])
        for g in stems:
            if g['lemma_slug']: lemmas[g['lemma_slug']].append(ai * 256 + wi)
            if g['root']: roots[g['root']] += 1
    sk = [skel(t) for t in toks]
    gl = []
    for m in G.get((s, a), []):
        b = m['book_info']['id']
        if b not in BOOKS: continue
        for e in m['words']:
            es = [skel(t) for t in re.split(r'\s+', e['text'].strip()) if skel(t)]
            if not es: continue
            hit = next((i for i in range(n - len(es) + 1) if sk[i:i + len(es)] == es), None)
            span = len(es)
            if hit is None: # the phrase's first word alone (a shorter spelling of the rest)
                hit = next((i for i in range(n) if sk[i] == es[0]), None); span = 1
            if hit is None:
                stats['unplaced'] += 1
                if os.environ.get('SHOW') and stats['unplaced'] % 150 == 0: print(s, a, e['text'], '|', ' '.join(toks), file=sys.stderr)
                continue
            stats['placed'] += 1
            meaning = re.sub(r'\s+', ' ', e['meaning']).strip()
            gl.append([hit, hit + span - 1, BOOKS.index(b), meaning])
    out[s][a] = {'w': ws, 'g': gl} if gl else {'w': ws}

os.makedirs(OUT, exist_ok=True)
for s, ayas in out.items():
    json.dump(ayas, open(os.path.join(OUT, f'{s}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump({
    'books': [names[b] for b in BOOKS],
    'lemmas': lemmas, 'roots': roots,
    'source': {'quranpedia': mean['license']['version'], 'morphology': morph['license']['version']},
}, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(dict(stats), file=sys.stderr)
