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
  canonTti, cleanCtry, cleanCoord, cleanIp, parseDeeplink, buildAccommodationCriteria,
  buildDynamicPackageCriteria, dpOrigins, resultIsProperty, normaliseAccommodationResult,
} from './_lib/offers/tti.js';
import { runSearch } from './_lib/offers/travelify-search.js';
import { resolveArrivalAirport, airportLabel } from './_lib/offers/arrival-airport.js';
import { setJson, getJson } from './_redis.js';

// A live search per property, so this is deliberately small.
const MAX_CODES = 5;
const CONCURRENCY = 2;
// Polls per property. The documented ceiling is 30; a search scoped to one
// property settles long before that, and the route dies at 60s.
const MAX_POLLS = 8;
// Stop starting new work past this, so a slow supplier cannot run the function
// into the platform's own timeout and return an empty body to the browser.
const DEADLINE_MS = 42000;
// Searches, not hotels. A package prices ONE departure airport at a time, so
// three airports across two hotels is six searches and the old per-hotel cap
// counted it as two. This is the number that actually costs money and time.
const MAX_SEARCHES = 6;
// Departure airports per test run. More than this and a single click on Test
// is running a small sweep.
const MAX_ORIGINS = 3;
// Properties we will spend a search on just to find out where they are. Only
// ever needed once per property: the search fills the cache on the way past.
const MAX_LOCATE = 2;
const LOCATE_POLLS = 4;
// The raw exchange handed back for support. One property's request and its
// first matching result, capped: enough to answer "what did you send and what
// came back" without turning every test response into a payload dump.
const RAW_MAX_BYTES = 96 * 1024;

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
      // cleanCoord, NOT Number(). The editor sends lat: null for a row with no
      // coordinates — NaN does not survive JSON — and Number(null) is 0, which
      // is finite, in range, and a real place in the Atlantic. That is how a
      // Bournemouth hotel came to be 5,629km from Cornwall and fly into
      // Newquay (Andy, 14 Sep 2026). cleanCoord has rejected zero since the
      // day this file was written; this one call site was not using it.
      lat: cleanCoord(row.lat, 90), lng: cleanCoord(row.lng, 180),
      radius: Number(row.radius) || undefined,
      locationName: row.locationName || row.loc || '',
      locationType: row.locationType || 'City',
      ctry: cleanCtry(row.ctry || row.countryCode || ''),
      // The arrival airport, when the agent pinned one or a pasted deeplink
      // carried `dst`. Everything else is resolved below.
      dst: String(row.dst || '').trim().toUpperCase(),
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

  // Travelify requires a CustomerIP and refuses the search without one. The
  // agent pressing the button IS the customer here, so their own address is
  // the honest value — never a fabricated one, because the field feeds geo and
  // fraud checks and a wrong IP puts the search in the wrong market.
  const customerIp = cleanIp(
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim() : '')
    || (req.socket && req.socket.remoteAddress) || '',
  );
  if (!customerIp) {
    return res.status(400).json({
      error: 'We could not read your IP address, and Travelify will not run a search '
           + 'without one. Try again, and tell us if it keeps happening.',
    });
  }

  // A dynamic package is a DIFFERENT SEARCH, not a label on this one: it sends
  // flight criteria alongside the hotel and prices the two together. Running
  // the hotel search and calling it a package is what produced hotel-only
  // prices under a package heading (Andy, 14 Sep 2026), so the two paths are
  // kept apart here rather than coerced into one.
  //
  // Declared BEFORE `search`, which reads `origins`. It was below, and a const
  // read before its declaration is a ReferenceError, not undefined — so the
  // whole route 500'd and the browser got Vercel's plain-text error page
  // instead of JSON ("Unexpected token 'A', \"A server e\"...").
  const isDp = String(body.type || 'Accommodation') !== 'Accommodation';
  const origins = Array.isArray(body.origins) ? body.origins : [];
  if (isDp && !origins.length) {
    return res.status(400).json({
      error: 'A flight + hotel package needs a departure airport. Add at least one to '
           + 'Origins, or switch this widget to "The hotel on its own".',
      code: 'dp_needs_origin',
    });
  }

  const search = {
    currency: body.currency, nationality: body.nationality,
    leadDays: body.leadDays, nights: body.nights, adults: body.adults,
    origins, cabinClass: body.cabinClass, directOnly: body.directOnly === true,
    customerIp,
    customerUserAgent: 'Travelgenix-TtiOffersTest/1.0',
  };

  // WHERE EACH PACKAGE FLIES INTO.
  //
  // A leg needs a real airport at both ends. Travelify rejected the hotel's
  // country by name ("Unrecognised 3-letter airport/city code: GB"), and a TTI
  // row carries a property code and a country, never an airport. So it is
  // resolved here, cheapest source first, and NO SEARCH IS SPENT doing it:
  //
  //   1. a code the agent pinned, or a pasted deeplink's own `dst`
  //   2. coordinates already on the row, from a pasted deeplink
  //   3. coordinates in THIS property's cache — free, and already there for
  //      any hotel that has been tested once, which is the common case
  //   4. the country's busiest hub, for a property we have never seen
  //
  // Each step is a fact rather than a guess, and the answer is reported back
  // with HOW it was decided, because "we chose Bristol for a hotel in
  // Bournemouth" is a reasonable call an agent should be able to see and
  // override rather than discover from a price.
  const arrivals = new Map();
  const unplaced = [];
  let locateSearches = 0;
  if (isDp) {
    await Promise.all(rows.map(async (row, idx) => {
      let { lat, lng } = row;
      if (!row.dst && !(Number.isFinite(lat) && Number.isFinite(lng))) {
        try {
          const cached = await getJson(ttiKey(creds.appId, row.code));
          const hit = (cached && Array.isArray(cached.offers) ? cached.offers : [])
            .find((o) => Number.isFinite(o.resortLat) && Number.isFinite(o.resortLng));
          if (hit) { lat = hit.resortLat; lng = hit.resortLng; }
        } catch { /* a cache miss is not a failure, it just costs precision */ }
      }
      const got = resolveArrivalAirport({ dst: row.dst, lat, lng, ctry: row.ctry });
      if (got) arrivals.set(idx, got);
      // AN AIRPORT THE AGENT TYPED IS THE ANSWER, FULL STOP.
      //
      // `unplaced` used to be filled on coordinates alone, so a row carrying an
      // explicit Fly into was still sent to the locate step below, which then
      // overwrote the agent's own choice with a computed one. Typing TFS
      // changed nothing at all, which is the worst way for an override to fail
      // (Andy, 14 Sep 2026).
      if (!row.dst && (!Number.isFinite(lat) || !Number.isFinite(lng))) unplaced.push(idx);
    }));

    // LOCATE, rather than fly to the capital.
    //
    // A country hub is a fair answer for a mainland hotel and a bad one for an
    // island: a property in Santa Cruz de Tenerife resolves to MADRID on the
    // country alone, and a package that lands 1,700km from the hotel is worse
    // than no package. So a property we cannot place gets ONE cheap
    // accommodation search first, purely to read its coordinates — the same
    // search the hotel-only widget runs, and it fills the cache on the way past
    // so this never happens twice for the same property.
    for (const idx of unplaced.slice(0, MAX_LOCATE)) {
      if (Date.now() - startedAt > DEADLINE_MS) break;
      const row = rows[idx];
      const probe = buildAccommodationCriteria(row, search);
      if (!probe) continue;
      locateSearches++;
      const r = await runSearch(creds, probe, { maxPolls: LOCATE_POLLS, pick: 'accommodationResults' });
      const mine = r.ok ? (r.results || []).filter((x) => resultIsProperty(x, row.code)) : [];
      const loc = mine.length && mine[0].location ? mine[0].location : null;
      const lat = cleanCoord(loc && (loc.latitude ?? loc.lat), 90);
      const lng = cleanCoord(loc && (loc.longitude ?? loc.lng), 180);
      if (lat == null || lng == null) continue;

      // MEASURED BEATS TYPED.
      //
      // The country now comes from the PROPERTY, not from the row. A hotel in
      // Tenerife entered with ctry=GB was searched for airports in Great
      // Britain, so the nearest was Newquay — 2,620km away, and correctly
      // computed, which is what made it look like a distance bug rather than a
      // country one (Andy, 14 Sep 2026). The agent's two letters are a hint;
      // the supplier's own answer about where its hotel is, is a fact.
      const found = cleanCtry(loc.countryCode || loc.country || loc.countryISO || '');
      if (found && found !== row.ctry) {
        row.ctryTyped = row.ctry;
        row.ctry = found;          // the DP criteria below use the real one too
      }
      const got = resolveArrivalAirport({ lat, lng, ctry: row.ctry });
      if (got) arrivals.set(idx, { ...got, source: got.source + '-located' });
    }
  }

  // ONE SEARCH PER DEPARTURE AIRPORT.
  //
  // Travelify's flight criteria take Legs, and a leg has a single origin. So
  // "ABZ, GLA, EDI" is three questions, not one wider one, and a hotel tested
  // from three airports costs three searches. Ordered by airport rank so every
  // hotel is tried from the FIRST airport before any hotel is tried from the
  // second: "does this package at all" matters more than "which airport is
  // cheapest", and the cap below bites the second question first.
  const useOrigins = isDp ? dpOrigins(search, MAX_ORIGINS) : [null];
  const jobs = [];
  const unsearchable = new Map();
  for (const origin of useOrigins) {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const arrival = arrivals.get(idx);
      if (isDp && !arrival) {
        unsearchable.set(idx, 'We could not work out which airport this package should fly into. '
          + 'Add the country, or type an arrival airport for this hotel.');
        continue;
      }
      const criteria = isDp
        ? buildDynamicPackageCriteria(row, { ...search, origin, destination: arrival.code })
        : buildAccommodationCriteria(row, search);
      if (!criteria) {
        // Never fall back to a broader search. A row without a country is not
        // a wider question, it is a different one.
        unsearchable.set(idx, 'Add the two-letter country for this hotel, so we know where to look.');
        continue;
      }
      jobs.push({ idx, row, origin, criteria, arrival });
    }
  }
  const dropped = Math.max(0, jobs.length - MAX_SEARCHES);
  jobs.length = Math.min(jobs.length, MAX_SEARCHES);

  // Per hotel, gathered across however many airports it was searched from.
  const perRow = rows.map(() => ({ offers: [], gaps: new Set(), tried: [], failures: [], polls: 0, areaResults: 0, flights: 0 }));
  let shape = null;
  // THE EXCHANGE, VERBATIM. Captured from the first job that returns our
  // property, so a question for Travelify can be answered without spending
  // another live search to go and fetch it. Nothing secret travels in here:
  // the API key lives in an Authorization header and never in the body.
  let raw = null;

  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      const acc = perRow[job.idx];
      const label = job.origin ? `${job.row.code} from ${job.origin}` : job.row.code;

      if (Date.now() - startedAt > DEADLINE_MS) {
        acc.failures.push(`${label}: ran out of time this round. Test fewer hotels, or fewer airports, at once.`);
        continue;
      }

      // Both product types return their properties in accommodationResults —
      // on a package that row carries the property, with the flights alongside
      // in flightResults. `also` counts those, because "0 flights came back"
      // and "this is a hotel-only price" look identical on a card.
      const r = await runSearch(creds, job.criteria, {
        maxPolls: MAX_POLLS,
        pick: 'accommodationResults',
        ...(isDp ? { also: 'flightResults' } : {}),
      });
      acc.tried.push(job.origin || 'hotel-only');
      if (!r.ok) {
        acc.failures.push(`${label}: ${r.error}`);
        if (r.supplierError) acc.supplierError = true;
        continue;
      }
      acc.polls += r.polls || 0;
      acc.areaResults += (r.results || []).length;
      acc.flights += r.alsoCount || 0;

      const mine = (r.results || []).filter((x) => resultIsProperty(x, job.row.code));
      if (!raw && mine.length) {
        const candidate = {
          note: 'The request we sent to POST https://api.travelify.io/search, and the first '
              + 'result that came back for this property. Credentials travel in a header and '
              + 'are not included.',
          code: job.row.code,
          request: job.criteria,
          searchSession: r.session || null,
          polls: r.polls,
          complete: r.complete,
          accommodationResult: mine[0],
          flightResultCount: r.alsoCount || 0,
          flightResult: r.alsoFirst || null,
        };
        // A supplier can return a very large result. Rather than truncate the
        // JSON into something unparseable, drop the biggest optional parts and
        // say which were dropped, so what is handed over is always valid JSON.
        let text = JSON.stringify(candidate);
        if (text.length > RAW_MAX_BYTES) {
          const trimmed = { ...candidate.accommodationResult };
          const dropped = [];
          for (const k of ['descriptions', 'amenities', 'features', 'units', 'optionalExtras', 'media']) {
            if (trimmed[k] !== undefined && text.length > RAW_MAX_BYTES) {
              delete trimmed[k]; dropped.push(k);
              text = JSON.stringify({ ...candidate, accommodationResult: trimmed });
            }
          }
          candidate.accommodationResult = trimmed;
          candidate.droppedForSize = dropped;
        }
        raw = candidate;
      }
      // Record the raw shape ONCE, from whatever came back, so a normaliser
      // built on guesses can be corrected against reality rather than argued
      // about. Keys only — never the full payload.
      if (!shape && r.results && r.results.length) {
        // Prefer OUR property's result: the fields on the hotel the agent
        // actually asked about are the ones worth mapping.
        const sample = mine[0] || r.results[0];
        shape = { resultKeys: Object.keys(sample).slice(0, 60), matched: mine.length };
        // Hunt for anything image-shaped, wherever it sits. Andy, 14 Sep 2026:
        // "every hotel has images" — so a card with no photo means the field is
        // somewhere this normaliser is not looking, and guessing again would
        // waste another round trip. Report the paths instead.
        const found = [];
        const walk = (v, path, depth) => {
          if (found.length >= 8 || depth > 3 || v == null) return;
          if (typeof v === 'string') {
            if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(v) || /(?:image|photo|thumb|media)/i.test(path)) {
              if (/^https?:\/\//.test(v)) found.push({ path, url: v.slice(0, 160) });
            }
            return;
          }
          if (Array.isArray(v)) { v.slice(0, 3).forEach((x, n) => walk(x, path + '[' + n + ']', depth + 1)); return; }
          if (typeof v === 'object') {
            for (const k of Object.keys(v).slice(0, 40)) walk(v[k], path ? path + '.' + k : k, depth + 1);
          }
        };
        walk(sample, '', 0);
        if (found.length) shape.imagePaths = found;
      }

      if (!mine.length) {
        acc.failures.push(`${label}: ${(r.results || []).length
          ? 'the search ran but this property was not among the results.'
          : 'the search ran and returned nothing at all for those dates.'}`);
        continue;
      }

      for (const one of mine) {
        const legs = (job.criteria.FlightSearchCriteria || {}).Legs || [];
        const guests = job.criteria.AccommodationSearchCriteria.Rooms[0].Guests || [];
        const n = normaliseAccommodationResult(one, {
          ctry: job.row.ctry, lat: job.row.lat, lng: job.row.lng,
          locationName: job.row.locationName, currency: job.criteria.Currency,
          checkinDate: job.criteria.AccommodationSearchCriteria.CheckinDate,
          // WHO THE PRICE IS FOR, from the party we actually searched for.
          adults: guests.filter((g) => g.Type === 'Adult').length,
          children: guests.filter((g) => g.Type === 'Child').length,
          infants: guests.filter((g) => g.Type === 'Infant').length,
          // The other end of the flight, and the dates. The card's flight line
          // needs BOTH airports or it draws nothing at all.
          ...(job.arrival ? { destination: job.arrival.code, destinationName: job.arrival.name } : {}),
          ...(job.origin ? { originName: airportLabel(job.origin) } : {}),
          ...(legs[0] ? { outboundDate: legs[0].DepartDate } : {}),
          ...(legs[1] ? { returnDate: legs[1].DepartDate } : {}),
          // A package price belongs to the airport it flies from. This is what
          // makes the stored offer a real package downstream: cached-offers
          // builds a flight block from it, the card draws the Flight + Hotel
          // badge and the departure code, and the widget's own hotel dedupe
          // folds three airports into one card.
          ...(job.origin ? { origin: job.origin } : {}),
          // The bookable link belongs to the SESSION, not to the result, so it
          // comes from the response rather than being built here.
          deeplinkUrl: (r.data && (r.data.deeplinkUrl || r.data.shareUrl)) || null,
        });
        if (!n) continue;
        acc.offers.push(n.offer);
        for (const g of n.unmapped) acc.gaps.add(g);
      }
    }
  });
  await Promise.all(workers);

  const results = await Promise.all(rows.map(async (row, idx) => {
    if (unsearchable.has(idx)) {
      return { code: row.code, status: 'incomplete', detail: unsearchable.get(idx) };
    }
    const acc = perRow[idx];
    if (!acc.tried.length) {
      return { code: row.code, status: 'skipped',
        detail: acc.failures[0] || 'Not reached this round. Test fewer hotels, or fewer airports, at once.' };
    }
    if (!acc.offers.length) {
      return {
        code: row.code,
        // A search that RAN and found nothing is not a failed search: the
        // property has no availability, which is an amber answer, not a red
        // one. Only a request that never completed is a failure. `polls` is
        // the honest test of which happened.
        status: acc.polls ? 'not-in-results' : 'failed',
        detail: acc.failures.join(' ') || 'Nothing usable came back, so nothing was cached.',
        areaResults: acc.areaResults, polls: acc.polls,
        ...(isDp ? { airports: acc.tried, flightResults: acc.flights } : {}),
        ...(acc.supplierError ? { supplierError: true } : {}),
      };
    }

    // One offer per hotel per airport, cheapest kept. Three airports should
    // give a visitor three prices to choose between, not the same hotel three
    // times at whatever each supplier happened to quote.
    const best = new Map();
    for (const o of acc.offers) {
      const k = (o.origin || '') + '|' + (o.checkinDate || '');
      const cur = best.get(k);
      if (!cur || o.price < cur.price) best.set(k, o);
    }
    const offers = [...best.values()].sort((a, b) => a.price - b.price);
    const cheapest = offers[0];
    const wrote = await setJson(ttiKey(creds.appId, row.code), {
      offers, refreshedAt: new Date().toISOString(),
    });

    return {
      code: row.code, status: 'found', offers: offers.length, cached: !!wrote,
      hotel: cheapest.hotel, fromPrice: cheapest.price, currency: cheapest.currency,
      checkinDate: cheapest.checkinDate, nights: cheapest.nights,
      image: cheapest.image ? true : false,
      polls: acc.polls,
      ...(isDp ? {
        airports: acc.tried,
        flyInto: (arrivals.get(idx) || {}).code || null,
        flyIntoName: (arrivals.get(idx) || {}).name || null,
        flyIntoWhy: (arrivals.get(idx) || {}).source || null,
        // The row says one country and the supplier says another. Worth saying
        // out loud: the typed one is what every OTHER search for this property
        // will use until it is corrected.
        ...(rows[idx].ctryTyped ? { countryWas: rows[idx].ctryTyped, countryIs: rows[idx].ctry } : {}),
        flyIntoKm: (arrivals.get(idx) || {}).km ?? null,
        // A nearby bigger airport, offered rather than chosen. A small airport
        // has thin routes, so this is the one-box fix when a package comes
        // back empty from a local field but would exist from a hub.
        flyIntoAlt: (arrivals.get(idx) || {}).alt || null,
        // What the price actually covers. A package that found no flights is a
        // hotel price under a package heading, which is the exact thing Andy
        // reported, so it is said out loud rather than left to be assumed.
        flightResults: acc.flights,
        pricedFrom: offers.map((o) => o.origin).filter(Boolean),
      } : {}),
      ...(acc.failures.length ? { notes: acc.failures } : {}),
      ...(acc.gaps.size ? { unmapped: [...acc.gaps] } : {}),
    };
  }));

  const found = results.filter((r) => r && r.status === 'found').length;
  return res.status(200).json({
    ok: true,
    tested: rows.length,
    found,
    cached: results.filter((r) => r && r.cached).length,
    searches: jobs.length + locateSearches,
    ...(isDp ? { airports: useOrigins } : {}),
    ...(dropped ? {
      dropped,
      droppedNote: `${dropped} search${dropped === 1 ? '' : 'es'} skipped to stay inside one click. `
        + 'Test fewer hotels, or fewer departure airports, at a time.',
    } : {}),
    elapsedMs: Date.now() - startedAt,
    shape,
    raw,
    results,
  });
}
