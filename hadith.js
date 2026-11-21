'use strict';

// الحديث: Sahih al-Bukhari, Sahih Muslim and Sunan Abi Dawud (data/hadith/, tools/hadith.py).
// Loaded only when the panel is first opened (app.js: loadHadith), and its data a part at a time:
// the books' list (index.json, 7 KB), a kitab a hundred hadiths at a time, a narrator's card from
// the shard he is in; the search runs in hadith-worker.js, away from the page.
// Its pages, one over the other (back goes to the one before): the books, a book's kutub, a
// kitab's hadiths, a hadith (its matn first, its grade, its chain as narrators to tap, the Quran
// it quotes, where else it is narrated), a narrator, the subjects, the saved ones.
// Uses $, esc, ar, store, toast, renderSheet, dismissSheet, goTo, flashAya, R and haptic from app.js.
const Hadith = (() => {
  const V = HADITH_V; // (app.js)
  const BOOKS = { bukhari: 'صحيح البخاري', muslim: 'صحيح مسلم', abudawud: 'سنن أبي داود' };
  const SHORT = { bukhari: 'البخاري', muslim: 'مسلم', abudawud: 'أبو داود' };
  const PART = 100;
  const files = new Map();
  const J = u => {
    if (!files.has(u)) files.set(u, fetch(`data/hadith/${u}?v=${V}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(e => { files.delete(u); throw e; }));
    return files.get(u);
  };
  const index = () => J('index.json');
  const part = (b, k, p) => J(`${b}/${k}-${p}.json`);
  const hadith = async (b, k, j) => { const d = await part(b, k, Math.floor(j / PART)); return { h: d.h[j % PART], R: d.R }; };
  const rawi = async id => (await J(`rawi/${id % 64}.json`))[id];

  // ---------------------------------------------------------------- words
  const num = (b, h) => b === 'muslim' && h.a ? h.a : h.n;
  const label = (b, h) => num(b, h)[0];
  function nums(list) { // «١٨١٧، ١٨١٨» — or «٣٩٤٣–٣٩٤٥» when they run on
    const l = [...new Set(list)];
    if (l.length > 2 && l.every((x, i) => !i || x === l[i - 1] + 1)) return `${ar(l[0])}–${ar(l[l.length - 1])}`;
    return l.map(ar).join('، ');
  }
  const cite = (b, h) => `رواه ${SHORT[b]} (${nums(num(b, h))})`;
  const nHadith = n => n === 1 ? 'حديث واحد' : n === 2 ? 'حديثان' : n <= 10 ? `${ar(n)} أحاديث` : `${ar(n)} حديثًا`;
  // a hadith's number in the app's star, sized to its digits (the star was made for a surah's 1–3)
  const star = n => `<b class="hd-star" data-d="${String(n).length}">${ar(n)}</b>`;
  const nKitab = n => n <= 10 ? `${ar(n)} كتب` : `${ar(n)} كتابًا`;
  const nTimes = n => n === 1 ? 'مرة' : n === 2 ? 'مرتين' : n <= 10 ? `${ar(n)} مرات` : `${ar(n)} مرة`;
  // a narrator's standing (Ibn Hajar's twelve grades, rank 1–12): its colour
  const RK = k => k === 1 ? 'sh' : k <= 3 ? 'th' : k <= 5 ? 'sd' : k <= 7 ? 'mq' : k <= 9 ? 'dh' : k ? 'mt' : 'gap';
  const RK_NAME = { sh: 'صحابي', th: 'ثقة', sd: 'صدوق', mq: 'مقبول أو مجهول الحال', dh: 'ضعيف أو مجهول', mt: 'متروك أو متهم', gap: 'انقطاع في الإسناد' };
  // Ibn Hajar's generations (Taqrib al-Tahdhib)
  const TB = ['', 'الصحابة', 'كبار التابعين', 'الطبقة الوسطى من التابعين', 'طبقة تلي الوسطى من التابعين', 'الطبقة الصغرى من التابعين',
    'طبقة عاصروا الخامسة ولم يثبت لهم لقاء الصحابة', 'كبار أتباع التابعين', 'الطبقة الوسطى من أتباع التابعين', 'الطبقة الصغرى من أتباع التابعين',
    'كبار الآخذين عن تبع الأتباع', 'الطبقة الوسطى من الآخذين عن تبع الأتباع', 'صغار الآخذين عن تبع الأتباع'];
  const TYPE = { 0: 'حديث قدسي', 2: 'موقوف', 3: 'مقطوع' };
  const gradeCls = g => /موضوع|منكر|جدًا|كذب|شاذ/.test(g) ? 'mt' : /ضعيف/.test(g) ? 'dh' : /حسن/.test(g) && !/صحيح/.test(g) ? 'sd' : 'th';

  const IC = {
    back: '<svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M5 12.5v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" class="hd-ck"><path d="M5.5 12.5l4 4 9-9"/></svg>',
    warn: '<svg viewBox="0 0 24 24" class="hd-wi"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/></svg>',
    person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/></svg>',
    go: '<svg viewBox="0 0 24 24" class="go"><path d="M14.5 6l-6 6 6 6"/></svg>',
    tree: '<svg viewBox="0 0 24 24"><path d="M12 4v16M12 8H6.5v4M12 8h5.5v4M6.5 12H4.5v4M6.5 12h2v4M17.5 12h-2v4M17.5 12h2v4"/></svg>',
    saved: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  };
  const bar = (title, sub = '', tools = '') => `<div class="pp-bar hd-bar"><button class="pp-back" data-hd-back aria-label="رجوع">${IC.back}</button>
    <span class="hd-bt"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${tools ? `<span class="hd-tools">${tools}</span>` : ''}</div>`;
  const wait = '<div class="tf-wait">…</div>';
  const fail = '<div class="empty"><b>تعذّر التحميل</b>تحقق من الاتصال ثم حاول مرة أخرى.<button class="hd-retry" data-hd-retry>أعد المحاولة</button></div>';

  // ---------------------------------------------------------------- pages
  // the pages open, the last on top; kept while the app is open (the panel closed and opened again
  // comes back to the same one); where each page was scrolled to, kept with it
  let stack = [{ v: 'home' }], root = null, run = 0;
  const top = () => stack[stack.length - 1];
  function push(p) {
    const body = $('#sheetBody');
    top().y = body ? body.scrollTop : 0;
    stack.push(p);
    if (stack.length > 40) stack.splice(1, 1);
    paint(true);
  }
  function back() {
    if (stack.length > 1) stack.pop();
    paint(false, top().y);
  }
  async function paint(fwd, y = 0) {
    if (!root?.isConnected) return;
    const id = ++run, p = top();
    const pending = setTimeout(() => { if (id === run) root.innerHTML = (p.v === 'home' ? '' : bar('')) + wait; }, 120);
    let html;
    try { html = await PAGES[p.v](p); } catch (e) { console.error(e); html = (p.v === 'home' ? '' : bar('')) + fail; }
    clearTimeout(pending);
    if (id !== run || !root.isConnected) return;
    root.innerHTML = html;
    root.classList.remove('hd-in', 'hd-out'); void root.offsetWidth;
    root.classList.add(fwd === undefined ? 'hd-fade' : fwd ? 'hd-in' : 'hd-out');
    const body = $('#sheetBody');
    if (body) body.scrollTop = y;
    after?.(); after = null;
  }
  let after = null; // what a page does once it is on the screen (the next part of a kitab watched for)

  const PAGES = {
    async home() {
      const ix = await index();
      const saved = store.get('hd.saved', []), at = store.get('hd.at', null);
      const day = ix.daily?.length ? ix.daily[Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5) % ix.daily.length] : null;
      let dayHTML = '';
      if (day) {
        try {
          const [b, k, j] = day, { h } = await hadith(b, k, j);
          dayHTML = `<button class="hd-day" data-hd-go="${b}:${k}:${j}"><small>حديث اليوم</small>
            <p>${esc(matnOf(h).slice(0, 260))}${matnOf(h).length > 260 ? ' …' : ''}</p><span>${cite(b, h)}${h.o?.some(o => o[4] && o[0] !== b && o[0] !== 'abudawud') ? ' · متفق عليه' : ''}</span></button>`;
        } catch {}
      }
      return `<div class="hd-home">${dayHTML}
        <div class="hd-books">${ix.books.map(b => `<button class="hd-book hd-${b.id}" data-hd-book="${b.id}">
          <b>${b.t}</b><small>${b.au} · ت ${ar(b.d)}هـ</small>
          <span>${nHadith(b.nn)} · ${nKitab(b.k.length)}</span></button>`).join('')}</div>
        <div class="group">
          <button class="row" data-hd-page="topics"><span class="num hd-ic">${IC.tree}</span><span class="main"><span class="t">المواضيع</span><span class="s">أحاديث الكتب الثلاثة مرتبة بموضوعاتها: العبادات، المعاملات، الأخلاق…</span></span>${IC.go}</button>
          ${saved.length ? `<button class="row" data-hd-page="saved"><span class="num hd-ic">${IC.saved}</span><span class="main"><span class="t">المحفوظة</span><span class="s">${nHadith(saved.length)}</span></span>${IC.go}</button>` : ''}
          ${at ? `<button class="row" data-hd-go="${at.b}:${at.k}:${at.j}"><span class="num hd-ic">${IC.clock}</span><span class="main"><span class="t">تابع من حيث وقفت</span><span class="s">${BOOKS[at.b]} · ${ar(at.l)}</span></span>${IC.go}</button>` : ''}
        </div>
        <p class="hd-tip">ابحث في الأعلى بكلمة من الحديث، أو باسم راوٍ، أو برقم الحديث: «مسلم ٢٥٦٤»، «البخاري ١».</p>
        <p class="note hd-cite">${ix.source}</p></div>`;
    },

    async book({ b }) {
      const ix = await index(), B = ix.books.find(x => x.id === b);
      return bar(B.t, `${B.au} · ${nHadith(B.nn)}`) + `<div class="group hd-kutub">${B.k.map(([t, n, first], k) =>
        `<button class="row" data-hd-kitab="${b}:${k}"><span class="num">${ar(k + (b === 'muslim' ? 0 : 1))}</span>
          <span class="main"><span class="t">${k || b !== 'muslim' ? 'كتاب ' : ''}${t}</span><span class="s">${nHadith(n)} · من ${ar(first)}</span></span>${IC.go}</button>`).join('')}</div>`;
    },

    async kitab({ b, k }) {
      const ix = await index(), B = ix.books.find(x => x.id === b), [t, n, , parts] = B.k[k];
      const first = await part(b, k, 0);
      after = () => watchMore(b, k, parts);
      return bar(`${k || b !== 'muslim' ? 'كتاب ' : ''}${t}`, `${BOOKS[b]} · ${nHadith(n)}`) +
        `<div class="group hd-list" data-hd-list="${b}:${k}">${rowsHTML(b, k, 0, first.h)}</div>${parts > 1 ? `<div class="tf-wait hd-more" data-hd-more="1">…</div>` : ''}`;
    },

    async hadith({ b, k, j }) {
      const ix = await index(), { h, R: names } = await hadith(b, k, j), B = ix.books.find(x => x.id === b);
      store.set('hd.at', { b, k, j, l: label(b, h) });
      const saved = isSaved(b, k, j);
      const last = j >= B.k[k][1] - 1 && k >= B.k.length - 1;
      const tools = `<button class="hd-tb${saved ? ' on' : ''}" data-hd-save aria-label="حفظ">${IC.star}</button>
        <button class="hd-tb" data-hd-copy aria-label="نسخ">${IC.copy}</button>
        <button class="hd-tb" data-hd-step="-1" aria-label="السابق"${!j && !k ? ' disabled' : ''}>${IC.back}</button>
        <button class="hd-tb" data-hd-step="1" aria-label="التالي"${last ? ' disabled' : ''}>${IC.next}</button>`;
      const kt = `${k || b !== 'muslim' ? 'كتاب ' : ''}${B.k[k][0]}`;
      return bar(kt, BOOKS[b], tools) + readerHTML(b, h, names, kt);
    },

    async rawi({ id }) {
      const r = await rawi(id);
      if (!r) return bar('الراوي') + '<div class="empty"><b>لا ترجمة له هنا</b>لم تُذكر له ترجمة في المصدر.</div>';
      return bar('ترجمة الراوي') + rawiHTML(r);
    },

    async topics({ t = 0 }) {
      const [T, G] = await Promise.all([J('topics.json'), J('groups.json')]);
      if (!T.kids) { T.kids = {}; T.by = {}; for (const x of T) { (T.kids[x[1]] ||= []).push(x); T.by[x[0]] = x; } }
      const node = T.by[t], kids = T.kids[t] || [], groups = node?.[4] || [];
      const path = []; for (let x = node; x; x = T.by[x[1]]) path.unshift(x[2]);
      const head = t ? bar(esc(node[2]), path.length > 1 ? esc(path.slice(0, -1).join(' › ')) : 'المواضيع') : bar('المواضيع', 'أحاديث الكتب الثلاثة بموضوعاتها');
      return head + (kids.length ? `<div class="group">${kids.map(x => `<button class="row" data-hd-topic="${x[0]}">
          <span class="main"><span class="t">${esc(x[2])}</span><span class="s">${nHadith(x[3])}</span></span>${IC.go}</button>`).join('')}</div>` : '') +
        (groups.length ? `${kids.length ? '<div class="group-label">أحاديث الباب</div>' : ''}<div class="group">${groups.map(g => groupRow(G[g])).join('')}</div>` : '');
    },

    async saved() {
      const list = store.get('hd.saved', []);
      return bar('المحفوظة', nHadith(list.length)) + (list.length ? `<div class="group">${list.map((s, i) =>
        `<button class="row hd-hrow" data-hd-go="${s.b}:${s.k}:${s.j}"><span class="num hd-bn">${SHORT[s.b]}${star(s.l)}</span>
          <span class="main"><span class="s hd-prev">${esc(s.t)}</span></span>
          <span class="del" data-hd-unsave="${i}" aria-label="حذف"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>`).join('')}</div>`
        : '<div class="empty"><b>لا أحاديث محفوظة</b>اضغط ☆ في أعلى الحديث لحفظه هنا.</div>');
    },

    async search({ q }) { $('#q').value = q; return ''; },
  };

  // ---------------------------------------------------------------- a kitab's list
  const matnOf = h => (h.m ? h.t.slice(h.m[0], h.m[1]) : h.t).replace(/\s+/g, ' ').trim();
  function rowsHTML(b, k, p0, hs) {
    return hs.map((h, i) => {
      const j = p0 * PART + i, g = b === 'abudawud' && h.gr?.[0];
      return `<button class="row hd-hrow" data-hd-go="${b}:${k}:${j}"><span class="num hd-n">${star(label(b, h))}</span>
        <span class="main"><span class="s hd-prev">${esc(matnOf(h).slice(0, 180))}</span>
        ${g || TYPE[h.ty] ? `<span class="hd-mini">${TYPE[h.ty] ? `<i class="hd-chip">${TYPE[h.ty]}</i>` : ''}${g ? `<i class="hd-chip g-${gradeCls(g[1])}">${g[1]}</i>` : ''}</span>` : ''}</span></button>`;
    }).join('');
  }
  // the rest of a kitab, a part as its end comes near
  function watchMore(b, k, parts) {
    const more = root.querySelector('[data-hd-more]');
    if (!more) return;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const p = +more.dataset.hdMore;
      try {
        const d = await part(b, k, p);
        if (!more.isConnected) return;
        root.querySelector('[data-hd-list]').insertAdjacentHTML('beforeend', rowsHTML(b, k, p, d.h));
        if (p + 1 < parts) { more.dataset.hdMore = p + 1; watchMore(b, k, parts); } else more.remove();
      } catch { more.innerHTML = '<button class="hd-retry" data-hd-retry-more>تعذّر التحميل — أعد المحاولة</button>'; }
    }, { rootMargin: '600px' });
    io.observe(more);
  }

  // ---------------------------------------------------------------- a hadith
  // its text with what is marked in it: the narrators (to tap), the Quran it quotes (with its aya)
  function marked(h, a, b, names) {
    const marks = [];
    for (const [s, e, id] of h.r || []) if (s >= a && e <= b) marks.push({ s, e, k: 'r', id });
    for (const [s, e, ai, rs] of h.q || []) if (s >= a && e <= b) marks.push({ s, e, k: 'q', ai, rs });
    marks.sort((x, y) => x.s - y.s);
    let out = '', at = a;
    for (const m of marks) {
      if (m.s < at) continue;
      out += esc(h.t.slice(at, m.s));
      const t = h.t.slice(m.s, m.e);
      if (m.k === 'r') out += `<button class="hd-rw r-${RK(names[m.id]?.[1] ?? 0)}" data-hd-rawi="${m.id}">${esc(t)}</button>`;
      else {
        const q = esc(h.t.slice(m.s, m.rs ?? m.e).trim()).replace(/\{\s*(\d+)\s*\}/g, (_, n) => `<i class="hd-an">${ar(n)}</i>`);
        const ai = m.ai != null && typeof R !== 'undefined' && R?.fromHafs ? R.fromHafs[m.ai] : null;
        const [su, ay] = m.ai != null ? META.hafs[m.ai] : [];
        out += `<span class="hd-q">﴿${q}﴾</span>${su ? `<button class="hd-aya" data-hd-aya="${ai ?? ''}" data-hd-h="${m.ai}">${suraName(su)}: ${ar(ay)}</button>` : ''}`;
      }
      at = m.e;
    }
    return out + esc(h.t.slice(at, b));
  }
  // the hadith's head, green as الأذكار's cards: its book and kitab, its number, its grade
  function headHTML(b, h, kt) {
    const tags = [];
    if (b !== 'abudawud') {
      // the two Sahihs: their hadiths with a chain to the Prophet ﷺ are sahih (not graded again)
      if (h.c && (h.ty == null || h.ty === 0)) tags.push(`<i class="hd-tag">${IC.check}صحيح</i>`);
      if (h.o?.some(o => o[4] && o[0] !== b && o[0] !== 'abudawud')) tags.push(`<i class="hd-tag">متفق عليه</i>`);
    } else for (const [who, g] of h.gr || []) {
      const ok = gradeCls(g) === 'th' || gradeCls(g) === 'sd';
      tags.push(`<i class="hd-tag${ok ? '' : ' hd-tag-w'}">${ok ? IC.check : ''}<small>${who}</small>${g}</i>`);
    }
    if (TYPE[h.ty]) tags.push(`<i class="hd-tag">${TYPE[h.ty]}</i>`);
    return `<div class="hd-hero"><small class="hd-hero-k">${BOOKS[b]}</small>
      <b class="hd-hero-n">${b === 'muslim' && h.a ? 'رقم' : 'الحديث'} ${nums(num(b, h))}</b>
      <span class="hd-hero-s">${kt}</span>
      ${tags.length ? `<span class="hd-tags">${tags.join('')}</span>` : ''}</div>`;
  }
  // the chain, down the page: the author at the top, each narrator with his standing, the Prophet ﷺ at the end
  const RK_WORD = { sh: 'صحابي', th: 'ثقة', sd: 'صدوق', mq: 'مقبول', dh: 'ضعيف', mt: 'متروك', gap: 'انقطاع' };
  function chainHTML(c, names, h) {
    const end = h.ty == null || h.ty === 0 ? '<li class="hd-nb"><b>النبي ﷺ</b></li>' : '';
    return `<ol class="hd-chain">${c.map((id, i) => {
      const [n, k] = names[id] || ['', 0], r = RK(k);
      if (k === 0 && /إرسال|انقطاع/.test(n)) return `<li class="r-gap"><span class="hd-cn">${esc(n)}</span><small>انقطاع</small></li>`;
      return `<li class="r-${r}"><button class="hd-cn" data-hd-rawi="${id}">${esc(n)}</button><small>${i ? RK_WORD[r] : 'المصنِّف'}</small></li>`;
    }).join('')}${end}</ol>`;
  }
  function readerHTML(b, h, names, kt) {
    const [m0, m1] = h.m || [0, h.t.length];
    // the whole text, its chain to tap and its matn marked in it (the source's matn is at times the
    // Prophet's ﷺ words alone, what was around them in the chain's part)
    const full = h.m ? `${marked(h, 0, m0, names)}<b class="hd-mt">${marked(h, m0, m1, names)}</b>${marked(h, m1, h.t.length, names)}`.trim() : '';
    const chains = h.c || [];
    const others = h.o || [];
    return `<article class="hd-read">
      ${headHTML(b, h, kt)}
      <div class="hd-box hd-matn-box"><div class="hd-matn">${marked(h, m0, m1, names)}</div>
        <div class="hd-foot"><span>${cite(b, h)}</span></div>
        ${h.hk ? `<p class="hd-hk"><b>حكم الإسناد</b> ${esc(h.hk)} <small>(موسوعة الحديث)</small></p>` : ''}</div>
      ${full ? `<details class="hd-sec hd-fold"><summary><h3>الحديث بإسناده<small>اضغط على اسم الراوي لترجمته</small></h3></summary><p class="hd-sanad">${full}</p></details>` : ''}
      ${chains.length ? `<section class="hd-sec"><h3>سلسلة الرواة<small>من المصنِّف إلى ${h.ty == null || h.ty === 0 ? 'النبي ﷺ' : 'قائله'}</small></h3>
        ${chainHTML(chains[0], names, h)}
        ${chains.length > 1 ? `<details class="hd-more-c"><summary>${chains.length === 2 ? 'طريق آخر' : `${ar(chains.length - 1)} طرق أخرى`} في هذا الموضع</summary>${chains.slice(1).map(c => chainHTML(c, names, h)).join('')}</details>` : ''}
</section>` : ''}
      ${others.length ? `<section class="hd-sec"><h3>روايات أخرى للحديث<small>${h.on > others.length ? `${ar(h.on)} رواية، أولها:` : 'في الكتب الثلاثة'}</small></h3>
        <div class="group">${others.map(([b2, k2, j2, l, same]) => `<button class="row hd-orow" data-hd-go="${b2}:${k2}:${j2}"><span class="num hd-bn">${SHORT[b2]}${star(l)}</span>
          <span class="main"><span class="t">${BOOKS[b2]}</span><span class="s">${same ? 'عن الصحابي نفسه' : 'عن صحابي آخر أو بلفظ آخر'}</span></span>
          ${same && b2 !== b && b2 !== 'abudawud' && b !== 'abudawud' ? '<span class="tag hd-agree">متفق عليه</span>' : ''}${IC.go}</button>`).join('')}</div></section>` : ''}
    </article>`;
  }

  // ---------------------------------------------------------------- a narrator
  function rawiHTML(r) {
    const R_ = RK(r.k), split = t => (t || '').split(/\s*[،,]\s*/).map(x => x.trim()).filter(Boolean);
    const gen = r.k === 1 ? 'من الصحابة رضي الله عنهم' : TB[r.tb] ? `من ${TB[r.tb]}` : '';
    // 1. the head: his name, his generation, three numbers
    const head = `<div class="hd-hero hd-rhero"><span class="hd-hero-ic">${IC.person}</span>
      <b class="hd-hero-name">${esc(r.s)}</b>${gen ? `<span class="hd-hero-s">${gen}</span>` : ''}
      <div class="hd-stats">
        <div><b>${RK_WORD[R_]}</b><small>${r.k === 1 ? 'عدالته' : 'عند ابن حجر'}</small></div>
        <div><b>${r.d ? `${ar(r.d)}هـ` : '—'}</b><small>وفاته</small></div>
        <div><b>${ar(r.n)}</b><small>${r.n > 2 && r.n <= 10 ? 'أحاديث' : 'حديثًا'} في الكتب الثلاثة</small></div>
      </div></div>`;
    // 2. the verdict on him: Ibn Hajar's words, where it stands of the twelve grades
    const flags = [r.tad && ['موصوف بالتدليس', 'قد يروي عمّن لقيه ما لم يسمعه منه بلفظ محتمل'], r.ikh && ['اختلط أو تغيّر حفظه', 'تُميَّز روايته قبل الاختلاط من روايته بعده']].filter(Boolean);
    const verdict = `<section class="hd-sec"><h3>الحكم عليه</h3><div class="hd-box hd-verdict">
      <p class="hd-v">${esc(r.rk || RK_NAME[R_])}</p>
      <small class="hd-v-src">${r.k === 1 ? 'الصحابة كلهم عدول' : 'خلاصة ابن حجر في «تقريب التهذيب»'}</small>
      ${r.k > 1 ? `<div class="hd-scale" aria-label="مرتبته ${ar(r.k)} من ١٢">${Array.from({ length: 12 }, (_, i) => `<i class="${i + 1 === r.k ? 'on' : i + 1 < r.k ? 'up' : ''}"></i>`).join('')}</div>
        <div class="hd-scale-l"><span>أعلى المراتب</span><b>مرتبته ${ar(r.k)} من ١٢</b><span>أدناها</span></div>` : ''}
      ${flags.map(([t, d]) => `<div class="hd-flag">${IC.warn}<span><b>${t}</b><small>${d}</small></span></div>`).join('')}
    </div></section>`;
    // 3. who he was: the short facts as tiles, the long ones as rows
    const tiles = [
      ['الطبقة', r.tb ? ar(r.tb) : '', r.tb ? TB[r.tb] : ''],
      ['المولد', r.b ? `${ar(r.b)}هـ` : '', ''],
      ['الوفاة', r.d ? `${ar(r.d)}هـ` : '', r.dp ? `بـ${r.dp}` : ''],
      ['العمر', r.age ? `${ar(r.age)} سنة` : '', ''],
    ].filter(x => x[1]);
    const tagsOf = list => `<span class="hd-chips">${list.map(x => `<i>${esc(x)}</i>`).join('')}</span>`;
    const rows = [
      ['الاسم', r.f !== r.s ? `<b>${esc(r.f)}</b>` : ''],
      ['النسبة', split(r.ns).length ? tagsOf(split(r.ns)) : ''],
      ['البلدان', split(r.iq).length ? tagsOf(split(r.iq)) : ''],
      ['العمل', r.pr ? `<b>${esc(r.pr)}</b>` : ''],
    ].filter(x => x[1]);
    const about = tiles.length || rows.length ? `<section class="hd-sec"><h3>التعريف به</h3>
      ${tiles.length ? `<div class="hd-box hd-tiles">${tiles.map(([k, v, s2]) => `<div><small>${k}</small><b>${v}</b>${s2 ? `<span>${esc(s2)}</span>` : ''}</div>`).join('')}</div>` : ''}
      ${rows.length ? `<div class="hd-box hd-rows">${rows.map(([k, v]) => `<div><small>${k}</small>${v}</div>`).join('')}</div>` : ''}
      ${r.stub ? '<p class="hd-note">لم تُذكر له ترجمة في المصدر؛ اسمه من نص الحديث.</p>' : ''}</section>` : '';
    // 4. what the critics said: a row each, cut short until tapped
    const q = r.q || [];
    const critics = q.length ? `<section class="hd-sec"><h3>أقوال العلماء فيه<small>${ar(r.qn || q.length)} ${(r.qn || q.length) <= 10 ? 'أقوال' : 'قولًا'}</small></h3>
      <div class="hd-box hd-qs">${q.map(([who, t], i) => `<button class="hd-qrow"${i >= 5 ? ' hidden' : ''} data-hd-qx><b>${esc(who)}</b><span>${esc(t.replace(/^قال في التقريب\s*/, ''))}</span></button>`).join('')}</div>
      ${q.length > 5 ? `<button class="hd-all" data-hd-aq>عرض ${q.length - 5 === 1 ? 'القول الباقي' : `الأقوال الباقية (${ar(q.length - 5)})`}</button>` : ''}</section>` : '';
    // 5. his teachers and his students in these books: tabs, a row each with how often
    const list = (l, key, on) => {
      const max = Math.max(...(l || []).map(x => x[2]), 1);
      return `<div class="hd-box hd-people"${on ? '' : ' hidden'} data-hd-list-of="${key}">${(l || []).map(([id, name, c, k]) => `<button class="hd-prow" data-hd-rawi="${id}">
        <span class="hd-dot r-${RK(k || 0)}"></span><span class="hd-pn"><b>${esc(name)}</b><small>${RK_WORD[RK(k || 0)]}</small></span>
        <span class="hd-pc"><i style="width:${Math.round(c / max * 100)}%"></i><small>${nTimes(c)}</small></span></button>`).join('')}</div>`;
    };
    const te = r.te?.length, st = r.st?.length;
    const people = te || st ? `<section class="hd-sec"><h3>شيوخه وتلاميذه<small>في أسانيد الكتب الثلاثة</small></h3>
      <div class="hd-seg">${te ? `<button data-hd-tab="te" class="on">شيوخه <small>${ar(r.ten)}</small></button>` : ''}${st ? `<button data-hd-tab="st"${te ? '' : ' class="on"'}>تلاميذه <small>${ar(r.stn)}</small></button>` : ''}</div>
      ${te ? list(r.te, 'te', true) : ''}${st ? list(r.st, 'st', !te) : ''}</section>` : '';
    return `<article class="hd-rawi">${head}${verdict}${about}${critics}${people}</article>`;
  }

  function groupRow(g) {
    if (!g) return '';
    const w = [...g.w].sort((x, y) => ['bukhari', 'muslim', 'abudawud'].indexOf(x[0]) - ['bukhari', 'muslim', 'abudawud'].indexOf(y[0]));
    const [b, k, j] = w[0];
    const where = [...new Map(w.map(x => [x[0], x])).values()].map(x => `${SHORT[x[0]]} ${ar(x[3])}`).join(' · ');
    return `<button class="row hd-hrow" data-hd-go="${b}:${k}:${j}"><span class="main"><span class="s hd-prev">${esc(g.t)}…</span>
      <span class="hd-mini"><i class="hd-chip">${where}</i>${w.length > 1 ? `<i class="hd-chip g-n">${ar(w.length)} روايات</i>` : ''}</span></span></button>`;
  }

  // ---------------------------------------------------------------- saved
  const isSaved = (b, k, j) => store.get('hd.saved', []).some(s => s.b === b && s.k === k && s.j === j);
  async function toggleSave(btn) {
    const { b, k, j } = top(), { h } = await hadith(b, k, j);
    let list = store.get('hd.saved', []);
    const was = list.findIndex(s => s.b === b && s.k === k && s.j === j);
    if (was >= 0) list.splice(was, 1);
    else list.unshift({ b, k, j, l: label(b, h), t: matnOf(h).slice(0, 120), at: Date.now() });
    store.set('hd.saved', list);
    btn.classList.toggle('on', was < 0);
    toast(was < 0 ? 'حُفظ الحديث في «المحفوظة»' : 'أُزيل من المحفوظة');
  }

  async function copy() {
    const { b, k, j } = top(), { h } = await hadith(b, k, j);
    const text = `${matnOf(h)}\n[${cite(b, h)}]`;
    try { await navigator.clipboard.writeText(text); toast('نُسخ الحديث'); } catch { toast('تعذّر النسخ'); }
  }

  // the hadith before or after this one, across its kutub
  async function step(d) {
    const ix = await index(), { b } = top(), B = ix.books.find(x => x.id === b);
    let { k, j } = top();
    j += d;
    if (j < 0) { if (!k) return; k--; j = B.k[k][1] - 1; }
    if (j >= B.k[k][1]) { if (k >= B.k.length - 1) return; k++; j = 0; }
    stack[stack.length - 1] = { v: 'hadith', b, k, j };
    paint(undefined);
    haptic?.(4);
  }

  // ---------------------------------------------------------------- search (hadith-worker.js)
  let worker = null, reqId = 0, askT = 0;
  const results = new Map(), asked = new Map(); // query -> its results, or 'wait'; request id -> query
  function ask(q) {
    if (!worker) {
      worker = new Worker('hadith-worker.js');
      worker.onmessage = ({ data }) => {
        const q = asked.get(data.id);
        asked.delete(data.id);
        if (q == null) return;
        results.set(q, data);
        if ($('#q').value.trim() === q && !$('#sheet').hidden) renderSheet();
      };
    }
    const id = ++reqId;
    results.set(q, 'wait'); asked.set(id, q);
    worker.postMessage({ id, q, v: V });
  }
  const mark = (s, q) => {
    const words = q.replace(/[ً-ٰٟ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').split(/\s+/).filter(w => w.length > 1 && !/\d/.test(w));
    let out = esc(s);
    for (const w of words) out = out.split(esc(w)).join(`<mark>${esc(w)}</mark>`);
    return out;
  };
  // the search's results while the panel is open (renderSheet); asked of the worker the first time
  function searchHTML(raw) {
    const q = raw.trim();
    if (results.size > 30) results.clear();
    const r = results.get(q);
    // (asked once the typing pauses, not at every letter)
    if (!r) { clearTimeout(askT); askT = setTimeout(() => { if ($('#q').value.trim() === q) ask(q); }, 220); return '<div class="tf-wait">جارٍ البحث في الأحاديث…</div>'; }
    if (r === 'wait') return '<div class="tf-wait">جارٍ البحث في الأحاديث…</div>';
    if (r.error) return fail;
    let html = '';
    if (r.rawis?.length) html += `<div class="group-label">الرواة</div><div class="group">${r.rawis.map(([id, n, k, c]) =>
      `<button class="row" data-hd-rawi="${id}"><span class="num hd-dotn"><i class="hd-dot r-${RK(k)}"></i></span><span class="main"><span class="t">${esc(n)}</span><span class="s">في إسناد ${nHadith(c)}</span></span>${IC.go}</button>`).join('')}</div>`;
    if (r.hits.length) html += `<div class="group-label">${r.rawis?.length ? 'الأحاديث' : ''}${r.total > r.hits.length ? ` أول ${ar(r.hits.length)} من ${ar(r.total)} نتيجة` : r.total > 2 ? ` (${ar(r.total)} نتيجة)` : ''}</div><div class="group">${r.hits.map(([b, k, j, ns, s]) =>
      `<button class="row hd-hrow" data-hd-go="${b}:${k}:${j}" data-hd-from-q><span class="num hd-bn">${SHORT[b]}${star(ns[0])}</span>
        <span class="main"><span class="s hd-prev">${r.num ? esc(s.slice(0, 160)) : mark(s, q)}</span></span></button>`).join('')}</div>`;
    return html || '<div class="empty"><b>لا نتائج في الأحاديث</b>جرّب كلمة أخرى، أو اسم راوٍ، أو رقمًا: «البخاري ١».</div>';
  }

  // ---------------------------------------------------------------- taps
  function onClick(e) {
    const t = e.target;
    const go = t.closest('[data-hd-go]');
    if (t.closest('[data-hd-unsave]')) {
      e.stopPropagation();
      const list = store.get('hd.saved', []); list.splice(+t.closest('[data-hd-unsave]').dataset.hdUnsave, 1); store.set('hd.saved', list);
      paint(undefined, $('#sheetBody').scrollTop); return true;
    }
    if (go) {
      const [b, k, j] = go.dataset.hdGo.split(':');
      const q = $('#q').value.trim();
      if (go.hasAttribute('data-hd-from-q') || q) { stack.push({ v: 'search', q }); $('#q').value = ''; $('#q').blur(); mountAgain({ v: 'hadith', b, k: +k, j: +j }); return true; }
      push({ v: 'hadith', b, k: +k, j: +j }); return true;
    }
    const rw = t.closest('[data-hd-rawi]');
    if (rw) {
      const q = $('#q').value.trim();
      if (q) { stack.push({ v: 'search', q }); $('#q').value = ''; $('#q').blur(); mountAgain({ v: 'rawi', id: +rw.dataset.hdRawi }); return true; }
      push({ v: 'rawi', id: +rw.dataset.hdRawi }); return true;
    }
    if (t.closest('[data-hd-back]')) {
      if (stack.length > 1 && stack[stack.length - 2].v === 'search') { stack.pop(); const s = stack.pop(); $('#q').value = s.q; renderSheet(); return true; }
      back(); return true;
    }
    const bk = t.closest('[data-hd-book]'); if (bk) { push({ v: 'book', b: bk.dataset.hdBook }); return true; }
    const kt = t.closest('[data-hd-kitab]'); if (kt) { const [b, k] = kt.dataset.hdKitab.split(':'); push({ v: 'kitab', b, k: +k }); return true; }
    const pg = t.closest('[data-hd-page]'); if (pg) { push({ v: pg.dataset.hdPage }); return true; }
    const tp = t.closest('[data-hd-topic]'); if (tp) { push({ v: 'topics', t: +tp.dataset.hdTopic }); return true; }
    if (t.closest('[data-hd-save]')) { toggleSave(t.closest('[data-hd-save]')); return true; }
    if (t.closest('[data-hd-copy]')) { copy(); return true; }
    const st = t.closest('[data-hd-step]'); if (st) { step(+st.dataset.hdStep); return true; }
    const ay = t.closest('[data-hd-aya]');
    if (ay) {
      // the aya quoted, in the mushaf (the riwaya open: through Hafs's numbering)
      const ai = ay.dataset.hdAya !== '' ? +ay.dataset.hdAya : R.fromHafs[+ay.dataset.hdH];
      dismissSheet(); goTo(R.ayas[ai][2]); setTimeout(() => flashAya(ai), 250);
      return true;
    }
    if (t.closest('[data-hd-aq]')) { root.querySelectorAll('.hd-qrow[hidden]').forEach(x => { x.hidden = false; }); t.closest('[data-hd-aq]').remove(); return true; }
    const qx = t.closest('[data-hd-qx]'); if (qx) { qx.classList.toggle('open'); return true; }
    const tb = t.closest('[data-hd-tab]');
    if (tb) {
      root.querySelectorAll('[data-hd-tab]').forEach(x => x.classList.toggle('on', x === tb));
      root.querySelectorAll('[data-hd-list-of]').forEach(x => { x.hidden = x.dataset.hdListOf !== tb.dataset.hdTab; });
      return true;
    }
    if (t.closest('[data-hd-retry]')) { paint(undefined); return true; }
    if (t.closest('[data-hd-retry-more]')) { paint(undefined, $('#sheetBody').scrollTop); return true; }
    return false;
  }
  // a page opened from the search's results: the panel drawn again (the search's results were in its place)
  function mountAgain(p) { stack.push(p); renderSheet(); }

  // the panel drawn (renderSheet): the page on top
  function mount(el) {
    root = el;
    if (top().v === 'search') stack.pop();
    paint(undefined, top().y || 0);
  }
  // the panel's own back: a page closed, true while there was one
  function goBack() {
    if (stack.length <= 1) return false;
    back(); return true;
  }

  return { mount, onClick, searchHTML, goBack, prefetch: () => index().catch(() => {}) };
})();
