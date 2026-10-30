'use strict';

// bump when data/ or fonts/ change so phones fetch the new files
const DATA_VERSION = 6;
const AUDIO_BASE = 'https://everyayah.com/data/Yasser_Ad-Dussary_128kbps/';
const RUB_LABEL = ['الحزب', 'ربع الحزب', 'نصف الحزب', 'ثلاثة أرباع الحزب'];
const $ = (s, el = document) => el.querySelector(s);

const store = {
  get(k, d) { try { const v = localStorage.getItem('q.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('q.' + k, JSON.stringify(v)); } catch {} },
};

const ar = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const isEnd = t => /^[٠-٩]+$/.test(t) || t.endsWith('*');
// KFGQPC QCF V2 per-page fonts (1441 Madani print): every word is a glyph
const QCF_BASE = 'https://verses.quran.foundation/fonts/quran/hafs/v2/woff2/';
const LINE_RATIO = 1.8;
// thin rules fading out to either side of a small rub' el-hizb star
const ORNAMENT = (() => {
  let star = '';
  for (let i = 0; i < 16; i++) {
    const a = Math.PI / 8 * i - Math.PI / 2, r = i % 2 ? 3.3 : 5.6;
    star += (i ? 'L' : 'M') + (140 + r * Math.cos(a)).toFixed(2) + ' ' + (7 + r * Math.sin(a)).toFixed(2);
  }
  return `<div class="page-orn" aria-hidden="true"><svg viewBox="0 0 280 14" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="ornL" x1="0" x2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor"/></linearGradient>
    <linearGradient id="ornR" x1="1" x2="0"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor"/></linearGradient></defs>
    <rect x="20" y="6.6" width="104" height=".8" fill="url(#ornL)"/><rect x="156" y="6.6" width="104" height=".8" fill="url(#ornR)"/>
    <path d="M114 7l3-2.2 3 2.2-3 2.2zM160 7l3-2.2 3 2.2-3 2.2z" fill="currentColor" opacity=".7"/>
    <path d="${star}Z" fill="none" stroke="currentColor" stroke-width=".9"/>
    <circle cx="140" cy="7" r="1.4" fill="currentColor"/>
  </svg></div>`;
})(); // line pitch / font size on regular pages
// QCF4 QBSML: printed-mushaf surah titles (U+F100 + surah - 1) and basmala
const SURA_GLYPH = s => String.fromCharCode(0xF100 + s - 1);
const BASMALA_GLYPHS = '\uFAD0\uFAD1\uFAD2\uFAD3';

let META;            // suras, hafs aya keys, emlaey text
let R;               // current riwaya data
const cache = {};    // riwaya id -> data
const S = {          // ui state
  page: 1,
  sel: null,         // selected riwaya aya index
  play: null,        // playing riwaya aya index
  landscape: false,
  availW: 300,
  fs: 24,
  lh: 48,
};

// ---------------------------------------------------------------- motion
// Panels ease in via CSS when unhidden; hide() lets them ease out first.

function show(el) {
  el.classList.remove('leaving');
  el.hidden = false;
}
function hide(el) {
  if (el.hidden || el.classList.contains('leaving')) return;
  el.classList.add('leaving');
  const done = e => {
    if (e && e.target !== el) return;
    el.removeEventListener('animationend', done);
    clearTimeout(t);
    if (el.classList.contains('leaving')) { el.hidden = true; el.classList.remove('leaving'); }
  };
  el.addEventListener('animationend', done);
  const t = setTimeout(done, 400); // in case animations are off
}

// ---------------------------------------------------------------- khatmas
// Each khatma is its own mushaf: riwaya, reading position, marked aya and
// bookmarks, saved separately so the Quran can be finished many times.

const COVERS = [
  { bg: ['#1f5040', '#11301f'], gold: '#d9b86c', name: 'زمردي' },
  { bg: ['#1e3160', '#101b38'], gold: '#d9b86c', name: 'كحلي' },
  { bg: ['#6e1f30', '#43101b'], gold: '#e0c07a', name: 'عنابي' },
  { bg: ['#262422', '#0c0b0a'], gold: '#cfae62', name: 'أسود' },
  { bg: ['#0f5559', '#073236'], gold: '#dcbf7c', name: 'فيروزي' },
  { bg: ['#5e3e24', '#3a2513'], gold: '#e2c27e', name: 'بني' },
  { bg: ['#f3ead7', '#dccfb2'], gold: '#9a7533', name: 'عاجي' },
];

let KH = [];   // all khatmas
let K;         // the open one

function saveKh() {
  store.set('khatmas', KH);
  store.set('kh.current', K?.id);
}

function newKhatma(name, riwaya = 'hafs', cover = 0) {
  return { id: Date.now().toString(36), name, riwaya, cover, page: 1, mark: null, bookmarks: [], done: 0, created: Date.now(), read: Date.now() };
}

function loadKhatmas() {
  KH = store.get('khatmas', []);
  if (!KH.length) {
    // first run (or an older version): carry over the saved place and bookmarks
    const r = store.get('riwaya', 'hafs');
    const k = newKhatma('ختمتي', r, 0);
    k.page = store.get('page.' + r, 1);
    k.bookmarks = store.get('bm', []);
    KH = [k];
  }
  K = KH.find(k => k.id === store.get('kh.current')) || KH[0];
  saveKh();
}

// ---------------------------------------------------------------- data

async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

async function loadRiwaya(id) {
  if (!cache[id]) {
    const d = await loadJSON(`data/${id}.json?v=${DATA_VERSION}`);
    d.id = id;
    d.font = 'rw-' + id;
    // per-aya text and the hafs -> riwaya index used by search and audio
    d.text = d.utext || new Array(d.ayas.length).fill('');
    if (!d.utext) for (const pg of d.pages) for (const ln of pg) {
      if (!Array.isArray(ln) || typeof ln[0] === 'string') continue;
      for (const [ai, t] of ln) d.text[ai] = d.text[ai] ? d.text[ai] + ' ' + t : t;
    }
    d.fromHafs = new Int32Array(META.hafs.length).fill(-1);
    d.ayas.forEach((a, i) => {
      for (let h = a[5]; h <= a[6]; h++) if (d.fromHafs[h] < 0) d.fromHafs[h] = i;
    });
    for (let h = 1; h < d.fromHafs.length; h++) if (d.fromHafs[h] < 0) d.fromHafs[h] = d.fromHafs[h - 1];
    d.suraStart = {};
    d.ayas.forEach((a, i) => { if (!(a[0] in d.suraStart)) d.suraStart[a[0]] = i; });
    d.juzStart = {};
    d.ayas.forEach((a, i) => { if (!(a[3] in d.juzStart)) d.juzStart[a[3]] = i; });
    await document.fonts.load(`20px ${d.font}`, 'بسم');
    cache[id] = d;
  }
  return cache[id];
}

const suraName = s => META.suras[s - 1][0];

// per-page glyph fonts, loaded on demand and measured once
const pageFonts = {}; // page -> { ready, promise, widths: [line natural width at 100px] }
const measureCtx = document.createElement('canvas').getContext('2d');

function ensurePageFont(p) {
  if (!R.glyph || p < 1 || p > R.pages.length) return Promise.resolve();
  if (pageFonts[p]) return pageFonts[p].promise;
  const pf = pageFonts[p] = { ready: false };
  const face = new FontFace(`qcf-p${p}`, `url(${QCF_BASE}p${p}.woff2)`);
  pf.promise = face.load().then(f => {
    document.fonts.add(f);
    measureCtx.font = `100px qcf-p${p}`;
    pf.widths = R.pages[p - 1].map(ln => {
      if (!Array.isArray(ln) || typeof ln[0] === 'string') return 0;
      const words = ln.flatMap(([, t]) => t.split(' '));
      return words.reduce((sum, w) => sum + measureCtx.measureText(w.replace('*', '')).width, 0) + 6 * (words.length - 1);
    });
    // every page font has its own metrics: centre the highlight disc on this
    // page's aya-number ink (span box = 1em line + .18em padding top/bottom,
    // .03em left/right)
    const endTok = R.pages[p - 1].flat().find(x => Array.isArray(x) && /\*/.test(x[1]))?.[1]
      .split(' ').find(t => t.endsWith('*'))?.replace('*', '');
    if (endTok) {
      const m = measureCtx.measureText(endTok);
      const A = m.fontBoundingBoxAscent / 100, D = m.fontBoundingBoxDescent / 100;
      const iA = m.actualBoundingBoxAscent / 100, iD = m.actualBoundingBoxDescent / 100;
      const w = m.width / 100;
      const inkL = -m.actualBoundingBoxLeft / 100, inkR = m.actualBoundingBoxRight / 100;
      const cy = .18 + (1 - (A + D)) / 2 + A - (iA - iD) / 2;
      const cx = .03 + (inkL + inkR) / 2;
      pf.disc = {
        top: (cy / 1.36 * 100).toFixed(2) + '%',
        left: (cx / (w + .06) * 100).toFixed(2) + '%',
        size: (Math.max(iA + iD, inkR - inkL) * .97).toFixed(3) + 'em',
      };
    }
    pf.ready = true;
    // swap the placeholder for the real page if it's on screen
    slots.forEach(sl => {
      if (sl.firstElementChild?.dataset.page == p && sl.firstElementChild.classList.contains('pending')) {
        const pg = renderPage(p);
        pg.classList.add('arrive');
        sl.replaceChildren(pg);
        drawBands(sl);
      }
    });
  }).catch(() => { delete pageFonts[p]; });
  return pf.promise;
}

// ---------------------------------------------------------------- layout

function measure() {
  const probe = $('#probe');
  const cs = getComputedStyle(probe);
  const W = probe.clientWidth, H = probe.clientHeight;
  const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
  const insetT = parseFloat(cs.paddingTop), insetB = parseFloat(cs.paddingBottom);
  S.landscape = W > H;
  document.body.classList.toggle('landscape', S.landscape);
  const em = R?.em || 17;
  if (S.landscape) {
    S.availW = Math.min(W - padL - padR, 980);
    S.fs = S.availW / em;
    S.lh = S.fs * 1.95;
  } else {
    S.availW = W - padL - padR;
    S.linesH = H - insetT - insetB - 46 - 40 - 4;
    S.fs = Math.min(S.availW / em, S.linesH / 15 * 0.74);
    S.lh = Math.min(S.linesH / 15, S.fs * LINE_RATIO);
  }
  document.documentElement.style.setProperty('--fs', S.fs.toFixed(2) + 'px');
  document.documentElement.style.setProperty('--lh', S.lh.toFixed(2) + 'px');
}

function pageInfo(p) {
  // first/last aya on the page
  let first = null, last = null;
  for (const ln of R.pages[p - 1]) {
    if (!Array.isArray(ln) || typeof ln[0] === 'string') continue;
    for (const seg of ln) { if (first == null) first = seg[0]; last = seg[0]; }
  }
  return { first, last };
}

function icon(name) {
  const icons = {
    grid: '<svg viewBox="0 0 28 28"><g fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="8.5" height="8.5" rx="2.6"/><rect x="15.5" y="4" width="8.5" height="8.5" rx="2.6"/><rect x="4" y="15.5" width="8.5" height="8.5" rx="2.6"/><rect x="15.5" y="15.5" width="8.5" height="8.5" rx="2.6"/></g></svg>',
    bm: '<svg viewBox="0 0 22 26"><path d="M3 2.5h16v21l-8-5.6-8 5.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    bmOn: '<svg viewBox="0 0 22 26"><path d="M3 2.5h16v21l-8-5.6-8 5.6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    chev: '<svg viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  return icons[name];
}

function renderPage(p) {
  const el = document.createElement('div');
  if (p < 1 || p > R.pages.length) return el;
  const lines = R.pages[p - 1];
  const opening = p <= 2;
  const pf = R.glyph && pageFonts[p];
  if (R.glyph && !pf?.ready) ensurePageFont(p);
  const pending = R.glyph && !pf?.ready;
  // glyph pages: size so the widest printed line spans the measure
  let fs = S.fs, widths = R.lw?.[p - 1], em = R.em;
  if (R.glyph && pf?.ready) {
    widths = pf.widths.map(w => w / 100);
    em = Math.max(...widths);
    fs = S.landscape ? S.availW / em : Math.min(S.availW / em, S.linesH / 15 * 0.82);
  }
  const lh = S.landscape ? fs * 1.75 : Math.min(S.linesH / 15, fs * LINE_RATIO);
  const { first, last } = pageInfo(p);
  const fa = R.ayas[first], la = R.ayas[last];
  el.className = `page ${p % 2 ? 'odd' : 'even'}${opening ? ' opening' : ''}${pending ? ' pending' : ''}${R.glyph ? ' glyph' : ''}`;
  el.dataset.page = p;
  if (R.glyph && !pending) {
    el.style.setProperty('--fs', fs.toFixed(2) + 'px');
    el.style.setProperty('--lh', lh.toFixed(2) + 'px');
    if (pf.disc) {
      el.style.setProperty('--disc-top', pf.disc.top);
      el.style.setProperty('--disc-left', pf.disc.left);
      el.style.setProperty('--disc-size', pf.disc.size);
    }
  }

  const rub = la[4];
  const rubText = rub ? `${RUB_LABEL[(rub - 1) % 4]} ${ar(Math.floor((rub - 1) / 4) + 1)}` : '';
  const marked = isBookmarked(p);

  let html = `<header class="phead">
    <button class="sura-btn" data-act="suras"><span>${suraName(fa[0])}</span><i class="chev">${icon('chev')}</i></button>
    <button class="grid-btn" data-act="index" aria-label="الفهرس">${icon('grid')}</button>
    <div class="side"><span class="juz">الجزء ${ar(fa[3])}</span><button class="bm-btn${marked ? ' on' : ''}" data-act="bm" aria-label="علامة">${icon(marked ? 'bmOn' : 'bm')}</button></div>
  </header>${ORNAMENT}<div class="lines" style="font-family:${R.glyph ? `qcf-p${p}` : R.font}">`;

  const n = opening ? lines.reduce((m, l, i) => (l ? i + 1 : m), 0) : 15;
  for (let i = 0; i < n; i++) {
    const ln = lines[i];
    if (!ln || pending) { html += '<div class="ln"></div>'; continue; }
    if (ln[0] === 'H') {
      html += `<div class="ln sura"><div class="band"><i class="orn"></i><span class="sname">${SURA_GLYPH(ln[1])}</span><i class="orn"></i></div></div>`;
      continue;
    }
    if (ln[0] === 'B') {
      html += R.glyph
        ? `<div class="ln bsm qb">${BASMALA_GLYPHS}</div>`
        : `<div class="ln bsm" style="font-family:${R.font}">${R.basmala}</div>`;
      continue;
    }
    const w = widths[i];
    let style = '';
    if (w * fs > S.availW * 0.985) style = ` style="font-size:${(S.availW * 0.985 / w).toFixed(2)}px"`;
    const centred = opening || w < em * 0.62;
    html += `<div class="ln${centred ? ' c' : ''}"${style}>`;
    for (const [ai, text] of ln) {
      for (const t of text.split(' ')) {
        const end = isEnd(t);
        html += `<span class="${end ? 'w end' : 'w'}" data-a="${ai}">${end ? t.replace('*', '') : t}</span>`;
      }
    }
    html += '</div>';
  }
  html += `</div>${ORNAMENT}<footer class="pfoot"><span class="pill"><span>${ar(p)}</span><span>${rubText}</span></span></footer>`;
  el.innerHTML = html;
  paintMarks(el);
  return el;
}

function paintMarks(root = document) {
  root.querySelectorAll('.w.sel, .w.play').forEach(e => e.classList.remove('sel', 'play'));
  const saved = new Set(bookmarks().filter(b => b.r === R.id).map(b => b.aya));
  root.querySelectorAll('.w.end').forEach(e => { if (saved.has(+e.dataset.a)) e.classList.add('sel'); });
  if (S.play != null) root.querySelectorAll(`.w.end[data-a="${S.play}"]`).forEach(e => e.classList.add('play'));
  // bands need layout: pages not yet in the document get them on insertion
  if (root === document || root.isConnected) drawBands(root);
}

// one rounded band per line behind the words of the highlighted aya
function drawBands(root) {
  if (root !== document && !root.isConnected) return;
  const want = new Map();
  if (S.focus != null) want.set(S.focus, 'hl');
  if (S.play != null && S.play !== S.focus) want.set(S.play, 'hl play');
  root.querySelectorAll('.hl').forEach(h => {
    if (!want.has(+h.dataset.a) || want.get(+h.dataset.a) !== h.className.replace(' in', '')) h.remove();
  });
  for (const [ai, cls] of want) {
    root.querySelectorAll('.ln').forEach(ln => {
      if (ln.querySelector(`.hl[data-a="${ai}"]`)) return;
      const ws = ln.querySelectorAll(`.w[data-a="${ai}"]`);
      if (!ws.length) return;
      let l = Infinity, r = -Infinity;
      ws.forEach(w => { l = Math.min(l, w.offsetLeft); r = Math.max(r, w.offsetLeft + w.offsetWidth); });
      const fs = parseFloat(getComputedStyle(ln).fontSize) || 20;
      const pad = fs * 0.12;
      const h = document.createElement('div');
      h.className = cls;
      h.dataset.a = ai;
      h.style.left = (l - pad) + 'px';
      h.style.width = (r - l + pad * 2) + 'px';
      ln.prepend(h);
    });
  }
}

// ---------------------------------------------------------------- paging

const slots = [...document.querySelectorAll('.slot')]; // [prev, current, next]

function placeSlots(dx = 0, animate = false) {
  const W = window.innerWidth;
  // RTL book: the next page sits to the left, the previous to the right
  const pos = [W, 0, -W];
  slots.forEach((s, i) => {
    s.style.transition = animate ? 'transform .28s cubic-bezier(.2,.8,.2,1)' : 'none';
    s.style.transform = `translate3d(${pos[i] + dx}px,0,0)`;
  });
}

function prefetchFonts() {
  for (const d of [0, 1, -1, 2, -2]) ensurePageFont(S.page + d);
}

function renderAll() {
  measure();
  prefetchFonts();
  [S.page - 1, S.page, S.page + 1].forEach((p, i) => slots[i].replaceChildren(renderPage(p)));
  placeSlots();
  paintMarks();
}

function goTo(p, { animate = false, from = 0 } = {}) {
  p = Math.max(1, Math.min(R.pages.length, p));
  if (p === S.page) return;
  const step = p - S.page;
  S.page = p;
  K.page = p; K.read = Date.now(); saveKh();
  if (p === R.pages.length && !K.endShown) setTimeout(showDone, 700);
  if (animate && Math.abs(step) === 1) {
    // rotate slots so the page we're moving to stays in place, then slide
    if (step === 1) slots.push(slots.shift()); else slots.unshift(slots.pop());
    // start the slide where the finger left it
    const W = window.innerWidth;
    placeSlots((step === 1 ? -W : W) + from, false);
    void slots[1].offsetWidth;
    placeSlots(0, true);
    const fresh = step === 1 ? 2 : 0;
    slots[fresh].replaceChildren(renderPage(p + (step === 1 ? 1 : -1)));
    drawBands(slots[fresh]);
  } else {
    renderAll();
  }
  const cur = slots[1].firstElementChild;
  if (cur) cur.scrollTop = 0;
  prefetchFonts();
}

// swipe handling
(() => {
  const vp = $('#viewport');
  let x0, y0, t0, axis = null, dx = 0, id = null, pressT = null, pressed = false;
  vp.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); axis = null; dx = 0;
    pressed = false;
    const w = e.target.closest('.w');
    clearTimeout(pressT);
    if (w && !w.classList.contains('end')) {
      pressT = setTimeout(() => { pressed = true; openActions(+w.dataset.a); }, 420);
    }
  });
  vp.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (Math.hypot(mx, my) > 8) clearTimeout(pressT);
    if (!axis && Math.hypot(mx, my) > 8) axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (axis !== 'x') return;
    dx = mx;
    if ((dx > 0 && S.page >= R.pages.length) || (dx < 0 && S.page <= 1)) dx /= 3;
    placeSlots(dx);
  });
  const end = e => {
    if (e.pointerId !== id) return;
    id = null;
    clearTimeout(pressT);
    if (pressed) { vp.dataset.swiped = '1'; setTimeout(() => delete vp.dataset.swiped, 400); }
    if (axis !== 'x') return;
    const v = dx / (performance.now() - t0);
    const W = window.innerWidth;
    if ((dx > W * 0.18 || v > 0.45) && S.page < R.pages.length) goTo(S.page + 1, { animate: true, from: dx });
    else if ((dx < -W * 0.18 || v < -0.45) && S.page > 1) goTo(S.page - 1, { animate: true, from: dx });
    else placeSlots(0, true);
    vp.dataset.swiped = '1';
    setTimeout(() => delete vp.dataset.swiped, 60);
  };
  vp.addEventListener('pointerup', end);
  vp.addEventListener('pointercancel', end);

  vp.addEventListener('click', e => {
    if (vp.dataset.swiped) return;
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'index') openSheet('suras');
      else if (a === 'suras') openSheet('suras');
      else if (a === 'bm') toggleBookmark(S.page);
      return;
    }
    // only the aya number marks; tapping anywhere else just closes the actions
    const w = e.target.closest('.w.end');
    if (w) toggleSave(+w.dataset.a, w);
    else closeActions();
  });
  vp.addEventListener('contextmenu', e => e.preventDefault());
})();

