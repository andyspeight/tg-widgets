/**
 * Supplier event feed — the normalisation pass.
 *
 * Takes raw rows from the "Supplier Event Listings" export (SportsEvents365 and
 * XS2Event, seven columns, one row per bookable event) and returns one clean
 * record per REAL-WORLD event, with each supplier's booking ids carried
 * alongside so a widget can still deep-link into whichever supplier it prefers.
 *
 * Written against a full read of the 28 Jul 2026 export: 11,045 rows, no blank
 * cells, all ids unique. Four things in that feed break a naive consumer, and
 * this pass exists for those four:
 *
 *   1. Event names are capped at ~100 characters by the source system, which
 *      cuts the trailing "(Category, Competition)" bracket in half on 110 rows.
 *      Anything reading the category out of that bracket silently loses them.
 *      We detect the cut structurally (unbalanced parentheses, not a length
 *      guess, because the cap lands at 99 or 100 depending on multi-byte
 *      characters) and repair it by prefix-matching against the vocabulary
 *      built from the intact rows in the same batch.
 *   2. The two suppliers use different taxonomies. "Football (Soccer) /
 *      English Premier League" and "Football / Premier League" are one league.
 *      Resolved through api/_lib/events/supplier-taxonomy.js.
 *   3. The same event is sold by both suppliers: 261 fixtures appear twice on
 *      teams-plus-date, and another 132 rows are exact within-supplier repeats
 *      carrying different event ids. Merged on an identity key, never on the
 *      supplier id.
 *   4. Venue identity is split across two id spaces. Wembley Stadium is 2024 to
 *      one supplier and a GUID to the other. Unified on a slug of the name.
 *
 * Design rules this file holds to:
 *   - Pure. No network, no filesystem, no clock reads that change the output,
 *     no secrets. Give it rows, get back rows. That makes it equally usable
 *     from an API route, a cron, or a one-off script.
 *   - Never invents. A field it cannot resolve is null and is counted in the
 *     report, rather than guessed into something that looks right.
 *   - Never silently drops. Every rejected row lands in report.rejectedRows
 *     with a reason, and every disagreement between merged sources is kept on
 *     the record in `conflicts`.
 *   - Times are naive local, exactly as the feed gives them. The feed carries
 *     no timezone, so we never build a Date or append a Z. Treating a 19:45
 *     kick-off at Anfield as UTC is how events land on the wrong day.
 *
 * Safety: every string off the feed is passed through safeText() — tags
 * stripped, control characters removed, length capped before any regex touches
 * it. All data-derived lookups use Map, never object literals, so a feed value
 * of "__proto__" or "constructor" cannot reach Object.prototype. Output is
 * plain text with no markup: consumers still render it with textContent or an
 * escaper, per the widget rules in CLAUDE.md.
 *
 * Usage:
 *   import { normaliseSupplierEvents } from './supplier-normalise.js';
 *   const { events, venues, report } = normaliseSupplierEvents(rows);
 */

import {
  CATEGORIES,
  COMPETITIONS,
  CATEGORY_IMPLIES_COMPETITION,
  SUPPLIERS,
  CLUB_TOKENS,
} from './supplier-taxonomy.js';

// ── Limits ───────────────────────────────────────────────────────────────────
// Bounds on untrusted input. Applied before any regex runs, so a hostile or
// corrupt feed cannot turn a linear scan into a long one.
export const LIMITS = {
  maxRows: 200000,
  maxNameLen: 300,
  maxVenueLen: 160,
  maxIdLen: 128,
  maxFieldLen: 200,
};

/** Rows whose start times differ by more than this are separate events. */
const DEFAULT_MERGE_WINDOW_MINUTES = 360;

/** Which supplier's copy of a merged event supplies the display fields. */
const DEFAULT_SUPPLIER_PRIORITY = ['sportsevents365', 'xs2event'];

// ── Lookup tables, built once ────────────────────────────────────────────────
// Map throughout. A plain object keyed by feed data is a prototype-pollution
// hole the moment a supplier ships an event called "__proto__".

const CATEGORY_BY_ALIAS = new Map();
for (const c of CATEGORIES) {
  for (const a of c.aliases) CATEGORY_BY_ALIAS.set(a, c);
}

/** category slug -> Map(alias -> competition) */
const COMPETITION_BY_CATEGORY = new Map();
for (const comp of COMPETITIONS) {
  let bucket = COMPETITION_BY_CATEGORY.get(comp.category);
  if (!bucket) { bucket = new Map(); COMPETITION_BY_CATEGORY.set(comp.category, bucket); }
  for (const a of comp.aliases) bucket.set(a, comp);
}

const COMPETITION_BY_SLUG = new Map(COMPETITIONS.map((c) => [c.slug, c]));

const SUPPLIER_BY_ALIAS = new Map();
for (const s of SUPPLIERS) {
  for (const a of s.aliases) SUPPLIER_BY_ALIAS.set(a, s);
}

// ── Text safety ──────────────────────────────────────────────────────────────

/**
 * Everything off the feed goes through here first. Strips tags and control
 * characters, collapses whitespace, caps length. Never throws.
 */
export function safeText(value, maxLen = LIMITS.maxFieldLen) {
  if (typeof value !== 'string') {
    if (value === null || value === undefined) return '';
    value = String(value);
  }
  // Cap before the regexes so the work is bounded whatever arrives.
  const cap = Math.max(1, maxLen | 0);
  return value
    .slice(0, cap * 2)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);
}

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
}

