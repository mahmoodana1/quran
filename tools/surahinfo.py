"""Build data/surah-info.json: what is said about each surah, in Arabic, from
the Quranic Encyclopedia (الموسوعة القرآنية, quranpedia.net), its dump
`surahs.json.gz` (https://quranpedia.net/dumps; free to use inside apps, the
source credited in the app and its version stated).

    python3 tools/surahinfo.py surahs.json.gz data/surah-info.json   (also data/asbab.json)

Per surah (index 0 = al-Fatiha), each text a list of paragraphs in a small safe
markup: <q> a quotation from the Quran (shown in the mushaf's font), <a
data-ia="s:a"> an aya named (Hafs numbering), and a paragraph beginning "* "
is a heading. Fields, any of them may be missing:
    intro, names, topics, purposes, grace (its virtue), prophet (the Prophet's
    practice with it), asbab (causes of revelation): paragraphs
    type (مكية / مدنية), order (of revelation), words: strings
    counts: [[the count's name, ayas], ...] (the schools of counting ayas)
The causes of revelation go to data/asbab.json instead, by aya: { "s:a" or "s:a-b": paragraphs } (the
heading naming the aya first), shown in the tafsir of that aya.
"""
import gzip
import html
import json
import re
import sys
from html.parser import HTMLParser

FIELDS = {'introduction': 'intro', 'asmaoha': 'names', 'topics': 'topics', 'purposes': 'purposes',
          'grace': 'grace', 'prophet': 'prophet', 'revelation': 'asbab'}


class Clean(HTMLParser):
    """paragraphs of text, Quran quotations (spans in the KFGQPC font) as <q>,
    aya references (data-quranpedia="surah=..&ayah=..") as links"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.paras, self.cur, self.stack = [], [], []

    def flush(self):
        t = re.sub(r'\s+', ' ', ''.join(self.cur)).strip()
        t = re.sub(r'<q>\s*</q>|<a data-ia="[^"]*">\s*</a>', '', t)
        if re.sub(r'<[^>]+>', '', t).strip():
            self.paras.append(t)
        self.cur = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('p', 'br', 'div', 'li'):
            self.flush()
            self.stack.append(None)
            return
        if tag != 'span':
            self.stack.append(None)
            return
        ref = a.get('data-quranpedia') or ''
        m = re.match(r'surah=(\d+)&ayah=(\d+)', ref)
        inside = [x for x in self.stack if x]
        if m and not any(x.startswith('a') for x in inside):
            self.cur.append(f'<a data-ia="{m[1]}:{m[2]}">')
            self.stack.append('a')
        elif 'font' in (a.get('style') or '') and 'uthmanic' in ' '.join(k for k, _ in attrs) and not any(x == 'q' for x in inside):
            self.cur.append('<q>')
            self.stack.append('q')
        else:
            self.stack.append(None)

    def handle_endtag(self, tag):
        if tag in ('p', 'div', 'li'):
            self.flush()
        if not self.stack:
            return
        x = self.stack.pop()
        if x == 'a':
            self.cur.append('</a>')
        elif x == 'q':
            self.cur.append('</q>')

    def handle_data(self, data):
        self.cur.append(html.escape(data, quote=False))

    def close(self):
        super().close()
        while self.stack:
            x = self.stack.pop()
            if x:
                self.cur.append(f'</{x}>')
        self.flush()


def paras(v):
    if not v:
        return None
    p = Clean()
    p.feed(v)
    p.close()
    out = []
    for t in p.paras:
        # the tags closed and opened in order, or none at all
        if t.count('<q>') != t.count('</q>') or t.count('<a ') != t.count('</a>'):
            t = re.sub(r'</?(q|a)[^>]*>', '', t)
        out.append(t)
    return out or None


def main(src, dst):
    d = json.load(gzip.open(src))
    rows = sorted(d['data'], key=lambda x: x['surah'])
    assert [x['surah'] for x in rows] == list(range(1, 115))
    out = []
    for x in rows:
        inf = x['information']
        r = {}
        for k, name in FIELDS.items():
            v = paras((inf.get(k) or {}).get('value'))
            if v:
                r[name] = v
        for k, name in (('surah_type', 'type'), ('descent', 'order'), ('words_count', 'words')):
            v = (inf.get(k) or {}).get('value')
            if v:
                r[name] = str(v).strip()
        c = [[y['title'].strip(), y['value']] for y in inf.get('ayahs_count') or [] if y.get('value')]
        if c:
            r['counts'] = c
        out.append(r)
    # the causes of revelation go with the ayas, to the tafsir: each heading naming an aya, and what follows it
    asbab = {}
    digits = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
    for su, r in enumerate(out, 1):
        cur = None
        for p in r.pop('asbab', None) or []:
            if p.startswith('*'):
                # the aya named: a link, or "[name: n]" / "[name: n-m]" (this surah's)
                m = re.search(r'data-ia="(\d+:\d+)"', p)
                k = m[1] if m else None
                if not k:
                    m = re.search(r'\[[^\]:]+:\s*([\d٠-٩]+)(?:\s*[-–]\s*([\d٠-٩]+))?', re.sub(r'<[^>]+>', '', p))
                    k = f'{su}:{int(m[1].translate(digits))}' + (f'-{int(m[2].translate(digits))}' if m and m[2] else '') if m else None
                cur = asbab.setdefault(k, []) if k else None
            if cur is not None:
                cur.append(p)
    ver = d.get('license', {}).get('version', '')
    with open(dst.replace('surah-info', 'asbab'), 'w') as f:
        json.dump({'source': 'الموسوعة القرآنية — quranpedia.net', 'version': ver, 'ayas': asbab}, f, ensure_ascii=False, separators=(',', ':'))
    print('asbab', len(asbab), 'ayas')
    res = {'source': 'الموسوعة القرآنية — quranpedia.net', 'url': 'https://quranpedia.net', 'version': ver, 'surahs': out}
    with open(dst, 'w') as f:
        json.dump(res, f, ensure_ascii=False, separators=(',', ':'))
    print(dst, sum(len(json.dumps(r, ensure_ascii=False)) for r in out) // 1024, 'KB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