document.addEventListener('keydown', e => {
  if (!$('#sheet').hidden) return;
  if (e.key === 'ArrowLeft') goTo(S.page + 1, { animate: true });
  if (e.key === 'ArrowRight') goTo(S.page - 1, { animate: true });
});

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(renderAll, 80); });

// ---------------------------------------------------------------- selection

function ayaLabel(i) {
  const a = R.ayas[i];
  return `${suraName(a[0])} ${ar(a[1])}`;
}

// Saving works on aya numbers: every saved aya shows a highlighted number.
// Tap a number to save / unsave it. A long press on an aya's text opens its
// actions (S.act) and highlights the whole aya; «علامة» there saves it too.
function toggleSave(i, el) {
  if (isSaved(i)) {
    setBookmarks(bookmarks().filter(b => !(b.r === R.id && b.aya === i)));
    toast('أُزيلت العلامة');
    if (S.act === i) closeActions();
  } else {
    const list = bookmarks();
    list.unshift({ r: R.id, aya: i, page: R.ayas[i][2], t: Date.now() });
    setBookmarks(list);
    K.read = Date.now(); saveKh();
    if (el) ripple(el);
    toast('حُفظت الآية');
    openActions(i);
  }
  paintMarks();
  refreshHeader();
}

function openActions(i) {
  S.act = i;
  S.focus = i;
  paintMarks();
  $('#ayaBarTitle').textContent = ayaLabel(i);
  $('#ayaBar [data-act=bookmark] span').textContent = isSaved(i) ? 'إزالة' : 'علامة';
  if (P.ai == null) hide($('#player'));
  const bar = $('#ayaBar');
  if (!bar.hidden && !bar.classList.contains('leaving')) { bar.classList.remove('swap'); void bar.offsetWidth; bar.classList.add('swap'); }
  show(bar);
}

