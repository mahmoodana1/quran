# data/hadith/: Sahih al-Bukhari, Sahih Muslim and Sunan Abi Dawud for the الحديث panel (hadith.js).
#
# Two open sources, matched hadith by hadith on their texts, in order:
#  - «الجامع» Hadith Knowledge Graph (huggingface.co/datasets/emadjumaah/hadith-kg, CC-BY-4.0):
#    the text with its narrators marked, every chain as its narrators in order, the narrators
#    (Ibn Hajar's generation and grade, dates, places) and what the critics said of them, Quran
#    quotes, which narrations are of one hadith, and a tree of subjects
#  - fawazahmed0/hadith-api (Unlicense): the standard numbers (Muslim also by Fuad Abd al-Baqi's),
#    each hadith's كتاب, and for Abu Dawud the gradings of al-Albani and Shu'ayb al-Arna'ut
# The graph's own automatic grading of chains is not shown for the two Sahihs (it calls some of
# their hadiths حسن or ضعيف; their musnad hadiths are accepted as sahih).
#
#   python3 tools/hadith.py ~/.cache/hadith-src     (hadith-kg.db, fz/ara-*.json, fz/info.json)
#
# Out (all loaded only when the panel asks for them):
#   index.json           the books, their kutub (title, count, first number), the subjects tree
#   <book>/<k>.json      one kitab: its hadiths, and the short names of the narrators in them
#   rawi/<id % 64>.json  narrators: who they were, their grade, the critics, teachers and students
#   search/<book>.json   the matn of each hadith, normalized, for the search worker
#   groups.json          for each hadith meaning: where it is in the three books (subjects, «روايات أخرى»)
import json, re, os, sys, sqlite3, collections, bisect

SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/.cache/hadith-src')
OUT = 'data/hadith'
db = sqlite3.connect(f'file:{SRC}/hadith-kg.db?mode=ro', uri=True)
info = json.load(open(f'{SRC}/fz/info.json'))

