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

import { listAll, AIRPORTS_TBL, COUNTRIES_TBL, AF } from './_ref.js';

const CITIES_TBL = 'tblTkKujdVZgWPAQe';
const PARKS_TBL = 'tblhVDUdpwaLabDmQ';
const COUNTRY_GETTING_THERE = 'fld98IDBKf9mFpxoG';
const CITY_GETTING_THERE = 'fldDppgzDttdnfmTZ';
const PARK_NEAREST_AIRPORT = 'fldOM08zdOuuOpjBX';

// A few codes that look like IATA but are common false positives in prose.
const STOP = new Set(['THE', 'AND', 'FOR', 'ARE', 'YOU', 'GMT', 'VIP', 'WWW', 'USD', 'GBP', 'EUR', 'CEO', 'FAQ', 'ATM', 'SUV']);

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

  const missing = missingCodes([...referenced.keys()], existing)
    .map(iata => ({ iata, mentions: referenced.get(iata).count, sample: referenced.get(iata).sample }))
    .sort((a, b) => b.mentions - a.mentions);

  return {
    existingAirports: existing.size,
    referencedCodes: referenced.size,
    missingCount: missing.length,
    missing,
  };
}
