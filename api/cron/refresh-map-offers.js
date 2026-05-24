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

import { setJson, getJson, setString, configured } from '../_redis.js';

// ── Config ────────────────────────────────────────────────────────────────
const AIRTABLE_BASE = 'appAYzWZxvK6qlwXK';
const MAP_SEARCHES_TABLE = 'tblrI1BihuDcpoV1A'; // MapSearches (country model, seeded 23 May 2026)
const OFFERS_PROXY = process.env.OFFERS_PROXY_URL || 'https://tg-widgets.vercel.app/api/offers';
const SELF_ORIGIN = 'https://tg-widgets.vercel.app';
const DEMO_APP_ID = '250';

const PER_REQUEST_TIMEOUT_MS = 10000;
const REQUEST_CONCURRENCY = 4;     // parallel proxy calls within a country
const HOURLY_FRACTION = 0.15;      // ~15% of countries per hourly run
const MAX_AGE_DAYS = 4;            // purge offers older than this
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
const countryKey = (cc) => `offers:packages:${cc}`;
const resortsKey = (cc) => `map:resorts:${cc}`;

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
  return {
    id: offer.id, type: offer.type || 'Packages', packageType: offer.packageType || null,
    price, pricePP: parsePPPrice(offer),
    currency: (flight.pricing && flight.pricing.currency) || (acc.pricing && acc.pricing.currency) || 'GBP',
    airport: iata, airportName: fdest.name || null, countryCode,
    resort: adest.name || null, lat, lng,
    resortLat: num(adest.latitude), resortLng: num(adest.longitude),
    hotel: acc.name || null, rating: num(acc.rating), boardBasis: acc.boardBasis || null,
    nights: num(acc.nights), reviewRating: num(acc.reviewRating), reviewCount: num(acc.reviewCount),
    carrier: (flight.carrier && flight.carrier.name) || null, direct: !!flight.direct,
    origin: (flight.origin && flight.origin.iataCode) || null,
    outboundDate: flight.outboundDate || null,
    checkinDate: acc.checkinDate || null,
    image: (acc.image && acc.image.url) || (flight.image && flight.image.url) || null,
    url: offer.url || null, updated: offer.updated || null, fetchedAt: new Date().toISOString(),
  };
}
function withinNightsRange(o) {
  // Keep only holiday-length stays. If nights is missing/unparseable, drop it
  // (we'd rather omit an offer than show a duration-less "deal").
  return Number.isFinite(o.nights) && o.nights >= MIN_NIGHTS && o.nights <= MAX_NIGHTS;
}
function normaliseOffers(rawArray) {
  if (!Array.isArray(rawArray)) return [];
  const out = [];
  for (const o of rawArray) {
    const n = normaliseOffer(o);
    if (n && withinNightsRange(n)) out.push(n);
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
      m.set(r, { resort: r, lat, lng, fromPrice: o.price, fromPricePP: o.pricePP, currency: o.currency, offerCount: 1, cheapestOfferId: o.id });
    } else {
      ex.offerCount += 1;
      const exPP = Number.isFinite(ex.fromPricePP) ? ex.fromPricePP : ex.fromPrice;
      if (pp != null && (exPP == null || pp < exPP)) {
        ex.fromPrice = o.price; ex.fromPricePP = o.pricePP; ex.lat = lat; ex.lng = lng; ex.cheapestOfferId = o.id;
      }
    }
  }
  return Array.from(m.values()).sort((a, b) => (a.fromPricePP || a.fromPrice || Infinity) - (b.fromPricePP || b.fromPrice || Infinity));
}

