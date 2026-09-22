/**
 * One ground, one entry, and a club's ground is where they play their sport.
 * (22 Sep 2026.)
 *
 * Two faults, reported together and fixed together because the first causes
 * part of the second.
 *
 * 1. The two suppliers name a ground differently and the pass keys venues on a
 *    compacted name, so one stadium became two: San Siro and Stadio San Siro,
 *    the Bernabéu with and without its "El". Venue pages split, and the false
 *    clashes it produced are what made the club merges harder to decide.
 *
 *    The handover has listed these as candidates since August and said not to
 *    apply them blindly, because the same signal catches a genuine supplier
 *    error: one Angels fixture filed at Dodger Stadium. What separates them is
 *    WHO PLAYS THERE. A ground spelled two ways hosts the same club under both
 *    spellings; a misfiled fixture puts two different clubs' grounds together.
 *
 * 2. A club's home ground was simply the venue it hosted at most often, which
 *    is right for a club that plays one sport. Bayern Munich hosted 19
 *    basketball games at the SAP Garden against 17 football matches at the
 *    Allianz Arena, so a football club's page named an indoor arena. Real
 *    Madrid showed the Movistar Arena for the same reason; merging the two
 *    Bernabéu spellings fixed that one by itself, and Bayern needed the rule.
 *
 * Run: node test/event-venue-aliases-smoke.mjs  (npm run test:event-venue-aliases)
 */
import { VENUE_ALIASES, NEVER_MERGE_VENUES, canonicalVenueKey } from '../api/_lib/events/venue-aliases.js';
import { venueKeyFor } from '../api/_lib/events/supplier-normalise.js';
import { buildSnapshot } from '../api/_lib/events/build-snapshot.js';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '  — ' + detail : '')); }
};

console.log('\nOne ground, one entry\n');

// ── Grounds the suppliers spell two ways ─────────────────────────────────────
console.log('the same ground under two names');
const SAME = [
  ['San Siro', 'Stadio San Siro (Giuseppe Meazza)'],
  ['El Sadar Stadium', 'Estadio El Sadar'],
  ['Estadio Santiago Bernabéu', 'El Estadio Santiago Bernabeu'],
  ['Estadi Cornellà-El Prat', 'RCDE Stadium'],
  ['Ghelamco Arena (Arteveldestadion)', 'Planet Group arena'],
  ['Estadi de Son Moix', 'Visit Mallorca Stadium (Estadi de Son Moix)'],
  ['Parken', 'Telia Parken (Parken Stadium)'],
  ['Metropolitano Stadium', 'Estadio Metropolitano Madrid'],
  ['Stadio Atleti Azzurri d’Italia', 'Stadio di Bergamo (Gewiss Stadium)'],
];
for (const [a, b] of SAME) {
  ok(`"${a}" and "${b}" are one ground`,
    venueKeyFor(a) === venueKeyFor(b), `${venueKeyFor(a)} vs ${venueKeyFor(b)}`);
}

// ── Grounds that must stay apart ─────────────────────────────────────────────
// Every one of these is offered by the candidate list and is a supplier filing
// a fixture at the wrong ground. Two of them share a generic word, which is
// exactly how an eager rule merges Montreal with Ottawa.
console.log('\ndifferent grounds that the candidate list offers up');
const APART = [
  ['Angel Stadium', 'Dodger Stadium'],
  ['Honda Center (The Pond)', 'United Center'],
  ['Centre Bell', 'Scotiabank Arena'],
  ['Canadian Tire Centre', 'Centre Bell'],
  ['Gateway Center Arena', 'State Farm Arena'],
  // Two real stadiums in Seville. Betis play at La Cartuja while Villamarín is
  // rebuilt, which is why the feed makes them look like one.
  ['Estadio Benito Villamarin', 'Estadio de La Cartuja'],
];
for (const [a, b] of APART) {
  ok(`"${a}" and "${b}" stay apart`,
    venueKeyFor(a) !== venueKeyFor(b), 'both keyed as ' + venueKeyFor(a));
}

// ── The table itself ─────────────────────────────────────────────────────────
console.log('\nthe table');
{
  ok('the lookup survives a key naming a prototype member',
    canonicalVenueKey('constructor') === 'constructor' && canonicalVenueKey('toString') === 'toString');
  ok('an unknown ground is returned unchanged', canonicalVenueKey('anfield') === 'anfield');
  ok('an empty key does not throw', canonicalVenueKey('') === '' && canonicalVenueKey(null) === null);

  let chainsEnd = true;
  for (const variant of Object.keys(VENUE_ALIASES)) {
    if (Object.prototype.hasOwnProperty.call(VENUE_ALIASES, canonicalVenueKey(variant))) chainsEnd = false;
  }
  ok('every alias lands on a key that is not itself an alias', chainsEnd);

  let guarded = true;
  for (const [a, b] of NEVER_MERGE_VENUES) {
    if (canonicalVenueKey(a) === canonicalVenueKey(b)) guarded = false;
  }
  ok('nothing in the never-merge list has crept into the table', guarded);
  ok('every never-merge entry carries its reason',
    NEVER_MERGE_VENUES.every((r) => r.length === 3 && r[2].length > 10));
}

// ── A club's ground is where they play their sport ───────────────────────────
console.log('\na club that plays two sports');
{
  const ev = (name, venue, vid, date) => ({
    Supplier: 'SportsEvents365',
    'Event ID For Searchbox': '179:' + vid + date,
    'Event ID For Filters': vid + date,
    'Event Name': name,
    'Start Date/Time': date + ' 19:00',
    'Venue Name': venue,
    'Venue ID': vid,
  });
  const rows = [];
  // More basketball at home than football, so the old rule picked the arena.
  for (const d of ['2027-03-01', '2027-03-08']) {
    rows.push(ev('Bayern Munich vs Borussia Dortmund (Football (Soccer), German Bundesliga)', 'Allianz Arena', 'a1', d));
  }
  for (const d of ['2027-03-02', '2027-03-09', '2027-03-16']) {
    rows.push(ev('Bayern Munich vs Olympiacos (Basketball, Euroleague)', 'SAP Garden', 's1', d));
  }
  // Across the season football is the bigger sport, home and away.
  for (const d of ['2027-04-01', '2027-04-08', '2027-04-15', '2027-04-22']) {
    rows.push(ev('Borussia Dortmund vs Bayern Munich (Football (Soccer), German Bundesliga)', 'Signal Iduna Park', 'd1', d));
  }
  const snap = buildSnapshot(rows, { generatedAt: '2026-09-22', source: 'test' });
  const bayern = snap.teams.find((t) => t.key === 'bayern-munich');

  ok('the club is still recorded as playing both sports',
    !!bayern && (bayern.categories || []).includes('football') && (bayern.categories || []).includes('basketball'),
    bayern && (bayern.categories || []).join(', '));
  ok('its home ground is the football ground, not the busier arena',
    !!bayern && bayern.homeVenueName === 'Allianz Arena', bayern && bayern.homeVenueName);

  // A one-sport club must be unaffected: the rule has to be invisible to the
  // several hundred clubs it does not apply to.
  const dortmund = snap.teams.find((t) => t.key === 'borussia-dortmund');
  ok('a club that plays one sport still gets the ground it hosts at',
    !!dortmund && dortmund.homeVenueName === 'Signal Iduna Park', dortmund && dortmund.homeVenueName);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