function closeActions() {
  const had = S.act != null || S.focus != null;
  S.act = null;
  S.focus = null;
  if (had) paintMarks();
  hide($('#ayaBar'));
  if (P.ai != null) show($('#player'));
}

// briefly highlight an aya, e.g. after jumping to it from search
let flashT;
function flashAya(i) {
  S.focus = i; paintMarks();
  clearTimeout(flashT);
  flashT = setTimeout(() => { if (S.focus === i && S.act !== i) { S.focus = null; paintMarks(); } }, 2400);
}

function ripple(el) {
  const r = document.createElement('i');
  r.className = 'ripple';
  el.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}

$('#ayaBar').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || S.act == null) return;
  const i = S.act;
  if (b.dataset.act === 'play') { closeActions(); playFrom(i); }
  if (b.dataset.act === 'copy') {
    const a = R.ayas[i];
    const txt = R.text[i].replace(/\s*[٠-٩]+$/, '');
    try { await navigator.clipboard.writeText(`${txt} ﴿${suraName(a[0])}: ${ar(a[1])}﴾`); toast('تم النسخ'); }
    catch { toast('تعذر النسخ'); }
  }
  if (b.dataset.act === 'bookmark') { toggleSave(i); if (isSaved(i)) closeActions(); }
  if (b.dataset.act === 'close') closeActions();
});

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; show(t);
  clearTimeout(toastT); toastT = setTimeout(() => hide(t), 1700);
}

