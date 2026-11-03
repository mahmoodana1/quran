# data/phon-hafs.json: how each aya of Hafs sounds, in the phonetic script the
# recitation model (Muaalem) writes, with each word of the mushaf page as a
# [start, end) range of it, and which words start with hamzat al-wasl (ٱ). Made with quran-transcript (MIT):
#   python tools/phonetics.py data/hafs.json data/phon-hafs.json
import json, sys, collections
import quran_transcript as qt
SRC, OUT = sys.argv[1], sys.argv[2]
d = json.load(open(SRC))
# words per aya as the mushaf pages show them (the app's words)
glyph = collections.Counter()
for page in d['pages']:
    for ln in page:
        if not isinstance(ln, list) or not ln or isinstance(ln[0], str): continue
        for a, text in ln:
            glyph[a] += sum(1 for t in text.split(' ') if not t.endswith('*'))
m = qt.MoshafAttributes(rewaya='hafs', madd_monfasel_len=4, madd_mottasel_len=4, madd_mottasel_waqf=4, madd_aared_len=4)
out = []
for ai, (s, a, *_) in enumerate(d['ayas']):
    f = qt.Aya(s, a).get()
    t = f.uthmani
    o = qt.quran_phonetizer(t, m, remove_spaces=True, sura_idx=s)
    spans, lo, hi = [], None, None
    for i, ch in enumerate(t + ' '):
        if ch == ' ':
            spans.append([lo, hi]); lo = hi = None; continue
        p = o.mappings[i]
        if p.deleted or p.pos[0] == p.pos[1]: continue
        lo = p.pos[0] if lo is None else min(lo, p.pos[0]); hi = p.pos[1] if hi is None else max(hi, p.pos[1])
    prev = 0
    for sp in spans:
        if sp[0] is None: sp[0] = sp[1] = prev
        prev = sp[1]
    words = list(f.uthmani_words)
    # where the mushaf writes two words as one (بَعْدَمَا, إِلْ يَاسِينَ): join the shortest pair
    while len(spans) > glyph[ai]:
        k = min(range(len(words) - 1), key=lambda k: len(words[k]) + len(words[k + 1]))
        spans[k:k + 2] = [[spans[k][0], spans[k + 1][1]]]; words[k:k + 2] = [words[k] + ' ' + words[k + 1]]
    assert len(spans) == glyph[ai], (s, a, len(spans), glyph[ai])
    out.append([o.phonemes, [x for sp in spans for x in sp], [k for k, w in enumerate(words) if w.startswith('ٱ')]])
json.dump(out, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'ayas')
