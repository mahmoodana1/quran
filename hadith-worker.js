'use strict';
// The الحديث panel's search, away from the page (hadith.js): the three books' matn, normalized
// as tools/hadith.py does (data/hadith/search/<book>.json: [kitab, place in it, numbers, text]),
// and the narrators by name (search/rawi.json). Loaded on the first search, kept after.
// In: { id, q, v } (v: the data version). Out: { id, hits: [[book, kitab, j, numbers, snippet]],
// rawis: [[id, name, rank, n]], num: true when the hits are a number's, total }
const BOOKS = ['bukhari', 'muslim', 'abudawud'];
let D = null, R = null, ready = null;

const norm = t => t.replace(/[ً-ٰٟۖ-ۭـ]/g, '').replace(/ﷺ/g, ' صلى الله عليه وسلم ')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^ء-ي0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = t => t.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
// a book named in the query: «البخاري ١», «مسلم 2564», «ابو داود ١٠»
const NAMES = [['bukhari', /(^| )(ال)?بخاري( |$)/], ['muslim', /(^| )مسلم( |$)/], ['abudawud', /(^| )ابو ?داود( |$)|(^| )ابي ?داود( |$)/]];

function load(v) {
  return ready ||= Promise.all([
    ...BOOKS.map(b => fetch(`data/hadith/search/${b}.json?v=${v}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })),
    fetch(`data/hadith/search/rawi.json?v=${v}`).then(r => r.json()),
  ]).then(([b, m, a, rw]) => {
    D = { bukhari: b, muslim: m, abudawud: a };
    R = rw.map(x => [...x, ' ' + norm(x[1]) + ' ']);
  }).catch(e => { ready = null; throw e; });
}

function snippet(t, w) {
  const i = Math.max(0, t.indexOf(w));
  const a = Math.max(0, t.lastIndexOf(' ', Math.max(0, i - 50)));
  const b = t.indexOf(' ', Math.min(t.length, i + w.length + 80));
  return (a > 0 ? '… ' : '') + t.slice(a, b < 0 ? t.length : b).trim() + (b > 0 && b < t.length ? ' …' : '');
}

function search(raw) {
  const q = norm(digits(raw));
  if (!q) return { hits: [], rawis: [], total: 0 };
  // a number (and maybe a book): where it is
  const nums = (q.match(/\d+/g) || []).map(Number);
  const text = q.replace(/\d+/g, ' ').trim();
  const named = NAMES.filter(([, re]) => re.test(' ' + text + ' ')).map(([b]) => b);
  if (nums.length && (!text || named.length)) {
    const hits = [];
    for (const b of named.length ? named : BOOKS) for (const [k, j, ns, t] of D[b]) if (ns.includes(nums[0])) hits.push([b, k, j, ns, snippet(t, '')]);
    return { hits, rawis: [], total: hits.length, num: true };
  }
  const words = text.split(' ').filter(w => w.length > 1 || /^[0-9]$/.test(w));
  if (!words.length) return { hits: [], rawis: [], total: 0 };
  const phrase = words.join(' ');
  // each word as written, and its stem (without ال و ف ب ل ك before it, ات ة ه ها هم ون ين ان after):
  // «بالنيات» finds «بالنية», «الأعمال» finds «أعمالكم»
  const stems = words.map(w => {
    let s = w.replace(/^(وال|فال|بال|كال|لل|ال|و|ف|ب|ل|ك)(?=..)/, '');
    s = s.replace(/(ات|ون|ين|ان|ها|هم|كم|نا|ه|ي)$/, m => s.length - m.length >= 3 ? '' : m);
    return s.length >= 2 ? s : w;
  });
  const need = words.length <= 2 ? words.length : Math.ceil(words.length * .66);
  const out = [];
  for (const b of named.length ? named : BOOKS) {
    for (const [k, j, ns, t] of D[b]) {
      let got = 0, score = 0;
      const s = ' ' + t + ' ';
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (s.includes(' ' + w + ' ')) { got++; score += 1; }
        else if (t.includes(w)) { got++; score += .75; }
        else if (t.includes(stems[i])) { got++; score += .5; }
      }
      if (got < need) continue;
      if (t.includes(phrase)) score += 3;
      score += got === words.length ? 2 : 0;
      score -= Math.min(1, t.length / 4000); // the shorter one first, of two alike
      out.push([score, b, k, j, ns, t]);
    }
  }
  out.sort((x, y) => y[0] - x[0]);
  const first = words.find(w => w.length > 2) || words[0];
  const hits = out.slice(0, 60).map(([, b, k, j, ns, t]) => [b, k, j, ns, snippet(t, t.includes(phrase) ? phrase : first)]);
  // narrators whose name has every word
  const rawis = [];
  if (!named.length) for (const r of R) {
    if (words.every(w => r[4].includes(' ' + w))) { rawis.push(r.slice(0, 4)); if (rawis.length >= 8) break; }
  }
  return { hits, rawis, total: out.length };
}

onmessage = async ({ data: { id, q, v } }) => {
  try { await load(v); postMessage({ id, ...search(q) }); }
  catch (e) { postMessage({ id, error: String(e) }); }
};
