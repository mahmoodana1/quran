'use strict';

// The coloured ribbons: six markers, each a vivid colour and a name of the reader's (ورد القراءة,
// المراجعة, …), each held at one aya at a time, as the ribbons sewn into a printed mushaf. Placing
// one again moves it, and its moves are kept (K.rb[colour].log), so how far it went today, this week
// and day by day is shown (Plan.ribbon), with when the mushaf is finished at that pace. On the page a
// ribbon's aya stands out: a band of its colour behind every line of it, a bar of it at the line's
// edge, its number in it, and the ribbons on a page hanging in its header. Kept with the khatma
// (synced with it), by hafs aya number, so a ribbon stays on its aya whatever the riwaya.
// Uses (app.js) $, R, K, S, ar, esc, toast, haptic, ripple, saveKh, suraName, goTo, flashAya,
// closeActions, openSheet, renderSheet, paintMarks, isSaved, toggleSave; Plan.

const Marks = (() => {
  const C = [
    { id: 'red', name: 'الأحمر' },
    { id: 'orange', name: 'البرتقالي' },
    { id: 'yellow', name: 'الأصفر' },
    { id: 'green', name: 'الأخضر' },
    { id: 'blue', name: 'الأزرق' },
    { id: 'purple', name: 'البنفسجي' },
  ];
  const LOG = 400; // moves kept per ribbon
  const BIG_BACK = 20; // moved back further than this: a new round, not a correction

  const rb = () => (K.rb ||= {});
  const nameOf = c => rb()[c.id]?.name || 'الشريط ' + c.name;
  const placed = () => C.filter(c => rb()[c.id]?.h != null);
  const aiOf = h => (R.fromHafs && R.fromHafs[h] >= 0 ? R.fromHafs[h] : null);
  const pageOfH = h => { const ai = aiOf(h); return ai != null ? R.ayas[ai][2] : 1; };
  const hafsOf = ai => R.ayas[ai][5];
  // the ribbons on an aya (this riwaya's index), in the palette's order
  const on = ai => placed().filter(c => aiOf(rb()[c.id].h) === ai);
  const stats = c => Plan.ribbon(rb()[c.id]?.log, pageOfH, Date.now(), 14, BIG_BACK);
  const pg = n => n === 1 ? 'صفحة' : n === 2 ? 'صفحتان' : n <= 10 ? `${ar(n)} صفحات` : `${ar(n)} صفحة`;
  const ago = t => {
    const d = Plan.dayNo() - Plan.dayNo(t);
    return d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : d === 2 ? 'قبل يومين' : d <= 10 ? `قبل ${ar(d)} أيام` : `قبل ${ar(d)} يومًا`;
  };

  function place(id, ai) {
    const c = C.find(x => x.id === id), h = hafsOf(ai), now = Date.now();
    const e = rb()[id] ||= { log: [] };
    const from = e.h != null ? pageOfH(e.h) : null;
    e.h = h; e.t = now;
    e.log = [...(e.log || []), [h, now]].slice(-LOG);
    K.read = now; saveKh();
    const to = R.ayas[ai][2], d = from != null ? to - from : 0;
    haptic(12);
    toast(`${nameOf(c)} · ${suraName(R.ayas[ai][0])} ${ar(R.ayas[ai][1])}${d > 0 ? ` · تقدّم ${pg(d)}` : ''}`, 2200);
  }
  function remove(id) {
    const e = rb()[id];
    if (!e) return;
    e.h = null; e.t = Date.now();
    K.read = Date.now(); saveKh();
    toast(`رُفع ${nameOf(C.find(x => x.id === id))}`);
  }

  // ---- on the page
  function paint(root) {
    root.querySelectorAll('.w.end.mkd').forEach(e => { e.classList.remove('mkd'); e.style.removeProperty('--mc'); e.style.removeProperty('--mi'); });
    const byAi = new Map();
    for (const c of placed()) { const ai = aiOf(rb()[c.id].h); if (ai != null) byAi.set(ai, [...(byAi.get(ai) || []), c]); }
    for (const [ai, cs] of byAi) root.querySelectorAll(`.w.end[data-a="${ai}"]`).forEach(e => {
      e.classList.add('mkd'); e.style.setProperty('--mc', `var(--rb-${cs[0].id})`); e.style.setProperty('--mi', `var(--rb-${cs[0].id}-i)`);
    });
    // the header: the ribbons on this page
    root.querySelectorAll('.page').forEach(p => {
      const tags = p.querySelector('.rb-tags');
      if (!tags) return;
      const n = +p.dataset.page, here = placed().filter(c => pageOfH(rb()[c.id].h) === n);
      const k = here.map(c => c.id).join();
      if (tags.dataset.k === k) return;
      tags.dataset.k = k;
      tags.innerHTML = here.map(c => `<i class="rb-${c.id}" title="${esc(nameOf(c))}"></i>`).join('');
      tags.hidden = !here.length;
    });
    if (root === document || root.isConnected) bands(root);
  }
  // a band of the ribbon's colour behind each line of its aya, and a bar at the line's edge
  function bands(root) {
    const want = new Map();
    for (const c of placed()) { const ai = aiOf(rb()[c.id].h); if (ai != null) want.set(ai, [...(want.get(ai) || []), c.id]); }
    root.querySelectorAll('.mkb, .mk-edge').forEach(el => { if (want.get(+el.dataset.a)?.join() !== el.dataset.k) el.remove(); });
    const draw = [];
    for (const [ai, ids] of want) {
      const lns = new Map();
      root.querySelectorAll(`.w[data-a="${ai}"]`).forEach(w => { const ln = w.closest('.ln'); if (ln) lns.set(ln, [...(lns.get(ln) || []), w]); });
      for (const [ln, ws] of lns) {
        if (ln.querySelector(`.mkb[data-a="${ai}"]`)) continue;
        let l = Infinity, r = -Infinity;
        ws.forEach(w => { l = Math.min(l, w.offsetLeft); r = Math.max(r, w.offsetLeft + w.offsetWidth); });
        if (!isFinite(l)) continue;
        draw.push([ln, ai, ids, l, r, (parseFloat(getComputedStyle(ln).fontSize) || 20) * 0.12]);
      }
    }
    for (const [ln, ai, ids, l, r, pad] of draw) {
      const k = ids.join(), b = document.createElement('div'), e = document.createElement('div');
      b.className = 'mkb'; e.className = 'mk-edge';
      b.dataset.a = e.dataset.a = ai; b.dataset.k = e.dataset.k = k;
      b.style.setProperty('--mc', `var(--rb-${ids[0]})`);
      b.style.left = (l - pad) + 'px'; b.style.width = (r - l + pad * 2) + 'px';
      // (two ribbons on one aya: the bar in both colours)
      e.style.background = ids.length > 1 ? `linear-gradient(${ids.map((id, j) => `var(--rb-${id}) ${j / ids.length * 100}% ${(j + 1) / ids.length * 100}%`).join(', ')})` : `var(--rb-${ids[0]})`;
      ln.prepend(b); ln.append(e);
    }
  }

  // ---- the aya's actions: «علامة» opens the palette
  const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  function onOpen(i) {
    const box = $('#ayaBarMk');
    box.hidden = true; box.innerHTML = '';
    const btn = $('#ayaBar [data-act=bookmark]'), cs = on(i);
    btn.classList.toggle('on', !cs.length && isSaved(i));
    btn.classList.toggle('rbd', !!cs.length);
    if (cs.length) btn.style.setProperty('--mc', `var(--rb-${cs[0].id})`); else btn.style.removeProperty('--mc');
    btn.querySelector('span').textContent = cs.length ? (cs.length > 1 ? `${ar(cs.length)} أشرطة` : nameOf(cs[0]).replace(/^الشريط /, '')) : isSaved(i) ? 'محفوظة' : 'علامة';
  }
  function palette(i) {
    const here = new Set(on(i).map(c => c.id));
    return `<div class="mk-pal">${C.map(c => {
      const e = rb()[c.id], elsewhere = e?.h != null && !here.has(c.id);
      return `<button data-mk="${c.id}" class="rb-${c.id}${here.has(c.id) ? ' on' : ''}" aria-pressed="${here.has(c.id)}"><i>${here.has(c.id) ? '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</i><span>${esc(nameOf(c).replace(/^الشريط /, ''))}</span>${elsewhere ? `<small>ص ${ar(pageOfH(e.h))}</small>` : '<small>&nbsp;</small>'}</button>`;
    }).join('')}<button data-mk="fav" class="fav${isSaved(i) ? ' on' : ''}"><i>${STAR}</i><span>${isSaved(i) ? 'محفوظة' : 'احفظها'}</span><small>&nbsp;</small></button></div>
    <p class="mk-hint">لون للشريط: يوضع هنا وينتقل من مكانه، ويُحسب تقدّمه. اضغطه ثانية لرفعه.</p>`;
  }
  // the aya bar's clicks; true when handled
  function onBar(e) {
    if (S.act == null) return false;
    const i = S.act, box = $('#ayaBarMk');
    const m = e.target.closest('[data-mk]');
    if (m) {
      const id = m.dataset.mk;
      if (id === 'fav') { toggleSave(i); if (S.act === i) { box.innerHTML = palette(i); onOpen(i); box.hidden = false; } return true; }
      const was = on(i).some(c => c.id === id);
      if (was) remove(id); else place(id, i);
      ripple(m.querySelector('i'));
      paintMarks();
      afterChange();
      box.innerHTML = palette(i);
      setTimeout(() => { if (S.act === i) closeActions(); }, was ? 250 : 420);
      return true;
    }
    if (e.target.closest('[data-act=bookmark]')) { openPalette(box.hidden); return true; }
    return false;
  }
  // open (or close) the palette on the aya open in the bar
  function openPalette(open = true) {
    if (S.act == null) return;
    const box = $('#ayaBarMk');
    if (open) { box.innerHTML = palette(S.act); box.hidden = false; } else box.hidden = true;
    $('#ayaBar [data-act=bookmark]').classList.toggle('open', !box.hidden);
    if (typeof keepClear === 'function') keepClear();
  }
  // the n-th colour (7: «احفظها») picked from the keyboard, when the palette is open
  function pick(n) {
    const box = $('#ayaBarMk');
    if (S.act == null || box.hidden || $('#ayaBar').hidden) return false;
    box.querySelectorAll('[data-mk]')[n - 1]?.click();
    return true;
  }
  function afterChange() {
    if (typeof refreshHeader === 'function') refreshHeader();
    if (panelOpen($('#sheet')) && tab === 'marks' && !$('#q').value.trim()) { const b = $('#sheetBody'), y = b.scrollTop; renderSheet(); b.scrollTop = y; }
  }

  // ---- the العلامات tab
  function stripHTML() {
    const total = R.pages.length;
    const pins = placed().map(c => { const p = pageOfH(rb()[c.id].h); return `<button class="rb-pin rb-${c.id}" data-rb-go="${c.id}" style="right:${(p - 1) / Math.max(1, total - 1) * 100}%" aria-label="${esc(nameOf(c))}، صفحة ${ar(p)}"></button>`; }).join('');
    const kp = Math.min(100, (S.page - 1) / Math.max(1, total - 1) * 100);
    return `<div class="rb-strip"><div class="rb-track"><i class="rb-here" style="right:${kp}%" title="تقرأ الآن"></i>${pins}</div>
      <div class="rb-ends"><span>الفاتحة</span><span>الجزء ١٥</span><span>الناس</span></div></div>`;
  }
  function cardHTML(c) {
    const e = rb()[c.id], ai = aiOf(e.h), a = R.ayas[ai], total = R.pages.length;
    const st = stats(c) || { today: 0, week: 0, daily: [], perDay: 0 };
    const pct = Math.min(100, Math.round(a[2] / total * 100));
    const max = Math.max(1, ...st.daily);
    const left = total - a[2], e0 = st.perDay > 0 && left > 0 ? Math.ceil(left / st.perDay) : null, eta = e0 && e0 <= 999 ? e0 : null;
    const days = st.daily.map((v, j) => `<i class="${v ? 'g' : ''}${j === st.daily.length - 1 ? ' now' : ''}" style="height:${v ? Math.max(18, v / max * 100) : 8}%" title="${pg(v)}"></i>`).join('');
    return `<div class="rb-card rb-${c.id}" data-rb-go="${c.id}" role="button">
      <div class="rb-top"><i class="rb-flag"></i><input class="rb-name" data-rb-name="${c.id}" value="${esc(nameOf(c))}" maxlength="28" enterkeyhint="done" aria-label="اسم الشريط"><b class="rb-pct">${ar(pct)}٪</b></div>
      <div class="rb-where"><b>${suraName(a[0])} · الآية ${ar(a[1])}</b><span>صفحة ${ar(a[2])}${a[3] ? ` · الجزء ${ar(a[3])}` : ''} · ${ago(e.t)}</span></div>
      <div class="rb-bar"><i style="width:${pct}%"></i></div>
      <div class="rb-stats">
        <span class="${st.today ? 'up' : ''}"><b>${st.today ? '+' + ar(st.today) : '٠'}</b>اليوم</span>
        <span class="${st.week ? 'up' : ''}"><b>${st.week ? '+' + ar(st.week) : '٠'}</b>هذا الأسبوع</span>
        <span><b>${eta ? '~' + ar(eta) : '—'}</b>${eta ? (eta <= 10 ? 'أيام للختم' : 'يومًا للختم') : 'للختم'}</span>
      </div>
      <div class="rb-days" aria-label="الصفحات كل يوم، آخر أسبوعين">${days}</div>
      <div class="rb-acts"><button data-rb-go="${c.id}" class="go">اذهب إليه</button><button data-rb-del="${c.id}" class="del">رفع</button></div>
    </div>`;
  }
  function panelHTML() {
    const ps = placed().sort((x, y) => (rb()[y.id].t || 0) - (rb()[x.id].t || 0)), free = C.filter(c => !ps.includes(c));
    let h = '<div class="group-label">الأشرطة الملوّنة</div>';
    if (ps.length) h += stripHTML() + ps.map(cardHTML).join('');
    else h += '<div class="rb-intro">ستة أشرطة بألوان زاهية، كأشرطة المصحف: اضغط رقم آية ثم «علامة» واختر لونًا. يبرز الشريط آيته في الصفحة، وينتقل إذا وضعته على غيرها، ويُحسب لك ما تقدّمت به كل يوم.</div>';
    if (free.length) h += `<div class="rb-free">${free.map(c => `<button data-rb-free="${c.id}" class="rb-${c.id}"><i></i>${esc(nameOf(c).replace(/^الشريط /, ''))}</button>`).join('')}</div>`;
    return h;
  }
  function onSheetClick(e) {
    if (e.target.closest('.rb-name')) return true;
    const fr = e.target.closest('[data-rb-free]');
    if (fr) { toast('اضغط رقم آية ثم «علامة» واختر هذا اللون', 2400); return true; }
    const del = e.target.closest('[data-rb-del]');
    if (del) { e.stopPropagation(); remove(del.dataset.rbDel); paintMarks(); afterChange(); return true; }
    const go = e.target.closest('[data-rb-go]');
    if (go) {
      const ai = aiOf(rb()[go.dataset.rbGo]?.h);
      if (ai == null) return true;
      dismissSheet();
      goTo(R.ayas[ai][2]);
      setTimeout(() => flashAya(ai), 250);
      return true;
    }
    return false;
  }
  function onChange(e) {
    const n = e.target.closest('[data-rb-name]');
    if (!n) return false;
    const id = n.dataset.rbName, v = n.value.trim().slice(0, 28), c = C.find(x => x.id === id);
    const ent = rb()[id] ||= { log: [] };
    ent.name = v && v !== 'الشريط ' + c.name ? v : undefined;
    ent.nt = Date.now();
    K.read = Date.now(); saveKh();
    n.value = nameOf(c);
    paintMarks();
    return true;
  }
  // (Enter in a name: done)
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('.rb-name')) e.target.blur(); });

  return { C, paint, onOpen, onBar, palette: openPalette, pick, panelHTML, onSheetClick, onChange, on, placed };
})();
