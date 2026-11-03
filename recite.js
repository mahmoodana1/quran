'use strict';

// Recitation from memory (التسميع). The reader recites from an aya on and the
// page follows word by word, marking words that were said wrong, skipped or
// needed a hint; «إخفاء» hides the words still to come. Mistakes are kept per
// riwaya, by aya; an aya counts as mastered after three clean recitations on
// different days, and a new mistake there starts the count again.
// The listener is simulated for now (no microphone): it walks the words at a
// reciting pace and makes the odd mistake, so the whole flow can be tried.
// Uses $, store, ar, esc, show, hide, toast, R, S, isEnd, goTo, pageInfo,
// paintMarks, closeActions, stopAudio, speakWord, suraName, ayaLabel,
// openRecite, renderSheet, closeSheet and flashAya from app.js at call time.
const Recite = (() => {
  const TYPES = { wrong: 'قرأتها بكلمة أخرى', skip: 'تجاوزتها', hint: 'احتجت تلميحًا' };
  const MASTER_DAYS = 3;
  const PACE = 420;       // simulated: ms a word
  const HINT_WAIT = 2200; // simulated: pause before the hint shows
  const CLS = ['rc-weak', 'rc-done', 'rc-now', 'rc-hid', 'rc-peek', 'rc-wrong', 'rc-skip', 'rc-hint'];

  // the session: words in order { ai, p, n (word on its page), wi (word in its aya), of (aya length) },
  // idx 'page:n' -> word, pos = next word to say, errs[k] = type, gone = mistakes taken back
  let G = null, dirty = false, timer = 0, waitUntil = 0;

  // ---- mistakes, per riwaya: { ayas: { ai: { n, last, words: { wi: type }, ok: [day], done } }, sessions }
  const key = () => 'recite.' + R.id;
  const log = () => store.get(key(), { ayas: {}, sessions: [] });
  const day = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const daysAgo = t => Math.round((new Date(day()) - new Date(day(t))) / 864e5);
  const ago = t => {
    const d = daysAgo(t);
    return d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : d === 2 ? 'قبل يومين' : d <= 10 ? `قبل ${ar(d)} أيام` : `قبل ${ar(d)} يومًا`;
  };
  const times = n => n === 1 ? 'مرة' : n === 2 ? 'مرتين' : n <= 10 ? `${ar(n)} مرات` : `${ar(n)} مرة`;
  const errs = n => n === 1 ? 'خطأ واحد' : n === 2 ? 'خطآن' : n <= 10 ? `${ar(n)} أخطاء` : `${ar(n)} خطأ`;
  const ayaCount = n => n === 1 ? 'آية' : n === 2 ? 'آيتان' : n <= 10 ? `${ar(n)} آيات` : `${ar(n)} آية`;
  const ayaTokens = ai => R.text[ai].replace(/\s*[٠-٩]+$/, '').split(' ');
  const wordText = w => ayaTokens(w.ai)[w.wi] || '';

  // every word of an aya, wherever its lines fall
  function ayaWords(ai) {
    const out = [];
    for (let p = R.ayas[ai][2]; p <= R.pages.length; p++) {
      let n = 0, here = false;
      for (const ln of R.pages[p - 1]) {
        if (!Array.isArray(ln) || typeof ln[0] === 'string') continue;
        for (const [a, text] of ln) for (const t of text.split(' ')) {
          if (isEnd(t)) continue;
          if (a === ai) { out.push({ ai, p, n, wi: out.length }); here = true; }
          n++;
        }
      }
      if (!here) break;
    }
    out.forEach(w => { w.of = out.length; });
    return out;
  }

  // ---- session

  // from an aya to the end of its surah, or just the ayas given (a review)
  function start(from, review) {
    cancel();
    stopAudio();
    closeActions();
    const ayas = review || [];
    if (!review) for (let a = from; a < R.ayas.length && R.ayas[a][0] === R.ayas[from][0] && ayas.length < 300; a++) ayas.push(a);
    const words = ayas.flatMap(ayaWords);
    if (!words.length) return;
    G = { ayas, words, idx: new Map(words.map((w, k) => [w.p + ':' + w.n, k])), pos: 0, errs: {}, gone: new Set(),
      hide: store.get('recite.hide', false), run: false, secs: 0, review: !!review, lastP: null };
    dirty = true;
    store.set('recite.used', true);
    syncDock();
    follow();
    paintMarks();
    paintBar();
    show($('#recBar'));
    if (!store.get('recite.intro')) show($('#recIntro'));
    else resume();
  }

  function resume() {
    if (!G || G.run || G.done) return;
    G.run = true; G.t = Date.now(); waitUntil = 0;
    hide($('#recWord'));
    clearInterval(timer);
    timer = setInterval(tick, PACE);
    paintBar();
  }
  function pause() {
    if (!G?.run) return;
    G.run = false; G.secs += (Date.now() - G.t) / 1000;
    clearInterval(timer);
    paintBar();
  }

  // drop the session without keeping anything
  function cancel() {
    if (!G) return;
    clearInterval(timer);
    G = null;
    ['#recBar', '#recWord', '#recIntro', '#recDone'].forEach(s => hide($(s)));
    paintMarks();
    syncDock();
  }

  // stand-in for the recogniser: an occasional wrong word, skipped word or hint
  function heard(k) {
    if (k < 3) return null;
    if (k % 29 === 11) return 'wrong';
    if (k % 43 === 25) return 'skip';
    if (k % 53 === 38) return 'hint';
    return null;
  }

  function tick() {
    if (!G?.run) return;
    const k = G.pos, m = heard(k);
    if (m === 'hint' && !waitUntil) { waitUntil = Date.now() + HINT_WAIT; G.hint = true; paint(); paintBar(); return; }
    if (waitUntil && Date.now() < waitUntil) return;
    waitUntil = 0; G.hint = false;
    if (m) { G.errs[k] = m; if (navigator.vibrate) navigator.vibrate(12); }
    G.pos++;
    if (G.pos >= G.words.length) return finish();
    follow();
    paint();
    paintBar();
  }

  // turn the page when the next word is on another one
  function follow() {
    const w = G.words[Math.min(G.pos, G.words.length - 1)];
    if (w.p === G.lastP) return;
    G.lastP = w.p;
    if (w.p !== S.page) goTo(w.p, { animate: Math.abs(w.p - S.page) === 1 });
  }

  const liveErrs = () => Object.keys(G.errs).map(Number).filter(k => !G.gone.has(k)).sort((a, b) => a - b);

  // ---- painting

  // past mistakes shown faintly while reading (a setting): 'page:n' -> type
  let weakMap = null;
  function weakWords() {
    if (weakMap?.rid === R.id) return weakMap.m;
    const m = new Map();
    for (const [ai, a] of Object.entries(log().ayas)) {
      if (a.done || !R.ayas[+ai]) continue;
      const ws = ayaWords(+ai);
      for (const [wi, e] of Object.entries(a.words)) { const w = ws[+wi]; if (w) m.set(w.p + ':' + w.n, e); }
    }
    weakMap = { rid: R.id, m };
    return m;
  }

  function paint(root = document) {
    const weak = !G && store.get('recite.weak', false) ? weakWords() : null;
    if (!G && !dirty && !weak) return;
    if (!G && root === document) dirty = !!weak;
    const pages = root.classList?.contains('page') ? [root] : root.querySelectorAll('.page');
    for (const pg of pages) {
      const p = +pg.dataset.page;
      pg.querySelectorAll('.w:not(.end)').forEach((el, n) => {
        el.classList.remove(...CLS);
        if (weak) { if (weak.has(p + ':' + n)) el.classList.add('rc-weak'); return; }
        const k = G?.idx.get(p + ':' + n);
        if (k == null) return;
        const e = G.gone.has(k) ? null : G.errs[k];
        if (k < G.pos) el.classList.add(e ? 'rc-' + e : 'rc-done');
        else if (G.done) return;
        else if (k === G.pos) { el.classList.add('rc-now'); if (G.hide) el.classList.add(G.hint ? 'rc-peek' : 'rc-hid'); }
        else if (G.hide) el.classList.add('rc-hid');
      });
    }
  }

  function paintBar() {
    if (!G) return;
    const w = G.words[Math.min(G.pos, G.words.length - 1)];
    const n = liveErrs().length;
    $('#recTitle').textContent = G.hint ? 'تلميح للكلمة التالية…' : G.run ? 'يستمع…' : G.pos ? 'متوقف مؤقتًا' : 'اضغط وابدأ القراءة';
    $('#recSub').textContent = `${ayaLabel(w.ai)}${n ? ' · ' + errs(n) : ''} · تجريبي`;
    $('#recBar').classList.toggle('paused', !G.run);
    $('#recToggle').classList.toggle('live', G.run);
    $('#recToggle').setAttribute('aria-label', G.run ? 'إيقاف مؤقت' : 'متابعة');
    $('#recHide').classList.toggle('on', G.hide);
    $('#recHide').setAttribute('aria-pressed', G.hide);
    // this aya's share of the bar, like the player
    $('#recProg').style.transform = `scaleX(${G.pos >= G.words.length ? 1 : w.wi / w.of})`;
  }

  // ---- the end of a session

  function finish() {
    if (!G || G.done) return;
    pause();
    G.done = true; G.hint = false;
    hide($('#recBar')); hide($('#recWord'));
    paint();
    paintDone();
    show($('#recDone'));
  }

  function paintDone() {
    const said = G.words.slice(0, G.pos), list = liveErrs();
    const first = G.words[0].ai, last = said[said.length - 1].ai;
    $('#rdTitle').textContent = list.length ? 'انتهت الجلسة' : 'ما شاء الله، بلا أخطاء';
    $('#rdRange').textContent = G.review ? `مراجعة مواضع الضعف · ${ayaCount(new Set(said.map(w => w.ai)).size)}`
      : first === last ? ayaLabel(first) : `${ayaLabel(first)} – ${ar(R.ayas[last][1])}`;
    $('#rdRight').textContent = ar(said.length - list.length);
    $('#rdErr').textContent = ar(list.length);
    const secs = Math.round(G.secs);
    $('#rdTime').textContent = `${ar(Math.floor(secs / 60))}:${ar(String(secs % 60).padStart(2, '0'))}`;
    const rows = Object.keys(G.errs).map(Number).sort((a, b) => a - b).map(k => {
      const w = G.words[k], e = G.errs[k], gone = G.gone.has(k);
      return `<div class="row rc-row${gone ? ' gone' : ''}"><span class="rc-mk rc-${e}"></span>
        <span class="main"><span class="t" style="font-family:${R.font}">${esc(wordText(w))}</span><span class="s">${ayaLabel(w.ai)} · ${TYPES[e]}</span></span>
        <button class="rc-not" data-rd-gone="${k}">${gone ? 'تراجع' : 'لم أخطئ'}</button></div>`;
    }).join('');
    $('#rdList').innerHTML = rows;
    $('#rdList').hidden = !rows;
    $('#rdNote').innerHTML = rows ? 'تُحفظ في سجل أخطائك عند الإغلاق · <button data-rd-log>عرض السجل</button>' : '';
    $('#rdAgain').textContent = list.length ? 'أعد الآيات المخطوءة' : 'تابع من الآية التالية';
  }

  // keep what was said: mistakes by aya, a clean full aya towards «mastered»
  function save() {
    const l = log(), today = day();
    const said = G.words.slice(0, G.pos);
    if (!said.length) return;
    const byAya = new Map();
    said.forEach((w, k) => {
      if (!byAya.has(w.ai)) byAya.set(w.ai, []);
      byAya.get(w.ai).push([w, G.gone.has(k) ? null : G.errs[k]]);
    });
    for (const [ai, list] of byAya) {
      const bad = list.filter(x => x[1]);
      const a = l.ayas[ai];
      if (bad.length) {
        const r = l.ayas[ai] = a || { n: 0, words: {}, ok: [] };
        r.n += bad.length; r.last = Date.now(); r.ok = []; r.done = false;
        bad.forEach(([w, e]) => { r.words[w.wi] = e; });
      } else if (a && list.length === list[0][0].of && !a.ok.includes(today)) {
        a.ok.push(today);
        if (a.ok.length >= MASTER_DAYS) { a.done = true; a.at = Date.now(); }
      }
    }
    l.sessions.unshift({ t: Date.now(), from: said[0].ai, to: said[said.length - 1].ai, ayas: byAya.size,
      words: said.length, errs: liveErrs().length, secs: Math.round(G.secs), review: G.review,
      list: liveErrs().slice(0, 30).map(k => [G.words[k].ai, G.words[k].wi, G.errs[k]]) });
    l.sessions.length = Math.min(l.sessions.length, 60);
    store.set(key(), l);
    weakMap = null;
    store.set('recite.last.' + R.id, Math.min(said[said.length - 1].ai + 1, R.ayas.length - 1));
  }

  function closeDone() {
    if (!G) return;
    save();
    const g = G;
    cancel();
    return g;
  }

  // ---- taps on the page while reciting

  function onTap(target) {
    if (!G) return false;
    const el = target.closest('.w');
    if (!el || el.classList.contains('end')) return !!el; // aya numbers do nothing mid-session
    const pg = el.closest('.page');
    const n = [...pg.querySelectorAll('.w:not(.end)')].indexOf(el);
    const k = G.idx.get(pg.dataset.page + ':' + n);
    if (k == null || k >= G.pos || !G.errs[k] || G.gone.has(k)) return true;
    pause();
    G.tap = { k, el };
    $('#rwWord').textContent = wordText(G.words[k]);
    $('#rwWord').style.fontFamily = R.font;
    $('#rwType').textContent = TYPES[G.errs[k]];
    if (!G.done) show($('#recWord'));
    return true;
  }

  // ---- the aya bar's note, the dock button

  function note(ai) {
    const a = log().ayas[ai];
    return a && !a.done ? `أخطأت هنا ${times(a.n)} · آخرها ${ago(a.last)}` : '';
  }

  function syncDock() {
    const on = !!store.get('recite.used');
    $('#dockRec').hidden = !on;
    $('#dock').classList.toggle('three', on);
    $('#dockRec').classList.toggle('on', !!G);
  }

  // ---- the «التسميع» panel: progress, weak spots, sessions and settings

  const MIC = '<svg viewBox="0 0 24 24"><path d="M12 3.5a3 3 0 00-3 3v5a3 3 0 006 0v-5a3 3 0 00-3-3zM6.5 11a5.5 5.5 0 0011 0M12 16.5v4"/></svg>';

  function snippet(ai, words) {
    const toks = ayaTokens(ai), ks = Object.keys(words).map(Number);
    const a = Math.max(0, Math.min(...ks) - 3), b = Math.min(toks.length, Math.max(...ks) + 4);
    return (a ? '… ' : '') + toks.slice(a, b).map((t, j) => {
      const e = words[a + j];
      return e ? `<mark class="rc-${e}">${esc(t)}</mark>` : esc(t);
    }).join(' ') + (b < toks.length ? ' …' : '');
  }

  // where «تابع» picks up: after the last session, else this page
  function resumeAya() {
    const last = store.get('recite.last.' + R.id);
    return last != null && R.ayas[last] ? last : pageInfo(S.page).first;
  }

  const toggle = (id, label, sub) => {
    const on = !!store.get('recite.' + id, false);
    return `<button class="row rc-set" data-rc-set="${id}" role="switch" aria-checked="${on}">
      <span class="main"><span class="t">${label}</span><span class="s">${sub}</span></span><span class="tog${on ? ' on' : ''}"><i></i></span></button>`;
  };

  function sessionLabel(s) {
    if (s.review) return 'مراجعة مواضع الضعف';
    if (!R.ayas[s.from] || !R.ayas[s.to]) return '';
    return s.from === s.to ? ayaLabel(s.from) : `${ayaLabel(s.from)} – ${ar(R.ayas[s.to][1])}`;
  }

  function panelHTML() {
    const l = log();
    const all = Object.entries(l.ayas).map(([ai, a]) => [+ai, a]).filter(([ai]) => R.ayas[ai]);
    const weak = all.filter(([, a]) => !a.done).sort((x, y) => x[0] - y[0]);
    const mastered = all.filter(([, a]) => a.done).sort((x, y) => y[1].at - x[1].at);
    const settings = `<div class="group-label">إعدادات التسميع</div><div class="group">
      ${toggle('hide', 'ابدأ والكلمات مخفية', 'تظهر كل كلمة حين تقرؤها')}
      ${toggle('weak', 'مواضع الضعف في المصحف', 'خط منقّط خفيف تحت كلمات أخطأت فيها')}</div>`;

    if (!all.length && !l.sessions.length) {
      return `<div class="rc-welcome"><div class="rc-badge">${MIC}</div><h2>التسميع</h2>
        <p>اقرأ من حفظك، ويتابعك التطبيق كلمةً كلمة، وينبّهك إلى ما أخطأت فيه ويحفظه هنا لتراجعه.</p>
        <button class="rc-review" data-rc-resume>${MIC}ابدأ من ${ayaLabel(pageInfo(S.page).first)}</button>
        <p class="note">أو اضغط رقم أي آية في المصحف ثم «تسميع».</p></div>${settings}`;
    }

    const now = Date.now(), wk = now - 7 * 864e5, wk2 = now - 14 * 864e5;
    const thisW = l.sessions.filter(s => s.t >= wk), lastW = l.sessions.filter(s => s.t >= wk2 && s.t < wk);
    const sum = (list, f) => list.reduce((s, x) => s + (x[f] || 0), 0);
    const e1 = sum(thisW, 'errs'), e0 = sum(lastW, 'errs');
    const trend = e0 ? (e1 <= e0 ? `الأخطاء أقل بـ ${ar(Math.round((1 - e1 / e0) * 100))}٪ من الأسبوع الماضي` : 'الأخطاء أكثر من الأسبوع الماضي') : '';
    let html = `<div class="rc-hero"><div class="rc-hero-l">هذا الأسبوع</div>
      <div class="rc-hero-n"><div><b>${ar(thisW.length)}</b><small>جلسة</small></div><div><b>${ar(sum(thisW, 'ayas'))}</b><small>آية</small></div><div><b>${ar(e1)}</b><small>خطأ</small></div></div>
      ${trend ? `<div class="rc-hero-t">${trend}</div>` : ''}</div>
      <div class="rc-actions"><button class="rc-review" data-rc-resume>${MIC}تابع من ${ayaLabel(resumeAya())}</button>
      ${weak.length ? `<button class="rc-review ghost" data-rc-review>راجع مواضع الضعف · ${ayaCount(weak.length)}</button>` : ''}</div>`;

    html += '<div class="group-label">مواضع الضعف</div>';
    if (weak.length) {
      html += '<div class="group">' + weak.map(([ai, a]) => {
        const dots = [0, 1, 2].map(j => `<i${j < a.ok.length ? ' class="on"' : ''}></i>`).join('');
        return `<button class="row rc-row" data-rc-aya="${ai}"><span class="num">${ar(R.ayas[ai][1])}</span>
          <span class="main"><span class="verse rc-snip" style="font-family:${R.font}">${snippet(ai, a.words)}</span>
          <span class="s">${suraName(R.ayas[ai][0])} · ${times(a.n)} · آخرها ${ago(a.last)}<span class="rc-dots" aria-label="${ar(a.ok.length)} من ${ar(MASTER_DAYS)} قراءات صحيحة">${dots}</span></span></span>
          <span class="rc-mic" data-rc-start="${ai}" aria-label="سمّع الآية">${MIC}</span></button>`;
      }).join('') + '</div>';
    } else {
      html += '<p class="note">لا مواضع ضعف الآن، ما شاء الله.</p>';
    }

    if (mastered.length) {
      html += '<div class="group-label">أتقنتها</div><div class="group">' + mastered.slice(0, 30).map(([ai, a]) =>
        `<button class="row rc-row rc-mastered" data-rc-aya="${ai}"><span class="num">${ar(R.ayas[ai][1])}</span>
          <span class="main"><span class="t">${ayaLabel(ai)}</span><span class="s">أتقنتها ${ago(a.at)}</span></span><span class="check">✓</span></button>`).join('') + '</div>';
    }

    if (l.sessions.length) {
      html += '<div class="group-label">الجلسات</div><div class="group">' + l.sessions.slice(0, 20).map(s => {
        const items = (s.list || []).filter(([ai]) => R.ayas[ai]).map(([ai, wi, e]) =>
          `<div class="rc-sess-i"><span class="rc-mk rc-${e}"></span><b style="font-family:${R.font}">${esc(ayaTokens(ai)[wi] || '')}</b><small>${ayaLabel(ai)} · ${TYPES[e]}</small></div>`).join('');
        return `<details class="rc-sess"><summary class="row"><span class="main"><span class="t">${sessionLabel(s)}</span>
          <span class="s">${ago(s.t)} · ${ayaCount(s.ayas || 1)} · ${s.errs ? errs(s.errs) : 'بلا أخطاء'}</span></span>
          <svg viewBox="0 0 24 24" class="go"><path d="M14.5 6l-6 6 6 6"/></svg></summary>
          <div class="rc-sess-list">${items || '<p class="note">بلا أخطاء، ما شاء الله.</p>'}</div></details>`;
      }).join('') + '</div>';
    }
    return html + settings;
  }

  function weakAyas() {
    return Object.entries(log().ayas).filter(([ai, a]) => !a.done && R.ayas[+ai]).map(([ai]) => +ai).sort((a, b) => a - b);
  }

  function onSheetClick(e) {
    const one = e.target.closest('[data-rc-start]');
    if (one) { e.stopPropagation(); closeSheet(); start(null, [+one.dataset.rcStart]); return true; }
    if (e.target.closest('[data-rc-resume]')) { closeSheet(); start(resumeAya()); return true; }
    if (e.target.closest('[data-rc-review]')) { closeSheet(); start(null, weakAyas()); return true; }
    const set = e.target.closest('[data-rc-set]');
    if (set) {
      const k = 'recite.' + set.dataset.rcSet;
      store.set(k, !store.get(k, false));
      weakMap = null;
      const y = $('#sheetBody').scrollTop;
      renderSheet();
      $('#sheetBody').scrollTop = y;
      paintMarks();
      return true;
    }
    const row = e.target.closest('[data-rc-aya]');
    if (row) {
      const ai = +row.dataset.rcAya;
      closeSheet();
      goTo(R.ayas[ai][2]);
      setTimeout(() => flashAya(ai), 250);
      return true;
    }
    return false;
  }

  // ---- controls

  $('#recToggle').onclick = () => (G?.run ? pause() : resume());
  $('#recHide').onclick = () => {
    if (!G) return;
    G.hide = !G.hide;
    store.set('recite.hide', G.hide);
    paint(); paintBar();
  };
  $('#recStop').onclick = () => { if (!G) return; if (G.pos) finish(); else cancel(); };

  $('#recWord').addEventListener('click', e => {
    const b = e.target.closest('[data-rw]');
    if (!b || !G?.tap) return;
    const { k, el } = G.tap;
    if (b.dataset.rw === 'say') speakWord(el);
    if (b.dataset.rw === 'gone') { G.gone.add(k); hide($('#recWord')); paint(); paintBar(); toast('أُزيلت من الأخطاء'); }
    if (b.dataset.rw === 'close') hide($('#recWord'));
  });

  $('#riGo').onclick = () => { store.set('recite.intro', true); hide($('#recIntro')); resume(); };
  $('#riLater').onclick = () => cancel();

  $('#rdList').addEventListener('click', e => {
    const b = e.target.closest('[data-rd-gone]');
    if (!b || !G) return;
    const k = +b.dataset.rdGone;
    if (G.gone.has(k)) G.gone.delete(k); else G.gone.add(k);
    paint(); paintDone();
  });
  $('#rdNote').addEventListener('click', e => { if (e.target.closest('[data-rd-log]')) { closeDone(); openRecite(); } });
  $('#rdOk').onclick = () => closeDone();
  $('#rdAgain').onclick = () => {
    const g = G;
    if (!g) return;
    const bad = [...new Set(liveErrs().map(k => g.words[k].ai))];
    closeDone();
    if (bad.length) start(null, bad);
    else start(Math.min(g.words[g.pos - 1].ai + 1, R.ayas.length - 1));
  };

  $('#dockRec').onclick = () => {
    if (G) return;
    $('#dockQuran').onclick();
    const { first, last } = pageInfo(S.page);
    const lastAi = store.get('recite.last.' + R.id);
    start(lastAi != null && lastAi >= first && lastAi <= last ? lastAi : first);
  };

  syncDock();

  return { start, cancel, paint, onTap, note, syncDock, panelHTML, onSheetClick, active: () => !!G };
})();
