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
 * HOW A PROPERTY IS ASKED FOR (read this before debugging an empty sweep)
 *   Taken from two real deep links Andy supplied, 14 Sep 2026, one
 *   DynamicPackaging and one Accommodation. Both pin a property the same way:
 *
 *     st=Accommodation &loc=Dubai,+United+Arab+Emirates &loct=City
 *       &lat=25.049 &lng=55.118 &rad=28 &fr=... &dur=7 &refn=TTI:12345 &adt=2
 *
 *   So the location is the CITY at city scale, and the property is pinned by
 *   refn=TTI:{code} alone. There is no loct=Property and no tight pin — refn is
 *   a refinement laid over an ordinary area search. buildTtiPayload mirrors it.
 *
 *   That is also why this job can run before anyone has confirmed the FEED
 *   honours refn, which is a different surface from the deep link. If it does,
 *   one request returns that property. If it is ignored, the SAME request
 *   returns the surrounding area and the verify gate keeps only our property
 *   out of it. Identical request count either way, and the wrong-parameter case
 *   degrades to fewer offers rather than to wrong ones.
 *
 *   To confirm which is happening: GET this route with
 *   ?probe=1&tti={code}&appId={app}&name={city}&ctry={cc}&lat=&lng=. It fires
 *   one request per pin spelling plus one deliberately unpinned, holding the
 *   area scope constant so only one variable moves, and reports how many offers
 *   came back and how many were actually that property. A pin is honoured when
 *   its offers are ALL that property while the unpinned run's are not.
 *   TTI_PROPERTY_PARAM then overrides the default spelling, no code change.
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
import { runSearch } from '../_lib/offers/travelify-search.js';
import { resolveArrivalAirport, airportLabel } from '../_lib/offers/arrival-airport.js';
import {
  normaliseOffers,
  callOffersProxy,
  compactOffer,
  airtableList,
} from './refresh-map-offers.js';

// ── Config ────────────────────────────────────────────────────────────────
const WIDGETS_TABLE = 'tblVAThVqAjqtria2'; // Widgets (appAYzWZxvK6qlwXK)
const WIDGET_TYPE = 'TTI Offers';

