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
    dropCanvas(); sheetOff(); wordOff(); cur = null;
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

  // ---------------------------------------------------------------- a hadith explained, and its words
  // شرح الحديث from موسوعة الأحاديث النبوية (HadeethEnc.com: explanation, word meanings, lessons; built
  // by tools/hadith_sharh.py, a hadith's narrations in the other books sharing it); a word's meaning
  // as the explanation gives it (no guessing from other sources: a wrong meaning is worse than none)
  let cur = null;
  const sharhIx = () => J('sharh/index.json').catch(() => ({}));
  const sharhId = async (b, k, j) => (await sharhIx())[`${b}:${k}:${j}`] || null;
  const sharhOf = async id => (await J(`sharh/${id % 32}.json`))[id];
  const HAR = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
  const bare = t => t.replace(HAR, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
  // مختار الصحاح (data/hadith/dict, tools/hadith_dict.py): the word as it is, then without the letters
  // joined to it (و ف ب ل ك, ال, a pronoun, a plural's ending), with or without ال; failing those, the
  // article of the root its letters come to (only a root the dictionary has), shown as that root
  const dictPart = c => J(`dict/${c.codePointAt(0).toString(16)}.json`).catch(() => ({}));
  function forms(w) {
    const out = [w], add = x => { if (x.length >= 2 && !out.includes(x)) out.push(x); };
    for (const x of [...out]) for (const p of ['و', 'ف']) if (x.startsWith(p) && x.length > 3) add(x.slice(1));
    for (const x of [...out]) for (const p of ['ب', 'ل', 'ك']) if (x.startsWith(p) && x.length > 3) add(x.slice(1));
    for (const x of [...out]) if (x.startsWith('لل') && x.length > 4) add('ال' + x.slice(2));
    for (const x of [...out]) for (const e of ['هما', 'كما', 'هم', 'هن', 'كم', 'كن', 'ها', 'نا', 'ني', 'ه', 'ك', 'ي']) if (x.endsWith(e) && x.length - e.length >= 3) add(x.slice(0, -e.length));
    for (const x of [...out]) for (const e of ['ون', 'ين', 'ات', 'وا', 'ان', 'تم', 'ت', 'و', 'ا']) if (x.endsWith(e) && x.length - e.length >= 3) add(x.slice(0, -e.length));
    for (const x of [...out]) if (x.startsWith('ال') && x.length > 4) add(x.slice(2)); else if (!x.startsWith('ال') && x.length >= 3) add('ال' + x);
    return out;
  }
  async function dictOf(w) {
    const fs = forms(w), res = [];
    for (const f of fs) {
      const d = await dictPart(f[0]);
      for (const [r, x] of d[f] || []) if (!res.some(y => y[0] === r && y[1] === x)) res.push([r, x]);
      if (res.length >= 2) break;
    }
    if (res.length) return res.slice(0, 2);
    // its root: the letters left without a verb's or noun's added ones (ت ي ن ا م before; ا و ي
    // within), three or four of them, one the dictionary has
    const roots = new Set();
    for (const f of fs.filter(x => !x.startsWith('ال'))) {
      const base = [f, f.replace(/^(ت|ي|ن|ا|م|است|مست|ان|افت|ت|م)/, '')];
      for (const b of base) { const core = b.replace(/[اوي](?=.)/g, ''); for (const c of [b, core]) if (c.length === 3 || c.length === 4) roots.add(c); }
    }
    // (an article only when a word it explains is of its root — a few in the digital text carry the next
    // root's words, their own heading lost)
    const ofRoot = (x, r) => (x.match(/\(([^()]+)\)/g) || []).some(h => { const w = bare(h.slice(1, -1)); let i = 0; for (const c of w) if (c === r[i]) i++; return i >= r.length; });
    for (const r of roots) { const d = await dictPart(r[0]); const a = d['√' + r]; if (a && ofRoot(a[1], r)) return [[a[0], a[1]]]; }
    return [];
  }
  const sheetOff = () => document.querySelectorAll('body > .hd-sh, body > .hd-wc, body > .hd-shv').forEach(x => x.remove());
  async function openSharh() {
    if (!cur?.sh) return;
    sheetOff();
    const d = await sharhOf(cur.sh).catch(() => null);
    if (!d) { toast('تعذّر تحميل الشرح'); return; }
    const veil = document.createElement('div'); veil.className = 'hd-shv';
    const el = document.createElement('section'); el.className = 'hd-sh';
    el.innerHTML = `<div class="hd-shg"></div><header><span><small>شرح الحديث</small><b>${esc(d.t || '')}</b></span><button class="hd-shx" aria-label="إغلاق">✕</button></header>
      <div class="hd-shb2">
        <p class="hd-she">${esc(d.e).replace(/\n+/g, '</p><p class="hd-she">')}</p>
        ${d.w?.length ? `<h4>معاني الكلمات</h4><dl class="hd-shw">${d.w.map(([w, m]) => `<div><dt>${esc(w)}</dt><dd>${esc(m)}</dd></div>`).join('')}</dl>` : ''}
        ${d.h?.length ? `<h4>من فوائد الحديث</h4><ul class="hd-shh">${d.h.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <p class="hd-shs">${d.g ? `${esc(d.g)}، ` : ''}${d.a ? `${esc(d.a)}. ` : ''}من موسوعة الأحاديث النبوية (HadeethEnc.com)</p></div>`;
    let gone = false;
    const close = () => { if (gone) return; gone = true; el.style.transform = ''; el.classList.add('out'); veil.classList.add('out'); setTimeout(() => { el.remove(); veil.remove(); }, 220); };
    // (outside it: the veil's own touch, not a click — Safari gives none to a bare div)
    veil.addEventListener('pointerup', e => { e.preventDefault(); close(); });
    el.querySelector('.hd-shx').onclick = close;
    // pulled down by its grip or its head: it follows the finger, and goes past a third of the way
    let y0 = null;
    const grab = el.querySelector('.hd-shg'), head = el.querySelector('header');
    for (const g of [grab, head]) g.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; y0 = e.clientY; el.classList.add('drag'); g.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', e => { if (y0 == null) return; el.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
    const drop = e => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; el.classList.remove('drag'); if (dy > Math.min(140, el.offsetHeight / 3)) close(); else el.style.transform = ''; };
    el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
    document.body.append(veil, el);
    haptic(6);
  }
  // a word held: its meaning, in a small card at the foot; a tap anywhere else lets it go
  let wcMark = null;
  function wordOff() { document.querySelectorAll('body > .hd-wc').forEach(x => x.remove()); if (wcMark) { const t = document.createTextNode(wcMark.textContent); wcMark.replaceWith(t); t.parentNode?.normalize(); wcMark = null; } }
  async function openWord(x, y) {
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : (p => { if (!p) return null; const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r; })(document.caretPositionFromPoint?.(x, y));
    const node = r?.startContainer;
    if (!node || node.nodeType !== 3 || !node.parentElement.closest('[data-hd-matn]') || node.parentElement.closest('button')) return false;
    const t = node.textContent, stop = /[\s،؛:.؟!,«»()\[\]{}"]/;
    let a = r.startOffset, z = r.startOffset;
    while (a > 0 && !stop.test(t[a - 1])) a--;
    while (z < t.length && !stop.test(t[z])) z++;
    const word = t.slice(a, z).trim();
    if (!word || bare(word).length < 2) return false;
    wordOff();
    const rg = document.createRange(); rg.setStart(node, a); rg.setEnd(node, z);
    wcMark = document.createElement('mark'); wcMark.className = 'hd-wm'; rg.surroundContents(wcMark);
    haptic(12);
    const bw = bare(word);
    const found = []; // [source, meaning, root]
    if (cur?.sh) {
      const d = await sharhOf(cur.sh).catch(() => null);
      const hit = d?.w?.find(([w]) => { const b2 = bare(w); return b2 === bw || b2.split(/\s+/).includes(bw) || (bw.length > 3 && b2.includes(bw)); });
      if (hit) found.push(['من شرح الحديث · موسوعة الأحاديث النبوية', hit[1], '']);
    }
    for (const [r, x] of await dictOf(bw)) found.push(['مختار الصحاح للرازي', x, r]);
    const el = document.createElement('div'); el.className = 'hd-wc';
    el.innerHTML = `<div class="hd-wch"><b>${esc(word)}</b></div>
      ${found.length ? found.map(([src, m, r]) => `<div class="hd-wm2"><p>${esc(m)}</p><small>${src}${r ? ` · مادة (${esc(r)})` : ''}</small></div>`).join('')
        : '<p class="none">لم نجد هذه الكلمة في شرح الحديث ولا في مختار الصحاح: معناها ظاهر غالبًا.</p>'}
      ${cur?.sh ? '<div class="hd-wcf"><button data-hd-wsharh>شرح الحديث</button></div>' : ''}`;
    el.querySelector('[data-hd-wsharh]')?.addEventListener('click', () => { wordOff(); openSharh(); });
    document.body.append(el);
    return true;
  }
  // on the hadith's text: a tap explains the hadith, a press held explains the word under it
  let holdT = 0, held = false, hx = 0, hy = 0;
  addEventListener('pointerdown', e => {
    if (!e.target.closest?.('body > .hd-wc')) { if (document.querySelector('body > .hd-wc')) { wordOff(); held = 'off'; } }
    const m = e.target.closest?.('[data-hd-matn]');
    if (!m || e.target.closest('button')) return;
    held = held === 'off' ? 'off' : false; hx = e.clientX; hy = e.clientY;
    clearTimeout(holdT);
    holdT = setTimeout(async () => { if (await openWord(hx, hy)) held = true; }, 430);
  }, true);
  addEventListener('pointermove', e => { if (holdT && Math.hypot(e.clientX - hx, e.clientY - hy) > 10) { clearTimeout(holdT); holdT = 0; } }, true);
  addEventListener('pointerup', () => { clearTimeout(holdT); holdT = 0; }, true);
  addEventListener('contextmenu', e => { if (e.target.closest?.('[data-hd-matn]')) e.preventDefault(); }, true);

  // ---------------------------------------------------------------- what has been read, a book at a time
  // hd.read.<book>: { kitab: [hadith indexes read] } (synced with the rest); hd.at.<book>: where in it
  const readOf = b => store.get(`hd.read.${b}`, {});
  const isRead = (b, k, j) => (readOf(b)[k] || []).includes(j);
  function setRead(b, k, j, on) {
    const r = readOf(b), l = new Set(r[k] || []);
    on ? l.add(j) : l.delete(j);
    if (l.size) r[k] = [...l].sort((x, y) => x - y); else delete r[k];
    store.set(`hd.read.${b}`, r);
  }
  const readIn = (b, k) => (readOf(b)[k] || []).length;
  const readAll = b => Object.values(readOf(b)).reduce((a, l) => a + l.length, 0);
  const total = B => B.k.reduce((a, x) => a + x[1], 0);
  // the next to read in a book: after the last one opened in it, else the first not read
  function nextIn(B) {
    const r = readOf(B.id), at = store.get(`hd.at.${B.id}`, null);
    if (at && !(r[at.k] || []).includes(at.j)) return [at.k, at.j];
    for (let k = at ? at.k : 0; k < B.k.length; k++) {
      const done = new Set(r[k] || []);
      for (let j = k === at?.k ? at.j : 0; j < B.k[k][1]; j++) if (!done.has(j)) return [k, j];
    }
    for (let k = 0; k < B.k.length; k++) { const done = new Set(r[k] || []); for (let j = 0; j < B.k[k][1]; j++) if (!done.has(j)) return [k, j]; }
    return null;
  }
  const k0 = (B, k) => `${k || B.id !== 'muslim' ? 'كتاب ' : ''}${B.k[k][0]}`;
  const bar_ = (n, t) => `<span class="hd-pg"><i style="width:${t ? Math.max(n ? 2 : 0, n / t * 100) : 0}%"></i></span>`;

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
        <div class="hd-books">${ix.books.map(b => { const n = readAll(b.id), t = total(b), nx = n ? nextIn(b) : null;
          return `<div class="hd-bookw"><button class="hd-book hd-${b.id}" data-hd-book="${b.id}">
          <b>${b.t}</b><small>${b.au} · ت ${ar(b.d)}هـ</small>
          <span>${nHadith(b.nn)} · ${nKitab(b.k.length)}</span></button>
          ${n ? `<div class="hd-bfoot"><span class="hd-bp"><em>قرأت ${ar(n)}، ${ar(Math.floor(n / t * 1000) / 10)}٪</em>${bar_(n, t)}</span>
            ${nx ? `<button class="hd-cont" data-hd-go="${b.id}:${nx[0]}:${nx[1]}">تابع ${IC.go}</button>` : ''}</div>` : ''}</div>`; }).join('')}</div>
        <div class="group">
          <button class="row" data-hd-page="topics"><span class="num hd-ic">${IC.tree}</span><span class="main"><span class="t">المواضيع</span><span class="s">أحاديث الكتب الثلاثة مرتبة بموضوعاتها: العبادات، المعاملات، الأخلاق…</span></span>${IC.go}</button>
          ${saved.length ? `<button class="row" data-hd-page="saved"><span class="num hd-ic">${IC.saved}</span><span class="main"><span class="t">المحفوظة</span><span class="s">${nHadith(saved.length)}</span></span>${IC.go}</button>` : ''}
          ${at ? `<button class="row" data-hd-go="${at.b}:${at.k}:${at.j}"><span class="num hd-ic">${IC.clock}</span><span class="main"><span class="t">تابع من حيث وقفت</span><span class="s">${BOOKS[at.b]} · ${ar(at.l)}</span></span>${IC.go}</button>` : ''}
        </div>
        <p class="hd-tip">ابحث في الأعلى بكلمة من الحديث، أو باسم راوٍ، أو برقم الحديث: «مسلم ٢٥٦٤»، «البخاري ١».</p>
        <p class="note hd-cite">${ix.source}</p></div>`;
    },

    async book({ b }) {
      const ix = await index(), B = ix.books.find(x => x.id === b), n = readAll(b), t = total(B), nx = nextIn(B);
      const head = `<div class="hd-bprog"><div><b>${n ? `قرأت ${ar(n)}` : 'لم تبدأ هذا الكتاب بعد'}</b><small>${ar(Math.floor(n / t * 1000) / 10)}٪</small></div>${bar_(n, t)}
        ${nx ? `<button class="hd-cont big" data-hd-go="${b}:${nx[0]}:${nx[1]}"><span>${n ? 'تابع القراءة' : 'ابدأ من أوله'}<small>${k0(B, nx[0])}، الحديث ${ar(nx[1] + 1)} فيه</small></span>${IC.go}</button>` : '<p class="hd-alld">أتممت الكتاب، ما شاء الله</p>'}</div>`;
      return bar(B.t, `${B.au} · ${nHadith(B.nn)}`) + head + `<div class="group hd-kutub">${B.k.map(([tt, nn, first], k) => { const r = readIn(b, k);
        return `<button class="row${r >= nn ? ' hd-kdone' : ''}" data-hd-kitab="${b}:${k}"><span class="num">${r >= nn ? '✓' : ar(k + (b === 'muslim' ? 0 : 1))}</span>
          <span class="main"><span class="t">${k || b !== 'muslim' ? 'كتاب ' : ''}${tt}</span><span class="s">${r ? `${ar(r)} من ${ar(nn)}` : `${nHadith(nn)} · من ${ar(first)}`}</span>${r && r < nn ? bar_(r, nn) : ''}</span>${IC.go}</button>`; }).join('')}</div>`;
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
      store.set(`hd.at.${b}`, { k, j });
      const saved = isSaved(b, k, j);
      const last = j >= B.k[k][1] - 1 && k >= B.k.length - 1;
      const tools = `<button class="hd-tb${saved ? ' on' : ''}" data-hd-save aria-label="حفظ">${IC.star}</button>
        <button class="hd-tb" data-hd-copy aria-label="نسخ">${IC.copy}</button>
        <button class="hd-tb" data-hd-step="-1" aria-label="السابق"${!j && !k ? ' disabled' : ''}>${IC.back}</button>
        <button class="hd-tb" data-hd-step="1" aria-label="التالي"${last ? ' disabled' : ''}>${IC.next}</button>`;
      const kt = `${k || b !== 'muslim' ? 'كتاب ' : ''}${B.k[k][0]}`;
      const rd = isRead(b, k, j), done = readAll(b), tt = total(B);
      const foot = `<div class="hd-rdone"><button class="hd-mark${rd ? ' on' : ''}" data-hd-mark>${rd ? '✓ قرأته' : 'علّمه مقروءًا'}</button>
        ${last ? '' : `<button class="hd-next" data-hd-readnext><span>${rd ? 'التالي' : 'قرأته، التالي'}<small>قرأت ${ar(done)} في ${BOOKS[b]}، ${ar(Math.floor(done / tt * 1000) / 10)}٪</small></span>${IC.next}</button>`}</div>`;
      const sh = await sharhId(b, k, j);
      cur = { b, k, j, sh, g: h.g };
      return bar(kt, BOOKS[b], tools) + readerHTML(b, h, names, kt, sh) + foot;
    },

    // every way this hadith came, in the three books, as one tree: the Prophet ﷺ at the top, the
    // companions under him, each narrator once on each path down to the books' authors, where the
    // paths meet drawn as one; the way of the hadith opened from in green
    async tree({ b, k, j }) {
      const { h } = await hadith(b, k, j);
      let refs = [[b, k, j]];
      if (h.g) {
        const w = (await J('groups.json'))[h.g]?.w || [];
        refs = refs.concat(w.map(([b2, k2, j2]) => [b2, k2, j2]).filter(([b2, k2, j2]) => !(b2 === b && k2 === k && j2 === j)));
      }
      const all = refs.length;
      refs = refs.slice(0, 30);
      const got = (await Promise.all(refs.map(r => hadith(...r).then(x => ({ r, ...x })).catch(() => null)))).filter(Boolean);
      const names = {}, ways = got.map(g => { Object.assign(names, g.R); return { c: g.h.c || [], ref: { b: g.r[0], k: g.r[1], j: g.r[2], l: label(g.r[0], g.h) }, own: g.r === refs[0] }; });
      // (back from a narrator's page: the tree as it was left, its branches open and its choice)
      const key = `${b}:${k}:${j}`;
      if (T?.key !== key) { T = buildTree(ways, names, h.ty == null || h.ty === 0); if (T) T.key = key; }
      if (!T) return bar('شجرة الإسناد') + '<div class="empty"><b>لا إسناد لهذا الحديث هنا</b></div>';
      const t = T, n = got.length;
      after = initCanvas;
      const sub = `${n === 1 ? 'رواية واحدة' : n === 2 ? 'روايتان' : `${ar(n)} ${n <= 10 ? 'روايات' : 'رواية'}`}، ${ar(t.people)} ${t.people <= 10 ? 'رواة' : 'راويًا'}${all > refs.length ? ` (أول ${ar(refs.length)} من ${ar(all)})` : ''}`;
      return bar('شجرة الإسناد', sub) + `<div class="hd-cv">
        <div class="hd-cvbar"><button class="hd-cvx" data-hd-back aria-label="رجوع">${IC.back}</button>
          <span class="hd-cvt"><b>شجرة الإسناد</b><small>${sub}</small></span>
          <span class="hd-cvz"><button data-cvz="-" aria-label="تصغير">−</button><button data-cvz="fit" aria-label="الشجرة كلها"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button><button data-cvz="+" aria-label="تكبير">+</button></span></div>
        <div class="hd-cvv">${treeLayout()}</div>
        <div class="hd-cvlg">${['sh', 'th', 'sd', 'mq', 'dh', 'mt'].map(r => `<span class="r-${r}"><i></i>${RK_WORD[r]}</span>`).join('')}<span class="own"><i></i>طريق هذا الحديث</span></div>
        <div class="hd-cvhint">اسحب في أي اتجاه، وقرّب أو بعّد بإصبعين · اضغط على راوٍ لترجمته</div></div>`;
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
      const j = p0 * PART + i, g = b === 'abudawud' && h.gr?.[0], rd = isRead(b, k, j);
      return `<button class="row hd-hrow${rd ? ' hd-read' : ''}" data-hd-go="${b}:${k}:${j}"><span class="num hd-n">${star(label(b, h))}</span>
        <span class="main"><span class="s hd-prev">${esc(matnOf(h).slice(0, 180))}</span>
        ${rd ? '<span class="hd-rtick" aria-label="مقروء">✓</span>' : ''}${g || TYPE[h.ty] ? `<span class="hd-mini">${TYPE[h.ty] ? `<i class="hd-chip">${TYPE[h.ty]}</i>` : ''}${g ? `<i class="hd-chip g-${gradeCls(g[1])}">${g[1]}</i>` : ''}</span>` : ''}</span></button>`;
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
  // the source's spacing tidied: no space before «، ؛ : . ؟ !», one after; no doubled spaces
  const tidy = t => t.replace(/\s+([،؛:.؟!,])/g, '$1').replace(/([،؛:؟!])(?=[^\s»)\]])/g, '$1 ').replace(/\s{2,}/g, ' ');
  function marked(h, a, b, names) {
    const marks = [];
    for (const [s, e, id] of h.r || []) if (s >= a && e <= b) marks.push({ s, e, k: 'r', id });
    for (const [s, e, ai, rs] of h.q || []) if (s >= a && e <= b) marks.push({ s, e, k: 'q', ai, rs });
    marks.sort((x, y) => x.s - y.s);
    let out = '', at = a;
    for (const m of marks) {
      if (m.s < at) continue;
      out += tidy(esc(h.t.slice(at, m.s)));
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
    return out + tidy(esc(h.t.slice(at, b)));
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
  // ---------------------------------------------------------------- the chain as a tree
  // ways = [{ c: [chains, each author … companion], ref: {b, k, j, l}, own }], merged from the Prophet ﷺ
  // down: a narrator once on each path, the tree branching where paths part. Its own page (the
  // tree icon by a hadith's chain): the way of the hadith opened from open and green, the other
  // branches closed (+N, a tap opens them); a narrator tapped: his way up and his students lit, the
  // rest faded, and a card under the tree (his page, his students shown or hidden)
  const initial = n => (n.replace(/^(أبو|أبي|أم|ابن|بن|عبد)\s+/, '').trim()[0] || '·');
  let T = null;
  function buildTree(ways, names, marfu) {
    const root = { id: 0, key: 'r', kids: new Map(), refs: [], own: true, up: null };
    for (const w of ways) for (const c of w.c) {
      let n = root;
      for (const id of [...c].reverse()) {
        if (!n.kids.has(id)) n.kids.set(id, { id, key: `${n.key}.${id}`, kids: new Map(), refs: [], own: false, up: n });
        n = n.kids.get(id);
        if (w.own) n.own = true;
      }
      if (w.ref && !n.refs.some(x => x.b === w.ref.b && x.k === w.ref.k && x.j === w.ref.j)) n.refs.push({ ...w.ref, own: w.own });
    }
    if (!root.kids.size) return null;
    const byKey = new Map(), open = new Set(['r']);
    let people = 0;
    const index = n => { byKey.set(n.key, n); if (n !== root) people++; if (n.own) open.add(n.key); n.kids.forEach(index); };
    index(root);
    const leaves = n => n.kids.size ? [...n.kids.values()].reduce((a, x) => a + leaves(x), 0) : 1;
    byKey.forEach(n => { n.routes = leaves(n); });
    return { root, byKey, open, sel: null, names, marfu, people };
  }
  // drawn on a canvas of its own, over the whole screen: a circle per narrator (his standing's colour,
  // the first letter of his name), his name and standing under it, curved lines down to his students,
  // each parent over the middle of his branches; dragged any way with a finger (or the mouse),
  // pinched (or ctrl+wheel, a trackpad's pinch) to make it smaller or larger; − ⤢ + for the same
  function treeLayout() {
    const { root, names, marfu } = T;
    const CW = 100, RH = 132, NW = 96, LB = 86;
    const kidsOf = n => [...n.kids.values()].sort((a, b) => (b.own - a.own) || (b.routes - a.routes));
    let col = 0, depth = 0, maxRefs = 0;
    const place = (n, d) => {
      depth = Math.max(depth, d);
      const ks = kidsOf(n);
      if (!ks.length) { maxRefs = Math.max(maxRefs, n.refs.length); n.x = col++ * CW + CW / 2; n.d = d; return; }
      ks.forEach(x => place(x, d + 1));
      n.x = (ks[0].x + ks[ks.length - 1].x) / 2; n.d = d;
    };
    place(root, 0);
    // (the first branch, the way opened from, on the right: x counted from the right)
    const W = Math.max(col * CW, CW) + 40, L = xr => W - 20 - xr, y0 = marfu ? 0 : -RH, yOf = d => d * RH + y0 + 20;
    const H = yOf(depth) + LB + 26 * maxRefs + 40;
    const nodes = [], lines = [];
    const walk = (n, parent) => {
      if (n !== root) {
        const [nm, rk] = names[n.id] || ['', 0], r = RK(rk), leaf = !n.kids.size;
        nodes.push(`<div class="hd-tn r-${r}${n.own ? ' own' : ''}" style="left:${L(n.x) - NW / 2}px;top:${yOf(n.d)}px">
          <button class="hd-tnb" data-hd-rawi="${n.id}" aria-label="${esc(nm)}"><i class="hd-tc">${esc(initial(nm))}</i><span class="hd-tname">${esc(nm || '—')}</span><small>${leaf ? 'المصنِّف' : RK_WORD[r]}</small></button>
          ${leaf && n.refs.length ? `<span class="hd-trefs">${n.refs.map(x => `<button class="hd-tref${x.own ? ' own' : ''}" data-hd-go="${x.b}:${x.k}:${x.j}">${SHORT[x.b]} ${ar(x.l)}</button>`).join('')}</span>` : ''}</div>`);
        if (parent !== root || marfu) {
          const x1 = L(parent.x), y1 = yOf(parent.d) + (parent === root ? 62 : LB), x2 = L(n.x), y2 = yOf(n.d) + 1, my = (y1 + y2) / 2;
          lines.push(`<path class="${n.own ? 'own' : ''}" d="M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}"/>`);
        }
      }
      kidsOf(n).forEach(x => walk(x, n));
    };
    walk(root, null);
    const top = marfu ? `<div class="hd-tn hd-troot" style="left:${L(root.x) - NW / 2}px;top:${yOf(0)}px"><i class="hd-tc">ﷺ</i><span class="hd-tname">النبي ﷺ</span></div>` : '';
    return `<div class="hd-cvi hd-tree" data-w="${W}" data-h="${H}" data-rx="${L(root.x)}" style="width:${W}px;height:${H}px">
      <svg class="hd-tlines" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${lines.join('')}</svg>${top}${nodes.join('')}</div>`;
  }
  // the canvas: lifted out of the panel over everything (the panel's own motion would carry it),
  // gone again with the next page
  const dropCanvas = () => document.querySelectorAll('body > .hd-cv').forEach(x => x.remove());
  function initCanvas() {
    const cv = root?.querySelector('.hd-cv');
    if (!cv) return;
    document.body.append(cv);
    new MutationObserver((_, mo) => { if ($('#sheet').hidden || !cv.isConnected) { cv.remove(); mo.disconnect(); } }).observe($('#sheet'), { attributes: true, attributeFilter: ['hidden'] });
    const vp = cv.querySelector('.hd-cvv'), inn = cv.querySelector('.hd-cvi');
    const W = +inn.dataset.w, H = +inn.dataset.h, rx = +inn.dataset.rx;
    const fitS = () => Math.min(1, (vp.clientWidth - 16) / W, (vp.clientHeight - 16) / H);
    const minS = () => Math.min(.5, fitS() * .8), maxS = 2.6;
    let s, x, y;
    const apply = () => { inn.style.transform = `translate3d(${x}px,${y}px,0) scale(${s})`; T.view = { s, x, y }; };
    const zoomAt = (k, px, py) => { const s2 = Math.min(maxS, Math.max(minS(), s * k)); k = s2 / s; x = px - (px - x) * k; y = py - (py - y) * k; s = s2; };
    const fit = () => { s = fitS(); x = (vp.clientWidth - W * s) / 2; y = Math.max(8, (vp.clientHeight - H * s) / 2); };
    if (T.view) ({ s, x, y } = T.view);
    else { s = Math.max(.75, Math.min(1, vp.clientWidth / 420)); x = vp.clientWidth / 2 - rx * s; y = 10; }
    apply();
    // fingers (or the mouse): one drags, two pinch about their middle; a tap stays a tap
    const pts = new Map();
    let moved = 0;
    const local = e => { const r = vp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    vp.addEventListener('pointerdown', e => { if (e.button > 0) return; pts.set(e.pointerId, local(e)); if (pts.size === 1) moved = 0; cv.classList.add('grab'); });
    const move = e => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e), before = [...pts.values()];
      if (pts.size === 1) { const o = pts.get(e.pointerId); x += p.x - o.x; y += p.y - o.y; moved += Math.abs(p.x - o.x) + Math.abs(p.y - o.y); }
      pts.set(e.pointerId, p);
      if (pts.size === 2) {
        const [a0, b0] = before, [a1, b1] = [...pts.values()];
        const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1, d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y) || 1;
        const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
        x += m1.x - m0.x; y += m1.y - m0.y; zoomAt(d1 / d0, m1.x, m1.y); moved += 99;
      }
      apply();
    };
    const up = e => { pts.delete(e.pointerId); if (!pts.size) cv.classList.remove('grab'); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    const off = new MutationObserver(() => { if (!cv.isConnected) { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); off.disconnect(); } });
    off.observe(document.body, { childList: true });
    vp.addEventListener('wheel', e => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey) zoomAt(Math.exp(-e.deltaY * .01), p.x, p.y); else { x -= e.deltaX; y -= e.deltaY; }
      apply();
    }, { passive: false });
    for (const ev of ['gesturestart', 'gesturechange']) cv.addEventListener(ev, e => e.preventDefault()); // (Safari's own pinch)
    cv.addEventListener('click', e => {
      if (moved > 8 && e.target.closest('.hd-cvv')) { e.preventDefault(); e.stopPropagation(); moved = 0; return; }
      const z = e.target.closest('[data-cvz]');
      if (z) { const k = z.dataset.cvz; if (k === 'fit') fit(); else zoomAt(k === '+' ? 1.3 : 1 / 1.3, vp.clientWidth / 2, vp.clientHeight / 2); inn.classList.add('ease'); apply(); setTimeout(() => inn.classList.remove('ease'), 260); return; }
      if (e.target.closest('[data-hd-back]')) { back(); return; }
      const rw = e.target.closest('[data-hd-rawi]'); if (rw) { push({ v: 'rawi', id: +rw.dataset.hdRawi }); return; }
      const go = e.target.closest('[data-hd-go]'); if (go) { const [b, k, j] = go.dataset.hdGo.split(':'); push({ v: 'hadith', b, k: +k, j: +j }); }
    }, true);
    addEventListener('keydown', function esc(e) { if (!cv.isConnected) return removeEventListener('keydown', esc); if (e.key === 'Escape') { e.stopPropagation(); back(); } }, true);
  }

  function readerHTML(b, h, names, kt, sh = null) {
    const [m0, m1] = h.m || [0, h.t.length];
    // the whole text, its chain to tap and its matn marked in it (the source's matn is at times the
    // Prophet's ﷺ words alone, what was around them in the chain's part)
    const full = h.m ? `${marked(h, 0, m0, names)}<b class="hd-mt">${marked(h, m0, m1, names)}</b>${marked(h, m1, h.t.length, names)}`.trim() : '';
    const chains = h.c || [];
    const others = h.o || [];
    return `<article class="hd-read">
      ${headHTML(b, h, kt)}
      <div class="hd-box hd-matn-box"><div class="hd-matn" data-hd-matn>${marked(h, m0, m1, names)}</div>
        <p class="hd-mhint">${sh ? '<button class="hd-shb" data-hd-sharh>شرح الحديث</button>' : ''}<small>${sh ? 'اضغط على الحديث لشرحه، ومطوّلًا على كلمة لمعناها' : 'اضغط مطوّلًا على كلمة لمعناها'}</small></p>
        <div class="hd-foot"><span>${cite(b, h)}</span></div>
        ${h.hk ? `<p class="hd-hk"><b>حكم الإسناد</b> ${esc(h.hk)} <small>(موسوعة الحديث)</small></p>` : ''}</div>
      ${full ? `<details class="hd-sec hd-fold"><summary><h3>الحديث بإسناده<small>اضغط على اسم الراوي لترجمته</small></h3></summary><p class="hd-sanad">${full}</p></details>` : ''}
      ${chains.length ? `<section class="hd-sec"><h3 class="hd-chh">سلسلة الرواة<small>من المصنِّف إلى ${h.ty == null || h.ty === 0 ? 'النبي ﷺ' : 'قائله'}</small><button class="hd-treeic" data-hd-tree aria-label="شجرة الإسناد">${IC.tree}<span>الشجرة</span></button></h3>
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
    if (t.closest('[data-hd-sharh]')) { openSharh(); return true; }
    if (t.closest('[data-hd-matn]') && !t.closest('button')) {
      if (held) { held = false; return true; }
      if (cur?.sh) openSharh(); return true;
    }
    if (t.closest('[data-hd-mark]')) { const p = top(); setRead(p.b, p.k, p.j, !isRead(p.b, p.k, p.j)); haptic(6); paint(undefined, $('#sheetBody').scrollTop); return true; }
    if (t.closest('[data-hd-readnext]')) { const p = top(); setRead(p.b, p.k, p.j, true); haptic(8); step(1); return true; }
    if (t.closest('[data-hd-tree]')) { const p = top(); push({ v: 'tree', b: p.b, k: p.k, j: p.j }); return true; }
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
