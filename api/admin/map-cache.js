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
 *                       count, refreshedAt and a per-type breakdown
 *                       (typeStats: count, cheapest pp, oldest/newest fetch,
 *                       stale count and per-origin tallies for each of
 *                       Packages / Accommodation / Flights) — drives the
 *                       type tabs on the Cache tab.
 *   GET ?country=XX   → that country's stored offers, sorted cheapest-first
 *                       (per person), sliced by ?offset / ?limit (default
 *                       200, max 500) so a big country can't flood the page.
 *                       Optional ?type=Packages|Accommodation|Flights and
 *                       ?origins=LGW,DUB filter before sorting/slicing.
 *   DELETE {country}  → purge one country's cached offers + resorts keys
 *                       (ALL types). The map summary still lists the country
 *                       until the next rebuild — the UI triggers one straight
 *                       after.
 *
 * Security: requireAdmin (same gate as the other map admin routes); no '*'
 * CORS; no-store. Reads only Redis — Airtable is not touched here.
 */

import { requireAdmin, setAdminCors } from './_guard.js';
import { getJson, getString, del, keys, configured } from '../_redis.js';

const COUNTRY_PREFIX = 'offers:packages:';
const SUMMARY_KEY = 'map:offers:v1';
const LASTRUN_KEY = 'map:offers:lastRunAt';
// Per-type fetched/kept/drop tallies written by the cron's last sweep — the
// Cache tab shows these so thin types can be diagnosed at a glance.
const SWEEP_STATS_KEY = 'map:offers:lastSweepStats';
// Sampled package composition over time (written by the cron on summary
// rebuild) — drives the Cache tab trend line.
const HISTORY_KEY = 'map:offers:history';
const countryKey = (cc) => `${COUNTRY_PREFIX}${cc}`;
// Accommodation + Flights offers live in a second per-country key (see the
// cron's storeCountryOffers). The inspector shows the WHOLE pool.
const extraCountryKey = (cc) => `offers:extra:${cc}`;
const resortsKey = (cc) => `map:resorts:${cc}`;

/** Load and combine a country's two offer keys. */
async function loadCountryOffers(cc) {
  const [p, x] = await Promise.all([getJson(countryKey(cc)), getJson(extraCountryKey(cc))]);
  const offers = []
    .concat(p && Array.isArray(p.offers) ? p.offers : [])
    .concat(x && Array.isArray(x.offers) ? x.offers : []);
  const refreshedAt = [p && p.refreshedAt, x && x.refreshedAt].filter(Boolean).sort().pop() || null;
  return { offers, refreshedAt, exists: !!(p || x) };
}

const CC_RE = /^[A-Z]{2}$/;
const REC_RE = /^rec[A-Za-z0-9]{14}$/;
const CLIENT_SUPPLIERS_PREFIX = 'suppliers:client:';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const OFFER_TYPES = ['Packages', 'Accommodation', 'Flights'];
// Staleness definition mirrors the cron's purge rules (MAX_AGE_HOURS 70 or a
// past travel date). Anything counted stale here has escaped deletion and
// should disappear on the next cron run's maintenance pass.
const STALE_AGE_MS = 70 * 60 * 60 * 1000;
function isStale(o, nowMs) {
  const td = Date.parse(o.outboundDate || o.checkinDate || '');
  if (Number.isFinite(td) && td < nowMs) return true;
  if (o.fetchedAt) {
    const f = Date.parse(o.fetchedAt);
    if (Number.isFinite(f) && (nowMs - f) > STALE_AGE_MS) return true;
  }
  return false;
}

