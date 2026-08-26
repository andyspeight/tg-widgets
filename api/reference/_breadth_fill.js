/**
 * Reference breadth auto-fill (two-independent-source model).
 *
 * For an airport the content references but has no record for, the AI verifies
 * its identity against TWO independent, machine-readable sources keyed on the
 * IATA code:
 *   - OurAirports open dataset (CSV)        -> name, municipality, country, lat/lon
 *   - Wikidata (SPARQL by IATA property)    -> label, country, coordinates
 * If the two agree (name corroborates and coordinates are close) the record is
 * identity-verified and can be created as a Draft carrying both source URLs and
 * today's date. If they disagree, or one can't be found, it is flagged for a
 * human — never guessed.
 *
 * IMPORTANT scope: two structured sources can verify an airport's IDENTITY
 * (what/where it is). They cannot supply the rich narrative (lounges, parking
 * prices, transfer detail) the existing records carry, so auto-created records
 * are Draft skeletons for content enrichment, never Live.
 *
 * Verification is per FIELD, not per record (see corroborateFields). Identity
 * agreeing is not enough to write a name or a country: each value has to have
 * been seen by both sources, or it is left blank for a human. runIdentityBackfill
 * applies the same rule to records that already exist but were never sourced.
 *
 * Network note: the build sandbox blocks outbound fetch, so the fetch adapters
 * below are validated on a deploy, not here. The decision logic and parsers
 * are pure and unit-tested. Writes are OFF unless `create:true` is passed.
 */

import { listAll, AIRPORTS_TBL, AF, AIRPORT_STATUS } from './_ref.js';
import { runBreadth } from './_breadth.js';

const OURAIRPORTS_CSV = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const COORD_TOLERANCE_KM = 50;

