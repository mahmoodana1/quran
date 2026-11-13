'use strict';

// الحفظ: learning new ayas the way memorizers do, on one page. A lesson (a few
// ayas of a surah, chosen and changed at will) goes through four steps: listen
// to it over and over, repeat after the reciter in the pauses he leaves, link
// the ayas one to the next, then recite it with the words hidden (Recite). Once
// memorized it is marked so (the same record التسميع keeps, recite.<riwaya>.said)
// and the next ayas become the lesson. Below it, today's revision: what was
// memorized in the last week (السبقي), and a share of the rest, all of it gone
// over every few days (المنزل).
//
// store: hifz.<riwaya> = { a, b } the lesson (first and last aya); hifz.o = how
// to repeat; hifz.day = the steps done today, and of which lesson.
// Uses (app.js): R, META, S, store, ar, esc, suraName, ayaLabel, pageInfo, playDrill,
// stopAudio, renderSheet, dismissSheet, closeSheet, openSheet, goTo, flashAya, toast, haptic, Recite.

const Hifz = (() => {
  const DEF = { each: 5, whole: 2, gap: 1, rate: 1, hide: true, days: 7 };
  const opts = () => { const o = { ...DEF, ...store.get('hifz.o', {}) }; if (o.whole >= 1e9) o.whole = Infinity; return o; };
  const setOpt = (k, v) => store.set('hifz.o', { ...store.get('hifz.o', {}), [k]: v });
  const today = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const dayNo = () => { const d = new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); };
  const log = () => store.get('recite.' + R.id, { ayas: {}, sessions: [] });
  const sizeOf = s => (R.suraStart[s + 1] ?? R.ayas.length) - R.suraStart[s];
  const ayaN = n => n === 1 ? 'آية واحدة' : n === 2 ? 'آيتان' : n <= 10 ? `${ar(n)} آيات` : `${ar(n)} آية`;
  const times = n => n === Infinity ? 'بلا توقف' : n === 1 ? 'مرة' : n === 2 ? 'مرتين' : n <= 10 ? `${ar(n)} مرات` : `${ar(n)} مرة`;
  let view = '';

  // ---- the lesson
  function lesson() {
    const L = store.get('hifz.' + R.id, null);
    if (L && R.ayas[L.a] && R.ayas[L.b] && L.a <= L.b && R.ayas[L.a][0] === R.ayas[L.b][0]) return L;
    // none yet: today's portion of the plan in التسميع, else the page being read
    const said = log().said || {}, plan = store.get('recite.plan.' + R.id, null);
    if (plan && R.suraStart[plan.s] != null) {
      const a0 = R.suraStart[plan.s], n = sizeOf(plan.s);
      for (let a = a0; a < a0 + n; a++) if (!said[a]) return { a, b: Math.min(a0 + n - 1, a + (plan.per || 5) - 1) };
    }
    return span(pageInfo(S.page).first, 5);
  }
  // n ayas from a, not past its surah
  function span(a, n) {
    const s = R.ayas[a][0], end = R.suraStart[s] + sizeOf(s) - 1;
    return { a, b: Math.min(end, a + n - 1) };
  }
  const setLesson = L => store.set('hifz.' + R.id, { a: L.a, b: L.b });
  const listOf = L => Array.from({ length: L.b - L.a + 1 }, (_, i) => L.a + i);
  const lessonKey = L => `${R.id}:${L.a}-${L.b}`;
  const rangeText = L => `${suraName(R.ayas[L.a][0])} ${ar(R.ayas[L.a][1])}${L.b > L.a ? '–' + ar(R.ayas[L.b][1]) : ''}`;

  // steps done today, of this lesson
  function stepsDone(L) {
    const d = store.get('hifz.day', null);
    return d && d.d === today() && d.k === lessonKey(L) ? d.s : {};
  }
  function markStep(L, k) {
    const s = { ...stepsDone(L), [k]: 1 };
    store.set('hifz.day', { d: today(), k: lessonKey(L), s });
    if (!$('#sheet').hidden && tab === 'hifz') renderSheet();
  }

  // ---- revision: memorized in the last 7 days (السبقي), and the rest in `days` shares, one a day (المنزل)
  function review(L) {
    const l = log(), said = l.said || {}, first = l.first || {}, week = Date.now() - 7 * 864e5;
    const near = [], far = [];
    for (const k of Object.keys(said)) {
      const ai = +k;
      if (!R.ayas[ai] || (ai >= L.a && ai <= L.b)) continue;
      const t = first[k] > 1e9 ? first[k] : said[k];
      (t >= week && first[k] !== 1 ? near : far).push(ai);
    }
    near.sort((x, y) => x - y); far.sort((x, y) => x - y);
    const days = Math.max(1, Math.min(opts().days, far.length || 1)), i = dayNo() % days;
    const per = Math.ceil(far.length / days), part = far.slice(i * per, (i + 1) * per);
    return { near, far, part, i, days };
  }
  const listText = list => list.length ? `${ayaLabel(list[0])}${list.length > 1 ? ` – ${R.ayas[list.at(-1)][0] === R.ayas[list[0]][0] ? ar(R.ayas[list.at(-1)][1]) : ayaLabel(list.at(-1))}` : ''}` : '';

  // ---- the page
  const IC = {
    edit: '<svg viewBox="0 0 24 24"><path d="M14.5 5.5l4 4M4.5 19.5l1-4.5L15.8 4.7a1.5 1.5 0 012.1 0l1.4 1.4a1.5 1.5 0 010 2.1L9 18.5z"/></svg>',
    listen: '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3.5" y="13.5" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="13.5" width="4" height="6.5" rx="1.5"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M17 3.5l3 3-3 3"/><path d="M4 11.5v-1a4 4 0 014-4h12M7 20.5l-3-3 3-3"/><path d="M20 12.5v1a4 4 0 01-4 4H4"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><path d="M12 3.5a3 3 0 00-3 3v5a3 3 0 006 0v-5a3 3 0 00-3-3zM6.5 11a5.5 5.5 0 0011 0M12 16.5v4"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8.5 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/></svg>',
    tune: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  };

  function panelHTML() {
    if (view === 'edit') return editHTML();
    const L = lesson(), o = opts(), list = listOf(L), said = log().said || {};
    const done = stepsDone(L), have = list.filter(a => said[a]).length, all = have === list.length;
    const s = R.ayas[L.a][0], words = list.reduce((t, a) => t + R.text[a].split(' ').length - 1, 0);
    const steps = [
      ['listen', IC.listen, 'استمع', o.each > 1 ? `كل آية ${times(o.each)}، ثم الدرس ${times(o.whole)}` : `الدرس ${times(o.whole)}`],
      ['repeat', IC.repeat, 'ردّد', 'يقرأ القارئ الآية ويسكت لتعيدها بعده'],
      ['link', IC.link, 'اربط', 'آية، ثم من الأولى إليها، حتى يتصل الدرس'],
      ['recite', IC.mic, 'سمّع', o.hide ? 'من حفظك والكلمات مخفية، والتطبيق يتابعك' : 'من حفظك، والتطبيق يتابعك'],
    ];
    const rv = review(L);
    let h = `<div class="hz">
      <section class="hz-lesson">
        <div class="hz-l-top"><small>درسك</small><button class="hz-edit" data-hz-view="edit" aria-label="غيّر الدرس">${IC.edit}<span>غيّر</span></button></div>
        <b class="hz-l-name">${rangeText(L)}</b>
        <span class="hz-l-sub">${ayaN(list.length)} · ${ar(words)} كلمة · صفحة ${ar(R.ayas[L.a][2])}${R.ayas[L.b][2] !== R.ayas[L.a][2] ? '–' + ar(R.ayas[L.b][2]) : ''}${have ? ` · حفظت ${ar(have)} منها` : ''}</span>
        <button class="hz-show" data-hz-show>${IC.book}<span>اعرضه في المصحف</span></button>
      </section>
      <ol class="hz-steps">${steps.map(([k, ic, t, sub], i) => {
        const ok = k === 'recite' ? all : done[k];
        return `<li><button class="hz-step${ok ? ' ok' : ''}" data-hz-go="${k}"><span class="hz-n">${ok ? IC.check : ar(i + 1)}</span>
          <span class="hz-st"><b>${t}</b><small>${sub}</small></span><span class="hz-ic">${ic}</span></button></li>`;
      }).join('')}</ol>
      <button class="hz-done${all ? ' ok' : ''}" data-hz-memo>${all ? 'حفظتَه، ما شاء الله — إلى الدرس التالي' : 'حفظتُ هذا الدرس — إلى التالي'}</button>

      <details class="hz-opts"${store.get('hifz.open', false) ? ' open' : ''}><summary>${IC.tune}<span><b>طريقة التكرار</b><small>${o.each > 1 ? `الآية ${times(o.each)}` : 'بلا تكرار للآية'} · الدرس ${times(o.whole)} · ${o.rate === 1 ? 'سرعة عادية' : `سرعة ${ar(o.rate).replace('.', '٫')}×`}</small></span></summary>
        ${chips('each', 'تكرار كل آية', [[1, '١'], [3, '٣'], [5, '٥'], [7, '٧'], [10, '١٠'], [20, '٢٠']], o.each)}
        ${chips('whole', 'تكرار الدرس كله', [[1, '١'], [2, '٢'], [3, '٣'], [5, '٥'], [0, '∞']], o.whole === Infinity ? 0 : o.whole)}
        ${chips('gap', 'مهلة الترديد بعد كل آية', [[0.5, 'نصفها'], [1, 'مثلها'], [1.5, 'مرة ونصف'], [2, 'ضعفها']], o.gap)}
        ${chips('rate', 'سرعة التلاوة', [[0.75, 'أبطأ'], [1, 'عادية'], [1.25, 'أسرع']], o.rate)}
        ${chips('days', 'تُراجَع محفوظاتك القديمة كلها كل', [[3, '٣ أيام'], [5, '٥'], [7, '٧'], [10, '١٠'], [14, '١٤'], [30, '٣٠']], o.days)}
        <button class="hz-sw rc-set" data-hz-hide role="switch" aria-checked="${o.hide}"><span>إخفاء الكلمات عند التسميع</span><span class="tog${o.hide ? ' on' : ''}"><i></i></span></button>
      </details>

      <div class="pp-h hz-h"><b>مراجعة اليوم</b><small>بلا مراجعة يتفلّت الحفظ</small></div>`;
    if (!rv.near.length && !rv.far.length) h += `<p class="hz-empty">ما تحفظه يُراجَع هنا: القريب منه كل يوم، والقديم جزءًا جزءًا حتى يُختم كل ${ar(o.days)} أيام.</p>`;
    else h += `<div class="group hz-rev">
        ${revRow('near', 'القريب', rv.near.length ? `ما حفظته هذا الأسبوع · ${ayaN(rv.near.length)}` : 'لا جديد هذا الأسبوع', rv.near)}
        ${revRow('far', 'المنزل', rv.part.length ? `${listText(rv.part)} · ${ayaN(rv.part.length)}${rv.days > 1 ? ` · ${ar(rv.i + 1)} من ${ar(rv.days)}` : ''}` : 'لا قديم بعد', rv.part)}
      </div>`;
    h += `<button class="hz-more" data-hz-recite>خطة الحفظ، وتقدّمك، ومواضع ضعفك في التسميع ${IC.back.replace('M9.5 6l6 6-6 6', 'M14.5 6l-6 6 6 6')}</button></div>`;
    return h;
  }
  function chips(k, label, list, cur) {
    return `<div class="hz-o"><span>${label}</span><div class="hz-chips">${list.map(([v, t]) =>
      `<button data-hz-opt="${k}" data-v="${v}" class="${v === cur ? 'on' : ''}">${t}</button>`).join('')}</div></div>`;
  }
  function revRow(k, t, sub, list) {
    return `<div class="row hz-rr"><span class="hz-rk ${k}">${t}</span><span class="main"><span class="s">${sub}</span></span>
      ${list.length ? `<button class="hz-rb" data-hz-rev="${k}" data-how="play" aria-label="استمع">${IC.play}</button><button class="hz-rb" data-hz-rev="${k}" data-how="recite" aria-label="سمّع">${IC.mic}</button>` : ''}</div>`;
  }

  // ---- changing the lesson: its surah, first and last aya, or a quick pick
  function editHTML() {
    const L = lesson(), s = R.ayas[L.a][0], a0 = R.suraStart[s], n = sizeOf(s), list = listOf(L);
    const opt = META.suras.map((x, i) => `<option value="${i + 1}"${i + 1 === s ? ' selected' : ''}>${ar(i + 1)}. ${x[0]}</option>`).join('');
    const stepper = (k, v, lab) => `<div class="hz-stp"><span>${lab}</span><div><button data-hz-step="${k}" data-d="1" aria-label="زد">+</button><b>${ar(v)}</b><button data-hz-step="${k}" data-d="-1" aria-label="أنقص">−</button></div></div>`;
    return `<div class="pp pp-sub"><div class="pp-bar"><button class="pp-back" data-hz-view="" aria-label="رجوع">${IC.back}</button><b>الدرس</b></div>
      <div class="pp-subb hz-ed">
        <label class="hz-sel"><span>السورة</span><select data-hz-sura>${opt}</select></label>
        <div class="hz-stps">${stepper('a', L.a - a0 + 1, 'من الآية')}${stepper('b', L.b - a0 + 1, 'إلى الآية')}</div>
        <div class="hz-o"><span>أو اختر سريعًا</span><div class="hz-chips">
          <button data-hz-quick="page">الصفحة التي تقرؤها</button>
          <button data-hz-quick="next">الآيات التالية</button>
          ${[3, 5, 7, 10].map(k => `<button data-hz-len="${k}" class="${list.length === k ? 'on' : ''}">${ayaN(k)}</button>`).join('')}
          <button data-hz-len="${n}" class="${list.length === n ? 'on' : ''}">السورة كلها</button>
        </div></div>
        <div class="hz-text" style="font-family:${R.font}">${list.slice(0, 40).map(a => esc(R.text[a])).join(' ')}${list.length > 40 ? ' …' : ''}</div>
        <button class="hz-done" data-hz-view="">تم</button>
      </div></div>`;
  }

  function play(list, o, then) { dismissSheet(); playDrill(list, o, then); }

  function onClick(e) {
    const t = e.target;
    const v = t.closest('[data-hz-view]');
    if (v) { view = v.dataset.hzView; renderSheet(); $('#sheetBody').scrollTop = 0; haptic(5); return true; }
    const L = lesson(), o = opts(), list = listOf(L);
    const go = t.closest('[data-hz-go]');
    if (go) {
      const k = go.dataset.hzGo;
      if (k === 'listen') play(list, { each: o.each, whole: o.whole, rate: o.rate }, () => markStep(L, 'listen'));
      else if (k === 'repeat') play(list, { each: Math.min(o.each, 3), whole: o.each > 1 ? 0 : 1, gap: o.gap, rate: o.rate }, () => markStep(L, 'repeat'));
      else if (k === 'link') play(list, { link: true, each: Math.min(o.each, 3), rate: o.rate }, () => markStep(L, 'link'));
      else if (k === 'recite') { stopAudio(); closeSheet(); Recite.start(null, list, { kind: 'new', hide: o.hide }); }
      haptic(8);
      return true;
    }
    if (t.closest('[data-hz-show]')) { dismissSheet(); goTo(R.ayas[L.a][2]); setTimeout(() => flashAya(L.a), 250); return true; }
    if (t.closest('[data-hz-memo]')) {
      const l = log();
      l.said ||= {}; l.first ||= {};
      for (const a of list) if (!l.said[a]) { l.said[a] = Date.now(); l.first[a] = Date.now(); }
      store.set('recite.' + R.id, l);
      setLesson(nextLesson(L));
      toast('بارك الله لك — هذا درسك التالي');
      haptic([10, 40, 10]);
      renderSheet();
      return true;
    }
    const op = t.closest('[data-hz-opt]');
    if (op) {
      let val = +op.dataset.v;
      if (op.dataset.hzOpt === 'whole' && !val) val = Infinity;
      setOpt(op.dataset.hzOpt, val === Infinity ? 1e9 : val);
      renderSheet(); haptic(5);
      return true;
    }
    if (t.closest('[data-hz-hide]')) { setOpt('hide', !o.hide); renderSheet(); return true; }
    const rv = t.closest('[data-hz-rev]');
    if (rv) {
      const r = review(L), l2 = rv.dataset.hzRev === 'near' ? r.near : r.part;
      if (rv.dataset.how === 'play') play(l2, { rate: o.rate });
      else { stopAudio(); closeSheet(); Recite.start(null, l2, { kind: 'rev', hide: o.hide }); }
      return true;
    }
    if (t.closest('[data-hz-recite]')) { openSheet('recite'); return true; }
    // the lesson's page
    const st = t.closest('[data-hz-step]');
    if (st) {
      const s = R.ayas[L.a][0], a0 = R.suraStart[s], end = a0 + sizeOf(s) - 1, d = +st.dataset.d;
      const N = { ...L };
      if (st.dataset.hzStep === 'a') { N.a = Math.max(a0, Math.min(end, L.a + d)); N.b = Math.max(N.a, N.b); }
      else { N.b = Math.max(a0, Math.min(end, L.b + d)); N.a = Math.min(N.a, N.b); }
      setLesson(N); renderSheet(); haptic(4);
      return true;
    }
    const q = t.closest('[data-hz-quick]');
    if (q) {
      if (q.dataset.hzQuick === 'page') {
        const pi = pageInfo(S.page), s = R.ayas[pi.first][0];
        let b = pi.first;
        while (b + 1 < R.ayas.length && R.ayas[b + 1][2] === S.page && R.ayas[b + 1][0] === s) b++;
        setLesson({ a: pi.first, b });
      } else setLesson(nextLesson(L));
      renderSheet(); haptic(5);
      return true;
    }
    const ln = t.closest('[data-hz-len]');
    if (ln) {
      const n = +ln.dataset.hzLen, s = R.ayas[L.a][0];
      setLesson(n >= sizeOf(s) ? { a: R.suraStart[s], b: R.suraStart[s] + sizeOf(s) - 1 } : span(L.a, n));
      renderSheet(); haptic(5);
      return true;
    }
    return false;
  }
  // as many ayas after this lesson, in its surah (or the next surah from its start)
  function nextLesson(L) {
    const n = L.b - L.a + 1, s = R.ayas[L.a][0], end = R.suraStart[s] + sizeOf(s) - 1;
    if (L.b < end) return span(L.b + 1, n);
    return s < 114 ? span(R.suraStart[s + 1], n) : L;
  }
  function onChange(e) {
    const sel = e.target.closest('[data-hz-sura]');
    if (!sel) return false;
    const L = lesson(), n = Math.min(L.b - L.a + 1, 10);
    setLesson(span(R.suraStart[+sel.value], n));
    renderSheet();
    return true;
  }
  // (the open/closed state of the options)
  function mounted() {
    const d = $('.hz-opts');
    if (d) d.addEventListener('toggle', () => store.set('hifz.open', d.open));
  }
  const reset = () => { view = ''; };

  return { panelHTML, onClick, onChange, mounted, reset };
})();
