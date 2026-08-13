/**
 * Vercel Cron — refresh world map offers (country-sweep model).
 *
 * WHAT IT DOES
 *   1. Reads enabled rows from the MapSearches table (one row per country).
 *   2. For each country: if AirportCodes is filled, fires ONE /api/offers request
 *      per airport (so each airport gets its own 250-offer allowance); otherwise
 *      fires a single request for the two-letter CountryCode.
 *   3. Normalises every returned offer (tested parser).
 *   4. Merges the fresh offers into that country's stored set in Redis
 *      (dedup on offer.id, newest wins), then purges offers whose travel date
 *      has passed or whose fetchedAt is older than MAX_AGE_HOURS (tested sweep
 *      logic).
 *   5. Maintenance-purges every stored key the sweep did NOT touch with the
 *      same rules — countries awaiting rotation, countries whose fetches keep
 *      failing, and orphans removed from MapSearches — deleting keys that end
 *      up empty. No stored offer outlives the rules by more than one run.
 *   6. Rebuilds the small map summary (cheapest per country + cheapest per airport)
 *      from ALL stored country keys and writes it to map:offers:v1.
 *
 * CADENCE
 *   - ?full=1  → sweep every enabled country (the nightly run).
 *   - default  → sweep a rotating ~5% slice, once every 10 minutes, so the
 *     rotation still covers ~30% of countries per hour (same as the old
 *     every-45-min 15% slice) but with a third of the per-run /api/offers
 *     fan-out, spread evenly so no single 5-minute window carries a whole
 *     slice's burst.
 *   The cron schedule in vercel.json fires every 10 min; trigger the nightly full
 *   sweep with ?full=1 (e.g. a second cron entry, or the scheduler calling it).
 *
 * STORAGE KEYS
 *   offers:packages:{CC}   per-country raw normalised offers + refreshedAt
 *   map:offers:v1          derived summary the widget reads (country + airport pins)
 *   map:offers:lastRunAt   ISO timestamp of the last successful summary write
 *   map:offers:cursor      rotation cursor for the rotating 5% slice
 *
 * AUTH
 *   Caller must send Authorization: Bearer ${CRON_SECRET}.
 *   The cron calls /api/offers with Referer + Origin headers so Travelify's
 *   auth layer accepts the server-to-server request (proven 22 May 2026).
 *
 * DEBUG
 *   ?debug=1[&dest=ES][&noOrigin=1][&max=250] runs a single probe request and
 *   returns the parsed summaries without writing anything. Kept for diagnosis.
 *
 * FAILS SAFE
 *   A country whose requests all fail keeps its existing Redis key untouched
 *   (the maintenance pass still removes offers that expire, so a failing
 *   country degrades to empty rather than to stale). The summary is only
 *   rewritten if at least one country has offers, so a bad run can never
 *   blank the map.
 */

import { setJson, getJson, setString, getString, keys, del, configured } from '../_redis.js';
import { MARKET_AIRPORTS, marketOfAirport } from '../_lib/offers/markets.js';

// ── Config ────────────────────────────────────────────────────────────────
const AIRTABLE_BASE = 'appAYzWZxvK6qlwXK';
const MAP_SEARCHES_TABLE = 'tblrI1BihuDcpoV1A'; // MapSearches (country model, seeded 23 May 2026)
const OFFERS_PROXY = process.env.OFFERS_PROXY_URL || 'https://tg-widgets.vercel.app/api/offers';
const SELF_ORIGIN = 'https://tg-widgets.vercel.app';
const DEMO_APP_ID = '250';

const PER_REQUEST_TIMEOUT_MS = 10000;
const REQUEST_CONCURRENCY = 6;     // parallel proxy calls within a country
                                   // (raised from 4 when types × markets grew
                                   // the per-country request count)
// ~5% of countries per run. The rotation is cursor-based, so coverage per hour
// is frequency × fraction: this pairs with the */10 cron (6 runs/hour) to sweep
// the same ~30%/hour as the old */45 × 15% did, but in thirds — a third of the
// /api/offers fan-out per run, evenly spaced 10 min apart, so no single 5-minute
// window carries a whole slice's burst. Same coverage and freshness, flatter peak.
const HOURLY_FRACTION = 0.05;
const MAX_AGE_HOURS = 70;          // purge offers older than this (was 4 days / 96h)
// Trip-duration bounds. Travelify returns offers of varying real durations and
// sort:price:asc surfaces the cheapest — which can be a 1-night stay. We keep
// holiday-length offers only: 2 nights (so short city breaks still qualify) up
// to 28 nights. Offers outside this range never enter Redis, so the map pins
// and the deal cards both stay clean. (Per-country override territory later.)
const MIN_NIGHTS = 2;
const MAX_NIGHTS = 28;
// Garbage-price floor, per TYPE and on the TOTAL price (never the per-person or
// per-night figure the widget shows). A genuinely cheap hotel can legitimately
// read a low price-per-person-per-night, but its TOTAL is still sensible, so a
// total-based floor keeps it. What we drop is a TOTAL of a few pounds, which is
// garbage for any type — the old European-number-format parse bug, or a bad
// source price. A flight+hotel holiday is never that cheap, so packages carry a
// higher floor; hotels and flights sit just below the cheapest a real one could
// plausibly be, so nothing genuine is lost. (Aug 2026.)
const MIN_STORE_PRICE_BY_TYPE = { Packages: 50, Accommodation: 10, Flights: 10 };
function minStorePrice(o) { return MIN_STORE_PRICE_BY_TYPE[o && o.type] || 10; }

const SUMMARY_KEY = 'map:offers:v1';
// Hotels ("Accommodation") mode of the World Map reads a parallel summary built
// from the same cache's accommodation subset, so holidays and hotels are two
// views of one map without blending. Country pins only — hotel offers have no
// flight gateway, so there is no airport tier.
const HOTELS_SUMMARY_KEY = 'map:hotels:v1';
// Sampled composition history for the admin trend line (spot supplier drop-offs
// / inventory drift). Appended on summary rebuild, gated to ~30m so manual
// re-polls don't spam it, capped to the last HISTORY_MAX points.
const HISTORY_KEY = 'map:offers:history';
const HISTORY_MIN_GAP_MS = 30 * 60 * 1000;
const HISTORY_MAX = 240;
const LASTRUN_KEY = 'map:offers:lastRunAt';
const CURSOR_KEY = 'map:offers:cursor';
// Per-type fetch/keep/drop tallies from the most recent sweep — the Cache
// tab reads this so the operator can see supplier-thin vs parser-dropped.
const SWEEP_STATS_KEY = 'map:offers:lastSweepStats';
const REFRESH_INTERVAL_KEY = 'tg:wm:refresh-interval-mins';
const DEFAULT_INTERVAL_MINS = 45;
const ALLOWED_INTERVALS = [15, 30, 45, 60, 120, 240, 1440];
const countryKey = (cc) => `offers:packages:${cc}`;
// Accommodation-only and flight-only offers live in their OWN key so the
// long-standing packages key (which the world map reads) keeps its exact
// product and neither key can outgrow Upstash's per-request write ceiling.
const extraKey = (cc) => `offers:extra:${cc}`;
const resortsKey = (cc) => `map:resorts:${cc}`;
const hotelResortsKey = (cc) => `map:hotels-resorts:${cc}`;

// Per-country, per-market storage caps (cheapest kept). A country key is one
// Redis value written in one REST call, so it must stay comfortably inside
// Upstash's request-size limit however many airports, markets and types a
// country accumulates. Cheapest-first matches how every consumer sorts.
const STORE_CAPS = { Packages: 800, Accommodation: 500, Flights: 400 };

/** Which place an offer belongs to, for spreading the cap across a country.
 *  Prefer the named resort/city; fall back to the arrival airport, then a
 *  coarse ~11km lat/lng cell, then the country. Without this, a country with
 *  one very cheap city (Las Vegas in the USA) fills its whole cap with that
 *  city's rooms — sorted cheapest-first — and the pricier rest of the country
 *  (New York, San Francisco, Miami) is cut before it can pin. */
function geoBucketKey(o) {
  if (o.resort) return 'r:' + String(o.resort).trim().toLowerCase();
  if (o.airport) return 'a:' + o.airport;
  const la = Number.isFinite(o.resortLat) ? o.resortLat : (Number.isFinite(o.lat) ? o.lat : null);
  const ln = Number.isFinite(o.resortLng) ? o.resortLng : (Number.isFinite(o.lng) ? o.lng : null);
  if (la != null && ln != null) return 'g:' + la.toFixed(1) + ',' + ln.toFixed(1);
  return 'c:' + (o.countryCode || '?');
}

/** Pick up to `cap` offers from one type|market list, spread across places so a
 *  single cheap city cannot crowd out the rest of a country. Buckets by place
 *  (each cheapest-first), then fills the cap by taking the cheapest unused offer
 *  from every bucket in rotation: round 1 is the cheapest room in each city,
 *  round 2 the second cheapest, and so on. Cheaper cities still lead overall (a
 *  partial final round favours them), but every place gets a pin before any
 *  place gets thirds. The single cheapest offer — the one the country's "from"
 *  price uses — is always kept (it leads round 1 of the cheapest bucket). */
