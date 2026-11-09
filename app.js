'use strict';

// bump when data/ or fonts/ change so phones fetch the new files
const DATA_VERSION = 6;
// Each riwaya is heard from a reciter who recites it. Hafs: Yasser Al-Dosari,
// one file per aya (everyayah.com). The others: one file per surah
// (mp3quran.net) and when each aya starts in it, data/audio/<riwaya>.json
// (tools/recitations.py; bump AUDIO_DATA_VERSION when those files change).
const AUDIO_BASE = 'https://everyayah.com/data/Yasser_Ad-Dussary_128kbps/';
const AUDIO_DATA_VERSION = 1;
const RECITERS = {
  hafs: 'ياسر الدوسري',
  shouba: 'علي بن عبد الرحمن الحذيفي',
  warsh: 'عمر القزابري',
  qaloon: 'محمود خليل الحصري',
  doori: 'محمود خليل الحصري',
  soosi: 'عبد الرشيد صوفي',
  bazzi: 'عكاشة كميني',
  qumbul: 'أحمد ديبان',
};
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
// the mic in the middle: read an aya and it is found, and the recitation goes on from it (the first
// time, what it does is said first)
// (held: put away, a small arrow left in its place, which brings it back; remembered. Away too while
// the panels are open)
const micAway = on => { document.body.classList.toggle('mic-away', on); store.set('mic.away', on); };
micAway(!!store.get('mic.away', false));
let micHold = 0, micHeld = false;
$('#dockMic').addEventListener('pointerdown', () => {
  micHeld = false; $('#dockMic').classList.add('holding');
  micHold = setTimeout(() => { micHeld = true; $('#dockMic').classList.remove('holding'); haptic(15); micAway(true); toast('أُخفي زر البحث بالصوت — المس السهم لإظهاره'); }, 550);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('#dockMic').addEventListener(ev, () => { clearTimeout(micHold); $('#dockMic').classList.remove('holding'); });
$('#dockMic').addEventListener('contextmenu', e => e.preventDefault());
$('#dockArrow').onclick = () => { haptic(8); micAway(false); };
new MutationObserver(() => document.body.classList.toggle('sheet-up', !$('#sheet').hidden && !$('#sheet').classList.contains('leaving')))
  .observe($('#sheet'), { attributes: true, attributeFilter: ['hidden', 'class'] });
$('#dockMic').onclick = () => {
  if (micHeld) { micHeld = false; return; }
  if (typeof Recite === 'undefined') return;
  haptic(8);
  if (store.get('mic.told', false) || Recite.active()) return Recite.mic();
  show($('#micIntro'));
};
$('#miGo').onclick = () => { store.set('mic.told', true); hide($('#micIntro')); Recite.mic(); };
$('#miLater').onclick = () => { store.set('mic.told', true); hide($('#micIntro')); };
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
  return { id: Date.now().toString(36), name, riwaya, cover, page: 1, mark: null, bookmarks: [], done: 0, created: Date.now(), read: Date.now(), pages: '' };
}

// the pages read in this round of a khatma: k.pages, a '1' for each page read ('' : none).
// A page is read once it has been on screen READ_MS with the app in front; jumping
// past pages doesn't read them, so the khatma is done only when every page was read.
const READ_MS = 10000;
const pagesRead = k => (k.pages || '').split('').filter(c => c === '1').length;
const khatmaTotal = k => k === K && R ? R.pages.length : k.total || 604; // (k.total: its riwaya's pages, kept when open)
function khatmaPct(k) {
  const n = pagesRead(k), t = khatmaTotal(k);
  return n >= t ? 100 : Math.min(99, Math.floor(n / t * 100));
}
// the same share of the mushaf read, on a riwaya with another number of pages
function remapPages(k, total) {
  const old = k.pages || '';
  if (!old || old.length === total) return;
  let out = '';
  for (let p = 0; p < total; p++) {
    const a = Math.floor(p / total * old.length), b = Math.max(a + 1, Math.floor((p + 1) / total * old.length));
    out += old.slice(a, b).includes('0') || old.slice(a, b) === '' ? '0' : '1';
  }
  k.pages = out;
}
let readT = null;
function startReading() {
  clearTimeout(readT);
  if (!K || !R || document.hidden) return;
  const k = K, p = S.page;
  if (k.total !== R.pages.length) { k.total = R.pages.length; saveKh(); }
  readT = setTimeout(() => markRead(k, p), READ_MS);
}
function markRead(k, p) {
  if (k !== K || p !== S.page || document.hidden) return;
  const total = R.pages.length;
  let m = (k.pages || '').padEnd(total, '0').slice(0, total);
  if (m[p - 1] === '1') return;
  k.pages = m = m.slice(0, p - 1) + '1' + m.slice(p);
  if (!m.includes('0') && !k.endShown) {
    // the whole mushaf read: counted now, whatever is chosen on the screen that says so
    k.done = (k.done || 0) + 1;
    k.endShown = true;
    saveKh();
    setTimeout(showDone, 400);
    return;
  }
  saveKh();
}
document.addEventListener('visibilitychange', () => document.hidden ? clearTimeout(readT) : startReading());

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
  // before pages were counted as read: the pages up to the place reached, and the
  // end reached by going there no longer finishes it
  for (const k of KH) if (k.pages == null) {
    k.pages = k.page > 1 && k.page < 604 ? '1'.repeat(k.page - 1) : '';
    k.endShown = false;
  }
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
    <div class="side"><span class="juz">الجزء ${ar(fa[3])}</span><button class="bm-btn${marked ? ' on' : ''}" data-act="bm" aria-label="علامة">${icon(marked ? 'bmOn' : 'bm')}</button></div>
  </header>${ORNAMENT}<div class="lines" style="font-family:${R.glyph ? `qcf-p${p}` : R.font}">`;

  const n = opening ? lines.reduce((m, l, i) => (l ? i + 1 : m), 0) : 15;
  for (let i = 0; i < n; i++) {
    const ln = lines[i];
    if (!ln || pending) { html += '<div class="ln"></div>'; continue; }
    if (ln[0] === 'H') {
      html += `<div class="ln sura"><div class="band" data-sura="${ln[1]}" role="button" aria-label="سورة ${suraName(ln[1])}"><i class="orn"></i><span class="sname">${SURA_GLYPH(ln[1])}</span><i class="orn"></i></div></div>`;
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
const BARS = ['#ayaBar', '#wordBar', '#suraBar', '#player', '#recBar', '#recWord'];
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
  BARS.forEach(sel => { const b = $(sel); if (b.hidden) delete b.dataset.pin; });
  for (const b of bars) {
    const lifted = parseFloat(b.style.getPropertyValue('--lift')) || 0;
    const top = b.offsetTop, h = b.offsetHeight, up = head + 8; // where it rests (not mid-slide)
    // put where the reader tapped it to (flipBar), while it stays open
    if (b.dataset.pin) { b.style.setProperty('--lift', (b.dataset.pin === 'up' ? up - top : 0) + 'px'); continue; }
    if (!box) { if (lifted) b.style.setProperty('--lift', '0px'); continue; }
    const over = t => Math.max(0, Math.min(t + h, box.bottom + 6) - Math.max(t, box.top - 6));
    const down = over(top), high = over(up);
    b.style.setProperty('--lift', (down === 0 || down <= high ? 0 : up - top) + 'px');
  }
}

// a tap on a bar, away from its buttons, sends it to the other end of the screen and back
function flipBar(e) {
  const b = e.currentTarget;
  if (e.target.closest('button, a, input, select, label, summary, [data-act], [data-wb], [data-rc-word], [role=button]')) return;
  b.dataset.pin = (parseFloat(b.style.getPropertyValue('--lift')) || 0) < 0 ? 'down' : 'up';
  keepClear();
}
BARS.filter(sel => sel !== '#player' && sel !== '#recBar').forEach(sel => $(sel).addEventListener('click', flipBar));

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
  startReading();
}

function goTo(p, { animate = false, from = 0 } = {}) {
  p = Math.max(1, Math.min(R.pages.length, p));
  if (p === S.page) return;
  const step = p - S.page;
  S.page = p;
  K.page = p; K.read = Date.now(); saveKh();
  startReading();
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

// popup cards: a tap outside the card, or the card pulled down by its top (the grip line),
// closes it as its own close button does; never while that button is hidden or disabled
// (the model downloading, say). The install card has its own outside tap (install.js).
(() => {
  const CLOSE = { khEdit: '#khCancel', done: '#doneLater', recIntro: '#riLater', micIntro: '#miLater', recPrep: '#rpCancel', recDone: '#rdOk', install: '#inLater' };
  const closer = m => { const b = $(CLOSE[m.id]); return b && !b.hidden && !b.disabled && b.offsetParent !== null ? b : null; };
  for (const id of Object.keys(CLOSE)) {
    const m = $('#' + id), card = m?.querySelector('.card');
    if (!card) continue;
    if (id !== 'install') m.addEventListener('click', e => { if (e.target === m) closer(m)?.click(); });
    let y0 = null, t0 = 0, dy = 0;
    const start = (y, e) => {
      // the grip: the card's top, while it is scrolled to its top
      if (y - card.getBoundingClientRect().top > 44 || card.scrollTop > 0 || !closer(m) || e.target.closest('button, input, select, textarea')) return;
      y0 = y; t0 = performance.now(); dy = 0;
      card.style.transition = 'none';
    };
    const move = (y, e) => {
      if (y0 == null) return;
      dy = Math.max(0, y - y0);
      card.style.transform = `translateY(${dy}px)`;
      if (dy > 4 && e.cancelable) e.preventDefault(); // the card follows the finger, the page doesn't scroll
    };
    const end = () => {
      if (y0 == null) return;
      y0 = null;
      const v = dy / Math.max(1, performance.now() - t0), b = closer(m);
      card.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1)';
      if (b && (dy > 90 || (dy > 24 && v > 0.5))) {
        b.click();
        setTimeout(() => { card.style.transform = ''; card.style.transition = ''; }, 320);
      } else { card.style.transform = ''; setTimeout(() => { card.style.transition = ''; }, 260); }
    };
    card.addEventListener('touchstart', e => start(e.touches[0].clientY, e), { passive: true });
    card.addEventListener('touchmove', e => move(e.touches[0].clientY, e), { passive: false });
    card.addEventListener('touchend', end);
    card.addEventListener('touchcancel', end);
    card.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') start(e.clientY, e); });
    addEventListener('pointermove', e => { if (e.pointerType === 'mouse') move(e.clientY, e); });
    addEventListener('pointerup', e => { if (e.pointerType === 'mouse') end(); });
  }
})();

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
    // a surah's band: its card (not while reciting)
    const band = e.target.closest('.band[data-sura]');
    if (band && !Recite.active()) { ripple(band); openSura(+band.dataset.sura); return; }
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

// a surah's card: how much of it was recited and how it went, and to recite it
let suraAt = null; // { s, from }
function openSura(su) {
  closeActions();
  WordCard.close();
  const c = Recite.suraCard(su);
  suraAt = { s: su, from: c.from };
  $('#sbTitle').textContent = `سورة ${suraName(su)}`;
  const n = (R.suraStart[su + 1] ?? R.ayas.length) - R.suraStart[su];
  $('#sbSub').textContent = n === 1 ? 'آية' : n === 2 ? 'آيتان' : n <= 10 ? `${ar(n)} آيات` : `${ar(n)} آية`;
  $('#sbBody').innerHTML = c.html;
  $('#suraBar [data-sb=go]').hidden = c.from == null;
  if (c.from != null) $('#sbGo').textContent = `تابع من ${ar(R.ayas[c.from][1])}`;
  if (P.ai == null) hide($('#player'));
  const bar = $('#suraBar');
  if (!bar.hidden && !bar.classList.contains('leaving')) { bar.classList.remove('swap'); void bar.offsetWidth; bar.classList.add('swap'); }
  show(bar);
  haptic(8);
}
function closeSura() {
  if (suraAt == null) return;
  suraAt = null;
  hide($('#suraBar'));
  if (P.ai != null) show($('#player'));
}
$('#suraBar').addEventListener('click', e => {
  if (!suraAt) return;
  const { s: su, from } = suraAt;
  const aya = e.target.closest('[data-sb-aya]');
  if (aya) { const ai = +aya.dataset.sbAya; closeSura(); goTo(R.ayas[ai][2]); setTimeout(() => openActions(ai), 350); return; }
  const b = e.target.closest('[data-sb]');
  if (!b) return;
  const a = b.dataset.sb;
  closeSura();
  if (a === 'start') Recite.start(R.suraStart[su]);
  if (a === 'go') Recite.start(from);
  if (a === 'play') playFrom(R.suraStart[su]);
});

// an update waiting (a new service worker took over): applied by loading the page again,
// never in the middle of something, and with a screen saying so. resume: what to do once
// loaded again (recite.js: the session that was about to start)
const UPD = {
  stale: false,
  busy: () => document.body.classList.contains('rc-on') || document.body.classList.contains('rc-find') || (typeof Mu !== 'undefined' && Mu.listening()),
};
function applyUpdate(resume) {
  keepUI();
  store.set('rec.alive', null); // (a reload of ours, not the phone closing the page: recite.js)
  if (resume) store.set('upd.resume', { t: Date.now(), ...resume });
  $('#loading').textContent = 'جارٍ تحديث التطبيق إلى نسخته الجديدة…';
  $('#loading').hidden = false;
  setTimeout(() => location.reload(), 700);
}

// an update ready, offered over the page blurred: a tap anywhere applies it, «لاحقًا» puts it
// off until the app is opened again (or a recitation is about to start: recite.js applies it)
let updLater = false;
function offerUpdate() {
  if (!UPD.stale || UPD.busy() || updLater || !$('#updReady').hidden) return;
  // not over a recitation's screens (its preparation, the place found, its summary)
  if (['#recPrep', '#recFound', '#recDone'].some(q => $(q) && !$(q).hidden)) return;
  $('#upVer').textContent = '';
  fetch('sw.js', { cache: 'no-store' }).then(r => r.text()).then(t => {
    const v = /quran-v(\d+)/.exec(t)?.[1];
    if (v) $('#upVer').textContent = `النسخة ${ar(v)}`;
  }).catch(() => {});
  show($('#updReady'));
}
$('#updReady').addEventListener('click', e => {
  if (e.target.closest('#upLater')) { updLater = true; hide($('#updReady')); return; }
  hide($('#updReady'));
  if (!UPD.busy()) applyUpdate({});
});
// a recitation going on when it came: offered once it is over
setInterval(() => { if (UPD.stale && !updLater && !document.hidden) offerUpdate(); }, 3000);

// what was open when the app went to the background (a panel and its tab, an aya's
// actions, its tafsir): put back if the page is loaded again soon after (an update,
// or a phone that closed it in the background to free memory)
const UI_KEY = 'ui.last', UI_MS = 30 * 60e3;
function keepUI() {
  if (!R) return;
  store.set(UI_KEY, { t: Date.now(), r: R.id, page: S.page,
    sheet: $('#sheet').hidden ? null : tab, act: !$('#ayaBar').hidden ? S.act : null,
    tafsir: !$('#tafsir').hidden ? tfAya : null });
}
function restoreUI() {
  const u = store.get(UI_KEY, null);
  store.set(UI_KEY, null);
  if (!u || Date.now() - u.t > UI_MS || u.r !== R.id || u.page !== S.page) return;
  if (u.tafsir != null && R.ayas[u.tafsir]) openTafsir(u.tafsir);
  else if (u.act != null && R.ayas[u.act]) openActions(u.act);
  if (u.sheet) openSheet(u.sheet);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) keepUI(); });
addEventListener('pagehide', keepUI);

function openActions(i) {
  closeSura();
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
  similarOf(i).then(l => { if (S.act !== i) return; const n = l?.n || 0, b = $('#abSim'); b.hidden = !n; b.textContent = ar(n); $('#ayaBar [data-act=similar]').classList.toggle('dim', !n); });
  if (P.ai == null) hide($('#player'));
  const bar = $('#ayaBar');
  if (String(i) !== bar.dataset.for) { delete bar.dataset.pin; bar.dataset.for = i; } // a new aya: placed clear of it again
  if (!bar.hidden && !bar.classList.contains('leaving')) { bar.classList.remove('swap'); void bar.offsetWidth; bar.classList.add('swap'); }
  show(bar);
}

function closeActions() {
  if (!$('#tafsir').hidden) return closeTafsir();
  closeSura();
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
  // a word got wrong, in the aya's card: its own card instead
  if (wd) { const [ai, wi] = wd.dataset.rcWord.split(':').map(Number); Recite.showWord(ai, wi, el => WordCard.open(el)); return; }
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
  if (b.dataset.act === 'tafsir') openTafsir(i, 'tafsir');
  if (b.dataset.act === 'similar') openTafsir(i, 'similar');
  if (b.dataset.act === 'close') closeActions();
  if (b.dataset.act === 'rc-set') openReciteSettings();
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
// run: playback session (stale async work checks it); rec: the riwaya's
// recitation (null: Hafs, aya by aya); list: files or parts of files in order
// from the start aya; got[k]: list[k]'s frames once read; at: index playing;
// chunk: the joined file now loaded { from, to, starts: start time of each }
const P = { run: 0, ai: null, rec: null, list: [], gen: null, got: [], at: -1, chunk: null, tick: 0 };

// the recitation of a riwaya other than Hafs: { url, size, t } (null for Hafs)
const recs = {};
const loadRec = id => id === 'hafs' ? Promise.resolve(null)
  : (recs[id] ||= loadJSON(`data/audio/${id}.json?v=${AUDIO_DATA_VERSION}`).catch(e => { delete recs[id]; throw e; }));
const surahUrl = (rec, s) => `${rec.url}${pad3(s)}.mp3`;

// what is played from aya `ai` on. Hafs: the aya files (a riwaya aya may
// cover part of a hafs aya or several of them; a hafs aya is never played
// twice). Other riwayat: each aya's stretch of its surah's file, and what is
// recited before a surah's first aya (isti'adha, basmala, takbir) when one is
// begun. intro: where the reciter pauses anyway
function* sequence(ai) {
  const rec = P.rec;
  if (rec) {
    for (; ai < R.ayas.length; ai++) {
      const [s, n] = R.ayas[ai], t = rec.t[s - 1], url = surahUrl(rec, s);
      if (n === 1 && t[0] > 300) yield { url, ai, from: 0, to: t[0], intro: true };
      yield { url, ai, from: t[n - 1], to: t[n] };
    }
    return;
  }
  let last = R.ayas[ai][5] - 1;
  for (; ai < R.ayas.length; ai++) {
    const a = R.ayas[ai];
    for (let h = Math.max(a[5], last + 1); h <= a[6]; h++) {
      const [s, n] = META.hafs[h];
      if (n === 1 && s !== 1 && s !== 9) yield { url: BASMALA_URL, ai, intro: true };
      yield { url: hafsUrl(h), ai };
      last = h;
    }
  }
}
function item(k) {
  while (P.list.length <= k) { const x = P.gen.next(); if (x.done) return null; P.list.push(x.value); }
  return P.list[k];
}

// MPEG audio frame header at b[i] (Layer III; MPEG-1, 2 or 2.5): its length,
// samples, and fmt (version, rate, channels: frames of another fmt cannot
// follow in the same joined file)
const MP3_KBPS = [[0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]];
const MP3_HZ = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3Header(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const v = (b[i + 1] >> 3) & 3;
  if (v === 1 || ((b[i + 1] >> 1) & 3) !== 1) return null;
  const kbps = MP3_KBPS[v === 3 ? 0 : 1][b[i + 2] >> 4], hz = MP3_HZ[v][(b[i + 2] >> 2) & 3];
  if (!kbps || !hz) return null;
  const k = v === 3 ? 144000 : 72000;
  return { len: Math.floor(k * kbps / hz) + ((b[i + 2] >> 1) & 1), L: k * kbps / hz, hz, samples: v === 3 ? 1152 : 576, fmt: `${v}.${hz}.${(b[i + 3] >> 6) === 3 ? 1 : 2}` };
}
const isTagFrame = (b, i) => /Xing|Info/.test(String.fromCharCode(...b.subarray(i + 4, i + 44)));
const frameSet = (parts, x) => ({ parts, bytes: parts.reduce((s, p) => s + p.length, 0), dur: x ? parts.length * x.samples / x.hz : 0, fmt: x?.fmt });

// MPEG audio frames of a file without its ID3 tags or Xing/Info header, which
// would stop a decoder mid-stream; duration counted from the frames
function mp3Frames(buf) {
  const b = new Uint8Array(buf);
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) i = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127));
  while (i + 1 < b.length && !mp3Header(b, i)) i++; // to the first frame
  const parts = [];
  let x, h, first = true;
  while ((h = mp3Header(b, i)) && i + h.len <= b.length) {
    if (!(first && isTagFrame(b, i))) { parts.push(b.subarray(i, i + h.len)); x = h; }
    first = false;
    i += h.len;
  }
  return frameSet(parts, x);
}

// bytes a-b of a file (an HTTP range; the service worker answers it from a
// saved copy)
async function getRange(url, a, b) {
  const r = await fetch(url, { mode: 'cors', headers: { Range: `bytes=${a}-${b}` } });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  if (r.status === 206) return new Uint8Array(await r.arrayBuffer());
  // the whole file came back: keep just the part asked for, and stop there
  const rd = r.body.getReader(), out = new Uint8Array(b - a + 1);
  let pos = 0, got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    const s = Math.max(a - pos, 0), e = Math.min(value.length, b + 1 - pos);
    if (e > s) { out.set(value.subarray(s, e), pos + s - a); got = pos + e - a; }
    pos += value.length;
    if (pos > b) { rd.cancel(); break; }
  }
  return out.subarray(0, got);
}

// A surah file is constant bitrate: frame n starts n * L bytes after the
// first audio frame and n * fd seconds into the recitation, so an aya is read
// with a range of the file, frame-exact. Consecutive ayat take frames by the
// same rule, so none is lost or heard twice between them.
const heads = {}; // surah file -> { start, L, fd, max }
function surahHead(url) {
  return (heads[url] ||= (async () => {
    let at = 0, b = await getRange(url, 0, 16383);
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
      at = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127)) + (b[5] & 0x10 ? 10 : 0);
      b = at + 8192 > b.length ? await getRange(url, at, at + 16383) : b.subarray(at);
    }
    let i = 0, h;
    while (i < b.length && !((h = mp3Header(b, i)) && mp3Header(b, i + h.len))) i++;
    if (!h || i >= b.length) throw new Error(url + ' mp3');
    return { start: at + i + (isTagFrame(b, i) ? h.len : 0), L: h.L, fd: h.samples / h.hz, max: h.len + 1 };
  })().catch(e => { delete heads[url]; throw e; }));
}
async function surahPart(it) {
  const h = await surahHead(it.url);
  const n0 = Math.round(it.from / 1000 / h.fd), n1 = Math.round(it.to / 1000 / h.fd);
  const off = h.start + Math.max(0, Math.floor(n0 * h.L) - h.max);
  const b = n1 > n0 ? await getRange(it.url, off, h.start + Math.ceil(n1 * h.L) + h.max) : new Uint8Array(0);
  const parts = [];
  let x;
  for (let i = 0, synced = false; i + 4 <= b.length;) {
    const f = mp3Header(b, i);
    // the range starts mid-frame: find a header followed by another
    if (!f || (!synced && i + f.len + 4 <= b.length && !mp3Header(b, i + f.len))) { if (synced) break; i++; continue; }
    if (i + f.len > b.length) break;
    synced = true;
    const n = Math.round((off + i - h.start) / h.L);
    if (n >= n1) break;
    if (n >= n0) { parts.push(b.subarray(i, i + f.len)); x = f; }
    i += f.len;
  }
  return frameSet(parts, x);
}

function fetchItem(k, tries = 3) {
  const run = P.run, it = item(k);
  if (!it || P.got[k]) return P.got[k]?.p;
  const g = P.got[k] = { v: undefined };
  g.p = (async () => {
    for (let t = 0; t < tries && run === P.run; t++) {
      try {
        if (it.from != null) return (g.v = await surahPart(it));
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
  let t = 0, bytes = 0, to = from, fmt = first.fmt;
  // frames of another sample rate or channel count (a surah recorded apart)
  // begin a joined file of their own
  const same = v => !v.fmt || !fmt || v.fmt === fmt;
  while (item(to) && P.got[to]?.v && (to === from || (bytes + P.got[to].v.bytes < CHUNK_MB * 1e6 && same(P.got[to].v)))) {
    starts.push(t);
    t += P.got[to].v.dur; bytes += P.got[to].v.bytes; fmt ||= P.got[to].v.fmt;
    to++;
  }
  // the hand-over to the next joined file may not be quite seamless on every
  // phone: when one is coming, make it just before a surah's opening, where
  // the reciter pauses anyway (if that leaves over two minutes)
  if (item(to) && !(P.got[to]?.v && !same(P.got[to].v))) {
    for (let j = to - 1; j > from; j--) {
      if (P.list[j].intro && starts[j - from] > 120) { to = j; t = starts[j - from]; starts.length = j - from; break; }
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

async function playFrom(ai) {
  if (typeof Recite !== 'undefined') Recite.cancel();
  stopAudio(false);
  const run = ++P.run;
  P.ai = S.play = ai;
  const page = R.ayas[ai][2];
  if (page !== S.page) goTo(page, { animate: Math.abs(page - S.page) === 1 });
  paintMarks();
  showPlayer();
  try { P.rec = await loadRec(R.id); } catch { if (run === P.run) { toast('تعذر تحميل الصوت'); stopAudio(); } return; }
  if (run !== P.run) return;
  P.gen = sequence(ai);
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
  $('#plReciter').textContent = `الشيخ ${RECITERS[R.id]}`;
  show($('#player'));
  if (S.act == null) hide($('#ayaBar'));
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `سورة ${ayaLabel(P.ai)}`, artist: RECITERS[R.id], album: `القرآن الكريم · ${META.riwayat.find(r => r.id === R.id)?.name || ''}`,
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
// ---- similar ayas (mutashabihat): per Hafs aya, those worded much like it (data/similar-hafs.json,
// from tools: closeness %, the longest run of words they share), for a memorizer to tell apart
let simData = null;
function similarOf(ai) {
  simData ||= fetch(`data/similar-hafs.json?v=${DATA_VERSION}`).then(r => r.json()).catch(() => { simData = null; return {}; });
  return simData.then(d => {
    const raw = d[R.ayas[ai]?.[5]] || [], more = raw.find(x => x[0] < 0);
    const list = raw.filter(x => x[0] >= 0).map(([h, close, run]) => ({ ai: R.fromHafs[h], close, run })).filter(x => x.ai >= 0 && x.ai !== ai);
    return { list, n: more ? more[1] : list.length };
  });
}
// an aya's words, as compared (no harakat or marks; one form of alif, ya, ta marbuta, hamza)
const simNorm = w => w.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '').replace(/[ٱأإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
const ayaWords = ai => R.text[ai].replace(/\s*[٠-٩]+$/, '').split(' ');
// the words of b not in its longest common run with a (in order): what tells b from a
function differ(a, b) {
  const A = a.map(simNorm), B = b.map(simNorm), n = A.length, m = B.length;
  const f = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) f[i][j] = A[i] === B[j] ? f[i + 1][j + 1] + 1 : Math.max(f[i + 1][j], f[i][j + 1]);
  const same = new Set();
  for (let i = 0, j = 0; i < n && j < m;) { if (A[i] === B[j]) { same.add(j); i++; j++; } else if (f[i + 1][j] >= f[i][j + 1]) i++; else j++; }
  return b.map((w, j) => same.has(j) ? esc(w) : `<mark>${esc(w)}</mark>`).join(' ');
}
async function similarHTML(ai) {
  const { list, n } = await similarOf(ai);
  if (!list.length) return '<div class="tf-wait">لا آيات تشبه هذه الآية في ألفاظها</div>';
  const me = ayaWords(ai), kind = x => x.close >= 85 ? 'شبه متطابقة' : x.close >= 60 ? 'متقاربة جدًا' : x.close >= 50 ? 'متقاربة' : `تشتركان في ${ar(x.run)} كلمات متتالية`;
  return `<p class="sm-note">آيات تتشابه ألفاظها بهذه الآية، يلتبس بعضها ببعض في الحفظ. المُبرَز ما تختلف فيه، فانتبه له.</p>
    <div class="sm-me"><small>هذه الآية · ${ayaLabel(ai)}</small><p style="font-family:${R.font}">${differ(ayaWords(list[0].ai), me)}</p></div>
    ${list.map(x => `<button class="sm-it" data-sim="${x.ai}"><span class="sm-h"><b>${ayaLabel(x.ai)}</b><small>ص ${ar(R.ayas[x.ai][2])}</small><span class="sm-tag${x.close >= 85 ? ' hi' : ''}">${kind(x)}</span></span>
      <p style="font-family:${R.font}">${differ(me, ayaWords(x.ai))}</p></button>`).join('')}
    ${n > list.length ? `<p class="sm-more">وآيات أخرى تشبهها (${ar(n)} في المجموع)، أقربها ما سبق</p>` : ''}`;
}
let tfMode = 'tafsir';
$('#tfSeg').onclick = e => { const b = e.target.closest('[data-tf]'); if (b && tfAya != null) openTafsir(tfAya, b.dataset.tf); };
$('#tfBody').addEventListener('click', e => { const b = e.target.closest('[data-sim]'); if (b) openTafsir(+b.dataset.sim, 'similar'); });

async function openTafsir(ai, mode = tfMode) {
  tfMode = mode;
  document.querySelectorAll('#tfSeg [data-tf]').forEach(b => b.classList.toggle('on', b.dataset.tf === mode));
  $('#tfSub').textContent = mode === 'similar' ? 'الآيات المتشابهة' : 'تفسير السعدي';
  similarOf(ai).then(l => { if (tfAya !== ai) return; const k = $('#tfSimN'); k.hidden = !l.n; k.textContent = ar(l.n); });
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
  if (mode === 'similar') {
    const html = await similarHTML(ai);
    if (tfAya === ai && tfMode === 'similar') { body.innerHTML = html; body.scrollTop = 0; }
    return;
  }
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
  // when each aya starts in the recitations (the audio itself is saved apart)
  ...META.riwayat.filter(r => r.id !== 'hafs').map(r => ({ cache: MUSHAF_CACHE, url: new URL(`data/audio/${r.id}.json?v=${AUDIO_DATA_VERSION}`, location.href).href })),
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
// Each riwaya's recitation can be saved on the device, only when asked: from
// the recitation card (the riwaya being read) or the button beside each riwaya
// in the settings. Hafs aya by aya (≈1.5 GB for all 6236 ayat; also part of
// «تحميل الكل»), the others surah by surah (their sizes are in data/audio/).
// The service worker answers playback from these caches, ranges included.

const AUDIO_CACHE = 'audio-yasser-128', RIWAYA_AUDIO_CACHE = 'audio-riwayat';
const AUDIO_TOTAL_MB = 1500;
// what of each recitation is on the device: rid -> { total, done (files), mb,
// doneMB }; the one downloading is updated as it goes
const AS = {};
// the download running (one at a time): its riwaya and failures
const DL = { running: false, rid: null, failed: 0, wake: null };
const allAudioUrls = () => META.hafs.map((_, h) => hafsUrl(h));

// the files of a riwaya's recitation, with their sizes in MB (Hafs: by count)
async function audioFiles(rid) {
  if (rid === 'hafs') {
    const urls = allAudioUrls();
    return { cache: AUDIO_CACHE, urls, mb: urls.map(() => AUDIO_TOTAL_MB / urls.length) };
  }
  const rec = await loadRec(rid);
  return { cache: RIWAYA_AUDIO_CACHE, urls: rec.size.map((_, i) => surahUrl(rec, i + 1)), mb: rec.size.map(b => b / 1e6) };
}
const sumMB = a => a.reduce((s, x) => s + x, 0);
const gbText = mb => mb >= 1000 ? `${ar((mb / 1000).toFixed(1)).replace('.', '٫')} غيغابايت` : `${ar(Math.round(mb))} م.ب`;

async function audioCachedSet(name = AUDIO_CACHE) {
  if (!('caches' in window)) return new Set();
  const c = await caches.open(name);
  return new Set((await c.keys()).map(r => r.url));
}

async function audioStatus(rid, sets = {}) {
  const f = await audioFiles(rid), set = await (sets[f.cache] ||= audioCachedSet(f.cache));
  const have = f.urls.map(u => set.has(u));
  return { total: f.urls.length, done: have.filter(Boolean).length, mb: sumMB(f.mb), doneMB: sumMB(f.mb.filter((_, i) => have[i])) };
}
// every riwaya's (the one downloading keeps its live count)
async function refreshAudioStatus() {
  const sets = {};
  await Promise.all(META.riwayat.map(async r => {
    if (DL.running && DL.rid === r.id) return;
    try { AS[r.id] = await audioStatus(r.id, sets); } catch {}
  }));
}
const audioDone = st => st?.total > 0 && st.done >= st.total;

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
      <span class="main"><span class="t">${r.name}</span><span class="s">${ar(r.ayas)} آية · بصوت ${RECITERS[r.id]}</span></span>${r.id === R.id ? '<span class="check">✓</span>' : ''}
      <span class="rw-dl" data-dl="rw" data-rid="${r.id}" role="button" hidden></span></button>`;
  }).join('');
  return `
    ${typeof Install !== 'undefined' ? Install.settingsHTML() : ''}
    <div class="group-label">المظهر</div>
    <div class="themes">${themes}</div>

    ${'wakeLock' in navigator ? `<div class="group-label">القراءة</div>
    <div class="group">${switchRow('awake', 'إبقاء الشاشة مضاءة', 'لا تنطفئ الشاشة وأنت تقرأ أو تسمّع، والتطبيق مفتوح')}</div>` : ''}

    <div class="group-label">الختمة</div>
    <div class="group"><button class="row" data-open-lib><span class="mini-cover">${coverHTML(K, true)}</span>
      <span class="main"><span class="t">ختماتي</span><span class="s">${esc(K.name)} · ${ar(khatmaPct(K))}٪ · صفحة ${ar(K.page)}${KH.length > 1 ? ` · ${ar(KH.length)} ختمات` : ''}</span></span>
      <svg viewBox="0 0 24 24" class="go">${ICO.next}</svg></button></div>

    <div class="group-label">دون اتصال</div>
    ${allCardHTML()}
    ${mushafCardHTML()}
    ${audioPanelHTML()}

    <div class="group-label">بياناتك</div>
    <div class="group">
      <button class="row" data-backup="save"><span class="main"><span class="t">حفظ نسخة احتياطية</span><span class="s">العلامات والختمات وتقدّم التسميع والأذكار، في ملف واحد</span></span><svg viewBox="0 0 24 24" class="go">${ICO.next}</svg></button>
      <button class="row" data-backup="load"><span class="main"><span class="t">استعادة من نسخة</span><span class="s">من ملف حفظته من قبل، على هذا الجهاز أو غيره</span></span><svg viewBox="0 0 24 24" class="go">${ICO.next}</svg></button>
    </div>
    <p class="note">بيانات التطبيق محفوظة على جهازك وحده، وقد يمسحها المتصفح إن قلّت مساحته أو طال تركه. احفظ نسخة بين حين وآخر.</p>

    <div class="group-label">التطبيق</div>
    <div class="group">
      <div class="row"><span class="main"><span class="t">النسخة</span><span class="s" id="appVer">…</span></span><button class="rc-not" data-app-update>تحقق من التحديث</button></div>
      <div class="row"><span class="main"><span class="t">المساحة المستعملة</span><span class="s" id="appStore">…</span></span></div>
    </div>

    <div class="group-label">الرواية</div>
    <div class="group">${riwayat}</div>
    <p class="note">لكل رواية رسمها وعلامات ضبطها ووقفها، وتلاوتها بصوت قارئ يقرأ بها: حفص آيةً آية من everyayah.com، والروايات الأخرى سورةً سورة من mp3quran.net مع مواضع آياتها.</p>`;
}

