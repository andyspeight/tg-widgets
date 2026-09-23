/* Find second sources without a search engine: list the external sources an
   airport's Wikipedia article cites, so the auditor can open the ORIGINAL
   publisher (a Reuters report, an operator's traffic release, a government
   notice) with grab.mjs.

   Usage: node refs.mjs <IATA> [filter-regex]

   What a cited page says counts as that publisher's word, not Wikipedia's, but
   only once grab.mjs has saved it and the quote is on it. Wikipedia mirrors,
   archive copies of Wikipedia and social media are left out. */
import fs from 'node:fs';
import path from 'node:path';

const SNAPSHOT = process.env.SWEEP_SNAPSHOT ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/snapshot-0923.json';
const UA = 'tg-widgets-airport-sweep/1.0 (https://widgets.travelify.io; Travelgenix content verification, low volume)';
const [code, filter] = [String(process.argv[2] || '').toUpperCase(), process.argv[3]];
const rec = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).records.find(r => r.cellValuesByFieldId.fldcS9uu4NWMVaIVP === code);
if (!rec || !rec.cellValuesByFieldId.fldRqtt44nsacJCwq) { console.error(code + ': no Wikipedia URL'); process.exit(1); }
const title = decodeURIComponent(new URL(rec.cellValuesByFieldId.fldRqtt44nsacJCwq).pathname.replace(/^\/wiki\//, ''));
const api = 'https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&redirects=1&prop=externallinks&page=' + encodeURIComponent(title);
// Shared back-off with wiki.mjs: if Wikimedia refused us in the last two hours, do not ask again.
const EVIDENCE = process.env.SWEEP_EVIDENCE ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/evidence';
const BLOCK = path.join(EVIDENCE, '..', 'wikimedia-blocked.txt');
try {
  if (Date.now() - fs.statSync(BLOCK).mtimeMs < 2 * 3600e3) { console.error(code + ': skipped. ' + fs.readFileSync(BLOCK, 'utf8').trim()); process.exit(2); }
} catch (e) { if (e.code !== 'ENOENT') throw e; }
const resp = await fetch(api, { headers: { 'User-Agent': UA } });
if (resp.status === 403) {
  fs.writeFileSync(BLOCK, `Wikimedia answered 403 at ${new Date().toISOString()}; wiki.mjs and refs.mjs skip it for two hours.\n`);
  console.error(code + ': Wikimedia answered 403 (robot policy). Not retrying; wiki.mjs and refs.mjs will skip it for two hours.');
  process.exit(2);
}
const j = await resp.json();
const SKIP = /wikipedia\.org|wikimedia\.org|wikidata\.org|wikiwand|archive\.org\/web\/[^/]+\/https?:\/\/[^/]*wikipedia|facebook\.com|twitter\.com|x\.com\/|instagram\.com|youtube\.com|geohack|toolforge|worldcat|doi\.org|books\.google/i;
const links = [...new Set((j.parse && j.parse.externallinks) || [])].filter(u => !SKIP.test(u));
const rx = filter ? new RegExp(filter, 'i') : null;
const byHost = new Map();
for (const u of links) {
  if (rx && !rx.test(u)) continue;
  let h; try { h = new URL(u).hostname.replace(/^www\./, ''); } catch { continue; }
  if (!byHost.has(h)) byHost.set(h, []);
  byHost.get(h).push(u);
}
console.log(`${code}: ${links.length} cited links${rx ? ', ' + [...byHost.values()].flat().length + ' matching /' + filter + '/' : ''}\n`);
for (const [h, us] of [...byHost].sort((a, b) => b[1].length - a[1].length)) {
  console.log(h + '  (' + us.length + ')');
  for (const u of us.slice(0, 6)) console.log('   ' + u);
}
