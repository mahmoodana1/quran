// node --test tests/   (التسميع: an aya said right is all right; a word left out is caught)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const Match = createRequire(import.meta.url)('../match.js');
const phon = JSON.parse(readFileSync(new URL('../data/phon-hafs.json', import.meta.url), 'utf8'));

const entry = ai => {
  const [ph, flat, wasl] = phon[ai], spans = [];
  for (let i = 0; i < flat.length; i += 2) spans.push([flat[i], flat[i + 1]]);
  return { ph, spans, wasl: wasl || [] };
};
const SAMPLE = [0, 1, 7, 262, 2000, 4000, 6000, 6235];

test('an aya said exactly as written: every word right', () => {
  for (const ai of SAMPLE) {
    const e = entry(ai), st = Match.words(e, e.ph, e.ph.length, true);
    assert.equal(st.length, e.spans.length, `aya ${ai}`);
    assert.ok(st.every(x => x.state === 'ok'), `aya ${ai}: ${JSON.stringify(st.filter(x => x.state !== 'ok'))}`);
  }
});

test('a word left out in the middle is marked', () => {
  for (const ai of [262, 2000, 4000]) {
    const e = entry(ai), k = Math.floor(e.spans.length / 2);
    const heard = e.ph.slice(0, e.spans[k][0]) + e.ph.slice(e.spans[k][1]);
    const st = Match.words(e, heard, heard.length, true);
    assert.ok(st.some(x => x.state === 'err'), `aya ${ai}`);
  }
});

test('nothing said yet: nothing marked', () => {
  const e = entry(262), st = Match.words(e, '', 0, false);
  assert.ok(st.every(x => x.state !== 'err'));
});
