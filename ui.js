// The way round the app (ui.css is its look). It leans on app.js's globals: tab, setView,
// renderSheet, syncDock, openSheet…
//
// The way round the app, made plain: a tab bar at the foot, each tab named —
// المصحف · الفهرس · (the mic) · الحفظ · المزيد — in place of two bare icons and a rail hidden
// behind a button. المزيد is a page of its own: the khatma being read, then the rest of the
// app as tiles (التسميع، الأذكار، الصلاة، الحديث، العلامات، ختماتي) and the settings; a panel
// opened from it has «المزيد» to go back.
(() => {
  if (!document.documentElement.classList.contains('ui')) return;
  const MORE = ['more', 'adhkar', 'hadith', 'marks', 'prayer', 'settings'];
  const HIFZ = ['hifz', 'recite']; // (الحفظ's tab: memorizing and reciting from memory, side by side)
  PANELS.push('more');
  TAB_NAMES.more = 'المزيد';

  const svg = (d, vb = 24) => `<svg viewBox="0 0 ${vb} ${vb}" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
  const railIco = t => $(`#tabs [data-tab="${t}"] svg`)?.outerHTML || '';
  const IC = {
    quran: svg('<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/>'),
    index: svg('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r="1.1"/><circle cx="4.6" cy="12" r="1.1"/><circle cx="4.6" cy="17.5" r="1.1"/>'),
    hifz: railIco('hifz'),
    more: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>'),
    lib: svg('<path d="M5 4.5h4v15H5zM10.5 4.5h4v15h-4z"/><path d="M16 5.6l3.6-1 3.4 13.9-3.6 1z" transform="translate(-1.6 .3)"/>'),
    gear: railIco('settings'),
    tour: svg('<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2l-1.6 4-4 1.6 1.6-4z"/>'),
    go: svg('<path d="M15 6l-6 6 6 6"/>'),
    back: svg('<path d="M9 6l6 6-6 6"/>'),
  };

  // ---------------------------------------------------------------- the tab bar
  const dock = $('#dock'), mid = dock.querySelector('.dock-mid');
  dock.classList.add('dv-dock');
  const tabBtn = (id, label, icon) => {
    const b = document.createElement('button');
    b.id = id; b.className = 'dv-tab'; b.setAttribute('aria-label', label);
    b.innerHTML = `${icon}<span>${label}</span>`;
    return b;
  };
  const tQuran = $('#dockQuran'), tMore = $('#dockPanels');
  tQuran.className = tMore.className = 'dv-tab';
  tQuran.innerHTML = `${IC.quran}<span>المصحف</span>`;
  tMore.innerHTML = `${IC.more}<span>المزيد</span>`; tMore.setAttribute('aria-label', 'المزيد');
  const tIndex = tabBtn('dvIndex', 'الفهرس', IC.index), tHifz = tabBtn('dvHifz', 'الحفظ', IC.hifz);
  // the mic: a green pill in the bar, named (find an aya by reading it)
  // the mic, round and raised, named under it
  const micL = document.createElement('span');
  micL.className = 'dv-micl'; micL.textContent = 'بحث بالصوت';
  mid.append(micL);
  // the bar's tab: puts the bar away (the page alone) and brings it back; remembered
  // (a chevron in the bar itself, at its end; the bar away, a small handle brings it back, in the
  // strip at the foot that is kept for the bar, so it never lies over the text)
  const hideB = document.createElement('button');
  hideB.className = 'dv-hide'; hideB.setAttribute('aria-label', 'أخفِ الشريط');
  hideB.innerHTML = svg('<path d="M7 10l5 5 5-5"/>');
  const showB = document.createElement('button');
  showB.className = 'dv-show'; showB.setAttribute('aria-label', 'أظهر الشريط');
  showB.innerHTML = svg('<path d="M7 14l5-5 5 5"/>');
  document.body.append(showB);
  const barless = on => {
    document.body.classList.toggle('dv-barless', on);
    store.set('dv.barless', on);
  };
  hideB.onclick = () => { haptic(8); barless(true); };
  showB.onclick = () => { haptic(8); barless(false); };
  barless(!!store.get('dv.barless', false));
  // (in the bar's order, right to left)
  dock.replaceChildren(tQuran, tIndex, mid, tHifz, tMore, hideB);

  // a tab: the panel it names, from wherever the reader is (the adhkar's reader and the
  // khatmas over the panels: put away first); tapped again, its page back to the top
  const away = () => { if (panelOpen($('#adhkar'))) Adhkar.close(); if (panelOpen($('#library'))) hide($('#library')); };
  function goTab(t) {
    haptic(6);
    const open = panelOpen($('#sheet'));
    away();
    if (open && tab === t && !$('#q').value.trim()) {
      if (t === 'more' || !(setView || (t === 'hifz' && Hifz.view()))) { $('#sheetBody').scrollTo({ top: 0, behavior: 'smooth' }); return; }
    }
    if (!open) { openSheet(t); return; }
    keepPanel(); tab = t; setView = ''; Hifz.reset(); stopPreview(); $('#q').value = '';
    renderSheet(); $('#sheetBody').scrollTop = 0;
  }
  tIndex.onclick = () => goTab('suras');
  let hz = 'hifz';
  tHifz.onclick = () => goTab(panelOpen($('#sheet')) && HIFZ.includes(tab) ? tab : hz);
  tMore.onclick = () => goTab('more');
  const quranTap = tQuran.onclick;
  tQuran.onclick = e => { haptic(6); quranTap.call(tQuran, e); };
  // the mic from a panel: back to the page first, where the aya will be found
  const micTap = $('#dockMic').onclick;
  $('#dockMic').onclick = e => {
    if (panelOpen($('#sheet')) || panelOpen($('#library')) || panelOpen($('#adhkar'))) { away(); closeSheet(); }
    micTap.call($('#dockMic'), e);
  };

  function lightTab() {
    const sheet = panelOpen($('#sheet')), over = panelOpen($('#library')) || panelOpen($('#adhkar'));
    const on = over ? 'more' : !sheet ? 'quran' : tab === 'suras' ? 'index' : HIFZ.includes(tab) ? 'hifz' : 'more';
    for (const [k, b] of [['quran', tQuran], ['index', tIndex], ['hifz', tHifz], ['more', tMore]]) {
      b.classList.toggle('on', k === on);
      b.setAttribute('aria-current', k === on ? 'page' : 'false');
    }
  }
  // (the adhkar's reader and the khatmas open and close by themselves too: the tabs follow; the
  // adhkar's reader a page of its own, the bar away)
  new MutationObserver(() => { document.body.classList.toggle('dv-immersive', panelOpen($('#adhkar'))); lightTab(); })
    .observe($('#adhkar'), { attributes: true, attributeFilter: ['hidden', 'class'] });
  new MutationObserver(lightTab).observe($('#library'), { attributes: true, attributeFilter: ['hidden', 'class'] });
  const sync0 = syncDock;
  syncDock = function () { sync0(); lightTab(); };

  // ---------------------------------------------------------------- the panels' head
  // a large title at the start; «المزيد» back from a panel reached from it; the search only
  // where it is the way in (الفهرس and المزيد), or while something is being looked for
  const head = $('#sheet .sheet-head');
  const back = document.createElement('button');
  back.className = 'dv-back'; back.innerHTML = `${IC.back}<span>المزيد</span>`;
  back.onclick = () => goTab('more');
  head.prepend(back);
  const seg = document.createElement('div');
  seg.className = 'dv-seg'; seg.setAttribute('role', 'tablist');
  seg.innerHTML = '<button data-t="hifz" role="tab">الحفظ</button><button data-t="recite" role="tab">التسميع</button><i></i>';
  seg.onclick = e => { const b = e.target.closest('[data-t]'); if (b && b.dataset.t !== tab) goTab(b.dataset.t); };
  head.append(seg);
  function paintHead() {
    const q = !!$('#q').value.trim(), sh = $('#sheet');
    back.hidden = q || !MORE.includes(tab) || tab === 'more';
    sh.classList.toggle('dv-find', q || ['suras', 'hadith', 'adhkar'].includes(tab)); // (where the panel's own way in is the search)
    sh.dataset.dvT = tab;
    seg.hidden = q || !HIFZ.includes(tab);
    if (HIFZ.includes(tab)) hz = tab;
    seg.dataset.on = tab;
    for (const b of seg.querySelectorAll('button')) { b.classList.toggle('on', b.dataset.t === tab); b.setAttribute('aria-selected', b.dataset.t === tab); }
  }

  // the large title made small once the page is scrolled (dev.css: .dv-up)
  const body = $('#sheetBody');
  let upRaf = 0;
  body.addEventListener('scroll', () => {
    if (upRaf) return;
    upRaf = requestAnimationFrame(() => { upRaf = 0; $('#sheet').classList.toggle('dv-up', body.scrollTop > 24); });
  }, { passive: true });

  // the khatmas, opened from المزيد: back to it
  const lib0 = openLibrary;
  openLibrary = function (...a) {
    const from = tab;
    lib0.apply(this, a);
    if (from === 'more') { libFrom = 'more'; $('#libClose').textContent = '‹ المزيد'; }
  };

  // ---------------------------------------------------------------- المزيد
  function nextPrayer() {
    try {
      const u = Prayer.upcoming(2), now = Date.now();
      for (const d of u.days) for (const k of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
        const t = d.times[k];
        if (t && +t > now) {
          const o = {};
          for (const x of new Intl.DateTimeFormat('en-US', { timeZone: u.place.tz, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(t)) o[x.type] = x.value;
          return `التالية: ${Prayer.NAMES[k]} ${ar(`${o.hour}:${o.minute}`)} ${o.dayPeriod === 'AM' ? 'ص' : 'م'}`;
        }
      }
    } catch {}
    return 'المواقيت والقبلة';
  }
  function hubHTML() {
    const pct = khatmaPct(K), read = pagesRead(K), total = khatmaTotal(K);
    const tile = (t, name, sub, attr = `data-dv-tab="${t}"`, ic = railIco(t)) =>
      `<button class="dv-tile" ${attr}><span class="dv-ti">${ic}</span><b>${name}</b><small>${sub}</small></button>`;
    const row = (attr, ic, t, s) => `<button class="row dv-row" ${attr}><span class="dv-ri">${ic}</span><span class="main"><span class="t">${t}</span><span class="s">${s}</span></span><span class="dv-go">${IC.go}</span></button>`;
    return `<div class="dv-hub">
      <button class="dv-cont" data-dv="read">
        <span class="dv-cover">${coverHTML(K, true)}</span>
        <span class="dv-cm"><small>تابع القراءة · ${esc(K.name)}</small>
          <b>${suraName(R.ayas[pageInfo(K.page).first]?.[0] || 1)} · صفحة ${ar(K.page)}</b>
          <span class="dv-bar"><i style="width:${pct}%"></i></span></span>
        <span class="dv-pct">${ar(pct)}٪</span>
      </button>
      <div class="dv-grid">
        ${tile('adhkar', 'الأذكار', 'الصباح والمساء وغيرها')}
        ${tile('prayer', 'الصلاة', nextPrayer())}
        ${tile('hadith', 'الحديث', 'الكتب الستة وحديث اليوم')}
        ${tile('marks', 'العلامات', 'الأشرطة والآيات المحفوظة')}
        ${tile('', 'ختماتي', KH.length > 1 ? `${ar(KH.length)} ختمات · ${ar(read)} من ${ar(total)} صفحة` : `${ar(read)} من ${ar(total)} صفحة`, 'data-open-lib', IC.lib)}
        ${tile('settings', 'الإعدادات', 'التلاوة، المظهر، دون اتصال', 'data-dv-tab="settings"', IC.gear)}
      </div>
      <div class="group">
        ${row('data-xs="tour"', IC.tour, 'جولة في التطبيق', 'ما يخفى منه، في دقيقة')}
      </div>
    </div>`;
  }
  $('#sheetBody').addEventListener('click', e => {
    const t = e.target.closest('#sheetBody [data-dv-tab]');
    if (t) { e.stopImmediatePropagation(); goTab(t.dataset.dvTab); return; }
    if (e.target.closest('[data-dv="read"]')) { e.stopImmediatePropagation(); closeSheet(); return; }
    if (tab === 'more' && e.target.closest('[data-open-lib]')) { e.stopImmediatePropagation(); openLibrary(); }
  }, true);

  const render0 = renderSheet;
  renderSheet = function () {
    if (tab === 'more' && !$('#q').value.trim()) {
      document.querySelectorAll('#tabs button').forEach(b => b.classList.remove('on'));
      $('#sheet').classList.remove('searching');
      $('#sheetTitle').textContent = 'المزيد';
      $('#sheetBody').innerHTML = hubHTML();
      if (typeof Desk !== 'undefined') Desk.sync();
    } else render0();
    paintHead(); lightTab();
    $('#sheet').classList.toggle('dv-up', body.scrollTop > 24);
  };
  $('#q').placeholder = 'ابحث: سورة، آية، صفحة، جزء، ذكر، أو إعداد…';

  lightTab();
  if (panelOpen($('#sheet'))) renderSheet();
})();