/** URL-and-filter-safe slug. Empty string when nothing survives. */
export function slugify(value, maxLen = 80) {
  const t = stripDiacritics(safeText(value, maxLen * 2)).toLowerCase();
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maxLen);
}

/** Lower-cased, whitespace-collapsed key for alias matching. */
function aliasKey(value) {
  return safeText(value, LIMITS.maxFieldLen).toLowerCase();
}

// ── Event name parsing ───────────────────────────────────────────────────────

/** Split on `sep` at parenthesis depth zero only. */
function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '(') depth++;
    else if (c === ')') { if (depth > 0) depth--; }
    else if (c === sep && depth === 0) { out.push(str.slice(start, i)); start = i + 1; }
  }
  out.push(str.slice(start));
  return out.map((s) => s.trim());
}

/**
 * Does this fragment name a category we know? Gates whether a trailing bracket
 * is taxonomy at all.
 */
function categoryFragmentResolves(fragment, truncated) {
  const key = aliasKey(fragment);
  if (!key) return false;
  if (CATEGORY_BY_ALIAS.has(key)) return true;
  // A cut fragment only counts if it can only have been one category.
  return truncated ? resolveByPrefix(key, CATEGORY_BY_ALIAS.keys()) !== null : false;
}

/**
 * Peel the trailing "(Category, Competition)" bracket off an event name.
 *
 * Truncation is detected by parenthesis balance, not by length. The source cap
 * lands at 99 or 100 characters depending on multi-byte characters in the name,
 * and a name cut at exactly 100 can still be perfectly balanced. Balance is the
 * only signal that is always right:
 *
 *   "Gyori ETO FC vs FC Atert Bissen (Football (Soccer), UEFA Conference League)"
 *      balanced, 100 chars, complete
 *   "Session 9 - Grounds Admission Only (Tennis, US Open (tennis - Grand Slam)"
 *      ends in ')' but the OUTER group never closes, so it is truncated and a
 *      backwards scan would wrongly read the category as "tennis - Grand Slam"
 *
 * The bracket is only taken as taxonomy when its first segment names a category
 * we recognise. Some rows end in a plain description:
 *
 *   "2026 Buffalo Bills Season Tickets (Includes Tickets To All Regular Season
 *    Home Games)"
 *
 * Peeling that off would truncate the title AND invent a category out of
 * "Includes Tickets To All Regular Season Home Games". Those rows keep their
 * full name and are counted as taxonomyMissing, so a genuinely new supplier
 * category shows up in the report instead of quietly corrupting titles.
 */
export function splitNameAndTaxonomy(rawName) {
  const name = safeText(rawName, LIMITS.maxNameLen);
  let depth = 0;
  let lastTopOpen = -1;
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c === '(') { if (depth === 0) lastTopOpen = i; depth++; }
    else if (c === ')') { if (depth > 0) depth--; }
  }

  const unbalanced = depth > 0;
  const closed = !unbalanced && name.endsWith(')');
  if (lastTopOpen < 0 || (!unbalanced && !closed)) {
    return { subject: name, taxonomy: '', truncated: false, taxonomyMissing: true };
  }

  const taxonomy = unbalanced
    ? name.slice(lastTopOpen + 1).trim()
    : name.slice(lastTopOpen + 1, -1).trim();
  const subject = name.slice(0, lastTopOpen).trim();

  if (!categoryFragmentResolves(splitTopLevel(taxonomy, ',')[0], unbalanced)) {
    // Not taxonomy. A dangling fragment from a cut bracket is noise and comes
    // off the title; a complete bracket is part of the name and stays.
    return {
      subject: unbalanced && subject ? subject : name,
      taxonomy: '',
      truncated: unbalanced,
      taxonomyMissing: true,
    };
  }

  return { subject, taxonomy, truncated: unbalanced, taxonomyMissing: false };
}

/** Pull the "Second Qualifying Round:" style qualifier off the front. */
function splitPhase(subject) {
  let depth = 0;
  for (let i = 0; i < subject.length && i < 60; i++) {
    const c = subject[i];
    if (c === '(') depth++;
    else if (c === ')') { if (depth > 0) depth--; }
    else if (c === ':' && depth === 0) {
      const phase = subject.slice(0, i).trim();
      const rest = subject.slice(i + 1).trim();
      if (phase && rest) return { phase, rest };
      return { phase: null, rest: subject };
    }
  }
  return { phase: null, rest: subject };
}

/** Split "A vs B" / "A vs. B" at depth zero. Null when it is not a fixture. */
function splitFixture(subject) {
  let depth = 0;
  for (let i = 0; i < subject.length; i++) {
    const c = subject[i];
    if (c === '(') { depth++; continue; }
    if (c === ')') { if (depth > 0) depth--; continue; }
    if (depth !== 0 || (c !== 'v' && c !== 'V')) continue;
    if (i === 0 || subject[i - 1] !== ' ') continue;
    const after = subject.slice(i, i + 4).toLowerCase();
    let len = 0;
    if (after.startsWith('vs. ')) len = 4;
    else if (after.startsWith('vs ')) len = 3;
    if (!len) continue;
    const home = subject.slice(0, i - 1).trim();
    const away = subject.slice(i + len).trim();
    if (home && away) return { home, away };
  }
  return null;
}

// "City, ST, Country" or "City, Country". Anchored and non-nested, so linear.
const LOCATION_RE = /^[^,]{1,60},\s*[^,]{1,40}(,\s*[^,]{1,40})?$/;

