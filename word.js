'use strict';

// The word card: a long press on a word. In Hafs, what the word means (four
// books of غريب القرآن), what it is (root, lemma, grammar: the Quranic Arabic
// Corpus) and where else it comes; in any riwaya, how it went in التسميع, with
// a reset held to be sure. Data: data/words (tools/words.py, from Quranpedia.net).
// Uses $, esc, ar, show, hide, toast, R, S, META, loadJSON, DATA_VERSION, ayaLabel,
// speakWord, wordIndex, openTafsir, closeActions, paintMarks, keepClear, haptic, Recite.
const WordCard = (() => {
  const files = {};
  let index = null, cur = null; // cur: { ai, wi, el }
  const surah = s => files[s] ||= loadJSON(`data/words/${s}.json?v=${DATA_VERSION}`).catch(e => { delete files[s]; throw e; });
  const idx = () => index ||= loadJSON(`data/words/index.json?v=${DATA_VERSION}`).catch(e => { index = null; throw e; });
  const tokens = ai => R.text[ai].replace(/\s*[٠-٩]+$/, '').split(' ');
  const times = n => n === 1 ? 'مرة واحدة' : n === 2 ? 'مرتين' : n <= 10 ? `${ar(n)} مرات` : `${ar(n)} مرة`;
  const places = n => n === 1 ? 'موضع واحد' : n === 2 ? 'موضعين' : n <= 10 ? `${ar(n)} مواضع` : `${ar(n)} موضعًا`;
  const HOLD = 1600; // ms the reset is held

  function open(el) {
    const ai = +el.dataset.a, wi = wordIndex(el);
    cur?.el?.classList.remove('w-card');
    cur = { ai, wi, el, more: false, all: false };
    el.classList.add('w-card');
    closeActions();
    $('#wbWord').textContent = tokens(ai)[wi] || el.textContent;
    $('#wbWord').style.fontFamily = R.font;
    $('#wbWhere').textContent = `${ayaLabel(ai)} · الكلمة ${ar(wi + 1)}`;
    paint();
    const bar = $('#wordBar');
    if (!bar.hidden && !bar.classList.contains('leaving')) { bar.classList.remove('swap'); void bar.offsetWidth; bar.classList.add('swap'); }
    fit();
    show(bar);
    $('#wbBody').scrollTop = 0;
    if (R.id === 'hafs') {
      const [s, a] = META.hafs[R.ayas[ai][5]], me = cur;
      Promise.all([surah(s), idx()]).then(([f, ix]) => { if (cur === me) { me.info = f[a]; me.ix = ix; paint(); } },
        () => { if (cur === me) { me.failed = true; paint(); } });
    }
  }

  // as tall as the room above or below the word, whichever is more, so the
  // word stays in sight (keepClear then puts the card on that side)
  function fit() {
    const r = cur.el.getBoundingClientRect(), ph = cur.el.closest('.page')?.querySelector('.phead');
    const head = ph ? ph.getBoundingClientRect().bottom : 60;
    const below = innerHeight - 64 - r.bottom - 16, above = r.top - head - 24;
    $('#wordBar').style.maxHeight = Math.max(240, Math.min(640, Math.max(below, above))) + 'px';
  }

  function close() {
    if (!cur) return;
    cur.el?.classList.remove('w-card');
    cur = null;
    hide($('#wordBar'));
    keepClear();
  }

  function paint() {
    const c = cur;
    if (!c) return;
    const hafs = R.id === 'hafs';
    $('#wbBody').innerHTML = (hafs ? meaningHTML(c) + whatHTML(c) + whereHTML(c) : '') + recordHTML(c)
      + (hafs && c.ix ? `<p class="wb-src">معاني الكلمات من <a href="https://quranpedia.net" target="_blank" rel="noopener">الموسوعة القرآنية</a> (نسخة ${esc(c.ix.source.quranpedia)})، والصرف من <a href="https://corpus.quran.com" target="_blank" rel="noopener">corpus.quran.com</a></p>` : '');
    $('#wordBar [data-wb=play]').hidden = !hafs;
    keepClear(); // its height changed: still clear of the word, and on screen
  }

  // ---- what it means
  function meaningHTML(c) {
    if (!c.info) return `<section class="wb-sec"><h4>المعنى</h4><p class="wb-wait">${c.failed ? 'تعذر التحميل — تحقق من الاتصال' : 'جارٍ التحميل…'}</p></section>`;
    const toks = tokens(c.ai), books = c.ix.books;
    const mine = (c.info.g || []).filter(([a, b]) => a <= c.wi && c.wi <= b)
      .sort((x, y) => x[2] - y[2] || (x[1] - x[0]) - (y[1] - y[0]));
    if (!mine.length) return `<section class="wb-sec"><h4>المعنى</h4><p class="wb-none">لم تُفرد كتب الغريب لهذه الكلمة شرحًا، فمعناها ظاهر. اقرأ تفسير الآية لسياقها.</p></section>`;
    const item = ([a, b, k, m], main) => `<div class="wb-m${main ? ' main' : ''}">${b > a ? `<b style="font-family:${R.font}">${esc(toks.slice(a, b + 1).join(' '))}:</b> ` : ''}<span>${esc(m)}</span>
      <small>${esc(books[k][0])} · ${esc(books[k][1])}</small></div>`;
    const [first, ...rest] = mine;
    return `<section class="wb-sec"><h4>المعنى</h4>${item(first, true)}
      ${rest.length ? (c.more ? rest.map(x => item(x)).join('') : `<button class="wb-link" data-wb="more">في ${rest.length === 1 ? 'كتاب آخر' : `${ar(rest.length)} كتب أخرى`}</button>`) : ''}</section>`;
  }

  // ---- what it is
  function whatHTML(c) {
    const w = c.info?.w?.[c.wi];
    if (!w || !(w[0] || w[1] || w[2])) return '';
    const [root, lemma, gram] = w, rc = root && !root.includes('+') ? c.ix.roots[root] : 0;
    return `<section class="wb-sec"><h4>الكلمة</h4><div class="wb-chips">
      ${root ? `<span class="wb-chip"><small>الجذر</small><b>${esc(root.split('').join(' '))}</b>${rc ? `<small>${times(rc)} في القرآن</small>` : ''}</span>` : ''}
      ${lemma ? `<span class="wb-chip"><small>أصلها</small><b>${esc(lemma.replace(/\+/g, ' + '))}</b></span>` : ''}</div>
      ${gram ? `<p class="wb-gram">${esc(gram)}</p>` : ''}</section>`;
  }

  // ---- where else it comes (the same lemma)
  function whereHTML(c) {
    const slug = c.info?.w?.[c.wi]?.[3], locs = slug ? c.ix.lemmas[slug] || [] : [];
    const others = locs.map(x => [x >> 8, x & 255]).filter(([ai, wi]) => !(ai === c.ai && wi === c.wi) && R.ayas[ai]);
    if (!others.length) return locs.length ? `<section class="wb-sec"><h4>مواضعها</h4><p class="wb-none">لم ترد بهذا الأصل في غير هذا الموضع.</p></section>` : '';
    const shown = c.all ? others.slice(0, 60) : others.slice(0, 5);
    return `<section class="wb-sec"><h4>مواضعها <small>وردت في ${places(locs.length)}</small></h4><div class="wb-where">
      ${shown.map(([ai, wi]) => `<button data-wb-go="${ai}:${wi}"><span>${ayaLabel(ai)}</span><b style="font-family:${R.font}">${esc(tokens(ai)[wi] || '')}</b></button>`).join('')}
      </div>${others.length > shown.length && !c.all ? `<button class="wb-link" data-wb="all">عرض ${others.length > 60 ? 'أول ٦٠' : 'الكل'}</button>` : ''}</section>`;
  }

  // ---- how it went in التسميع
  function recordHTML(c) {
    const st = Recite.wordStats(c.ai, c.wi);
    if (!st.read && !st.hist.length) return `<section class="wb-sec"><h4>في التسميع</h4><p class="wb-none">لم تُسمِّع هذه الآية بعد.</p></section>`;
    const hist = st.hist.slice(0, 6).map(([t, e]) => `<li><span>${Recite.ago(t)}</span><span>${e === 'skip' ? 'تجاوزت الآية أو الكلمة' : esc(st.types[e] || 'خطأ')}</span></li>`).join('');
    return `<section class="wb-sec"><h4>في التسميع</h4>
      <div class="rc-ab-top"><span class="rc-ab-n ok"><b>${ar(st.right)}</b>صحيحة</span><span class="rc-ab-n bad"><b>${ar(st.wrong)}</b>خطأ</span>
        ${st.now ? `<span class="wb-now">${esc(st.types[st.now] || '')}</span>` : ''}</div>
      ${hist ? `<ul class="wb-hist">${hist}</ul>` : ''}
      ${st.wrong || st.now || st.hist.length ? `<div class="wb-reset">${c.confirm ? `
        <p>سيُمحى كل سجل أخطاء هذه الكلمة: عددها، وعلامتها، وتاريخها. لا يمكن التراجع عن هذا.</p>
        <div class="wb-reset-row"><button class="wb-hold" data-wb-hold><i></i><span>اضغط مطولًا للمحو</span></button><button class="wb-link" data-wb="keep">إلغاء</button></div>`
        : `<button class="wb-link danger" data-wb="reset">محو سجل هذه الكلمة…</button>`}</div>` : ''}
    </section>`;
  }

  // ---- taps
  $('#wordBar').addEventListener('click', e => {
    const c = cur;
    if (!c) return;
    const go = e.target.closest('[data-wb-go]');
    if (go) { const [ai, wi] = go.dataset.wbGo.split(':').map(Number); close(); Recite.showWord(ai, wi); return; }
    const b = e.target.closest('[data-wb]');
    if (!b) return;
    const a = b.dataset.wb;
    if (a === 'close') close();
    if (a === 'play' && c.el?.isConnected) speakWord(c.el);
    if (a === 'tafsir') { const ai = c.ai; close(); openTafsir(ai); }
    if (a === 'copy') {
      navigator.clipboard.writeText(tokens(c.ai)[c.wi] || '').then(() => toast('تم النسخ'), () => toast('تعذر النسخ'));
    }
    if (a === 'more') { c.more = true; paint(); }
    if (a === 'all') { c.all = true; paint(); }
    if (a === 'reset') { c.confirm = true; paint(); haptic(8); }
    if (a === 'keep') { c.confirm = false; paint(); }
  });
  // the reset: held down for HOLD ms; let go sooner and nothing happens
  let holdT = null;
  const release = () => { clearTimeout(holdT); holdT = null; $('#wordBar .wb-hold')?.classList.remove('holding'); };
  $('#wordBar').addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-wb-hold]');
    if (!h || !cur) return;
    e.preventDefault();
    h.classList.add('holding');
    haptic(8);
    const c = cur;
    holdT = setTimeout(() => {
      holdT = null;
      if (cur !== c) return;
      Recite.resetWord(c.ai, c.wi);
      c.confirm = false;
      haptic([20, 50, 20]);
      paint();
      toast('مُحي سجل الكلمة');
    }, HOLD);
  });
  ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => { if (holdT) release(); }));
  $('#wordBar').addEventListener('pointerout', e => { if (holdT && e.target.closest('[data-wb-hold]')) release(); });
  $('#wordBar').addEventListener('contextmenu', e => e.preventDefault());

  return { open, close, el: () => cur?.el };
})();
