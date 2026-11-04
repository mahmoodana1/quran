'use strict';

// bump when data/ or fonts/ change so phones fetch the new files
const DATA_VERSION = 6;
const AUDIO_BASE = 'https://everyayah.com/data/Yasser_Ad-Dussary_128kbps/';
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
  syncDock();
  if (el.classList.contains('bar')) keepClear();
}
function hide(el) {
  if (el.hidden || el.classList.contains('leaving')) return;
  el.classList.add('leaving');
  syncDock();
  const done = e => {
    if (e && e.target !== el) return;
    el.removeEventListener('animationend', done);
    clearTimeout(t);
    if (el.classList.contains('leaving')) { el.hidden = true; el.classList.remove('leaving'); }
    syncDock();
  };
  el.addEventListener('animationend', done);
  const t = setTimeout(done, 400); // in case animations are off
}

// bottom switcher: "panels" is lit while the index sheet, the library or adhkar are up
function panelOpen(el) { return !el.hidden && !el.classList.contains('leaving'); }
function syncDock() {
  const panels = panelOpen($('#sheet')) || panelOpen($('#library')) || panelOpen($('#adhkar'));
  $('#dockPanels').classList.toggle('on', panels);
  $('#dockQuran').classList.toggle('on', !panels);
}
$('#dockPanels').onclick = () => {
  if (panelOpen($('#adhkar'))) Adhkar.close();
  else if (!panelOpen($('#sheet')) && !panelOpen($('#library'))) openSheet();
};
$('#dockQuran').onclick = () => {
  closeSheet();
  hide($('#library'));
  hide($('#adhkar'));
  if (!$('#tafsir').hidden) closeTafsir();
};

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
      // glyphs + .04em padding around aya numbers + .03em css gap between
      // items (an aya number and the word before it form one item)
      const items = words.length - words.filter((w, k) => k && w.endsWith('*')).length;
      return words.reduce((sum, w) => sum + measureCtx.measureText(w.replace('*', '')).width + (w.endsWith('*') ? 4 : 0), 0)
        + 3 * (items - 1);
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
  S.W = W; S.H = H;
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
    bm: '<svg viewBox="0 0 22 26"><path d="M3 2.5h16v21l-8-5.6-8 5.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    bmOn: '<svg viewBox="0 0 22 26"><path d="M3 2.5h16v21l-8-5.6-8 5.6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><path d="M12 3.5a3 3 0 00-3 3v5a3 3 0 006 0v-5a3 3 0 00-3-3zM6.5 11a5.5 5.5 0 0011 0M12 16.5v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
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
    // size to a typical full line; the odd longest line is shrunk (≤3%) to fit
    const full = widths.filter(Boolean).sort((x, y) => x - y);
    const max = full[full.length - 1];
    em = Math.max(full[Math.floor(full.length * 0.8)] || max, max * 0.97);
    fs = S.landscape ? S.availW / em : Math.min(S.availW / em, S.linesH / 15 * 0.82);
  }
  const lh = S.landscape ? fs * 1.75 : Math.min(S.linesH / 15, fs * LINE_RATIO);
  const { first, last } = pageInfo(p);
  const fa = R.ayas[first];
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

  const marked = isBookmarked(p);

  let html = `<header class="phead">
    <button class="sura-btn" data-act="suras"><span>${suraName(fa[0])}</span><i class="chev">${icon('chev')}</i></button>
    <span class="pnum">${ar(p)}</span>
    <div class="side"><span class="juz">الجزء ${ar(fa[3])}</span><button class="bm-btn${marked ? ' on' : ''}" data-act="bm" aria-label="علامة">${icon(marked ? 'bmOn' : 'bm')}</button><button class="mic-btn" data-act="mic" aria-label="اقرأ آيةً لأجدها">${icon('mic')}</button></div>
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
    const fit = R.glyph ? 0.998 : 0.985; // glyph sizes come from in-browser measurement
    if (w * fs > S.availW * fit) style = ` style="font-size:${(S.availW * fit / w).toFixed(2)}px"`;
    const centred = opening || w < em * 0.62;
    html += `<div class="ln${centred ? ' c' : ''}"${style}>`;
    // an aya number hugs the word before it, as in print
    const items = [];
    for (const [ai, text] of ln) {
      for (const t of text.split(' ')) {
        const end = isEnd(t);
        const span = `<span class="${end ? 'w end' : 'w'}" data-a="${ai}">${end ? t.replace('*', '') : t}</span>`;
        if (end && items.length) items.push(`<span class="wg">${items.pop()}${span}</span>`);
        else items.push(span);
      }
    }
    html += items.join('') + '</div>';
  }
  html += `</div>${ORNAMENT}<footer class="pfoot"></footer>`;
  el.innerHTML = html;
  paintMarks(el);
  return el;
}

function paintMarks(root = document) {
  root.querySelectorAll('.w.sel, .w.play').forEach(e => e.classList.remove('sel', 'play'));
  const saved = new Set(bookmarks().filter(b => b.r === R.id).map(b => b.aya));
  root.querySelectorAll('.w.end').forEach(e => { if (saved.has(+e.dataset.a)) e.classList.add('sel'); });
  if (S.play != null) root.querySelectorAll(`.w.end[data-a="${S.play}"]`).forEach(e => e.classList.add('play'));
  if (typeof Recite !== 'undefined') Recite.paint(root);
  // bands need layout: pages not yet in the document get them on insertion
  if (root === document || root.isConnected) drawBands(root);
  keepClear();
}

// ---------------------------------------------------------------- the aya in sight
// The floating bars (the aya's actions, the player, the reciting bar) sit at
// the bottom. When the aya they are about (pressed, playing or being recited)
// would be under one, the bar slides up under the page header instead (or to
// wherever it covers less), so the aya is always in full view; in landscape,
// where the page scrolls, the aya is scrolled into view as well.
const BARS = ['#ayaBar', '#wordBar', '#player', '#recBar', '#recWord'];
let clearRaf = 0;
function keepClear() {
  cancelAnimationFrame(clearRaf);
  clearRaf = requestAnimationFrame(clearNow);
}
function clearNow() {
  const bars = BARS.map(sel => $(sel)).filter(b => !b.hidden && !b.classList.contains('leaving'));
  const pg = slots[1]?.firstElementChild, ai = S.act ?? S.focus ?? S.play;
  let box = null;
  const wel = typeof WordCard !== 'undefined' && WordCard.el();
  if (wel?.isConnected) { const r = wel.getBoundingClientRect(); box = { top: r.top, bottom: r.bottom }; }
  else if (ai != null && pg) for (const w of pg.querySelectorAll(`.w[data-a="${ai}"]`)) {
    const r = w.getBoundingClientRect();
    if (!r.height) continue;
    box = box ? { top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom) } : { top: r.top, bottom: r.bottom };
  }
  // the page header's lowest part (its box can be shorter than its buttons)
  const ph = pg?.querySelector('.phead');
  const head = ph ? Math.max(ph.getBoundingClientRect().bottom, ...[...ph.querySelectorAll('*')].map(e => e.getBoundingClientRect().bottom)) : 0;
  if (box && S.landscape) {
    const lowest = Math.min(window.innerHeight, ...bars.map(b => b.getBoundingClientRect().top));
    if (box.top < head || box.bottom > lowest) {
      pg.scrollBy({ top: box.top - head - 24, behavior: 'smooth' });
      setTimeout(keepClear, 450);
      return;
    }
  }
  for (const b of bars) {
    const lifted = parseFloat(b.style.getPropertyValue('--lift')) || 0;
    if (!box) { if (lifted) b.style.setProperty('--lift', '0px'); continue; }
    const top = b.offsetTop, h = b.offsetHeight, up = head + 8; // where it rests (not mid-slide)
    const over = t => Math.max(0, Math.min(t + h, box.bottom + 6) - Math.max(t, box.top - 6));
    const down = over(top), high = over(up);
    b.style.setProperty('--lift', (down === 0 || down <= high ? 0 : up - top) + 'px');
  }
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
  const W = S.W || window.innerWidth;
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
    const W = S.W || window.innerWidth;
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
  keepClear();
  setTimeout(keepClear, 420); // once the slide has settled
}

// ---------------------------------------------------------------- single word

// Long-pressing a word recites just that word (quran.com word-by-word audio,
// Hafs numbering). Position = words of the aya on earlier pages + words before it here.
const WORD_AUDIO = 'https://audio.qurancdn.com/wbw/';
const wordAudio = new Audio();
let sayEl = null;

function wordsOnPage(p, ai) {
  let n = 0;
  for (const ln of R.pages[p - 1]) {
    if (!Array.isArray(ln) || typeof ln[0] === 'string') continue;
    for (const [a, text] of ln) if (a === ai) n += text.split(' ').filter(t => !isEnd(t)).length;
  }
  return n;
}

// a word on the page: its place in its aya (from 0)
function wordIndex(el) {
  const ai = +el.dataset.a, page = +el.closest('.page').dataset.page;
  let wi = 0;
  for (let p = R.ayas[ai][2]; p < page; p++) wi += wordsOnPage(p, ai);
  return wi + [...el.closest('.page').querySelectorAll(`.w:not(.end)[data-a="${ai}"]`)].indexOf(el);
}

function speakWord(el) {
  if (R.id !== 'hafs') { toast('نطق الكلمة متاح في رواية حفص'); return; }
  const ai = +el.dataset.a, pos = wordIndex(el) + 1;
  const [s, a] = META.hafs[R.ayas[ai][5]];
  const id = n => String(n).padStart(3, '0');
  if (!audio.paused) audio.pause();
  sayEl?.classList.remove('say');
  sayEl = el;
  el.classList.add('say');
  wordAudio.src = `${WORD_AUDIO}${id(s)}_${id(a)}_${id(pos)}.mp3`;
  wordAudio.play().catch(() => { el.classList.remove('say'); toast('تعذر تشغيل الكلمة'); });
  haptic(8);
}
wordAudio.addEventListener('ended', () => sayEl?.classList.remove('say'));
wordAudio.addEventListener('error', () => { sayEl?.classList.remove('say'); if (wordAudio.src) toast('تعذر تشغيل الكلمة'); });

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
    // a long press on a word: its card (not while reciting)
    if (w && !w.classList.contains('end') && !Recite.active()) {
      pressT = setTimeout(() => { pressed = true; haptic(8); WordCard.open(w); }, 420);
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
    const W = S.W || window.innerWidth;
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
      else if (a === 'mic') Recite.mic();
      return;
    }
    if (typeof Recite !== 'undefined' && Recite.onTap(e.target)) return;
    // a tap on an aya (any of its words, or its number) marks it and opens its
    // actions; a second tap, or one off the text, closes them
    const w = e.target.closest('.w[data-a]');
    if (w) {
      const i = +w.dataset.a;
      if (!$('#tafsir').hidden) { ripple(w); openTafsir(i); }
      else if (S.act === i && !$('#ayaBar').hidden) closeActions();
      else { ripple(w); openActions(i); }
    }
    else closeActions();
    if (!w) WordCard.close();
  });
  vp.addEventListener('contextmenu', e => e.preventDefault());
})();

document.addEventListener('keydown', e => {
  if (!$('#sheet').hidden) return;
  if (e.key === 'ArrowLeft') goTo(S.page + 1, { animate: true });
  if (e.key === 'ArrowRight') goTo(S.page - 1, { animate: true });
});

// Re-lay out when the screen turns. iOS fires 'resize' before the rotation
// has settled (and can leave the document scrolled afterwards, which shifts
// every tap off what's drawn), so watch the probe's own size, which only
// changes once layout has the final dimensions, and pin the document back.
let resizeT;
function onResize() {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  document.documentElement.scrollTop = document.body.scrollTop = 0;
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    const probe = $('#probe');
    if (!R || (probe.clientWidth === S.W && probe.clientHeight === S.H)) return;
    renderAll();
  }, 60);
}
if ('ResizeObserver' in window) new ResizeObserver(onResize).observe($('#probe'));
window.addEventListener('resize', onResize);
window.addEventListener('resize', keepClear);
window.addEventListener('orientationchange', () => { onResize(); setTimeout(onResize, 400); });
window.visualViewport?.addEventListener('resize', onResize);

// ---------------------------------------------------------------- selection

function ayaLabel(i) {
  const a = R.ayas[i];
  return `${suraName(a[0])} ${ar(a[1])}`;
}

// Saving works on aya numbers: every saved aya shows a highlighted number.
// Tapping a number opens the aya's actions and
// highlights it; «علامة» in the actions saves or unsaves it.
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
  }
  paintMarks();
  refreshHeader();
}

function openActions(i) {
  WordCard.close();
  S.act = i;
  S.focus = i;
  paintMarks();
  $('#ayaBarTitle').textContent = ayaLabel(i);
  $('#ayaBar [data-act=bookmark] span').textContent = isSaved(i) ? 'محفوظة' : 'علامة';
  $('#ayaBar [data-act=bookmark]').classList.toggle('on', isSaved(i));
  const card = typeof Recite !== 'undefined' ? Recite.card(i) : '';
  $('#ayaBarRc').innerHTML = card;
  $('#ayaBarRc').hidden = !card;
  if (P.ai == null) hide($('#player'));
  const bar = $('#ayaBar');
  if (!bar.hidden && !bar.classList.contains('leaving')) { bar.classList.remove('swap'); void bar.offsetWidth; bar.classList.add('swap'); }
  show(bar);
}

function closeActions() {
  if (!$('#tafsir').hidden) return closeTafsir();
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
  const wd = e.target.closest('[data-rc-word]');
  if (wd) { const [ai, wi] = wd.dataset.rcWord.split(':').map(Number); Recite.showWord(ai, wi); return; }
  const b = e.target.closest('[data-act]');
  if (!b || S.act == null) return;
  const i = S.act;
  if (b.dataset.act === 'play') { closeActions(); playFrom(i); }
  if (b.dataset.act === 'recite') Recite.start(i);
  if (b.dataset.act === 'copy') {
    const a = R.ayas[i];
    const txt = R.text[i].replace(/\s*[٠-٩]+$/, '');
    try { await navigator.clipboard.writeText(`${txt} ﴿${suraName(a[0])}: ${ar(a[1])}﴾`); toast('تم النسخ'); }
    catch { toast('تعذر النسخ'); }
  }
  if (b.dataset.act === 'bookmark') { toggleSave(i); closeActions(); }
  if (b.dataset.act === 'tafsir') openTafsir(i);
  if (b.dataset.act === 'close') closeActions();
});

// a short buzz: the Vibration API where there is one; iPhones have none, but
// Safari gives a tick when a switch is flipped, so a hidden one is flipped
let hapticSw = null;
function haptic(pattern = 10) {
  if (navigator.vibrate) { navigator.vibrate(pattern); return; }
  if (!hapticSw) {
    hapticSw = document.createElement('label');
    hapticSw.setAttribute('aria-hidden', 'true');
    hapticSw.style.cssText = 'position:fixed;left:-20px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    hapticSw.innerHTML = '<input type="checkbox" switch tabindex="-1">';
    hapticSw.addEventListener('click', e => e.stopPropagation());
    document.body.append(hapticSw);
  }
  const ticks = Array.isArray(pattern) ? Math.ceil(pattern.length / 2) : 1;
  for (let k = 0; k < ticks; k++) setTimeout(() => {
    const was = document.activeElement;
    hapticSw.click();
    if (document.activeElement !== was) { document.activeElement?.blur(); was?.focus?.({ preventScroll: true }); }
  }, k * 110);
}

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

// Seamless recitation. Switching an <audio> element from one file to the next
// leaves an audible cut on phones, so the aya files are joined into one long
// MP3 instead: each is read ahead (the saved copy when downloaded, else the
// network, which the service worker also saves), stripped to its bare MP3
// frames and appended. One <audio> element plays it, so lock-screen controls
// and background playback keep working on iPhone and Android. The aya being
// recited is worked out from the play position.

const audio = $('#audio');
const pad3 = n => String(n).padStart(3, '0');
const hafsUrl = h => { const [s, a] = META.hafs[h]; return `${AUDIO_BASE}${pad3(s)}${pad3(a)}.mp3`; };
const BASMALA_URL = `${AUDIO_BASE}001001.mp3`;
// one joined file holds at most ~26 minutes (128 kbps); as much again is read ahead
const CHUNK_MB = 24;
// run: playback session (stale async work checks it); list: files in order from
// the start aya; got[k]: list[k]'s frames once read; at: index playing; chunk:
// the joined file now loaded { from, to, starts: start time of each file }
const P = { run: 0, ai: null, list: [], gen: null, got: [], at: -1, chunk: null, tick: 0 };

// every recitation file from aya `ai` on: a riwaya aya may cover part of a
// hafs aya or several of them; a hafs aya is never played twice
function* sequence(ai) {
  let last = R.ayas[ai][5] - 1;
  for (; ai < R.ayas.length; ai++) {
    const a = R.ayas[ai];
    for (let h = Math.max(a[5], last + 1); h <= a[6]; h++) {
      const [s, n] = META.hafs[h];
      if (n === 1 && s !== 1 && s !== 9) yield { url: BASMALA_URL, ai };
      yield { url: hafsUrl(h), ai };
      last = h;
    }
  }
}
function item(k) {
  while (P.list.length <= k) { const x = P.gen.next(); if (x.done) return null; P.list.push(x.value); }
  return P.list[k];
}

// MPEG audio frames of a file without its ID3 tags or Xing/Info header, which
// would stop a decoder mid-stream; duration counted from the frames
const MP3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_HZ = [44100, 48000, 32000];
function mp3Frames(buf) {
  const b = new Uint8Array(buf);
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) i = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127));
  while (i + 1 < b.length && !(b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0)) i++; // to the first frame
  const parts = [];
  let hz = 44100, first = true;
  while (i + 4 <= b.length && b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) {
    const kbps = MP3_KBPS[b[i + 2] >> 4];
    hz = MP3_HZ[(b[i + 2] >> 2) & 3];
    if (!kbps || !hz) break;
    const len = Math.floor(144000 * kbps / hz) + ((b[i + 2] >> 1) & 1);
    if (i + len > b.length) break;
    if (!(first && /Xing|Info/.test(String.fromCharCode(...b.subarray(i + 4, i + 44))))) parts.push(b.subarray(i, i + len));
    first = false;
    i += len;
  }
  // MPEG-1 Layer III: 1152 samples a frame
  return { parts, bytes: parts.reduce((s, p) => s + p.length, 0), dur: parts.length * 1152 / hz };
}

function fetchItem(k, tries = 3) {
  const run = P.run, it = item(k);
  if (!it || P.got[k]) return P.got[k]?.p;
  const g = P.got[k] = { v: undefined };
  g.p = (async () => {
    for (let t = 0; t < tries && run === P.run; t++) {
      try {
        const r = await fetch(it.url, { mode: 'cors' });
        if (r.ok) return (g.v = mp3Frames(await r.arrayBuffer()));
      } catch {}
      await new Promise(r => setTimeout(r, 600 * (t + 1)));
    }
    if (P.got[k] === g) delete P.got[k]; // ask again next time
    return (g.v = null);
  })();
  return g.p;
}

// keep reading ahead of the file playing, a few at a time
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  const run = P.run;
  try {
    // bytes read but not yet in a joined file
    const ahead = () => P.got.reduce((s, g) => s + (g?.v?.bytes || 0), 0);
    const worker = async () => {
      for (let k = Math.max(P.at + 1, P.chunk?.to ?? 0); run === P.run && item(k) && ahead() < CHUNK_MB * 1e6; k++) {
        if (!P.got[k]) await fetchItem(k);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } finally { pumping = false; }
}

// join the files from list[from] on that are already read (waiting for the first)
async function playChunk(from, wait = 0) {
  const run = P.run;
  const first = await fetchItem(from);
  if (run !== P.run) return;
  if (!first) { toast('تعذر تحميل الصوت'); return stopAudio(); }
  // when starting, give the next ones a moment so the first joined file is not tiny
  if (wait) {
    pump();
    const next = Array.from({ length: 12 }, (_, d) => item(from + 1 + d) && fetchItem(from + 1 + d));
    await Promise.race([Promise.all(next), new Promise(r => setTimeout(r, wait))]);
  }
  if (run !== P.run) return;
  const starts = [];
  let t = 0, bytes = 0, to = from;
  while (item(to) && P.got[to]?.v && (to === from || bytes + P.got[to].v.bytes < CHUNK_MB * 1e6)) {
    starts.push(t);
    t += P.got[to].v.dur; bytes += P.got[to].v.bytes;
    to++;
  }
  // the hand-over to the next joined file may not be quite seamless on every
  // phone: when one is coming, make it just before a surah's basmala, where
  // the reciter pauses anyway (if that leaves over two minutes)
  if (item(to)) {
    for (let j = to - 1; j > from; j--) {
      if (P.list[j].url === BASMALA_URL && starts[j - from] > 120) { to = j; t = starts[j - from]; starts.length = j - from; break; }
    }
  }
  starts.push(t);
  const parts = [];
  for (let k = from; k < to; k++) { parts.push(...P.got[k].v.parts); P.got[k] = { v: true }; } // the joined file holds the bytes now
  const old = audio.src;
  P.chunk = { from, to, starts };
  P.at = -1;
  audio.src = URL.createObjectURL(new Blob(parts, { type: 'audio/mpeg' }));
  if (old.startsWith('blob:')) URL.revokeObjectURL(old);
  audio.play().catch(() => $('#player').classList.add('paused'));
  sync();
  pump();
}

// which file is playing: follow it with the highlight, page and title
function sync() {
  clearTimeout(P.tick);
  const c = P.chunk;
  if (!c) return;
  const t = audio.currentTime;
  let k = c.from;
  while (k + 1 < c.to && c.starts[k + 1 - c.from] <= t + 0.02) k++;
  if (k !== P.at) {
    P.at = k;
    const ai = P.list[k].ai;
    if (ai !== P.ai) {
      P.ai = S.play = ai;
      const page = R.ayas[ai][2];
      if (page !== S.page) goTo(page, { animate: Math.abs(page - S.page) === 1 });
      paintMarks();
      showPlayer();
    }
    pump();
  }
  // this aya's share of the bar
  let a = k, b = k + 1;
  while (a > c.from && P.list[a - 1].ai === P.ai) a--;
  while (b < c.to && P.list[b].ai === P.ai) b++;
  const s = c.starts[a - c.from], e = c.starts[b - c.from];
  $('#plProg').style.transform = `scaleX(${Math.min(1, Math.max(0, (t - s) / (e - s || 1)))})`;
  // wake up right at the next file (timeupdate alone is only ~4 times a second)
  if (!audio.paused && k + 1 < c.to) P.tick = setTimeout(sync, (c.starts[k + 1 - c.from] - t) * 1000 / (audio.playbackRate || 1) + 15);
}

function playFrom(ai) {
  if (typeof Recite !== 'undefined') Recite.cancel();
  stopAudio(false);
  P.run++;
  P.gen = sequence(ai);
  P.ai = S.play = ai;
  const page = R.ayas[ai][2];
  if (page !== S.page) goTo(page, { animate: Math.abs(page - S.page) === 1 });
  paintMarks();
  showPlayer();
  playChunk(0, 1500);
}

// next/previous aya: inside the loaded file just move the play position
function jump(ai) {
  const c = P.chunk;
  if (ai < 0 || ai >= R.ayas.length) return;
  for (let k = c ? c.from : 0; c && k < c.to; k++) {
    if (P.list[k].ai === ai) { audio.currentTime = c.starts[k - c.from]; sync(); if (audio.paused) audio.play(); return; }
  }
  playFrom(ai);
}

audio.addEventListener('ended', () => {
  const c = P.chunk;
  if (c && item(c.to)) playChunk(c.to);
  else stopAudio();
});
audio.addEventListener('timeupdate', sync);
audio.addEventListener('seeked', sync);
audio.addEventListener('play', () => { $('#player').classList.remove('paused'); sync(); });
audio.addEventListener('pause', () => { $('#player').classList.add('paused'); clearTimeout(P.tick); });
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

function stopAudio(close = true) {
  P.run++;
  clearTimeout(P.tick);
  audio.pause();
  const old = audio.src;
  audio.removeAttribute('src');
  if (old.startsWith('blob:')) URL.revokeObjectURL(old);
  Object.assign(P, { list: [], gen: null, got: [], at: -1, chunk: null });
  if (!close) return;
  P.ai = null; S.play = null;
  hide($('#player'));
  paintMarks();
}

$('#plToggle').onclick = () => (audio.paused ? audio.play() : audio.pause());
$('#plStop').onclick = () => stopAudio();
$('#plNext').onclick = () => P.ai != null && jump(P.ai + 1);
$('#plPrev').onclick = () => P.ai != null && jump(P.ai - 1);
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => $('#plNext').onclick());
  navigator.mediaSession.setActionHandler('previoustrack', () => $('#plPrev').onclick());
}

// ---------------------------------------------------------------- tafsir
// Tafsir As-Sa'di, one file per surah (keyed by Hafs numbering). Where
// as-Sa'di comments on several ayat together, the later ones point back to
// the aya holding the shared text.

const TAFSIR_CACHE = 'tafsir-saadi';
const tafsirFiles = {};
const loadTafsir = s => (tafsirFiles[s] ||= loadJSON(`data/tafsir/${s}.json`).catch(e => { delete tafsirFiles[s]; throw e; }));

function tafsirHTML(t) {
  return t.split(/\n+/).filter(x => x.trim()).map(par =>
    '<p>' + esc(par).replace(/\{\s*([^{}]+?)\s*\}/g, '<span class="q">﴿$1﴾</span>') + '</p>').join('');
}

let tfAya = null;
async function openTafsir(ai) {
  tfAya = ai;
  S.act = ai; S.focus = ai; paintMarks();
  const a = R.ayas[ai];
  const [s, n] = META.hafs[a[5]];
  $('#tfTitle').textContent = ayaLabel(ai);
  const body = $('#tfBody');
  body.innerHTML = '<div class="tf-wait">…</div>';
  hide($('#ayaBar'));
  if (P.ai != null) hide($('#player'));
  show($('#tafsir'));
  if (R.ayas[ai][2] !== S.page) goTo(R.ayas[ai][2], { animate: Math.abs(R.ayas[ai][2] - S.page) === 1 });
  try {
    const list = await loadTafsir(s);
    if (tfAya !== ai) return;
    // all the Hafs ayat this aya covers (usually one)
    let html = '', lastText = null;
    for (let h = a[5]; h <= a[6]; h++) {
      const [hs, hn] = META.hafs[h];
      const file = hs === s ? list : await loadTafsir(hs);
      let e = file[hn - 1], from = hn;
      if (typeof e === 'number') { from = e; e = file[e - 1]; }
      if (!e || e === lastText) continue;
      lastText = e;
      let to = from;
      while (typeof file[to] === 'number' && file[to] === from) to++;
      const label = to > from ? `تفسير الآيات ${ar(from)}–${ar(to)}` : '';
      html += (label ? `<div class="tf-group">${label}</div>` : '') + tafsirHTML(e);
    }
    body.innerHTML = html || '<div class="tf-wait">لا يوجد تفسير لهذه الآية</div>';
    body.scrollTop = 0;
  } catch {
    if (tfAya === ai) body.innerHTML = '<div class="tf-wait">تعذّر تحميل التفسير — تحقق من الاتصال أو حمّله من الإعدادات</div>';
  }
}

function closeTafsir() {
  tfAya = null;
  hide($('#tafsir'));
  S.act = null; S.focus = null; paintMarks();
  if (P.ai != null) show($('#player'));
}

$('#tfClose').onclick = closeTafsir;
$('#tfNext').onclick = () => tfAya != null && tfAya + 1 < R.ayas.length && openTafsir(tfAya + 1);
$('#tfPrev').onclick = () => tfAya != null && tfAya > 0 && openTafsir(tfAya - 1);

async function tafsirStatus() {
  if (!('caches' in window)) return 0;
  const c = await caches.open(TAFSIR_CACHE);
  return new Set((await c.keys()).map(r => new URL(r.url).pathname.match(/tafsir\/(\d+)\.json/)?.[1]).filter(Boolean)).size;
}

const TF = { running: false, done: 0, stop: false };
async function downloadTafsir() {
  if (TF.running) return;
  TF.running = true; TF.stop = false; paintTafsirCard();
  let next = 1, failed = 0;
  const c = await caches.open(TAFSIR_CACHE);
  const worker = async () => {
    while (next <= 114 && !TF.stop) {
      const s = next++;
      const url = new URL(`data/tafsir/${s}.json`, location.href).href;
      if (await c.match(url)) continue;
      try { const r = await fetch(url); if (r.ok) await c.put(url, r); else failed++; } catch { failed++; }
      TF.done = await tafsirStatus(); paintTafsirCard();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  TF.running = false;
  TF.done = await tafsirStatus(); paintTafsirCard();
  if (!ALL.running) toast(failed ? 'تعذّر تحميل بعض السور — حاول مجددًا' : 'اكتمل تحميل التفسير');
}

function tafsirCardHTML() {
  return `<div class="group dl-card" id="tfCard">
    <div class="dl-top">
      ${ico('tafsir', 'marks')}
      <div class="dl-txt"><div class="t">تفسير السعدي</div><div class="s" id="tfText"></div></div>
      <div class="dl-pct" id="tfPct"></div>
    </div>
    <div class="prog dl-prog"><i id="tfBar" style="width:0"></i></div>
    <div class="dl-actions" id="tfActions"></div>
  </div>`;
}

function paintTafsirCard() {
  if (!$('#tfCard')) return;
  const pct = TF.done / 114;
  $('#tfBar').style.width = (pct * 100).toFixed(1) + '%';
  $('#tfPct').textContent = ar(Math.floor(pct * 100)) + '٪';
  const complete = TF.done >= 114;
  $('#tfText').textContent = complete ? 'التفسير كاملًا محفوظ على جهازك ✓'
    : `${ar(TF.done)} من ١١٤ سورة · قرابة ٦ م.ب${TF.running ? ' · جارٍ التحميل…' : ''}`;
  $('#tfActions').innerHTML = complete || TF.running ? '' : `<button data-dl="tafsir" class="primary">${TF.done ? 'متابعة التحميل' : 'تحميل التفسير كاملًا'}</button>`;
  paintAllCard();
}

// ---------------------------------------------------------------- offline mushaf
// All 604 page fonts (Hafs) plus the text and font of every riwaya, and the
// adhkar, so the whole mushaf opens with no connection. Fonts go in the SW's
// font cache, data in its own.
const MUSHAF_CACHE = 'mushaf-data', FONT_CACHE = 'qcf-v2-fonts';
const LOCAL_FONTS = ['hafs', 'shouba', 'warsh', 'qaloon', 'doori', 'soosi', 'bazzi', 'qumbul', 'qbsml', 'amiri', 'amiri-bold'];
const MQ = { running: false, done: 0, total: 0, failed: 0, stop: false };
const mushafTasks = () => [
  { cache: MUSHAF_CACHE, url: new URL(`data/meta.json?v=${DATA_VERSION}`, location.href).href },
  ...META.riwayat.map(r => ({ cache: MUSHAF_CACHE, url: new URL(`data/${r.id}.json?v=${DATA_VERSION}`, location.href).href })),
  { cache: MUSHAF_CACHE, url: Adhkar.url() },
  ...LOCAL_FONTS.map(f => ({ cache: MUSHAF_CACHE, url: new URL(`fonts/${f}.woff2`, location.href).href })),
  ...Array.from({ length: 604 }, (_, i) => ({ cache: FONT_CACHE, url: `${QCF_BASE}p${i + 1}.woff2` })),
];
async function mushafStatus() {
  if (!('caches' in window)) return { done: 0, total: 1 };
  const tasks = mushafTasks();
  const have = {};
  for (const name of [MUSHAF_CACHE, FONT_CACHE]) have[name] = new Set((await (await caches.open(name)).keys()).map(r => r.url));
  return { done: tasks.filter(t => have[t.cache].has(t.url)).length, total: tasks.length };
}

function mushafCardHTML() {
  return `<div class="group dl-card" id="mqCard">
    <div class="dl-top">
      ${ico('tafsir', 'marks')}
      <div class="dl-txt"><div class="t">المصحف كاملًا دون اتصال</div><div class="s" id="mqText"></div></div>
      <div class="dl-pct" id="mqPct"></div>
    </div>
    <div class="prog dl-prog"><i id="mqBar" style="width:0"></i></div>
    <div class="dl-actions" id="mqActions"></div>
  </div>`;
}

function paintMushafCard() {
  if (!$('#mqCard')) return;
  const pct = MQ.total ? MQ.done / MQ.total : 0;
  $('#mqBar').style.width = (pct * 100).toFixed(1) + '%';
  $('#mqPct').textContent = ar(Math.floor(pct * 100)) + '٪';
  const complete = MQ.total > 0 && MQ.done >= MQ.total;
  $('#mqText').textContent = complete ? 'خطوط الصفحات ونصوص الروايات محفوظة على جهازك ✓'
    : `خطوط الصفحات ونصوص الروايات · قرابة ١١٠ م.ب${MQ.running ? ' · جارٍ التحميل…' : ''}${MQ.failed ? ` · تعذّر ${ar(MQ.failed)}` : ''}`;
  $('#mqActions').innerHTML = complete || ALL.running ? '' : MQ.running
    ? '<button data-dl="mushaf-pause">إيقاف مؤقت</button>'
    : `<button data-dl="mushaf" class="primary">${MQ.done ? 'متابعة التحميل' : 'تحميل المصحف دون اتصال'}</button>`;
  paintAllCard();
}

async function refreshMushafCard() {
  if (!$('#mqCard')) return;
  if (!MQ.running) Object.assign(MQ, await mushafStatus());
  paintMushafCard();
}

async function downloadMushaf() {
  if (MQ.running) return;
  MQ.running = true; MQ.stop = false; MQ.failed = 0;
  const tasks = mushafTasks();
  const caches_ = { [MUSHAF_CACHE]: await caches.open(MUSHAF_CACHE), [FONT_CACHE]: await caches.open(FONT_CACHE) };
  Object.assign(MQ, await mushafStatus());
  paintMushafCard();
  let next = 0;
  const worker = async () => {
    while (!MQ.stop && next < tasks.length) {
      const t = tasks[next++], c = caches_[t.cache];
      if (await c.match(t.url)) continue;
      try { const r = await fetch(t.url); if (r.ok) { await c.put(t.url, r); MQ.done++; } else MQ.failed++; } catch { MQ.failed++; }
      paintMushafCard();
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  MQ.running = false;
  Object.assign(MQ, await mushafStatus());
  paintMushafCard();
  if (!MQ.stop && !ALL.running) toast(MQ.failed ? 'تعذّر تحميل بعض الملفات — حاول مجددًا' : 'اكتمل تحميل المصحف');
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

const ICO = {
  theme: '<path d="M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM12 3.5v17"/><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" stroke="none"/>',
  book: '<path d="M5 4.5h3.5v15H5zM10.5 4.5H14v15h-3.5zM15.6 5.6l3.3-.9 3.4 14.2-3.3.9z"/>',
  audio: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3"/>',
  tafsir: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/>',
  next: '<path d="M14.5 6l-6 6 6 6"/>',
};
const ico = (name, c) => `<span class="ico" style="--c:var(--c-${c})"><svg viewBox="0 0 24 24">${ICO[name]}</svg></span>`;

function settingsHTML() {
  const cur = store.get('theme', 'light');
  const riwayaName = id => META.riwayat.find(r => r.id === id)?.name || id;
  const themes = THEMES.map(([id, label]) =>
    `<button class="theme${cur === id ? ' on' : ''}" data-theme-set="${id}"><i class="th th-${id}"><b>أ</b></i><span>${label}</span></button>`).join('');
  const riwayat = META.riwayat.map((r, k) => {
    const letter = r.name.replace(/^ال/, '')[0];
    return `<button class="row" data-riwaya="${r.id}"><span class="num">${letter}</span>
      <span class="main"><span class="t">${r.name}</span><span class="s">${ar(r.ayas)} آية</span></span>${r.id === R.id ? '<span class="check">✓</span>' : ''}</button>`;
  }).join('');
  return `
    ${typeof Install !== 'undefined' ? Install.settingsHTML() : ''}
    ${allCardHTML()}
    <div class="group-label">المظهر</div>
    <div class="themes">${themes}</div>

    <div class="group-label">الختمة</div>
    <div class="group"><button class="row" data-open-lib><span class="mini-cover">${coverHTML(K, true)}</span>
      <span class="main"><span class="t">ختماتي</span><span class="s">${esc(K.name)} · صفحة ${ar(K.page)}${KH.length > 1 ? ` · ${ar(KH.length)} ختمات` : ''}</span></span>
      <svg viewBox="0 0 24 24" class="go">${ICO.next}</svg></button></div>

    <div class="group-label">الرواية</div>
    <div class="group">${riwayat}</div>
    <p class="note">لكل رواية رسمها وعلامات ضبطها ووقفها. التلاوة بصوت الشيخ ياسر الدوسري برواية حفص، وتُطابَق آيات الروايات الأخرى مع ما يقابلها فيها.</p>

    <div class="group-label">دون اتصال</div>
    ${mushafCardHTML()}
    ${audioPanelHTML()}`;
}

function audioPanelHTML() {
  return `<div class="group dl-card" id="dlCard">
    <div class="dl-top">
      ${ico('audio', 'settings')}
      <div class="dl-txt"><div class="t">التلاوة · الشيخ ياسر الدوسري</div><div class="s" id="dlText">جارٍ الفحص…</div></div>
      <div class="dl-pct" id="dlPct"></div>
    </div>
    <div class="prog dl-prog"><i id="dlBar" style="width:0"></i></div>
    <div class="dl-actions" id="dlActions"></div>
  </div>
  ${tafsirCardHTML()}
  <p class="note">يُحفظ صوت كل آية (قرابة ١٫٥ غيغابايت) والتفسير على جهازك لتستعملهما دون إنترنت. أبقِ التطبيق مفتوحًا أثناء التحميل، ويمكنك الإيقاف والمتابعة لاحقًا. الآيات التي تستمع إليها تُحفظ تلقائيًا.</p>`;
}

async function refreshAudioPanel() {
  if (!$('#dlCard')) return;
  if (!TF.running) TF.done = await tafsirStatus();
  paintTafsirCard();
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
    ? `التلاوة كاملة محفوظة على جهازك ✓`
    : `${ar(DL.done)} من ${ar(DL.total)} آية · ${ar(mb)} من ${ar(AUDIO_TOTAL_MB)} م.ب${DL.running ? ' · جارٍ التحميل…' : ''}${DL.failed ? ` · تعذّر ${ar(DL.failed)}` : ''}`;
  $('#dlActions').innerHTML = (complete || ALL.running ? '' : DL.running
    ? '<button data-dl="pause">إيقاف مؤقت</button>'
    : `<button data-dl="start" class="primary">${DL.done ? 'متابعة التحميل' : 'تحميل التلاوة كاملة'}</button>`)
    + (DL.done && !DL.running && !ALL.running ? '<button data-dl="clear" class="danger">حذف التحميلات</button>' : '');
  paintAllCard();
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
  if (ALL.running) return;
  if (finished && !DL.failed) toast('اكتمل تحميل التلاوة');
  else if (finished) toast('تعذّر تحميل بعض الآيات — اضغط متابعة');
}

// ---------------------------------------------------------------- everything offline
// One button for the mushaf, tafsir, adhkar and (optionally) the recitation,
// one after the other, with a single progress bar weighted by size.

const ALL = { running: false, audio: true, stop: false, stage: '' };
const SIZE_MB = { mushaf: 112, tafsir: 6, audio: AUDIO_TOTAL_MB };

function allProgress(audio) {
  const parts = [[SIZE_MB.mushaf, MQ.total ? MQ.done / MQ.total : 0], [SIZE_MB.tafsir, TF.done / 114]];
  if (audio) parts.push([SIZE_MB.audio, DL.total ? DL.done / DL.total : 0]);
  return parts.reduce((s, [w, f]) => s + w * Math.min(1, f), 0) / parts.reduce((s, [w]) => s + w, 0);
}

function allCardHTML() {
  return `<div class="all-card" id="allCard">
    <svg viewBox="0 0 24 24" class="all-ico"><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 15.5v2.5a2.5 2.5 0 002.5 2.5h10a2.5 2.5 0 002.5-2.5v-2.5"/></svg>
    <div class="all-t" id="allT"></div>
    <div class="all-s" id="allS"></div>
    <div class="all-prog" id="allProg" hidden><i id="allBar"></i></div>
    <div class="all-actions" id="allActions"></div>
  </div>`;
}

function paintAllCard() {
  if (!$('#allCard')) return;
  const textDone = MQ.total > 0 && MQ.done >= MQ.total && TF.done >= 114;
  const audioDone = DL.total > 0 && DL.done >= DL.total;
  const card = $('#allCard');
  card.classList.toggle('done', textDone && audioDone);
  $('#allProg').hidden = !ALL.running;
  if (ALL.running) {
    const pct = allProgress(ALL.audio);
    $('#allBar').style.width = (pct * 100).toFixed(1) + '%';
    $('#allT').textContent = `جارٍ التحميل… ${ar(Math.floor(pct * 100))}٪`;
    $('#allS').textContent = `${ALL.stage} · أبقِ التطبيق مفتوحًا حتى يكتمل`;
    $('#allActions').innerHTML = '<button data-dl="all-pause" class="all-btn ghost">إيقاف مؤقت</button>';
  } else if (textDone && audioDone) {
    $('#allT').textContent = 'التطبيق كاملًا محفوظ على جهازك ✓';
    $('#allS').textContent = 'المصحف بكل رواياته، والتفسير، والأذكار، والتلاوة تعمل دون إنترنت';
    $('#allActions').innerHTML = '';
  } else if (textDone) {
    $('#allT').textContent = 'المصحف والتفسير والأذكار محفوظة ✓';
    $('#allS').textContent = `بقيت التلاوة · قرابة ${DL.done ? ar(Math.round((1 - DL.done / DL.total) * AUDIO_TOTAL_MB)) + ' م.ب' : '١٫٥ غيغابايت'}`;
    $('#allActions').innerHTML = '<button data-dl="all" class="all-btn">تحميل التلاوة أيضًا</button>';
  } else {
    const started = store.get('dlAll', false);
    $('#allT').textContent = 'استعمل التطبيق كاملًا دون إنترنت';
    $('#allS').textContent = 'المصحف بكل رواياته وخطوطه، والتفسير، والأذكار، والتلاوة كاملة';
    $('#allActions').innerHTML = `<button data-dl="all" class="all-btn">${started ? 'متابعة تحميل الكل' : 'تحميل الكل'} <small>قرابة ١٫٦ غيغابايت</small></button>
      <button data-dl="all-text" class="all-link">أو دون التلاوة · قرابة ١٢٠ م.ب</button>`;
  }
}

async function downloadAll(audio) {
  if (ALL.running) return;
  Object.assign(ALL, { running: true, audio, stop: false, stage: 'المصحف والأذكار' });
  store.set('dlAll', true);
  paintAllCard();
  try { await navigator.storage?.persist?.(); } catch {}
  await downloadMushaf();
  if (!ALL.stop) { ALL.stage = 'تفسير السعدي'; paintAllCard(); await downloadTafsir(); }
  if (!ALL.stop && audio) { ALL.stage = 'التلاوة'; paintAllCard(); await startAudioDownload(); }
  ALL.running = false;
  await refreshAudioPanel();
  await refreshMushafCard();
  paintAllCard();
  if (ALL.stop) return;
  const failed = MQ.failed || DL.failed || TF.done < 114;
  toast(failed ? 'تعذّر تحميل بعض الملفات — اضغط متابعة' : audio ? 'اكتمل التحميل — التطبيق كله يعمل دون اتصال' : 'اكتمل تحميل المصحف والتفسير والأذكار');
}

function pauseAll() {
  ALL.stop = true;
  MQ.stop = true; TF.stop = true; DL.running = false;
  paintAllCard();
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

// ---- theme: auto follows the phone, or pick light / sepia / dark
const THEMES = [['auto', 'تلقائي'], ['light', 'فاتح'], ['sepia', 'ورقي'], ['dark', 'داكن']];
const THEME_BAR = { light: '#faf6f3', sepia: '#f1e7d0', dark: '#15130f' };
function applyTheme() {
  const t = store.get('theme', 'light');
  const d = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  document.documentElement.dataset.theme = d;
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = THEME_BAR[d] || THEME_BAR.light;
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', d === 'dark' ? 'dark' : 'light');
  document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.setAttribute('content', d === 'dark' ? 'black-translucent' : 'default');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

let tab = 'suras';
function openRecite() { openSheet('recite'); }
function openSheet(t = tab) {
  tab = t;
  $('#sheetTitle').textContent = 'اللوحات';
  $('#sheetSub').textContent = `${K.name} · ${META.riwayat.find(r => r.id === R.id)?.name || ''} · صفحة ${ar(S.page)}`;
  closeActions();
  show($('#sheet'));
  $('#q').value = '';
  renderSheet();
}
function closeSheet() { hide($('#sheet')); $('#q').blur(); }
$('#sheetClose').onclick = closeSheet;
$('#setBtn').onclick = () => {
  tab = tab === 'settings' ? 'suras' : 'settings';
  $('#q').value = '';
  renderSheet();
  $('#sheetBody').scrollTop = 0;
};
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  $('#q').value = '';
  renderSheet();
  $('#sheetBody').scrollTop = 0;
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
  const here = s === R.ayas[pageInfo(S.page).first][0] ? ' here' : '';
  return `<button class="row${extra}${here}" data-go-sura="${s}">
    <span class="num">${ar(s)}</span>
    <span class="main"><span class="t">${nameAr}</span><span class="s"><em class="pl ${place === 'makkah' ? 'mk' : 'md'}">${place === 'makkah' ? 'مكية' : 'مدنية'}</em>${ar(count)} آية · <span class="en">${en}</span></span></span>
    <span class="meta">${ar(pageOfSura(s))}</span>
  </button>`;
}

// the khatma shelf, first thing in the bookmarks tab
function khatmaRowHTML() {
  return `<div class="group kh-entry"><button class="row" data-open-lib><span class="mini-cover">${coverHTML(K, true)}</span>
    <span class="main"><span class="t">ختماتي</span><span class="s">${esc(K.name)} · صفحة ${ar(K.page)}${KH.length > 1 ? ` · ${ar(KH.length)} ختمات` : ''}</span></span>
    <svg viewBox="0 0 24 24" class="go">${ICO.next}</svg></button></div>`;
}

function renderSheet() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#sheetBody');
  const q = $('#q').value;
  $('#tabs').hidden = !!q.trim();
  $('#setBtn').classList.toggle('on', tab === 'settings');
  $('.search').hidden = tab === 'prayer' || tab === 'settings' || tab === 'recite';
  $('#q').placeholder = tab === 'adhkar' ? 'ابحث في الأذكار… (مثال: الكرب، السفر)' : 'ابحث عن سورة أو آية… (مثال: البقرة ٢٥٥)';
  let html = '';

  if (q.trim() && tab === 'adhkar') {
    html = Adhkar.searchHTML(q);
  } else if (q.trim()) {
    const res = search(q);
    if (!res.length) html = '<div class="empty"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><b>لا توجد نتائج</b>جرّب كلمات أخرى أو اسم السورة.</div>';
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
  } else if (tab === 'adhkar') {
    html = '<div id="adhkarList"></div>';
  } else if (tab === 'recite') {
    html = Recite.panelHTML();
  } else if (tab === 'marks') {
    const list = bookmarks();
    html = khatmaRowHTML();
    if (!list.length) html += '<div class="empty"><svg viewBox="0 0 24 24"><path d="M6.5 4.5h11v15.5l-5.5-3.8-5.5 3.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg><b>لا توجد علامات بعد</b>اضغط رقم آية ثم «علامة» لحفظها هنا.</div>';
    else {
      html += '<div class="group">' + list.map((b, k) => {
        const name = META.riwayat.find(r => r.id === b.r)?.name || b.r;
        const d = cache[b.r];
        const a = d && b.aya != null ? d.ayas[b.aya] : null;
        const page = a ? a[2] : b.page;
        const dt = new Date(b.t);
        const date = ar(`${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`);
        return `<button class="row" data-go-mark="${k}"><span class="num">${a ? ar(a[1]) : '•'}</span>
          <span class="main"><span class="t">${a ? `${suraName(a[0])} · الآية ${ar(a[1])}` : 'الصفحة ' + ar(page ?? '')}</span><span class="s">صفحة ${ar(page ?? '')} · ${name} · ${date}</span></span>
          <span class="del" data-del-mark="${k}" aria-label="حذف"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>`;
      }).join('') + '</div>';
    }
  } else if (tab === 'prayer') {
    html = '<div id="prayer"></div>';
  } else if (tab === 'settings') {
    html = settingsHTML();
  }
  body.innerHTML = html;
  if (!q.trim()) {
    // open the surah list at the surah being read
    const here = body.querySelector('.row.here');
    if (here) here.scrollIntoView({ block: 'center' }); else if (tab !== 'adhkar') body.scrollTop = 0;
  }
  if (tab === 'settings' && !q.trim()) { refreshAudioPanel(); refreshMushafCard(); }
  if (tab === 'prayer' && !q.trim()) Prayer.mount();
  if (tab === 'recite' && !q.trim()) Recite.mounted();
  if (tab === 'adhkar' && !q.trim()) Adhkar.mount($('#adhkarList'));
}

$('#sheetBody').addEventListener('change', e => {
  const sel = e.target.closest('[data-pr]');
  if (sel) Prayer.onChange(sel);
});
$('#sheetBody').addEventListener('click', async e => {
  const th = e.target.closest('[data-theme-set]');
  if (th) { store.set('theme', th.dataset.themeSet); applyTheme(); renderSheet(); return; }
  if (e.target.closest('[data-open-lib]')) { openLibrary(); return; }
  const compass = e.target.closest('[data-pr-compass]');
  if (compass) { Prayer.startCompass(compass); return; }
  const dk = e.target.closest('[data-dk]');
  if (dk) { $('#q').blur(); Adhkar.open(dk.dataset.dk, dk.dataset.dkI != null ? +dk.dataset.dkI : undefined); return; }
  if (typeof Recite !== 'undefined' && Recite.onSheetClick(e)) return;
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
    else if (a === 'tafsir') downloadTafsir();
    else if (a === 'mushaf') downloadMushaf();
    else if (a === 'mushaf-pause') MQ.stop = true;
    else if (a === 'all') downloadAll(true);
    else if (a === 'all-text') downloadAll(false);
    else if (a === 'all-pause') pauseAll();
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
  if (typeof Recite !== 'undefined') Recite.cancel();
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
        <div class="book-meta"><span>صفحة ${ar(k.page)}</span><span>${ar(pct)}٪</span></div>
        ${k.done ? `<div class="book-done">✓ ${k.done === 1 ? 'ختمة مكتملة' : `${ar(k.done)} ختمات مكتملة`}</div>` : ''}
      </div>
    </div>`;
  }).join('') + `<div class="book" style="--i:${sorted.length}"><button class="book-open" data-new="1"><div class="cover new"><span>+</span><small>ختمة جديدة</small></div></button></div>`;
}

