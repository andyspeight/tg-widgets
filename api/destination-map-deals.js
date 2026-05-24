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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method not allowed' }); return; }

  const q = req.query || {};
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
    if (!country && airport) {
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

    const stored = await getJson(countryKey(country));
    let offers = stored && Array.isArray(stored.offers) ? stored.offers.slice() : [];

    // Scope to the airport if one was given.
    if (airport) offers = offers.filter(o => o.airport === airport);

    const total = offers.length;

    // ── Facets (what filter values are actually available for this pin) ──
    const boardSet = new Map(); // normalised → display
    const ratingSet = new Set();
    for (const o of offers) {
      if (o.boardBasis) boardSet.set(normaliseBoard(o.boardBasis), o.boardBasis);
      if (Number.isFinite(o.rating)) ratingSet.add(o.rating);
    }

    // ── Filters ──
    const board = q.board ? normaliseBoard(q.board) : '';
    const minRating = q.minRating ? parseFloat(q.minRating) : null;
    const maxPrice = q.maxPrice ? parseFloat(q.maxPrice) : null;
    const directOnly = q.direct === '1' || q.direct === 'true';

    if (board) offers = offers.filter(o => normaliseBoard(o.boardBasis) === board);
    if (Number.isFinite(minRating)) offers = offers.filter(o => Number.isFinite(o.rating) && o.rating >= minRating);
    if (Number.isFinite(maxPrice)) offers = offers.filter(o => Number.isFinite(o.pricePP ?? o.price) && (o.pricePP ?? o.price) <= maxPrice);
    if (directOnly) offers = offers.filter(o => o.direct);

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
      offers: sliced,
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, error: err.message, offers: [] });
  }
}
