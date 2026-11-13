'use strict';

// A computer's screen (a mouse and room: app.js, measureDesk): the mushaf lies open in the middle,
// two facing pages; a bar along the top (where one is, the search, the tools), a rail of the panels
// at the side, the panel chosen standing beside the pages and the tafsir at the other side, a
// line under the pages to run through the mushaf by; the keys, the wheel, the aya under the mouse.
// Uses $, S, R, K, P, META, store, ar, show, hide, panelOpen, toast, suraName, pageInfo, base,
// shownPages, turn, goTo, renderAll, openSheet, closeSheet, renderSheet, openActions, closeActions,
// openTafsir, toggleBookmark, toggleSave, isBookmarked, playFrom, audio, applyTheme, drawBands,
// paintMarks, juzStarts, slots, tab, WordCard, Recite, Adhkar from the other scripts, at call time.
const Desk = (() => {
  let built = false, on = false, bySearch = false;
  let at = { x: 0, y: 0, t: 0, el: null }; // the last press on the pages: a card opens by it
  const svg = (d, o = '') => `<svg viewBox="0 0 24 24" ${o}><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
  const IC = {
    read: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/>',
    suras: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.2 6.5h.6M4.2 12h.6M4.2 17.5h.6" stroke-width="2.4"/>',
    play: '<path d="M8.5 5.5v13l10.5-6.5z"/>',
    pause: '<path d="M8.5 6v12M15.5 6v12" stroke-width="2.4"/>',
    mic: '<path d="M12 3.5a3 3 0 00-3 3v5a3 3 0 006 0v-5a3 3 0 00-3-3zM6.5 11a5.5 5.5 0 0011 0M12 16.5v4"/>',
    bm: '<path d="M6.5 4h11v16.5l-5.5-4-5.5 4z"/>',
    two: '<rect x="3.5" y="5" width="8" height="14" rx="1.5"/><rect x="12.5" y="5" width="8" height="14" rx="1.5"/>',
    one: '<rect x="7" y="4.5" width="10" height="15" rx="1.5"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M6 12h12M12 6v12"/>',
    cloud: '<path d="M7 18.5a4.5 4.5 0 01-.6-8.96 6 6 0 0111.5 1.5A3.75 3.75 0 0117.25 18.5z"/>',
    theme: '<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8a8.2 8.2 0 010 16.4z" fill="currentColor" stroke="none"/>',
    full: '<path d="M4.5 9.5v-5h5M19.5 9.5v-5h-5M4.5 14.5v5h5M19.5 14.5v5h-5"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 114 2c-.9.6-1.6 1.1-1.6 2.3"/><path d="M12 16.8h.01" stroke-width="2.2"/>',
    next: '<path d="M14.5 5.5l-6.5 6.5 6.5 6.5"/>',
    prev: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5"/>',
    down: '<path d="M7 10l5 5 5-5"/>',
  };
  const THEME_NAME = { light: 'فاتح', sepia: 'ورقي', dark: 'داكن', auto: 'تلقائي' };
  const RAIL = [['read', 'المصحف'], ['suras', 'الفهرس'], ['recite', 'التسميع'], ['adhkar', 'الأذكار'], ['marks', 'العلامات'], ['prayer', 'الصلاة'], ['settings', 'الإعدادات']];
  const KEYS = [
    ['التنقل', [
      ['←', 'الصفحة التالية'], ['→', 'الصفحة السابقة'], ['Home / End', 'أول المصحف وآخره'],
      ['Ctrl ← / →', 'السورة التالية / السابقة'], ['/', 'البحث: سورة، آية، صفحة، جزء'], ['عجلة الفأرة', 'تقليب الصفحات'],
    ]],
    ['الآيات', [
      ['↓ / ↑', 'الآية التالية / السابقة'], ['Enter', 'خيارات الآية المحددة'], ['T', 'تفسير الآية'], ['M', 'الآيات المتشابهة'],
      ['B', 'علامة على الآية أو الصفحة'], ['C', 'نسخ الآية'], ['نقرتان', 'معنى الكلمة ونطقها'],
    ]],
    ['الاستماع والتسميع', [
      ['Space', 'تشغيل التلاوة / إيقافها'], ['N / P', 'الآية التالية / السابقة في التلاوة'], ['R', 'سمّع من الآية المحددة'], ['V', 'ابحث بصوتك عن آية'],
    ]],
    ['العرض', [
      ['1 / 2', 'صفحة واحدة / صفحتان'], ['+ / −', 'تكبير الخط / تصغيره'], ['0', 'الحجم الأصلي'], ['F', 'ملء الشاشة'],
      ['D', 'المظهر: فاتح، ورقي، داكن'], ['I', 'الفهرس'], ['Esc', 'إغلاق ما هو مفتوح'], ['?', 'هذه القائمة'],
    ]],
  ];

  function build() {
    built = true;
    const bar = document.createElement('header');
    bar.id = 'deskBar';
    const tool = (id, ic, tip) => `<button id="${id}" class="db-btn" data-tip="${tip}" aria-label="${tip}">${svg(IC[ic])}</button>`;
    bar.innerHTML = `
      <button id="dbWhere" class="db-where" data-tip="الفهرس  ·  I"><span><b id="dbSura"></b><small id="dbPage"></small></span>${svg(IC.down)}</button>
      <div id="dbSearch" class="db-search"><kbd>/</kbd></div>
      <div class="db-tools">
        ${tool('dbPlay', 'play', 'استماع  ·  Space')}
        ${tool('dbMic', 'mic', 'ابحث بصوتك ثم سمّع  ·  V')}
        ${tool('dbBm', 'bm', 'علامة  ·  B')}
        <i class="db-sep"></i>
        ${tool('dbTwo', 'two', 'صفحة أو صفحتان  ·  1 / 2')}
        <span class="db-zoom">${tool('dbOut', 'minus', 'تصغير  ·  −')}<button id="dbZoom" data-tip="الحجم الأصلي  ·  0"></button>${tool('dbIn', 'plus', 'تكبير  ·  +')}</span>
        <i class="db-sep"></i>
        ${tool('dbSync', 'cloud', 'المزامنة بين أجهزتك')}
        ${tool('dbTheme', 'theme', 'المظهر  ·  D')}
        ${tool('dbFull', 'full', 'ملء الشاشة  ·  F')}
        ${tool('dbHelp', 'help', 'اختصارات لوحة المفاتيح  ·  ?')}
      </div>`;
    const rail = document.createElement('nav');
    rail.id = 'deskRail';
    rail.setAttribute('aria-label', 'اللوحات');
    rail.innerHTML = `<img class="dr-logo" src="icons/icon-192.png" alt="">` + RAIL.map(([id, name]) => {
      const ic = IC[id] ? svg(IC[id]) : $(`#tabs [data-tab=${id}] svg`).outerHTML;
      return `<button data-dr="${id}"${id === 'settings' ? ' class="dr-end"' : ''}>${ic}<span>${name}</span></button>`;
    }).join('');
    const scrub = document.createElement('div');
    scrub.id = 'deskScrub';
    scrub.innerHTML = `<span id="dsN" class="ds-n"></span><div id="dsTrk" class="ds-trk"><span id="dsTicks"></span><i id="dsFill"></i><b id="dsKnob"></b></div><span id="dsPct" class="ds-n ds-pct"></span><div id="dsTip" class="ds-tip" hidden></div>`;
    const mk = (id, ic, label) => { const b = document.createElement('button'); b.id = id; b.className = 'dk-turn'; b.setAttribute('aria-label', label); b.innerHTML = svg(IC[ic]); return b; };
    const nx = mk('dkNextPg', 'next', 'الصفحة التالية'), pv = mk('dkPrevPg', 'prev', 'الصفحة السابقة');
    const help = document.createElement('section');
    help.id = 'deskHelp'; help.className = 'modal'; help.hidden = true;
    help.innerHTML = `<div class="card dk-help"><h2>اختصارات لوحة المفاتيح</h2><div class="dk-keys">${KEYS.map(([t, l]) =>
      `<div class="dk-kg"><h3>${t}</h3>${l.map(([k, d]) => `<div><span>${d}</span><span class="dk-k">${k.split(' / ').map(x => `<kbd>${x}</kbd>`).join('')}</span></div>`).join('')}</div>`).join('')}</div>
      <p class="note">انقر آيةً لخياراتها، وبالزر الأيمن كذلك؛ وانقر كلمةً نقرتين لمعناها. اسحب حافة التفسير لتوسيعه.</p>
      <div class="actions"><button id="dhOk" class="primary">تم</button></div></div>`;
    const size = document.createElement('i');
    size.id = 'tfSize';
    $('#tafsir').append(size);
    document.body.append(bar, rail, scrub, nx, pv, help);
    wire(size);
  }

  // ---- the look of things kept in step with where the reader is
  // (written only when it changes: this runs at every turn, every panel, every class of the body's)
  const put = (sel, t) => { const el = $(sel); if (el.textContent !== t) el.textContent = t; };
  function sync() {
    if (!!S.desk !== on) S.desk ? enter() : leave();
    if (!on || !R) return;
    const pages = shownPages(), fa = R.ayas[pageInfo(pages[0]).first], la = R.ayas[pageInfo(pages[pages.length - 1]).last];
    put('#dbSura', fa[0] === la[0] ? `سورة ${suraName(fa[0])}` : `${suraName(fa[0])} – ${suraName(la[0])}`);
    put('#dbPage', (pages.length > 1 ? `الصفحتان ${ar(pages[0])}–${ar(pages[1])}` : `الصفحة ${ar(pages[0])}`) + ` · الجزء ${ar(R.ayas[pageInfo(S.page).first][3])}`);
    const playing = P.ai != null && !audio.paused;
    const pb = $('#dbPlay');
    if (pb.dataset.s !== String(playing)) { pb.dataset.s = playing; pb.innerHTML = svg(IC[playing ? 'pause' : 'play']); pb.classList.toggle('on', playing); }
    $('#dbBm').classList.toggle('on', pages.some(isBookmarked));
    $('#dbMic').classList.toggle('on', document.body.classList.contains('rc-on') || document.body.classList.contains('rc-find'));
    const tb = $('#dbTwo'), two = !!store.get('desk.two', true);
    if (tb.dataset.s !== String(two)) { tb.dataset.s = two; tb.innerHTML = svg(IC[two ? 'two' : 'one']); }
    tb.classList.toggle('dim', two && !S.two); // (asked for, no room for it)
    put('#dbZoom', ar(Math.round(zoom() * 100)) + '٪');
    // the rail: the panel standing open, or the pages
    const open = panelOpen($('#adhkar')) ? 'adhkar' : panelOpen($('#library')) ? 'marks' : panelOpen($('#sheet')) ? (tab === 'suras' || $('#q').value.trim() ? 'suras' : tab) : 'read';
    document.querySelectorAll('#deskRail [data-dr]').forEach(b => b.classList.toggle('on', b.dataset.dr === open));
    $('#dbWhere').classList.toggle('on', open === 'suras');
    // the line under the pages
    const n = R.pages.length, f = n > 1 ? (S.page - 1) / (n - 1) : 0;
    $('#dsFill').style.width = (f * 100).toFixed(2) + '%';
    $('#dsKnob').style.right = (f * 100).toFixed(2) + '%';
    put('#dsN', `${ar(S.page)} / ${ar(n)}`);
    put('#dsPct', `${K.name} · ${ar(khatmaPct(K))}٪`);
    if ($('#dsTicks').dataset.r !== R.id) {
      $('#dsTicks').dataset.r = R.id;
      $('#dsTicks').innerHTML = juzStarts().map((p, j) => p > 1 ? `<u style="right:${((p - 1) / (n - 1) * 100).toFixed(2)}%"></u>` : '').join('');
    }
    if (panelOpen($('#sheet'))) put('#sheetSub', `${K.name} · ${META.riwayat.find(r => r.id === R.id)?.name || ''} · صفحة ${ar(S.page)}`);
    $('#dkNextPg').disabled = base(S.page) + (S.two ? 2 : 1) > n;
    $('#dkPrevPg').disabled = base(S.page) <= 1;
    // the surah list open beside the pages: the surah being read marked as the pages turn
    if (panelOpen($('#sheet')) && tab === 'suras' && !$('#q').value.trim()) {
      const s = R.ayas[pageInfo(S.page).first][0], was = $('#sheetBody .row.here'), now = $(`#sheetBody .row[data-go-sura="${s}"]`);
      if (now && was !== now) { was?.classList.remove('here'); now.classList.add('here'); now.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }
  }

  function enter() {
    if (!built) build();
    on = true;
    $('#dbSearch').prepend($('#sheet .search') || $('.search'));
    if (store.get('desk.tfw')) document.body.style.setProperty('--dk-tf', store.get('desk.tfw') + 'px');
    if (!store.get('desk.told', false)) { store.set('desk.told', true); setTimeout(() => toast('مرحبًا — اضغط ؟ لاختصارات لوحة المفاتيح', 4200), 1600); }
  }
  function leave() {
    on = false;
    if (!built) return;
    $('#sheet .sheet-head').after($('#dbSearch .search'));
    S.hover = null;
    document.querySelectorAll('.bar.pop').forEach(b => b.classList.remove('pop'));
    hide($('#deskHelp'));
  }

  // ---- an aya's card, a word's, a surah's: opened beside what was pressed, inside the pages' room
  const POPS = { ayaBar: () => 'a' + S.act, wordBar: () => WordCard.el(), suraBar: () => $('#sbTitle').textContent, recWord: () => $('#rwWord').textContent + $('#rwType').textContent };
  function anchorOf(b) {
    const key = POPS[b.id]();
    if (b._key !== key || !b._at?.el?.isConnected) {
      b._key = key;
      const fresh = performance.now() - at.t < 700 && at.el?.isConnected;
      let el = b.id === 'wordBar' ? WordCard.el() : fresh ? at.el : null;
      if (!el && b.id === 'ayaBar' && S.act != null) el = slots[1].querySelector(`.page[data-page="${S.page}"] .w[data-a="${S.act}"]`) || slots[1].querySelector(`.w[data-a="${S.act}"]`);
      b._at = el ? { el, x: fresh && b.id !== 'wordBar' && b.id !== 'suraBar' ? at.x : null } : null;
    }
    if (!b._at) return null;
    const r = b._at.el.getBoundingClientRect();
    if (!r.height) return null;
    return { x: b._at.x ?? (r.left + r.right) / 2, top: r.top, bottom: r.bottom };
  }
  function place(bars) {
    const st = $('#viewport').getBoundingClientRect(), m = 10;
    for (const b of bars) {
      b.style.setProperty('--lift', '0px');
      delete b.dataset.pin;
      if (!POPS[b.id]) continue;
      const a = anchorOf(b);
      b.classList.toggle('pop', !!a);
      if (!a) continue;
      const w = b.offsetWidth, h = b.offsetHeight, lo = st.top + m, hi = innerHeight - m;
      let x = Math.max(st.left + m, Math.min(st.right - w - m, a.x - w / 2));
      let y = a.bottom + 8;
      if (y + h > hi) y = a.top - h - 8;
      if (y < lo) { // no room under it or over it: beside it
        y = Math.max(lo, Math.min(hi - h, a.top - h / 3));
        x = a.x + 44 + w < st.right - m ? a.x + 44 : Math.max(st.left + m, a.x - 44 - w);
      }
      b.style.setProperty('--px', Math.round(x) + 'px');
      b.style.setProperty('--py', Math.round(y) + 'px');
    }
    document.querySelectorAll('.bar.pop[hidden]').forEach(b => { b._key = null; });
  }

  // ---- the size of the type, and one page or two
  const zoom = () => Math.max(DESK.zmin, Math.min(DESK.zmax, +store.get('desk.zoom', 1) || 1));
  function setZoom(z) {
    z = Math.max(DESK.zmin, Math.min(DESK.zmax, z));
    if (Math.abs(z - 1) < .04) z = 1;
    if (z === zoom()) return;
    // (the same lines kept in sight)
    const sc = slots[1], f = sc.scrollHeight > sc.clientHeight ? sc.scrollTop / sc.scrollHeight : 0;
    store.set('desk.zoom', +z.toFixed(3));
    renderAll();
    slots[1].scrollTop = f * slots[1].scrollHeight;
    toast(`حجم الخط ${ar(Math.round(z * 100))}٪`, 900);
  }
  function setTwo(two) {
    if (!!store.get('desk.two', true) === two) return;
    store.set('desk.two', two);
    renderAll();
    toast(two ? (S.two ? 'صفحتان متقابلتان' : 'صفحتان متى اتسعت النافذة لهما') : 'صفحة واحدة', 1300);
  }
  function theme() {
    const order = ['light', 'sepia', 'dark'], cur = store.get('theme', 'light');
    const next = order[(order.indexOf(cur) + 1) % order.length];
    store.set('theme', next); applyTheme();
    if (panelOpen($('#sheet')) && tab === 'settings') renderSheet();
    toast(`المظهر: ${THEME_NAME[next]}`, 1100);
  }
  // the whole screen: taken by itself as the reader comes in. A browser gives it only to a press
  // or a key, so it is at the first of either; left by the reader's own hand (F, its button), it
  // is not taken again until they ask (desk.full)
  function full() {
    store.set('desk.full', !document.fullscreenElement);
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  let fullAsked = false;
  function fullFirst(e) {
    if (fullAsked || !on || !document.fullscreenEnabled || document.fullscreenElement || !store.get('desk.full', true)) return;
    if (e.type === 'keydown' && (e.code === 'KeyF' || e.key === 'Escape' || e.key === 'F11' || e.ctrlKey || e.metaKey || e.altKey)) return;
    document.documentElement.requestFullscreen?.().then(() => { fullAsked = true; }, () => {});
  }

  // ---- the panels
  function panel(t) {
    const openNow = panelOpen($('#sheet')) && !panelOpen($('#library')) && !panelOpen($('#adhkar'));
    if (t === 'read') return $('#dockQuran').onclick();
    if (openNow && tab === t && !$('#q').value.trim()) return closeSheet();
    hide($('#library'));
    if (panelOpen($('#adhkar'))) Adhkar.close();
    bySearch = false;
    openSheet(t);
  }
  const sel = () => S.act ?? S.focus;
  function play() {
    if (!$('#recBar').hidden) return $('#recToggle').click();
    if (P.ai != null) return audio.paused ? audio.play() : audio.pause();
    playFrom(sel() ?? pageInfo(base(S.page)).first);
  }
  function mark() {
    if (S.act != null) toggleSave(S.act); else toggleBookmark(S.page);
  }
  // the aya chosen with the keys: lit, its card or its tafsir following if one is open
  function step(d) {
    let i = sel();
    if (i == null) i = d > 0 ? pageInfo(base(S.page)).first : pageInfo(shownPages().pop()).last; else i += d;
    if (i < 0 || i >= R.ayas.length) return;
    const p = R.ayas[i][2];
    if (p !== S.page) goTo(p, { animate: true });
    clearTimeout(flashT);
    at.t = 0;
    if (!$('#tafsir').hidden) openTafsir(i);
    else if (!$('#ayaBar').hidden) openActions(i);
    else { S.focus = i; paintMarks(); }
    slots[1].querySelector(`.w[data-a="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function sura(d) {
    const s = R.ayas[pageInfo(S.page).first][0], here = R.ayas[R.suraStart[s]][2];
    const t = d < 0 && here < base(S.page) ? s : s + d; // (back: this surah's beginning first)
    if (t >= 1 && t <= 114) goTo(R.ayas[R.suraStart[t]][2]);
  }
  async function copy(i) {
    const a = R.ayas[i], txt = R.text[i].replace(/\s*[٠-٩]+$/, '');
    try { await navigator.clipboard.writeText(`${txt} ﴿${suraName(a[0])}: ${ar(a[1])}﴾`); toast('تم النسخ'); } catch { toast('تعذر النسخ'); }
  }
  function focusSearch() { const q = $('#q'); q.focus(); q.select(); }

  function wire(size) {
    const vp = $('#viewport'), q = $('#q');
    $('#dbWhere').onclick = () => panel('suras');
    $('#deskRail').addEventListener('click', e => { const b = e.target.closest('[data-dr]'); if (b) panel(b.dataset.dr); });
    $('#dbPlay').onclick = play;
    $('#dbMic').onclick = () => $('#dockMic').onclick();
    $('#dbBm').onclick = mark;
    $('#dbTwo').onclick = () => setTwo(!store.get('desk.two', true));
    $('#dbOut').onclick = () => setZoom(zoom() / 1.1);
    $('#dbIn').onclick = () => setZoom(zoom() * 1.1);
    $('#dbZoom').onclick = () => setZoom(1);
    $('#dbSync').onclick = () => { if (!(panelOpen($('#sheet')) && tab === 'settings')) panel('settings'); setTimeout(() => $('#syncCard')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350); };
    $('#dbTheme').onclick = theme;
    $('#dbFull').onclick = full;
    $('#dbHelp').onclick = () => show($('#deskHelp'));
    $('#deskHelp').addEventListener('click', e => { if (e.target.id === 'deskHelp' || e.target.id === 'dhOk') hide($('#deskHelp')); });
    $('#dkNextPg').onclick = () => turn(1);
    $('#dkPrevPg').onclick = () => turn(-1);
    $('#dbSearch').addEventListener('click', e => { if (e.target !== q) focusSearch(); });
    for (const ev of ['play', 'pause', 'ended', 'emptied']) audio.addEventListener(ev, () => on && sync());
    new MutationObserver(() => on && sync()).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // the search in the top bar: what it finds listed in the panel beside the pages
    q.addEventListener('input', () => {
      if (!on) return;
      if (q.value.trim() && !(panelOpen($('#sheet')) && !panelOpen($('#library')) && !panelOpen($('#adhkar')))) {
        bySearch = !panelOpen($('#sheet'));
        hide($('#library')); if (panelOpen($('#adhkar'))) Adhkar.close();
        openSheet(tab, '', true);
      } else if (!q.value.trim() && bySearch) { bySearch = false; closeSheet(); }
    });
    q.addEventListener('keydown', e => {
      if (!on) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...document.querySelectorAll('#sheetBody .row')];
        if (!rows.length) return;
        const cur = rows.findIndex(r => r.classList.contains('kb'));
        const i = Math.max(0, Math.min(rows.length - 1, cur < 0 ? (e.key === 'ArrowDown' ? (rows.length > 1 ? 1 : 0) : 0) : cur + (e.key === 'ArrowDown' ? 1 : -1)));
        rows[cur]?.classList.remove('kb'); rows[i].classList.add('kb');
        rows[i].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') setTimeout(() => q.blur(), 0);
      else if (e.key === 'Escape') {
        e.stopPropagation();
        if (q.value) { q.value = ''; if (bySearch) { bySearch = false; closeSheet(); } else renderSheet(); }
        q.blur();
      }
    });

    // the press a card opens by; the aya under the mouse; a word clicked twice; the right button
    vp.addEventListener('pointerdown', e => { at = { x: e.clientX, y: e.clientY, t: performance.now(), el: e.target.closest?.('.w, .band') || null }; }, true);
    const hover = ai => { if (S.hover === ai) return; S.hover = ai; drawBands(slots[1]); };
    vp.addEventListener('mouseover', e => {
      if (!on) return;
      const w = e.target.closest?.('.w[data-a]');
      if (w) hover(Recite.active() ? null : +w.dataset.a);
      else if (!e.target.closest?.('.lines')) hover(null);
    });
    vp.addEventListener('mouseleave', () => hover(null));
    vp.addEventListener('dblclick', e => {
      const w = e.target.closest?.('.w:not(.end)');
      if (on && w && !Recite.active()) { at = { x: e.clientX, y: e.clientY, t: performance.now(), el: w }; WordCard.open(w); }
    });
    vp.addEventListener('contextmenu', e => {
      const w = e.target.closest?.('.w[data-a]');
      if (!on || !w || Recite.active() || !$('#tafsir').hidden) return;
      $('#ayaBar')._key = null;
      openActions(+w.dataset.a);
    });

    // the wheel: turns the pages (pages larger than the window: once at their end, a push more);
    // with Ctrl, the size of the type
    let acc = 0, last = 0, lock = false, lockT = 0, edge = false, zt = 0;
    vp.addEventListener('wheel', e => {
      if (!on) return;
      const now = performance.now(), gap = now - last;
      last = now;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (now - zt > 140 && e.deltaY) { zt = now; setZoom(zoom() * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }
        return;
      }
      const k = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1, dx = e.deltaX * k, dy = e.deltaY * k;
      const side = Math.abs(dx) > Math.abs(dy), sc = slots[1], can = sc.scrollHeight > sc.clientHeight + 2;
      const atEnd = dy > 0 ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2 : sc.scrollTop <= 1;
      if (gap > 160) { acc = 0; edge = !can || atEnd; if (lock && gap > 90) lock = false; }
      if (lock && now < lockT) { e.preventDefault(); return; }
      lock = false;
      if (!side && can && !(edge && atEnd)) return; // (the page itself scrolls)
      e.preventDefault();
      acc += side ? -dx : dy;
      const need = side ? 90 : can ? 260 : 50;
      if (Math.abs(acc) < need) return;
      const d = acc > 0 ? 1 : -1;
      acc = 0; lock = true; lockT = now + 900;
      if (turn(d) && d < 0 && !side) requestAnimationFrame(() => { slots[1].scrollTop = slots[1].scrollHeight; });
    }, { passive: false });

    // the line under the pages: every page of the mushaf along it, the first at the right
    const trk = $('#dsTrk'), tip = $('#dsTip');
    const pageAt = x => { const r = trk.getBoundingClientRect(); return 1 + Math.round(Math.max(0, Math.min(1, (r.right - x) / r.width)) * (R.pages.length - 1)); };
    let drag = false;
    const show_ = e => {
      const p = pageAt(e.clientX), a = R.ayas[pageInfo(p).first], r = $('#deskScrub').getBoundingClientRect();
      tip.textContent = `سورة ${suraName(a[0])} · صفحة ${ar(p)} · الجزء ${ar(a[3])}`;
      tip.hidden = false;
      tip.style.left = Math.max(tip.offsetWidth / 2 + 6, Math.min(r.width - tip.offsetWidth / 2 - 6, e.clientX - r.left)) + 'px';
      if (drag) { const f = (p - 1) / (R.pages.length - 1) * 100; $('#dsKnob').style.right = f + '%'; $('#dsFill').style.width = f + '%'; }
    };
    trk.addEventListener('pointermove', show_);
    trk.addEventListener('pointerleave', () => { if (!drag) tip.hidden = true; });
    trk.addEventListener('pointerdown', e => { drag = true; trk.classList.add('drag'); try { trk.setPointerCapture(e.pointerId); } catch {} show_(e); });
    const drop = e => { if (!drag) return; drag = false; trk.classList.remove('drag'); tip.hidden = true; if (e.type === 'pointerup') goTo(pageAt(e.clientX)); sync(); };
    trk.addEventListener('pointerup', drop);
    trk.addEventListener('pointercancel', drop);

    // the tafsir made wider or narrower by its edge
    let sz = null;
    size.addEventListener('pointerdown', e => { sz = e.pointerId; try { size.setPointerCapture(sz); } catch {} document.body.classList.add('dk-sizing'); e.preventDefault(); });
    size.addEventListener('pointermove', e => {
      if (sz == null) return;
      const w = Math.round(Math.max(300, Math.min(innerWidth * .5, 760, e.clientX)));
      document.body.style.setProperty('--dk-tf', w + 'px'); store.set('desk.tfw', w);
    });
    const szEnd = () => { sz = null; document.body.classList.remove('dk-sizing'); };
    size.addEventListener('pointerup', szEnd);
    size.addEventListener('pointercancel', szEnd);

    document.addEventListener('fullscreenchange', () => {
      const f = !!document.fullscreenElement;
      document.body.classList.toggle('dk-full', f);
      // (Esc closes what is open in the app, as ever, and does not leave the whole screen: held, it does)
      try { f ? navigator.keyboard?.lock?.(['Escape'])?.catch?.(() => {}) : navigator.keyboard?.unlock?.(); } catch {}
    });
    for (const ev of ['mousedown', 'keydown', 'touchend']) addEventListener(ev, fullFirst, true);
    deskMQ.addEventListener?.('change', () => { if (R) renderAll(); });
    document.addEventListener('keydown', keys);
  }

  function keys(e) {
    if (!on || !R || e.defaultPrevented) return;
    const t = e.target, typing = t.closest?.('input, textarea, select, [contenteditable]');
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'k' || k === 'K' || k === 'f' || k === 'F') && !e.altKey) { e.preventDefault(); focusSearch(); return; }
    if (typing || e.altKey) return;
    if (panelOpen($('#adhkar'))) return; // (its own keys: adhkar.js)
    if (k === 'Escape') {
      if (panelOpen($('#deskHelp'))) return hide($('#deskHelp'));
      if (window.closeTopCard?.()) return;
      if (document.querySelector('.modal:not([hidden]), .rc-found:not([hidden])')) return;
      if (!$('#wordBar').hidden) return WordCard.close();
      if (!$('#ayaBar').hidden || !$('#suraBar').hidden || !$('#tafsir').hidden) return closeActions();
      if (S.focus != null) { S.focus = null; return paintMarks(); }
      if (panelOpen($('#library'))) return hide($('#library'));
      if (panelOpen($('#sheet'))) return closeSheet();
      return;
    }
    // (a card over everything: its buttons only)
    if (document.querySelector('.modal:not([hidden]), .rc-found:not([hidden])')) return;
    const btn = t.closest?.('button, a, [role=button], summary');
    // (reciting, the space is the recitation's whatever button was pressed last)
    if (btn && k === ' ' && Recite.active() && !$('#recBar').hidden && !e.repeat) { e.preventDefault(); btn.blur(); return play(); }
    if (btn && (k === ' ' || k === 'Enter')) return;
    const done = () => e.preventDefault();
    if (mod) {
      if (k === 'ArrowLeft') { done(); sura(1); }
      else if (k === 'ArrowRight') { done(); sura(-1); }
      else if (k === '=' || k === '+') { done(); setZoom(zoom() * 1.1); }
      else if (k === '-') { done(); setZoom(zoom() / 1.1); }
      else if (k === '0') { done(); setZoom(1); }
      return;
    }
    const rec = Recite.active();
    switch (k) {
      case 'ArrowLeft': case 'PageDown': done(); turn(1); break;
      case 'ArrowRight': case 'PageUp': done(); turn(-1); break;
      case 'Home': done(); goTo(1); break;
      case 'End': done(); goTo(R.pages.length); break;
      case 'ArrowDown': case 'j': if (!rec) { done(); step(1); } break;
      case 'ArrowUp': case 'k': if (!rec) { done(); step(-1); } break;
      case 'Enter': if (!rec && sel() != null) { done(); at.t = 0; $('#ayaBar')._key = null; openActions(sel()); } break;
      case ' ': done(); if (!e.repeat) play(); break;
      case '/': done(); focusSearch(); break;
      case '?': case '؟': done(); show($('#deskHelp')); break;
      case '+': case '=': done(); setZoom(zoom() * 1.1); break;
      case '-': case '_': done(); setZoom(zoom() / 1.1); break;
      case '0': done(); setZoom(1); break;
      case '1': done(); setTwo(false); break;
      case '2': done(); setTwo(true); break;
      default: {
        // letters: by the key's place, so they work with an Arabic layout too
        const c = e.code;
        if (c === 'KeyF') { done(); full(); }
        else if (c === 'KeyD') { done(); theme(); }
        else if (c === 'KeyI') { done(); panel('suras'); }
        else if (c === 'KeyG') { done(); focusSearch(); }
        else if (c === 'KeyV') { done(); $('#dockMic').onclick(); }
        else if (rec) return;
        else if (c === 'KeyB') { done(); mark(); }
        else if (c === 'KeyN' && P.ai != null) { done(); $('#plNext').onclick(); }
        else if (c === 'KeyP' && P.ai != null) { done(); $('#plPrev').onclick(); }
        else if (sel() == null && ['KeyT', 'KeyM', 'KeyC', 'KeyR', 'KeyL'].includes(c)) { toast('اختر آية أولًا: انقرها أو استعمل ↓ ↑', 1500); }
        else if (c === 'KeyT') { done(); openTafsir(sel(), 'tafsir'); }
        else if (c === 'KeyM') { done(); openTafsir(sel(), 'similar'); }
        else if (c === 'KeyC') { done(); copy(sel()); }
        else if (c === 'KeyR') { done(); Recite.start(sel()); }
        else if (c === 'KeyL') { done(); const i = sel(); closeActions(); playFrom(i); }
      }
    }
  }

  // (before the first measure, so the pages are measured once, in the room they will have)
  if (deskMQ.matches) { document.body.classList.add('desk'); S.desk = true; enter(); }
  return { sync, place, on: () => on };
})();
