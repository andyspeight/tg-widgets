/**
 * Vercel Cron — refresh world map offers.
 *
 * Schedule: every 45 minutes (configured in vercel.json).
 * That gives ~32 runs/day. The cron iterates MapSearches rows from Airtable,
 * fires Travelify Packages searches in batches of 3, retries any that fail
 * once after 60 seconds, then aggregates the results into a single payload
 * keyed by destination. The payload is written to Redis at `map:offers:v1`
 * ONLY if the success rate clears 90% — partial failures never overwrite a
 * good payload. This is the "never empty" guarantee.
 *
 * Auth: Vercel Cron sends an Authorization header with the value
 * `Bearer ${CRON_SECRET}`. Any unauthenticated call is rejected.
 *
 * Env vars required:
 *  - CRON_SECRET                  Vercel-generated; matches Authorization header
 *  - AIRTABLE_PAT                 Read scope on appAYzWZxvK6qlwXK
 *  - OFFERS_PROXY_URL             (optional) defaults to https://tg-widgets.vercel.app/api/offers
 *  - UPSTASH_REDIS_REST_URL       From shared lib/redis.js
 *  - UPSTASH_REDIS_REST_TOKEN     From shared lib/redis.js
 *  - RESEND_API_KEY               (optional) for failure alerts to Andy
 *  - ALERT_EMAIL_TO               (optional) defaults to andy@travelgenix.io
 *
 * Travelify credentials live on the existing /api/offers proxy and are not
 * needed here. The cron resolves them by sending appId per MapSearches row
 * (default "250" during dev). Switching a client to live creds is purely a
 * data change on the MapSearches row, not a code change here.
 */

import { setJson, setString } from '../_redis.js';

// ── Offer parser (tested against the real Travelify shape, 22 May 2026) ──
// Each raw offer carries its own coords, IATA, country code, price, url, id —
// so the offers drive the grouping, not the search row.
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
    image: (acc.image && acc.image.url) || (flight.image && flight.image.url) || null,
    url: offer.url || null, updated: offer.updated || null, fetchedAt: new Date().toISOString(),
  };
}
function normaliseOffers(rawArray) {
  if (!Array.isArray(rawArray)) return [];
  const out = [];
  for (const o of rawArray) { const n = normaliseOffer(o); if (n) out.push(n); }
  return out;
}
function summariseByAirport(offers) {
  const m = new Map();
  for (const o of offers) {
    if (!o.airport) continue;
    const c = m.get(o.airport);
    if (!c) m.set(o.airport, { airport: o.airport, airportName: o.airportName, countryCode: o.countryCode, lat: o.lat, lng: o.lng, fromPrice: o.price, fromPricePP: o.pricePP, currency: o.currency, offerCount: 1, cheapestOfferId: o.id });
    else { c.offerCount += 1; if (o.price < c.fromPrice) { c.fromPrice = o.price; c.fromPricePP = o.pricePP; c.cheapestOfferId = o.id; } }
  }
  return Array.from(m.values()).sort((a, b) => a.fromPrice - b.fromPrice);
}
function summariseByCountry(offers) {
  const m = new Map();
  for (const o of offers) {
    if (!o.countryCode) continue;
    const c = m.get(o.countryCode);
    if (!c) m.set(o.countryCode, { countryCode: o.countryCode, lat: o.lat, lng: o.lng, fromPrice: o.price, fromPricePP: o.pricePP, currency: o.currency, offerCount: 1, _airports: new Set([o.airport]), cheapestOfferId: o.id });
    else { c.offerCount += 1; c._airports.add(o.airport); if (o.price < c.fromPrice) { c.fromPrice = o.price; c.fromPricePP = o.pricePP; c.lat = o.lat; c.lng = o.lng; c.cheapestOfferId = o.id; } }
  }
  return Array.from(m.values()).map(c => { const { _airports, ...rest } = c; return { ...rest, airportCount: _airports.size }; }).sort((a, b) => a.fromPrice - b.fromPrice);
}


// Airtable base/table for the MapSearches definitions
const AIRTABLE_BASE = 'appAYzWZxvK6qlwXK';
const MAP_SEARCHES_TABLE = 'tblrI1BihuDcpoV1A'; // MapSearches in appAYzWZxvK6qlwXK (seeded 22 May 2026, 46 package destinations)
const DESTINATION_BASE = 'appuZdlMJ7HKUt6qS';
const DESTINATION_TABLE_CITIES = 'tblCitiesAndRegions'; // PLACEHOLDER — confirm at deploy
// (We pull lat/lng + region from the Destination Content base to enrich the cache.)

