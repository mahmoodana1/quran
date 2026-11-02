'use strict';

// Adhkar from Hisn al-Muslim (data/adhkar.json, built by tools/adhkar.py).
// The panel lists every chapter; a chapter opens as cards, one dhikr each,
// counted down by tapping. Swipe to move on without counting, or hold the
// counter to finish one. Counts are kept for the day.
// Uses $, store, ar, esc, show, hide and toast from app.js at call time.
const Adhkar = (() => {
  const VERSION = 2; // bump with data/adhkar.json
  const URL_ = `data/adhkar.json?v=${VERSION}`;
  let D = null, loading = null;
  const byId = {};

  function load() {
    return loading ||= fetch(URL_)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => {
        D = d;
        d.cats.forEach(c => {
          byId[c.id] = c;
          c.core = c.items;
          c.more?.forEach(it => { it.x = 1; });
          applyMore(c);
        });
        return d;
      })
      .catch(e => { loading = null; throw e; });
  }

  // optional authentic additions after a daily chapter, on per chapter;
  // they come after the book's adhkar, so counts kept by index stay put
  const moreOn = c => !!store.get('adhkar.more', {})[c.id];
  function applyMore(c) { c.items = c.more?.length && moreOn(c) ? c.core.concat(c.more) : c.core; }
  function setMore(c, on) {
    const m = store.get('adhkar.more', {});
    if (on) m[c.id] = true; else delete m[c.id];
    store.set('adhkar.more', m);
    applyMore(c);
  }

  // ---------------------------------------------------------------- progress
  // remaining count of every dhikr touched today: { day, c: { cat: { i: n } } }
  let P = null;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function prog() {
    if (!P) P = store.get('adhkar', null);
    if (!P || P.day !== today()) P = { day: today(), c: {} };
    return P;
  }
  const left = (cat, i) => prog().c[cat.id]?.[i] ?? cat.items[i].c;
  function setLeft(cat, i, n) { (prog().c[cat.id] ||= {})[i] = n; store.set('adhkar', P); }
  const doneOf = cat => cat.items.reduce((n, _, i) => n + (left(cat, i) === 0), 0);
  const started = cat => !!prog().c[cat.id];
  function reset(cat) { delete prog().c[cat.id]; store.set('adhkar', P); }

  // ---------------------------------------------------------------- list

  const ICON = {
    morning: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
    evening: '<path d="M19.5 14.6A8 8 0 019.4 4.5a8 8 0 1010.1 10.1z"/><path d="M17 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke="none"/>',
    prayer: '<path d="M4 20.5h16M6 20.5V11a6 6 0 0112 0v9.5M12 5V2.8M9.5 20.5v-4.5a2.5 2.5 0 015 0v4.5"/>',
    sleep: '<path d="M3.5 17.5h17M5 17.5v-5.5h14v5.5M5 12V8.5a2 2 0 012-2h3a2 2 0 012 2V12M3.5 20v-2.5M20.5 20v-2.5"/>',
    waking: '<path d="M3.5 18h17M7 18a5 5 0 0110 0M12 7.5v3M5.2 10.7l2 1.6M18.8 10.7l-2 1.6"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" class="dk-ico">${ICON[name]}</svg>`;

  // "٣ أذكار", "ذكران", "١١ ذكرًا"
  function nItems(n) {
    if (n === 1) return 'ذكر واحد';
    if (n === 2) return 'ذكران';
    return `${ar(n)} ${n <= 10 ? 'أذكار' : 'ذكرًا'}`;
  }

  const plain = t => t.replace(/[ً-ْٰۖ-ۭ]/g, '');
  const preview = cat => {
    const seg = cat.items[0].s.find(([k]) => k === 's' || k === 'q') || cat.items[0].s[0];
    return esc(seg[1]);
  };

  function state(cat) {
    const d = doneOf(cat), n = cat.items.length;
    return { d, n, all: d === n, pct: d / n };
  }

  function heroHTML(cat, now) {
    const s = state(cat);
    return `<button class="dk-hero${now ? ' now' : ''}${s.all ? ' all' : ''}" data-dk="${cat.id}">
      ${now ? '<span class="dk-now">وقتها الآن</span>' : ''}
      ${svg(cat.id)}
      <b>${cat.t.replace('أذكار ', '')}</b>
      <small>${s.all ? 'تمّت بحمد الله ✓' : s.d ? `${ar(s.d)} من ${ar(s.n)}` : nItems(s.n)}</small>
      <span class="dk-bar"><i style="width:${(s.pct * 100).toFixed(1)}%"></i></span>
    </button>`;
  }

  function tileHTML(cat) {
    const s = state(cat);
    return `<button class="dk-tile${s.all ? ' all' : ''}" data-dk="${cat.id}">
      ${svg(cat.id)}<b>${cat.t.replace('أذكار ', '')}</b>
      <small>${s.all ? '✓' : s.d ? `${ar(s.d)}/${ar(s.n)}` : nItems(s.n)}</small>
    </button>`;
  }

  function rowHTML(cat, extra = '', sub = null, at = null) {
    const s = state(cat);
    const mark = s.all ? '<span class="check">✓</span>' : s.d ? `<span class="dk-part">${ar(s.d)}/${ar(s.n)}</span>` : '';
    return `<button class="row dk-row${extra}" data-dk="${cat.id}"${at != null ? ` data-dk-i="${at}"` : ''}>
      <span class="num">${ar(s.n)}</span>
      <span class="main"><span class="t">${cat.t}</span><span class="s dk-prev">${sub ?? preview(cat)}</span></span>${mark}
    </button>`;
  }

  function listHTML() {
    const [daily, ...groups] = D.groups;
    const h = new Date().getHours();
    const now = h >= 3 && h < 12 ? 'morning' : h >= 15 || h < 3 ? 'evening' : null;
    const [m, e, ...rest] = daily.cats.map(id => byId[id]);
    let html = `<div class="dk-heroes">${heroHTML(m, now === 'morning')}${heroHTML(e, now === 'evening')}</div>
      <div class="dk-tiles">${rest.map(tileHTML).join('')}</div>`;
    for (const g of groups) {
      html += `<div class="group-label">${g.t}</div><div class="group">${g.cats.map(id => rowHTML(byId[id])).join('')}</div>`;
    }
    return html + `<p class="note dk-cite">النصوص والتخريج من كتاب «${D.source}»${D.more ? `، والإضافات الاختيارية ${D.more}` : ''}</p>`;
  }

  async function mount(el) {
    if (!D) {
      el.innerHTML = '<div class="tf-wait">…</div>';
      try { await load(); } catch {
        if (el.isConnected) el.innerHTML = '<div class="empty"><b>تعذّر تحميل الأذكار</b>تحقق من الاتصال، أو حمّل التطبيق كاملًا من الإعدادات.</div>';
        return;
      }
      if (!el.isConnected) return;
    }
    el.innerHTML = listHTML();
  }

  // titles and text, diacritics-insensitive; best: title matches first
  function searchHTML(q) {
    if (!D) { load().catch(() => {}); return '<div class="tf-wait">…</div>'; }
    const n = s => plain(s).replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
    const words = n(q.trim()).split(/\s+/).filter(Boolean);
    const hits = [];
    for (const cat of D.cats) {
      const t = n(cat.t);
      if (words.every(w => t.includes(w))) { hits.push({ cat, score: 2 }); continue; }
      cat.items.some((it, i) => {
        const text = it.s.map(x => x[1]).join(' ');
        if (!words.every(w => n(text).includes(w))) return false;
        hits.push({ cat, at: i, score: 1, text });
        return true;
      });
    }
    if (!hits.length) return '<div class="empty"><b>لا توجد نتائج</b>جرّب كلمة أخرى من الذكر أو اسم الباب.</div>';
    hits.sort((a, b) => b.score - a.score);
    return '<div class="group">' + hits.slice(0, 50).map((x, k) =>
      rowHTML(x.cat, k ? '' : ' best', x.text ? esc(x.text) : null, x.at)).join('') + '</div>';
  }

  // ---------------------------------------------------------------- reader

  let cat = null, idx = 0, advT = null;
  const SIZES = ['s', 'm', 'l'];
  const RING = 2 * Math.PI * 44;

  function open(id, at) {
    cat = byId[id];
    if (!cat) return;
    const first = cat.items.findIndex((_, i) => left(cat, i) > 0);
    idx = at ?? (first < 0 ? 0 : first);
    $('#dkTitle').textContent = cat.t;
    $('#adhkar').dataset.size = store.get('adhkar.size', 'm');
    const stage = $('#dkStage');
    stage.replaceChildren(card(idx));
    paint();
    show($('#adhkar'));
  }

  function close() {
    clearTimeout(advT);
    hide($('#adhkar'));
    const list = $('#adhkarList');
    if (list) list.innerHTML = listHTML();
  }

  function card(i) {
    const el = document.createElement('article');
    el.className = 'dk-card';
    if (i >= cat.items.length) {
      const s = state(cat);
      el.classList.add('dk-end');
      el.innerHTML = `<div class="dk-end-in">
        <svg viewBox="0 0 64 64" class="dk-medal"><g fill="none" stroke="currentColor" stroke-width="1.4"><rect x="14" y="14" width="36" height="36" rx="3"/><rect x="14" y="14" width="36" height="36" rx="3" transform="rotate(45 32 32)"/><circle cx="32" cy="32" r="13"/></g><path d="M25.5 32.5l4.5 4.5 8.5-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h2>${s.all ? `تمّت ${cat.t}` : `أتممت ${ar(s.d)} من ${ar(s.n)}`}</h2>
        <p>${s.all ? 'تقبّل الله منك، وجعلها لك حرزًا ونورًا' : 'يمكنك الرجوع إلى ما فاتك، أو الاكتفاء بما قرأت'}</p>
        ${s.all && cat.more?.length && !moreOn(cat) ? moreOfferHTML() : ''}
        <div class="actions">
          ${s.all ? '' : '<button class="primary" data-dk-act="missed">أكمل ما فاتك</button>'}
          <button class="${s.all && !(cat.more?.length && !moreOn(cat)) ? 'primary' : ''}" data-dk-act="back">العودة إلى الأذكار</button>
          <button data-dk-act="again">البدء من جديد</button>
          ${cat.more?.length && moreOn(cat) ? '<button class="dk-more-off" data-dk-act="more-off">إزالة الأذكار الإضافية</button>' : ''}
        </div></div>`;
      return el;
    }
    const it = cat.items[i];
    let html = '', para = '';
    const flush = () => { if (para) html += `<p class="dk-say">${para}</p>`; para = ''; };
    for (const [k, t] of it.s) {
      if (k === 's') para += (para ? ' ' : '') + esc(t);
      else if (k === 'o') para += ` <span class="dk-o">${esc(t)}</span>`;
      else {
        flush();
        html += k === 'q' ? `<p class="dk-q"><i class="dk-orn">﴿</i>${esc(t)}<i class="dk-orn">﴾</i></p>` : `<p class="dk-n">${esc(t)}</p>`;
      }
    }
    flush();
    el.innerHTML = `<div class="dk-in">
      ${it.x ? '<span class="dk-badge">إضافة</span>' : ''}
      <div class="dk-text">${html}</div>
      ${it.f ? `<p class="dk-fadl"><i></i>${esc(it.f)}</p>` : ''}
      ${it.r ? `<p class="dk-src">رواه ${esc(it.r)}</p>` : ''}
    </div>`;
    return el;
  }

  // offered once the book's adhkar are done, never in the way before that
  function moreOfferHTML() {
    return `<div class="dk-more">
      <b>زيادة من السنّة الصحيحة</b>
      <small>${nItems(cat.more.length)} لم ترد في الحصن، ${D.more}. تُضاف بعد أذكارك، ويمكنك إزالتها متى شئت.</small>
      <div class="actions"><button class="primary" data-dk-act="more-on">أضفها</button></div>
    </div>`;
  }

  // the card set changed under the reader (additions on/off): redraw in place
  function redraw() {
    idx = Math.min(idx, cat.items.length);
    const c = card(idx);
    c.classList.add('arrive');
    $('#dkStage').replaceChildren(c);
    paint();
  }

  function paint() {
    const n = cat.items.length;
    const end = idx >= n;
    // one step per dhikr: gold when done, outlined where you are
    $('#dkSteps').innerHTML = n > 1 ? cat.items.map((_, i) =>
      `<i class="${left(cat, i) === 0 ? 'ok' : ''}${i === idx ? ' cur' : ''}${cat.items[i].x ? ' x' : ''}" data-step="${i}"></i>`).join('') : '';
    const s = state(cat);
    $('#dkSub').textContent = end ? (s.all ? 'تمّت' : '') : `${ar(idx + 1)} من ${ar(n)}`;
    $('#adhkar').classList.toggle('at-end', end);
    $('#dkPrev').disabled = idx === 0;
    if (end) return;
    const it = cat.items[idx], l = left(cat, idx);
    const btn = $('#dkCount');
    btn.classList.toggle('ok', l === 0);
    $('#dkNum').textContent = l === 0 ? '' : ar(l);
    $('#dkOf').textContent = l && it.c > 1 ? `من ${ar(it.c)}` : '';
    $('#dkRing').style.strokeDashoffset = (RING * (l / it.c)).toFixed(2);
    btn.setAttribute('aria-label', l ? `عدّ — بقي ${ar(l)}` : 'تم');
  }

  // slide to card i; the RTL book order of the mushaf: the next card comes in
  // from the left and the current one leaves to the right
  function go(i, from = 0) {
    clearTimeout(advT);
    i = Math.max(0, Math.min(cat.items.length, i));
    const stage = $('#dkStage');
    const old = stage.lastElementChild;
    if (i === idx) { old.style.transition = 'transform .25s ease'; old.style.transform = ''; return; }
    const dir = i > idx ? 1 : -1;
    const W = stage.clientWidth;
    const fresh = card(i);
    fresh.style.transform = `translate3d(${-dir * W + (from ? from : 0)}px,0,0)`;
    stage.append(fresh);
    void fresh.offsetWidth;
    const ease = 'transform .34s cubic-bezier(.2,.8,.2,1)';
    old.style.transition = fresh.style.transition = ease;
    old.style.transform = `translate3d(${dir * W}px,0,0)`;
    fresh.style.transform = 'translate3d(0,0,0)';
    const drop = () => old.remove();
    old.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 420);
    idx = i;
    paint();
  }

  function tick() {
    if (idx >= cat.items.length) return;
    let l = left(cat, idx);
    if (l === 0) { go(idx + 1); return; }
    setLeft(cat, idx, --l);
    const btn = $('#dkCount');
    btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
    if (navigator.vibrate) navigator.vibrate(l ? 8 : [12, 60, 22]);
    paint();
    if (!l) advT = setTimeout(() => go(idx + 1), 560);
  }

  function finish() {
    if (idx >= cat.items.length || left(cat, idx) === 0) return;
    setLeft(cat, idx, 0);
    if (navigator.vibrate) navigator.vibrate([12, 60, 22]);
    paint();
    advT = setTimeout(() => go(idx + 1), 420);
  }

  // the counter: tap counts one, holding it finishes this dhikr
  (() => {
    const btn = $('#dkCount');
    let holdT = null, held = false;
    btn.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      held = false;
      clearTimeout(holdT);
      if (idx < cat.items.length && left(cat, idx) > 0) {
        btn.classList.add('holding');
        holdT = setTimeout(() => { held = true; btn.classList.remove('holding'); finish(); }, 650);
      }
    });
    const up = e => {
      clearTimeout(holdT);
      btn.classList.remove('holding');
      if (e.type === 'pointerup' && !held) tick();
      held = false;
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', () => { clearTimeout(holdT); btn.classList.remove('holding'); });
    btn.addEventListener('contextmenu', e => e.preventDefault());
  })();

  // the card: swipe sideways to move, tap anywhere on it to count
  (() => {
    const stage = $('#dkStage');
    let x0, y0, t0, axis, dx, id = null;
    stage.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button')) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); axis = null; dx = 0;
    });
    stage.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!axis && Math.hypot(mx, my) > 8) axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (axis !== 'x') return;
      dx = mx;
      if ((dx > 0 && idx >= cat.items.length) || (dx < 0 && idx === 0)) dx /= 3;
      const c = stage.lastElementChild;
      c.style.transition = 'none';
      c.style.transform = `translate3d(${dx}px,0,0)`;
    });
    const end = e => {
      if (e.pointerId !== id) return;
      id = null;
      if (axis === 'x') {
        const v = dx / (performance.now() - t0), W = stage.clientWidth;
        if ((dx > W * 0.2 || v > 0.45) && idx < cat.items.length) go(idx + 1, dx);
        else if ((dx < -W * 0.2 || v < -0.45) && idx > 0) go(idx - 1, dx);
        else go(idx);
      } else if (!axis && e.type === 'pointerup' && performance.now() - t0 < 500) {
        tick();
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('click', e => {
      const b = e.target.closest('[data-dk-act]');
      if (!b) return;
      const a = b.dataset.dkAct;
      if (a === 'back') close();
      else if (a === 'again') { reset(cat); go(0); toast('بدأت من جديد'); }
      else if (a === 'missed') go(cat.items.findIndex((_, i) => left(cat, i) > 0));
      else if (a === 'more-on') { setMore(cat, true); idx = cat.core.length; redraw(); }
      else if (a === 'more-off') { setMore(cat, false); redraw(); toast('أُزيلت الأذكار الإضافية'); }
    });
  })();

  $('#dkSteps').addEventListener('click', e => {
    const s = e.target.closest('[data-step]');
    if (s) go(+s.dataset.step);
  });
  $('#dkNext').onclick = () => go(idx + 1);
  $('#dkPrev').onclick = () => go(idx - 1);
  $('#dkBack').onclick = close;
  $('#dkSize').onclick = () => {
    const cur = store.get('adhkar.size', 'm');
    const next = SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length];
    store.set('adhkar.size', next);
    $('#adhkar').dataset.size = next;
    toast({ s: 'خط صغير', m: 'خط متوسط', l: 'خط كبير' }[next]);
  };
  document.addEventListener('keydown', e => {
    if ($('#adhkar').hidden) return;
    if (e.key === 'ArrowLeft') go(idx + 1);
    else if (e.key === 'ArrowRight') go(idx - 1);
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tick(); }
    else if (e.key === 'Escape') close();
  });

  return { mount, searchHTML, open, close, load, url: () => new URL(URL_, location.href).href };
})();