// ---------------------------------------------------------------- bookmarks

const bookmarks = () => K.bookmarks;
const setBookmarks = list => { K.bookmarks = list; saveKh(); };
const isSaved = i => bookmarks().some(b => b.r === R.id && b.aya === i);
const isBookmarked = p => bookmarks().some(b => b.r === R.id && b.page === p);

// header ribbon: saves the page's first aya, or clears the page's saved ayas
function toggleBookmark(page) {
  if (isBookmarked(page)) {
    setBookmarks(bookmarks().filter(b => !(b.r === R.id && b.page === page)));
    toast('أُزيلت العلامة');
  } else {
    const i = pageInfo(page).first;
    const list = bookmarks();
    list.unshift({ r: R.id, aya: i, page, t: Date.now() });
    setBookmarks(list);
    toast('حُفظت الآية');
  }
  paintMarks();
  refreshHeader();
}

// older saves were by page or a single mark: turn them into aya saves
function normalizeBookmarks() {
  let changed = false;
  if (K.mark != null) {
    if (!K.bookmarks.some(b => b.r === K.riwaya && b.aya === K.mark)) K.bookmarks.unshift({ r: K.riwaya, aya: K.mark, t: Date.now() });
    K.mark = null; changed = true;
  }
  for (const b of K.bookmarks) {
    if (b.r !== R.id) continue;
    if (b.aya == null && b.page) { b.aya = pageInfo(b.page).first; changed = true; }
    if (b.aya != null && R.ayas[b.aya] && b.page !== R.ayas[b.aya][2]) { b.page = R.ayas[b.aya][2]; changed = true; }
  }
  if (changed) saveKh();
}

function refreshHeader() {
  slots.forEach(s => {
    const pg = s.firstElementChild;
    const btn = pg && $('.bm-btn', pg);
    if (!btn) return;
    const on = isBookmarked(+pg.dataset.page);
    btn.classList.toggle('on', on);
    btn.innerHTML = icon(on ? 'bmOn' : 'bm');
  });
}

// ---------------------------------------------------------------- audio

const audio = $('#audio');
const P = { queue: [], ai: null, playedHafs: -1 };
const pad3 = n => String(n).padStart(3, '0');
const hafsUrl = h => { const [s, a] = META.hafs[h]; return `${AUDIO_BASE}${pad3(s)}${pad3(a)}.mp3`; };
const BASMALA_URL = `${AUDIO_BASE}001001.mp3`;

function queueFor(ai) {
  // a riwaya aya may cover part of a hafs aya or several of them; never replay a hafs aya
  const a = R.ayas[ai], q = [];
  for (let h = Math.max(a[5], P.playedHafs + 1); h <= a[6]; h++) {
    const [s, n] = META.hafs[h];
    if (n === 1 && s !== 1 && s !== 9) q.push({ url: BASMALA_URL, h: null });
    q.push({ url: hafsUrl(h), h });
  }
  return q;
}

function playFrom(ai) {
  P.playedHafs = R.ayas[ai][5] - 1;
  startAya(ai);
}

function startAya(ai) {
  if (ai == null || ai >= R.ayas.length) return stopAudio();
  P.ai = ai;
  S.play = ai;
  P.queue = queueFor(ai);
  const page = R.ayas[ai][2];
  if (page !== S.page) goTo(page, { animate: Math.abs(page - S.page) === 1 });
  paintMarks();
  showPlayer();
  if (!P.queue.length) { setTimeout(() => P.ai === ai && startAya(ai + 1), 400); return; }
  nextInQueue();
}

function nextInQueue() {
  const item = P.queue.shift();
  if (!item) return startAya(P.ai + 1);
  if (item.h != null) P.playedHafs = item.h;
  audio.src = item.url;
  audio.play().catch(() => $('#player').classList.add('paused'));
  preloadNext();
}

function preloadNext() {
  const nxt = P.queue[0]?.url || (P.ai + 1 < R.ayas.length ? hafsUrl(R.ayas[P.ai + 1][5]) : null);
  if (nxt) { const a = new Audio(); a.preload = 'auto'; a.src = nxt; }
}

