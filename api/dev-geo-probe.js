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
  const r = await fetch(PHOTON + '?q=' + encodeURIComponent(q) + '&limit=1&lang=en', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const d = await r.json();
  const f = d && d.features && d.features[0];
  if (!f || !f.geometry) return null;
  return {
    lng: +f.geometry.coordinates[0].toFixed(5),
    lat: +f.geometry.coordinates[1].toFixed(5),
    cc: (f.properties && f.properties.countrycode || '').toUpperCase(),
    label: (f.properties && f.properties.name) || '',
  };
}

async function resolve(v) {
  const expect = ISO[(v.cityCountry || '').toLowerCase()] || ISO[(v.compCountry || '').toLowerCase()] || null;
  const ladder = [];
  if (v.city) ladder.push([v.name + ', ' + v.city, 'venue']);
  if (v.compCountry) ladder.push([v.name + ', ' + v.compCountry, 'venue']);
  ladder.push([v.name, 'venue']);
  if (v.city && v.cityCountry) ladder.push([v.city + ', ' + v.cityCountry, 'city']);

  for (const [q, src] of ladder) {
    let hit = null;
    try { hit = await photon(q); } catch (e) { hit = null; }
    if (!hit) continue;
    // A wrong country is worse than no answer: it would anchor a hotel search
    // in Manchester, New Hampshire. Unverifiable results are accepted but
    // flagged, so the report shows exactly what rests on trust.
    if (expect && hit.cc && hit.cc !== expect) continue;
    return { key: v.key, lat: hit.lat, lng: hit.lng, src, flag: expect ? '' : 'unverified', label: hit.label };
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