// a setting that is on or off
function switchRow(id, label, sub) {
  const on = !!store.get(id, false);
  return `<button class="row rc-set" data-switch="${id}" role="switch" aria-checked="${on}">
    <span class="main"><span class="t">${label}</span><span class="s">${sub}</span></span><span class="tog${on ? ' on' : ''}"><i></i></span></button>`;
}

// the screen kept on while the app is open, if asked for
let awakeLock = null;
async function syncAwake() {
  const want = !!store.get('awake', false) && !document.hidden;
  if (want && !awakeLock && navigator.wakeLock) {
    try { awakeLock = await navigator.wakeLock.request('screen'); awakeLock.addEventListener('release', () => { awakeLock = null; }); } catch {}
  } else if (!want && awakeLock) { awakeLock.release().catch(() => {}); awakeLock = null; }
}
document.addEventListener('visibilitychange', syncAwake);
syncAwake();

// the app's version, and the room its downloads take
function refreshAppInfo() {
  if (!$('#appVer')) return;
  caches.keys().then(k => {
    const v = k.map(x => x.match(/^quran-v(\d+)$/)?.[1]).filter(Boolean).sort((a, b) => b - a)[0];
    if ($('#appVer')) $('#appVer').textContent = v ? `الإصدار ${ar(v)}${UPD.stale ? ' · نسخة جديدة جاهزة' : ''}` : '—';
  }).catch(() => {});
  navigator.storage?.estimate?.().then(e => {
    const mb = Math.round((e.usage || 0) / 1048576);
    if ($('#appStore')) $('#appStore').textContent = mb >= 1024 ? `${ar((mb / 1024).toFixed(1))} غيغابايت` : `${ar(mb)} م.ب`;
  }).catch(() => { if ($('#appStore')) $('#appStore').textContent = '—'; });
}
async function checkUpdate(b) {
  b.disabled = true; b.textContent = 'نبحث…';
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch {}
  await new Promise(r => setTimeout(r, 2500));
  if (UPD.stale && !UPD.busy()) return applyUpdate({});
  b.disabled = false; b.textContent = 'تحقق من التحديث';
  toast('التطبيق على أحدث نسخة');
}

