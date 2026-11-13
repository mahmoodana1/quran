// Are the outside sources the app plays and draws from still there, and unchanged?
//   node tools/check-sources.mjs        (run daily by .github/workflows/sources.yml; exit 1 lists what failed)
// - mp3quran.net: the first and last surah of every recording timed in data/audio/, each the size
//   recorded there (a file replaced by another recording would put every aya's timing off)
// - everyayah.com: the first aya of every Hafs reciter played aya by aya (HAFS_VOICES in app.js)
// - the Hafs page fonts, the word-by-word audio, the speech models' site, Quranpedia
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url), read = f => readFileSync(new URL(f, root), 'utf8');
const app = read('app.js');
const checks = [];
for (const f of readdirSync(new URL('data/audio/', root))) {
  const d = JSON.parse(read('data/audio/' + f));
  for (const s of [1, 114]) checks.push({ what: `${f} surah ${s}`, url: `${d.url}${String(s).padStart(3, '0')}.mp3`, size: d.size[s - 1] });
}
const ev = app.match(/const EVERYAYAH = '([^']+)'/)[1];
const voices = app.slice(app.indexOf('const HAFS_VOICES = ['), app.indexOf('];', app.indexOf('const HAFS_VOICES = [')));
for (const [, id, folder] of voices.matchAll(/\['([\w-]+)', '[^']*', '[^']*', '([^']+)'/g)) checks.push({ what: `everyayah ${id}`, url: `${ev}${folder}/001001.mp3` });
checks.push({ what: 'Hafs page font', url: app.match(/const QCF_BASE = '([^']+)'/)[1] + 'p1.woff2' });
checks.push({ what: 'word audio', url: app.match(/const WORD_AUDIO = '([^']+)'/)[1] + '001_001_001.mp3' });
checks.push({ what: 'speech models', url: read('mu.js').match(/const BASE = '([^']+)'/)[1] });
checks.push({ what: 'Quranpedia', url: 'https://quranpedia.net/' });

const H = { 'User-Agent': 'quran-app-source-check' };
async function one(c) {
  for (let tries = 0; ; tries++) {
    try {
      // a byte of it: the total size is in Content-Range (some hosts refuse HEAD)
      const r = await fetch(c.url, { headers: { ...H, Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      await r.body?.cancel();
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (c.size) {
        const total = +(r.headers.get('content-range') || '').split('/')[1] || +r.headers.get('content-length');
        if (total && total !== c.size) return `${c.what}: ${total} bytes, timed for ${c.size} (${c.url})`;
      }
      return null;
    } catch (e) {
      if (tries >= 2) return `${c.what}: ${e.message} (${c.url})`;
      await new Promise(r => setTimeout(r, 3000 * (tries + 1)));
    }
  }
}
const bad = [];
for (let i = 0; i < checks.length; i += 6) (await Promise.all(checks.slice(i, i + 6).map(one))).forEach(x => x && bad.push(x));
console.log(`${checks.length - bad.length} of ${checks.length} sources answer as expected`);
if (bad.length) { console.log('\n' + bad.join('\n')); process.exit(1); }
