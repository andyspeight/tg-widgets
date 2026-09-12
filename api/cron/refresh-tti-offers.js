/**
 * Vercel Cron — refresh the TTI Offers property sweep.
 *
 * WHAT IT DOES
 *   1. Reads every live TTI Offers widget from the Widgets table and pulls
 *      the TTI property codes out of each one's saved config.
 *   2. Resolves the OWNING client's Travelify App ID for each widget, then
 *      folds the whole roster into a deduped set of (appId, code) pairs — two
 *      widgets on the same account asking about the same hotel cost one search,
 *      two different accounts asking about it cost one each (their contracted
 *      rates differ, and so must their cached prices).
 *   3. Fires ONE /api/offers request per pair, scoped to that single property.
 *   4. Normalises every returned offer with the SAME tested parser the world
 *      map cron uses, so the stored shape is byte-identical and
 *      api/cached-offers.js can rebuild it with the one toRawShape it already has.
 *   5. Verifies every offer actually belongs to the property that was asked for
 *      before storing it (see THE VERIFY GATE below).
 *   6. Writes offers:tti:{appId}:{code}. A pair whose request fails keeps its
 *      existing key untouched — the read side's own 70-hour staleness guard
 *      retires it if the failure persists, so a bad night degrades to empty
 *      rather than to stale.
 *
 * THE OPEN QUESTION (read this before debugging an empty sweep)
 *   What a DEEP LINK cannot do, settled by Travelify's own documentation. The
 *   Deeplinking Instructions (Darren Swan, Aug 2022) open with: a results page
 *   "contain[s] a unique search session that is for a single user/customer only.
 *   After roughly 20 minutes, the search session will expire and not be
 *   bookable". A deep link is therefore a per-visitor, self-expiring browser
 *   session — there is nothing in it to harvest into a shared overnight cache,
 *   and building one on top of it would be building on a 20-minute fuse.
 *
 *   What that document DOES define for pinning a property is loct=Property
 *   alongside loc={name} and ctry={code}. It defines no TTI parameter and no
 *   refn at all; our own refn=TTI:{code} came from reverse-engineering a live
 *   link Travelify's generator produced (22 Jul 2026) and is undocumented.
 *   So TTI codes are proven to identify a property to Travelify — their own
 *   platform keys accommodation image overrides on them — but no published
 *   source says how to hand one to the offers FEED, which is what this job
 *   needs. Until that is settled TTI_PROPERTY_PARAM stays unset and this cron
 *   fires NO searches: burning search capacity on a guess is exactly what the
 *   cache-only rule exists to prevent.
 *
 *   To settle it: GET this route with ?probe=1&tti={a real code}&appId={an app}
 *   (add &name= and &ctry= to include the documented loct=Property shape). The
 *   probe sends one request per candidate spelling plus an unscoped control,
 *   and reports how many offers came back and how many carried the requested
 *   property. The winner is the candidate whose offers are ALL that property
 *   while the control's are not. Set TTI_PROPERTY_PARAM to its name and the
 *   nightly sweep starts working with no code change.
 *
 * THE VERIFY GATE (never remove)
 *   Travelify ignores parameters it does not recognise rather than erroring. A
 *   wrong TTI_PROPERTY_PARAM would therefore come back 200 with a full page of
 *   UNRELATED inventory, and a client's "our twelve hotels" widget would quietly
 *   fill with somebody else's. So every offer is checked against the code that
 *   was requested and dropped if it does not match, whatever the param does.
 *   A wrong param can then only ever produce an empty widget, never a wrong one.
 *
 * CADENCE
 *   Nightly (see vercel.json). One request per property per run, which is why
 *   MAX_CODES_PER_WIDGET exists: the whole point of the cache is that visitors
 *   never trigger a search, and that only holds if OUR search volume stays
 *   predictable. Budget is roughly (properties x accounts) requests per night.
 *
 * STORAGE KEYS
 *   offers:tti:{appId}:{code}   per-property normalised offers + refreshedAt
 *   tti:offers:lastRunAt        ISO timestamp of the last completed sweep
 *   tti:offers:lastSweepStats   per-run tallies for the admin view
 *
 * AUTH
 *   Caller must send Authorization: Bearer ${CRON_SECRET}.
 */

