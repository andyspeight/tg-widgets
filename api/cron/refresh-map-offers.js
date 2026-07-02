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
 *      has passed or whose fetchedAt is older than 4 days (tested sweep logic).
 *   5. Rebuilds the small map summary (cheapest per country + cheapest per airport)
 *      from ALL stored country keys and writes it to map:offers:v1.
 *
 * CADENCE
 *   - ?full=1  → sweep every enabled country (the nightly run).
 *   - default  → sweep a rotating ~15% slice (the hourly run).
 *   The cron schedule in vercel.json fires hourly-ish; trigger the nightly full
 *   sweep with ?full=1 (e.g. a second cron entry, or the scheduler calling it).
 *
 * STORAGE KEYS
 *   offers:packages:{CC}   per-country raw normalised offers + refreshedAt
 *   map:offers:v1          derived summary the widget reads (country + airport pins)
 *   map:offers:lastRunAt   ISO timestamp of the last successful summary write
 *   map:offers:cursor      rotation cursor for the hourly 15% slice
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
 *   A country whose requests all fail keeps its existing Redis key untouched.
 *   The summary is only rewritten if at least one country has offers, so a bad
 *   run can never blank the map.
 */

import { setJson, getJson, setString, getString, configured } from '../_redis.js';

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
const HOURLY_FRACTION = 0.15;      // ~15% of countries per hourly run
const MAX_AGE_HOURS = 70;          // purge offers older than this (was 4 days / 96h)
// Trip-duration bounds. Travelify returns offers of varying real durations and
// sort:price:asc surfaces the cheapest — which can be a 1-night stay. We keep
// holiday-length offers only: 2 nights (so short city breaks still qualify) up
// to 28 nights. Offers outside this range never enter Redis, so the map pins
// and the deal cards both stay clean. (Per-country override territory later.)
const MIN_NIGHTS = 2;
const MAX_NIGHTS = 28;

const SUMMARY_KEY = 'map:offers:v1';
const LASTRUN_KEY = 'map:offers:lastRunAt';
const CURSOR_KEY = 'map:offers:cursor';
const REFRESH_INTERVAL_KEY = 'tg:wm:refresh-interval-mins';
const DEFAULT_INTERVAL_MINS = 45;
const ALLOWED_INTERVALS = [15, 30, 45, 60, 120, 240, 1440];
const countryKey = (cc) => `offers:packages:${cc}`;
// Accommodation-only and flight-only offers live in their OWN key so the
// long-standing packages key (which the world map reads) keeps its exact
// product and neither key can outgrow Upstash's per-request write ceiling.
const extraKey = (cc) => `offers:extra:${cc}`;
const resortsKey = (cc) => `map:resorts:${cc}`;

// Per-country, per-market storage caps (cheapest kept). A country key is one
// Redis value written in one REST call, so it must stay comfortably inside
// Upstash's request-size limit however many airports, markets and types a
// country accumulates. Cheapest-first matches how every consumer sorts.
const STORE_CAPS = { Packages: 900, Accommodation: 600, Flights: 400 };

/** Cap a merged offer list: within each type|market group keep only the
 *  cheapest STORE_CAPS[type] offers (per person). */
