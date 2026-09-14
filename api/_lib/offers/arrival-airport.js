/**
 * Which airport a dynamic package FLIES INTO.
 *
 * Travelify's flight legs want a real 3-letter code at both ends. It said so
 * by name on 14 Sep 2026, after we sent the hotel's country:
 *
 *   FlightSearchCriteria - Legs[0] - DestinationCode:
 *     Unrecognised 3-letter airport/city code: GB
 *
 * A country is not a place a plane lands. So a package needs an arrival
 * airport, and a TTI row carries a property code and a country — never an
 * airport. This module is where that gap is closed.
 *
 * THE LIST. api/_data/airports-arrivals.json — every large or medium airport
 * worldwide with scheduled service and an IATA code, with coordinates, from
 * OurAirports. Scheduled service is the filter that matters: it is what makes
 * an airport somewhere a package can actually land.
 *
 * It was built for this job because neither existing list could do it. The
 * departures list has 3,242 airports and no coordinates; the curated majors
 * have coordinates and only 106 airports. So a hotel in Bournemouth resolved
 * to BRISTOL, 95km away, while Bournemouth Airport sat in neither usable list
 * (Andy, 14 Sep 2026: "why is it choosing Bristol when there is an airport in
 * Bournemouth?"). The answer was that BOH was not a candidate at all, which is
 * a gap in the data rather than a judgement about the airport — so the data
 * was fixed. Rebuild with scripts/build-arrival-airports.mjs.
 *
 * A NEARBY BIGGER AIRPORT IS OFFERED, NOT CHOSEN. The nearest airport is the
 * honest answer to "where does this hotel's package fly into", but a medium
 * airport has thin routes, and a package from Aberdeen to Bournemouth may
 * simply not exist while Aberdeen to Gatwick does. That is a real supplier
 * answer rather than a bug, so it is not papered over: the nearest LARGE
 * airport in the same country comes back alongside as `alt`, the editor shows
 * it, and the agent can switch with one box. Choosing it for them would quote
 * a package from an airport nobody asked about, which is the quiet kind of
 * wrong this widget keeps having to avoid.
 *
 * SAME COUNTRY FIRST. The nearest airport to a hotel in Nice is in Italy often
 * enough to matter, and a package that lands in another country is wrong in a
 * way a price cannot show. So the hotel's own country wins whenever it has a
 * major airport at all, and only a country absent from the list falls through
 * to nearest-overall.
 */

import { readFileSync } from 'node:fs';

// [iata, label, countryCode, lat, lng, isLarge], large first then medium,
// alphabetical within each — so a country's first entry is its biggest airport.
let AIRPORTS = null;

export function arrivalAirports() {
  if (AIRPORTS) return AIRPORTS;
  AIRPORTS = [];
  try {
    const url = new URL('../../_data/airports-arrivals.json', import.meta.url);
    AIRPORTS = JSON.parse(readFileSync(url, 'utf8')).airports || [];
  } catch (err) {
    // Never throw: a package that cannot name an arrival airport is refused
    // by the caller, which is a clean "we did not search" rather than a crash.
    console.error('[offers/arrival-airport] list load failed:', err && err.message);
  }
  return AIRPORTS;
}

/**
 * The 106 curated majors, IN IMPORTANCE ORDER, which is the one thing
 * OurAirports does not give us. It has no passenger numbers, so "large
 * airport" is a runway-and-service classification: Al Maktoum is a large
 * airport 18km from central Dubai and Dubai International is 34km, and pure
 * distance picks the near-empty one. Alphabetical order inside that
 * classification is worse still — it made Aberdeen the hub for Great Britain.
 *
 * So this list stays, for the two jobs it is genuinely good at: naming a
 * country's main airport, and telling us which nearby airports are real hubs.
 */
let MAJORS = null;

export function majorAirports() {
  if (MAJORS) return MAJORS;
  MAJORS = [];
  try {
    const url = new URL('../../_data/airports.json', import.meta.url);
    MAJORS = JSON.parse(readFileSync(url, 'utf8')).airports || [];
  } catch (err) {
    console.error('[offers/arrival-airport] majors load failed:', err && err.message);
  }
  return MAJORS;
}

/** How much further a real hub may be before the genuinely nearest airport
 *  wins. Dubai: DWC 18km vs DXB 34km, so the hub takes it. Bournemouth: BOH
 *  7km vs BRS 94km, so the local airport keeps it, which is the answer an
 *  agent selling Bournemouth expects. */
