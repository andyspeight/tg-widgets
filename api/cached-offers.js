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

// Board-basis synonym classes. Travelify labels the SAME board several ways —
// "Bed & Breakfast" normalises to "bedbreakfast", "Breakfast" to "breakfast",
// "Bed and Breakfast" to "bedandbreakfast" — so an exact normBoard match makes a
// "BedAndBreakfast" filter silently drop genuine B&B offers spelled otherwise
// (the CT ribbon's ~41% cache miss, 28 Jul 2026). The widget already folds these
// together for display (boardBasisLabel); the cache filter must fold them the
// same way. Keys are normBoard() output; each maps to one canonical class.
const BOARD_CANON = {
  bedandbreakfast: 'breakfast', bedbreakfast: 'breakfast', breakfast: 'breakfast', breakfastincluded: 'breakfast',
  roomonly: 'roomonly',
  selfcatering: 'selfcatering',
  halfboard: 'halfboard',
  fullboard: 'fullboard',
  allinclusive: 'allinclusive',
  allinclusiveplus: 'allinclusiveplus',
};
const canonBoard = (s) => { const k = normBoard(s); return BOARD_CANON[k] || k; };

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

/**
 * Operator package (one tour operator) vs dynamic package (flight + hotel from
 * two different suppliers). packageType is authoritative; supplier-sid
 * inequality is the fallback for offers Travelify left UNTYPED (packageType
 * null) — a large share of the feed. Identical to the cron's packageKindOf and
 * the widget's own isDynamic test, so a type-specific widget sees the SAME
 * offers whether it is served from the cache or from live Travelify.
 *
 * Why this matters: the read side used to test `packageType === 'DynamicPackages'`
 * literally, which hid every untyped offer from a Dynamic-type widget. A broad
 * "UK to anywhere, dynamic" widget then matched only the tagged minority, kept
 * missing a cache that in fact held the offers, and fell through to slow live
 * Travelify (the 27 Jul 2026 overnight timeouts).
 */
function packageKindOf(o) {
  if (o.packageType === 'DynamicPackages') return 'DynamicPackages';
  if (o.packageType === 'PackageHolidays') return 'PackageHolidays';
  return (Number.isFinite(o.flightSid) && Number.isFinite(o.accommodationSid) && o.flightSid !== o.accommodationSid)
    ? 'DynamicPackages' : 'PackageHolidays';
}

/** Which stored offers satisfy the requested type. */
function typePredicate(requested) {
  const t = String(requested || 'BothPackages');
  if (t === 'Any') return () => true; // "Mixed everything" — every stored type
  if (t === 'Accommodation') return (o) => o.type === 'Accommodation';
  if (t === 'Flights') return (o) => o.type === 'Flights';
  if (t === 'DynamicPackages') return (o) => (o.type || 'Packages') === 'Packages' && packageKindOf(o) === 'DynamicPackages';
  if (t === 'PackageHolidays') return (o) => (o.type || 'Packages') === 'Packages' && packageKindOf(o) === 'PackageHolidays';
  // Packages / BothPackages / anything else → the whole Packages family.
  return (o) => (o.type || 'Packages') === 'Packages';
}

/**
 * Resolve a free-text destination NAME (e.g. "Orlando", "Tenerife") to the
 * cached airports it names, using the summary's own airport index — the same
 * airportName the cron already stores. A whole-word / phrase boundary match so
 * "Orlando" hits "Orlando International Airport" but a fragment can't sneak a
 * false match (the char after must be a non-letter). This self-heals the
 * handful of widgets whose destinations were saved as place names instead of
 * codes, with no migration: an unresolved name is treated as a cache miss by
 * the caller, never as "no filter", so a name can never widen a widget to
 * worldwide offers.
 */
function nameMatchesAirport(airportName, token) {
  const A = String(airportName || '').toUpperCase();
  const T = String(token || '').toUpperCase().trim();
  if (!A || T.length < 2) return false;
  let from = 0;
  for (;;) {
    const idx = A.indexOf(T, from);
    if (idx < 0) return false;
    const before = idx === 0 ? ' ' : A[idx - 1];
    const after = (idx + T.length >= A.length) ? ' ' : A[idx + T.length];
    if (!/[A-Z]/.test(before) && !/[A-Z]/.test(after)) return true;
    from = idx + 1;
  }
}

/** Split destination tokens into 2-3 letter codes and free-text place names.
 *  A token that is neither a clean code nor a plausible place name (letters,
 *  spaces, dots, apostrophes, hyphens) is invalid, and the caller MUST treat an
 *  invalid or unresolved destination as a cache miss — never as "no filter",
 *  which would serve worldwide offers for a widget that asked for one place. */