// the library goes back to the panel it was opened from
let libFrom = 'marks';
function openLibrary() {
  libFrom = tab === 'settings' ? 'settings' : 'marks';
  $('#libClose').textContent = libFrom === 'settings' ? '‹ الإعدادات' : '‹ العلامات';
  closeSheet();
  closeActions();
  renderShelf();
  show($('#library'));
}

$('#libClose').onclick = () => { hide($('#library')); openSheet(libFrom); };

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
  $('#khWarn').hidden = true;
  $('#khDelete').disabled = KH.length < 2;
  updatePreview();
  show($('#khEdit'));
}
function updatePreview() {
  const f = $('#khForm');
  $('#khPreview').innerHTML = coverHTML({ name: f.name.value || '—', cover: +f.cover.value }, true);
}
$('#khForm').addEventListener('input', () => {
  updatePreview();
  $('#khWarn').hidden = !(editing && $('#khForm').riwaya.value !== editing.riwaya);
});
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
    Recite.restore(); // a session cut off by a reload
  } catch (err) {
    $('#loading').textContent = 'تعذر التحميل — تحقق من الاتصال';
    console.error(err);
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // reload once when an updated service worker takes over, so updates show up;
    // on the first visit too, as its headers are what let recitation use several cores.
    // Never in the middle of something: at once if the app wasn't touched yet, or
    // else as it leaves the screen or comes back to it, with no recitation going.
    // An app brought back from the background looks for an update then too (phones
    // keep it open for days)
    const hadController = !!navigator.serviceWorker.controller;
    const busy = () => document.body.classList.contains('rc-on') || document.body.classList.contains('rc-find');
    let stale = false, touched = false;
    addEventListener('pointerdown', () => { touched = true; }, { capture: true, once: true });
    const reloadIfIdle = () => { if (stale && !busy()) location.reload(); };
    document.addEventListener('visibilitychange', () => {
      reloadIfIdle();
      if (!document.hidden) navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {});
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController && self.crossOriginIsolated) return;
      stale = true;
      if (!touched || document.hidden) reloadIfIdle();
      else if (!busy()) toast('تحديث جديد — يُطبَّق حين تعود إلى التطبيق');
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
})();
