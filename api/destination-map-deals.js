/**
 * Public widget endpoint — World Map DEALS (per-airport / per-country offers).
 *
 * The summary endpoint (/api/destination-map-offers) returns one cheapest price
 * per country/airport for the map pins. THIS endpoint returns the actual list of
 * offers behind a pin, with all the per-offer detail the deal cards need
 * (hotel, image, board basis, rating, nights, carrier, dates, booking URL).
 *
 * It reads the per-country raw offers the cron already stores in Redis
 * (offers:packages:{CC}) — no extra storage, no Travelify round-trip.
 *
 * QUERY PARAMS
 *   airport=AGA           → offers departing into that airport (IATA). Preferred.
 *   country=MA            → all offers for that two-letter country code.
 *   (one of airport/country is required)
 *
 *   FILTERS (all optional, applied server-side):
 *     board=AllInclusive        → exact boardBasis match (case-insensitive)
 *     minRating=4               → hotel star rating >= N
 *     maxPrice=500              → per-person price <= N
 *     direct=1                  → direct flights only
 *     sort=price|rating|nights  → default price (ascending; rating/nights descending)
 *     limit=40                  → cap results (default 60, max 200)
 *
 * RESPONSE
 *   { ok, scope:{airport|country}, count, total, currency,
 *     boardBases:[...], ratings:[...],   // facets available for this pin (for filter UI)
 *     offers:[ {...card fields...} ] }
 *
 * CACHING
 *   Real data → short edge cache. Empty/error → no-store (never cache a miss).
 *
 * CORS: open, read-only public data, no secrets.
 */

import { getJson } from './_redis.js';

const countryKey = (cc) => `offers:packages:${cc}`;
// Hotels mode (?mode=hotels) reads the accommodation cache and returns hotel
// cards instead of package deals. Same offer shape, no flight leg.
const extraKey = (cc) => `offers:extra:${cc}`;