// everything the app keeps (its 'q.' keys), to a file and back
async function saveBackup() {
  const data = {};
  for (let k = 0; k < localStorage.length; k++) {
    const key = localStorage.key(k);
    if (key.startsWith('q.') && !key.startsWith('q.upd.') && !key.startsWith('q.ui.')) data[key] = localStorage.getItem(key);
  }
  const d = new Date(), name = `quran-backup-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}.json`;
  const file = new File([JSON.stringify({ app: 'quran', v: 1, t: Date.now(), data })], name, { type: 'application/json' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'نسخة احتياطية' }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function loadBackup() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    try {
      const j = JSON.parse(await inp.files[0].text());
      if (j?.app !== 'quran' || !j.data) throw 0;
      for (const [k, v] of Object.entries(j.data)) if (k.startsWith('q.') && typeof v === 'string') localStorage.setItem(k, v);
      store.set('rec.alive', null);
      $('#loading').textContent = 'استُعيدت بياناتك…';
      $('#loading').hidden = false;
      setTimeout(() => location.reload(), 600);
    } catch { toast('هذا الملف ليس نسخة احتياطية من التطبيق'); }
  };
  inp.click();
}

function audioPanelHTML() {
  return `<div class="group dl-card" id="dlCard">
    <div class="dl-top">
      ${ico('audio', 'settings')}
      <div class="dl-txt"><div class="t" id="dlTitle">التلاوة · ${RECITERS[R.id]}</div><div class="s" id="dlText">جارٍ الفحص…</div></div>
      <div class="dl-pct" id="dlPct"></div>
    </div>
    <div class="prog dl-prog"><i id="dlBar" style="width:0"></i></div>
    <div class="dl-actions" id="dlActions"></div>
  </div>
  ${tafsirCardHTML()}
  <p class="note" id="dlNote"></p>`;
}