function parseDestinations(v, cap = 60) {
  const rawTokens = String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const codes = [];
  const names = [];
  let invalid = rawTokens.length > cap;
  for (const tok of rawTokens.slice(0, cap)) {
    const up = tok.toUpperCase();
    if (/^[A-Z]{2,3}$/.test(up)) codes.push(up);
    else if (/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(tok)) names.push(up);
    else invalid = true;
  }
  return { codes, names, invalid };
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
      widgetType: 'Travel Offers',
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
    // Destinations may be 2-3 letter codes OR free-text place names — a name is
    // resolved against the cache's own airport index below (self-heals configs
    // saved as "Orlando" instead of "MCO"). A name that resolves to nothing is
    // an honest miss, never a widened filter.
    const dest = parseDestinations(q.destinations);
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
    const ccs = new Set(dest.codes.filter((s) => s.length === 2));
    const iatas = new Set(dest.codes.filter((s) => s.length === 3));
    // "Destinations were given" if the widget named ANY place — code or name.
    // Kept separate from `iatas`/`ccs` because free-text names are folded into
    // `iatas` only after resolution, and the no-destination "read everything"
    // branch must never fire for a widget that did name a place.
    const hasDestFilter = dest.codes.length > 0 || dest.names.length > 0;
    const origins = new Set(orig.tokens.filter((s) => s.length === 3));
    const originMarkets = new Set(orig.tokens.filter((s) => s.length === 2));
    const hasOriginFilter = orig.tokens.length > 0;
    const boards = new Set(boardsCsv.tokens.map(canonBoard));
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
    // 2-letter tokens name countries directly. 3-letter tokens are airports,
    // and free-text tokens are place NAMES — both resolve against the summary's
    // airport index (airport IATA + its country). A named place resolves to the
    // specific airport IATAs it matches (added to `iatas`, so the per-offer
    // filter stays precise — "Orlando" matches MCO offers, not all of the US),
    // while its country code selects which key to read. If no destinations were
    // given at all, read everything (edge cache absorbs the cost).
    const targetCCs = new Set(ccs);
    if (iatas.size || dest.names.length) {
      const summary = await getJson(SUMMARY_KEY);
      const airports = summary && Array.isArray(summary.airports) ? summary.airports : [];
      for (const a of airports) {
        if (a && iatas.has(String(a.airport || '').toUpperCase()) && a.countryCode) {
          targetCCs.add(String(a.countryCode).toUpperCase());
        }
      }
      // Resolve each free-text name to the airports it names. A name that
      // matches nothing in the cache is an honest miss for the WHOLE query
      // (same rule as an invalid code) — the widget then falls back to live,
      // which resolves free-text names itself. Never widen to "no filter".
      for (const name of dest.names) {
        let resolved = 0;
        for (const a of airports) {
          if (a && a.airport && nameMatchesAirport(a.airportName, name)) {
            iatas.add(String(a.airport).toUpperCase());
            if (a.countryCode) targetCCs.add(String(a.countryCode).toUpperCase());
            resolved++;
          }
        }
        if (!resolved) {
          res.setHeader('Cache-Control', 'no-store');
          return done(200, { success: true, source: 'cache', totalMatched: 0, data: [], unresolvedFilters: true });
        }
      }
    }
    let ccList;
    if (targetCCs.size) {
      ccList = Array.from(targetCCs);
    } else if (!hasDestFilter) {
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
          // is one of the requested IATAs (including those resolved from a
          // free-text place name), or its country one of the requested codes.
          if (hasDestFilter) {
            const apOk = iatas.size && o.airport && iatas.has(String(o.airport).toUpperCase());
            const ccOk = ccs.size && o.countryCode && ccs.has(String(o.countryCode).toUpperCase());
            if (!apOk && !ccOk) continue;
          }
          if (hasOriginFilter) {
            const apOk = origins.size && o.origin && origins.has(String(o.origin).toUpperCase());
            const mkOk = originMarkets.size && originMarkets.has(String(o.market || 'GB').toUpperCase());
            // A hotel-only offer has NO departure airport, so a departure-airport
            // origin filter cannot describe it — gate it on market alone (and let
            // it through when only airports were named). Without this an
            // Accommodation widget with airport origins matched nothing at all,
            // because every hotel lacks o.origin (the 100% miss on the hotel
            // "cards" widgets, 28 Jul 2026). Flight and package offers, which
            // carry a real departure airport, keep the full airport-or-market gate.
            if (!o.origin) {
              if (originMarkets.size && !mkOk) continue;
            } else if (!apOk && !mkOk) {
              continue;
            }
          }
          if (boards.size && !boards.has(canonBoard(o.boardBasis))) continue;
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
