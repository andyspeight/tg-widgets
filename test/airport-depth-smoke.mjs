/**
 * Smoke test for the two serving depths.
 *
 * The rule that must never bend: a record whose narrative has NOT been audited
 * against two sources cannot have that narrative served, by any route. Before
 * 27 Aug 2026 that was enforced by refusing the record entirely, which was safe
 * and also meant 375 correct, two-source-verified airports could not be offered
 * at all. Now they are served at identity depth and the narrative is stripped
 * server side.
 *
 * Stripping in the API rather than skipping in the widget is the whole point. A
 * Draft record is prose that has been WRITTEN and not CHECKED. If the widget
 * were trusted to skip it, the prose would still be in the response, one
 * careless consumer away from a client site.
 *
 * Run: node test/airport-depth-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import {
  AIRPORT_DEPTH, IDENTITY_KEYS, SERVABLE_AIRPORT_STATUSES,
  isServableAirportStatus, airportDepth, toIdentityCard, servableStatusFormula,
} from '../api/_lib/airport-status.js';

let pass = 0; const fails = [];
const ok = (label, cond) => { if (cond) pass++; else fails.push(label); };

// --- depth from status -----------------------------------------------------
ok('Done is full depth', airportDepth('Done') === AIRPORT_DEPTH.FULL);
ok('Live is full depth', airportDepth('Live') === AIRPORT_DEPTH.FULL);
ok('In progress is identity depth', airportDepth('In progress') === AIRPORT_DEPTH.IDENTITY);
ok('Draft is identity depth', airportDepth('Draft') === AIRPORT_DEPTH.IDENTITY);
ok('Todo is identity depth', airportDepth('Todo') === AIRPORT_DEPTH.IDENTITY);
ok('a missing status is identity depth', airportDepth(null) === AIRPORT_DEPTH.IDENTITY);
ok('an Airtable select object works too', airportDepth({ name: 'Done' }) === AIRPORT_DEPTH.FULL);
ok('an unknown status is never full', airportDepth('Published') === AIRPORT_DEPTH.IDENTITY);

// --- the strip -------------------------------------------------------------
const fullPayload = {
  name: 'Sofia Airport', iata: 'SOF', cityServed: 'Sofia', country: 'BG',
  lat: 42.69, lng: 23.41, officialWebsite: 'https://sofia-airport.eu',
  role: 'destination', type: 'International', provisional: false,
  resorts: [{ name: 'Bansko' }], cities: [{ name: 'Sofia' }],
  // narrative
  overview: 'A long audited overview.', tagline: 'Gateway nobody wrote',
  terminalsAndAirlines: 'T1 and T2.', parkingInfo: 'P1 is cheapest.',
  loungesInfo: 'Two lounges.', tips: 'Bring cash.', recommendedArrival: '2 hours.',
  gettingByTrain: 'Metro line 4.', flightTimeFromUk: '3h 10m',
};

const card = toIdentityCard(fullPayload);
ok('the identity card keeps the name', card.name === 'Sofia Airport');
ok('it keeps the IATA code', card.iata === 'SOF');
ok('it keeps city and country', card.cityServed === 'Sofia' && card.country === 'BG');
ok('it keeps coordinates, which is what puts it on a map', card.lat === 42.69 && card.lng === 23.41);
// Deliberately withheld. It is typed by a human and never checked, and sending
// a customer to the wrong airport's website is worse than sending them nowhere.
ok('the official website is withheld until the record is audited', !('officialWebsite' in card));
ok('it keeps structural fields', card.role === 'destination' && card.type === 'International');
ok('it keeps linked resorts and cities', Array.isArray(card.resorts) && Array.isArray(card.cities));

ok('the overview is gone', !('overview' in card));
ok('the tagline is gone', !('tagline' in card));
ok('terminals are gone', !('terminalsAndAirlines' in card));
ok('tips are gone', !('tips' in card));

// THE TEST THAT MATTERS. Read the real payload keys out of the endpoint and
// assert that everything not on the allowlist is stripped. Checking a hand
// written list against itself is what let seven transport fields through the
// first time: the names had been written from memory and were wrong.
const src = readFileSync(new URL('../api/airport-content.js', import.meta.url), 'utf8');
const start = src.indexOf('  return {', src.indexOf('const lat = fldNum(airportRec, AF.lat)'));
const payloadBlock = src.slice(start, src.indexOf('\n  };', start));
// Catch shorthand properties and several keys on one line, both of which the
// first version of this extraction missed: "lat, lng," yielded only lat, and
// "role," yielded nothing, so the audit under-reported what was being served.
const realKeys = payloadBlock
  .split('\n')
  .filter(line => !/^\s*\/\//.test(line))
  .flatMap(line => [...line.matchAll(/(?:^|,)\s*([A-Za-z][A-Za-z0-9]*)\s*(?=[:,]|$)/g)].map(m => m[1]));

ok('the endpoint payload was actually parsed', realKeys.length > 40);
ok('the extraction catches shorthand properties', realKeys.includes('role') && realKeys.includes('lng'));
ok('every allowlisted key really exists in the payload',
  IDENTITY_KEYS.every(k => realKeys.includes(k)));

const everyRealKey = Object.fromEntries(realKeys.map(k => [k, 'VALUE']));
const strippedReal = toIdentityCard(everyRealKey);
const leaked = Object.keys(strippedReal).filter(k => !IDENTITY_KEYS.includes(k));
ok(`nothing outside the allowlist survives (leaked: ${leaked.join(', ') || 'none'})`, leaked.length === 0);

// Name the specific fields that leaked on the first attempt, so a regression
// that reintroduces the blocklist is caught by name rather than by count.
for (const key of ['gettingThereByTrain', 'gettingThereByCar', 'gettingThereByCoach',
  'taxiAndRideshare', 'parking', 'dropOffInfo', 'flightTimeFromUK',
  'terminalsCount', 'keyAirlines', 'hasLounges', 'hasFastTrack', 'heroImageUrl']) {
  ok(`${key} is not served at identity depth`, !(key in strippedReal));
}

ok('the allowlist is an allowlist, so an unknown future key is hidden',
  !('somethingAddedNextMonth' in toIdentityCard({ name: 'x', somethingAddedNextMonth: 'prose' })));

// --- the strip does not mutate --------------------------------------------
ok('the original payload is untouched', fullPayload.overview === 'A long audited overview.');
ok('a null payload passes through', toIdentityCard(null) === null);
ok('a non-object passes through', toIdentityCard('x') === 'x');

// --- the search formula ----------------------------------------------------
const formula = servableStatusFormula();
ok('the formula still admits Done', formula.includes("{Status}='Done'"));
ok('the formula still admits Live', formula.includes("{Status}='Live'"));
ok('the formula admits identity-verified records', formula.includes('{Source 1 URL}') && formula.includes('{Source 2 URL}'));
ok('identity requires BOTH sources, not either', /AND\(/.test(formula));
ok('identity requires coordinates', formula.includes('{Latitude}') && formula.includes('{Longitude}'));
ok('identity requires a name', formula.includes('{Airport Name}'));
// The identity half asks for evidence, never for a Status: a record claiming
// Done while citing nothing is exactly what the May 2026 audit found.
ok('the identity half does not admit a record on Status alone',
  !/AND\([^)]*\{Status\}/.test(formula));
ok('the two halves are an OR', formula.startsWith('OR('));

ok('status list is unchanged and still just Done and Live',
  SERVABLE_AIRPORT_STATUSES.join() === 'Done,Live');
ok('isServableAirportStatus is untouched by any of this',
  isServableAirportStatus('Done') && !isServableAirportStatus('In progress'));

console.log(`airport-depth: ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.error('  FAIL:', f); process.exit(1); }
