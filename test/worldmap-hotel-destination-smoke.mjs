/**
 * Offer map cron — hotels are swept by COUNTRY, not by airport (Andy, Aug 2026).
 *
 * The sweep fired every product (packages, hotels, flights) at the row's gateway
 * AIRPORTS. That's right for flights/packages (you fly TO an airport) but wrong
 * for hotel-only: a hotel search by airport returns only that airport's own city
 * — LAS gave the whole of Las Vegas, JFK/MCO/MIA gave nothing — so the US hotel
 * cache came back Las-Vegas-only. Accommodation is now swept by the country code,
 * so the feed returns rooms across the whole country.
 *
 * Verifies the real destinationCodesForType (extracted + evaluated) and
 * source-guards the sweep loop.
 *
 * Run: node test/worldmap-hotel-destination-smoke.mjs  (npm run test:worldmap-hotel-dest)
 */
import { readFileSync } from 'node:fs';

const CRON = readFileSync(new URL('../api/cron/refresh-map-offers.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const m = CRON.match(/function destinationCodesForType\(row, sweepType\) \{[\s\S]*?\n\}/);
ok('destinationCodesForType is defined', !!m);
let destinationCodesForType = () => { throw new Error('not loaded'); };
if (m) destinationCodesForType = new Function(m[0] + '\n return destinationCodesForType;')();

const usRow = { fields: { CountryCode: 'US', AirportCodes: 'MCO,JFK,LAS,MIA,LAX,EWR,SFO,LGA,IAD,ONT,ORD' } };

console.log('Hotels (Accommodation) are searched by the country code, not airports');
{
  const hotels = destinationCodesForType(usRow, { id: 'Accommodation' });
  ok('the US hotel search targets the country', JSON.stringify(hotels) === '["US"]');
  ok('it does NOT fan out over the gateway airports (the Vegas-only bug)',
    !hotels.includes('LAS') && !hotels.includes('JFK') && hotels.length === 1);
}

console.log('Packages and flights still fly to the gateway airports');
{
  const pkg = destinationCodesForType(usRow, { id: 'Packages' });
  const fly = destinationCodesForType(usRow, { id: 'Flights' });
  ok('packages use every gateway airport', pkg.length === 11 && pkg.includes('JFK') && pkg.includes('LAS'));
  ok('flights use every gateway airport', fly.length === 11 && fly.includes('MCO'));
}

console.log('Fallbacks');
{
  ok('a row with no airports falls back to the country for packages',
    JSON.stringify(destinationCodesForType({ fields: { CountryCode: 'GR' } }, { id: 'Packages' })) === '["GR"]');
  ok('hotels with no country code yield nothing (not an airport)',
    JSON.stringify(destinationCodesForType({ fields: { AirportCodes: 'JFK' } }, { id: 'Accommodation' })) === '[]');
}

console.log('Sweep wiring');
{
  ok('destination codes are resolved per sweep type inside the job loop',
    /for \(const sweepType of SWEEP_TYPES\) \{\s*const codes = destinationCodesForType\(row, sweepType\);/.test(CRON));
  ok('the old airport-for-everything loop is gone', !/for \(const code of codes\) for \(const market of MARKETS\)/.test(CRON));
  ok('the country-code guard still short-circuits an unusable row', /if \(!cc\) \{[\s\S]*?no country code/.test(CRON));
}

// ── Every type fetches the SAME request size (the wide-band dead end) ──
// A wider hotel band (maxOffers 1000) timed out every Accommodation request and
// stored zero hotels, so hotels are back on the lean default. This guards the
// revert: no per-type maxOffers inflation, and the dead end is documented so it
// is not retried.
const bpm = CRON.match(/function buildPayload\(row, destinationCode[\s\S]*?\n\}/);
ok('buildPayload is defined', !!bpm);
// Explicit market + sweepType args are passed so the MARKETS/SWEEP_TYPES default
// params never evaluate — buildPayload's only free reference then is DEMO_APP_ID.
const buildPayload = bpm
  ? new Function('DEMO_APP_ID', bpm[0] + '\nreturn buildPayload;')('250')
  : () => { throw new Error('not loaded'); };
const GB = { id: 'GB', nationality: 'GB' };

console.log('Hotels use the same lean request size as packages/flights (no wide band)');
{
  const acc = buildPayload({ fields: {} }, 'US', GB, { id: 'Accommodation', payloadType: 'Accommodation' }, null, 'GBP');
  const pkg = buildPayload({ fields: {} }, 'US', GB, { id: 'Packages', payloadType: 'Packages', packageType: 'Any' }, null, 'GBP');
  const fly = buildPayload({ fields: {} }, 'US', GB, { id: 'Flights', payloadType: 'Flights' }, 'LGW', 'GBP');
  ok('hotels fetch the lean 250 default (a wider band timed out)', acc.maxOffers === 250);
  ok('packages fetch the lean 250 default', pkg.maxOffers === 250);
  ok('flights fetch the lean 250 default', fly.maxOffers === 250);
  ok('the wide-band constant is gone (not merely lowered)', !/ACCOMMODATION_MAX_OFFERS/.test(CRON));
  ok('the dead end is recorded so it is not retried', /DEAD END/.test(CRON) && /10s per-request timeout/.test(CRON));
}

console.log('A per-row MaxOffers override still applies to every type equally');
{
  const accHi = buildPayload({ fields: { MaxOffers: 300 } }, 'US', GB, { id: 'Accommodation', payloadType: 'Accommodation' }, null, 'GBP');
  const pkgHi = buildPayload({ fields: { MaxOffers: 300 } }, 'US', GB, { id: 'Packages', payloadType: 'Packages', packageType: 'Any' }, null, 'GBP');
  ok('a per-row MaxOffers override is honoured for hotels', accHi.maxOffers === 300);
  ok('a per-row MaxOffers override is honoured for packages', pkgHi.maxOffers === 300);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
