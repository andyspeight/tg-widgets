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
 * THE LIST. api/_data/airports.json, 106 curated majors with coordinates, and
 * deliberately not the 3,242-airport departures list beside it. That file's own
 * header says why: "the package's dst and the venue fact sheets stay on the
 * curated majors in airports.json, because an arrival needs a hub with hotels
 * and inbound flights." A package into a regional strip with no inbound
 * schedule returns nothing, which looks exactly like a hotel with no
 * availability.
 *
 * SAME COUNTRY FIRST. The nearest airport to a hotel in Nice is in Italy often
 * enough to matter, and a package that lands in another country is wrong in a
 * way a price cannot show. So the hotel's own country wins whenever it has a
 * major airport at all, and only a country absent from the list falls through
 * to nearest-overall.
 */

import { readFileSync } from 'node:fs';

// [iata, name, countryCode, lat, lng], ordered busiest-first within a country.
let AIRPORTS = null;

export function arrivalAirports() {
  if (AIRPORTS) return AIRPORTS;
  AIRPORTS = [];
  try {
    const url = new URL('../../_data/airports.json', import.meta.url);
    AIRPORTS = JSON.parse(readFileSync(url, 'utf8')).airports || [];
  } catch (err) {
    // Never throw: a package that cannot name an arrival airport is refused
    // by the caller, which is a clean "we did not search" rather than a crash.
    console.error('[offers/arrival-airport] list load failed:', err && err.message);
  }
  return AIRPORTS;
}

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
  const haveSpot = Number.isFinite(lat) && Number.isFinite(lng);

  const nearestOf = (pool, source) => {
    let best = null;
    for (const a of pool) {
      const km = haversineKm(lat, lng, a[3], a[4]);
      // Strictly less-than, so the earlier (busier) airport keeps a tie.
      if (!best || km < best.km) best = { code: a[0], name: a[1], km: Math.round(km), source };
    }
    return best;
  };

  if (haveSpot && inCountry.length) return nearestOf(inCountry, 'nearest-in-country');
  // The list is busiest-first within a country, so the first entry is the hub.
  if (inCountry.length) {
    const a = inCountry[0];
    return { code: a[0], name: a[1], km: null, source: 'country-hub' };
  }
  if (haveSpot) return nearestOf(list, 'nearest-anywhere');
  return null;
}
