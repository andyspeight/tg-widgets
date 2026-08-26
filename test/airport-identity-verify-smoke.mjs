/**
 * Smoke test for the two-independent-source identity rules.
 *
 * The rule this guards: a field is written only when BOTH sources saw it.
 * Identity agreeing is not enough. Before corroborateFields existed, a record
 * whose coordinates matched had its name, city and country written from
 * OurAirports alone, which is single-sourcing wearing a verified badge.
 *
 * Run: node test/airport-identity-verify-smoke.mjs
 */
import {
  corroborateFields, crossVerify, identityFields, normalizeName,
  parseOurAirports, parseWikidataSparql, splitCsvLine, haversineKm,
} from '../api/reference/_breadth_fill.js';
import { targetCodes } from '../api/reference/_breadth.js';

let pass = 0; const fails = [];
const ok = (label, cond) => { if (cond) pass++; else fails.push(label); };

// --- a clean two-source agreement -----------------------------------------
const OA = { iata: 'LHR', name: 'London Heathrow Airport', city: 'London', country: 'GB', lat: 51.4706, lon: -0.461941, source: 'https://ourairports/' };
const WD = { iata: 'LHR', name: 'Heathrow Airport', city: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.4775, lon: -0.4614, source: 'https://wikidata/Q8709' };

const clean = corroborateFields(OA, WD);
ok('name corroborated when labels overlap', clean.corroborated.includes('name'));
ok('name value taken from the fuller source', clean.fields.name === 'London Heathrow Airport');
ok('coordinates corroborated when close', clean.corroborated.includes('lat') && clean.corroborated.includes('lon'));
ok('country corroborated on matching ISO codes', clean.fields.country === 'GB');
ok('city corroborated on matching place names', clean.fields.city === 'London');
ok('nothing left uncorroborated on a clean match', clean.uncorroborated.length === 0);

// --- coordinates agree but nothing else does ------------------------------
const WD_THIN = { iata: 'LHR', name: '', city: '', country: '', countryCode: '', lat: 51.4775, lon: -0.4614, source: 'https://wikidata/Q8709' };
const thin = corroborateFields(OA, WD_THIN);
ok('identity still passes on coordinates alone', crossVerify(OA, WD_THIN).verified === true);
ok('but the name is NOT written from one source', !('name' in thin.fields));
ok('and the country is NOT written from one source', !('country' in thin.fields));
ok('and the city is NOT written from one source', !('city' in thin.fields));
ok('coordinates are still written', thin.fields.lat === OA.lat && thin.fields.lon === OA.lon);
ok('the uncorroborated fields are reported', ['name', 'country', 'city'].every(f => thin.uncorroborated.includes(f)));

// --- a country mismatch must not be papered over --------------------------
const WD_WRONG_CC = { ...WD, countryCode: 'FR' };
ok('country dropped when ISO codes differ', !('country' in corroborateFields(OA, WD_WRONG_CC).fields));

// --- a code compared against a display name must never match --------------
const WD_NAME_ONLY = { ...WD, countryCode: '' };
ok('country dropped when only a label is available', !('country' in corroborateFields(OA, WD_NAME_ONLY).fields));

// --- coordinates far apart --------------------------------------------------
const WD_FAR = { ...WD, lat: 40.6413, lon: -73.7781 };
ok('far coordinates are a conflict', crossVerify(OA, WD_FAR).verified === false);
ok('far coordinates are not written', !('lat' in corroborateFields(OA, WD_FAR).fields));

// --- blank fields are omitted, never written empty -------------------------
const f = identityFields({ iata: 'ABC', source1: 'a', source2: 'b', verifiedDate: '2026-08-25' });
ok('identityFields always sets IATA', Object.values(f).includes('ABC'));
ok('identityFields omits an absent name', !Object.values(f).includes(undefined));
ok('identityFields carries both sources', Object.values(f).includes('a') && Object.values(f).includes('b'));
const f2 = identityFields({ iata: 'ABC', name: 'X Airport', lat: 1, lon: 2, source1: 'a', source2: 'b', verifiedDate: '2026-08-25' });
ok('identityFields writes a supplied name', Object.values(f2).includes('X Airport'));
ok('identityFields writes supplied coordinates', Object.values(f2).includes(1) && Object.values(f2).includes(2));

// --- parsers ---------------------------------------------------------------
const CSV = 'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code\n' +
            '1,EGLL,large_airport,"London Heathrow Airport",51.4706,-0.461941,83,EU,GB,GB-ENG,London,yes,EGLL,LHR';