audio.addEventListener('ended', nextInQueue);
audio.addEventListener('timeupdate', () => {
  const f = audio.duration ? audio.currentTime / audio.duration : 0;
  $('#plProg').style.transform = `scaleX(${f})`;
});
audio.addEventListener('play', () => $('#player').classList.remove('paused'));
audio.addEventListener('pause', () => $('#player').classList.add('paused'));
audio.addEventListener('error', () => { if (P.ai != null) toast('تعذر تحميل الصوت'); });

function showPlayer() {
  $('#plTitle').textContent = ayaLabel(P.ai);
  show($('#player'));
  if (S.act == null) hide($('#ayaBar'));
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `سورة ${ayaLabel(P.ai)}`, artist: 'ياسر الدوسري', album: 'القرآن الكريم',
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }
}

function stopAudio() {
  audio.pause();
  audio.removeAttribute('src');
  P.ai = null; S.play = null; P.queue = [];
  hide($('#player'));
  paintMarks();
}

$('#plToggle').onclick = () => (audio.paused ? audio.play() : audio.pause());
$('#plStop').onclick = stopAudio;
$('#plNext').onclick = () => P.ai != null && playFrom(Math.min(P.ai + 1, R.ayas.length - 1));
$('#plPrev').onclick = () => P.ai != null && playFrom(Math.max(P.ai - 1, 0));
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => $('#plNext').onclick());
  navigator.mediaSession.setActionHandler('previoustrack', () => $('#plPrev').onclick());
}

// ---------------------------------------------------------------- offline audio
// Every recitation file can be saved on the device (≈1.5 GB for all 6236
// ayat). The service worker answers playback from this cache, ranges included.

const AUDIO_CACHE = 'audio-yasser-128';
const AUDIO_TOTAL_MB = 1500;
const DL = { running: false, done: 0, total: 0, failed: 0, cached: null, wake: null };
const allAudioUrls = () => META.hafs.map((_, h) => hafsUrl(h));

async function audioCachedSet() {
  if (!('caches' in window)) return new Set();
  const c = await caches.open(AUDIO_CACHE);
  return new Set((await c.keys()).map(r => r.url));
}

function audioPanelHTML() {
  return `<div class="group-label">التلاوة دون اتصال</div>
  <div class="group dl-card" id="dlCard">
    <div class="dl-top">
      <div><div class="t">الشيخ ياسر الدوسري</div><div class="s" id="dlText">جارٍ الفحص…</div></div>
      <div class="dl-pct" id="dlPct"></div>
    </div>
    <div class="prog dl-prog"><i id="dlBar" style="width:0"></i></div>
    <div class="dl-actions" id="dlActions"></div>
  </div>
  <p class="note">يُحفظ صوت كل آية على جهازك (قرابة ١٫٥ غيغابايت للمصحف كاملًا) لتستمع دون إنترنت. أبقِ التطبيق مفتوحًا أثناء التحميل؛ ويمكنك الإيقاف والمتابعة لاحقًا من حيث توقفت. الآيات التي تستمع إليها تُحفظ تلقائيًا أيضًا.</p>`;
}

async function refreshAudioPanel() {
  if (!$('#dlCard')) return;
  if (!DL.running) {
    const set = await audioCachedSet();
    DL.total = META.hafs.length;
    DL.done = allAudioUrls().filter(u => set.has(u)).length;
  }
  paintAudioPanel();
}

function paintAudioPanel() {
  if (!$('#dlCard')) return;
  const pct = DL.total ? DL.done / DL.total : 0;
  $('#dlBar').style.width = (pct * 100).toFixed(1) + '%';
  $('#dlPct').textContent = ar(Math.floor(pct * 100)) + '٪';
  const mb = Math.round(pct * AUDIO_TOTAL_MB);
  const complete = DL.done >= DL.total && DL.total > 0;
  $('#dlText').textContent = complete
    ? `المصحف كاملًا محفوظ على جهازك ✓`
    : `${ar(DL.done)} من ${ar(DL.total)} آية · ${ar(mb)} من ${ar(AUDIO_TOTAL_MB)} م.ب${DL.running ? ' · جارٍ التحميل…' : ''}${DL.failed ? ` · تعذّر ${ar(DL.failed)}` : ''}`;
  $('#dlActions').innerHTML = (complete ? '' : DL.running
    ? '<button data-dl="pause">إيقاف مؤقت</button>'
    : `<button data-dl="start" class="primary">${DL.done ? 'متابعة التحميل' : 'تحميل المصحف كاملًا'}</button>`)
    + (DL.done && !DL.running ? '<button data-dl="clear" class="danger">حذف التحميلات</button>' : '');
}

async function startAudioDownload() {
  if (DL.running) return;
  DL.running = true; DL.failed = 0;
  paintAudioPanel();
  try { await navigator.storage?.persist?.(); } catch {}
  try { DL.wake = await navigator.wakeLock?.request('screen'); } catch {}
  const cache = await caches.open(AUDIO_CACHE);
  const have = await audioCachedSet();
  const urls = allAudioUrls().filter(u => !have.has(u)); // 001001 doubles as the basmala
  DL.total = META.hafs.length;
  DL.done = allAudioUrls().filter(u => have.has(u)).length;
  let next = 0, lastPaint = 0;
  const worker = async () => {
    while (DL.running && next < urls.length) {
      const u = urls[next++];
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok && DL.running; attempt++) {
        try {
          const res = await fetch(u, { mode: 'cors' });
          if (res.ok) { await cache.put(u, res); ok = true; }
        } catch { await new Promise(r => setTimeout(r, 800 * (attempt + 1))); }
      }
      if (ok) DL.done++;
      else if (DL.running) DL.failed++;
      if (performance.now() - lastPaint > 400) { lastPaint = performance.now(); paintAudioPanel(); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const finished = DL.running;
  DL.running = false;
  try { await DL.wake?.release(); } catch {}
  DL.wake = null;
  await refreshAudioPanel();
  if (finished && !DL.failed) toast('اكتمل تحميل التلاوة');
  else if (finished) toast('تعذّر تحميل بعض الآيات — اضغط متابعة');
}

// the wake lock drops when the app is hidden; take it back on return
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && DL.running && !DL.wake) {
    try { DL.wake = await navigator.wakeLock?.request('screen'); } catch {}
  }
  if (document.visibilityState === 'hidden') DL.wake = null;
});

async function clearAudioDownload(btn) {
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'اضغط مرة أخرى للحذف';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'حذف التحميلات'; } }, 2500);
    return;
  }
  await caches.delete(AUDIO_CACHE);
  DL.done = 0;
  await refreshAudioPanel();
  toast('حُذفت التحميلات');
}

// ---------------------------------------------------------------- search

function norm(s) {
  return s
    .replace(/[ٱأإآ]/g, 'ا')
    .replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^ا-ي\sa-z0-9]/g, '')
    .replace(/ـ/g, '');
}
const normLatin = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '');
const toLatinDigits = s => s.replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6f0);

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function wordSim(q, w) {
  if (q === w) return 1;
  if (w.length > q.length && w.startsWith(q)) return q.length >= 3 ? 0.92 : 0.7;
  // attached particles: و ف ب ل ك + ال
  const strip = x => x.replace(/^(و|ف)?(ب|ل|ك)?(ال)?/, '');
  const sq = strip(q), sw = strip(w);
  if (sq.length >= 2 && sq === sw) return 0.9;
  if (sq.length >= 3 && sw.startsWith(sq)) return 0.85;
  const L = Math.max(sq.length, sw.length);
  if (L < 3) return 0;
  const max = L <= 4 ? 1 : 2;
  const d = lev(sq, sw, max);
  return d <= max ? 0.8 * (1 - d / L) + 0.1 : 0;
}