async function refreshAudioPanel() {
  if (!$('#dlCard')) return;
  if (!TF.running) TF.done = await tafsirStatus();
  paintTafsirCard();
  await refreshAudioStatus();
  paintAudioPanel();
}

// the card shows the riwaya being read (or the one downloading)
function paintAudioPanel() {
  paintRiwayaDl();
  if (!$('#dlCard')) return;
  const rid = DL.running ? DL.rid : R.id, st = AS[rid] || { total: 0, done: 0, mb: 0, doneMB: 0 }, hafs = rid === 'hafs';
  const running = DL.running && DL.rid === rid;
  const pct = st.mb ? Math.min(1, st.doneMB / st.mb) : 0;
  $('#dlBar').style.width = (pct * 100).toFixed(1) + '%';
  $('#dlPct').textContent = ar(Math.floor(pct * 100)) + '٪';
  $('#dlTitle').textContent = `التلاوة · ${RECITERS[rid]}`;
  const complete = audioDone(st);
  $('#dlText').textContent = complete
    ? `التلاوة كاملة محفوظة على جهازك ✓`
    : !st.total ? 'تعذّر الفحص — تحقق من الاتصال'
    : `${ar(st.done)} من ${ar(st.total)} ${hafs ? 'آية' : 'سورة'} · ${ar(Math.round(st.doneMB))} من ${ar(Math.round(st.mb))} م.ب${running ? ' · جارٍ التحميل…' : ''}${running && DL.failed ? ` · تعذّر ${ar(DL.failed)}` : ''}`;
  $('#dlActions').innerHTML = (complete || ALL.running || !st.total ? '' : running
    ? '<button data-dl="pause">إيقاف مؤقت</button>'
    : `<button data-dl="start" class="primary">${st.done ? 'متابعة التحميل' : 'تحميل التلاوة كاملة'}</button>`)
    + (st.done && !running && !ALL.running ? `<button data-dl="clear" data-rid="${rid}" class="danger">حذف التحميلات</button>` : '');
  $('#dlNote').textContent = (hafs
    ? `يُحفظ صوت كل آية (قرابة ${gbText(st.mb || AUDIO_TOTAL_MB)}) والتفسير على جهازك لتستعملهما دون إنترنت.`
    : `تُحفظ تلاوة ${RECITERS[rid]} سورةً سورة (قرابة ${gbText(st.mb)}) والتفسير على جهازك لتستعملهما دون إنترنت.`)
    + ' أبقِ التطبيق مفتوحًا أثناء التحميل، ويمكنك الإيقاف والمتابعة لاحقًا.'
    + (hafs ? ' الآيات التي تستمع إليها تُحفظ تلقائيًا.' : '')
    + ' تلاوة كل رواية اختيارية: تُحمَّل من زرّها بجانب الرواية في قائمة الرواية أدناه.';
  paintAllCard();
}

