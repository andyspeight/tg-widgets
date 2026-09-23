/* Find second sources without a search engine: list the external sources an
   airport's Wikipedia article cites, so the auditor can open the ORIGINAL
   publisher (a Reuters report, an operator's traffic release, a government
   notice) with grab.mjs.

   Usage: node refs.mjs <IATA> [filter-regex]

   What a cited page says counts as that publisher's word, not Wikipedia's, but
   only once grab.mjs has saved it and the quote is on it. Wikipedia mirrors,
   archive copies of Wikipedia and social media are left out. */
import fs from 'node:fs';

const SNAPSHOT = process.env.SWEEP_SNAPSHOT ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/snapshot-0923.json';
const UA = 'tg-widgets airport verification sweep (andy.speight@agendas.group)';
const [code, filter] = [String(process.argv[2] || '').toUpperCase(), process.argv[3]];
const rec = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).records.find(r => r.cellValuesByFieldId.fldcS9uu4NWMVaIVP === code);
if (!rec || !rec.cellValuesByFieldId.fldRqtt44nsacJCwq) { console.error(code + ': no Wikipedia URL'); process.exit(1); }
const title = decodeURIComponent(new URL(rec.cellValuesByFieldId.fldRqtt44nsacJCwq).pathname.replace(/^\/wiki\//, ''));
const api = 'https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&redirects=1&prop=externallinks&page=' + encodeURIComponent(title);
const j = await (await fetch(api, { headers: { 'User-Agent': UA } })).json();
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
