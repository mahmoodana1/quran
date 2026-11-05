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
  const TYPES = { wrong: 'قرأتها بكلمة أخرى', haraka: 'أخطأت في حركتها', skip: 'تجاوزتها', hint: 'احتجت تلميحًا', madd: 'لم تعطِ المدّ حقّه', ghunna: 'أخطأت في الغنّة أو الإدغام' };
  const MASTER_DAYS = 3;
  const HINT_AFTER = 7000; // ms of silence on a hidden word before it shows
  const CLS = ['rc-weak', 'rc-done', 'rc-now', 'rc-hid', 'rc-blind', 'rc-peek', 'rc-wrong', 'rc-haraka', 'rc-skip', 'rc-hint', 'rc-madd', 'rc-ghunna'];
  // hidden, and blind (a setting): no trace of the words ahead, their number or their ayas'
  const blind = () => !!G?.hide && !G.done && store.get('recite.blind', false);
  // Muaalem listens in Hafs (its phonetic script is Hafs's)
  const MU = () => R.id === 'hafs' && typeof Mu !== 'undefined';
  const MU_NAMES = { 'q8-cpu': '٨ بت · المعالج', 'q8-gpu': '٨ بت · المعالج الرسومي', 'fp16-gpu': '١٦ بت · المعالج الرسومي', 'q4-cpu': '٤ بت · المعالج', 'q4-gpu': '٤ بت · المعالج الرسومي' };
  const ready = () => MU() ? Mu.ready() : Listen.ready();

  // the session: words in order { ai, p, n (word on its page), wi (word in its aya), of (aya length), nt (normalised) },
  // idx 'page:n' -> word, pos = next word to say, errs[k] = type, gone = mistakes taken back
  let G = null, dirty = false, timer = 0;

  // ---- mistakes, per riwaya: { ayas: { ai: { n, last, words: { wi: type }, ok: [day], done } }, sessions,
  // stats: { ai: { r: times read right, w: times with mistakes, h: [[time, mistakes (-1: skipped)]] (the last
  // 12), wc: { wi: times wrong } } } }
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

  // the model was loaded again while listening (see Mu.recover): the reading
  // goes on from where it was, or the search starts over
  Mu.lost(err => {
    if (err) { if (F) stopFind(); if (G?.run) pause(); toast('تعذر تحضير التسميع — أعد فتح التطبيق'); return; }
    if (F) { stopFind(); findMu(); return; }
    if (G?.run && G.mu) { pause(); setTimeout(() => { if (G && !G.run && !G.done) resume(); }, 100); }
  });

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
      G.mu = { c: 0, w0: opts.w0 || 0, cut: 0, final: '', tent: '', starts, lead: true, open: true, stream: !!opts.stream };
      G.pos = G.tent = G.mu.w0; // found by reciting from inside the aya: from that word
      G.heard = {}; // k -> { got, want }: what was heard for a word marked, and how it should sound
      if (opts.carry) Object.assign(G.mu, opts.carry, { lead: true, open: true }); // the reading of the surah before goes on
    }
    // begun from an aya: on into the next surahs until the reader stops
    G.chain = !review && !opts.test;
    // brought back after the page reloaded: where it was, paused
    const back = opts.restore;
    if (back) {
      Object.assign(G, { pos: back.pos, tent: back.pos, errs: back.errs, gone: new Set(back.gone), secs: back.secs, hide: back.hide, review: back.review, chain: !back.review && !back.test });
      if (G.mu) {
        const m = G.mu;
        m.c = Math.max(0, m.starts.findLastIndex(k => k <= G.pos));
        m.w0 = G.pos - m.starts[m.c];
        G.heard = back.heard || {};
      }
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
    if (back) { toast('استُعيدت جلستك — اضغط الميكروفون لتتابع'); return; }
    resume();
  }

  // ---- the session, kept as it goes: if the page reloads (an update, or the
  // phone short of memory), it comes back where it was
  const LIVE = () => 'recite.live.' + R.id;
  let keptAt = 0;
  function keep(now = false) {
    if (!G || G.done || (!now && Date.now() - keptAt < 3000)) return;
    keptAt = Date.now();
    store.set(LIVE(), { t: Date.now(), ayas: G.ayas, pos: G.pos, errs: G.errs, gone: [...G.gone], heard: G.heard,
      secs: G.secs + (G.run ? (Date.now() - G.t) / 1000 : 0), hide: G.hide, review: G.review, test: G.test });
  }
  function restore() {
    const s = store.get(LIVE(), null);
    if (!s || Date.now() - s.t > 3 * 3600e3 || !s.pos || !s.ayas?.every(ai => R.ayas[ai])) return;
    start(null, s.ayas, { test: s.test, restore: s });
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
    keep(true);
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
        m.cut = 0; m.final = ''; m.conf = null; m.alts = null; m.lead = false; m.open = true;
      });
    } else Listen.stop();
    paintBar();
  }

  // drop the session without keeping anything
  function cancel() {
    store.set(LIVE(), null);
    if (!G) return;
    save(); // what was said is kept, however the session ends (another begun, the audio played, the riwaya changed)
    clearInterval(timer);
    if (!G.keepMic) { if (G.mu) Mu.stop(); else Listen.stop(); }
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
  const MU_TYPE = { haraka: 'haraka', letter: 'wrong', extra: 'wrong', skipped: 'skip', madd: 'madd', ghunna: 'ghunna' };
  function onMu(g, d) {
    if (G !== g) return;
    if (g.done) { g.mu.final = d.final; g.mu.tent = d.tent; g.mu.conf = d.conf; g.mu.alts = d.alts; return; } // the last of it, read after «finish»: pause() applies it
    const m = g.mu, grew = d.final.length + d.tent.length !== m.final.length + m.tent.length;
    m.final = d.final; m.tent = d.tent; m.conf = d.conf; m.alts = d.alts;
    if (grew && g.run) {
      g.lastAct = Date.now();
      if (!g.voice) { g.voice = true; paintBar(); }
      clearTimeout(g.voiceT);
      g.voiceT = setTimeout(() => { if (G === g) { g.voice = false; paintBar(); } }, 900);
    }
    muFollow(false);
  }
  function muFollow(done) {
    const m = G.mu, U = Match.units(m.final + m.tent);
    // each stretch read (the first, and after every pause) may open with an
    // isti'adha or a basmala: set aside, and nothing marked while it is said
    if (m.open && m.c < G.ayas.length && U.length - m.cut >= 6) {
      const ai = G.ayas[m.c], o = Mu.opening(Match.text(U.slice(m.cut)), m.w0 === 0 && Mu.expect(ai).ph.startsWith('بِسمِ'));
      if (o === null && !done) { paintBar(); return; }
      m.open = false;
      if (o?.cut) m.cut += o.cut;
    }
    for (let guard = 0; guard < 40 && m.c < G.ayas.length; guard++) {
      const ai = G.ayas[m.c];
      let nx = done ? null : G.ayas[m.c + 1], after = nx != null ? Mu.expect(nx) : null;
      // the surah's last aya, the session going on: what comes after is the next
      // surah's basmala and first aya (at-Tawbah: its first aya), so the last aya
      // is closed when they begin
      if (nx == null && !done && G.chain && m.c === G.ayas.length - 1 && R.ayas[ai + 1]) {
        nx = ai + 1;
        after = R.ayas[nx][0] === 9 ? Mu.expect(nx) : Mu.expect2(Mu.expect(0), Mu.expect(nx));
      }
      // and the aya after the next too: what was heard past the next then has an aya to line
      // up with, so an aya skipped (and the two after it said) isn't stretched over the next
      // one's words, putting everything after it an aya behind
      const nx2 = after && !done ? G.ayas[m.c + 2] : null;
      if (nx2 != null) after = Mu.expect2(after, Mu.expect(nx2));
      const cur = Mu.expect(ai, m.w0), ex = after ? Mu.expect2(cur, after) : cur;
      // what was heard from the cut on, as heard (a madd's run whole: its length is a tajweed check)
      const all = m.final + m.tent, c0 = Match.charAt(all, m.cut);
      const sub = all.slice(c0), fin = Math.max(0, m.final.length - c0);
      const st = Match.words(ex, sub, fin, done, { freeLead: m.lead, conf: m.conf.slice(c0), alts: m.alts.slice(c0), tajweed: setting('tajweed') });
      const n0 = cur.spans.length;
      const begun = nx != null && st.slice(n0, n0 + 2).some(x => x.state === 'ok' || x.state === 'err');
      muApply(st.slice(0, n0), begun, cur);
      const end = st[n0 - 1]?.state === 'ok' || st[n0 - 1]?.state === 'err' ? st[n0 - 1].at?.[1] : null;
      if (end != null) m.endAt = m.cut + end; // where the aya's last word ended in what was heard
      if (!begun) { if (!done && muRelocate(st.slice(0, n0), sub, fin, m.conf.slice(c0), m.alts.slice(c0))) continue; break; }
      m.cut += st[n0].at[0]; m.c++; m.w0 = 0; m.lead = false;
    }
    if (G.pos >= G.words.length) return G.chain ? chain() : finish();
    follow();
    paint();
    paintBar();
  }
  // the surah read to its end, in a session begun from an aya: kept, and the next
  // surah goes on at once, on the same reading (its basmala set aside), until the
  // reader stops
  function chain() {
    const g = G, next = g.ayas[g.ayas.length - 1] + 1;
    if (!R.ayas[next] || !g.run) return finish();
    save();
    // the next surah's reading starts where it was heard beginning (its basmala then set aside)
    const m = g.mu, carry = m && { final: m.final, tent: m.tent, conf: m.conf, alts: m.alts,
      cut: m.c >= g.ayas.length ? m.cut : m.endAt ?? Match.units(m.final + m.tent).length };
    g.keepMic = !!m;
    start(next, null, { stream: !!m, carry });
    toast(`سورة ${suraName(R.ayas[next][0])}`);
  }
  // the session is over: the words of the aya being said that were begun are
  // judged as they were said (the reading's end is their end); the rest stay unsaid
  function muSettle() {
    const m = G.mu;
    if (m.c >= G.ayas.length) return;
    const c0 = Match.charAt(m.final, m.cut), sub = m.final.slice(c0), conf = m.conf.slice(c0), alts = m.alts.slice(c0);
    const cur = Mu.expect(G.ayas[m.c], m.w0);
    const tajweed = setting('tajweed');
    const st = Match.words(cur, sub, sub.length, false, { freeLead: m.lead, conf, alts, tajweed });
    const t = st.findLastIndex(x => x.state !== 'todo');
    if (t < 0) return;
    const part = { ph: cur.ph.slice(0, cur.spans[t][1]), spans: cur.spans.slice(0, t + 1), wasl: cur.wasl.filter(k => k <= t) };
    if (cur.tj) part.tj = cur.tj.filter(c => c < part.ph.length);
    const fin = Match.words(part, sub, sub.length, true, { freeLead: m.lead, conf, alts, tajweed });
    muApply(fin.concat(st.slice(t + 1)), false, cur);
  }

  // the words of the aya being said, from w0 (cur: how they should sound):
  // what each turned out to be, and what was heard for the ones marked
  function muApply(states, closing, cur) {
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
          if (cur?.spans[i]) G.heard[k] = { got: x.heard || '', want: cur.ph.slice(...cur.spans[i]) };
          if (e === 'skip') skips.push([k, 'skip']);
        } else if (G.errs[k] && G.errs[k] !== 'hint') delete G.errs[k];
      } else if (x.state === 'hear') tent = k + 1;
    });
    if (pos > G.pos) G.peek = false;
    G.pos = pos; G.tent = tent;
    if (fresh) chime();
    warnSkipped(skips);
  }
  // the aya being said doesn't fit what is heard (nothing of it, or mistakes
  // piling up), but another aya of the session clearly does: a skip ahead (even
  // to an aya that opens like the one skipped, as al-Mulk 2 and 3), or a step back
  function muRelocate(states, sub, fin, conf, alts) {
    const m = G.mu;
    const ok0 = states.filter(x => x.state === 'ok').length, bad0 = states.filter(x => x.state === 'err').length;
    if (Date.now() - (m.relocAt || 0) < 800 || (ok0 && bad0 < 2)) return false;
    if (Match.units(sub).length < 25) return false;
    m.relocAt = Date.now();
    // of ayas heard alike (a refrain, as ar-Rahman's «فبأي آلاء ربكما تكذبان»), the one
    // just read (said again), else the nearest ahead; further back only when it fits better
    const order = m.c > 0 ? [m.c - 1] : [];
    for (let j = m.c + 1; j < Math.min(G.ayas.length, m.c + 9); j++) order.push(j);
    for (let j = m.c - 2; j >= Math.max(0, m.c - 3); j--) order.push(j);
    let best = null;
    for (const j of order) {
      const st = Match.words(Mu.expect(G.ayas[j]), sub, fin, false, { freeLead: true, conf, alts });
      const ok = st.filter(x => x.state === 'ok').length, bad = st.filter(x => x.state === 'err').length;
      if (ok >= Math.max(3, ok0 + 2) && ok / (ok + bad) >= 0.7 && (!best || ok > best.ok)) best = { j, ok };
    }
    if (!best) return false;
    const from = m.starts[m.c] + m.w0;
    if (best.j > m.c) {
      // what was heard for the aya left was the later one's: all of it is skipped
      const marks = [];
      for (let k = from; k < m.starts[best.j]; k++) { if (G.errs[k] !== 'hint') G.errs[k] = 'skip'; delete G.heard[k]; marks.push([k, 'skip']); }
      warnSkipped(marks);
    } else {
      for (let k = from; k < G.words.length && k < from + G.words[from].of; k++) { if (G.errs[k] !== 'hint') delete G.errs[k]; delete G.heard[k]; }
      toast(`رجعت إلى الآية ${ar(R.ayas[G.ayas[best.j]][1])}`);
    }
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
    if (marked) chime();
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
    haptic([40, 60, 40]);
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
    keep();
    if (G.hide && !G.peek && !G.voice && !G.busy && Date.now() - G.lastAct > HINT_AFTER) {
      G.peek = true;
      G.errs[Math.max(G.pos, G.tent)] ||= 'hint';
      paint(); paintBar();
    }
  }

  // the band follows the aya being recited; turn the page when the next word is on another one
  function follow() {
    const w = G.words[Math.min(Math.max(G.pos, G.tent), G.words.length - 1)];
    if (S.focus !== w.ai) { S.focus = w.ai; drawBands(document); keepClear(); }
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
      }, on => { if (F === f) { f.voice = on; f.ever ||= on; syncBubble(); } })
        .catch(() => { stopFind(); toast('لا يمكن الوصول إلى الميكروفون — اسمح به من إعدادات المتصفح'); });
    });
  }
  function stopFind() {
    if (!F) return;
    clearInterval(F.timer);
    F = null;
    if (MU()) Mu.stop(); else Listen.stop();
    syncBubble();
  }
  // Muaalem: the reading so far, looked up in the whole Quran (begun at any
  // word); the session then goes on with it, from that word
  const FIND_EVERY = 500, QUIET = 1500;
  const FIND_MARGIN = 12; // heard sounds the best place must explain beyond any other
  function findMu() {
    withModel(() => {
      if (G) return;
      F = { voice: false, d: null, n: 0, grew: 0, same: 0, last: null };
      syncBubble();
      const f = F;
      Mu.start(d => {
        if (F !== f) return;
        f.d = d;
        if (!f.voice) { f.voice = true; syncBubble(); }
      }).then(() => {
        if (F === f) f.timer = setInterval(() => { if (F !== f) clearInterval(f.timer); else checkFind(f); }, FIND_EVERY);
      }, () => { stopFind(); toast('لا يمكن الوصول إلى الميكروفون — اسمح به من إعدادات المتصفح'); });
    });
  }
  // many places in the Quran read alike: go only once one fits clearly better
  // than any other, and has stayed the best for a second; when the reader has
  // stopped, a smaller lead is enough, and places said the same way are told
  // apart by the page open
  function checkFind(f) {
    const d = f.d;
    if (!d) return;
    const h = d.final + d.tent, n = Match.units(h).length;
    if (n !== f.n) { f.n = n; f.grew = Date.now(); }
    const quiet = Date.now() - f.grew > QUIET;
    if (n < 24) return;
    if (quiet && f.quietAt === n) return; // nothing new since the last quiet check
    // a look takes longer as the reading grows (most of a second on a slow
    // phone): keep the page free between looks at least as long as a look took
    if (Date.now() < (f.nextAt || 0)) return;
    if (quiet) f.quietAt = n;
    const t0 = Date.now(), r = locateMu(h, d.conf, d.alts);
    f.nextAt = Date.now() + (Date.now() - t0);
    f.same = r && f.last != null && Math.abs(r.g - f.last) <= 1 ? f.same + 1 : 0;
    f.last = r ? r.g : null;
    if (r && !f.found) { f.found = true; syncBubble(); }
    const sure = r && f.same >= 2 && (r.fit - r.next >= FIND_MARGIN || (n > 150 && f.same >= 4) || (quiet && (r.fit - r.next >= 3 || f.same >= 3)));
    if (!sure) { if (n > 320 || (quiet && Date.now() - f.grew > 6000)) { stopFind(); toast('لم أجد الآية — اقرأ أكثر من آية'); } return; }
    clearInterval(f.timer);
    F = null; // the reading goes on, now as the session's
    syncBubble();
    start(r.ai, null, { stream: true, w0: r.w });
    toast(r.w ? `${ayaLabel(r.ai)} · من كلمة ${ayaTokens(r.ai)[r.w] || ''}` : ayaLabel(r.ai));
  }
  // where the reading fits best: { ai, w, g, fit, next (the runner-up's fit) },
  // equal fits going to the one nearest the page open
  function locateMu(h, conf, alts) {
    const fits = Mu.locate(h, conf, alts, 6).filter(x => x.ok >= 4 && x.ok / (x.ok + x.err) >= 0.75);
    if (!fits.length) return null;
    fits.forEach(x => { x.far = Math.abs(R.ayas[x.ai][2] - S.page); });
    fits.sort((a, b) => b.fit - a.fit || a.far - b.far);
    return { ...fits[0], next: fits[1]?.fit ?? 0 };
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
    $('#micPillTxt').textContent = !F ? '' : F.busy || F.found ? 'أبحث عن الآية…' : F.voice || F.ever ? 'أستمع…' : 'اقرأ آيةً، وأجدها لك';
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
    document.body.classList.toggle('rc-blind', blind());
    const weak = !G && store.get('recite.weak', false) ? weakWords() : null;
    if (!G && !dirty && !weak) return;
    if (!G && root === document) dirty = !!weak;
    const pages = root.classList?.contains('page') ? [root] : root.querySelectorAll('.page');
    const bl = blind(), ahead = bl ? new Set(G.words.slice(G.pos).map(w => w.ai)) : null;
    for (const pg of pages) {
      const p = +pg.dataset.page;
      pg.querySelectorAll('.w.end').forEach(el => el.classList.toggle('rc-blind', !!ahead?.has(+el.dataset.a)));
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
        else if (k === cur) { el.classList.add('rc-now'); if (G.hide) el.classList.add(G.peek ? 'rc-peek' : 'rc-hid'); if (bl && !G.peek) el.classList.add('rc-blind'); }
        else if (G.hide) el.classList.add('rc-hid', ...(bl ? ['rc-blind'] : []));
      });
    }
  }

  function paintBar() {
    if (!G) return;
    const w = G.words[Math.min(G.pos, G.words.length - 1)];
    const n = mistakes().length;
    $('#recTitle').textContent = !G.run ? (G.pos ? 'متوقف مؤقتًا' : 'اضغط وابدأ القراءة')
      : G.busy ? 'يتعرّف على ما قرأت…' : G.voice ? 'يستمع…' : G.peek ? 'هذه الكلمة التالية' : 'اقرأ، أنا أستمع';
    const bl = blind();
    $('#recSub').textContent = bl ? (n ? errs(n) : 'تسميع أعمى') : `${ayaLabel(w.ai)}${n ? ' · ' + errs(n) : ''}`;
    $('#recToggle').classList.toggle('voice', !!G.voice);
    $('#recBar').classList.toggle('paused', !G.run);
    $('#recToggle').classList.toggle('live', G.run);
    $('#recToggle').setAttribute('aria-label', G.run ? 'إيقاف مؤقت' : 'متابعة');
    $('#recHide').classList.toggle('on', G.hide);
    $('#recHide').setAttribute('aria-pressed', G.hide);
    // this aya's share of the bar, like the player
    $('#recProg').style.transform = `scaleX(${bl ? 0 : G.pos >= G.words.length ? 1 : w.wi / w.of})`;
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
    if (!G || G.saved) return; // once per session (a surah carried on into the next is kept at its end)
    const l = log(), today = day();
    const said = G.words.slice(0, G.pos);
    if (!said.length) return;
    G.saved = true;
    const byAya = new Map();
    said.forEach((w, k) => {
      if (!byAya.has(w.ai)) byAya.set(w.ai, []);
      byAya.get(w.ai).push([w, G.gone.has(k) ? null : G.errs[k]]);
    });
    l.stats ||= {};
    for (const [ai, list] of byAya) {
      const bad = list.filter(x => x[1]), full = list.length === list[0][0].of;
      if (!full && !bad.length) continue; // begun and left: not a reading of it
      const st = l.stats[ai] ||= statsFrom(l, ai);
      const skipped = full && bad.length === list.length && bad.every(x => x[1] === 'skip');
      if (bad.length) st.w++; else st.r++;
      if (!skipped) bad.forEach(([w]) => { st.wc[w.wi] = (st.wc[w.wi] || 0) + 1; });
      st.h.push([Date.now(), skipped ? -1 : bad.length]);
      if (st.h.length > 12) st.h.splice(0, st.h.length - 12);
    }
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
    // recited: an aya said to its end (mistakes or not); begun and left, or skipped whole, isn't
    const whole = [...byAya].filter(([, list]) => list.length === list[0][0].of && !list.every(x => x[1] === 'skip')).map(([ai]) => ai);
    l.said ||= {}; l.days ||= {};
    for (const ai of whole) l.said[ai] = Date.now();
    if (whole.length) l.days[today] = (l.days[today] || 0) + whole.length;
    const days = Object.keys(l.days);
    if (days.length > 400) days.slice(0, days.length - 400).forEach(d => delete l.days[d]);
    // (a session that got through no aya and marked nothing isn't one)
    if (whole.length || mistakes().length) l.sessions.unshift({ t: Date.now(), from: said[0].ai, to: said[said.length - 1].ai, ayas: whole.length,
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
    // while reading: a tap on a word marked takes the mark away (again: puts it
    // back), and the reading goes on
    if (G.run && k != null && G.errs[k] && G.errs[k] !== 'hint') {
      const back = G.gone.has(k);
      if (back) G.gone.delete(k); else G.gone.add(k);
      paint(); paintBar();
      el.classList.remove('rc-cleared', 'rc-unclear');
      void el.offsetWidth; // the flash again, on a second tap
      el.classList.add(back ? 'rc-unclear' : 'rc-cleared');
      setTimeout(() => el.classList.remove('rc-cleared', 'rc-unclear'), 700);
      haptic(back ? [10, 40, 10] : 8);
      return true;
    }
    if (k == null || k >= G.pos || !G.errs[k] || G.gone.has(k)) return true;
    pause();
    G.tap = { k, el };
    $('#rwWord').textContent = wordText(G.words[k]);
    $('#rwWord').style.fontFamily = R.font;
    $('#rwType').textContent = TYPES[G.errs[k]];
    // what the model heard there, beside how the word should sound
    const h = G.heard?.[k];
    $('#rwHeard').hidden = !h;
    $('#rwCopy').hidden = !h;
    if (h) $('#rwHeard').innerHTML = `<span><small>سُمِع</small>${esc(h.got) || '—'}</span><span><small>المتوقَّع</small>${esc(h.want)}</span>`;
    $('#recWord').classList.toggle('three', !!h);
    if (!G.done) show($('#recWord'));
    return true;
  }

  // ---- a mistake, heard: two soft falling notes, like wood struck lightly, and
  // a buzz with them. At the reader's next breath: over the voice, the
  // microphone takes the notes in and the model writes them as sounds said
  let chimeT = null;
  function chime(test = false) {
    if (test) return ring();
    if (!setting('sound') || chimeT) return;
    chimeT = setInterval(() => {
      if (G?.run && Date.now() - G.lastAct < 450) return;
      clearInterval(chimeT); chimeT = null;
      if (G?.run) ring();
    }, 100);
  }
  function ring() {
    haptic(14);
    const ctx = MU() && Mu.sound();
    if (!ctx || ctx.state === 'closed') return;
    if (ctx.state !== 'running') { ctx.resume().then(() => ctx.state === 'running' && play(ctx), () => {}); return; }
    play(ctx);
  }
  function play(ctx) {
    const t = ctx.currentTime + 0.01, out = ctx.createGain();
    out.gain.value = 0.16;
    out.connect(ctx.destination);
    [[1046.5, 0], [784, 0.085]].forEach(([f, at]) => {
      // a marimba-ish bar: the note and its fourth partial, which dies first
      [[1, 1, 0.22], [4, 0.18, 0.05]].forEach(([mul, amp, len]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f * mul;
        g.gain.setValueAtTime(0, t + at);
        g.gain.linearRampToValueAtTime(amp, t + at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
        o.connect(g); g.connect(out);
        o.start(t + at); o.stop(t + at + len + 0.02);
      });
    });
  }

  // ---- the aya bar: how this aya went in التسميع

  // an aya's counts from before they were kept: its mistakes from the sessions
  // still in the log, its clean days towards «mastered»
  function statsFrom(l, ai) {
    const st = { r: 0, w: 0, h: [], wc: {} };
    for (const s of [...l.sessions].reverse()) {
      const mine = (s.list || []).filter(x => x[0] === ai);
      if (!mine.length) continue;
      st.w++;
      const skip = mine.some(x => x[1] < 0);
      if (!skip) mine.forEach(([, wi]) => { st.wc[wi] = (st.wc[wi] || 0) + 1; });
      st.h.push([s.t, skip ? -1 : mine.length]);
    }
    const a = l.ayas[ai];
    if (a) {
      st.r = a.ok.length;
      for (const wi of Object.keys(a.words)) st.wc[wi] ||= 1;
      if (!st.w) st.w = 1;
    }
    st.h = st.h.slice(-12);
    return st;
  }
  // the card in the aya bar: right and wrong, the last readings, the words got wrong
  function card(ai) {
    const l = log(), a = l.ayas[ai], st = l.stats?.[ai] || (a ? statsFrom(l, ai) : null);
    if (!st || !(st.r + st.w)) return '';
    const toks = ayaTokens(ai), last = st.h.length ? st.h[st.h.length - 1][0] : a?.last;
    const words = Object.entries(st.wc).map(([wi, n]) => [+wi, n]).filter(([wi]) => toks[wi])
      .sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 8);
    const kind = wi => a && !a.done ? a.words[wi] : null;
    const state = a?.done ? `<span class="rc-ab-done">متقنة</span>`
      : a ? `<span class="rc-ab-m"><span class="rc-dots" aria-label="${ar(a.ok.length)} من ${ar(MASTER_DAYS)} قراءات صحيحة">${[0, 1, 2].map(j => `<i${j < a.ok.length ? ' class="on"' : ''}></i>`).join('')}</span>للإتقان</span>` : '';
    return `<div class="rc-ab">
      <div class="rc-ab-top">
        <span class="rc-ab-n ok"><b>${ar(st.r)}</b>صحيحة</span>
        <span class="rc-ab-n bad"><b>${ar(st.w)}</b>بأخطاء</span>
        ${st.h.length ? `<span class="rc-ab-h" aria-label="آخر القراءات">${st.h.map(([, e]) => `<i class="${e === 0 ? 'ok' : e < 0 ? 'skip' : 'bad'}"></i>`).join('')}</span>` : ''}
        ${state}
      </div>
      ${words.length ? `<div class="rc-ab-w">${words.map(([wi, n]) => `<button data-rc-word="${ai}:${wi}" class="${kind(wi) ? 'now ' + kind(wi) : ''}"><span style="font-family:${R.font}">${esc(toks[wi])}</span>${n > 1 ? `<small>×${ar(n)}</small>` : ''}</button>`).join('')}</div>` : ''}
      ${last ? `<small class="rc-ab-last">آخر تسميع ${ago(last)}</small>` : ''}
    </div>`;
  }
  // ---- the surah bar (its band tapped): how much of it was recited, how it went,
  // its weak ayas and its last sessions; { html, from: where to go on from, or null }
  function suraCard(su) {
    const l = log(), said = l.said || {}, a0 = R.suraStart[su], n = suraSizes()[su];
    let got = 0, r = 0, w = 0, done = 0, last = 0;
    const weak = [];
    for (let ai = a0; ai < a0 + n; ai++) {
      if (said[ai]) { got++; last = Math.max(last, said[ai]); }
      const a = l.ayas[ai], st = l.stats?.[ai] || (a ? statsFrom(l, ai) : null);
      if (st) { r += st.r; w += st.w; }
      if (a) a.done ? done++ : weak.push(ai);
    }
    const inSura = ai => R.ayas[ai]?.[0] === su;
    const sess = l.sessions.filter(x => !x.review && (inSura(x.from) || inSura(x.to) || (x.list || []).some(([ai]) => inSura(ai)))).slice(0, 4);
    const full = got >= n, nx = nextIn(su, said);
    let h = `<div class="rc-ab rc-sb">
      <div class="rc-sb-p"><span class="rc-bar${full ? ' full' : ''}"><i style="width:${got ? Math.max(3, Math.round(got / n * 100)) : 0}%"></i></span>
        <small>${full ? 'سمّعتها كاملة' : got ? `${ar(got)} من ${ar(n)} آية` : `لم تسمّع منها بعد · ${ayaCount(n)}`}</small></div>`;
    if (r + w || done) h += `<div class="rc-ab-top">
        <span class="rc-ab-n ok"><b>${ar(r)}</b>قراءة صحيحة</span><span class="rc-ab-n bad"><b>${ar(w)}</b>بأخطاء</span>
        ${done ? `<span class="rc-ab-done">${ayaCount(done)} متقنة</span>` : ''}</div>`;
    if (weak.length) h += `<div class="rc-sb-l">مواضع الضعف</div><div class="rc-ab-w rc-sb-w">${weak.slice(0, 16).map(ai =>
      `<button data-sb-aya="${ai}">${ar(R.ayas[ai][1])}</button>`).join('')}${weak.length > 16 ? `<small>و${ar(weak.length - 16)} أخرى</small>` : ''}</div>`;
    if (sess.length) h += `<div class="rc-sb-l">آخر الجلسات</div><div class="rc-sb-s">${sess.map(x =>
      `<div><span>${sessionLabel(x)}</span><small>${ago(x.t)} · ${x.errs ? errs(x.errs) : 'بلا أخطاء'}</small></div>`).join('')}</div>`;
    else if (last) h += `<small class="rc-ab-last">آخر تسميع ${ago(last)}</small>`;
    return { html: h + '</div>', from: got && !full && nx !== a0 ? nx : null };
  }

  // a word's record: { read: readings of its aya, wrong, right, now: its mark
  // (none once mastered), hist: [[time, type]] newest first, the aya's skips too }
  function wordStats(ai, wi) {
    const l = log(), a = l.ayas[ai], st = l.stats?.[ai] || (a ? statsFrom(l, ai) : null);
    const hist = [];
    for (const s of l.sessions) for (const x of s.list || []) if (x[0] === ai && (x[1] === wi || x[1] < 0)) hist.push([s.t, x[1] < 0 ? 'skip' : x[2]]);
    const wrong = st?.wc[wi] || 0, read = st ? st.r + st.w : 0;
    return { read, wrong, right: Math.max(0, read - wrong), now: a && !a.done ? a.words[wi] || null : null, hist, types: TYPES };
  }
  // forget every mistake on a word: its count, its mark, and its lines in the
  // sessions kept (the aya leaves the weak spots when it was the last word marked)
  function resetWord(ai, wi) {
    const l = log();
    const st = l.stats?.[ai] || (l.ayas[ai] ? statsFrom(l, ai) : null);
    if (st) { delete st.wc[wi]; (l.stats ||= {})[ai] = st; }
    const a = l.ayas[ai];
    if (a) { delete a.words[wi]; if (!Object.keys(a.words).length) delete l.ayas[ai]; }
    for (const s of l.sessions) if (s.list) s.list = s.list.filter(x => !(x[0] === ai && x[1] === wi));
    store.set(key(), l);
    weakMap = null; dirty = true;
    paintMarks();
  }

  // a word from the card, shown on the page
  // (then(el): instead of pointing at it, something else done with it)
  function showWord(ai, wi, then) {
    const w = ayaWords(ai)[wi];
    if (!w) return;
    const go = () => {
      const el = [...document.querySelectorAll(`.page[data-page="${w.p}"] .w:not(.end)`)][w.n];
      if (!el) return;
      if (then) return then(el);
      el.classList.remove('rc-pointed'); void el.offsetWidth; el.classList.add('rc-pointed');
      setTimeout(() => el.classList.remove('rc-pointed'), 1600);
    };
    if (w.p !== S.page) { goTo(w.p); setTimeout(go, 350); } else go();
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

  const SET_ON = { sound: true, tajweed: true }; // settings on unless turned off
  // how often the words are read (Mu.rate): the same mistakes caught either way
  const RATE_NOTE = {
    auto: 'كل ربع ثانية إن أطاق جهازك، وأقل على الأجهزة البطيئة كي لا تسخن',
    fast: 'كل ربع ثانية دائمًا، أو بأقصى ما يطيقه جهازك · أثقل على البطارية',
    save: 'مرة كل ثانية ونصف · أخف على البطارية، والأخطاء تُكشف كما هي، وتظهر الكلمات متأخرة قليلًا',
  };
  const setting = id => !!store.get('recite.' + id, SET_ON[id] ?? false);
  const toggle = (id, label, sub) => {
    const on = setting(id);
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

  // the 114 surahs as tiles, by how much of each was recited
  function mapHTML(got, sizes, weakIn) {
    let tiles = '';
    for (let s = 1; s <= 114; s++) {
      const f = sizes[s] ? got[s] / sizes[s] : 0;
      const lvl = f === 0 ? 0 : f < 1 / 3 ? 1 : f < 2 / 3 ? 2 : f < 1 ? 3 : 4;
      tiles += `<button class="rc-tile l${lvl}${weakIn.has(s) ? ' weak' : ''}" data-rc-sura="${s}" aria-label="${suraName(s)}: ${ar(got[s])} من ${ar(sizes[s])}">${ar(s)}</button>`;
    }
    return `<details class="rc-map"><summary class="row"><span class="main"><span class="t">خريطة السور</span><span class="s">كل سورة بلون ما سمّعته منها</span></span><svg viewBox="0 0 24 24" class="go"><path d="M14.5 6l-6 6 6 6"/></svg></summary>
      <div class="rc-tiles">${tiles}</div>
      <div class="rc-legend"><span><i class="rc-tile l1"></i>بدأتها</span><span><i class="rc-tile l4"></i>كاملة</span><span><i class="rc-tile l2 weak"></i>فيها مواضع ضعف</span></div></details>`;
  }

  // in a surah: the first aya after the last one recited (else its first aya)
  function nextIn(s, said) {
    const a0 = R.suraStart[s], n = suraSizes()[s];
    let last = -1;
    for (let a = a0; a < a0 + n; a++) if (said[a] && (last < 0 || said[a] >= said[last])) last = a;
    return last >= 0 && last + 1 < a0 + n ? last + 1 : a0;
  }

  const ICONS = {
    review: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 0113-5.1M19.5 12a7.5 7.5 0 01-13 5.1"/><path d="M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4"/></svg>',
    test: '<svg viewBox="0 0 24 24"><path d="M6.5 4.5h11v15h-11z"/><path d="M9.5 9.5l1.6 1.6 3.4-3.4M9.5 15h5"/></svg>',
    find: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 7.8v3.6M8.7 10.4a1.8 1.8 0 003.6 0"/></svg>',
  };
  const SEGS = [['memo', 'حفظي'], ['errs', 'الأخطاء'], ['log', 'السجل'], ['set', 'الإعدادات']];

  function panelHTML() {
    const l = log(), said = l.said || {}, sizes = suraSizes();
    const all = Object.entries(l.ayas).map(([ai, a]) => [+ai, a]).filter(([ai]) => R.ayas[ai]);
    const weak = all.filter(([, a]) => !a.done).sort((x, y) => x[0] - y[0]);
    const mastered = all.filter(([, a]) => a.done).sort((x, y) => y[1].at - x[1].at);
    const goal = store.get('recite.goal', 0), fresh = !all.length && !l.sessions.length;
    const seg = SEGS.some(([k]) => k === store.get('recite.seg')) ? store.get('recite.seg') : 'memo';

    // ---- where to go on from: the aya, its opening words, and the surah so far
    const at = resumeAya(), s0 = R.ayas[at][0];
    const got = new Array(115).fill(0), lastIn = new Array(115).fill(0);
    for (const k of Object.keys(said)) { const a = R.ayas[+k]; if (a) { got[a[0]]++; lastIn[a[0]] = Math.max(lastIn[a[0]], said[k]); } }
    const words = ayaTokens(at), open = words.slice(0, 7).join(' ') + (words.length > 7 ? ' …' : '');
    const today = l.days?.[day()] || 0, run = streak(l);
    const C = 2 * Math.PI * 15, part = goal ? Math.min(1, today / goal) : 0;
    const ring = goal ? `<svg viewBox="0 0 36 36" class="rc-ring${today >= goal ? ' full' : ''}"><circle cx="18" cy="18" r="15" class="trk"/>
      <circle cx="18" cy="18" r="15" class="val" style="stroke-dasharray:${(part * C).toFixed(1)} ${C.toFixed(1)}"/></svg>` : '';
    const todayTxt = goal ? (today >= goal ? 'بلغت هدف اليوم' : `اليوم ${ar(today)} من ${ayaCount(goal)}`) : today ? `اليوم ${ayaCount(today)}` : 'لم تسمّع اليوم بعد';
    let html = `<div class="rc-go">
      <div class="rc-go-l">${fresh ? 'ابدأ التسميع' : 'تابع من حيث توقفت'}</div>
      <div class="rc-go-t">${ayaLabel(at)}</div>
      <div class="rc-go-v" style="font-family:${R.font}">${esc(open)}</div>
      <div class="rc-go-p"><span class="rc-bar"><i style="width:${Math.round(got[s0] / sizes[s0] * 100)}%"></i></span><small>${ar(got[s0])} من ${ar(sizes[s0])} في ${suraName(s0)}</small></div>
      <button class="rc-go-b" data-rc-resume>${MIC}${fresh ? 'ابدأ التسميع' : 'تابع التسميع'}</button>
      <div class="rc-go-f">${ring ? `<span class="rc-ring-w">${ring}</span>` : ''}<span>${todayTxt}</span><span class="sep">·</span><span>${streakText(run)}</span></div>
    </div>`;

    // ---- the three things most often wanted next
    const test = testAyas();
    html += `<div class="rc-quick">
      <button data-rc-review${weak.length ? '' : ' disabled'}>${ICONS.review}<b>راجع أخطاءك</b><small>${weak.length ? ayaCount(weak.length) : 'لا أخطاء الآن'}</small></button>
      <button data-rc-test${test ? '' : ' disabled'}>${ICONS.test}<b>اختبرني</b><small>${test ? 'من مواضع حفظتها' : 'سمّع ٣ آيات أولًا'}</small></button>
      <button data-rc-find>${ICONS.find}<b>ابحث بصوتك</b><small>اقرأ، ونجد الآية</small></button>
    </div>`;

    html += `<nav class="rc-seg" role="tablist">${SEGS.map(([k, t]) => `<button role="tab" data-rc-seg="${k}" aria-selected="${k === seg}"${k === seg ? ' class="on"' : ''}>${t}${k === 'errs' && weak.length ? `<i>${ar(weak.length)}</i>` : ''}</button>`).join('')}</nav>`;
    html += `<div class="rc-pane">${seg === 'memo' ? memoHTML() : seg === 'errs' ? errsHTML() : seg === 'log' ? logHTML() : setHTML()}</div>`;
    return html;

    // ---- حفظي: the whole so far, and each surah begun, to go on with
    function memoHTML() {
      const n = Object.keys(said).filter(k => R.ayas[+k]).length, total = R.ayas.length;
      const full = Array.from({ length: 114 }, (_, i) => i + 1).filter(s => sizes[s] && got[s] >= sizes[s]).length;
      const begun = Array.from({ length: 114 }, (_, i) => i + 1).filter(s => got[s]).sort((a, b) => lastIn[b] - lastIn[a]);
      if (!n) return `<p class="rc-empty">ما تسمّعه كاملًا من الآيات يُعَدّ هنا، سورةً سورة، لتعود إليه وتتابع.</p>` + helpHTML();
      const pct = n / total * 100;
      let h = `<div class="rc-sum"><div><b>${ar(n)}</b><small>آية سمّعتها</small></div><div><b>${ar(full)}</b><small>سورة كاملة</small></div><div><b>${ar(pct < 1 ? pct.toFixed(1) : Math.round(pct))}٪</b><small>من القرآن</small></div></div>`;
      h += '<div class="group">' + begun.map(s => {
        const f = got[s] / sizes[s], nx = nextIn(s, said), doneS = got[s] >= sizes[s];
        return `<div class="row rc-sura" data-rc-sura="${s}"><span class="num">${ar(s)}</span>
          <span class="main"><span class="t">${suraName(s)}</span>
          <span class="rc-bar${doneS ? ' full' : ''}"><i style="width:${Math.max(3, Math.round(f * 100))}%"></i></span>
          <span class="s">${doneS ? 'كاملة' : `${ar(got[s])} من ${ar(sizes[s])} آية`} · ${ago(lastIn[s])}</span></span>
          <button class="rc-cont" data-rc-from="${nx}" aria-label="تابع ${suraName(s)} من الآية ${ar(R.ayas[nx][1])}">${MIC}<span>${doneS ? 'أعدها' : `من ${ar(R.ayas[nx][1])}`}</span></button></div>`;
      }).join('') + '</div>';
      return h + mapHTML(got, sizes, new Set(weak.map(([ai]) => R.ayas[ai][0])));
    }

    // ---- الأخطاء: what to go over, and what was mastered
    function errsHTML() {
      let h = '';
      if (weak.length) {
        h += `<p class="rc-hint">كل آية تُتقَن بعد قراءتها صحيحة في ${ar(MASTER_DAYS)} أيام مختلفة. المس الآية لتراها في المصحف، أو الميكروفون لتسمّعها.</p>`;
        h += '<div class="group">' + weak.map(([ai, a]) => {
          const dots = [0, 1, 2].map(j => `<i${j < a.ok.length ? ' class="on"' : ''}></i>`).join('');
          return `<button class="row rc-row" data-rc-aya="${ai}"><span class="num">${ar(R.ayas[ai][1])}</span>
            <span class="main"><span class="verse rc-snip" style="font-family:${R.font}">${snippet(ai, a.words)}</span>
            <span class="s">${suraName(R.ayas[ai][0])} · ${times(a.n)} · آخرها ${ago(a.last)}<span class="rc-dots" aria-label="${ar(a.ok.length)} من ${ar(MASTER_DAYS)} قراءات صحيحة">${dots}</span></span></span>
            <span class="rc-mic" data-rc-start="${ai}" aria-label="سمّع الآية">${MIC}</span></button>`;
        }).join('') + '</div>';
      } else h += '<p class="rc-empty">لا مواضع ضعف الآن، ما شاء الله. ما تخطئ فيه يُجمَع هنا لتراجعه.</p>';
      if (mastered.length) {
        h += `<div class="group-label">أتقنتها · ${ayaCount(mastered.length)}</div><div class="group">` + mastered.slice(0, 30).map(([ai, a]) =>
          `<button class="row rc-row rc-mastered" data-rc-aya="${ai}"><span class="num">${ar(R.ayas[ai][1])}</span>
            <span class="main"><span class="t">${ayaLabel(ai)}</span><span class="s">أتقنتها ${ago(a.at)}</span></span><span class="check">✓</span></button>`).join('') + '</div>';
      }
      return h;
    }

    // ---- السجل: this week, against the one before, and each session
    function logHTML() {
      if (!l.sessions.length) return '<p class="rc-empty">جلساتك تُحفظ هنا: ما سمّعته، ومتى، وما أخطأت فيه.</p>';
      const now = Date.now(), wk = now - 7 * 864e5, wk2 = now - 14 * 864e5;
      const thisW = l.sessions.filter(s => s.t >= wk), lastW = l.sessions.filter(s => s.t >= wk2 && s.t < wk);
      const sum = (list, f) => list.reduce((s, x) => s + (x[f] || 0), 0);
      const e1 = sum(thisW, 'errs'), e0 = sum(lastW, 'errs'), mins = Math.round(sum(thisW, 'secs') / 60);
      const trend = e0 ? (e1 <= e0 ? `الأخطاء أقل بـ ${ar(Math.round((1 - e1 / e0) * 100))}٪ من الأسبوع الماضي` : 'الأخطاء أكثر من الأسبوع الماضي') : '';
      let h = `<div class="group-label">هذا الأسبوع</div><div class="rc-sum"><div><b>${ar(thisW.length)}</b><small>جلسة</small></div><div><b>${ar(sum(thisW, 'ayas'))}</b><small>آية</small></div>
        <div><b>${ar(mins)}</b><small>دقيقة</small></div><div><b>${ar(e1)}</b><small>خطأ</small></div></div>${trend ? `<p class="rc-hint c">${trend}</p>` : ''}`;
      h += '<div class="group-label">الجلسات</div><div class="group">' + l.sessions.slice(0, 20).map(s => {
        const items = (s.list || []).filter(([ai]) => R.ayas[ai]).map(([ai, wi, e]) => wi < 0
          ? `<div class="rc-sess-i"><span class="rc-mk rc-skip"></span><b>${ayaLabel(ai)}</b><small>تجاوزت الآية كلها</small></div>`
          : `<div class="rc-sess-i"><span class="rc-mk rc-${e}"></span><b style="font-family:${R.font}">${esc(ayaTokens(ai)[wi] || '')}</b><small>${ayaLabel(ai)} · ${TYPES[e]}</small></div>`).join('');
        const again = !s.review && R.ayas[s.from] ? `<button class="rc-not" data-rc-from="${s.from}">أعد هذه الجلسة</button>` : '';
        return `<details class="rc-sess"><summary class="row"><span class="main"><span class="t">${sessionLabel(s)}</span>
          <span class="s">${ago(s.t)} · ${ayaCount(s.ayas || 1)} · ${s.errs ? errs(s.errs) : 'بلا أخطاء'}</span></span>
          <svg viewBox="0 0 24 24" class="go"><path d="M14.5 6l-6 6 6 6"/></svg></summary>
          <div class="rc-sess-list">${items || '<p class="note">بلا أخطاء، ما شاء الله.</p>'}${again}</div></details>`;
      }).join('') + '</div>';
      return h;
    }

    // ---- الإعدادات, and how it all works
    function setHTML() {
      return `<div class="group">
        ${toggle('hide', 'ابدأ والكلمات مخفية', 'تظهر كل كلمة حين تقرؤها')}
        ${toggle('sound', 'صوت واهتزاز عند الخطأ', 'نغمة خفيفة واهتزاز حين تُعلَّم كلمة')}
        ${MU() ? toggle('tajweed', 'أخطاء التجويد', 'المدّ والغنّة والإدغام: تُعلَّم الكلمة إن لم تعطها حقها') : ''}
        ${toggle('blind', 'تسميع أعمى', 'مع الإخفاء: لا أثر لما بعدك، فلا عدد للكلمات ولا أرقام للآيات')}
        ${toggle('weak', 'مواضع الضعف في المصحف', 'خط منقّط خفيف تحت كلمات أخطأت فيها')}
        <div class="row rc-goal"><span class="main"><span class="t">هدف يومي</span><span class="s">عدد الآيات التي تسمّعها كل يوم</span></span>
          <span class="rc-chips">${[0, 5, 10, 20].map(n => `<button data-rc-goal="${n}"${goal === n ? ' class="on"' : ''}>${n ? ar(n) : 'لا'}</button>`).join('')}</span></div>
        ${MU() ? '' : `<div class="row rc-goal"><span class="main"><span class="t">سرعة التعرّف</span><span class="s">السريع أخفّ وأسرع بمرتين، والدقيق أثبت قليلًا</span></span>
          <span class="rc-chips">${[['fast', 'سريع'], ['exact', 'دقيق']].map(([k, t]) => `<button data-rc-use="${k}"${Listen.which() === k ? ' class="on"' : ''}>${t}</button>`).join('')}</span></div>`}
        ${MU() ? `<div class="row rc-goal"><span class="main"><span class="t">تحديث الكلمات</span><span class="s">${RATE_NOTE[Mu.rate()]}</span></span>
          <span class="rc-chips">${[['auto', 'تلقائي'], ['fast', 'الأسرع'], ['save', 'موفّر']].map(([k, t]) => `<button data-rc-rate="${k}"${Mu.rate() === k ? ' class="on"' : ''}>${t}</button>`).join('')}</span></div>` : ''}
        <div class="row rc-model"><span class="main"><span class="t">نموذج التعرّف على التلاوة</span><span class="s" id="rcModelS">…</span></span><span id="rcModelB"></span></div>
        ${MU() ? `<div class="rc-models" id="rcModels"></div>
        <div class="row rc-model" id="rcDiag" hidden><span class="main"><span class="t">تسجيل آخر جلسة</span><span class="s">إن أخطأ التعرّف، شارك هذا التسجيل (آخر ٥ دقائق) لنحسّنه</span></span><button class="rc-not" data-rc-diag>مشاركة</button></div>` : ''}
      </div>` + helpHTML();
    }
  }

  // how it works, in a few lines
  function helpHTML() {
    const tips = [
      [MIC, 'اضغط رقم أي آية في المصحف ثم «تسميع»، أو الميكروفون أعلى الصفحة واقرأ: نجد الآية ونتابعك منها.'],
      ['<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>', '«إخفاء» يخفي ما بعد موضعك. إن توقفت، تظهر لك الكلمة التالية تلميحًا.'],
      ['<svg viewBox="0 0 24 24"><path d="M4 18h16" stroke-dasharray="2 3"/><path d="M8 13l4-7 4 7"/></svg>', 'المس الكلمة المخطوءة لترى ما سُمِع، أو لتسمعها، أو لتلغي الخطأ إن لم تخطئ.'],
      ['<svg viewBox="0 0 24 24"><path d="M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.5l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/></svg>', `تُتقَن الآية بقراءتها صحيحة في ${ar(MASTER_DAYS)} أيام مختلفة، فتخرج من مواضع الضعف.`],
      ['<svg viewBox="0 0 24 24"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/></svg>', 'يعمل على جهازك دون إنترنت، وصوتك لا يغادره.'],
    ];
    return `<details class="rc-help"${store.get('recite.used', false) ? '' : ' open'}><summary class="row"><span class="main"><span class="t">كيف يعمل التسميع</span></span><svg viewBox="0 0 24 24" class="go"><path d="M14.5 6l-6 6 6 6"/></svg></summary>
      <div class="rc-points">${tips.map(([i, t]) => `<div>${i}<span>${t}</span></div>`).join('')}</div></details>`;
  }

  // the model row in the settings, once the panel is on screen
  function mounted() {
    if (MU()) return paintModels();
    Listen.saved().then(have => {
      const s = $('#rcModelS'), b = $('#rcModelB');
      if (!s) return;
      const st = Listen.stats();
      s.textContent = (have ? `على جهازك · ${ar(Listen.mb())} م.ب · يعمل دون إنترنت` : `غير منزّل · ${ar(Listen.mb())} م.ب`)
        + (st.ms ? ` · آخر تعرّف ${ar((st.ms / 1000).toFixed(1))} ث · ${ar(st.threads)} ${st.threads > 1 ? 'أنوية' : 'نواة'}` : '');
      b.innerHTML = `<button class="rc-not" data-rc-model="${have ? 'del' : 'get'}">${have ? 'حذف' : 'تنزيل'}</button>`;
    });
  }

  // the Muaalem models, each with how fast it ran in this device's test
  async function paintModels(testing) {
    const box = $('#rcModels'), s = $('#rcModelS'), b = $('#rcModelB');
    if (!box) return;
    const have = await Mu.savedVariants(), bench = Mu.bench(), c = Mu.choice();
    if (!$('#rcModels')) return;
    s.textContent = testing ? `نختبر النماذج على جهازك… ${testing}`
      : bench ? `الأسرع على جهازك يُختار له (اختبرناه ${ago(bench.at)}): ٤ بت على المعالج الرسومي، و٨ بت على المعالج`
      : 'لم نختبرها على جهازك بعد';
    b.innerHTML = `<button class="rc-not" data-rc-model="probe"${testing ? ' disabled' : ''}>${bench ? 'اختبر من جديد' : 'اختبر جهازك'}</button>`;
    const diag = $('#rcDiag');
    if (diag) diag.hidden = !Mu.ready();
    const times = bench?.times || {}, ok = Object.values(times).filter(x => x != null), fastest = ok.length ? Math.min(...ok) : null;
    const row = x => {
      const t = times[x.id], on = c?.id === x.id, got = have[x.variant];
      const speed = t === undefined ? '<span class="rc-mt">لم يُختبر</span>'
        : t === null ? '<span class="rc-mt na">لا يعمل على جهازك</span>'
        : `<span class="rc-mt">نحو ${ar(t)} م.ث</span><span class="rc-mbar"><i style="width:${Math.max(6, Math.round(fastest / t * 100))}%"></i></span>`;
      const tags = (t === null ? [] : [x.id === bench?.best ? 'الأسرع' : '', on ? 'المستعمل' : '', got ? 'على جهازك' : '']).filter(Boolean)
        .map(k => `<span class="rc-tag${k === 'المستعمل' ? ' on' : ''}">${k}</span>`).join('');
      return `<button class="rc-m${on ? ' on' : ''}" data-rc-pick="${x.id}"${t === null ? ' disabled' : ''}>
        <span class="rc-mn">${MU_NAMES[x.id]}<small>${ar(x.mb)} م.ب</small></span>${speed}<span class="rc-tags">${tags}</span></button>`;
    };
    const base = Mu.CANDS.filter(x => Mu.BASE_IDS.includes(x.id)), big = Mu.CANDS.filter(x => !Mu.BASE_IDS.includes(x.id));
    const onBig = big.some(x => x.id === c?.id), bigTested = big.some(x => times[x.id] !== undefined);
    box.innerHTML = base.map(row).join('')
      + `<details class="rc-big"${onBig || box.querySelector('.rc-big[open]') ? ' open' : ''}><summary><span class="main"><span class="t">النموذج الكبير · اختياري</span>
          <span class="s">أدق قليلًا في الحركات والمدود، وتنزيله أكبر وأبطأ على أكثر الأجهزة. يُنزَّل حين تختاره.</span></span><svg viewBox="0 0 24 24" class="go"><path d="M14.5 6l-6 6 6 6"/></svg></summary>
        ${big.map(row).join('')}
        ${bigTested ? '' : `<button class="rc-not rc-bigtest" data-rc-model="probe"${testing ? ' disabled' : ''}>اختبرها على جهازك</button>`}
        ${onBig ? `<button class="rc-not rc-bigtest" data-rc-pick="${bench?.best || 'q4-cpu'}">العودة إلى الأسرع على جهازك</button>` : ''}
      </details>`
      + (Object.values(have).some(Boolean) ? `<div class="rc-mfoot">${Object.entries(have).filter(([, v]) => v).map(([k]) =>
      `<button class="rc-not" data-rc-delv="${k}">حذف ${k === 'q8' ? '٨ بت' : k === 'q4' ? '٤ بت' : '١٦ بت'} من جهازك</button>`).join('')}</div>` : '');
  }

  function weakAyas() {
    return Object.entries(log().ayas).filter(([ai, a]) => !a.done && R.ayas[+ai]).map(([ai]) => +ai).sort((a, b) => a - b);
  }

  function onSheetClick(e) {
    const one = e.target.closest('[data-rc-start]');
    if (one) { e.stopPropagation(); closeSheet(); start(+one.dataset.rcStart); return true; }
    if (e.target.closest('[data-rc-resume]')) { closeSheet(); start(resumeAya()); return true; }
    const from = e.target.closest('[data-rc-from]');
    if (from) { e.stopPropagation(); closeSheet(); start(+from.dataset.rcFrom); return true; }
    if (e.target.closest('[data-rc-find]')) { closeSheet(); if (!G && !F) find(); return true; }
    const sg = e.target.closest('[data-rc-seg]');
    if (sg) {
      store.set('recite.seg', sg.dataset.rcSeg);
      const y = $('#sheetBody').scrollTop;
      renderSheet();
      $('#sheetBody').scrollTop = y;
      return true;
    }
    if (e.target.closest('[data-rc-review]')) { closeSheet(); start(null, weakAyas()); return true; }
    if (e.target.closest('[data-rc-test]')) { const t = testAyas(); if (t) { closeSheet(); start(null, t, { test: true }); } return true; }
    const pick = e.target.closest('[data-rc-pick]');
    if (pick) {
      if (G) { toast('أنهِ جلسة التسميع أولًا'); return true; }
      Mu.use(pick.dataset.rcPick);
      paintModels();
      Mu.saved().then(have => { if (have) toast(`سيُستعمل ${MU_NAMES[pick.dataset.rcPick]}`); else withModel(() => paintModels()); });
      return true;
    }
    if (e.target.closest('[data-rc-diag]')) {
      Mu.recording().then(async blob => {
        if (!blob) return toast('لا تسجيل بعد — سمّع أولًا');
        const c = Mu.choice(), name = `tasmee-${c ? c.id : 'model'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.wav`;
        const file = new File([blob], name, { type: 'audio/wav' });
        const text = `${c ? MU_NAMES[c.id] : ''} · ${navigator.userAgent}`;
        try {
          if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'تسجيل التسميع', text }); return; }
        } catch (err) { if (err?.name === 'AbortError') return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      });
      return true;
    }
    const dv = e.target.closest('[data-rc-delv]');
    if (dv) { Mu.remove(dv.dataset.rcDelv).then(() => { toast('حُذف من جهازك'); paintModels(); }); return true; }
    const md = e.target.closest('[data-rc-model]');
    if (md) {
      if (md.dataset.rcModel === 'get') withModel(() => mounted());
      else if (md.dataset.rcModel === 'probe' && MU()) {
        paintModels('');
        Mu.probe((n, all) => paintModels(`${ar(n)} من ${ar(all)}`), true, true).then(() => { paintModels(); toast('انتهى الاختبار'); }, () => { paintModels(); toast('تعذر الاختبار على هذا الجهاز'); });
      }
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
    const rt = e.target.closest('[data-rc-rate]');
    if (rt) {
      Mu.setRate(rt.dataset.rcRate);
      const y = $('#sheetBody').scrollTop;
      renderSheet();
      $('#sheetBody').scrollTop = y;
      return;
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
      const id = set.dataset.rcSet;
      store.set('recite.' + id, !setting(id));
      if (id === 'sound' && setting(id)) { if (MU()) Mu.prime(); chime(true); }
      weakMap = null;
      const y = $('#sheetBody').scrollTop;
      renderSheet();
      $('#sheetBody').scrollTop = y;
      paintMarks();
      return true;
    }
    const row = e.target.closest('[data-rc-aya]');
    // an aya in the panel: a session from it, on until the reader stops
    if (row) { closeSheet(); start(+row.dataset.rcAya); return true; }
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
    if (b.dataset.rw === 'copy') {
      // for reporting a wrong mark: where, the word, what was heard and expected
      const w = G.words[k], h = G.heard?.[k] || {};
      const text = `${ayaLabel(w.ai)} · ${wordText(w)} · ${TYPES[G.errs[k]]} · سُمِع: ${h.got || '—'} · المتوقَّع: ${h.want || ''} · ${MU() && Mu.choice() ? MU_NAMES[Mu.choice().id] : ''}`;
      navigator.clipboard?.writeText(text).then(() => toast('نُسخ — أرسله لنحسّن التعرّف'), () => toast('تعذر النسخ'));
    }
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

  return { start, cancel, paint, onTap, card, suraCard, showWord, wordStats, resetWord, ago, restore, syncBubble, mic, panelHTML, mounted, onSheetClick, active: () => !!G };
})();
