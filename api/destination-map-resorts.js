/**
 * Public widget endpoint — World Map RESORTS (per-country resort summary).
 *
 * The deals endpoint (/api/destination-map-deals) returns the cheapest slice of
 * actual offers (capped) behind a pin — great for the deal cards, but it means
 * a country with 1,200+ offers only surfaces the handful of resorts that happen
 * to be in the cheapest slice.
 *
 * THIS endpoint returns the COMPLETE list of distinct resorts for a country —
 * each with its cheapest price, coordinates and offer count — aggregated by the
 * cron from ALL stored offers and written to Redis (map:resorts:{CC}). It lets
 * the fullscreen map pin EVERY resort, not just the cheapest few.
 *
 * QUERY PARAMS
 *   country=GR   → two-letter country code (required)
 *
 * RESPONSE
 *   { ok, country, count, currency, refreshedAt,
 *     resorts:[ { resort, lat, lng, fromPrice, fromPricePP, currency, offerCount } ] }
 *
 * CACHING
 *   Real data → short edge cache. Empty/error → no-store (never cache a miss).
 *
 * CORS: open, read-only public data, no secrets.
 */

import { getJson } from './_redis.js';

const resortsKey = (cc) => `map:resorts:${cc}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method not allowed' }); return; }

  const q = req.query || {};
  const country = q.country ? String(q.country).trim().toUpperCase() : '';

  if (!country) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ ok: false, error: 'country required', resorts: [] });
    return;
  }

  try {
    const stored = await getJson(resortsKey(country));
    const resorts = stored && Array.isArray(stored.resorts) ? stored.resorts : [];

    if (resorts.length === 0) {
      // No aggregated resorts yet for this country. Don't cache a miss.
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.status(200).json({ ok: true, country, count: 0, resorts: [] });
      return;
    }

    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    res.status(200).json({
      ok: true,
      country,
      count: resorts.length,
      currency: (resorts[0] && resorts[0].currency) || 'GBP',
      refreshedAt: stored ? stored.refreshedAt : null,
      resorts,
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, error: err.message, resorts: [] });
  }
}