function diverseCheapest(arr, cap, pp) {
  const sortByPrice = (a, b) => pp(a) - pp(b);
  if (arr.length <= cap) return arr.slice().sort(sortByPrice);
  const buckets = new Map();
  for (const o of arr) {
    const k = geoBucketKey(o);
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); }
    b.push(o);
  }
  for (const b of buckets.values()) b.sort(sortByPrice);
  const bucketList = Array.from(buckets.values());
  const cursor = new Map(bucketList.map(b => [b, 0]));
  const picked = [];
  while (picked.length < cap) {
    const avail = bucketList.filter(b => cursor.get(b) < b.length);
    if (!avail.length) break;
    // Cheaper cities first, so the partial final round tops up from them.
    avail.sort((a, b) => pp(a[cursor.get(a)]) - pp(b[cursor.get(b)]));
    for (const b of avail) {
      if (picked.length >= cap) break;
      picked.push(b[cursor.get(b)]);
      cursor.set(b, cursor.get(b) + 1);
    }
  }
  picked.sort(sortByPrice);
  return picked;
}

/** Cap a merged offer list: within each type|market group keep only
 *  STORE_CAPS[type] offers, spread across places (diverseCheapest) so coverage
 *  follows the map, not just the single cheapest city. `factor` scales every
 *  group's cap down proportionally — the oversized-write retry uses it so
 *  degradation stays fair across types and markets. */