import { setJson, getJson, setString, configured } from '../_redis.js';
import { lookupClientCredentialsByRecordId, lookupClientCredentialsByEmail } from '../_auth.js';
// The parser, the proxy caller and the Airtable reader are the world map
// cron's, imported rather than copied. Two normalisers writing one cache shape
// is how the shape drifts, and api/cached-offers.js rebuilds BOTH pools with a
// single toRawShape that is the exact inverse of this one parser.
import {
  normaliseOffers,
  callOffersProxy,
  compactOffer,
  airtableList,
} from './refresh-map-offers.js';

// ── Config ────────────────────────────────────────────────────────────────
const WIDGETS_TABLE = 'tblVAThVqAjqtria2'; // Widgets (appAYzWZxvK6qlwXK)
const WIDGET_TYPE = 'TTI Offers';

const TTI_PREFIX = 'offers:tti:';
const ttiKey = (appId, code) => `${TTI_PREFIX}${appId}:${code}`;
const LASTRUN_KEY = 'tti:offers:lastRunAt';
const STATS_KEY = 'tti:offers:lastSweepStats';

// The pure logic — how a pasted code becomes a cache key, what search a
// widget implies, how the upstream ask is shaped, and the verify gate — lives
// in one dependency-free module so it can be tested without this job's
// Airtable and Redis imports. This file is the I/O around it.
import {
  PROPERTY_PARAM,
  PROBE_CANDIDATES,
  MAX_REQUESTS_PER_RUN,
  REQUEST_CONCURRENCY,
  PER_REQUEST_TIMEOUT_MS,
  canonTti,
  cleanName,
  cleanCtry,
  codesFromConfig,
  searchFromConfig,
  buildTtiPayload,
  offerIsProperty,
} from '../_lib/offers/tti.js';

/** Read every live TTI Offers widget and fold it into deduped work items.
 *  One item per (appId, code): the same hotel on two widgets of one account is
 *  one search, the same hotel on two different accounts is one search each
 *  because their contracted rates — and therefore their cached prices — differ. */
