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
import { canonTti, cleanCtry, searchFromConfig, buildTtiPayload, offerIsProperty,
  PROBE_CANDIDATES } from './_lib/offers/tti.js';
import { normaliseOffers, callOffersProxy } from './cron/refresh-map-offers.js';

// One click, a handful of codes. Enough to check a list is sane without
// becoming a way to sweep inventory.
const MAX_CODES = 10;
const DEEPLINK_BASE = 'https://dl.tvllnk.com/deeplink/';
const CONCURRENCY = 2;
// The pin probe is a diagnostic, not the main job, so it gets its own tighter
// budget: a few candidates, a short timeout each, and a hard wall-clock wall it
// will not cross whatever is left to try.
const PROBE_MAX_CANDIDATES = 5;
const PROBE_TIMEOUT_MS = 9000;
const PROBE_DEADLINE_MS = 38000;
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

/** Build the deep link for one property, in the shape Andy's own working links
 *  use: an area search with the property pinned by refn. */
export function deeplinkFor(appId, prop, search) {
  const q = new URLSearchParams();
  q.set('st', search.type === 'Accommodation' ? 'Accommodation' : 'DynamicPackaging');
  q.set('curr', search.currency);
  q.set('nat', search.nationality);
  if (prop.loc) { q.set('loc', prop.loc); q.set('loct', 'City'); }
  else if (prop.ctry) { q.set('ctry', prop.ctry); }
  if (prop.lat != null && prop.lng != null) {
    q.set('lat', String(prop.lat)); q.set('lng', String(prop.lng));
    q.set('rad', String(search.radiusKm || 28));
  }
  q.set('frd', '30');
  q.set('dur', '7');
  q.set('refn', 'TTI:' + prop.code);
  q.set('adt', '2'); q.set('chd', '0'); q.set('inf', '0');
  return DEEPLINK_BASE + encodeURIComponent(appId) + '?' + q.toString();
}

/** Fetch that deep link SERVER-SIDE and report what actually comes back.
 *
 *  Andy's position is that the deep link is the only correct way to run this
 *  search, and he knows Travelify better than this code does. Rather than argue
 *  the point a third time, measure it: follow the link, and report the status,
 *  the redirect chain, the content type, and whether any of it is machine
 *  readable. If there is a session or a JSON surface behind it, this finds it.
 *  If it is an HTML application shell, that is now evidence rather than a claim.
 *
 *  Diagnostic only. Nothing in the product reads offers this way. */
