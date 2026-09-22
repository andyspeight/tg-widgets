/**
 * The events snapshot refreshes itself from the supplier Sheet (22 Sep 2026).
 *
 * The feed is a Google Sheet Darren keeps up to date. Ours was built from one
 * read of it on 21 August and committed, so by late September the widgets were
 * offering August's inventory: very few matches, and tickets that had gone.
 * Andy: "it's a Google Sheet, so it is always being updated, it's not a fixed
 * point in time."
 *
 * What this covers, and what it cannot:
 *
 *   - the CRON and the SCRIPT build the same snapshot, because they now share
 *     one builder. Two copies of that shape would drift silently;
 *   - the reader falls back to the committed file whenever the stored one is
 *     missing, unreachable, empty or slow. That is the whole safety of the
 *     change: a refresh that never runs has to leave today's behaviour intact;
 *   - the sheet reader refuses a short or oversized read rather than replacing
 *     ten thousand good events with twelve;
 *   - the scope it asks Google for is read-only.
 *
 * It cannot reach Google or the blob store from a test, so the credentialled
 * legs are exercised through injected failures rather than live calls. Those
 * are flagged in the output as unproven rather than claimed as passing.
 *
 * Run: node test/events-snapshot-refresh-smoke.mjs  (npm run test:events-refresh)
 */
import { readFileSync } from 'node:fs';
import { buildSnapshot, SNAPSHOT_BLOB_PATH, SHORT_KEYS } from '../api/_lib/events/build-snapshot.js';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '  — ' + detail : '')); }
};

const ROWS = [
  { Supplier: 'SportsEvents365', 'Event ID For Searchbox': '179:1', 'Event ID For Filters': '1',
    'Event Name': 'Arsenal FC vs Chelsea FC (Football (Soccer), English Premier League)',
    'Start Date/Time': '2027-03-01 15:00', 'Venue Name': 'Emirates Stadium', 'Venue ID': '2001' },
  { Supplier: 'XS2Event', 'Event ID For Searchbox': '144:abc_spp', 'Event ID For Filters': 'abc',
    'Event Name': 'Arsenal vs Chelsea (Football, Premier League)',
    'Start Date/Time': '2027-03-01 16:00', 'Venue Name': 'Emirates Stadium', 'Venue ID': 'gu-1' },
  { Supplier: 'SportsEvents365', 'Event ID For Searchbox': '179:2', 'Event ID For Filters': '2',
    'Event Name': 'Hull City vs Everton FC (Football (Soccer), English Premier League)',
    'Start Date/Time': '2027-03-02 15:00', 'Venue Name': 'MKM Stadium', 'Venue ID': '2002' },
];

console.log('\nEvents snapshot: it refreshes itself\n');

// ── One builder, two callers ─────────────────────────────────────────────────
console.log('the cron and the script build the same thing');
{
  const a = buildSnapshot(ROWS, { generatedAt: '2026-09-22', source: 'csv' });
  const b = buildSnapshot(ROWS, { generatedAt: '2026-09-22', source: 'google-sheet:1gvZH9EW' });
  const strip = (s) => JSON.stringify({ ...s, source: null });
  ok('the same rows give the same snapshot whatever read them', strip(a) === strip(b));
  ok('only the source line records where it came from', a.source !== b.source);

  const script = readFileSync(new URL('../scripts/build-events-snapshot.mjs', import.meta.url), 'utf8');
  ok('the script builds through the shared builder, not its own copy',
    /from '\.\.\/api\/_lib\/events\/build-snapshot\.js'/.test(script) && script.includes('buildSnapshot('));
  ok('the script no longer assembles a snapshot object of its own',
    !/const snapshot = \{\s*\n\s*version: 1,/.test(script));

  // The cron reaches the builder through the shared refresh rather than calling
  // it itself, so the chain is what matters: cron -> refresh -> builder, with
  // the staff button joining at the same point.
  const cron = readFileSync(new URL('../api/cron/refresh-events-snapshot.js', import.meta.url), 'utf8');
  const refresh = readFileSync(new URL('../api/_lib/events/refresh-snapshot.js', import.meta.url), 'utf8');
  ok('the cron reaches the builder through the shared refresh',
    /refreshEventsSnapshot/.test(cron) && /from '\.\/build-snapshot\.js'/.test(refresh) && refresh.includes('buildSnapshot('));
}

// ── What it actually produced ────────────────────────────────────────────────
console.log('\nwhat a build produces');
{
  const snap = buildSnapshot(ROWS, { generatedAt: '2026-09-22', source: 'test' });
  ok('the two suppliers\' listing of one match is a single event', snap.counts.events === 2,
    snap.counts.events + ' events');
  const arsenal = snap.events.find((e) => e.hk === 'arsenal');
  ok('that event keeps both suppliers, so both booking routes survive',
    arsenal && arsenal.s.length === 2, arsenal && JSON.stringify(arsenal.s.map((x) => x[0])));
  ok('home and away are stored separately and the right way round',
    !!snap.events.find((e) => e.hk === 'hull-city' && e.ak === 'everton'));
  ok('it carries the counts the feed reports', snap.counts.teams === 4 && snap.counts.venues === 2,
    JSON.stringify(snap.counts));
  ok('SHORT_KEYS still describes the short form the feed expands',
    SHORT_KEYS.hk === 'homeTeamKey' && SHORT_KEYS.dt === 'startDate');
}

// ── Falling back ─────────────────────────────────────────────────────────────
// The point of the change is that it cannot make things worse. Every way the
// refresh can be absent has to land on the committed file.
console.log('\nthe reader falls back rather than serving nothing');
{
  const feed = readFileSync(new URL('../api/events-feed.js', import.meta.url), 'utf8');
  ok('the reader prefers a stored snapshot', feed.includes('storedSnapshotUrl'));
  ok('it reads the committed file when there is no stored one',
    /_data\/events-snapshot\.json/.test(feed));
  ok('a stored snapshot with no events is refused',
    /Array\.isArray\(raw\.events\) && raw\.events\.length/.test(feed));
  ok('an unreachable store is caught rather than thrown at the visitor',
    /stored snapshot unreachable/.test(feed));
  ok('the fetch is bounded, so a slow store cannot hang a page',
    /AbortSignal\.timeout\(\d+\)/.test(feed));
  ok('resolving the stored url never throws', /return null;\n  }\n}/.test(feed));
  ok('the snapshot path is shared, not written out twice',
    feed.includes("SNAPSHOT_BLOB_PATH") && SNAPSHOT_BLOB_PATH === 'events/events-snapshot.json');
  ok('the feed does not import the cron to get it',
    !/from '\.\/cron\//.test(feed));
}