BOOKS = [  # id, graph book id, title, author, his death
    ('bukhari', 1, 'صحيح البخاري', 'محمد بن إسماعيل البخاري', 256),
    ('muslim', 2, 'صحيح مسلم', 'مسلم بن الحجاج النيسابوري', 261),
    ('abudawud', 4, 'سنن أبي داود', 'سليمان بن الأشعث السجستاني', 275),
]
# the kutub's titles, as each book names them (in the order of the sources' sections)
KUTUB = {
 'bukhari': ['بدء الوحي', 'الإيمان', 'العلم', 'الوضوء', 'الغسل', 'الحيض', 'التيمم', 'الصلاة', 'مواقيت الصلاة', 'الأذان', 'الجمعة', 'صلاة الخوف', 'العيدين', 'الوتر', 'الاستسقاء', 'الكسوف', 'سجود القرآن', 'تقصير الصلاة', 'التهجد', 'فضل الصلاة في مسجد مكة والمدينة', 'العمل في الصلاة', 'السهو', 'الجنائز', 'الزكاة', 'الحج', 'العمرة', 'المحصر', 'جزاء الصيد', 'فضائل المدينة', 'الصوم', 'صلاة التراويح', 'فضل ليلة القدر', 'الاعتكاف', 'البيوع', 'السلم', 'الشفعة', 'الإجارة', 'الحوالات', 'الكفالة', 'الوكالة', 'المزارعة', 'المساقاة', 'الاستقراض وأداء الديون والحجر والتفليس', 'الخصومات', 'اللقطة', 'المظالم والغصب', 'الشركة', 'الرهن', 'العتق', 'المكاتب', 'الهبة وفضلها والتحريض عليها', 'الشهادات', 'الصلح', 'الشروط', 'الوصايا', 'الجهاد والسير', 'فرض الخمس', 'الجزية والموادعة', 'بدء الخلق', 'أحاديث الأنبياء', 'المناقب', 'فضائل أصحاب النبي ﷺ', 'مناقب الأنصار', 'المغازي', 'التفسير', 'فضائل القرآن', 'النكاح', 'الطلاق', 'النفقات', 'الأطعمة', 'العقيقة', 'الذبائح والصيد', 'الأضاحي', 'الأشربة', 'المرضى', 'الطب', 'اللباس', 'الأدب', 'الاستئذان', 'الدعوات', 'الرقاق', 'القدر', 'الأيمان والنذور', 'كفارات الأيمان', 'الفرائض', 'الحدود', 'الديات', 'استتابة المرتدين والمعاندين وقتالهم', 'الإكراه', 'الحيل', 'التعبير', 'الفتن', 'الأحكام', 'التمني', 'أخبار الآحاد', 'الاعتصام بالكتاب والسنة', 'التوحيد'],
 'muslim': ['المقدمة', 'الإيمان', 'الطهارة', 'الحيض', 'الصلاة', 'المساجد ومواضع الصلاة', 'صلاة المسافرين وقصرها', 'الجمعة', 'صلاة العيدين', 'صلاة الاستسقاء', 'الكسوف', 'الجنائز', 'الزكاة', 'الصيام', 'الاعتكاف', 'الحج', 'النكاح', 'الرضاع', 'الطلاق', 'اللعان', 'العتق', 'البيوع', 'المساقاة', 'الفرائض', 'الهبات', 'الوصية', 'النذر', 'الأيمان', 'القسامة والمحاربين والقصاص والديات', 'الحدود', 'الأقضية', 'اللقطة', 'الجهاد والسير', 'الإمارة', 'الصيد والذبائح وما يؤكل من الحيوان', 'الأضاحي', 'الأشربة', 'اللباس والزينة', 'الآداب', 'السلام', 'الألفاظ من الأدب وغيرها', 'الشعر', 'الرؤيا', 'الفضائل', 'فضائل الصحابة', 'البر والصلة والآداب', 'القدر', 'العلم', 'الذكر والدعاء والتوبة والاستغفار', 'الرقاق', 'التوبة', 'صفات المنافقين وأحكامهم', 'صفة القيامة والجنة والنار', 'الجنة وصفة نعيمها وأهلها', 'الفتن وأشراط الساعة', 'الزهد والرقائق', 'التفسير'],
 'abudawud': ['الطهارة', 'الصلاة', 'الاستسقاء', 'صلاة السفر', 'التطوع', 'شهر رمضان', 'سجود القرآن', 'الوتر', 'الزكاة', 'اللقطة', 'المناسك', 'النكاح', 'الطلاق', 'الصوم', 'الجهاد', 'الضحايا', 'الصيد', 'الوصايا', 'الفرائض', 'الخراج والإمارة والفيء', 'الجنائز', 'الأيمان والنذور', 'البيوع', 'الإجارة', 'الأقضية', 'العلم', 'الأشربة', 'الأطعمة', 'الطب', 'الكهانة والتطير', 'العتق', 'الحروف والقراءات', 'الحمام', 'اللباس', 'الترجل', 'الخاتم', 'الفتن والملاحم', 'المهدي', 'الملاحم', 'الحدود', 'الديات', 'السنة', 'الأدب'],
}
# Abu Dawud's gradings, in Arabic (the source gives them in English)
GRADERS = {'Al-Albani': 'الألباني', 'Shuaib Al Arnaut': 'شعيب الأرناؤوط'}
GW = {'sahih': 'صحيح', 'hasan': 'حسن', 'daif': 'ضعيف', 'lighairihi': 'لغيره', 'maqtu': 'مقطوع', 'muquf': 'موقوف',
      'mauquf': 'موقوف', 'mawquf': 'موقوف', 'shadh': 'شاذ', 'munkar': 'منكر', 'mawdu': 'موضوع', 'mursal': 'مرسل',
      'mutawatir': 'متواتر', 'hadith': '', 'very': None, 'isnaad': None, 'isnad': None, 'sanad': None, 'jiddan': 'جدًا', 'and': 'و'}
def grade_ar(g):
    w = re.findall(r'[a-z]+', g.lower().replace("'", ''))
    out, isn = [], False
    for i, x in enumerate(w):
        if x not in GW: raise SystemExit(f'grade not known: {g!r} ({x})')
        if x in ('isnaad', 'isnad', 'sanad'): isn = True; continue
        if x == 'very': out.append('__very'); continue
        if GW[x]: out.append(GW[x])
    s = ' '.join(out).replace('__very ضعيف', 'ضعيف جدًا')
    if isn:  # «ضعيف الإسناد», «صحيح الإسناد مقطوع»
        p = s.split(' ', 1) if s.split(' ')[0] in ('صحيح', 'حسن', 'ضعيف') else [s]
        s = p[0] + ' الإسناد' + (' ' + p[1] if len(p) > 1 else '')
    return s.strip()

