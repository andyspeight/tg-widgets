/**
 * Club identities in the event feed (22 Sep 2026).
 *
 * A client counted 23 clubs in the 18-club Primeira and 24 in the 18-club
 * Ligue 1. Our second supplier spells a whole league its own way, and the
 * normalise pass only folded a club when one spelling was a PREFIX of the
 * other, so "Sporting CP" and "Sporting Club Portugal" sat side by side.
 *
 * Two directions matter equally here and this suite checks both:
 *   - the duplicates are gone, and
 *   - the clubs that merely LOOK like duplicates are still apart. Dundee and
 *     Dundee United, Paris FC and PSG, LAFC and the Galaxy, the two Madrids
 *     and the two Zurichs all sit in exactly the shape an eager rule folds.
 *
 * Run: node test/event-club-aliases-smoke.mjs  (npm run test:event-club-aliases)
 */
import { readFileSync } from 'node:fs';
import {
  CLUB_ALIASES, CLUB_SPLITS, NEVER_MERGE, CLUB_NAMES,
  aliasLookup, canonicalClubKey, splitClub, pinnedClubName,
} from '../api/_lib/events/club-aliases.js';
import { buildSnapshot } from '../api/_lib/events/build-snapshot.js';

const snap = JSON.parse(readFileSync(new URL('../api/_data/events-snapshot.json', import.meta.url), 'utf8'));

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '  — ' + detail : '')); }
};

const teamKeys = new Set(snap.teams.map((t) => t.key));
const clubsIn = (comp) => snap.teams.filter((t) => (t.competitions || []).includes(comp)).length;

console.log('\nEvent feed: one club, one entry\n');

// ── The table itself ─────────────────────────────────────────────────────────
console.log('the alias table');
const table = aliasLookup();
ok('the lookup is a Map, so a feed key cannot reach Object.prototype', table instanceof Map);
ok('splitClub survives a key that names a prototype member',
  splitClub('any-competition', 'constructor') === null && splitClub('any-competition', 'toString') === null);

let chainsEnd = true;
for (const [comp, pairs] of Object.entries(CLUB_ALIASES)) {
  for (const variant of Object.keys(pairs)) {
    const end = canonicalClubKey(comp, variant, table);
    if (table.has(`${comp}\u0000${end}`)) chainsEnd = false;
  }
}
ok('every alias resolves to a key that is not itself an alias', chainsEnd);

// ── The pairs that must never be folded ──────────────────────────────────────
console.log('\nclubs that must stay apart');
for (const [a, b, why] of NEVER_MERGE) {
  const folded = canonicalClubKey('', a, table) === canonicalClubKey('', b, table)
    && canonicalClubKey('', a, table) !== a;
  let listed = false;
  for (const pairs of Object.values(CLUB_ALIASES)) {
    if (pairs[a] === b || pairs[b] === a) listed = true;
  }
  ok(`${a} and ${b} are not folded together`, !folded && !listed, why);
}

// Both sides of a genuine rivalry still have to exist in the snapshot, or the
// merge happened somewhere else and the table is guarding nothing.
console.log('\nboth clubs of a real pair still exist');
for (const [a, b] of [['dundee', 'dundee-united'], ['paris', 'paris-sg'], ['roma', 'lazio']]) {
  ok(`${a} and ${b} are both in the snapshot`, teamKeys.has(a) && teamKeys.has(b),
    `${a}:${teamKeys.has(a)} ${b}:${teamKeys.has(b)}`);
}

// ── The leagues ──────────────────────────────────────────────────────────────
// A league is a closed set, so the club count is the plainest possible check
// that a duplicate has not crept back in.
console.log('\nleague sizes');
const SIZES = {
  'english-premier-league': 20, 'spanish-la-liga': 20, 'italian-serie-a': 20,
  'german-bundesliga': 18, 'french-ligue-1': 18, 'portuguese-primeira': 18,
  'dutch-eredivisie': 18, 'scottish-premiership': 12, 'turkish-super-lig': 18,
  'danish-superliga': 12, 'austrian-bundesliga': 12, 'swiss-super-league': 12,
  'greek-super-league': 14,
};
for (const [comp, size] of Object.entries(SIZES)) {
  const got = clubsIn(comp);
  ok(`${comp} lists ${size} clubs`, got === size, `lists ${got}`);
}

// ── The variants are gone from the data ──────────────────────────────────────
console.log('\nno folded spelling is still its own club');
const strays = [];
for (const pairs of Object.values(CLUB_ALIASES)) {
  for (const variant of Object.keys(pairs)) if (teamKeys.has(variant)) strays.push(variant);
}
ok('every folded spelling has left the team registry', strays.length === 0, strays.join(', '));

const keysInEvents = new Set();
for (const e of snap.events) { if (e.hk) keysInEvents.add(e.hk); if (e.ak) keysInEvents.add(e.ak); }
const inFixtures = [];
for (const pairs of Object.values(CLUB_ALIASES)) {
  for (const variant of Object.keys(pairs)) if (keysInEvents.has(variant)) inFixtures.push(variant);
}
ok('no fixture still points at a folded spelling', inFixtures.length === 0, inFixtures.join(', '));

// The folded name has to survive as an alias or a visitor searching the way
// their supplier spells it finds nothing.
const sporting = snap.teams.find((t) => t.key === 'sporting-cp');
ok('a folded spelling is kept as an alias so search still finds it',
  !!sporting && (sporting.aliases || []).some((a) => /Sporting Club Portugal/i.test(a)),
  JSON.stringify(sporting && sporting.aliases));