// The cron calls our own /api/offers proxy rather than Travelify directly.
// The proxy already handles auth (Token AppId:Key), per-client credential
// lookup, the right endpoint (widgetsvc/traveloffers), and error reporting.
// Reusing it means we benefit automatically when issues get fixed there.
const OFFERS_PROXY = process.env.OFFERS_PROXY_URL || 'https://tg-widgets.vercel.app/api/offers';
const DEMO_APP_ID = '250';
const DEFAULT_ORIGIN = 'LGW';
const BATCH_SIZE = 8;
const MIN_SUCCESS_RATE = 0.5; // forgiving for now — a few unrecognised IATA codes shouldn't bin the whole run. Tighten once data is proven clean.
const REDIS_KEY = 'map:offers:v1';
const REDIS_LASTRUN_KEY = 'map:offers:lastRunAt';

// ── helpers ─────────────────────────────────────────────────────────────

async function airtableList(tableId, params = {}) {
  const PAT = process.env.AIRTABLE_PAT;
  if (!PAT) throw new Error('AIRTABLE_PAT not set');
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  if (!res.ok) throw new Error(`Airtable ${tableId} HTTP ${res.status}`);
  return await res.json();
}

async function fetchAllMapSearches() {
  const rows = [];
  let offset;
  do {
    const params = { pageSize: '100', 'filterByFormula': '{Enabled}=TRUE()' };
    if (offset) params.offset = offset;
    const j = await airtableList(MAP_SEARCHES_TABLE, params);
    rows.push(...(j.records || []));
    offset = j.offset;
  } while (offset);
  return rows;
}

function buildOffersPayload(row) {
  const f = row.fields || {};
  // Field shape copied EXACTLY from the working offers widget (_buildPayload):
  //  - 'type' (not 'SearchType'); 'Packages' + packageType:'Any' gets both
  //    dynamic packages AND tour-operator packages.
  //  - 'destinations' is an ARRAY of codes (two-letter country code, or airport
  //    codes for big countries).
  //  - 'origins' is an ARRAY.
  // Hybrid mode: if AirportCodes is filled, search those (comma-separated);
  // otherwise fall back to the two-letter country code in CountryCode.
  const airportCodes = (f.AirportCodes || '').split(',').map(s => s.trim()).filter(Boolean);
  const countryCode = (f.CountryCode || '').trim();
  // Fallback chain so this works both now (current table has DestinationCode)
  // and later (after AirportCodes + CountryCode columns are added):
  //   AirportCodes (comma list) → CountryCode (two-letter) → DestinationCode (legacy single IATA)
  let destinations = [];
  if (airportCodes.length) destinations = airportCodes;
  else if (countryCode) destinations = [countryCode];
  else if (f.DestinationCode) destinations = [String(f.DestinationCode).trim()];

  const payload = {
    appId: f.AppId || DEMO_APP_ID,
    type: 'Packages',
    packageType: 'Any', // both DynamicPackages + PackageHolidays
    deduping: 'None',
    currency: 'GBP',
    language: 'en',
    nationality: 'GB',
    maxOffers: f.MaxOffers || 250,
    rollingDates: true,
    DatesMin: f.DatesMin || 7,
    DatesMax: f.DatesMax || 14,
    sort: 'price:asc',
    pricingByType: 'Person',
    customerUserAgent: 'Travelgenix-WorldMapCron/1.0',
  };
  if (destinations.length) payload.destinations = destinations;
  const origins = (f.Origin || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origins.length) payload.origins = origins;
  return payload;
}

async function callOffersProxy(payload, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OFFERS_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Travelify's auth layer validates Referer/Origin to confirm requests
        // come from a real Travelgenix browser session. This cron is a
        // server-to-server call with no browser context, so the proxy would
        // otherwise forward nothing and Travelify returns 401. We supply a
        // legitimate Travelgenix origin so the proxy passes it upstream.
        'Referer': 'https://tg-widgets.vercel.app/',
        'Origin': 'https://tg-widgets.vercel.app',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    // /api/offers wraps Travelify's response — success field is on the upstream payload
    if (data && data.success === false) return { ok: false, error: data.error || 'upstream failure' };
    return { ok: true, data };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e.message };
  }
}

