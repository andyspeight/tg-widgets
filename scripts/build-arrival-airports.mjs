/**
 * Rebuild api/_data/airports-arrivals.json from OurAirports (public domain).
 *
 *   node scripts/build-arrival-airports.mjs
 *
 * WHY THIS FILE EXISTS. Dynamic packaging has to name a real airport for each
 * flight leg, and a TTI row carries a property code and a country — never an
 * airport. So the arrival airport is resolved from the hotel's position, which
 * needs a list with COORDINATES. Neither list we had could do it:
 * airports-departures.json has 3,242 airports but no coordinates, and
 * airports.json has coordinates but only 106 majors. A hotel in Bournemouth
 * therefore resolved to Bristol, 95km away, while Bournemouth Airport sat in
 * neither usable list (Andy, 14 Sep 2026: "why is it choosing Bristol when
 * there is an airport in Bournemouth?").
 *
 * FILTER: large or medium airports, with scheduled service, with a real IATA
 * code — the same filter the departures list uses. Scheduled service is the
 * one that matters here: it is what makes an airport somewhere a package can
 * actually land.
 *
 * The sandbox reaches raw.githubusercontent.com but not the github.io mirror,
 * so that one is tried first.
 */

import { writeFileSync } from 'node:fs';

const SOURCES = [
  'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
  'https://davidmegginson.github.io/ourairports-data/airports.csv',
];

/** Minimal correct CSV parser: quoted fields, embedded commas and quotes. */
function parseCsv(text) {
  const rows = [];
  let row = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

let text = null;
for (const url of SOURCES) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (r.ok) { text = await r.text(); break; }
    console.error(`[arrivals] ${url} -> HTTP ${r.status}`);
  } catch (e) { console.error(`[arrivals] ${url} -> ${e.message}`); }
}
if (!text) { console.error('[arrivals] no source reachable; file left unchanged'); process.exit(1); }

const rows = parseCsv(text);
const head = rows.shift().map((h) => h.replace(/^"|"$/g, ''));
const col = (name) => head.indexOf(name);
const [cType, cName, cLat, cLng, cCtry, cMuni, cSched, cIata] =
  ['type', 'name', 'latitude_deg', 'longitude_deg', 'iso_country', 'municipality', 'scheduled_service', 'iata_code'].map(col);

const keep = new Map();
for (const r of rows) {
  const iata = String(r[cIata] || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata)) continue;
  const type = r[cType];
  if (type !== 'large_airport' && type !== 'medium_airport') continue;
  if (r[cSched] !== 'yes') continue;
  const lat = Number(r[cLat]); const lng = Number(r[cLng]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
  // Fold the town into the label when the name does not carry it, so an agent
  // reading "Flying into BOH" sees somewhere they recognise.
  let name = String(r[cName] || '').trim();
  const muni = String(r[cMuni] || '').trim();
  if (muni && !name.toLowerCase().includes(muni.toLowerCase())) name = `${name}, ${muni}`;
  const isLarge = type === 'large_airport';
  const prev = keep.get(iata);
  if (prev && prev[5] && !isLarge) continue;   // one row per code, large wins
  keep.set(iata, [iata, name.slice(0, 80), String(r[cCtry] || '').trim().toUpperCase(),
    Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4, isLarge]);
}

// Large first, then medium, alphabetical within each — so "the country's first
// entry" is its biggest airport.
const airports = [...keep.values()].sort((a, b) => (a[5] === b[5] ? (a[0] < b[0] ? -1 : 1) : (a[5] ? -1 : 1)));

// Validate before overwriting anything. A silently truncated list would send
// every package to the wrong airport, which looks like a supplier problem.
const have = new Set(airports.map((a) => a[0]));
const problems = [];
if (airports.length < 2000 || airports.length > 5000) problems.push(`count ${airports.length}`);
for (const c of ['BOH', 'SOU', 'LHR', 'JFK', 'DXB', 'CGN', 'BRS']) if (!have.has(c)) problems.push(`missing ${c}`);
const majors = JSON.parse(
  await (await import('node:fs/promises')).readFile(new URL('../api/_data/airports.json', import.meta.url), 'utf8'),
).airports.map((a) => a[0]);
for (const m of majors) if (!have.has(m)) problems.push(`lost curated major ${m}`);
if (problems.length) { console.error('[arrivals] refused:', problems.join('; ')); process.exit(1); }

writeFileSync(new URL('../api/_data/airports-arrivals.json', import.meta.url), JSON.stringify({
  _comment: 'Arrival airports for dynamic packaging: every large or medium airport with scheduled '
    + 'service and an IATA code, WITH COORDINATES, from the OurAirports public-domain dataset. '
    + '[iata, label, countryCode, lat, lng, isLarge]. This exists because airports-departures.json '
    + 'carries no coordinates and airports.json carries only 106 majors, so a hotel in Bournemouth '
    + 'resolved to Bristol 95km away while Bournemouth Airport sat in neither usable list '
    + '(Andy, 14 Sep 2026). Scheduled service is the filter that matters: it is what makes an '
    + 'airport somewhere a package can actually land. Server-side only, never served to a browser. '
    + 'Rebuild: scripts/build-arrival-airports.mjs',
  source: 'https://davidmegginson.github.io/ourairports-data/airports.csv',
  fetchedAt: new Date().toISOString().slice(0, 10),
  counts: { large: airports.filter((a) => a[5]).length, medium: airports.filter((a) => !a[5]).length },
  airports,
}));
console.log(`[arrivals] wrote ${airports.length} airports`);
