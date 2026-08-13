/**
 * Offer map — spread the per-country storage cap across cities (Travel Cheaper,
 * 13 Aug 2026).
 *
 * THE REPORT. Travel Cheaper's hotels map had the USA switched on but only
 * showed hotels around Las Vegas; the rest of the country was sparse.
 *
 * WHY. The refresh job keeps only the cheapest STORE_CAPS[type] offers per
 * country (500 hotels). Las Vegas has a big volume of very cheap per-person
 * rooms, so sorted cheapest-first it filled the whole 500 and pricier cities
 * (New York, San Francisco, Miami) were cut before they could pin — even though
 * we DO fetch them (11 US gateways are swept). The data was there; the cap threw
 * it away.
 *
 * THE FIX. capStoredOffers now fills each type|market cap with diverseCheapest:
 * bucket by place, then take the cheapest unused offer from every city in
 * rotation. Same storage budget, coverage spread across the country. The single
 * cheapest offer (the country's "from" price) is always kept.
 *
 * Verifies the real geoBucketKey + diverseCheapest (extracted + evaluated, the
 * cron imports Redis/env at load so it can't be imported in the dev sandbox),
 * and source-guards the wiring.
 *
 * Run: node test/worldmap-diverse-cap-smoke.mjs  (npm run test:worldmap-diverse-cap)
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../api/cron/refresh-map-offers.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// ── Extract the real helpers and evaluate them together ──
const geoM = SRC.match(/function geoBucketKey\(o\) \{[\s\S]*?\n\}/);
const divM = SRC.match(/function diverseCheapest\(arr, cap, pp\) \{[\s\S]*?\n\}/);
ok('geoBucketKey + diverseCheapest are defined', !!geoM && !!divM);

let geoBucketKey = () => { throw new Error('not loaded'); };
let diverseCheapest = () => { throw new Error('not loaded'); };
if (geoM && divM) {
  ({ geoBucketKey, diverseCheapest } = new Function(
    geoM[0] + '\n' + divM[0] + '\n return { geoBucketKey, diverseCheapest };')());
}

const pp = (o) => (Number.isFinite(o.pricePP) ? o.pricePP : Infinity);
const cityOf = (o) => o.resort;
const countBy = (arr, k) => arr.filter(o => cityOf(o) === k).length;

console.log('geoBucketKey prefers resort, then airport, then a geo cell, then country');
{
  ok('resort wins', geoBucketKey({ resort: 'Las Vegas', airport: 'LAS' }) === 'r:las vegas');
  ok('airport is the fallback', geoBucketKey({ airport: 'JFK' }) === 'a:JFK');
  ok('geo cell when no name/airport', geoBucketKey({ resortLat: 36.17, resortLng: -115.14 }) === 'g:36.2,-115.1');
  ok('country is the last resort', geoBucketKey({ countryCode: 'US' }) === 'c:US');
}

// ── The Las Vegas scenario ──
// 520 very cheap Vegas rooms (£30–81), plus 30 each in three pricier cities that
// are ALL dearer than every Vegas room. A plain cheapest-500 keeps 500 Vegas and
// zero of the others. cap = 500.
function makeOffers() {
  const offers = [];
  for (let i = 0; i < 520; i++) offers.push({ id: 'lv' + i, resort: 'Las Vegas', pricePP: 30 + i * 0.1, currency: 'GBP' });
  for (let i = 0; i < 30; i++) offers.push({ id: 'ny' + i, resort: 'New York', pricePP: 150 + i, currency: 'GBP' });
  for (let i = 0; i < 30; i++) offers.push({ id: 'sf' + i, resort: 'San Francisco', pricePP: 140 + i, currency: 'GBP' });
  for (let i = 0; i < 30; i++) offers.push({ id: 'mi' + i, resort: 'Miami', pricePP: 90 + i, currency: 'GBP' });
  return offers;
}

console.log('A plain cheapest-500 is Las-Vegas-only (the bug being fixed)');
{
  const naive = makeOffers().slice().sort((a, b) => pp(a) - pp(b)).slice(0, 500);
  ok('naive keeps 500 offers', naive.length === 500);
  ok('naive is 100% Las Vegas', naive.every(o => o.resort === 'Las Vegas'));
  ok('naive shows zero New York / SF / Miami', countBy(naive, 'New York') + countBy(naive, 'San Francisco') + countBy(naive, 'Miami') === 0);
}

console.log('diverseCheapest spreads the same 500-slot budget across every city');
{
  const picked = diverseCheapest(makeOffers(), 500, pp);
  ok('still fills the whole cap (500)', picked.length === 500);
  ok('every city is represented', countBy(picked, 'Las Vegas') > 0 && countBy(picked, 'New York') > 0 && countBy(picked, 'San Francisco') > 0 && countBy(picked, 'Miami') > 0);
  ok('the smaller cities are shown in full (30 each)', countBy(picked, 'New York') === 30 && countBy(picked, 'San Francisco') === 30 && countBy(picked, 'Miami') === 30);
  ok('Las Vegas still takes the remaining budget (410)', countBy(picked, 'Las Vegas') === 410);
  ok('the single cheapest offer (Vegas £30) is always kept', picked.some(o => o.id === 'lv0'));
  ok('output is sorted cheapest-first', picked.every((o, i) => i === 0 || pp(picked[i - 1]) <= pp(o)));
}

console.log('Cap boundary + degenerate cases');
{
  ok('returns everything when under the cap, sorted', (() => {
    const few = [{ resort: 'A', pricePP: 5 }, { resort: 'B', pricePP: 2 }, { resort: 'A', pricePP: 9 }];
    const out = diverseCheapest(few, 500, pp);
    return out.length === 3 && out[0].pricePP === 2 && out[2].pricePP === 9;
  })());
  ok('a single city just returns its cheapest N', (() => {
    const one = Array.from({ length: 40 }, (_, i) => ({ resort: 'Only', pricePP: 100 - i }));
    const out = diverseCheapest(one, 10, pp);
    return out.length === 10 && out.every(o => o.resort === 'Only') && out[0].pricePP === 61;
  })());
}

console.log('Wiring');
{
  ok('capStoredOffers fills each group with diverseCheapest, not a raw slice',
    /out\.push\(\.\.\.diverseCheapest\(arr, cap, pp\)\)/.test(SRC) && !/out\.push\(\.\.\.arr\.slice\(0, cap\)\)/.test(SRC));
  ok('the cap still scales with the oversized-write retry factor',
    /const cap = Math\.max\(1, Math\.ceil\(\(STORE_CAPS\[type\] \|\| STORE_CAPS\.Packages\) \* factor\)\)/.test(SRC));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
