// Usage: node wiki-coords.mjs <IATA-folder> "<from title>" "<to title>" ["<to title>" ...]
// Saves each article's Wikipedia coordinates (prop=coordinates, primary) and the straight-line distance and
// bearing from the first to each of the others, to $SWEEP_EVIDENCE/<IATA>/wikipedia-coords.txt. A second,
// independent set of coordinates for airport-to-airport distances, next to geo.mjs's OurAirports figures
// (added 23 Sep late evening, for Strasbourg). One request; honours the
// shared Wikimedia back-off marker.
import fs from 'node:fs';
import path from 'node:path';
const EVIDENCE = process.env.SWEEP_EVIDENCE || '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/evidence';
const BLOCK = path.join(EVIDENCE, '..', 'wikimedia-blocked.txt');
try { if (Date.now() - fs.statSync(BLOCK).mtimeMs < 2 * 3600e3) { console.log('Wikimedia back-off in force: ' + fs.readFileSync(BLOCK, 'utf8')); process.exit(1); } } catch {}
const UA = 'tg-widgets-airport-sweep/1.0 (https://widgets.travelify.io; Travelgenix content verification, low volume)';
const [folder, from, ...tos] = process.argv.slice(2);
const titles = [from, ...tos];
const api = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=coordinates|revisions&rvprop=ids|timestamp&titles=' + encodeURIComponent(titles.join('|'));
const r = await fetch(api, { headers: { 'User-Agent': UA } });
if (r.status === 403) { fs.writeFileSync(BLOCK, `Wikimedia answered 403 at ${new Date().toISOString()}; wiki.mjs and refs.mjs skip it for two hours.\n`); console.log('403'); process.exit(1); }
const j = await r.json();
const norm = new Map((j.query.normalized || []).map(n => [n.from, n.to]));
const redir = new Map((j.query.redirects || []).map(n => [n.from, n.to]));
const page = t => { let x = norm.get(t) || t; x = redir.get(x) || x; return j.query.pages.find(p => p.title === x); };
const R = 6371, rad = x => x * Math.PI / 180, pts = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west'];
const P = titles.map(t => { const p = page(t); const c = p && p.coordinates && p.coordinates[0]; return { t, title: p && p.title, c, rev: p && p.revisions && p.revisions[0] }; });
let out = `URL: ${api}\nFETCHED: ${new Date().toISOString()}\nHTTP: ${r.status}\nKIND: Wikipedia article coordinates (prop=coordinates, primary), with straight-line distances computed from them\n----\n`;
for (const p of P) out += `Wikipedia coordinates for ${p.title} (revision ${p.rev ? p.rev.revid + ' of ' + p.rev.timestamp : '?'}): ${p.c ? p.c.lat.toFixed(4) + ', ' + p.c.lon.toFixed(4) : 'none'}\n`;
const a = P[0];
for (const b of P.slice(1)) {
  if (!a.c || !b.c) continue;
  const [la1, lo1, la2, lo2] = [a.c.lat, a.c.lon, b.c.lat, b.c.lon];
  const d = 2 * R * Math.asin(Math.sqrt(Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2));
  const y = Math.sin(rad(lo2 - lo1)) * Math.cos(rad(la2)), x = Math.cos(rad(la1)) * Math.sin(rad(la2)) - Math.sin(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1));
  const br = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  out += `Straight-line distance from ${a.title} to ${b.title}, from the Wikipedia coordinates: ${d.toFixed(1)} km, bearing ${Math.round(br)} degrees, which is ${pts[Math.round(br / 45) % 8]}\n`;
}
const f = path.join(EVIDENCE, folder, 'wikipedia-coords.txt'); fs.writeFileSync(f, out); console.log(out);