/** Extract the cheapest offer from a Travelify /traveloffers response.
 *  Shape (from the offers widget's working integration): { offers: [...] } where each
 *  offer has at minimum a price field. Defensive against shape drift. */
function extractCheapest(response) {
  if (!response || !response.data) return null;
  const offers = response.data.offers || response.data.results || response.data.items || [];
  if (!Array.isArray(offers) || offers.length === 0) return null;
  let minPrice = Infinity;
  let currency = 'GBP';
  for (const o of offers) {
    const p = parseFloat(o.priceFrom || o.totalPrice || o.price || o.gross || o.fromPrice || 0);
    if (Number.isFinite(p) && p > 0 && p < minPrice) {
      minPrice = p;
      currency = o.currency || currency;
    }
  }
  if (!Number.isFinite(minPrice)) return null;
  return { fromPrice: Math.floor(minPrice / 10) * 10, currency, offerCount: offers.length };
}

async function processBatch(rows) {
  return Promise.all(rows.map(async (row) => {
    const payload = buildOffersPayload(row);
    const result = await callOffersProxy(payload);
    if (!result.ok) return { row, ok: false, error: result.error || `HTTP ${result.status}` };
    const cheapest = extractCheapest(result);
    if (!cheapest) return { row, ok: false, error: 'no offers in response' };
    return { row, ok: true, ...cheapest };
  }));
}

function aggregateResults(results) {
  const byDestination = new Map();
  for (const r of results) {
    if (!r.ok) continue;
    const f = r.row.fields || {};
    const key = f.DestinationCode || f.Name;
    if (!key) continue;
    const existing = byDestination.get(key);
    if (!existing || r.fromPrice < existing.fromPrice) {
      byDestination.set(key, {
        destination: f.Name || key,
        destinationCode: f.DestinationCode || null,
        country: f.Country || null,
        region: f.Region || null,
        lat: typeof f.Lat === 'number' ? f.Lat : null,
        lng: typeof f.Lng === 'number' ? f.Lng : null,
        fromPrice: r.fromPrice,
        currency: r.currency,
        offerCount: r.offerCount,
        offerType: f.SearchType || 'Packages',
      });
    }
  }
  return Array.from(byDestination.values());
}

function clusterByCountry(destinations) {
  const byCountry = new Map();
  for (const d of destinations) {
    if (!d.country) continue;
    const existing = byCountry.get(d.country);
    if (!existing) {
      byCountry.set(d.country, {
        country: d.country,
        region: d.region,
        lat: d.lat,
        lng: d.lng,
        fromPrice: d.fromPrice,
        currency: d.currency,
        destinationCount: 1,
        totalOffers: d.offerCount,
      });
    } else {
      existing.destinationCount += 1;
      existing.totalOffers += d.offerCount;
      if (d.fromPrice < existing.fromPrice) {
        existing.fromPrice = d.fromPrice;
        existing.lat = d.lat;
        existing.lng = d.lng;
      }
    }
  }
  return Array.from(byCountry.values());
}

async function sendFailureAlert(summary) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const to = process.env.ALERT_EMAIL_TO || 'andy@travelgenix.io';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Travelgenix Monitoring <monitoring@mail.travelgenix.com>',
        to,
        subject: '[World Map] Cron refresh aborted',
        text: `World Map offer refresh aborted at ${new Date().toISOString()}.\n\n${summary}\n\nPrevious payload still serving. Investigate Vercel function logs.`,
      }),
    });
  } catch (e) { console.error('[alert] failed', e.message); }
}

// ── handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Authorise: Vercel Cron sets the Authorization header.
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return res.status(401).json({ ok: false, error: 'unauthorised' });
  }

  const startedAt = Date.now();
  try {
    const rows = await fetchAllMapSearches();
    if (rows.length === 0) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'no enabled rows' });
    }

    // ── DIAGNOSTIC MODE ───────────────────────────────────────────────
    // ?debug=1                    → run first row, return raw response
    // ?debug=1&dest=TFS           → override the destination(s), comma-separated
    // ?debug=1&dest=ES&noOrigin=1 → also drop the origins filter (UK-wide search)
    // No Redis write, no full sweep. TEMPORARY — remove once shape is mapped.
    if (req.query && (req.query.debug === '1' || req.query.debug === 'true')) {
      const row = rows[0];
      const payload = buildOffersPayload(row);
      // Optional destination override
      if (req.query.dest) {
        payload.destinations = String(req.query.dest).split(',').map(s => s.trim()).filter(Boolean);
      }
      // Optional: drop the origins filter to search UK-wide (any departure airport)
      if (req.query.noOrigin === '1' || req.query.noOrigin === 'true') {
        delete payload.origins;
      }
      // Optional maxOffers override
      if (req.query.max) {
        const m = parseInt(req.query.max, 10);
        if (Number.isFinite(m) && m > 0) payload.maxOffers = m;
      }
      const raw = await callOffersProxy(payload);
      const arr = raw.data && Array.isArray(raw.data.data) ? raw.data.data : null;
      const normalised = arr ? normaliseOffers(arr) : [];
      const byAirport = summariseByAirport(normalised);
      const byCountry = summariseByCountry(normalised);
      return res.status(200).json({
        ok: true,
        debug: true,
        sentPayload: payload,
        rawResponseOk: raw.ok,
        rawError: raw.error || null,
        rawOfferCount: arr ? arr.length : null,
        normalisedCount: normalised.length,
        byCountry,                 // envelope pins
        byAirport,                 // fullscreen pins
        sampleOffer: normalised[0] || null,
        rawResponse: (arr && arr.length) ? undefined : raw.data,
      });
    }

    // Pass 1: run all rows in batches of BATCH_SIZE.
    const firstPass = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const out = await processBatch(batch);
      firstPass.push(...out);
    }

    // Pass 2: retry only the failures, after a short pause.
    // NOTE: must stay short — a long sleep inside a serverless function
    // blows the max-duration budget and kills the whole run before it can
    // write to Redis. 2s is enough to let a transient rate-limit settle.
    const failed = firstPass.filter(r => !r.ok).map(r => r.row);
    let retried = [];
    if (failed.length > 0) {
      await new Promise(r => setTimeout(r, 2_000));
      for (let i = 0; i < failed.length; i += BATCH_SIZE) {
        const batch = failed.slice(i, i + BATCH_SIZE);
        const out = await processBatch(batch);
        retried.push(...out);
      }
    }

    // Merge: take pass-1 successes, plus pass-2 results (which override their pass-1 failures)
    const finalById = new Map();
    for (const r of firstPass) if (r.ok) finalById.set(r.row.id, r);
    for (const r of retried) finalById.set(r.row.id, r);
    const finalResults = Array.from(finalById.values());

    const successes = finalResults.filter(r => r.ok).length;
    const total = rows.length;
    const successRate = successes / total;

    if (successRate < MIN_SUCCESS_RATE) {
      await sendFailureAlert(
        `Success rate ${(successRate * 100).toFixed(1)}% (${successes}/${total}). Threshold ${MIN_SUCCESS_RATE * 100}%.`
      );
      const failures = finalResults
        .filter(r => !r.ok)
        .map(r => ({ dest: (r.row.fields || {}).DestinationCode || (r.row.fields || {}).Name, error: r.error }));
      return res.status(200).json({
        ok: false,
        aborted: true,
        successes, total, successRate,
        failures,
        durationMs: Date.now() - startedAt,
      });
    }

    // Aggregate and write atomically.
    const destinations = aggregateResults(finalResults);
    const countries = clusterByCountry(destinations);
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      origin: DEFAULT_ORIGIN,
      destinations,
      countries,
      stats: { searchesRun: total, searchesSucceeded: successes, destinationsCovered: destinations.length },
    };

    const writeOk = await setJson(REDIS_KEY, payload);
    if (writeOk) await setString(REDIS_LASTRUN_KEY, payload.generatedAt);

    const failures = finalResults
      .filter(r => !r.ok)
      .map(r => ({ dest: (r.row.fields || {}).DestinationCode || (r.row.fields || {}).Name, error: r.error }));

    return res.status(200).json({
      ok: true,
      written: writeOk,
      successes, total, successRate,
      destinationsCovered: destinations.length,
      countriesCovered: countries.length,
      failures,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    console.error('[cron] fatal', e);
    await sendFailureAlert(`Fatal error: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
