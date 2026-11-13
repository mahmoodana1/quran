"""Build data/audio/<riwaya>.json: the reciter of each riwaya and when each aya
starts in his recording of every surah.

Hafs is recited aya by aya (everyayah.com, one file per aya), so it needs no
timing, except its reciters in EXTRA (a continuous recording from mp3quran.net). Every other riwaya is a recitation in that riwaya from mp3quran.net,
one file per surah, with the time of each aya from mp3quran.net's
`ayat_timing` API, in the riwaya's own count of ayat (checked here against
data/<riwaya>.json). Qunbul has no published timing: tools/align.py works it
out from the recording itself (see there) and this script reads its output.

    python3 tools/recitations.py data [cache-dir] [qumbul-timing.json]
    ONLY=extra python3 tools/recitations.py data   (just the EXTRA reciters)
    ONLY=hafs python3 tools/recitations.py data    (just one riwaya's EXTRA)

Output per riwaya:
    name   reciter (Arabic)
    url    folder of the surah files (NNN.mp3)
    src    where the timing comes from
    size   bytes of each surah file (for the download size and progress)
    t      per surah: start of each aya in ms from the start of the file, and
           the end of the last one (before aya 1: isti'adha, basmala, takbir)

The surah files are constant bitrate MPEG audio (checked when this was
written), so the app reads one aya with an HTTP range of the file.

mp3quran.net allows its material and links to be used and copied; the timing
is credited to it in the app and the README.
"""
import json
import os
import sys
import time
import urllib.request

API = 'https://www.mp3quran.net/api/v3/ayat_timing?surah={s}&read={read}'
CDN = 'https://cdn.mp3quran.net/audio/'

# riwaya -> (reciter, mp3quran read id with timing, folder on the CDN). The
# server16/server13/... folders that mp3quran lists redirect to these.
RECITERS = {
    'shouba': ('علي بن عبد الرحمن الحذيفي', 305, 'ali-hudhaifi/r3/'),
    'warsh': ('عمر القزابري', 80, 'omar-kazabri/r1/'),
    'qaloon': ('محمود خليل الحصري', 270, 'mahmoud-husary/r5/'),
    'doori': ('محمود خليل الحصري', 269, 'mahmoud-husary/r4/'),
    'soosi': ('عبد الرشيد صوفي', 65, 'abdulrasheed-sufi/r2/'),
    'bazzi': ('عكاشة كميني', 296, 'okasha-kameny/r2/'),
    'qumbul': ('أحمد ديبان', None, 'ahmad-deeban/r3/'),
}

# more reciters of a riwaya, chosen in the settings: riwaya -> [(key, reciter,
# read id, folder)], written to data/audio/<riwaya>.<key>.json. One whose
# timing does not match the riwaya's count of ayat is left out (and said so).
EXTRA = {
    # Hafs: everyayah.com's aya files are cut apart with silence of their own
    # between them (dead digital silence, or a second or two); where the same
    # reciter has a timed recording on mp3quran.net it is played from that,
    # one continuous recording (the key is his id in HAFS_VOICES in app.js)
    'hafs': [
        ('alafasy', 'مشاري راشد العفاسي', 123, 'mishary-alafasy/r1/'),
        ('sudais', 'عبد الرحمن السديس', 54, 'abdulrahman-sudais/r1/'),
        ('shuraim', 'سعود الشريم', 31, 'saud-shuraim/r1/'),
        ('qatami', 'ناصر القطامي', 86, 'nasser-qatami/r1/'),
        ('ghamdi', 'سعد الغامدي', 30, 'saad-ghamdi/r1/'),
        ('ajamy', 'أحمد بن علي العجمي', 5, 'ahmad-ajmi/r1/'),
        ('shatri', 'أبو بكر الشاطري', 4, 'abubakr-shatri/r1/'),
        ('abbad', 'فارس عباد', 81, 'fares-abbad/r1/'),
        ('ayyoub', 'محمد أيوب', 109, 'muhammad-ayyub/r1/'),
        ('budair', 'صلاح البدير', 43, 'salah-budair/r1/'),
        ('juhany', 'عبد الله عواد الجهني', 62, 'abdullah-juhani/r1/'),
        ('qahtani', 'خالد القحطاني', 21, 'khalid-qahtani/r1/'),
        ('hudhaify', 'علي بن عبد الرحمن الحذيفي', 74, 'ali-hudhaifi/r1/'),
        ('jaber', 'علي جابر', 76, 'ali-jaber/r1/'),
        ('basfar', 'عبد الله بصفر', 60, 'abdullah-basfar/r1/'),
        ('matroud', 'عبد الله المطرود', 59, 'abdullah-matrood/r1/'),
        ('qasim', 'عبد المحسن القاسم', 67, 'abdulmohsen-qasim/r1/'),
        ('alaqimy', 'أكرم العلاقمي', 10, 'akram-alaqmi/r1/'),
        ('bukhatir', 'صلاح بو خاطر', 46, 'salah-bukhatir/r1/'),
        ('rifai', 'هاني الرفاعي', 89, 'hani-rifai/r1/'),
        ('husary', 'محمود خليل الحصري', 118, 'mahmoud-husary/r1/'),
        ('husary-mj', 'محمود خليل الحصري', 119, 'mahmoud-husary/r2/'),
        ('minshawi', 'محمد صديق المنشاوي', 112, 'muhammad-minshawi/r1/'),
        ('basit', 'عبد الباسط عبد الصمد', 53, 'abdulbasit-abdulsamad/r3/'),
        ('basit-mj', 'عبد الباسط عبد الصمد', 51, 'abdulbasit-abdulsamad/r1/'),
        ('tablawi', 'محمد محمود الطبلاوي', 106, 'muhammad-tablawi/r1/'),
    ],
    'warsh': [
        ('husary', 'محمود خليل الحصري', 120, 'mahmoud-husary/r3/'),
        ('kouchi', 'العيون الكوشي', 16, 'laayoun-kouchi/r1/'),
        ('jazairi', 'ياسين الجزائري', 14, 'yassen-jazairi/r1/'),
        ('saayed', 'محمد سايد', 134, 'muhammad-saayed/r1/'),
    ],
    'qaloon': [
        ('hudhaifi', 'علي بن عبد الرحمن الحذيفي', 75, 'ali-hudhaifi/r2/'),
        ('dokali', 'الدوكالي محمد العالم', 208, 'dokali-alim/r1/'),
    ],
}

