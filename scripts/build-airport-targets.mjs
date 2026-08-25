/**
 * scripts/build-airport-targets.mjs
 * ----------------------------------------------------------------
 * Builds api/_data/airport-targets.json: the list of globally major airports
 * we intend to carry in the shared Airports reference table.
 *
 * WHAT THIS FILE IS NOT. It is a WORKLIST, not content. Nothing here is ever
 * written to an airport record. Choosing which airports to cover is a scoping
 * decision; every fact we then publish about one of them still has to be
 * verified against two independent sources per the airport-spotlight skill.
 * That is why the output carries IATA codes and a rank and nothing else: no
 * names, no coordinates, nothing that could leak into a record single-sourced.
 *
 * SELECTION. Airports typed large_airport by OurAirports, with scheduled
 * service and an IATA code (1,149 of them), ranked by route connectivity and
 * cut to --limit. Connectivity comes from the OpenFlights routes table, which
 * is old and partly derived from OurAirports. That would disqualify it as a
 * verification source. It is fine as a popularity proxy for ordering a
 * worklist, which is all it is used for.
 *
 * The reference layer unions this list at run time with the airports already
 * in the table and the airports our own destination prose names, so those two
 * Travelgenix-specific sets stay live rather than frozen into a file.
 *
 * Usage:
 *   node scripts/build-airport-targets.mjs                 # fetch sources
 *   node scripts/build-airport-targets.mjs --limit 475
 *   node scripts/build-airport-targets.mjs --airports <path> --routes <path>
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const AIRPORTS_CSV = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const ROUTES_DAT   = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'api/_data/airport-targets.json');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Minimal CSV line splitter handling quoted fields. Pure. */
export function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Rows of OurAirports that are large, scheduled and IATA-coded. Pure. */
export function majorCodes(csvText) {
  const lines = String(csvText || '').split('\n');
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, ''));
  const ci = n => header.indexOf(n);
  const cType = ci('type'), cSched = ci('scheduled_service'), cIata = ci('iata_code');
  if (cType < 0 || cSched < 0 || cIata < 0) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsvLine(lines[i]);
    if (c[cType] !== 'large_airport') continue;
    if (c[cSched] !== 'yes') continue;
    const iata = (c[cIata] || '').trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(iata)) out.push(iata);
  }
  return [...new Set(out)];
}

/** Route count per airport code from the OpenFlights routes table. Pure. */
export function routeDegrees(datText) {
  const deg = new Map();
  for (const line of String(datText || '').split('\n')) {
    const p = line.split(',');
    if (p.length < 5) continue;
    for (const idx of [2, 4]) {
      const c = (p[idx] || '').trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(c)) deg.set(c, (deg.get(c) || 0) + 1);
    }
  }
  return deg;
}

async function load(urlOrPath, url) {
  if (urlOrPath && existsSync(urlOrPath)) return readFileSync(urlOrPath, 'utf8');
  const r = await fetch(url, { headers: { 'User-Agent': 'LunaBrain/1.0 (+https://travelify.io)' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

async function main() {
  const limit = parseInt(arg('limit', '475'), 10);
  const csv = await load(arg('airports'), AIRPORTS_CSV);
  const dat = await load(arg('routes'), ROUTES_DAT);

  const codes = majorCodes(csv);
  const deg = routeDegrees(dat);
  const ranked = codes
    .slice()
    .sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0) || a.localeCompare(b))
    .slice(0, limit);

  const payload = {
    note: 'Worklist only. Never written to an airport record. Every published fact still needs two independent sources.',
    selection: 'OurAirports large_airport with scheduled service and an IATA code, ranked by OpenFlights route connectivity',
    sources: { airports: AIRPORTS_CSV, connectivity: ROUTES_DAT },
    generatedBy: 'scripts/build-airport-targets.mjs',
    candidates: codes.length,
    limit,
    count: ranked.length,
    codes: ranked,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`wrote ${OUT}: ${ranked.length} of ${codes.length} candidates (limit ${limit})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
