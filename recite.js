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
// stopAudio, speakWord, suraName, ayaLabel, openRecite, openReciteSettings, renderSheet,
// closeSheet and flashAya from app.js at call time.
const Recite = (() => {
  const AYA_TYPES = { skip: 'تجاوزت الآية كلها', order: 'قرأتها في غير موضعها: بعد التي تليها' };
  const KIND_SHORT = { wrong: 'كلمة بأخرى', haraka: 'حركة', skip: 'تجاوز', hint: 'تلميح', madd: 'مدّ', ghunna: 'غنّة وإدغام', order: 'تقديم وتأخير', heavy: 'تفخيم وترقيق', near: 'حروف متقاربة', maddlong: 'مدّ زائد', maddnone: 'مدّ ناقص' };
  const TYPES = { wrong: 'قرأتها بكلمة أخرى', haraka: 'أخطأت في حركتها', skip: 'تجاوزتها', hint: 'احتجت تلميحًا', madd: 'لم تعطِ المدّ حقّه', ghunna: 'أخطأت في الغنّة أو الإدغام', order: 'قدّمتها أو أخّرتها عن جارتها',
    heavy: 'خلطت بين حرف مفخّم ونظيره المرقّق', near: 'أبدلت حرفًا بحرف قريب منه', maddlong: 'زدت في المدّ الطبيعي', maddnone: 'مددت حرفًا لا مدّ فيه' };
  const MASTER_DAYS = 3;
  const HINT_AFTER = 7000; // ms of silence on a hidden word before it shows
  const CLS = ['rc-weak', 'rc-here', 'rc-done', 'rc-now', 'rc-hid', 'rc-blind', 'rc-peek', 'rc-wrong', 'rc-haraka', 'rc-skip', 'rc-hint', 'rc-madd', 'rc-ghunna', 'rc-order', 'rc-heavy', 'rc-near', 'rc-maddlong', 'rc-maddnone'];
  // hidden, and blind (a setting): no trace of the words ahead, their number or their ayas'
  const blind = () => !!G?.hide && !G.done && store.get('recite.blind', false);
  // Muaalem listens in Hafs (its phonetic script is Hafs's)
  const MU = () => R.id === 'hafs' && typeof Mu !== 'undefined';
  const MU_NAMES = { 's8-cpu': 'المتدفّق · ٨ بت · المعالج', 'q8-cpu': '٨ بت · المعالج', 'q8-gpu': '٨ بت · المعالج الرسومي', 'fp16-gpu': '١٦ بت · المعالج الرسومي', 'q4-cpu': '٤ بت · المعالج', 'q4-gpu': '٤ بت · المعالج الرسومي' };
  const ready = () => MU() ? Mu.ready() : Listen.ready();
  // all a recitation needs, done (prep): no update waiting, the microphone allowed, the
  // model loaded and prepared for every window it will read
  let micOk = false;
  const prepared = () => MU() ? Mu.ready() && Mu.warmed() && micOk && !UPD.stale : Listen.ready();

  // the session: words in order { ai, p, n (word on its page), wi (word in its aya), of (aya length), nt (normalised) },
  // idx 'page:n' -> word, pos = next word to say, errs[k] = type, gone = mistakes taken back
  let G = null, dirty = false, timer = 0, leadTimer = 0;

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
  // (the second model once downloaded for Hafs, 111 MB, replaced by ctc.js: let go of)
  try { caches.open('transformers-cache').then(c => c.keys().then(ks => ks.forEach(r => r.url.includes('/deepdml/') && c.delete(r)))).catch(() => {}); store.set('verify.ok', null); } catch {}
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
  // a browser inside another app (WhatsApp, Facebook, the Google app…) often gives no microphone
  // and keeps no downloads, and Xiaomi's own browser is behind on what the model needs: said
  // before the first recitation there, with a way to the phone's real browser (Chrome by an
  // Android intent, Safari by its own address scheme; the link copied too, should neither open).
  // Once per opening inside an app, once ever in Xiaomi's browser; «المتابعة هنا» goes on as asked
  let brTold = false;
  function browserFirst(go) {
    const I = typeof Install !== 'undefined' ? Install : null, br = I?.browser;
    if (!I || I.inApk || I.os === 'desktop' || brTold || !['inapp', 'google', 'miui'].includes(br) || (br === 'miui' && store.get('rec.brTold', false))) return false;
    brTold = true;
    const ios = I.os === 'ios', name = ios ? 'Safari' : 'Chrome';
    $('#rbName').textContent = name;
    $('#rbGo').textContent = `افتح في ${name}`;
    $('#rbLead').textContent = br === 'miui'
      ? 'متصفح Mi يتأخر عمّا يحتاج إليه التسميع، فقد يكون بطيئًا أو لا يعمل. في Chrome يعمل أسرع، ويمكن تثبيت التطبيق منه.'
      : 'أنت داخل متصفح تطبيق آخر، وهو في الغالب لا يعطي الميكروفون ولا يحفظ نموذج التسميع. افتح الصفحة في متصفح الهاتف ليعمل التسميع كما ينبغي.';
    $('#rbGo').onclick = () => {
      const url = location.origin + location.pathname;
      navigator.clipboard?.writeText(url).catch(() => {});
      location.href = ios ? 'x-safari-' + url
        : `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
      toast(`نُسخ الرابط — إن لم يُفتح ${name} فالصقه فيه`, 4000);
    };
    $('#rbStay').onclick = () => { if (br === 'miui') store.set('rec.brTold', true); hide($('#recBrowser')); go(); };
    show($('#recBrowser'));
    return true;
  }
  // a Xiaomi phone (Redmi, POCO): from the browser's name for itself, or the phone's model where
  // the browser tells it (Chrome hides it from the name; Xiaomi's models are numbered 2201117TG, M2101K6G)
  let XIAOMI = /Xiaomi|Redmi|POCO|MIUI|HyperOS/i.test(navigator.userAgent);
  try { navigator.userAgentData?.getHighEntropyValues?.(['model']).then(v => { if (/redmi|poco|xiaomi|^mi \w|^M?2[0-5]\d{2}[0-9A-Z]{4,}$/i.test(v?.model || '')) XIAOMI = true; }).catch(() => {}); } catch {}
  // intent: what is about to happen ({ start: [from, review, opts] }), to go on with after an update
  function withModel(then, intent) {
    if (browserFirst(() => withModel(then, intent))) return;
    if (MU()) {
      Mu.prime();
      // every use is checked first (its screen shown only for what takes a while or needs the reader)
      if (!Mu.choice()) { pending = then; paintDl(); show($('#recIntro')); return; }
      if (Mu.ready()) return prep(then, intent);
      Mu.saved().then(have => {
        if (!have) { pending = then; paintDl(); show($('#recIntro')); return; }
        prep(then, intent);
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
    if (F) { stopFind(); findMu(true); return; }
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

  // ---- before a session: each thing it needs, on a screen, one after the other, so none of
  // it happens during the recitation (an update loading the page again, the microphone's
  // question, the model loaded or prepared on the GPU, where a phone short of memory would
  // close the page). Shown only for what is left to do; then the session starts.
  // Shown only when it is needed: something takes a while (PREP_SHOW_MS), fails, or asks for a
  // tap; all ready and quick, the session just starts
  let prepRun = 0, prepT = 0;
  const PREP_SHOW_MS = 900;
  const reveal = () => { clearTimeout(prepT); show($('#recPrep')); };
  const ask = (text, f) => { $('#rpGo').hidden = false; $('#rpGo').textContent = text; $('#rpGo').onclick = f; reveal(); };
  function prepStep(id, state, note = '') {
    if (state === 'fail') reveal();
    const li = $(`#recPrep [data-rp="${id}"]`);
    li.className = state; // '', 'doing', 'done', 'skip', 'fail'
    li.querySelector('small').textContent = note;
  }
  async function prep(then, intent, after) {
    const run = ++prepRun;
    prepThen = then; prepIntent = intent;
    ['update', 'mic', 'model', 'warm'].forEach(id => prepStep(id, ''));
    $('#rpGo').hidden = true;
    // (closed more than once: what the reader can do about it; a Xiaomi phone closes apps the soonest, and says where to stop it)
    const again = intent?.killed && store.get('mu.kills', 0) >= 2 ? (XIAOMI
      ? ' ليبقى مفتوحًا على هواتف شاومي وريدمي: أغلق التطبيقات الأخرى، واقفل هذا التطبيق في قائمة التطبيقات الأخيرة (ضغطة مطوّلة عليه ثم القفل)، واجعل «موفّر البطارية» له «بلا قيود» من إعدادات الهاتف ← التطبيقات.'
      : /Android/i.test(navigator.userAgent) ? ' إن تكرر ذلك فأغلق التطبيقات الأخرى قبل التسميع.' : '') : '';
    $('#rpLead').textContent = intent?.killed ? `أغلق الهاتف التطبيق أثناء القراءة ليوفّر الذاكرة${intent.light ? '، فاخترنا طريقة أخف لا تُثقل عليه' : ''}. نكمل من حيث توقفت.${again}`
      : intent?.fresh ? 'أنعشنا التطبيق قبل أن تبدأ، لتمضي القراءة دون انقطاع.'
      : after && intent?.mic ? 'أُعيد تحميل التطبيق. نتأكد من الميكروفون ونكمل.'
      : after ? 'حُدِّث التطبيق إلى نسخته الجديدة. نكمل تجهيز التسميع.' : 'لحظات، نجهّز كل شيء قبل أن تبدأ، فلا يقطعك شيء أثناء القراءة.';
    clearTimeout(prepT);
    prepT = setTimeout(() => run === prepRun && reveal(), PREP_SHOW_MS);
    const live = () => run === prepRun;
    // 1. an update waiting: applied now, the page loaded again, and on from here (prepResume).
    // And on a phone that closed the page while it listened before: a page open a long while is
    // loaded fresh now, before the reading (its memory all free for the model), not during it
    if (!UPD.stale && !after && (intent?.start || intent?.find) && store.get('mu.kills', 0) && performance.now() > FRESH_MS) {
      prepStep('update', 'doing', 'نُنعش التطبيق قبل أن تبدأ'); reveal();
      await new Promise(r => setTimeout(r, 600));
      if (!live()) return;
      keep(true);
      store.set('upd.resume', { t: Date.now(), prep: { ...(intent || {}), fresh: true } });
      $('#loading').textContent = 'لحظة…'; $('#loading').hidden = false;
      setTimeout(() => location.reload(), 200);
      return;
    }
    if (UPD.stale) {
      prepStep('update', 'doing', 'نسخة جديدة جاهزة — تُطبَّق الآن ثم نكمل'); reveal();
      await new Promise(r => setTimeout(r, 900));
      if (!live()) return;
      return applyUpdate(intent ? { prep: intent } : { prep: {} });
    }
    prepStep('update', 'done', after && !intent?.mic ? 'حُدِّث الآن' : 'التطبيق محدَّث');
    // 2. the microphone (asked once per opening of the app by some browsers)
    // heard working once since the app opened: not asked for again (some phones ask each time it is
    // opened), unless the permission was taken back; while reading, Mu watches that sound comes in
    let perm = null;
    // (some browsers never answer this: not waited on)
    try { perm = (await Promise.race([navigator.permissions?.query({ name: 'microphone' }), new Promise(r => setTimeout(r, 1000))]))?.state; } catch {}
    if (!micOk || perm === 'denied') {
      prepStep('mic', 'doing', 'اسمح للتطبيق باستعمال الميكروفون، ونتأكد أن الصوت يصل');
      // the browser's question not answered after a while: it may not have shown at all (some
      // phones, Xiaomi among them, ask in the phone's settings first). How, and try again
      const slow = setTimeout(async () => {
        let st = null;
        try { st = (await Promise.race([navigator.permissions?.query({ name: 'microphone' }), new Promise(r => setTimeout(r, 500))]))?.state; } catch {}
        if (!live() || st === 'granted') return; // allowed: still opening (asked again meanwhile)
        prepStep('mic', 'doing', 'لم يظهر طلب الإذن؟ اسمح للمتصفح بالميكروفون من إعدادات الهاتف: التطبيقات ← المتصفح (Chrome) ← الأذونات ← الميكروفون ← السماح، ثم أعد المحاولة');
        ask('أعد المحاولة', () => prep(then, intent));
      }, 8000);
      const r = await Mu.micCheck();
      clearTimeout(slow);
      if (!live()) return;
      $('#rpGo').hidden = true;
      // allowed, and the phone never gave the microphone: the page loaded again, once, by itself
      // (it is given at once then), and on from here
      let hung = null;
      try { hung = sessionStorage.getItem('micHung'); r === 'hung' ? sessionStorage.setItem('micHung', '1') : sessionStorage.removeItem('micHung'); } catch {}
      if (r === 'hung' && !hung) {
        prepStep('mic', 'doing', 'سُمح به — نعيد تحميل التطبيق ليعمل'); reveal();
        return reloadApp(intent);
      }
      if (r !== 'ok') {
        prepStep('mic', 'fail', r === 'denied' ? 'لم يُسمح به — اسمح به من إعدادات المتصفح ثم أعد المحاولة'
          : r === 'silent' ? 'لا يصل منه صوت — إن فصلت سماعة أو غيّرت الميكروفون فأعد تحميل التطبيق'
          : r === 'hung' ? 'سمحتَ به، لكن الهاتف لم يُعطِ المتصفح الميكروفون. افتح إعدادات الهاتف ← التطبيقات ← المتصفح (Chrome) ← الأذونات ← الميكروفون ← «السماح أثناء استخدام التطبيق»، وأغلق أي تطبيق يستعمله (مكالمة، تسجيل، مساعد صوتي)، ثم أعد المحاولة'
          : 'تعذّر فتح الميكروفون — تأكد أن المتصفح مسموح له به في إعدادات الهاتف وأن تطبيقًا آخر لا يستعمله، ثم أعد تحميل التطبيق');
        $('#recPrep [data-rp="mic"] small').textContent += ` (${r}·${Mu.micWhy() || '-'})`;
        if (r === 'denied' || r === 'hung') ask('أعد المحاولة', () => prep(then, intent));
        else ask('أعد تحميل التطبيق', () => reloadApp(intent));
        return;
      }
      micOk = true;
    }
    if (!live()) return;
    prepStep('mic', 'done', 'يعمل');
    // 3. the model, from the device (chosen before the stream was there: timed again first, once)
    if (!Mu.ready()) {
      const up = await Mu.upgrade((n, all) => live() && prepStep('model', 'doing', `نختبر أسرع طريقة لجهازك… ${ar(n)} من ${ar(all)}`)).catch(() => null);
      if (!live()) return;
      if (up === 'offer') toast('طريقة أسرع متاحة لجهازك: «المتدفّق» في إعدادات التسميع ← النماذج');
    }
    if (!Mu.ready()) {
      prepStep('model', 'doing', 'يُحمَّل من جهازك…');
      try { await Promise.all([Mu.load(p => live() && prepStep('model', 'doing', `يُحمَّل من جهازك… ${ar(Math.round(p * 100))}٪`)), Mu.sounds()]); }
      catch { if (live()) modelFail(); return; }
    } else await Mu.sounds();
    if (!live()) return;
    if (!Mu.ready()) { modelFail(); return; }
    prepStep('model', 'done', `${MU_NAMES[Mu.choice()?.id] || ''} · يعمل`);
    // 4. prepared for every window it will read (the GPU); nothing to do on a CPU
    if (!Mu.warmed()) {
      prepStep('warm', 'doing', 'يُهيَّأ لقراءتك…');
      await Mu.warm(p => live() && prepStep('warm', 'doing', `يُهيَّأ لقراءتك… ${ar(Math.round(p * 100))}٪`));
    }
    if (!live()) return;
    if (!Mu.ready()) { modelFail(); return; }
    prepStep('warm', 'done', 'جاهز');
    // after a reload the page may have no tap yet to let sound and the microphone start: on at once
    // if the browser lets it (the reading not paused at all), else one tap asked for
    if (after) {
      Mu.prime();
      await new Promise(r => setTimeout(r, 250));
      if (!live()) return;
      if (Mu.sound()?.state === 'running') { clearTimeout(prepT); hide($('#recPrep')); then(); return; }
    }
    if (after) { ask(intent?.killed ? 'أكمل القراءة' : 'ابدأ التسميع', () => { Mu.prime(); hide($('#recPrep')); then(); }); return; }
    clearTimeout(prepT);
    // (shown: the last tick seen a moment)
    if (!$('#recPrep').hidden) { await new Promise(r => setTimeout(r, 350)); if (!live()) return; hide($('#recPrep')); }
    then();
  }
  $('#rpCancel').onclick = () => { prepRun++; clearTimeout(prepT); hide($('#recPrep')); };
  // the model didn't load (or stopped answering): said so, with a way to try again
  function modelFail() {
    prepStep('model', 'fail', 'تعذّر تحميله على هذا الجهاز — أعد المحاولة، وإن تكرر فأغلق التطبيقات الأخرى وأعد فتح التطبيق');
    ask('أعد المحاولة', () => { Mu.prime(); prep(prepThen, prepIntent); });
  }
  let prepThen = null, prepIntent = null;
  const FRESH_MS = 15 * 60e3;
  // the app loaded again, safely: what was being said is kept (it comes back paused), and what
  // was about to begin goes on after (prepResume): the way out when the microphone is lost
  function reloadApp(intent) {
    if (G?.run) pause();
    keep(true);
    store.set(ALIVE, null);
    store.set('upd.resume', { t: Date.now(), prep: { ...intent, mic: true } });
    $('#loading').textContent = 'جارٍ إعادة تحميل التطبيق…';
    $('#loading').hidden = false;
    setTimeout(() => location.reload(), 500);
  }
  // listening, the microphone sends nothing, and taking it again didn't help (Mu.dead): the
  // reading is paused, and the reader is told, with the reload one tap away
  Mu.dead?.(() => {
    micOk = false;
    if (F) stopFind();
    if (G?.run) pause();
    prepRun++;
    ['update', 'mic', 'model', 'warm'].forEach(id => prepStep(id, ''));
    prepStep('update', 'done', '');
    prepStep('mic', 'fail', 'لا يصل منه صوت — إن فصلت سماعة أو غيّرت الميكروفون، أعد تحميل التطبيق، وتعود جلستك كما هي');
    $('#rpLead').textContent = 'توقف الميكروفون عن إرسال الصوت، فأوقفنا التسميع مؤقتًا.';
    // (a session with nothing said yet is begun again after; one under way comes back as it was)
    const g = G, again = g && !g.pos && !g.done ? { start: [g.review || g.test ? null : g.ayas[0], g.review || g.test ? g.ayas : null, { test: g.test }] } : null;
    $('#rpGo').hidden = false; $('#rpGo').textContent = 'أعد تحميل التطبيق'; $('#rpGo').onclick = () => reloadApp(again);
    show($('#recPrep'));
  });
  // the page loaded again for an update during a preparation: on with it
  function prepResume() {
    const a = store.get(ALIVE, null);
    store.set(ALIVE, null);
    if (a && Date.now() - a.t < ALIVE_MS && !store.get('upd.resume', null) && MU() && Mu.choice()) { killed(a); return; }
    const u = store.get('upd.resume', null);
    store.set('upd.resume', null);
    if (!u?.prep || Date.now() - u.t > 3 * 60e3 || !MU() || !Mu.choice()) return;
    const s = u.prep.start;
    prep(s ? () => start(s[0], s[1], { ...s[2], checked: true }) : u.prep.find ? () => findMu(true) : () => restore(), u.prep, true);
  }

  // the phone closed the page while it listened (short of memory: the model and the microphone
  // take a lot, and a phone frees it by closing the page, which opens again): a heartbeat while
  // listening; the page loaded right after one, and not by a reload of ours, was closed so.
  // A lighter way to read is chosen (so it isn't closed again), and the reading goes on from
  // where it was, a tap away (the restored session, or begun again where it began)
  const ALIVE = 'rec.alive', ALIVE_MS = 12e3, GRACE_MS = 20e3;
  const graced = () => G?.grace && Date.now() < G.grace;
  let aliveAt = 0;
  function alive() {
    if (Date.now() - aliveAt < 2000) return;
    aliveAt = Date.now();
    const g = G;
    store.set(ALIVE, { t: aliveAt, find: !g && !!F,
      at: g ? [g.review || g.test ? null : g.ayas[0], g.review || g.test ? g.ayas : null, { test: g.test }] : null });
  }
  async function killed(a) {
    store.set('mu.kills', store.get('mu.kills', 0) + 1);
    // the session as it was kept (the model is ready by then: it comes back at once) and on, listening
    const then = () => {
      if (!G) restore();
      // (the words read meanwhile, unheard, aren't marked skipped: graced)
      if (G && !G.done) { if (!G.run) { G.grace = Date.now() + GRACE_MS; resume(); toast('نكمل من حيث توقفت'); } }
      else if (a.find) findMu(true);
      else if (a.at) start(a.at[0], a.at[1], { ...a.at[2], checked: true });
    };
    const light = await Mu.lighter().catch(() => null);
    prep(then, { mic: true, killed: true, light }, true);
  }

  // ---- session

  // from an aya to the end of its surah, or just the ayas given (a review or a test);
  // opts.test hides the words, opts.seed is the phrase that found the aya (bubble)
  function start(from, review, opts = {}) {
    // (a surah carried on into the next: the session goes on as it is, never prepared again)
    // a reading going on (into the next surah, found by reciting) or a session brought back paused only needs the
    // model; anything else the reader begins is checked first, on its screen (withModel → prep)
    const going = opts.carry || opts.stream || opts.seed || opts.restore || opts.checked;
    if (going ? !ready() : true) return withModel(() => start(from, review, { ...opts, checked: true }), going ? null : { start: [from, review, opts] });
    cancel();
    stopFind();
    stopAudio();
    closeActions();
    const ayas = review || [];
    if (!review) for (let a = from; a < R.ayas.length && R.ayas[a][0] === R.ayas[from][0] && ayas.length < 300; a++) ayas.push(a);
    const words = ayas.flatMap(ayaWords);
    if (!words.length) return;
    G = { ayas, words, idx: new Map(words.map((w, k) => [w.p + ':' + w.n, k])), pos: 0, errs: {}, gone: new Set(),
      hide: !!opts.test || (!opts.seed && store.get('recite.hide', false)), fast: setting('fastOn'), light: MU() && !!store.get('recite.light', false), run: false, secs: 0, busy: 0,
      review: !!review && !opts.test && !opts.kind, kind: opts.kind || null, test: !!opts.test, lastP: null, miss: 0, tent: 0, found: !!opts.stream };
    // Muaalem: c = the aya being said (in G.ayas), w0 = its first word still to
    // match, cut = how much of the reading belongs to ayas already done
    if (MU()) {
      const starts = [];
      words.forEach((w, k) => { if (w.wi === 0) starts.push(k); });
      G.mu = { c: 0, w0: opts.w0 || 0, cut: opts.cut || 0, final: '', tent: '', starts, lead: true, open: true, stream: !!opts.stream, late: !!opts.stream, letPairs: {} };
      G.pos = G.tent = G.mu.w0; // found by reciting from inside the aya: from that word
      G.heard = {}; // k -> { got, want }: what was heard for a word marked, and how it should sound
      if (opts.carry) Object.assign(G.mu, opts.carry, { lead: true, open: true }); // the reading of the surah before goes on
    }
    // begun from an aya: on into the next surahs until the reader stops
    G.chain = !review && !opts.test && !opts.kind;
    // brought back after the page reloaded: where it was, paused
    const back = opts.restore;
    if (back) {
      Object.assign(G, { pos: back.pos, tent: back.pos, errs: back.errs, gone: new Set(back.gone), secs: back.secs, hide: back.hide, review: back.review, kind: back.kind || null, chain: !back.review && !back.test && !back.kind });
      if (G.mu) {
        const m = G.mu;
        m.c = Math.max(0, m.starts.findLastIndex(k => k <= G.pos));
        m.w0 = G.pos - m.starts[m.c];
        G.heard = back.heard || {};
      }
    }
    // found by the header mic (Muaalem): the words said while it made sure count as said, its
    // mistakes as mistakes, and the reading goes on from the next word
    if (opts.said?.n && G.mu) {
      const k0 = G.mu.w0;
      for (const [i, e, got, want, v] of opts.said.errs) if (k0 + i < words.length) {
        G.errs[k0 + i] = e; G.heard[k0 + i] = { got, want };
        if (v && opts.stream) (G.saidVer ||= []).push({ k: k0 + i, e, ...v });
      }
      G.mu.goneAt = (opts.said.gone || []).filter(x => k0 + x.k < words.length).map(x => ({ ...x, k: k0 + x.k })); // (a madd not heard there: counted on)
      G.pos = G.tent = Math.min(words.length, k0 + opts.said.n);
      const m = G.mu;
      if (opts.stream) { m.cut = opts.said.at || 0; m.lead = false; } // the reading goes on from where it got to
      m.c = Math.max(0, m.starts.findLastIndex(k => k <= Math.min(G.pos, words.length - 1)));
      m.w0 = Math.min(G.pos, words.length) - m.starts[m.c];
      if (m.w0 >= words[m.starts[m.c]].of && m.c + 1 < ayas.length) { m.c++; m.w0 = 0; }
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
      secs: G.secs + (G.run ? (Date.now() - G.t) / 1000 : 0), hide: G.hide, review: G.review, kind: G.kind, test: G.test });
  }
  function restore() {
    if (store.get('upd.resume', null)?.prep) return; // an update came mid-preparation: prepResume brings it back
    const a = store.get(ALIVE, null);
    if (a && Date.now() - a.t < ALIVE_MS) return; // the phone closed the page as it listened: prepResume (killed)
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
    clearInterval(leadTimer);
    leadTimer = setInterval(lead, LEAD_EVERY);
    paintBar();
  }
  function pause() {
    if (!G?.run) return;
    keep(true);
    store.set(ALIVE, null);
    G.run = false; G.voice = false; G.secs += (Date.now() - G.t) / 1000;
    clearInterval(timer); clearInterval(leadTimer); showLead(null);
    if (MU()) {
      // what was read to the end counts; the next stretch is matched from the first word not yet said
      const g = G;
      Mu.stop().then(() => {
        if (G !== g || !g.mu) return;
        g.mu.tent = '';
        muFollow(false);
        if (g.done) {
          muSettle(); paint(); paintDone();
          const m = g.mu, all = m.final + m.tent, c0 = Match.charAt(all, m.cut);
          // (to the end of its last word heard)
          const ce = m.endAt > m.cut ? Math.min(m.at.length - 1, Match.charAt(all, m.endAt)) : m.at.length - 1;
          (m.c < g.ayas.length && m.at?.length ? recheck(g, g.ayas[m.c], m.starts[m.c] + m.w0, m.at[c0], m.at[ce] + 10) : Promise.resolve())
            .finally(() => g.checked?.());
          return;
        }
        const m = g.mu;
        // stopped at the aya's end: its last word heard, but not yet decided (a stop drops its last
        // haraka or tanween, which may still have been coming), so it is judged now, as said; else
        // the reading would go on expecting it, and the next aya's first words would mark it
        if (m.c < G.ayas.length) {
          const endK = m.starts[m.c] + G.words[m.starts[m.c]].of;
          if (G.tent >= endK && G.pos < endK) { muSettle(); paint(); }
        }
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
    clearInterval(timer); clearInterval(leadTimer);
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
  const MU_TYPE = { haraka: 'haraka', letter: 'wrong', extra: 'wrong', skipped: 'skip', madd: 'madd', ghunna: 'ghunna', order: 'order', heavy: 'heavy', near: 'near', maddlong: 'maddlong', maddnone: 'maddnone' };
  function onMu(g, d) {
    if (G !== g) return;
    if (g.done) { g.mu.final = d.final; g.mu.tent = d.tent; g.mu.conf = d.conf; g.mu.alts = d.alts; g.mu.at = d.at; return; } // the last of it, read after «finish»: pause() applies it
    const m = g.mu, grew = d.final.length + d.tent.length !== m.final.length + m.tent.length;
    m.final = d.final; m.tent = d.tent; m.conf = d.conf; m.alts = d.alts; m.at = d.at;
    if (g.saidVer?.length && m.at?.length) saidVerify(g);
    if (grew && g.run) {
      g.lastAct = Date.now();
      if (!g.voice) { g.voice = true; paintBar(); }
      clearTimeout(g.voiceT);
      g.voiceT = setTimeout(() => { if (G === g) { g.voice = false; paintBar(); } }, 900);
    }
    if (grew) speed(g);
    behind(g, d);
    muFollow(false);
    if (grew) g.grewAt = Date.now();
    atEnd(g);
  }
  // a phone too slow to keep up with the reader (a full read's letters out LIGHT_LAG after their
  // sound came in, the middle of the last LIGHT_N reads): the model then reads in long catch-up
  // stretches, where a madd's or a ghunna's length and a letter's weight are heard wrong, and were
  // marked wrongly. The light way then: words and harakat checked as ever, lengths and letters
  // told from their like not. By itself both ways (back under LIGHT_OK), said once; kept for the
  // next session to begin as this one ended
  const LIGHT_LAG = 2000, LIGHT_OK = 1200, LIGHT_N = 6;
  function behind(g, d) {
    if (d.end == null || !(d.lag >= 0) || !g.run) return; // (full reads only: a glance reads the newest alone)
    const l = g.lags ||= [];
    l.push(d.lag);
    if (l.length < LIGHT_N) return;
    if (l.length > LIGHT_N) l.shift();
    const mid = [...l].sort((a, b) => a - b)[LIGHT_N >> 1];
    if (!g.light && mid > LIGHT_LAG) {
      g.light = true; g.lags = [];
      store.set('recite.light', true);
      if (!g.lightSaid && (setting('tjMadd') || setting('tjGhunna'))) { g.lightSaid = true; toast('هاتفك يتأخر عن قراءتك: وضع خفيف، بلا فحص المدّ والغنّة', 3500); }
    } else if (g.light && mid < LIGHT_OK) { g.light = false; g.lags = []; store.set('recite.light', false); }
  }
  const light = () => G ? !!G.light : false;
  // how fast the reader reads: sounds a second over the last FAST_WIN frames (40 ms) heard (each sound's time to
  // the next, a pause counted as at most 0.4 s). Fast reading turns the fast mode on by itself, past
  // FAST_AT for FAST_ON_MS; reading at a usual pace off, under FAST_OFF for FAST_OFF_MS (readings at a
  // usual pace measured 6.5 to 10.5, fast ones 13 to 14.6: the usual pace never in fast mode). Over a
  // short stretch (1.6 s) and at once both ways (the reader asked: a few words hurried are judged as fast reading, not as
  // mistakes), quietly (the bar's «سريع» lit). For this session only; the reader's own choice
  // («سريع») is left alone FAST_OWN_MS
  const FAST_WIN = 40, FAST_N = 14, FAST_AT = 12, FAST_OFF = 10.5, FAST_ON_MS = 0, FAST_OFF_MS = 0, FAST_OWN_MS = 30000;
  function speed(g) {
    // (of the final sounds only: the tentative ones, of a glance's short read, run fast and loose)
    const m = g.mu, all = m.final + m.tent, at = m.at, h = m.final;
    if (!at || at.length !== all.length || !h.length) return;
    let n = 0, t = 0, next = null;
    for (let c = h.length - 1; c >= 0 && at[h.length - 1] - at[c] < FAST_WIN; c--) {
      if (c > 0 && h[c] === h[c - 1] && 'اۦۥں'.includes(h[c])) continue; // (a madd's run: one sound)
      if (next != null) { t += Math.min(10, next - at[c]); n++; }
      next = at[c];
    }
    if (n < FAST_N || !t) return;
    g.speed = n / (t * 0.04);
    const now = Date.now();
    g.fastAt = g.speed > FAST_AT ? g.fastAt || now : 0;
    g.slowAt = g.speed < FAST_OFF ? g.slowAt || now : 0;
    if (now - (g.ownAt || 0) < FAST_OWN_MS) return;
    if (!fast() && g.fastAt && now - g.fastAt >= FAST_ON_MS) setFast(true);
    else if (fast() && g.slowAt && now - g.slowAt >= FAST_OFF_MS) setFast(false);
  }
  function setFast(on, say) {
    G.fast = on;
    if (say) toast(say);
    paintBar();
  }

  // the last word of the session heard, and nothing more for a moment: it is judged as said (a stop
  // drops its last vowel, and the last sounds are final only a second or more later) and the session ends.
  // Not while the reader's voice goes on: a madd held at the end (الضَّاۤلِّينَ) adds no letters for a
  // while, so the voice must have stopped END_VOICE too (but at most END_MAX after the last letter,
  // in a room loud enough to sound like a voice all along)
  const END_QUIET = 1000, END_VOICE = 700, END_MAX = 6000;
  function atEnd(g) {
    clearTimeout(g.endT);
    if (G !== g || !g.run || g.done || !g.mu || G.pos >= G.words.length || G.tent < G.words.length || g.mu.c !== G.ayas.length - 1) return;
    const since = Date.now() - (g.grewAt || 0);
    const wait = Math.max(END_QUIET - since, since < END_MAX ? END_VOICE - Mu.quiet() : 0);
    if (wait > 0) { g.endT = setTimeout(() => atEnd(g), Math.min(wait, 250) + 20); return; }
    muSettle(true);
    if (G.pos >= G.words.length) { paint(); G.chain ? chain() : finish(); }
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
      // and the aya after the next too: what was heard past the next then has an aya to line
      // up with, so an aya skipped (and the two after it said) isn't stretched over the next
      // one's words, putting everything after it an aya behind
      const nx2 = after && !done ? G.ayas[m.c + 2] : null;
      if (nx2 != null) after = Mu.expect2(after, Mu.expect(nx2));
      const cur = Mu.expect(ai, m.w0), ex = after ? Mu.expect2(cur, after) : cur;
      // what was heard from the cut on, as heard (a madd's run whole: its length is a tajweed check)
      const all = m.final + m.tent, c0 = Match.charAt(all, m.cut);
      let sub = all.slice(c0), fin = Math.max(0, m.final.length - c0), last = done;
      // a long stretch heard at once (the place found late, by the header mic or after the reader went
      // elsewhere) is taken as it was heard: the aya being said and a little after it, then on from the
      // next, as when it came in (all of it at once is explained as sounds before the aya). Only
      // until it has caught up: a reading as it comes in is never cut so (a short aya such as الم
      // after an opening not set aside would never be found in what is left)
      const cu = Match.units(cur.ph).length, su = Match.units(sub).length;
      if (m.late && su <= cu * 1.5 + 45) m.late = false;
      if (m.late) { const cc = Match.charAt(sub, Math.round(cu * 1.25) + 10); sub = sub.slice(0, cc); fin = Math.min(fin, cc); last = false; }
      // (each natural madd of the aya as last heard: this reader's own length, taken in as it ends)
      if (m.tjAt !== ai + ':' + m.w0) { m.tjAt = ai + ':' + m.w0; m.tjSeen = {}; m.letSeen = {}; }
      const seen = m.tjSeen, lets = m.letSeen, gones = m.goneSeen = {};
      const st = Match.words(ex, sub, fin, last, { fast: fast(), freeLead: m.lead, conf: m.conf.slice(c0, c0 + sub.length), alts: m.alts.slice(c0, c0 + sub.length), at: m.at?.slice(c0, c0 + sub.length), tajweed: { ...tjRules(), pace: pace(), seen: (k, hl, d) => { if (k < cu && !fast()) seen[k] = [hl, d]; }, ...goneRules(gones, m.goneAt ||= [], cu) }, letters: { ...letRules(), heard: (pk, k) => { if (k < cu) lets[k] = pk; } } });
      // (a madd not heard a second time: the first, in an aya before, marked too)
      goneMark(gones, m.goneAt, (gk, got, want) => { if (!G.errs[gk]) { G.errs[gk] = 'madd'; G.heard[gk] ||= { got, want }; } });
      // (a letter said as its like a second time: the first, in an aya before, marked too)
      for (const [pk, ks] of Object.entries(m.letPairs || {})) if (Array.isArray(ks) && ks.length && Object.values(lets).includes(pk) && letTimes(pk) >= letNeed(pk)) {
        for (const gk of ks) if (!G.errs[gk]) { G.errs[gk] = Match.pairType(pk); G.heard[gk] ||= { got: pk[1], want: pk[0] }; }
      }
      const n0 = cur.spans.length;
      const begun = nx != null && st.slice(n0, n0 + 2).some(x => x.state === 'ok' || x.state === 'err');
      muApply(st.slice(0, n0), begun, cur);
      const end = st[n0 - 1]?.state === 'ok' || st[n0 - 1]?.state === 'err' ? st[n0 - 1].at?.[1] : null;
      if (end != null) m.endAt = m.cut + end; // where the aya's last word ended in what was heard
      // (past: the aya said to its end — where it ended, in sub)
      const past = end != null && nx != null ? Match.charAt(sub, end) : null;
      // the next aya begun with more of its words taken for wrong ones than heard right, after an
      // aya said to its end: the reader may be elsewhere (gone back, ayas left out, another sura).
      // Looked for first, once enough is heard; the next aya is gone on to, its words marked, only
      // when what was heard is found nowhere else
      const weak = begun && !done && past != null && st.slice(n0).filter(x => x.state === 'ok').length < st.slice(n0).filter(x => x.state === 'err').length;
      // (tracked: where the reading is among the ayas around is the tracker's to say, muTrack; asked
      // only when the reading stops fitting: sounds heard after the aya's end that don't begin the
      // next, or mistakes piling up in the aya, or nothing of it heard in a long stretch)
      const tracked = !!m.at?.length;
      { const okN = st.slice(0, n0).filter(x => x.state === 'ok').length, badN = st.slice(0, n0).filter(x => x.state === 'err').length;
        m.trkNeed = !done && ((past != null && (!begun || st.slice(n0).filter(x => x.state === 'ok').length < st.slice(n0).filter(x => x.state === 'err').length) && Match.units(sub.slice(past)).length >= 8) || badN >= 2 || (!okN && su >= 20)); }
      if (weak) {
        const tail = Match.units(sub.slice(past, Math.max(past, fin))).length;
        if (tail < OVER || Date.now() - (m.relocAt || 0) < 800) break;
        if (tracked) { if (!(m.trk && m.trk.c === m.c && m.trk.cut === m.cut && Date.now() - m.trk.at < 2000)) break; }
        else if (muRelocate(st.slice(0, n0), sub, fin, m.conf.slice(c0), m.alts.slice(c0), past, end)) continue;
        if (muFar(st.slice(0, n0), all, c0, past, end)) return;
        if (tail < OVER_FAR || m.farCand) break;
      }
      if (!begun) {
        if (!done && !tracked && muRelocate(st.slice(0, n0), sub, fin, m.conf.slice(c0), m.alts.slice(c0), past, end)) continue;
        if (!done && muFar(st.slice(0, n0), all, c0, past, end)) return;
        break;
      }
      paceAdd(m.tjSeen); m.tjAt = null;
      // (not an aya passed over this time, its words said right before: these frames are not its own)
      if (m.at && !cur.spans.some((_, i) => m.passed?.[m.starts[m.c] + m.w0 + i])) recheck(G, G.ayas[m.c], m.starts[m.c] + m.w0, m.at[c0], m.at[c0 + Match.charAt(sub, st[n0].at[0])]);
      goneAdd(gones, m.goneAt, ex, st, cur, n0, wi => m.starts[m.c] + m.w0 + wi);
      // (each one, at its word in the session)
      for (const [k, pk] of Object.entries(m.letSeen || {})) {
        const wi = ex._w ? ex._w.findIndex(([a, b]) => +k >= a && +k < b) : -1;
        const lp = (m.letPairs ||= {});
        if (!Array.isArray(lp[pk])) lp[pk] = [];
        if (wi >= 0) lp[pk].push(m.starts[m.c] + m.w0 + wi);
      }
      m.cut += st[n0].at[0]; m.c++; m.w0 = 0; m.lead = false;
    }
    if (G.pos >= G.words.length) return G.chain ? chain() : finish();
    if (!done) muTrack();
    follow();
    paint();
    paintBar();
  }
  // Where the reading is, among the ayas around the one being said: the best path of what was heard
  // since that aya began through their words (ctc.js: path), asked of the model's frames every
  // TRK_EVERY ms. The path's last stretch of words in a row beginning in another aya than the one
  // being said (and not simply the next): the reader went back, or left ayas out. The session goes
  // on from there: ayas left out are marked (not those said right before), an aya gone back to is
  // read anew. Ayas of two or three words that begin alike (ثُمَّ نَظَرَ · ثُمَّ عَبَسَ وَبَسَرَ) are told apart
  // by the words after them, which matching one aya's letters at a time cannot do.
  const TRK_EVERY = 600, TRK_BACK = 15, TRK_AHEAD = 8, TRK_MAX = 600, TRK_CAP = 220, TRK_WORDS = 3, TRK_SOUNDS = 12, TRK_LEAD = 60, TRK_OTHER = 40, TRK_PART = 0.25;
  function muTrack() {
    const g = G, m = g.mu;
    if (!m?.at?.length || !m.trkNeed || m.trkBusy || g.done || Date.now() - (m.trkAt || 0) < TRK_EVERY) return;
    const all = m.final + m.tent, c0 = Match.charAt(all, m.cut), fEnd = m.at[Math.min(m.at.length, m.final.length) - 1];
    if (fEnd == null) return;
    const f0 = Math.max(0, (m.at[Math.min(c0, m.at.length - 1)] ?? 0) - TRK_LEAD, fEnd - TRK_MAX); // (from a little before the aya: the words that led to it place it)
    if (fEnd - f0 < 40) return;
    // (a reader goes back to where the passage began, ayas before: as far back as TRK_CAP words allow)
    let j0 = Math.max(0, m.c - TRK_BACK); const j1 = Math.min(g.ayas.length - 1, m.c + TRK_AHEAD), words = [], start = [], where = [];
    while (j0 < m.c - 2 && m.starts[Math.min(j1 + 1, m.starts.length - 1)] - m.starts[j0] > TRK_CAP) j0++;
    for (let j = j0; j <= j1; j++) { const e = Mu.expect(g.ayas[j]); e.spans.forEach((sp, wi) => { words.push(e.ph.slice(...sp)); start.push(wi === 0); where.push([j, wi]); }); }
    m.trkBusy = true; m.trkAt = Date.now();
    const c = m.c, cut = m.cut, w0 = m.w0;
    Mu.path(f0, fEnd + 1, words, start).then(segs => {
      m.trkBusy = false;
      if (G !== g || g.mu !== m || g.done || m.c !== c || m.cut !== cut || m.w0 !== w0) return;
      m.trk = { c, cut, at: Date.now() };
      const ws = (segs || []).filter(x => x.w != null);
      if (!ws.length) return;
      // the last stretch of words in a row
      let a = ws.length - 1;
      while (a > 0 && (ws[a - 1].w === ws[a].w - 1 || ws[a - 1].w === ws[a].w)) a--;
      const run = ws.slice(a), [j, wi] = where[run[0].w], said = run.filter(x => x.done);
      // the aya being said among them, or on to the next: as it goes
      if (run.some(x => where[x.w][0] === c) || (j === c + 1 && wi === 0)) return;
      if (said.length < TRK_WORDS || said.reduce((p, x) => p + Match.units(words[x.w]).length, 0) < TRK_SOUNDS) return;
      // (an aya behind that one of the next ayas repeats word for word — فَبِأَيِّ آلَاءِ رَبِّكُمَا تُكَذِّبَانِ — and nothing
      // heard past it: the one ahead is being said, not that one gone back to)
      if (j < c && where[run[run.length - 1].w][0] === j) { const ph = Mu.expect(g.ayas[j]).ph; if ([c, c + 1, c + 2].some(q => g.ayas[q] != null && Mu.expect(g.ayas[q]).ph === ph)) return; }
      // (and what was heard from there on is those words, not other sounds with a word of them here and
      // there — a reading gone to another sura is not this one's ayas: muFar's to find)
      { const i0 = segs.indexOf(run[0]), before = segs[i0 - 1]?.g || 0, other = segs.slice(i0).reduce((p, x) => p + (x.g || 0), 0);
        if (before > TRK_OTHER || other > TRK_PART * (fEnd - run[0].t)) return; }
      const now = m.final + m.tent, ci = m.at.findIndex(f => f >= run[0].t);
      if (ci < 0) return;
      const to = m.starts[j] + wi, was = G.pos;
      if (to > was) {
        const marks = [], away = graced();
        for (let k = was; k < to; k++) { if (away || G.once?.[k]) delete G.errs[k]; else if (G.errs[k] !== 'hint') { G.errs[k] = 'skip'; marks.push([k, 'skip']); } delete G.heard[k]; }
        warnSkipped(marks);
      } else {
        // (gone back to read the stretch again: an aya of it marked said after its next is read anew)
        for (let k = m.starts[Math.max(0, j - 1)]; k < was; k++) if (G.errs[k] === 'order' && !G.heard[k]) delete G.errs[k];
        if (j !== c) toast(`رجعت إلى الآية ${ar(R.ayas[G.ayas[j]][1])}`);
        // (read anew from there: an aya of the stretch left out this time is left out, said before or not)
        if (G.once) for (const k in G.once) if (+k >= to) delete G.once[k];
      }
      (m.shaky ||= {})[G.ayas[c]] = true; m.shaky[G.ayas[j]] = true;
      m.passed = {};
      m.c = j; m.w0 = wi; m.cut = Match.units(now.slice(0, ci)).length; m.lead = true; m.open = false; m.relocAt = Date.now();
      G.pos = G.tent = to; G.ver = {};
      muFollow(false);
    });
  }
  // each aya once said (or the last, as far as it was said), asked again of what the model heard (its frames' log-probabilities, ctc.js):
  // the aya as written scored against it with a word left out (each word marked so), with another
  // word marked as heard in its place, with a word marked as any sounds at all, and with each two
  // neighbouring words the other way round. A word marked left out that the written aya fits clearly
  // better (SKIP_BY) was said; one marked another that the written aya fits about as well as what was
  // heard (WRONG_BY) is taken back too; each only where the written word fits as well as any sounds
  // there would (a word said otherwise does not: of words given another's audio, 4-5% pass; of words
  // said right, 95%);
  // two words that fit clearly better the other way round (SWAP_BY) are marked so. A fast reading
  // the model writes out garbled still ranks so. (On 300 ayas by 12 reciters, at their pace and
  // 1.5x: every pair swapped in the audio caught and no pair said in order marked; no word cut out
  // taken back, 97% of the words said whose mark would be taken back; of the words heard otherwise
  // in a correct reading, about a third within WRONG_BY.) Frames [from, to), as in `at`
  // Not where the aya fits what was heard poorly as a whole (FIT, per frame; a reading's ayas fit
  // at -0.3 to -0.9): its bounds misplaced, any other reading fits better
  const RECHECK = ['skip', 'wrong'], ANY_BY = 2.5, STRONG_BY = 6, STRONG_MIN = 3, SWAP_BY = 6, FIT = -2, EXT = 75, AFTER_BY = 15;
  function recheck(g, ai, k0, from, to) {
    if (from == null || to == null || !g.words[k0]) return Promise.resolve();
    // (the words reached only: a session ended in the middle of an aya)
    const w0 = g.words[k0].wi, cur = Mu.expect(ai, w0), w = cur.spans.map(sp => cur.ph.slice(...sp)).slice(0, Math.max(1, g.pos - k0)), n = w.length;
    // (each word left out, asked of every aya: a swap must fit better than either of its two words
    // left out, too; else it is one word barely said, not two the other way round)
    const texts = [w, ...w.map((_, i) => [...w.slice(0, i), ...w.slice(i + 1)])], asks = [];
    // (two words the other way round are asked with the word before the aya and the one after it in
    // their places: else, in ayas that rhyme — مَخضُود · وَطَلحٍ مَنضُود · وَظِلٍّ مَمدُود — the aya turned round
    // fits the end of the one before and its own beginning, and words read in order are marked)
    const phOf = k => { const x = g.words[k]; if (!x) return null; const e = Mu.expect(x.ai); return e.spans[x.wi] ? e.ph.slice(...e.spans[x.wi]) : null; };
    const pL = k0 > 0 ? phOf(k0 - 1) : null, pR = k0 + n < g.pos ? phOf(k0 + n) : null, ctxL = pL ? [pL] : [], ctxR = pR ? [pR] : [];
    for (let i = 0; i < n; i++) {
      const k = k0 + i, e = g.errs[k];
      // (a word marked: it as any sounds at all, which the written word must fit about as well as; a
      // word said otherwise fits better than none there, and than what the matcher took it for)
      // (and a word not marked: one the written word fits far worse than any sounds was not said as written)
      if (RECHECK.includes(e) || (!e && i > 0 && i < n - 1 && Match.units(w[i]).length >= STRONG_MIN)) { asks.push(['any', i]); texts.push([...w.slice(0, i), null, ...w.slice(i + 1)]); }
      if (e === 'wrong' && g.heard[k]?.got) { asks.push(['wrong', i]); texts.push([...w.slice(0, i), g.heard[k].got, ...w.slice(i + 1)]); }
      if (i + 1 < n && Match.units(w[i]).length >= 2 && Match.units(w[i + 1]).length >= 2 && w[i] !== w[i + 1]) {
        asks.push(['order', i]); texts.push([...ctxL, ...w.slice(0, i), w[i + 1], w[i], ...w.slice(i + 2), ...ctxR]);
      }
    }
    if (asks.some(a => a[0] === 'order')) { asks.push(['ctx', 0]); texts.push([...ctxL, ...w, ...ctxR]); }
    // (EXT frames more either side: the aya's bounds as the matcher put them may be a second or two
    // off, its first words left in the aya before; each reading finds where it lies, ctc.js)
    const f0 = Math.max(0, from - EXT), f1 = to + EXT;
    // (the aya before, every word of it marked left out: said after this one instead? this aya and it
    // after, against this aya alone, its frames then the matcher's for neither; and with this aya's
    // last word as any sounds, which the matcher may have run the other aya's first sounds into)
    let prev = null;
    if (w0 === 0 && k0 > 0) {
      const pw = g.words[k0 - 1], p0 = k0 - 1 - pw.wi;
      if (pw.wi === pw.of - 1 && pw.of > 1 && [...Array(pw.of).keys()].every(i => g.errs[p0 + i] === 'skip')) {
        const e = Mu.expect(pw.ai);
        prev = { p0, of: pw.of, ai: pw.ai, words: e.spans.map(sp => e.ph.slice(...sp)) };
        asks.push(['after', 0]); texts.push([...w, ...prev.words]);
        asks.push(['afterAny', 0]); texts.push([...w.slice(0, -1), null, ...prev.words]);
      }
    }
    const f1x = prev ? f1 + Match.units(prev.words.join('')).length * 4 : f1; // (its sounds, at about 4 frames each, may run past)
    return Mu.score(f0, f1x, texts).then(sc => {
      if (G !== g || !sc || sc[0] == null || sc[0] / Math.max(1, f1x - f0) < FIT) return;
      let changed = 0, added = false;
      const swaps = [], left = i => sc[1 + i], any = {}, at = {};
      asks.forEach(([kind, i], j) => { if (kind === 'any') any[i] = sc[1 + n + j]; else at[kind] = sc[1 + n + j]; });
      if (prev && at.after - sc[0] >= AFTER_BY && [...Array(prev.of).keys()].every(i => g.errs[prev.p0 + i] === 'skip')) { // (not already so, muRelocate)
        for (let i = 0; i < prev.of; i++) { g.errs[prev.p0 + i] = 'order'; delete g.heard[prev.p0 + i]; }
        const last = k0 + n - 1;
        if (RECHECK.includes(g.errs[last]) && at.after >= at.afterAny) { delete g.errs[last]; delete g.heard[last]; }
        changed++; added = true;
        if (!g.done) toast(`قرأت الآية ${ar(R.ayas[prev.ai][1])} بعد الآية ${ar(R.ayas[ai][1])}`);
      }
      // (the written word fits what was heard nearly as well as any sounds there would, ANY_BY a
      // sound: said, however the model wrote it out. On 400 readings by learners judged correct, the
      // words wrongly marked sit at -0.5 to -2.5 a sound, a word really another at -3 to -8, one left
      // out at -5 to -12: three in four of the wrong marks taken back, one in twelve of the right ones)
      const fits = i => any[i] != null && (sc[0] - any[i]) / Math.max(1, Match.units(w[i]).length) >= -ANY_BY;
      for (let i = 0; i < n; i++) if (RECHECK.includes(g.errs[k0 + i]) && fits(i)) { delete g.errs[k0 + i]; delete g.heard[k0 + i]; changed++; }
      // a word the matcher let pass (letters the model mishears are forgiven) that the written word
      // fits far worse than any sounds there (STRONG_BY a sound): another word said in its place
      // (not an aya's first or last word here: where the aya begins and ends in what was heard is known only
      // roughly, and any sounds there take in the neighbouring aya's)
      // (nor in an aya the reading jumped to or from: where it lies in what was heard is less sure still)
      // The clearest first, and never beside a word already marked: a word said wrong pulls the fit
      // of its neighbours down with it
      if (!g.mu?.shaky?.[ai] && g.errs[k0 - 1] !== 'skip') { // (nor after words left out)
        const strong = [];
        for (let i = 1; i < n - 1; i++) if (!g.errs[k0 + i] && any[i] != null) { const d = (sc[0] - any[i]) / Math.max(1, Match.units(w[i]).length); if (d < -STRONG_BY) strong.push([d, i]); }
        for (const [, i] of strong.sort((a, b) => a[0] - b[0])) {
          if (g.errs[k0 + i - 1] || g.errs[k0 + i + 1]) continue;
          g.errs[k0 + i] = 'wrong'; g.heard[k0 + i] = { got: '', want: w[i] }; changed++; added = true;
        }
      }
      asks.forEach(([kind, i], j) => {
        const x = sc[1 + n + j], d = x - (at.ctx ?? sc[0]), k = k0 + i;
        if (kind === 'order' && d >= SWAP_BY && d >= Math.max(left(i), left(i + 1)) - sc[0]) swaps.push([d, i]);
      });
      // (two words the other way round, and the aya as written then fits poorly about them: their
      // neighbours too fit better swapped; the likeliest swap only, of those sharing a word)
      const took = new Set();
      for (const [, i] of swaps.sort((a, b) => b[0] - a[0])) {
        const k = k0 + i, a = g.errs[k], b = g.errs[k + 1];
        if (took.has(i) || took.has(i + 1)) continue;
        if ((a && a !== 'order' && !RECHECK.includes(a)) || (b && b !== 'order' && !RECHECK.includes(b))) continue;
        took.add(i); took.add(i + 1);
        const t = ayaTokens(ai), x = t[w0 + i] || '', y = t[w0 + i + 1] || '';
        for (const q of [k, k + 1]) if (g.errs[q] !== 'order') { g.errs[q] = 'order'; g.heard[q] = { got: y + ' ' + x, want: x + ' ' + y }; changed++; added = true; }
      }
      if (added && !g.done) chime();
      if (!changed) return;
      paint(); paintBar();
      if (g.done && !$('#recDone').hidden) paintDone();
    });
  }

  // the surah read to its end, in a session begun from an aya: kept, and the next
  // surah goes on at once, on the same reading (its basmala set aside), until the
  // reader stops
  function chain() {
    // the surah read to its end: the session stops there (its summary says so), and the
    // next surah is one tap away on it
    const g = G, next = g.ayas[g.ayas.length - 1] + 1;
    if (R.ayas[next] && R.ayas[next][0] !== R.ayas[next - 1][0]) g.next = next;
    finish();
  }
  // the session is over: the words of the aya being said that were begun are
  // judged as they were said (the reading's end is their end); the rest stay unsaid
  // (all: with what is still tentative, the reader having stopped)
  function muSettle(all = false) {
    const m = G.mu;
    if (m.c >= G.ayas.length || !m.conf) return;
    const heard = all ? m.final + m.tent : m.final;
    const c0 = Match.charAt(heard, m.cut), sub = heard.slice(c0), conf = m.conf.slice(c0, c0 + sub.length), alts = m.alts.slice(c0, c0 + sub.length), at = m.at?.slice(c0, c0 + sub.length);
    const cur = Mu.expect(G.ayas[m.c], m.w0);
    const gones = {}, tajweed = { ...tjRules(), ...goneRules(gones, m.goneAt ||= [], Match.units(cur.ph).length) };
    const letters = letRules();
    const st = Match.words(cur, sub, sub.length, false, { fast: fast(), freeLead: m.lead, conf, alts, at, tajweed, letters });
    const t = st.findLastIndex(x => x.state !== 'todo');
    if (t < 0) return;
    const part = { ph: cur.ph.slice(0, cur.spans[t][1]), spans: cur.spans.slice(0, t + 1), wasl: cur.wasl.filter(k => k <= t) };
    if (cur.tj) part.tj = cur.tj.filter(c => c < part.ph.length);
    const fin = Match.words(part, sub, sub.length, true, { fast: fast(), freeLead: m.lead, conf, alts, at, tajweed, letters });
    muApply(fin.concat(st.slice(t + 1)), false, cur);
    goneMark(gones, m.goneAt, (gk, got, want) => { if (!G.errs[gk]) { G.errs[gk] = 'madd'; G.heard[gk] ||= { got, want }; } });
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
      if (e === 'skip' && graced()) e = null; // read while the page was away: taken as said
      // (a word said right before in this reading, the reader having gone back over it since: not left out)
      if (e === 'skip' && G.once?.[k]) { e = null; (m.passed ||= {})[k] = true; }
      // (the reading's very first word: its first sound is cut by the microphone opening, or by the reader
      // beginning as it does; a haraka wrong there alone, the rest of the word as written, is not marked)
      if (e === 'haraka' && k === (m.firstK ??= base) && i === 0 && cur?.spans[0]) {
        const a = Match.units(x.heard || ''), b = Match.units(cur.ph.slice(...cur.spans[0]));
        if (a.length === b.length && a.slice(2).every((u, q) => u === b[q + 2])) e = null;
      }
      // (left out or another, by the letters the model wrote: asked of what it heard there first)
      if (e && x.state === 'err' && RECHECK.includes(e) && cur?.spans[i]) e = unheard(k, i, x, states, cur, e);
      if (decided) {
        pos = tent = k + 1;
        if (e) {
          if (G.errs[k] !== e && G.errs[k] !== 'hint') { G.errs[k] = e; fresh = true; }
          if (cur?.spans[i]) G.heard[k] = { got: x.heard || '', want: cur.ph.slice(...cur.spans[i]) };
          if (e === 'skip') skips.push([k, 'skip']);
        } else { if (G.errs[k] && G.errs[k] !== 'hint') delete G.errs[k]; if (x.state === 'ok') (G.once ||= {})[k] = true; }
      } else if (x.state === 'hear') tent = k + 1;
    });
    if (pos > G.pos) G.peek = false;
    G.pos = pos; G.tent = tent;
    if (fresh) chime();
    warnSkipped(skips);
  }
  // A word the matcher marks left out or another, from the letters the model wrote out, is asked of
  // what the model heard there before it is marked: the word with its neighbours as written, against
  // the same with any sounds at all in its place, on those words' frames (ctc.js, as recheck() does
  // for the whole aya once it is done). The written word fitting nearly as well (ANY_BY a sound) was
  // said, however it was written out (a soft voice, a phone held far, an accent); else it is marked,
  // a moment after the word is read, so no word is marked and then taken back. Returns e to mark
  // now, or null (said; or being asked: marked when the answer comes, if it says so)
  const VER_CTX = 2, VER_PAD = 12;
  function unheard(k, i, x, states, cur, e) {
    const g = G, m = g.mu, V = (g.ver ||= {});
    if (!m.at?.length || !x.at) return e;
    const sig = m.cut + ':' + x.at[0] + ':' + x.at[1];
    let v = V[k];
    if (v && v.sig === sig) return v.r === false ? e : null;
    const said = y => (y.state === 'ok' || y.state === 'err') && y.at && y.at[1] > y.at[0];
    let L = i, R = i;
    while (L > 0 && i - L < VER_CTX && said(states[L - 1])) L--;
    while (R + 1 < states.length && R - i < VER_CTX && said(states[R + 1]) && cur.spans[R + 1]) R++;
    const all = m.final + m.tent, c0 = Match.charAt(all, m.cut), sub = all.slice(c0);
    const fr = u => m.at[Math.min(m.at.length - 1, c0 + Match.charAt(sub, Math.max(0, u)))];
    let u0 = x.at[0], u1 = x.at[1];
    for (let j = L; j <= R; j++) if (states[j].at) { u0 = Math.min(u0, states[j].at[0]); u1 = Math.max(u1, states[j].at[1]); }
    const f0 = Math.max(0, fr(u0) - VER_PAD), f1 = fr(Math.max(u0, u1 - 1)) + 8 + VER_PAD;
    const w = [];
    for (let j = L; j <= R; j++) w.push(cur.ph.slice(...cur.spans[j]));
    const q = i - L, len = Match.units(w[q]).length, heard = { got: x.heard || '', want: w[q] };
    if (f0 == null || f1 == null || isNaN(f0) || isNaN(f1)) return e;
    v = V[k] = { sig };
    Mu.score(f0, f1, [w, [...w.slice(0, q), null, ...w.slice(q + 1)]]).then(sc => {
      if (V[k] !== v) return;
      v.r = !!sc && sc[0] != null && sc[1] != null && (sc[0] - sc[1]) / Math.max(1, len) >= -ANY_BY;
      if (G !== g || !g.ver || g.ver[k] !== v) return;
      if (!v.r && k < g.pos && g.errs[k] !== e && g.errs[k] !== 'hint') {
        g.errs[k] = e; g.heard[k] = heard;
        if (!g.done) chime();
        if (e === 'skip') warnSkipped([[k, 'skip']]);
      }
      paint(); paintBar();
      if (g.done && !$('#recDone').hidden) paintDone();
    });
    return null;
  }
  // the words said while the header mic found the place, marked left out or another there (reached()):
  // each asked of what the model heard, as unheard() asks, and taken back where the written word fits
  function saidVerify(g) {
    const m = g.mu, all = m.final + m.tent, list = g.saidVer;
    g.saidVer = null;
    const fr = u => m.at[Math.min(m.at.length - 1, Match.charAt(all, Math.max(0, u)))];
    for (const v of list) {
      const f0 = Math.max(0, fr(v.u0) - VER_PAD), f1 = fr(Math.max(v.u0, v.u1 - 1)) + 8 + VER_PAD, len = Match.units(v.w[v.q]).length;
      if (isNaN(f0) || isNaN(f1)) continue;
      Mu.score(f0, f1, [v.w, [...v.w.slice(0, v.q), null, ...v.w.slice(v.q + 1)]]).then(sc => {
        if (G !== g || g.errs[v.k] !== v.e || !sc || sc[0] == null || sc[1] == null) return;
        if ((sc[0] - sc[1]) / Math.max(1, len) >= -ANY_BY) { delete g.errs[v.k]; delete g.heard[v.k]; paint(); paintBar(); }
      });
    }
  }
  // mistakes piling up in the aya being said (or nothing of it heard), and no aya of the session near it fits better (muRelocate):
  // the reading is elsewhere. Looked for in the whole Quran, as the header mic does; found clearly, the
  // session goes on from there, on the same reading (the microphone never stops). Right after the
  // header mic found the place (its first aya), that guess was wrong: it is dropped, unsaved, and all
  // that was heard is looked for again; later on, ayas were skipped or the reader went elsewhere:
  // what was heard from the aya being said on is looked for, and that aya's marks are dropped
  // Limited, so a reading isn't sent all over the place: the header mic's guess put right at most
  // twice (early: still in the first aya found, or found again); once the place is settled (an aya
  // read there, or moved once already), a move needs a long stretch heard elsewhere, far clearer,
  // found twice in a row; and no more than FAR_MOVES in one reading. An aya or a few skipped are the
  // session's own (muRelocate: marked skipped, not a move)
  const FAR_EVERY = 1500, FAR_MARGIN = 8, FAR_MOVES = 3, FAR_SETTLED = 160, OVER = 30, OVER_FAR = 60;
  function muFar(states, all, c0, past = null, end = 0) {
    const m = G.mu, moves = G.moves || 0, early = G.found && m.c === 0 && moves < 2;
    if (moves >= FAR_MOVES) return false;
    const ok = states.filter(x => x.state === 'ok').length, bad = states.filter(x => x.state === 'err').length;
    // (or nothing of it heard, in all that was: everything taken for sounds before it)
    // (over: the aya said to its end, and what came after it is neither the next aya nor one near: from there)
    const over = !early && past != null && ok > bad;
    const from = early ? 0 : c0 + (over ? past : 0), text = all.slice(from), n = Match.units(text).length;
    // a session begun by the reader at an aya is taken to be there: only a long stretch heard that
    // doesn't fit it moves it (a basmala or a pause before a short aya such as الم isn't one)
    const settled = !early && (moves > 0 || m.c > 0);
    const least = over ? OVER_FAR : settled ? FAR_SETTLED : G.found ? 40 : 90;
    const lost = (bad >= (early ? 2 : 3) && ok <= bad && n >= least) || (!ok && !bad && n >= least) || (over && n >= least);
    if (!lost || Date.now() - (m.farAt || 0) < FAR_EVERY) return false;
    m.farAt = Date.now();
    const r = locateMu(text, m.conf.slice(from), m.alts.slice(from));
    if (!r || r.fit - r.next < (settled ? 2 * FAR_MARGIN : FAR_MARGIN)) { m.farCand = null; return false; }
    // (settled: the same place found by the look before too)
    if (settled) {
      const was = m.farCand;
      m.farCand = { ai: r.ai, at: Date.now() };
      if (!was || Math.abs(was.ai - r.ai) > 1 || Date.now() - was.at > 5000) return false;
    }
    // a basmala heard (al-Fatiha's, or an-Naml 30's from its بسم): never where a reading went
    if (r.ai === 0 || [0, 1, 2].some(w => Mu.expect(0, w).ph === Mu.expect(r.ai, r.w).ph)) return false;
    // where the session's own relocation looks (and the aya being said) is not elsewhere
    const near = G.ayas.slice(Math.max(0, m.c - 3), m.c + 9);
    if (near.includes(r.ai)) return false;
    const g = G, cut = early ? 0 : m.cut + (over ? end : 0);
    if (early) g.saved = true; // the wrong guess: nothing of it kept
    else if (!over) for (let k = m.starts[m.c] + m.w0; k < G.words.length && G.words[k].ai === G.ayas[m.c]; k++) { delete G.errs[k]; delete G.heard[k]; }
    g.keepMic = true;
    start(r.ai, null, { stream: true, w0: r.w, cut });
    if (G !== g && G?.mu) { G.found = g.found; G.moves = moves + 1; G.mu.shaky = { [r.ai]: true }; } // still the header mic's, if it was; and how often moved
    toast(`${early ? 'وجدناها' : 'انتقلنا'}: ${r.w ? `${ayaLabel(r.ai)} · من كلمة ${ayaTokens(r.ai)[r.w] || ''}` : ayaLabel(r.ai)}`);
    return true;
  }
  // the aya being said doesn't fit what is heard (nothing of it, or mistakes
  // piling up), but another aya of the session clearly does: a skip ahead (even
  // to an aya that opens like the one skipped, as al-Mulk 2 and 3), or a step back
  // An aya said to its end, and a stretch heard after it that is not the next aya (ayas left out
  // after one said right: nothing of the aya said is wrong, so nothing above looks): what was heard
  // after it (from `past`) is looked for in the ayas further on, and those before
  function muRelocate(states, sub, fin, conf, alts, past = null, end = 0) {
    const m = G.mu;
    let ok0 = states.filter(x => x.state === 'ok').length, bad0 = states.filter(x => x.state === 'err').length;
    const over = past != null && ok0 > bad0 && Match.units(sub.slice(past, Math.max(past, fin))).length >= OVER; // (of what is settled: the next aya's words still coming in are not yet heard right)
    if (Date.now() - (m.relocAt || 0) < 800 || (!over && ok0 && bad0 < 2)) return false;
    if (over) { sub = sub.slice(past); fin = Math.max(0, fin - past); conf = conf.slice(past); alts = alts.slice(past); ok0 = 0; }
    if (Match.units(sub).length < 25) return false;
    m.relocAt = Date.now();
    // of ayas heard alike (a refrain, as ar-Rahman's «فبأي آلاء ربكما تكذبان»), the one
    // just read (said again), else the nearest ahead; further back only when it fits better
    const order = over ? [m.c] : m.c > 0 ? [m.c - 1] : [];
    for (let j = m.c + (over ? 2 : 1); j < Math.min(G.ayas.length, m.c + 9); j++) order.push(j);
    for (let j = m.c - (over ? 1 : 2); j >= Math.max(0, m.c - 3); j--) order.push(j);
    let best = null;
    for (const j of order) {
      // (over: a long stretch, gone past the aya it began: the ayas after it too, as when following)
      let ex = Mu.expect(G.ayas[j]);
      if (over && G.ayas[j + 1] != null) ex = Mu.expect2(ex, G.ayas[j + 2] != null ? Mu.expect2(Mu.expect(G.ayas[j + 1]), Mu.expect(G.ayas[j + 2])) : Mu.expect(G.ayas[j + 1]));
      const st = Match.words(ex, sub, fin, false, { freeLead: true, conf, alts });
      const ok = st.filter(x => x.state === 'ok').length, bad = st.filter(x => x.state === 'err').length;
      // (and the aya itself mostly said, not only those after it)
      if (over) { const own = st.slice(0, Mu.expect(G.ayas[j]).spans.length); if (own.filter(x => x.state === 'ok').length <= own.filter(x => x.state !== 'ok').length) continue; }
      if (ok >= Math.max(3, ok0 + 2) && ok / (ok + bad) >= 0.7 && (!best || ok > best.ok)) best = { j, ok, st };
    }
    if (!best) return false;
    // (the aya said stays as it was heard: what is left out begins after it)
    const from = over ? m.starts[m.c + 1] : m.starts[m.c] + m.w0;
    if (over) m.cut += end;
    if (best.j > m.c) {
      // what was heard for the aya left was the later one's: all of it is skipped
      const marks = [];
      // (or, just back after the phone closed the page, read while it was away: taken as said)
      const away = graced();
      for (let k = from; k < m.starts[best.j]; k++) { if (away || G.once?.[k]) delete G.errs[k]; else if (G.errs[k] !== 'hint') { G.errs[k] = 'skip'; marks.push([k, 'skip']); } delete G.heard[k]; }
      warnSkipped(marks);
    } else {
      // an aya before, every word of it marked left out, and those after it said: not gone back to,
      // said late (4 after 5): marked so, and the reading goes on where it was, after it
      const j0 = m.starts[best.j], jn = G.words[j0].of, said = k => G.errs[k] !== 'skip';
      if (best.j < m.c && [...Array(jn).keys()].every(i => G.errs[j0 + i] === 'skip') && m.starts[best.j + 1] < from
        && [...Array(from - m.starts[best.j + 1]).keys()].some(i => said(m.starts[best.j + 1] + i))) {
        for (let i = 0; i < jn; i++) { G.errs[j0 + i] = 'order'; delete G.heard[j0 + i]; }
        const end = best.st.findLast(x => (x.state === 'ok' || x.state === 'err') && x.at)?.at[1] || 0;
        m.cut += end; m.lead = true;
        toast(`قرأت الآية ${ar(R.ayas[G.ayas[best.j]][1])} بعد التي تليها`);
        return true;
      }
      if (!over) for (let k = from; k < G.words.length && k < from + G.words[from].of; k++) { if (G.errs[k] !== 'hint') delete G.errs[k]; delete G.heard[k]; }
      // (gone back to read the stretch again: an aya of it marked said after its next is read anew)
      for (let k = m.starts[Math.max(0, best.j - 1)]; k < G.words.length && k < from + (G.words[from]?.of || 0); k++) if (G.errs[k] === 'order' && !G.heard[k]) delete G.errs[k];
      toast(`رجعت إلى الآية ${ar(R.ayas[G.ayas[best.j]][1])}`);
    }
    (m.shaky ||= {})[G.ayas[m.c]] = true; m.shaky[G.ayas[best.j]] = true;
    m.passed = {}; // (gone elsewhere: what is read from here on is read anew)
    m.c = best.j; m.w0 = 0; m.lead = true;
    G.pos = G.tent = m.starts[best.j];
    G.ver = {}; // (what was asked of the words left: no longer theirs)
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
  // ---- where the reader is now, ahead of the model (which hears a word only a moment after it is
  // said): a soft background that moves on from the last word heard at the reader's own pace, while
  // their voice is heard, LEAD_MAX words ahead at most; the model's word, once it is further, at once
  const LEAD_MAX = 2, LEAD_EVERY = 100, LEAD_GAP = 600; // (LEAD_GAP: ms of quiet still within the reading: the gaps between words)
  const wordUnits = k => {
    const w = G.words[k], ex = Mu.expect(w.ai), sp = ex.spans[w.wi];
    return w.u ??= sp ? Math.max(2, Match.units(ex.ph.slice(...sp)).length) : 4;
  };
  function lead() {
    const g = G;
    if (!g || g.done || !g.run || !MU() || blind()) return showLead(null);
    const cur = Math.min(Math.max(g.pos, g.tent), g.words.length - 1), now = Date.now();
    if (g.leadK == null || g.leadK < cur || g.leadK > cur + LEAD_MAX) { g.leadK = cur; g.leadU = 0; }
    const dt = Math.min(0.5, (now - (g.leadT || now)) / 1000);
    g.leadT = now;
    // (sounds a second: this reader's, once measured; a little under, so it waits rather than runs ahead)
    if (Mu.quiet() < LEAD_GAP) {
      let budget = dt * (g.speed || 8) * 0.75;
      while (budget > 0 && g.leadK < Math.min(cur + LEAD_MAX, g.words.length - 1)) {
        const left = wordUnits(g.leadK) - g.leadU;
        if (budget < left) { g.leadU += budget; budget = 0; } else { budget -= left; g.leadK++; g.leadU = 0; }
      }
    }
    showLead(g.leadK);
  }
  function showLead(k) {
    if (!G || G.leadAt === k) return;
    if (G.leadAt != null) wordEl(G.leadAt)?.classList.remove('rc-here');
    G.leadAt = k;
    if (k != null) wordEl(k)?.classList.add('rc-here');
  }

  function tick() {
    if (!G?.run) return;
    keep();
    alive();
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
    if (MU()) { Mu.boost(false); Mu.stop(); } else Listen.stop();
    syncBubble();
  }
  // Muaalem: the reading so far, looked up in the whole Quran (begun at any
  // word); the session then goes on with it, from that word
  const FIND_EVERY = 250, QUIET = 1500, QUIET_VOICE = 700, FIND_MIN = 16, FOUND_GO = 1300;
  const FIND_WORDS = 3; // words heard right at the place, at least (its lead over every other place says the rest)
  const FIND_MARGIN = 12; // heard sounds the best place must explain beyond any other
  // checked: the steps already seen to (after an update, or the model brought back mid-search)
  function findMu(checked) {
    const go = () => {
      if (G) return;
      F = { voice: false, d: null, n: 0, grew: 0, same: 0, last: null };
      syncBubble();
      const f = F;
      Mu.boost(true); // (read as often as the device can while looking: the search is short, its speed what counts)
      Mu.start(d => {
        if (F !== f) return;
        f.d = d;
        if (!f.voice) { f.voice = true; syncBubble(); }
      }).then(() => {
        if (F === f) f.timer = setInterval(() => { if (F !== f) clearInterval(f.timer); else { alive(); checkFind(f); } }, FIND_EVERY);
      }, () => { stopFind(); toast('لا يمكن الوصول إلى الميكروفون — اسمح به من إعدادات المتصفح'); });
    };
    if (checked) go(); else withModel(go, { find: true });
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
    // (stopped: nothing new heard, and the voice quiet too: a madd held long at an aya's end, تُبۡصِرُونَ,
    // adds nothing for a second or more while the reader is still saying it)
    const quiet = Date.now() - f.grew > QUIET && Mu.quiet() > QUIET_VOICE;
    if (n < FIND_MIN) return;
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
    // (far ahead of any other on five words or more, the next look agreeing is enough; on fewer, two
    // looks: «فلا أقسم ب…» opens several ayas; a lead of one margin, on four words at least: three
    // fit by chance after a false start, وجمع الشم… بل يريد read as …ومنكم من يريد)
    const lead = r ? r.fit - r.next : 0;
    const sure = r && f.same >= 1 && (lead >= 2 * FIND_MARGIN && (r.ok >= 5 || f.same >= 2) || f.same >= 2 && (lead >= FIND_MARGIN && r.ok >= 4 || (n > 150 && f.same >= 4) || (quiet && (lead >= 3 || f.same >= 3))));
    if (!sure) { if (n > 320 || (quiet && Date.now() - f.grew > 6000)) { stopFind(); toast('لم أجد الآية — اقرأ أكثر من آية'); } return; }
    clearInterval(f.timer);
    Mu.boost(false);
    const said = reached(r, h, d.conf, d.alts);
    // the search ends, but not its listening: what the reader goes on to say while the aya is shown
    // is kept, and the session, begun on a tap, goes on with it (nothing of the reading lost)
    F = null; syncBubble();
    Mu.listen(() => {});
    found(r.ai, r.w, said);
  }
  // how far the reading went from where it was found (it may have gone on into the next ayas while
  // the search made sure): { n words said, errs: [[i, type, got, want]] } in the session's words from there
  function reached(r, h, conf, alts) {
    const errs = [], s0 = R.ayas[r.ai][0], gone = [];
    let n = 0, cut = r.cut || 0, a = r.ai, w0 = r.w, at = cut; // (what was heard before it: a false start, left out)
    try {
      // aya by aya, as a session follows a reading (muFollow): the aya and the two after it lined up
      // with what was heard from it on; once the next is begun, this one is done
      for (let guard = 0; guard < 8 && R.ayas[a]?.[0] === s0; guard++) {
        const cur = Mu.expect(a, w0), more = [a + 1, a + 2].filter(b => R.ayas[b]?.[0] === s0);
        let ex = cur;
        for (const b of more) ex = Mu.expect2(ex, Mu.expect(b));
        // (no more of what was heard than this aya and a little after it, as muFollow takes a long stretch)
        const c0 = Match.charAt(h, cut), cu = Match.units(cur.ph).length;
        let sub = h.slice(c0);
        if (Match.units(sub).length > cu * 1.5 + 45) sub = sub.slice(0, Match.charAt(sub, Math.round(cu * 1.25) + 10));
        const gs = {};
        const st = Match.words(ex, sub, sub.length, false, { fast: fast(), freeLead: !guard, conf: conf.slice(c0, c0 + sub.length), alts: alts.slice(c0, c0 + sub.length), tajweed: { ...tjRules(), ...goneRules(gs, gone, cu) }, letters: letRules() });
        const n0 = cur.spans.length, begun = more.length && st.slice(n0, n0 + 2).some(x => x.state === 'ok' || x.state === 'err');
        const upto = begun ? n0 : st.slice(0, n0).findLastIndex(x => x.state === 'ok' || x.state === 'err') + 1;
        goneMark(gs, gone, (k, got, want) => { if (!errs.some(x => x[0] === k)) errs.push([k, 'madd', got, want]); });
        goneAdd(gs, gone, ex, st, cur, upto, wi => n + wi);
        for (let i = 0; i < upto; i++) if (st[i].state === 'err') {
          const e = MU_TYPE[st[i].type] || (st[i].heard?.length > 1 ? 'wrong' : 'skip'), row = [n + i, e, st[i].heard || '', cur.ph.slice(...cur.spans[i])];
          // (left out or another: asked of what the model heard there once the session has the reading
          // (saidVerify, as unheard() asks): the word, its neighbours said, and where they were heard)
          if (RECHECK.includes(e) && st[i].at) {
            const said = y => (y.state === 'ok' || y.state === 'err') && y.at && y.at[1] > y.at[0];
            let L = i, Rr = i, u0 = st[i].at[0], u1 = st[i].at[1];
            while (L > 0 && i - L < VER_CTX && said(st[L - 1])) L--;
            while (Rr + 1 < upto && Rr - i < VER_CTX && said(st[Rr + 1])) Rr++;
            const w = [];
            for (let j = L; j <= Rr; j++) { w.push(cur.ph.slice(...cur.spans[j])); if (st[j].at) { u0 = Math.min(u0, st[j].at[0]); u1 = Math.max(u1, st[j].at[1]); } }
            row.push({ w, q: i - L, u0: cut + u0, u1: cut + u1 });
          }
          errs.push(row);
        }
        n += upto;
        at = upto && st[upto - 1].at ? cut + st[upto - 1].at[1] : cut;
        if (!begun) break;
        cut += st[n0].at[0]; a++; w0 = 0; at = cut;
      }
    } catch { /* what was reached so far */ }
    return { n, errs, at, gone };
  }
  function found(ai, w = 0, said = { n: 0, errs: [] }) {
    const p = R.ayas[ai][2], turn = p !== S.page;
    if (turn) goTo(p);
    S.focus = ai; paintMarks();
    setTimeout(() => showFound(ai, w, said), turn ? 420 : 40);
  }
  function showFound(ai, w, said) {
    // (the reading still listened to: the session takes it over; else, a reading of its own, prepared)
    const go = () => start(ai, null, Mu.listening() ? { w0: w, said, stream: true } : { w0: w, said });
    const pg = slots[1]?.firstElementChild, lines = pg?.querySelector('.lines');
    const own = pg ? [...pg.querySelectorAll(`.w[data-a="${ai}"]`)] : [];
    if (!own.length) return go(); // (not on the page shown: no place to fall into)
    const box = $('#recFound'), aya = $('#rfAya'), fs = parseFloat(getComputedStyle(own[0]).fontSize) || 24;
    aya.textContent = '';
    aya.style.fontFamily = getComputedStyle(lines).fontFamily;
    aya.style.fontSize = Math.min(fs * 1.45, 40) + 'px';
    let wi = 0;
    own.forEach(el => {
      const c = el.cloneNode(true), end = el.classList.contains('end');
      c.className = end ? 'w end' : 'w';
      c.style.color = getComputedStyle(el).color;
      // the words before the one found faded; those said since, as the session shows words said
      if (!end) { if (wi < w) c.classList.add('rf-before'); else if (wi < w + said.n) c.classList.add('rc-done'); wi++; }
      else if (wi > w && wi <= w + said.n) c.classList.add('rc-done');
      if (c.classList.contains('rc-done')) c.style.color = '';
      aya.append(c, ' ');
    });
    box.classList.remove('landing');
    // (it goes on by itself after FOUND_GO, as the line under it fills; a tap goes at once)
    const bar = box.querySelector('.rf-bar');
    bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
    clearTimeout(box.auto);
    box.auto = setTimeout(() => box.onclick?.({ target: box }), FOUND_GO);
    box.onclick = e => {
      box.onclick = null;
      clearTimeout(box.auto);
      if (e.target.closest('#rfCancel')) { hide(box); S.focus = null; paintMarks(); if (!G) Mu.stop(); return; }
      // not the aya read: what was heard is let go, and the search begins again, listening afresh
      if (e.target.closest('#rfAgain')) { hide(box); S.focus = null; paintMarks(); Mu.stop().then(() => { if (!G && !F) findMu(true); }); return; }
      // each word from where it is shown to where it is on the page
      const clones = [...aya.querySelectorAll('.w')];
      clones.forEach((c, i) => {
        const a = c.getBoundingClientRect(), b = own[i]?.getBoundingClientRect();
        if (!b) { c.style.opacity = '0'; return; }
        c.style.transformOrigin = '0 0';
        c.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width || 1})`; // (the same glyphs: as wide as on the page, which may be drawn scaled)
        c.classList.remove('rf-before');
      });
      box.classList.add('landing');
      setTimeout(() => { box.hidden = true; box.classList.remove('landing'); aya.textContent = ''; go(); }, 640);
    };
    show(box);
    haptic(12);
  }
  // where the reading fits best: { ai, w, g, fit, next (the runner-up's fit) },
  // equal fits going to the one nearest the page open
  // (most of its words heard right; or, a noisy or fast reading, half of them, the place far ahead of
  // any other all the same)
  function locateMu(h, conf, alts) {
    const all = Mu.locate(h, conf, alts, 6), right = x => x.ok / Math.max(1, x.ok + x.err);
    const top = all[0], other = all.slice(1).reduce((m, x) => Math.max(m, x.fit), 0);
    const fits = all.filter(x => x.ok >= FIND_WORDS && (right(x) >= 0.75 || x === top && right(x) >= 0.5 && x.fit - other >= 2.5 * FIND_MARGIN));
    if (!fits.length) return null;
    fits.forEach(x => { x.far = Math.abs(R.ayas[x.ai][2] - S.page); });
    fits.sort((a, b) => b.fit - a.fit || a.far - b.far);
    // (its lead over every other place, not only those heard well enough to go to: a reading begun
    // wrong, its place not yet clear, is no lead for the first place that fits a little)
    const rest = all.filter(x => x !== fits[0] && Math.abs(x.g - fits[0].g) > 1).reduce((m, x) => Math.max(m, x.fit), 0);
    return { ...fits[0], next: Math.max(fits[1]?.fit ?? 0, rest) };
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
      const e = G.errs[k];
      if ((e === 'skip' || e === 'order') && w.wi === 0 && w.of > 1 && [...Array(w.of).keys()].every(i => set.has(k + i) && G.errs[k + i] === e)) {
        for (let i = 0; i < w.of; i++) seen.add(k + i);
        out.push({ k, aya: w.ai, e });
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
        if (k === G.leadAt) el.classList.add('rc-here');
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
    $('#recFast').hidden = !MU();
    $('#recFast').classList.toggle('on', fast());
    $('#recFast').setAttribute('aria-pressed', fast());
    $('#recHide').setAttribute('aria-pressed', G.hide);
    // this aya's share of the bar, like the player
    $('#recProg').style.transform = `scaleX(${bl ? 0 : G.pos >= G.words.length ? 1 : w.wi / w.of})`;
  }

  // ---- the end of a session

  // (its last aya asked again first, a moment at most)
  const CHECK_WAIT = 3000;
  function finish() {
    if (!G || G.done) return;
    const g = G, wait = MU() && g.run;
    const checked = wait ? new Promise(r => { g.checked = r; setTimeout(r, CHECK_WAIT); }) : null;
    pause();
    g.done = true;
    hide($('#recBar')); hide($('#recWord'));
    paint();
    const go = () => {
      if (G !== g) return;
      const list = mistakes().filter(x => x.aya != null || g.errs[x.k] !== 'hint');
      if (list.length) { g.walk = list; walk(0); return; }
      paintDone();
      show($('#recDone'));
    };
    if (!checked) return go();
    let over = false;
    setTimeout(() => { if (!over) toast('يراجع القراءة…'); }, 400); // (said only if it takes a while)
    checked.then(() => { over = true; paint(); go(); });
  }

  function paintDone() {
    const said = G.words.slice(0, G.pos), list = mistakes();
    const first = G.words[0].ai, last = said[said.length - 1].ai;
    const sura = suraName(R.ayas[G.words[G.words.length - 1].ai][0]);
    $('#rdTitle').textContent = G.next != null ? (list.length ? `تمّت سورة ${sura}` : `تمّت سورة ${sura}، بلا أخطاء`)
      : list.length ? 'انتهت الجلسة' : 'ما شاء الله، بلا أخطاء';
    $('#rdRange').textContent = G.kind ? `${G.kind === 'new' ? 'حفظ جديد' : 'مراجعة'} · ${ayaLabel(first)}${said.length > 1 ? ` – ${ar(R.ayas[said[said.length - 1].ai][1])}` : ''}` : G.test ? `اختبار · ${ayaLabel(first)}` : G.review ? `مراجعة مواضع الضعف · ${ayaCount(new Set(said.map(w => w.ai)).size)}`
      : first === last ? ayaLabel(first) : `${ayaLabel(first)} – ${ar(R.ayas[last][1])}`;
    $('#rdRight').textContent = ar(said.length - liveErrs().length);
    $('#rdErr').textContent = ar(list.length);
    const secs = Math.round(G.secs);
    $('#rdTime').textContent = `${ar(Math.floor(secs / 60))}:${ar(String(secs % 60).padStart(2, '0'))}`;
    const rows = mistakes(true).map(({ k, e, aya }) => {
      const w = G.words[k], gone = G.gone.has(k);
      const t = aya != null ? `<span class="t">${ayaLabel(aya)}</span><span class="s">${AYA_TYPES[e]}</span>`
        : `<span class="t" style="font-family:${R.font}">${esc(wordText(w))}</span><span class="s">${ayaLabel(w.ai)} · ${TYPES[e]}</span>`;
      return `<div class="row rc-row${gone ? ' gone' : ''}"><span class="rc-mk rc-${e || 'skip'}"></span><span class="main">${t}</span>
        <button class="rc-not" data-rd-gone="${k}"${aya != null ? ` data-rd-n="${w.of}"` : ''}>${gone ? 'تراجع' : 'لم أخطئ'}</button></div>`;
    }).join('');
    $('#rdList').innerHTML = rows;
    $('#rdList').hidden = !rows;
    $('#rdNote').innerHTML = rows ? 'تُحفظ في سجل أخطائك عند الإغلاق · <button data-rd-log>عرض السجل</button>' : '';
    // the surah done: on to the next first; the ayas got wrong after it
    $('#rdNext').hidden = G.next == null;
    if (G.next != null) $('#rdNext').textContent = `تابع: سورة ${suraName(R.ayas[G.next][0])}`;
    $('#rdAgain').hidden = G.next != null && !list.length;
    $('#rdAgain').classList.toggle('primary', G.next == null);
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
    l.first ||= {};
    for (const ai of whole) { if (!l.said[ai]) l.first[ai] = Date.now(); l.said[ai] = Date.now(); }
    // (a surah gone over (a revision, or most of what was memorized of it): a step up the revision
    // ladder if clean, at most one mistake; a step down if not)
    l.rev ||= {};
    const bySura = new Map();
    for (const ai of whole) bySura.set(R.ayas[ai][0], (bySura.get(R.ayas[ai][0]) || 0) + 1);
    for (const [su, c] of bySura) {
      const mem = Object.keys(l.said).filter(k => R.ayas[+k]?.[0] === su).length;
      if (G.kind !== 'rev' && c < Math.max(3, mem * 0.6)) continue;
      const bad = mistakes().filter(x => R.ayas[x.aya ?? G.words[x.k].ai]?.[0] === su).length, r = l.rev[su] ||= { n: 0 };
      r.n = bad <= 1 ? r.n + 1 : Math.max(0, r.n - 1); r.at = Date.now();
    }
    l.total ||= { secs: 0, sessions: 0 };
    l.total.secs += Math.round(G.secs); l.total.sessions++;
    if (whole.length) l.days[today] = (l.days[today] || 0) + whole.length;
    const days = Object.keys(l.days);
    if (days.length > 400) days.slice(0, days.length - 400).forEach(d => delete l.days[d]);
    // (a session that got through no aya and marked nothing isn't one)
    if (whole.length || mistakes().length) l.sessions.unshift({ t: Date.now(), from: said[0].ai, to: said[said.length - 1].ai, ayas: whole.length,
      words: said.length, errs: mistakes().length, secs: Math.round(G.secs), review: G.review, kind: G.kind, test: G.test,
      list: mistakes().slice(0, 30).map(({ k, e, aya }) => aya != null ? [aya, -1, e] : [G.words[k].ai, G.words[k].wi, e]) });
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
    if (G.walk) return true;
    if (k == null || k >= G.pos || !G.errs[k] || G.gone.has(k)) return true;
    pause();
    wordCard(k, el);
    if (!G.done) show($('#recWord'));
    return true;
  }
  // a mistake's card (the word, how it was marked, what was heard); aya: the whole aya skipped
  function wordCard(k, el, aya = null) {
    G.tap = { k, el, aya };
    $('#rwWord').textContent = aya != null ? ayaLabel(aya) : wordText(G.words[k]);
    $('#rwWord').style.fontFamily = aya != null ? '' : R.font;
    $('#rwType').textContent = aya != null ? AYA_TYPES[G.errs[k]] || AYA_TYPES.skip : TYPES[G.errs[k]];
    // what the model heard there, beside how the word should sound
    const h = G.heard?.[k];
    $('#rwHeard').hidden = !h;
    $('#rwCopy').hidden = !h;
    if (h) $('#rwHeard').innerHTML = `<span><small>سُمِع</small>${esc(h.got) || '—'}</span><span><small>المتوقَّع</small>${esc(h.want)}</span>`;
    $('#recWord').classList.toggle('three', !!h);
    $('#rwWalk').hidden = !G.walk;
  }

  // ---- the session finished: its mistakes, one card after another in order (each word shown on
  // its page), then its summary
  function wordEl(k) {
    const w = G.words[k];
    return document.querySelector(`.page[data-page="${w.p}"]`)?.querySelectorAll('.w:not(.end)')[w.n] || null;
  }
  function walk(i) {
    document.querySelectorAll('.w.rc-walk').forEach(el => el.classList.remove('rc-walk'));
    const list = G.walk;
    while (list && i < list.length && list[i].aya == null && !G.errs[list[i].k]) i++; // (taken back since: recheck())
    if (!list || i >= list.length) { G.walk = null; G.tap = null; hide($('#recWord')); paintDone(); show($('#recDone')); return; }
    G.walkI = i;
    const { k, aya } = list[i], w = G.words[k];
    if (S.focus !== w.ai) { S.focus = w.ai; drawBands(document); }
    if (w.p !== S.page) goTo(w.p, { animate: Math.abs(w.p - S.page) === 1 });
    $('#rwCount').textContent = `${ar(i + 1)} من ${ar(list.length)}`;
    $('#rwNext').textContent = i + 1 < list.length ? 'التالي' : 'النتيجة';
    // (the page drawn first)
    setTimeout(() => {
      if (!G || G.walk !== list || G.walkI !== i) return;
      const el = wordEl(k);
      el?.classList.add('rc-walk');
      wordCard(k, el, aya);
      show($('#recWord'));
      keepClear();
    }, w.p !== S.page ? 120 : 30);
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

  // (tajweed: one setting before madd and ghunna were apart; turned off, both start off)
  const SET_ON = { sound: true, tjMadd: store.get('recite.tajweed', true), tjGhunna: store.get('recite.tajweed', true), tjOver: true, lHeavy: true, lNear: true }; // settings on unless turned off
  // how often the words are read (Mu.rate): the same mistakes caught either way
  const RATE_NOTE = {
    auto: 'كل ربع ثانية إن أطاق جهازك، وأقل على الأجهزة البطيئة كي لا تسخن',
    fast: 'كل ربع ثانية دائمًا، أو بأقصى ما يطيقه جهازك · أثقل على البطارية',
    save: 'مرة كل ثانية ونصف · أخف على البطارية، والأخطاء تُكشف كما هي، وتظهر الكلمات متأخرة قليلًا',
  };
  const setting = id => !!store.get('recite.' + id, SET_ON[id] ?? false);
  // the tajweed rules checked while reciting (match.js)
  // (a fast reading, hadr: no tajweed checked, nor letters told from their like; match.js opt.fast)
  // (this session's: begun as the setting says, then as the reader's pace and «سريع» turn it)
  // (the session's own to its end, the last aya judged at «إنهاء» too; and an aya found by the header
  // mic after one, read at that one's pace)
  const fast = () => G ? !!G.fast : setting('fastOn');
  const tjRules = () => fast() || light() ? { madd: false, ghunna: false, munfasil: false, over: false, pace: pace() }
    : { madd: setting('tjMadd'), ghunna: setting('tjGhunna'), munfasil: setting('tjMunfasil'), over: setting('tjOver'), pace: pace() };
  // how this reader holds a natural madd, from their own readings (match.js: rules.pace), in
  // the model's letters and in time: how often each length in letters was heard (0 to 8, older
  // readings counting less and less), and from it the length in the middle (u), how often heard
  // as nothing (z), how many (n); and how long it is held (the last PACE_T, in frames of 40 ms):
  // the middle (t), how many (tn). A madd is then judged against this reader's own natural one
  let paceNow = null;
  const PACE_T = 200;
  const mid = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  function pace() {
    if (paceNow) return paceNow;
    const h = store.get('mu.pace', null) || [], n = h.reduce((a, b) => a + b, 0), m = n - (h[0] || 0), ts = store.get('mu.paceT', null) || [];
    let u = 2;
    for (let l = 1, c = 0; l < h.length; l++) if ((c += h[l]) >= m / 2) { u = l; break; }
    return paceNow = { u: m > 0 ? u : 2, z: n ? (h[0] || 0) / n : 0, n, t: ts.length ? mid(ts) : 0, tn: ts.length };
  }
  function paceAdd(seen) {
    const ls = Object.values(seen || {});
    if (!ls.length) return;
    const h = store.get('mu.pace', null) || Array(9).fill(0), ts = store.get('mu.paceT', null) || [];
    for (const [l, d] of ls) {
      for (let i = 0; i < h.length; i++) h[i] *= 0.997;
      h[Math.min(8, l)] += 1;
      if (l > 0 && d > 0) ts.push(d);
    }
    store.set('mu.pace', h.map(x => +x.toFixed(3)));
    store.set('mu.paceT', ts.slice(-PACE_T));
    paceNow = null;
  }
  // letters told apart from their like (match.js: opt.letters)
  // (a letter said as its like, not heard all but surely: marked once this reader says it so
  // LET_OFTEN times in the session, the aya being said with the ones before; letters near in
  // sound, as many times as match.js asks)
  const LET_OFTEN = 2;
  const letTimes = pk => {
    const m = G?.mu, now = m?.letSeen ? Object.values(m.letSeen).filter(x => x === pk).length : 0;
    const before = m?.letPairs?.[pk];
    return (Array.isArray(before) ? before.length : 0) + now;
  };
  // a madd not heard at all (a fatha where an alif should be: match.js rules.gone), marked once this
  // reader is heard so MADD_OFTEN times, here or in the ayas before (at: those, each { k, got, want }
  // at its word); now: the ones in the aya being matched (its first cu units), by unit
  const MADD_OFTEN = 2;
  const goneRules = (now, at, cu) => ({
    gone: k => { if (k < cu) now[k] = 1; },
    goneOften: k => at.length + Object.keys(now).length + (now[k] ? 0 : 1) >= MADD_OFTEN,
  });
  // (once often: those before, each marked by mark(k, got, want))
  const goneMark = (now, at, mark) => {
    if (!Object.keys(now).length || at.length + Object.keys(now).length < MADD_OFTEN) return;
    for (const x of at) mark(x.k, x.got, x.want);
  };
  // the aya done: its ones kept, at their words (key(wi): a word of cur, as the caller counts words)
  const goneAdd = (now, at, ex, st, cur, n0, key) => {
    for (const k of Object.keys(now)) {
      const wi = ex._w ? ex._w.findIndex(([a, b]) => +k >= a && +k < b) : -1;
      if (wi >= 0 && wi < n0 && !at.some(x => x.k === key(wi))) at.push({ k: key(wi), got: st[wi]?.heard || '', want: cur.ph.slice(...cur.spans[wi]) });
    }
  };
  const letNeed = pk => Match.pairType(pk) === 'near' ? 3 : LET_OFTEN;
  const letRules = () => ({ heavy: setting('lHeavy') && !fast() && !light(), near: setting('lNear') && !fast() && !light(), often: (pk, need = LET_OFTEN) => letTimes(pk) + (Object.values(G?.mu?.letSeen || {}).includes(pk) ? 0 : 1) >= need });
  const toggle = (id, label, sub) => {
    const on = setting(id);
    return `<button class="row rc-set" data-rc-set="${id}" role="switch" aria-checked="${on}">
      <span class="main"><span class="t">${label}</span><span class="s">${sub}</span></span><span class="tog${on ? ' on' : ''}"><i></i></span></button>`;
  };

  function sessionLabel(s) {
    if (s.review) return 'مراجعة مواضع الضعف';
    if (s.kind && R.ayas[s.from]) return `${s.kind === 'new' ? 'حفظ جديد' : 'مراجعة'} · ${suraName(R.ayas[s.from][0])}`;
    if (!R.ayas[s.from] || !R.ayas[s.to]) return '';
    const range = s.from === s.to ? ayaLabel(s.from) : `${ayaLabel(s.from)} – ${ar(R.ayas[s.to][1])}`;
    return s.test ? `اختبار · ${range}` : range;
  }

  const streakText = n => !n ? 'سمّع اليوم لتبدأ سلسلة الأيام' : n === 1 ? 'بدأت سلسلة الأيام، عُد غدًا'
    : n === 2 ? 'يومان متتاليان' : n <= 10 ? `${ar(n)} أيام متتالية` : `${ar(n)} يومًا متتاليًا`;

  // days in a row with a session, up to today (or yesterday, before today's)
  // the most days in a row ever recited
  function longest(l) {
    const ds = Object.keys(l.days || {}).map(k => { const [y, m, d] = k.split('-').map(Number); return Math.round(new Date(y, m - 1, d) / 864e5); }).sort((a, b) => a - b);
    let best = 0, n = 0;
    ds.forEach((d, i) => { n = i && d - ds[i - 1] === 1 ? n + 1 : 1; best = Math.max(best, n); });
    return best;
  }
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

  // a surah card's edit button: its own page (a span: inside a button)
  const pen = s => `<span class="pp-pen" data-rc-edit="${s}" role="button" aria-label="عدّل ${suraName(s)}">${ICONS.fix}</span>`;
  // a name as typed: no harakat, one alif
  const simple = t => t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '').replace(/[ٱأإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  // the surah page in its edit mode: { s, pend: Map ai -> memorized, range: the aya a stretch begins at
  // (-1: none tapped yet; null: not choosing one), sure: the save tapped once }
  let suraEdit = null;
  const rerender = () => { const y = $('#sheetBody').scrollTop; renderSheet(); $('#sheetBody').scrollTop = y; };
  // the surah page's mutashabihat: how many of its ayas have one, once the list has come
  function fillSim() {
    const el = document.querySelector('[data-sim-of]');
    if (!el || typeof similarOf !== 'function') return;
    const x = +el.dataset.simOf;
    const list = suraAyas(x);
    Promise.all(list.map(ai => similarOf(ai))).then(r => {
      if (!el.isConnected) return;
      const n = r.filter(q => q.n).length, btn = el.closest('[data-rc-simtop]');
      if (!n || !btn) return;
      // (the closest likeness: the aya to compare first)
      let top = -1, best = -1;
      r.forEach((q, i) => { const c = Math.max(-1, ...q.list.map(y => y.close)); if (c > best) { best = c; top = list[i]; } });
      el.textContent = `${ayaCount(n)} منها تشبه آيات أخرى`;
      btn.dataset.rcSimtop = top; btn.hidden = false;
    });
  }
  // ayas marked memorized (known already: not today's new ones) or not
  function markSaid(list, on) {
    const l = log();
    l.said ||= {}; l.first ||= {};
    for (const a of list) {
      if (on) { if (!l.said[a]) { l.said[a] = Date.now(); l.first[a] = 1; } }
      else { delete l.said[a]; delete l.first[a]; }
    }
    store.set(key(), l);
    weakMap = null;
    rerender();
  }
  const suraAyas = x => Array.from({ length: suraSizes()[x] }, (_, i) => R.suraStart[x] + i);

  // the 114 surahs as tiles, by how much of each was recited
  function mapHTML(got, sizes, weakIn) {
    let tiles = '';
    for (let s = 1; s <= 114; s++) {
      const f = sizes[s] ? got[s] / sizes[s] : 0;
      const lvl = f === 0 ? 0 : f < 1 / 3 ? 1 : f < 2 / 3 ? 2 : f < 1 ? 3 : 4;
      tiles += `<button class="rc-tile l${lvl}${weakIn.has(s) ? ' weak' : ''}" data-rc-edit="${s}" aria-label="${suraName(s)}: ${ar(got[s])} من ${ar(sizes[s])}">${ar(s)}</button>`;
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
    seed: '<svg viewBox="0 0 24 24"><path d="M12 20.5v-8M12 12.5C12 8 9 5.5 4.5 5.5 4.5 10 7.5 12.5 12 12.5zM12 15c0-3.6 2.6-6 6.5-6 0 3.6-2.6 6-6.5 6z"/></svg>',
    fix: '<svg viewBox="0 0 24 24"><path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="M12.5 7.5l4 4"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.8"/><path d="M12 3.2l1.6 1.9 2.4-.6.8 2.3 2.3.8-.6 2.4 1.9 1.6-1.9 1.6.6 2.4-2.3.8-.8 2.3-2.4-.6L12 20.8l-1.6-1.9-2.4.6-.8-2.3-2.3-.8.6-2.4L3.2 12l1.9-1.6-.6-2.4 2.3-.8.8-2.3 2.4.6z"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    go: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M9 6.5v11l9-5.5z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 2.6-5 3.4-8.4 1.9 1.3 2.6 3 2.6 4.6 1-.6 1.6-1.7 1.8-2.9 1.6 1.4 4.2 3.6 4.2 6.7 0 3.2-2.4 5.6-6 5.6z"/></svg>',
  };
  const VIEWS = { log: 'السجل', set: 'إعدادات التسميع', pick: 'اختر سورة تحفظها', revs: 'جدول المراجعة', weak: 'مواضع الضعف', suras: 'سوري', sura: '' };
  const PER = [3, 5, 10, 15, 20]; // ayas a day the plan may take

  // ---- the plan: one surah memorized at a time, so many new ayas a day (store recite.plan.<riwaya>
  // { s, per, at }). Its ayas recited whole (log.said) are memorized; today's portion is the next
  // `per` of it not yet, and today's done once that many were first recited today
  const planKey = () => 'recite.plan.' + R.id;
  function planInfo(l) {
    const p = store.get(planKey(), null);
    if (!p || R.suraStart[p.s] == null) return null;
    const a0 = R.suraStart[p.s], n = suraSizes()[p.s], said = l.said || {}, first = l.first || {}, td = day();
    let done = 0, todayN = 0;
    const portion = [];
    for (let a = a0; a < a0 + n; a++) {
      if (said[a]) { done++; if (day(first[a] || said[a]) === td) todayN++; }
      else if (portion.length < p.per) portion.push(a);
    }
    const left = n - done;
    return { ...p, a0, n, done, todayN, portion, left, days: Math.ceil(left / p.per), finished: !left };
  }
  // ---- revision (muraja'a): every surah with ayas memorized comes back after an interval that grows
  // with each clean review (REV_DAYS by log.rev[s].n), shorter while it has weak spots; `due` in days
  // (negative: not yet), the most overdue first. The surah of the plan, being memorized, is left out
  const REV_DAYS = [1, 2, 4, 7, 14, 30];
  function revisions(l, skip = 0) {
    const said = l.said || {}, sizes = suraSizes(), got = new Array(115).fill(0), last = new Array(115).fill(0), weak = new Array(115).fill(0);
    for (const k of Object.keys(said)) { const a = R.ayas[+k]; if (a) { got[a[0]]++; last[a[0]] = Math.max(last[a[0]], said[k]); } }
    for (const [ai, a] of Object.entries(l.ayas)) if (!a.done && R.ayas[ai]) weak[R.ayas[ai][0]]++;
    const out = [];
    for (let s = 1; s <= 114; s++) {
      if (s === skip || got[s] < Math.min(3, sizes[s])) continue;
      const n = l.rev?.[s]?.n || 0, rv = l.rev?.[s]?.at || last[s];
      let iv = REV_DAYS[Math.min(n, REV_DAYS.length - 1)];
      if (weak[s]) iv = Math.max(1, Math.floor(iv / 2));
      out.push({ s, n, got: got[s], size: sizes[s], whole: got[s] >= sizes[s], last: last[s], weak: weak[s], due: daysAgo(rv) - iv, today: daysAgo(last[s]) === 0 });
    }
    return out.sort((a, b) => b.due - a.due || a.s - b.s);
  }
  const dueText = r => r.due > 0 ? `متأخرة ${r.due === 1 ? 'يومًا' : r.due === 2 ? 'يومين' : `${ar(r.due)} أيام`}` : r.due === 0 ? 'موعدها اليوم' : r.due === -1 ? 'غدًا' : `بعد ${ar(-r.due)} أيام`;
  // a surah's memorized ayas, in order (what its revision goes over)
  const memorized = (l, s) => { const out = [], a0 = R.suraStart[s], n = suraSizes()[s]; for (let a = a0; a < a0 + n; a++) if (l.said?.[a]) out.push(a); return out; };

  function panelHTML() {
    const l = log(), said = l.said || {}, sizes = suraSizes();
    const all = Object.entries(l.ayas).map(([ai, a]) => [+ai, a]).filter(([ai]) => R.ayas[ai]);
    const weak = all.filter(([, a]) => !a.done).sort((x, y) => x[0] - y[0]);
    const mastered = all.filter(([, a]) => a.done).sort((x, y) => y[1].at - x[1].at);
    const goal = store.get('recite.goal', 0), fresh = !all.length && !l.sessions.length;
    const view = store.get('recite.view', '') || '';

    // ---- one page, top to bottom: the greeting and the streak, the week, today's wird as cards to
    // swipe (each its colour and a play button), the plan as a journey, the revisions due, the numbers
    // and the mistakes. The log, the settings, the surah picker, the whole revision schedule and the
    // weak spots open as pages of their own over it (recite.view), a back arrow to return
    const at = resumeAya(), got = new Array(115).fill(0), lastIn = new Array(115).fill(0);
    for (const k of Object.keys(said)) { const a = R.ayas[+k]; if (a) { got[a[0]]++; lastIn[a[0]] = Math.max(lastIn[a[0]], said[k]); } }
    const today = l.days?.[day()] || 0, run = streak(l), pl = planInfo(l), revs = revisions(l, pl && !pl.finished ? pl.s : 0);
    const n = Object.keys(said).filter(k => R.ayas[+k]).length;
    const fmt = o => new Intl.DateTimeFormat('ar-u-nu-arab', o);
    const es = store.get('recite.editS', 0);
    if (view === 'sura' && !sizes[es]) { store.set('recite.view', ''); return panelHTML(); }
    if (view) return `<div class="pp pp-sub"><div class="pp-bar"><button class="pp-back" data-rc-view="${view === 'sura' ? store.get('recite.editFrom', '') : ''}" aria-label="رجوع">${ICONS.back}</button><b>${view === 'sura' ? `سورة ${suraName(es)}` : VIEWS[view] || ''}</b></div>
      <div class="pp-subb">${view === 'log' ? logHTML() : view === 'set' ? setHTML() : view === 'pick' ? pickHTML() : view === 'revs' ? revsHTML() : view === 'weak' ? weakHTML(weak) : view === 'suras' ? memoHTML() : view === 'sura' ? suraHTML(es) : ''}</div></div>`;

    const hr = new Date().getHours(), hi = hr < 5 ? 'ليلة مباركة' : hr < 12 ? 'صباح الخير' : hr < 18 ? 'طاب يومك' : 'مساء النور';
    let h = `<div class="pp">
      <header class="pp-top">
        <div class="pp-hi"><small>${hi}</small><b>${esc(fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))}</b></div>
        <span class="pp-flame${run ? '' : ' cold'}" aria-label="${run ? streakText(run) : 'لا سلسلة بعد'}">${ICONS.flame}<b>${ar(run)}</b></span>
        <span class="pp-icons"><button data-rc-view="log" aria-label="السجل">${ICONS.clock}</button><button data-rc-view="set" aria-label="إعدادات التسميع">${ICONS.gear}</button></span>
      </header>`;
    h += weekHTML();

    // ---- today's wird: a card each, to swipe through
    const cards = [];
    if (pl && !pl.finished) {
      const met = pl.todayN >= pl.per, a0 = pl.portion[0], a1 = pl.portion[pl.portion.length - 1];
      cards.push({ c: 'green', icon: ICONS.seed, k: 'حفظ جديد', t: suraName(pl.s), s: met ? `أتممت ورد اليوم · ${ayaCount(pl.todayN)}` : `الآيات ${ar(R.ayas[a0][1])}${a1 !== a0 ? '–' + ar(R.ayas[a1][1]) : ''}`, f: Math.min(1, pl.todayN / pl.per), done: met, act: 'data-rc-new', edit: pl.s });
    } else cards.push({ c: 'green', icon: ICONS.seed, k: 'حفظ جديد', t: pl?.finished ? 'سورة جديدة؟' : 'ابدأ رحلة حفظ', s: pl?.finished ? `أتممت ${suraName(pl.s)}، ما شاء الله` : 'اختر سورة وكم آية في اليوم', act: 'data-rc-view="pick"', go: ICONS.plus });
    const due = revs.filter(r => r.due >= 0);
    if (due.length) cards.push({ c: 'amber', icon: ICONS.review, k: 'مراجعة', t: suraName(due[0].s), s: dueText(due[0]) + (due.length > 1 ? ` · و${ar(due.length - 1)} غيرها` : ''), act: `data-rc-rev="${due[0].s}"`, edit: due[0].s });
    else if (revs.length) cards.push({ c: 'amber', icon: ICONS.review, k: 'مراجعة', t: 'لا شيء مستحق', s: `التالية: ${suraName(revs[0].s)} ${dueText(revs[0])}`, done: true, act: `data-rc-rev="${revs[0].s}"`, edit: revs[0].s });
    if (weak.length) cards.push({ c: 'coral', icon: ICONS.fix, k: 'تثبيت', t: `${ar(weak.length)} ${weak.length <= 10 && weak.length > 2 ? 'مواضع' : 'موضعًا'}`, s: 'آيات أخطأت فيها تنتظرك', act: 'data-rc-review' });
    cards.push({ c: 'sky', icon: MIC, k: fresh ? 'ابدأ التسميع' : 'تابع', t: ayaLabel(at), s: esc(ayaTokens(at).slice(0, 4).join(' ')) + ' …', act: 'data-rc-resume', verse: true });
    if (testAyas()) cards.push({ c: 'violet', icon: ICONS.test, k: 'اختبرني', t: 'آيات مخفية', s: 'من موضع سمّعته من قبل', act: 'data-rc-test' });
    cards.push({ c: 'ink', icon: ICONS.find, k: 'ابحث بصوتك', t: 'اقرأ ونجدها', s: 'من أي موضع في المصحف', act: 'data-rc-find' });
    const doneN = cards.filter(x => x.done).length, wird = cards.filter(x => ['green', 'amber', 'coral'].includes(x.c)).length;
    h += `<div class="pp-h"><b>ورد اليوم</b><small>${ar(doneN)} من ${ar(wird)}</small></div>
      <div class="pp-cards">${cards.map((x, i) => `<button class="pp-c ${x.c}${x.done ? ' done' : ''}" ${x.act} style="--i:${i}">${x.edit ? pen(x.edit) : ''}
        <span class="pp-c-i">${x.icon}</span>
        <span class="pp-c-k">${x.k}</span>
        <b class="pp-c-t">${x.t}</b>
        <span class="pp-c-s"${x.verse ? ` style="font-family:${R.font}"` : ''}>${x.s}</span>
        ${x.f != null ? `<span class="pp-c-bar"><i style="width:${Math.round(x.f * 100)}%"></i></span>` : ''}
        <span class="pp-c-go">${x.done ? ICONS.check : x.go || ICONS.play}</span></button>`).join('')}</div>`;

    // ---- the plan, as a journey: the surah in its ring, a dot a day to its end
    if (pl) {
      const f = pl.done / pl.n, days = Math.ceil(pl.n / pl.per), past = Math.floor(pl.done / pl.per), dots = Math.min(days, 21);
      const end = new Date(Date.now() + pl.days * 864e5);
      h += `<div class="pp-h"><b>رحلة الحفظ</b><button data-rc-view="pick">${pl.finished ? 'سورة جديدة' : 'غيّر'}</button></div>
        <section class="pp-plan">
          ${pen(pl.s)}<div class="pp-plan-r" style="--f:${f}"><span><b>${suraName(pl.s)}</b><small>${ar(Math.round(f * 100))}٪</small></span></div>
          <div class="pp-plan-x">
            <b>${pl.finished ? 'أتممتها، ما شاء الله' : `${ayaCount(pl.left)} باقية`}</b>
            <small>${pl.finished ? 'دخلت جدول المراجعة' : `تتمّها ${pl.days <= 1 ? 'غدًا' : `في ${ar(pl.days)} ${pl.days <= 10 ? 'أيام' : 'يومًا'}`} · ${esc(fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(end))}`}</small>
            <span class="pp-path">${Array.from({ length: dots }, (_, i) => `<i class="${i < Math.round(past * dots / days) ? 'on' : ''}${i === Math.round(past * dots / days) && !pl.finished ? ' now' : ''}"></i>`).join('')}<em>🏁</em></span>
            <span class="pp-per">${PER.map(k => `<button data-rc-per="${k}"${pl.per === k ? ' class="on"' : ''}>${ar(k)}</button>`).join('')}<small>آية/يوم</small></span>
          </div>
        </section>`;
    }

    // ---- the revisions, the most urgent first
    if (revs.length) {
      h += `<div class="pp-h"><b>المراجعة</b><button data-rc-view="revs">الجدول كله</button></div>
        <div class="pp-revs">${revs.slice(0, 8).map(r => `<button class="pp-rev ${r.due > 0 ? 'late' : r.due === 0 ? 'now' : 'later'}" data-rc-rev="${r.s}">
          ${pen(r.s)}<small>${r.due > 0 ? `متأخرة ${ar(r.due)}` : r.due === 0 ? 'اليوم' : r.due === -1 ? 'غدًا' : `بعد ${ar(-r.due)} أيام`}</small>
          <b>${suraName(r.s)}</b>
          <span class="pp-str">${[0, 1, 2, 3, 4].map(j => `<i${j < Math.min(5, r.n) ? ' class="on"' : ''}></i>`).join('')}</span></button>`).join('')}</div>`;
    }

    // ---- the numbers, as a bento of tiles
    if (!fresh) {
      const tot = l.total || {}, secs = Math.max(tot.secs || 0, l.sessions.reduce((t, x) => t + (x.secs || 0), 0));
      const full = Array.from({ length: 114 }, (_, i) => i + 1).filter(x => sizes[x] && got[x] >= sizes[x]).length;
      const mastered = all.filter(([, a]) => a.done).length, pct = n / R.ayas.length * 100, hrs = secs / 3600;
      const w1 = l.sessions.filter(x => x.t >= Date.now() - 7 * 864e5);
      const acc = w1.length ? 1 - w1.reduce((t, x) => t + x.errs, 0) / Math.max(1, w1.reduce((t, x) => t + x.words, 0)) : null;
      h += `<div class="pp-h"><b>أرقامك</b><button data-rc-view="suras">سوري</button></div>
        <div class="pp-bento">
          <div class="pp-t big green"><span class="pp-ring" style="--f:${Math.min(1, pct / 100)}"></span><b>${ar(n)}</b><small>آية سمّعتها · ${ar(pct < 1 ? pct.toFixed(1) : Math.round(pct))}٪ من القرآن</small></div>
          <div class="pp-t amber"><b>${ar(Math.max(run, longest(l)))}</b><small>أطول سلسلة</small></div>
          <div class="pp-t sky"><b>${hrs >= 1 ? ar(hrs.toFixed(1).replace('.', '٫')) : ar(Math.round(secs / 60))}</b><small>${hrs >= 1 ? 'ساعة' : 'دقيقة'} تسميع</small></div>
          <div class="pp-t violet"><b>${ar(full)}</b><small>سورة كاملة</small></div>
          <div class="pp-t coral"><b>${acc == null ? '—' : ar(Math.round(acc * 100)) + '٪'}</b><small>دقّتك هذا الأسبوع</small></div>
          <div class="pp-t wide">${heatHTML()}</div>
          <div class="pp-t ink"><b>${ar(mastered)}</b><small>آية أتقنتها</small></div>
          <div class="pp-t ink"><b>${ar(Math.max(tot.sessions || 0, l.sessions.length))}</b><small>جلسة</small></div>
        </div>`;
      h += mistakesHTML();
    } else h += helpHTML();
    return h + '</div>';

    // the week: a bubble a day, filled when recited, today's ring filling toward the goal
    function weekHTML() {
      const LET = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'], now = new Date();
      let w = '';
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i);
        const c = l.days?.[day(d)] || 0, isT = !i, f = isT && goal ? Math.min(1, today / goal) : c ? 1 : 0;
        w += `<li class="${c ? 'on' : ''}${isT ? ' now' : ''}" style="--f:${f};--i:${6 - i}" title="${c ? ayaCount(c) : 'لا تسميع'}"><span>${c ? ICONS.check : ar(d.getDate())}</span><small>${LET[d.getDay()]}</small></li>`;
      }
      return `<ol class="pp-week">${w}</ol>${goal ? `<p class="pp-goal">${today >= goal ? '🎉 بلغت هدف اليوم' : `${ayaCount(goal - today)} لهدف اليوم`}</p>` : ''}`;
    }
    // the mistakes: their kinds as chips, the words most often wrong, the weak spots a tap away
    function mistakesHTML() {
      const ss = l.sessions.filter(x => x.t >= Date.now() - 30 * 864e5), kinds = {}, words = new Map();
      for (const x of ss) for (const [ai, wi, e] of x.list || []) {
        kinds[e] = (kinds[e] || 0) + 1;
        if (wi >= 0 && R.ayas[ai]) { const k = ai + ':' + wi; words.set(k, (words.get(k) || 0) + 1); }
      }
      if (!Object.keys(kinds).length && !weak.length) return '';
      const often = [...words].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8);
      return `<div class="pp-h"><b>أخطاؤك</b><small>آخر ٣٠ يومًا</small></div>
        <div class="pp-kinds">${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([e, c], i) => `<span class="pp-k k${i % 5}"><b>${ar(c)}</b>${KIND_SHORT[e] || TYPES[e] || e}</span>`).join('')}</div>
        ${often.length ? `<div class="pp-sub-h">كلمات تتكرر أخطاؤك فيها</div><div class="pp-words">${often.map(([k, c]) => {
          const [ai, wi] = k.split(':').map(Number);
          return `<button data-rc-aya="${ai}"><b style="font-family:${R.font}">${esc(ayaTokens(ai)[wi] || '')}</b><small>${ayaLabel(ai)}</small><i>${ar(c)}</i></button>`;
        }).join('')}</div>` : ''}
        ${weak.length ? `<button class="pp-wide-b" data-rc-view="weak">${ICONS.fix}<span>كل مواضع الضعف <b>${ar(weak.length)}</b></span>${ICONS.go}</button>` : ''}`;
    }
    // 16 weeks, a cell a day, oldest on the right
    function heatHTML() {
      const cols = [], now = new Date(), start = new Date(now); start.setDate(now.getDate() - now.getDay() - 7 * 15);
      let active = 0;
      for (let w = 0; w < 16; w++) {
        const col = [];
        for (let d = 0; d < 7; d++) {
          const x = new Date(start); x.setDate(start.getDate() + w * 7 + d);
          const c = x > now ? -1 : l.days?.[day(x)] || 0;
          if (c > 0) active++;
          col.push(`<i class="h${c < 0 ? 'x' : !c ? 0 : c < 5 ? 1 : c < 10 ? 2 : c < 20 ? 3 : 4}" title="${fmt({ day: 'numeric', month: 'short' }).format(x)}: ${c > 0 ? ayaCount(c) : 'لا تسميع'}"></i>`);
        }
        cols.push(`<span>${col.join('')}</span>`);
      }
      return `<div class="pp-heat-h"><b>${ar(active)}</b><small>يومًا فيها تسميع · آخر ١٦ أسبوعًا</small></div><div class="pp-heat">${cols.join('')}</div>`;
    }
    // the whole revision schedule
    function revsHTML() {
      if (!revs.length) return '<p class="rc-empty">ما تحفظه من السور يعود إليك هنا لتراجعه، وتطول المدة كلما راجعته بلا أخطاء.</p>';
      return `<p class="rc-hint">كل سورة حفظتها تعود إليك بعد يوم، ثم يومين، ثم ٤، ثم أسبوع، ثم أسبوعين، ثم شهر، كلما راجعتها بلا أخطاء؛ وأسرع إن كانت فيها مواضع ضعف.</p><div class="group">` + revs.map(r =>
        `<div class="row rc-rev"><span class="rc-rev-d ${r.due > 0 ? 'late' : r.due === 0 ? 'now' : ''}">${r.due >= 0 ? (r.due ? `متأخرة ${ar(r.due)}` : 'اليوم') : `بعد ${ar(-r.due)}`}</span>
          <span class="main"><span class="t">${suraName(r.s)}</span><span class="s">${r.whole ? 'كاملة' : `${ar(r.got)} من ${ar(r.size)}`} · آخر قراءة ${ago(r.last)}${r.weak ? ` · ${ar(r.weak)} موضع ضعف` : ''}</span>
          <span class="rc-str">${[0, 1, 2, 3, 4].map(j => `<i${j < Math.min(5, r.n) ? ' class="on"' : ''}></i>`).join('')}</span></span>
          <button class="rc-cont" data-rc-rev="${r.s}">${MIC}<span>راجع</span></button></div>`).join('') + '</div>';
    }
    function weakHTML(list) {
      if (!list.length) return '<p class="rc-empty">لا مواضع ضعف الآن، ما شاء الله.</p>';
      return `<button class="pp-wide-b solid" data-rc-review>${MIC}<span>سمّعها كلها الآن</span></button><div class="group">` + list.map(([ai, a]) => {
        const dots = [0, 1, 2].map(j => `<i${j < a.ok.length ? ' class="on"' : ''}></i>`).join('');
        return `<button class="row rc-row" data-rc-aya="${ai}"><span class="num">${ar(R.ayas[ai][1])}</span>
          <span class="main"><span class="verse rc-snip" style="font-family:${R.font}">${snippet(ai, a.words)}</span>
          <span class="s">${suraName(R.ayas[ai][0])} · ${times(a.n)} · آخرها ${ago(a.last)}<span class="rc-dots">${dots}</span></span></span>
          <span class="rc-mic" data-rc-start="${ai}" aria-label="سمّع الآية">${MIC}</span></button>`;
      }).join('') + `</div><p class="rc-hint">تُتقَن الآية بقراءتها صحيحة في ${ar(MASTER_DAYS)} أيام مختلفة، فتخرج من هنا.</p>`;
    }
    // a surah to memorize: all 114 as tiles, found by name or number as typed, or by a filter (begun,
    // juz 'amma, tabarak, the long ones); each with how much of it is memorized, the plan's marked
    function pickHTML() {
      const pl0 = store.get(planKey(), null)?.s, juzOf = x => R.ayas[R.suraStart[x]][3];
      const begun = x => got[x] > 0 && got[x] < sizes[x];
      const fl = [['all', 'الكل'], ...(Array.from({ length: 114 }, (_, i) => i + 1).some(begun) ? [['begun', 'بدأتها']] : []), ['amma', 'جزء عمّ'], ['tabarak', 'جزء تبارك'], ['short', 'قصيرة'], ['long', 'الطوال']];
      const tag = x => [begun(x) && 'begun', juzOf(x) === 30 && 'amma', juzOf(x) === 29 && 'tabarak', sizes[x] <= 20 && 'short', sizes[x] >= 100 && 'long'].filter(Boolean).join(' ');
      return `<div class="pp-find"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg><input type="search" data-rc-pick-q placeholder="ابحث باسم السورة أو رقمها" autocomplete="off"></div>
        <div class="pp-fl">${fl.map(([k, t], i) => `<button data-rc-pf="${k}"${i ? '' : ' class="on"'}>${t}</button>`).join('')}</div>
        <div class="pp-grid">${Array.from({ length: 114 }, (_, i) => i + 1).map(x => {
          const f = sizes[x] ? got[x] / sizes[x] : 0, full = f >= 1;
          return `<button class="pp-g${x === pl0 ? ' cur' : ''}${full ? ' full' : ''}" data-rc-plan="${x}" data-k="${tag(x)}" data-q="${x} ${esc(simple(suraName(x)))}">
            <span class="pp-g-n">${ar(x)}</span><b>${suraName(x)}</b><small>${full ? 'محفوظة' : x === pl0 ? 'خطتك الآن' : got[x] ? `${ar(got[x])} من ${ar(sizes[x])}` : ayaCount(sizes[x])}</small>
            ${got[x] && !full ? `<span class="pp-g-bar"><i style="width:${Math.max(4, Math.round(f * 100))}%"></i></span>` : ''}${full ? `<span class="pp-g-ok">${ICONS.check}</span>` : ''}</button>`;
        }).join('')}</div>
        <p class="pp-none" hidden>لا سورة بهذا الاسم</p>`;
    }

    // ---- a surah's own page (its edit button, or the card held): the reader's own way through it. How
    // much is memorized and when it was revised; the journey (its quarters as milestones, the pace so
    // far and when, at it, the surah is done); what needs care (its pages by strength, the weakest a
    // tap from a session, the weak ayas, its ayas that read like others elsewhere); the reader's numbers
    // in it (sessions, accuracy and its trend, mistakes by kind, words most missed); a little to know
    // and to hope for. Its ayas below, read only: changed in an edit mode of its own, each change
    // pending until confirmed (twice: what changes said first)
    function suraHTML(x) {
      if (!sizes[x]) return '';
      const a0 = R.suraStart[x], N = sizes[x], k = got[x], f = k / N, pl0 = store.get(planKey(), null), plan = pl0?.s === x ? planInfo(l) : null;
      const ayas = Array.from({ length: N }, (_, i) => a0 + i), inS = ai => ai >= a0 && ai < a0 + N;
      const weakIn = weak.filter(([ai]) => inS(ai)).map(([ai]) => ai), weakSet = new Set(weakIn);
      const rv = revisions(l).find(r => r.s === x), ed = suraEdit?.s === x ? suraEdit : null;
      const [, , , , place] = META.suras[x - 1];
      const fmtD = t => esc(fmt({ day: 'numeric', month: 'long' }).format(new Date(t)));
      const days = n => n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? `${ar(n)} أيام` : `${ar(n)} يومًا`;

      // the journey: when each aya was memorized (first said whole; those marked known have no date)
      const when = ayas.map(ai => l.first?.[ai] > 1e9 ? l.first[ai] : said[ai] > 1e9 && l.first?.[ai] !== 1 ? said[ai] : 0).filter(Boolean).sort((p, q) => p - q);
      const firstAt = when[0], activeDays = new Set(when.map(t => day(t))).size;
      const recent = when.filter(t => t > Date.now() - 14 * 864e5).length; // (the last two weeks)
      const perDay = plan && !plan.finished ? plan.per : recent >= 3 ? recent / 14 : activeDays ? when.length / Math.max(1, daysAgo(firstAt) + 1) : 0;
      const left = N - k, eta = perDay > 0 && left ? Math.ceil(left / perDay) : 0;
      const marks = [[.25, 'ربعها'], [.5, 'نصفها'], [.75, 'ثلاثة أرباعها'], [1, 'كلها']];
      const next = marks.find(([q]) => k < Math.ceil(q * N));
      // its pages, each by how much of it is memorized and whether a weak spot is in it
      const pages = []; for (const ai of ayas) { const p = R.ayas[ai][2]; let g = pages[pages.length - 1]; if (!g || g.p !== p) pages.push(g = { p, list: [] }); g.list.push(ai); }
      for (const g of pages) { g.got = g.list.filter(ai => said[ai]).length; g.weak = g.list.filter(ai => weakSet.has(ai)).length; }
      const known = pages.filter(g => g.got), worst = known.filter(g => g.weak).sort((p, q) => q.weak / q.list.length - p.weak / p.list.length)[0];
      // the sessions that went over it, and its mistakes in them (oldest first, for the trend)
      const ss = l.sessions.filter(q => (q.from != null && q.to != null && q.from <= a0 + N - 1 && q.to >= a0) || (q.list || []).some(([ai]) => inS(ai))).slice().reverse();
      const share = q => { if (q.from == null || !q.words || q.to == null) return 0; const lo = Math.max(q.from, a0), hi = Math.min(q.to, a0 + N - 1); return hi >= lo ? q.words * (hi - lo + 1) / Math.max(1, q.to - q.from + 1) : 0; };
      const errsIn = ss.flatMap(q => (q.list || []).filter(([ai]) => inS(ai))), wordsIn = ss.reduce((t, q) => t + share(q), 0);
      const accOf = list => { const w = list.reduce((t, q) => t + share(q), 0), e = list.reduce((t, q) => t + (q.list || []).filter(([ai]) => inS(ai)).length, 0); return w >= 10 ? Math.max(0, 1 - e / w) : null; };
      const acc = wordsIn >= 10 ? Math.max(0, 1 - errsIn.length / wordsIn) : null;
      const half = Math.floor(ss.length / 2), was = ss.length >= 4 ? accOf(ss.slice(0, half)) : null, now = ss.length >= 4 ? accOf(ss.slice(half)) : null;
      const kinds = {}; for (const [, , e] of errsIn) kinds[e] = (kinds[e] || 0) + 1;
      const wc = new Map(); for (const [ai, wi] of errsIn) if (wi >= 0) { const q = ai + ':' + wi; wc.set(q, (wc.get(q) || 0) + 1); }
      const missed = [...wc].sort((p, q) => q[1] - p[1]).slice(0, 4);
      // its length: words, letters (each a good deed, and ten like it), the time it takes at the reader's pace
      const words = ayas.reduce((t, ai) => t + ayaTokens(ai).length, 0);
      const letters = ayas.reduce((t, ai) => t + ayaTokens(ai).join('').replace(/[^ء-يٱ]/g, '').length, 0);
      const pace = (q => q.words > 200 ? Math.min(1.4, Math.max(0.45, q.secs / q.words)) : 0.75)(l.sessions.reduce((t, q) => ({ secs: t.secs + (q.secs || 0), words: t.words + (q.secs ? q.words || 0 : 0) }), { secs: 0, words: 0 }));
      const mins = Math.max(1, Math.round(words * pace / 60)), minsLeft = Math.round(ayas.filter(ai => !said[ai]).reduce((t, ai) => t + ayaTokens(ai).length, 0) * pace / 60);
      const p0 = R.ayas[a0][2], p1 = R.ayas[a0 + N - 1][2];
      const big = n => ar(n.toLocaleString('en').replace(/,/g, '٬'));
      const stat = (v, t) => `<div><b>${v}</b><small>${t}</small></div>`;
      const fact = (t, v) => `<li><small>${t}</small><b>${v}</b></li>`;
      setTimeout(fillSim); // (once the page is in)
      // (each aya as memorized now, or as it will be once the changes pending are kept)
      const isOn = ai => ed?.pend.has(ai) ? ed.pend.get(ai) : !!said[ai];
      const add = ed ? [...ed.pend].filter(([ai, v]) => v && !said[ai]).length : 0, del = ed ? [...ed.pend].filter(([ai, v]) => !v && said[ai]).length : 0;
      // a word of encouragement, for where the reader is in it
      const cheer = k >= N ? (rv?.n >= 3 ? 'ثابتة في صدرك، ما شاء الله. مراجعة بين حين وآخر تبقيها كذلك.' : 'أتممتها! المراجعات القادمة هي التي تثبّتها، فلا تفوّتها.')
        : !k ? `${N <= 20 ? 'سورة قصيرة: ' : ''}${N <= 10 ? 'تحفظها في جلسة أو جلستين.' : `بخمس آيات في اليوم تتمّها في ${days(Math.ceil(N / 5))}.`}`
        : next && Math.ceil(next[0] * N) - k <= 3 ? `${ayaCount(Math.ceil(next[0] * N) - k)} وتبلغ ${next[1]}!`
        : f >= .5 ? `تجاوزت نصفها، ولم يبقَ إلا ${ayaCount(left)}${minsLeft ? ` (نحو ${ar(Math.max(1, minsLeft))} دقيقة تلاوةً)` : ''}.` : `بدأت، والبداية أصعب ما فيها. ${ayaCount(left)} باقية.`;
      return `<section class="pp-se">
        <div class="pp-se-top">
          <div class="pp-plan-r" style="--f:${f}"><span><b>${ar(Math.round(f * 100))}٪</b><small>${ar(k)}/${ar(N)}</small></span></div>
          <div class="pp-se-x">
            <b>${k >= N ? 'محفوظة كاملة' : k ? `${ayaCount(k)} محفوظة` : 'لم تحفظ منها شيئًا بعد'}</b>
            <small>${cheer}</small>
            ${rv ? `<span class="pp-str" aria-label="${ar(rv.n)} مراجعات متقنة">${[0, 1, 2, 3, 4].map(j => `<i${j < Math.min(5, rv.n) ? ' class="on"' : ''}></i>`).join('')}<em>المراجعة ${dueText(rv)}</em></span>` : ''}
          </div>
        </div>
        <div class="pp-se-acts">
          ${k ? `<button data-rc-rev="${x}">${ICONS.review}<span>راجعها</span></button>` : ''}
          ${plan ? `<button class="on" disabled>${ICONS.seed}<span>خطتك الآن</span></button>` : k < N ? `<button data-rc-plan="${x}">${ICONS.seed}<span>${k ? 'أكمل حفظها' : 'احفظها'}</span></button>` : ''}
          <button data-rc-open="${x}">${ICONS.go}<span>في المصحف</span></button>
        </div>

        <div class="pp-sub-h">رحلتك فيها</div>
        <div class="pp-se-card">
          <div class="pp-se-miles">${marks.map(([q, t]) => { const need = Math.ceil(q * N), on = k >= need; return `<span class="${on ? 'on' : ''}${next?.[0] === q ? ' next' : ''}"><i style="--f:${Math.min(1, Math.max(0, (k - Math.ceil((q - .25) * N)) / Math.max(1, need - Math.ceil((q - .25) * N))))}"></i><small>${t}</small></span>`; }).join('')}</div>
          <ul class="pp-se-facts flat">
            ${firstAt ? fact('بدأتها', `${fmtD(firstAt)} · منذ ${days(Math.max(1, daysAgo(firstAt)))}`) : ''}
            ${activeDays ? fact('أيام حفظت فيها منها', ar(activeDays)) : ''}
            ${perDay ? fact('وتيرتك', `${perDay < 1 ? 'أقل من آية' : Number.isInteger(+perDay.toFixed(1)) ? ayaCount(Math.round(perDay)) : ar(perDay.toFixed(1)).replace('.', '٫') + ' آية'} في اليوم`) : ''}
            ${eta ? fact('تتمّها على وتيرتك', `${eta <= 1 ? 'غدًا' : `في ${days(eta)}`} · ${fmtD(Date.now() + eta * 864e5)}`) : ''}
            ${k >= N && when.length ? fact('أتممتها في', days(Math.max(1, daysAgo(when[0]) - daysAgo(when[when.length - 1]) + 1))) : ''}
          </ul>
        </div>

        ${k ? `<div class="pp-sub-h">ما يحتاج عنايتك<small>صفحاتها، كل صفحة بما حفظت منها${weakIn.length ? '، والأحمر فيه مواضع ضعف' : ''}</small></div>
        <div class="pp-se-card">
          <div class="pp-se-pages">${pages.map(g => `<button data-rc-pg="${g.list[0]},${g.list[g.list.length - 1]}" class="${g.got === g.list.length ? 'full' : g.got ? 'part' : ''}${g.weak ? ' weak' : ''}" style="--f:${g.got / g.list.length}" aria-label="صفحة ${ar(g.p)}"><i></i><small>${ar(g.p)}</small></button>`).join('')}</div>
          <div class="pp-se-need">
            ${weakIn.length ? `<button data-rc-weaks="${x}">${ICONS.fix}<span><b>${ayaCount(weakIn.length)} فيها ضعف</b><small>ثبّتها الآن في جلسة قصيرة</small></span>${ICONS.go}</button>` : ''}
            ${worst ? `<button data-rc-pg="${worst.list[0]},${worst.list[worst.list.length - 1]}">${ICONS.review}<span><b>أضعف صفحاتها: ${ar(worst.p)}</b><small>الآيات ${ar(R.ayas[worst.list[0]][1])}–${ar(R.ayas[worst.list[worst.list.length - 1]][1])} · سمّعها</small></span>${ICONS.go}</button>` : ''}
            <button data-rc-simtop="0" hidden>${ICONS.find}<span><b data-sim-of="${x}">…</b><small>قارنها بما يشبهها لئلا تلتبس عليك</small></span>${ICONS.go}</button>
          </div>
        </div>` : ''}

        ${ss.length ? `<div class="pp-sub-h">أرقامك فيها</div>
        <div class="pp-se-stats">
          ${stat(ar(ss.length), ss.length === 1 ? 'جلسة' : 'جلسات')}
          ${stat(acc == null ? '—' : ar(Math.round(acc * 100)) + '٪', 'دقّتك فيها')}
          ${stat(ar(errsIn.length), 'خطأ')}
          ${stat(lastIn[x] ? ago(lastIn[x]) : '—', 'آخر تسميع')}
        </div>
        ${was != null && now != null && Math.abs(now - was) >= .02 ? `<p class="pp-se-trend ${now > was ? 'up' : 'down'}">${now > was ? `دقّتك فيها تتحسّن: من ${ar(Math.round(was * 100))}٪ إلى ${ar(Math.round(now * 100))}٪ في جلساتك الأخيرة` : `دقّتك فيها نزلت من ${ar(Math.round(was * 100))}٪ إلى ${ar(Math.round(now * 100))}٪ — وقتها للمراجعة`}</p>` : ''}
        ${errsIn.length ? `<div class="rc-kinds pp-se-kinds">${Object.entries(kinds).sort((p, q) => q[1] - p[1]).slice(0, 4).map(([e, c]) =>
          `<div class="rc-kind"><span class="rc-mk rc-${e}"></span><span class="k">${KIND_SHORT[e] || TYPES[e] || e}</span><span class="rc-kbar"><i style="width:${Math.max(4, Math.round(c / errsIn.length * 100))}%"></i></span><b>${ar(c)}</b></div>`).join('')}</div>` : ''}
        ${missed.length ? `<div class="rc-often-h">كلمات تخطئ فيها هنا</div><div class="rc-often">${missed.map(([q, c]) => { const [ai, wi] = q.split(':').map(Number);
          return `<button data-rc-aya="${ai}"><b style="font-family:${R.font}">${esc(ayaTokens(ai)[wi] || '')}</b><small>آية ${ar(R.ayas[ai][1])}</small><i>${ar(c)}×</i></button>`; }).join('')}</div>` : ''}` : ''}

        <div class="pp-se-hope">
          <b>${big(letters)} حرفًا، بكل حرف حسنة، والحسنة بعشر أمثالها</b>
          <small>تلاوتها كاملة نحو ${big(letters * 10)} حسنة بإذن الله · «من قرأ حرفًا من كتاب الله فله به حسنة، والحسنة بعشر أمثالها» (الترمذي)</small>
        </div>
        <ul class="pp-se-facts">
          ${fact('نزلت', place === 'makkah' ? 'مكية' : 'مدنية')}
          ${fact('صفحاتها', p0 === p1 ? `صفحة ${ar(p0)}` : `${ar(p0)}–${ar(p1)} · ${ar(p1 - p0 + 1)} ${p1 - p0 + 1 <= 10 ? 'صفحات' : 'صفحة'}`)}
          ${fact('الجزء', ar(R.ayas[a0][3]) + (R.ayas[a0 + N - 1][3] !== R.ayas[a0][3] ? `–${ar(R.ayas[a0 + N - 1][3])}` : ''))}
          ${fact('كلماتها', `${big(words)} كلمة`)}
          ${fact('تلاوتها كاملة', mins >= 60 ? `نحو ${ar(+(mins / 60).toFixed(1))} ${mins < 120 ? 'ساعة' : 'ساعات'}`.replace('.', '٫') : `نحو ${ar(mins)} ${mins <= 10 && mins > 2 ? 'دقائق' : 'دقيقة'}`)}
        </ul>

        <div class="pp-sub-h">آياتها<small>${ed ? (ed.range != null ? (ed.range < 0 ? 'اضغط أول آية في المدى' : 'والآن آخر آية فيه') : 'اضغط آية لتغيّرها، ثم احفظ التغييرات') : 'المحفوظة بالأخضر'}</small></div>
        ${ed ? `<div class="pp-se-tools">
          <button data-rc-range${ed.range != null ? ' class="on"' : ''}>${ed.range != null ? 'إلغاء التحديد' : 'من آية إلى آية'}</button>
          <button data-rc-all="1">كلها محفوظة</button>
          <button data-rc-all="0">لا شيء</button>
        </div>` : ''}
        <div class="pp-ayas${ed ? ' editing' : ''}${ed?.range != null ? ' ranging' : ''}">${ayas.map(ai => {
          const on = isOn(ai), chg = ed?.pend.has(ai) && ed.pend.get(ai) !== !!said[ai];
          return `<${ed ? `button data-rc-tog="${ai}"` : 'span'} class="${on ? 'on' : ''}${weakSet.has(ai) ? ' weak' : ''}${chg ? ' chg' : ''}${ai === ed?.range ? ' anchor' : ''}">${ar(R.ayas[ai][1])}</${ed ? 'button' : 'span'}>`;
        }).join('')}</div>
        <div class="rc-legend pp-se-leg"><span><i class="on"></i>محفوظة</span><span><i class="weak"></i>فيها ضعف</span>${ed ? '<span><i class="chg"></i>تغيّرت</span>' : ''}</div>
        ${ed ? `<div class="pp-se-save">
            <span>${add || del ? [add && `+${ar(add)} محفوظة`, del && `−${ar(del)} تُزال`].filter(Boolean).join(' · ') : 'لا تغييرات بعد'}</span>
            <button data-rc-edit-cancel>إلغاء</button>
            <button class="pri" data-rc-edit-save${add || del ? '' : ' disabled'}>احفظ</button>
          </div>
          ${k ? `<button class="pp-wipe" data-rc-wipe="${x}">احذف تقدّمك في السورة كله</button>` : ''}`
        : `<button class="pp-se-edit" data-rc-edit-on="${x}">${ICONS.fix}<span>تعديل المحفوظ</span></button>
          <p class="pp-se-note">لتعلّم آيات حفظتها من قبل، أو تزيل ما لم تعد تحفظه. ما تسمّعه كاملًا يُعلَّم وحده.</p>`}
      </section>`;
    }

    // ---- حفظي: the whole so far, and each surah begun, to go on with
    function memoHTML() {
      const begun = Array.from({ length: 114 }, (_, i) => i + 1).filter(s => got[s]).sort((a, b) => lastIn[b] - lastIn[a]);
      if (!n) return `<p class="rc-empty">ما تسمّعه كاملًا من الآيات يُعَدّ هنا، سورةً سورة، لتعود إليه وتتابع.</p>` + helpHTML();
      let h = `<div class="group-label">سورك · الأحدث أولًا</div><div class="group">` + begun.map(s => {
        const f = got[s] / sizes[s], nx = nextIn(s, said), doneS = got[s] >= sizes[s];
        return `<div class="row rc-sura" data-rc-edit="${s}"><span class="num">${ar(s)}</span>
          <span class="main"><span class="t">${suraName(s)}</span>
          <span class="rc-bar${doneS ? ' full' : ''}"><i style="width:${Math.max(3, Math.round(f * 100))}%"></i></span>
          <span class="s">${doneS ? 'كاملة' : `${ar(got[s])} من ${ar(sizes[s])} آية`} · ${ago(lastIn[s])}</span></span>
          ${pen(s)}<button class="rc-cont" data-rc-from="${nx}" aria-label="تابع ${suraName(s)} من الآية ${ar(R.ayas[nx][1])}">${MIC}<span>${doneS ? 'أعدها' : `من ${ar(R.ayas[nx][1])}`}</span></button></div>`;
      }).join('') + '</div>';
      return h + mapHTML(got, sizes, new Set(weak.map(([ai]) => R.ayas[ai][0])));
    }

    // ---- the mistakes at a glance (the last 30 days of sessions): of which kind, how right the last
    // sessions were, and the words got wrong most often (each a tap from its aya)
    function insightsHTML() {
      const since = Date.now() - 30 * 864e5, ss = l.sessions.filter(x => x.t >= since && x.words);
      if (!ss.length) return '';
      const kinds = {}, words = new Map();
      for (const x of ss) for (const [ai, wi, e] of x.list || []) {
        kinds[e] = (kinds[e] || 0) + 1;
        if (wi >= 0 && R.ayas[ai]) { const k = ai + ':' + wi; words.set(k, (words.get(k) || 0) + 1); }
      }
      const total = Object.values(kinds).reduce((a, b) => a + b, 0), top = Math.max(1, ...Object.values(kinds));
      let h = '<section class="rc-ins">';
      if (total) h += `<div class="rc-ins-h"><b>${errs(total)}</b><small>في آخر ٣٠ يومًا · ${ar(ss.length)} ${ss.length === 1 ? 'جلسة' : ss.length === 2 ? 'جلستان' : ss.length <= 10 ? 'جلسات' : 'جلسة'}</small></div>
        <div class="rc-kinds">${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([e, c]) =>
          `<div class="rc-kind"><span class="rc-mk rc-${e}"></span><span class="k">${KIND_SHORT[e] || TYPES[e] || e}</span><span class="rc-kbar"><i style="width:${Math.max(4, Math.round(c / top * 100))}%"></i></span><b>${ar(c)}</b></div>`).join('')}</div>`;
      // (how right each of the last sessions was: its words said without a mistake; oldest first)
      const last = ss.slice(0, 12).reverse();
      if (last.length >= 2) {
        const acc = last.map(x => Math.max(0, 1 - x.errs / x.words)), mean = acc.reduce((a, b) => a + b, 0) / acc.length;
        h += `<div class="rc-acc"><div class="rc-acc-h"><span>دقّتك في آخر الجلسات</span><b>${ar(Math.round(mean * 100))}٪</b></div>
          <div class="rc-acc-bars" role="img" aria-label="دقة آخر ${ar(last.length)} جلسات، من الأقدم إلى الأحدث">${last.map((x, i) =>
            `<span title="${ago(x.t)} · ${ar(Math.round(acc[i] * 100))}٪"><i style="height:${Math.max(6, Math.round(acc[i] * 100))}%"></i></span>`).join('')}</div>
          <div class="rc-acc-x"><small>الأقدم</small><small>الأحدث</small></div></div>`;
      }
      const often = [...words].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (often.length) h += `<div class="rc-often-h">كلمات تتكرر أخطاؤك فيها</div><div class="rc-often">${often.map(([k, c]) => {
        const [ai, wi] = k.split(':').map(Number);
        return `<button data-rc-aya="${ai}"><b style="font-family:${R.font}">${esc(ayaTokens(ai)[wi] || '')}</b><small>${ayaLabel(ai)}</small><i>${ar(c)}×</i></button>`;
      }).join('')}</div>`;
      return h + '</section>';
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
        ${toggle('blind', 'تسميع أعمى', 'مع الإخفاء: لا أثر لما بعدك، فلا عدد للكلمات ولا أرقام للآيات')}
        ${toggle('weak', 'مواضع الضعف في المصحف', 'خط منقّط خفيف تحت كلمات أخطأت فيها')}
        ${MU() ? toggle('fastOn', 'القراءة السريعة', 'كل جلسة تبدأ بها. وتعمل وحدها إن أسرعت، وتتوقف إن عدت إلى قراءتك المعتادة، أو بزر «سريع»: يُعلَّم فيها ما تجاوزته أو قرأته بكلمة أخرى، والحركة إن سُمعت الكلمة واضحة؛ ولا يُفحص المدّ ولا الغنّة ولا الحروف المتقاربة') : ''}
        ${MU() ? `<div class="group-label">التجويد</div>
        ${toggle('tjMadd', 'المدّ', 'يُعلَّم المدّ الطبيعي إن قُصِر، والمتصل واللازم إن لم يُمَدّا')}
        ${setting('tjMadd') ? toggle('tjMunfasil', 'المدّ المنفصل أربع حركات', 'قراءة الشاطبية؛ إن تركتها مطفأة فالقصر جائز') : ''}
        ${toggle('tjOver', 'المدّ الزائد', 'يُعلَّم المدّ الطبيعي إن زِيد فيه كثيرًا، والحرف القصير إن مُدّ')}
        ${setting('tjMadd') || setting('tjOver') ? `<p class="note">يُقاس المدّ على قدر مدّك أنت، من قراءتك: ${pace().tn >= 30 ? `مدّك الطبيعي نحو ${ar((pace().t * 0.04).toFixed(2).replace('.', '٫'))} ثانية` : `يُقاس في أول قراءاتك (${ar(pace().tn)} من ${ar(30)})`}</p>` : ''}
        ${toggle('tjGhunna', 'الغنّة والإدغام', 'الإدغام والإخفاء والإقلاب والنون والميم المشددتان بغنّتها، والإدغام بلا غنّة')}
        <div class="group-label">الحروف</div>
        ${toggle('lHeavy', 'التفخيم والترقيق', 'س/ص، ت/ط، د/ض، ذ/ظ، ز/ظ، ق/ك: إن قُرئ أحدهما مكان الآخر')}
        ${toggle('lNear', 'الحروف المتقاربة', 'م/ن، ح/هـ، ع/ء، ذ/ز، ث/س: إن قُرئ أحدهما مكان الآخر')}` : ''}
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
      : bench ? `الأسرع على جهازك يُختار له (اختبرناه ${ago(bench.at)}): «المتدفّق» على المعالج، أو ٤ بت على المعالج الرسومي حيث هو أسرع بوضوح`
      : 'لم نختبرها على جهازك بعد';
    // (on how many of the processor's cores it runs: one only where the browser doesn't allow more)
    const inf = Mu.info();
    if (!testing && inf?.ep === 'wasm') s.textContent += inf.threads > 1 ? ` · يعمل على ${ar(inf.threads)} أنوية` : ' · يعمل على نواة واحدة (لا يسمح المتصفح بأكثر)';
    if (!testing && store.get('recite.light', false)) s.textContent += ' · وضع خفيف: الهاتف يتأخر عن القراءة، فلا يُفحص المدّ والغنّة حتى يلحق بها';
    b.innerHTML = `<button class="rc-not" data-rc-model="probe"${testing ? ' disabled' : ''}>${bench ? 'اختبر من جديد' : 'اختبر جهازك'}</button>`;
    const diag = $('#rcDiag');
    if (diag) diag.hidden = !Mu.ready();
    const times = bench?.times || {}, ok = Object.values(times).filter(x => x != null), fastest = ok.length ? Math.min(...ok) : null;
    const row = x => {
      const t = times[x.id], on = c?.id === x.id, got = have[x.variant];
      const speed = t === undefined ? '<span class="rc-mt">لم يُختبر</span>'
        : t === null ? `<span class="rc-mt na">لا يعمل على جهازك${bench?.errs?.[x.id] ? ` <bdi dir="ltr" class="rc-why">${esc(bench.errs[x.id])}</bdi>` : ''}</span>`
        : `<span class="rc-mt">نحو ${ar(t)} م.ث</span><span class="rc-mbar"><i style="width:${Math.max(6, Math.round(fastest / t * 100))}%"></i></span>`;
      const tags = (t === null ? [] : [x.id === bench?.best ? 'الأسرع' : '', on ? 'المستعمل' : '', got ? 'على جهازك' : '']).filter(Boolean)
        .map(k => `<span class="rc-tag${k === 'المستعمل' ? ' on' : ''}">${k}</span>`).join('');
      return `<button class="rc-m${on ? ' on' : ''}" data-rc-pick="${x.id}"${t === null ? ' disabled' : ''}>
        <span class="rc-mn">${MU_NAMES[x.id]}<small>${ar(x.mb)} م.ب</small></span>${speed}<span class="rc-tags">${tags}</span></button>`;
    };
    const base = Mu.CANDS.filter(x => Mu.BASE_IDS.includes(x.id)), big = Mu.CANDS.filter(x => !Mu.BASE_IDS.includes(x.id));
    const onBig = big.some(x => x.id === c?.id), bigTested = big.some(x => times[x.id] !== undefined);
    box.innerHTML = base.map(row).join('')
      + `<details class="rc-big"${onBig || box.querySelector('.rc-big[open]') ? ' open' : ''}><summary><span class="main"><span class="t">نماذج أخرى · اختياري</span>
          <span class="s">القراءة بالنوافذ كما كانت (٨ بت و٤ بت)، والنموذج الكبير: أبطأ على أكثر الأجهزة. يُنزَّل ما تختاره.</span></span><svg viewBox="0 0 24 24" class="go"><path d="M14.5 6l-6 6 6 6"/></svg></summary>
        ${big.map(row).join('')}
        ${bigTested ? '' : `<button class="rc-not rc-bigtest" data-rc-model="probe"${testing ? ' disabled' : ''}>اختبرها على جهازك</button>`}
        ${onBig ? `<button class="rc-not rc-bigtest" data-rc-pick="${bench?.best || 's8-cpu'}">العودة إلى الأسرع على جهازك</button>` : ''}
      </details>`
      + (Object.values(have).some(Boolean) ? `<div class="rc-mfoot">${Object.entries(have).filter(([, v]) => v).map(([k]) =>
      `<button class="rc-not" data-rc-delv="${k}">حذف ${k === 'q8' ? '٨ بت' : k === 'q4' ? '٤ بت' : '١٦ بت'} من جهازك</button>`).join('')}</div>` : '');
  }

  function weakAyas() {
    return Object.entries(log().ayas).filter(([ai, a]) => !a.done && R.ayas[+ai]).map(([ai]) => +ai).sort((a, b) => a - b);
  }

  function setPlan(s) {
    if (!R.suraStart[s] && R.suraStart[s] !== 0) return;
    store.set(planKey(), { s, per: store.get(planKey(), null)?.per || 5, at: Date.now() });
    store.set('recite.view', '');
    renderSheet();
    toast(`خطتك: ${suraName(s)}`);
  }
  // the picker: the tiles that fit what is typed and the filter chosen
  function pickFilter() {
    const q = $('[data-rc-pick-q]'), k = $('.pp-fl .on')?.dataset.rcPf || 'all';
    if (!q) return;
    const t = simple(q.value.trim()).replace(/^سوره\s*/, ''), num = /^[0-9٠-٩]+$/.test(t) ? +t.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)) : null;
    let shown = 0;
    document.querySelectorAll('.pp-g').forEach(g => {
      const [n, ...nm] = g.dataset.q.split(' '), name = nm.join(' ');
      const ok = (k === 'all' || g.dataset.k.split(' ').includes(k)) && (!t || (num != null ? +n === num : name.includes(t) || name.replace(/^ال/, '').startsWith(t.replace(/^ال/, ''))));
      g.hidden = !ok; if (ok) shown++;
    });
    $('.pp-none').hidden = !!shown;
  }
  document.addEventListener('input', e => { if (e.target.closest?.('[data-rc-pick-q]')) pickFilter(); });
  function openSura(x) {
    const from = store.get('recite.view', '') || '';
    if (from !== 'sura') store.set('recite.editFrom', from);
    store.set('recite.editS', x); store.set('recite.view', 'sura'); suraEdit = null;
    renderSheet(); $('#sheetBody').scrollTop = 0; haptic(5);
  }
  // a long press on a surah's card: its page too (the tap that ends it does nothing else). By touch
  // where there is touch (a phone's pointer events are cancelled as a press turns into the system's own
  // long press), and Android's long press itself (contextmenu) as well
  {
    const CARDS = '.pp-c, .pp-rev, .pp-plan, .rc-sura, .rc-tile';
    const editOf = el => { const card = el?.closest?.(CARDS); return card && (card.matches('[data-rc-edit]') ? card : card.querySelector('[data-rc-edit]')); };
    let t = null, x0 = 0, y0 = 0, fired = false, eatUntil = 0;
    const stop = () => { clearTimeout(t); t = null; };
    const fire = ed => { stop(); if (fired) return; fired = true; eatUntil = Date.now() + 900; haptic(15); openSura(+ed.dataset.rcEdit); };
    const down = (el, x, y) => { const ed = editOf(el); if (!ed) return; x0 = x; y0 = y; fired = false; stop(); t = setTimeout(() => fire(ed), 450); };
    const move = (x, y) => { if (t && Math.hypot(x - x0, y - y0) > 12) stop(); };
    const up = () => { stop(); if (fired) { fired = false; eatUntil = Date.now() + 400; } };
    const body = $('#sheetBody');
    if ('ontouchstart' in window) {
      body.addEventListener('touchstart', e => { if (e.touches.length === 1) down(e.target, e.touches[0].clientX, e.touches[0].clientY); else stop(); }, { passive: true });
      body.addEventListener('touchmove', e => move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
      body.addEventListener('touchend', up, { passive: true });
      body.addEventListener('touchcancel', up, { passive: true });
    } else {
      body.addEventListener('pointerdown', e => down(e.target, e.clientX, e.clientY));
      body.addEventListener('pointermove', e => move(e.clientX, e.clientY));
      body.addEventListener('pointerup', up);
      body.addEventListener('pointercancel', up);
    }
    body.addEventListener('contextmenu', e => { const ed = editOf(e.target); if (!ed) return; e.preventDefault(); if (!fired && Date.now() > eatUntil) fire(ed); });
    // (the click of the release only)
    body.addEventListener('click', e => { if (Date.now() < eatUntil) { eatUntil = 0; e.stopPropagation(); e.preventDefault(); } }, true);
  }
  function onSheetClick(e) {
    // a surah's page, from its edit button (before the card it is on)
    const ed = e.target.closest('[data-rc-edit]');
    if (ed && !e.target.closest('[data-rc-from]')) { e.stopPropagation(); openSura(+ed.dataset.rcEdit); return true; }
    // the surah page's edit mode: on, each aya, a stretch, all or none, kept (twice) or let go
    const eo = e.target.closest('[data-rc-edit-on]');
    if (eo) { suraEdit = { s: +eo.dataset.rcEditOn, pend: new Map(), range: null }; rerender(); haptic(8); return true; }
    if (e.target.closest('[data-rc-edit-cancel]')) { suraEdit = null; rerender(); return true; }
    const sv = e.target.closest('[data-rc-edit-save]');
    if (sv && suraEdit) {
      const said0 = log().said || {}, on = [...suraEdit.pend].filter(([ai, v]) => v && !said0[ai]).map(([ai]) => ai), off = [...suraEdit.pend].filter(([ai, v]) => !v && said0[ai]).map(([ai]) => ai);
      if (!sv.classList.contains('sure')) {
        sv.classList.add('sure'); sv.textContent = 'تأكيد';
        sv.previousElementSibling.previousElementSibling.textContent = 'اضغط «تأكيد» ليُحفظ: ' + [on.length && `${ayaCount(on.length)} تُعلَّم محفوظة`, off.length && `${ayaCount(off.length)} تُزال`].filter(Boolean).join('، ');
        haptic(10); return true;
      }
      suraEdit = null;
      const l = log(); l.said ||= {}; l.first ||= {};
      for (const a of on) { l.said[a] = Date.now(); l.first[a] = 1; }
      for (const a of off) { delete l.said[a]; delete l.first[a]; }
      store.set(key(), l); weakMap = null; rerender();
      toast('حُفظت التغييرات'); haptic(15);
      return true;
    }
    const tg = e.target.closest('[data-rc-tog]');
    if (tg && suraEdit) {
      const ai = +tg.dataset.rcTog, ed = suraEdit, now = ai => ed.pend.has(ai) ? ed.pend.get(ai) : !!log().said?.[ai];
      if (ed.range == null) { ed.pend.set(ai, !now(ai)); rerender(); haptic(5); return true; }
      if (ed.range === -1 || ed.range === ai) { ed.range = ed.range === ai ? null : ai; rerender(); return true; }
      const [x, y] = [Math.min(ed.range, ai), Math.max(ed.range, ai)];
      for (let a = x; a <= y; a++) ed.pend.set(a, true);
      ed.range = null; rerender(); haptic(10);
      return true;
    }
    if (e.target.closest('[data-rc-range]') && suraEdit) { suraEdit.range = suraEdit.range != null ? null : -1; rerender(); return true; }
    const all = e.target.closest('[data-rc-all]');
    if (all && suraEdit) { for (const a of suraAyas(suraEdit.s)) suraEdit.pend.set(a, all.dataset.rcAll === '1'); rerender(); haptic(8); return true; }
    const wipe = e.target.closest('[data-rc-wipe]');
    if (wipe) {
      // (twice: the first tap asks)
      if (!wipe.classList.contains('sure')) { wipe.classList.add('sure'); wipe.textContent = 'اضغط مرة أخرى: يُحذف حفظها ومراجعاتها وأخطاؤها'; setTimeout(() => { if (wipe.isConnected) { wipe.classList.remove('sure'); wipe.textContent = 'احذف تقدّمك في السورة كله'; } }, 4000); return true; }
      const x = +wipe.dataset.rcWipe, l = log(), list = suraAyas(x);
      for (const a of list) delete l.ayas[a];
      if (l.rev) delete l.rev[x];
      store.set(key(), l);
      suraEdit = null;
      markSaid(list, false);
      toast(`حُذف تقدّمك في ${suraName(x)}`);
      return true;
    }
    const pg = e.target.closest('[data-rc-pg]');
    if (pg) {
      const [a, b] = pg.dataset.rcPg.split(',').map(Number), sd = log().said || {}, list = Array.from({ length: b - a + 1 }, (_, i) => a + i);
      closeSheet();
      if (list.some(ai => sd[ai])) start(null, list, { kind: 'rev' }); else start(a);
      return true;
    }
    const wk = e.target.closest('[data-rc-weaks]');
    if (wk) { const x = +wk.dataset.rcWeaks, list = weakAyas().filter(ai => R.ayas[ai][0] === x); if (list.length) { closeSheet(); start(null, list); } return true; }
    const sm = e.target.closest('[data-rc-simtop]');
    if (sm && +sm.dataset.rcSimtop > 0) { closeSheet(); openTafsir(+sm.dataset.rcSimtop, 'similar'); return true; }
    const op = e.target.closest('[data-rc-open]');
    if (op) { closeSheet(); goTo(R.ayas[R.suraStart[+op.dataset.rcOpen]][2]); return true; }
    const pf = e.target.closest('[data-rc-pf]');
    if (pf) { pf.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === pf)); pickFilter(); return true; }
    const one = e.target.closest('[data-rc-start]');
    if (one) { e.stopPropagation(); closeSheet(); start(+one.dataset.rcStart); return true; }
    if (e.target.closest('[data-rc-resume]')) { closeSheet(); start(resumeAya()); return true; }
    const from = e.target.closest('[data-rc-from]');
    if (from) { e.stopPropagation(); closeSheet(); start(+from.dataset.rcFrom); return true; }
    if (e.target.closest('[data-rc-find]')) { closeSheet(); if (!G && !F) find(); return true; }
    // the plan's: today's new ayas, a surah's revision, the ayas a day, the surah chosen
    if (e.target.closest('[data-rc-new]')) {
      const pl = planInfo(log());
      if (pl && !pl.finished) { closeSheet(); start(null, pl.portion.length ? pl.portion : [pl.a0], { kind: 'new' }); }
      return true;
    }
    const rv = e.target.closest('[data-rc-rev]');
    if (rv) { const list = memorized(log(), +rv.dataset.rcRev); if (list.length) { closeSheet(); start(null, list, { kind: 'rev' }); } return true; }
    const per = e.target.closest('[data-rc-per]');
    if (per) { const p = store.get(planKey(), null); if (p) { store.set(planKey(), { ...p, per: +per.dataset.rcPer }); renderSheet(); } return true; }
    const pk = e.target.closest('[data-rc-plan]');
    if (pk) { setPlan(+pk.dataset.rcPlan); return true; }
    // (a page of its own over the panel, or back to it)
    const vw = e.target.closest('[data-rc-view]');
    if (vw) { suraEdit = null; store.set('recite.view', vw.dataset.rcView); renderSheet(); $('#sheetBody').scrollTop = 0; haptic(5); return true; }
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

  // going on after a pause: if the model was let go meanwhile (Mu's idle unload), or the microphone
  // or an update needs seeing to, the steps first, on their screen
  $('#recToggle').onclick = () => {
    if (G?.run) return pause();
    const g = G;
    if (MU() && g && !g.done) return withModel(() => { if (G === g) resume(); }, {});
    resume();
  };
  $('#recHide').onclick = () => {
    if (!G) return;
    G.hide = !G.hide;
    store.set('recite.hide', G.hide);
    paint(); paintBar();
  };
  // a fast reading (hadr), turned on or off at any moment; what is said from then on is judged so
  $('#recFast').onclick = () => {
    if (!G) return;
    G.ownAt = Date.now();
    setFast(!fast(), !fast() ? 'القراءة السريعة: بلا فحص للمدّ والغنّة' : 'عاد الفحص الكامل');
  };
  $('#recStop').onclick = () => { if (!G) return; if (G.pos) finish(); else cancel(); };
  // the settings, the session paused while they are changed (resumed from the bar)
  $('#recSet').onclick = () => { if (G?.run) pause(); openReciteSettings(); };

  $('#recWord').addEventListener('click', e => {
    const b = e.target.closest('[data-rw]');
    if (!b || !G?.tap) return;
    const { k, el, aya } = G.tap;
    if (b.dataset.rw === 'say') { if (el) speakWord(el); }
    if (G.walk) {
      // (going through them at the end: on to the next; the cross, straight to the summary)
      if (b.dataset.rw === 'gone') { for (let i = 0; i < (aya != null ? G.words[k].of : 1); i++) G.gone.add(k + i); paint(); toast('أُزيلت من الأخطاء'); }
      if (b.dataset.rw === 'gone' || b.dataset.rw === 'next') walk(G.walkI + 1);
      if (b.dataset.rw === 'close') walk(G.walk.length);
      if (b.dataset.rw !== 'copy') return;
    }
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
      // no room for it: said before the download, not after it (a phone nearly full)
      const noRoom = 'لا مساحة كافية على الهاتف للنموذج — أفرغ بعض المساحة ثم أعد المحاولة';
      const free = await Mu.room();
      if (free != null && free < Mu.mb() * 1.3 && !(await Mu.saved())) { toast(noRoom, 4500); return; }
      Mu.keepFiles();
      paintDl(0);
      Promise.all([Mu.load(paintDl), Mu.sounds()]).then(() => {
        hide($('#recIntro'));
        paintDl();
        toast('نُزّل النموذج، ويعمل الآن دون إنترنت');
        const f = pending;
        pending = null;
        f?.();
      }, e => { paintDl(); /quota/i.test(e?.message || '') ? toast(noRoom, 4500) : toast('تعذر التنزيل — تحقق من الاتصال'); });
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
  $('#rdNext').onclick = () => {
    const g = G;
    if (!g || g.next == null) return;
    const next = g.next;
    closeDone();
    start(next);
  };
  $('#rdAgain').onclick = () => {
    const g = G;
    if (!g) return;
    const bad = [...new Set(liveErrs().map(k => g.words[k].ai))];
    closeDone();
    if (bad.length) start(null, bad);
    else start(Math.min(g.words[g.pos - 1].ai + 1, R.ayas.length - 1));
  };

  syncBubble();

  return { start, cancel, paint, onTap, card, suraCard, showWord, prepResume, wordStats, resetWord, ago, restore, syncBubble, mic, panelHTML, mounted, onSheetClick, active: () => !!G, _g: () => G };
})();
