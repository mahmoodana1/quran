'use strict';

// الحفظ: learning new ayas the way memorizers do, on one page. A lesson (a few
// ayas of a surah, chosen and changed at will) goes through four steps: listen
// to it over and over, repeat after the reciter in the pauses he leaves, link
// the ayas one to the next, then recite it with the words hidden (Recite). Once
// memorized it is marked so (the same record التسميع keeps, recite.<riwaya>.said)
// and the next ayas become the lesson. Below it, today's revision: what was
// memorized in the last week (السبقي), and a share of the rest, all of it gone
// over every few days (المنزل).
//
// store: hifz.<riwaya> = { a, b } the lesson (first and last aya); hifz.o = how
// to repeat and which steps make the routine (a preset or the reader's own); hifz.day = the steps done
// today, and of which lesson. «ابدأ الجلسة» plays the routine's listening steps as one recording.
// Uses (app.js): R, META, S, store, ar, esc, suraName, ayaLabel, pageInfo, playDrill,
// stopAudio, renderSheet, dismissSheet, closeSheet, openSheet, goTo, flashAya, toast, haptic, Recite.

const Hifz = (() => {
  const view0 = () => view;
  // each: listening, times an aya; whole: then the lesson; rEach / gap: repeating after the reciter, times an
  // aya and the pause (times the aya's length); lEach: linking, times an aya; steps: which are in the routine
  const DEF = { each: 5, whole: 2, rEach: 3, gap: 1, lEach: 2, rate: 1, hide: true, days: 7, review: true,
    steps: { listen: true, repeat: true, link: true, recite: true } };
  const PRESETS = [
    ['light', 'خفيف', 'لمن يحفظ بسرعة', { each: 3, whole: 1, rEach: 2, lEach: 1, gap: 1 }],
    ['mid', 'متوازن', 'لأكثر الحفّاظ', { each: 5, whole: 2, rEach: 3, lEach: 2, gap: 1 }],
    ['deep', 'متقن', 'تكرار كثير لحفظ راسخ', { each: 10, whole: 3, rEach: 5, lEach: 3, gap: 1.5 }],
  ];
  const opts = () => {
    const o = { ...DEF, ...store.get('hifz.o', {}) };
    o.steps = { ...DEF.steps, ...o.steps };
    if (o.whole >= 1e9) o.whole = Infinity;
    return o;
  };
  const presetOf = o => PRESETS.find(([, , , p]) => Object.entries(p).every(([k, v]) => o[k] === v))?.[0] || 'custom';
  const setOpt = (k, v) => store.set('hifz.o', { ...store.get('hifz.o', {}), [k]: v });
  const today = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const dayNo = () => { const d = new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); };
  const log = () => store.get('recite.' + R.id, { ayas: {}, sessions: [] });
  const sizeOf = s => (R.suraStart[s + 1] ?? R.ayas.length) - R.suraStart[s];
  const ayaN = n => n === 1 ? 'آية واحدة' : n === 2 ? 'آيتان' : n <= 10 ? `${ar(n)} آيات` : `${ar(n)} آية`;
  const wordN = n => n === 1 ? 'كلمة واحدة' : n === 2 ? 'كلمتان' : n <= 10 ? `${ar(n)} كلمات` : `${ar(n)} كلمة`;
  const times = n => n === Infinity ? 'بلا توقف' : n === 1 ? 'مرة' : n === 2 ? 'مرتين' : n <= 10 ? `${ar(n)} مرات` : `${ar(n)} مرة`;
  let view = '';

  // ---- the lesson
  function lesson() {
    const L = store.get('hifz.' + R.id, null);
    if (L && R.ayas[L.a] && R.ayas[L.b] && L.a <= L.b && R.ayas[L.a][0] === R.ayas[L.b][0]) return L; // (L.pg: page by page)
    // none yet: today's portion of the plan in التسميع, else the page being read
    const said = log().said || {}, plan = store.get('recite.plan.' + R.id, null);
    if (plan && R.suraStart[plan.s] != null) {
      const a0 = R.suraStart[plan.s], n = sizeOf(plan.s);
      for (let a = a0; a < a0 + n; a++) if (!said[a]) return { a, b: Math.min(a0 + n - 1, a + (plan.per || 5) - 1) };
    }
    let a = pageInfo(S.page).first;
    while (a < R.ayas.length - 1 && said[a]) a++;
    return span(a, 5);
  }
  // n ayas from a, not past its surah
  // (a leftover of an aya or two at the surah's end joins this lesson rather than make one of its own)
  function span(a, n) {
    const s = R.ayas[a][0], end = R.suraStart[s] + sizeOf(s) - 1;
    let b = Math.min(end, a + n - 1);
    if (end - b > 0 && end - b <= Math.max(2, Math.floor(n / 2))) b = end;
    return { a, b };
  }
  // (dir: -1 going back through the surahs, as جزء عمّ is memorized from الناس; kept unless given)
  function setLesson(L) {
    const cur = store.get('hifz.' + R.id, null), dir = L.dir ?? cur?.dir, n = L.n ?? cur?.n;
    store.set('hifz.' + R.id, { a: L.a, b: L.b, ...(L.pg ? { pg: 1 } : {}), ...(dir === -1 ? { dir } : {}), ...(n ? { n } : {}) });
    // the plan in التسميع, if there is one, on the same surah
    const pk = 'recite.plan.' + R.id, p = store.get(pk, null), su = R.ayas[L.a][0];
    if (p && p.s !== su) store.set(pk, { ...p, s: su, at: Date.now() });
  }
  // the first aya of a surah not yet memorized (null: all of it is)
  function firstOpen(su, said = log().said || {}) {
    const a0 = R.suraStart[su], n = sizeOf(su);
    for (let a = a0; a < a0 + n; a++) if (!said[a]) return a;
    return null;
  }
  // the lesson in a surah: from its first aya not yet memorized, n long (the lesson's own length kept)
  function inSura(su, n, dir) {
    const a = firstOpen(su);
    return a == null ? null : { ...span(a, n), ...(dir ? { dir } : {}) };
  }
  // a page as the lesson: from aya a to the end of its page (or of its surah, if that comes first)
  function pageSpan(a) {
    let b = a;
    while (b + 1 < R.ayas.length && R.ayas[b + 1][2] === R.ayas[a][2] && R.ayas[b + 1][0] === R.ayas[a][0]) b++;
    return { a, b, pg: 1 };
  }
  const listOf = L => Array.from({ length: L.b - L.a + 1 }, (_, i) => L.a + i);
  const lessonKey = L => `${R.id}:${L.a}-${L.b}`;
  const rangeText = L => `${suraName(R.ayas[L.a][0])} ${ar(R.ayas[L.a][1])}${L.b > L.a ? '–' + ar(R.ayas[L.b][1]) : ''}`;

  // steps done today, of this lesson
  function stepsDone(L) {
    const d = store.get('hifz.day', null);
    return d && d.d === today() && d.k === lessonKey(L) ? d.s : {};
  }
  function markStep(L, k) {
    const s = { ...stepsDone(L), [k]: 1 };
    store.set('hifz.day', { d: today(), k: lessonKey(L), s });
    mark(1);
    if (!$('#sheet').hidden && tab === 'hifz') renderSheet();
  }

  // ---- revision (Plan.revision): السبقي, what was memorized in the last 7 days, every day; المنزل, the
  // older pages, the least recently recited first and the weak ones (mistakes in التسميع not yet mended)
  // more often. Today's pages are chosen once a day (hifz.plan.<riwaya>) so reciting them doesn't
  // change them; done when every aya of both was recited today.
  function review(L) {
    const l = log(), said = l.said || {}, first = l.first || {}, o = opts();
    const weak = new Set(Object.keys(l.ayas || {}).filter(k => !l.ayas[k].done).map(Number));
    const r = Plan.revision({ ayas: R.ayas, said, first, weak, days: o.days, skip: ai => ai >= L.a && ai <= L.b });
    const key = 'hifz.plan.' + R.id, d = today();
    let c = store.get(key, null);
    if (c?.d !== d || c.days !== o.days) { c = { d, days: o.days, total: r.total, part: r.part, pages: r.pages, weakPages: r.weakPages, late: r.late }; store.set(key, c); }
    else if (c.total !== r.total) {
      // (more memorized since the day's pages were chosen — surahs marked as known: chosen again, what was chosen kept)
      const pages = [...new Set([...c.pages, ...r.pages])].sort((x, y) => x - y);
      c = { ...c, total: r.total, part: [...new Set([...c.part, ...r.part])].sort((x, y) => x - y), pages, weakPages: Math.max(c.weakPages || 0, r.weakPages), late: r.late };
      store.set(key, c);
    }
    const part = c.part.filter(ai => said[ai] && !(ai >= L.a && ai <= L.b));
    const start = Plan.dayStart(), all = [...r.near, ...part];
    const left = all.filter(ai => !(said[ai] >= start));
    return { near: r.near, part, pages: c.pages, weakPages: c.weakPages, late: c.late, total: r.total, all, left, done: all.length > 0 && !left.length };
  }
  // the days: hifz.hist.<riwaya> = { day: 1 (something done) | 2 (the whole revision done) }
  const histKey = () => 'hifz.hist.' + R.id;
  function mark(v = 1) {
    const h = store.get(histKey(), {}), d = today();
    if ((h[d] || 0) >= v) return;
    h[d] = v;
    const ks = Object.keys(h);
    if (ks.length > 400) ks.slice(0, ks.length - 400).forEach(k => delete h[k]);
    store.set(histKey(), h);
  }
  // after a recitation (recite.js) or on opening the panel: today's revision done?
  function check() {
    if (!R) return;
    const l = log();
    if ((l.days || {})[today()]) mark(1);
    if (opts().review && review(lesson()).done) {
      const was = store.get(histKey(), {})[today()] === 2;
      mark(2);
      if (!was) toast('أتممت مراجعة اليوم، تقبّل الله منك', 3000);
    }
  }
  function days() {
    const l = log(), h = store.get(histKey(), {}), active = new Set(Object.keys(h)), full = new Set(Object.keys(h).filter(k => h[k] === 2));
    for (const [k, n] of Object.entries(l.days || {})) if (n) active.add(k);
    for (const t of Object.values(l.first || {})) if (t > 1e9) active.add(today(t));
    return { active, full };
  }
  function daysHTML() {
    const { active, full } = days(), st = Plan.streak(active), strip = Plan.lastDays(28, active, full);
    const said = Object.keys(log().said || {}).filter(k => R.ayas[+k]), pages = new Set(said.map(k => R.ayas[+k][2]));
    const pct = Math.round(said.length / R.ayas.length * 1000) / 10;
    const wd = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
    return `<div class="pp-h hz-h"><b>أيامك</b><small>${st.now ? `${ar(st.now)} ${st.now === 1 ? 'يوم' : st.now === 2 ? 'يومان' : st.now <= 10 ? 'أيام' : 'يومًا'} متتالية${st.today ? '' : ' · أكملها اليوم'}` : 'ابدأ اليوم سلسلة أيامك'}</small></div>
      <div class="group hz-days">
        <div class="hz-strip">${strip.map(x => `<i class="${x.full ? 'full' : x.on ? 'on' : ''}${x.today ? ' now' : ''}" title="${x.key}"><span>${wd[x.wd]}</span></i>`).join('')}</div>
        <div class="hz-key"><span><i class="on"></i>حفظ أو تسميع</span><span><i class="full"></i>المراجعة كلها</span>${st.best > st.now ? `<span>أطول سلسلة: ${ar(st.best)}</span>` : ''}</div>
        <div class="hz-tot"><b>${ar(said.length)}</b><small>آية</small><b>${ar(pages.size)}</b><small>صفحة</small><b>${ar(pct)}٪</b><small>من القرآن</small></div>
      </div>`;
  }
  const listText = list => list.length ? `${ayaLabel(list[0])}${list.length > 1 ? ` – ${R.ayas[list.at(-1)][0] === R.ayas[list[0]][0] ? ar(R.ayas[list.at(-1)][1]) : ayaLabel(list.at(-1))}` : ''}` : '';

  // ---- the first time: what is memorized already, where to begin, how long a lesson (once; hifz.setup)
  let undo = null; // («حفظتُ» just tapped: { L, added, t, text }, to take back)
  const setup = { from: 'amma', n: 5 };
  const needsSetup = () => !store.get('hifz.setup', 0) && !store.get('hifz.' + R.id, null);
  // the first lesson from a starting point: جزء عمّ from الناس back, the mushaf from its start (both past
  // what is memorized)
  function startAt(from, n) {
    // (جزء عمّ known already: on back through the mushaf, تبارك next)
    if (from === 'amma') { for (let s = 114; s >= 1; s--) { const N = inSura(s, n, -1); if (N) return N; } return null; }
    for (let s = 1; s <= 114; s++) { const N = inSura(s, n); if (N) return N; }
    return null;
  }
  function setupHTML() {
    const known = Object.keys(log().said || {}).length;
    const ch = (k, v, t, sub) => `<button data-hz-su="${k}" data-v="${v}" class="${setup[k] === v ? 'on' : ''}"><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
    return `<div class="hz">${typeof Extras !== 'undefined' ? Extras.safetyHTML() : ''}<section class="hz-start">
      <b class="hz-s-t">ابدأ رحلتك في الحفظ</b><small class="hz-s-sub">ثلاثة أسئلة، مرة واحدة، وتغيّرها متى شئت</small>
      <div class="hz-s-q"><span><i>١</i>ما تحفظه من قبل</span>
        <button class="hz-s-known" data-hz-view="known">${known ? `${ayaN(known)} محفوظة — غيّرها` : 'علّم السور التي تحفظها'}<small>${known ? 'تبدأ مراجعتها من اليوم' : 'لتُراجَع، ولا تأتيك دروسًا من جديد'}</small></button></div>
      <div class="hz-s-q"><span><i>٢</i>من أين تبدأ؟</span><div class="hz-s-ch">
        ${ch('from', 'amma', 'جزء عمّ', 'من الناس صعودًا')}${ch('from', 'start', 'أول المصحف', 'الفاتحة ثم البقرة')}${ch('from', 'pick', 'سورة أختارها', '')}</div></div>
      <div class="hz-s-q"><span><i>٣</i>كم في الدرس الواحد؟</span><div class="hz-chips">
        ${[3, 5, 7, 10].map(k => `<button data-hz-su="n" data-v="${k}" class="${setup.n === k ? 'on' : ''}">${ayaN(k)}</button>`).join('')}<button data-hz-su="n" data-v="page" class="${setup.n === 'page' ? 'on' : ''}">صفحة</button></div>
        <small class="hz-s-note">للمبتدئ: ٣ إلى ٥ آيات، تزيد إذا ثبت حفظك</small></div>
      <button class="hz-go" data-hz-begin><span class="hz-go-i">${IC.play}</span><span><b>ابدأ</b><small>${setup.from === 'pick' ? 'ثم اختر السورة' : 'ويظهر درسك الأول'}</small></span></button>
      <button class="hz-s-skip" data-hz-begin="skip">تخطَّ — سأختار بنفسي</button>
    </section>${daysHTML()}</div>`;
  }
  function setupClick(t) {
    const c = t.closest('[data-hz-su]');
    if (c) { const v = c.dataset.v; setup[c.dataset.hzSu] = /^\d+$/.test(v) ? +v : v; renderSheet(); haptic(5); return true; }
    const b = t.closest('[data-hz-begin]');
    if (!b) return false;
    store.set('hifz.setup', 1);
    if (b.dataset.hzBegin !== 'skip') {
      const n = setup.n === 'page' ? 5 : setup.n;
      if (setup.from === 'pick') { const N = startAt('start', n) || span(0, n); setLesson(setup.n === 'page' ? pageSpan(N.a) : { ...N, n }); view = 'edit'; }
      else {
        const N = startAt(setup.from, n);
        if (!N) toast('ما شاء الله، كله محفوظ — اختر ما تراجعه');
        else setLesson(setup.n === 'page' ? { ...pageSpan(N.a), ...(N.dir ? { dir: N.dir } : {}) } : { ...N, n });
      }
    }
    renderSheet(); $('#sheetBody').scrollTop = 0; haptic(10);
    return true;
  }

  // ---- what is memorized already, a surah at a time (or a juz of them at once); added only here (taking
  // one out is on its page in التسميع, where it is noted for the sync)
  let picked = new Set();
  function knownHTML() {
    const said = log().said || {}, full = s => firstOpen(s, said) == null, juz = s => R.ayas[R.suraStart[s]][3];
    const part = s => { const a0 = R.suraStart[s]; let k = 0; for (let a = a0; a < a0 + sizeOf(s); a++) if (said[a]) k++; return k; };
    const sel = [...picked], ayas = sel.reduce((t, s) => t + sizeOf(s) - part(s), 0);
    const group = (t, list) => `<button data-hz-kg="${list.join(',')}">${t}</button>`;
    const amma = [], tabarak = [];
    for (let s = 1; s <= 114; s++) { if (juz(s) === 30) amma.push(s); if (juz(s) === 29) tabarak.push(s); }
    return `<div class="pp pp-sub"><div class="pp-bar"><button class="pp-back" data-hz-view="" aria-label="رجوع">${IC.back}</button><b>ما تحفظه من قبل</b></div>
      <div class="pp-subb hz-kn">
        <p class="hz-hint">اختر السور التي تحفظها كلها: تُراجَع كل يوم بقدرٍ، ولا تأتيك دروسًا من جديد. وما حفظت بعضه فمن صفحة السورة في «التسميع».</p>
        <div class="hz-chips hz-kg">${group('جزء عمّ كله', amma)}${group('جزء تبارك', tabarak)}${group('الفاتحة', [1])}${sel.length ? '<button data-hz-kg="none">لا شيء</button>' : ''}</div>
        <div class="pp-grid hz-kgrid">${Array.from({ length: 114 }, (_, i) => i + 1).map(s => {
          const f = full(s), k = part(s), on = picked.has(s);
          return `<button class="pp-g${f ? ' full' : ''}${on ? ' sel' : ''}" data-hz-ks="${s}"${f ? ' disabled' : ''}><span class="pp-g-n">${ar(s)}</span><b>${suraName(s)}</b><small>${f ? 'محفوظة' : k ? `${ar(k)} من ${ar(sizeOf(s))}` : ayaN(sizeOf(s))}</small>${f || on ? `<span class="pp-g-ok">${IC.check}</span>` : ''}</button>`;
        }).join('')}</div>
        <div class="hz-foot"><span class="hz-sum">${sel.length ? `<b>${ar(sel.length)} ${sel.length <= 10 && sel.length > 2 ? 'سور' : 'سورة'}</b> · ${ayaN(ayas)}` : 'اختر سورة أو أكثر'}</span><button class="hz-done" data-hz-known${sel.length ? '' : ' disabled'}>احفظ</button></div>
      </div></div>`;
  }
  function knownClick(t) {
    const ks = t.closest('[data-hz-ks]');
    if (ks) { const s = +ks.dataset.hzKs; picked.has(s) ? picked.delete(s) : picked.add(s); keepScroll(); haptic(4); return true; }
    const kg = t.closest('[data-hz-kg]');
    if (kg) {
      if (kg.dataset.hzKg === 'none') picked.clear();
      else { const said = log().said || {}; for (const s of kg.dataset.hzKg.split(',').map(Number)) if (firstOpen(s, said) != null) picked.add(s); }
      keepScroll(); haptic(5);
      // (the surahs just picked shown, wherever they are in the list)
      if (kg.dataset.hzKg !== 'none') document.querySelector('.hz-kgrid .pp-g.sel')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return true;
    }
    if (!t.closest('[data-hz-known]') || !picked.size) return false;
    const l = log(), now = Date.now();
    l.said ||= {}; l.first ||= {};
    const add = [];
    for (const s of picked) for (let a = R.suraStart[s]; a < R.suraStart[s] + sizeOf(s); a++) if (!l.said[a]) add.push(a);
    const when = Plan.backdate(add, R.ayas, opts().days, now), n = add.length;
    for (const a of add) { l.said[a] = when[a]; l.first[a] = 1; if (l.gone?.said) delete l.gone.said[a]; }
    store.set('recite.' + R.id, l);
    picked = new Set(); undo = null;
    // the lesson, if it is now memorized, moves on
    const L = store.get('hifz.' + R.id, null);
    if (L && R.ayas[L.a] && listOf(L).every(a => l.said[a])) setLesson(nextLesson(L));
    view = '';
    toast(`عُلّمت ${ayaN(n)} محفوظة — تبدأ مراجعتها من اليوم`, 2800);
    renderSheet(); $('#sheetBody').scrollTop = 0; haptic([10, 40, 10]);
    return true;
  }
  const keepScroll = () => { const b = $('#sheetBody'), y = b.scrollTop; renderSheet(); b.scrollTop = y; };

  // ---- the page
  const IC = {
    edit: '<svg viewBox="0 0 24 24"><path d="M14.5 5.5l4 4M4.5 19.5l1-4.5L15.8 4.7a1.5 1.5 0 012.1 0l1.4 1.4a1.5 1.5 0 010 2.1L9 18.5z"/></svg>',
    listen: '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3.5" y="13.5" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="13.5" width="4" height="6.5" rx="1.5"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M17 3.5l3 3-3 3"/><path d="M4 11.5v-1a4 4 0 014-4h12M7 20.5l-3-3 3-3"/><path d="M20 12.5v1a4 4 0 01-4 4H4"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><path d="M12 3.5a3 3 0 00-3 3v5a3 3 0 006 0v-5a3 3 0 00-3-3zM6.5 11a5.5 5.5 0 0011 0M12 16.5v4"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8.5 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/></svg>',
    tune: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  };

  const STEPS = [
    ['listen', 'استمع', o => o.each > 1 ? `كل آية ${times(o.each)}، ثم الدرس ${times(o.whole)}` : `الدرس ${times(o.whole)}`],
    ['repeat', 'ردّد', o => `يقرأ القارئ الآية ${o.rEach > 1 ? times(o.rEach) + ' ' : ''}ويسكت لتعيدها بعده`],
    ['link', 'اربط', o => `آية آية${o.lEach > 1 ? ` (${times(o.lEach)})` : ''}، وبعد كلٍّ من الأولى إليها`],
    ['recite', 'سمّع', o => o.hide ? 'من حفظك والكلمات مخفية، والتطبيق يتابعك' : 'من حفظك، والتطبيق يتابعك'],
  ];
  // what each listening step plays
  const stepPlay = (k, o) => k === 'listen' ? { name: 'استمع', each: o.each, whole: o.whole }
    : k === 'repeat' ? { name: 'ردّد', each: o.rEach, whole: o.rEach > 1 ? 0 : 1, gap: o.gap }
    : k === 'link' ? { name: 'اربط', link: true, each: o.lEach } : null;

  function panelHTML() {
    if (view === 'edit') return editHTML();
    if (view === 'way') return wayHTML();
    if (view === 'known') return knownHTML();
    if (needsSetup()) return setupHTML();
    const L = lesson(), o = opts(), list = listOf(L), said = log().said || {};
    const done = stepsDone(L), have = list.filter(a => said[a]).length, all = have === list.length;
    const words = list.reduce((t, a) => t + R.text[a].split(' ').length - 1, 0);
    const on = STEPS.filter(([k]) => o.steps[k]), plays = on.filter(([k]) => k !== 'recite');
    const allPlayed = plays.length && plays.every(([k]) => done[k]);
    const pr = PRESETS.find(p => p[0] === presetOf(o));
    const un = undo && Date.now() - undo.t < 10 * 60e3 ? undo : null;
    let h = `<div class="hz">${typeof Extras !== 'undefined' ? Extras.safetyHTML() : ''}
      ${un ? `<div class="hz-undo"><span>سُجّل حفظ ${un.text}</span><button data-hz-undo>تراجع</button><button data-hz-undo-x aria-label="إخفاء">×</button></div>` : ''}
      <!--hz-rev-->
      <section class="hz-lesson">
        <div class="hz-l-top"><small>درسك</small><button class="hz-edit" data-hz-view="edit" aria-label="غيّر الدرس">${IC.edit}<span>غيّر</span></button></div>
        <b class="hz-l-name">${rangeText(L)}</b>
        <span class="hz-l-sub">${ayaN(list.length)} · ${wordN(words)} · صفحة ${ar(R.ayas[L.a][2])}${R.ayas[L.b][2] !== R.ayas[L.a][2] ? '–' + ar(R.ayas[L.b][2]) : ''}${have ? ` · حفظت ${ar(have)} منها` : ''}</span>
        <div class="hz-l-acts"><button class="hz-show" data-hz-show>${IC.book}<span>في المصحف</span></button><button class="hz-show" data-hz-reciter>${IC.listen}<span>${esc(reciterFull(R.id))}</span></button></div>
      </section>`;
    // one tap for the whole routine (the listening steps, one after the other), then the recitation
    if (plays.length) h += `<button class="hz-go${allPlayed ? ' ok' : ''}" data-hz-all><span class="hz-go-i">${allPlayed ? IC.check : IC.play}</span>
        <span><b>${allPlayed ? 'أعد الجلسة' : 'ابدأ الجلسة'}</b><small>${plays.map(([, t]) => t).join(' ثم ')} · دون توقف${o.steps.recite && !all ? '، ثم سمّع' : ''}</small></span></button>`;
    // (the steps one by one: a row of tiles, each its own; what each does is said in «طريقتك»)
    h += `<div class="hz-tiles" style="--n:${on.length}">${on.map(([k, t, sub]) => {
        const ok = k === 'recite' ? all : done[k], i = STEPS.findIndex(x => x[0] === k);
        return `<button class="hz-tile${ok ? ' ok' : ''}" data-hz-go="${k}" title="${esc(sub(o))}"><span class="hz-ic">${ok ? IC.check : [IC.listen, IC.repeat, IC.link, IC.mic][i]}</span><b>${t}</b><small>${ok ? 'تمّ' : ar(on.findIndex(x => x[0] === k) + 1)}</small></button>`;
      }).join('')}</div>
      <button class="hz-done${all ? ' ok' : ''}${!all && !Object.keys(done).length ? ' quiet' : ''}" data-hz-memo>${all ? 'حفظتَه، ما شاء الله — إلى الدرس التالي' : 'حفظتُ هذا الدرس — إلى التالي'}</button>
      <button class="hz-way" data-hz-view="way">${IC.tune}<span><b>طريقتك في الحفظ</b><small>${pr ? pr[1] : 'مخصّصة'} · ${ar(on.length)} ${on.length <= 2 ? (on.length === 1 ? 'خطوة' : 'خطوتان') : 'خطوات'} · ${o.rate === 1 ? 'سرعة عادية' : o.rate < 1 ? 'أبطأ' : 'أسرع'}</small></span>${IC.back.replace('M9.5 6l6 6-6 6', 'M14.5 6l-6 6 6 6')}</button>`;
    if (o.review) {
      const rv = review(L);
      let rh = '';
      const H = x => { rh += x; };
      H(`<div class="pp-h hz-h"><b>مراجعة اليوم</b><small>${rv.done ? 'أتممتها اليوم، بارك الله فيك' : rv.all.length ? `بقي ${ayaN(rv.left.length)} تُسمَّع اليوم` : 'بلا مراجعة يتفلّت الحفظ'}</small></div>`);
      if (!rv.near.length && !rv.part.length) H(`<p class="hz-empty">ما تحفظه يُراجَع هنا: القريب منه كل يوم، والقديم صفحاتٍ كل يوم حتى يُختم كل ${ar(o.days)} أيام، وما أخطأت فيه في التسميع يعود أسرع.</p>`);
      else {
        const pg = rv.pages.length, st = new Set(rv.left);
        const nearDone = rv.near.length && rv.near.every(a => !st.has(a)), farDone = rv.part.length && rv.part.every(a => !st.has(a));
        if (rv.left.length) H(`<button class="hz-revgo" data-hz-revall><span class="hz-go-i">${IC.mic}</span><span><b>سمّع مراجعة اليوم</b><small>${ayaN(rv.left.length)}${rv.left.length < rv.all.length ? ' باقية' : ''} · القريب ثم المنزل، دفعة واحدة</small></span></button>`);
        H(`<div class="group hz-rev${rv.done ? ' ok' : ''}">
        ${revRow('near', 'القريب', rv.near.length ? `ما حفظته هذا الأسبوع · ${ayaN(rv.near.length)}` : Object.values(log().first || {}).some(t => t >= Plan.dayStart()) ? 'ما حفظته اليوم يأتي هنا من الغد' : 'لا جديد هذا الأسبوع', rv.near, nearDone)}
        ${revRow('far', 'المنزل', rv.part.length ? `${pg === 1 ? 'صفحة واحدة' : pg === 2 ? 'صفحتان' : `${ar(pg)} صفحات`}${rv.weakPages ? `، ${rv.weakPages === 1 ? 'إحداها' : ar(rv.weakPages)} فيها مواضع ضعف` : ''}</span><span class="s hz-pg">${rv.pages.length === 1 ? 'الصفحة' : 'الصفحات'} ${Plan.pageRuns(rv.pages, ar)}` : 'لا قديم بعد', rv.part, farDone)}
      </div>`);
        if (rv.late) H(`<p class="hz-late">تأخّرت ${ar(rv.late)} ${rv.late <= 10 && rv.late > 2 ? 'صفحات' : 'صفحة'} عن موعد مراجعتها، وستأتي أولًا في الأيام القادمة.</p>`);
      }
      // (revision first, as memorizers do — old before new — until it is done for the day)
      if (rv.all.length && !rv.done) h = h.replace('<!--hz-rev-->', `<div class="hz-first">${rh}</div>`);
      else h += rh;
    }
    h = h.replace('<!--hz-rev-->', '');
    h += daysHTML();
    h += typeof Extras !== 'undefined' ? Extras.remindRowHTML('hifz') : '';
    h += `<button class="hz-more" data-hz-view="known">${IC.check.replace('<svg', '<svg class="hz-k-i"')}<span>علّم ما تحفظه من قبل</span></button>`;
    h += `<button class="hz-more" data-hz-recite>خطة الحفظ، وتقدّمك، ومواضع ضعفك في التسميع ${IC.back.replace('M9.5 6l6 6-6 6', 'M14.5 6l-6 6 6 6')}</button></div>`;
    return h;
  }

  // ---- the way of memorizing: a preset, the steps in the routine, each step's repeats, and the rest
  function wayHTML() {
    const o = opts(), pre = presetOf(o);
    const sec = (k, t, body) => o.steps[k] ? `<div class="hz-sec"><b>${t}</b>${body}</div>` : '';
    return `<div class="pp pp-sub"><div class="pp-bar"><button class="pp-back" data-hz-view="" aria-label="رجوع">${IC.back}</button><b>طريقتك في الحفظ</b></div>
      <div class="pp-subb hz-ed">
        <div class="hz-presets">${PRESETS.map(([id, t, sub]) => `<button data-hz-preset="${id}" class="${pre === id ? 'on' : ''}"><b>${t}</b><small>${sub}</small></button>`).join('')}</div>
        <p class="hz-hint">${pre === 'custom' ? 'طريقة مخصّصة: غيّرت الأعداد بنفسك.' : 'اختر طريقة جاهزة، أو غيّر أي عدد أدناه.'}</p>
        <div class="hz-sec"><b>خطوات جلستك</b><small>اختر ما يناسبك، و«ابدأ الجلسة» يمرّ بها بالترتيب</small>
          <div class="hz-tg">${STEPS.map(([k, t]) => `<button data-hz-stepon="${k}" class="${o.steps[k] ? 'on' : ''}" role="switch" aria-checked="${!!o.steps[k]}">${o.steps[k] ? IC.check : ''}<span>${t}</span></button>`).join('')}</div></div>
        ${sec('listen', 'الاستماع', chips('each', 'كل آية', [[1, '١'], [3, '٣'], [5, '٥'], [7, '٧'], [10, '١٠'], [20, '٢٠']], o.each)
          + chips('whole', 'ثم الدرس كله', [[1, '١'], [2, '٢'], [3, '٣'], [5, '٥'], [0, '∞']], o.whole === Infinity ? 0 : o.whole))}
        ${sec('repeat', 'الترديد', chips('rEach', 'كل آية', [[1, '١'], [2, '٢'], [3, '٣'], [5, '٥'], [7, '٧']], o.rEach)
          + chips('gap', 'مهلتك بعدها', [[0.5, 'نصفها'], [1, 'مثلها'], [1.5, 'مرة ونصف'], [2, 'ضعفها']], o.gap))}
        ${sec('link', 'الربط', chips('lEach', 'كل آية قبل ربطها', [[1, '١'], [2, '٢'], [3, '٣'], [5, '٥']], o.lEach))}
        <div class="hz-sec"><b>التلاوة</b>${chips('rate', 'السرعة', [[0.75, 'أبطأ'], [0.9, 'أبطأ قليلًا'], [1, 'عادية'], [1.25, 'أسرع']], o.rate)}
          <button class="hz-sw hz-o" data-hz-reciter><span>القارئ</span><span class="hz-val">${esc(reciterFull(R.id))} ›</span></button></div>
        <div class="hz-sec"><b>التسميع والمراجعة</b>
          ${toggle('hide', 'إخفاء الكلمات عند التسميع', o.hide)}
          ${toggle('review', 'إظهار مراجعة اليوم', o.review)}
          ${o.review ? chips('days', 'تُراجَع محفوظاتك القديمة كلها كل', [[3, '٣ أيام'], [5, '٥'], [7, '٧'], [10, '١٠'], [14, '١٤'], [30, '٣٠']], o.days) : ''}</div>
        <button class="hz-reset" data-hz-preset="mid">العودة إلى الطريقة الأصلية</button>
      </div></div>`;
  }
  function toggle(k, label, on) {
    return `<button class="hz-sw hz-o rc-set" data-hz-flag="${k}" role="switch" aria-checked="${on}"><span>${label}</span><span class="tog${on ? ' on' : ''}"><i></i></span></button>`;
  }
  function chips(k, label, list, cur) {
    return `<div class="hz-o"><span>${label}</span><div class="hz-chips">${list.map(([v, t]) =>
      `<button data-hz-opt="${k}" data-v="${v}" class="${v === cur ? 'on' : ''}">${t}</button>`).join('')}</div></div>`;
  }
  function revRow(k, t, sub, list, ok) {
    return `<div class="row hz-rr${ok ? ' ok' : ''}"><span class="hz-rk ${k}">${ok ? '✓ ' : ''}${t}</span><span class="main"><span class="s">${sub}</span></span>
      ${list.length ? `<button class="hz-rb" data-hz-rev="${k}" data-how="play" aria-label="استمع">${IC.play}</button><button class="hz-rb" data-hz-rev="${k}" data-how="recite" aria-label="سمّع">${IC.mic}</button>` : ''}</div>`;
  }

  // ---- changing the lesson: its surah, first and last aya (typed, or + and − held to run), or a quick pick;
  // what it comes to stays in view at the bottom, and the ayas are shown first and last, not all of them
  const sumText = L => {
    const list = listOf(L), words = list.reduce((t, a) => t + R.text[a].split(' ').length - 1, 0), p0 = R.ayas[L.a][2], p1 = R.ayas[L.b][2];
    return `<b>${ayaN(list.length)}</b> · ${wordN(words)} · ${p1 > p0 ? `الصفحات ${ar(p0)}–${ar(p1)}` : `صفحة ${ar(p0)}`}`;
  };
  function previewHTML(L) {
    const list = listOf(L), aya = a => `<span>${esc(R.text[a])}</span>`;
    if (list.length <= 4) return list.map(aya).join(' ');
    return `${aya(list[0])}<i class="hz-gap">… ${list.length - 2 === 2 ? 'وآيتان' : `و${ayaN(list.length - 2)}`} بينهما …</i>${aya(list.at(-1))}`;
  }
  function editHTML() {
    const L = lesson(), s = R.ayas[L.a][0], a0 = R.suraStart[s], n = sizeOf(s), list = listOf(L);
    const opt = META.suras.map((x, i) => `<option value="${i + 1}"${i + 1 === s ? ' selected' : ''}>${ar(i + 1)}. ${x[0]}</option>`).join('');
    const stepper = (k, v, lab) => `<div class="hz-stp"><span>${lab}</span><div><button data-hz-step="${k}" data-d="1" aria-label="زد">+</button>
      <input class="hz-num" data-hz-num="${k}" inputmode="numeric" enterkeyhint="done" autocomplete="off" value="${ar(v)}" aria-label="${lab}"><button data-hz-step="${k}" data-d="-1" aria-label="أنقص">−</button></div></div>`;
    return `<div class="pp pp-sub"><div class="pp-bar"><button class="pp-back" data-hz-view="" aria-label="رجوع">${IC.back}</button><b>الدرس</b><small class="hz-of">${suraName(s)} · ${ayaN(n)}</small></div>
      <div class="pp-subb hz-ed">
        <div class="hz-top">
          <label class="hz-sel"><span>السورة</span><select data-hz-sura>${opt}</select></label>
          ${stepper('a', L.a - a0 + 1, 'من الآية')}${stepper('b', L.b - a0 + 1, 'إلى الآية')}
        </div>
        <div class="hz-o"><span>أو اختر سريعًا</span><div class="hz-chips">
          <button data-hz-quick="page">الصفحة التي تقرؤها</button>
          <button data-hz-quick="wpage" class="${L.pg ? 'on' : ''}">صفحة صفحة</button>
          <button data-hz-quick="next">الآيات التالية</button>
          <button data-hz-quick="amma">جزء عمّ من الناس</button>
          ${[3, 5, 7, 10, 15, 20].filter(k => k < n).map(k => `<button data-hz-len="${k}" class="${list.length === k ? 'on' : ''}">${ayaN(k)}</button>`).join('')}
          <button data-hz-len="${n}" class="${list.length === n ? 'on' : ''}">السورة كلها</button>
        </div></div>
        <div class="hz-text" style="font-family:${R.font}">${previewHTML(L)}</div>
        <div class="hz-foot"><span class="hz-sum">${sumText(L)}</span><button class="hz-done" data-hz-view="">تم</button></div>
      </div></div>`;
  }
  // a step of the first or last aya, kept in its surah and in order
  function stepTo(k, v) {
    const L = lesson(), s = R.ayas[L.a][0], a0 = R.suraStart[s], end = a0 + sizeOf(s) - 1, N = { a: L.a, b: L.b };
    if (k === 'a') { N.a = Math.max(a0, Math.min(end, v)); N.b = Math.max(N.a, N.b); }
    else { N.b = Math.max(a0, Math.min(end, v)); N.a = Math.min(N.a, N.b); }
    setLesson(N);
    return N;
  }
  // painted in place while a button is held (a render would lose the press)
  function paintEdit(N) {
    const ed = document.querySelector('.hz-ed');
    if (!ed) return;
    const a0 = R.suraStart[R.ayas[N.a][0]];
    ed.querySelector('[data-hz-num="a"]').value = ar(N.a - a0 + 1);
    ed.querySelector('[data-hz-num="b"]').value = ar(N.b - a0 + 1);
    ed.querySelector('.hz-sum').innerHTML = sumText(N);
    ed.querySelector('.hz-text').innerHTML = previewHTML(N);
  }
  // «تم» and the sum kept just above the dock, wherever the panel's bottom is (the dock's height, the
  // panel running under it, the safe area: measured, not guessed)
  function footAt() {
    const f = document.querySelector('.hz-foot'), body = document.getElementById('sheetBody'), dock = document.getElementById('dock');
    if (!f || !body) return;
    // (sticky counts from inside the panel's bottom padding; the dock's top read from the screen's bottom,
    // as the panel may still be sliding in)
    const shown = dock && dock.getClientRects().length && getComputedStyle(dock).visibility !== 'hidden';
    const over = shown ? Math.max(0, innerHeight - dock.getBoundingClientRect().top) : 0;
    f.style.bottom = Math.round(over - parseFloat(getComputedStyle(body).paddingBottom || 0)) + 'px';
  }
  addEventListener('resize', () => requestAnimationFrame(footAt));
  let holdT = 0;
  function onPointerDown(e) {
    const btn = e.target.closest('[data-hz-step]');
    if (!btn || e.button > 0) return;
    e.preventDefault();
    let reps = 0;
    const go = () => {
      const L = lesson(), k = btn.dataset.hzStep, d = +btn.dataset.d * (reps >= 40 ? 10 : reps >= 15 ? 3 : 1);
      const before = k === 'a' ? L.a : L.b, N = stepTo(k, before + d);
      if ((k === 'a' ? N.a : N.b) !== before) { paintEdit(N); haptic(3); }
      reps++;
    };
    go();
    clearTimeout(holdT);
    holdT = setTimeout(function loop() { go(); holdT = setTimeout(loop, reps > 12 ? 45 : 90); }, 380);
    const stop = () => {
      clearTimeout(holdT);
      removeEventListener('pointerup', stop); removeEventListener('pointercancel', stop);
      renderSheet();
    };
    addEventListener('pointerup', stop); addEventListener('pointercancel', stop);
  }
  const digits = v => +String(v).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/\D/g, '');

  function play(list, o, then) { dismissSheet(); playDrill(list, o, then); }

  function onClick(e) {
    const t = e.target;
    if (t.closest('[data-hz-undo]') && undo) {
      // «حفظتُ» taken back: those ayas not memorized (noted, so a synced copy doesn't bring them back), the lesson as it was
      const l = log(), now = Date.now();
      for (const a of undo.added) { delete l.said?.[a]; delete l.first?.[a]; ((l.gone ||= {}).said ||= {})[a] = now; }
      store.set('recite.' + R.id, l);
      setLesson(undo.L);
      undo = null;
      toast('تراجعتَ: الدرس كما كان');
      renderSheet(); haptic(8);
      return true;
    }
    if (t.closest('[data-hz-undo-x]')) { undo = null; renderSheet(); return true; }
    if (setupClick(t) || knownClick(t)) return true;
    const v = t.closest('[data-hz-view]');
    if (v) { view = v.dataset.hzView; renderSheet(); $('#sheetBody').scrollTop = 0; haptic(5); return true; }
    const L = lesson(), o = opts(), list = listOf(L);
    if (t.closest('[data-hz-all]')) {
      const ks = STEPS.map(([k]) => k).filter(k => o.steps[k] && k !== 'recite');
      play(list, { seq: ks.map((k, i) => { const x = stepPlay(k, o); return ks.length > 1 ? { ...x, name: `${x.name} (${ar(i + 1)} من ${ar(ks.length)})` } : x; }), rate: o.rate }, () => {
        const s = { ...stepsDone(L) };
        ks.forEach(k => { s[k] = 1; });
        store.set('hifz.day', { d: today(), k: lessonKey(L), s });
        mark(1);
        toast(o.steps.recite ? 'انتهت الجلسة — سمّعه الآن من حفظك' : 'انتهت الجلسة، بارك الله فيك', 3000);
        if (o.steps.recite) openSheet('hifz');
      });
      haptic(8);
      return true;
    }
    const go = t.closest('[data-hz-go]');
    if (go) {
      const k = go.dataset.hzGo;
      if (k === 'recite') { stopAudio(); closeSheet(); Recite.start(null, list, { kind: 'new', hide: o.hide }); }
      else play(list, { ...stepPlay(k, o), rate: o.rate }, () => markStep(L, k));
      haptic(8);
      return true;
    }
    if (t.closest('[data-hz-reciter]')) { openSheet('settings', 'reciter'); return true; }
    if (t.closest('[data-hz-show]')) { dismissSheet(); goTo(R.ayas[L.a][2]); setTimeout(() => flashAya(L.a), 250); return true; }
    if (t.closest('[data-hz-memo]')) {
      const l = log();
      l.said ||= {}; l.first ||= {};
      const added = list.filter(a => !l.said[a]);
      for (const a of added) { l.said[a] = Date.now(); l.first[a] = Date.now(); }
      store.set('recite.' + R.id, l);
      mark(1);
      undo = { L, added, t: Date.now(), text: rangeText(L) };
      setLesson(nextLesson(L));
      toast('بارك الله لك — هذا درسك التالي');
      haptic([10, 40, 10]);
      renderSheet();
      return true;
    }
    const keepY = fn => { const b = $('#sheetBody'), y = b.scrollTop; fn(); renderSheet(); b.scrollTop = y; haptic(5); return true; };
    const op = t.closest('[data-hz-opt]');
    if (op) {
      let val = +op.dataset.v;
      if (op.dataset.hzOpt === 'whole' && !val) val = 1e9;
      return keepY(() => setOpt(op.dataset.hzOpt, val));
    }
    const ps = t.closest('[data-hz-preset]');
    if (ps) return keepY(() => { const p = PRESETS.find(x => x[0] === ps.dataset.hzPreset)[3]; store.set('hifz.o', { ...store.get('hifz.o', {}), ...p }); });
    const so = t.closest('[data-hz-stepon]');
    if (so) {
      const k = so.dataset.hzStepon, st = { ...o.steps, [k]: !o.steps[k] };
      if (!Object.values(st).some(Boolean)) { toast('أبقِ خطوة واحدة على الأقل'); return true; }
      return keepY(() => setOpt('steps', st));
    }
    const fl = t.closest('[data-hz-flag]');
    if (fl) return keepY(() => setOpt(fl.dataset.hzFlag, !o[fl.dataset.hzFlag]));
    if (t.closest('[data-hz-revall]')) { const r = review(L); if (r.left.length) { stopAudio(); closeSheet(); Recite.start(null, r.left, { kind: 'rev', hide: o.hide }); } return true; }
    const rv = t.closest('[data-hz-rev]');
    if (rv) {
      const r = review(L), l2 = rv.dataset.hzRev === 'near' ? r.near : r.part;
      if (rv.dataset.how === 'play') play(l2, { rate: o.rate });
      else { stopAudio(); closeSheet(); Recite.start(null, l2, { kind: 'rev', hide: o.hide }); }
      return true;
    }
    if (t.closest('[data-hz-recite]')) { openSheet('recite'); return true; }
    // the lesson's page
    const st = t.closest('[data-hz-step]');
    if (st) {
      // (stepped on the press, onPointerDown; a click from the keyboard steps here)
      if (e.detail === 0) { stepTo(st.dataset.hzStep, (st.dataset.hzStep === 'a' ? L.a : L.b) + +st.dataset.d); renderSheet(); }
      return true;
    }
    if (t.closest('[data-hz-num]')) { const i = t.closest('[data-hz-num]'); i.select?.(); return true; }
    const q = t.closest('[data-hz-quick]');
    if (q) {
      if (q.dataset.hzQuick === 'page') setLesson(pageSpan(pageInfo(S.page).first));
      else if (q.dataset.hzQuick === 'wpage') {
        // from the start of the lesson's page
        let a = L.a;
        while (a > 0 && R.ayas[a - 1][2] === R.ayas[L.a][2] && R.ayas[a - 1][0] === R.ayas[L.a][0]) a--;
        setLesson(pageSpan(a));
      } else if (q.dataset.hzQuick === 'amma') {
        const N = startAt('amma', L.b - L.a + 1);
        if (N) setLesson(N); else toast('جزء عمّ كله محفوظ، ما شاء الله');
      } else setLesson(nextLesson(L));
      renderSheet(); haptic(5);
      return true;
    }
    const ln = t.closest('[data-hz-len]');
    if (ln) {
      const n = +ln.dataset.hzLen, s = R.ayas[L.a][0];
      setLesson(n >= sizeOf(s) ? { a: R.suraStart[s], b: R.suraStart[s] + sizeOf(s) - 1 } : { ...span(L.a, n), n });
      renderSheet(); haptic(5);
      return true;
    }
    return false;
  }
  // as many ayas after this lesson, in its surah (or the next surah from its start)
  // what is memorized already skipped; after the last surah of the way, the other way (الناس: back to الفلق)
  function nextLesson(L) {
    const said = log().said || {};
    if (L.pg) { let a = L.b + 1; while (a < R.ayas.length && said[a]) a++; return a < R.ayas.length ? pageSpan(a) : L; }
    const n = L.n || store.get('hifz.' + R.id, null)?.n || L.b - L.a + 1, s = R.ayas[L.a][0], end = R.suraStart[s] + sizeOf(s) - 1;
    let a = L.b + 1;
    while (a <= end && said[a]) a++;
    if (a <= end) return span(a, n);
    const dir = L.dir || store.get('hifz.' + R.id, null)?.dir || (s === 114 ? -1 : 1);
    for (const d of [dir, -dir]) for (let t = s + d; t >= 1 && t <= 114; t += d) { const N = inSura(t, n, d); if (N) return N; }
    return L;
  }
  function onChange(e) {
    const num = e.target.closest('[data-hz-num]');
    if (num) {
      const L = lesson(), a0 = R.suraStart[R.ayas[L.a][0]], v = digits(num.value);
      // painted in place: a render now would swallow a tap on «تم» that took the focus away
      paintEdit(v ? stepTo(num.dataset.hzNum, a0 + v - 1) : L);
      return true;
    }
    const sel = e.target.closest('[data-hz-sura]');
    if (!sel) return false;
    const L = lesson(), n = Math.min(L.b - L.a + 1, 10);
    setLesson(span(R.suraStart[+sel.value], n));
    renderSheet();
    return true;
  }
  function mounted() {
    check();
    if (document.querySelector('.hz-kn')) footAt();
    const ed = document.querySelector('.hz-ed');
    if (ed) {
      footAt();
      ed.addEventListener('pointerdown', onPointerDown);
      // Enter (or «تم» on the keyboard) sets the number typed
      ed.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-hz-num]')) e.target.blur(); });
    }
  }
  const reset = () => { view = ''; };
  // a surah to memorize (its card on the page): from its first aya not yet memorized, as many as the
  // lesson had, and the panel opened on it
  function learnSura(su) {
    const a0 = R.suraStart[su], n = sizeOf(su), said = log().said || {}, L = lesson();
    let a = a0;
    while (a < a0 + n - 1 && said[a]) a++;
    store.set('hifz.setup', 1);
    setLesson({ ...span(a, Math.min(L.b - L.a + 1, 10)), dir: 0 });
    openSheet('hifz');
    if (a > a0) toast(`تابع ${suraName(su)} من الآية ${ar(R.ayas[a][1])}`);
  }

  // the plan chosen in التسميع: the lesson in that surah, from its first aya not memorized
  function fromPlan(su) {
    const L = store.get('hifz.' + R.id, null), n = L?.n || (L && R.ayas[L.a] ? Math.min(L.b - L.a + 1, 10) : 5), N = inSura(su, n);
    if (N) { store.set('hifz.setup', 1); setLesson({ ...N, dir: 0, n }); }
  }

  // today, as التسميع's wird shows it: the lesson (memorized today?) and the revision
  function today_() {
    if (!R) return null;
    const L = lesson(), o = opts(), first = log().first || {}, t0 = Plan.dayStart();
    const newToday = Object.keys(first).filter(k => first[k] >= t0 && R.ayas[+k]).map(Number).sort((a, b) => a - b);
    return { L, text: rangeText(L), n: listOf(L).length, steps: stepsDone(L), setup: needsSetup(), newToday, rv: o.review ? review(L) : null };
  }

  // «احفظ من هنا» on an aya: the lesson from it, as long as lessons are
  function fromAya(ai) {
    const L = store.get('hifz.' + R.id, null), n = L?.n || (L && R.ayas[L.a] ? Math.min(L.b - L.a + 1, 10) : 5);
    store.set('hifz.setup', 1);
    setLesson({ ...span(ai, n), dir: 0, n });
    view = '';
    openSheet('hifz');
    toast(`درسك: ${rangeText(lesson())}`);
  }

  // a lesson recited clean in التسميع (its ayas memorized by that): the next one, the panel open on it
  function advance() {
    const L = lesson(), said = log().said || {};
    if (listOf(L).every(a => said[a])) { mark(1); setLesson(nextLesson(L)); toast(`بارك الله لك — درسك التالي: ${rangeText(lesson())}`, 2600); }
    view = '';
    openSheet('hifz');
  }

  return { advance, fromAya, today: today_, fromPlan, check, panelHTML, onClick, onChange, mounted, reset, learnSura, view: view0, setView: v => { view = v; } };
})();
