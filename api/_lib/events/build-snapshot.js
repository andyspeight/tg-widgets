/**
 * api/_lib/events/build-snapshot.js — rows in, snapshot out
 *
 * Lifted out of scripts/build-events-snapshot.mjs on 22 Sep 2026, unchanged,
 * so that the cron which reads the supplier Google Sheet and the script which
 * reads a CSV build the SAME snapshot. Two copies of this shape would drift,
 * and a snapshot is not the sort of thing anyone would notice drifting until a
 * widget started reading a field that only one of them wrote.
 *
 * Pure: rows in, an object out. No clock (the caller stamps `generatedAt`), no
 * network, no filesystem, so it is equally at home in a script, a cron or a
 * test.
 */
import { normaliseSupplierEvents } from './supplier-normalise.js';
import { buildEventIndexes } from './event-indexes.js';

/**
 * Where a refreshed snapshot is stored, for the cron that writes it and the
 * feed that reads it. A fixed path with no random suffix, so the feed can find
 * it without being told.
 */
export const SNAPSHOT_BLOB_PATH = 'events/events-snapshot.json';

/** Short key -> full key. Kept in step with api/events-feed.js. */
export const SHORT_KEYS = {
  i: 'id', t: 'title', p: 'phase', k: 'kind',
  c: 'category', o: 'competition',
  hk: 'homeTeamKey', ak: 'awayTeamKey', pk: 'performerKey', lo: 'locationText',
  d: 'startsAtLocal', dt: 'startDate', tm: 'startTime', tk: 'timeKnown',
  vk: 'venueKey', s: 'sources', x: 'startTimeConflict',
  ph: 'hasPlaceholderTeams', tr: 'truncated',
};

/**
 * @param rows  one object per feed row, keyed by the feed's own column names
 * @param opts  { notBefore, generatedAt, source }
 */
export function buildSnapshot(rows, opts = {}) {
  const { events, venues, report } = normaliseSupplierEvents(rows, { notBefore: opts.notBefore || undefined });
  const indexes = buildEventIndexes(events);

  // The pass's own venue registry is the only place the two supplier id spaces
  // are recorded, so fold those ids onto the index entries. A venue page can
  // then show that Wembley is 2024 to one supplier and a GUID to the other.
  const venueIds = new Map(venues.map((v) => [v.key, v.ids]));
  for (const v of indexes.venues) v.ids = venueIds.get(v.key) || {};

  // Anything the registries already hold is dropped and rehydrated by the API
  // from the entity key. That is worth about 1.2MB, and it also fixes display:
  // the feed calls the same club "Arsenal" and "Arsenal FC" depending on the
  // row, so deriving the name from the team registry gives every page one
  // spelling. A title is only stored when it cannot be rebuilt, which means
  // anything that is not a two-named fixture: concerts, sessions, packages, and
  // the rows with a placeholder side.
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
    // could be misled by, and the one with no fix until the timezone question
    // is settled. See docs/supplier-event-feed.md.
    if (e.conflicts && e.conflicts.startTime) o.x = e.conflicts.startTime;
    return o;
  });

  return {
    version: 1,
    generatedAt: opts.generatedAt || new Date().toISOString().slice(0, 10),
    source: opts.source || 'unknown',
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
}