export async function collectWork() {
  const rows = [];
  let offset;
  do {
    const params = {
      pageSize: '100',
      // The WidgetType option is exact; Status filtering is done below so a
      // legacy record with no Status still counts as live.
      filterByFormula: `{WidgetType}='${WIDGET_TYPE}'`,
    };
    if (offset) params.offset = offset;
    const j = await airtableList(WIDGETS_TABLE, params);
    rows.push(...(j.records || []));
    offset = j.offset;
  } while (offset);

  const work = new Map();
  const appIdCache = new Map();
  const skipped = [];

  for (const row of rows) {
    const f = row.fields || {};
    const status = String(f.Status || '').toLowerCase();
    if (status && status !== 'active' && status !== 'live') continue;

    let config;
    try { config = JSON.parse(f.Config || '{}'); } catch { config = null; }
    if (!config) { skipped.push({ widget: f.WidgetID || row.id, why: 'unreadable config' }); continue; }

    const props = codesFromConfig(config);
    if (!props.length) { skipped.push({ widget: f.WidgetID || row.id, why: 'no TTI codes' }); continue; }

    // Resolve the OWNING account's App ID, the same way /api/widget-config
    // does: the ClientRecordId is authoritative, because one email can own
    // several client accounts and an email lookup returns an arbitrary one.
    const clientRecordId = String(f.ClientRecordId || '').trim();
    const clientEmail = String(f.ClientEmail || '').toLowerCase().trim();
    const cacheKey = clientRecordId || clientEmail;
    if (!cacheKey) { skipped.push({ widget: f.WidgetID || row.id, why: 'no owning account' }); continue; }

    let appId = appIdCache.get(cacheKey);
    if (appId === undefined) {
      try {
        const creds = (clientRecordId ? await lookupClientCredentialsByRecordId(clientRecordId) : null)
                   || (clientEmail ? await lookupClientCredentialsByEmail(clientEmail) : null);
        appId = creds && creds.appId ? String(creds.appId).trim() : null;
      } catch (e) {
        appId = null;
      }
      appIdCache.set(cacheKey, appId);
    }
    if (!appId || !/^\d{1,10}$/.test(appId)) {
      skipped.push({ widget: f.WidgetID || row.id, why: 'no Travelify App ID on the owning account' });
      continue;
    }

    const search = searchFromConfig(config);
    for (const p of props) {
      // The search shape is part of the key's identity in spirit but not in
      // fact: two widgets on one account asking about one hotel with different
      // date windows share a key. First one in sets the shape, and the wider
      // window wins so neither widget is starved.
      const k = `${appId}:${p.code}`;
      const existing = work.get(k);
      if (!existing) {
        work.set(k, {
          appId, code: p.code, name: p.name, ctry: p.ctry,
          // One property, one cache key, but possibly two asks. A hotel-only
          // widget and a dynamic-package widget want genuinely different
          // products from the same property, and neither ask is a superset of
          // the other, so we sweep each type this account actually asked for
          // and merge both into the key. The read side already separates them
          // by type, the same way it does for the country pool.
          //
          // Demand-driven, so the common case (one widget, one type) is still
          // one request. Only an account running both kinds pays for both.
          searches: [{ ...search }],
        });
      } else {
        // One widget naming the hotel benefits every widget on the account
        // that only pasted its code — the documented anchor needs a name.
        if (!existing.name && p.name) existing.name = p.name;
        if (!existing.ctry && p.ctry) existing.ctry = p.ctry;
        const same = existing.searches.find((sr) => sr.type === search.type);
        if (same) {
          // Same product, different window: the wider one wins so neither
          // widget is starved of the dates it asked for.
          same.DatesMin = Math.min(same.DatesMin, search.DatesMin);
          same.DatesMax = Math.max(same.DatesMax, search.DatesMax);
        } else {
          existing.searches.push({ ...search });
        }
      }
    }
  }
  return { work: Array.from(work.values()), widgets: rows.length, skipped };
}

/** Fetch, normalise and verify one property's offers for ONE product type.
 *  Returns null on a failed request so the caller can leave the key alone. */
async function fetchProperty(item, search, override = null) {
  const payload = buildTtiPayload(item.appId, item, search, override);
  if (!payload) return null;
  const res = await callOffersProxy(payload, PER_REQUEST_TIMEOUT_MS, 1);
  if (!res || !res.ok) return null;
  const raw = (res.data && (res.data.data || res.data.offers)) || [];
  // search.type is the FAMILY name ('Accommodation' or 'Packages') and is what
  // gets stamped onto the stored offer, so cached-offers.js can tell a dynamic
  // package from an operator one with packageKindOf at read time — exactly as
  // it does for the country pool. The ask was already narrowed to DP by
  // search.packageType.
  const parsed = normaliseOffers(Array.isArray(raw) ? raw : [], search.type);
  const verified = parsed.filter((o) => offerIsProperty(o, item.code));
  return { returned: Array.isArray(raw) ? raw.length : 0, parsed: parsed.length, verified };
}

/** Sweep every product type one property was asked for, and pool the results.
 *  Returns null only when EVERY request failed — a partial failure still
 *  stores what did come back, because a hotel-only widget should not go blank
 *  because the package request timed out. */
async function fetchPropertyAllTypes(item) {
  const results = await Promise.all(item.searches.map((sr) => fetchProperty(item, sr)));
  const ok = results.filter(Boolean);
  if (!ok.length) return null;
  return {
    returned: ok.reduce((n, r) => n + r.returned, 0),
    parsed: ok.reduce((n, r) => n + r.parsed, 0),
    verified: ok.flatMap((r) => r.verified),
    partial: ok.length < results.length,
  };
}

/** Store one property's offers, cheapest first. A run that verified nothing
 *  writes an EMPTY key rather than leaving yesterday's behind: the property
 *  genuinely has no availability we can show, and the calm empty state is the
 *  honest answer. A FAILED request never reaches here. */
