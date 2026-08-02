/**
 * Offers cache — a 2-letter origin means "departing this country".
 *
 * THE INCIDENT (2 Aug 2026). Andy asked why widget tgw_1783445412374_vpks6v
 * showed no offers. It is configured `origins: ['GB']`. Measured against the
 * live cache that morning:
 *
 *   type=PackageHolidays                        → 2,661 offers
 *   type=PackageHolidays&origins=GB             →     0
 *   type=PackageHolidays&origins=IE             → 2,661
 *   type=PackageHolidays&origins=<30 UK airports> → 2,661
 *   type=PackageHolidays&origins=<5 IE airports>  →     0
 *
 * Every cached package departed a UK airport. Every one was tagged Irish.
 *
 * WHY. An offer was tagged with the customer nationality we sent Travelify to
 * steer pricing. The cron sweeps GB then IE, both return largely the same
 * offers, and the merge key is id|origin|type — no market. So the Irish copy,
 * written second, overwrote the British one, every time, for everything.
 *
 * The fix is that where an offer departs from is a property of the OFFER, not
 * of the request that fetched it. The market is now derived from the departure
 * airport on the way in, and read from the departure airport on the way out.
 * Both sides share one airport list so they cannot drift apart.
 *
 * This was invisible for weeks because the widgets fell back to live Travelify
 * on a cache miss. Going cache-only on 30 Jul turned it into a blank widget —
 * which is how it finally got reported.
 *
 * Run: node test/offers-origin-market-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { MARKET_AIRPORTS, marketOfAirport, airportInMarket } from '../api/_lib/offers/markets.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const CACHED = readFileSync(new URL('../api/cached-offers.js', import.meta.url), 'utf8');
const CRON = readFileSync(new URL('../api/cron/refresh-map-offers.js', import.meta.url), 'utf8');

// ── The shared list ──────────────────────────────────────────────────────────
ok(MARKET_AIRPORTS.GB.length >= 25, `the GB list covers the UK airports (${MARKET_AIRPORTS.GB.length})`);
ok(MARKET_AIRPORTS.IE.length >= 4, `the IE list covers the Irish airports (${MARKET_AIRPORTS.IE.length})`);
for (const a of ['LHR', 'LGW', 'MAN', 'BHX', 'EDI', 'GLA', 'BFS', 'BHD', 'LDY']) {
  ok(marketOfAirport(a) === 'GB', `${a} is a GB departure`);
}
for (const a of ['DUB', 'ORK', 'SNN', 'NOC', 'KIR']) {
  ok(marketOfAirport(a) === 'IE', `${a} is an IE departure`);
}
// Northern Ireland flies from the UK market, which is the case most likely to
// be "tidied" wrongly by someone reading a map rather than a departure list.
ok(marketOfAirport('BFS') === 'GB' && marketOfAirport('DUB') === 'IE',
  'Belfast is GB and Dublin is IE — the border is the market, not the island');
// The two lists must not overlap, or an airport belongs to both markets.
{
  const overlap = MARKET_AIRPORTS.GB.filter((a) => MARKET_AIRPORTS.IE.includes(a));
  ok(overlap.length === 0, `no airport is in both markets (${overlap.join(',') || 'none'})`);
}
// Offers really do depart elsewhere — Bucharest and Milan both turn up in the
// sweep logs — so an unknown airport must answer "I do not know", not "GB".
for (const a of ['OTP', 'LIN', 'JFK', 'CDG', '', null, undefined, 'zz']) {
  ok(marketOfAirport(a) === null, `an airport outside our markets returns null, not a guess (${JSON.stringify(a)})`);
}
ok(marketOfAirport('lhr') === 'GB', 'lookup is case-insensitive');
ok(marketOfAirport(' LHR ') === 'GB', 'lookup tolerates whitespace');
ok(airportInMarket('MAN', 'GB') === true && airportInMarket('MAN', 'IE') === false, 'airportInMarket answers both ways');
ok(airportInMarket('OTP', 'GB') === false, 'an unknown airport is in no market');

// ── The read side answers from the airport ───────────────────────────────────
ok(/import \{ marketOfAirport \} from '\.\/_lib\/offers\/markets\.js'/.test(CACHED),
  'cached-offers reads the shared list');
const originGate = CACHED.slice(CACHED.indexOf('if (hasOriginFilter) {'), CACHED.indexOf('if (boards.size'));
ok(/const depMarket = o\.origin \? marketOfAirport\(o\.origin\) : null;/.test(originGate),
  'the departure airport decides the market');
ok(/depMarket\s*\?\s*originMarkets\.has\(depMarket\)/.test(originGate),
  'and it is preferred over the stored tag');
// The stored tag may only be consulted when there is genuinely no airport.
ok(/: \(!o\.origin && originMarkets\.has\(String\(o\.market \|\| 'GB'\)\.toUpperCase\(\)\)\)/.test(originGate),
  'the stored tag is the fallback ONLY for offers with no departure airport');
// An unrecognised airport must not fall through to the tag, or a Bucharest
// departure tagged GB would answer a British widget.
ok(!/depMarket \|\| String\(o\.market/.test(originGate),
  'an unknown airport does not fall back to the tag (that would widen the filter)');
ok(/artefact of how we fetched/.test(originGate) || /artefact of how we fetched/.test(CACHED),
  'the reason the tag is not trusted is written down where it is not trusted');

// ── The cron tags from the airport ───────────────────────────────────────────
ok(/import \{ MARKET_AIRPORTS, marketOfAirport \} from '\.\.\/_lib\/offers\/markets\.js'/.test(CRON),
  'the cron reads the same shared list');
ok(/flightOrigins: MARKET_AIRPORTS\.GB/.test(CRON) && /flightOrigins: MARKET_AIRPORTS\.IE/.test(CRON),
  'the sweep airports come from the shared list, so there is only one list to update');
ok(/o\.market = o\.origin \? marketOfAirport\(o\.origin\) : market\.id;/.test(CRON),
  'an offer is tagged by where it departs, and by the sweep only when it does not depart anywhere');
ok(!/for \(const o of offers\) o\.market = market\.id;/.test(CRON),
  'the old tag-by-request line is gone');
// An airport we do not recognise must NOT inherit the sweep, or the same
// Bucharest departure gets tagged GB by one sweep and IE by the other and
// both copies survive the market-keyed merge — the widget draws it twice.
ok(!/marketOfAirport\(o\.origin\) \|\| market\.id/.test(CRON),
  'an unknown departure airport does not inherit the sweep nationality');
// The list must not be duplicated back into the cron, or the two drift.
ok(!/'LHR', 'LGW', 'LTN'/.test(CRON), 'the airport list is not copied back into the cron');

// ── The merge key keeps both hotel markets ───────────────────────────────────
// A hotel has no departure airport, so before the fix the GB and IE sweeps
// produced the same key and the Irish copy overwrote the British one. All
// 3,572 cached hotels were tagged IE and every GB hotel widget was blank too.
ok(/\$\{o\.id\}\|\$\{o\.origin \|\| ''\}\|\$\{o\.type \|\| 'Packages'\}\|\$\{marketTagOf\(o\)\}/.test(CRON),
  'the merge key includes the market, so the two hotel copies both survive');
ok(/if \(o\.origin\) o\.market = marketOfAirport\(o\.origin\);/.test(CRON),
  'merging heals the stored tag on already-cached offers, so no duplicate survives the first sweep after the fix');
ok(/function marketTagOf\(o\) \{\s*return \(o\.origin \? marketOfAirport\(o\.origin\) : o\.market\) \|\| '';/.test(CRON),
  'the key reads the market the same way the read side does');
// STORE_CAPS is per type|market, so the extra hotel copy was already budgeted.
ok(/\$\{o\.type \|\| 'Packages'\}\|\$\{o\.market \|\| 'GB'\}/.test(CRON),
  'the storage cap is per type AND market, which is what makes room for both copies');

// Reimplement the merge to prove the shapes behave.
function mergeKey(o) {
  const m = (o.origin ? marketOfAirport(o.origin) : o.market) || '';
  return `${o.id}|${o.origin || ''}|${o.type || 'Packages'}|${m}`;
}
{
  // Same hotel, two nationalities, two prices. Both must be kept.
  const gb = { id: 9876897, type: 'Accommodation', market: 'GB', price: 44 };
  const ie = { id: 9876897, type: 'Accommodation', market: 'IE', price: 49 };
  ok(mergeKey(gb) !== mergeKey(ie), 'the GB and IE copies of one hotel are two cache entries');

  // Same package, fetched by both sweeps. One entry, because both sweeps now
  // derive GB from Birmingham.
  const fromGB = { id: 18629728, origin: 'BHX', type: 'Packages', market: 'GB' };
  const fromIE = { id: 18629728, origin: 'BHX', type: 'Packages', market: 'IE' };
  ok(mergeKey(fromGB) === mergeKey(fromIE), 'one package fetched by both sweeps stays one cache entry');

  // A stale entry written before the fix must collapse onto the fresh one.
  const stale = { id: 18629728, origin: 'BHX', type: 'Packages', market: 'IE', price: 1 };
  ok(mergeKey(stale) === mergeKey(fromGB), 'a mis-tagged cached offer keys onto its corrected self, not alongside it');

  // Different departures are different offers and both belong in the cache.
  const dub = { id: 18629728, origin: 'DUB', type: 'Packages', market: 'IE' };
  ok(mergeKey(fromGB) !== mergeKey(dub), 'Gatwick and Dublin departures of one package id stay separate');

  // An unknown airport must key the same from either sweep.
  const otpGB = { id: 5, origin: 'OTP', type: 'Packages', market: 'GB' };
  const otpIE = { id: 5, origin: 'OTP', type: 'Packages', market: 'IE' };
  ok(mergeKey(otpGB) === mergeKey(otpIE),
    'an unrecognised departure airport does not split into one copy per sweep');
}

// ── The behaviour, end to end ────────────────────────────────────────────────
// Reproduce the gate with the real helper and the shapes the cache stores.
function matches(offer, originTokens) {
  const origins = new Set(originTokens.filter((t) => t.length === 3));
  const originMarkets = new Set(originTokens.filter((t) => t.length === 2));
  const apOk = origins.size && offer.origin && origins.has(String(offer.origin).toUpperCase());
  const depMarket = offer.origin ? marketOfAirport(offer.origin) : null;
  const mkOk = originMarkets.size && (depMarket
    ? originMarkets.has(depMarket)
    : (!offer.origin && originMarkets.has(String(offer.market || 'GB').toUpperCase())));
  if (!offer.origin) return !(originMarkets.size && !mkOk);
  return !!(apOk || mkOk);
}

// The exact offer that was being hidden: departs Birmingham, tagged Irish.
const theOffer = { id: 18629728, origin: 'BHX', market: 'IE', type: 'Packages' };
ok(matches(theOffer, ['GB']) === true,
  'a Birmingham departure matches a GB widget even while its stored tag says IE');
ok(matches(theOffer, ['IE']) === false,
  'and it does NOT match an Irish widget, however it is tagged');
ok(matches(theOffer, ['BHX']) === true, 'naming the airport still works');
ok(matches(theOffer, ['LGW']) === false, 'naming a different airport still excludes it');

const dublin = { origin: 'DUB', market: 'GB', type: 'Packages' };
ok(matches(dublin, ['IE']) === true, 'a Dublin departure matches an IE widget even if mis-tagged GB');
ok(matches(dublin, ['GB']) === false, 'and never a GB widget');

const bucharest = { origin: 'OTP', market: 'IE', type: 'Packages' };
ok(matches(bucharest, ['GB']) === false, 'a Bucharest departure matches neither market widget');
ok(matches(bucharest, ['IE']) === false, 'not the Irish one either');
ok(matches(bucharest, ['OTP']) === true, 'but naming its airport finds it');

// Hotel-only offers have no departure, so the tag is all there is — and for
// them it is the right answer, because it really is the customer's market.
const hotelGB = { market: 'GB', type: 'Accommodation' };
const hotelIE = { market: 'IE', type: 'Accommodation' };
ok(matches(hotelGB, ['GB']) === true, 'a GB-market hotel matches a GB widget');
ok(matches(hotelIE, ['GB']) === false, 'an IE-market hotel does not');
ok(matches(hotelGB, ['LGW']) === true,
  'a hotel is not excluded by an airport-only filter — it has no departure to judge');

// Mixed filters behave as "any of these".
ok(matches(theOffer, ['GB', 'IE']) === true, 'either market matches');
ok(matches(theOffer, ['LGW', 'GB']) === true, 'an airport OR a market matches');

// ── The regression that hid it ───────────────────────────────────────────────
// Zero matches used to mean "fall back to live Travelify", so a broken filter
// only cost latency. Cache-only made it a blank widget. Worth remembering that
// removing a fallback promotes every latent miss to an outage.
ok(/THE ONLY OFFER SOURCE/i.test(CACHED), 'cached-offers still records that it is the only source');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
