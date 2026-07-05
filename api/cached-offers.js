/**
 * GET /api/cached-offers
 *
 * Serves the OFFER-BOX widgets from the Travelgenix offer cache in Redis —
 * the pool the refresh-map-offers cron builds up from Travelify in
 * 250-offer increments (per destination × market × type). Locked decision
 * 2 Jul 2026: offer boxes read this cache, not live Travelify; the widget
 * falls back to the live proxy only when the cache has nothing matching.
 *
 * Query params (all optional):
 *   type          Accommodation | Flights | Packages | DynamicPackages |
 *                 PackageHolidays | BothPackages   (default Packages family)
 *   destinations  CSV of 3-letter airport IATA and/or 2-letter country codes
 *   origins       CSV of departure-airport IATA codes
 *   boardBases    CSV of board names (matched loosely: case/punctuation-blind)
 *   budgetMin, budgetMax   per-person GBP bounds
 *   ratingMin     minimum hotel star rating
 *   durationMin, durationMax   nights bounds (stay types only)
 *   DatesMin, DatesMax   departure window in days from today
 *   sort          price:asc (default) | price:desc
 *   maxOffers     1..500 (default 100)
 *
 * Response mirrors /api/offers: { success, data: [...] } — data entries are
 * rebuilt into the raw Travelify shape the widget renderer already reads
 * (the exact reverse of the cron's normaliseOffer field mapping), plus:
 *   totalMatched  the TRUE number of cached offers matching the filters
 *                 (before maxOffers slicing) — this is the availability count
 *   source        'cache'
 *
 * Public + CORS * (widgets run on client sites), edge-cached briefly.
 */

import { setCors } from './_auth.js';
import { getJson, keys, configured } from './_redis.js';
import { evaluatePublicRateLimit } from './_lib/rate-limit-public.js';
import { logWidgetEvent } from './_lib/telemetry.js';

const COUNTRY_PREFIX = 'offers:packages:';
const SUMMARY_KEY = 'map:offers:v1';
const countryKey = (cc) => `${COUNTRY_PREFIX}${cc}`;
// Accommodation-only and flight-only offers live in a second key per country
// (see the cron's storeCountryOffers) so the packages key the world map reads
// keeps its exact product. This endpoint reads both.
const extraCountryKey = (cc) => `offers:extra:${cc}`;

const MAX_OFFERS_CAP = 500;
const DEFAULT_MAX = 100;

/** Parse a CSV param, validating every token. Returns { tokens, invalid } —
 *  callers MUST treat invalid tokens as a cache miss, never as "no filter":
 *  silently dropping a filter token would serve wrong offers with
 *  totalMatched > 0 and the widget's live fallback would never fire. */
