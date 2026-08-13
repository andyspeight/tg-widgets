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

// ── Hotels fetch a WIDER band than the flighted products ──
// A whole-country hotel search is cheapest-first, so a 250-deep request is all
// cheap-city rooms; the dearer cities only reach the cache if we fetch past the
// store cap and let the per-city spread keep them.
const bpm = CRON.match(/function buildPayload\(row, destinationCode[\s\S]*?\n\}/);
ok('buildPayload is defined', !!bpm);
const capM = CRON.match(/const ACCOMMODATION_MAX_OFFERS = (\d+)/);
ok('ACCOMMODATION_MAX_OFFERS is defined', !!capM);
const ACC_MAX = capM ? Number(capM[1]) : 0;
// Explicit market + sweepType args are passed so the MARKETS/SWEEP_TYPES default
// params never evaluate — the only free references left are the two we inject.
const buildPayload = bpm
  ? new Function('DEMO_APP_ID', 'ACCOMMODATION_MAX_OFFERS', bpm[0] + '\nreturn buildPayload;')('250', ACC_MAX)
  : () => { throw new Error('not loaded'); };
const GB = { id: 'GB', nationality: 'GB' };

console.log('Accommodation fetches a wider price band so dearer cities come back');
{
  const acc = buildPayload({ fields: {} }, 'US', GB, { id: 'Accommodation', payloadType: 'Accommodation' }, null, 'GBP');
  const pkg = buildPayload({ fields: {} }, 'US', GB, { id: 'Packages', payloadType: 'Packages', packageType: 'Any' }, null, 'GBP');
  const fly = buildPayload({ fields: {} }, 'US', GB, { id: 'Flights', payloadType: 'Flights' }, 'LGW', 'GBP');
  ok('the store cap for Accommodation is 500 in the source', /Accommodation: 500/.test(CRON));
  ok('the hotel fetch overflows the 500 store cap so diverseCheapest engages', acc.maxOffers > 500);
  ok('hotels fetch the wide band', acc.maxOffers === ACC_MAX && ACC_MAX === 1000);
  ok('packages keep the lean 250 default', pkg.maxOffers === 250);
  ok('flights keep the lean 250 default', fly.maxOffers === 250);
}

console.log('A per-row MaxOffers override still wins when larger');
{
  const accHi = buildPayload({ fields: { MaxOffers: 1500 } }, 'US', GB, { id: 'Accommodation', payloadType: 'Accommodation' }, null, 'GBP');
  const accLo = buildPayload({ fields: { MaxOffers: 300 } }, 'US', GB, { id: 'Accommodation', payloadType: 'Accommodation' }, null, 'GBP');
  ok('a bigger per-row MaxOffers is respected for hotels', accHi.maxOffers === 1500);
  ok('a smaller per-row MaxOffers is floored to the wide band for hotels', accLo.maxOffers === ACC_MAX);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
