/**
 * TEMPORARY venue geocoder — 21 Aug 2026, deleted once venue-geo.json exists.
 *
 * Travelify deeplinks require a lat/lng/rad anchor (proved by probe: the same
 * link 400s without one and 302s with one) and the supplier feed carries no
 * coordinates at all. This endpoint geocodes the venue registry via Photon,
 * OpenStreetMap's public geocoder, because the build sandbox cannot reach any
 * geocoder directly. It runs from here, its results are committed as a static
 * file, and then this file goes.
 *
 * Query context, best first: the city its concerts say it is in, then the
 * country of a competition it hosts, then the bare name. A match only counts
 * when the returned country agrees with the expected one where we have an
 * expectation; a venue that fails validation falls back to CITY coordinates,
 * which with rad=20 is exactly the anchor Andy's working example used.
 */
import { readFileSync } from 'node:fs';

const PHOTON = 'https://photon.komoot.io/api/';
const UA = 'tg-widgets-venue-geocode/1.0 (one-off registry build; andy.speight@agendas.group)';

// Expected-country names (taxonomy + concert location text) to ISO2, so
// "England" validates a result photon reports as country=United Kingdom.
const ISO = {
  argentina: 'AR', aruba: 'AW', australia: 'AU', austria: 'AT', belgium: 'BE',
  brazil: 'BR', canada: 'CA', chile: 'CL', china: 'CN', colombia: 'CO',
  croatia: 'HR', czechia: 'CZ', denmark: 'DK', england: 'GB', finland: 'FI',
  france: 'FR', germany: 'DE', greece: 'GR', hungary: 'HU', india: 'IN',
  ireland: 'IE', italy: 'IT', japan: 'JP', luxembourg: 'LU', malaysia: 'MY',
  mexico: 'MX', monaco: 'MC', netherlands: 'NL', 'new zealand': 'NZ',
  'northern ireland': 'GB', norway: 'NO', poland: 'PL', portugal: 'PT',
  qatar: 'QA', romania: 'RO', 'saudi arabia': 'SA', scotland: 'GB',
  serbia: 'RS', singapore: 'SG', slovakia: 'SK', slovenia: 'SI',
  'south korea': 'KR', spain: 'ES', sweden: 'SE', switzerland: 'CH',
  taiwan: 'TW', thailand: 'TH', turkey: 'TR', uae: 'AE', uk: 'GB',
  'united arab emirates': 'AE', 'united kingdom': 'GB', 'united states': 'US',
  usa: 'US', wales: 'GB',
};

let PLAN = null;

function plan() {
  if (PLAN) return PLAN;
  const url = new URL('./_data/events-snapshot.json', import.meta.url);
  const snap = JSON.parse(readFileSync(url, 'utf8'));

  const countryBySlug = new Map(snap.competitions.map((c) => [c.slug, c.country || null]));

  // Majority concert location per venue: "Denver, CO, USA" → city Denver, country USA.
  const loVotes = new Map();
  for (const ev of snap.events) {
    if (!ev.vk || !ev.lo) continue;
    let m = loVotes.get(ev.vk);
    if (!m) { m = new Map(); loVotes.set(ev.vk, m); }
    m.set(ev.lo, (m.get(ev.lo) || 0) + 1);
  }

  PLAN = snap.venues
    .filter((v) => v.key !== 'tobedecided')
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((v) => {
      let city = null;
      let cityCountry = null;
      const votes = loVotes.get(v.key);
      if (votes) {
        const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const parts = top.split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length >= 2) { city = parts[0]; cityCountry = parts[parts.length - 1]; }
      }
      let compCountry = null;
      for (const slug of v.competitions || []) {
        const c = countryBySlug.get(slug);
        if (c) { compCountry = c; break; }
      }
      return { key: v.key, name: v.name, city, cityCountry, compCountry, comps: v.competitions || [] };
    });
  return PLAN;
}