// A "package" in the cache is really two products. An OPERATOR package
// (PackageHolidays) is one tour operator — flight.sid === accommodation.sid ===
// that operator's Packages id. A DYNAMIC package (DynamicPackages) is a flight
// and a hotel assembled from two DIFFERENT suppliers, so it has no single
// operator id; its flight.sid is just the flight consolidator. Roughly 70% of
// inventory is dynamic. packageType is authoritative; the sid-inequality
// fallback covers offers cached before packageType was carried. Mirrors the
// widget filter so the admin view matches what clients actually see.
const PKG_HOLIDAY = 'PackageHolidays';
const PKG_DYNAMIC = 'DynamicPackages';
function packageKind(o) {
  if (o.packageType === PKG_DYNAMIC) return PKG_DYNAMIC;
  if (o.packageType === PKG_HOLIDAY) return PKG_HOLIDAY;
  const f = o.flightSid, a = o.accommodationSid;
  if (Number.isFinite(f) && Number.isFinite(a) && f !== a) return PKG_DYNAMIC;
  return PKG_HOLIDAY;
}

/** Would this offer survive a client's supplier selection? Mirrors EXACTLY the
 *  widget filter (widget-offers supplierAllows / widget-worldmap mapSupplierAllows):
 *  empty list for a type = show all; missing sid = keep; dynamic packages bypass
 *  the operator whitelist; only operator packages are gated on the operator id.
 *  f is { flights:[ids], accommodation:[ids], packages:[ids] }. */
function offerVisible(o, f) {
  const type = OFFER_TYPES.includes(o.type) ? o.type : 'Packages';
  if (type === 'Flights') {
    if (!f.flights.length) return true;
    return Number.isFinite(o.flightSid) ? f.flights.includes(o.flightSid) : true;
  }
  if (type === 'Accommodation') {
    if (!f.accommodation.length) return true;
    return Number.isFinite(o.accommodationSid) ? f.accommodation.includes(o.accommodationSid) : true;
  }
  if (!f.packages.length) return true;
  if (packageKind(o) === PKG_DYNAMIC) return true; // dynamic packages always show
  const sid = Number.isFinite(o.flightSid) ? o.flightSid
    : (Number.isFinite(o.accommodationSid) ? o.accommodationSid : null);
  return sid == null ? true : f.packages.includes(sid);
}

/** Accumulate one offer into a stats bucket (count, cheapest pp, oldest/newest
 *  fetch, stale, per-departure-airport origins). Shared by the per-type and the
 *  per-package-kind breakdowns. */
function accStat(map, key, o, pp, stale) {
  const ts = map[key] || (map[key] = {
    count: 0, fromPP: null, oldestFetchedAt: null, newestFetchedAt: null, stale: 0, origins: {},
  });
  ts.count += 1;
  if (pp != null && (ts.fromPP == null || pp < ts.fromPP)) ts.fromPP = pp;
  if (o.fetchedAt) {
    if (!ts.oldestFetchedAt || o.fetchedAt < ts.oldestFetchedAt) ts.oldestFetchedAt = o.fetchedAt;
    if (!ts.newestFetchedAt || o.fetchedAt > ts.newestFetchedAt) ts.newestFetchedAt = o.fetchedAt;
  }
  if (stale) ts.stale += 1;
  const k = String(o.origin || '').toUpperCase();
  if (/^[A-Z]{3}$/.test(k)) {
    const e = ts.origins[k] || (ts.origins[k] = { count: 0, fromPP: null });
    e.count += 1;
    if (pp != null && (e.fromPP == null || pp < e.fromPP)) e.fromPP = pp;
  }
}

/** Per-type breakdown of one country's stored offers, plus a package-kind split
 *  (Package holidays vs Dynamic). The Cache tab's type tabs, chips, columns and
 *  the dynamic/operator split all read this. */
function buildTypeStats(offers, nowMs) {
  const typeStats = {};
  const packageStats = {}; // PackageHolidays / DynamicPackages — packages only
  let staleCount = 0;
  for (const o of offers) {
    if (!o) continue;
    const t = OFFER_TYPES.includes(o.type) ? o.type : 'Packages';
    const pp = Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : null);
    const stale = isStale(o, nowMs);
    if (stale) staleCount += 1;
    accStat(typeStats, t, o, pp, stale);
    if (t === 'Packages') accStat(packageStats, packageKind(o), o, pp, stale);
  }
  return { typeStats, packageStats, staleCount };
}

