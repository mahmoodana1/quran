'use strict';

// Recitation from memory (التسميع). The reader recites from an aya on and the
// page follows, marking words that were said wrong, skipped or needed a hint;
// «إخفاء» hides the words still to come, and touching the hidden word you are
// on peeks at it (counted as a hint). Mistakes are kept per riwaya, by aya; an
// aya counts as mastered after three clean recitations on different days, and
// a new mistake there starts the count again. The panel keeps a daily goal and
// streak, a tracker of every surah recited from memory, and «اختبرني», which
// starts at a random place already recited.
// In Hafs, listening is Muaalem (mu.js): a model that writes what the reader
// actually says, harakat included, read again every quarter second over the
// last 2.5 s; match.js lines that up with how the aya should sound, word by
// word, so a wrong haraka, a wrong or skipped word shows as such, and the
// reader is followed from aya to aya. The model that runs fastest on the
// device is found first and downloaded once.
// In the other riwayat, listening (listen.js) is a Whisper model: each phrase
// said between pauses is lined up against the words expected from where the
// reader is (align).
// The mic in the page header: recite any aya and it is found, opened and
// followed from there.
// Uses $, store, ar, esc, show, hide, toast, R, S, isEnd, norm,
// lev, wordSim, buildIndex, ayaScore, goTo, pageInfo, paintMarks, closeActions,
// stopAudio, speakWord, suraName, ayaLabel, openRecite, renderSheet,
// closeSheet and flashAya from app.js at call time.
const Recite = (() => {
  const TYPES = { wrong: 'قرأتها بكلمة أخرى', haraka: 'أخطأت في حركتها', skip: 'تجاوزتها', hint: 'احتجت تلميحًا' };
  const MASTER_DAYS = 3;
  const HINT_AFTER = 7000; // ms of silence on a hidden word before it shows
  const CLS = ['rc-weak', 'rc-done', 'rc-now', 'rc-hid', 'rc-peek', 'rc-wrong', 'rc-haraka', 'rc-skip', 'rc-hint'];
  // Muaalem listens in Hafs (its phonetic script is Hafs's)
  const MU = () => R.id === 'hafs' && typeof Mu !== 'undefined';
  const MU_NAMES = { 'q8-cpu': '٨ بت · المعالج', 'q8-gpu': '٨ بت · المعالج الرسومي', 'fp16-gpu': '١٦ بت · المعالج الرسومي', 'q4-cpu': '٤ بت · المعالج', 'q4-gpu': '٤ بت · المعالج الرسومي' };
  const ready = () => MU() ? Mu.ready() : Listen.ready();

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
    if (MU()) {
      Mu.prime();
      if (Mu.ready()) return Mu.sounds().then(then, () => toast('تعذر تحضير التسميع'));
      if (!Mu.choice()) { pending = then; paintDl(); show($('#recIntro')); return; }
      Mu.saved().then(have => {
        if (!have) { pending = then; paintDl(); show($('#recIntro')); return; }
        toast('جارٍ تحضير التسميع…');
        Promise.all([Mu.load(), Mu.sounds()]).then(then, () => toast('تعذر تحضير التسميع'));
      });
      return;
    }
    Listen.prime();
    if (Listen.ready()) return then();
    Listen.saved().then(have => {
      if (!have) { pending = then; paintDl(); show($('#recIntro')); return; }
      toast('جارٍ تحضير التسميع…');
      Listen.load().then(then, () => toast('تعذر تحضير التسميع'));
    });
  }

  // p: 0..1 while downloading, 'probe' while timing the models on this device
  function paintDl(p) {
    const busy = p != null;
    if (p === 'probe') {
      $('#riProg').hidden = true; $('#riGo').disabled = true; $('#riLater').hidden = true;
      $('#riGo').textContent = 'نختبر أسرع نموذج لجهازك…';
      return;
    }
    $('#riProg').hidden = !busy;
    $('#riGo').disabled = busy;
    $('#riLater').hidden = busy;
    $('#riBar').style.width = ((p || 0) * 100).toFixed(1) + '%';
    $('#riPct').textContent = ar(Math.round((p || 0) * 100)) + '٪';
    const c = MU() && Mu.choice();
    $('#recIntro .rc-demo').textContent = c
      ? `الأسرع على جهازك: نموذج معلّم ${MU_NAMES[c.id]} · نحو ${ar(c.ms)} م.ث لكل تحديث. يُنزَّل مرة واحدة ويبقى على جهازك، ويكشف أخطاء الحركات أيضًا.`
      : MU() ? 'يحتاج التسميع إلى نموذج التعرّف على التلاوة. نختبر أولًا أيّ نسخه أسرع على جهازك (ثوانٍ)، ثم يُنزَّل مرة واحدة ويبقى عليه.'
      : 'يحتاج التسميع إلى نموذج التعرّف على التلاوة، يُنزَّل مرة واحدة ويبقى على جهازك.';
    $('#riGo').textContent = busy ? 'جارٍ التنزيل…'
      : !MU() ? `تنزيل النموذج · ${ar(Listen.mb())} م.ب`
      : Mu.choice() ? `تنزيل النموذج · ${ar(Mu.mb())} م.ب` : 'اختبر جهازك ونزّل النموذج';
  }

  // ---- session

  // from an aya to the end of its surah, or just the ayas given (a review or a test);
  // opts.test hides the words, opts.seed is the phrase that found the aya (bubble)
  function start(from, review, opts = {}) {
    if (!ready()) return withModel(() => start(from, review, opts));
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
      review: !!review && !opts.test, test: !!opts.test, lastP: null, miss: 0, tent: 0 };
    // Muaalem: c = the aya being said (in G.ayas), w0 = its first word still to
    // match, cut = how much of the reading belongs to ayas already done
    if (MU()) {
      const starts = [];
      words.forEach((w, k) => { if (w.wi === 0) starts.push(k); });
      G.mu = { c: 0, w0: 0, cut: 0, final: '', tent: '', starts, lead: true, stream: !!opts.stream };
    }
    // found by reciting: what was already said counts as said
    if (opts.seed) { const r = align(opts.seed, 0, words[0].of); if (r) G.pos = Math.min(r.end, words.length - 1); }
    dirty = true;
    store.set('recite.used', true);
    follow();
    paintMarks();
    paintBar();
    show($('#recBar'));
    syncBubble();
    resume();
  }

  function resume() {
    if (!G || G.run || G.done) return;
    G.run = true; G.t = G.lastAct = Date.now();
    hide($('#recWord'));
    const g = G;
    const noMic = () => { if (G === g) { pause(); toast('لا يمكن الوصول إلى الميكروفون — اسمح به من إعدادات المتصفح'); } };
    if (MU()) {
      const h = d => onMu(g, d);
      if (g.mu.stream && Mu.listening()) { g.mu.stream = false; Mu.listen(h); } // the reading that found the aya goes on
      else Mu.start(h).catch(noMic);
    } else Listen.start(audio => onPhrase(g, audio), on => { if (G === g) { G.voice = on; if (on) G.lastAct = Date.now(); paintBar(); } }, audio => onPartial(g, audio))
      .catch(noMic);
    clearInterval(timer);
    timer = setInterval(tick, 500);
    paintBar();
  }
  function pause() {
    if (!G?.run) return;
    G.run = false; G.voice = false; G.secs += (Date.now() - G.t) / 1000;
    clearInterval(timer);
    if (MU()) {
      // what was read to the end counts; the next stretch is matched from the first word not yet said
      const g = G;
      Mu.stop().then(() => {
        if (G !== g || !g.mu) return;
        g.mu.tent = '';
        muFollow(false);
        if (g.done) { muSettle(); paint(); paintDone(); return; }
        const m = g.mu;
        m.w0 = Math.max(0, Math.min(G.pos - m.starts[m.c], G.words[m.starts[m.c]].of));
        if (m.w0 >= G.words[m.starts[m.c]].of && m.c + 1 < G.ayas.length) { m.c++; m.w0 = 0; }
        m.cut = 0; m.final = ''; m.lead = false;
      });
    } else Listen.stop();
    paintBar();
  }

  // drop the session without keeping anything
  function cancel() {
    if (!G) return;
    clearInterval(timer);
    if (G.mu) Mu.stop(); else Listen.stop();
    G = null; S.focus = null;
    ['#recBar', '#recWord', '#recDone'].forEach(s => hide($(s)));
    paintMarks();
    syncBubble();
  }

  // while the reader is still going: a look at the phrase so far reveals the
  // words it reaches (no mistakes are marked until the phrase is finished)
  function onPartial(g, audio) {
    if (g.busy || g.partial) return; // never hold up a finished phrase
    g.partial = true;
    Listen.transcribe(audio).then(text => {
      g.partial = false;
      if (G !== g || g.done || g.busy) return;
      const r = align(text, g.pos);
      if (r && r.fit >= 0.75 && r.end > Math.max(g.pos, g.tent)) { g.tent = r.end; follow(); paint(); }
    });
  }

  // ---- Muaalem: the reading so far, matched against the aya being said and
  // the next one together; once the next one has begun, the one before is
  // closed (words never reached count as skipped)
  const MU_TYPE = { haraka: 'haraka', letter: 'wrong', extra: 'wrong', skipped: 'skip' };
  function onMu(g, d) {
    if (G !== g) return;
    if (g.done) { g.mu.final = d.final; g.mu.tent = d.tent; return; } // the last of it, read after «finish»: pause() applies it
    const m = g.mu, grew = d.final.length + d.tent.length !== m.final.length + m.tent.length;
    m.final = d.final; m.tent = d.tent;
    if (grew && g.run) {
      g.lastAct = Date.now();
      if (!g.voice) { g.voice = true; paintBar(); }
      clearTimeout(g.voiceT);
      g.voiceT = setTimeout(() => { if (G === g) { g.voice = false; paintBar(); } }, 900);
    }
    muFollow(false);
  }
  function muFollow(done) {
    const m = G.mu, U = Match.units(m.final + m.tent), uf = Match.units(m.final).length;
    for (let guard = 0; guard < 40 && m.c < G.ayas.length; guard++) {
      const ai = G.ayas[m.c], nx = done ? null : G.ayas[m.c + 1];
      const cur = Mu.expect(ai, m.w0), ex = nx != null ? Mu.expect2(cur, Mu.expect(nx)) : cur;
      const sub = Match.text(U.slice(m.cut)), fin = Match.text(U.slice(m.cut, Math.max(m.cut, uf))).length;
      const st = Match.words(ex, sub, fin, done, { freeLead: m.lead });
      const n0 = cur.spans.length;
      const begun = nx != null && st.slice(n0, n0 + 2).some(x => x.state === 'ok' || x.state === 'err');
      muApply(st.slice(0, n0), begun);
      if (!begun) { if (!done && muRelocate(st.slice(0, n0), sub, fin)) continue; break; }
      m.cut += st[n0].at[0]; m.c++; m.w0 = 0; m.lead = false;
    }
    if (G.pos >= G.words.length) return finish();
    follow();
    paint();
    paintBar();
  }
  // the session is over: the words of the aya being said that were begun are
  // judged as they were said (the reading's end is their end); the rest stay unsaid
  function muSettle() {
    const m = G.mu;
    if (m.c >= G.ayas.length) return;
    const U = Match.units(m.final), sub = Match.text(U.slice(m.cut));
    const cur = Mu.expect(G.ayas[m.c], m.w0);
    const st = Match.words(cur, sub, sub.length, false, { freeLead: m.lead });
    const t = st.findLastIndex(x => x.state !== 'todo');
    if (t < 0) return;
    const part = { ph: cur.ph.slice(0, cur.spans[t][1]), spans: cur.spans.slice(0, t + 1), wasl: cur.wasl.filter(k => k <= t) };
    const fin = Match.words(part, sub, sub.length, true, { freeLead: m.lead });
    muApply(fin.concat(st.slice(t + 1)), false);
  }

  // the words of the aya being said, from w0: what each turned out to be
  function muApply(states, closing) {
    const m = G.mu, base = m.starts[m.c] + m.w0, skips = [];
    let pos = base, tent = base, fresh = false;
    states.forEach((x, i) => {
      const k = base + i;
      let decided = x.state === 'ok' || x.state === 'err', e = null;
      if (x.state === 'err') e = MU_TYPE[x.type] || (x.heard && x.heard.length > 1 ? 'wrong' : 'skip');
      else if (closing && !decided) { decided = true; e = 'skip'; }
      if (decided) {
        pos = tent = k + 1;
        if (e) {
          if (G.errs[k] !== e && G.errs[k] !== 'hint') { G.errs[k] = e; fresh = true; }
          if (e === 'skip') skips.push([k, 'skip']);
        } else if (G.errs[k] && G.errs[k] !== 'hint') delete G.errs[k];
      } else if (x.state === 'hear') tent = k + 1;
    });
    if (pos > G.pos) G.peek = false;
    G.pos = pos; G.tent = tent;
    if (fresh && navigator.vibrate) navigator.vibrate(12);
    warnSkipped(skips);
  }
  // nothing of the aya being said is heard, but plenty is: another aya of the
  // session it fits clearly (a skip ahead, or a step back)
  function muRelocate(states, sub, fin) {
    const m = G.mu;
    if (Date.now() - (m.relocAt || 0) < 800 || states.some(x => x.state === 'ok')) return false;
    if (Match.units(sub).length < 25) return false;
    m.relocAt = Date.now();
    let best = null;
    for (let j = Math.max(0, m.c - 3); j < Math.min(G.ayas.length, m.c + 9); j++) {
      if (j === m.c || j === m.c + 1) continue;
      const st = Match.words(Mu.expect(G.ayas[j]), sub, fin, false, { freeLead: true });
      const ok = st.filter(x => x.state === 'ok').length, bad = st.filter(x => x.state === 'err').length;
      if (ok >= 3 && ok / (ok + bad) >= 0.7 && (!best || ok > best.ok)) best = { j, ok };
    }
    if (!best) return false;
    if (best.j > m.c) {
      const marks = [];
      for (let k = G.pos; k < m.starts[best.j]; k++) { if (G.errs[k] !== 'hint') G.errs[k] = 'skip'; marks.push([k, 'skip']); }
      warnSkipped(marks);
    } else toast(`رجعت إلى الآية ${ar(R.ayas[G.ayas[best.j]][1])}`);
    m.c = best.j; m.w0 = 0; m.lead = true;
    G.pos = G.tent = m.starts[best.j];
    return true;
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
    G.tent = 0;
    let r = align(text, G.pos);
    // another aya of this surah that fits clearly better (ayas that open
    // alike, as al-Mulk 2 and 3, would otherwise pass for wrong words)
    const j = !r || r.fit < 0.85 ? relocate(text) : null;
    if (j && (!r || j.score > r.fit + 0.25)) r = null;
    if (!r) {
      if (!j) {
        if (norm(text).trim() && ++G.miss >= 2) { toast('لم أتبيّن القراءة، أعد من موضعك'); G.miss = 0; }
        paint();
        return;
      }
      if (j.k > G.pos) {
        const skipped = [];
        for (let k = G.pos; k < j.k; k++) skipped.push([k, 'skip']);
        r = { end: j.end, marks: skipped };
      } else {
        toast(`رجعت إلى الآية ${ar(R.ayas[G.words[j.k].ai][1])}`);
        r = { end: j.end, marks: [] };
        G.pos = j.k;
      }
    }
    G.miss = 0;
    let marked = false;
    for (const [k, e] of r.marks) if (!G.errs[k]) { G.errs[k] = e; marked = true; }
    warnSkipped(r.marks);
    if (marked && navigator.vibrate) navigator.vibrate(12);
    if (r.end > G.pos || r.end < G.pos) { G.pos = r.end; G.peek = false; }
    if (G.pos >= G.words.length) return finish();
    follow();
    paint();
  }

  // a phrase that does not fit where the reader is: the aya of the session it
  // starts best, with where it ends there
  function relocate(text) {
    const t = norm(text).split(/\s+/).filter(Boolean);
    if (t.length < 2) return null;
    let best = null;
    G.words.forEach((w, k0) => {
      if (w.wi !== 0 || Math.abs(k0 - G.pos) < 3) return;
      // in-order matches of the phrase's words in this aya's opening
      const lim = Math.min(G.words.length, k0 + t.length + 4);
      let q = k0, ok = 0;
      for (const x of t) {
        for (let y = q; y < lim; y++) if (fit(x, G.words[y].nt) >= 0.75) { ok++; q = y + 1; break; }
      }
      const score = ok / t.length;
      if (score >= 0.6 && (!best || score > best.score)) best = { k: k0, score };
    });
    if (!best) return null;
    const r = align(text, best.k, G.words[best.k].of);
    return r ? { k: best.k, end: r.end, score: best.score } : null;
  }

  // whole ayas among the skipped words: say so
  function warnSkipped(marks) {
    const skipped = new Set(marks.filter(([, e]) => e === 'skip').map(([k]) => k));
    const ayas = [];
    for (const k of skipped) {
      const w = G.words[k];
      if (w.wi === 0 && !ayas.includes(w.ai) && [...Array(w.of).keys()].every(i => skipped.has(k + i))) ayas.push(w.ai);
    }
    if (!ayas.length) return;
    ayas.sort((a, b) => a - b);
    const n = a => ar(R.ayas[a][1]);
    toast(ayas.length === 1 ? `تنبيه: تجاوزت الآية ${n(ayas[0])}` : `تنبيه: تجاوزت الآيات ${n(ayas[0])}–${n(ayas[ayas.length - 1])}`);
    $('#recBar').classList.remove('warn'); void $('#recBar').offsetWidth; $('#recBar').classList.add('warn');
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
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
    return { end: at, fit: ok / n, marks: freeStart ? [] : marks.filter(([k]) => k >= pos && k < at) };
  }

  // every half second: the clock, and a hidden word that has kept the reader silent
  function tick() {
    if (!G?.run) return;
    if (G.hide && !G.peek && !G.voice && !G.busy && Date.now() - G.lastAct > HINT_AFTER) {
      G.peek = true;
      G.errs[Math.max(G.pos, G.tent)] ||= 'hint';
      paint(); paintBar();
    }
  }

  // the band follows the aya being recited; turn the page when the next word is on another one
  function follow() {
    const w = G.words[Math.min(Math.max(G.pos, G.tent), G.words.length - 1)];
    if (S.focus !== w.ai) { S.focus = w.ai; drawBands(document); }
    if (w.p === G.lastP) return;
    G.lastP = w.p;
    if (w.p !== S.page) goTo(w.p, { animate: Math.abs(w.p - S.page) === 1 });
  }

  // ---- the header mic: recite, and the aya is found

  let F = null;
  function find() {
    if (MU()) return findMu();
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
    if (MU()) Mu.stop(); else Listen.stop();
    syncBubble();
  }
  // Muaalem: the reading so far, looked up among all ayas by its consonants,
  // the likeliest checked word by word; the session then goes on with it
  function findMu() {
    withModel(() => {
      if (G) return;
      F = { tries: 0, busy: false, voice: false };
      syncBubble();
      const f = F;
      Mu.start(d => {
        if (F !== f) return;
        if (!f.voice) { f.voice = true; syncBubble(); }
        clearTimeout(f.vt);
        f.vt = setTimeout(() => { if (F === f) { f.voice = false; syncBubble(); } }, 900);
        const h = d.final + d.tent, n = Match.units(h).length;
        if (n < 24 || Date.now() - (f.at || 0) < 500) return;
        f.at = Date.now();
        // many ayas open alike: go only once one fits clearly better than any
        // other, and has stayed the best for a second; ayas said the same way
        // (as in ar-Rahman) are told apart, after a while, by the page open
        const r = locateMu(h);
        f.same = r && r.ai === f.last ? (f.same || 0) + 1 : 0;
        f.last = r?.ai;
        const sure = r && f.same >= 2 && (r.ok - r.next >= 2 || (n > 150 && f.same >= 4));
        if (!sure) { if (n > 320) { stopFind(); toast('لم أجد الآية — جرّب من بداية آية'); } return; }
        const ai = r.ai;
        F = null; // the reading goes on, now as the session's
        syncBubble();
        start(ai, null, { stream: true });
        toast(ayaLabel(ai));
      }).catch(() => { stopFind(); toast('لا يمكن الوصول إلى الميكروفون — اسمح به من إعدادات المتصفح'); });
    });
  }
  // the aya the reading fits best: { ai, ok (words right), next (the runner-up's) },
  // equal fits going to the one nearest the page open
  function locateMu(h) {
    const fits = [];
    for (const { ai } of Mu.candidates(h, 12)) {
      const st = Match.words(Mu.expect(ai), h, h.length, false, { freeLead: true });
      const ok = st.filter(x => x.state === 'ok').length, bad = st.filter(x => x.state === 'err').length;
      if (ok >= 4 && ok / (ok + bad) >= 0.75) fits.push({ ai, ok, far: Math.abs(R.ayas[ai][2] - S.page) });
    }
    if (!fits.length) return null;
    fits.sort((a, b) => b.ok - a.ok || a.far - b.far);
    return { ai: fits[0].ai, ok: fits[0].ok, next: fits[1]?.ok ?? 0 };
  }
  function locate(text) {
    if (norm(text).trim().split(/\s+/).length < 2) return null;
    buildIndex();
    const best = ayaScore(text)[0];
    if (!best || best.score < 0.8) return null;
    const ai = R.fromHafs[best.h];
    return ai >= 0 ? ai : null;
  }

  // while listening, a pill over the header row says so; the header mics
  // step aside during a session, when the reciting bar has its own
  function syncBubble() {
    const pill = $('#micPill');
    pill.hidden = !F;
    pill.classList.toggle('voice', !!F?.voice);
    $('#micPillTxt').textContent = !F ? '' : F.busy ? 'أبحث عن الآية…' : F.voice ? 'أستمع…' : 'اقرأ آيةً، وأجدها لك';
    document.body.classList.toggle('rc-on', !!G);
    document.body.classList.toggle('rc-find', !!F);
  }
  const mic = () => (F ? stopFind() : G ? null : find());
  $('#micPillX').onclick = stopFind;

  const liveErrs = () => Object.keys(G.errs).map(Number).filter(k => !G.gone.has(k)).sort((a, b) => a - b);

  // the session's mistakes as the reader sees them: a whole aya skipped is one
  // ({ k: its first word, aya }), any other word on its own ({ k, e })
  function mistakes(withGone = false) {
    const ks = Object.keys(G.errs).map(Number).filter(k => withGone || !G.gone.has(k)).sort((a, b) => a - b);
    const set = new Set(ks), out = [], seen = new Set();
    for (const k of ks) {
      if (seen.has(k)) continue;
      const w = G.words[k];
      if (G.errs[k] === 'skip' && w.wi === 0 && [...Array(w.of).keys()].every(i => set.has(k + i) && G.errs[k + i] === 'skip')) {
        for (let i = 0; i < w.of; i++) seen.add(k + i);
        out.push({ k, aya: w.ai });
      } else out.push({ k, e: G.errs[k] });
    }
    return out;
  }

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
        const cur = Math.max(G.pos, G.tent);
        if (k < G.pos) el.classList.add(e ? 'rc-' + e : 'rc-done');
        else if (k < cur) el.classList.add('rc-done'); // heard, the phrase not yet finished
        else if (G.done) return;
        else if (k === cur) { el.classList.add('rc-now'); if (G.hide) el.classList.add(G.peek ? 'rc-peek' : 'rc-hid'); }
        else if (G.hide) el.classList.add('rc-hid');
      });
    }
  }

  function paintBar() {
    if (!G) return;
    const w = G.words[Math.min(G.pos, G.words.length - 1)];
    const n = mistakes().length;
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
    const said = G.words.slice(0, G.pos), list = mistakes();
    const first = G.words[0].ai, last = said[said.length - 1].ai;
    $('#rdTitle').textContent = list.length ? 'انتهت الجلسة' : 'ما شاء الله، بلا أخطاء';
    $('#rdRange').textContent = G.test ? `اختبار · ${ayaLabel(first)}` : G.review ? `مراجعة مواضع الضعف · ${ayaCount(new Set(said.map(w => w.ai)).size)}`
      : first === last ? ayaLabel(first) : `${ayaLabel(first)} – ${ar(R.ayas[last][1])}`;
    $('#rdRight').textContent = ar(said.length - liveErrs().length);
    $('#rdErr').textContent = ar(list.length);
    const secs = Math.round(G.secs);
    $('#rdTime').textContent = `${ar(Math.floor(secs / 60))}:${ar(String(secs % 60).padStart(2, '0'))}`;
    const rows = mistakes(true).map(({ k, e, aya }) => {
      const w = G.words[k], gone = G.gone.has(k);
      const t = aya != null ? `<span class="t">${ayaLabel(aya)}</span><span class="s">تجاوزت الآية كلها</span>`
        : `<span class="t" style="font-family:${R.font}">${esc(wordText(w))}</span><span class="s">${ayaLabel(w.ai)} · ${TYPES[e]}</span>`;
      return `<div class="row rc-row${gone ? ' gone' : ''}"><span class="rc-mk rc-${e || 'skip'}"></span><span class="main">${t}</span>
        <button class="rc-not" data-rd-gone="${k}"${aya != null ? ` data-rd-n="${w.of}"` : ''}>${gone ? 'تراجع' : 'لم أخطئ'}</button></div>`;
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
        r.n += bad.length === list[0][0].of && bad.every(x => x[1] === 'skip') ? 1 : bad.length;
        r.last = Date.now(); r.ok = []; r.done = false;
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
      words: said.length, errs: mistakes().length, secs: Math.round(G.secs), review: G.review, test: G.test,
      list: mistakes().slice(0, 30).map(({ k, e, aya }) => aya != null ? [aya, -1, 'skip'] : [G.words[k].ai, G.words[k].wi, e]) });
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
    if (k === Math.max(G.pos, G.tent) && G.hide && !G.done && !G.peek) {
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
      ${MU() ? '' : `<div class="row rc-goal"><span class="main"><span class="t">سرعة التعرّف</span><span class="s">السريع أخفّ وأسرع بمرتين، والدقيق أثبت قليلًا</span></span>
        <span class="rc-chips">${[['fast', 'سريع'], ['exact', 'دقيق']].map(([k, t]) => `<button data-rc-use="${k}"${Listen.which() === k ? ' class="on"' : ''}>${t}</button>`).join('')}</span></div>`}
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
        const items = (s.list || []).filter(([ai]) => R.ayas[ai]).map(([ai, wi, e]) => wi < 0
          ? `<div class="rc-sess-i"><span class="rc-mk rc-skip"></span><b>${ayaLabel(ai)}</b><small>تجاوزت الآية كلها</small></div>`
          : `<div class="rc-sess-i"><span class="rc-mk rc-${e}"></span><b style="font-family:${R.font}">${esc(ayaTokens(ai)[wi] || '')}</b><small>${ayaLabel(ai)} · ${TYPES[e]}</small></div>`).join('');
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
    if (MU()) {
      Mu.saved().then(have => {
        const s = $('#rcModelS'), b = $('#rcModelB'), c = Mu.choice();
        if (!s) return;
        s.textContent = !c ? 'يُختار أسرع نموذج لجهازك قبل التنزيل'
          : `${MU_NAMES[c.id]} · ${ar(Mu.mb())} م.ب · ${have ? 'على جهازك، يعمل دون إنترنت' : 'غير منزّل'} · نحو ${ar(c.ms)} م.ث لكل تحديث`;
        b.innerHTML = (c ? `<button class="rc-not" data-rc-model="probe">اختبر من جديد</button>` : '')
          + `<button class="rc-not" data-rc-model="${have ? 'del' : 'get'}">${have ? 'حذف' : 'تنزيل'}</button>`;
      });
      return;
    }
    Listen.saved().then(have => {
      const s = $('#rcModelS'), b = $('#rcModelB');
      if (!s) return;
      const st = Listen.stats();
      s.textContent = (have ? `على جهازك · ${ar(Listen.mb())} م.ب · يعمل دون إنترنت` : `غير منزّل · ${ar(Listen.mb())} م.ب`)
        + (st.ms ? ` · آخر تعرّف ${ar((st.ms / 1000).toFixed(1))} ث · ${ar(st.threads)} ${st.threads > 1 ? 'أنوية' : 'نواة'}` : '');
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
      else if (md.dataset.rcModel === 'probe') { Mu.reprobe(); withModel(() => mounted()); }
      else (MU() ? Mu.remove() : Listen.remove()).then(() => { toast('حُذف النموذج من جهازك'); mounted(); });
      return true;
    }
    const u = e.target.closest('[data-rc-use]');
    if (u) {
      Listen.use(u.dataset.rcUse);
      const y = $('#sheetBody').scrollTop;
      renderSheet();
      $('#sheetBody').scrollTop = y;
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

  $('#riGo').onclick = async () => {
    if (MU()) {
      Mu.prime();
      if (!Mu.choice()) {
        paintDl('probe');
        try { await Mu.probe(); } catch { paintDl(); toast('تعذر تشغيل النموذج على هذا الجهاز'); return; }
        paintDl();
        const have = await Mu.saved();
        if (!have) { toast(`الأسرع على جهازك: ${MU_NAMES[Mu.choice().id]}`); return; } // its size is on the button now
      }
      paintDl(0);
      Promise.all([Mu.load(paintDl), Mu.sounds()]).then(() => {
        hide($('#recIntro'));
        paintDl();
        toast('نُزّل النموذج، ويعمل الآن دون إنترنت');
        const f = pending;
        pending = null;
        f?.();
      }, () => { paintDl(); toast('تعذر التنزيل — تحقق من الاتصال'); });
      return;
    }
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
    const k = +b.dataset.rdGone, n = +(b.dataset.rdN || 1), back = G.gone.has(k);
    for (let i = k; i < k + n; i++) if (back) G.gone.delete(i); else G.gone.add(i);
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

  return { start, cancel, paint, onTap, note, syncBubble, mic, panelHTML, mounted, onSheetClick, active: () => !!G };
})();
