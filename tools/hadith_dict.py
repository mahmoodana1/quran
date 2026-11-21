#!/usr/bin/env python3
# مختار الصحاح (Muhammad b. Abi Bakr al-Razi, d. 666 AH; public domain; text from the OpenITI corpus,
# 0666IbnAbiBakrZaynDinRazi.MukhtarSihah.Shamela0023193-ara1) for الحديث's long press on a word: every
# word the dictionary explains (in its «(...)»), without harakat, to its root and the explanation that
# follows it. Writes data/hadith/dict/<shard>.json: { bare word: [[root, explanation], …] }, sharded by
# the word's first letter (its code point in hex); and «√root letters»: [root, the article's opening].
# Usage: python3 tools/hadith_dict.py ~/.cache/dict/mukhtar.txt
import json, os, re, sys, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = f'{ROOT}/data/hadith/dict'; os.makedirs(OUT, exist_ok=True)
AR = 'ء-ي'
HAR = re.compile('[ً-ٰٟۖ-ۭـ]')
def bare(t): return HAR.sub('', t).replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ٱ', 'ا').replace('ى', 'ي').replace('ة', 'ه').strip()

src = open(sys.argv[1], encoding='utf-8').read()
src = src[src.index('### |'):]
arts, cur = collections.OrderedDict(), None
for line in src.splitlines():
    if line.startswith('### |'):
        letters = re.sub(r'\s+', '', line[5:].strip())
        if not re.fullmatch(f'[{AR}]{{2,5}}', letters): continue  # (a page's number, not a root)
        cur = ' '.join(letters); arts.setdefault(cur, [])        # («أب ق», «أ ب ق»: one way)
        continue
    if cur is None or line.startswith('# Page'): continue
    t = re.sub(r'^(#\s*:?|~~)\s*', '', line)
    t = re.sub(r'\bms\d+\b|\[ص:\s*\d+\]|PageV\d+P\d+', '', t).strip()
    if t: arts[cur].append(t)

words = collections.defaultdict(list)
for r, lines in arts.items():
    text = re.sub(r'\s+', ' ', ' '.join(lines)).strip()
    for m in re.finditer(r'\(([^()]{1,30})\)', text):
        w = bare(m.group(1))
        if not re.fullmatch(f'[{AR}]{{2,}}', w): continue
        rest = text[m.end():]
        # to the end of its sentence, or where the next word is taken up («و (…)»): not merely the
        # next «(» (a definition goes on through the forms it names)
        cut = re.search(r'[.;]|\sو\s?\((?=[^)]{1,30}\))|\sو\s?«', rest[12:])
        expl = (m.group(0) + rest[:12 + cut.start() if cut else 200]).strip(' ،,')
        if len(expl) > 240: expl = expl[:230].rsplit(' ', 1)[0] + ' …'
        if len(expl) < len(m.group(0)) + 4: continue  # (named, not explained, here)
        if not any(x[0] == r for x in words[w]): words[w].append([r, expl])

shards = collections.defaultdict(dict)
for w, v in words.items(): shards[w[0]][w] = v[:3]
# each article by its root's letters too («√شمت»): its opening, for a word met in another form
for r, lines in arts.items():
    text = re.sub(r'\s+', ' ', ' '.join(lines)).strip()
    if not text: continue
    key = bare(r.replace(' ', ''))
    # (from its first word of that root: a few articles in the digital text open with the words of
    # another, its heading lost — «ن ش ب» opening with «نشأ»)
    def of_root(h):
        i = 0
        for c in bare(h):
            if i < len(key) and c == key[i]: i += 1
        return i >= len(key)
    first = next((m.start() for m in re.finditer(r'\(([^()]{1,30})\)', text) if of_root(m.group(1))), None)
    if first is None: continue
    text = text[first:]
    ex = text if len(text) <= 320 else text[:300].rsplit(' ', 1)[0] + ' …'
    shards[key[0]].setdefault('√' + key, [r, ex])
for k in os.listdir(OUT): os.remove(f'{OUT}/{k}')
for c, d in shards.items(): json.dump(d, open(f'{OUT}/{ord(c):x}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
size = sum(os.path.getsize(f'{OUT}/{f}') for f in os.listdir(OUT))
print(f'articles {len(arts)}, words {len(words)}, {size // 1024} KB in {len(os.listdir(OUT))} files')
