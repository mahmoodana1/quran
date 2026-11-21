#!/usr/bin/env python3
# شرح الحديث for الحديث: HadeethEnc.com's Arabic encyclopedia (fetched by tools/hadeethenc.py into
# ~/.cache/hadith-src/he) matched to the app's hadiths by the numbers its references give (صحيح
# البخاري (6864), صحيح مسلم (1678) — Abd al-Baqi's, سنن أبي داود (n)), each match checked by the
# words the two texts share; a hadith's other narrations in the three books (its group) share it.
# Writes data/hadith/sharh/index.json ({"book:kitab:j": id}) and sharh/<id % 32>.json.
# Usage: python3 tools/hadith_sharh.py
import json, os, re, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HE = os.path.expanduser('~/.cache/hadith-src/he')
OUT = f'{ROOT}/data/hadith/sharh'; os.makedirs(OUT, exist_ok=True)
HAR = re.compile('[ً-ٰٟۖ-ۭـ]')
def words(t):
    t = HAR.sub('', t).replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ى', 'ي').replace('ة', 'ه')
    return {w for w in re.findall(r'[ء-ي]{3,}', t)}
# the app's hadiths: by number in each book; their text and group
by_num, text, group, members = {}, {}, {}, {}
ix = json.load(open(f'{ROOT}/data/hadith/index.json'))
for B in ix['books']:
    b = B['id']
    for k, kt in enumerate(B['k']):
        for f in sorted(glob.glob(f'{ROOT}/data/hadith/{b}/{k}-*.json'), key=lambda p: int(p.rsplit('-', 1)[1][:-5])):
            p = int(f.rsplit('-', 1)[1][:-5]); d = json.load(open(f))
            for i, h in enumerate(d['h']):
                j = p * 100 + i; key = f'{b}:{k}:{j}'
                m = h.get('m') or [0, len(h['t'])]; text[key] = words(h['t'][m[0]:m[1]] or h['t'])
                for n in (h.get('a') if b == 'muslim' and h.get('a') else h.get('n', [])): by_num.setdefault((b, n), []).append(key)
                if h.get('g'): group[key] = h['g']; members.setdefault(h['g'], []).append(key)
BOOK = [('bukhari', 'صحيح البخاري'), ('muslim', 'صحيح مسلم'), ('abudawud', 'سنن أبي داود')]
index, content, direct = {}, {}, 0
for f in glob.glob(f'{HE}/*.json'):
    d = json.load(open(f)); hid = int(d['id'])
    he_words = words(d.get('hadeeth', ''))
    hits = []
    for line in (d.get('reference') or '').splitlines():
        for b, name in BOOK:
            if line.strip().startswith(name):
                nums = re.findall(r'\((\d+)\)', line)
                if nums: hits += [k for k in by_num.get((b, int(nums[-1])), [])]
    good = []
    for key in hits:
        t = text.get(key, set())
        if t and he_words and len(t & he_words) / max(1, min(len(t), len(he_words))) >= .35: good.append(key)
    if not good: continue
    wm = []
    for x in d.get('words_meanings') or []:
        if isinstance(x, dict) and x.get('word') and x.get('meaning'): wm.append([x['word'].strip(), x['meaning'].strip()])
    content[hid] = {'t': d.get('title', ''), 'e': d.get('explanation', '').strip(), 'w': wm, 'h': [x.strip() for x in d.get('hints') or [] if x.strip()],
                    'a': d.get('attribution', ''), 'g': d.get('grade', '')}
    for key in good:
        if index.get(key) is None or isinstance(index[key], tuple): index[key] = hid; direct += 1
    for key in good:  # (its narrations in the other books, unless they have their own)
        for o in members.get(group.get(key), []):
            index.setdefault(o, hid)
json.dump(index, open(f'{OUT}/index.json', 'w'), separators=(',', ':'))
parts = {}
for hid, c in content.items(): parts.setdefault(hid % 32, {})[hid] = c
for p, c in parts.items(): json.dump(c, open(f'{OUT}/{p}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
size = sum(os.path.getsize(f'{OUT}/{f}') for f in os.listdir(OUT))
print(f'explanations {len(content)}, hadiths with one {len(index)} (direct {direct}), {size // 1024} KB')
