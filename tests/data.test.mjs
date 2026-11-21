// node --test tests/   (the data the app ships agrees with itself)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url), read = f => readFileSync(new URL(f, root), 'utf8'), json = f => JSON.parse(read(f));

const meta = json('data/meta.json');
const counts = {};
for (const r of meta.riwayat) {
  const d = json(`data/${r.id}.json`), c = Array(114).fill(0);
  for (const a of d.ayas) c[a[0] - 1]++;
  counts[r.id] = c;
}

test('every riwaya has 114 surahs', () => {
  for (const [id, c] of Object.entries(counts)) assert.ok(c.every(n => n > 0), id);
  assert.equal(counts.hafs.reduce((a, b) => a + b), 6236);
});

test('recitation timing: each aya a start (and the end), in order, sizes for every surah', () => {
  for (const f of readdirSync(new URL('data/audio/', root))) {
    const d = json('data/audio/' + f), rid = f.split('.')[0];
    assert.ok(counts[rid], f);
    assert.equal(d.t.length, 114, f);
    assert.equal(d.size.length, 114, f);
    assert.ok(/^https:\/\//.test(d.url), f);
    d.t.forEach((t, s) => {
      assert.equal(t.length, counts[rid][s] + 1, `${f} surah ${s + 1}`);
      for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], `${f} ${s + 1}:${i}`);
      assert.ok(d.size[s] > 0, `${f} size ${s + 1}`);
    });
  }
});

test('the continuous Hafs reciters (HAFS_CONT) each have their timing', () => {
  const app = read('app.js'), m = app.match(/const HAFS_CONT = \{([^}]+)\}/);
  assert.ok(m, 'HAFS_CONT');
  const ids = [...m[1].matchAll(/['"]?([\w-]+)['"]?\s*:/g)].map(x => x[1]);
  assert.ok(ids.length >= 19);
  for (const id of ids) assert.ok(existsSync(new URL(`data/audio/hafs.${id}.json`, root)), id);
});

test('the service worker caches files that exist, and the page loads them', () => {
  const sw = read('sw.js'), shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  for (const f of shell) if (f !== './') assert.ok(existsSync(new URL(f, root)), f);
  const html = read('index.html');
  for (const [, f] of html.matchAll(/<script src="([^"]+)"/g)) {
    assert.ok(existsSync(new URL(f, root)), f);
    // (dev.js and dev.css: dev mode's only, fetched on a device with it on and kept then, never
    // downloaded for anyone else, so not in the shell)
    if (!f.startsWith('http') && f !== 'dev.js') assert.ok(shell.includes(f), `${f} not cached by sw.js`);
  }
});

test('surah info and causes of revelation', () => {
  const si = json('data/surah-info.json');
  assert.equal(si.surahs.length, 114);
  const as = json('data/asbab.json');
  for (const k of Object.keys(as.ayas)) assert.match(k, /^\d+:\d+(-\d+)?$/);
  // صحيح أسباب النزول: [surah, [ayas], [[paragraph, ...], ...]], each aya one of its surah's (Hafs)
  const hafs = counts.hafs, sh = json('data/asbab-sahih.json');
  assert.ok(sh.list.length > 150);
  for (const [s, l, nar] of sh.list) {
    assert.ok(s >= 1 && s <= 114 && l.length && l.every(n => Number.isInteger(n) && n >= 1 && n <= hafs[s - 1]), `${s}:${l}`);
    assert.ok(nar.length && nar.every(ps => ps.length && ps.every(p => typeof p === 'string' && p && !/[{}]|<(?!\/?q>)/.test(p))), `${s}:${l}`);
  }
});

test("index.html's first script asks for the data app.js will (DATA_VERSION), and Hafs's texts are apart", () => {
  const v = read('app.js').match(/const DATA_VERSION = (\d+);/)?.[1], w = read('index.html').match(/var V = (\d+); \/\/ = DATA_VERSION/)?.[1];
  assert.ok(v && v === w, `app.js ${v}, index.html ${w}`);
  const h = json('data/hafs.json'), t = json('data/hafs-text.json'), e = json('data/emlaey.json');
  assert.ok(!h.utext && !meta.emlaey, 'the texts are not in the files the first page waits for');
  assert.equal(t.length, h.ayas.length);
  assert.equal(e.length, meta.hafs.length);
});

test('الحديث: every kitab has its parts, each hadith its text, the names its chains need, the narrators their cards', () => {
  const ix = json('data/hadith/index.json');
  assert.deepEqual(ix.books.map(b => b.id), ['bukhari', 'muslim', 'abudawud']);
  const shards = {};
  for (const b of ix.books) {
    let n = 0;
    b.k.forEach(([t, count, , parts], k) => {
      let got = 0;
      for (let p = 0; p < parts; p++) {
        const d = json(`data/hadith/${b.id}/${k}-${p}.json`);
        for (const h of d.h) {
          assert.ok(h.t && h.n.length, `${b.id} ${k}-${p}`);
          for (const c of h.c || []) for (const id of c) assert.ok(d.R[id], `${b.id} ${h.n[0]}: name of ${id}`);
          for (const q of h.q || []) assert.ok(q[0] < q[1] && q[1] <= h.t.length);
          if (h.m) assert.ok(h.m[0] < h.m[1] && h.m[1] <= h.t.length);
        }
        got += d.h.length;
      }
      assert.equal(got, count, `${b.id} kitab ${k}`);
      n += got;
    });
    assert.equal(n, b.n, b.id);
  }
  // a few known: Bukhari 1, Muslim 2564 (Abd al-Baqi), Abu Dawud 1 graded by al-Albani
  const b1 = json('data/hadith/bukhari/0-0.json').h[0];
  assert.ok(b1.n.includes(1) && b1.t.replace(/[\u064B-\u0652\u0670]/g, '').includes('إنما الأعمال بالنيات'));
  assert.ok(b1.o.some(o => o[0] === 'muslim' && o[3] === 1907));
  const ad1 = json('data/hadith/abudawud/0-0.json').h[0];
  assert.ok(ad1.gr.some(([who]) => who === 'الألباني'));
  for (const f of readdirSync(new URL('data/hadith/rawi/', root))) Object.assign(shards, json('data/hadith/rawi/' + f));
  assert.ok(shards[7272]?.s.includes('الزهري'));
  assert.equal(json('data/hadith/search/rawi.json').length, Object.keys(shards).length);
});
