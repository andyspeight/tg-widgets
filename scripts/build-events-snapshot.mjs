#!/usr/bin/env node
/**
 * Build the events snapshot that /api/events-feed serves.
 *
 * The feed is a periodic export, not a live API, so the prototype surfaces read
 * a snapshot committed alongside the code. One file, built here, loaded once per
 * cold start by the API and sliced per request.
 *
 * Fields are shortened because the whole point is to keep the bundle small:
 * 8.9MB of full records becomes about 2.2MB this way, and the API expands the
 * short keys back out before it answers. The map is in SHORT_KEYS below and in
 * api/events-feed.js, which is the only reader.
 *
 * Usage:
 *   node scripts/build-events-snapshot.mjs feed.csv
 *   node scripts/build-events-snapshot.mjs feed.csv --out api/_data/events-snapshot.json
 *   node scripts/build-events-snapshot.mjs feed.csv --not-before 2026-08-01
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normaliseSupplierEvents } from '../api/_lib/events/supplier-normalise.js';
import { buildEventIndexes } from '../api/_lib/events/event-indexes.js';

/** Short key -> full key. Kept in step with api/events-feed.js. */
export const SHORT_KEYS = {
  i: 'id', t: 'title', p: 'phase', k: 'kind',
  c: 'category', o: 'competition',
  hk: 'homeTeamKey', ak: 'awayTeamKey', pk: 'performerKey', lo: 'locationText',
  d: 'startsAtLocal', dt: 'startDate', tm: 'startTime', tk: 'timeKnown',
  vk: 'venueKey', s: 'sources', x: 'startTimeConflict',
  ph: 'hasPlaceholderTeams', tr: 'truncated',
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] || '').trim());
}

function toObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = Object.create(null);
    for (let i = 0; i < headers.length; i++) o[headers[i]] = (r[i] ?? '').trim();
    return o;
  });
}

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const FLAGS = new Set(['--out', '--not-before', '--generated']);
const input = argv.find((a, i) => !a.startsWith('--') && !FLAGS.has(argv[i - 1]));

if (!input) {
  console.error('Usage: node scripts/build-events-snapshot.mjs <feed.csv> [--out path] [--not-before YYYY-MM-DD]');
  process.exit(1);
}

const outPath = value('--out', 'api/_data/events-snapshot.json');
const rows = toObjects(parseCsv(readFileSync(input, 'utf8')));
const { events, venues, report } = normaliseSupplierEvents(rows, { notBefore: value('--not-before') });
const indexes = buildEventIndexes(events);

// The pass's own venue registry is the only place the two supplier id spaces
// are recorded, so fold those ids onto the index entries. A venue page can then
// show that Wembley is 2024 to one supplier and a GUID to the other.
const venueIds = new Map(venues.map((v) => [v.key, v.ids]));
for (const v of indexes.venues) v.ids = venueIds.get(v.key) || {};

// The build stamps its own date rather than the pass reading a clock, so the
// normalisation stays pure and the snapshot stays reproducible.
const generatedAt = value('--generated', new Date().toISOString().slice(0, 10));

// Anything the registries already hold is dropped and rehydrated by the API
// from the entity key. That is worth about 1.2MB, and it also fixes display:
// the feed calls the same club "Arsenal" and "Arsenal FC" depending on the row,
// so deriving the name from the team registry gives every page one spelling.
// A title is only stored when it cannot be rebuilt, which means anything that
// is not a two-named fixture: concerts, sessions, packages, and the 133 rows
// with a placeholder side.
const short = events.map((e) => {
  const o = {
    i: e.id, k: e.kind,
    d: e.startsAtLocal, dt: e.startDate, vk: e.venue.key,
    // [supplier, searchboxId, filterId, rawName] — rawName is what the ticket
    // deeplink puts in `loc`, so it belongs to the source it came from.
    s: e.sources.map((x) => [x.supplier, x.searchboxId, x.filterId, x.rawName]),
  };
  const rebuildable = e.kind === 'fixture' && e.homeTeamKey && e.awayTeamKey && !e.hasPlaceholderTeams;
  if (!rebuildable && e.kind !== 'performance') o.t = e.title;
  if (e.phase) o.p = e.phase;
  if (e.category) o.c = e.category;
  if (e.competition) o.o = e.competition;
  if (e.homeTeamKey) o.hk = e.homeTeamKey;
  if (e.awayTeamKey) o.ak = e.awayTeamKey;
  if (e.performerKey) o.pk = e.performerKey;
  if (e.locationText) o.lo = e.locationText;
  if (e.startTime) o.tm = e.startTime;
  if (!e.timeKnown) o.tk = 0;
  if (e.hasPlaceholderTeams) o.ph = 1;
  if (e.truncated) o.tr = 1;
  // Only the time disagreement is carried through. It is the one a visitor
  // could be misled by, and it is the one with no fix until the timezone
  // question is settled. See docs/supplier-event-feed.md.
  if (e.conflicts && e.conflicts.startTime) o.x = e.conflicts.startTime;
  return o;
});

const snapshot = {
  version: 1,
  generatedAt,
  source: input.split('/').pop(),
  counts: {
    events: events.length,
    competitions: indexes.competitions.length,
    teams: indexes.teams.length,
    performers: indexes.performers.length,
    venues: indexes.venues.length,
  },
  report: {
    rowsIn: report.rowsIn,
    rejected: report.rejected,
    mergedAway: report.mergedAway,
    crossSupplierMerges: report.crossSupplierMerges,
    nameTruncated: report.nameTruncated,
    placeholderTeams: report.placeholderTeams,
    timeOffsets: report.timeOffsets.slice(0, 10),
    venueAliasCandidates: report.venueAliasCandidates.slice(0, 25),
    teamAliases: report.teamAliases,
    teamAliasCandidates: report.teamAliasCandidates,
  },
  categories: indexes.categories,
  competitions: indexes.competitions,
  teams: indexes.teams,
  performers: indexes.performers,
  venues: indexes.venues,
  events: short,
};

mkdirSync(dirname(outPath), { recursive: true });
const json = JSON.stringify(snapshot);
writeFileSync(outPath, json);

const mb = (json.length / 1048576).toFixed(2);
console.log(`\nevents snapshot -> ${outPath}`);
console.log('─'.repeat(56));
console.log(`  generated       ${generatedAt}`);
console.log(`  events          ${snapshot.counts.events}`);
console.log(`  competitions    ${snapshot.counts.competitions}`);
console.log(`  teams           ${snapshot.counts.teams}`);
console.log(`  performers      ${snapshot.counts.performers}`);
console.log(`  venues          ${snapshot.counts.venues}`);
console.log(`  size            ${mb} MB`);
console.log('');
console.log('  biggest competitions by roster:');
for (const c of [...indexes.competitions].sort((a, b) => b.teams - a.teams).slice(0, 8)) {
  console.log(`    ${String(c.teams).padStart(3)} teams  ${String(c.events).padStart(4)} events  ${c.label}`);
}
console.log('');
