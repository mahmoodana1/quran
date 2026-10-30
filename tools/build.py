"""Build compact per-riwaya page layouts for the Quran PWA.

Hafs line breaks come from quran.com (KFGQPC Hafs mushaf). For the other
riwayat KFGQPC only gives the start/end line of each aya, so word-level line
breaks are solved with a DP that keeps every line close to the same natural
width (measured with the riwaya's own font via HarfBuzz).
"""
import difflib
import glob
import json
import os
import re
import sys

import uharfbuzz as hb

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'dl', 'quran-data-kfgqpc')
OUT = sys.argv[1]
LINES = 15
DIGITS = re.compile(r'^[٠-٩]+$')

RIWAYAT = [
    ('hafs', 'حفص عن عاصم'),
    ('shouba', 'شعبة عن عاصم'),
    ('warsh', 'ورش عن نافع'),
    ('qaloon', 'قالون عن نافع'),
    ('doori', 'الدوري عن أبي عمرو'),
    ('soosi', 'السوسي عن أبي عمرو'),
    ('bazzi', 'البزي عن ابن كثير'),
    ('qumbul', 'قنبل عن ابن كثير'),
]


def norm(w):
    w = re.sub('[ٱأإآ]', 'ا', w)
    w = w.replace('ى', 'ي').replace('ة', 'ه')
    w = w.replace('ؤ', 'و').replace('ئ', 'ي')
    return ''.join(c for c in w if 'ا' <= c <= 'ي' and c != 'ـ')


def load_riwaya_json(r):
    return json.load(open(glob.glob(f'{SRC}/{r}/data/*.json')[0]))


# ---------- Hafs reference (quran.com words with line numbers) ----------
hafs_words = []   # per aya: list of (text, page, line)
hafs_meta = []    # per aya: (s, a, juz, rub)
for p in range(1, 605):
    for v in json.load(open(f'{HERE}/qcom/{p}.json'))['verses']:
        s, a = map(int, v['verse_key'].split(':'))
        hafs_meta.append((s, a, v['juz_number'], v['rub_el_hizb_number']))
        # word page_number is unreliable at page edges; ayas never span pages in
        # this mushaf, so the page we fetched the verse from is authoritative
        hafs_words.append([(w['text_qpc_hafs'], p, w['line_number']) for w in v['words']])
assert len(hafs_meta) == 6236
hafs_emlaey = [a['aya_text_emlaey'] for a in load_riwaya_json('hafs')]
chapters = json.load(open(f'{HERE}/chapters.json'))['chapters']

# hafs word stream per surah for alignment
hafs_sura_words = {}
for i, a in enumerate(load_riwaya_json('hafs')):
    s = hafs_meta[i][0]
    for t in a['aya_text'].split():
        n = norm(t)
        if n and not DIGITS.match(t):
            hafs_sura_words.setdefault(s, []).append((n, i))


def gline(page, line):
    return (page - 1) * LINES + (line - 1)