let IDX;
function buildIndex() {
  if (IDX) return IDX;
  const ayas = META.emlaey.map(t => {
    const n = norm(t);
    return { str: n, words: n.split(/\s+/).filter(Boolean) };
  });
  const suras = META.suras.map(([nameAr, en, tr], i) => {
    const a = norm(nameAr).replace(/\s+/g, '');
    return {
      s: i + 1,
      keys: [a, a.replace(/^ال/, ''), normLatin(en).replace(/ /g, ''), normLatin(en).replace(/^(a[lnrstdzh]{1,2})[ -]?/, '').replace(/ /g, ''), normLatin(tr).replace(/ /g, '')],
    };
  });
  return (IDX = { ayas, suras });
}

function suraScore(q) {
  const qa = norm(q).replace(/^سوره\s*/, '').replace(/\s+/g, '');
  const ql = normLatin(q).replace(/^(surah?|sura)\s*/, '').replace(/ /g, '');
  const out = [];
  for (const s of IDX.suras) {
    let best = 0;
    for (const k of s.keys) {
      if (!k) continue;
      for (const x of [qa, qa.replace(/^ال/, ''), ql, ql.replace(/^(a[lnrstdzh]{1,2})[ -]?/, '')]) {
        if (!x || x.length < 2) continue;
        let sc = 0;
        if (x === k) sc = 1;
        else if (k.startsWith(x)) sc = 0.75 + 0.2 * (x.length / k.length);
        else if (k.includes(x) && x.length >= 3) sc = 0.6;
        else {
          const max = k.length <= 4 ? 1 : 2;
          const d = lev(x, k, max);
          if (d <= max) sc = 0.85 * (1 - d / Math.max(x.length, k.length)) + 0.1;
        }
        best = Math.max(best, sc);
      }
    }
    if (best >= 0.55) out.push({ type: 'sura', s: s.s, score: best });
  }
  return out.sort((a, b) => b.score - a.score);
}

function ayaScore(q) {
  const qn = norm(q).trim();
  const qw = qn.split(/\s+/).filter(Boolean);
  if (!qw.length || (qw.length === 1 && qw[0].length < 2)) return [];
  const scoreWords = (words, str) => {
    let sum = 0, lastPos = -1, ordered = 0;
    for (const w of qw) {
      let best = 0, pos = -1;
      for (let k = 0; k < words.length; k++) {
        const sc = wordSim(w, words[k]);
        if (sc > best) { best = sc; pos = k; if (sc === 1) break; }
      }
      sum += best;
      if (pos > lastPos) ordered++;
      lastPos = pos;
    }
    let score = sum / qw.length;
    if (qw.length > 1) score += 0.06 * (ordered / qw.length);
    if (str.includes(qn)) score += 0.25;
    return score;
  };
  const out = [];
  IDX.ayas.forEach((a, h) => {
    let score = scoreWords(a.words, a.str);
    // a phrase can run across into the next aya (e.g. الرحمن علم القرآن)
    const nx = IDX.ayas[h + 1];
    if (qw.length > 1 && nx && META.hafs[h + 1][0] === META.hafs[h][0] && score < 1.2) {
      score = Math.max(score, scoreWords(a.words.concat(nx.words), a.str + ' ' + nx.str) - 0.05);
    }
    if (score >= 0.5) out.push({ type: 'aya', h, score });
  });
  return out.sort((a, b) => b.score - a.score || a.h - b.h).slice(0, 60);
}

function search(raw) {
  buildIndex();
  const q = toLatinDigits(raw.trim());
  if (!q) return [];
  const nums = (q.match(/\d+/g) || []).map(Number);
  const text = q.replace(/[\d:：.,،\-]+/g, ' ').trim();
  const results = [];
  const hafsIndex = (s, a) => META.hafs.findIndex(([x, y]) => x === s && y === a);

  if (!text) {
    if (nums.length >= 2 && nums[0] >= 1 && nums[0] <= 114) {
      const h = hafsIndex(nums[0], nums[1]);
      if (h >= 0) results.push({ type: 'aya', h, score: 2 });
    }
    if (nums[0] >= 1 && nums[0] <= 114) results.push({ type: 'sura', s: nums[0], score: 1.5 });
    if (nums.length === 1 && nums[0] >= 1 && nums[0] <= R.pages.length) results.push({ type: 'page', p: nums[0], score: 1.4 });
    return results;
  }

  const suras = suraScore(text);
  if (nums.length && suras.length) {
    // "البقرة 255" / "baqara 255": jump straight to that aya
    for (const s of suras.slice(0, 3)) {
      const h = hafsIndex(s.s, nums[0]);
      if (h >= 0) results.push({ type: 'aya', h, score: 1.5 + s.score });
    }
  }
  const ayas = /[؀-ۿ]/.test(text) ? ayaScore(text) : [];
  // surah names outrank aya text for short queries, which is how names get typed
  const short = text.split(/\s+/).length <= 2;
  results.push(...suras.slice(0, 6).map(s => ({ ...s, score: s.score + (s.score >= 0.95 ? 0.4 : short ? 0.3 : 0.05) })));
  results.push(...ayas);
  return results.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- sheet

let tab = 'suras';
function openSheet(t = tab) {
  tab = t;
  $('#sheetTitle').textContent = K.name;
  closeActions();
  show($('#sheet'));
  $('#q').value = '';
  renderSheet();
}
function closeSheet() { hide($('#sheet')); $('#q').blur(); }
$('#sheetClose').onclick = closeSheet;
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  $('#q').value = '';
  renderSheet();
});

let searchT;
$('#q').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(renderSheet, 120); });
$('#q').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('#sheetBody .row')?.click(); }
});

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pageOfSura = s => R.ayas[R.suraStart[s]][2];

function suraRow(s, extra = '') {
  const [nameAr, en, tr, count, place] = META.suras[s - 1];
  return `<button class="row${extra}" data-go-sura="${s}">
    <span class="num">${ar(s)}</span>
    <span class="main"><span class="t">سورة ${nameAr}</span><span class="s">${en} · ${place === 'makkah' ? 'مكية' : 'مدنية'} · ${ar(count)} آية</span></span>
    <span class="meta">${ar(pageOfSura(s))}</span>
  </button>`;
}

