#!/usr/bin/env python3
# Fetches HadeethEnc.com's Arabic encyclopedia (explanation, word meanings, lessons) into a local
# cache, politely (a few requests at a time), resumable: ~/.cache/hadith-src/he/<id>.json
# Usage: python3 tools/hadeethenc.py
import json, os, time, urllib.request, concurrent.futures as cf
API = 'https://hadeethenc.com/api/v1'
OUT = os.path.expanduser('~/.cache/hadith-src/he'); os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'quran-app-builder/1.0'}
def get(url, tries=4):
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r: return json.load(r)
        except Exception as e:
            time.sleep(2 + 3 * t)
    raise RuntimeError(url)
ids = set()
cats = get(f'{API}/categories/roots/?language=ar')  # (the roots hold every hadith of their branches)
for c in cats:
    page = 1
    while True:
        d = get(f"{API}/hadeeths/list/?language=ar&category_id={c['id']}&page={page}&per_page=100")
        for h in d.get('data', []): ids.add(h['id'])
        meta = d.get('meta', {})
        if int(meta.get('current_page', page)) >= int(meta.get('last_page', page)): break
        page += 1
print('ids', len(ids), flush=True)
todo = [i for i in sorted(ids, key=int) if not os.path.exists(f'{OUT}/{i}.json')]
def one(i):
    d = get(f'{API}/hadeeths/one/?language=ar&id={i}')
    json.dump(d, open(f'{OUT}/{i}.json', 'w'), ensure_ascii=False)
    time.sleep(.15)
with cf.ThreadPoolExecutor(4) as ex:
    for n, _ in enumerate(ex.map(one, todo)):
        if n % 200 == 0: print(n, '/', len(todo), flush=True)
print('done', len(os.listdir(OUT)))
