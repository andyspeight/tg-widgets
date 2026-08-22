#!/usr/bin/env node
/**
 * Build api/_data/venue-geo.json from the supplier feed's own coordinates.
 *
 * From 21 Aug 2026 the "Supplier Event Listings" export carries Latitude and
 * Longitude on every row, which supersedes the one-off geocoding run (that
 * story, and the 174 hand checks it needed, live in git history and in
 * venue-geo-overrides.json). Supplier coordinates are authoritative for the
 * supplier's own inventory, with two known defects this script repairs:
 *
 *   - a few rows drop the minus sign off a western longitude (Chicago at
 *     +87.6 is in China), fixed when the sign-flipped point rejoins its
 *     venue's median or a trusted reference
 *   - the odd row is simply somewhere else; a per-venue MEDIAN shrugs those
 *     off, and a row more than 50km from its venue's median becomes a
 *     per-EVENT entry instead, which is exactly right for the venue keys that
 *     merge different real grounds (redbullarena spans three countries)
 *
 * The previous verified table is used as a cross-check reference and as the
 * fallback for any venue the feed leaves without a usable coordinate.
 *
 * Usage: node scripts/build-venue-geo-from-feed.mjs feed.csv [--ref old-venue-geo.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const refPath = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null;
if (!input) { console.error('usage: build-venue-geo-from-feed.mjs feed.csv [--ref old.json]'); process.exit(1); }

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCsv(readFileSync(input, 'utf8'));
const headers = rows[0].map((h) => h.trim());
const objs = rows.slice(1).map((r) => {
  const o = {};
  for (let i = 0; i < headers.length; i++) o[headers[i]] = (r[i] ?? '').trim();
  return o;
});

const snap = JSON.parse(readFileSync('api/_data/events-snapshot.json', 'utf8'));
const ref = refPath ? JSON.parse(readFileSync(refPath, 'utf8')) : { venues: [] };
const refByKey = new Map(ref.venues.map((v) => [v[0], { lat: v[1], lng: v[2] }]));

const km = (a, b) => {
  const dLat = (a.lat - b.lat) * 111;
  const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};
// A real coordinate is never a whole-degree pair: the feed truncates some
// venues to integers (Ceres Park at 10,10; Chase Center at 37,122 with the
// sign gone too), and a point that coarse is worse than none.
const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0)
  && !(Number.isInteger(p.lat) && Number.isInteger(p.lng));

// Row coordinates by source id, which is how snapshot events point back at
// their rows ("supplier:filterId").
const SUPPLIER_SLUG = { SportsEvents365: 'sportsevents365', XS2Event: 'xs2event' };
const rowGeo = new Map();
for (const o of objs) {
  const supplier = SUPPLIER_SLUG[o.Supplier] || o.Supplier.toLowerCase();
  const id = `${supplier}:${o['Event ID For Filters']}`;
  const p = { lat: parseFloat(o.Latitude), lng: parseFloat(o.Longitude) };
  if (valid(p)) rowGeo.set(id, p);
}

// Every event's candidate points, and per-venue pools.
const byVenue = new Map();
const eventPts = new Map();
for (const ev of snap.events) {
  const pts = [];
  for (const [supplier, , filterId] of ev.s || []) {
    const p = rowGeo.get(`${supplier}:${filterId}`);
    if (p) pts.push(p);
  }
  if (!pts.length) continue;
  eventPts.set(ev.i, pts);
  if (!ev.vk) continue;
  let pool = byVenue.get(ev.vk);
  if (!pool) { pool = []; byVenue.set(ev.vk, pool); }
  pool.push(...pts);
}

const median = (pool) => {
  const lats = pool.map((p) => p.lat).sort((a, b) => a - b);
  const lngs = pool.map((p) => p.lng).sort((a, b) => a - b);
  return { lat: lats[Math.floor(lats.length / 2)], lng: lngs[Math.floor(lngs.length / 2)] };
};

// The trusted point a sign-flipped row is allowed to rejoin: its venue's
// median when the venue has enough honest rows, else the previous table.
function repair(p, anchor) {
  if (!anchor) return null;
  const flips = [
    { lat: p.lat, lng: -p.lng },
    { lat: -p.lat, lng: p.lng },
    { lat: -p.lat, lng: -p.lng },
  ];
  for (const f of flips) if (km(f, anchor) < 50) return f;
  return null;
}

const venueGeo = new Map();
const eventGeo = new Map();
const report = { venues: 0, fromRef: 0, signFixed: 0, eventLevel: 0, disagreeWithRef: [] };

for (const v of snap.venues) {
  const pool = (byVenue.get(v.key) || []).filter(valid);
  const anchorRef = refByKey.get(v.key) || null;
  if (!pool.length) {
    if (anchorRef) { venueGeo.set(v.key, { ...anchorRef, src: 'ref' }); report.fromRef++; }
    continue;
  }
  let med = median(pool);
  // If most of the pool is far from the previous verified point but the
  // sign-flip lands on it, the whole venue's rows are flipped.
  // A flip that lands the median on the previous verified point beats any
  // disagreement bigger than the acceptance radius (Sincil Bank sat 72km out
  // on a longitude sign alone).
  if (anchorRef && km(med, anchorRef) > 50) {
    const fixed = repair(med, anchorRef);
    if (fixed) { med = fixed; report.signFixed++; }
  }
  const near = pool.filter((p) => km(p, med) < 50);
  const off = pool.filter((p) => km(p, med) >= 50);
  // A venue where under half the rows agree with their own median is a merged
  // key: no single point is honest for it, so its events carry their own.
  if (near.length >= Math.max(1, pool.length / 2)) {
    venueGeo.set(v.key, { lat: +median(near).lat.toFixed(5), lng: +median(near).lng.toFixed(5), src: 'supplier' });
    report.venues++;
    if (anchorRef && km(venueGeo.get(v.key), anchorRef) > 50) {
      report.disagreeWithRef.push([v.key, v.name, km(venueGeo.get(v.key), anchorRef).toFixed(0) + 'km']);
    }
  } else if (anchorRef) {
    venueGeo.set(v.key, { ...anchorRef, src: 'ref' });
    report.fromRef++;
  }
  if (off.length) {
    // A far row is one of two things. When MANY far rows agree on one spot,
    // that is a second real ground sharing the venue key (Mechelen's sixteen
    // rows under afasstadion), and each event should anchor to its own row.
    // When one or two rows sit alone somewhere odd, that is supplier noise
    // (Bon Jovi at Wembley with two rows in rural Oxfordshire), and the
    // venue's own point is the truth. Three agreeing rows is the line.
    const clustered = (p) => off.filter((o) => km(o, p) < 25).length >= 3;
    for (const ev of snap.events) {
      if (ev.vk !== v.key) continue;
      const pts = (eventPts.get(ev.i) || []).filter(valid);
      if (!pts.length) continue;
      let p = pts[0];
      const vg = venueGeo.get(v.key);
      if (vg && km(p, vg) < 50) continue; // the venue point already covers it
      const fixed = vg ? repair(p, vg) : null;
      if (fixed) { report.signFixed++; continue; }
      if (vg && !clustered(p)) continue;  // noise: the venue point wins
      eventGeo.set(ev.i, { lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) });
      report.eventLevel++;
    }
  }
}

// Hand-verified corrections have the final say over everything above.
try {
  const ov = JSON.parse(readFileSync('api/_data/venue-geo-overrides.json', 'utf8'));
  for (const [k, o] of Object.entries(ov.venues || {})) {
    if (o === null) { venueGeo.delete(k); continue; }
    venueGeo.set(k, { lat: o.lat, lng: o.lng, src: 'manual' });
  }
} catch (e) { console.warn('no overrides applied:', e.message); }

const out = {
  _comment: 'Venue and per-event anchor coordinates for Travelify deeplinks, '
    + 'which require lat/lng/rad. Built by scripts/build-venue-geo-from-feed.mjs '
    + 'from the supplier feed\'s own Latitude/Longitude columns (added to the '
    + 'sheet 21 Aug 2026), validated by per-venue median with longitude '
    + 'sign-flip repair. events entries carry venues whose key merges more '
    + 'than one real ground, so each event anchors to its own row. src: '
    + 'supplier = the feed\'s coordinates, ref = carried from the previous '
    + 'verified table where the feed had no usable point.',
  builtAt: snap.report && snap.report.generatedAt || null,
  venues: [...venueGeo.entries()].sort().map(([k, g]) => [k, g.lat, g.lng, g.src]),
  events: [...eventGeo.entries()].sort().map(([k, g]) => [k, g.lat, g.lng]),
};
writeFileSync('api/_data/venue-geo.json', JSON.stringify(out) + '\n');

console.log('venues anchored:', out.venues.length,
  `(supplier ${report.venues}, carried-from-ref ${report.fromRef}, whole-venue sign fixes ${report.signFixed})`);
console.log('event-level anchors:', out.events.length);
console.log('venues absent entirely:', snap.venues.length - out.venues.length);
console.log('supplier vs previous table >50km disagreements:', report.disagreeWithRef.length);
for (const d of report.disagreeWithRef.slice(0, 40)) console.log('  ', ...d);
