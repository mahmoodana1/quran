'use strict';

// Prayer times and qibla, computed on the device (works offline).
// Uses ar(), store and toast() from app.js at call time.
const Prayer = (() => {
  const KAABA = { lat: 21.4225, lng: 39.8262 };

  // the default is Al-Aqsa; the rest are choices in the location list
  const CITIES = [
    { id: 'aqsa', name: 'المسجد الأقصى · القدس', lat: 31.7761, lng: 35.2358, tz: 'Asia/Jerusalem' },
    { id: 'makkah', name: 'مكة المكرمة', lat: 21.4225, lng: 39.8262, tz: 'Asia/Riyadh' },
    { id: 'madinah', name: 'المدينة المنورة', lat: 24.4672, lng: 39.6111, tz: 'Asia/Riyadh' },
    { id: 'gaza', name: 'غزة', lat: 31.5017, lng: 34.4668, tz: 'Asia/Gaza' },
    { id: 'amman', name: 'عمّان', lat: 31.9539, lng: 35.9106, tz: 'Asia/Amman' },
    { id: 'damascus', name: 'دمشق', lat: 33.5138, lng: 36.2765, tz: 'Asia/Damascus' },
    { id: 'beirut', name: 'بيروت', lat: 33.8938, lng: 35.5018, tz: 'Asia/Beirut' },
    { id: 'cairo', name: 'القاهرة', lat: 30.0444, lng: 31.2357, tz: 'Africa/Cairo' },
    { id: 'baghdad', name: 'بغداد', lat: 33.3152, lng: 44.3661, tz: 'Asia/Baghdad' },
    { id: 'riyadh', name: 'الرياض', lat: 24.7136, lng: 46.6753, tz: 'Asia/Riyadh' },
    { id: 'dubai', name: 'دبي', lat: 25.2048, lng: 55.2708, tz: 'Asia/Dubai' },
    { id: 'istanbul', name: 'إسطنبول', lat: 41.0082, lng: 28.9784, tz: 'Europe/Istanbul' },
    { id: 'casablanca', name: 'الدار البيضاء', lat: 33.5731, lng: -7.5898, tz: 'Africa/Casablanca' },
    { id: 'algiers', name: 'الجزائر', lat: 36.7538, lng: 3.0588, tz: 'Africa/Algiers' },
    { id: 'tunis', name: 'تونس', lat: 36.8065, lng: 10.1815, tz: 'Africa/Tunis' },
    { id: 'khartoum', name: 'الخرطوم', lat: 15.5007, lng: 32.5599, tz: 'Africa/Khartoum' },
    { id: 'karachi', name: 'كراتشي', lat: 24.8607, lng: 67.0011, tz: 'Asia/Karachi' },
    { id: 'jakarta', name: 'جاكرتا', lat: -6.2088, lng: 106.8456, tz: 'Asia/Jakarta' },
    { id: 'kl', name: 'كوالالمبور', lat: 3.139, lng: 101.6869, tz: 'Asia/Kuala_Lumpur' },
    { id: 'london', name: 'لندن', lat: 51.5072, lng: -0.1276, tz: 'Europe/London' },
    { id: 'paris', name: 'باريس', lat: 48.8566, lng: 2.3522, tz: 'Europe/Paris' },
    { id: 'newyork', name: 'نيويورك', lat: 40.7128, lng: -74.006, tz: 'America/New_York' },
    { id: 'toronto', name: 'تورنتو', lat: 43.6532, lng: -79.3832, tz: 'America/Toronto' },
  ];

  // fajr / isha sun angles; isha as minutes after maghrib where `ishaMin` is set
  const METHODS = {
    // Ministry of Awqaf (Jordan), which administers Al-Aqsa: maghrib is sunset + 5 min
    awqaf: { name: 'وزارة الأوقاف الأردنية (الأقصى)', fajr: 18, isha: 18, maghribMin: 5 },
    mwl: { name: 'رابطة العالم الإسلامي', fajr: 18, isha: 17 },
    egypt: { name: 'الهيئة المصرية العامة للمساحة', fajr: 19.5, isha: 17.5 },
    makkah: { name: 'أم القرى (مكة المكرمة)', fajr: 18.5, ishaMin: 90 },
    karachi: { name: 'جامعة العلوم الإسلامية بكراتشي', fajr: 18, isha: 18 },
    isna: { name: 'أمريكا الشمالية (ISNA)', fajr: 15, isha: 15 },
    // Diyanet publishes its times with fixed safety offsets (minutes)
    turkey: { name: 'رئاسة الشؤون الدينية التركية', fajr: 18, isha: 17, tune: { sunrise: -7, dhuhr: 5, asr: 4, maghrib: 7 } },
  };

  const NAMES = { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
  const ORDER = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const ICONS = {
    fajr: '<path d="M4 17h16M7 17a5 5 0 0110 0M12 6v3M5.6 10.6l1.8 1.8M18.4 10.6l-1.8 1.8" />',
    sunrise: '<path d="M4 18h16M7 18a5 5 0 0110 0M12 7v3M9 9l3-3 3 3" />',
    dhuhr: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />',
    asr: '<circle cx="12" cy="11" r="3.6"/><path d="M12 3.5v1.6M4.5 11h1.6M17.9 11h1.6M6.7 5.7l1.1 1.1M16.2 6.8l1.1-1.1M5 19h14" />',
    maghrib: '<path d="M4 18h16M7 18a5 5 0 0110 0M12 7v3M9 8l3 3 3-3" />',
    isha: '<path d="M19 14.5A7.5 7.5 0 019.5 5a7.5 7.5 0 109.5 9.5z" />',
  };

  const cfg = () => ({ city: 'aqsa', method: 'awqaf', asr: 1, ...store.get('pray', {}) });
  const save = patch => store.set('pray', { ...cfg(), ...patch });
  function place() {
    const c = cfg();
    if (c.city === 'gps' && c.pos) return { name: 'موقعي', ...c.pos };
    return CITIES.find(x => x.id === c.city) || CITIES[0];
  }

  // ---------------------------------------------------------- astronomy
  const rad = Math.PI / 180;
  const sin = d => Math.sin(d * rad), cos = d => Math.cos(d * rad), tan = d => Math.tan(d * rad);
  const mod = (a, n) => ((a % n) + n) % n;

  function sunPos(jd) {
    const D = jd - 2451545;
    const g = mod(357.529 + 0.98560028 * D, 360);
    const q = mod(280.459 + 0.98564736 * D, 360);
    const L = mod(q + 1.915 * sin(g) + 0.02 * sin(2 * g), 360);
    const e = 23.439 - 3.6e-7 * D;
    const ra = mod(Math.atan2(cos(e) * sin(L), cos(L)) / rad, 360) / 15;
    return { decl: Math.asin(sin(e) * sin(L)) / rad, eqt: q / 15 - ra };
  }

  // times (as Dates) for a calendar day at a place; null where the sun never reaches the angle
  function compute(y, m, d, p, method, asrFactor) {
    const jd0 = Date.UTC(y, m - 1, d) / 864e5 + 2440587.5;
    const at = h => sunPos(jd0 + (h - p.lng / 15) / 24);
    const mid = h => mod(12 - at(h).eqt, 24);
    // hours after solar noon when the sun is `angle` degrees above the horizon
    const hourAngle = (angle, decl) =>
      Math.acos((-sin(angle) - sin(p.lat) * sin(decl)) / (cos(p.lat) * cos(decl))) / rad / 15;
    let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 15, maghrib: 18, isha: 19 };
    for (let pass = 0; pass < 2; pass++) {
      const n = {};
      n.dhuhr = mid(t.dhuhr);
      const noon = n.dhuhr;
      const decl = h => at(h).decl;
      n.sunrise = noon - hourAngle(0.833, decl(t.sunrise));
      n.maghrib = noon + hourAngle(0.833, decl(t.maghrib)) + (method.maghribMin || 0) / 60;
      n.fajr = noon - hourAngle(method.fajr, decl(t.fajr));
      const asrAngle = -Math.atan(1 / (asrFactor + tan(Math.abs(p.lat - decl(t.asr))))) / rad;
      n.asr = noon + hourAngle(asrAngle, decl(t.asr));
      n.isha = method.ishaMin != null ? n.maghrib + method.ishaMin / 60 : noon + hourAngle(method.isha, decl(t.isha));
      t = { ...t, ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Number.isNaN(v) ? t[k] : v])) };
      t._bad = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Number.isNaN(v)]));
    }
    const bad = t._bad;
    // far north the twilight angles can fail: fall back to a seventh of the night
    const sunOk = !bad.sunrise && !bad.maghrib;
    if (sunOk) {
      const night = t.sunrise + 24 - t.maghrib;
      if (bad.fajr) { t.fajr = t.sunrise - night / 7; bad.fajr = false; }
      if (bad.isha) { t.isha = t.maghrib + night / 7; bad.isha = false; }
    }
    const out = {};
    for (const k of ORDER) {
      if (bad[k]) { out[k] = null; continue; }
      const ms = Date.UTC(y, m - 1, d) + (t[k] - p.lng / 15) * 36e5 + (method.tune?.[k] || 0) * 6e4;
      out[k] = new Date(Math.round(ms / 6e4) * 6e4);
    }
    return out;
  }

  // calendar date of an instant in a time zone
  function ymd(date, tz) {
    const o = {};
    for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date)) o[x.type] = +x.value;
    return [o.year, o.month, o.day];
  }
  const nextDay = ([y, m, d]) => { const x = new Date(Date.UTC(y, m - 1, d + 1)); return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]; };

  function fmt(date, tz) {
    if (!date) return '—';
    const o = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(date)) o[x.type] = x.value;
    return ar(`${o.hour}:${o.minute}`) + ' ' + (o.dayPeriod === 'AM' ? 'ص' : 'م');
  }

  // ---------------------------------------------------------- qibla
  function qibla(p) {
    const f1 = p.lat * rad, f2 = KAABA.lat * rad, dl = (KAABA.lng - p.lng) * rad;
    const bearing = mod(Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) / rad, 360);
    const a = Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    return { bearing, km: 12742 * Math.asin(Math.sqrt(a)) };
  }

  function compassSVG(q) {
    let ticks = '';
    for (let a = 0; a < 360; a += 10) {
      const major = a % 90 === 0, len = major ? 0 : a % 30 === 0 ? 8 : 4;
      if (!major) ticks += `<line x1="120" y1="14" x2="120" y2="${14 + len}" transform="rotate(${a} 120 120)" stroke-width="${a % 30 === 0 ? 1.4 : .8}"/>`;
    }
    const card = [['ش', 0], ['ق', 90], ['ج', 180], ['غ', 270]].map(([l, a]) =>
      `<text x="120" y="38" transform="rotate(${a} 120 120)" text-anchor="middle" class="${a ? 'cd' : 'cd n'}">${l}</text>`).join('');
    return `<svg viewBox="0 0 240 240" class="compass" id="prCompass" aria-hidden="true">
      <path class="pt-fix" d="M120 3l-6 11h12z"/>
      <g id="prDial" style="transform-origin:120px 120px">
        <circle cx="120" cy="120" r="104" class="ring"/>
        <circle cx="120" cy="120" r="70" class="ring thin"/>
        <g class="tick">${ticks}</g>${card}
        <g transform="rotate(${q.bearing.toFixed(1)} 120 120)">
          <line x1="120" y1="120" x2="120" y2="60" class="qline"/>
          <g class="kaaba"><rect x="108" y="40" width="24" height="24" rx="3"/><path d="M108 49h24" /><circle cx="125" cy="56" r="1.4"/></g>
        </g>
        <circle cx="120" cy="120" r="5" class="hub"/>
      </g>
    </svg>`;
  }

  // ---------------------------------------------------------- panel
  let timer = 0;
  let heading = null, cum = 0, qb = 0, listening = false;

  function panelHTML() {
    const c = cfg(), p = place(), tz = p.tz;
    const now = new Date();
    const today = ymd(now, tz);
    const day = compute(...today, p, METHODS[c.method] || METHODS.awqaf, c.asr);
    const tomorrow = compute(...nextDay(today), p, METHODS[c.method] || METHODS.awqaf, c.asr);
    const friday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now) === 'Fri';

    const obligatory = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    let nextKey = obligatory.find(k => day[k] && day[k] > now), nextAt = nextKey && day[nextKey], tomorrowFajr = false;
    if (!nextKey) { nextKey = 'fajr'; nextAt = tomorrow.fajr; tomorrowFajr = true; }
    panelHTML.next = nextAt;

    const q = qibla(p);
    qb = q.bearing;
    const sel = (name, opts, cur) => `<select data-pr="${name}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const cityOpts = CITIES.map(x => [x.id, x.name]);
    cityOpts.push(['gps', c.city === 'gps' ? 'موقعي الحالي' : 'موقعي الحالي (تحديد بالـGPS)']);

    const date = new Intl.DateTimeFormat('ar-u-nu-arab', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    const hijri = new Intl.DateTimeFormat('ar-u-ca-islamic-umalqura-nu-arab', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(now);

    const rows = ORDER.map(k => {
      const label = k === 'dhuhr' && friday ? 'الجمعة' : NAMES[k];
      const cls = (k === nextKey && !tomorrowFajr ? ' next' : '') + (k === 'sunrise' ? ' dim' : '');
      return `<div class="row pt${cls}"><svg viewBox="0 0 24 24" class="pt-ic">${ICONS[k]}</svg><span class="main"><span class="t">${label}</span></span><span class="when">${fmt(day[k], tz)}</span></div>`;
    }).join('');

    return `
      <div class="pr-hero">
        <div class="pr-next-l">${tomorrowFajr ? 'فجر الغد' : 'الصلاة القادمة'}</div>
        <div class="pr-next-n">${NAMES[nextKey]}${nextKey === 'dhuhr' && friday ? ' (الجمعة)' : ''} <small>${fmt(nextAt, tz)}</small></div>
        <div class="pr-count" id="prCount">${nextAt ? '' : '—'}</div>
        <div class="pr-date">${date} · ${hijri}</div>
      </div>
      <div class="fields pr-where"><label class="field"><span>الموقع</span>${sel('city', cityOpts, c.city)}</label></div>
      <div class="group">${rows}</div>
      <div class="group-label">القبلة</div>
      <div class="group pr-qibla">
        ${compassSVG(q)}
        <div class="pr-qinfo" id="prQinfo"><b>${ar(Math.round(q.bearing))}°</b> من الشمال${q.km < 1 ? '' : ` · تبعد ${ar(Math.round(q.km).toLocaleString('en'))} كم عن الكعبة`}</div>
        <button class="pr-btn" data-pr-compass>${listening ? 'البوصلة تعمل' : 'تشغيل البوصلة'}</button>
        <p class="pr-hint" id="prHint">أمسك الجهاز مسطّحًا، وحين يستقيم رمز الكعبة مع المؤشر في الأعلى فأنت متجه نحو القبلة.</p>
      </div>
      <div class="group-label">طريقة الحساب</div>
      <div class="fields">
        <label class="field"><span>الهيئة</span>${sel('method', Object.entries(METHODS).map(([k, v]) => [k, v.name]), c.method)}</label>
        <label class="field"><span>العصر</span>${sel('asr', [[1, 'المثل (الجمهور)'], [2, 'المثلان (الحنفية)']], c.asr)}</label>
      </div>
      ${typeof Extras !== 'undefined' ? Extras.remindRowHTML('prayer') + Extras.calendarHTML() : ''}
      <p class="note pr-note">تُحسب المواقيت على الجهاز دون اتصال بالإنترنت، وقد تختلف دقيقة أو دقيقتين عن التقويم المحلي المعتمد؛ فاعتمد تقويم بلدك إن خالف.</p>`;
  }

  function mount() {
    const el = document.getElementById('prayer');
    if (!el) return;
    el.innerHTML = panelHTML();
    applyHeading();
    tick();
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  }

  function tick() {
    const el = document.getElementById('prCount');
    if (!el) { clearInterval(timer); stopCompass(); return; }
    const next = panelHTML.next;
    if (!next) return;
    const left = next - Date.now();
    if (left <= 0) { mount(); return; }
    const s = Math.floor(left / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    const two = n => String(n).padStart(2, '0');
    el.textContent = 'بعد ' + ar(`${h ? h + ':' : ''}${two(m)}:${two(sec)}`);
  }

  // ---------------------------------------------------------- compass
  function applyHeading() {
    const dial = document.getElementById('prDial');
    if (!dial) return;
    dial.style.transform = heading == null ? 'none' : `rotate(${-cum}deg)`;
    const svg = document.getElementById('prCompass');
    // facing the qibla: how far the rim marker is from straight up
    const off = heading == null ? 180 : Math.abs(mod(qb - heading + 180, 360) - 180);
    svg.classList.toggle('ok', off < 4);
    const hint = document.getElementById('prHint');
    if (hint && heading != null) hint.textContent = off < 4 ? 'أنت الآن متجه نحو القبلة' : 'أدر الجهاز حتى يستقيم رمز الكعبة مع المؤشر في الأعلى.';
  }

  function onOrient(e) {
    if (!document.getElementById('prDial')) { stopCompass(); return; }
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = mod(360 - e.alpha, 360);
    if (h == null) return;
    cum = heading == null ? h : cum + (mod(h - heading + 540, 360) - 180);
    heading = h;
    applyHeading();
  }

  function stopCompass() {
    window.removeEventListener('deviceorientationabsolute', onOrient, true);
    window.removeEventListener('deviceorientation', onOrient, true);
    listening = false;
  }

  async function startCompass(btn) {
    if (listening) return;
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') throw 0;
      }
      if (!('ondeviceorientation' in window) && !('ondeviceorientationabsolute' in window)) throw 0;
    } catch {
      toast('البوصلة غير متاحة على هذا الجهاز');
      return;
    }
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
    listening = true;
    btn.textContent = 'البوصلة تعمل';
    // no sensor reading after a moment: tell them rather than sit silent
    setTimeout(() => { if (listening && heading == null) { stopCompass(); btn.textContent = 'تشغيل البوصلة'; toast('لا توجد قراءة للبوصلة في هذا الجهاز'); } }, 2500);
  }

  // ---------------------------------------------------------- input
  function onChange(sel) {
    const k = sel.dataset.pr, v = sel.value;
    if (k === 'city') {
      if (v === 'gps') {
        if (!navigator.geolocation) { toast('تحديد الموقع غير متاح'); mount(); return; }
        toast('جارٍ تحديد موقعك…');
        navigator.geolocation.getCurrentPosition(pos => {
          save({ city: 'gps', pos: { lat: pos.coords.latitude, lng: pos.coords.longitude, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
          mount();
        }, () => { toast('تعذر تحديد موقعك'); mount(); }, { timeout: 12000, maximumAge: 600000 });
        return;
      }
      save({ city: v });
    } else if (k === 'method') save({ method: v });
    else if (k === 'asr') save({ asr: +v });
    mount();
  }

  // the times of the next n days, from today, at the chosen place: [{ ymd, times: { fajr: Date, ... } }]
  function upcoming(n = 1) {
    const c = cfg(), p = place(), m = METHODS[c.method] || METHODS.awqaf;
    let d = ymd(new Date(), p.tz);
    const out = [];
    for (let i = 0; i < n; i++, d = nextDay(d)) out.push({ ymd: d, times: compute(...d, p, m, c.asr) });
    return { place: p, days: out };
  }

  return { mount, onChange, startCompass, upcoming, NAMES };
})();