function capStoredOffers(offers, factor = 1) {
  const groups = new Map();
  for (const o of offers || []) {
    const k = `${o.type || 'Packages'}|${o.market || 'GB'}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  // Order by a GBP-equivalent so a EUR group is not cut unfairly by its larger
  // raw numbers. This fixed rate is for INTERNAL ordering only — the widget
  // converts with live FX at display time. EUR groups are Irish-market and small
  // next to the caps, so this rarely bites; it just keeps the cut honest.
  const EUR_TO_GBP = 0.86;
  const pp = (o) => {
    const v = Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : Infinity);
    return o.currency === 'EUR' && Number.isFinite(v) ? v * EUR_TO_GBP : v;
  };
  const out = [];
  for (const [k, arr] of groups) {
    const type = k.split('|')[0];
    const cap = Math.max(1, Math.ceil((STORE_CAPS[type] || STORE_CAPS.Packages) * factor));
    out.push(...diverseCheapest(arr, cap, pp));
  }
  return out;
}

/**
 * Read the operator-configured min interval between re-sweeps of the same
 * country (set from the admin dashboard). Returns minutes; falls back to the
 * default if unset or off the allow-list. This is what makes the dashboard
 * "Refresh every…" dropdown actually do something: a country whose stored
 * offers were refreshed less than this many minutes ago is skipped this run,
 * so the rotation spends its effort on the stalest countries instead.
 */
async function getRefreshIntervalMins() {
  try {
    const raw = await getString(REFRESH_INTERVAL_KEY);
    const n = Number(raw);
    return ALLOWED_INTERVALS.includes(n) ? n : DEFAULT_INTERVAL_MINS;
  } catch {
    return DEFAULT_INTERVAL_MINS;
  }
}

/** True if this country's stored offers are younger than intervalMins. */
function isFresh(stored, intervalMins, now = Date.now()) {
  if (!stored || !stored.refreshedAt) return false;
  const t = Date.parse(stored.refreshedAt);
  if (!Number.isFinite(t)) return false;
  return (now - t) < intervalMins * 60 * 1000;
}

// Operator package (one tour operator) vs dynamic package (flight + hotel from
// two different suppliers). packageType is authoritative; sid inequality is the
// fallback. Mirrors the admin/widget classifier.
function packageKindOf(o) {
  if (o.packageType === 'DynamicPackages') return 'DynamicPackages';
  if (o.packageType === 'PackageHolidays') return 'PackageHolidays';
  return (Number.isFinite(o.flightSid) && Number.isFinite(o.accommodationSid) && o.flightSid !== o.accommodationSid)
    ? 'DynamicPackages' : 'PackageHolidays';
}

// ── Tested offer parser (unit-verified 22 May 2026) ─────────────────────────
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
// Parse a whole-pound(/euro) amount out of a formatted price string, in EITHER
// English (1,234.56) or European (1.234,56) number format. Travelify formats EUR
// (Irish) prices European-style, with a DOT as the thousands separator; the old
// "strip everything but digits and dots" parser turned "€1.234,56" into "1.234"
// and rounded it to 1, which is where the £1 offers came from once we started
// sweeping euros. Decide the decimal separator from the string itself. (Aug 2026.)
function parseMoney(str) {
  if (typeof str !== 'string') return null;
  const s0 = str.replace(/[^0-9.,]/g, '');
  if (!s0) return null;
  const lastDot = s0.lastIndexOf('.'), lastComma = s0.lastIndexOf(',');
  let s;
  if (lastDot >= 0 && lastComma >= 0) {
    // Both separators present: the LAST one is the decimal point, the other is
    // the thousands separator. 1.234,56 -> 1234.56 ; 1,234.56 -> 1234.56
    s = lastComma > lastDot ? s0.replace(/\./g, '').replace(',', '.') : s0.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Only commas: thousands when there is more than one, or a single one with
    // exactly 3 trailing digits (1,234); otherwise a European decimal (999,00).
    const many = (s0.match(/,/g) || []).length > 1;
    s = (many || s0.length - lastComma - 1 === 3) ? s0.replace(/,/g, '') : s0.replace(',', '.');
  } else if (lastDot >= 0) {
    // Only dots: thousands when there is more than one, or a single one with
    // exactly 3 trailing digits (1.234); otherwise an English decimal (999.00).
    const many = (s0.match(/\./g) || []).length > 1;
    s = (many || s0.length - lastDot - 1 === 3) ? s0.replace(/\./g, '') : s0;
  } else {
    s = s0;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
function parsePrice(offer) {
  if (typeof offer.formattedPrice === 'string') {
    const n = parseMoney(offer.formattedPrice);
    if (n != null) return n;
  }
  const fp = offer.flight && offer.flight.pricing ? Number(offer.flight.pricing.price) : 0;
  const ap = offer.accommodation && offer.accommodation.pricing ? Number(offer.accommodation.pricing.price) : 0;
  const sum = (Number.isFinite(fp) ? fp : 0) + (Number.isFinite(ap) ? ap : 0);
  return sum > 0 ? Math.round(sum) : null;
}
function parsePPPrice(offer) {
  if (typeof offer.formattedPPPrice === 'string') {
    const n = parseMoney(offer.formattedPPPrice);
    if (n != null) return n;
  }
  return null;
}
function normaliseOffer(offer, fallbackCC = null) {
  const flight = offer.flight || {}, acc = offer.accommodation || {};
  const fdest = flight.destination || {}, adest = acc.destination || {};
  const price = parsePrice(offer);
  if (price == null) return null;
  const iata = fdest.iataCode || null;
  // fallbackCC: the sweep requested ONE destination, so an offer that comes
  // back without its own countryCode still factually belongs to the swept
  // country. Hotel-only offers often carry no flight leg to infer geo from;
  // without this they'd be binned as destination-less.
  const countryCode = fdest.countryCode || adest.countryCode || fallbackCC || null;
  const lat = num(fdest.latitude) ?? num(adest.latitude);
  const lng = num(fdest.longitude) ?? num(adest.longitude);
  if (!iata && !countryCode) return null;
  // Was-price/lead-in flags: taken from whichever pricing block carries them
  // (they power the strike-through price and discount badges in the widget).
  const pricing = (acc.pricing && acc.pricing.priceChanged != null) ? acc.pricing
    : (flight.pricing && flight.pricing.priceChanged != null) ? flight.pricing
    : (acc.pricing || flight.pricing || {});
  return {
    id: offer.id, type: offer.type || 'Packages', packageType: offer.packageType || null,
    price, pricePP: parsePPPrice(offer),
    currency: (flight.pricing && flight.pricing.currency) || (acc.pricing && acc.pricing.currency) || 'GBP',
    airport: iata, airportName: fdest.name || null, countryCode,
    resort: adest.name || null, lat, lng,
    resortLat: num(adest.latitude), resortLng: num(adest.longitude),
    hotel: acc.name || null, rating: num(acc.rating), boardBasis: acc.boardBasis || null,
    nights: num(acc.nights), reviewRating: num(acc.reviewRating), reviewCount: num(acc.reviewCount),
    carrier: (flight.carrier && flight.carrier.name) || null,
    carrierCode: (flight.carrier && flight.carrier.code) || null,
    direct: !!flight.direct,
    stops: num(flight.stops),
    duration: num(flight.duration),
    cabinClass: flight.cabinClass || null,
    flightNumber: flight.flightNumber || null,
    origin: (flight.origin && flight.origin.iataCode) || null,
    originName: (flight.origin && flight.origin.name) || null,
    outboundDate: flight.outboundDate || null,
    returnDate: flight.returnDate || null,
    arrivalDate: flight.arrivalDate || flight.outboundArrivalDate || null,
    checkinDate: acc.checkinDate || null,
    priceChanged: pricing.priceChanged === true || null,
    priceBeforeChange: num(pricing.priceBeforeChange),
    isLeadIn: pricing.isLeadIn === true || null,
    refundability: pricing.refundability || null,
    adults: num(offer.adults), children: num(offer.children), infants: num(offer.infants),
    propertyType: acc.propertyType || null, chain: acc.chain || null,
    operatorName: (acc.operator && acc.operator.name) || null,
    // Operator message carries the ATOL/ABTA protection line the cards show.
    // Capped so a verbose operator can't bloat the stored offer.
    operatorMessage: (acc.operator && acc.operator.message)
      ? String(acc.operator.message).slice(0, 200) : null,
    // Supplier ids for the per-client supplier filter (Travelify `sid`, added
    // to the feed 3 Jul 2026). Scoped to the sub-product's prodType: on a
    // package flight.sid === accommodation.sid === the Packages supplier id;
    // on a flight-only offer only flight.sid; on a hotel-only offer only
    // accommodation.sid. Null when the sub-product is absent (compactOffer
    // then strips it, so a hotel-only offer costs no flightSid byte).
    // accommodation.uniqueRef pins the exact property for the deeplink
    // (&refn=), unrelated to supplier matching.
    flightSid: num(flight.sid),
    accommodationSid: num(acc.sid),
    accommodationUniqueRef: acc.uniqueRef ? String(acc.uniqueRef).slice(0, 64) : null,
    image: (acc.image && acc.image.url) || (flight.image && flight.image.url) || null,
    url: offer.url || null, updated: offer.updated || null, fetchedAt: new Date().toISOString(),
  };
}
function withinNightsRange(o) {
  // Keep only holiday-length stays. If nights is missing/unparseable, drop it
  // (we'd rather omit an offer than show a duration-less "deal").
  return Number.isFinite(o.nights) && o.nights >= MIN_NIGHTS && o.nights <= MAX_NIGHTS;
}
/** The nights rule only makes sense for offers with a stay. Flight-only
 *  offers have no nights and must not be dropped by it. */
function passesDurationRule(o) {
  return (o.type === 'Flights') ? true : withinNightsRange(o);
}
function normaliseOffers(rawArray, sweepTypeId = 'Packages', drops = null, fallbackCC = null) {
  if (!Array.isArray(rawArray)) return [];
  const out = [];
  for (const o of rawArray) {
    const n = normaliseOffer(o, fallbackCC);
    if (!n) {
      // Tally WHY the offer was unusable (the parsePrice re-check is cheap):
      // the sweep report needs to show supplier-thin versus parser-dropped
      // per type, or the type mix in the cache can't be diagnosed.
      if (drops) { if (parsePrice(o) == null) drops.noPrice++; else drops.noDest++; }
      continue;
    }
    // Stamp the swept type authoritatively — the read side filters on it.
    n.type = sweepTypeId;
    if (passesDurationRule(n)) out.push(n);
    else if (drops) {
      // Split the nights-rule drop so the audit can tell "missing a nights
      // value" (a hotel-only offer we might choose to keep) from "genuinely
      // outside the 2–28 night holiday range".
      drops.duration++;
      if (!Number.isFinite(n.nights)) drops.durNoNights = (drops.durNoNights || 0) + 1;
      else drops.durOutOfRange = (drops.durOutOfRange || 0) + 1;
    }
  }
  return out;
}
// Cheapest per-person price per WHOLE star for one destination, so a
// rating-filtered map can (a) hide a place with no matching stars and (b) price
// its pin for the shown ratings only. Additive: `ratings` + `ppByRating` are new
// summary fields; every existing field is untouched, and a destination with no
// rated offers carries neither (older widgets ignore them either way).
function accRating(byRating, o) {
  const r = num(o.rating);
  if (r == null || !isFinite(r)) return;
  const star = Math.round(r);
  if (star < 1 || star > 5) return;
  const pp = Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : null);
  if (pp == null) return;
  if (byRating[star] == null || pp < byRating[star]) byRating[star] = pp;
}
function ratingFields(byRating) {
  const ratings = Object.keys(byRating).map(Number).sort((a, b) => a - b);
  return ratings.length ? { ratings, ppByRating: byRating } : {};
}

function summariseByAirport(offers, regionByCC = {}) {
  const m = new Map();
  for (const o of offers) {
    if (!o.airport) continue;
    const c = m.get(o.airport);
    if (!c) m.set(o.airport, { airport: o.airport, airportName: o.airportName, countryCode: o.countryCode, lat: o.lat, lng: o.lng, fromPrice: o.price, fromPricePP: o.pricePP, currency: o.currency, offerCount: 1, cheapestOfferId: o.id });
    else { c.offerCount += 1; if (o.price < c.fromPrice) { c.fromPrice = o.price; c.fromPricePP = o.pricePP; c.cheapestOfferId = o.id; } }
  }
  return Array.from(m.values())
    .map(a => ({ ...a, region: regionByCC[a.countryCode] || 'Other' }))
    .sort((a, b) => a.fromPrice - b.fromPrice);
}
function summariseByCountry(offers, regionByCC = {}) {
  const m = new Map();
  for (const o of offers) {
    if (!o.countryCode) continue;
    let c = m.get(o.countryCode);
    if (!c) { c = { countryCode: o.countryCode, lat: o.lat, lng: o.lng, fromPrice: o.price, fromPricePP: o.pricePP, currency: o.currency, offerCount: 1, _airports: new Set([o.airport]), cheapestOfferId: o.id, _byRating: {} }; m.set(o.countryCode, c); }
    else { c.offerCount += 1; c._airports.add(o.airport); if (o.price < c.fromPrice) { c.fromPrice = o.price; c.fromPricePP = o.pricePP; c.lat = o.lat; c.lng = o.lng; c.cheapestOfferId = o.id; } }
    accRating(c._byRating, o);
  }
  // Stamp the region (from the MapSearches rows) onto each country so the widget
  // can offer region filtering. Unknown codes fall back to 'Other'.
  return Array.from(m.values())
    .map(c => { const { _airports, _byRating, ...rest } = c; return { ...rest, airportCount: _airports.size, region: regionByCC[c.countryCode] || 'Other', ...ratingFields(_byRating) }; })
    .sort((a, b) => a.fromPrice - b.fromPrice);
}

/** Distinct resorts within ONE country's offers — cheapest price + coords +
 *  offer count per resort, across ALL stored offers (not just the cheapest
 *  slice the deals endpoint returns). This is what lets the map pin every
 *  resort, not only the handful in the cheapest 60. */
function summariseByResort(offers) {
  const m = new Map();
  for (const o of offers) {
    const r = o.resort;
    const lat = num(o.resortLat), lng = num(o.resortLng);
    if (!r || lat == null || lng == null) continue;
    const pp = Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : null);
    let ex = m.get(r);
    if (!ex) {
      ex = {
        resort: r, lat, lng, fromPrice: o.price, fromPricePP: o.pricePP, currency: o.currency,
        offerCount: 1, cheapestOfferId: o.id,
        // airport = the gateway for this resort's cheapest offer. The widget
        // fetches deals?airport=… so it can pull a resort's real offers even
        // when they're outside the country's cheapest slice. _airports tracks
        // every gateway seen (a resort may be served by more than one).
        airport: o.airport || null, airportName: o.airportName || null,
        _airports: new Set(o.airport ? [o.airport] : []),
        _byRating: {},
      };
      m.set(r, ex);
    } else {
      ex.offerCount += 1;
      if (o.airport) ex._airports.add(o.airport);
      const exPP = Number.isFinite(ex.fromPricePP) ? ex.fromPricePP : ex.fromPrice;
      if (pp != null && (exPP == null || pp < exPP)) {
        ex.fromPrice = o.price; ex.fromPricePP = o.pricePP; ex.lat = lat; ex.lng = lng;
        ex.cheapestOfferId = o.id; ex.airport = o.airport || ex.airport; ex.airportName = o.airportName || ex.airportName;
      }
    }
    accRating(ex._byRating, o);
  }
  return Array.from(m.values())
    .map(r => { const { _airports, _byRating, ...rest } = r; return { ...rest, airports: Array.from(_airports), ...ratingFields(_byRating) }; })
    .sort((a, b) => (a.fromPricePP || a.fromPrice || Infinity) - (b.fromPricePP || b.fromPrice || Infinity));
}

// ── Tested sweep / merge / purge logic (unit-verified 22 May 2026) ──────────
function mergeOffers(existing, fresh) {
  // Key by id + origin + type + market. With two departure markets in one
  // cache the same package id can legitimately exist once per departure
  // airport (Gatwick and Dublin are different offers with different prices),
  // and with three offer types swept, ids from different type namespaces must
  // never overwrite each other. Keying by id alone would make them clobber
  // each other on every sweep.
  //
  // The market joined the key on 2 Aug 2026. A hotel-only offer has no
  // departure airport, so the GB and IE sweeps produced the same key and the
  // Irish copy — written second — overwrote the British one every time. All
  // 3,572 cached hotels ended up tagged IE and every `origins: ['GB']` hotel
  // widget matched nothing. They are genuinely two offers: same room, two
  // customer nationalities, two prices and two booking links.
  //
  // This does NOT duplicate flighted offers, because their market is derived
  // from the departure airport (see sweepCountry) and so is identical
  // whichever sweep fetched them. STORE_CAPS already caps per type|market, so
  // the space this can add was budgeted for.
  const key = (o) => `${o.id}|${o.origin || ''}|${o.type || 'Packages'}|${marketTagOf(o)}`;
  const byId = new Map();
  // Heal the stored tag on the way past. Offers cached before the fix carry
  // the sweep nationality, so without this an already-cached Gatwick package
  // tagged IE would key differently from the fresh GB one and the widget would
  // draw the same holiday twice until the old copy aged out.
  for (const o of existing || []) {
    if (!o || o.id == null) continue;
    if (o.origin) o.market = marketOfAirport(o.origin);
    byId.set(key(o), o);
  }
  // Within one run, both sweeps hand back the same Gatwick package — same key
  // now that the market comes from the airport — but each carries the booking
  // nationality it was fetched under in its click-through URL. Pick between
  // them deliberately rather than letting job order decide, so a British
  // visitor clicking a Gatwick holiday is not dropped into an Irish booking
  // flow. Fresh still always beats cached: a right-nationality link is not
  // worth showing yesterday's price for.
  const best = new Map();
  for (const o of fresh || []) {
    if (!o || o.id == null) continue;
    const k = key(o);
    const prev = best.get(k);
    if (!prev || preferredCopy(o, prev)) best.set(k, o);
  }
  for (const [k, o] of best) byId.set(k, o);
  return Array.from(byId.values());
}
/** The market an offer belongs to, read the same way everywhere: from the
 *  departure airport when it has one, from the stored tag when it does not. */
function marketTagOf(o) {
  return (o.origin ? marketOfAirport(o.origin) : o.market) || '';
}
/** The nationality Travelify will search under when a visitor clicks, read off
 *  the click URL it gave us (…/en/GBP/GB/<uuid>). '' when the shape is not
 *  ours to read, which simply means "no opinion". */
function clickNationality(o) {
  const m = /\/[A-Z]{3}\/([A-Z]{2})\/[^/]+$/.exec(String(o.url || ''));
  return m ? m[1] : '';
}
/** True when `a` is the better copy of an offer than `b`: the one whose
 *  booking link matches the market it departs from. No opinion either way
 *  means "yes", so the later copy wins as it always did. */
function preferredCopy(a, b) {
  const want = marketTagOf(a) || marketTagOf(b);
  // Prefer the copy priced in the market's native currency. The two IE requests
  // (GBP and EUR) can both return the same Irish offer under the same merge key;
  // an Irish customer should see the EUR price we now capture, not the GBP one.
  // For GB (native GBP) both copies are GBP, so this is a no-op there.
  const native = nativeCurrencyFor(want);
  const aNative = a.currency === native, bNative = b.currency === native;
  if (aNative !== bNative) return aNative;
  if (!want) return true;
  const aOk = clickNationality(a) === want;
  const bOk = clickNationality(b) === want;
  return aOk === bOk ? true : aOk;
}
function travelDateOf(offer) { return offer.outboundDate || offer.checkinDate || null; }
function purgeOffers(offers, now = new Date(), maxAgeHours = MAX_AGE_HOURS) {
  const nowMs = now.getTime();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return (offers || []).filter(o => {
    // Drop offers outside the holiday-length range (stay types only — flights
    // have no nights). This also clears any pre-existing out-of-range offers
    // stored before the nights filter existed, so the fix takes effect on the
    // next sweep rather than over MAX_AGE_HOURS.
    if (!passesDurationRule(o)) return false;
    // Drop garbage single/low-digit prices (the European-format parse bug's £1-£3
    // offers, and any future mispriced one), by type, on the TOTAL. Applies on
    // store AND on the maintenance pass, so already-cached ones clear on the next
    // run without a full resweep.
    if (Number.isFinite(o.price) && o.price < minStorePrice(o)) return false;
    const td = travelDateOf(o);
    if (td) { const t = Date.parse(td); if (Number.isFinite(t) && t < nowMs) return false; }
    if (o.fetchedAt) { const f = Date.parse(o.fetchedAt); if (Number.isFinite(f) && (nowMs - f) > maxAgeMs) return false; }
    return true;
  });
}
function updateCountryOffers(existingOffers, freshOffers, now = new Date()) {
  return purgeOffers(mergeOffers(existingOffers, freshOffers), now);
}

/** Strip null/undefined fields before storage. Every reader is defensive
 *  (`||` fallbacks and Number.isFinite throughout), so a missing key reads
 *  identically to null — but nulls cost real bytes: a hotel-only offer
 *  carries a dozen null flight fields, and each country key must stay
 *  inside Upstash's per-request write limit. Zeros and falses are kept
 *  (stops: 0 and direct: false are meaningful). */
function compactOffer(o) {
  const out = {};
  for (const k of Object.keys(o)) {
    if (o[k] !== null && o[k] !== undefined) out[k] = o[k];
  }
  return out;
}

/** Write one country offers key with size telemetry and a fair-share retry:
 *  if the write is rejected (typically the request-size limit), retry once
 *  with every type|market group's cap halved. A too-big country degrades to
 *  fewer (cheapest) offers instead of silently keeping its stale contents —
 *  setJson returning false was previously ignored here, which left the OLD
 *  offers in place with no trace. */
async function writeOffersKey(key, cappedOffers, refreshedAtIso) {
  const compact = cappedOffers.map(compactOffer);
  const bytes = JSON.stringify({ offers: compact, refreshedAt: refreshedAtIso }).length;
  if (bytes > 700 * 1024) {
    console.log(`[map-cron] ${key} is ~${Math.round(bytes / 1024)}KB — approaching the write limit`);
  }
  if (await setJson(key, { offers: compact, refreshedAt: refreshedAtIso })) {
    return { ok: true, stored: compact.length, kb: Math.round(bytes / 1024) };
  }
  const halved = capStoredOffers(compact, 0.5);
  const retryBytes = JSON.stringify({ offers: halved, refreshedAt: refreshedAtIso }).length;
  console.error(`[map-cron] write FAILED for ${key} (~${Math.round(bytes / 1024)}KB, ${compact.length} offers) — retrying with ${halved.length}`);
  if (await setJson(key, { offers: halved, refreshedAt: refreshedAtIso })) {
    return { ok: true, stored: halved.length, kb: Math.round(retryBytes / 1024), halved: true };
  }
  console.error(`[map-cron] retry write FAILED for ${key} (~${Math.round(retryBytes / 1024)}KB) — key left unchanged`);
  return { ok: false, stored: 0, kb: Math.round(bytes / 1024) };
}

/** Merge a sweep's fresh offers (all types mixed) into the country's TWO
 *  storage keys: Packages → offers:packages:{CC} (the key the world map
 *  reads, product unchanged), Accommodation + Flights → offers:extra:{CC}.
 *  Each key gets the shared merge + purge + cheapest-cap treatment.
 *  Returns stored counts + write health for the run report. */
async function storeCountryOffers(cc, freshOffers, now) {
  const freshPackages = freshOffers.filter(o => (o.type || 'Packages') === 'Packages');
  const freshExtra = freshOffers.filter(o => (o.type || 'Packages') !== 'Packages');
  const iso = now.toISOString();

  const existingP = (await getJson(countryKey(cc))) || { offers: [] };
  const survivingP = capStoredOffers(updateCountryOffers(existingP.offers || [], freshPackages, now));
  const pRes = await writeOffersKey(countryKey(cc), survivingP, iso);

  const existingX = (await getJson(extraKey(cc))) || { offers: [] };
  const survivingX = capStoredOffers(updateCountryOffers(existingX.offers || [], freshExtra, now));
  const xRes = await writeOffersKey(extraKey(cc), survivingX, iso);

  return {
    storedPackages: pRes.stored,
    storedExtra: xRes.stored,
    writeFailed: !pRes.ok || !xRes.ok,
    halved: !!(pRes.halved || xRes.halved),
    keyKB: { packages: pRes.kb, extra: xRes.kb },
  };
}

/** Maintenance purge over EVERY stored offer key, not just the swept slice.
 *
 *  The per-sweep purge only runs when a country is actually swept, which
 *  leaves three ways for stale offers to linger: countries waiting their
 *  turn in the rotation (travel dates pass mid-cycle), countries whose
 *  fetches keep failing (fail-safe leaves the key untouched), and countries
 *  disabled or deleted in MapSearches (never swept again, key orphaned
 *  forever). This pass applies the same purge rules to every stored key on
 *  every run, deletes keys that end up empty, and clears the orphaned
 *  resort key alongside — so nothing outlives the 70-hour/past-date rules
 *  by more than one cron interval.
 *
 *  refreshedAt is preserved on rewrite: it means "last swept", and faking
 *  it here would wrongly suppress the next real sweep's freshness gate. */
async function maintainStoredOffers(now, sweptCCs = new Set()) {
  const report = { countriesChecked: 0, countriesCleaned: 0, offersRemoved: 0, keysDeleted: 0, writeFailures: 0 };
  const [pKeys, xKeys] = await Promise.all([keys('offers:packages:*'), keys('offers:extra:*')]);
  const ccs = new Set();
  for (const k of pKeys) ccs.add(String(k).slice('offers:packages:'.length).toUpperCase());
  for (const k of xKeys) ccs.add(String(k).slice('offers:extra:'.length).toUpperCase());
  const targets = Array.from(ccs).filter(cc => /^[A-Z]{2}$/.test(cc) && !sweptCCs.has(cc));
  report.countriesChecked = targets.length;
  await pooled(targets, async (cc) => {
    let removedHere = 0, keysLeft = 0;
    for (const key of [countryKey(cc), extraKey(cc)]) {
      const stored = await getJson(key);
      if (!stored || !Array.isArray(stored.offers) || !stored.offers.length) continue;
      const surviving = purgeOffers(stored.offers, now);
      if (surviving.length === stored.offers.length) { keysLeft++; continue; }
      removedHere += stored.offers.length - surviving.length;
      if (!surviving.length) {
        await del(key);
        report.keysDeleted++;
      } else {
        // Checked write with the halving fallback (compacts internally) —
        // an unchecked setJson here left oversized countries frozen with
        // ageing offers, which is exactly how stale offers were surviving.
        const w = await writeOffersKey(key, surviving, stored.refreshedAt || now.toISOString());
        if (!w.ok) report.writeFailures++;
        keysLeft++;
      }
    }
    if (removedHere) {
      report.countriesCleaned++;
      report.offersRemoved += removedHere;
      // Both offer keys gone → the country is fully expired (usually an
      // orphan). Drop its resort summary too so nothing lingers.
      if (!keysLeft) await del(resortsKey(cc));
    }
  });
  return report;
}

// ── Airtable ────────────────────────────────────────────────────────────────
async function airtableList(tableId, params = {}) {
  const PAT = process.env.AIRTABLE_PAT;
  if (!PAT) throw new Error('AIRTABLE_PAT not set');
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  if (!res.ok) throw new Error(`Airtable ${tableId} HTTP ${res.status}`);
  return await res.json();
}
async function fetchEnabledCountries() {
  const rows = [];
  let offset;
  do {
    const params = { pageSize: '100', filterByFormula: '{Enabled}=TRUE()' };
    if (offset) params.offset = offset;
    const j = await airtableList(MAP_SEARCHES_TABLE, params);
    rows.push(...(j.records || []));
    offset = j.offset;
  } while (offset);
  return rows;
}

// ── Offers proxy ─────────────────────────────────────────────────────────────
// Markets swept per destination. Each market is one extra request per
// destination code with a different customer nationality, which is what
// steers Travelify's departure market. BOTH request GBP so the blended cache
// stays single-currency (locked decision 2 Jul 2026: one cache, mixed
// origins; the widget shows each offer's true departure airport). Any offer
// that still comes back non-GBP is dropped before it can enter Redis.
const MARKETS = [
  // flightOrigins: departure airports for FLIGHT sweeps, ONE REQUEST EACH
  // (the single-`origin` request is the only shape the feed returns flight
  // offers for — proven by the departure-board widget). Flight requests go to
  // EVERY swept destination, held today or not.
  //
  // 28 Jul 2026 — WIDENED back to (nearly) every UK/Irish airport with
  // scheduled leisure service, on Travelify's advice that thousands of flight
  // offers depart UK and Irish airports. This reverses the 6 Jul trim to 10 UK
  // hubs, which was made because a whole sweep was only yielding ~15 flight-only
  // offers and the requests were starving the Packages/Accommodation budget.
  // The cron's cursor-based partial-sweep continuation absorbs the extra
  // fan-out: each run STARTS fewer countries, but every country it starts runs
  // to completion, and the rotation picks up the rest next run — so no country
  // is left half-swept, package freshness just spreads over a little more time.
  //
  // WATCH THIS: if the flight-only count does NOT rise materially after this,
  // the bottleneck is the flight REQUEST SHAPE, not the airport list (20 origins
  // already gave ~15 offers on 6 Jul). In that case Travelify needs to confirm
  // the exact flight query that returns their thousands — likely those flights
  // are embedded in the Packages we already cache, not a standalone Flights
  // product. The per-type sweep stats (SWEEP_STATS_KEY / the Cache tab) show the
  // real fetched-vs-kept per type, so the answer is measurable after one sweep.
  //
  // currencies: which pricing currencies to request for this market. GB is GBP
  // only. IE asks BOTH GBP and EUR because the great majority of Irish offers
  // price in EUR, and asking GBP alone (the old behaviour) dropped them all —
  // an Irish flight search returns only EUR, so the GBP-only cache held zero
  // Irish flights. EUR offers are kept ONLY when they belong to the Irish market
  // (see the keep rule in sweepCountry), so a EUR price can never land on a
  // British-market offer. (5 Aug 2026.)
  { id: 'GB', nationality: 'GB', currencies: ['GBP'], flightOrigins: MARKET_AIRPORTS.GB },
  // Irish departures for the Irish clients — every airport with scheduled service.
  { id: 'IE', nationality: 'IE', currencies: ['GBP', 'EUR'], flightOrigins: MARKET_AIRPORTS.IE },
];

// The currency an offer of a given market is NATURALLY priced in: Irish offers
// in EUR, everything else GBP. Used to prefer the native copy when the same
// offer comes back in two currencies from the two IE requests.
function nativeCurrencyFor(market) { return market === 'IE' ? 'EUR' : 'GBP'; }

// Offer types swept into the cache. The cache powers the offer-box widgets
// (locked decision 2 Jul 2026: offer boxes read the cache, not live
// Travelify), so it must hold every type a widget can be set to — not just
// the Packages the world map pins. The map's summary and deals stay
// Packages-only via type filters at read/summarise time.
const SWEEP_TYPES = [
  { id: 'Packages', payloadType: 'Packages', packageType: 'Any' },
  { id: 'Accommodation', payloadType: 'Accommodation' },
  { id: 'Flights', payloadType: 'Flights' },
];

function buildPayload(row, destinationCode, market = MARKETS[0], sweepType = SWEEP_TYPES[0], flightOrigin = null, currency = 'GBP') {
  const f = row.fields || {};
  return {
    appId: f.AppId || DEMO_APP_ID,
    type: sweepType.payloadType,
    ...(sweepType.packageType ? { packageType: sweepType.packageType } : {}),
    // Flight-only offers only come back when a SINGLE departure airport is
    // named per request — the departure-board widget's proven shape. The
    // `origins` array form was ignored by the feed (see MARKETS.flightOrigins).
    ...(sweepType.id === 'Flights' && flightOrigin ? { origin: flightOrigin } : {}),
    deduping: 'None',
    currency: currency, language: 'en', nationality: market.nationality,
    maxOffers: f.MaxOffers || 250,
    // DatesMin/DatesMax are the DEPARTURE ADVANCE WINDOW in days from today
    // (NOT trip duration). 1–700 = "anything departing between tomorrow and ~23
    // months out". The old 7/14 default restricted us to next-week departures,
    // which is why long-haul came back empty and everything clustered in June.
    rollingDates: true,
    DatesMin: f.DatesMin || 1,
    DatesMax: f.DatesMax || 700,
    sort: 'price:asc',
    pricingByType: 'Person',
    destinations: [destinationCode],
    customerUserAgent: 'Travelgenix-WorldMapCron/1.0',
  };
}
async function callOffersProxy(payload, timeoutMs = PER_REQUEST_TIMEOUT_MS, retries = 1) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 500));
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(OFFERS_PROXY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': SELF_ORIGIN + '/',
          'Origin': SELF_ORIGIN,
          // Identify this as our own internal cache-refresh traffic so the
          // proxy exempts it from the per-IP rate limit (we call it once per
          // country at high volume from a single Vercel egress IP). The secret
          // is server-only; browsers never see it.
          ...(process.env.CRON_SECRET ? { 'x-tgs-internal': process.env.CRON_SECRET } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) { last = { ok: false, status: res.status }; continue; } // retryable
      const data = await res.json();
      if (data && data.success === false) {
        // Upstream said no — a retry won't change its mind. Fail now.
        return { ok: false, error: data.error || 'upstream failure' };
      }
      return { ok: true, data };
    } catch (e) {
      clearTimeout(t);
      last = { ok: false, error: e.message }; // timeout/network — retryable
    }
  }
  return last || { ok: false, error: 'request failed' };
}

/** Resolve which destination codes to query for a row. */
function destinationCodesFor(row) {
  const f = row.fields || {};
  const airports = (f.AirportCodes || '').split(',').map(s => s.trim()).filter(Boolean);
  if (airports.length) return airports;
  const cc = (f.CountryCode || '').trim();
  return cc ? [cc] : [];
}

/** Run a list of async thunks with bounded concurrency. */
async function pooled(items, worker, concurrency = REQUEST_CONCURRENCY) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Sweep one country: fire a request per destination code PER MARKET (GB and
 *  IE), return fresh normalised offers. Non-GBP offers are dropped so the
 *  blended cache stays single-currency whatever the supplier returns. */
async function sweepCountry(row) {
  const f = row.fields || {};
  const cc = (f.CountryCode || '').trim();
  const codes = destinationCodesFor(row);
  if (!cc || codes.length === 0) {
    return { cc: cc || '(none)', name: f.Name || '', ok: false, error: 'no country code', codeResults: [], freshOffers: [] };
  }
  const jobs = [];
  for (const code of codes) for (const market of MARKETS) for (const cur of (market.currencies || ['GBP'])) for (const sweepType of SWEEP_TYPES) {
    // Flight sweeps fan out to one request per departure airport (the only
    // request shape the feed returns flight-only offers for), toward every
    // swept destination — including pairs Travelify holds nothing for today,
    // so inventory they add later is picked up without a code change.
    if (sweepType.id === 'Flights') {
      for (const flightOrigin of (market.flightOrigins || [])) jobs.push({ code, market, cur, sweepType, flightOrigin });
      continue;
    }
    jobs.push({ code, market, cur, sweepType });
  }
  const codeResults = await pooled(jobs, async ({ code, market, cur, sweepType, flightOrigin }) => {
    const raw = await callOffersProxy(buildPayload(row, code, market, sweepType, flightOrigin, cur));
    if (!raw.ok) return { code, market: market.id, cur, type: sweepType.id, origin: flightOrigin || undefined, ok: false, error: raw.error || `HTTP ${raw.status}`, count: 0, fetched: 0, dropped: null, offers: [] };
    const arr = raw.data && Array.isArray(raw.data.data) ? raw.data.data : [];
    const dropped = { noPrice: 0, noDest: 0, duration: 0, durNoNights: 0, durOutOfRange: 0, nonGBP: 0 };
    // The country fallback applies to the non-map types only: the world map's
    // Packages product keeps its exact geo requirements, while hotel-only and
    // flight-only offers inherit the swept country when the supplier omits it.
    let offers = normaliseOffers(arr, sweepType.id, dropped, sweepType.id === 'Packages' ? null : cc);
    // Currency keep-rule. GBP is kept for any market (the cache's base currency).
    // EUR is kept ONLY for the Irish market — an Irish departure, or a hotel-only
    // offer priced for an IE customer — so Irish offers enter the cache in their
    // real currency while a EUR price can never attach to a British-market offer
    // (a GB-departing flight returned under the IE/EUR request is dropped here).
    // The market is derived the same way as the tag applied just below.
    const beforeCurrencyFilter = offers.length;
    offers = offers.filter((o) => {
      if (o.currency === 'GBP') return true;
      if (o.currency === 'EUR') return (o.origin ? marketOfAirport(o.origin) : market.id) === 'IE';
      return false;
    });
    dropped.nonGBP = beforeCurrencyFilter - offers.length;
    // TAG FROM THE DEPARTURE AIRPORT, not from the request that fetched it.
    //
    // The nationality we send Travelify steers pricing; it does not decide
    // where a flight leaves from. Tagging by request meant the same offer got
    // one tag from the GB sweep and another from the IE sweep, and since the
    // merge key includes the market the two copies both survived and the
    // widget drew the same holiday twice. The whole package cache was also
    // ending up tagged IE, so every `origins: ['GB']` widget matched nothing
    // (2 Aug 2026).
    //
    // Three cases, and each has one honest answer:
    //   a departure we know   → that airport's market. Both sweeps agree, so
    //                           the same offer dedupes to one copy.
    //   a departure we do not → no market. Still stable across sweeps (so no
    //                           duplicate), and the read side judges it by its
    //                           airport anyway. Guessing 'GB' would put a
    //                           Bucharest departure in a British widget.
    //   no departure at all   → the sweep nationality, which for a hotel-only
    //                           offer really is the market: it is the customer
    //                           we priced for. The GB and IE copies are
    //                           genuinely different offers and both are kept.
    for (const o of offers) {
      o.market = o.origin ? marketOfAirport(o.origin) : market.id;
    }
    // fetched = what Travelify actually sent; count = what survived our rules.
    // The gap between them, split by reason, is the whole diagnosis.
    // Kept Irish EUR — the whole point of the euro sweep. By the keep-rule above
    // every kept EUR offer is Irish-market, so this is the visible "we captured
    // it" number that balances the non-Irish EUR we drop.
    const keptEUR = offers.reduce((n, o) => n + (o.currency === 'EUR' ? 1 : 0), 0);
    return { code, market: market.id, type: sweepType.id, origin: flightOrigin || undefined, ok: true, fetched: arr.length, count: offers.length, keptEUR, dropped, offers };
  });
  const freshOffers = codeResults.flatMap(r => r.offers);
  const anyOk = codeResults.some(r => r.ok);

  // Unique offers per type across this country's requests. Hotel-only offers
  // come back near-identical from the GB and IE market requests (no flight
  // leg to differ on), so roughly half of what's fetched merges away — the
  // sweep report shows this stage so "fetched 5,258, stored 2,607" reads as
  // dedupe, not loss. Same key as mergeOffers.
  const uniqueByType = {};
  {
    const seen = new Set();
    for (const o of freshOffers) {
      const k = `${o.id}|${o.origin || ''}|${o.type || 'Packages'}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const t = o.type || 'Packages';
      uniqueByType[t] = (uniqueByType[t] || 0) + 1;
    }
  }

  // Observability for the Irish market rollout: log what the IE requests
  // actually returned (origin airports prove the market took effect; a tally
  // of UK-only origins would mean nationality does not steer the market and
  // we need a different lever). Logged per country, only when informative.
  const ieResults = codeResults.filter(r => r.market === 'IE');
  if (ieResults.length) {
    const ieOffers = ieResults.flatMap(r => r.offers || []);
    const originTally = {};
    for (const o of ieOffers) { const k = o.origin || '??'; originTally[k] = (originTally[k] || 0) + 1; }
    const dropped = ieResults.reduce((s, r) => s + ((r.dropped && r.dropped.nonGBP) || 0), 0);
    const errs = ieResults.filter(r => !r.ok).length;
    console.log(`[map-cron] ${cc} IE market: ${ieOffers.length} offers` +
      (Object.keys(originTally).length ? ` origins=${Object.entries(originTally).map(([k, v]) => `${k}x${v}`).join(',')}` : '') +
      (dropped ? ` droppedNonGBP=${dropped}` : '') +
      (errs ? ` failedRequests=${errs}` : ''));
  }

  return {
    cc, name: f.Name || '',
    ok: anyOk,
    uniqueByType,
    codeResults: codeResults.map(({ code, market, type, origin, ok, error, fetched, count, keptEUR, dropped }) => ({ code, market, type, origin, ok, error, fetched, count, keptEUR, dropped })),
    freshOffers,
  };
}

