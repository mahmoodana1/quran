'use strict';

// Recitation from memory (التسميع). The reader recites from an aya on and the
// page follows, marking words that were said wrong, skipped or needed a hint;
// «إخفاء» hides the words still to come, and touching the hidden word you are
// on peeks at it (counted as a hint). Mistakes are kept per riwaya, by aya; an
// aya counts as mastered after three clean recitations on different days, and
// a new mistake there starts the count again. The panel keeps a daily goal and
// streak, a tracker of every surah recited from memory, and «اختبرني», which
// starts at a random place already recited.
// Listening (listen.js) needs the Quran speech model, downloaded once when
// first asked for. Each phrase the reader says between pauses is lined up
// against the words expected from where they are (align), so a word said
// differently, a skipped word or a stretch said again shows as such.
// The mic bubble over the page: recite any aya and it is found, opened and
// followed from there.
// Uses $, store, ar, esc, show, hide, toast, panelOpen, R, S, isEnd, norm,
// lev, wordSim, buildIndex, ayaScore, goTo, pageInfo, paintMarks, closeActions,
// stopAudio, speakWord, suraName, ayaLabel, openRecite, renderSheet,
// closeSheet and flashAya from app.js at call time.
const Recite = (() => {
  const TYPES = { wrong: 'قرأتها بكلمة أخرى', skip: 'تجاوزتها', hint: 'احتجت تلميحًا' };
  const MASTER_DAYS = 3;
  const HINT_AFTER = 7000; // ms of silence on a hidden word before it shows
  const CLS = ['rc-weak', 'rc-done', 'rc-now', 'rc-hid', 'rc-peek', 'rc-wrong', 'rc-skip', 'rc-hint'];

  // the session: words in order { ai, p, n (word on its page), wi (word in its aya), of (aya length), nt (normalised) },
  // idx 'page:n' -> word, pos = next word to say, errs[k] = type, gone = mistakes taken back
  let G = null, dirty = false, timer = 0;

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
    const toks = ayaTokens(ai);
    out.forEach(w => { w.of = out.length; w.nt = norm(toks[w.wi] || ''); });
    return out;
  }

  // ---- the speech model: asked for once, then kept

  let pending = null;
  function withModel(then) {
    Listen.prime();
    if (Listen.ready()) return then();
    Listen.saved().then(have => {
      if (!have) { pending = then; paintDl(); show($('#recIntro')); return; }
      toast('جارٍ تحضير التسميع…');
      Listen.load().then(then, () => toast('تعذر تحضير التسميع'));
    });
  }

  function paintDl(p) {
    const busy = p != null;
    $('#riProg').hidden = !busy;
    $('#riGo').disabled = busy;
    $('#riLater').hidden = busy;
    $('#riBar').style.width = ((p || 0) * 100).toFixed(1) + '%';
    $('#riPct').textContent = ar(Math.round((p || 0) * 100)) + '٪';
    $('#riGo').textContent = busy ? 'جارٍ التنزيل…' : `تنزيل النموذج · ${ar(Listen.MODEL_MB)} م.ب`;
  }

  // ---- session

  // from an aya to the end of its surah, or just the ayas given (a review or a test);
  // opts.test hides the words, opts.seed is the phrase that found the aya (bubble)
  function start(from, review, opts = {}) {
    if (!Listen.ready()) return withModel(() => start(from, review, opts));
    cancel();
    stopFind();
    stopAudio();
    closeActions();
    const ayas = review || [];
    if (!review) for (let a = from; a < R.ayas.length && R.ayas[a][0] === R.ayas[from][0] && ayas.length < 300; a++) ayas.push(a);
    const words = ayas.flatMap(ayaWords);
    if (!words.length) return;
    G = { ayas, words, idx: new Map(words.map((w, k) => [w.p + ':' + w.n, k])), pos: 0, errs: {}, gone: new Set(),
      hide: !!opts.test || (!opts.seed && store.get('recite.hide', false)), run: false, secs: 0, busy: 0,
      review: !!review && !opts.test, test: !!opts.test, lastP: null, miss: 0 };
    // found by reciting: what was already said counts as said
    if (opts.seed) { const r = align(opts.seed, 0, words[0].of); if (r) G.pos = Math.min(r.end, words.length - 1); }
    dirty = true;
    store.set('recite.used', true);
    follow();
    paintMarks();
    paintBar();
    show($('#recBar'));
    resume();
  }

  function resume() {
    if (!G || G.run || G.done) return;
    G.run = true; G.t = G.lastAct = Date.now();
    hide($('#recWord'));
    const g = G;
    Listen.start(audio => onPhrase(g, audio), on => { if (G === g) { G.voice = on; if (on) G.lastAct = Date.now(); paintBar(); } })
      .catch(() => { if (G === g) { pause(); toast('لا يمكن الوصول إلى الميكروفون — اسمح به من إعدادات المتصفح'); } });
    clearInterval(timer);
    timer = setInterval(tick, 500);
    paintBar();
  }
  function pause() {
    if (!G?.run) return;
    G.run = false; G.voice = false; G.secs += (Date.now() - G.t) / 1000;
    Listen.stop();
    clearInterval(timer);
    paintBar();
  }

  // drop the session without keeping anything
  function cancel() {
    if (!G) return;
    clearInterval(timer);
    Listen.stop();
    G = null;
    ['#recBar', '#recWord', '#recDone'].forEach(s => hide($(s)));
    paintMarks();
    syncBubble();
  }

  // a phrase from the microphone: recognised in order, then lined up
  function onPhrase(g, audio) {
    g.busy++;
    paintBar();
    Listen.transcribe(audio).then(text => {
      g.busy--;
      if (G !== g || g.done) return;
      heard(text);
      paintBar();
    });
  }

  function heard(text) {
    G.lastAct = Date.now();
    const r = align(text, G.pos);
    if (!r) {
      if (norm(text).trim() && ++G.miss >= 2) { toast('لم أتبيّن القراءة، أعد من موضعك'); G.miss = 0; }
      return;
    }
    G.miss = 0;
    let marked = false;
    for (const [k, e] of r.marks) if (!G.errs[k]) { G.errs[k] = e; marked = true; }
    if (marked && navigator.vibrate) navigator.vibrate(12);
    if (r.end > G.pos) { G.pos = r.end; G.peek = false; }
    if (G.pos >= G.words.length) return finish();
    follow();
    paint();
  }

  // How well a spoken word fits the expected one. One letter apart counts as
  // the same word when that letter is a long vowel or its carrier (the
  // mushaf's spelling: «الحيوة» for «الحياة», «الصلوة»), and as a different
  // word otherwise («تعلمون» for «يعلمون»).
  const VOWELISH = 'اويىهةء';
  function fit(a, b) {
    if (a === b) return 1;
    if (lev(a, b, 1) === 1) {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      const x = a[i] || '', y = b[i] || '';
      const one = a.length === b.length ? (VOWELISH.includes(x) && VOWELISH.includes(y))
        : VOWELISH.includes(a.length > b.length ? x : y);
      if (one) return 0.9;
      if (Math.min(a.length, b.length) >= 3) return 0.6;
    }
    return wordSim(a, b);
  }

  // Line a phrase up with the words expected from `pos`: an edit alignment
  // where the start may fall up to 8 words back (readers often repeat before
  // going on) or, when finding an aya, anywhere in its first `freeStart`
  // words, and the end falls wherever the phrase stops. Returns where the
  // reader now is and the wrong and skipped words on the way, or null when
  // the phrase does not fit here.
  function align(text, pos, freeStart = 0) {
    const t = norm(text).split(/\s+/).filter(Boolean);
    if (!t.length) return null;
    const back = Math.min(pos, 8), s0 = pos - back, free = back + freeStart;
    const E = G.words.slice(s0, Math.min(G.words.length, pos + freeStart + t.length * 2 + 6));
    const n = t.length, m = E.length;
    if (!m) return null;
    const D = [], B = [], sim = [];
    for (let i = 0; i <= n; i++) { D.push(new Float32Array(m + 1)); B.push(new Uint8Array(m + 1)); sim.push(new Float32Array(m + 1)); }
    for (let j = 0; j <= m; j++) D[0][j] = Math.max(0, j - free);
    for (let i = 1; i <= n; i++) {
      D[i][0] = i; B[i][0] = 1;
      for (let j = 1; j <= m; j++) {
        const s = sim[i][j] = fit(t[i - 1], E[j - 1].nt);
        const sub = D[i - 1][j - 1] + (s >= 0.75 ? 0 : s >= 0.45 ? 0.6 : 1);
        const ins = D[i - 1][j] + 1, del = D[i][j - 1] + 1;
        if (sub <= ins && sub <= del) { D[i][j] = sub; B[i][j] = 0; }
        else if (del <= ins) { D[i][j] = del; B[i][j] = 2; }
        else { D[i][j] = ins; B[i][j] = 1; }
      }
    }
    let end = 0;
    for (let j = 1; j <= m; j++) if (D[n][j] <= D[n][end]) end = j;
    const marks = [];
    let ok = 0, i = n, j = end;
    while (i > 0 || j > 0) {
      if (i === 0) { if (j - 1 >= free) marks.push([s0 + j - 1, 'skip']); j--; continue; }
      const b = j === 0 ? 1 : B[i][j];
      if (b === 0) { if (sim[i][j] >= 0.75) ok++; else marks.push([s0 + j - 1, 'wrong']); i--; j--; }
      else if (b === 2) { marks.push([s0 + j - 1, 'skip']); j--; }
      else i--;
    }
    if (ok < Math.max(1, Math.ceil(n * 0.4))) return null;
    const at = Math.max(pos, s0 + end);
    return { end: at, marks: freeStart ? [] : marks.filter(([k]) => k >= pos && k < at) };
  }

  // every half second: the clock, and a hidden word that has kept the reader silent
  function tick() {
    if (!G?.run) return;
    if (G.hide && !G.peek && !G.voice && !G.busy && Date.now() - G.lastAct > HINT_AFTER) {
      G.peek = true;
      G.errs[G.pos] ||= 'hint';
      paint(); paintBar();
    }
  }

  // turn the page when the next word is on another one
  function follow() {
    const w = G.words[Math.min(G.pos, G.words.length - 1)];
    if (w.p === G.lastP) return;
    G.lastP = w.p;
    if (w.p !== S.page) goTo(w.p, { animate: Math.abs(w.p - S.page) === 1 });
  }

  // ---- the mic bubble: recite, and the aya is found

  let F = null;
  function find() {
    withModel(() => {
      if (G) return;
      F = { tries: 0, busy: false, voice: false };
      syncBubble();
      const f = F;
      Listen.start(audio => {
        if (F !== f || f.busy) return;
        f.busy = true; syncBubble();
        Listen.transcribe(audio).then(text => {
          if (F !== f) return;
          f.busy = false;
          const ai = locate(text);
          if (ai == null) {
            if (++f.tries >= 3) { stopFind(); toast('لم أجد الآية — جرّب مقطعًا أطول'); } else syncBubble();
            return;
          }
          stopFind();
          start(ai, null, { seed: text });
          toast(ayaLabel(ai));
        });
      }, on => { if (F === f) { f.voice = on; syncBubble(); } })
        .catch(() => { stopFind(); toast('لا يمكن الوصول إلى الميكروفون — اسمح به من إعدادات المتصفح'); });
    });
  }
  function stopFind() {
    if (!F) return;
    F = null;
    Listen.stop();
    syncBubble();
  }
  function locate(text) {
    if (norm(text).trim().split(/\s+/).length < 2) return null;
    buildIndex();
    const best = ayaScore(text)[0];
    if (!best || best.score < 0.8) return null;
    const ai = R.fromHafs[best.h];
    return ai >= 0 ? ai : null;
  }

  // the bubble keeps out of the way of every bar, sheet and dialog
  const COVERS = ['#sheet', '#library', '#adhkar', '#tafsir', '#ayaBar', '#player', '#recBar', '#recWord', '#recIntro', '#recDone', '#khEdit', '#done'];
  function syncBubble() {
    const b = $('#micBubble');
    if (!b) return;
    const blocked = typeof R === 'undefined' || !R || !!G || COVERS.some(s => panelOpen($(s)));
    b.hidden = blocked && !F;
    b.classList.toggle('open', !!F);
    b.classList.toggle('voice', !!F?.voice);
    $('#micBubbleTxt').textContent = !F ? '' : F.busy ? 'أبحث عن الآية…' : F.voice ? 'أستمع…' : 'اقرأ آيةً، وأجدها لك';
    b.setAttribute('aria-label', F ? 'إيقاف' : 'اقرأ آيةً لأجدها');
  }
  $('#micBubble').onclick = () => (F ? stopFind() : find());

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
        else if (k === G.pos) { el.classList.add('rc-now'); if (G.hide) el.classList.add(G.peek ? 'rc-peek' : 'rc-hid'); }
        else if (G.hide) el.classList.add('rc-hid');
      });
    }
  }

  function paintBar() {
    if (!G) return;
    const w = G.words[Math.min(G.pos, G.words.length - 1)];
    const n = liveErrs().length;
    $('#recTitle').textContent = !G.run ? (G.pos ? 'متوقف مؤقتًا' : 'اضغط وابدأ القراءة')
      : G.busy ? 'يتعرّف على ما قرأت…' : G.voice ? 'يستمع…' : G.peek ? 'هذه الكلمة التالية' : 'اقرأ، أنا أستمع';
    $('#recSub').textContent = `${ayaLabel(w.ai)}${n ? ' · ' + errs(n) : ''}`;
    $('#recToggle').classList.toggle('voice', !!G.voice);
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
    G.done = true;
    hide($('#recBar')); hide($('#recWord'));
    paint();
    paintDone();
    show($('#recDone'));
  }

  function paintDone() {
    const said = G.words.slice(0, G.pos), list = liveErrs();
    const first = G.words[0].ai, last = said[said.length - 1].ai;
    $('#rdTitle').textContent = list.length ? 'انتهت الجلسة' : 'ما شاء الله، بلا أخطاء';
    $('#rdRange').textContent = G.test ? `اختبار · ${ayaLabel(first)}` : G.review ? `مراجعة مواضع الضعف · ${ayaCount(new Set(said.map(w => w.ai)).size)}`
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
    l.said ||= {}; l.days ||= {};
    for (const [ai, list] of byAya) if (list.length === list[0][0].of) l.said[ai] = Date.now();
    l.days[today] = (l.days[today] || 0) + byAya.size;
    const days = Object.keys(l.days);
    if (days.length > 400) days.slice(0, days.length - 400).forEach(d => delete l.days[d]);
    l.sessions.unshift({ t: Date.now(), from: said[0].ai, to: said[said.length - 1].ai, ayas: byAya.size,
      words: said.length, errs: liveErrs().length, secs: Math.round(G.secs), review: G.review, test: G.test,
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
    // the hidden word you are on: a peek, counted as a hint
    if (k === G.pos && G.hide && !G.done && !G.peek) {
      G.peek = true; G.errs[k] = 'hint';
      G.lastAct = Date.now();
      paint(); paintBar();
      return true;
    }
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
    const range = s.from === s.to ? ayaLabel(s.from) : `${ayaLabel(s.from)} – ${ar(R.ayas[s.to][1])}`;
    return s.test ? `اختبار · ${range}` : range;
  }

  const streakText = n => !n ? 'سمّع اليوم لتبدأ سلسلة الأيام' : n === 1 ? 'بدأت سلسلة الأيام، عُد غدًا'
    : n === 2 ? 'يومان متتاليان' : n <= 10 ? `${ar(n)} أيام متتالية` : `${ar(n)} يومًا متتاليًا`;

  // days in a row with a session, up to today (or yesterday, before today's)
  function streak(l) {
    const d = new Date();
    if (!l.days?.[day(d)]) d.setDate(d.getDate() - 1);
    let n = 0;
    while (l.days?.[day(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // ayas in each surah of this riwaya
  let suraSize = null;
  function suraSizes() {
    if (suraSize?.rid === R.id) return suraSize.n;
    const n = new Array(115).fill(0);
    R.ayas.forEach(a => { n[a[0]]++; });
    suraSize = { rid: R.id, n };
    return n;
  }

  // «اختبرني»: three ayas from a random place already recited, words hidden
  function testAyas() {
    const said = Object.keys(log().said || {}).map(Number).filter(ai => R.ayas[ai]);
    if (said.length < 3) return null;
    const a = said[Math.floor(Math.random() * said.length)];
    const out = [a];
    for (let b = a + 1; out.length < 3 && R.ayas[b] && R.ayas[b][0] === R.ayas[a][0]; b++) out.push(b);
    return out;
  }

  function trackerHTML(l, weak) {
    const said = l.said || {}, sizes = suraSizes();
    const got = new Array(115).fill(0), weakIn = new Set(weak.map(([ai]) => R.ayas[ai][0]));
    for (const ai of Object.keys(said)) if (R.ayas[+ai]) got[R.ayas[+ai][0]]++;
    let full = 0, some = 0, tiles = '';
    for (let s = 1; s <= 114; s++) {
      const f = sizes[s] ? got[s] / sizes[s] : 0;
      const lvl = f === 0 ? 0 : f < 1 / 3 ? 1 : f < 2 / 3 ? 2 : f < 1 ? 3 : 4;
      if (lvl === 4) full++; else if (lvl) some++;
      tiles += `<button class="rc-tile l${lvl}${weakIn.has(s) ? ' weak' : ''}" data-rc-sura="${s}" aria-label="${suraName(s)}: ${ar(got[s])} من ${ar(sizes[s])}">${ar(s)}</button>`;
    }
    return `<div class="group-label">متابعة الحفظ</div>
      <p class="rc-track-sum">${ar(full)} سورة كاملة · ${ar(some)} بدأتها</p>
      <div class="rc-tiles">${tiles}</div>
      <div class="rc-legend"><span><i class="rc-tile l1"></i>بدأتها</span><span><i class="rc-tile l4"></i>كاملة</span><span><i class="rc-tile l2 weak"></i>فيها مواضع ضعف</span></div>`;
  }

  function panelHTML() {
    const l = log();
    const all = Object.entries(l.ayas).map(([ai, a]) => [+ai, a]).filter(([ai]) => R.ayas[ai]);
    const weak = all.filter(([, a]) => !a.done).sort((x, y) => x[0] - y[0]);
    const mastered = all.filter(([, a]) => a.done).sort((x, y) => y[1].at - x[1].at);
    const goal = store.get('recite.goal', 0);
    const settings = `<div class="group-label">إعدادات التسميع</div><div class="group">
      ${toggle('hide', 'ابدأ والكلمات مخفية', 'تظهر كل كلمة حين تقرؤها')}
      ${toggle('weak', 'مواضع الضعف في المصحف', 'خط منقّط خفيف تحت كلمات أخطأت فيها')}
      <div class="row rc-model"><span class="main"><span class="t">نموذج التعرّف على التلاوة</span><span class="s" id="rcModelS">…</span></span><span id="rcModelB"></span></div>
      <div class="row rc-goal"><span class="main"><span class="t">هدف يومي</span><span class="s">عدد الآيات التي تسمّعها كل يوم</span></span>
        <span class="rc-chips">${[0, 5, 10, 20].map(n => `<button data-rc-goal="${n}"${goal === n ? ' class="on"' : ''}>${n ? ar(n) : 'لا'}</button>`).join('')}</span></div></div>`;

    if (!all.length && !l.sessions.length) {
      return `<div class="rc-welcome"><div class="rc-badge">${MIC}</div><h2>التسميع</h2>
        <p>اقرأ من حفظك، ويتابعك التطبيق كلمةً كلمة، وينبّهك إلى ما أخطأت فيه ويحفظه هنا لتراجعه. يحتاج أول مرة إلى تنزيل نموذج التعرّف على التلاوة.</p>
        <button class="rc-review" data-rc-resume>${MIC}ابدأ من ${ayaLabel(pageInfo(S.page).first)}</button>
        <p class="note">أو اضغط رقم أي آية في المصحف ثم «تسميع».</p></div>${settings}`;
    }

    const now = Date.now(), wk = now - 7 * 864e5, wk2 = now - 14 * 864e5;
    const thisW = l.sessions.filter(s => s.t >= wk), lastW = l.sessions.filter(s => s.t >= wk2 && s.t < wk);
    const sum = (list, f) => list.reduce((s, x) => s + (x[f] || 0), 0);
    const e1 = sum(thisW, 'errs'), e0 = sum(lastW, 'errs');
    const trend = e0 ? (e1 <= e0 ? `الأخطاء أقل بـ ${ar(Math.round((1 - e1 / e0) * 100))}٪ من الأسبوع الماضي` : 'الأخطاء أكثر من الأسبوع الماضي') : '';
    const today = l.days?.[day()] || 0, run = streak(l);
    const C = 2 * Math.PI * 19, done = goal ? Math.min(1, today / goal) : 0;
    const ring = goal ? `<svg viewBox="0 0 44 44" class="rc-ring${today >= goal ? ' full' : ''}"><circle cx="22" cy="22" r="19" class="trk"/>
      <circle cx="22" cy="22" r="19" class="val" style="stroke-dasharray:${(done * C).toFixed(1)} ${C.toFixed(1)}"/></svg>` : '';
    const test = testAyas();
    let html = `<div class="rc-hero"><div class="rc-today">${ring ? `<div class="rc-ring-w">${ring}<b>${ar(today)}</b></div>` : ''}
      <div class="rc-today-t"><b>${goal ? (today >= goal ? 'بلغت هدف اليوم، ما شاء الله' : `اليوم ${ar(today)} من ${ayaCount(goal)}`) : `اليوم: ${today ? ayaCount(today) : 'لم تسمّع بعد'}`}</b>
      <small>${streakText(run)}</small></div></div>
      <div class="rc-hero-l">هذا الأسبوع</div>
      <div class="rc-hero-n"><div><b>${ar(thisW.length)}</b><small>جلسة</small></div><div><b>${ar(sum(thisW, 'ayas'))}</b><small>آية</small></div><div><b>${ar(e1)}</b><small>خطأ</small></div></div>
      ${trend ? `<div class="rc-hero-t">${trend}</div>` : ''}</div>
      <div class="rc-actions"><button class="rc-review" data-rc-resume>${MIC}تابع من ${ayaLabel(resumeAya())}</button>
      ${test ? `<button class="rc-review ghost" data-rc-test>اختبرني من حفظي</button>` : ''}
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
    if (Object.keys(l.said || {}).length) html += trackerHTML(l, weak);

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

  // the model row in the settings, once the panel is on screen
  function mounted() {
    Listen.saved().then(have => {
      const s = $('#rcModelS'), b = $('#rcModelB');
      if (!s) return;
      s.textContent = have ? `على جهازك · ${ar(Listen.MODEL_MB)} م.ب · يعمل دون إنترنت` : `غير منزّل · ${ar(Listen.MODEL_MB)} م.ب`;
      b.innerHTML = `<button class="rc-not" data-rc-model="${have ? 'del' : 'get'}">${have ? 'حذف' : 'تنزيل'}</button>`;
    });
  }

  function weakAyas() {
    return Object.entries(log().ayas).filter(([ai, a]) => !a.done && R.ayas[+ai]).map(([ai]) => +ai).sort((a, b) => a - b);
  }

  function onSheetClick(e) {
    const one = e.target.closest('[data-rc-start]');
    if (one) { e.stopPropagation(); closeSheet(); start(null, [+one.dataset.rcStart]); return true; }
    if (e.target.closest('[data-rc-resume]')) { closeSheet(); start(resumeAya()); return true; }
    if (e.target.closest('[data-rc-review]')) { closeSheet(); start(null, weakAyas()); return true; }
    if (e.target.closest('[data-rc-test]')) { const t = testAyas(); if (t) { closeSheet(); start(null, t, { test: true }); } return true; }
    const md = e.target.closest('[data-rc-model]');
    if (md) {
      if (md.dataset.rcModel === 'get') withModel(() => mounted());
      else Listen.remove().then(() => { toast('حُذف النموذج من جهازك'); mounted(); });
      return true;
    }
    const g = e.target.closest('[data-rc-goal]');
    if (g) {
      store.set('recite.goal', +g.dataset.rcGoal);
      const y = $('#sheetBody').scrollTop;
      renderSheet();
      $('#sheetBody').scrollTop = y;
      return true;
    }
    const su = e.target.closest('[data-rc-sura]');
    if (su) { closeSheet(); goTo(R.ayas[R.suraStart[+su.dataset.rcSura]][2]); return true; }
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

  $('#riGo').onclick = () => {
    Listen.prime();
    paintDl(0);
    Listen.load(paintDl).then(() => {
      hide($('#recIntro'));
      paintDl();
      toast('نُزّل النموذج، ويعمل الآن دون إنترنت');
      const f = pending;
      pending = null;
      f?.();
    }, () => { paintDl(); toast('تعذر التنزيل — تحقق من الاتصال'); });
  };
  $('#riLater').onclick = () => { pending = null; hide($('#recIntro')); };

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

  syncBubble();

  return { start, cancel, paint, onTap, note, syncBubble, panelHTML, mounted, onSheetClick, active: () => !!G };
})();
