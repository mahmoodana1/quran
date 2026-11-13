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
    if (!f.startsWith('http')) assert.ok(shell.includes(f), `${f} not cached by sw.js`);
  }
});

test('surah info and causes of revelation', () => {
  const si = json('data/surah-info.json');
  assert.equal(si.surahs.length, 114);
  const as = json('data/asbab.json');
  for (const k of Object.keys(as.ayas)) assert.match(k, /^\d+:\d+(-\d+)?$/);
});