// ── Tested sweep / merge / purge logic (unit-verified 22 May 2026) ──────────
function mergeOffers(existing, fresh) {
  const byId = new Map();
  for (const o of existing || []) if (o && o.id != null) byId.set(String(o.id), o);
  for (const o of fresh || []) if (o && o.id != null) byId.set(String(o.id), o);
  return Array.from(byId.values());
}
function travelDateOf(offer) { return offer.outboundDate || offer.checkinDate || null; }
function purgeOffers(offers, now = new Date(), maxAgeDays = MAX_AGE_DAYS) {
  const nowMs = now.getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return (offers || []).filter(o => {
    // Drop offers outside the holiday-length range. This also clears any
    // pre-existing out-of-range offers stored before the nights filter existed,
    // so the fix takes effect on the next sweep rather than over MAX_AGE_DAYS.
    if (!withinNightsRange(o)) return false;
    const td = travelDateOf(o);
    if (td) { const t = Date.parse(td); if (Number.isFinite(t) && t < nowMs) return false; }
    if (o.fetchedAt) { const f = Date.parse(o.fetchedAt); if (Number.isFinite(f) && (nowMs - f) > maxAgeMs) return false; }
    return true;
  });
}
function updateCountryOffers(existingOffers, freshOffers, now = new Date()) {
  return purgeOffers(mergeOffers(existingOffers, freshOffers), now);
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
function buildPayload(row, destinationCode) {
  const f = row.fields || {};
  return {
    appId: f.AppId || DEMO_APP_ID,
    type: 'Packages',
    packageType: 'Any',
    deduping: 'None',
    currency: 'GBP', language: 'en', nationality: 'GB',
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

/** Sweep one country: fire a request per destination code, return fresh normalised offers. */
async function sweepCountry(row) {
  const f = row.fields || {};
  const cc = (f.CountryCode || '').trim();
  const codes = destinationCodesFor(row);
  if (!cc || codes.length === 0) {
    return { cc: cc || '(none)', name: f.Name || '', ok: false, error: 'no country code', codeResults: [], freshOffers: [] };
  }
  const codeResults = await pooled(codes, async (code) => {
    const raw = await callOffersProxy(buildPayload(row, code));
    if (!raw.ok) return { code, ok: false, error: raw.error || `HTTP ${raw.status}`, count: 0, offers: [] };
    const arr = raw.data && Array.isArray(raw.data.data) ? raw.data.data : [];
    const offers = normaliseOffers(arr);
    return { code, ok: true, count: offers.length, offers };
  });
  const freshOffers = codeResults.flatMap(r => r.offers);
  const anyOk = codeResults.some(r => r.ok);
  return {
    cc, name: f.Name || '',
    ok: anyOk,
    codeResults: codeResults.map(({ code, ok, error, count }) => ({ code, ok, error, count })),
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
      all = all.concat(stored.offers);
      // Write a compact per-country resort summary (ALL resorts, cheapest +
      // coords + count each) so the widget can pin every resort, not just the
      // handful in the deals endpoint's cheapest slice.
      const resorts = summariseByResort(stored.offers);
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
      const payload = buildPayload(row, code);
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

    // ── Select the slice to sweep this run ────────────────────────────────
    const full = q.full === '1' || q.full === 'true';
    const { slice, nextCursor } = await selectSlice(rows, full);

    // ── Sweep each country in the slice, store per-country with merge+purge ─
    const now = new Date();
    const perCountry = [];
    for (const row of slice) {
      const swept = await sweepCountry(row);
      if (!swept.cc || swept.cc === '(none)') {
        perCountry.push({ cc: swept.cc, ok: false, error: swept.error, stored: 0 });
        continue;
      }
      if (!swept.ok) {
        // All requests failed — leave the existing key untouched (fail safe).
        perCountry.push({ cc: swept.cc, ok: false, error: 'all requests failed', codeResults: swept.codeResults, stored: 'unchanged' });
        continue;
      }
      const key = countryKey(swept.cc);
      const existing = (await getJson(key)) || { offers: [] };
      const surviving = updateCountryOffers(existing.offers || [], swept.freshOffers, now);
      await setJson(key, { offers: surviving, refreshedAt: now.toISOString() });
      perCountry.push({
        cc: swept.cc, ok: true,
        fetched: swept.freshOffers.length, stored: surviving.length,
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
      sweptCountries: slice.length,
      totalCountries: rows.length,
      summary,
      perCountry,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, durationMs: Date.now() - startedAt });
  }
}