# the critics' names as the source spells them, put right
CRITIC_FIX = {'ابن حجر العسقلاتي': 'ابن حجر العسقلاني', 'مصنفوا تحرير تقريب التهذيب': 'مصنفو تحرير تقريب التهذيب'}
# whose words come first on a narrator's card: Ibn Hajar's verdict, al-Dhahabi's, then the early critics
CRITIC_ORDER = ['ابن حجر العسقلاني', 'الذهبي', 'يحيى بن معين', 'أحمد بن حنبل', 'علي بن المديني', 'أبو حاتم الرازي',
                'أبو زرعة الرازي', 'البخاري', 'أحمد بن شعيب النسائي', 'الدارقطني', 'أحمد بن عبد الله العجلي',
                'أبو حاتم بن حبان البستي', 'محمد بن سعد كاتب الواقدي', 'أبو أحمد بن عدي الجرجاني']

# ------------------------------------------------------------------ text
HARAKAT = re.compile('[ً-ٰٟۖ-ۭـ]')
def norm(t):
    t = HARAKAT.sub('', t).replace('ﷺ', ' صلى الله عليه وسلم ')
    t = re.sub('[أإآٱ]', 'ا', t).replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي')
    return re.sub(r'[^ء-ي ]', ' ', t).split()
def grams(w, n=3): return {' '.join(w[i:i + n]) for i in range(max(1, len(w) - n + 1))}
def sim(a, b): return len(a & b) / min(len(a), len(b)) if a and b else 0
def cover(a, b): return len(a & b) / len(a) if a else 0  # how much of a is in b

def tidy(t):
    return re.sub(r'[ \t]+', ' ', t).replace(' ،', '،').replace(' .', '.').strip()

# ------------------------------------------------------------------ Quran quotes -> aya
meta = json.load(open('data/meta.json'))
eml = json.load(open('data/emlaey.json'))
AY4 = collections.defaultdict(set)
AYW = [norm(t) for t in eml]
for h, w in enumerate(AYW):
    for g in grams(w, 4): AY4[g].add(h)
SURA = {' '.join(norm(x[0])): i + 1 for i, x in enumerate(meta['suras'])}
SURA.update({' '.join(norm(k)): v for k, v in {'الإسراء': 17, 'الاسراء': 17, 'بني إسرائيل': 17, 'التوبة': 9, 'براءة': 9, 'غافر': 40, 'المؤمن': 40, 'فصلت': 41, 'الإنسان': 76, 'الدهر': 76, 'المسد': 111, 'تبت': 111, 'المطففين': 83, 'الطلاق': 65, 'التحريم': 66, 'الملك': 67, 'المعارج': 70, 'البينة': 98, 'الإخلاص': 112}.items()})
HAFS_IX = {(s_, a_): h for h, (s_, a_) in enumerate(meta['hafs'])}
REF = re.compile(r'سورة\s+([^\d]+?)\s+آية\s+(\d+)(?:\s*-\s*\d+)?')
unknown_suras = collections.Counter()
def quote(t, s, e):
    # the source's own «سورة … آية …» after the quote: its aya, and where that reference starts
    m = None
    for m in REF.finditer(t, s, e): pass
    if m:
        su = SURA.get(' '.join(norm(m.group(1))))
        if su and (su, int(m.group(2))) in HAFS_IX:
            return [s, e, HAFS_IX[(su, int(m.group(2)))], m.start()]
        unknown_suras[m.group(1)] += 1
    a = aya_of(t[s:e])
    return [s, e] + ([a] if a is not None else [])
def aya_of(q):
    w = norm(q)
    if len(w) < 3: return None
    gs = grams(w, 4) if len(w) >= 4 else {' '.join(w)}
    c = collections.Counter()
    for g in gs:
        for h in AY4.get(g, ()) if len(w) >= 4 else [h for h, aw in enumerate(AYW) if g in ' '.join(aw)][:50]: c[h] += 1
    if not c: return None
    h, k = c.most_common(1)[0]
    return h if k >= max(1, len(gs) * .5) else None

