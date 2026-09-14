/**
 * POST /api/tti-test — run a REAL search for a TTI property, and cache it.
 *
 * The editor's "Test" button, rebuilt on the booking API (14 Sep 2026). The
 * previous version asked `widgetsvc/traveloffers` for a country's worth of
 * offers and sieved them for one hotel, which could never work: 250 offers for
 * Great Britain sorted cheapest-first will not contain one named property.
 *
 * What it does now is what the nightly sweep will do, in miniature:
 *
 *   POST /search                       with the property pinned by Ref
 *   GET  /search/{session}              polled until it settles
 *   keep only results that ARE this property
 *   write them to offers:tti:{appId}:{code}
 *
 * So a successful test leaves a real cached offer behind, and the widget shows
 * it immediately. That is deliberate: "it says it found something" and "the
 * widget displays something" have been two different questions all week, and
 * this collapses them into one.
 *
 * WHY THIS IS ALLOWED TO SEARCH LIVE
 *   The cache-only rule is about VISITORS. This is an authenticated agent in
 *   the editor who pressed a button, capped and rate limited. The rule exists
 *   because a per-visitor live path cost ~4,000 searches a week (30 Jul 2026).
 *
 * DIAGNOSTICS
 *   The response carries `shape` — the keys of the first raw result and the
 *   fields the normaliser could not map. The exact result shape had not been
 *   seen when this was written, so rather than guess and be silently wrong,
 *   the guesses report themselves. A cache quietly full of nulls looks exactly
 *   like a supplier with thin content.
 */

import { requireAuth, setCors } from './_auth.js';
import { lookupClientCredentialsByRecordId, lookupClientCredentialsByEmail } from './_auth.js';
import { evaluatePublicRateLimit } from './_lib/rate-limit-public.js';
import {
  canonTti, cleanCtry, parseDeeplink, buildAccommodationCriteria,
  resultIsProperty, normaliseAccommodationResult,
} from './_lib/offers/tti.js';
import { runSearch } from './_lib/offers/travelify-search.js';
import { setJson } from './_redis.js';

// A live search per property, so this is deliberately small.
const MAX_CODES = 5;
const CONCURRENCY = 2;
// Polls per property. The documented ceiling is 30; a search scoped to one
// property settles long before that, and the route dies at 60s.
const MAX_POLLS = 8;
// Stop starting new work past this, so a slow supplier cannot run the function
// into the platform's own timeout and return an empty body to the browser.
const DEADLINE_MS = 42000;

const ttiKey = (appId, code) => `offers:tti:${appId}:${code}`;

async function credsForCaller(user) {
  return (user.clientId ? await lookupClientCredentialsByRecordId(user.clientId) : null)
      || (user.email ? await lookupClientCredentialsByEmail(user.email) : null);
}

/** Accept either structured rows or pasted deeplinks, and canonicalise both
 *  into the one row shape the criteria builder wants. */
