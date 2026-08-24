#!/usr/bin/env node
/**
 * Assemble api/_data/venue-facts.json — the venue fact sheets.
 *
 * Three honest sources, nothing invented:
 *   - our own snapshot: the city its concerts say it is in (majority of
 *     location texts), else the country of a competition it hosts
 *   - Wikidata research pages (fetched by the temporary probe endpoint,
 *     coordinate-gated so a name cannot match the wrong place): capacity,
 *     opened, website, Wikipedia link, photo with Commons credit
 *   - pure maths on data already in the repo: IANA timezone from the anchor
 *     coordinates, and the nearest major airports from the Flight Time
 *     widget's bundled list, straight-line distance, only within 150km
 *
 * A fact that is missing stays missing; the sheet omits the row.
 *
 * Usage: node scripts/build-venue-facts.mjs <dir-with-factpage-*.json>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const tzLookup = require('tz-lookup');

const dir = process.argv[2];
if (!dir) { console.error('usage: build-venue-facts.mjs <dir-with-factpage-*.json>'); process.exit(1); }

const snap = JSON.parse(readFileSync('api/_data/events-snapshot.json', 'utf8'));
const geo = JSON.parse(readFileSync('api/_data/venue-geo.json', 'utf8'));
const airports = JSON.parse(readFileSync('api/_data/airports.json', 'utf8')).airports;
const geoByKey = new Map(geo.venues.map((v) => [v[0], { lat: v[1], lng: v[2] }]));

// City and country per venue, from the feed itself.
const countryBySlug = new Map(snap.competitions.map((c) => [c.slug, c.country || null]));
const loVotes = new Map();
for (const ev of snap.events) {
  if (!ev.vk || !ev.lo) continue;
  let m = loVotes.get(ev.vk);
  if (!m) { m = new Map(); loVotes.set(ev.vk, m); }
  m.set(ev.lo, (m.get(ev.lo) || 0) + 1);
}

const km = (a, b) => {
  const dLat = (a.lat - b.lat) * 111;
  const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

// Wikidata pages.
const wd = new Map();
let researched = 0;
for (const f of readdirSync(dir).filter((f) => /^factpage-.*\.json$/.test(f)).sort()) {
  const d = JSON.parse(readFileSync(dir + '/' + f, 'utf8'));
  for (const r of d.rows) {
    if (!r.qid) continue;
    // The coordinate gate can pass the METRO STATION named after the ground
    // (Vasil Levski Stadium station sits at Vasil Levski Stadium). A station's
    // facts on a stadium sheet are worse than none.
    if (/_station|Metro_Station|railway/i.test(r.wiki || '')) continue;
    wd.set(r.key, r); researched++;
  }
}

const out = {};
const stats = { city: 0, country: 0, tz: 0, cap: 0, opened: 0, img: 0, wiki: 0, web: 0, air: 0 };
for (const v of snap.venues) {
  const g = geoByKey.get(v.key);
  if (!g) continue;
  const f = {};

  const votes = loVotes.get(v.key);
  if (votes) {
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const parts = top.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) { f.city = parts[0]; f.country = parts[parts.length - 1]; }
  }
  if (!f.country) {
    for (const slug of v.competitions || []) {
      const c = countryBySlug.get(slug);
      if (c) { f.country = c; break; }
    }
  }
  try { f.tz = tzLookup(g.lat, g.lng); } catch (e) { /* polar nonsense only */ }

  const near = airports
    .map(([iata, name, cc, lat, lng]) => [iata, name, Math.round(km({ lat, lng }, g))])
    .filter(([, , d]) => d <= 150)
    .sort((a, b) => a[2] - b[2])
    .slice(0, 2);
  if (near.length) f.air = near;

  const r = wd.get(v.key);
  if (r) {
    if (r.capacity >= 200 && r.capacity <= 250000) f.cap = r.capacity;
    if (r.opened) f.opened = r.opened;
    if (r.website) f.web = r.website;
    if (r.wiki) f.wiki = r.wiki;
    if (r.img) f.img = r.img;
    f.qid = r.qid;
  }

  for (const k of Object.keys(stats)) if (f[k]) stats[k]++;
  out[v.key] = f;
}

// Hand-reviewed rematches (api/_data/venue-facts-overrides.json). The
// coordinate gate cannot tell a venue from the demolished venue it replaced
// on the same ground, so those venues' Wikidata fields come from a reviewed
// match instead of the research pages. An override REPLACES the whole
// Wikidata-sourced group, so a field it omits stays absent rather than
// falling back to the predecessor's value.
const WD_FIELDS = ['cap', 'opened', 'web', 'wiki', 'img', 'qid'];
try {
  const ov = JSON.parse(readFileSync('api/_data/venue-facts-overrides.json', 'utf8')).venues || {};
  for (const [key, fields] of Object.entries(ov)) {
    if (!out[key]) continue;
    for (const k of WD_FIELDS) delete out[key][k];
    Object.assign(out[key], fields);
    console.log('override applied:', key, '->', fields.wiki || '(no wiki)');
  }
} catch (e) { /* no overrides file, nothing to apply */ }

writeFileSync('api/_data/venue-facts.json', JSON.stringify({
  _comment: 'Venue fact sheets. Sources: the feed itself (city, country), '
    + 'Wikidata matched by coordinates (capacity, opened, website, Wikipedia, '
    + 'photo with Commons credit), tz-lookup on the anchor, and nearest major '
    + 'airports from the suite\'s bundled list. Missing facts are omitted, '
    + 'never invented. Rebuild: docs/supplier-event-feed.md.',
  builtAt: '2026-08-21',
  venues: out,
}) + '\n');

console.log('venues with a sheet:', Object.keys(out).length, '| wikidata-matched:', researched);
console.log('field coverage:', stats);
