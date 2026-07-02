/**
 * /api/admin/map-cache
 *
 * Inspect and manage the World Map offer cache in Redis — the Cache tab on
 * the admin dashboard. This is the "look inside the tin" companion to
 * map-destinations (which manages what gets polled): it reads the ACTUAL
 * stored offers, per country, straight from the store the cron writes.
 *
 * Storage being inspected (written by api/cron/refresh-map-offers.js):
 *   offers:packages:{CC}   per-country normalised offers + refreshedAt
 *   map:resorts:{CC}       per-country resort summary
 *   map:offers:v1          derived summary the widget reads
 *   map:offers:lastRunAt   last successful summary write
 *
 * Methods (all admin-gated):
 *   GET               → overview: every stored country key with its offer
 *                       count and refreshedAt, plus the summary's stats.
 *   GET ?country=XX   → that country's stored offers, sorted cheapest-first
 *                       (per person), sliced by ?offset / ?limit (default
 *                       200, max 500) so a big country can't flood the page.
 *   DELETE {country}  → purge one country's cached offers + resorts keys.
 *                       The map summary still lists the country until the
 *                       next rebuild — the UI triggers one straight after.
 *
 * Security: requireAdmin (same gate as the other map admin routes); no '*'
 * CORS; no-store. Reads only Redis — Airtable is not touched here.
 */

import { requireAdmin, setAdminCors } from './_guard.js';
import { getJson, getString, del, keys, configured } from '../_redis.js';

const COUNTRY_PREFIX = 'offers:packages:';
const SUMMARY_KEY = 'map:offers:v1';
const LASTRUN_KEY = 'map:offers:lastRunAt';
const countryKey = (cc) => `${COUNTRY_PREFIX}${cc}`;
const resortsKey = (cc) => `map:resorts:${cc}`;

const CC_RE = /^[A-Z]{2}$/;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/** Sort offers cheapest-first by per-person price, total price as fallback,
 *  unpriced last. Stable enough for an inspector view. */
function byCheapest(a, b) {
  const ap = Number.isFinite(a.pricePP) ? a.pricePP : (Number.isFinite(a.price) ? a.price : Infinity);
  const bp = Number.isFinite(b.pricePP) ? b.pricePP : (Number.isFinite(b.price) ? b.price : Infinity);
  return ap - bp;
}

/** Run async worker over items with bounded concurrency (same idiom as the cron). */
async function pooled(items, worker, concurrency = 8) {
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

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ ok: false, error: gate.error });

  if (!configured()) {
    return res.status(200).json({ ok: true, redisConfigured: false, countries: [], summary: null, lastRunAt: null });
  }

  try {
    // ── DELETE: purge one country's cache ─────────────────────────────────
    if (req.method === 'DELETE') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return res.status(400).json({ ok: false, error: 'Body must be JSON' });
      }
      const cc = String(body.country || '').toUpperCase().trim();
      if (!CC_RE.test(cc)) return res.status(400).json({ ok: false, error: 'country must be a 2-letter code' });
      const removedOffers = await del(countryKey(cc));
      await del(resortsKey(cc));
      return res.status(200).json({
        ok: true,
        country: cc,
        purged: removedOffers === 1,
        note: 'Summary rebuild needed for the map to reflect the purge.',
      });
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'GET or DELETE only' });
    }

    const q = req.query || {};

    // ── GET ?country=XX: one country's stored offers ──────────────────────
    // Optional ?origins=LGW,DUB filters by DEPARTURE airport before sorting
    // and slicing, so the filter sees the whole stored set, not just the
    // first page.
    if (q.country) {
      const cc = String(q.country).toUpperCase().trim();
      if (!CC_RE.test(cc)) return res.status(400).json({ ok: false, error: 'country must be a 2-letter code' });
      const stored = await getJson(countryKey(cc));
      if (!stored || !Array.isArray(stored.offers)) {
        return res.status(200).json({ ok: true, country: cc, exists: false, count: 0, offers: [] });
      }
      const origins = String(q.origins || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{3}$/.test(s))
        .slice(0, 30);
      const originSet = origins.length ? new Set(origins) : null;
      const offset = Math.max(0, parseInt(q.offset, 10) || 0);
      const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit, 10) || DEFAULT_LIMIT));
      const pool = originSet
        ? stored.offers.filter((o) => o && originSet.has(String(o.origin || '').toUpperCase()))
        : stored.offers;
      const sorted = pool.slice().sort(byCheapest);
      return res.status(200).json({
        ok: true,
        country: cc,
        exists: true,
        refreshedAt: stored.refreshedAt || null,
        totalStored: stored.offers.length,
        appliedOrigins: origins,
        count: sorted.length,
        offset,
        limit,
        offers: sorted.slice(offset, offset + limit),
      });
    }

    // ── GET: overview of every stored country key ─────────────────────────
    const [allKeys, summary, lastRunAt] = await Promise.all([
      keys(`${COUNTRY_PREFIX}*`),
      getJson(SUMMARY_KEY),
      getString(LASTRUN_KEY),
    ]);

    const ccs = allKeys
      .map((k) => String(k).slice(COUNTRY_PREFIX.length).toUpperCase())
      .filter((cc) => CC_RE.test(cc))
      .sort();

    // Cheapest per-person price per country, from the summary the widget reads.
    const summaryByCC = new Map();
    if (summary && Array.isArray(summary.countries)) {
      for (const c of summary.countries) {
        if (c && c.countryCode) summaryByCC.set(String(c.countryCode).toUpperCase(), c);
      }
    }

    const countries = await pooled(ccs, async (cc) => {
      const stored = await getJson(countryKey(cc));
      const offers = stored && Array.isArray(stored.offers) ? stored.offers : [];
      const resorts = await getJson(resortsKey(cc));
      const s = summaryByCC.get(cc);
      // Oldest fetchedAt still stored — surfaces countries drifting toward the
      // 70-hour expiry cliff before they empty out.
      let oldestFetchedAt = null;
      for (const o of offers) {
        if (o && o.fetchedAt && (!oldestFetchedAt || o.fetchedAt < oldestFetchedAt)) oldestFetchedAt = o.fetchedAt;
      }
      // Per-DEPARTURE-airport tally: count + cheapest per-person price for
      // each origin seen in this country's offers. Drives the departure
      // filter chips on the Cache tab.
      const origins = {};
      for (const o of offers) {
        if (!o) continue;
        const k = String(o.origin || '').toUpperCase();
        if (!/^[A-Z]{3}$/.test(k)) continue;
        const pp = Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : null);
        const e = origins[k];
        if (!e) origins[k] = { count: 1, fromPP: pp };
        else { e.count += 1; if (pp != null && (e.fromPP == null || pp < e.fromPP)) e.fromPP = pp; }
      }
      return {
        countryCode: cc,
        offerCount: offers.length,
        refreshedAt: (stored && stored.refreshedAt) || null,
        oldestFetchedAt,
        resortCount: resorts && Array.isArray(resorts.resorts) ? resorts.resorts.length : 0,
        cheapestPP: s ? (s.fromPricePP ?? s.fromPrice ?? null) : null,
        currency: s ? (s.currency || 'GBP') : 'GBP',
        inSummary: !!s,
        origins,
      };
    });

    countries.sort((a, b) => b.offerCount - a.offerCount);

    return res.status(200).json({
      ok: true,
      redisConfigured: true,
      lastRunAt: lastRunAt || null,
      summary: summary ? { generatedAt: summary.generatedAt || null, stats: summary.stats || null } : null,
      countries,
    });
  } catch (err) {
    console.error('[admin/map-cache] error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to read the offer cache' });
  }
}