function renderSheet() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#sheetBody');
  const q = $('#q').value;
  $('#tabs').hidden = !!q.trim();
  let html = '';

  if (q.trim()) {
    const res = search(q);
    if (!res.length) html = '<div class="empty">لا توجد نتائج</div>';
    else {
      html = '<div class="group">';
      res.slice(0, 50).forEach((r, k) => {
        const best = k === 0 ? ' best' : '';
        if (r.type === 'sura') html += suraRow(r.s, best).replace('<span class="meta">', '<span class="tag">سورة</span><span class="meta">');
        else if (r.type === 'page') html += `<button class="row${best}" data-go-page="${r.p}"><span class="num">${ar(r.p)}</span><span class="main"><span class="t">الصفحة ${ar(r.p)}</span></span><span class="tag">صفحة</span></button>`;
        else {
          const ai = R.fromHafs[r.h];
          const [s, a] = META.hafs[r.h];
          html += `<button class="row${best}" data-go-aya="${ai}">
            <span class="main"><span class="s">${suraName(s)} ${ar(a)} · ص ${ar(R.ayas[ai][2])}</span>
            <span class="verse" style="font-family:${R.font}">${esc(R.text[ai])}</span></span>
            <span class="tag">آية</span></button>`;
        }
      });
      html += '</div>';
    }
  } else if (tab === 'suras') {
    html = '<div class="group">' + META.suras.map((_, i) => suraRow(i + 1)).join('') + '</div>';
  } else if (tab === 'juz') {
    html = '<div class="group">';
    for (let j = 1; j <= 30; j++) {
      const ai = R.juzStart[j];
      if (ai == null) continue;
      const a = R.ayas[ai];
      html += `<button class="row" data-go-aya="${ai}"><span class="num">${ar(j)}</span>
        <span class="main"><span class="t">الجزء ${ar(j)}</span><span class="s">${suraName(a[0])} ${ar(a[1])}</span></span>
        <span class="meta">${ar(a[2])}</span></button>`;
    }
    html += '</div>';
  } else if (tab === 'marks') {
    const list = bookmarks();
    if (!list.length) html = '<div class="empty">لا توجد علامات بعد.<br>اضغط على أيقونة العلامة أعلى الصفحة لحفظها.</div>';
    else {
      html = '<div class="group">' + list.map((b, k) => {
        const name = META.riwayat.find(r => r.id === b.r)?.name || b.r;
        const d = cache[b.r];
        const a = d && b.aya != null ? d.ayas[b.aya] : null;
        const page = a ? a[2] : b.page;
        const label = a ? `${suraName(a[0])} ${ar(a[1])}` : '';
        return `<button class="row" data-go-mark="${k}"><span class="num">${ar(page ?? '')}</span>
          <span class="main"><span class="t">${label || 'الصفحة ' + ar(page ?? '')}${label && page ? ' · ص ' + ar(page) : ''}</span><span class="s">${name} · ${new Date(b.t).toLocaleDateString('ar')}</span></span>
          <span class="meta" data-del-mark="${k}">حذف</span></button>`;
      }).join('') + '</div>';
    }
  } else if (tab === 'riwaya') {
    html = audioPanelHTML();
    html += '<div class="group-label">رواية المصحف</div><div class="group">' + META.riwayat.map(r =>
      `<button class="row" data-riwaya="${r.id}"><span class="main"><span class="t">رواية ${r.name}</span><span class="s">${ar(r.ayas)} آية · بخط مجمع الملك فهد</span></span>${r.id === R.id ? '<span class="check">✓</span>' : ''}</button>`).join('') + '</div>';
    html += '<p class="note">لكل رواية رسمها وعلامات ضبطها ووقفها الخاصة. التلاوة الصوتية بصوت الشيخ ياسر الدوسري برواية حفص، وتُطابَق آيات الروايات الأخرى مع ما يقابلها في رواية حفص.</p>';
  }
  body.innerHTML = html;
  if (!q.trim()) body.scrollTop = 0;
  if (tab === 'riwaya' && !q.trim()) refreshAudioPanel();
}

$('#sheetBody').addEventListener('click', async e => {
  const del = e.target.closest('[data-del-mark]');
  if (del) {
    e.stopPropagation();
    const list = bookmarks(); list.splice(+del.dataset.delMark, 1); setBookmarks(list);
    refreshHeader(); renderSheet(); return;
  }
  const dl = e.target.closest('[data-dl]');
  if (dl) {
    const a = dl.dataset.dl;
    if (a === 'start') startAudioDownload();
    else if (a === 'pause') DL.running = false;
    else if (a === 'clear') clearAudioDownload(dl);
    return;
  }
  const row = e.target.closest('.row');
  if (!row) return;
  const d = row.dataset;
  if (d.goSura) { closeSheet(); goTo(pageOfSura(+d.goSura)); }
  else if (d.goPage) { closeSheet(); goTo(+d.goPage); }
  else if (d.goAya) {
    closeSheet();
    const ai = +d.goAya;
    goTo(R.ayas[ai][2]);
    setTimeout(() => flashAya(ai), 250);
  } else if (d.goMark) {
    const b = bookmarks()[+d.goMark];
    closeSheet();
    if (b.r !== R.id) await switchRiwaya(b.r, false);
    goTo(b.aya != null && R.ayas[b.aya] ? R.ayas[b.aya][2] : b.page);
    if (b.aya != null) setTimeout(() => flashAya(b.aya), 250);
  } else if (d.riwaya && d.riwaya !== R.id) {
    await switchRiwaya(d.riwaya, true);
    renderSheet();
  }
});

async function switchRiwaya(id, keepPlace) {
  // keep the reader on the same passage: go through the hafs aya numbering
  const h = keepPlace ? R.ayas[pageInfo(S.page).first][5] : null;
  stopAudio();
  $('#loading').hidden = false;
  try {
    const d = await loadRiwaya(id);
    R = d;
    S.page = h != null ? R.ayas[R.fromHafs[h]][2] : K.page;
    K.riwaya = id; K.page = S.page;
    S.act = S.focus = null;
    normalizeBookmarks();
    saveKh();
    renderAll();
  } catch (err) {
    toast('تعذر تحميل الرواية');
  } finally {
    $('#loading').hidden = true;
  }
}

// ---------------------------------------------------------------- library

function coverSVG(c) {
  // gold frame, corner fleurons and an eight-pointed star medallion
  const star = (cx, cy, r) => {
    let d = '';
    for (let i = 0; i < 16; i++) {
      const a = Math.PI / 8 * i - Math.PI / 2, rr = i % 2 ? r * 0.62 : r;
      d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(2) + ' ' + (cy + rr * Math.sin(a)).toFixed(2);
    }
    return d + 'Z';
  };
  const corner = (x, y, sx, sy) => `<path transform="translate(${x} ${y}) scale(${sx} ${sy})" d="M0 0h14M0 0v14M3 3h7M3 3v7M3 3l6 6" />`;
  return `<svg viewBox="0 0 120 168" class="cv-art" aria-hidden="true">
    <defs><pattern id="pt${c}" width="12" height="12" patternUnits="userSpaceOnUse">
      <path d="${star(6, 6, 3.2)}" fill="none" stroke="currentColor" stroke-width=".35" opacity=".35"/></pattern></defs>
    <rect x="13" y="13" width="94" height="142" fill="url(#pt${c})" />
    <g fill="none" stroke="currentColor">
      <rect x="7" y="7" width="106" height="154" rx="2" stroke-width="1.3"/>
      <rect x="11" y="11" width="98" height="146" rx="1.5" stroke-width=".5"/>
      <g stroke-width=".8">${corner(14, 14, 1, 1)}${corner(106, 14, -1, 1)}${corner(14, 154, 1, -1)}${corner(106, 154, -1, -1)}</g>
      <circle cx="60" cy="92" r="24" stroke-width=".5"/>
      <circle cx="60" cy="92" r="21" stroke-width=".3" stroke-dasharray="1 1.6"/>
      <path d="${star(60, 92, 18)}" stroke-width=".9"/>
      <path d="${star(60, 92, 11.5)}" stroke-width=".5"/>
      <path d="M40 126h40M48 130h24" stroke-width=".5"/>
      <path d="M60 122l3 4-3 4-3-4z" stroke-width=".6"/>
    </g>
  </svg>`;
}