async function probeDeeplink(url) {
  const out = { url, hops: [] };
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const r = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Travelgenix-TtiTest/1.0', Accept: '*/*' },
        signal: AbortSignal.timeout(12000),
      });
      const loc = r.headers.get('location');
      out.hops.push({ status: r.status, contentType: r.headers.get('content-type') || null, location: loc });
      if (loc && r.status >= 300 && r.status < 400) {
        current = new URL(loc, current).toString();
        continue;
      }
      const body = await r.text();
      out.finalUrl = current;
      out.contentType = r.headers.get('content-type') || null;
      out.bytes = body.length;
      try { JSON.parse(body); out.isJson = true; } catch { out.isJson = false; }
      // Enough of the body to recognise an app shell, an error, or a payload.
      out.bodyStarts = body.slice(0, 300).replace(/\s+/g, ' ').trim();
      return out;
    }
    out.error = 'too many redirects';
    return out;
  } catch (e) {
    out.error = (e && e.name === 'TimeoutError') ? 'timed out after 12s' : (e && e.message) || 'failed';
    return out;
  }
}

/** Why one property could not be found: is the pin ignored, or is the code wrong?
 *
 *  THE EVIDENCE THAT SEPARATES THEM. A pinned search and an UNPINNED one are
 *  fired at the same property in the same area. If both return the same
 *  surrounding area, refn did nothing and the property is simply not in the
 *  cheapest slice of a whole country — our ask is wrong, not the code. If the
 *  pinned one returns dramatically less, the pin IS honoured and the code is
 *  the thing to look at. Then the remaining spellings are tried in case one of
 *  them is the parameter the feed actually wants.
 *
 *  This is the open question in docs/tti-offers-handover.md, moved from a
 *  document nobody can run to the button the agent is already pressing. If a
 *  candidate wins here, set TTI_PROPERTY_PARAM on Vercel to its name and the
 *  sweep uses it that night: no code change.
 *
 *  Bounded and diagnostic: one property per click, at most PROBE_MAX_CANDIDATES
 *  extra requests, and it stops at the deadline rather than holding the
 *  function open. */
async function probePin(appId, prop, search, startedAt) {
  const tried = [];
  // The control first. It is the cheapest and the most informative single
  // request in the whole endpoint.
  const order = [{ shape: 'none' }].concat(
    PROBE_CANDIDATES.filter((c) => c.param && !(c.param === 'refn' && c.prefixed)),
  );
  for (const spec of order.slice(0, PROBE_MAX_CANDIDATES)) {
    if (Date.now() - startedAt > PROBE_DEADLINE_MS) break;
    const payload = buildTtiPayload(appId, prop, search, spec);
    if (!payload) continue;
    const r = await callOffersProxy(payload, PROBE_TIMEOUT_MS, 0);
    const label = spec.shape === 'none' ? 'no pin at all'
      : spec.param + (spec.prefixed ? ' (TTI: prefixed)' : '') + (spec.array ? ' (as a list)' : '');
    if (!r || !r.ok) { tried.push({ label, failed: (r && r.error) || 'no answer' }); continue; }
    const raw = (r.data && (r.data.data || r.data.offers)) || [];
    const parsed = normaliseOffers(Array.isArray(raw) ? raw : [], search.type);
    const mine = parsed.filter((o) => offerIsProperty(o, prop.code)).length;
    tried.push({ label, offers: parsed.length, mine, unpinned: spec.shape === 'none' });
    // A candidate that finds the property is the answer. Stop paying for more.
    if (mine > 0 && spec.shape !== 'none') return { code: prop.code, tried, winner: label };
  }
  const control = tried.find((t) => t.unpinned);
  const pinned = tried.filter((t) => !t.unpinned && typeof t.offers === 'number');
  // Same breadth pinned and unpinned means nothing narrowed the search.
  const pinIgnored = !!control && typeof control.offers === 'number' && pinned.length > 0
    && pinned.every((t) => t.offers === control.offers);
  return { code: prop.code, tried, winner: null, pinIgnored };
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
        // The interesting failure, and the one that needs evidence rather than
        // a guess. Three numbers separate the three possible causes:
        //   withRef 0          the feed does not return uniqueRef on this
        //                      product at all, so the verify gate can never
        //                      match and the fault is OURS
        //   refs look foreign  it returns a different identifier shape, so our
        //                      canonicalisation is wrong — also ours
        //   refs look like TTI codes but none is the one asked for
        //                      the pin was ignored and this is a plain area
        //                      search, which is Travelify's behaviour to
        //                      confirm, not our bug
        const refs = parsed.map((o) => o.accommodationUniqueRef).filter(Boolean);
        results[idx] = {
          code: prop.code, status: 'area-only', areaOffers: parsed.length,
          withRef: refs.length,
          sampleRefs: [...new Set(refs)].slice(0, 5),
          sampleHotels: [...new Set(parsed.map((o) => o.hotel).filter(Boolean))].slice(0, 3),
          detail: refs.length
            ? 'The search worked but none of what came back was this property.'
            : 'The search worked, but none of the offers carried a property reference '
              + 'at all, so there was nothing to match the code against.',
        };
      } else {
        results[idx] = { code: prop.code, status: 'empty',
          detail: 'No availability at all in that country right now.' };
      }
    }
  });
  await Promise.all(workers);

  // When the feed could not find the property, follow the DEEP LINK for the
  // first such code and report what it returns. One extra request per click,
  // not per code, and only on the path where we already have no answer.
  let deeplink;
  let pinProbe;
  const firstMiss = props.find((_, n) => results[n] && results[n].status === 'area-only');
  if (firstMiss && body.probeDeeplink !== false) {
    deeplink = await probeDeeplink(deeplinkFor(appId, firstMiss, search));
    // And find out WHY the feed could not find it, which is the question the
    // deep link on its own cannot answer.
    pinProbe = await probePin(appId, firstMiss, search, startedAt);
  }

  const found = results.filter((r) => r.status === 'found').length;
  return res.status(200).json({
    ok: true,
    tested: results.length,
    found,
    // Every code coming back area-only, with a healthy area count, is the
    // signature of the feed ignoring the refn pin rather than of bad codes.
    // True when the shape of the answer says the pin was ignored rather than
    // that the codes are wrong. Deliberately fires on a SINGLE code too: the
    // first person to try this will test one hotel, and making them add a
    // second before we will tell them what we can already see is no help.
    pinLooksIgnored: found === 0
      && results.length > 0
      && results.every((r) => r.status === 'area-only' && r.withRef > 20),
    truncated: rows.length > MAX_CODES ? rows.length - MAX_CODES : undefined,
    deeplink,
    pinProbe,
    results,
  });
}