export const HUB_BONUS_KM = 50;

/** Great-circle distance in km. Good enough to rank airports; this is not
 *  navigation. */
export function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Is this already a usable code? Travelify wants 3 to 11 characters; a plain
 *  IATA code is 3, and its own destination codes (a DP deep link carries
 *  `dst=AE1`) fit the same field. Accepted as given rather than validated
 *  against our list, because their code space is theirs, not ours. */
export function isArrivalCode(v) {
  return /^[A-Z0-9]{3,11}$/.test(String(v || '').trim().toUpperCase());
}

/**
 * The airport a package should fly into.
 *
 *   { code, name, km, source }   or   null when nothing can be said honestly
 *
 * `source` records HOW it was decided, because "we chose Bristol for a hotel
 * in Bournemouth" is a reasonable answer an agent should be able to see and
 * override, while "we chose the only airport in the country" is a different
 * claim entirely. The editor shows it.
 *
 * Preference order, and each step is a real fact rather than a guess:
 *   1. An explicit code (a pasted `dst`, or an arrival airport the agent typed)
 *   2. Nearest major IN THE HOTEL'S COUNTRY, when we know where the hotel is
 *   3. The country's busiest major, when we know the country but not the spot
 *   4. Nearest major anywhere, for a country with no major airport of its own
 */
export function resolveArrivalAirport({ dst, lat, lng, ctry } = {}) {
  const explicit = String(dst || '').trim().toUpperCase();
  if (isArrivalCode(explicit)) {
    return { code: explicit, name: null, km: null, source: 'given' };
  }

  const list = arrivalAirports();
  if (!list.length) return null;
  const country = String(ctry || '').trim().toUpperCase();
  const inCountry = country ? list.filter((a) => a[2] === country) : [];
  const majorsHere = country ? majorAirports().filter((a) => a[2] === country) : [];
  // NEVER Number.isFinite alone: zero is finite, and (0,0) is a real place in
  // the Gulf of Guinea. A row that simply has no coordinates arrives here as
  // 0,0 the moment anything upstream does Number(null), and the nearest
  // airport to null island is Cornwall — which is exactly what happened.
  const haveSpot = Number.isFinite(lat) && Number.isFinite(lng)
    && !(lat === 0 && lng === 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const nearestOf = (pool) => {
    let best = null;
    for (const a of pool) {
      const km = haversineKm(lat, lng, a[3], a[4]);
      // Strictly less-than, so the earlier (bigger) airport keeps a tie.
      if (!best || km < best.km) best = { code: a[0], name: a[1], km: Math.round(km) };
    }
    return best;
  };

  if (haveSpot && inCountry.length) {
    const near = nearestOf(inCountry);
    const hub = majorsHere.length ? nearestOf(majorsHere) : null;
    // A real hub that is barely further away wins: more routes, more chance
    // the package exists at all. Further than that and the local airport is
    // the honest answer to "where does this hotel fly into".
    const hubWins = hub && hub.code !== near.code && hub.km <= near.km + HUB_BONUS_KM;
    const chosen = hubWins ? hub : near;
    const other = hubWins ? near : hub;
    return {
      ...chosen,
      source: hubWins ? 'nearest-hub' : 'nearest-in-country',
      // The alternative is OFFERED, never substituted. A medium airport has
      // thin routes, and a package from Aberdeen to Bournemouth may simply not
      // exist while Aberdeen to Gatwick does — a real supplier answer the agent
      // can act on with one box, rather than one we quietly decide for them.
      ...(other && other.code !== chosen.code ? { alt: other } : {}),
    };
  }

  // No coordinates: the country's MAIN airport, which is the first curated
  // entry because that list is ordered by importance. The arrivals list is
  // alphabetical within its size classes, so its first entry would be a
  // different and much worse answer.
  if (majorsHere.length) {
    const a = majorsHere[0];
    return { code: a[0], name: a[1], km: null, source: 'country-hub' };
  }
  // A country with no curated major still has airports; take its biggest,
  // which is where the large-first ordering of the arrivals list earns its keep.
  if (inCountry.length) {
    const a = inCountry[0];
    return { code: a[0], name: a[1], km: null, source: 'country-hub' };
  }
  if (haveSpot) return { ...nearestOf(list), source: 'nearest-anywhere' };
  return null;
}