function capStoredOffers(offers) {
  const groups = new Map();
  for (const o of offers || []) {
    const k = `${o.type || 'Packages'}|${o.market || 'GB'}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  const pp = (o) => (Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : Infinity));
  const out = [];
  for (const [k, arr] of groups) {
    const type = k.split('|')[0];
    const cap = STORE_CAPS[type] || STORE_CAPS.Packages;
    arr.sort((a, b) => pp(a) - pp(b));
    out.push(...arr.slice(0, cap));
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

// ── Tested offer parser (unit-verified 22 May 2026) ─────────────────────────
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function parsePrice(offer) {
  if (typeof offer.formattedPrice === 'string') {
    const n = parseFloat(offer.formattedPrice.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const fp = offer.flight && offer.flight.pricing ? Number(offer.flight.pricing.price) : 0;
  const ap = offer.accommodation && offer.accommodation.pricing ? Number(offer.accommodation.pricing.price) : 0;
  const sum = (Number.isFinite(fp) ? fp : 0) + (Number.isFinite(ap) ? ap : 0);
  return sum > 0 ? Math.round(sum) : null;
}
function parsePPPrice(offer) {
  if (typeof offer.formattedPPPrice === 'string') {
    const n = parseFloat(offer.formattedPPPrice.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}
function normaliseOffer(offer) {
  const flight = offer.flight || {}, acc = offer.accommodation || {};
  const fdest = flight.destination || {}, adest = acc.destination || {};
  const price = parsePrice(offer);
  if (price == null) return null;
  const iata = fdest.iataCode || null;
  const countryCode = fdest.countryCode || adest.countryCode || null;
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
function normaliseOffers(rawArray, sweepTypeId = 'Packages') {
  if (!Array.isArray(rawArray)) return [];
  const out = [];
  for (const o of rawArray) {
    const n = normaliseOffer(o);
    if (!n) continue;
    // Stamp the swept type authoritatively — the read side filters on it.
    n.type = sweepTypeId;
    if (passesDurationRule(n)) out.push(n);
  }
  return out;
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
    const c = m.get(o.countryCode);
    if (!c) m.set(o.countryCode, { countryCode: o.countryCode, lat: o.lat, lng: o.lng, fromPrice: o.price, fromPricePP: o.pricePP, currency: o.currency, offerCount: 1, _airports: new Set([o.airport]), cheapestOfferId: o.id });
    else { c.offerCount += 1; c._airports.add(o.airport); if (o.price < c.fromPrice) { c.fromPrice = o.price; c.fromPricePP = o.pricePP; c.lat = o.lat; c.lng = o.lng; c.cheapestOfferId = o.id; } }
  }
  // Stamp the region (from the MapSearches rows) onto each country so the widget
  // can offer region filtering. Unknown codes fall back to 'Other'.
  return Array.from(m.values())
    .map(c => { const { _airports, ...rest } = c; return { ...rest, airportCount: _airports.size, region: regionByCC[c.countryCode] || 'Other' }; })
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
    const ex = m.get(r);
    if (!ex) {
      m.set(r, {
        resort: r, lat, lng, fromPrice: o.price, fromPricePP: o.pricePP, currency: o.currency,
        offerCount: 1, cheapestOfferId: o.id,
        // airport = the gateway for this resort's cheapest offer. The widget
        // fetches deals?airport=… so it can pull a resort's real offers even
        // when they're outside the country's cheapest slice. _airports tracks
        // every gateway seen (a resort may be served by more than one).
        airport: o.airport || null, airportName: o.airportName || null,
        _airports: new Set(o.airport ? [o.airport] : []),
      });
    } else {
      ex.offerCount += 1;
      if (o.airport) ex._airports.add(o.airport);
      const exPP = Number.isFinite(ex.fromPricePP) ? ex.fromPricePP : ex.fromPrice;
      if (pp != null && (exPP == null || pp < exPP)) {
        ex.fromPrice = o.price; ex.fromPricePP = o.pricePP; ex.lat = lat; ex.lng = lng;
        ex.cheapestOfferId = o.id; ex.airport = o.airport || ex.airport; ex.airportName = o.airportName || ex.airportName;
      }
    }
  }
  return Array.from(m.values())
    .map(r => { const { _airports, ...rest } = r; return { ...rest, airports: Array.from(_airports) }; })
    .sort((a, b) => (a.fromPricePP || a.fromPrice || Infinity) - (b.fromPricePP || b.fromPrice || Infinity));
}

// ── Tested sweep / merge / purge logic (unit-verified 22 May 2026) ──────────
function mergeOffers(existing, fresh) {
  // Key by id + origin + type: with two departure markets in one cache, the
  // same package id can legitimately exist once per departure airport
  // (Gatwick and Dublin are different offers with different prices), and with
  // three offer types swept, ids from different type namespaces must never
  // overwrite each other. Keying by id alone would make them clobber each
  // other on every sweep.
  const key = (o) => `${o.id}|${o.origin || ''}|${o.type || 'Packages'}`;
  const byId = new Map();
  for (const o of existing || []) if (o && o.id != null) byId.set(key(o), o);
  for (const o of fresh || []) if (o && o.id != null) byId.set(key(o), o);
  return Array.from(byId.values());
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
    const td = travelDateOf(o);
    if (td) { const t = Date.parse(td); if (Number.isFinite(t) && t < nowMs) return false; }
    if (o.fetchedAt) { const f = Date.parse(o.fetchedAt); if (Number.isFinite(f) && (nowMs - f) > maxAgeMs) return false; }
    return true;
  });
}
function updateCountryOffers(existingOffers, freshOffers, now = new Date()) {
  return purgeOffers(mergeOffers(existingOffers, freshOffers), now);
}

/** Merge a sweep's fresh offers (all types mixed) into the country's TWO
 *  storage keys: Packages → offers:packages:{CC} (the key the world map
 *  reads, product unchanged), Accommodation + Flights → offers:extra:{CC}.
 *  Each key gets the shared merge + purge + cheapest-cap treatment.
 *  Returns stored counts for the run report. */
async function storeCountryOffers(cc, freshOffers, now) {
  const freshPackages = freshOffers.filter(o => (o.type || 'Packages') === 'Packages');
  const freshExtra = freshOffers.filter(o => (o.type || 'Packages') !== 'Packages');

  const pKey = countryKey(cc);
  const existingP = (await getJson(pKey)) || { offers: [] };
  const survivingP = capStoredOffers(updateCountryOffers(existingP.offers || [], freshPackages, now));
  await setJson(pKey, { offers: survivingP, refreshedAt: now.toISOString() });

  const xKey = extraKey(cc);
  const existingX = (await getJson(xKey)) || { offers: [] };
  const survivingX = capStoredOffers(updateCountryOffers(existingX.offers || [], freshExtra, now));
  await setJson(xKey, { offers: survivingX, refreshedAt: now.toISOString() });

  return { storedPackages: survivingP.length, storedExtra: survivingX.length };
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
  { id: 'GB', nationality: 'GB' },
  { id: 'IE', nationality: 'IE' }, // Irish departures for the Irish clients
];

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

function buildPayload(row, destinationCode, market = MARKETS[0], sweepType = SWEEP_TYPES[0]) {
  const f = row.fields || {};
  return {
    appId: f.AppId || DEMO_APP_ID,
    type: sweepType.payloadType,
    ...(sweepType.packageType ? { packageType: sweepType.packageType } : {}),
    deduping: 'None',
    currency: 'GBP', language: 'en', nationality: market.nationality,
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
async function callOffersProxy(payload, timeoutMs = PER_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OFFERS_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': SELF_ORIGIN + '/',
        'Origin': SELF_ORIGIN,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    if (data && data.success === false) return { ok: false, error: data.error || 'upstream failure' };
    return { ok: true, data };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e.message };
  }
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
  for (const code of codes) for (const market of MARKETS) for (const sweepType of SWEEP_TYPES) {
    jobs.push({ code, market, sweepType });
  }
  const codeResults = await pooled(jobs, async ({ code, market, sweepType }) => {
    const raw = await callOffersProxy(buildPayload(row, code, market, sweepType));
    if (!raw.ok) return { code, market: market.id, type: sweepType.id, ok: false, error: raw.error || `HTTP ${raw.status}`, count: 0, offers: [] };
    const arr = raw.data && Array.isArray(raw.data.data) ? raw.data.data : [];
    let offers = normaliseOffers(arr, sweepType.id);
    const beforeCurrencyFilter = offers.length;
    offers = offers.filter(o => o.currency === 'GBP');
    const droppedNonGBP = beforeCurrencyFilter - offers.length;
    for (const o of offers) o.market = market.id;
    return { code, market: market.id, type: sweepType.id, ok: true, count: offers.length, droppedNonGBP, offers };
  });
  const freshOffers = codeResults.flatMap(r => r.offers);
  const anyOk = codeResults.some(r => r.ok);

  // Observability for the Irish market rollout: log what the IE requests
  // actually returned (origin airports prove the market took effect; a tally
  // of UK-only origins would mean nationality does not steer the market and
  // we need a different lever). Logged per country, only when informative.
  const ieResults = codeResults.filter(r => r.market === 'IE');
  if (ieResults.length) {
    const ieOffers = ieResults.flatMap(r => r.offers || []);
    const originTally = {};
    for (const o of ieOffers) { const k = o.origin || '??'; originTally[k] = (originTally[k] || 0) + 1; }
    const dropped = ieResults.reduce((s, r) => s + (r.droppedNonGBP || 0), 0);
    const errs = ieResults.filter(r => !r.ok).length;
    console.log(`[map-cron] ${cc} IE market: ${ieOffers.length} offers` +
      (Object.keys(originTally).length ? ` origins=${Object.entries(originTally).map(([k, v]) => `${k}x${v}`).join(',')}` : '') +
      (dropped ? ` droppedNonGBP=${dropped}` : '') +
      (errs ? ` failedRequests=${errs}` : ''));
  }

  return {
    cc, name: f.Name || '',
    ok: anyOk,
    codeResults: codeResults.map(({ code, market, type, ok, error, count }) => ({ code, market, type, ok, error, count })),
    freshOffers,
  };
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
  for (const cc of allCountryCodes) {
    const stored = await getJson(countryKey(cc));
    if (stored && Array.isArray(stored.offers)) {
      // The world map is a PACKAGE-deals product: its pins, prices and resort
      // cards must not blend hotel-only or flight-only offers now that the
      // cache stores all types for the offer boxes. Summaries are built from
      // the Packages subset only.
      const packageOffers = stored.offers.filter(o => (o.type || 'Packages') === 'Packages');
      all = all.concat(packageOffers);
      // Write a compact per-country resort summary (ALL resorts, cheapest +
      // coords + count each) so the widget can pin every resort, not just the
      // handful in the deals endpoint's cheapest slice.
      const resorts = summariseByResort(packageOffers);
      await setJson(resortsKey(cc), { resorts, refreshedAt: new Date().toISOString() });
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
  return { written: ok, ...payload.stats };
}

// ── Cursor for hourly rotation ──────────────────────────────────────────────
async function selectSlice(rows, full) {
  if (full) return { slice: rows, nextCursor: 0 };
  const total = rows.length;
  const sliceSize = Math.max(1, Math.ceil(total * HOURLY_FRACTION));
  const cur = (await getJson(CURSOR_KEY)) || { i: 0 };
  const start = (cur.i || 0) % total;
  const slice = [];
  for (let k = 0; k < sliceSize; k++) slice.push(rows[(start + k) % total]);
  return { slice, nextCursor: (start + sliceSize) % total };
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
    const { slice, nextCursor } = await selectSlice(rows, full);

    // ── Sweep each country in the slice, store per-country with merge+purge ─
    const now = new Date();
    const perCountry = [];
    let skippedFresh = 0;
    for (const row of slice) {
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
        codeResults: swept.codeResults,
      });
    }

    // ── Rebuild the widget summary from ALL country keys (full coverage) ───
    // Pass the full rows so region (from MapSearches) travels into the summary.
    const summary = await rebuildSummary(rows);

    // ── Advance the rotation cursor (hourly only) ─────────────────────────
    if (!full) await setJson(CURSOR_KEY, { i: nextCursor });

    return res.status(200).json({
      ok: true,
      mode: full ? 'full' : 'hourly',
      intervalMins,
      sweptCountries: slice.length,
      skippedFresh,
      totalCountries: rows.length,
      summary,
      perCountry,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, durationMs: Date.now() - startedAt });
  }
}