// The customer address every Travelify search requires. A cron has no visitor,
// so there is nobody's address to send, and one MUST NOT be invented: the field
// feeds geo and fraud checks, so a wrong value runs the whole sweep in the wrong
// market and caches the wrong prices. Set TTI_CUSTOMER_IP on the deployment to
// the address these searches should be attributed to.
//
// Unset, the sweep does NOTHING and says so. That is deliberate and it is the
// safe direction: the cache keeps whatever is in it rather than being refreshed
// from a search that would be priced for the wrong place.
const CUSTOMER_IP = cleanIp(process.env.TTI_CUSTOMER_IP || '');
// Polls per property. The documented ceiling is 30 at a second apart; a search
// scoped to one property settles long before that, and a nightly run has many
// properties to get through.
const CRON_MAX_POLLS = 10;
// Departure airports swept per package property per night. Travelify prices
// ONE origin per search, so this is a straight multiplier on the nightly bill:
// a widget offering six airports would otherwise cost six searches a night for
// every hotel on it. Three is enough to give a visitor a real choice.
const CRON_MAX_ORIGINS = 3;

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
  buildAccommodationCriteria,
  buildDynamicPackageCriteria,
  dpOrigins,
  cheapestFlight,
  normaliseAccommodationResult,
  resultIsProperty,
  cleanIp,
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

    // The whole credentials now, not just the App ID: the booking API uses
    // Token auth, so the key travels with every search.
    let creds = appIdCache.get(cacheKey);
    if (creds === undefined) {
      try {
        creds = (clientRecordId ? await lookupClientCredentialsByRecordId(clientRecordId) : null)
             || (clientEmail ? await lookupClientCredentialsByEmail(clientEmail) : null);
      } catch (e) {
        creds = null;
      }
      appIdCache.set(cacheKey, creds);
    }
    const appId = creds && creds.appId ? String(creds.appId).trim() : '';
    if (!appId || !/^\d{1,10}$/.test(appId) || !(creds && creds.apiKey)) {
      skipped.push({ widget: f.WidgetID || row.id, why: 'no Travelify credentials on the owning account' });
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
          appId, apiKey: creds.apiKey, code: p.code, name: p.name, ctry: p.ctry,
          lat: p.lat, lng: p.lng, radius: p.radius, locationName: p.locationName || p.name,
          // The arrival airport an agent pinned, if any. Resolved to a real
          // code later, once per property.
          dst: p.dst || '',
          // A departure this hotel travels on, and how long for. Overrides the
          // widget's window for this property only.
          ...(p.checkin ? { checkin: p.checkin } : {}),
          ...(p.nights ? { nights: p.nights } : {}),
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
        if (!existing.dst && p.dst) existing.dst = p.dst;
        if (!existing.checkin && p.checkin) { existing.checkin = p.checkin; existing.nights = p.nights; }
        if (!Number.isFinite(existing.lat) && Number.isFinite(p.lat)) {
          existing.lat = p.lat; existing.lng = p.lng;
        }
        // A FIXED DEPARTURE IS ITS OWN SEARCH, not a window to widen.
        //
        // Two widgets can name the same hotel on different dates — a half-term
        // package and a January one — and neither is a superset of the other.
        // Merging them on type alone would let whichever loaded first decide
        // the date for both, so the second widget's offers would never exist.
        // They share one cache key and the read side keeps both.
        const same = existing.searches.find((sr) => sr.type === search.type
          && (sr.checkinDate || '') === (search.checkinDate || ''));
        if (same) {
          // Same product, same departure, different window: the wider one wins
          // so neither widget is starved of the dates it asked for.
          same.DatesMin = Math.min(same.DatesMin, search.DatesMin);
          same.DatesMax = Math.max(same.DatesMax, search.DatesMax);
          same.leadDays = Math.min(same.leadDays, search.leadDays);
          // And the union of the airports, so the second widget's departure
          // points are not silently dropped by the first widget getting there
          // first. dpOrigins caps what is actually swept.
          for (const o of (search.origins || [])) {
            if (!same.origins.includes(o)) same.origins.push(o);
          }
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
/** One property, one real search.
 *
 *  REBUILT on the booking API (14 Sep 2026). This used to ask
 *  widgetsvc/traveloffers for a country's worth of offers and sieve them for
 *  one hotel, which could never work: 250 offers for Great Britain sorted
 *  cheapest-first will not contain one named property. It now runs the same
 *  search the editor's Test button runs, which is proven — Andy watched it
 *  cache a real Hilton Bournemouth offer and render it.
 *
 *  A package is a DIFFERENT search rather than a label: it sends flight
 *  criteria alongside the hotel and prices the two together. Asking for one and
 *  storing the other is what put hotel-only prices under a package heading. */
async function fetchProperty(item, search, origin = null) {
  const isDp = search.type !== 'Accommodation';
  const opts = {
    ...search, customerIp: CUSTOMER_IP, customerUserAgent: 'Travelgenix-TtiOffersCron/1.0',
    ...(origin ? { origin } : {}),
    // Where the package lands. Resolved from whatever the row knows — a
    // pinned code, a pasted deeplink's coordinates, otherwise the country's
    // hub. A leg will not take a country code, so without this there is no
    // package and fetchProperty returns null rather than searching blind.
    ...(isDp ? { destination: (item.arrival && item.arrival.code) || '' } : {}),
  };
  const criteria = isDp
    ? buildDynamicPackageCriteria(item, opts)
    : buildAccommodationCriteria(item, opts);
  // No criteria means the row cannot be searched — no area, or a package with
  // no departure airport. Skipping is right; a broader search would spend
  // Travelify capacity on somewhere nobody asked about.
  if (!criteria) return null;

  const r = await runSearch({ appId: item.appId, apiKey: item.apiKey }, criteria, {
    maxPolls: CRON_MAX_POLLS,
    pick: 'accommodationResults',
    ...(isDp ? { also: 'flightResults' } : {}),
  });
  if (!r.ok) return null;

  const results = r.results || [];
  // A package is priced from the cheapest flight PLUS the hotel. No flight
  // means no package, and the night is left without one for this origin rather
  // than caching a hotel price behind a Flight + Hotel badge.
  const { flight } = isDp ? cheapestFlight(r.alsoResults) : { flight: null };
  if (isDp && !flight) return { returned: results.length, parsed: 0, verified: [], flights: r.alsoCount || 0 };
  const verified = [];
  for (const one of results) {
    if (!resultIsProperty(one, item.code)) continue;
    const legs = (criteria.FlightSearchCriteria || {}).Legs || [];
    const guests = criteria.AccommodationSearchCriteria.Rooms[0].Guests || [];
    const n = normaliseAccommodationResult(one, {
      ctry: item.ctry, lat: item.lat, lng: item.lng,
      locationName: item.locationName,
      currency: criteria.Currency,
      checkinDate: criteria.AccommodationSearchCriteria.CheckinDate,
      // The party the price is for. The card prints "2 adults" from this and
      // falls back to the bare word "Travellers" without it, so a nightly
      // refresh that dropped it would quietly undo the cards the Test button
      // produced.
      adults: guests.filter((g) => g.Type === 'Adult').length,
      children: guests.filter((g) => g.Type === 'Child').length,
      infants: guests.filter((g) => g.Type === 'Infant').length,
      // Which airport this price flies from, under the name the rest of the
      // product uses. It is what turns this into a real package downstream:
      // a flight block, the Flight + Hotel badge, and the dedupe key below.
      ...(origin ? { origin, originName: airportLabel(origin) } : {}),
      // And where it lands, plus the dates. The card's flight line needs BOTH
      // ends or it draws nothing at all.
      ...(isDp && item.arrival ? { destination: item.arrival.code, destinationName: item.arrival.name } : {}),
      ...(legs[0] ? { outboundDate: legs[0].DepartDate } : {}),
      ...(legs[1] ? { returnDate: legs[1].DepartDate } : {}),
      ...(flight ? { flight } : {}),
      deeplinkUrl: (r.data && (r.data.deeplinkUrl || r.data.shareUrl)) || null,
    });
    if (n && n.offer) verified.push(n.offer);
  }
  return { returned: results.length, parsed: results.length, verified, flights: r.alsoCount || 0 };
}

/** Sweep every product type one property was asked for, and pool the results.
 *  Returns null only when EVERY request failed — a partial failure still
 *  stores what did come back, because a hotel-only widget should not go blank
 *  because the package request timed out.
 *
 *  A PACKAGE IS ONE SEARCH PER DEPARTURE AIRPORT, not one search carrying a
 *  list. Travelify's flight criteria take Legs and a leg has a single origin,
 *  so a widget offering Aberdeen, Glasgow and Edinburgh is three searches and
 *  three prices. Capped at CRON_MAX_ORIGINS, because this multiplies the
 *  nightly bill by every airport a client adds. */
async function fetchPropertyAllTypes(item) {
  // Resolved once per property rather than once per airport: the arrival
  // airport depends on the HOTEL, not on where the visitor flies from.
  //
  // The sweep has no cache read of its own for this: it uses what the row
  // carries. A property whose widget was built from a pasted deeplink has
  // coordinates and gets its nearest major; one with only a country gets that
  // country's hub. Both are honest, and the editor shows an agent which it is
  // so they can pin a better one.
  if (!item.arrival) {
    let { lat, lng } = item;
    // WHAT WE MEASURED LAST NIGHT BEATS WHAT SOMEBODY TYPED.
    //
    // The row carries whatever country an agent entered, and a hotel in
    // Tenerife typed as GB resolved to Newquay — correctly computed, entirely
    // wrong (Andy, 14 Sep 2026). The cached offer for this very property holds
    // the supplier's own coordinates and country, so read them: one Redis get
    // against a key this job is about to overwrite anyway.
    if (!item.dst && !(Number.isFinite(lat) && Number.isFinite(lng))) {
      try {
        const cached = await getJson(ttiKey(item.appId, item.code));
        const hit = (cached && Array.isArray(cached.offers) ? cached.offers : [])
          .find((o) => Number.isFinite(o.resortLat) && Number.isFinite(o.resortLng));
        if (hit) {
          lat = hit.resortLat; lng = hit.resortLng;
          const found = cleanCtry(hit.countryCode || '');
          if (found) item.ctry = found;
        }
      } catch { /* a cache miss only costs precision, never the sweep */ }
    }
    item.arrival = resolveArrivalAirport({ dst: item.dst, lat, lng, ctry: item.ctry });
  }
  const asks = [];
  for (const sr of item.searches) {
    if (sr.type === 'Accommodation') { asks.push([sr, null]); continue; }
    for (const origin of dpOrigins(sr, CRON_MAX_ORIGINS)) asks.push([sr, origin]);
  }
  const results = await Promise.all(asks.map(([sr, origin]) => fetchProperty(item, sr, origin)));
  const ok = results.filter(Boolean);
  if (!ok.length) return null;
  return {
    returned: ok.reduce((n, r) => n + r.returned, 0),
    parsed: ok.reduce((n, r) => n + r.parsed, 0),
    verified: ok.flatMap((r) => r.verified),
    searches: asks.length,
    flights: ok.reduce((n, r) => n + (r.flights || 0), 0),
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
    // `origin` was already in this key, and now carries the departure airport:
    // the same hotel on the same dates from Aberdeen and from Glasgow is two
    // offers at two prices, and both are kept.
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
  const results = [];
  // Every candidate runs against the SAME area scope, so the only thing moving
  // between them is the pin. One of them is deliberately unpinned, and that one
  // is the baseline the others are read against.
  for (const cand of PROBE_CANDIDATES) {
    const r = await fetchProperty(item, search, cand);
    const unpinned = cand.shape === 'none';
    results.push({
      pin: unpinned ? '(none — the area search on its own)' : cand.param,
      shape: unpinned
        ? 'control, and the fallback the sweep runs on if nothing narrows'
        : (cand.array ? 'array' : 'single') + (cand.prefixed ? ', TTI: prefixed' : ', bare code'),
      requestFailed: r === null,
      returned: r ? r.returned : 0,
      parsed: r ? r.parsed : 0,
      matchedProperty: r ? r.verified.length : 0,
      // A pin that is HONOURED returns only the asked-for property. A pin
      // Travelify ignored returns the same broad area as the unpinned run.
      looksHonoured: !unpinned && !!(r && r.parsed > 0 && r.verified.length === r.parsed),
    });
  }
  const control = results.find((r) => r.pin.startsWith('(none'));
  const honoured = results.filter((r) => r.looksHonoured);
  return {
    code: prop.code,
    loc: prop.loc || prop.name || null,
    appId,
    scope: {
      note: 'held constant across every candidate, mirroring the real deep links',
      loc: prop.loc || prop.name || null,
      ctry: prop.ctry || null,
      lat: prop.lat ?? null,
      lng: prop.lng ?? null,
      rad: search.radiusKm,
    },
    candidates: results,
    verdict: honoured.length
      ? honoured.map((r) => `${r.pin} (${r.shape})`)
      : ['no pin narrowed the result. The sweep still works: the area search '
         + 'plus the verify gate keeps only this property, just less completely.'],
    // The one number that says whether the fallback alone is good enough.
    fallbackUsable: !!(control && control.matchedProperty > 0),
    howToRead: 'A candidate whose matchedProperty equals its parsed count, while the '
      + 'unpinned control returned a broader set, is a pin Travelify honours. Set '
      + 'TTI_PROPERTY_PARAM to its name on Vercel (plus TTI_PROPERTY_PARAM_ARRAY=1 '
      + 'and/or TTI_PROPERTY_PARAM_PREFIXED=1 to match its shape). If none narrows '
      + 'but fallbackUsable is true, leave it as it is: the default refn pin costs '
      + 'nothing extra and the verify gate is doing the work.',
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
  // No customer address, no sweep. Every Travelify search requires one and a
  // cron has no visitor to take it from, so it comes from TTI_CUSTOMER_IP. It
  // must never be invented: the field feeds geo and fraud checks, and a wrong
  // one runs the whole sweep in the wrong market and caches prices for the
  // wrong place — which looks exactly like working.
  //
  // Refusing leaves the cache as it is. That is the safe direction: a widget
  // keeps yesterday's real offers rather than being refreshed with wrong ones,
  // and the read side's own staleness guard retires them if this persists.
  if (!CUSTOMER_IP) {
    console.warn('[tti-cron] TTI_CUSTOMER_IP is not set — sweep skipped, cache left untouched');
    return res.status(200).json({
      ok: false,
      skipped: 'no-customer-ip',
      error: 'TTI_CUSTOMER_IP is not set on this deployment. Every Travelify search needs a '
           + 'customer address and a cron has no visitor to take one from. Nothing was '
           + 'written, so existing cached offers are untouched.',
    });
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
      const num = (v, limit) => {
        const n = Number(String(v == null ? '' : v).trim());
        return (Number.isFinite(n) && n !== 0 && Math.abs(n) <= limit) ? n : null;
      };
      const prop = {
        code,
        loc: cleanName(q.loc || q.name),
        ctry: cleanCtry(q.ctry),
        lat: num(q.lat, 90),
        lng: num(q.lng, 180),
      };
      if (!prop.loc && !prop.ctry && prop.lat == null) {
        return res.status(400).json({
          ok: false,
          error: 'the probe needs an area to search in as well as the code: add '
               + '&loc={city} and/or &ctry={cc} and/or &lat=&lng=. Without one every '
               + 'candidate would be a worldwide search and none of them comparable.',
        });
      }
      const report = await runProbe(appId, prop, search);
      return res.status(200).json({ ok: true, probe: true, ...report, ms: Date.now() - startedAt });
    }

    // ── Sweep ─────────────────────────────────────────────────────────────
    const { work, widgets, skipped } = await collectWork();

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
        ? `every offer returned under the '${PROPERTY_PARAM || 'refn'}' pin was for a `
          + 'different property, so either the pin is ignored AND the area searched is too '
          + 'wide for these hotels to surface in, or the codes are wrong. Re-run with '
          + '?probe=1 to see which, and narrow the area with coordinates if it is the former.'
        : undefined,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[tti-cron] failed:', err && err.message);
    return res.status(500).json({ ok: false, error: err && err.message });
  }
}
