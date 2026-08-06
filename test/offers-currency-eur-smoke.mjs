/**
 * Offers — native currency (Irish offers in EUR).
 *
 * The cache used to be GBP-only: the cron asked GBP, dropped everything else,
 * cached-offers force-formatted every price as £, and the widget converted every
 * number as though it were GBP. An Irish flight search returns only EUR, so the
 * whole Irish market fell through the floor.
 *
 * This proves the end-to-end currency behaviour without a live feed:
 *   - the widget converts from each offer's OWN currency (EUR → viewer currency),
 *   - getNumericPrice normalises to GBP so sorting stays comparable,
 *   - the cron asks EUR for Ireland, keeps EUR only for the Irish market,
 *     prefers the native (EUR) copy, orders the cap by a GBP-equivalent, and
 *     keeps EUR out of the single-currency world-map summary,
 *   - cached-offers formats each price in its own currency.
 *
 * Run: node test/offers-currency-eur-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { marketOfAirport } from '../api/_lib/offers/markets.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const SRC = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');
const CACHED = readFileSync(new URL('../api/cached-offers.js', import.meta.url), 'utf8');
const CRON = readFileSync(new URL('../api/cron/refresh-map-offers.js', import.meta.url), 'utf8');

function extractFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('signature not found: ' + sig);
  let depth = 0, start = -1;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { if (start < 0) start = j; depth++; }
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces for: ' + sig);
}

// ── Widget currency maths (real functions, controllable display currency) ─────
function buildWidgetMoney(rates, displayCode) {
  const body = [
    'let ACTIVE_CUR = { code: ' + JSON.stringify(displayCode || 'GBP') + ', rates: ' + JSON.stringify(rates) + ' };',
    'const FX_FALLBACK = { GBP: 1, EUR: 1.17, USD: 1.27 };',
    extractFn(SRC, 'function fmtCur(val, code)'),
    extractFn(SRC, 'function money(gbpAmount)'),
    extractFn(SRC, 'function offerCurrency(o)'),
    extractFn(SRC, 'function toGbp(amount, cur)'),
    extractFn(SRC, 'function paxCount(o)'),
    extractFn(SRC, 'function nightsCount(o)'),
    extractFn(SRC, 'function getNumericPrice(o)'),
    extractFn(SRC, 'function computeDisplayPrice(o, mode, t)'),
    'return { money, offerCurrency, toGbp, getNumericPrice, computeDisplayPrice };',
  ].join('\n');
  return new Function(body)();
}

// rate 1.17 = 1 GBP buys 1.17 EUR, so €500 ≈ £427.
const RATES = { GBP: 1, EUR: 1.17 };
const eurOffer = { adults: 2, formattedPrice: '€500', formattedPPPrice: '€250',
  accommodation: { nights: 7, pricing: { price: 500, currency: 'EUR' } } };
const gbpOffer = { adults: 2, formattedPrice: '£400', formattedPPPrice: '£200',
  accommodation: { nights: 7, pricing: { price: 400, currency: 'GBP' } } };

{
  const w = buildWidgetMoney(RATES, 'GBP'); // viewer sees GBP
  ok(w.offerCurrency(eurOffer) === 'EUR', 'offerCurrency reads EUR off the pricing block');
  ok(w.offerCurrency(gbpOffer) === 'GBP', 'offerCurrency defaults/reads GBP');
  ok(w.offerCurrency({}) === 'GBP', 'offerCurrency falls back to GBP when absent');

  const eurTotal = w.computeDisplayPrice(eurOffer, 'total').primary;
  ok(/427/.test(eurTotal), `€500 shows as ~£427 in a GBP widget (got ${eurTotal})`);
  ok(eurTotal.indexOf('£') === 0, `EUR offer converts to the £ display currency (got ${eurTotal})`);

  const gbpTotal = w.computeDisplayPrice(gbpOffer, 'total').primary;
  ok(/£400/.test(gbpTotal), `£400 GBP offer is unchanged in a GBP widget (got ${gbpTotal})`);

  // Sorting must be comparable across currencies: €500 (~£427) is dearer than £400.
  ok(w.getNumericPrice(eurOffer) > w.getNumericPrice(gbpOffer),
    'getNumericPrice normalises to GBP so €500 ranks dearer than £400');
  ok(Math.abs(w.getNumericPrice(eurOffer) - 500 / 1.17) < 0.5, 'getNumericPrice(EUR) is the GBP-equivalent');
}

{
  const w = buildWidgetMoney(RATES, 'EUR'); // Irish widget: viewer sees EUR
  const eurTotal = w.computeDisplayPrice(eurOffer, 'total').primary;
  ok(/€500/.test(eurTotal), `an Irish EUR offer shows its true €500 in a EUR widget (got ${eurTotal})`);
  const gbpTotal = w.computeDisplayPrice(gbpOffer, 'total').primary;
  ok(eurTotal.indexOf('€') === 0 && gbpTotal.indexOf('€') === 0, 'a EUR widget shows every offer in €');
  ok(/€468/.test(gbpTotal), `£400 converts to €468 in a EUR widget (got ${gbpTotal})`);
}

// ── Cron: buildPayload carries the requested currency ─────────────────────────
{
  const buildPayload = new Function('DEMO_APP_ID',
    extractFn(CRON, 'function buildPayload(row, destinationCode, market = MARKETS[0], sweepType = SWEEP_TYPES[0], flightOrigin = null, currency = \'GBP\')') +
    '\nreturn buildPayload;')('250');
  const mkt = { id: 'IE', nationality: 'IE' };
  const st = { id: 'Packages', payloadType: 'Packages', packageType: 'Any' };
  ok(buildPayload({ fields: {} }, 'AGP', mkt, st, null, 'EUR').currency === 'EUR', 'buildPayload sends EUR when asked');
  ok(buildPayload({ fields: {} }, 'AGP', mkt, st, null).currency === 'GBP', 'buildPayload defaults to GBP');
  ok(buildPayload({ fields: {} }, 'AGP', mkt, st, null, 'EUR').nationality === 'IE', 'buildPayload keeps the IE nationality');
}

// ── Cron: prefer the native (EUR) copy for an Irish offer ─────────────────────
{
  const preferredCopy = new Function('marketOfAirport',
    extractFn(CRON, 'function marketTagOf(o)') + '\n' +
    extractFn(CRON, 'function clickNationality(o)') + '\n' +
    extractFn(CRON, 'function nativeCurrencyFor(market)') + '\n' +
    extractFn(CRON, 'function preferredCopy(a, b)') + '\nreturn preferredCopy;')(marketOfAirport);
  const irishEur = { id: 1, origin: 'DUB', type: 'Packages', currency: 'EUR', url: 'x/EUR/IE/1' };
  const irishGbp = { id: 1, origin: 'DUB', type: 'Packages', currency: 'GBP', url: 'x/GBP/IE/1' };
  ok(preferredCopy(irishEur, irishGbp) === true, 'the EUR copy beats the GBP copy for an Irish offer');
  ok(preferredCopy(irishGbp, irishEur) === false, 'and not the other way round');
  // GB offers are native GBP — the currency preference is a no-op there.
  const gb1 = { id: 2, origin: 'LGW', type: 'Packages', currency: 'GBP', url: 'x/GBP/GB/2' };
  const gb2 = { id: 2, origin: 'LGW', type: 'Packages', currency: 'GBP', url: 'x/GBP/GB/2b' };
  ok(typeof preferredCopy(gb1, gb2) === 'boolean', 'GB offers still resolve through the existing rule');
}

// ── Cron: the cap orders EUR by a GBP-equivalent, so a cheap EUR offer survives ─
{
  const capStoredOffers = new Function(
    'const STORE_CAPS = { Packages: 800, Accommodation: 500, Flights: 400 };\n' +
    extractFn(CRON, 'function capStoredOffers(offers, factor = 1)') + '\nreturn capStoredOffers;')();
  // Same IE group. EUR 500 → ~£430 equivalent, cheaper than the GBP 450. With a
  // cap of 1 the cheaper (EUR) offer must be the one kept.
  const kept = capStoredOffers([
    { id: 'g', type: 'Packages', market: 'IE', currency: 'GBP', pricePP: 450 },
    { id: 'e', type: 'Packages', market: 'IE', currency: 'EUR', pricePP: 500 },
  ], 1 / 800);
  ok(kept.length === 1 && kept[0].currency === 'EUR',
    'the cheaper EUR offer (by GBP-equivalent) survives a tight cap over a dearer GBP one');
}

// ── Source guards for the inline rules that are not separately callable ────────
ok(/currencies:\s*\['GBP',\s*'EUR'\]/.test(CRON), 'the IE market asks for GBP and EUR');
ok(/currencies:\s*\['GBP'\]/.test(CRON), 'the GB market still asks GBP only');
ok(/o\.currency === 'EUR'/.test(CRON) && /=== 'IE'/.test(CRON),
  'the keep-rule admits EUR only for the Irish market');
ok(/\(o\.currency \|\| 'GBP'\) === 'GBP'/.test(CRON), 'the world-map summary is filtered to GBP only');
ok(/money\(o\.price, o\.currency/.test(CACHED), 'cached-offers formats each price in its own currency');

// ── Cron: price parser handles European (euro) number format, no more £1 ──────
// Travelify formats EUR prices European-style (dot = thousands, comma = decimal).
// The old parser turned "€1.234,56" into 1, which is where the £1 offers came from.
{
  const parseMoney = new Function(extractFn(CRON, 'function parseMoney(str)') + '\nreturn parseMoney;')();
  // English format still works.
  ok(parseMoney('£1,234') === 1234, 'English thousands parse (£1,234)');
  ok(parseMoney('£1,234.56') === 1235, 'English decimal parse (£1,234.56)');
  ok(parseMoney('£1,234,567.89') === 1234568, 'English multi-thousands parse');
  ok(parseMoney('£999.00') === 999, 'English sub-thousand decimal parse');
  // European format — the cases that used to collapse to £1.
  ok(parseMoney('€1.234,56') === 1235, 'European "€1.234,56" is 1235, not 1');
  ok(parseMoney('€1.234') === 1234, 'European thousands "€1.234" is 1234, not 1');
  ok(parseMoney('€12.345') === 12345, 'European "€12.345" is 12345, not 12');
  ok(parseMoney('€1.234.567,89') === 1234568, 'European multi-thousands is 1234568, not 1');
  ok(parseMoney('€999,00') === 999, 'European decimal "€999,00" is 999, not 99900');
  // Degenerate inputs.
  ok(parseMoney('') === null && parseMoney(null) === null, 'empty/invalid → null');
  ok(parseMoney('€0,00') === null, 'zero → null (no free offers)');
}

// ── Cron: the price floor drops garbage sub-£5 (£1) offers on store + purge ────
{
  const purge = new Function(
    'const MAX_AGE_HOURS = 70; const MIN_STORE_PRICE = 5;\n' +
    'function passesDurationRule(){ return true; }\n' +
    'function travelDateOf(o){ return o.outboundDate || o.checkinDate || null; }\n' +
    extractFn(CRON, 'function purgeOffers(offers, now = new Date(), maxAgeHours = MAX_AGE_HOURS)') +
    '\nreturn purgeOffers;')();
  const now = new Date('2026-08-10T00:00:00Z');
  const kept = purge([
    { id: 'a', price: 1, outboundDate: '2026-09-01', fetchedAt: '2026-08-10T00:00:00Z' },
    { id: 'b', price: 4, outboundDate: '2026-09-01', fetchedAt: '2026-08-10T00:00:00Z' },
    { id: 'c', price: 5, outboundDate: '2026-09-01', fetchedAt: '2026-08-10T00:00:00Z' },
    { id: 'd', price: 1299, outboundDate: '2026-09-01', fetchedAt: '2026-08-10T00:00:00Z' },
  ], now);
  ok(kept.map(o => o.id).join(',') === 'c,d', 'purgeOffers drops sub-£5 (£1) garbage, keeps real prices');
}

// ── Cron: sweep stats surface kept Irish EUR (dashboard visibility) ───────────
{
  const aggregateSweepStats = new Function(
    extractFn(CRON, 'function aggregateSweepStats(perCountry)') + '\nreturn aggregateSweepStats;')();
  const stats = aggregateSweepStats([{ codeResults: [
    { type: 'Packages', ok: true, fetched: 100, count: 40, keptEUR: 12, dropped: { nonGBP: 60 } },
    { type: 'Packages', ok: true, fetched: 50, count: 30, keptEUR: 0, dropped: { nonGBP: 20 } },
  ], uniqueByType: { Packages: 55 } }]);
  ok(stats.Packages.keptEUR === 12, 'aggregateSweepStats sums kept Irish EUR for the dashboard');
  ok(stats.Packages.dropped.nonGBP === 80, 'and still totals the dropped non-Irish EUR separately');
}

// ── Dashboard: shows the win, and the drop reads as a duplicate not a loss ─────
{
  const ADMIN = readFileSync(new URL('../public/admin-worldmap.html', import.meta.url), 'utf8');
  ok(/s\.keptEUR/.test(ADMIN) && /Irish €/.test(ADMIN), 'the dashboard shows kept Irish euros');
  ok(/non-Irish EUR \(already held in £\)/.test(ADMIN), 'the drop label reads as a duplicate, not missed euros');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