const csv = (v, re, cap = 60) => {
  const rawTokens = String(v || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return {
    tokens: rawTokens.filter((s) => re.test(s)).slice(0, cap),
    invalid: rawTokens.some((s) => !re.test(s)) || rawTokens.length > cap,
  };
};

const normBoard = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// Serve-time stale guard — the same expiry rules the cron purges on (past
// travel date, or fetched more than 70 hours ago; keep in step with the
// cron's MAX_AGE_HOURS). The cron deletes stale offers on its own cadence,
// but nothing stale may ever reach a client page even if the cron stalls,
// so the read side enforces the rules independently.
const STALE_AGE_MS = 70 * 60 * 60 * 1000;
function isServable(o, nowMs) {
  const td = Date.parse(o.outboundDate || o.checkinDate || '');
  if (Number.isFinite(td) && td < nowMs) return false;
  if (o.fetchedAt) {
    const f = Date.parse(o.fetchedAt);
    if (Number.isFinite(f) && (nowMs - f) > STALE_AGE_MS) return false;
  }
  return true;
}

/** Which stored offers satisfy the requested type. */
function typePredicate(requested) {
  const t = String(requested || 'BothPackages');
  if (t === 'Any') return () => true; // "Mixed everything" — every stored type
  if (t === 'Accommodation') return (o) => o.type === 'Accommodation';
  if (t === 'Flights') return (o) => o.type === 'Flights';
  if (t === 'DynamicPackages') return (o) => (o.type || 'Packages') === 'Packages' && o.packageType === 'DynamicPackages';
  if (t === 'PackageHolidays') return (o) => (o.type || 'Packages') === 'Packages' && o.packageType === 'PackageHolidays';
  // Packages / BothPackages / anything else → the whole Packages family.
  return (o) => (o.type || 'Packages') === 'Packages';
}

/** GBP display string in the shape Travelify uses (whole pounds). */
const gbp = (n) => (Number.isFinite(n) ? '£' + Math.round(n).toLocaleString('en-GB') : null);

/**
 * Rebuild the raw Travelify offer shape from a cached normalised offer —
 * the exact inverse of normaliseOffer in api/cron/refresh-map-offers.js.
 * Every field here is one that normaliseOffer originally read from the raw
 * offer, so the paths are provably the ones the widget knows.
 */
function toRawShape(o) {
  const hasFlight = !!(o.origin || o.airport || o.carrier || o.outboundDate);
  const raw = {
    id: o.id,
    type: o.type === 'Packages' ? 'Packages' : o.type,
    url: o.url || null,
    updated: o.updated || null,
  };
  if (o.packageType) raw.packageType = o.packageType;
  if (Number.isFinite(o.price)) raw.formattedPrice = gbp(o.price);
  if (Number.isFinite(o.pricePP)) raw.formattedPPPrice = gbp(o.pricePP);
  // Party size — drives the "Based on N adults sharing" caption and the
  // per-person derivations.
  if (Number.isFinite(o.adults)) raw.adults = o.adults;
  if (Number.isFinite(o.children)) raw.children = o.children;
  if (Number.isFinite(o.infants)) raw.infants = o.infants;
  // Was-price / lead-in flags travel on the pricing blocks — the widget reads
  // them for the strike-through price and discount badges. Only emit the
  // was-price when it exceeds the price we're serving: the stored
  // priceBeforeChange can be a component-level figure, and a "was £150" strike
  // next to a £1,240 total would be nonsense.
  const showWas = o.priceChanged && Number.isFinite(o.priceBeforeChange)
    && Number.isFinite(o.price) && o.priceBeforeChange > o.price;
  const pricing = {
    price: o.price,
    currency: o.currency || 'GBP',
    ...(showWas ? { priceChanged: true, priceBeforeChange: o.priceBeforeChange } : {}),
    ...(o.isLeadIn ? { isLeadIn: true } : {}),
    ...(o.refundability ? { refundability: o.refundability } : {}),
  };
  if (hasFlight) {
    raw.flight = {
      // Supplier id (Travelify sid) — carried through for the per-client
      // supplier filter the widget applies. Null on offers cached before the
      // feed added sids.
      sid: Number.isFinite(o.flightSid) ? o.flightSid : null,
      origin: o.origin ? { iataCode: o.origin, name: o.originName || null } : null,
      destination: {
        iataCode: o.airport || null,
        name: o.airportName || null,
        countryCode: o.countryCode || null,
        latitude: o.lat, longitude: o.lng,
      },
      carrier: (o.carrier || o.carrierCode) ? { name: o.carrier || null, code: o.carrierCode || null } : null,
      direct: !!o.direct,
      stops: o.stops,
      duration: o.duration,
      cabinClass: o.cabinClass || null,
      flightNumber: o.flightNumber || null,
      outboundDate: o.outboundDate || null,
      returnDate: o.returnDate || null,
      arrivalDate: o.arrivalDate || null,
      image: o.image && !o.hotel ? { url: o.image } : null,
      pricing,
    };
  }
  if (o.hotel || o.resort || Number.isFinite(o.nights)) {
    raw.accommodation = {
      name: o.hotel || null,
      rating: o.rating,
      boardBasis: o.boardBasis || null,
      nights: o.nights,
      reviewRating: o.reviewRating,
      reviewCount: o.reviewCount,
      checkinDate: o.checkinDate || null,
      propertyType: o.propertyType || null,
      chain: o.chain || null,
      // Supplier id (Travelify sid) for the per-client supplier filter.
      sid: Number.isFinite(o.accommodationSid) ? o.accommodationSid : null,
      // uniqueRef pins the exact property for the offer deeplink (&refn=).
      // Only present on accommodation and package-accommodation offers.
      uniqueRef: o.accommodationUniqueRef || null,
      // Operator name + message drive the operator strip and the ATOL badge
      // (compliance-relevant), so they're stored and rebuilt.
      operator: (o.operatorName || o.operatorMessage)
        ? { name: o.operatorName || null, message: o.operatorMessage || null }
        : null,
      image: o.image ? { url: o.image } : null,
      destination: {
        name: o.resort || null,
        countryCode: o.countryCode || null,
        latitude: o.resortLat, longitude: o.resortLng,
      },
      pricing,
    };
  }
  raw._cache = { market: o.market || 'GB', fetchedAt: o.fetchedAt || null };
  return raw;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'GET only' });
  }

  const startedAt = Date.now();
  const q = req.query || {};
  const widgetId = q.widgetId ? String(q.widgetId).slice(0, 120) : '';

  // Send the response then log telemetry (after the bytes are flushed, so no
  // client-visible latency). cacheHit reflects whether the cache actually
  // served offers — a 0-match result is effectively a miss that makes the
  // widget fall back to the live proxy. Never throws.
  async function done(status, jsonBody) {
    res.status(status).json(jsonBody);
    await logWidgetEvent(req, {
      event: 'cached-offers',
      widgetId,
      status,
      cacheHit: status === 200 ? (Number(jsonBody?.totalMatched) > 0) : null,
      latencyMs: Date.now() - startedAt,
    });
  }

  // Rate limit (cross-instance, fail-open). Cheap Redis reads, but still
  // throttled so the cache can't be hammered as a scraping surface.
  const rl = await evaluatePublicRateLimit(req, res, { event: 'cached-offers', widgetId });
  if (!rl.allowed) {
    return done(429, {
      success: false,
      error: `Too many requests. Please retry in ${rl.retryAfter} second${rl.retryAfter === 1 ? '' : 's'}.`,
    });
  }

  if (!configured()) {
    // No Redis in this deploy — tell the widget honestly so it falls back to live.
    res.setHeader('Cache-Control', 'no-store');
    return done(200, { success: true, source: 'cache', totalMatched: 0, data: [] });
  }

  try {
    const dest = csv(q.destinations, /^[A-Z]{2,3}$/);
    // Origins accept 3-letter airport IATAs AND 2-letter country codes (the
    // editor documents both and its presets use 'GB'). Country origins map to
    // the sweep market: GB-market offers depart UK airports, IE-market
    // offers depart Irish airports.
    const orig = csv(q.origins, /^[A-Z]{2,3}$/);
    const boardsCsv = csv(q.boardBases, /^[A-Z]/i, 12);
    // Any filter token we cannot faithfully apply → honest miss (the widget
    // then falls back to live Travelify, which resolves free-text names).
    if (dest.invalid || orig.invalid || boardsCsv.invalid) {
      res.setHeader('Cache-Control', 'no-store');
      return done(200, { success: true, source: 'cache', totalMatched: 0, data: [], unresolvedFilters: true });
    }
    const destTokens = dest.tokens;
    const ccs = new Set(destTokens.filter((s) => s.length === 2));
    const iatas = new Set(destTokens.filter((s) => s.length === 3));
    const origins = new Set(orig.tokens.filter((s) => s.length === 3));
    const originMarkets = new Set(orig.tokens.filter((s) => s.length === 2));
    const hasOriginFilter = orig.tokens.length > 0;
    const boards = new Set(boardsCsv.tokens.map(normBoard));
    const cabinsCsv = csv(q.cabinClasses, /^[A-Z]/i, 8);
    if (cabinsCsv.invalid) {
      res.setHeader('Cache-Control', 'no-store');
      return done(200, { success: true, source: 'cache', totalMatched: 0, data: [], unresolvedFilters: true });
    }
    const cabins = new Set(cabinsCsv.tokens.map(normBoard)); // same loose normaliser

    const budgetMin = num(q.budgetMin);
    const budgetMax = num(q.budgetMax);
    const ratingMin = num(q.ratingMin);
    const durationMin = num(q.durationMin);
    const durationMax = num(q.durationMax);
    const datesMin = num(q.DatesMin);
    const datesMax = num(q.DatesMax);
    const sortDesc = String(q.sort || '') === 'price:desc';
    const maxOffers = Math.min(MAX_OFFERS_CAP, Math.max(1, num(q.maxOffers) || DEFAULT_MAX));
    const matchesType = typePredicate(q.type);

    // ── Which country keys to read ─────────────────────────────────────────
    // 2-letter tokens name countries directly. 3-letter tokens are airports —
    // resolve them to countries via the summary's airport index. If no
    // destinations were given, read everything (edge cache absorbs the cost).
    const targetCCs = new Set(ccs);
    if (iatas.size) {
      const summary = await getJson(SUMMARY_KEY);
      const airports = summary && Array.isArray(summary.airports) ? summary.airports : [];
      for (const a of airports) {
        if (a && iatas.has(String(a.airport || '').toUpperCase()) && a.countryCode) {
          targetCCs.add(String(a.countryCode).toUpperCase());
        }
      }
    }
    let ccList;
    if (targetCCs.size) {
      ccList = Array.from(targetCCs);
    } else if (!destTokens.length) {
      ccList = (await keys(`${COUNTRY_PREFIX}*`))
        .map((k) => String(k).slice(COUNTRY_PREFIX.length).toUpperCase())
        .filter((cc) => /^[A-Z]{2}$/.test(cc));
    } else {
      ccList = []; // destinations were given but none resolved — no matches
    }

    // ── Load + filter ───────────────────────────────────────────────────────
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const windowMin = datesMin != null ? now + datesMin * dayMs : null;
    const windowMax = datesMax != null ? now + datesMax * dayMs : null;
    const isFlights = String(q.type || '') === 'Flights';

    const matched = [];
    let newestRefresh = null;

    // Bounded concurrency over the country keys (same idiom as the cron).
    let i = 0;
    const workers = Array.from({ length: Math.min(8, ccList.length || 1) }, async () => {
      while (i < ccList.length) {
        const cc = ccList[i++];
        const [packagesStored, extraStored] = await Promise.all([
          getJson(countryKey(cc)),
          getJson(extraCountryKey(cc)),
        ]);
        const pools = [packagesStored, extraStored].filter(s => s && Array.isArray(s.offers));
        if (!pools.length) continue;
        for (const s of pools) {
          if (s.refreshedAt && (!newestRefresh || s.refreshedAt > newestRefresh)) newestRefresh = s.refreshedAt;
        }
        const allOffers = pools.length === 1 ? pools[0].offers : pools[0].offers.concat(pools[1].offers);
        for (const o of allOffers) {
          if (!o || !matchesType(o)) continue;
          if (!isServable(o, now)) continue;
          // Destination semantics: an offer matches when its arrival airport
          // is one of the requested IATAs, or its country one of the codes.
          if (destTokens.length) {
            const apOk = iatas.size && o.airport && iatas.has(String(o.airport).toUpperCase());
            const ccOk = ccs.size && o.countryCode && ccs.has(String(o.countryCode).toUpperCase());
            if (!apOk && !ccOk) continue;
          }
          if (hasOriginFilter) {
            const apOk = origins.size && o.origin && origins.has(String(o.origin).toUpperCase());
            const mkOk = originMarkets.size && originMarkets.has(String(o.market || 'GB').toUpperCase());
            if (!apOk && !mkOk) continue;
          }
          if (boards.size && !boards.has(normBoard(o.boardBasis))) continue;
          if (cabins.size && !cabins.has(normBoard(o.cabinClass))) continue;
          const pp = Number.isFinite(o.pricePP) ? o.pricePP : o.price;
          if (budgetMin != null && !(Number.isFinite(pp) && pp >= budgetMin)) continue;
          if (budgetMax != null && !(Number.isFinite(pp) && pp <= budgetMax)) continue;
          if (ratingMin != null && ratingMin > 0 && !(Number.isFinite(o.rating) && o.rating >= ratingMin)) continue;
          if (!isFlights) {
            if (durationMin != null && durationMin > 0 && !(Number.isFinite(o.nights) && o.nights >= durationMin)) continue;
            if (durationMax != null && durationMax > 0 && !(Number.isFinite(o.nights) && o.nights <= durationMax)) continue;
          }
          if (windowMin != null || windowMax != null) {
            const td = Date.parse(o.outboundDate || o.checkinDate || '');
            if (!Number.isFinite(td)) continue;
            if (windowMin != null && td < windowMin) continue;
            if (windowMax != null && td > windowMax) continue;
          }
          matched.push(o);
        }
      }
    });
    await Promise.all(workers);

    // Dedupe (same composite key the cron merges on), sort, slice.
    const seen = new Set();
    const unique = [];
    for (const o of matched) {
      const k = `${o.id}|${o.origin || ''}|${o.type || 'Packages'}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(o);
    }
    const price = (o) => (Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : Infinity));
    unique.sort((a, b) => (sortDesc ? price(b) - price(a) : price(a) - price(b)));
    const sliced = unique.slice(0, maxOffers);

    res.setHeader('Cache-Control', unique.length
      ? 'public, s-maxage=120, stale-while-revalidate=300'
      : 'no-store'); // never edge-cache a miss — the cache may be mid-fill
    return done(200, {
      success: true,
      source: 'cache',
      totalMatched: unique.length,
      refreshedAt: newestRefresh,
      data: sliced.map(toRawShape),
    });
  } catch (err) {
    console.error('[cached-offers] failed:', err?.message);
    // Fail soft with an empty result — the widget treats this as a miss and
    // falls back to the live proxy, so visitors always see offers.
    res.setHeader('Cache-Control', 'no-store');
    return done(200, { success: true, source: 'cache', totalMatched: 0, data: [], degraded: true });
  }
}