/** Fold one country's offers into a running supplier tally. Operator packages,
 *  hotels and flights are keyed prodType:id to match the master supplier list
 *  (so the Suppliers tab can name and flag them as client-selectable). DYNAMIC
 *  packages collapse into ONE 'Dynamic' bucket rather than a fake per-consolidator
 *  row, since no single supplier owns them. Accumulation is synchronous, so it is
 *  safe to share the Map across the pooled workers. */
function tallySuppliers(offers, cc, agg) {
  for (const o of offers) {
    if (!o) continue;
    const prodType = OFFER_TYPES.includes(o.type) ? o.type : 'Packages';
    let key, id, group;
    if (prodType === 'Packages') {
      if (packageKind(o) === PKG_DYNAMIC) {
        key = 'Dynamic'; id = null; group = 'Dynamic';
      } else {
        id = Number.isFinite(o.flightSid) ? o.flightSid
          : (Number.isFinite(o.accommodationSid) ? o.accommodationSid : null); // operator id
        key = `Packages:${id == null ? '?' : id}`; group = 'Packages';
      }
    } else if (prodType === 'Accommodation') {
      id = Number.isFinite(o.accommodationSid) ? o.accommodationSid : null;
      key = `Accommodation:${id == null ? '?' : id}`; group = 'Accommodation';
    } else {
      id = Number.isFinite(o.flightSid) ? o.flightSid : null;
      key = `Flights:${id == null ? '?' : id}`; group = 'Flights';
    }
    let e = agg.get(key);
    if (!e) { e = { key, id, prodType: group, count: 0, fromPP: null, ccs: new Set(), ops: new Map(), carriers: new Map() }; agg.set(key, e); }
    e.count += 1;
    e.ccs.add(cc);
    const pp = Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : null);
    if (pp != null && (e.fromPP == null || pp < e.fromPP)) e.fromPP = pp;
    // Identifying hints: the tour operator behind packages/hotels and the airline
    // behind flights. Names the dynamic bucket and any deactivated-id supplier.
    if (o.operatorName) e.ops.set(o.operatorName, (e.ops.get(o.operatorName) || 0) + 1);
    if (o.carrier) e.carriers.set(o.carrier, (e.carriers.get(o.carrier) || 0) + 1);
  }
}