async function photon(q) {
  const r = await fetch(PHOTON + '?q=' + encodeURIComponent(q) + '&limit=5&lang=en', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return [];
  const d = await r.json();
  return ((d && d.features) || []).filter((f) => f && f.geometry).map((f) => ({
    lng: +f.geometry.coordinates[0].toFixed(5),
    lat: +f.geometry.coordinates[1].toFixed(5),
    cc: ((f.properties && f.properties.countrycode) || '').toUpperCase(),
    label: (f.properties && f.properties.name) || '',
    city: (f.properties && (f.properties.city || f.properties.county || f.properties.state)) || '',
    okey: (f.properties && f.properties.osm_key) || '',
    osm: (f.properties && f.properties.osm_value) || '',
  }));
}

// Text similarity alone cannot tell the Arena da Baixada from a street in
// Bahia named after it, or Audi Field from an Office of Field Audit. Two
// failed passes proved it, so acceptance now leans on the geocoder's own
// metadata instead of name overlap:
//   - a venue with a known city (its concerts say where it is) must come back
//     IN that city, whatever it is called this season
//   - a fixtures venue, where no city is known, must at least BE a sports
//     place; a street or a bank branch is never a stadium however well the
//     name matches
//   - the North American leagues span two countries, so their expectation is
//     {US, CA}, which is what kept BMO Field and the Canada Life Centre out.
const norm = (t) => String(t || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
  .split(/\s+/).filter(Boolean);

function nameScore(venueName, label) {
  const a = norm(venueName);
  const b = norm(label);
  if (!a.length || !b.length) return 0;
  const bs = new Set(b);
  let hit = 0;
  for (const t of new Set(a)) if (bs.has(t)) hit++;
  let score = hit / new Set(a).size;
  const aj = a.join(' ');
  const bj = b.join(' ');
  if (aj === bj) score += 0.4;
  else if (bj.includes(aj) || aj.includes(bj)) score += 0.2;
  return score;
}

const sameCity = (a, b) => {
  const x = norm(a).join(' ');
  const y = norm(b).join(' ');
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

const SPORTY = new Set(['stadium', 'sports_centre', 'sports_hall', 'pitch', 'arena',
  'racetrack', 'raceway', 'track', 'golf_course', 'ice_rink', 'horse_racing',
  'events_centre', 'exhibition_centre']);
const NEVER = new Set(['bank', 'library', 'office', 'company', 'residential', 'school', 'university']);

// Two-country leagues: a US expectation must not reject Toronto and Winnipeg.
const NA_LEAGUES = new Set(['mlb', 'nhl', 'nba', 'nfl', 'mls']);

async function resolve(v) {
  let expectSet = null;
  const named = ISO[(v.cityCountry || '').toLowerCase()] || null;
  if (named) expectSet = new Set([named]);
  else {
    const compIso = ISO[(v.compCountry || '').toLowerCase()] || null;
    if (compIso === 'US' && (v.comps || []).some((c) => NA_LEAGUES.has(c))) expectSet = new Set(['US', 'CA']);
    else if (compIso) expectSet = new Set([compIso]);
  }

  const queries = [];
  if (v.city) queries.push(v.name + ', ' + v.city);
  if (v.compCountry) queries.push(v.name + ', ' + v.compCountry);
  queries.push(v.name);

  const flag = expectSet ? '' : 'unverified';
  let bestSporty = null;

  for (const q of queries) {
    let hits = [];
    try { hits = await photon(q); } catch (e) { hits = []; }
    for (const h of hits) {
      if (expectSet && h.cc && !expectSet.has(h.cc)) continue;
      if (h.okey === 'highway' || NEVER.has(h.osm)) continue;
      const score = nameScore(v.name, h.label);

      // City truth beats everything: the right city plus any name evidence is
      // the venue, whatever its sponsor calls it now.
      if (v.city && sameCity(h.city, v.city) && score >= 0.3) {
        return { key: v.key, lat: h.lat, lng: h.lng, src: 'venue', flag, label: h.label };
      }
      // No known city: only a sports place can carry a weak name, and an exact
      // name on a non-sports place is accepted but never a partial one.
      if (!v.city) {
        const sporty = SPORTY.has(h.osm);
        if (sporty && score >= 0.3 && (!bestSporty || score > bestSporty.score)) {
          bestSporty = { h, score };
        }
        if (!sporty && score >= 0.95) {
          return { key: v.key, lat: h.lat, lng: h.lng, src: 'venue', flag, label: h.label };
        }
      }
    }
    if (bestSporty && bestSporty.score >= 0.85) break;
  }
  if (bestSporty) {
    const h = bestSporty.h;
    return { key: v.key, lat: h.lat, lng: h.lng, src: 'venue', flag, label: h.label };
  }

  // Last resort for concert venues: the city itself. rad=20 covers a metro,
  // which is exactly the anchor the working example used.
  if (v.city && v.cityCountry) {
    let hits = [];
    try { hits = await photon(v.city + ', ' + v.cityCountry); } catch (e) { hits = []; }
    const cityHit = hits.filter((h) => !expectSet || !h.cc || expectSet.has(h.cc))
      .sort((a, b) => nameScore(v.city, b.label) - nameScore(v.city, a.label))[0];
    if (cityHit && nameScore(v.city, cityHit.label) >= 0.6) {
      return { key: v.key, lat: cityHit.lat, lng: cityHit.lng, src: 'city', flag, label: cityHit.label };
    }
  }
  return { key: v.key, fail: (v.name + ' | city=' + (v.city || '-') + ' | country=' + (v.compCountry || v.cityCountry || '-')) };
}

export default async function handler(req, res) {
  const all = plan();
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const count = Math.min(200, Math.max(1, parseInt(req.query.count, 10) || 150));
  const slice = all.slice(offset, offset + count);

  const rows = [];
  const fails = [];
  // Five workers, ~200ms pacing per slot: roughly five requests a second to a
  // shared public service, briefly. Polite enough for a one-off registry build.
  let i = 0;
  const worker = async () => {
    while (i < slice.length) {
      const v = slice[i++];
      const out = await resolve(v);
      if (out.fail) fails.push([out.key, out.fail]);
      else rows.push([out.key, out.lat, out.lng, out.src, out.flag, out.label]);
      await new Promise((ok) => setTimeout(ok, 200));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);

  res.setHeader('Cache-Control', 'no-store');
  const pad = Math.min(120000, Math.max(0, parseInt(req.query.pad, 10) || 0));
  res.status(200).json({ total: all.length, offset, count: slice.length, rows, fails,
    pad: pad ? ' '.repeat(pad) : undefined });
}