/**
 * Split "Performer-City, Country" used by the entertainment rows.
 *
 * Scans hyphens from the right and takes the first one whose right-hand side
 * looks like a location, so "Jay-Z-New York City, NY, USA" keeps the hyphen in
 * the performer's name instead of splitting on it.
 */
function splitPerformance(subject) {
  for (let i = subject.length - 1; i > 0; i--) {
    if (subject[i] !== '-') continue;
    const right = subject.slice(i + 1).trim();
    const left = subject.slice(0, i).trim();
    if (left && right && LOCATION_RE.test(right)) return { performer: left, location: right };
  }
  return { performer: subject, location: null };
}

// ── Dates ────────────────────────────────────────────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parse the feed's "YYYY-MM-DD HH:MM:SS" into naive local parts.
 *
 * No Date object and no Z. The feed states no timezone, so the only honest
 * reading is "this is the local clock time at the venue".
 *
 * A 00:00:00 stamp is treated as "time not supplied", not as midnight. 336 rows
 * carry it, spread across MLB, football and concerts, none of which start at
 * midnight. `timeKnown: false` is the flag; the date is still trusted.
 */
export function parseStart(raw) {
  const s = safeText(raw, 40);
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3], hour = +m[4], minute = +m[5];
  const second = m[6] ? +m[6] : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // Reject 31 April and friends by round-tripping through the calendar.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  const pad = (n) => String(n).padStart(2, '0');
  const startDate = `${m[1]}-${pad(month)}-${pad(day)}`;
  const timeKnown = !(hour === 0 && minute === 0 && second === 0);
  return {
    startDate,
    startTime: timeKnown ? `${pad(hour)}:${pad(minute)}` : null,
    startsAtLocal: `${startDate}T${pad(hour)}:${pad(minute)}:${pad(second)}`,
    timeKnown,
    minuteOfDay: hour * 60 + minute,
  };
}

// ── Venues ───────────────────────────────────────────────────────────────────

/**
 * Key a venue on its name, so the two suppliers' id spaces line up.
 *
 * This is a JOIN key, not a display slug — separators are removed entirely
 * rather than collapsed to hyphens, because the two suppliers disagree about
 * spacing and punctuation far more often than about the words themselves:
 *
 *   "Jan Breydel Stadion"  / "Jan Breydelstadion"    -> janbreydelstadion
 *   "St Marys Stadium"     / "St. Mary's Stadium"    -> stmarysstadium
 *   "Estadio Ramon Sanchez Pizjuan" / "...Sánchez Pizjuán" -> same
 *
 * Parenthesised alternates are dropped from the key but kept in the display
 * name, so "Crypto.com Arena (Staples Center)" keys as cryptocomarena.
 */
export function venueKeyFor(name) {
  const clean = safeText(name, LIMITS.maxVenueLen);
  const compact = (s) => stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80);
  return compact(clean.replace(/\([^)]*\)/g, ' ')) || compact(clean);
}

// ── Team names ───────────────────────────────────────────────────────────────

/**
 * Reduce a team name to a comparison key.
 *
 * Only club-type tokens come off, and only from the ends: "Aberdeen FC" and
 * "Aberdeen" match, while "Manchester United" and "Manchester City" stay apart.
 * Parenthesised alternates are dropped, so "Crvena Zvezda ( Red Star Belgrade )"
 * keys as crvena-zvezda.
 */
export function normaliseTeamName(raw) {
  // Periods go before slugging, not after. "A.F.C. Bournemouth" slugs to
  // a-f-c-bournemouth, whose leading tokens are three single letters that no
  // club-token list will ever match, so it never collapses onto "AFC
  // Bournemouth". Dropping the dots first turns it into afc-bournemouth and the
  // normal rule takes it from there. 15 keys in the feed have this shape,
  // including Olympiacos F.C., Lommel S.K. and A.C. Monza.
  const base = safeText(raw, 120).replace(/\([^)]*\)/g, ' ').replace(/\./g, '');
  let tokens = slugify(base, 120).split('-').filter(Boolean);
  // "Saint Mirren FC" and "St Mirren" are one club. No two different clubs
  // differ only by which way that word is written.
  tokens = tokens.map((t) => (t === 'saint' ? 'st' : t));
  // Connector words carry no identity: "Standard de Liege" is "Standard Liege"
  // and "Racing de Santander" is "Racing Santander".
  tokens = tokens.filter((t) => !CONNECTOR_TOKENS.has(t));
  // Club-type tokens come off wherever they sit, not just at the ends, so
  // "Athletic Club Bilbao" meets "Athletic Bilbao". Never all of them: a name
  // made only of club words keeps itself.
  const stripped = tokens.filter((t) => !CLUB_TOKENS.has(t));
  if (stripped.length) tokens = stripped;
  return tokens.join('-');
}

/**
 * "To be decided" is not a team.
 *
 * 133 rows carry a placeholder on one or both sides — NFL wildcard slots, WNBA
 * playoff spots, the whole 2026 volleyball European Championship knockout. They
 * must never merge: four different quarter-finals on one day all read
 * "To be decided vs To be decided" and folding them together would delete three
 * real, bookable events.
 */
const PLACEHOLDER_TEAM_RE = /^(to be (decided|confirmed|announced)|tb[acd]|winner\b.*|loser\b.*|qualifier\b.*)$/i;

export function isPlaceholderTeam(raw) {
  return PLACEHOLDER_TEAM_RE.test(safeText(raw, 60));
}