// the button beside each riwaya in the settings: its size and a download
// arrow; its progress (tap to pause) while downloading; a check once saved
// (tapped twice, deleted)
const DL_ICO = {
  get: '<svg viewBox="0 0 24 24"><path d="M12 4.5v10M7.8 10.6l4.2 4.2 4.2-4.2M5 19.5h14"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 7v10M15 7v10"/></svg>',
  done: '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>',
};
function paintRiwayaDl() {
  for (const el of document.querySelectorAll('[data-dl="rw"]')) {
    const rid = el.dataset.rid, st = AS[rid];
    const running = DL.running && DL.rid === rid;
    const pct = st?.mb ? Math.floor(Math.min(1, st.doneMB / st.mb) * 100) : 0;
    el.hidden = !st;
    if (!st || el.dataset.armed) continue;
    const state = running ? 'run' : audioDone(st) ? 'done' : st.done ? 'part' : 'none';
    el.className = `rw-dl ${state}`;
    el.style.setProperty('--p', pct + '%');
    el.setAttribute('aria-label', running ? 'إيقاف التحميل مؤقتًا' : state === 'done' ? 'التلاوة محفوظة — اضغط مرتين للحذف' : `تحميل التلاوة (${gbText(st.mb)})`);
    el.innerHTML = running ? `${DL_ICO.pause}<span>${ar(pct)}٪</span>`
      : state === 'done' ? `${DL_ICO.done}<span>محفوظة</span>`
      : `${DL_ICO.get}<span>${state === 'part' ? ar(pct) + '٪' : gbText(st.mb).replace(' غيغابايت', ' غ.ب')}</span>`;
  }
}
async function riwayaDlTap(el) {
  const rid = el.dataset.rid, st = AS[rid];
  if (!st) return;
  if (DL.running && DL.rid === rid) { DL.running = false; return; }
  if (audioDone(st)) {
    if (!el.dataset.armed) {
      el.dataset.armed = '1';
      el.className = 'rw-dl del';
      el.innerHTML = '<span>حذف؟</span>';
      setTimeout(() => { if (el.isConnected && el.dataset.armed) { delete el.dataset.armed; paintRiwayaDl(); } }, 2500);
      return;
    }
    delete el.dataset.armed;
    return clearRecitation(rid);
  }
  if (DL.running || ALL.running) { toast(`يجري تحميل ${DL.rid ? 'تلاوة ' + RECITERS[DL.rid] : 'آخر'} — أوقفه أولًا`); return; }
  startAudioDownload(rid);
}

