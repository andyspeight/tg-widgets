/**
 * Offer map — read-only hotel destination probe (Andy, Aug 2026, TEMPORARY).
 *
 * Diagnostic to settle whether Travelify's hotel search can target a US city by
 * NAME (New York, Miami) or only by the country/airport codes we already use.
 * The probe fires Accommodation searches in several destination forms and
 * reports what each returns. It MUST stay read-only: it never writes Redis, it
 * only reads Travelify through our proxy, so it is safe against production.
 *
 * This test source-guards the read-only contract (the whole risk of a
 * production diagnostic) and the admin passthrough that carries the secret.
 *
 * Run: node test/worldmap-hotelprobe-smoke.mjs  (npm run test:worldmap-hotelprobe)
 */
import { readFileSync } from 'node:fs';

const CRON = readFileSync(new URL('../api/cron/refresh-map-offers.js', import.meta.url), 'utf8');
const REBUILD = readFileSync(new URL('../api/admin/map-rebuild.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// Isolate the probe branch source so the read-only assertions can't be satisfied
// by writes elsewhere in the file.
const m = CRON.match(/if \(q\.hotelprobe === '1'[\s\S]*?return res\.status\(200\)\.json\(\{ ok: true, hotelprobe: true[\s\S]*?\}\);/);
ok('the hotelprobe branch exists', !!m);
const branch = m ? m[0] : '';

console.log('The probe is READ-ONLY (the whole safety contract)');
{
  ok('it never writes an offers key (no setJson)', !/setJson\(/.test(branch));
  ok('it never stores or caps country offers', !/storeCountryOffers|writeOffersKey|capStoredOffers|storeCountryOffers/.test(branch));
  ok('it never deletes keys', !/\bdel\(/.test(branch));
  ok('it only reads Travelify via the proxy', /callOffersProxy\(/.test(branch));
  ok('it searches Accommodation, not Packages', /payloadType: 'Accommodation'/.test(branch));
  ok('it tallies the returned cities', /accommodation && o\.accommodation\.destination/.test(branch));
  ok('it returns per-destination results', /hotelprobe: true/.test(branch) && /results/.test(branch));
}

console.log('The probe needs no cache (runs before the Redis gate)');
{
  ok('hotelprobe is handled before the configured() guard',
    CRON.indexOf("q.hotelprobe === '1'") > 0 &&
    CRON.indexOf("q.hotelprobe === '1'") < CRON.indexOf('if (!configured())'));
}

console.log('Candidate destination forms include a city name (the actual question)');
{
  ok('the default set probes a US city by name', /'New York'/.test(branch));
  ok('it keeps a country-code baseline', /'US'/.test(branch));
  ok('it keeps an airport control (the known dead end)', /'LAS'|'JFK'/.test(branch));
  ok('the candidate list is capped', /\.slice\(0, 12\)/.test(branch));
}

console.log('The admin rebuild forwards the probe WITH the secret, writing nothing');
{
  ok('map-rebuild reads a diag body', /const diag = b\.diag && typeof b\.diag === 'object'/.test(REBUILD));
  ok('it forwards hotelprobe=1 to the cron', /URLSearchParams\(\{ hotelprobe: '1' \}\)/.test(REBUILD));
  ok('it passes cc / dests / max through', /params\.set\('cc'/.test(REBUILD) && /params\.set\('dests'/.test(REBUILD));
  ok('it still calls the cron with the Bearer secret', /Authorization: `Bearer \$\{secret\}`/.test(REBUILD));
  ok('the diag result is labelled honestly', /diag \? 'diag:hotelprobe'/.test(REBUILD));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