/** Most frequent key in a count Map (ties broken by insertion order). */
function topOf(m) {
  let best = null, n = -1;
  for (const [k, v] of m) if (v > n) { n = v; best = k; }
  return best;
}

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
      await del(extraCountryKey(cc));
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

    // ── GET ?preview=<clientId>: what a client's supplier selection shows ──
    // Reads the client's selection from Redis, resolves it to the three id
    // lists (same split as widget-config's supplierFilterForClient), then walks
    // every stored offer applying the EXACT widget filter and tallies
    // visible-vs-stored per package kind / type and per country. Turns "why is
    // my client seeing nothing" into a glance.
    if (q.preview) {
      const clientId = String(q.preview).trim();
      if (!REC_RE.test(clientId)) {
        return res.status(400).json({ ok: false, error: 'preview must be a client record id (rec…)' });
      }
      const rec = await getJson(CLIENT_SUPPLIERS_PREFIX + clientId);
      const enabled = rec && Array.isArray(rec.enabled) ? rec.enabled : [];
      const f = { flights: [], accommodation: [], packages: [] };
      for (const k of enabled) {
        const i = String(k).indexOf(':');
        if (i < 1) continue;
        const id = parseInt(String(k).slice(i + 1), 10);
        if (!Number.isFinite(id)) continue;
        const prod = String(k).slice(0, i);
        if (prod === 'Flights') f.flights.push(id);
        else if (prod === 'Accommodation') f.accommodation.push(id);
        else if (prod === 'Packages') f.packages.push(id);
      }
      const allKeys = await keys(`${COUNTRY_PREFIX}*`);
      const ccs = allKeys
        .map((k) => String(k).slice(COUNTRY_PREFIX.length).toUpperCase())
        .filter((cc) => CC_RE.test(cc));
      const KINDS = ['PackageHolidays', 'DynamicPackages', 'Accommodation', 'Flights'];
      const byKind = {};
      for (const k of KINDS) byKind[k] = { stored: 0, visible: 0 };
      const countryRows = [];
      let totalStored = 0, totalVisible = 0;
      await pooled(ccs, async (cc) => {
        const stored = await loadCountryOffers(cc);
        let cStored = 0, cVisible = 0;
        for (const o of stored.offers) {
          if (!o) continue;
          const type = OFFER_TYPES.includes(o.type) ? o.type : 'Packages';
          const kind = type === 'Packages' ? packageKind(o) : type;
          const vis = offerVisible(o, f);
          (byKind[kind] || (byKind[kind] = { stored: 0, visible: 0 })).stored += 1;
          if (vis) byKind[kind].visible += 1;
          cStored += 1; if (vis) cVisible += 1;
        }
        totalStored += cStored; totalVisible += cVisible;
        if (cStored) countryRows.push({ countryCode: cc, stored: cStored, visible: cVisible, hidden: cStored - cVisible });
      });
      countryRows.sort((a, b) => b.hidden - a.hidden || b.stored - a.stored);
      return res.status(200).json({
        ok: true,
        mode: 'preview',
        clientId,
        configured: !!rec,
        restricted: !!(f.flights.length || f.accommodation.length || f.packages.length),
        filter: f,
        totalStored,
        totalVisible,
        byKind,
        countries: countryRows,
      });
    }

    // ── GET ?country=XX: one country's stored offers ──────────────────────
    // Optional ?type=Packages|Accommodation|Flights and ?origins=LGW,DUB
    // filter before sorting and slicing, so the filters see the whole stored
    // set, not just the first page.
    if (q.country) {
      const cc = String(q.country).toUpperCase().trim();
      if (!CC_RE.test(cc)) return res.status(400).json({ ok: false, error: 'country must be a 2-letter code' });
      const stored = await loadCountryOffers(cc);
      if (!stored.exists || !stored.offers.length) {
        return res.status(200).json({ ok: true, country: cc, exists: false, count: 0, offers: [] });
      }
      // ?type accepts a stored type (Packages|Accommodation|Flights) OR a
      // package kind (PackageHolidays|DynamicPackages) — the latter scopes to
      // Packages offers of that kind so the browse view can drill into the split.
      const rawType = String(q.type || '').trim();
      const typeParam = OFFER_TYPES.includes(rawType) ? rawType : null;
      const kindParam = (rawType === PKG_HOLIDAY || rawType === PKG_DYNAMIC) ? rawType : null;
      const origins = String(q.origins || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{3}$/.test(s))
        .slice(0, 30);
      const originSet = origins.length ? new Set(origins) : null;
      const offset = Math.max(0, parseInt(q.offset, 10) || 0);
      const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit, 10) || DEFAULT_LIMIT));
      let pool = stored.offers;
      if (typeParam) pool = pool.filter((o) => o && (o.type || 'Packages') === typeParam);
      else if (kindParam) pool = pool.filter((o) => o && (o.type || 'Packages') === 'Packages' && packageKind(o) === kindParam);
      if (originSet) pool = pool.filter((o) => o && originSet.has(String(o.origin || '').toUpperCase()));
      const sorted = pool.slice().sort(byCheapest);
      // Per-resort (city) spread over the WHOLE filtered pool, so the admin can
      // see coverage at a glance. A cheapest-first page otherwise fills up with
      // one cheap city (Las Vegas in the USA) and hides the dozens of others that
      // are actually stored, making a well-spread cache look one-city deep.
      const byResort = new Map();
      for (const o of pool) {
        const r = (o && o.resort) ? String(o.resort) : '—';
        const e = byResort.get(r) || { resort: r, count: 0, fromPP: null };
        e.count += 1;
        const pp = Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : null);
        if (pp != null && (e.fromPP == null || pp < e.fromPP)) e.fromPP = pp;
        byResort.set(r, e);
      }
      const resortBreakdown = Array.from(byResort.values())
        .sort((a, b) => b.count - a.count || (a.fromPP || Infinity) - (b.fromPP || Infinity))
        .slice(0, 80);
      return res.status(200).json({
        ok: true,
        country: cc,
        exists: true,
        refreshedAt: stored.refreshedAt || null,
        totalStored: stored.offers.length,
        appliedType: typeParam || kindParam,
        appliedOrigins: origins,
        count: sorted.length,
        offset,
        limit,
        resortBreakdown,
        offers: sorted.slice(offset, offset + limit),
      });
    }

    // ── GET: overview of every stored country key ─────────────────────────
    const [allKeys, summary, lastRunAt, lastSweep, history] = await Promise.all([
      keys(`${COUNTRY_PREFIX}*`),
      getJson(SUMMARY_KEY),
      getString(LASTRUN_KEY),
      getJson(SWEEP_STATS_KEY),
      getJson(HISTORY_KEY),
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

    const nowMs = Date.now();
    // Running supplier tally, folded in per country as the pool sweeps. Keyed
    // prodType:id to line up with /api/admin/suppliers; the Suppliers tab
    // resolves those ids to names.
    const supplierAgg = new Map();
    const countries = await pooled(ccs, async (cc) => {
      const stored = await loadCountryOffers(cc);
      const offers = stored.offers;
      tallySuppliers(offers, cc, supplierAgg);
      const resorts = await getJson(resortsKey(cc));
      const s = summaryByCC.get(cc);
      // Oldest fetchedAt still stored — surfaces countries drifting toward the
      // 70-hour expiry cliff before they empty out.
      let oldestFetchedAt = null;
      for (const o of offers) {
        if (o && o.fetchedAt && (!oldestFetchedAt || o.fetchedAt < oldestFetchedAt)) oldestFetchedAt = o.fetchedAt;
      }
      // Per-type breakdown (counts, cheapest, freshness, stale, origins) —
      // the granular detail behind the Cache tab's All/Packages/Hotels/
      // Flights views.
      const { typeStats, packageStats, staleCount } = buildTypeStats(offers, nowMs);
      return {
        countryCode: cc,
        offerCount: offers.length,
        typeStats,
        packageStats,
        staleCount,
        refreshedAt: stored.refreshedAt,
        oldestFetchedAt,
        resortCount: resorts && Array.isArray(resorts.resorts) ? resorts.resorts.length : 0,
        cheapestPP: s ? (s.fromPricePP ?? s.fromPrice ?? null) : null,
        currency: s ? (s.currency || 'GBP') : 'GBP',
        inSummary: !!s,
      };
    });

    countries.sort((a, b) => b.offerCount - a.offerCount);

    // Flatten the supplier tally: drop the working Set/Maps for plain values
    // (country count + the dominant operator/carrier hint), biggest suppliers
    // first. Drives the Suppliers tab.
    const suppliers = Array.from(supplierAgg.values())
      .map(({ ccs, ops, carriers, ...rest }) => ({
        ...rest,
        countryCount: ccs.size,
        topOperator: topOf(ops),
        topCarrier: topOf(carriers),
      }))
      .sort((a, b) => b.count - a.count);

    return res.status(200).json({
      ok: true,
      redisConfigured: true,
      lastRunAt: lastRunAt || null,
      lastSweep: lastSweep || null,
      summary: summary ? { generatedAt: summary.generatedAt || null, stats: summary.stats || null } : null,
      history: Array.isArray(history) ? history : [],
      countries,
      suppliers,
    });
  } catch (err) {
    console.error('[admin/map-cache] error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to read the offer cache' });
  }
}