// a riwaya's recitation, file by file; the progress of a surah file counts as
// it arrives
async function startAudioDownload(rid = R.id) {
  if (DL.running) return;
  Object.assign(DL, { running: true, rid, failed: 0 });
  paintAudioPanel();
  try { await navigator.storage?.persist?.(); } catch {}
  try { DL.wake = await navigator.wakeLock?.request('screen'); } catch {}
  let f;
  try { f = await audioFiles(rid); } catch { DL.running = false; paintAudioPanel(); if (!ALL.running) toast('تعذّر التحميل — تحقق من الاتصال'); return; }
  const cache = await caches.open(f.cache);
  const have = await audioCachedSet(f.cache);
  const todo = f.urls.map((u, i) => i).filter(i => !have.has(f.urls[i])); // 001001 doubles as the basmala
  const st = AS[rid] = { total: f.urls.length, done: f.urls.length - todo.length, mb: sumMB(f.mb), doneMB: sumMB(f.mb.filter((_, i) => have.has(f.urls[i]))) };
  let next = 0, lastPaint = 0;
  const paint = () => { if (performance.now() - lastPaint > 400) { lastPaint = performance.now(); paintAudioPanel(); } };
  const worker = async () => {
    while (DL.running && next < todo.length) {
      const i = todo[next++], u = f.urls[i];
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok && DL.running; attempt++) {
        let got = 0;
        try {
          const res = await fetch(u, { mode: 'cors' });
          if (!res.ok) throw 0;
          const body = res.body.pipeThrough(new TransformStream({
            transform(c, ctl) { got += c.length; st.doneMB += c.length / 1e6; paint(); ctl.enqueue(c); },
          }));
          await cache.put(u, new Response(body, { headers: res.headers }));
          ok = true;
        } catch { await new Promise(r => setTimeout(r, 800 * (attempt + 1))); }
        st.doneMB += ok ? f.mb[i] - got / 1e6 : -got / 1e6;
      }
      if (ok) st.done++;
      else if (DL.running) DL.failed++;
      paint();
    }
  };
  await Promise.all(Array.from({ length: rid === 'hafs' ? 6 : 3 }, worker));
  const finished = DL.running;
  DL.running = false;
  try { await DL.wake?.release(); } catch {}
  DL.wake = null;
  await refreshAudioPanel();
  paintAudioPanel();
  if (ALL.running) return;
  if (finished && !DL.failed) toast(`اكتمل تحميل تلاوة ${RECITERS[rid]}`);
  else if (finished) toast(`تعذّر تحميل بعض ${rid === 'hafs' ? 'الآيات' : 'السور'} — اضغط متابعة`);
}

// ---------------------------------------------------------------- everything offline
// One button for the mushaf, tafsir, adhkar and (optionally) the recitation of
// Hafs, one after the other, with a single progress bar weighted by size. The
// other riwayat's recitations are never part of it: each has its own button.

const ALL = { running: false, audio: true, stop: false, stage: '' };
const SIZE_MB = { mushaf: 112, tafsir: 6 };

