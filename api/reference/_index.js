/**
 * Reference lookup index + matcher — the bridge between a visitor's question
 * and the shared reference layer (Countries + Airports).
 *
 * Deterministic, no AI: detects which countries and airports a query mentions
 * (by country name + a few aliases, by IATA code, by airport city/name) and
 * returns the verified facts so the chatbot can ground its answer. No model
 * call here means no chance of the lookup itself inventing anything.
 *
 * The index is built once and cached in module memory (1h TTL) so warm
 * invocations are instant.
 */

import { listAll, COUNTRIES_TBL, AIRPORTS_TBL, CF, AF } from './_ref.js';

const TTL_MS = 60 * 60 * 1000;
let _cache = null;
let _cacheAt = 0;

// Common informal names mapped to the country name as stored.
const ALIASES = {
  uk: 'United Kingdom', britain: 'United Kingdom', england: 'United Kingdom',
  scotland: 'United Kingdom', wales: 'United Kingdom',
  usa: 'USA', us: 'USA', america: 'USA', 'united states': 'USA',
  uae: 'UAE', dubai: 'UAE', 'abu dhabi': 'UAE',
  holland: 'Netherlands',
};

function clamp(s, n) { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n) : s; }
function low(s) { return String(s || '').toLowerCase(); }

/** Build (or return cached) lookup index from the reference base. */
export async function getIndex() {
  if (_cache && Date.now() - _cacheAt < TTL_MS) return _cache;

  const [countries, airports] = await Promise.all([
    listAll(COUNTRIES_TBL, [CF.name, CF.visaStatus, CF.visaAdvisory, CF.health, CF.currency, CF.language, CF.timezone, CF.flightTime, CF.bestTime, CF.status]),
    listAll(AIRPORTS_TBL, [AF.name, AF.iata, AF.cityServed, AF.countryText, AF.distance, AF.terminals, AF.train, AF.coach, AF.taxi, AF.lounges, AF.arrival, AF.status]),
  ]);

  const countryByName = new Map(); // lowercased name -> record
  for (const c of countries) {
    const name = c.fields[CF.name];
    if (name) countryByName.set(low(name), c);
  }
  const airportByIata = new Map();  // UPPER iata -> record
  const airportByCity = new Map();  // lowercased city -> record
  for (const a of airports) {
    const iata = (a.fields[AF.iata] || '').toUpperCase().trim();
    if (iata) airportByIata.set(iata, a);
    const city = low(a.fields[AF.cityServed]);
    if (city) airportByCity.set(city, a);
  }

  _cache = { countryByName, airportByIata, airportByCity, builtAt: Date.now(), counts: { countries: countries.length, airports: airports.length } };
  _cacheAt = Date.now();
  return _cache;
}

function wordHit(haystackLower, needleLower) {
  if (!needleLower || needleLower.length < 3) return false;
  const esc = needleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, 'i').test(haystackLower);
}

/**
 * Detect reference entities in a free-text query. Pure function for testability.
 * @returns { countries: record[], airports: record[] }
 */
export function matchEntities(index, query, { maxEach = 3 } = {}) {
  const q = String(query || '');
  const ql = low(q);
  const countries = [];
  const airports = [];
  const seenC = new Set();
  const seenA = new Set();

  // Countries by stored name.
  for (const [name, rec] of index.countryByName) {
    if (countries.length >= maxEach) break;
    if (wordHit(ql, name) && !seenC.has(rec.id)) { countries.push(rec); seenC.add(rec.id); }
  }
  // Countries by alias.
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (countries.length >= maxEach) break;
    if (wordHit(ql, alias)) {
      const rec = index.countryByName.get(low(canonical));
      if (rec && !seenC.has(rec.id)) { countries.push(rec); seenC.add(rec.id); }
    }
  }

  // Airports by IATA (uppercase 3-letter tokens in the original query).
  const iataTokens = (q.match(/\b[A-Z]{3}\b/g) || []);
  for (const tok of iataTokens) {
    if (airports.length >= maxEach) break;
    const rec = index.airportByIata.get(tok);
    if (rec && !seenA.has(rec.id)) { airports.push(rec); seenA.add(rec.id); }
  }
  // Airports by city served.
  for (const [city, rec] of index.airportByCity) {
    if (airports.length >= maxEach) break;
    if (wordHit(ql, city) && !seenA.has(rec.id)) { airports.push(rec); seenA.add(rec.id); }
  }

  return { countries, airports };
}