/**
 * Suffix words that can be dropped when one club name is a prefix of another
 * IN THE SAME COMPETITION. "Coventry" and "Coventry City" are one club, so a
 * league page must not list both.
 *
 * "united" is deliberately absent, and this is not caution for its own sake:
 * the Scottish Premiership carries Dundee FC and Dundee United, which are two
 * different clubs whose keys sit in exactly this prefix relationship. Including
 * "united" would merge them. Same reasoning excludes rovers, wanderers,
 * athletic, county and rangers.
 */
const CONNECTOR_TOKENS = new Set(['de', 'du', 'di', 'del', 'of', 'the']);

const MERGEABLE_SUFFIXES = new Set([
  'city', 'town', 'fc', 'afc', 'cf', 'bc', 'hc', 'sk', 'vv', 'club',
  'calcio', 'balompie', '1907',
]);

/**
 * Collapse club aliases the feed spells two ways, using the competition as the
 * evidence. A league does not contain both "Ipswich" and "Ipswich Town", so
 * when two keys in one competition differ only by a mergeable suffix they are
 * the same club and the shorter key wins.
 *
 * Restricting it to a shared competition is what makes this safe. Across the
 * whole feed the same test would be a guess; inside one league it is a fact.
 * Against the 28 Jul 2026 export it finds six pairs and no false ones.
 */
function resolveTeamAliases(events) {
  const perCompetition = new Map();
  for (const e of events) {
    if (!e.competition) continue;
    let bucket = perCompetition.get(e.competition);
    if (!bucket) { bucket = new Set(); perCompetition.set(e.competition, bucket); }
    if (e.homeTeamKey) bucket.add(e.homeTeamKey);
    if (e.awayTeamKey) bucket.add(e.awayTeamKey);
  }

  const alias = new Map(); // long key -> short key
  for (const keys of perCompetition.values()) {
    const list = [...keys];
    for (const shorter of list) {
      for (const longer of list) {
        if (shorter === longer || !longer.startsWith(`${shorter}-`)) continue;
        const rest = longer.slice(shorter.length + 1).split('-');
        if (rest.every((w) => MERGEABLE_SUFFIXES.has(w))) alias.set(longer, shorter);
      }
    }
  }

  // Follow chains so a-b-c lands on a, not on a-b. Bounded by the map size.
  const canonical = (k) => {
    let cur = k;
    for (let i = 0; i < 8 && alias.has(cur); i++) cur = alias.get(cur);
    return cur;
  };

  const applied = new Map();
  for (const e of events) {
    for (const field of ['homeTeamKey', 'awayTeamKey']) {
      const key = e[field];
      if (!key) continue;
      const c = canonical(key);
      if (c !== key) { e[field] = c; applied.set(key, c); }
    }
  }

  // Whatever is still in a prefix relationship inside one competition but was
  // NOT safe to merge. Some are aliases the rules cannot reach (Genoa / Genoa
  // CFC), some are real rivals (Dundee FC / Dundee United), and telling them
  // apart needs a person. Reported, never applied.
  const candidates = [];
  const seen = new Set();
  for (const keys of perCompetition.values()) {
    const list = [...keys].map(canonical);
    for (const a of list) {
      for (const b of list) {
        if (a === b || !b.startsWith(`${a}-`)) continue;
        const id = `${a}|${b}`;
        if (seen.has(id)) continue;
        seen.add(id);
        candidates.push({ shorter: a, longer: b });
      }
    }
  }

  return {
    applied: [...applied.entries()].map(([from, to]) => ({ from, to })).sort((a, b) => (a.from < b.from ? -1 : 1)),
    candidates: candidates.sort((a, b) => (a.shorter < b.shorter ? -1 : 1)),
  };
}

// ── Taxonomy resolution ──────────────────────────────────────────────────────

function resolveCategory(rawCategory) {
  const key = aliasKey(rawCategory);
  if (!key) return null;
  return CATEGORY_BY_ALIAS.get(key) || null;
}

function resolveCompetition(categorySlug, rawCompetition) {
  const key = aliasKey(rawCompetition);
  if (!key) return null;
  const bucket = COMPETITION_BY_CATEGORY.get(categorySlug);
  return (bucket && bucket.get(key)) || null;
}

/**
 * Resolve a truncated fragment against the vocabulary of intact rows.
 * Unique prefix match wins. Zero or several matches means we do not know, and
 * we say so rather than picking one.
 */
function resolveByPrefix(fragment, vocabulary) {
  const frag = aliasKey(fragment);
  if (frag.length < 3) return null;
  let hit = null;
  for (const candidate of vocabulary) {
    if (!candidate.startsWith(frag)) continue;
    if (hit && hit !== candidate) return null;
    hit = candidate;
  }
  return hit;
}

// ── Row normalisation ────────────────────────────────────────────────────────