async function storeProperty(item, offers, nowIso) {
  const price = (o) => (Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : Infinity));
  // Both product types share one key, so dedupe on the same composite the
  // country pool merges on before sorting.
  const seen = new Set();
  const unique = [];
  for (const o of offers) {
    const k = `${o.id}|${o.origin || ''}|${o.type || 'Packages'}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(o);
  }
  const sorted = unique.sort((a, b) => price(a) - price(b));
  const compact = sorted.map(compactOffer);
  const ok = await setJson(ttiKey(item.appId, item.code), { offers: compact, refreshedAt: nowIso });
  return { ok, stored: ok ? compact.length : 0 };
}

/** The diagnostic that closes THE OPEN QUESTION above. Fires one request per
 *  candidate spelling plus an unscoped control, and reports what came back.
 *  Writes nothing. */
async function runProbe(appId, prop, search) {
  const item = { appId, ...prop };
  // The control is a parameter Travelify certainly does not know. It is
  // ignored, so what comes back is what an UNSCOPED search returns — the
  // baseline every candidate is judged against.
  const control = await callOffersProxy(
    buildTtiPayload(appId, prop, search, { param: '_tgProbeControl', array: false, prefixed: false }),
    PER_REQUEST_TIMEOUT_MS, 0,
  );
  const controlRaw = (control && control.ok && control.data && (control.data.data || control.data.offers)) || [];
  const controlParsed = normaliseOffers(Array.isArray(controlRaw) ? controlRaw : [], search.type);
  const results = [];
  for (const cand of PROBE_CANDIDATES) {
    const r = await fetchProperty(item, search, cand);
    const label = cand.shape === 'loct'
      ? 'loct=Property + loc/ctry (the documented shape)'
      : cand.param;
    if (r === null && cand.shape === 'loct' && !prop.name) {
      results.push({ param: label, shape: 'not tried', skipped: 'needs &name= — the documented anchor names the property, it does not code it' });
      continue;
    }
    results.push({
      param: label,
      shape: cand.shape === 'loct'
        ? 'name + country'
        : (cand.array ? 'array' : 'single') + (cand.prefixed ? ', TTI: prefixed' : ', bare code'),
      requestFailed: r === null,
      returned: r ? r.returned : 0,
      parsed: r ? r.parsed : 0,
      matchedProperty: r ? r.verified.length : 0,
      // The signal: a spelling that WORKS returns only the asked-for property.
      // A spelling Travelify ignored returns the same broad set as the control.
      looksScoped: !!(r && r.parsed > 0 && r.verified.length === r.parsed),
    });
  }
  return {
    code: prop.code,
    name: prop.name || null,
    appId,
    control: {
      note: 'an unrecognised param. Travelify ignores it, so this is what an UNSCOPED search returns',
      returned: Array.isArray(controlRaw) ? controlRaw.length : 0,
      parsed: controlParsed.length,
      matchedProperty: controlParsed.filter((o) => offerIsProperty(o, prop.code)).length,
    },
    candidates: results,
    verdict: results.filter((r) => r.looksScoped).map((r) => `${r.param} (${r.shape})`),
    howToRead: 'A candidate with matchedProperty === parsed AND parsed > 0, where the '
      + 'control returned a broader set, is the parameter. Set TTI_PROPERTY_PARAM to its '
      + 'name on Vercel (plus TTI_PROPERTY_PARAM_ARRAY=1 and/or '
      + 'TTI_PROPERTY_PARAM_PREFIXED=1 to match its shape) and the nightly sweep runs.',
  };
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorised' });
  }
  if (!configured()) {
    return res.status(503).json({ ok: false, error: 'Redis not configured — nothing to refresh into' });
  }

  const q = req.query || {};
  const startedAt = Date.now();

  try {
    // ── Probe mode ────────────────────────────────────────────────────────
    // Diagnostic only, writes nothing. Needs a real code and a real app so the
    // answer is evidence rather than a guess.
    if (String(q.probe || '') === '1') {
      const code = canonTti(q.tti);
      const appId = String(q.appId || '').trim();
      if (!code || !/^\d{1,10}$/.test(appId)) {
        return res.status(400).json({
          ok: false,
          error: 'probe needs ?tti={a real property code}&appId={a real Travelify app id}',
        });
      }
      const search = searchFromConfig({ type: q.type || 'Accommodation' });
      const report = await runProbe(
        appId,
        { code, name: cleanName(q.name), ctry: cleanCtry(q.ctry) },
        search,
      );
      return res.status(200).json({ ok: true, probe: true, ...report, ms: Date.now() - startedAt });
    }

    // ── Sweep ─────────────────────────────────────────────────────────────
    const { work, widgets, skipped } = await collectWork();

    // No property parameter means no honest way to ask for one hotel. Firing a
    // broad search per code would burn Travelify capacity to fill the cache
    // with inventory the verify gate then discards, so we do not fire at all.
    if (!PROPERTY_PARAM) {
      return res.status(200).json({
        ok: true,
        swept: 0,
        widgets,
        properties: work.length,
        skipped,
        unconfigured: true,
        note: 'TTI_PROPERTY_PARAM is not set, so no searches were fired. Run this route '
            + 'with ?probe=1&tti={code}&appId={app} to find the parameter that scopes a '
            + 'traveloffers search to one property, then set it on Vercel.',
        ms: Date.now() - startedAt,
      });
    }

    // The ceiling counts REQUESTS, and a property asked for as both a hotel and
    // a dynamic package is two. Fill the queue by request budget, not by
    // property count, or an account running both kinds would quietly double it.
    const queue = [];
    let budget = MAX_REQUESTS_PER_RUN;
    for (const item of work) {
      if (budget < item.searches.length) break;
      budget -= item.searches.length;
      queue.push(item);
    }
    const truncated = work.length - queue.length;
    const nowIso = new Date().toISOString();
    // properties = cache keys touched. requests = upstream calls, which is the
    // number that costs us Travelify capacity, and the two differ whenever an
    // account runs both a hotel and a dynamic-package widget on one property.
    const stats = {
      properties: queue.length,
      requests: queue.reduce((n, it) => n + it.searches.length, 0),
      ok: 0, failed: 0, partial: 0, empty: 0, offersStored: 0, dropped: 0,
    };
    const failures = [];

    let i = 0;
    const workers = Array.from({ length: Math.min(REQUEST_CONCURRENCY, queue.length || 1) }, async () => {
      while (i < queue.length) {
        const item = queue[i++];
        const r = await fetchPropertyAllTypes(item);
        if (r === null) {
          // Request failed. Leave the existing key alone — the read side's
          // staleness guard retires it if this keeps happening.
          stats.failed++;
          if (failures.length < 20) failures.push(`${item.appId}:${item.code}`);
          continue;
        }
        if (r.partial) stats.partial++;
        stats.dropped += Math.max(0, r.parsed - r.verified.length);
        const w = await storeProperty(item, r.verified, nowIso);
        if (!w.ok) { stats.failed++; continue; }
        stats.ok++;
        stats.offersStored += w.stored;
        if (!w.stored) stats.empty++;
      }
    });
    await Promise.all(workers);

    await setString(LASTRUN_KEY, nowIso);
    await setJson(STATS_KEY, { at: nowIso, ...stats, widgets, truncated });

    // A sweep that stored nothing at all, having asked for plenty, is the
    // signature of a param Travelify is ignoring — say so rather than
    // reporting a cheerful zero.
    const suspectParam = stats.requests > 0 && stats.offersStored === 0 && stats.dropped > 0;

    return res.status(200).json({
      ok: true,
      swept: stats.properties,
      widgets,
      properties: work.length,
      ...stats,
      truncated: truncated > 0 ? truncated : undefined,
      failures: failures.length ? failures : undefined,
      skipped: skipped.length ? skipped : undefined,
      suspectParam: suspectParam
        ? `every offer returned under '${PROPERTY_PARAM}' was for a different property, `
          + 'so the parameter is probably being ignored. Re-run with ?probe=1 to re-check it.'
        : undefined,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[tti-cron] failed:', err && err.message);
    return res.status(500).json({ ok: false, error: err && err.message });
  }
}
