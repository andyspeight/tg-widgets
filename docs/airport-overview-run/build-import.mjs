/**
 * build-import.mjs - regenerate the Luna airport import payload from source.
 *
 * Rebuilds, from two public datasets and nothing else, the list of airports
 * that qualify for the Destination Content table under the rule Andy agreed
 * on 22 Sep 2026:
 *
 *     peak annual passengers >= 1,000,000
 *     OR busiest airport in its country with at least 100,000
 *
 * Usage:
 *     node build-import.mjs                 # writes create-payload.json
 *     node build-import.mjs --existing a.json   # skip IATA codes already held
 *
 * It does NOT write to Airtable. It emits the payload; the create call is made
 * separately (this environment has no AIRTABLE_PAT, so the 22 Sep run went
 * through the Airtable MCP in batches of 45).
 *
 * Andy's locked rule applies: no made-up data. Every field below is copied
 * from a fetched source or left blank.
 *
 * It will NOT reproduce the 18 airports added by hand on 23 Sep 2026 (UBN VTE
 * MJI BWN BJL LLW FNA ROB RAR TBU AXA GOH MGQ KBL HIR JUB PBH TMS). Their
 * countries have no Wikidata passenger figure, so their traffic was sourced
 * from national statistics and the WFP Logistics Cluster instead. See
 * thirty-countries.md. When reconciling a re-run against the table, expect them
 * as extra records, not strays.
 */

const AIRPORTS_CSV = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const WDQS = 'https://query.wikidata.org/sparql';

// Airtable field IDs - Destination Content base appuZdlMJ7HKUt6qS,
// Airports table tblI2iVAbIGCtsGa7.
const F = {
  name:    'fldlT6eApAdQHGYED',
  iata:    'fldcS9uu4NWMVaIVP',
  country: 'fldjARk52dZi7TGGc',
  lat:     'fldXZKuycZOgJScSj',
  lng:     'fldRG7pc5iPJPzhEI',
  wiki:    'fldRqtt44nsacJCwq',
  source1: 'fldEVfcn75Tm0u0Es',
  status:  'fldjvujj14Q9QNLLq',
};

// Peak since this year. Taking the LATEST P3872 statement instead gives
// garbage: Wikidata holds several statements per year and "most recent" lands
// on pandemic figures. 334 of 2,960 airports read under a fifth of their own
// historic max that way.
const PEAK_SINCE = 2015;

const THRESHOLD = 1_000_000;
const COUNTRY_FLOOR = 100_000;

/** Minimal CSV reader - OurAirports quotes fields containing commas. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length)
             .map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function fetchAirports() {
  const res = await fetch(AIRPORTS_CSV);
  if (!res.ok) throw new Error(`OurAirports ${res.status}`);
  const all = parseCsv(await res.text());
  return all.filter(a =>
    a.scheduled_service === 'yes' &&
    /^[A-Z]{3}$/.test((a.iata_code || '').trim())
  );
}

/** Peak annual passengers per IATA code, from Wikidata P3872. */
async function fetchPeakPassengers() {
  const query = `
    SELECT ?iata ?pax ?when WHERE {
      ?airport wdt:P238 ?iata ;
               p:P3872 ?st .
      ?st ps:P3872 ?pax .
      OPTIONAL { ?st pq:P585 ?when }
    }`;
  const res = await fetch(`${WDQS}?query=${encodeURIComponent(query)}`, {
    headers: {
      accept: 'application/sparql-results+json',
      'user-agent': 'travelgenix-luna-airport-import/1.0 (https://widgets.travelify.io)',
    },
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const { results } = await res.json();

  const peak = new Map();
  for (const b of results.bindings) {
    const iata = b.iata?.value;
    const pax = Number(b.pax?.value);
    if (!iata || !Number.isFinite(pax) || pax <= 0) continue;
    const year = b.when ? new Date(b.when.value).getUTCFullYear() : null;
    if (year !== null && year < PEAK_SINCE) continue;
    const prev = peak.get(iata);
    if (!prev || pax > prev.p) peak.set(iata, { p: pax, y: year });
  }
  return peak;
}

function qualify(rows) {
  const bestByCountry = new Map();
  for (const r of rows) {
    if (r.pax === null) continue;
    const best = bestByCountry.get(r.country);
    if (!best || r.pax > best.pax) bestByCountry.set(r.country, r);
  }
  return rows.filter(r => {
    if (r.pax === null) return false;
    if (r.pax >= THRESHOLD) return true;
    const best = bestByCountry.get(r.country);
    return !!(best && best.iata === r.iata && r.pax >= COUNTRY_FLOOR);
  });
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = code => {
  let name;
  try { name = regionNames.of(code) || code; } catch { return code; }
  // UK English house style: St Martin, not St. Martin.
  return name.replace(/\bSt\./g, 'St');
};

async function main() {
  const skipArg = process.argv.indexOf('--existing');
  let held = new Set();
  if (skipArg > -1) {
    const { readFileSync } = await import('node:fs');
    held = new Set(JSON.parse(readFileSync(process.argv[skipArg + 1], 'utf8')));
  }

  const [airports, peak] = await Promise.all([fetchAirports(), fetchPeakPassengers()]);
  console.log(`OurAirports: ${airports.length} with scheduled service and an IATA code`);
  console.log(`Wikidata:    ${peak.size} airports with a usable passenger figure`);

  const rows = airports.map(a => ({
    iata: a.iata_code.trim(),
    name: a.name,
    country: a.iso_country,
    lat: Number(a.latitude_deg),
    lng: Number(a.longitude_deg),
    wiki: a.wikipedia_link || '',
    pax: peak.get(a.iata_code.trim())?.p ?? null,
  }));

  const passing = qualify(rows);
  const overThreshold = passing.filter(r => r.pax >= THRESHOLD).length;
  console.log(`Qualifying:  ${passing.length} (>=1m: ${overThreshold}, country floor: ${passing.length - overThreshold})`);
  console.log(`Countries:   ${new Set(passing.map(r => r.country)).size}`);

  const fresh = passing.filter(r => !held.has(r.iata));
  console.log(`New records: ${fresh.length}`);

  // City Served, Airport Type, Airport Role and Verified Date stay blank on
  // purpose. municipality is where the airport STANDS, not what it SERVES;
  // type and role cannot be derived from this data; and Verified Date is only
  // ever written by an audit, never at creation.
  const payload = fresh.map(r => ({
    fields: {
      [F.name]:    r.name,
      [F.iata]:    r.iata,
      [F.country]: countryName(r.country),
      [F.lat]:     Number(r.lat.toFixed(4)),
      [F.lng]:     Number(r.lng.toFixed(4)),
      ...(r.wiki ? { [F.wiki]: r.wiki } : {}),
      [F.source1]: AIRPORTS_CSV,
      [F.status]:  'Todo',
    },
  }));

  const { writeFileSync } = await import('node:fs');
  writeFileSync('create-payload.json', JSON.stringify(payload, null, 2));
  console.log('wrote create-payload.json');
}

main().catch(err => { console.error(err); process.exit(1); });