// Map an airport IATA to its country code via the stored offers themselves
// (every offer carries countryCode), so we don't need a separate lookup table.
// But to find the right Redis key from an airport alone, we need the country.
// The summary key carries the airport→country mapping cheaply.
const SUMMARY_KEY = 'map:offers:v1';

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function normaliseBoard(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Dynamic package (flight + hotel from two different suppliers) vs operator
// package (one tour operator). packageType is authoritative; sid inequality is
// the fallback. Mirrors the widget/admin classifier.
function isDynamicPackage(o) {
  if (o.packageType === 'DynamicPackages') return true;
  if (o.packageType === 'PackageHolidays') return false;
  return Number.isFinite(o.flightSid) && Number.isFinite(o.accommodationSid) && o.flightSid !== o.accommodationSid;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method not allowed' }); return; }

  const q = req.query || {};
  const hotels = String(q.mode || '') === 'hotels';
  const airport = q.airport ? String(q.airport).trim().toUpperCase() : '';
  let country = q.country ? String(q.country).trim().toUpperCase() : '';

  if (!airport && !country) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ ok: false, error: 'airport or country required' });
    return;
  }

  try {
    // Resolve the country code we need to load. If only an airport was given,
    // find its country from the summary's airports[] (cheap, already in Redis).
    // Hotels have no flight gateway, so airport resolution is packages-only.
    if (!country && airport && !hotels) {
      const summary = await getJson(SUMMARY_KEY);
      const ap = summary && Array.isArray(summary.airports)
        ? summary.airports.find(a => a.airport === airport) : null;
      if (ap && ap.countryCode) country = ap.countryCode;
    }

    if (!country) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).json({ ok: false, error: 'could not resolve country for that airport', offers: [] });
      return;
    }

    // Hotels mode reads the accommodation cache; holidays read the packages key.
    const stored = await getJson(hotels ? extraKey(country) : countryKey(country));
    let offers = stored && Array.isArray(stored.offers) ? stored.offers.slice() : [];

    // Scope to this mode's type. The country/extra keys hold multiple types
    // (swept for the offer-box widgets); keep only Accommodation (hotels) or
    // Packages (holidays).
    offers = hotels
      ? offers.filter(o => o.type === 'Accommodation')
      : offers.filter(o => (o.type || 'Packages') === 'Packages');

    // Scope to the airport if one was given (packages only — hotels have none).
    if (airport && !hotels) offers = offers.filter(o => o.airport === airport);

    // Per-client operator whitelist, applied BEFORE the cheapest-N cut so an
    // enabled operator's packages surface instead of being squeezed out of the
    // fetched slice by non-enabled ones. The widget passes its enabled Packages
    // operator ids as ?pkgSuppliers=110,61,123. Dynamic packages have no single
    // operator and always show (mirrors the widget filter); empty/absent list =
    // show all. The widget still re-applies its own filter, so this is a safe
    // pre-filter that only ever tightens the cheapest-N to what the client sees.
    const pkgSuppliers = String(q.pkgSuppliers || '')
      .split(',').map(s => parseInt(s, 10)).filter(Number.isFinite).slice(0, 200);
    if (pkgSuppliers.length && !hotels) {
      offers = offers.filter(o => {
        if (isDynamicPackage(o)) return true;
        const sid = Number.isFinite(o.flightSid) ? o.flightSid
          : (Number.isFinite(o.accommodationSid) ? o.accommodationSid : null);
        return sid == null ? true : pkgSuppliers.includes(sid);
      });
    }

    const total = offers.length;

    // ── Facets (what filter values are actually available for this pin) ──
    const boardSet = new Map(); // normalised → display
    const ratingSet = new Set();
    const nightsSet = new Set();
    for (const o of offers) {
      if (o.boardBasis) boardSet.set(normaliseBoard(o.boardBasis), o.boardBasis);
      if (Number.isFinite(o.rating)) ratingSet.add(o.rating);
      if (Number.isFinite(o.nights)) nightsSet.add(o.nights);
    }

    // ── Filters ──
    const board = q.board ? normaliseBoard(q.board) : '';
    const minRating = q.minRating ? parseFloat(q.minRating) : null;
    const maxPrice = q.maxPrice ? parseFloat(q.maxPrice) : null;
    const directOnly = q.direct === '1' || q.direct === 'true';
    const nights = q.nights ? parseInt(q.nights, 10) : null;

    if (board) offers = offers.filter(o => normaliseBoard(o.boardBasis) === board);
    if (Number.isFinite(minRating)) offers = offers.filter(o => Number.isFinite(o.rating) && o.rating >= minRating);
    if (Number.isFinite(maxPrice)) offers = offers.filter(o => Number.isFinite(o.pricePP ?? o.price) && (o.pricePP ?? o.price) <= maxPrice);
    if (directOnly && !hotels) offers = offers.filter(o => o.direct);
    if (Number.isFinite(nights)) offers = offers.filter(o => o.nights === nights);

    // ── Sort ──
    const sort = String(q.sort || 'price');
    const pp = o => (Number.isFinite(o.pricePP) ? o.pricePP : o.price);
    if (sort === 'rating') offers.sort((a, b) => (b.rating || 0) - (a.rating || 0) || pp(a) - pp(b));
    else if (sort === 'nights') offers.sort((a, b) => (b.nights || 0) - (a.nights || 0) || pp(a) - pp(b));
    else offers.sort((a, b) => pp(a) - pp(b)); // price asc (default)

    const limit = clampInt(q.limit, 60, 1, 200);
    const sliced = offers.slice(0, limit);

    if (total === 0) {
      // Pin has no stored offers (yet). Don't cache a miss.
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    }

    res.status(200).json({
      ok: true,
      scope: airport ? { airport, country } : { country },
      count: sliced.length,
      total,
      filtered: offers.length,
      currency: (sliced[0] && sliced[0].currency) || 'GBP',
      refreshedAt: stored ? stored.refreshedAt : null,
      // Facets for the filter UI — only what's actually available behind this pin.
      boardBases: Array.from(boardSet.values()).sort(),
      ratings: Array.from(ratingSet).sort((a, b) => b - a),
      nightsOptions: Array.from(nightsSet).sort((a, b) => a - b),
      offers: sliced,
    });
  } catch (err) {
    // Log the real error server-side; return a generic message so this public
    // endpoint never leaks internal implementation detail (23 Jul 2026 audit).
    console.error('[destination-map-deals]', err && err.message);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, error: 'Deals are temporarily unavailable', offers: [] });
  }
}