/** Roll each request's fetched/kept/drop tallies up per offer type. This is
 *  the number that answers "why so few hotels or flights": a small `fetched`
 *  means Travelify sent little for that request shape; a big fetched-to-kept
 *  gap names the rule doing the dropping. */
function aggregateSweepStats(perCountry) {
  const perType = {};
  const bucket = (type) => perType[type] || (perType[type] = {
    requests: 0, failed: 0, fetched: 0, kept: 0, keptEUR: 0, unique: 0,
    dropped: { noPrice: 0, noDest: 0, duration: 0, durNoNights: 0, durOutOfRange: 0, nonGBP: 0 },
  });
  for (const p of perCountry || []) {
    for (const r of (p.codeResults || [])) {
      if (!r || !r.type) continue;
      const t = bucket(r.type);
      t.requests++;
      if (!r.ok) { t.failed++; continue; }
      t.fetched += r.fetched || 0;
      t.kept += r.count || 0;
      t.keptEUR += r.keptEUR || 0;
      const d = r.dropped || {};
      t.dropped.noPrice += d.noPrice || 0;
      t.dropped.noDest += d.noDest || 0;
      t.dropped.duration += d.duration || 0;
      t.dropped.durNoNights += d.durNoNights || 0;
      t.dropped.durOutOfRange += d.durOutOfRange || 0;
      t.dropped.nonGBP += d.nonGBP || 0;
    }
    // Per-country unique tallies (offers are country-scoped, so summing
    // across countries stays an exact unique count).
    const u = p.uniqueByType || {};
    for (const type of Object.keys(u)) bucket(type).unique += u[type] || 0;
  }
  return perType;
}

