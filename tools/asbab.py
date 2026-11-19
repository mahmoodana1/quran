"""Build data/asbab-sahih.json: the causes of revelation of صحيح أسباب النزول (دراسة حديثية),
by إبراهيم محمد العلي, as structured by github.com/mostafaahmed97/asbab-al-nuzul-dataset (MIT),
its data/structured/json/all.json.

    git clone --depth 1 https://github.com/mostafaahmed97/asbab-al-nuzul-dataset
    python3 tools/asbab.py asbab-al-nuzul-dataset/data/structured/json/all.json data/asbab-sahih.json

It goes beside data/asbab.json (الموسوعة القرآنية, tools/surahinfo.py); the app shows both in the
tab «سبب النزول» of each aya. Out: {"source", "via", "list": [[surah, [ayas], [[paragraph, ...], ...]]]},
one list of paragraphs per narration, ayas in Hafs numbering (not always one run: 5:44,45,47;
run from the repository's root, data/meta.json giving each surah's count). Each
paragraph is plain text escaped, a quotation from the Quran ({…} in the dataset) as <q>…</q>.
"""
import html
import json
import re
import sys


def kfgqpc(q):
    """A quotation in Tanzil's marks (sukun U+0652, the rounded zero over a letter not read U+06DF)
    in those of the KFGQPC Hafs font it is shown in (and of data/hafs.json): sukun U+06E1, the zero
    U+0652. Left as they were, the font draws U+06DF as a dotted circle beside the alif."""
    return q.replace('ْ', 'ۡ').replace('۟', 'ْ')


def paras(t):
    out = []
    for p in re.split(r'\n\s*\n|\n', t.strip()):
        p = re.sub(r'\s+', ' ', p).strip()
        if not p:
            continue
        p = html.escape(p, quote=False)
        # a quotation from the Quran: {…} → <q>﴿…﴾</q> (any ﴿n﴾ aya number left inside it)
        p = re.sub(r'\{\s*([^{}]+?)\s*\}', lambda m: f'<q>﴿{kfgqpc(m[1])}﴾</q>', p)
        out.append(p)
    return out


def main(src, dst):
    d = json.load(open(src, encoding='utf-8'))
    # each surah's ayas (Hafs), to leave out a number past its end (96:6-20 in the dataset; al-Alaq has 19)
    count = {}
    for s, n in json.load(open('data/meta.json', encoding='utf-8'))['hafs']:
        count[s] = max(count.get(s, 0), n)
    rows = []
    for e in d:
        s, ayas = int(e['surah']), sorted({int(a) for a in e['ayahs']})
        if any(a > count[s] for a in ayas):
            print(f'{s}:{ayas}: past the surah\'s {count[s]} ayas, those left out', file=sys.stderr)
            ayas = [a for a in ayas if a <= count[s]]
        nar = [paras(o) for o in e['occasions'] if o.strip()]
        nar = [n for n in nar if n]
        if nar:
            rows.append([s, ayas, nar])
    rows.sort(key=lambda r: (r[0], r[1][0]))
    res = {'source': 'صحيح أسباب النزول — إبراهيم محمد العلي',
           'via': 'github.com/mostafaahmed97/asbab-al-nuzul-dataset (MIT)', 'list': rows}
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, separators=(',', ':'))
    print(len(rows), 'entries,', sum(len(r[1]) for r in rows), 'ayas,', sum(len(r[2]) for r in rows), 'narrations')


if __name__ == '__main__':
    main(*sys.argv[1:3])
