'use strict';

// Plans and schedules, without the page: what today's revision is, the days kept, a khatma's daily
// portion, the Hijri occasions ahead and calendar files. Pure functions (no DOM, no store), so the
// tests (tests/*.test.mjs) load this file in node; the app uses the global Plan.

const Plan = (() => {
  const DAY = 864e5;
  // a local calendar day: its key (as recite.js keeps l.days) and its number
  const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const dayNo = (t = Date.now()) => { const d = new Date(t); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };
  const dayStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

  // ---- revision. ayas: [[sura, aya, page], ...] (the riwaya's); said: { ai: when last recited };
  // first: { ai: when memorized (1: memorized before using the app) }; weak: Set of ayas with mistakes not
  // yet mended; skip: ayas not to revise (the lesson); days: everything old revised within that many days.
  // السبقي (near): memorized in the last 7 days, every day. المنزل: the older ones by page, the pages least
  // recently recited first, weak pages coming back three times as often; as many pages a day as keeps
  // that pace, so a day missed is not lost: what was due stays first.
  function revision({ ayas, said = {}, first = {}, weak = new Set(), skip = () => false, days = 7, now = Date.now() }) {
    const week = now - 7 * DAY, near = [], byPage = new Map();
    for (const k of Object.keys(said)) {
      const ai = +k;
      if (!ayas[ai] || skip(ai)) continue;
      const t = first[k] > 1e9 ? first[k] : said[k];
      if (t >= week && first[k] !== 1) { near.push(ai); continue; }
      const p = ayas[ai][2];
      if (!byPage.has(p)) byPage.set(p, { page: p, ayas: [], last: Infinity, weak: 0 });
      const g = byPage.get(p);
      g.ayas.push(ai);
      g.last = Math.min(g.last, said[k] || 0);
      if (weak.has(ai)) g.weak++;
    }
    near.sort((a, b) => a - b);
    const pages = [...byPage.values()];
    for (const g of pages) {
      g.every = g.weak ? Math.max(1, Math.round(days / 3)) : days;
      g.due = (now - g.last) / DAY / g.every; // 1: due today
    }
    const load = pages.reduce((t, g) => t + 1 / g.every, 0);
    const quota = pages.length ? Math.max(1, Math.ceil(load - 1e-9)) : 0;
    const order = [...pages].sort((a, b) => b.due - a.due || a.page - b.page);
    const today = order.slice(0, quota).sort((a, b) => a.page - b.page);
    const part = today.flatMap(g => g.ayas).sort((a, b) => a - b);
    const late = order.slice(quota).filter(g => g.due > 1.5).length;
    return { near, part, pages: today.map(g => g.page), weakPages: today.filter(g => g.weak).length, total: pages.length, late };
  }

  // pages as text: runs joined, "١٢–١٤، ٥٠"
  function pageRuns(pages, num = String) {
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      let j = i;
      while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
      out.push(i === j ? num(pages[i]) : `${num(pages[i])}–${num(pages[j])}`);
      i = j;
    }
    return out.join('، ');
  }

  // ---- the days kept. active: Set of day keys with something done; full: Set of days when the whole
  // revision was done. The streak counts back from today (or yesterday, today not done yet).
  function streak(active, now = Date.now()) {
    let t = now, n = 0;
    if (!active.has(dayKey(t))) t -= DAY;
    while (active.has(dayKey(t))) { n++; t -= DAY; }
    let best = 0, run = 0;
    const keys = [...active].map(k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; }).sort((a, b) => a - b);
    keys.forEach((d, i) => { run = i && d === keys[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); });
    return { now: n, best: Math.max(best, n), today: active.has(dayKey(now)) };
  }
  // the last n days, oldest first: [{ key, wd (0 Sunday), on, full }]
  function lastDays(n, active, full, now = Date.now()) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const t = now - i * DAY, key = dayKey(t);
      out.push({ key, wd: new Date(t).getDay(), on: active.has(key), full: full.has(key), today: i === 0 });
    }
    return out;
  }

  // ---- a khatma's daily portion. k.goal = { days, start }; k.day = { d: day key, n0: pages read at
  // its start }; read: pages read now; unread: page numbers not yet read, from where the reader is.
  function ward(k, total, read, unread, now = Date.now()) {
    if (!k.goal?.days) return null;
    const passed = dayNo(now) - dayNo(k.goal.start), left = Math.max(1, k.goal.days - passed);
    const n0 = k.day?.d === dayKey(now) ? k.day.n0 : read;
    const target = Math.max(0, Math.ceil((total - n0) / left)), today = read - n0;
    const rest = Math.max(0, target - today);
    // where it should be by now: the pages of the days passed
    const should = Math.min(total, Math.round(total * Math.min(passed, k.goal.days) / k.goal.days));
    return { left, target, today, rest, from: unread[0] ?? null, to: rest ? unread[Math.min(rest, unread.length) - 1] : null,
      behind: Math.max(0, should - n0), over: passed >= k.goal.days, done: read >= total };
  }

  // ---- the Hijri calendar (Umm al-Qura, as Intl gives it)
  let fmtH = null;
  function hijri(t) {
    fmtH ||= new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' });
    const o = {};
    for (const x of fmtH.formatToParts(new Date(t))) o[x.type] = parseInt(x.value, 10);
    return { y: o.year, m: o.month, d: o.day };
  }
  const MONTHS = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
  // the days with a deed of the Sunnah, [month, day, name, what to do]
  const OCCASIONS = [
    [1, 1, 'بداية العام الهجري', 'شهر الله المحرّم: أفضل الصيام بعد رمضان'],
    [1, 9, 'تاسوعاء', 'يُستحب صيامه مع عاشوراء'],
    [1, 10, 'عاشوراء', 'صيامه يكفّر السنة التي قبله'],
    [8, 1, 'شعبان', 'كان النبي ﷺ يكثر الصيام فيه'],
    [9, 1, 'رمضان', 'شهر الصيام والقيام والقرآن'],
    [9, 21, 'العشر الأواخر', 'التماس ليلة القدر، والاعتكاف'],
    [10, 1, 'عيد الفطر', 'زكاة الفطر قبل الصلاة، والتكبير'],
    [10, 2, 'ستّ من شوّال', 'من صام رمضان وأتبعه ستًّا من شوّال كان كصيام الدهر'],
    [12, 1, 'عشر ذي الحجة', 'أفضل أيام الدنيا: الذكر والتكبير والعمل الصالح'],
    [12, 8, 'يوم التروية', ''],
    [12, 9, 'يوم عرفة', 'صيامه يكفّر السنة الماضية والباقية'],
    [12, 10, 'عيد الأضحى', 'صلاة العيد والأضحية'],
    [12, 11, 'أيام التشريق', 'أيام أكل وشرب وذكر لله'],
  ];
  // the occasions in the next `n` days (and the white days, 13–15 of each month, the nearest)
  function occasions(now = Date.now(), n = 380) {
    const out = [];
    let white = null;
    for (let i = 0; i < n; i++) {
      const t = dayStart(now) + i * DAY + 12 * 36e5, h = hijri(t);
      for (const [m, d, name, sub] of OCCASIONS) if (h.m === m && h.d === d) out.push({ t, in: i, h, name, sub });
      if (!white && h.d === 13 && !(h.m === 12)) white = { t, in: i, h, name: 'الأيام البيض', sub: 'صيام ١٣ و١٤ و١٥ من الشهر' };
    }
    if (white) out.push(white);
    return out.sort((a, b) => a.t - b.t);
  }
  // the Hijri month around `now`: [{ t, d (Hijri day), g (Gregorian day), occ }]
  function month(now = Date.now()) {
    const h = hijri(now), days = [];
    let t = dayStart(now) + 12 * 36e5 - (h.d - 1) * DAY;
    for (let i = 0; i < 31; i++, t += DAY) {
      const x = hijri(t);
      if (x.m !== h.m) { if (i) break; continue; }
      days.push({ t, d: x.d, g: new Date(t).getDate(), wd: new Date(t).getDay(), today: dayKey(t) === dayKey(now),
        occ: OCCASIONS.find(([m, d]) => m === x.m && d === x.d)?.[2] || (x.d >= 13 && x.d <= 15 && x.m !== 12 ? 'الأيام البيض' : '') });
    }
    return { y: h.y, m: h.m, name: MONTHS[h.m - 1], days };
  }

  // ---- calendar files (RFC 5545): events { uid, start: Date, mins, title, desc, url, alarm (minutes
  // before, 0: at the time), daily: a floating local time repeated every day }
  function ics(events, name = 'القرآن الكريم') {
    const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const two = n => String(n).padStart(2, '0');
    const utc = d => `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}T${two(d.getUTCHours())}${two(d.getUTCMinutes())}00Z`;
    const local = d => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}T${two(d.getHours())}${two(d.getMinutes())}00`;
    // lines of at most 75 octets, folded (cut on characters, not inside one)
    const fold = line => {
      const enc = new TextEncoder(), out = [];
      let cur = '', n = 0;
      for (const ch of line) {
        const b = enc.encode(ch).length;
        if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
        cur += ch; n += b;
      }
      out.push(cur);
      return out.join('\r\n ');
    };
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//quran-app//ar', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`];
    const stamp = utc(new Date());
    for (const e of events) {
      const end = new Date(e.start.getTime() + (e.mins || 10) * 6e4);
      L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
      if (e.daily) L.push(`DTSTART:${local(e.start)}`, `DTEND:${local(end)}`, 'RRULE:FREQ=DAILY');
      else L.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(end)}`);
      L.push(`SUMMARY:${esc(e.title)}`);
      if (e.desc) L.push(`DESCRIPTION:${esc(e.desc)}`);
      if (e.url) L.push(`URL:${e.url}`);
      L.push('TRANSP:TRANSPARENT');
      if (e.alarm != null) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:${e.alarm ? `-PT${e.alarm}M` : 'PT0M'}`, 'END:VALARM');
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  // ---- two copies of a riwaya's recitation record (recite.<riwaya>), one from each device, made one: nothing
  // recited on either is lost. `a` is the copy changed less recently (its plain fields give way to b's).
  // said: the latest time of each aya, unless taken out later (gone.said); first: the earliest; days: the
  // larger count; an aya's weak spot (ayas), its numbers (stats), a surah's revisions (rev): the copy
  // changed last, unless taken out later; the sessions: both, once each, the newest 200; totals: the larger.
  function mergeRecite(a, b) {
    a ||= {}; b ||= {};
    const out = { ...a, ...b }, g = {};
    for (const kind of ['said', 'ayas', 'rev']) {
      g[kind] = { ...(a.gone?.[kind] || {}) };
      for (const [k, t] of Object.entries(b.gone?.[kind] || {})) g[kind][k] = Math.max(g[kind][k] || 0, t);
    }
    out.gone = g;
    const keys = (x, y) => new Set([...Object.keys(x || {}), ...Object.keys(y || {})]);
    out.said = {}; out.first = {};
    for (const k of keys(a.said, b.said)) {
      const t = Math.max(a.said?.[k] || 0, b.said?.[k] || 0);
      if (!t || (g.said[k] || 0) >= t) continue;
      out.said[k] = t;
      const f = [a.first?.[k], b.first?.[k]].filter(x => x > 0);
      if (f.length) out.first[k] = Math.min(...f);
    }
    out.days = {};
    for (const k of keys(a.days, b.days)) out.days[k] = Math.max(a.days?.[k] || 0, b.days?.[k] || 0);
    const dk = Object.keys(out.days);
    if (dk.length > 400) {
      const num = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
      dk.sort((x, y) => num(x) - num(y)).slice(0, dk.length - 400).forEach(k => delete out.days[k]);
    }
    const ver = r => Math.max(r?.last || 0, r?.at || 0, r?.edit || 0, ...(r?.h || []).map(x => x[0] || 0));
    const pick = (field, kind) => {
      const o = {};
      for (const k of keys(a[field], b[field])) {
        const x = a[field]?.[k], y = b[field]?.[k], r = !x ? y : !y ? x : ver(y) >= ver(x) ? y : x;
        if (r && !(kind && (g[kind][k] || 0) >= ver(r))) o[k] = r;
      }
      return o;
    };
    out.ayas = pick('ayas', 'ayas');
    out.stats = pick('stats');
    out.rev = pick('rev', 'rev');
    const ss = new Map();
    for (const s of [...(a.sessions || []), ...(b.sessions || [])]) {
      const k = `${s.t}|${s.from}`, was = ss.get(k);
      // (the same session on both: the one with fewer mistakes listed, some since forgiven)
      if (!was || (s.list || []).length < (was.list || []).length) ss.set(k, s);
    }
    out.sessions = [...ss.values()].sort((x, y) => y.t - x.t).slice(0, 200);
    if (a.total || b.total) out.total = { secs: Math.max(a.total?.secs || 0, b.total?.secs || 0), sessions: Math.max(a.total?.sessions || 0, b.total?.sessions || 0) };
    return out;
  }
  // the days kept (hifz.hist.<riwaya>: { day: 1 | 2 }), from two devices: the most done each day
  function mergeDays(a, b) {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) out[k] = Math.max(out[k] || 0, v);
    return out;
  }

  return { DAY, dayKey, mergeRecite, mergeDays, dayNo, dayStart, revision, pageRuns, streak, lastDays, ward, hijri, MONTHS, OCCASIONS, occasions, month, ics };
})();

if (typeof module !== 'undefined') module.exports = Plan;