function rowsFrom(body) {
  const out = [];
  const seen = new Set();
  const add = (row) => {
    const code = canonTti(row && (row.code || row.tti));
    if (!code || seen.has(code)) return;
    seen.add(code);
    out.push({
      code,
      lat: Number(row.lat), lng: Number(row.lng),
      radius: Number(row.radius) || undefined,
      locationName: row.locationName || row.loc || '',
      locationType: row.locationType || 'City',
      ctry: cleanCtry(row.ctry || row.countryCode || ''),
    });
  };
  for (const raw of (Array.isArray(body.deeplinks) ? body.deeplinks : [])) {
    const parsed = parseDeeplink(raw);
    if (parsed) add(parsed);
  }
  for (const raw of (Array.isArray(body.rows) ? body.rows : [])) {
    if (raw && typeof raw === 'object') add(raw);
  }
  return out.slice(0, MAX_CODES);
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user || {};
  if (!user.email && !user.clientId) {
    return res.status(403).json({ error: 'Account not found. Please sign in again.' });
  }

  const rl = await evaluatePublicRateLimit(req, res, { event: 'tti-test' });
  if (!rl.allowed) {
    return res.status(429).json({
      error: `Too many tests. Please retry in ${rl.retryAfter} second${rl.retryAfter === 1 ? '' : 's'}.`,
    });
  }

  const body = req.body || {};
  const rows = rowsFrom(body);
  if (!rows.length) return res.status(400).json({ error: 'No properties to test.' });

  const creds = await credsForCaller(user);
  if (!creds) {
    return res.status(400).json({
      error: 'No Travelify credentials on your account, so there is nothing to search against. '
           + 'Ask us to connect your Travelify application first.',
    });
  }

  const search = {
    currency: body.currency, nationality: body.nationality,
    leadDays: body.leadDays, nights: body.nights, adults: body.adults,
    customerUserAgent: 'Travelgenix-TtiOffersTest/1.0',
  };
  const type = body.type === 'DynamicPackages' ? 'DynamicPackages' : 'Accommodation';
  const results = new Array(rows.length);
  let shape = null;

  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
    while (i < rows.length) {
      const idx = i++;
      const row = rows[idx];

      const criteria = buildAccommodationCriteria(row, search);
      if (!criteria) {
        // Never fall back to a broader search. A row without coordinates is
        // not a wider question, it is a different one.
        results[idx] = { code: row.code, status: 'incomplete',
          detail: 'Add the two-letter country for this hotel, so we know where to look.' };
        continue;
      }
      if (Date.now() - startedAt > DEADLINE_MS) {
        results[idx] = { code: row.code, status: 'skipped',
          detail: 'Ran out of time this round. Test fewer hotels at once.' };
        continue;
      }

      const r = await runSearch(creds, criteria, { maxPolls: MAX_POLLS, pick: 'accommodationResults' });
      if (!r.ok) {
        results[idx] = { code: row.code, status: 'failed', detail: r.error,
          ...(r.supplierError ? { supplierError: true } : {}) };
        continue;
      }

      const mine = (r.results || []).filter((x) => resultIsProperty(x, row.code));
      // Record the raw shape ONCE, from whatever came back, so a normaliser
      // built on guesses can be corrected against reality rather than argued
      // about. Keys only — never the full payload.
      if (!shape && r.results && r.results.length) {
        shape = { resultKeys: Object.keys(r.results[0]).slice(0, 60), matched: mine.length };
      }

      if (!mine.length) {
        results[idx] = {
          code: row.code, status: 'not-in-results',
          areaResults: r.results.length, complete: r.complete, polls: r.polls,
          detail: r.results.length
            ? 'The search ran but this property was not among the results.'
            : 'The search ran and returned nothing at all for those dates.',
        };
        continue;
      }

      const normalised = [];
      const gaps = new Set();
      for (const one of mine) {
        const n = normaliseAccommodationResult(one, {
          type, ctry: row.ctry, lat: row.lat, lng: row.lng,
          locationName: row.locationName, currency: criteria.Currency,
          checkinDate: criteria.AccommodationSearchCriteria.CheckinDate,
        });
        if (!n) continue;
        normalised.push(n.offer);
        for (const g of n.unmapped) gaps.add(g);
      }

      if (!normalised.length) {
        results[idx] = { code: row.code, status: 'no-price', found: mine.length,
          detail: 'Found the property but no usable price came back, so nothing was cached.' };
        continue;
      }

      const cheapest = normalised.reduce((a, b) => (b.price < a.price ? b : a));
      const wrote = await setJson(ttiKey(creds.appId, row.code), {
        offers: normalised, refreshedAt: new Date().toISOString(),
      });

      results[idx] = {
        code: row.code, status: 'found', offers: normalised.length,
        cached: !!wrote,
        hotel: cheapest.hotel, fromPrice: cheapest.price, currency: cheapest.currency,
        checkinDate: cheapest.checkinDate, nights: cheapest.nights,
        image: cheapest.image ? true : false,
        polls: r.polls, complete: r.complete,
        ...(gaps.size ? { unmapped: [...gaps] } : {}),
      };
    }
  });
  await Promise.all(workers);

  const found = results.filter((r) => r && r.status === 'found').length;
  return res.status(200).json({
    ok: true,
    tested: rows.length,
    found,
    cached: results.filter((r) => r && r.cached).length,
    elapsedMs: Date.now() - startedAt,
    shape,
    results,
  });
}
