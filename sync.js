'use strict';

// Sync, for who wants it: signed in (a Google account, or an email and a password), what the reader
// keeps (khatmas and their bookmarks, the recitation's record, the reciter chosen for each riwaya,
// the memorizing lesson and how it is repeated, the adhkar counted, the prayer settings, the theme) is kept in their own place in a Firebase project too, and brought to every
// device they sign in on. Nothing is sent before signing in, and signing out leaves the device as it is.
//
// No Firebase SDK: its REST endpoints with fetch. The app's pages are served cross-origin isolated
// (sw.js), which rules out the SDK's sign-in popup, so Google's sign-in is a plain redirect to
// accounts.google.com and back with an ID token, exchanged for a Firebase session.
//
// What is kept there: users/<uid>/sync/main, one document: { key: { t: when it last changed, v: its
// value as stored } }; a value over BIG_AT is a document of its own (users/<uid>/big/<key>), named
// there by { t, big: true }. Each key goes to whoever changed it last (sync.mt: when, on this
// device); the khatmas are merged one by one, each to where it was read last.
// Uses $, store, ar, toast, esc, panelOpen, renderSheet, loadKhatmas, loadRiwaya, normalizeBookmarks,
// renderAll, applyTheme, UPD, P, S, K, R from app.js at call time.
const Sync = (() => {
  const CFG = {
    key: 'AIzaSyAi2yjHuXm5V6pJnqcKuFbdbSDBpVickVQ',
    project: 'quran-app-sync',
    client: '588501310040-rnsj35dr7r9mtfc4mt98i82kj6imklq8.apps.googleusercontent.com',
  };
  const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:', TOKEN = 'https://securetoken.googleapis.com/v1/token';
  const DOCS = `https://firestore.googleapis.com/v1/projects/${CFG.project}/databases/(default)/documents`;
  const BIG_AT = 60e3, TOO_BIG = 900e3, PUSH_MS = 4000, AGAIN_MS = 20e3;
  // what goes with the reader from device to device (not what belongs to the device: the model
  // chosen, the look of this screen, what was open)
  const SYNCED = /^(khatmas|kh\.current|kh\.gone|theme|adhkar|adhkar\.size|adhkar\.more|pray|mu\.pace|mu\.paceT|voice\..+|hifz\.(?!open$).+|recite\.(?!view$|barUp$|model$|light$|editS$|editFrom$|live\.).+)$/;
  const ls = { get: (k, d) => { try { const v = localStorage.getItem('q.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('q.' + k, JSON.stringify(v)); } catch {} } };
  let auth = ls.get('sync.auth', null);   // { uid, email, refresh, id, exp }
  let mt = ls.get('sync.mt', {});         // key -> when it last changed here
  let state = auth ? 'idle' : 'out', err = '', applying = false, running = null, pushT = 0, lastRun = 0, form = null;

  // ---- every change of a kept value noted, and sent a moment later
  const set0 = store.set;
  store.set = (k, v) => {
    const key = 'q.' + k, was = SYNCED.test(k) && !applying ? localStorage.getItem(key) : undefined;
    set0(k, v);
    if (was !== undefined && localStorage.getItem(key) !== was) { mt[k] = Date.now(); ls.set('sync.mt', mt); later(); }
  };
  function later(ms = PUSH_MS) { if (!auth) return; clearTimeout(pushT); pushT = setTimeout(run, ms); }

  // ---- the session
  async function post(url, body, form) {
    const r = await fetch(url, form ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error?.message || 'HTTP ' + r.status), { status: r.status, code: j.error?.message || '' });
    return j;
  }
  function signedIn(j) {
    auth = { uid: j.localId || j.user_id, email: j.email || auth?.email || '', refresh: j.refreshToken || j.refresh_token, id: j.idToken || j.id_token, exp: Date.now() + (+(j.expiresIn || j.expires_in) || 3600) * 1000 - 60e3 };
    ls.set('sync.auth', auth);
  }
  async function token() {
    if (!auth) throw new Error('out');
    if (Date.now() < auth.exp) return auth.id;
    try { signedIn(await post(`${TOKEN}?key=${CFG.key}`, { grant_type: 'refresh_token', refresh_token: auth.refresh }, true)); }
    catch (e) { if (e.status === 400 || e.status === 401 || e.status === 403) { signOut(true); throw new Error('expired'); } throw e; }
    return auth.id;
  }
  const MSG = {
    EMAIL_EXISTS: 'لهذا البريد حساب — ادخل به', EMAIL_NOT_FOUND: 'لا حساب بهذا البريد', INVALID_PASSWORD: 'كلمة السر غير صحيحة',
    INVALID_LOGIN_CREDENTIALS: 'البريد أو كلمة السر غير صحيحة', INVALID_EMAIL: 'اكتب بريدًا صحيحًا', MISSING_PASSWORD: 'اكتب كلمة السر',
    WEAK_PASSWORD: 'كلمة السر ستة أحرف على الأقل', TOO_MANY_ATTEMPTS_TRY_LATER: 'محاولات كثيرة — حاول بعد قليل', USER_DISABLED: 'هذا الحساب موقوف',
  };
  const say = e => MSG[(e.code || '').split(' ')[0]] || (navigator.onLine === false ? 'لا اتصال بالإنترنت' : 'تعذّر — حاول مرة أخرى');
  async function email(kind, mail, pass) {
    signedIn(await post(`${AUTH}${kind === 'new' ? 'signUp' : 'signInWithPassword'}?key=${CFG.key}`, { email: mail, password: pass, returnSecureToken: true }));
    began();
  }
  // Google: away to its sign-in page and back here with an ID token in the address (start())
  const home = () => new URL('./', location.href).href.split(/[?#]/)[0];
  function google() {
    const nonce = crypto.getRandomValues(new Uint32Array(4)).join('');
    try { sessionStorage.setItem('q.sync.nonce', nonce); } catch {}
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: CFG.client, redirect_uri: home(), response_type: 'id_token', scope: 'openid email profile', nonce, state: 'q-sync', prompt: 'select_account' });
  }
  async function back() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('state') !== 'q-sync') return;
    history.replaceState(null, '', location.pathname + location.search);
    const idt = h.get('id_token');
    if (!idt) return;
    let nonce = ''; try { nonce = sessionStorage.getItem('q.sync.nonce') || ''; sessionStorage.removeItem('q.sync.nonce'); } catch {}
    try {
      const claims = JSON.parse(decodeURIComponent(escape(atob(idt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
      if (!nonce || claims.nonce !== nonce) throw new Error('nonce');
      signedIn(await post(`${AUTH}signInWithIdp?key=${CFG.key}`, { postBody: 'id_token=' + encodeURIComponent(idt) + '&providerId=google.com', requestUri: home(), returnSecureToken: true }));
      began();
    } catch (e) { toast('تعذّر الدخول بحساب Google — حاول مرة أخرى', 3500); }
  }
  function began() {
    form = null; state = 'idle'; err = ''; paint();
    toast(`دخلت — تُزامَن بياناتك (${auth.email})`, 2600);
    run();
  }
  function signOut(expired) {
    auth = null; ls.set('sync.auth', null); clearTimeout(pushT);
    state = 'out'; err = expired ? 'انتهت الجلسة — ادخل من جديد' : ''; paint();
  }

  // ---- the place kept in Firebase
  async function api(method, path, body, query = '') {
    for (let again = 0; ; again++) {
      const r = await fetch(`${DOCS}/users/${auth.uid}/${path}${query}`, { method, headers: { Authorization: 'Bearer ' + await token(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401 && !again) { auth.exp = 0; continue; }
      if (r.status === 404 && method === 'GET') return null;
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error?.message || 'HTTP ' + r.status), { status: r.status, code: j.error?.status || '' });
      return j;
    }
  }
  const bigPath = k => 'big/' + encodeURIComponent(k);

  // the khatmas of two devices: each one as it is where it was read last; one deleted anywhere, gone
  function mergeKh(a, b, gone) {
    const by = new Map();
    for (const k of [...a, ...b]) { if (!k?.id || gone.includes(k.id)) continue; const o = by.get(k.id); if (!o || (k.read || 0) > (o.read || 0)) by.set(k.id, k); }
    return [...by.values()].sort((x, y) => (x.created || 0) - (y.created || 0));
  }
  const parse = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
  const busy = () => (typeof UPD !== 'undefined' && UPD.busy()) || (typeof P !== 'undefined' && P.ai != null);

  function run() {
    if (!auth) return Promise.resolve();
    if (running) return running.then(() => later(500));
    clearTimeout(pushT);
    // (never under a recitation or a listening: what comes may turn the page)
    if (busy()) { later(AGAIN_MS); return Promise.resolve(); }
    state = 'run'; err = ''; paint();
    running = once().then(() => { state = 'idle'; lastRun = Date.now(); ls.set('sync.at', lastRun); },
      e => { state = auth ? 'fail' : 'out'; err = auth ? (navigator.onLine === false ? 'لا اتصال — تُزامَن حين يعود' : 'تعذّرت المزامنة — نحاول لاحقًا') : err; if (auth) later(60e3); })
      .then(() => { running = null; paint(); });
    return running;
  }
  async function once(tries = 0) {
    const doc = await api('GET', 'sync/main');
    const remote = doc ? parse(doc.fields?.s?.stringValue, {}) : {};
    const forced = localStorage.getItem('q.sync.push') === '1'; // (a backup just restored: it is what counts)
    const local = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('q.') && SYNCED.test(k.slice(2))) local[k.slice(2)] = localStorage.getItem(k); }
    const now = Date.now(), next = { ...remote }, take = {}, bigs = [];
    let push = false;
    const give = (k, v, t) => {
      push = true; mt[k] = t;
      if (v.length > TOO_BIG) return; // (kept on the device only)
      if (v.length > BIG_AT) { next[k] = { t, big: true }; bigs.push([k, v, t]); } else next[k] = { t, v };
    };
    // a device signing in for the first time, its own khatma never read in: the reader's khatmas
    // take its place (not a second «ختمتي» beside theirs), opened where they were left
    const untouched = k => (k.page || 1) <= 1 && !k.bookmarks?.length && !(k.pages || '').includes('1') && !k.done;
    const lk0 = parse(local.khatmas, []), fresh = !forced && ls.get('sync.met', '') !== auth.uid && remote.khatmas && lk0.some(untouched) && parse(remote.khatmas.v, []).length > 0;
    for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      if (!SYNCED.test(k) || k === 'khatmas' || k === 'kh.gone') continue;
      const r = remote[k], l = local[k];
      const lt = l == null || (fresh && k === 'kh.current') ? 0 : forced ? now : mt[k] || (r ? 1 : now);
      if (r && r.t > lt) take[k] = r; else if (l != null && (!r || lt > r.t)) give(k, l, lt);
    }
    for (const k of Object.keys(take)) if (take[k].big) { const d = await api('GET', bigPath(k)); take[k] = { t: take[k].t, v: d?.fields?.v?.stringValue }; if (take[k].v == null) delete take[k]; }
    // the khatmas, merged
    const rk = remote.khatmas, rg = parse(remote['kh.gone']?.v, []), lg = parse(local['kh.gone'], []);
    const gone = [...new Set([...lg, ...rg])];
    if (gone.length !== rg.length) give('kh.gone', JSON.stringify(gone), now);
    if (gone.length !== lg.length) take['kh.gone'] = { t: now, v: JSON.stringify(gone) };
    const lk = fresh ? lk0.filter(k => !untouched(k)) : lk0, rkv = rk ? parse(rk.v, []) : [];
    const merged = forced ? lk : mergeKh(lk, rkv, gone), ms = JSON.stringify(merged);
    if (merged.length && (!rk || ms !== JSON.stringify(rkv))) give('khatmas', ms, now);
    if (ms !== local.khatmas && merged.length) take.khatmas = { t: now, v: ms };
    else mt.khatmas ||= now;

    if (push) {
      for (const [k, v, t] of bigs) await api('PATCH', bigPath(k), { fields: { v: { stringValue: v }, t: { integerValue: String(t) } } });
      try {
        await api('PATCH', 'sync/main', { fields: { s: { stringValue: JSON.stringify(next) }, t: { integerValue: String(now) } } },
          doc ? '?currentDocument.updateTime=' + encodeURIComponent(doc.updateTime) : '?currentDocument.exists=false');
      } catch (e) {
        // (another device wrote meanwhile: looked at again, from the start)
        if ((e.status === 400 || e.status === 409 || e.code === 'FAILED_PRECONDITION' || e.code === 'ALREADY_EXISTS') && tries < 3) return once(tries + 1);
        throw e;
      }
    }
    if (forced) localStorage.removeItem('q.sync.push');
    ls.set('sync.met', auth.uid);
    const got = Object.keys(take).filter(k => take[k].v !== local[k]);
    applying = true;
    try { for (const k of Object.keys(take)) { try { localStorage.setItem('q.' + k, take[k].v); } catch {} mt[k] = take[k].t; } } finally { applying = false; }
    ls.set('sync.mt', mt);
    if (got.length) await show_(got);
  }
  // what came from another device, shown: the khatma where it was left, the theme, the panel open
  async function show_(keys) {
    if (typeof R === 'undefined' || !R) return;
    applying = true;
    try {
      if (keys.includes('khatmas') || keys.includes('kh.current')) {
        const was = K && { id: K.id, page: K.page, r: K.riwaya };
        loadKhatmas();
        if (!was || was.id !== K.id || was.page !== K.page || was.r !== K.riwaya || keys.includes('khatmas')) {
          try { R = await loadRiwaya(K.riwaya); } catch { return; }
          S.page = Math.min(K.page || 1, R.pages.length);
          S.act = S.focus = null;
          normalizeBookmarks();
          renderAll();
          if (was && (was.id !== K.id || was.page !== K.page)) toast(`من جهازك الآخر: ${K.name} · صفحة ${ar(K.page)}`, 2600);
        }
      }
      if (keys.includes('theme')) applyTheme();
      // another reciter chosen there: what is saved of him counted again, his name in the player
      for (const k of keys) if (k.startsWith('voice.')) { delete AS[k.slice(6)]; if (P.ai != null && k === 'voice.' + R.id) showPlayer(); }
      if (panelOpen($('#sheet')) && !$('#q').value.trim() && !$('#syncForm')) { const b = $('#sheetBody'), y = b.scrollTop; renderSheet(); b.scrollTop = y; }
    } finally { applying = false; }
  }

  // ---- its card in the settings
  const CLOUD = '<svg viewBox="0 0 24 24"><path d="M7 18.5a4.5 4.5 0 01-.6-8.96 6 6 0 0111.5 1.5A3.75 3.75 0 0117.25 18.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const GOOGLE = '<svg viewBox="0 0 24 24" class="sy-g"><path fill="#4285F4" d="M21.6 12.23c0-.68-.06-1.34-.17-1.97H12v3.73h5.39a4.6 4.6 0 01-2 3.02v2.5h3.24c1.9-1.75 2.97-4.32 2.97-7.28z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.76-5.6-4.12H3.06v2.58A10 10 0 0012 22z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 010-3.8V7.52H3.06a10 10 0 000 8.96z"/><path fill="#EA4335" d="M12 5.98c1.47 0 2.78.5 3.82 1.5l2.86-2.86A9.97 9.97 0 0012 2 10 10 0 003.06 7.52L6.4 10.1c.8-2.36 3-4.12 5.6-4.12z"/></svg>';
  const when = t => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'الآن' : m < 60 ? `قبل ${ar(m)} د` : m < 1440 ? `قبل ${ar(Math.round(m / 60))} س` : `قبل ${ar(Math.round(m / 1440))} يوم`; };
  function inner() {
    if (auth) {
      const at = lastRun || ls.get('sync.at', 0);
      const sub = state === 'run' ? 'تجري المزامنة…' : state === 'fail' ? err : at ? `آخر مزامنة ${when(at)}` : 'لم تُزامَن بعد';
      return `<div class="sy-top"><span class="sy-ico on">${CLOUD}</span><span class="sy-txt"><b>المزامنة تعمل</b><small dir="ltr">${esc(auth.email || '')}</small><small class="${state === 'fail' ? 'sy-err' : ''}">${sub}</small></span></div>
        <div class="sy-acts"><button data-sync="now" class="primary"${state === 'run' ? ' disabled' : ''}>زامن الآن</button><button data-sync="out">تسجيل الخروج</button></div>`;
    }
    const head = `<div class="sy-top"><span class="sy-ico">${CLOUD}</span><span class="sy-txt"><b>المزامنة بين أجهزتك</b><small>ادخل بحسابك، فتنتقل ختماتك وعلاماتك وتقدّم التسميع والأذكار بين هاتفك وحاسوبك. اختيارية: دونها يبقى كل شيء على هذا الجهاز وحده.</small>${err ? `<small class="sy-err">${err}</small>` : ''}</span></div>`;
    if (!form) return head + `<div class="sy-acts col"><button data-sync="google" class="sy-google">${GOOGLE}المتابعة بحساب Google</button><button data-sync="mail">أو ببريد وكلمة سر</button></div>`;
    return head + `<form id="syncForm" class="sy-form" autocomplete="on">
        <input name="email" type="email" inputmode="email" autocomplete="username" placeholder="البريد الإلكتروني" dir="ltr" required value="${esc(form.mail || '')}">
        <input name="password" type="password" autocomplete="current-password" placeholder="كلمة السر" dir="ltr" minlength="6" required>
        ${form.msg ? `<small class="sy-err">${form.msg}</small>` : ''}
        <div class="sy-acts"><button type="submit" class="primary" data-kind="in"${form.wait ? ' disabled' : ''}>دخول</button><button type="submit" data-kind="new"${form.wait ? ' disabled' : ''}>حساب جديد</button></div>
        <div class="sy-links"><button type="button" data-sync="forgot">نسيت كلمة السر</button><button type="button" data-sync="google">بحساب Google</button><button type="button" data-sync="cancel">إلغاء</button></div>
      </form>`;
  }
  const settingsHTML = () => `<div class="group-label">المزامنة</div><div class="group sy-card" id="syncCard">${inner()}</div>`;
  function paint() {
    const c = $('#syncCard');
    if (c) c.innerHTML = inner();
    document.body.classList.toggle('sync-on', !!auth);
    document.body.dataset.syncState = state;
  }
  async function submit(f, kind) {
    const mail = f.email.value.trim(), pass = f.password.value;
    form = { mail, wait: true }; paint();
    try { await email(kind, mail, pass); }
    catch (e) { form = { mail, msg: say(e) }; paint(); }
  }
  function onClick(e) {
    const b = e.target.closest('#syncCard [data-sync]');
    if (!b) return !!e.target.closest('#syncCard form');
    const a = b.dataset.sync;
    if (a === 'google') google();
    else if (a === 'mail') { form = {}; err = ''; paint(); $('#syncForm')?.email.focus(); }
    else if (a === 'cancel') { form = null; paint(); }
    else if (a === 'now') run().then(() => { if (state === 'idle') toast('تمت المزامنة'); });
    else if (a === 'out') { if (b.dataset.armed) signOut(); else { b.dataset.armed = '1'; b.textContent = 'اضغط مرة أخرى للخروج'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'تسجيل الخروج'; } }, 2500); } }
    else if (a === 'forgot') {
      const mail = $('#syncForm')?.email.value.trim();
      if (!mail) { form = { msg: 'اكتب بريدك أولًا' }; paint(); return true; }
      post(`${AUTH}sendOobCode?key=${CFG.key}`, { requestType: 'PASSWORD_RESET', email: mail }).then(() => { form = { mail, msg: 'أرسلنا إلى بريدك رابطًا لتغيير كلمة السر' }; paint(); }, e2 => { form = { mail, msg: say(e2) }; paint(); });
    }
    return true;
  }
  document.addEventListener('submit', e => {
    if (e.target.id !== 'syncForm') return;
    e.preventDefault();
    submit(e.target, e.submitter?.dataset.kind === 'new' ? 'new' : 'in');
  });

  // ---- when: as the app opens and comes back to the front, after a change, as it leaves
  document.addEventListener('visibilitychange', () => {
    if (!auth) return;
    if (document.hidden) { if (pushT) { clearTimeout(pushT); pushT = 0; run(); } }
    else if (Date.now() - lastRun > AGAIN_MS) run();
  });
  addEventListener('online', () => { if (auth && state === 'fail') run(); });
  function start() { paint(); back().then(() => { if (auth && !running) run(); }); }

  return { settingsHTML, onClick, start, run, signedIn: () => !!auth, state: () => state };
})();