def build_riwaya(r):
    font = hb.Font(hb.Face(hb.Blob.from_file_path(glob.glob(f'{SRC}/{r}/font/*.ttf')[0])))
    cache = {}

    def width(t):
        if t not in cache:
            buf = hb.Buffer()
            buf.add_str(t)
            buf.guess_segment_properties()
            hb.shape(font, buf, {})
            cache[t] = sum(g.x_advance for g in buf.glyph_positions)
        return cache[t]

    space = width(' ')

    data = load_riwaya_json(r)
    tok_text, tok_aya, bounds = [], [], []
    ayas = []
    for i, a in enumerate(data):
        pages = [int(x) for x in str(a['page']).split('-')]
        gs, ge = gline(pages[0], a['line_start']), gline(pages[-1], a['line_end'])
        bounds.append((gs, ge))
        ts = a['aya_text'].split()
        if not DIGITS.match(ts[-1]):
            print(r, 'no end marker', a.get('sura_no') or a['sora'], a['aya_no'], file=sys.stderr)
        for t in ts:
            tok_text.append(t)
            tok_aya.append(i)
        ayas.append([a.get('sura_no') or a['sora'], a['aya_no'], pages[0], a['jozz']])
    sura_of = [a[0] for a in ayas]
    n = len(tok_text)
    W = [width(t) for t in tok_text]
    first = [k == 0 or tok_aya[k - 1] != tok_aya[k] for k in range(n)]
    last = [k == n - 1 or tok_aya[k + 1] != tok_aya[k] for k in range(n)]
    nlines = len({l for gs, ge in bounds for l in range(gs, ge + 1)})
    target = (sum(W) + space * (n - nlines)) / nlines
    # pages 1-2 are short centred lines; let them balance freely
    # each page is set to its own measure: aim every line at the page average
    pw, pl = {}, {}
    for k in range(n):
        pg = bounds[tok_aya[k]][0] // LINES
        pw[pg] = pw.get(pg, 0) + W[k] + space
    for gs, ge in bounds:
        for l in range(gs, ge + 1):
            pl.setdefault(l // LINES, set()).add(l)
    ptarget = {pg: (pw.get(pg, 0) - space * len(ls)) / len(ls) for pg, ls in pl.items()}
    tgt = lambda L: ptarget.get(L // LINES, target)

    INF = float('inf')
    best = [dict() for _ in range(n + 1)]  # best[i][L] = (cost, prev_i, prev_L)
    best[0][bounds[0][0]] = (0.0, None, None)
    for i in range(n):
        if i and (DIGITS.match(tok_text[i]) or tok_text[i - 1] == '۞'):
            continue  # a line never starts with an aya marker or right after ۞
        for L, (c0, _, _) in list(best[i].items()):
            w = -space
            for j in range(i + 1, min(n, i + 40) + 1):
                k = j - 1
                gs, ge = bounds[tok_aya[k]]
                if not (gs <= L <= ge) or (first[k] and gs != L):
                    break
                w += W[k] + space
                if last[k] and ge != L:
                    continue  # aya must continue past this line
                t = tgt(L)
                cost = c0 + ((w - t) ** 2 if t else 0)
                if j == n:
                    nxt = L
                else:
                    ngs, nge = bounds[tok_aya[j]]
                    if first[j]:
                        if ngs <= L:
                            continue
                        nxt = ngs
                    else:
                        nxt = L + 1
                        if nxt > nge:
                            continue
                if cost < best[j].get(nxt, (INF,))[0]:
                    best[j][nxt] = (cost, i, L)
                if t and w > target * 1.5:
                    break
    if not best[n]:
        raise SystemExit(f'{r}: DP found no layout')
    # backtrack
    L = min(best[n], key=lambda x: best[n][x][0])
    j = n
    line_of = [0] * n
    while j > 0:
        _, i, Lp = best[j][L]
        for k in range(i, j):
            line_of[k] = Lp
        j, L = i, Lp
    toks = [(tok_aya[k], tok_text[k], line_of[k]) for k in range(n)]

    # audio / rub mapping through word alignment with Hafs
    by_sura = {}
    if r == 'hafs':  # the reference itself: identity mapping
        for i, a in enumerate(ayas):
            a += [hafs_meta[i][3], i, i]
    for k in range(n):
        nk = norm(tok_text[k])
        if nk and not DIGITS.match(tok_text[k]):
            by_sura.setdefault(sura_of[tok_aya[k]], []).append((nk, tok_aya[k]))
    for s, rw in (by_sura.items() if r != 'hafs' else ()):
        hw = hafs_sura_words[s]
        sm = difflib.SequenceMatcher(None, [x[0] for x in hw], [x[0] for x in rw], autojunk=False)
        mp = [None] * len(rw)
        for blk in sm.get_matching_blocks():
            for d in range(blk.size):
                mp[blk.b + d] = blk.a + d
        prev = 0
        for q in range(len(rw)):  # fill gaps with the last matched position
            if mp[q] is None:
                mp[q] = min(prev + 1, len(hw) - 1) if q else 0
            prev = mp[q]
        for q, (_, ai) in enumerate(rw):
            h = hw[mp[q]][1]
            if len(ayas[ai]) == 4:
                ayas[ai] += [None, h, h]
            ayas[ai][5] = min(ayas[ai][5], h)
            ayas[ai][6] = max(ayas[ai][6], h)
    prev_h = 0
    for a in ayas:
        if len(a) == 4:  # aya with no alignable words
            a += [None, prev_h, prev_h]
        a[4] = hafs_meta[a[5]][3]
        prev_h = a[6]

    # ---------- assemble pages ----------
    nP = max(t[2] for t in toks) // LINES + 1
    grid = [[None] * LINES for _ in range(nP)]
    for ai, t, g in toks:
        line = grid[g // LINES][g % LINES]
        if line is None:
            line = grid[g // LINES][g % LINES] = []
        if line and line[-1][0] == ai:
            line[-1][1] += ' ' + t
        else:
            line.append([ai, t])

    flat = [l for pg in grid for l in pg]
    starts = {}
    for ai, t, g in toks:
        if ayas[ai][1] == 1 and ayas[ai][0] not in starts:
            starts[ayas[ai][0]] = g
    fatiha_basmala_is_aya = r in ('hafs', 'shouba', 'bazzi', 'qumbul')
    for s, g in starts.items():
        need_b = s != 9 and not (s == 1 and fatiha_basmala_is_aya)
        k = g - 1
        if need_b and k >= 0 and flat[k] is None:
            flat[k] = ['B']
            k -= 1
        if k >= 0 and flat[k] is None:
            flat[k] = ['H', s]
        else:
            print(r, 'no room for header of sura', s, file=sys.stderr)
    pages = [[flat[p * LINES + i] or 0 for i in range(LINES)] for p in range(nP)]

    # natural width of every text line in em, so the client can size type
    # without measuring
    upem = font.face.upem
    lw = []
    for pg in pages:
        row = []
        for line in pg:
            if line and not isinstance(line[0], str):
                ws = ' '.join(seg[1] for seg in line).split()
                row.append(round(sum(width(t) for t in ws) / upem + 0.1 * (len(ws) - 1), 2))  # words + .1em css gap
            else:
                row.append(0)
        lw.append(row)
    allw = sorted(w for row in lw[2:] for w in row if w)

    # basmala in this riwaya's orthography: tail of An-Naml 27:30
    i30 = next(i for i, a in enumerate(ayas) if a[0] == 27 and a[1] == 30)
    words = [t for ai, t, _ in toks if ai == i30 and not DIGITS.match(t)]
    basmala = ' '.join(words[-4:])
    return {'pages': pages, 'ayas': ayas, 'basmala': basmala, 'lw': lw,
            'em': allw[int(len(allw) * 0.97)]}


os.makedirs(OUT, exist_ok=True)
index = []
for r, name in RIWAYAT:
    d = build_riwaya(r)
    d['id'] = r
    json.dump(d, open(f'{OUT}/{r}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    index.append({'id': r, 'name': name, 'ayas': len(d['ayas']), 'pages': len(d['pages'])})
    print(r, 'em', d['em'], 'min', min(w for row in d['lw'][2:] for w in row if w), 'max', max(max(row) for row in d['lw']))
    print(r, len(d['ayas']), 'ayas', len(d['pages']), 'pages', os.path.getsize(f'{OUT}/{r}.json') // 1024, 'KB')

meta = {
    'riwayat': index,
    'suras': [[c['name_arabic'], c['name_simple'], c['translated_name']['name'], c['verses_count'],
               c['revelation_place'], c['pages'][0]] for c in chapters],
    'hafs': [[m[0], m[1]] for m in hafs_meta],
    'emlaey': hafs_emlaey,
}
json.dump(meta, open(f'{OUT}/meta.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('meta', os.path.getsize(f'{OUT}/meta.json') // 1024, 'KB')
