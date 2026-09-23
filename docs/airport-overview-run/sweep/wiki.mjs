/* Source 1 for the sweep: the Wikipedia text each Overview was written from.

   Usage: node wiki.mjs <IATA> [<IATA> ...]

   For each airport, writes to $SWEEP_EVIDENCE/<IATA>/:
     wikipedia-archived.txt  the exact text the Overview was drafted from, when
                             it is in ../evidence/batch-NN.json (batches 7-13)
     wikipedia-now.txt       the article as it reads today, fetched fresh
     wikipedia-infobox.txt   today's infobox as plain "key = value" lines, which
                             is where passenger figures, runways, operator and
                             opening dates usually live (the plain-text article
                             leaves the infobox out)

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
const UA = 'tg-widgets-airport-sweep/1.0 (https://widgets.travelify.io; Travelgenix content verification, low volume)';

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

async function infobox(url) {
  const title = decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, ''));
  const api = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1' +
    '&prop=revisions&rvprop=content|timestamp|ids&rvslots=main&titles=' + encodeURIComponent(title);
  const r = await fetch(api, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const j = await r.json();
  const rev = j.query && j.query.pages && j.query.pages[0] && j.query.pages[0].revisions && j.query.pages[0].revisions[0];
  if (!rev) return null;
  const w = rev.slots.main.content;
  const start = w.search(/\{\{\s*Infobox[ _]airport/i);
  if (start < 0) return { rev, lines: [] };
  let depth = 0, i = start;
  for (; i < w.length; i++) {
    if (w.startsWith('{{', i)) { depth++; i++; }
    else if (w.startsWith('}}', i)) { depth--; i++; if (!depth) break; }
  }
  const body = w.slice(start, i + 1)
    .replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '; ').replace(/\{\{(increase|decrease|steady|nowrap|small)\}\}/gi, '')
    .replace(/\{\{convert\|([\d.,]+)\|(\w+)[^}]*\}\}/gi, '$1 $2').replace(/\{\{(?:nowrap|small|lang\|\w+)\|([^{}]*)\}\}/gi, '$1')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '');
  const lines = body.split(/\n\s*\|/).slice(1).map(l => l.replace(/\s+/g, ' ').trim()).filter(l => /=\s*\S/.test(l));
  return { rev, lines };
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
  const box = wiki ? await infobox(wiki).catch(() => null) : null;
  if (box && box.lines.length) {
    fs.writeFileSync(path.join(dir, 'wikipedia-infobox.txt'),
      `URL: ${wiki}\nFETCHED: ${new Date().toISOString()}\nHTTP: 200\nKIND: wikipedia infobox (revision ${box.rev.revid} of ${box.rev.timestamp})\n----\n${box.lines.join('\n')}\n`);
  }
  console.log(code.padEnd(4) + ' ' + (a ? 'archived ' + a.file : 'no archive      ') + '  infobox: ' + (box ? box.lines.length + ' lines' : 'none') + '  now: ' +
    (now ? now.text.length + ' chars, rev ' + (now.rev ? now.rev.timestamp : '?') : 'FAILED') + '  ' + (f.fldlT6eApAdQHGYED || '(no name)'));
  await new Promise(s => setTimeout(s, 400));
}