/** Render matches as a compact, clearly-trusted grounding block for the model. */
export function formatContext(matches) {
  const lines = [];
  for (const c of matches.countries) {
    const f = c.fields;
    const bits = [];
    if (f[CF.visaStatus]) bits.push(`Visa (UK): ${typeof f[CF.visaStatus] === 'object' ? f[CF.visaStatus].name : f[CF.visaStatus]}`);
    if (f[CF.visaAdvisory]) bits.push(`Visa detail: ${clamp(f[CF.visaAdvisory], 240)}`);
    if (f[CF.currency]) bits.push(`Currency: ${f[CF.currency]}`);
    if (f[CF.language]) bits.push(`Language: ${f[CF.language]}`);
    if (f[CF.timezone]) bits.push(`Time: ${f[CF.timezone]}`);
    if (f[CF.flightTime]) bits.push(`Flight from UK: ${f[CF.flightTime]}`);
    if (f[CF.health]) bits.push(`Health: ${clamp(f[CF.health], 240)}`);
    lines.push(`Country — ${f[CF.name]}: ${bits.join('. ')}.`);
  }
  for (const a of matches.airports) {
    const f = a.fields;
    const bits = [];
    if (f[AF.distance]) bits.push(`Location: ${clamp(f[AF.distance], 240)}`);
    if (f[AF.terminals]) bits.push(`Terminals: ${clamp(f[AF.terminals], 220)}`);
    if (f[AF.train]) bits.push(`Train: ${clamp(f[AF.train], 200)}`);
    if (f[AF.taxi]) bits.push(`Taxi: ${clamp(f[AF.taxi], 160)}`);
    if (f[AF.lounges]) bits.push(`Lounges: ${clamp(f[AF.lounges], 200)}`);
    if (f[AF.arrival]) bits.push(`Arrive: ${clamp(f[AF.arrival], 160)}`);
    lines.push(`Airport — ${f[AF.name]} (${f[AF.iata]}), serves ${f[AF.cityServed] || ''} ${f[AF.countryText] || ''}: ${bits.join('. ')}.`);
  }
  if (!lines.length) return '';
  return 'VERIFIED TRAVEL REFERENCE (trusted shared data, safe to state as fact):\n' + lines.join('\n');
}

/** Shape matches for a JSON API response (compact). */
export function shapeMatches(matches) {
  return {
    countries: matches.countries.map(c => ({
      name: c.fields[CF.name],
      visaStatusUK: typeof c.fields[CF.visaStatus] === 'object' ? c.fields[CF.visaStatus]?.name : c.fields[CF.visaStatus] || null,
      visaAdvisory: c.fields[CF.visaAdvisory] || null,
      currency: c.fields[CF.currency] || null,
      language: c.fields[CF.language] || null,
      timeZone: c.fields[CF.timezone] || null,
      flightTimeFromUK: c.fields[CF.flightTime] || null,
      healthNotes: c.fields[CF.health] || null,
    })),
    airports: matches.airports.map(a => ({
      name: a.fields[AF.name],
      iata: a.fields[AF.iata],
      cityServed: a.fields[AF.cityServed] || null,
      country: a.fields[AF.countryText] || null,
      distance: a.fields[AF.distance] || null,
      terminals: a.fields[AF.terminals] || null,
      train: a.fields[AF.train] || null,
      taxi: a.fields[AF.taxi] || null,
      lounges: a.fields[AF.lounges] || null,
      recommendedArrival: a.fields[AF.arrival] || null,
    })),
  };
}
