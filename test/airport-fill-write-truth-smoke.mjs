/**
 * Smoke test for the truthfulness of the identity fill's own reporting, and
 * for the promise that the fill never writes narrative.
 *
 * Why this exists: both fill passes used to swallow a failed Airtable write
 * (`await write(...).catch(() => {})`) and then increment the success counter
 * anyway. Pointed at 293 new airports that would have reported "created 293"
 * having created none. This whole project began with records that claimed to
 * be verified and were not, so a run that overstates what it wrote is the one
 * bug we cannot ship.
 *
 * Run: node test/airport-fill-write-truth-smoke.mjs
 */
import { runBreadthFill, runIdentityBackfill, identityFields, isWorthCreatingFromProse } from '../api/reference/_breadth_fill.js';
import { extractIatas } from '../api/reference/_breadth.js';
import { AF, AIRPORT_STATUS } from '../api/reference/_ref.js';

let pass = 0; const fails = [];
const ok = (label, cond) => { if (cond) pass++; else fails.push(label); };

// Two sources that agree on everything, so verification is never the variable.
const OA = { iata: 'BOG', name: 'El Dorado International Airport', city: 'Bogota', country: 'CO', lat: 4.70159, lon: -74.1469, source: 'https://ourairports/' };
const WD = { iata: 'BOG', name: 'El Dorado International Airport', city: 'Bogota', country: 'Colombia', countryCode: 'CO', lat: 4.7016, lon: -74.1469, source: 'https://wikidata/Q1450351' };
const fetchers = { ourAirports: async () => OA, wikidata: async () => WD, breadth: async () => ({ missingCount: 1, missing: [{ iata: 'BOG' }] }) };

// --- a write that fails is never counted as a creation --------------------
const broke = await runBreadthFill({
  limit: 1, create: true, nowIso: '2026-08-26T00:00:00Z',
  fetchers: { ...fetchers, create: async () => { throw new Error('airtable 422'); } },
});
ok('a failed create is not counted as created', broke.created === 0);
ok('a failed create is counted as failed', broke.failed === 1);
ok('the item reports it was not created', broke.items[0].created === false);
ok('the item carries the write error', /422/.test(broke.items[0].writeError || ''));
ok('verification is still reported as verified', broke.verified === 1);

// --- a write that succeeds is counted once --------------------------------
let wrote = null;
const good = await runBreadthFill({
  limit: 1, create: true, nowIso: '2026-08-26T00:00:00Z',
  fetchers: { ...fetchers, create: async rec => { wrote = rec; } },
});
ok('a successful create is counted', good.created === 1);
ok('a successful create reports no failure', good.failed === 0);
ok('no write error on the happy path', !('writeError' in good.items[0]));
ok('the record carries both source urls', !!wrote.source1 && !!wrote.source2 && wrote.source1 !== wrote.source2);
ok('the record carries the run date', wrote.verifiedDate === '2026-08-26');

// --- a dry run writes nothing ---------------------------------------------
let touched = false;
const dry = await runBreadthFill({ limit: 1, create: false, fetchers: { ...fetchers, create: async () => { touched = true; } } });
ok('a dry run does not write', touched === false && dry.created === 0 && dry.failed === 0);

// --- the fill never writes narrative --------------------------------------
const NARRATIVE = ['overview', 'terminals', 'parking', 'lounges', 'train', 'coach', 'taxi', 'arrival', 'distance'];
const built = identityFields({ iata: 'BOG', name: OA.name, city: OA.city, country: OA.country, lat: OA.lat, lon: OA.lon, source1: 'a', source2: 'b', verifiedDate: '2026-08-26' });
ok('no narrative field is ever written by the fill', NARRATIVE.every(k => !(AF[k] in built)));
ok('a created record lands gated, not servable', built[AF.status] === AIRPORT_STATUS.IN_PROGRESS);
ok('In progress is not a servable status', AIRPORT_STATUS.IN_PROGRESS !== 'Done' && AIRPORT_STATUS.IN_PROGRESS !== 'Live');

// --- an uncorroborated field is omitted, never written blank --------------
const thin = identityFields({ iata: 'BOG', source1: 'a', source2: 'b', verifiedDate: '2026-08-26' });
ok('an uncorroborated name is absent, not empty', !(AF.name in thin));
ok('an uncorroborated city is absent, not empty', !(AF.cityServed in thin));
ok('coordinates absent rather than zero', !(AF.latitude in thin) && !(AF.longitude in thin));