function allProgress(audio) {
  const parts = [[SIZE_MB.mushaf, MQ.total ? MQ.done / MQ.total : 0], [SIZE_MB.tafsir, TF.done / 114]];
  const h = AS.hafs || { mb: AUDIO_TOTAL_MB, doneMB: 0 };
  if (audio) parts.push([h.mb, h.mb ? h.doneMB / h.mb : 0]);
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
  const h = AS.hafs || { mb: AUDIO_TOTAL_MB, doneMB: 0 }, hafsDone = audioDone(AS.hafs);
  const card = $('#allCard');
  card.classList.toggle('done', textDone && hafsDone);
  $('#allProg').hidden = !ALL.running;
  if (ALL.running) {
    const pct = allProgress(ALL.audio);
    $('#allBar').style.width = (pct * 100).toFixed(1) + '%';
    $('#allT').textContent = `جارٍ التحميل… ${ar(Math.floor(pct * 100))}٪`;
    $('#allS').textContent = `${ALL.stage} · أبقِ التطبيق مفتوحًا حتى يكتمل`;
    $('#allActions').innerHTML = '<button data-dl="all-pause" class="all-btn ghost">إيقاف مؤقت</button>';
  } else if (textDone && hafsDone) {
    $('#allT').textContent = 'التطبيق كاملًا محفوظ على جهازك ✓';
    $('#allS').textContent = 'المصحف بكل رواياته، والتفسير، والأذكار، وتلاوة حفص تعمل دون إنترنت';
    $('#allActions').innerHTML = '';
  } else if (textDone) {
    $('#allT').textContent = 'المصحف والتفسير والأذكار محفوظة ✓';
    $('#allS').textContent = `بقيت تلاوة حفص (${RECITERS.hafs}) · قرابة ${gbText(h.mb - h.doneMB)}`;
    $('#allActions').innerHTML = '<button data-dl="all" class="all-btn">تحميل تلاوة حفص أيضًا</button>';
  } else {
    const started = store.get('dlAll', false);
    $('#allT').textContent = 'استعمل التطبيق كاملًا دون إنترنت';
    $('#allS').textContent = 'المصحف بكل رواياته وخطوطه، والتفسير، والأذكار، وتلاوة حفص كاملة';
    $('#allActions').innerHTML = `<button data-dl="all" class="all-btn">${started ? 'متابعة تحميل الكل' : 'تحميل الكل'} <small>قرابة ${gbText(h.mb + SIZE_MB.mushaf + SIZE_MB.tafsir)}</small></button>
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
  if (!ALL.stop && audio && !DL.running) { ALL.stage = 'تلاوة حفص'; paintAllCard(); await startAudioDownload('hafs'); }
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
  await clearRecitation(btn.dataset.rid || R.id);
}

// one riwaya's saved recitation (the riwayat other than Hafs share a cache)
async function clearRecitation(rid) {
  if (rid === 'hafs') await caches.delete(AUDIO_CACHE);
  else {
    const f = await audioFiles(rid), c = await caches.open(f.cache);
    await Promise.all(f.urls.map(u => c.delete(u)));
  }
  delete AS[rid];
  await refreshAudioPanel();
  paintAudioPanel();
  toast(`حُذفت تلاوة ${RECITERS[rid]}`);
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
// the same panel, on its settings page
function openReciteSettings() { openSheet('recite', 'set'); }
function openSheet(t = tab, view = '') {
  tab = t;
  store.set('recite.view', view); // (التسميع's own pages: its main one, unless asked)
  railOpen(false);
  $('#sheetSub').textContent = `${K.name} · ${META.riwayat.find(r => r.id === R.id)?.name || ''} · صفحة ${ar(S.page)}`;
  closeActions();
  show($('#sheet'));
  Adhkar.load().then(() => { if ($('#q').value.trim() && !$('#sheet').hidden) renderSheet(); }).catch(() => {}); // so the search finds adhkar too
  $('#q').value = '';
  renderSheet();
}
function closeSheet() { hide($('#sheet')); $('#q').blur(); }
$('#sheetClose').onclick = closeSheet;
// the side rail of the panels: on a phone it comes over the panel from the button beside it, and
// goes once a panel is chosen (or the panel is touched); on a wide screen it stays
const wide = matchMedia('(min-width: 760px)');
function railOpen(on) {
  $('#sheet').classList.toggle('rail-open', !!on);
  $('#railBtn').classList.toggle('on', !!on);
}
$('#railBtn').onclick = () => { railOpen(!$('#sheet').classList.contains('rail-open')); haptic(6); };
$('#railVeil').onclick = () => railOpen(false);
const TAB_NAMES = { suras: 'السور', recite: 'التسميع', adhkar: 'الأذكار', marks: 'العلامات', prayer: 'الصلاة', settings: 'الإعدادات' };
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  $('#q').value = '';
  if (!wide.matches) railOpen(false);
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
    <span class="main"><span class="t">ختماتي</span><span class="s">${esc(K.name)} · ${ar(khatmaPct(K))}٪ · صفحة ${ar(K.page)}${KH.length > 1 ? ` · ${ar(KH.length)} ختمات` : ''}</span></span>
    <svg viewBox="0 0 24 24" class="go">${ICO.next}</svg></button></div>`;
}

// the 30 juz, a tap each, above the surahs; the one being read marked
function juzStarts() {
  const at = [];
  R.ayas.forEach(a => { if (a[3] && at[a[3]] == null) at[a[3]] = a[2]; });
  return at;
}
function juzStripHTML() {
  const at = juzStarts(), cur = R.ayas[pageInfo(S.page).first][3];
  let h = '';
  for (let j = 1; j <= 30; j++) if (at[j]) h += `<button class="jz${j === cur ? ' on' : ''}" data-go-juz="${at[j]}" aria-label="الجزء ${ar(j)}، صفحة ${ar(at[j])}">${ar(j)}</button>`;
  return `<nav class="juz-strip" aria-label="الأجزاء"><span class="jz-l">الجزء</span>${h}</nav>`;
}
// «الجزء ٣» / «جزء عم»
function juzHit(raw) {
  const q = toLatinDigits(raw.trim()).replace(/^ال/, '');
  const m = q.match(/^جزء\s*(\d+)$/) || q.match(/^juz\s*(\d+)$/i);
  const j = m ? +m[1] : /^جزء\s*(ال)?عم$/.test(q) ? 30 : /^جزء\s*(ال)?تبارك$/.test(q) ? 29 : 0;
  const p = j >= 1 && j <= 30 ? juzStarts()[j] : null;
  return p ? `<div class="group"><button class="row best" data-go-page="${p}"><span class="num">${ar(j)}</span><span class="main"><span class="t">الجزء ${ar(j)}</span><span class="s">يبدأ في صفحة ${ar(p)}</span></span><span class="tag">جزء</span></button></div>` : '';
}
// the app's own places, found by what people call them
const PLACES = [
  ['prayer', 'مواقيت الصلاة', 'الأوقات والتنبيه بالوقت القادم', 'صلاه صلوات مواقيت اوقات اذان فجر ظهر عصر مغرب عشاء'],
  ['prayer', 'اتجاه القبلة', 'البوصلة نحو الكعبة', 'قبله بوصله اتجاه كعبه'],
  ['recite', 'التسميع', 'سمّع من حفظك ونتابعك ونصحح', 'تسميع حفظ محفوظ مراجعه اختبار اخطاء تلاوه'],
  ['adhkar', 'الأذكار', 'الصباح والمساء والنوم وغيرها', 'اذكار ذكر ادعيه دعاء صباح مساء نوم'],
  ['marks', 'العلامات', 'الآيات التي علّمتها', 'علامات علامه محفوظات مفضله'],
  ['lib', 'ختماتي', 'ختماتك وتقدّمك في كل منها', 'ختمه ختمات مكتبه'],
  ['settings', 'الرواية', 'حفص، ورش، قالون، وغيرها', 'روايه روايات قراءه قراءات حفص شعبه ورش قالون دوري سوسي بزي قنبل'],
  ['settings', 'المظهر', 'فاتح، ورقي، داكن، أو تلقائي', 'مظهر داكن ليلي فاتح ورقي الوان لون'],
  ['settings', 'دون اتصال', 'تحميل المصحف والتلاوة والتفسير', 'تحميل تنزيل انترنت اتصال صوت تفسير تلاوه'],
  ['settings', 'إبقاء الشاشة مضاءة', 'لا تنطفئ وأنت تقرأ', 'شاشه اضاءه تنطفئ قفل سطوع'],
  ['settings', 'نسخة احتياطية', 'احفظ بياناتك في ملف أو استعدها', 'نسخه احتياطي استعاده حفظ بيانات نقل'],
  ['settings', 'التحديث', 'الإصدار، والتحقق من نسخة جديدة', 'تحديث اصدار نسخه جديده'],
  ['settings', 'الإعدادات', 'كل الإعدادات', 'اعدادات ضبط'],
];
function shortcuts(raw) {
  const n = x => x.replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  const ws = n(raw.trim()).split(/\s+/).map(w => w.replace(/^ال(?=..)/, '')).filter(w => w.length >= 2 && !/^\d+$/.test(w));
  if (!ws.length) return '';
  const hits = PLACES.filter(([, , , k]) => ws.every(w => k.split(' ').some(x => x.startsWith(w))));
  return hits.length ? '<div class="group">' + hits.slice(0, 3).map(([t, name, sub]) =>
    `<button class="row" ${t === 'lib' ? 'data-open-lib' : `data-go-tab="${t}"`}><span class="main"><span class="t">${name}</span><span class="s">${sub}</span></span><svg viewBox="0 0 24 24" class="go">${ICO.next}</svg></button>`).join('') + '</div>' : '';
}

function renderSheet() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#sheetBody');
  const q = $('#q').value;
  $('#sheet').classList.toggle('searching', !!q.trim());
  $('#sheetTitle').textContent = q.trim() ? 'البحث' : TAB_NAMES[tab] || 'اللوحات';
  $('#q').placeholder = 'ابحث: سورة، آية، صفحة، جزء، ذكر، أو إعداد…';
  let html = '';

  if (q.trim()) {
    // one search for all of it: the app's own places, juz, the Quran, the adhkar
    const res = search(q), go = shortcuts(q), jz = juzHit(q);
    let dk = Adhkar.searchHTML(q);
    if (/class="(empty|tf-wait)"/.test(dk)) dk = '';
    let quran = '';
    if (res.length) {
      quran = '<div class="group">';
      res.slice(0, 50).forEach((r, k) => {
        const best = k === 0 ? ' best' : '';
        if (r.type === 'sura') quran += suraRow(r.s, best).replace('<span class="meta">', '<span class="tag">سورة</span><span class="meta">');
        else if (r.type === 'page') quran += `<button class="row${best}" data-go-page="${r.p}"><span class="num">${ar(r.p)}</span><span class="main"><span class="t">الصفحة ${ar(r.p)}</span></span><span class="tag">صفحة</span></button>`;
        else {
          const ai = R.fromHafs[r.h];
          const [s, a] = META.hafs[r.h];
          quran += `<button class="row${best}" data-go-aya="${ai}">
            <span class="main"><span class="s">${suraName(s)} ${ar(a)} · ص ${ar(R.ayas[ai][2])}</span>
            <span class="verse" style="font-family:${R.font}">${esc(R.text[ai])}</span></span>
            <span class="tag">آية</span></button>`;
        }
      });
      quran += '</div>';
    }
    const app = jz + go;
    const parts = [
      app && ['في التطبيق', app],
      quran && ['القرآن', quran],
      dk && ['الأذكار', dk],
    ].filter(Boolean);
    // the adhkar first when searching from their tab; the app's places first unless a surah or aya is a sure match
    if (tab === 'adhkar' && dk) parts.sort((a, b) => (b[0] === 'الأذكار') - (a[0] === 'الأذكار'));
    else if (app && quran && res[0].score >= 1.3) parts.sort((a, b) => (b[0] === 'القرآن') - (a[0] === 'القرآن'));
    html = parts.length ? parts.map(([t, h]) => (parts.length > 1 ? `<div class="group-label">${t}</div>` : '') + h).join('')
      : '<div class="empty"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><b>لا توجد نتائج</b>جرّب اسم سورة، أو رقم صفحة، أو كلمة من آية أو ذكر.</div>';
  } else if (tab === 'suras') {
    html = juzStripHTML() + '<div class="group">' + META.suras.map((_, i) => suraRow(i + 1)).join('') + '</div>';
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
    const jz = body.querySelector('.jz.on');
    if (jz) jz.parentNode.scrollLeft = jz.offsetLeft - jz.parentNode.clientWidth / 2 + jz.offsetWidth / 2;
    const here = body.querySelector('.row.here');
    if (here) here.scrollIntoView({ block: 'center' }); else if (tab !== 'adhkar') body.scrollTop = 0;
  }
  if (tab === 'settings' && !q.trim()) { refreshAudioPanel(); refreshMushafCard(); refreshAppInfo(); }
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
  const sw = e.target.closest('[data-switch]');
  if (sw) {
    const id = sw.dataset.switch, on = !store.get(id, false);
    store.set(id, on);
    sw.setAttribute('aria-checked', on); sw.querySelector('.tog').classList.toggle('on', on);
    if (id === 'awake') syncAwake();
    return;
  }
  const bk = e.target.closest('[data-backup]');
  if (bk) { if (bk.dataset.backup === 'save') saveBackup(); else loadBackup(); return; }
  const upd = e.target.closest('[data-app-update]');
  if (upd) { checkUpdate(upd); return; }
  const compass = e.target.closest('[data-pr-compass]');
  if (compass) { Prayer.startCompass(compass); return; }
  const dk = e.target.closest('[data-dk]');
  if (dk) { $('#q').blur(); Adhkar.open(dk.dataset.dk, dk.dataset.dkI != null ? +dk.dataset.dkI : undefined); return; }
  if (typeof Recite !== 'undefined' && Recite.onSheetClick(e)) return;
  const jz = e.target.closest('[data-go-juz]');
  if (jz) { closeSheet(); goTo(+jz.dataset.goJuz); return; }
  const gt = e.target.closest('[data-go-tab]');
  if (gt) { tab = gt.dataset.goTab; $('#q').value = ''; $('#q').blur(); renderSheet(); $('#sheetBody').scrollTop = 0; return; }
  const del = e.target.closest('[data-del-mark]');
  if (del) {
    e.stopPropagation();
    const list = bookmarks(); list.splice(+del.dataset.delMark, 1); setBookmarks(list);
    refreshHeader(); renderSheet(); return;
  }
  const dl = e.target.closest('[data-dl]');
  if (dl) {
    const a = dl.dataset.dl;
    if (a === 'rw') { e.stopPropagation(); riwayaDlTap(dl); }
    else if (a === 'start') startAudioDownload(R.id);
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
    remapPages(K, R.pages.length);
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
    const pct = khatmaPct(k);
    return `<div class="book${k.id === K.id ? ' current' : ''}" data-kh="${k.id}" style="--i:${idx}">
      <button class="book-open" data-open="${k.id}" aria-label="${esc(k.name)}">${coverHTML(k)}</button>
      <div class="book-info">
        <div class="book-row"><b>${esc(k.name)}</b><button class="dots" data-edit="${k.id}" aria-label="تعديل">•••</button></div>
        <div class="book-sub">${riwayaName(k.riwaya)}</div>
        <div class="prog"><i style="width:${pct}%"></i></div>
        <div class="book-meta"><span>قرأت ${ar(pagesRead(k))} من ${ar(khatmaTotal(k))} صفحة</span><span>${ar(pct)}٪</span></div>
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
      editing.mark = null; editing.page = 1; editing.pages = ''; editing.endShown = false;
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
  Object.assign(editing, { page: 1, mark: null, endShown: false, pages: '' });
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
  $('#doneCover').innerHTML = coverHTML(K, true);
  $('#doneText').textContent = `أتممت «${K.name}»${K.done > 1 ? ` — الختمة رقم ${ar(K.done)}` : ''}`;
  show($('#done'));
}
$('#doneAgain').onclick = () => {
  Object.assign(K, { page: 1, mark: null, endShown: false, pages: '' });
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
    restoreUI();      // and what was open
    Recite.prepResume(); // a recitation being prepared when an update was applied
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
    // Never silently: before the app was touched, or when it comes back after being away a
    // while (AWAY_MS), with a screen saying so (and what was open put back: keepUI); else
    // when a recitation is about to start (recite.js: its preparation), or as a toast says
    const hadController = !!navigator.serviceWorker.controller, AWAY_MS = 4 * 60e3;
    let touched = false, hiddenAt = 0;
    addEventListener('pointerdown', () => { touched = true; }, { capture: true, once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS && UPD.stale && !UPD.busy()) applyUpdate();
      if (hiddenAt) updLater = false; // opened again: offered again
      navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {});
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController && self.crossOriginIsolated) return;
      UPD.stale = true;
      if (!touched) applyUpdate();
      else offerUpdate();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
})();
