/**
 * Reference breadth detector.
 *
 * Finds airports the content already talks about but has no data card for:
 * scans the parenthesised IATA codes in destination prose (Theme Parks'
 * "Nearest Airport", Country/City "Getting There") and diffs them against the
 * Airports table. Deterministic, no AI, no fabrication — it reports the gap so
 * a human can add the record from real sources. The reference base is
 * human-verified against two sources, so we never auto-create content here.
 */

import { readFileSync } from 'node:fs';
import { listAll, AIRPORTS_TBL, COUNTRIES_TBL, AF } from './_ref.js';

/**
 * The globally major airports we intend to carry, independent of whether our
 * own prose happens to mention them. Without this the detector could only find
 * gaps in what we had already written about, which caps coverage at the content
 * we happen to have. See scripts/build-airport-targets.mjs.
 *
 * Read via `new URL(..., import.meta.url)` so Vercel's file tracer follows it,
 * the same way api/events-feed.js loads its bundled data. A missing file means
 * no target seeding, never an error: the prose-referenced gaps still work.
 */
export function targetCodes() {
  try {
    const url = new URL('../_data/airport-targets.json', import.meta.url);
    const raw = JSON.parse(readFileSync(url, 'utf8'));
    return Array.isArray(raw.codes) ? raw.codes.filter(c => /^[A-Z]{3}$/.test(c)) : [];
  } catch (err) {
    console.error('[reference/_breadth] target worklist load failed (prose gaps only):', err && err.message);
    return [];
  }
}

const CITIES_TBL = 'tblTkKujdVZgWPAQe';
const PARKS_TBL = 'tblhVDUdpwaLabDmQ';
const COUNTRY_GETTING_THERE = 'fld98IDBKf9mFpxoG';
const CITY_GETTING_THERE = 'fldDppgzDttdnfmTZ';
const PARK_NEAREST_AIRPORT = 'fldOM08zdOuuOpjBX';

/**
 * Codes that look like IATA but are something else in travel prose.
 *
 * The airline block is not theoretical. On 26 Aug 2026 the first fill run
 * created a record for Kalaleh Airport in Iran, because two Caribbean records
 * say "Connect via Amsterdam (KLM)" and KLM is both the Dutch airline and the
 * IATA code for Kalaleh. Airline names in brackets are exactly how a travel
 * writer writes, so they will keep appearing.
 */
const STOP = new Set([
  // words
  'THE', 'AND', 'FOR', 'ARE', 'YOU', 'ALL', 'ANY', 'CAN', 'ONE', 'TWO', 'NEW', 'OUR',
  // organisations and general abbreviations
  'GMT', 'VIP', 'WWW', 'CEO', 'FAQ', 'ATM', 'SUV', 'MPV', 'CDW', 'TBC', 'TBA',
  'NHS', 'VAT', 'TSA', 'PCR', 'ETA', 'EES',
  // currencies
  'USD', 'GBP', 'EUR', 'CHF', 'JPY', 'AUD', 'NZD', 'ZAR', 'THB', 'SEK', 'NOK',
  'DKK', 'PLN', 'CZK', 'HUF', 'IDR', 'INR', 'AED', 'SAR', 'QAR', 'HKD', 'SGD',
  // airlines, which is how this list earned its comment
  'KLM', 'TUI', 'BAW', 'DLH', 'AFR', 'UAE', 'QTR', 'SIA', 'ANA', 'JAL', 'AAL',
  'DAL', 'UAL', 'RYR', 'EZY', 'EJU', 'VIR', 'ETD', 'THY', 'SAS', 'TAP', 'LOT',
]);

/** Extract parenthesised 3-letter codes, e.g. "Orlando International (MCO)" -> ["MCO"]. Pure. */
export function extractIatas(text) {
  const out = [];
  const re = /\(([A-Z]{3})\)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const code = m[1];
    if (!STOP.has(code)) out.push(code);
  }
  return out;
}

/** Set of referenced codes not present in the existing set. Pure. */
export function missingCodes(referenced, existing) {
  const miss = [];
  for (const code of referenced) if (!existing.has(code)) miss.push(code);
  return miss.sort();
}

/**
 * @returns { existingAirports, referencedCodes, missing: [{iata, mentions, sample}] }
 */
export async function runBreadth() {
  const [airports, countries, cities, parks] = await Promise.all([
    listAll(AIRPORTS_TBL, [AF.iata]),
    listAll(COUNTRIES_TBL, ['flddJJrpwcXOwWIow', COUNTRY_GETTING_THERE]),
    listAll(CITIES_TBL, ['fld2VkY61c1JKUWKB', CITY_GETTING_THERE]),
    listAll(PARKS_TBL, ['fldboK0kstNohXgqJ', PARK_NEAREST_AIRPORT]),
  ]);

  const existing = new Set(airports.map(a => (a.fields[AF.iata] || '').toUpperCase().trim()).filter(Boolean));

  // code -> { count, sample (where first seen) }
  const referenced = new Map();
  const scan = (rows, textField, labelField) => {
    for (const r of rows) {
      const codes = extractIatas(r.fields[textField]);
      for (const code of codes) {
        const cur = referenced.get(code) || { count: 0, sample: r.fields[labelField] || '' };
        cur.count++;
        referenced.set(code, cur);
      }
    }
  };
  scan(countries, COUNTRY_GETTING_THERE, 'flddJJrpwcXOwWIow');
  scan(cities, CITY_GETTING_THERE, 'fld2VkY61c1JKUWKB');
  scan(parks, PARK_NEAREST_AIRPORT, 'fldboK0kstNohXgqJ');

  // Two independent reasons an airport belongs in the table: our own content
  // already promises it, or it is one of the globally major airports on the
  // worklist. Airports our prose names come first, because those are the ones a
  // reader can already be sent looking for.
  const targets = targetCodes();
  const fromProse = missingCodes([...referenced.keys()], existing)
    .map(iata => ({ iata, reason: 'content-referenced', mentions: referenced.get(iata).count, sample: referenced.get(iata).sample }))
    .sort((a, b) => b.mentions - a.mentions);

  const proseCodes = new Set(fromProse.map(m => m.iata));
  const fromTargets = missingCodes(targets, existing)
    .filter(iata => !proseCodes.has(iata))
    .map((iata, i) => ({ iata, reason: 'global-major', mentions: 0, rank: targets.indexOf(iata) + 1 || i + 1 }))
    .sort((a, b) => a.rank - b.rank);

  const missing = [...fromProse, ...fromTargets];

  return {
    existingAirports: existing.size,
    referencedCodes: referenced.size,
    targetCodes: targets.length,
    missingCount: missing.length,
    missingFromProse: fromProse.length,
    missingFromTargets: fromTargets.length,
    missing,
  };
}