/** Accepts both the spreadsheet headers and already-camelCased keys. */
function readField(row, ...names) {
  for (const n of names) {
    const v = row[n];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function classifyKind(categorySlug, isFixture) {
  if (isFixture) return 'fixture';
  if (categorySlug === 'entertainment') return 'performance';
  return 'event';
}

/**
 * Normalise one row. Returns { ok: true, event } or { ok: false, reason }.
 * Taxonomy repair happens later, once the whole batch has been seen.
 */
function normaliseRow(row, index) {
  const supplierRaw = safeText(readField(row, 'Supplier', 'supplier'), 64);
  const searchboxId = safeText(readField(row, 'Event ID For Searchbox', 'searchboxId'), LIMITS.maxIdLen);
  const filterId = safeText(readField(row, 'Event ID For Filters', 'filterId'), LIMITS.maxIdLen);
  const nameRaw = readField(row, 'Event Name', 'eventName', 'name');
  const startRaw = readField(row, 'Start Date/Time', 'startDateTime', 'start');
  const venueName = safeText(readField(row, 'Venue Name', 'venueName'), LIMITS.maxVenueLen);
  const venueId = safeText(readField(row, 'Venue ID', 'venueId'), LIMITS.maxIdLen);

  if (!supplierRaw) return { ok: false, reason: 'missing-supplier', index };
  if (!searchboxId && !filterId) return { ok: false, reason: 'missing-event-id', index };
  if (!nameRaw) return { ok: false, reason: 'missing-name', index };

  const start = parseStart(startRaw);
  if (!start) return { ok: false, reason: 'unparseable-start', index };

  const supplierDef = SUPPLIER_BY_ALIAS.get(aliasKey(supplierRaw));
  const supplier = supplierDef ? supplierDef.slug : slugify(supplierRaw) || 'unknown';
  const supplierLabel = supplierDef ? supplierDef.label : supplierRaw;

  const { subject, taxonomy, truncated, taxonomyMissing } = splitNameAndTaxonomy(nameRaw);
  const parts = taxonomy ? splitTopLevel(taxonomy, ',') : [];
  const rawCategory = parts.length ? parts[0] : '';
  const rawCompetition = parts.length > 1 ? parts.slice(1).join(', ') : '';

  const { phase, rest } = splitPhase(subject);
  const fixture = splitFixture(rest);

  const event = {
    // Identity
    uid: `${supplier}:${filterId || searchboxId}`,
    supplier,
    supplierLabel,
    searchboxId,
    filterId,

    // Display
    title: rest,
    phase,
    truncated,
    // The name exactly as the feed wrote it, taxonomy bracket and all. The
    // Travelify ticket deeplink puts it in `loc` verbatim, so it has to survive
    // the pass that strips it off the title.
    rawName: safeText(nameRaw, LIMITS.maxNameLen),

    // Taxonomy — filled in by applyTaxonomy() once the batch has been seen
    category: null,
    categoryLabel: null,
    categoryRaw: rawCategory || null,
    competition: null,
    competitionLabel: null,
    competitionRaw: rawCompetition || null,
    taxonomyRepaired: false,
    taxonomyMissing,

    // Shape
    kind: null,
    homeTeam: fixture ? fixture.home : null,
    awayTeam: fixture ? fixture.away : null,
    hasPlaceholderTeams: Boolean(
      fixture && (isPlaceholderTeam(fixture.home) || isPlaceholderTeam(fixture.away)),
    ),
    // Entity keys live on the row from here on. resolveTeamAliases() rewrites
    // them to canonical clubs before anything merges or indexes on them.
    homeTeamKey: null,
    awayTeamKey: null,
    performerKey: null,
    performer: null,
    locationText: null,

    // When (naive local, no timezone — see parseStart)
    startDate: start.startDate,
    startTime: start.startTime,
    startsAtLocal: start.startsAtLocal,
    timeKnown: start.timeKnown,

    // Where
    venue: { key: venueKeyFor(venueName), name: venueName, supplierId: venueId },

    _minuteOfDay: start.minuteOfDay,
    _subject: rest,
  };

  return { ok: true, event };
}

/** Second pass: resolve taxonomy, repairing truncated fragments from the batch. */
function applyTaxonomy(events) {
  // Vocabulary of intact labels, harvested from the rows that were not cut.
  const categoryVocab = new Set();
  const competitionVocab = new Map(); // raw category key -> Set(raw competition key)
  for (const e of events) {
    if (e.truncated || !e.categoryRaw) continue;
    const ck = aliasKey(e.categoryRaw);
    categoryVocab.add(ck);
    if (!e.competitionRaw) continue;
    let bucket = competitionVocab.get(ck);
    if (!bucket) { bucket = new Set(); competitionVocab.set(ck, bucket); }
    bucket.add(aliasKey(e.competitionRaw));
  }

  const stats = {
    repairedCategory: 0,
    repairedCompetition: 0,
    truncatedCategoryLost: 0,
    truncatedCompetitionLost: 0,
    unresolvedCategory: 0,
    unresolvedCompetition: 0,
    taxonomyMissing: 0,
  };

  for (const e of events) {
    let catRaw = e.categoryRaw;
    let compRaw = e.competitionRaw;

    if (e.truncated) {
      let repaired = false;
      if (!resolveCategory(catRaw)) {
        const catFix = resolveByPrefix(catRaw, categoryVocab);
        if (catFix) { catRaw = catFix; repaired = true; stats.repairedCategory++; }
      }
      const bucket = competitionVocab.get(aliasKey(catRaw));
      if (bucket && compRaw) {
        const compFix = resolveByPrefix(compRaw, bucket);
        if (compFix && compFix !== aliasKey(compRaw)) {
          compRaw = compFix; repaired = true; stats.repairedCompetition++;
        }
      }
      e.taxonomyRepaired = repaired;
    }

    const cat = resolveCategory(catRaw);
    if (cat) {
      e.category = cat.slug;
      e.categoryLabel = cat.label;
    } else if (catRaw) {
      e.category = slugify(catRaw) || null;
      e.categoryLabel = safeText(catRaw, 64) || null;
      stats.unresolvedCategory++;
    }

    if (e.category) {
      let comp = compRaw ? resolveCompetition(e.category, compRaw) : null;
      if (!comp && !compRaw) {
        // XS2Event files Formula 1 and MotoGP as bare categories.
        const implied = CATEGORY_IMPLIES_COMPETITION.get(aliasKey(catRaw));
        if (implied) comp = COMPETITION_BY_SLUG.get(implied) || null;
      }
      if (comp) {
        e.competition = comp.slug;
        e.competitionLabel = comp.label;
      } else if (compRaw) {
        e.competition = slugify(compRaw) || null;
        e.competitionLabel = safeText(compRaw, 96) || null;
        stats.unresolvedCompetition++;
      }
    }

    e.categoryRaw = catRaw || null;
    e.competitionRaw = compRaw || null;
    e.kind = classifyKind(e.category, Boolean(e.homeTeam && e.awayTeam));

    if (e.taxonomyMissing) stats.taxonomyMissing++;
    if (e.truncated && !e.category) stats.truncatedCategoryLost++;
    if (e.truncated && !e.competition) stats.truncatedCompetitionLost++;

    if (e.kind === 'performance') {
      const { performer, location } = splitPerformance(e._subject);
      e.performer = performer || null;
      e.locationText = location;
      e.performerKey = performer ? slugify(performer) || null : null;
      if (performer) e.title = performer;
    }

    if (e.kind === 'fixture' && !e.hasPlaceholderTeams) {
      e.homeTeamKey = normaliseTeamName(e.homeTeam) || null;
      e.awayTeamKey = normaliseTeamName(e.awayTeam) || null;
    }
  }

  return stats;
}

// ── Identity and merging ─────────────────────────────────────────────────────

/**
 * The key two rows must share to be the same real-world event.
 *
 * Date, not timestamp: the suppliers disagree on kick-off times and 336 rows
 * carry a placeholder. Time is used afterwards, to split a day's worth of
 * matches between the same two teams (an MLB doubleheader) back apart.
 *
 * Fixture sides are sorted, so a supplier listing "B vs A" still merges. Two
 * clubs cannot meet twice on one date in one competition with the home side
 * swapped, so sorting cannot merge two genuinely different fixtures.
 */
export function identityKeyFor(event) {
  // A placeholder side carries no identity, so the row can only ever be itself.
  if (event.hasPlaceholderTeams) return `x|${event.uid}`;

  if (event.kind === 'fixture') {
    // The resolved keys when the pass set them, so an alias collapsed by
    // resolveTeamAliases() merges too: the feed lists one Arsenal friendly as
    // "Arsenal vs Como" and again as "Arsenal vs Como 1907".
    const a = event.homeTeamKey || normaliseTeamName(event.homeTeam);
    const b = event.awayTeamKey || normaliseTeamName(event.awayTeam);
    if (a && b) {
      const [x, y] = a < b ? [a, b] : [b, a];
      return `f|${event.category || '?'}|${event.startDate}|${x}|${y}`;
    }
  }
  if (event.kind === 'performance' && event.performer) {
    const p = event.performerKey || slugify(event.performer);
    return `p|${p}|${event.startDate}|${event.venue.key}`;
  }
  return `o|${event.category || '?'}|${event.startDate}|${event.venue.key}|${slugify(event._subject, 60)}`;
}

/**
 * Split one identity group into clusters by start time, so an MLB doubleheader
 * stays two events rather than folding into one.
 *
 * A row with no known time joins the cluster when there is only one to join.
 * When the day already holds two or more real kick-offs there is no honest way
 * to say which one the placeholder belongs to, so it stays separate rather than
 * being attached to whichever happens to be first.
 */
function clusterByTime(group, windowMinutes) {
  const known = group.filter((e) => e.timeKnown).sort((a, b) => a._minuteOfDay - b._minuteOfDay);
  const unknown = group.filter((e) => !e.timeKnown);
  if (!known.length) return [group];

  const clusters = [];
  for (const e of known) {
    const last = clusters[clusters.length - 1];
    if (last && e._minuteOfDay - last.anchor <= windowMinutes) last.rows.push(e);
    else clusters.push({ anchor: e._minuteOfDay, rows: [e] });
  }
  if (unknown.length) {
    if (clusters.length === 1) clusters[0].rows.push(...unknown);
    else clusters.push({ anchor: -1, rows: unknown });
  }
  return clusters.map((c) => c.rows);
}

function sourceOf(event) {
  return {
    supplier: event.supplier,
    supplierLabel: event.supplierLabel,
    searchboxId: event.searchboxId,
    filterId: event.filterId,
    rawName: event.rawName,
    startsAtLocal: event.startsAtLocal,
    startTime: event.startTime,
    timeKnown: event.timeKnown,
    venueKey: event.venue.key,
    venueName: event.venue.name,
    venueSupplierId: event.venue.supplierId,
  };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/**
 * Two things worth knowing that only become visible once events are merged.
 *
 * TIME OFFSETS. The suppliers do not share a timezone convention, and the gaps
 * are not noise — they land on the hour. Against the 28 Jul 2026 export,
 * XS2Event runs +60 minutes on every Premier League, Championship and Six
 * Nations fixture, +120 on Ligue 1 and the Belgian Pro League, and −60 across
 * the Segunda División. Neither feed can be assumed to be venue-local, so this
 * pass never converts one into the other: it keeps both times on the record,
 * takes the display time from supplierPriority, and counts the disagreements
 * here so the size of the problem stays in view. Fixing it properly needs a
 * venue-to-timezone table, which this feed does not carry.
 *
 * VENUE ALIASES. A confirmed merge whose sources name different venues is
 * evidence those two names are one ground — "San Siro" and "Stadio San Siro
 * (Giuseppe Meazza)", "RCDE Stadium" and "Estadi Cornellà-El Prat". They are
 * reported as candidates rather than applied, because the same signal also
 * catches genuine supplier errors: one Angels fixture is listed at Dodger
 * Stadium. The support count separates them — a real alias recurs, a mistake
 * appears once.
 */
function summariseConflicts(events, supplierPriority) {
  const timeOffsets = new Map();
  const venueAliases = new Map();

  for (const e of events) {
    if (!e.conflicts) continue;

    if (e.conflicts.startTime && e.sources.length === 2) {
      const [a, b] = [...e.sources].sort(
        (x, y) => supplierPriority.indexOf(x.supplier) - supplierPriority.indexOf(y.supplier),
      );
      if (a.timeKnown && b.timeKnown && a.supplier !== b.supplier) {
        const offset = toMinutes(b.startTime) - toMinutes(a.startTime);
        const bucket = timeOffsets.get(offset) || { offsetMinutes: offset, count: 0, competitions: new Map() };
        bucket.count++;
        const c = e.competitionLabel || 'unknown';
        bucket.competitions.set(c, (bucket.competitions.get(c) || 0) + 1);
        timeOffsets.set(offset, bucket);
      }
    }

    if (e.conflicts.venue) {
      const pairs = [...new Map(e.sources.map((s) => [s.venueKey, s.venueName])).entries()]
        .sort((x, y) => (x[0] < y[0] ? -1 : 1));
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          const id = `${pairs[i][0]}|${pairs[j][0]}`;
          const hit = venueAliases.get(id) || { names: [pairs[i][1], pairs[j][1]], support: 0 };
          hit.support++;
          venueAliases.set(id, hit);
        }
      }
    }
  }

  return {
    timeOffsets: [...timeOffsets.values()]
      .sort((a, b) => b.count - a.count)
      .map((b) => ({
        offsetMinutes: b.offsetMinutes,
        count: b.count,
        competitions: Object.fromEntries([...b.competitions].sort((x, y) => y[1] - x[1])),
      })),
    venueAliasCandidates: [...venueAliases.values()].sort((a, b) => b.support - a.support),
  };
}

function mergeCluster(rows, priority) {
  const rank = (e) => {
    const i = priority.indexOf(e.supplier);
    return i === -1 ? priority.length : i;
  };
  const ordered = [...rows].sort((a, b) => {
    // Prefer the priority supplier, then a row that actually knows the time.
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.timeKnown !== b.timeKnown) return a.timeKnown ? -1 : 1;
    return a.uid < b.uid ? -1 : 1;
  });
  const primary = ordered[0];
  const withTime = ordered.find((e) => e.timeKnown) || primary;

  const conflicts = {};
  // Compared on the join key, not the raw name: the suppliers spell the same
  // ground half a dozen ways ("San Siro" / "Stadio San Siro (Giuseppe Meazza)")
  // and reporting that as a conflict would bury the handful of merges where the
  // venues are genuinely different. The spellings are kept in the registry.
  const venueKeys = new Set(ordered.map((e) => e.venue.key).filter(Boolean));
  if (venueKeys.size > 1) {
    conflicts.venue = [...new Set(ordered.map((e) => e.venue.name).filter(Boolean))];
  }
  const times = [...new Set(ordered.filter((e) => e.timeKnown).map((e) => e.startTime))];
  if (times.length > 1) conflicts.startTime = times;
  const comps = [...new Set(ordered.map((e) => e.competition).filter(Boolean))];
  if (comps.length > 1) conflicts.competition = comps;

  return {
    id: `${primary.supplier}:${primary.filterId || primary.searchboxId}`,
    title: primary.title,
    phase: primary.phase,
    kind: primary.kind,
    category: primary.category,
    categoryLabel: primary.categoryLabel,
    competition: primary.competition,
    competitionLabel: primary.competitionLabel,
    homeTeam: primary.homeTeam,
    homeTeamKey: primary.homeTeamKey,
    awayTeam: primary.awayTeam,
    awayTeamKey: primary.awayTeamKey,
    hasPlaceholderTeams: primary.hasPlaceholderTeams,
    performer: primary.performer,
    performerKey: primary.performerKey,
    locationText: primary.locationText,

    startDate: withTime.startDate,
    startTime: withTime.startTime,
    startsAtLocal: withTime.startsAtLocal,
    timeKnown: withTime.timeKnown,

    venue: { key: primary.venue.key, name: primary.venue.name },

    truncated: ordered.every((e) => e.truncated),
    taxonomyRepaired: ordered.some((e) => e.taxonomyRepaired),

    sources: ordered.map(sourceOf),
    suppliers: [...new Set(ordered.map((e) => e.supplier))],
    conflicts: Object.keys(conflicts).length ? conflicts : null,
  };
}