// ── Summary rebuild from all stored country keys ────────────────────────────
async function rebuildSummary(rows) {
  // Build countryCode → region from the MapSearches rows (the single source of
  // truth for region — already populated in Airtable). Region travels into the
  // summary so the widget can filter the map by region.
  const regionByCC = {};
  const allCountryCodes = [];
  for (const r of rows) {
    const f = r.fields || {};
    const cc = (f.CountryCode || '').trim();
    if (!cc) continue;
    allCountryCodes.push(cc);
    if (f.Region) regionByCC[cc] = f.Region;
  }

  let all = [];
  let allHotels = [];
  for (const cc of allCountryCodes) {
    const stored = await getJson(countryKey(cc));
    if (stored && Array.isArray(stored.offers)) {
      // The world map is a PACKAGE-deals product: its pins, prices and resort
      // cards must not blend hotel-only or flight-only offers now that the
      // cache stores all types for the offer boxes. Summaries are built from
      // the Packages subset only. GBP only too: the map's "from £X" pins are a
      // single-currency label, so Irish EUR packages (which the offer boxes read
      // straight from the per-country keys) are kept out of the map summary
      // rather than mislabelled with a £ sign. (5 Aug 2026.)
      const packageOffers = stored.offers.filter(o => (o.type || 'Packages') === 'Packages' && (o.currency || 'GBP') === 'GBP');
      all = all.concat(packageOffers);
      // Write a compact per-country resort summary (ALL resorts, cheapest +
      // coords + count each) so the widget can pin every resort, not just the
      // handful in the deals endpoint's cheapest slice.
      const resorts = summariseByResort(packageOffers);
      await setJson(resortsKey(cc), { resorts, refreshedAt: new Date().toISOString() });
    }
    // Hotels ("Accommodation") live in the extra key. Build a parallel GBP-only
    // hotel summary and per-country resort summary so the World Map's Hotels
    // mode has its own pins and resort cards, without touching the package
    // summary above. Flight-only offers in the extra key are ignored here.
    const extra = await getJson(extraKey(cc));
    if (extra && Array.isArray(extra.offers)) {
      const hotelOffers = extra.offers.filter(o => o && o.type === 'Accommodation' && (o.currency || 'GBP') === 'GBP');
      allHotels = allHotels.concat(hotelOffers);
      const hotelResorts = summariseByResort(hotelOffers);
      await setJson(hotelResortsKey(cc), { resorts: hotelResorts, refreshedAt: new Date().toISOString() });
    }
  }
  const countries = summariseByCountry(all, regionByCC);
  const airports = summariseByAirport(all, regionByCC);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'redis',
    currency: 'GBP',
    // ENVELOPE reads `countries`; FULLSCREEN reads `airports`.
    // Widget displays fromPricePP (per-person), per locked decision.
    // Each country/airport now carries `region` for map-level region filtering.
    countries,
    airports,
    stats: { totalOffers: all.length, countriesCovered: countries.length, airportsCovered: airports.length },
  };
  const ok = await setJson(SUMMARY_KEY, payload);
  if (ok) await setString(LASTRUN_KEY, payload.generatedAt);

  // Hotels summary — country pins only (hotel offers carry no flight gateway,
  // so there is no airport tier). Same shape as the package summary so the
  // widget reuses its country-pin renderer in Hotels mode. Written separately
  // and never blended with the package summary above.
  const hotelCountries = summariseByCountry(allHotels, regionByCC);
  await setJson(HOTELS_SUMMARY_KEY, {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'redis',
    currency: 'GBP',
    countries: hotelCountries,
    airports: [],
    stats: { totalOffers: allHotels.length, countriesCovered: hotelCountries.length, airportsCovered: 0 },
  });

  // Sample a composition point for the admin trend line. Best-effort — a
  // history hiccup must never fail the summary write. Gated to ~30m so frequent
  // manual re-polls don't spam the series; `all` is the package pool, split
  // into holidays vs dynamic (the map's own product, and where supplier drift
  // shows first).
  try {
    const raw = await getJson(HISTORY_KEY);
    const arr = Array.isArray(raw) ? raw.slice() : [];
    const last = arr[arr.length - 1];
    const nowT = Date.parse(payload.generatedAt);
    if (!last || !last.at || (nowT - Date.parse(last.at)) >= HISTORY_MIN_GAP_MS) {
      let holidays = 0, dynamic = 0;
      for (const o of all) { if (packageKindOf(o) === 'DynamicPackages') dynamic++; else holidays++; }
      // Count the hotels/flights pool too — but read those keys ONLY here (past
      // the gate), so the common per-sweep summary rebuild pays nothing extra.
      let hotels = 0, flights = 0;
      for (const cc of allCountryCodes) {
        const x = await getJson(extraKey(cc));
        if (x && Array.isArray(x.offers)) {
          for (const o of x.offers) {
            if (!o) continue;
            if (o.type === 'Flights') flights++;
            else if (o.type === 'Accommodation') hotels++;
          }
        }
      }
      arr.push({ at: payload.generatedAt, packages: all.length, holidays, dynamic, hotels, flights, countries: countries.length });
      while (arr.length > HISTORY_MAX) arr.shift();
      await setJson(HISTORY_KEY, arr);
    }
  } catch (e) {
    console.warn('[map-cron] history sample skipped:', e.message);
  }
  return { written: ok, ...payload.stats };
}