# where mp3quran's division differs from the riwaya's count: {surah: [rows
# (1-based) heard as one aya]}. al-Mulk 9 in al-Duri (Basri count, 30 ayat):
# mp3quran ends an aya at «قد جاءنا نذير», as the Madani and Makki counts do.
MERGE = {'doori': {67: [(9, 10)]}}


def get(url, tries=4):
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'quran-app-build'}), timeout=60) as r:
                return r.read()
        except Exception:
            if t == tries - 1:
                raise
            time.sleep(2 ** t)


def file_size(url, tries=4):
    req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'quran-app-build'})
    for t in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return int(r.headers['Content-Length'])
        except Exception:
            if t == tries - 1:
                raise
            time.sleep(2 ** t)


def counts(data, rid):
    d = json.load(open(os.path.join(data, rid + '.json')))
    c = [0] * 115
    for a in d['ayas']:
        c[a[0]] += 1
    return c


def timing(read, s, cache):
    path = os.path.join(cache, str(read), f'{s}.json')
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'wb').write(get(API.format(s=s, read=read)))
    rows = json.load(open(path))
    return [(int(r['ayah']), int(r['start_time']), int(r['end_time'])) for r in rows]


def one(data, cache, qumbul, rid, name, read, folder, out):
    n = counts(data, rid)
    T = []
    if read is None:
        if not os.path.exists(qumbul):
            print(rid, 'skipped: no timing yet (tools/align.py)')
            return
        T = json.load(open(qumbul))['t']
        src = 'aligned with tools/align.py'
    else:
        src = f'mp3quran.net ayat_timing, read {read}'
        for s in range(1, 115):
            rows = [r for r in timing(read, s, cache) if r[0] >= 1]
            assert [r[0] for r in rows] == list(range(1, len(rows) + 1)), (rid, s, 'rows out of order')
            for a, b in reversed(MERGE.get(rid, {}).get(s, [])):
                rows[a - 1:b] = [(a, rows[a - 1][1], rows[b - 1][2])]
            assert len(rows) == n[s], (rid, s, len(rows), n[s])
            starts = [r[1] for r in rows]
            assert all(x < y for x, y in zip(starts, starts[1:])), (rid, s, 'times out of order')
            T.append(starts + [rows[-1][2]])
    for s in range(1, 115):
        assert len(T[s - 1]) == n[s] + 1, (rid, s)
    size = [file_size(f'{CDN}{folder}{s:03d}.mp3') for s in range(1, 115)]
    # constant bitrate (an aya is read by its byte offset): no Xing (VBR) header
    for s in (1, 2, 114):
        req = urllib.request.Request(f'{CDN}{folder}{s:03d}.mp3', headers={'User-Agent': 'quran-app-build', 'Range': 'bytes=0-65535'})
        with urllib.request.urlopen(req, timeout=60) as r:
            assert b'Xing' not in r.read(), (rid, s, 'variable bitrate')
    res = {'name': name, 'url': CDN + folder, 'src': src, 'size': size, 't': T}
    with open(out, 'w') as f:
        json.dump(res, f, ensure_ascii=False, separators=(',', ':'))
    print(os.path.basename(out), name, f'{sum(size) / 1e9:.2f} GB', os.path.getsize(out) // 1024, 'KB')


def build(data, cache, qumbul, only=None):
    out_dir = os.path.join(data, 'audio')
    os.makedirs(out_dir, exist_ok=True)
    if only is None:
        for rid, (name, read, folder) in RECITERS.items():
            one(data, cache, qumbul, rid, name, read, folder, os.path.join(out_dir, rid + '.json'))
    for rid, rows in EXTRA.items():
        if only not in (None, 'extra') and rid != only:
            continue
        for key, name, read, folder in rows:
            out = os.path.join(out_dir, f'{rid}.{key}.json')
            if os.environ.get('KEEP') and os.path.exists(out):
                continue  # (KEEP=1: built already, an earlier run cut short)
            try:
                one(data, cache, qumbul, rid, name, read, folder, os.path.join(out_dir, f'{rid}.{key}.json'))
            except AssertionError as e:
                print(rid, key, 'left out:', e)


if __name__ == '__main__':
    data = sys.argv[1]
    cache = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dl', 'ayat_timing')
    qumbul = sys.argv[3] if len(sys.argv) > 3 else os.path.join(data, 'audio', 'qumbul.json')
    build(data, cache, qumbul, os.environ.get('ONLY'))