const parsed = parseOurAirports(CSV, 'LHR');
ok('OurAirports row parses', parsed && parsed.name === 'London Heathrow Airport');
ok('OurAirports country is the ISO code', parsed.country === 'GB');
ok('OurAirports municipality becomes city', parsed.city === 'London');
ok('unknown IATA returns null', parseOurAirports(CSV, 'ZZZ') === null);
ok('quoted CSV fields split correctly', splitCsvLine('a,"b,c",d').length === 3);

const SPARQL = { results: { bindings: [{
  airport: { value: 'https://www.wikidata.org/entity/Q8709' },
  airportLabel: { value: 'Heathrow Airport' },
  countryLabel: { value: 'United Kingdom' },
  iso: { value: 'gb' },
  placeLabel: { value: 'London' },
  coord: { value: 'Point(-0.4614 51.4775)' },
}] } };
const wd = parseWikidataSparql(SPARQL, 'LHR');
ok('Wikidata label parses', wd.name === 'Heathrow Airport');
ok('Wikidata ISO code parses and upper-cases', wd.countryCode === 'GB');
ok('Wikidata place becomes city', wd.city === 'London');
ok('Wikidata Point parses lon then lat', Math.round(wd.lat) === 51 && Math.round(wd.lon) === 0);
ok('empty bindings return null', parseWikidataSparql({ results: { bindings: [] } }, 'LHR') === null);

// --- helpers ---------------------------------------------------------------
ok('normalizeName strips airport noise', normalizeName('London Heathrow Airport') === 'london heathrow');
ok('haversine returns null on bad input', haversineKm(1, 2, NaN, 4) === null);
ok('haversine measures a known gap', Math.round(haversineKm(51.47, -0.46, 40.64, -73.78)) > 5000);

// --- the worklist ----------------------------------------------------------
const targets = targetCodes();
ok('target worklist loads', targets.length > 0);
ok('target worklist is the agreed size', targets.length === 475);
ok('every target is a valid IATA shape', targets.every(c => /^[A-Z]{3}$/.test(c)));
ok('target worklist has no duplicates', new Set(targets).size === targets.length);
ok('the busiest airports are on the worklist', ['ATL', 'LHR', 'JFK', 'DXB'].every(c => targets.includes(c)));

// --- accented and apostrophed names ---------------------------------------
// Real pairs from the first fill run on 26 Aug 2026. Punctuation used to become
// a space BEFORE the token length filter, which split accented words mid-letter
// ("Málaga" -> "m laga") and reduced apostrophed ones to nothing. Tahiti and
// Puerto Vallarta were created with no name because of it.
const tok = s => new Set(normalizeName(s).split(' ').filter(w => w.length > 2));
const overlaps = (a, b) => {
  const ta = tok(a), tb = tok(b);
  if (!ta.size || !tb.size) return 0;
  let n = 0; for (const w of ta) if (tb.has(w)) n++;
  return n / Math.min(ta.size, tb.size);
};

ok('an accent folds to its base letter', normalizeName('Málaga Airport') === 'malaga');
ok('an accent does not split the word', !normalizeName('Díaz Ordaz').includes('d az'));
ok('apostrophes are removed, not turned into gaps', normalizeName("Fa'a'a Airport") === 'faaa');
ok('a macron folds too', normalizeName("Fa'a'ā Airport") === 'faaa');

ok('Malaga matches Málaga-Costa del Sol', overlaps('Malaga Airport', 'Málaga-Costa del Sol Airport') >= 0.5);
ok('Tahiti matches across the apostrophes', overlaps("Faa'a International Airport", "Fa'a'ā International Airport") >= 0.5);
ok('Puerto Vallarta matches its longer official name', overlaps('Licenciado Gustavo Díaz Ordaz International Airport', 'Gustavo Díaz Ordaz International Airport') >= 0.5);
ok('Sao Paulo matches São Paulo', overlaps('Sao Paulo Guarulhos International Airport', 'São Paulo/Guarulhos International Airport') >= 0.5);
ok('Dusseldorf matches Düsseldorf', overlaps('Dusseldorf Airport', 'Düsseldorf Airport') >= 0.5);

// Folding must not make genuinely different airports look the same.
ok('folding does not collide unrelated names', overlaps('Malaga Airport', 'Malta International Airport') < 0.5);
ok('folding does not collide two Paris fields', overlaps('Charles de Gaulle International Airport', 'Paris Orly Airport') < 0.5);

if (fails.length) {
  console.error(`FAIL ${fails.length} of ${pass + fails.length}`);
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log(`PASS airport identity verification: ${pass} assertions`);