// ── Cursor + time budget ────────────────────────────────────────────────────
// Every run — rotating AND full — starts at the stored cursor, sweeps as many
// of its target countries as the time budget allows, then advances the cursor
// past exactly the countries it processed. A full sweep of 40+ countries does
// not fit inside the function's 300s limit once retries and three offer types
// are in play; before this, an over-long full sweep was killed mid-loop and
// NOTHING after it ran — no sweep stats, no maintenance purge, no summary
// rebuild — which is why full rebuilds appeared to do nothing. Now a run that
// hits the budget still completes all bookkeeping, reports partial: true, and
// the next invocation (cron tick or another click) continues where it stopped.
// 200s sweeping + up to ~75s bookkeeping keeps the whole run inside the
// admin page's 290s wait window (map-rebuild aborts its wait there), so the
// operator reliably gets the real "swept X of Y — click again" response
// instead of a vague "still running" race.
const SWEEP_TIME_BUDGET_MS = 200 * 1000;
async function selectSlice(rows, full) {
  const total = rows.length;
  const cur = (await getJson(CURSOR_KEY)) || { i: 0 };
  const start = (cur.i || 0) % total;
  const target = full ? total : Math.max(1, Math.ceil(total * HOURLY_FRACTION));
  const slice = [];
  for (let k = 0; k < Math.min(target, total); k++) slice.push(rows[(start + k) % total]);
  return { slice, start, total };
}

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Auth
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorised' });
  }

  const startedAt = Date.now();
  const q = req.query || {};

  try {
    const rows = await fetchEnabledCountries();
    if (rows.length === 0) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'no enabled countries' });
    }

    // ── READBACK probe ───────────────────────────────────────────────────
    // ?readback=1 reads map:offers:v1 straight back from Redis via the cron's
    // OWN connection (same env the cron writes with). Bypasses the read
    // endpoint and the edge cache entirely, so it tells us definitively
    // whether the data is in Redis and what shape it has. TEMPORARY.
    if (q.readback === '1' || q.readback === 'true') {
      const summary = await getJson(SUMMARY_KEY);
      const sampleCountryKeys = ['ES', 'GR', 'PT'];
      const countryProbe = {};
      for (const cc of sampleCountryKeys) {
        const s = await getJson(countryKey(cc));
        countryProbe[cc] = s && Array.isArray(s.offers)
          ? { offers: s.offers.length, refreshedAt: s.refreshedAt }
          : (s === null ? 'null' : 'no offers array');
      }
      return res.status(200).json({
        ok: true,
        readback: true,
        redisConfigured: configured(),
        summaryKey: SUMMARY_KEY,
        summaryExists: !!summary,
        summaryShape: summary ? {
          hasCountries: Array.isArray(summary.countries),
          countriesLen: Array.isArray(summary.countries) ? summary.countries.length : null,
          hasAirports: Array.isArray(summary.airports),
          airportsLen: Array.isArray(summary.airports) ? summary.airports.length : null,
          generatedAt: summary.generatedAt || null,
          stats: summary.stats || null,
        } : null,
        firstCountry: summary && Array.isArray(summary.countries) ? summary.countries[0] : null,
        countryKeyProbe: countryProbe,
      });
    }

    // ── DEBUG probe ──────────────────────────────────────────────────────
    if (q.debug === '1' || q.debug === 'true') {
      const row = rows[0];
      const code = q.dest ? String(q.dest).split(',')[0].trim() : destinationCodesFor(row)[0];
      // ?nat=IE probes a different market without writing anything — used to
      // verify what nationality steers on the Travelify side.
      const nat = q.nat && /^[A-Za-z]{2}$/.test(String(q.nat)) ? String(q.nat).toUpperCase() : 'GB';
      const market = MARKETS.find(m => m.nationality === nat) || { id: nat, nationality: nat };
      const payload = buildPayload(row, code, market);
      if (q.max) { const m = parseInt(q.max, 10); if (Number.isFinite(m) && m > 0) payload.maxOffers = m; }
      const raw = await callOffersProxy(payload);
      const arr = raw.data && Array.isArray(raw.data.data) ? raw.data.data : null;
      const offers = arr ? normaliseOffers(arr) : [];

      // Redis readback folded in — reads what the cron's own connection sees,
      // so the debug URL (known to work) also reports the stored state.
      let redisReadback = null;
      try {
        const summary = await getJson(SUMMARY_KEY);
        const probe = {};
        for (const cc of ['ES', 'GR', 'US']) {
          const s = await getJson(countryKey(cc));
          probe[cc] = s && Array.isArray(s.offers)
            ? { offers: s.offers.length, refreshedAt: s.refreshedAt }
            : (s === null ? 'null' : 'no offers array');
        }
        redisReadback = {
          redisConfigured: configured(),
          summaryKey: SUMMARY_KEY,
          summaryExists: !!summary,
          summaryCountriesLen: summary && Array.isArray(summary.countries) ? summary.countries.length : null,
          summaryAirportsLen: summary && Array.isArray(summary.airports) ? summary.airports.length : null,
          summaryGeneratedAt: summary ? summary.generatedAt : null,
          summaryStats: summary ? summary.stats : null,
          firstCountry: summary && Array.isArray(summary.countries) ? summary.countries[0] : null,
          countryKeyProbe: probe,
        };
      } catch (e) {
        redisReadback = { error: e.message };
      }

      return res.status(200).json({
        ok: true, debug: true, sentPayload: payload,
        rawResponseOk: raw.ok, rawError: raw.error || null,
        rawOfferCount: arr ? arr.length : null,
        normalisedCount: offers.length,
        byCountry: summariseByCountry(offers),
        byAirport: summariseByAirport(offers),
        sampleOffer: offers[0] || null,
        // rawSample = the UNTOUCHED Travelify offer (before our parser), so we can
        // see exactly which fields it carries (e.g. where nights/duration lives).
        // Two samples in case the first is atypical. TEMPORARY diagnostic.
        rawSample: arr && arr[0] ? arr[0] : null,
        rawSample2: arr && arr[1] ? arr[1] : null,
        redisReadback,
      });
    }

    if (!configured()) {
      return res.status(500).json({ ok: false, error: 'Redis not configured' });
    }

    // ── Single-country sweep (?country=XX) ────────────────────────────────
    // Powers the per-row "refresh" button in the admin dashboard. Sweeps
    // exactly the one requested country and rebuilds the summary. This is a
    // deliberate manual override, so it ALWAYS runs regardless of the
    // configured refresh interval (the operator asked for it now).
    const reqCountry = q.country ? String(q.country).toUpperCase().trim() : null;
    if (reqCountry) {
      if (!/^[A-Z]{2}$/.test(reqCountry)) {
        return res.status(400).json({ ok: false, error: 'country must be a 2-letter code' });
      }
      const row = rows.find(r => ((r.fields || {}).CountryCode || '').trim().toUpperCase() === reqCountry);
      if (!row) {
        return res.status(404).json({ ok: false, error: `country ${reqCountry} is not an enabled destination` });
      }
      const now = new Date();
      const swept = await sweepCountry(row);
      let stored = 'unchanged', fetched = 0;
      if (swept.ok) {
        const counts = await storeCountryOffers(swept.cc, swept.freshOffers, now);
        stored = counts.storedPackages + counts.storedExtra;
        fetched = swept.freshOffers.length;
        // Single-country re-polls refresh the sweep stats too — labelled so
        // the Cache tab shows the honest scope.
        await setJson(SWEEP_STATS_KEY, {
          at: now.toISOString(),
          mode: `country:${reqCountry}`,
          sweptCountries: 1,
          perType: aggregateSweepStats([{ codeResults: swept.codeResults, uniqueByType: swept.uniqueByType }]),
        });
      }
      const summary = await rebuildSummary(rows);
      return res.status(200).json({
        ok: true,
        mode: 'country',
        country: reqCountry,
        swept: { cc: swept.cc, ok: swept.ok, fetched, stored, codeResults: swept.codeResults, error: swept.ok ? null : (swept.error || 'all requests failed') },
        summary,
        durationMs: Date.now() - startedAt,
      });
    }

    // ── Read the operator-configured min re-sweep interval ────────────────
    const intervalMins = await getRefreshIntervalMins();
    const nowMs = Date.now();

    // ── Select the slice to sweep this run ────────────────────────────────
    const full = q.full === '1' || q.full === 'true';
    const { slice, start, total } = await selectSlice(rows, full);

    // ── Sweep each country in the slice, store per-country with merge+purge ─
    const now = new Date();
    const perCountry = [];
    let skippedFresh = 0;
    let processed = 0;
    let budgetExhausted = false;
    for (const row of slice) {
      if (Date.now() - startedAt > SWEEP_TIME_BUDGET_MS) { budgetExhausted = true; break; }
      processed++;
      const rowCC = ((row.fields || {}).CountryCode || '').trim().toUpperCase();
      // Interval gate: on a normal (rotating) run, skip any country whose
      // offers are younger than the configured interval. A full sweep (?full=1)
      // ignores the gate — it's the guaranteed complete refresh.
      if (!full && rowCC) {
        const existingForFreshness = await getJson(countryKey(rowCC));
        if (isFresh(existingForFreshness, intervalMins, nowMs)) {
          skippedFresh++;
          perCountry.push({ cc: rowCC, ok: true, skipped: 'fresh', stored: (existingForFreshness.offers || []).length });
          continue;
        }
      }
      const swept = await sweepCountry(row);
      if (!swept.cc || swept.cc === '(none)') {
        perCountry.push({ cc: swept.cc, ok: false, error: swept.error, stored: 0 });
        continue;
      }
      if (!swept.ok) {
        // All requests failed — leave the existing keys untouched (fail safe).
        perCountry.push({ cc: swept.cc, ok: false, error: 'all requests failed', codeResults: swept.codeResults, stored: 'unchanged' });
        continue;
      }
      const counts = await storeCountryOffers(swept.cc, swept.freshOffers, now);
      perCountry.push({
        cc: swept.cc, ok: true,
        fetched: swept.freshOffers.length,
        stored: counts.storedPackages + counts.storedExtra,
        storedPackages: counts.storedPackages,
        storedExtra: counts.storedExtra,
        keyKB: counts.keyKB,
        uniqueByType: swept.uniqueByType,
        ...(counts.writeFailed ? { writeFailed: true } : {}),
        ...(counts.halved ? { halved: true } : {}),
        codeResults: swept.codeResults,
      });
    }

    // ── Sweep stats: per-type fetched vs kept, with drop reasons ───────────
    // Written every run so the Cache tab can show what the last sweep
    // actually pulled per type and why anything was rejected.
    const sweptCount = perCountry.filter(p => p.ok && !p.skipped).length;
    const sweepStats = aggregateSweepStats(perCountry);
    if (sweptCount) {
      await setJson(SWEEP_STATS_KEY, {
        at: now.toISOString(),
        mode: full ? 'full' : 'hourly',
        ...(budgetExhausted ? { partial: true } : {}),
        sweptCountries: sweptCount,
        targetCountries: slice.length,
        perType: sweepStats,
      });
      for (const [t, s] of Object.entries(sweepStats)) {
        console.log(`[map-cron] sweep ${t}: ${s.fetched} fetched → ${s.kept} kept` +
          ` (noPrice ${s.dropped.noPrice}, noDest ${s.dropped.noDest}, duration ${s.dropped.duration}` +
          (s.dropped.duration ? ` [noNights ${s.dropped.durNoNights || 0}, outOfRange ${s.dropped.durOutOfRange || 0}]` : '') +
          `, nonGBP ${s.dropped.nonGBP}` +
          (s.failed ? `, ${s.failed}/${s.requests} requests failed)` : `)`));
      }
    }

    // ── Maintenance: purge every UNSWEPT stored key (stale-offer guarantee) ─
    // Swept countries were just purged inside storeCountryOffers; this covers
    // the rest, including orphans no longer in MapSearches. Runs before the
    // summary rebuild so expired offers can't reach the map either.
    // Only countries that went through storeCountryOffers this run are freshly
    // purged — skipped-fresh entries were not, so they stay in scope here.
    const sweptCCs = new Set(perCountry.filter(p => p.ok && p.cc && !p.skipped).map(p => String(p.cc).toUpperCase()));
    const maintenance = await maintainStoredOffers(now, sweptCCs);
    if (maintenance.offersRemoved || maintenance.keysDeleted || maintenance.writeFailures) {
      console.log(`[map-cron] maintenance: removed ${maintenance.offersRemoved} expired offers across ${maintenance.countriesCleaned} countries, deleted ${maintenance.keysDeleted} empty keys` +
        (maintenance.writeFailures ? `, ${maintenance.writeFailures} rewrites FAILED even halved` : ''));
    }

    // ── Rebuild the widget summary from ALL country keys (full coverage) ───
    // Pass the full rows so region (from MapSearches) travels into the summary.
    const summary = await rebuildSummary(rows);

    // ── Advance the cursor past exactly the countries processed ───────────
    // Both modes resume from here next run, so a budget-limited full sweep
    // continues where it stopped instead of restarting.
    await setJson(CURSOR_KEY, { i: total ? (start + processed) % total : 0 });
    if (budgetExhausted) {
      console.log(`[map-cron] time budget reached after ${processed} of ${slice.length} countries — cursor advanced, next run continues from there`);
    }

    return res.status(200).json({
      ok: true,
      mode: full ? 'full' : 'hourly',
      intervalMins,
      partial: budgetExhausted,
      processedCountries: processed,
      targetCountries: slice.length,
      skippedFresh,
      totalCountries: rows.length,
      sweepStats,
      maintenance,
      summary,
      perCountry,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, durationMs: Date.now() - startedAt });
  }
}
