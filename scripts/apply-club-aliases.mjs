/**
 * Apply the decided club aliases to an events snapshot that is already built.
 *
 * The normalise pass reads club-aliases.js, so a snapshot rebuilt from a fresh
 * CSV gets this for free. The committed snapshot was built on 21 Aug 2026 from
 * an export we no longer hold, and waiting for the next one would leave every
 * club list showing 23 teams in an 18-team league until then. So this walks the
 * snapshot and applies exactly what the pass would have.
 *
 * It does four things, in this order:
 *   1. splits a key that holds two real clubs (Vitória of Guimarães and of
 *      Salvador) before anything is folded into it;
 *   2. re-keys every home and away side through the alias table;
 *   3. folds events that are now identical, because a match listed once per
 *      spelling was two events and is one (PSG v Monaco was listed as "Paris
 *      SG v Monaco" and "Paris Saint-Germain v Monaco" on the same day at the
 *      same ground). Both suppliers' booking ids are kept, so no route to
 *      buying a ticket is lost;
 *   4. merges the team registry entries and recounts from the events, rather
 *      than adding the old counts together, which would carry the duplication
 *      into the numbers on every badge.
 *
 * Usage:
 *   node scripts/apply-club-aliases.mjs                 # report only
 *   node scripts/apply-club-aliases.mjs --write         # rewrite the snapshot
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { aliasLookup, canonicalClubKey, splitClub } from '../api/_lib/events/club-aliases.js';

const SNAPSHOT = new URL('../api/_data/events-snapshot.json', import.meta.url);
const write = process.argv.includes('--write');

const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const table = aliasLookup();

const before = { events: snap.events.length, teams: snap.teams.length };
const splitsMade = new Map();
const renames = new Map();

// ── 1 + 2. Split, then re-key ────────────────────────────────────────────────
for (const e of snap.events) {
  for (const field of ['hk', 'ak']) {
    const key = e[field];
    if (!key) continue;
    const split = splitClub(e.o, key);
    if (split) {
      e[field] = split.key;
      splitsMade.set(split.key, split);
      continue;
    }
    const canonical = canonicalClubKey(e.o, key, table);
    if (canonical !== key) { e[field] = canonical; renames.set(key, canonical); }
  }
}

// ── 3. Fold events that are now the same match ───────────────────────────────
// Identity is competition, date, ground and the two sides. A club cannot play
// twice at one ground on one day, so this cannot fold two real fixtures.
const merged = new Map();
const foldedEvents = [];
for (const e of snap.events) {
  const id = [e.o || '', e.dt || '', e.vk || '', e.hk || '', e.ak || ''].join('|');
  const isFixture = e.hk && e.ak;
  if (!isFixture) { merged.set(`${id}|${merged.size}`, e); continue; }
  const found = merged.get(id);
  if (!found) { merged.set(id, e); continue; }
  // Keep every supplier listing so both booking routes survive.
  const seen = new Set(found.s.map((row) => row.join('\u0000')));
  for (const row of e.s) if (!seen.has(row.join('\u0000'))) found.s.push(row);
  foldedEvents.push(id);
}
snap.events = [...merged.values()];

// ── 4. Rebuild the team registry ─────────────────────────────────────────────
const byKey = new Map(snap.teams.map((t) => [t.key, t]));
const teams = new Map();

const ensure = (key) => {
  let t = teams.get(key);
  if (t) return t;
  const seed = byKey.get(key);
  t = seed
    ? { ...seed, aliases: [...(seed.aliases || [])], categories: [], competitions: [], events: 0, home: 0, away: 0 }
    : { key, name: key, aliases: [], initials: key.slice(0, 2).toUpperCase(), hue: 0,
        events: 0, home: 0, away: 0, categories: [], competitions: [],
        homeVenueKey: null, homeVenueName: null, from: null, to: null };
  teams.set(key, t);
  return t;
};

// A folded club's name becomes an alias of the club it folded into, so search
// still finds "Estoril Praia" and lands on Estoril.
for (const [from, to] of renames) {
  const target = ensure(to);
  const old = byKey.get(from);
  if (!old) continue;
  for (const n of [old.name, ...(old.aliases || [])]) {
    if (n && !target.aliases.includes(n) && n !== target.name) target.aliases.push(n);
  }
  if (!target.homeVenueKey && old.homeVenueKey) {
    target.homeVenueKey = old.homeVenueKey;
    target.homeVenueName = old.homeVenueName;
  }
}
for (const [key, split] of splitsMade) {
  const t = ensure(key);
  if (split.name) t.name = split.name;
  t.initials = split.name ? split.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : t.initials;
  // The split club's ground is its own, not the one it was filed under.
  t.homeVenueKey = null; t.homeVenueName = null;
}

// Counts come from the events, never from adding the old totals together.
const homeVenues = new Map();
for (const e of snap.events) {
  for (const [field, side] of [['hk', 'home'], ['ak', 'away']]) {
    const key = e[field];
    if (!key) continue;
    const t = ensure(key);
    t.events++; t[side]++;
    if (e.c && !t.categories.includes(e.c)) t.categories.push(e.c);
    if (e.o && !t.competitions.includes(e.o)) t.competitions.push(e.o);
    if (!t.from || e.dt < t.from) t.from = e.dt;
    if (!t.to || e.dt > t.to) t.to = e.dt;
    if (field === 'hk' && e.vk) {
      if (!homeVenues.has(key)) homeVenues.set(key, new Map());
      const m = homeVenues.get(key);
      m.set(e.vk, (m.get(e.vk) || 0) + 1);
    }
  }
}
// The home ground is the one a club plays at most, which re-derives it for a
// club that has just been split off and for one that just gained fixtures.
const venueName = new Map(snap.venues.map((v) => [v.key, v.name]));
for (const [key, counts] of homeVenues) {
  const t = teams.get(key);
  if (!t) continue;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) { t.homeVenueKey = top[0]; t.homeVenueName = venueName.get(top[0]) || t.homeVenueName || null; }
}

snap.teams = [...teams.values()].sort((a, b) => a.key.localeCompare(b.key));
if (snap.counts) { snap.counts.events = snap.events.length; snap.counts.teams = snap.teams.length; }
snap.report = snap.report || {};
snap.report.clubAliasesApplied = [...renames.entries()].map(([from, to]) => ({ from, to }));
snap.report.clubSplitsApplied = [...splitsMade.keys()];

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`club aliases applied : ${renames.size}`);
for (const [from, to] of [...renames].sort()) console.log(`    ${from.padEnd(28)} -> ${to}`);
console.log(`club splits applied  : ${[...splitsMade.keys()].join(', ') || 'none'}`);
console.log(`\nevents  ${before.events} -> ${snap.events.length}  (${foldedEvents.length} duplicate listings folded)`);
console.log(`teams   ${before.teams} -> ${snap.teams.length}`);

for (const comp of ['portuguese-primeira', 'french-ligue-1', 'german-bundesliga', 'italian-serie-a']) {
  const n = snap.teams.filter((t) => (t.competitions || []).includes(comp)).length;
  console.log(`  ${comp.padEnd(22)} ${n} clubs`);
}

if (write) {
  writeFileSync(SNAPSHOT, JSON.stringify(snap));
  console.log('\nsnapshot rewritten');
} else {
  console.log('\n(report only, pass --write to rewrite the snapshot)');
}