// ---- pure: normalisation + cross-verification -----------------------------
export function normalizeName(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(airport|international|intl|regional|the)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function nameOverlap(a, b) {
  const ta = new Set(normalizeName(a).split(' ').filter(w => w.length > 2));
  const tb = new Set(normalizeName(b).split(' ').filter(w => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export function haversineKm(aLat, aLon, bLat, bLon) {
  if ([aLat, aLon, bLat, bLon].some(v => typeof v !== 'number' || isNaN(v))) return null;
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Decide whether two independent source records describe the same airport.
 * Pure. Both: { iata, name, city, country, lat, lon }.
 */
export function crossVerify(a, b) {
  const conflicts = [];
  if (!a || !b) return { verified: false, conflicts: ['a source was missing'] };
  if (a.iata && b.iata && a.iata.toUpperCase() !== b.iata.toUpperCase()) conflicts.push('IATA codes differ');

  const overlap = nameOverlap(a.name, b.name);
  const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
  const nameOk = overlap >= 0.5;
  const coordOk = dist == null ? null : dist <= COORD_TOLERANCE_KM;

  if (coordOk === false) conflicts.push(`coordinates ${Math.round(dist)}km apart`);
  // Need positive corroboration: matching name, OR close coordinates.
  const corroborated = nameOk || coordOk === true;
  if (!corroborated) conflicts.push('neither name nor coordinates corroborate');

  return {
    verified: conflicts.length === 0 && corroborated,
    nameOverlap: Number(overlap.toFixed(2)),
    distanceKm: dist == null ? null : Math.round(dist),
    conflicts,
  };
}

/**
 * Decide, FIELD BY FIELD, what the two sources actually agree on. Pure.
 *
 * crossVerify above answers "are these the same airport". That is not the same
 * question as "is this value verified". A record can pass identity on matching
 * coordinates alone while its name, city or country has been seen by only one
 * source. Writing those anyway would single-source them, which is exactly what
 * the airport-spotlight skill exists to prevent.
 *
 * So each field is corroborated on its own terms and an uncorroborated field is
 * left blank for a human rather than filled from one source:
 *   name     both labels describe the same airport (token overlap)
 *   lat/lon  both coordinates agree inside COORD_TOLERANCE_KM
 *   country  both ISO 3166-1 alpha-2 codes match
 *   city     both place names match after normalisation
 *
 * @returns { fields, corroborated: string[], uncorroborated: string[] }
 */
export function corroborateFields(oa, wd) {
  const fields = {};
  const corroborated = [];
  const uncorroborated = [];
  const mark = (key, ok, value) => {
    if (ok && value !== undefined && value !== null && value !== '') {
      fields[key] = value;
      corroborated.push(key);
    } else {
      uncorroborated.push(key);
    }
  };

  // Name: OurAirports carries the fuller official form, so use it as the value,
  // but only once the Wikidata label confirms it is the same airport.
  mark('name', nameOverlap(oa.name, wd.name) >= 0.5, oa.name);

  // Coordinates: only when the two independent fixes agree.
  const dist = haversineKm(oa.lat, oa.lon, wd.lat, wd.lon);
  const coordsAgree = dist != null && dist <= COORD_TOLERANCE_KM;
  mark('lat', coordsAgree, Number.isFinite(oa.lat) ? oa.lat : undefined);
  mark('lon', coordsAgree, Number.isFinite(oa.lon) ? oa.lon : undefined);

  // Country: compare ISO codes, never a code against a display name.
  const oaCc = String(oa.country || '').toUpperCase();
  const wdCc = String(wd.countryCode || '').toUpperCase();
  mark('country', !!oaCc && oaCc === wdCc, oaCc);

  // City: Wikidata's administrative place against OurAirports' municipality.
  const cityAgrees = !!oa.city && !!wd.city && normalizeName(oa.city) === normalizeName(wd.city);
  mark('city', cityAgrees, oa.city);

  return { fields, corroborated, uncorroborated };
}

// ---- pure: source parsers -------------------------------------------------
/** Parse the OurAirports CSV for one IATA. Pure. Returns normalized record or null. */
export function parseOurAirports(csvText, iata) {
  const lines = String(csvText || '').split('\n');
  if (lines.length < 2) return null;
  const header = splitCsvLine(lines[0]);
  const col = name => header.indexOf(name);
  const ciIata = col('iata_code');
  if (ciIata === -1) return null;
  const want = String(iata).toUpperCase();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = splitCsvLine(lines[i]);
    if ((cells[ciIata] || '').toUpperCase() !== want) continue;
    return {
      iata: want,
      name: cells[col('name')] || '',
      city: cells[col('municipality')] || '',
      country: cells[col('iso_country')] || '',
      lat: parseFloat(cells[col('latitude_deg')]),
      lon: parseFloat(cells[col('longitude_deg')]),
      source: OURAIRPORTS_CSV,
    };
  }
  return null;
}

/** Minimal CSV line splitter handling quoted fields. Pure. */
export function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Parse a Wikidata SPARQL JSON result (by IATA) into a normalized record. Pure. */
export function parseWikidataSparql(json, iata) {
  const b = json && json.results && json.results.bindings && json.results.bindings[0];
  if (!b) return null;
  let lat, lon;
  const coord = b.coord && b.coord.value; // "Point(lon lat)"
  if (coord) {
    const m = /Point\(([-\d.]+)\s+([-\d.]+)\)/.exec(coord);
    if (m) { lon = parseFloat(m[1]); lat = parseFloat(m[2]); }
  }
  return {
    iata: String(iata).toUpperCase(),
    name: (b.airportLabel && b.airportLabel.value) || '',
    city: (b.placeLabel && b.placeLabel.value) || '',
    country: (b.countryLabel && b.countryLabel.value) || '',
    countryCode: ((b.iso && b.iso.value) || '').toUpperCase(),
    lat, lon,
    source: b.airport && b.airport.value ? b.airport.value : 'https://www.wikidata.org/',
  };
}

// ---- network adapters (validated on deploy, not in sandbox) ---------------
async function getJson(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'LunaBrain/1.0 (+https://travelify.io)', Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

async function fetchWikidata(iata) {
  // Ask for the ISO country code (P297) and the administrative place (P131) as
  // well as the label and coordinates. Without those two, country and city
  // could only ever come from OurAirports, and a field only one source has
  // seen is not a verified field.
  const q = `SELECT ?airport ?airportLabel ?countryLabel ?iso ?placeLabel ?coord WHERE { ?airport wdt:P238 "${iata}". OPTIONAL { ?airport wdt:P17 ?country. OPTIONAL { ?country wdt:P297 ?iso. } } OPTIONAL { ?airport wdt:P131 ?place. } OPTIONAL { ?airport wdt:P625 ?coord. } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 1`;
  const json = await getJson(`${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(q)}`);
  return json ? parseWikidataSparql(json, iata) : null;
}

let _ourAirportsCache = null;
async function fetchOurAirports(iata) {
  if (!_ourAirportsCache) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(OURAIRPORTS_CSV, { signal: ctrl.signal, headers: { 'User-Agent': 'LunaBrain/1.0 (+https://travelify.io)' } });
      _ourAirportsCache = r.ok ? await r.text() : '';
    } catch { _ourAirportsCache = ''; } finally { clearTimeout(t); }
  }
  return _ourAirportsCache ? parseOurAirports(_ourAirportsCache, iata) : null;
}

// ---- orchestrator ---------------------------------------------------------
/**
 * @param opts.limit   max missing airports to process
 * @param opts.create  if true, create skeletons for verified ones (default false: dry run)
 * @param opts.fetchers test seam: { ourAirports, wikidata, breadth, create } override the live adapters
 * @returns { missing, processed, verified, conflict, unverifiable, created, failed, items[] }
 *          `created` counts records actually written; `failed` counts records
 *          that verified cleanly but whose write threw. The two are separate on
 *          purpose: a write failure is not a verification failure, and neither
 *          may be reported as a success.
 */
export async function runBreadthFill({ limit = 10, create = false, nowIso, fetchers } = {}) {
  const today = (nowIso || new Date().toISOString()).slice(0, 10);
  const getOA = (fetchers && fetchers.ourAirports) || fetchOurAirports;
  const getWD = (fetchers && fetchers.wikidata) || fetchWikidata;
  // Same test seam as `patch` below, so the write-failure path is exercisable
  // without a live Airtable. A run that cannot prove it reports failures
  // honestly is not a run worth pointing at 293 records.
  const getWorklist = (fetchers && fetchers.breadth) || runBreadth;
  const createOne = (fetchers && fetchers.create) || createSkeleton;

  const breadth = await getWorklist();
  const targets = breadth.missing.slice(0, limit);

  const items = [];
  let created = 0, failed = 0;
  for (const t of targets) {
    const [oa, wd] = await Promise.all([getOA(t.iata), getWD(t.iata)]);
    if (!oa || !wd) {
      items.push({ iata: t.iata, verdict: 'unverifiable', reason: !oa && !wd ? 'neither source found' : !oa ? 'not in OurAirports' : 'not in Wikidata' });
      continue;
    }
    const cv = crossVerify(oa, wd);
    if (!cv.verified) {
      items.push({ iata: t.iata, verdict: 'conflict', conflicts: cv.conflicts, oa: oa.name, wd: wd.name });
      continue;
    }
    // Identity holds. Now keep only the individual fields both sources saw.
    const { fields, corroborated, uncorroborated } = corroborateFields(oa, wd);
    const record = {
      iata: t.iata, ...fields,
      source1: oa.source, source2: wd.source, verifiedDate: today,
    };
    // Count the RESULT of the write, never the attempt. Swallowing the error
    // and incrementing anyway is how a run reports 293 records created having
    // created none, which is the same class of untruth the Status audit
    // existed to remove. A verified record that failed to write stays verified
    // and is reported as unwritten, so the next run picks it up again.
    let didCreate = false;
    let writeError = null;
    if (create) {
      try {
        await createOne(record);
        didCreate = true;
        created++;
      } catch (err) {
        writeError = (err && err.message) || String(err);
        failed++;
      }
    }
    items.push({
      iata: t.iata, verdict: 'verified', name: fields.name || oa.name,
      distanceKm: cv.distanceKm, corroborated, uncorroborated, created: didCreate,
      ...(writeError ? { writeError } : {}),
    });
  }

  const summary = { missing: breadth.missingCount, processed: items.length, verified: 0, conflict: 0, unverifiable: 0, created, failed, items };
  for (const it of items) summary[it.verdict === 'verified' ? 'verified' : it.verdict === 'conflict' ? 'conflict' : 'unverifiable']++;
  return summary;
}

/** Map a corroborated record onto Airtable field IDs. Blank fields are omitted,
 *  never written empty, so an uncorroborated value stays visibly missing. Pure. */
export function identityFields(rec) {
  const fields = {
    [AF.iata]: rec.iata,
    [AF.status]: AIRPORT_STATUS.IN_PROGRESS,
    [AF.source1]: rec.source1,
    [AF.source2]: rec.source2,
    [AF.verifiedDate]: rec.verifiedDate,
  };
  if (rec.name) fields[AF.name] = rec.name;
  if (rec.city) fields[AF.cityServed] = rec.city;
  if (rec.country) fields[AF.countryText] = rec.country;
  if (rec.lat != null) fields[AF.latitude] = rec.lat;
  if (rec.lon != null) fields[AF.longitude] = rec.lon;
  return fields;
}

async function createSkeleton(rec) {
  return createAirport(identityFields(rec));
}

// Thin write (kept here so the table id stays with the reference helpers).
async function createAirport(fields) {
  const PAT = process.env.AIRTABLE_DESTINATION_CONTENT_PAT || process.env.AIRTABLE_PAT;
  const BASE = process.env.DESTINATION_CONTENT_BASE_ID || 'appuZdlMJ7HKUt6qS';
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${AIRPORTS_TBL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  if (!r.ok) throw new Error(`airtable ${r.status}`);
  return r.json();
}

// ---- identity backfill for records that already exist ---------------------
/**
 * The 25 Aug 2026 audit found 123 records carrying narrative but no
 * coordinates, no City Served, no Type and no cited source at all. They were
 * stamped Done and Verified anyway. They are now In progress, and this pass
 * gives them the identity half of their verification.
 *
 * Same rule as a new skeleton: a field is written only when both independent
 * sources saw it, and only when the record does not already have a value. It
 * never touches narrative, and it never overwrites a human's work.
 *
 * @param opts.limit   max records to process
 * @param opts.write   if true, patch the records (default false: dry run)
 * @param opts.fetchers test seam: { ourAirports, wikidata, listRows, patch }
 * @returns { due, processed, filled, conflict, unverifiable, failed, items[] }
 */
export async function runIdentityBackfill({ limit = 10, write = false, nowIso, fetchers } = {}) {
  const today = (nowIso || new Date().toISOString()).slice(0, 10);
  const getOA = (fetchers && fetchers.ourAirports) || fetchOurAirports;
  const getWD = (fetchers && fetchers.wikidata) || fetchWikidata;
  const patch = (fetchers && fetchers.patch) || patchAirport;

  const readRows = (fetchers && fetchers.listRows)
    || (() => listAll(AIRPORTS_TBL, [AF.iata, AF.name, AF.cityServed, AF.countryText, AF.latitude, AF.longitude, AF.source1, AF.source2]));
  const rows = await readRows();
  const due = rows.filter(r => {
    const f = r.fields || {};
    return f[AF.iata] && (f[AF.latitude] == null || f[AF.longitude] == null || !f[AF.source1] || !f[AF.source2]);
  });

  const items = [];
  let filled = 0, failed = 0;
  for (const row of due.slice(0, limit)) {
    const iata = String(row.fields[AF.iata]).toUpperCase();
    const [oa, wd] = await Promise.all([getOA(iata), getWD(iata)]);
    if (!oa || !wd) {
      items.push({ iata, verdict: 'unverifiable', reason: !oa && !wd ? 'neither source found' : !oa ? 'not in OurAirports' : 'not in Wikidata' });
      continue;
    }
    const cv = crossVerify(oa, wd);
    if (!cv.verified) {
      items.push({ iata, verdict: 'conflict', conflicts: cv.conflicts, oa: oa.name, wd: wd.name });
      continue;
    }
    const { fields, corroborated, uncorroborated } = corroborateFields(oa, wd);

    // Only supply what is genuinely missing. An existing value is a human's or
    // an earlier verified pass's, and is not ours to replace.
    const existing = row.fields || {};
    const out = {};
    if (fields.name && !existing[AF.name]) out[AF.name] = fields.name;
    if (fields.city && !existing[AF.cityServed]) out[AF.cityServed] = fields.city;
    if (fields.country && !existing[AF.countryText]) out[AF.countryText] = fields.country;
    if (fields.lat != null && existing[AF.latitude] == null) out[AF.latitude] = fields.lat;
    if (fields.lon != null && existing[AF.longitude] == null) out[AF.longitude] = fields.lon;
    if (!existing[AF.source1]) out[AF.source1] = oa.source;
    if (!existing[AF.source2]) out[AF.source2] = wd.source;
    if (Object.keys(out).length) out[AF.verifiedDate] = today;

    const willWrite = Object.keys(out).length > 0;
    let applied = false;
    let writeError = null;
    if (write && willWrite) {
      try {
        await patch(row.id, out);
        applied = true;
        filled++;
      } catch (err) {
        writeError = (err && err.message) || String(err);
        failed++;
      }
    }
    items.push({
      iata, verdict: 'verified', corroborated, uncorroborated,
      wrote: willWrite ? Object.keys(out).length : 0, applied,
      ...(writeError ? { writeError } : {}),
    });
  }

  const summary = { due: due.length, processed: items.length, verified: 0, conflict: 0, unverifiable: 0, filled, failed, items };
  for (const it of items) summary[it.verdict === 'verified' ? 'verified' : it.verdict === 'conflict' ? 'conflict' : 'unverifiable']++;
  return summary;
}

async function patchAirport(recordId, fields) {
  const PAT = process.env.AIRTABLE_DESTINATION_CONTENT_PAT || process.env.AIRTABLE_PAT;
  const BASE = process.env.DESTINATION_CONTENT_BASE_ID || 'appuZdlMJ7HKUt6qS';
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${AIRPORTS_TBL}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!r.ok) throw new Error(`airtable ${r.status}`);
  return r.json();
}