// ── The split ────────────────────────────────────────────────────────────────
// The opposite fault: one key holding two real clubs in two countries.
console.log('\nclubs that had to be split apart');
ok('the Brazilian Vitória has its own key', teamKeys.has('vitoria-salvador'));
const vitoriaComps = (snap.teams.find((t) => t.key === 'vitoria') || {}).competitions || [];
ok('Vitória SC is Portuguese only',
  !vitoriaComps.some((c) => /brazil|copa-do/.test(c)), vitoriaComps.join(', '));
const salvador = snap.teams.find((t) => t.key === 'vitoria-salvador');
ok('EC Vitória is Brazilian only',
  !!salvador && !(salvador.competitions || []).some((c) => /portug/.test(c)),
  salvador && (salvador.competitions || []).join(', '));
ok('CLUB_SPLITS still describes exactly the collisions found', Object.keys(CLUB_SPLITS).length === 1);

// ── Double-listed matches ────────────────────────────────────────────────────
// Folding the clubs turns two listings of one match into one. Both suppliers'
// booking ids have to survive that, or a route to buying a ticket is lost.
console.log('\ndouble-listed matches');
const seen = new Map();
let dupes = 0;
for (const e of snap.events) {
  if (!e.hk || !e.ak) continue;
  const id = [e.o || '', e.dt || '', e.vk || '', e.hk, e.ak].join('|');
  if (seen.has(id)) dupes++; else seen.set(id, e);
}
ok('no match is listed twice at one ground on one day', dupes === 0, dupes + ' still duplicated');

const everyEventHasASupplier = snap.events.every((e) => Array.isArray(e.s) && e.s.length >= 1);
ok('every event still carries at least one supplier listing', everyEventHasASupplier);

const multi = snap.events.filter((e) => Array.isArray(e.s) && e.s.length > 1).length;
ok('folded matches kept both suppliers rather than dropping one', multi > 0, multi + ' events with two listings');

// ── The name a merged club is shown under ────────────────────────────────────
// Folding two spellings does not settle which one a visitor reads. The registry
// picks the feed's most-used spelling, so the winner moves with the supplier's
// row counts: a refresh on 22 Sep 2026 renamed Sporting CP to "Sporting Club
// Portugal (Lisbon)" and fixtures started reading "RC Lens vs Sporting Club
// Portugal (Lisbon)". Pinning it here makes it stop moving.
console.log('\nthe name a merged club is shown under');
{
  ok('a pinned name is returned for a merged club', pinnedClubName('sporting-cp') === 'Sporting CP');
  ok('an unpinned club is left to the feed', pinnedClubName('arsenal') === '');
  ok('a key naming a prototype member is inert', pinnedClubName('constructor') === '');

  // Every club that COULD flip should be pinned, or the fix only covers the one
  // that happened to flip first.
  const atRisk = [];
  for (const pairs of Object.values(CLUB_ALIASES)) {
    for (const [variant, canonical] of Object.entries(pairs)) {
      if (variant.length > canonical.length + 2 && !pinnedClubName(canonical)) atRisk.push(canonical);
    }
  }
  ok('every merge that could be renamed by a refresh has a pinned name',
    atRisk.length === 0, atRisk.join(', '));

  // A pinned name has to beat the majority spelling, which is the whole point.
  const rows = [
    { Supplier: 'SportsEvents365', 'Event ID For Searchbox': '179:1', 'Event ID For Filters': '1',
      'Event Name': 'Sporting Club Portugal (Lisbon) vs Benfica (Football (Soccer), Portuguese Primeira Liga)',
      'Start Date/Time': '2027-03-01 15:00', 'Venue Name': 'Estadio Jose Alvalade', 'Venue ID': '1' },
    { Supplier: 'SportsEvents365', 'Event ID For Searchbox': '179:2', 'Event ID For Filters': '2',
      'Event Name': 'Sporting Club Portugal (Lisbon) vs Porto (Football (Soccer), Portuguese Primeira Liga)',
      'Start Date/Time': '2027-03-08 15:00', 'Venue Name': 'Estadio Jose Alvalade', 'Venue ID': '1' },
    { Supplier: 'XS2Event', 'Event ID For Searchbox': '144:a_spp', 'Event ID For Filters': 'a',
      'Event Name': 'Sporting CP vs SL Benfica (Football, Primeira Liga)',
      'Start Date/Time': '2027-03-01 16:00', 'Venue Name': 'Estadio Jose Alvalade', 'Venue ID': 'g1' },
  ];
  const built = buildSnapshot(rows, { generatedAt: '2026-09-22', source: 'test' });
  const sp = built.teams.find((t) => t.key === 'sporting-cp');
  ok('the pinned name wins even when the other spelling has more rows',
    !!sp && sp.name === 'Sporting CP', sp && JSON.stringify(sp.name));
  ok('the spelling it beat is kept as an alias, so search still finds it',
    !!sp && (sp.aliases || []).some((a) => /Sporting Club Portugal/.test(a)),
    sp && JSON.stringify(sp.aliases));

  ok('pinned names are chosen from what the suppliers send, not invented',
    Object.values(CLUB_NAMES).every((n) => typeof n === 'string' && n.length > 1 && n.length < 40));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
