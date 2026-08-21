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
      return { key: v.key, name: v.name, city, cityCountry, compCountry };
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
    osm: (f.properties && f.properties.osm_value) || '',
  }));
}

// "Angel Stadium" must never mean a business library in Alabama just because
// both are in the US. The first run proved top-1-plus-country is not enough:
// same-country wrong-city hits sail through. So every candidate is scored
// against the venue name, and a coordinate with no name evidence is accepted
// only when independent queries agree on the same spot.
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
  else if (bj.includes(aj) || aj.includes(bj)) score += 0.25;
  return score;
}

const SPORTY = new Set(['stadium', 'sports_centre', 'sports_hall', 'pitch', 'arena',
  'racetrack', 'raceway', 'golf_course', 'events_centre', 'theatre', 'attraction']);

const kmApart = (p, q) => {
  const dLat = (p.lat - q.lat) * 111;
  const dLng = (p.lng - q.lng) * 111 * Math.cos((p.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
};

async function resolve(v) {
  const expect = ISO[(v.cityCountry || '').toLowerCase()] || ISO[(v.compCountry || '').toLowerCase()] || null;
  const queries = [];
  if (v.city) queries.push(v.name + ', ' + v.city);
  if (v.compCountry) queries.push(v.name + ', ' + v.compCountry);
  queries.push(v.name);

  const pool = [];
  for (const q of queries) {
    let hits = [];
    try { hits = await photon(q); } catch (e) { hits = []; }
    for (const h of hits) {
      if (expect && h.cc && h.cc !== expect) continue;
      h.q = q;
      h.score = nameScore(v.name, h.label) + (SPORTY.has(h.osm) ? 0.15 : 0);
      pool.push(h);
    }
    // A confident name match ends the ladder early: no point burning requests.
    const best = pool.slice().sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 0.85) break;
  }

  const flag = expect ? '' : 'unverified';
  const best = pool.slice().sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= 0.6) {
    return { key: v.key, lat: best.lat, lng: best.lng, src: 'venue', flag, label: best.label };
  }

  // No name evidence: only agreement between DIFFERENT queries on the same
  // 25km spot counts. One ranking fluke cannot agree with itself.
  for (const c of pool) {
    const backers = new Set(pool.filter((o) => kmApart(o, c) < 25).map((o) => o.q));
    if (backers.size >= 2) {
      return { key: v.key, lat: c.lat, lng: c.lng, src: 'consensus', flag, label: c.label };
    }
  }

  // Last resort: the city its concerts say it is in. rad=20 covers a metro,
  // which is exactly the anchor the working example used.
  if (v.city && v.cityCountry) {
    let hits = [];
    try { hits = await photon(v.city + ', ' + v.cityCountry); } catch (e) { hits = []; }
    const cityHit = hits.filter((h) => !expect || !h.cc || h.cc === expect)
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
  res.status(200).json({ total: all.length, offset, count: slice.length, rows, fails });
}