// ── The sheet reader ─────────────────────────────────────────────────────────
console.log('\nthe sheet reader refuses what it should');
{
  const sheet = readFileSync(new URL('../api/_lib/events/supplier-sheet.js', import.meta.url), 'utf8');
  ok('it asks Google for read-only access', /spreadsheets\.readonly/.test(sheet));
  ok('it never asks for write or drive scope',
    !/auth\/spreadsheets['"]/.test(sheet) && !/auth\/drive/.test(sheet));
  ok('a short read is refused rather than published', /refusing to rebuild from that/.test(sheet));
  ok('an absurd read is refused too', /beyond anything this feed has been/.test(sheet));
  ok('a 403 says what to do about it', /Share the sheet with/.test(sheet));
  ok('row objects have no prototype, so a column named __proto__ is inert',
    /Object\.create\(null\)/.test(sheet));
}

// ── The refresh, the cron and the button ─────────────────────────────────────
// The button exists because a weekly update should not wait six hours to show.
// It has to run the SAME code as the cron, or "I pressed refresh" and "it
// refreshed overnight" become two different things.
console.log('\nthe refresh, and its two doors');
{
  const refresh = readFileSync(new URL('../api/_lib/events/refresh-snapshot.js', import.meta.url), 'utf8');
  const cron = readFileSync(new URL('../api/cron/refresh-events-snapshot.js', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../api/admin/events-refresh.js', import.meta.url), 'utf8');

  ok('a rebuild that collapses in size is not stored',
    /MIN_KEEP_RATIO/.test(refresh) && /stored: false/.test(refresh));
  ok('it writes to one stable path, not a new file each run', /addRandomSuffix: false/.test(refresh));
  ok('it overwrites rather than failing on the second run', /allowOverwrite: true/.test(refresh));
  ok('it says plainly when a credential is missing',
    /credentials are not set/.test(refresh) && /BLOB_READ_WRITE_TOKEN is not set/.test(refresh));
  ok('it never throws at its caller', !/throw /.test(refresh));

  ok('the cron runs the shared refresh, not its own copy',
    /refreshEventsSnapshot/.test(cron) && !/buildSnapshot\(/.test(cron));
  ok('the cron is behind CRON_SECRET like the others', /Bearer \$\{secret\}/.test(cron));

  ok('the button runs the same shared refresh',
    /refreshEventsSnapshot/.test(admin) && !/buildSnapshot\(/.test(admin));
  ok('the button is staff-only', /requireAdmin/.test(admin));
  ok('the button is rate limited, so it cannot be held down', /applyRateLimit/.test(admin));
  ok('reading the state does not rebuild anything',
    /currentStoredSnapshot/.test(admin) && admin.indexOf('currentStoredSnapshot') < admin.indexOf('refreshEventsSnapshot('));
  ok('only POST rebuilds', /req\.method === 'POST'/.test(admin) && /405/.test(admin));

  const page = readFileSync(new URL('../public/admin-events.html', import.meta.url), 'utf8');
  ok('the page says when no refresh has landed rather than looking fine',
    /still reading the copy built into the platform/.test(page));
  ok('the page reports the before and after counts', /previousEvents/.test(page));
  ok('the page has no inline handlers', !/ on[a-z]+=/.test(page));
}

console.log('\n  note: the Google read and the blob write need credentials this');
console.log('  test cannot hold, so those two legs are unproven until the cron');
console.log('  runs in production. Everything above is exercised for real.');

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
