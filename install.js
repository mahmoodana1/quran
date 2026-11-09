'use strict';

// Install the app on the phone (or computer), whatever the browser.
// Where the browser has its own install dialog (Chrome, Edge, Samsung Internet on
// Android and computers), that is what opens: on a tap after a little reading, and
// from the row in settings. Browsers have none (Safari and every iPhone browser,
// Firefox), and there a card shows the steps for
// that very browser: Safari, Chrome, Edge and Firefox on iPhone/iPad; Chrome,
// Samsung Internet and Firefox on Android; Safari on Mac. Inside the Google app or a
// social app's browser, which can't install, the link is copied to open elsewhere.
// Offered once on its own after a little reading, then rarely; always in settings.

const Install = (() => {
  const ua = navigator.userAgent;
  const IOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ANDROID = /Android/i.test(ua);
  const OS = IOS ? 'ios' : ANDROID ? 'android' : 'desktop';
  const BROWSER =
    /GSA\//.test(ua) ? 'google'
    : /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|Snapchat|TikTok|musical_ly|Bytedance|WhatsApp|Telegram|; wv\)/i.test(ua) ? 'inapp'
    : IOS ? (/CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : /OPiOS|OPT\//.test(ua) ? 'other' : 'safari')
    : /SamsungBrowser/.test(ua) ? 'samsung'
    : /Firefox|FxA/.test(ua) ? 'firefox'
    : /EdgA?\//.test(ua) ? 'edge'
    : /OPR\/|Opera|YaBrowser|UCBrowser|MiuiBrowser|HuaweiBrowser/.test(ua) ? 'other'
    : /Chrome|CriOS|Chromium/.test(ua) ? 'chrome'
    : /Safari/.test(ua) ? 'safari'
    : 'other';

  // ---- the Android app (android/, released from the repository as an APK): the site in it
  // knows so by ?src=apk (its start address) for the visit; on Android elsewhere (a browser,
  // or the site added to the home screen) it is offered in a big card as the site opens, on
  // each of the first five visits until it is downloaded, and always from settings
  const APK_URL = 'https://github.com/mahmoodana1/quran/releases/latest/download/quran.apk';
  const IN_APK = (() => {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('src') === 'apk' || document.referrer.startsWith('android-app://')) sessionStorage.setItem('apk', '1');
      if (u.searchParams.has('src')) { u.searchParams.delete('src'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
      return sessionStorage.getItem('apk') === '1';
    } catch { return false; }
  })();
  const installed = () => IN_APK || matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches || navigator.standalone === true;
  const APK = ANDROID && !IN_APK;
  let apkVisit = false;  // (this visit's first page: the card may open on it)
  if (APK) try { if (!sessionStorage.getItem('apk.seen')) { sessionStorage.setItem('apk.seen', '1'); apkVisit = true; } } catch {}
  let deferred = null;   // the browser's own install dialog, once it offers one
  // browsers that have one (it comes as beforeinstallprompt once the app qualifies)
  const NATIVE = (ANDROID && ['chrome', 'edge', 'samsung'].includes(BROWSER)) || (OS === 'desktop' && ['chrome', 'edge'].includes(BROWSER));
  let view = OS;         // which device's steps are shown
  let auto = false;      // offered on its own (only those count towards asking again)

  // ---- icons, drawn like the buttons they stand for
  const I = {
    share: '<path d="M12 14.5V3.5M8.5 7L12 3.5 15.5 7"/><path d="M8 10H6.5A1.5 1.5 0 005 11.5v8A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5v-8a1.5 1.5 0 00-1.5-1.5H16"/>',
    add: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>',
    dots: '<circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/>',
    hdots: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
    screen: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 7.5v6M9.5 11l2.5 2.5 2.5-2.5"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2l-1.7 3.9-3.9 1.7 1.7-3.9z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
    wifi: '<path d="M3.5 9.5a12.5 12.5 0 0117 0M6.5 12.8a8 8 0 0111 0M9.5 16a3.5 3.5 0 015 0"/><path d="M4 4l16 16"/>',
    tap: '<path d="M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V11m0-.5a1.5 1.5 0 013 0v4.5a6 6 0 01-6 6h-.6a5 5 0 01-4-2l-3-4a1.5 1.5 0 012.3-1.9L9 15"/>',
  };
  const svg = (n, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${I[n]}</svg>`;
  // a key: the button's icon inline in the sentence, as it looks on screen
  const k = (n, label = '') => `<span class="in-k">${svg(n)}${label ? `<b>${label}</b>` : ''}</span>`;
  const q = s => `<b class="in-q">«${s}»</b>`;

  // ---- the steps, for each device and browser
  function steps(os, br) {
    const copyFirst = (where, then) => ({
      note: `هذا المتصفح داخل التطبيق لا يثبّت المواقع. انسخ الرابط وافتحه في ${where}:`,
      list: [
        `اضغط ${q('نسخ الرابط')} في الأسفل`,
        `افتح ${where} والصق الرابط في شريط العنوان`,
        then,
      ],
      copy: true,
    });
    if (os === 'ios') {
      if (br === 'google' || br === 'inapp') return copyFirst('Safari', `ثم ${k('share')} ← ${q('إضافة إلى الشاشة الرئيسية')}`);
      const share = {
        safari: `اضغط زر المشاركة ${k('share')} في شريط Safari — وإن لم تره فاضغط ${k('hdots')} أولًا`,
        chrome: `اضغط زر المشاركة ${k('share')} بجانب شريط العنوان أعلى الصفحة`,
        edge: `اضغط ${k('hdots')} أسفل الصفحة، ثم زر المشاركة ${k('share')}`,
        firefox: `اضغط القائمة ${k('menu')}، ثم ${q('مشاركة')} ${k('share')}`,
      }[br] || `افتح قائمة المتصفح، ثم ${q('مشاركة')} ${k('share')}`;
      return { list: [
        share,
        `مرّر للأسفل واختر ${k('add', 'إضافة إلى الشاشة الرئيسية')}`,
        `اضغط ${q('إضافة')} أعلى الشاشة — يظهر القرآن بين تطبيقاتك`,
      ], foot: br === 'other' ? 'إن لم تجد الخيار فافتح الموقع في Safari.' : '' };
    }
    if (os === 'android') {
      if (br === 'google') return {
        note: 'تطبيق Google لا يثبّت المواقع، فافتح الصفحة في Chrome:',
        list: [`اضغط ${k('dots')} أعلى الصفحة`, `اختر ${q('فتح في Chrome')}`, `ثم من Chrome: ${k('dots')} ← ${q('تثبيت التطبيق')}`],
        copy: true,
      };
      if (br === 'inapp') return copyFirst('Chrome', `ثم ${k('dots')} ← ${q('تثبيت التطبيق')}`);
      if (br === 'samsung') return { list: [
        `اضغط القائمة ${k('menu')} أسفل الشاشة`,
        `اختر ${q('إضافة الصفحة إلى')} ← ${q('الشاشة الرئيسية')}`,
        `اضغط ${q('إضافة')} — يظهر القرآن بين تطبيقاتك`,
      ] };
      if (br === 'firefox') return { list: [
        `اضغط ${k('dots')} بجانب شريط العنوان`,
        `اختر ${q('تثبيت')} أو ${k('add', 'إضافة إلى الشاشة الرئيسية')}`,
        `اضغط ${q('إضافة')} — يظهر القرآن بين تطبيقاتك`,
      ] };
      return { list: [
        `اضغط ${k('dots')} أعلى المتصفح`,
        `اختر ${k('screen', 'تثبيت التطبيق')} أو ${q('إضافة إلى الشاشة الرئيسية')}`,
        `اضغط ${q('تثبيت')} — يظهر القرآن بين تطبيقاتك`,
      ] };
    }
    // computers
    if (br === 'safari') return { list: [
      `من شريط القوائم اختر ${q('ملف')} (File)`,
      `ثم ${q('إضافة إلى Dock')} (Add to Dock)`,
      `اضغط ${q('إضافة')} — يفتح القرآن من Dock كتطبيق`,
    ] };
    if (br === 'firefox' || br === 'other') return {
      note: 'هذا المتصفح لا يثبّت المواقع على الحاسوب. افتح الموقع في Chrome أو Edge أو Safari (على Mac):',
      list: [`انسخ الرابط وافتحه هناك`, `اضغط ${k('screen')} في شريط العنوان`, `اختر ${q('تثبيت')}`],
      copy: true,
    };
    if (br === 'edge') return { list: [
      `اضغط ${k('screen')} في شريط العنوان، أو ${k('hdots')} ← ${q('التطبيقات')}`,
      `اختر ${q('تثبيت هذا الموقع كتطبيق')}`,
      `اضغط ${q('تثبيت')}`,
    ] };
    return { list: [
      `اضغط ${k('screen')} في شريط العنوان، أو ${k('dots')} ← ${q('الإرسال والحفظ والمشاركة')}`,
      `اختر ${q('تثبيت الصفحة كتطبيق')}`,
      `اضغط ${q('تثبيت')}`,
    ] };
  }

  // the browser to show for a device that isn't this one: its main one
  const mainBrowser = os => os === OS ? BROWSER : os === 'ios' ? 'safari' : 'chrome';
  const BR_NAME = { safari: 'Safari', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', samsung: 'Samsung Internet', google: 'تطبيق Google', inapp: 'متصفح داخل تطبيق', other: 'متصفحك' };
  const OS_NAME = { ios: 'آيفون وآيباد', android: 'أندرويد', desktop: 'الحاسوب' };

  function paint() {
    const card = $('#install .in-card');
    if (!card) return;
    const br = mainBrowser(view), here = view === OS;
    const oneTap = here && deferred;
    const s = oneTap ? null : steps(view, br);
    $('#inWhere').textContent = here ? `على ${OS_NAME[OS]} · ${BR_NAME[BROWSER]}` : `على ${OS_NAME[view]} · ${BR_NAME[br]}`;
    $('#inChips').innerHTML = ['ios', 'android', 'desktop'].map(o =>
      `<button data-in-os="${o}" class="${o === view ? 'on' : ''}">${svg(o === 'desktop' ? 'screen' : 'phone')}${OS_NAME[o]}</button>`).join('');
    $('#inSteps').innerHTML = oneTap
      ? `<p class="in-one">${svg('tap')}<span>اضغط ${q('ثبّت الآن')} ثم ${q('تثبيت')} — ويظهر القرآن بين تطبيقاتك.</span></p>`
      : `${s.note ? `<p class="in-note">${s.note}</p>` : ''}
         <ol class="in-list">${s.list.map((t, i) => `<li><i>${ar(i + 1)}</i><span>${t}</span></li>`).join('')}</ol>
         ${s.foot ? `<p class="in-note">${s.foot}</p>` : ''}`;
    // iPhone's Safari: an arrow down to its share button, and «أضفته» to stop asking
    $('#inPoint').hidden = !(here && OS === 'ios' && BROWSER === 'safari' && /iPhone|iPod/.test(ua));
    $('#inDone').hidden = !(here && OS === 'ios');
    // (popped up on its own on a phone: this phone's steps only, and the green plate small, all in sight)
    $('#install .in-other').hidden = auto && OS === 'ios';
    $('#install').classList.toggle('compact', auto && OS !== 'desktop');
    const go = $('#inGo');
    go.hidden = !(oneTap || (s && s.copy && here));
    go.innerHTML = oneTap ? `${svg('screen')}ثبّت الآن` : `${svg('copy')}نسخ الرابط`;
    go.dataset.do = oneTap ? 'install' : 'copy';
  }

  // the browser's own dialog; browsers open it only from a tap
  async function nativeAsk(byItself) {
    const p = deferred;
    deferred = null;
    try { await p.prompt(); } catch { deferred = p; return false; }
    const { outcome } = await p.userChoice.catch(() => ({}));
    if (outcome === 'accepted') store.set('install.done', true);
    else if (byItself) { store.set('install.later', Date.now()); store.set('install.asked', store.get('install.asked', 0) + 1); }
    return true;
  }

  async function open(byItself = false) {
    if (APK) { apkOpen(); return; }
    if (installed()) { toast('التطبيق مثبّت على جهازك'); return; }
    if (deferred && !byItself && await nativeAsk(false)) return;
    auto = byItself;
    view = OS;
    paint();
    show($('#install'));
  }
  function later() {
    if (auto) {
      store.set('install.later', Date.now());
      store.set('install.asked', store.get('install.asked', 0) + 1);
    }
    hide($('#install'));
  }

  async function act() {
    const go = $('#inGo');
    if (go.dataset.do === 'install' && deferred) {
      hide($('#install'));
      await nativeAsk(auto);
      return;
    }
    const url = location.origin + location.pathname;
    try { await navigator.clipboard.writeText(url); toast('نُسخ الرابط — الصقه في المتصفح'); }
    catch { prompt('انسخ الرابط:', url); }
  }

  // ---- when to offer it on its own: after a little reading, not over anything else,
  // then again a week after «لاحقًا», at most three times in all
  function due() {
    if (APK || IOS || installed() || store.get('install.done', false)) return false;  // (Android, iPhone: as the site opens, below)
    const asked = store.get('install.asked', 0), last = store.get('install.later', 0);
    return asked < 3 && Date.now() - last > 7 * 864e5;
  }
  function busy() {
    return [...document.querySelectorAll('.modal')].some(m => !m.hidden)
      || !$('#recBar').hidden || !$('#loading').hidden || !$('#sheet').hidden || !$('#adhkar').hidden || !$('#library').hidden;
  }
  // with a browser dialog: it opens on the reader's next tap (the tap still does what
  // it does), not in the middle of reciting or over another card
  let ripe = false, armed = false;
  function armTap() {
    if (armed || !deferred || !due()) return;
    armed = true;
    const onTap = () => {
      if (!deferred || !due()) { armed = false; return; }
      if ([...document.querySelectorAll('.modal')].some(m => !m.hidden) || !$('#recBar').hidden) {
        document.addEventListener('click', onTap, { capture: true, once: true });
        return;
      }
      armed = false;
      nativeAsk(true);
    };
    document.addEventListener('click', onTap, { capture: true, once: true });
  }
  function offerSoon(ms) {
    if (!due()) return;
    let tries = 0;
    const t = () => {
      if (!due()) return;
      ripe = true;
      if (deferred) { armTap(); return; }
      if (NATIVE) return;  // its dialog isn't offered (yet): armed when it is
      if (busy() && ++tries < 20) { setTimeout(t, 15000); return; }
      if (!busy()) open(true);
    };
    setTimeout(t, ms);
  }

  // ---- iPhone: added to the home screen, it is the app (full screen, offline, the microphone
  // too); its card opens as the site opens, on each of the first five visits until added
  let iosVisit = false;
  if (IOS && !installed()) try { if (!sessionStorage.getItem('ios.seen')) { sessionStorage.setItem('ios.seen', '1'); iosVisit = true; } } catch {}
  if (iosVisit && !store.get('install.done', false) && store.get('ios.shown', 0) < 5) {
    let tries = 0;
    const t = () => {
      if (busy() && ++tries < 40) { setTimeout(t, 4000); return; }
      if (busy()) return;
      store.set('ios.shown', store.get('ios.shown', 0) + 1);
      open(true);
    };
    setTimeout(t, 1500);
  }
  $('#inDone').onclick = () => { store.set('install.done', true); hide($('#install')); toast('افتح القرآن من شاشتك الرئيسية'); };

  // ---- the Android app's card
  function apkOpen() { show($('#apk')); }
  function apkLater() { hide($('#apk')); }
  $('#apkGo').href = APK_URL;
  $('#apkGo').onclick = () => {
    store.set('apk.got', true);
    $('#apk').classList.add('got');
    toast('يُحمَّل التطبيق — افتح الملف حين يكتمل');
  };
  $('#apkLater').onclick = apkLater;
  $('#apk').addEventListener('click', e => { if (e.target === $('#apk')) apkLater(); });
  if (apkVisit && !store.get('apk.got', false) && store.get('apk.shown', 0) < 5) {
    let tries = 0;
    const t = () => {
      if (busy() && ++tries < 40) { setTimeout(t, 4000); return; }
      if (busy()) return;
      store.set('apk.shown', store.get('apk.shown', 0) + 1);
      apkOpen();
    };
    setTimeout(t, 1500);
  }

  // ---- settings: a row to open it, while it isn't installed
  function settingsHTML() {
    if (installed() && !APK) return '';
    return `<button class="in-row" data-install>
      <span class="in-row-ico"><img src="icons/icon-192.png" alt=""></span>
      <span class="in-row-txt"><b>${APK ? 'حمّل تطبيق أندرويد' : IOS ? 'أضف التطبيق إلى شاشتك' : 'ثبّت التطبيق على جهازك'}</b><small>${APK ? 'القرآن بملء الشاشة، يتحدّث مع الموقع وحده' : 'يفتح من شاشتك الرئيسية بملء الشاشة ويعمل دون إنترنت'}</small></span>
      <svg viewBox="0 0 24 24" class="go"><path d="M14.5 6l-6 6 6 6"/></svg>
    </button>`;
  }

  // ---- wiring
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    if (IOS) return;  // (none there; only a desktop browser posing as one)
    deferred = e;
    if (!$('#install').hidden) paint();
    if (ripe) armTap();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    store.set('install.done', true);
    hide($('#install'));
    toast('تم التثبيت — تجد القرآن بين تطبيقاتك');
  });
  $('#inLater').onclick = later;
  $('#inGo').onclick = act;
  $('#install').addEventListener('click', e => {
    const o = e.target.closest('[data-in-os]');
    if (o) { view = o.dataset.inOs; paint(); return; }
    if (e.target === $('#install')) later();
  });
  $('#sheetBody').addEventListener('click', e => { if (e.target.closest('[data-install]')) open(); });
  offerSoon(30000);

  return { open: () => open(), settingsHTML, installed };
})();