// --- backfill: the same defect, the same guard ----------------------------
const row = { id: 'rec1', fields: { [AF.iata]: 'BOG' } };
const bad = await runIdentityBackfill({
  limit: 1, write: true, nowIso: '2026-08-26T00:00:00Z',
  fetchers: { ...fetchers, listRows: async () => [row], patch: async () => { throw new Error('airtable 500'); } },
});
ok('a failed patch is not counted as filled', bad.filled === 0);
ok('a failed patch is counted as failed', bad.failed === 1);
ok('the backfill item reports it was not applied', bad.items[0].applied === false);
ok('the backfill item carries the write error', /500/.test(bad.items[0].writeError || ''));

const fine = await runIdentityBackfill({
  limit: 1, write: true, nowIso: '2026-08-26T00:00:00Z',
  fetchers: { ...fetchers, listRows: async () => [row], patch: async () => {} },
});
ok('a successful patch is counted', fine.filled === 1 && fine.failed === 0);
ok('backfill never writes narrative', NARRATIVE.every(k => !(AF[k] in (fine.items[0].out || {}))));

// --- prose codes that are not airports ------------------------------------
// All of this is from the first live run on 26 Aug 2026, which created records
// for an Iranian regional airport and a Belize airstrip. Both came from our own
// prose, neither from the curated target list.

// The real sentence, from the Curacao and Aruba records.
const REAL_PROSE = 'Curacao Airport (CUR) is 15 min from Willemstad. Connect via Amsterdam (KLM) or US cities.';
ok('an airport code in prose is still found', extractIatas(REAL_PROSE).includes('CUR'));
ok('an AIRLINE in brackets is not read as an airport', !extractIatas(REAL_PROSE).includes('KLM'));
ok('other airlines are blocked too', extractIatas('Fly with (TUI) or (SAS) via (TAP)').length === 0);
ok('currencies in brackets are not airports', extractIatas('Budget around (AED) 400 or (THB) 2000').length === 0);
ok('travel abbreviations are not airports', extractIatas('You need an (ETA) and a (PCR) test').length === 0);
ok('a real code beside a blocked one still survives', extractIatas('Rome (FCO) connects via Amsterdam (KLM)').join() === 'FCO');

const asOA = (type, scheduledService) => ({ type, scheduledService });
ok('a large airport from prose is worth creating', isWorthCreatingFromProse(asOA('large_airport', 'yes')));
ok('a medium airport from prose is worth creating', isWorthCreatingFromProse(asOA('medium_airport', 'yes')));
ok('Kalaleh, small with no service, is refused', !isWorthCreatingFromProse(asOA('small_airport', 'no')));
ok('Hector Silva Airstrip, small with no service, is refused', !isWorthCreatingFromProse(asOA('small_airport', 'no')));
ok('El Nido, small but scheduled, is kept', isWorthCreatingFromProse(asOA('small_airport', 'yes')));
ok('Phnom Penh, large but mis-flagged by OurAirports, is kept', isWorthCreatingFromProse(asOA('large_airport', 'no')));
ok('a heliport is refused', !isWorthCreatingFromProse(asOA('heliport', 'yes')));
ok('a closed airport is refused', !isWorthCreatingFromProse(asOA('closed', 'no')));
ok('a missing record is refused', !isWorthCreatingFromProse(null));

// The filter must apply to prose codes only. A curated target is wanted even if
// OurAirports describes it oddly.
const smallOA = { iata: 'ENI', name: 'El Nido Airport', city: 'El Nido', country: 'PH', lat: 11.2, lon: 119.4, type: 'small_airport', scheduledService: 'no', source: 'https://ourairports/' };
const smallWD = { iata: 'ENI', name: 'El Nido Airport', city: 'El Nido', country: 'Philippines', countryCode: 'PH', lat: 11.2, lon: 119.4, source: 'https://wikidata/' };
const smallSeam = { ourAirports: async () => smallOA, wikidata: async () => smallWD };

const fromProse = await runBreadthFill({
  limit: 1, create: true,
  fetchers: { ...smallSeam, breadth: async () => ({ missingCount: 1, missing: [{ iata: 'ENI', reason: 'content-referenced' }] }), create: async () => {} },
});
ok('a non-bookable PROSE code is not created', fromProse.created === 0 && fromProse.unverifiable === 1);
ok('and the reason names what it actually is', /small_airport/.test(fromProse.items[0].reason || ''));

const fromTarget = await runBreadthFill({
  limit: 1, create: true,
  fetchers: { ...smallSeam, breadth: async () => ({ missingCount: 1, missing: [{ iata: 'ENI', reason: 'global-major' }] }), create: async () => {} },
});
ok('the same code from the curated TARGET list is still created', fromTarget.created === 1);

console.log(`airport-fill-write-truth: ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.error('  FAIL:', f); process.exit(1); }
