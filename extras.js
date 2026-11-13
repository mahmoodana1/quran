'use strict';

// The day-to-day around the mushaf: keeping the reader's data safe (a reminder to back up or sync),
// reminders in the phone's own calendar (the day's memorizing; the prayer times, a month at a time),
// a note when a prayer comes in with the app open, the Hijri calendar and its days, the misbaha, and
// the first-run tour. Logic is in plan.js; uses (app.js) $, store, ar, esc, toast, haptic, show,
// hide, openSheet, renderSheet, saveBackup, KH, pagesRead, bookmarks; Prayer, Sync, Plan.

const Extras = (() => {
  const APP = location.origin + location.pathname;
  const DAY = 864e5;

  // ---------------------------------------------------------------- data safety
  // something worth losing: an aya memorized or recited, pages read, a bookmark
  function hasProgress() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^q\.recite\.[a-z]+$/.test(k) && /"said":\{"\d/.test(localStorage.getItem(k) || '')) return true;
      }
      return KH.some(k => pagesRead(k) >= 5) || bookmarks().length > 0;
    } catch { return false; }
  }
  const synced = () => typeof Sync !== 'undefined' && Sync.signedIn();
  function atRisk() {
    if (synced() || !hasProgress()) return false;
    const now = Date.now();
    return now - store.get('backup.at', 0) > 14 * DAY && now > store.get('backup.snooze', 0);
  }
  function safetyHTML() {
    if (!atRisk()) return '';
    const at = store.get('backup.at', 0);
    return `<div class="xs-safe" role="note"><b>تقدّمك محفوظ على هذا الجهاز وحده</b>
      <small>${at ? `آخر نسخة احتياطية قبل ${ar(Math.floor((Date.now() - at) / DAY))} يومًا. ` : ''}إن مُسحت بيانات المتصفح أو حُذف التطبيق ضاع حفظك وختماتك. فعّل المزامنة، أو احفظ نسخة في ملف.</small>
      <div class="xs-acts"><button data-xs="sync" class="on">فعّل المزامنة</button><button data-xs="backup">احفظ نسخة</button><button data-xs="later">لاحقًا</button></div></div>`;
  }
  // under «بياناتك» in the settings
  function dataLineHTML() {
    const at = store.get('backup.at', 0);
    const s = synced() ? 'المزامنة مفعّلة: بياناتك محفوظة في حسابك أيضًا' : 'المزامنة غير مفعّلة: بياناتك على هذا الجهاز وحده';
    return `<p class="note xs-line">${s} · ${at ? `آخر نسخة احتياطية: ${new Date(at).toLocaleDateString('ar-u-nu-arab')}` : 'لم تحفظ نسخة احتياطية بعد'}</p>`;
  }

  // ---------------------------------------------------------------- calendar reminders
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // a calendar file handed to the phone: Safari on iOS shows "Add all" for text/calendar
  async function deliver(text, name) {
    const file = new File([text], name, { type: 'text/calendar' });
    if (isIOS()) {
      const a = document.createElement('a');
      a.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text);
      a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    try { if (navigator.canShare?.({ files: [file] }) && /Android/.test(navigator.userAgent)) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function hifzICS(time) {
    const [h, m] = time.split(':').map(Number), d = new Date();
    d.setHours(h, m, 0, 0);
    if (d < new Date()) d.setDate(d.getDate() + 1);
    return Plan.ics([{ uid: 'hifz-daily@quran-app', start: d, mins: 30, daily: true, alarm: 0, url: APP,
      title: 'وِرد الحفظ والمراجعة', desc: `درس اليوم ومراجعته في تطبيق القرآن: ${APP}` }], 'الحفظ');
  }
  function prayerICS(n, before) {
    const { place, days } = Prayer.upcoming(n), ev = [];
    for (const { ymd, times } of days) for (const k of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      if (!times[k]) continue;
      ev.push({ uid: `pr-${ymd.join('')}-${k}@quran-app`, start: times[k], mins: 15, alarm: before, title: `صلاة ${Prayer.NAMES[k]}`, desc: place.name || '' });
    }
    return Plan.ics(ev, 'مواقيت الصلاة');
  }
  function remindRowHTML(kind) {
    if (kind === 'hifz') {
      const t = store.get('remind.hifz', '20:00'), at = store.get('remind.hifz.at', 0);
      return `<div class="pp-h hz-h"><b>التذكير</b><small>في تقويم جهازك، يصلك ولو كان التطبيق مغلقًا</small></div>
        <div class="group xs-rem"><label class="row"><span class="main"><span class="t">تذكير يومي بالحفظ والمراجعة</span>
          <span class="s">${at ? 'أُضيف إلى تقويمك؛ أضفه ثانيةً إن غيّرت الوقت' : 'كل يوم في الوقت الذي تختاره'}</span></span>
          <input type="time" value="${t}" data-xs-time="hifz"></label>
          <button class="row xs-go" data-xs="cal-hifz"><span class="main"><span class="t">أضِفه إلى التقويم</span></span></button></div>`;
    }
    const b = store.get('remind.pray.before', 0), on = store.get('pray.alert', false);
    return `<div class="group-label">التنبيه بالصلاة</div>
      <div class="group xs-rem">
        <button class="row" data-xs="cal-pray"><span class="main"><span class="t">أضف المواقيت إلى تقويم جهازك</span>
          <span class="s">٣٠ يومًا من الصلوات الخمس، بتنبيه ${b ? `قبل كل صلاة بـ${ar(b)} دقائق` : 'عند دخول الوقت'} — يصلك والتطبيق مغلق. أضفها ثانيةً كل شهر أو إن غيّرت موقعك.</span></span></button>
        <div class="row xs-ch"><span class="main"><span class="t">التنبيه</span></span>${[[0, 'عند الوقت'], [5, 'قبل ٥ د'], [10, 'قبل ١٠ د']].map(([v, l]) => `<button data-xs-before="${v}" class="${b === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <button class="row rc-set" data-xs="alert" role="switch" aria-checked="${on}"><span class="main"><span class="t">تنبيه داخل التطبيق</span>
          <span class="s">إشعار عند دخول الوقت ما دام التطبيق مفتوحًا</span></span><span class="tog${on ? ' on' : ''}"><i></i></span></button>
      </div>`;
  }

  // a prayer come in while the app is open
  let watchT = 0;
  function watch() {
    clearInterval(watchT);
    if (!store.get('pray.alert', false) || typeof Prayer === 'undefined') return;
    const check = () => {
      const now = Date.now(), last = store.get('pray.alerted', 0);
      for (const { times } of Prayer.upcoming(1).days) for (const k of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
        const t = times[k]?.getTime();
        if (!t || t > now || now - t > 10 * 6e4 || t <= last) continue;
        store.set('pray.alerted', t);
        const text = `حان الآن وقت صلاة ${Prayer.NAMES[k]}`;
        toast(text, 6000);
        haptic([30, 80, 30]);
        if (window.Notification?.permission === 'granted') navigator.serviceWorker?.ready.then(r => r.showNotification('الصلاة', { body: text, tag: 'prayer', icon: 'icons/icon-192.png' })).catch(() => {});
      }
    };
    check();
    watchT = setInterval(check, 30000);
  }

  // ---------------------------------------------------------------- the Hijri calendar
  function calendarHTML() {
    let m, occ;
    try { m = Plan.month(); occ = Plan.occasions().slice(0, 5); } catch { return ''; }
    const lead = m.days[0].wd, wd = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
    const cells = Array(lead).fill('<i></i>').join('') + m.days.map(d =>
      `<i class="${d.today ? 'now' : ''}${d.occ ? ' occ' : ''}${d.wd === 1 || d.wd === 4 ? ' fast' : ''}" title="${esc(d.occ)}"><b>${ar(d.d)}</b><small>${ar(d.g)}</small></i>`).join('');
    const gfmt = new Intl.DateTimeFormat('ar-u-nu-arab', { day: 'numeric', month: 'long' });
    const when = n => n === 0 ? 'اليوم' : n === 1 ? 'غدًا' : n === 2 ? 'بعد يومين' : `بعد ${ar(n)} ${n <= 10 ? 'أيام' : 'يومًا'}`;
    return `<div class="group-label">التقويم الهجري</div>
      <div class="group xs-cal"><div class="xs-cal-h"><b>${m.name} ${ar(m.y)}</b><small>أم القرى</small></div>
        <div class="xs-grid">${wd.map(x => `<span>${x}</span>`).join('')}${cells}</div>
        <div class="xs-cal-k"><span><i class="occ"></i>مناسبة</span><span><i class="fast"></i>صيام الإثنين والخميس</span></div></div>
      <div class="group xs-occ">${occ.map(o => `<div class="row"><span class="main"><span class="t">${o.name}</span><span class="s">${o.h.d ? `${ar(o.h.d)} ${Plan.MONTHS[o.h.m - 1]} · ${gfmt.format(o.t)}` : ''}${o.sub ? ` · ${o.sub}` : ''}</span></span><span class="when">${when(o.in)}</span></div>`).join('')}</div>
      <p class="note">قد يختلف أول الشهر يومًا عن رؤية الهلال في بلدك.</p>`;
  }

  // ---------------------------------------------------------------- the misbaha
  const DHIKR = ['سبحان الله', 'الحمد لله', 'الله أكبر', 'لا إله إلا الله', 'أستغفر الله', 'سبحان الله وبحمده', 'لا حول ولا قوة إلا بالله', 'اللهم صلِّ على محمد'];
  const ms = () => {
    const m = { i: 0, target: 33, n: 0, d: '', today: 0, ...store.get('misbaha', {}) };
    if (m.d !== Plan.dayKey()) { m.d = Plan.dayKey(); m.today = 0; }
    return m;
  };
  function misbahaRowHTML() {
    const m = ms();
    return `<div class="group xs-mrow"><button class="row" data-xs="misbaha"><span class="xs-bead"></span><span class="main"><span class="t">المسبحة</span>
      <span class="s">${m.today ? `سبّحت اليوم ${ar(m.today)} مرة` : 'عدّاد للتسبيح والاستغفار، بلمسة واحدة'}</span></span></button></div>`;
  }
  function paintMisbaha() {
    const m = ms(), el = $('#misbaha');
    el.querySelector('.xs-dk').innerHTML = DHIKR.map((t, i) => `<button data-ms-i="${i}" class="${i === m.i ? 'on' : ''}">${t}</button>`).join('');
    el.querySelector('.xs-tg').innerHTML = [33, 99, 100, 0].map(v => `<button data-ms-t="${v}" class="${v === m.target ? 'on' : ''}">${v ? ar(v) : '∞'}</button>`).join('');
    el.querySelector('.xs-word').textContent = DHIKR[m.i];
    el.querySelector('.xs-n').textContent = ar(m.n);
    el.querySelector('.xs-of').textContent = m.target ? `من ${ar(m.target)}` : '';
    el.querySelector('.xs-today').textContent = `اليوم: ${ar(m.today)}`;
    const ring = el.querySelector('.xs-ring circle:last-child');
    ring.style.strokeDashoffset = m.target ? 597 * (1 - (m.n % m.target || (m.n ? m.target : 0)) / m.target) : 597 * (1 - (m.n % 100) / 100);
  }
  function openMisbaha() {
    let el = $('#misbaha');
    if (!el) {
      el = document.createElement('section');
      el.id = 'misbaha'; el.className = 'xs-ms'; el.hidden = true;
      el.innerHTML = `<div class="xs-ms-top"><button data-ms="close" aria-label="إغلاق">✕</button><b>المسبحة</b><button data-ms="reset">صفّر</button></div>
        <div class="xs-dk"></div>
        <button class="xs-tap" data-ms="tap" aria-label="سبّح"><svg class="xs-ring" viewBox="0 0 200 200"><circle cx="100" cy="100" r="95"/><circle cx="100" cy="100" r="95"/></svg>
          <span class="xs-word"></span><span class="xs-n"></span><span class="xs-of"></span></button>
        <div class="xs-tg"></div><small class="xs-today"></small>`;
      document.body.appendChild(el);
      el.addEventListener('pointerdown', e => {
        const tap = e.target.closest('[data-ms="tap"]');
        if (!tap) return;
        e.preventDefault();
        const m = ms();
        m.n++; m.today++;
        const hit = m.target && m.n % m.target === 0;
        haptic(hit ? [40, 60, 40] : 6);
        if (hit) toast(`أتممت ${ar(m.target)} — ${DHIKR[m.i]}`);
        store.set('misbaha', m);
        paintMisbaha();
      });
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-ms],[data-ms-i],[data-ms-t]');
        if (!b || b.dataset.ms === 'tap') return;
        const m = ms();
        if (b.dataset.ms === 'close') { hide(el); return; }
        if (b.dataset.ms === 'reset') m.n = 0;
        if (b.dataset.msI != null) { m.i = +b.dataset.msI; m.n = 0; }
        if (b.dataset.msT != null) { m.target = +b.dataset.msT; m.n = 0; }
        store.set('misbaha', m); paintMisbaha(); haptic(5);
      });
    }
    paintMisbaha();
    show(el);
  }

  // ---------------------------------------------------------------- the tour
  const TOUR = [
    ['المصحف', 'اسحب يمينًا ويسارًا لتقليب الصفحات. اضغط على رقم آية لبطاقتها: التفسير، والاستماع منها، والعلامة، والآيات المتشابهة.'],
    ['الكلمة', 'اضغط مطوّلًا على كلمة لمعناها من كتب غريب القرآن، وجذرها وإعرابها.'],
    ['السورة', 'اضغط على شريط اسم السورة: «عن السورة» (مقاصدها وفضلها وموضوعاتها)، والاستماع لها، و«احفظها».'],
    ['الحفظ', 'في لوحة «الحفظ»: درسك في أربع خطوات — استمع، ردّد، اربط، ثم سمّع من حفظك والتطبيق يتابعك ويُنبّهك على الخطأ. ومراجعتك كل يوم: الجديد، وصفحات من القديم، وما أخطأت فيه يعود أسرع.'],
    ['البحث واللوحات', 'من زر اللوحات: السور والأجزاء، والعلامات والختمات، والأذكار والمسبحة، ومواقيت الصلاة والقبلة والتقويم الهجري. والبحث في أعلاها يجد السورة والآية والصفحة والذكر والإعداد.'],
    ['احفظ تقدّمك', 'بياناتك على جهازك. فعّل «المزامنة» في الإعدادات لتبقى في حسابك وتنتقل معك إلى أجهزتك، أو احفظ نسخة احتياطية في ملف.'],
  ];
  let tourI = 0;
  function paintTour() {
    const el = $('#tour'), [t, d] = TOUR[tourI];
    el.querySelector('h2').textContent = t;
    el.querySelector('p').textContent = d;
    el.querySelector('.xs-dots').innerHTML = TOUR.map((_, i) => `<i class="${i === tourI ? 'on' : ''}"></i>`).join('');
    el.querySelector('[data-tour="next"]').textContent = tourI === TOUR.length - 1 ? 'ابدأ' : 'التالي';
    el.querySelector('[data-tour="back"]').hidden = !tourI;
  }
  function openTour() {
    let el = $('#tour');
    if (!el) {
      el = document.createElement('section');
      el.id = 'tour'; el.className = 'modal xs-tour'; el.hidden = true;
      el.innerHTML = `<div class="card"><div class="xs-dots"></div><h2></h2><p></p>
        <div class="actions"><button class="primary" data-tour="next"></button><button data-tour="back">السابق</button></div>
        <button class="xs-skip" data-tour="skip">تخطَّ الجولة</button></div>`;
      document.body.appendChild(el);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-tour]');
        if (!b) return;
        const k = b.dataset.tour;
        if (k === 'back') tourI = Math.max(0, tourI - 1);
        else if (k === 'next' && tourI < TOUR.length - 1) tourI++;
        else { store.set('tour', 1); hide(el); return; }
        paintTour();
      });
    }
    tourI = 0;
    paintTour();
    show(el);
  }

  // ---------------------------------------------------------------- clicks (in the panels)
  function onClick(e) {
    const t = e.target;
    const x = t.closest('[data-xs]');
    if (x) {
      const k = x.dataset.xs;
      if (k === 'later') { store.set('backup.snooze', Date.now() + 7 * DAY); renderSheet(); }
      else if (k === 'backup') saveBackup();
      else if (k === 'sync') { openSheet('settings'); setTimeout(() => $('#set-data')?.scrollIntoView({ block: 'start' }), 60); }
      else if (k === 'cal-hifz') { store.set('remind.hifz.at', Date.now()); deliver(hifzICS(store.get('remind.hifz', '20:00')), 'quran-hifz.ics'); }
      else if (k === 'cal-pray') deliver(prayerICS(30, store.get('remind.pray.before', 0)), 'prayer-times.ics');
      else if (k === 'alert') {
        const on = !store.get('pray.alert', false);
        store.set('pray.alert', on);
        if (on && window.Notification?.permission === 'default') Notification.requestPermission().catch(() => {});
        x.setAttribute('aria-checked', on); x.querySelector('.tog').classList.toggle('on', on);
        watch();
      } else if (k === 'misbaha') openMisbaha();
      else if (k === 'tour') openTour();
      haptic(5);
      return true;
    }
    const bf = t.closest('[data-xs-before]');
    if (bf) { store.set('remind.pray.before', +bf.dataset.xsBefore); renderSheet(); return true; }
    return false;
  }
  function onChange(e) {
    const tm = e.target.closest('[data-xs-time]');
    if (!tm) return false;
    if (tm.value) store.set('remind.hifz', tm.value);
    return true;
  }

  // ---------------------------------------------------------------- start
  async function boot() {
    // ask the browser not to clear the data when space runs low (granted silently to a home-screen app)
    try { if (hasProgress() && navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
    watch();
    if (!store.get('tour', 0) && !new URLSearchParams(location.search).has('notour')) setTimeout(() => {
      if ([...document.querySelectorAll('.modal')].some(m => !m.hidden)) { store.set('tour', 1); return; }
      openTour();
    }, 1500);
  }

  return { safetyHTML, dataLineHTML, remindRowHTML, calendarHTML, misbahaRowHTML, openMisbaha, openTour, onClick, onChange, boot, watch, hasProgress };
})();