function coverHTML(k, small = false) {
  const c = COVERS[k.cover] || COVERS[0];
  return `<div class="cover${small ? ' small' : ''}" style="--c1:${c.bg[0]};--c2:${c.bg[1]};--gold:${c.gold}">
    ${coverSVG(k.cover)}
    <div class="cv-title">ٱلۡقُرۡءَانُ<br>ٱلۡكَرِيمُ</div>
    <div class="cv-name">${esc(k.name)}</div>
  </div>`;
}

function renderShelf() {
  const riwayaName = id => META.riwayat.find(r => r.id === id)?.name || id;
  const sorted = [...KH].sort((a, b) => b.read - a.read);
  $('#shelf').innerHTML = sorted.map((k, idx) => {
    const total = 604;
    const pct = Math.round((k.page - 1) / (total - 1) * 100);
    return `<div class="book${k.id === K.id ? ' current' : ''}" data-kh="${k.id}" style="--i:${idx}">
      <button class="book-open" data-open="${k.id}" aria-label="${esc(k.name)}">${coverHTML(k)}</button>
      <div class="book-info">
        <div class="book-row"><b>${esc(k.name)}</b><button class="dots" data-edit="${k.id}" aria-label="تعديل">•••</button></div>
        <div class="book-sub">${riwayaName(k.riwaya)}</div>
        <div class="prog"><i style="width:${pct}%"></i></div>
        <div class="book-sub">صفحة ${ar(k.page)} · ${ar(pct)}٪${k.done ? ` · ${ar(k.done)} ${k.done === 1 ? 'ختمة' : 'ختمات'} ✓` : ''}</div>
      </div>
    </div>`;
  }).join('') + `<div class="book" style="--i:${sorted.length}"><button class="book-open" data-new="1"><div class="cover new"><span>+</span><small>ختمة جديدة</small></div></button></div>`;
}

function openLibrary() {
  closeSheet();
  closeActions();
  renderShelf();
  show($('#library'));
}

$('#libClose').onclick = () => hide($('#library'));
$('#libBtn').onclick = openLibrary;

$('#shelf').addEventListener('click', async e => {
  const t = e.target.closest('[data-open],[data-edit],[data-new]');
  if (!t) return;
  if (t.dataset.edit) return openEditor(KH.find(k => k.id === t.dataset.edit));
  if (t.dataset.new) return openEditor(null);
  await openKhatma(t.dataset.open);
});

async function openKhatma(id) {
  const k = KH.find(x => x.id === id);
  if (!k) return;
  stopAudio();
  closeActions();
  K = k; K.read = Date.now(); saveKh();
  $('#loading').hidden = false;
  try {
    R = await loadRiwaya(K.riwaya);
    S.page = K.page;
    S.act = S.focus = null;
    normalizeBookmarks();
    renderAll();
    hide($('#library'));
  } catch { toast('تعذر التحميل'); }
  finally { $('#loading').hidden = true; }
}

let editing = null;
function openEditor(k) {
  editing = k;
  const f = $('#khForm');
  f.name.value = k ? k.name : `ختمة ${ar(KH.length + 1)}`;
  f.riwaya.innerHTML = META.riwayat.map(r => `<option value="${r.id}">رواية ${r.name}</option>`).join('');
  f.riwaya.value = k ? k.riwaya : 'hafs';
  const cover = k ? k.cover : KH.length % COVERS.length;
  $('#swatches').innerHTML = COVERS.map((c, i) =>
    `<label class="sw" style="--c1:${c.bg[0]};--c2:${c.bg[1]};--gold:${c.gold}"><input type="radio" name="cover" value="${i}"${i === cover ? ' checked' : ''}><span></span></label>`).join('');
  $('#khTitle').textContent = k ? 'تعديل الختمة' : 'ختمة جديدة';
  $('#khSave').textContent = k ? 'حفظ' : 'ابدأ الختمة';
  $('#khRestart').hidden = $('#khDelete').hidden = !k;
  $('#khDelete').disabled = KH.length < 2;
  updatePreview();
  show($('#khEdit'));
}
function updatePreview() {
  const f = $('#khForm');
  $('#khPreview').innerHTML = coverHTML({ name: f.name.value || '—', cover: +f.cover.value }, true);
}
$('#khForm').addEventListener('input', updatePreview);
$('#khCancel').onclick = () => hide($('#khEdit'));
$('#khForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const name = f.name.value.trim() || 'ختمة';
  if (editing) {
    const riwayaChanged = editing.riwaya !== f.riwaya.value;
    Object.assign(editing, { name, cover: +f.cover.value });
    if (riwayaChanged) {
      editing.riwaya = f.riwaya.value;
      editing.mark = null; editing.page = 1;
    }
    saveKh();
    hide($('#khEdit'));
    if (editing === K && riwayaChanged) await openKhatma(K.id);
    renderShelf();
  } else {
    const k = newKhatma(name, f.riwaya.value, +f.cover.value);
    KH.push(k); saveKh();
    hide($('#khEdit'));
    await openKhatma(k.id);
    toast('بدأت ختمة جديدة');
  }
});
$('#khRestart').onclick = () => {
  Object.assign(editing, { page: 1, mark: null, endShown: false });
  saveKh();
  hide($('#khEdit'));
  if (editing === K) { S.page = 1; renderAll(); }
  renderShelf();
};
$('#khDelete').onclick = async () => {
  if (KH.length < 2) return;
  if (!$('#khDelete').dataset.armed) {
    $('#khDelete').dataset.armed = '1';
    $('#khDelete').textContent = 'اضغط مرة أخرى للحذف';
    setTimeout(() => { delete $('#khDelete').dataset.armed; $('#khDelete').textContent = 'حذف الختمة'; }, 2500);
    return;
  }
  KH = KH.filter(k => k !== editing);
  hide($('#khEdit'));
  if (editing === K) await openKhatma(KH[0].id);
  saveKh();
  renderShelf();
};

function showDone() {
  if (S.page !== R.pages.length) return;
  K.endShown = true; saveKh();
  $('#doneCover').innerHTML = coverHTML(K, true);
  $('#doneText').textContent = `أتممت «${K.name}»${K.done ? ` — الختمة رقم ${ar(K.done + 1)}` : ''}`;
  show($('#done'));
}
$('#doneAgain').onclick = () => {
  K.done = (K.done || 0) + 1;
  Object.assign(K, { page: 1, mark: null, endShown: false });
  saveKh();
  hide($('#done'));
  S.page = 1; renderAll();
  toast('بارك الله لك — بدأت الختمة من جديد');
};
$('#doneLater').onclick = () => hide($('#done'));

// ---------------------------------------------------------------- boot

(async () => {
  try {
    META = await loadJSON(`data/meta.json?v=${DATA_VERSION}`);
    loadKhatmas();
    if (!META.riwayat.some(r => r.id === K.riwaya)) K.riwaya = 'hafs';
    R = await loadRiwaya(K.riwaya);
    S.page = K.page;
    normalizeBookmarks();
    renderAll();
    hide($('#loading'));
  } catch (err) {
    $('#loading').textContent = 'تعذر التحميل — تحقق من الاتصال';
    console.error(err);
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // reload once when an updated service worker takes over, so updates show up
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
})();
