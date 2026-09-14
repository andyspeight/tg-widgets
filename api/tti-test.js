/**
 * POST /api/tti-test — check a TTI Offers property list against Travelify.
 *
 * The editor's "Test" button. An agent pastes property codes and, until now,
 * had no way to know whether a code was real, whether the country was right,
 * or whether that hotel has any sellable inventory at all. They found out the
 * next morning, from an empty widget. This answers it while they are still
 * looking at the field.
 *
 * WHY THIS IS ALLOWED TO SEARCH LIVE
 *   The cache-only rule says a VISITOR's browser must never trigger a Travelify
 *   search. This is not a visitor: it is an authenticated agent in the editor,
 *   who pressed a button, and it is capped and rate limited. The rule exists
 *   because a per-visitor live path cost ~4,000 searches a week (30 Jul 2026);
 *   a deliberate click on a handful of codes is a different thing entirely.
 *
 *   The guard rails that keep it that way:
 *     - MAX_CODES per request, so one click cannot fan out.
 *     - Low concurrency and a short timeout, so a slow supplier cannot hold
 *       the function open.
 *     - Rate limited per account.
 *     - The App ID is resolved SERVER-SIDE from the caller's own account. A
 *       client cannot test against somebody else's Travelify application.
 *
 * WHAT IT REPORTS, per code
 *   found        offers came back that are genuinely THIS property
 *   area-only    offers came back for the area but none were this property.
 *                Either the code is wrong, or the feed ignores the refn pin and
 *                the hotel is not in the cheapest slice of that country.
 *   empty        the search worked and returned nothing at all
 *   failed       the request itself failed
 *
 * The area-only case is also, incidentally, how we find out whether the feed
 * honours refn: if every code reports area-only with a large areaOffers count,
 * the pin is being ignored. See docs/tti-offers-handover.md.
 */

import { requireAuth, setCors } from './_auth.js';
import { lookupClientCredentialsByRecordId, lookupClientCredentialsByEmail } from './_auth.js';
import { evaluatePublicRateLimit } from './_lib/rate-limit-public.js';
import { canonTti, cleanCtry, searchFromConfig, buildTtiPayload, offerIsProperty } from './_lib/offers/tti.js';
import { normaliseOffers, callOffersProxy } from './cron/refresh-map-offers.js';

// One click, a handful of codes. Enough to check a list is sane without
// becoming a way to sweep inventory.
const MAX_CODES = 10;
const CONCURRENCY = 2;
// Must stay comfortably INSIDE the maxDuration vercel.json gives this route
// (60s). It was 12s against an undeclared route, which meant Vercel's own
// default cut in first: the platform kills the function mid-flight and returns
// an empty-bodied gateway response, so the caller gets nothing to parse rather
// than an honest per-code result. Same trap /api/offers documents at its own
// UPSTREAM_TIMEOUT_MS. Worst case here is ceil(10/2) x 20s = 100s, so the
// function can still be cut on a full slate of slow codes; each code that DID
// answer is reported, and the browser has its own deadline besides.
const TIMEOUT_MS = 20000;

/** The caller's own Travelify App ID. Never taken from the request body: that
 *  would let one client test against another client's application, and the
 *  rates that come back are commercially theirs. */
async function appIdForCaller(user) {
  const creds = (user.clientId ? await lookupClientCredentialsByRecordId(user.clientId) : null)
             || (user.email ? await lookupClientCredentialsByEmail(user.email) : null);
  const appId = creds && creds.appId ? String(creds.appId).trim() : '';
  return /^\d{1,10}$/.test(appId) ? appId : '';
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = (auth.user || {});
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
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No properties to test.' });

  // Canonicalise here rather than trusting the editor: this is the same
  // normalisation the cron and the widget do, so a code that passes the test
  // is a code that will key correctly tonight.
  const props = [];
  const seen = new Set();
  for (const r of rows.slice(0, MAX_CODES)) {
    const code = canonTti(r && (r.code || r.tti));
    const ctry = cleanCtry(r && (r.ctry || r.countryCode));
    if (!code || seen.has(code)) continue;
    seen.add(code);
    props.push({ code, ctry });
  }
  if (!props.length) {
    return res.status(400).json({ error: 'None of those look like property codes.' });
  }

  const appId = await appIdForCaller(user);
  if (!appId) {
    return res.status(400).json({
      error: 'No Travelify App ID on your account, so there is nothing to search against. '
           + 'Ask us to connect your Travelify application first.',
    });
  }

  const search = searchFromConfig({ type: body.type || 'Accommodation' });
  const results = new Array(props.length);

  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, props.length) }, async () => {
    while (i < props.length) {
      const idx = i++;
      const prop = props[idx];
      // No country means no area to search, which the sweep would skip. Say so
      // here rather than firing a worldwide search to prove it.
      if (!prop.ctry) {
        results[idx] = { code: prop.code, status: 'no-country',
          detail: 'Add the two-letter country so we know where to look.' };
        continue;
      }
      const payload = buildTtiPayload(appId, prop, search);
      if (!payload) {
        results[idx] = { code: prop.code, status: 'no-country' };
        continue;
      }
      const r = await callOffersProxy(payload, TIMEOUT_MS, 0);
      if (!r || !r.ok) {
        results[idx] = { code: prop.code, status: 'failed',
          detail: (r && r.error) || 'the search did not come back' };
        continue;
      }
      const raw = (r.data && (r.data.data || r.data.offers)) || [];
      const parsed = normaliseOffers(Array.isArray(raw) ? raw : [], search.type);
      const mine = parsed.filter((o) => offerIsProperty(o, prop.code));
      if (mine.length) {
        const cheapest = mine.reduce((a, b) => {
          const pa = Number.isFinite(a.pricePP) ? a.pricePP : a.price;
          const pb = Number.isFinite(b.pricePP) ? b.pricePP : b.price;
          return (pb < pa) ? b : a;
        });
        results[idx] = {
          code: prop.code, status: 'found', offers: mine.length,
          hotel: cheapest.hotel || null,
          resort: cheapest.resort || null,
          fromPrice: Number.isFinite(cheapest.pricePP) ? cheapest.pricePP : cheapest.price,
          currency: cheapest.currency || 'GBP',
        };
      } else if (parsed.length) {
        results[idx] = {
          code: prop.code, status: 'area-only', areaOffers: parsed.length,
          detail: 'The search worked but nothing came back for this property. '
                + 'Check the code and the country.',
        };
      } else {
        results[idx] = { code: prop.code, status: 'empty',
          detail: 'No availability at all in that country right now.' };
      }
    }
  });
  await Promise.all(workers);

  const found = results.filter((r) => r.status === 'found').length;
  return res.status(200).json({
    ok: true,
    tested: results.length,
    found,
    // Every code coming back area-only, with a healthy area count, is the
    // signature of the feed ignoring the refn pin rather than of bad codes.
    pinLooksIgnored: found === 0
      && results.length > 1
      && results.every((r) => r.status === 'area-only' && r.areaOffers > 20),
    truncated: rows.length > MAX_CODES ? rows.length - MAX_CODES : undefined,
    results,
  });
}