// ── Venue registry ───────────────────────────────────────────────────────────

function buildVenues(events) {
  const byKey = new Map();
  for (const e of events) {
    const k = e.venue.key;
    if (!k) continue;
    let v = byKey.get(k);
    if (!v) { v = { key: k, name: e.venue.name, names: new Map(), ids: new Map() }; byKey.set(k, v); }
    v.names.set(e.venue.name, (v.names.get(e.venue.name) || 0) + 1);
    if (e.venue.supplierId) {
      let ids = v.ids.get(e.supplier);
      if (!ids) { ids = new Set(); v.ids.set(e.supplier, ids); }
      ids.add(e.venue.supplierId);
    }
  }
  return [...byKey.values()]
    .map((v) => {
      // Most frequently used spelling wins, longest breaks the tie so the
      // "(Staples Center)" hint survives.
      let best = v.name;
      let bestCount = -1;
      for (const [name, count] of v.names) {
        if (count > bestCount || (count === bestCount && name.length > best.length)) { best = name; bestCount = count; }
      }
      const ids = {};
      for (const [supplier, set] of v.ids) ids[supplier] = [...set].sort();
      return { key: v.key, name: best, aliases: [...v.names.keys()].filter((n) => n !== best).sort(), ids };
    })
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Normalise a batch of supplier feed rows.
 *
 * @param {Array<object>} rows Raw rows, spreadsheet headers or camelCase keys.
 * @param {object} [options]
 * @param {boolean} [options.merge=true] Merge duplicates into one record each.
 * @param {number}  [options.mergeWindowMinutes=360] Max gap between two rows
 *   still counted as the same event. Lower it to keep doubleheaders apart.
 * @param {string[]} [options.supplierPriority] Which supplier supplies the
 *   display fields on a merged record.
 * @param {string} [options.notBefore] 'YYYY-MM-DD'. Drops earlier events.
 *   Pass it explicitly; this function never reads the clock itself.
 * @param {number} [options.maxRows]
 * @returns {{ events: object[], venues: object[], report: object }}
 */
export function normaliseSupplierEvents(rows, options = {}) {
  const {
    merge = true,
    mergeWindowMinutes = DEFAULT_MERGE_WINDOW_MINUTES,
    supplierPriority = DEFAULT_SUPPLIER_PRIORITY,
    notBefore = null,
    maxRows = LIMITS.maxRows,
  } = options;

  const list = Array.isArray(rows) ? rows : [];
  const inputTruncated = list.length > maxRows;
  const slice = inputTruncated ? list.slice(0, maxRows) : list;

  const rejected = [];
  const parsed = [];
  const seenUid = new Set();

  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    if (!row || typeof row !== 'object') { rejected.push({ index: i, reason: 'not-an-object' }); continue; }
    const result = normaliseRow(row, i);
    if (!result.ok) { rejected.push({ index: i, reason: result.reason }); continue; }
    if (seenUid.has(result.event.uid)) { rejected.push({ index: i, reason: 'duplicate-supplier-id' }); continue; }
    seenUid.add(result.event.uid);
    parsed.push(result.event);
  }

  const taxonomyStats = applyTaxonomy(parsed);
  const { applied: teamAliases, candidates: teamAliasCandidates } = resolveTeamAliases(parsed);

  const cutoff = typeof notBefore === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(notBefore) ? notBefore : null;
  const kept = cutoff ? parsed.filter((e) => e.startDate >= cutoff) : parsed;
  const droppedPast = parsed.length - kept.length;

  const venues = buildVenues(kept);

  let events;
  let mergedAway = 0;
  let crossSupplier = 0;
  let conflictCount = 0;

  if (merge) {
    const groups = new Map();
    for (const e of kept) {
      const k = identityKeyFor(e);
      let g = groups.get(k);
      if (!g) { g = []; groups.set(k, g); }
      g.push(e);
    }
    events = [];
    for (const group of groups.values()) {
      for (const cluster of clusterByTime(group, mergeWindowMinutes)) {
        const record = mergeCluster(cluster, supplierPriority);
        if (cluster.length > 1) mergedAway += cluster.length - 1;
        if (record.suppliers.length > 1) crossSupplier++;
        if (record.conflicts) conflictCount++;
        events.push(record);
      }
    }
  } else {
    events = kept.map((e) => mergeCluster([e], supplierPriority));
  }

  events.sort((a, b) => (
    a.startsAtLocal < b.startsAtLocal ? -1
      : a.startsAtLocal > b.startsAtLocal ? 1
        : a.id < b.id ? -1 : 1
  ));

  const { timeOffsets, venueAliasCandidates } = summariseConflicts(events, supplierPriority);

  const bySupplier = {};
  for (const e of kept) bySupplier[e.supplier] = (bySupplier[e.supplier] || 0) + 1;
  const byCategory = {};
  for (const e of events) {
    const k = e.category || 'unclassified';
    byCategory[k] = (byCategory[k] || 0) + 1;
  }

  return {
    events,
    venues,
    report: {
      rowsIn: list.length,
      rowsProcessed: slice.length,
      inputTruncated,
      parsed: parsed.length,
      rejected: rejected.length,
      rejectedReasons: rejected.reduce((acc, r) => { acc[r.reason] = (acc[r.reason] || 0) + 1; return acc; }, {}),
      rejectedRows: rejected.slice(0, 50),
      droppedBefore: cutoff,
      droppedPast,
      eventsOut: events.length,
      mergedAway,
      crossSupplierMerges: crossSupplier,
      conflicts: conflictCount,
      venues: venues.length,
      venuesWithBothSuppliers: venues.filter((v) => Object.keys(v.ids).length > 1).length,
      nameTruncated: parsed.filter((e) => e.truncated).length,
      placeholderTeams: parsed.filter((e) => e.hasPlaceholderTeams).length,
      timeOffsets,
      venueAliasCandidates,
      teamAliases,
      teamAliasCandidates,
      ...taxonomyStats,
      bySupplier,
      byCategory,
    },
  };
}