# ------------------------------------------------------------------ narrators
rank = {}
for rid, rno in db.execute('select id, rank_no from rawis'): rank[rid] = rno
def short(rid, name, nick):
    return (nick or name).strip()

used_rawis = collections.Counter()  # in how many of the three books' hadiths (their chains)
teach = collections.defaultdict(collections.Counter)  # rawi -> who he narrated from
stud = collections.defaultdict(collections.Counter)

# ------------------------------------------------------------------ the books
os.makedirs(OUT + '/rawi', exist_ok=True); os.makedirs(OUT + '/search', exist_ok=True)
index = {'books': [], 'source': 'النصوص والأسانيد والرواة من «الجامع» (موسوعة الحديث، CC-BY-4.0)، والترقيم والكتب وأحكام سنن أبي داود من hadith-api'}
group_where = collections.defaultdict(list)  # meaning group -> [[book, entry no in book, kitab]]
names = {}
ALL = {}
PART = 100  # hadiths to a file: a kitab opens with its first, the rest as it is scrolled
for bk, bid, title, author, died in BOOKS:
    fz = json.load(open(f'{SRC}/fz/ara-{bk}.json'))['hadiths']
    secs = info[bk]['metadata']['sections']
    order = [k for k in secs if not (k == '0' and not secs[k] and bk != 'muslim')]
    assert len(order) == len(KUTUB[bk]), (bk, len(order), len(KUTUB[bk]))
    kitab_of_sec = {k: i for i, k in enumerate(order)}
    kg = db.execute('select id, no_inbook, nass, matn_start, matn_end, type_no, matn, group_id from hadiths where book_id=? order by no_inbook', (bid,)).fetchall()
    K = [grams(norm(r[2])) for r in kg]
    F = [grams(norm(x['text'])) for x in fz]
    # 1. in order, each of the graph's hadiths to the standard one most like it, a little ahead
    m = [None] * len(kg); j = 0
    for i, g in enumerate(K):
        best, bj = 0, -1
        for jj in range(max(0, j - 5), min(len(F), j + 80)):
            s = sim(g, F[jj])
            if s > best: best, bj = s, jj
        if best >= .5: m[i] = bj; j = bj + 1
    # 2. the rest by where they stand, between the matched ones on either side
    for i in range(len(kg)):
        if m[i] is not None: continue
        lo = next((m[x] for x in range(i - 1, -1, -1) if m[x] is not None), -1)
        hi = next((m[x] for x in range(i + 1, len(kg)) if m[x] is not None), len(F))
        cand = range(max(0, lo), min(len(F), hi + 1))
        bj = max(cand, key=lambda jj: cover(F[jj], K[i]) + sim(K[i], F[jj]), default=max(lo, 0))
        m[i] = bj
    # 3. the standard hadiths no graph entry was matched to: in the graph's neighbouring entry
    #    when their text is in it (a second chain the graph keeps with the first), else on their own
    nums = collections.defaultdict(list)  # graph entry -> its standard numbers (fz indexes)
    for i, jf in enumerate(m): nums[i].append(jf)
    taken = set(m)
    anchors = sorted((jf, i) for i, jf in enumerate(m)); akeys = [a[0] for a in anchors]
    alone = []
    for jf in range(len(fz)):
        if jf in taken or not fz[jf]['text'].strip(): continue
        k = bisect.bisect(akeys, jf)
        near = [anchors[x][1] for x in (k - 1, k) if 0 <= x < len(anchors)]
        best = max(near, key=lambda i: cover(F[jf], K[i]), default=None)
        if best is not None and cover(F[jf], K[best]) > .6: nums[best].append(jf)
        else: alone.append(jf)
    # entries, in the book's order
    entries = []
    for i, r in enumerate(kg): entries.append(('kg', i, sorted(set(nums[i]))))
    for jf in alone: entries.append(('fz', jf, [jf]))
    entries.sort(key=lambda e: (e[2][0], e[0] != 'kg'))
    # chains, mentions, quotes of the graph's entries
    ids = [r[0] for r in kg]
    q = ','.join(map(str, ids))
    chains = collections.defaultdict(list)
    sh = {}
    for sid, hid, hukum in db.execute(f'select id, hadith_id, hukum from sanads where hadith_id in ({q}) order by id'):
        chains[hid].append([sid, hukum, []]); sh[sid] = chains[hid][-1]
    for sid, pos, rid in db.execute(f'select sanad_id, pos, rawi_id from sanad_rawis where sanad_id in (select id from sanads where hadith_id in ({q})) order by sanad_id, pos'):
        sh[sid][2].append(rid)
    ment = collections.defaultdict(list)
    for hid, s, e, rid in db.execute(f'select hadith_id, start, end, rawi_id from hadith_rawis where hadith_id in ({q}) order by hadith_id, seq'):
        if rid: ment[hid].append([s, e, rid])
    quotes = collections.defaultdict(list)
    for hid, s, e in db.execute(f'select hadith_id, start, end from hadith_ayas where hadith_id in ({q}) order by hadith_id, seq'):
        quotes[hid].append([s, e])
    # 4. the kutub
    kutub = [[] for _ in order]
    last_ki = 0
    search = []
    for no, (src, x, js) in enumerate(entries):
        f0 = fz[js[0]]
        # its kitab: the source's (a few have none, «0»: then the one before it, the books being in order)
        rb = f0['reference']['book']
        ki = kitab_of_sec.get(str(rb)) if rb or (bk == 'muslim' and f0['hadithnumber'] <= 92) else None
        if ki is None or ki < last_ki: ki = last_ki
        last_ki = ki
        n = [fz[j]['hadithnumber'] for j in js]
        h = {'i': no, 'n': n}
        if bk == 'muslim':  # Fuad Abd al-Baqi's numbers, the ones Arabic books cite
            ab = sorted({int(float(fz[j]['arabicnumber'])) for j in js if fz[j].get('arabicnumber')})
            if ab: h['a'] = ab
        if src == 'kg':
            hid, _, nass, ms, me, ty, hukm, gid = kg[x]
            h['t'] = nass
            if ms is not None and me: h['m'] = [ms, me]
            if ty != 1: h['ty'] = ty
            cs = [c for c in chains.get(hid, []) if c[2]]
            if cs:
                h['c'] = [c[2] for c in cs]
                for rid in {r for c in cs for r in c[2]}: used_rawis[rid] += 1
                for c in cs:
                    for p, rid in enumerate(c[2]):
                        if p + 1 < len(c[2]):  # pos 0 the author: he heard from the one after him
                            teach[rid][c[2][p + 1]] += 1; stud[c[2][p + 1]][rid] += 1
                if bk == 'abudawud': h['hk'] = cs[0][1]
                sah = [c[2][-1] for c in cs if rank.get(c[2][-1]) == 1]
                if sah: h['p'] = sah[0]
            if ment.get(hid): h['r'] = ment[hid]
            qs = []
            for s, e in quotes.get(hid, []): qs.append(quote(nass, s, e))
            if qs: h['q'] = qs
            if gid: h['g'] = gid; group_where[gid].append([bk, ki, len(kutub[ki])])
        else:
            h['t'] = tidy(f0['text'])
        if bk == 'abudawud':
            gr = {}
            for j in js:
                for g in fz[j]['grades']:
                    if g['name'] in GRADERS and g['name'] not in gr: gr[g['name']] = grade_ar(g['grade'].strip())
            if gr: h['gr'] = [[GRADERS[k], v] for k, v in gr.items()]
        kutub[ki].append(h)
        mt = h['t'][h['m'][0]:h['m'][1]] if 'm' in h else h['t']
        search.append([ki, len(kutub[ki]) - 1, h.get('a') or h['n'] if bk == 'muslim' else h['n'], ' '.join(norm(mt))])
    ALL[bk] = kutub
    klist = []
    for ki, hs in enumerate(kutub):
        first = hs[0]['a' if bk == 'muslim' and 'a' in hs[0] else 'n'][0] if hs else 0
        klist.append([KUTUB[bk][ki], len(hs), first, -(-len(hs) // PART)])
    json.dump(search, open(f'{OUT}/search/{bk}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    index['books'].append({'id': bk, 't': title, 'au': author, 'd': died, 'n': len(entries), 'nn': len(fz), 'k': klist})
    print(bk, 'entries', len(entries), '(graph', len(kg), '+ alone', len(alone), ') standard', len(fz))

# ------------------------------------------------------------------ the kutub written, a part at a time
LABEL = lambda bk, h: (h.get('a') or h['n'])[0] if bk == 'muslim' else h['n'][0]
for bk, kutub in ALL.items():
    os.makedirs(f'{OUT}/{bk}', exist_ok=True)
    for f in os.listdir(f'{OUT}/{bk}'): os.remove(f'{OUT}/{bk}/{f}')
    for ki, hs in enumerate(kutub):
        for h in hs:  # where else this hadith is, in the three books (its meaning group)
            if 'g' in h:
                o = [[b2, k2, j2, LABEL(b2, ALL[b2][k2][j2])] + ([1] if h.get('p') and ALL[b2][k2][j2].get('p') == h['p'] else [])
                     for b2, k2, j2 in group_where[h['g']] if not (b2 == bk and ALL[b2][k2][j2] is h)]
                # the two Sahihs from the same companion first, then the rest in the books' order
                o.sort(key=lambda x: (0 if len(x) > 4 and x[0] != bk and x[0] != 'abudawud' and bk != 'abudawud' else 1 if x[0] != bk else 2,
                                      ['bukhari', 'muslim', 'abudawud'].index(x[0]), x[1], x[2]))
                if o: h['o'] = o[:12]; h['on'] = len(o)
        for p0 in range(0, len(hs), PART):
            part = hs[p0:p0 + PART]
            rids = {rid for h in part for c in h.get('c', []) for rid in c} | {r[2] for h in part for r in h.get('r', [])}
            names.update({rid: None for rid in rids})
            json.dump({'h': part, 'R': {}, '_rids': sorted(rids)}, open(f'{OUT}/{bk}/{ki}-{p0 // PART}.json', 'w'), ensure_ascii=False, separators=(',', ':'))

# ------------------------------------------------------------------ narrator names into the kutub
allr = set(names) | set(used_rawis)
for x in list(allr):
    allr |= set(teach[x]) | set(stud[x])
rows = {r[0]: r for r in db.execute(f'select id, name, nickname, rank_no, rank, tabaka, birth_year_raw, death_year_raw, age_raw, profession, nasab, iqama, death_place, has_tadlis, has_ikhtilat, is_stub from rawis where id in ({",".join(map(str, allr))})')}
SN = {rid: short(rid, r[1], r[2]) for rid, r in rows.items()}
for bk, *_ in BOOKS:
    for f in os.listdir(f'{OUT}/{bk}'):
        p = f'{OUT}/{bk}/{f}'; d = json.load(open(p))
        d['R'] = {str(rid): [SN[rid], rank[rid]] for rid in d.pop('_rids') if rid in SN}
        json.dump(d, open(p, 'w'), ensure_ascii=False, separators=(',', ':'))

# ------------------------------------------------------------------ narrators' cards
aq = collections.defaultdict(list)
crit = {a: (CRITIC_FIX.get(s, s), d) for a, s, d in db.execute('select id, shuhra, death_year from alems')}
ids = ','.join(map(str, used_rawis))
for rid, alem, qawl in db.execute(f'select rawi_id, alem_id, qawl from aqwal where rawi_id in ({ids}) order by id'):
    name, died = crit[alem]
    aq[rid].append((name, died, qawl.strip()))
def crit_key(x):
    name, died, _ = x
    return (CRITIC_ORDER.index(name) if name in CRITIC_ORDER else len(CRITIC_ORDER), name == 'تعليق', died or 9999)
shards = collections.defaultdict(dict)
for rid in used_rawis:
    r = rows.get(rid)
    if not r: continue
    _, name, nick, rno, rk, tb, b, d, age, prof, nasab, iq, dp, tad, ikh, stub = r
    c = {'s': SN[rid], 'f': name, 'k': rno, 'rk': rk or '', 'tb': tb, 'n': used_rawis[rid]}
    for key, v in (('b', b), ('d', d), ('age', age), ('pr', prof), ('ns', nasab), ('iq', iq), ('dp', dp)):
        if v and str(v).strip(): c[key] = str(v).strip()
    if tad: c['tad'] = 1
    if ikh: c['ikh'] = 1
    if stub: c['stub'] = 1
    qs = sorted(aq.get(rid, []), key=crit_key)
    seen = set(); qq = []
    for name_, died_, qawl in qs:
        if (name_, qawl) in seen: continue
        seen.add((name_, qawl)); qq.append([name_, re.sub(r'\s+', ' ', qawl)])
    if qq: c['q'] = qq[:30]; c['qn'] = len(qq)
    for key, src in (('te', teach[rid]), ('st', stud[rid])):
        top = [[x, SN.get(x, ''), k, rank.get(x, 0)] for x, k in src.most_common(8) if x in SN and rank.get(x, 0) != 0 and SN.get(x)]
        if top: c[key] = top; c[key + 'n'] = len(src)
    shards[rid % 64][rid] = c
json.dump([[rid, c['s'], c['k'], c['n']] for rid, c in sorted(((r, c) for sh in shards.values() for r, c in sh.items()), key=lambda x: -x[1]['n'])],
          open(f'{OUT}/search/rawi.json', 'w'), ensure_ascii=False, separators=(',', ':'))
for k, v in shards.items():
    json.dump(v, open(f'{OUT}/rawi/{k}.json', 'w'), ensure_ascii=False, separators=(',', ':'))

# ------------------------------------------------------------------ meanings and subjects
gw = {g: v for g, v in group_where.items()}
taraf = {g: t for g, t in db.execute(f'select id, nass from meaning_groups where id in ({",".join(map(str, gw))})')}
json.dump({g: {'w': [[b, k, j, LABEL(b, ALL[b][k][j])] for b, k, j in v], 't': (taraf.get(g) or '')[:90]} for g, v in gw.items()}, open(f'{OUT}/groups.json', 'w'), ensure_ascii=False, separators=(',', ':'))
# the subjects tree, only the branches that reach a hadith of the three books
T = {i: [name, p, lvl, g] for i, name, p, lvl, g in db.execute('select id, name, parent_id, level, group_id from topics')}
kids = collections.defaultdict(list)
for i, (name, p, lvl, g) in T.items(): kids[p].append(i)
cnt = {}
def count(i):
    name, p, lvl, g = T[i]
    s = set([g]) if g in gw else set()
    for c in kids[i]: s |= count(c)
    cnt[i] = s
    return s
root = kids[None][0]
count(root)
tree = []
def emit(i, depth):
    for c in sorted(kids[i], key=lambda c: T[c][0] if False else c):
        if not cnt[c]: continue
        name, p, lvl, g = T[c]
        if g is not None and not kids[c]:
            continue  # a leaf: one meaning, listed under its parent
        leaf_groups = sorted({T[x][3] for x in kids[c] if T[x][3] in gw and not kids[x]})
        tree.append([c, i if i != root else 0, name, len(cnt[c])] + ([leaf_groups] if leaf_groups else []))
        emit(c, depth + 1)
emit(root, 0)
json.dump(tree, open(f'{OUT}/topics.json', 'w'), ensure_ascii=False, separators=(',', ':'))
# a hadith for each day of the year: of the two Sahihs, agreed upon (the same companion in both), short, one a meaning
daily, seen_g = [], set()
for ki, hs in enumerate(ALL['bukhari']):
    for j, h in enumerate(hs):
        mt = h['t'][h['m'][0]:h['m'][1]] if 'm' in h else ''
        if h.get('ty') is None and 'c' in h and h.get('g') not in seen_g and 50 < len(mt) < 330 and any(len(o) > 4 and o[0] == 'muslim' for o in h.get('o', [])):
            seen_g.add(h['g']); daily.append(['bukhari', ki, j])
step = max(1, len(daily) // 366)
index['daily'] = daily[::step][:366]
print('daily', len(daily), '->', len(index['daily']))
# what each book takes on a phone saved for offline use (its kutub and its search), and what the
# three share (the narrators, the subjects, the meanings), in bytes (app.js: the settings' cards)
def size(paths): return sum(os.path.getsize(f'{OUT}/{p}') for p in paths)
index['sz'] = {bk: size([f'{bk}/{f}' for f in os.listdir(f'{OUT}/{bk}')] + [f'search/{bk}.json']) for bk, *_ in BOOKS}
index['sz']['shared'] = size([f'rawi/{f}' for f in os.listdir(f'{OUT}/rawi')] + ['search/rawi.json', 'topics.json', 'groups.json'])
index['rawi'] = len(os.listdir(f'{OUT}/rawi'))
json.dump(index, open(f'{OUT}/index.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('suras not known', unknown_suras.most_common(8))
print('narrators', len(used_rawis), 'groups', len(gw), 'topics', len(tree))
