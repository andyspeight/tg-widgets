/* Source 1 for the sweep: the Wikipedia text each Overview was written from.

   Usage: node wiki.mjs <IATA> [<IATA> ...]

   For each airport, writes to $SWEEP_EVIDENCE/<IATA>/:
     wikipedia-archived.txt  the exact text the Overview was drafted from, when
                             it is in ../evidence/batch-NN.json (batches 7-13)
     wikipedia-now.txt       the article as it reads today, fetched fresh

   The archived copy is what the Overview was traced against. The fresh copy
   shows whether the article has moved since, which matters for anything
   recent. Neither counts as the SECOND source: that has to come from outside
   Wikimedia. */
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EVIDENCE = process.env.SWEEP_EVIDENCE ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/evidence';
const SNAPSHOT = process.env.SWEEP_SNAPSHOT ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/snapshot-0923.json';
const UA = 'tg-widgets airport verification sweep (andy.speight@agendas.group)';

const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).records;
const archive = new Map();
for (const f of fs.readdirSync(path.join(HERE, '..', 'evidence'))) {
  for (const b of JSON.parse(fs.readFileSync(path.join(HERE, '..', 'evidence', f), 'utf8'))) {
    archive.set(b.iata, { file: f, text: b.text, id: b.id });
  }
}

async function articleText(url) {
  const title = decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, ''));
  const api = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2' +
    '&prop=extracts|revisions&rvprop=timestamp|ids&explaintext=1&redirects=1&titles=' + encodeURIComponent(title);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(api, { headers: { 'User-Agent': UA } });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 3000 * (attempt + 1))); continue; }
    const j = await r.json();
    const p = j.query && j.query.pages && j.query.pages[0];
    if (!p || p.missing) return null;
    return { title: p.title, text: p.extract || '', rev: p.revisions && p.revisions[0] };
  }
  return null;
}

for (const code of process.argv.slice(2).map(s => s.toUpperCase())) {
  const rec = snap.find(r => r.cellValuesByFieldId.fldcS9uu4NWMVaIVP === code);
  if (!rec) { console.log(code + '  not in snapshot'); continue; }
  const f = rec.cellValuesByFieldId;
  const dir = path.join(EVIDENCE, code);
  fs.mkdirSync(dir, { recursive: true });
  const a = archive.get(code);
  if (a) {
    fs.writeFileSync(path.join(dir, 'wikipedia-archived.txt'),
      `URL: ${f.fldRqtt44nsacJCwq}\nFETCHED: archived in docs/airport-overview-run/evidence/${a.file}\nHTTP: archived\nKIND: wikipedia\n----\n${a.text}`);
  }
  const wiki = f.fldRqtt44nsacJCwq;
  let now = null;
  if (wiki) now = await articleText(wiki).catch(() => null);
  if (now) {
    fs.writeFileSync(path.join(dir, 'wikipedia-now.txt'),
      `URL: ${wiki}\nFETCHED: ${new Date().toISOString()}\nHTTP: 200\nKIND: wikipedia (revision ${now.rev ? now.rev.revid + ' of ' + now.rev.timestamp : '?'})\n----\n${now.text}`);
  }
  console.log(code.padEnd(4) + ' ' + (a ? 'archived ' + a.file : 'no archive      ') + '  now: ' +
    (now ? now.text.length + ' chars, rev ' + (now.rev ? now.rev.timestamp : '?') : 'FAILED') + '  ' + (f.fldlT6eApAdQHGYED || '(no name)'));
  await new Promise(s => setTimeout(s, 400));
}
