/**
 * Supplier event normalisation — unit and behaviour tests.
 *
 * Every case here is a shape that actually appears in the "Supplier Event
 * Listings" export, or a trap that the export sets. The interesting ones are
 * the traps, because they are the reasons the pass is not a one-liner:
 *
 *   - "Serie A" is Italy to XS2Event and Brazil to SportsEvents365
 *   - "Bundesliga" is Germany, "Bundesliga AT" is Austria
 *   - the name cap cuts the taxonomy bracket, sometimes leaving a name that is
 *     still parenthesis-balanced and reads as a different category
 *   - a trailing bracket is sometimes a description, not a taxonomy
 *   - "To be decided vs To be decided" is four different volleyball matches
 *   - Manchester United and Manchester City must never collapse together
 *
 * Run: node test/supplier-events-normalise-smoke.mjs
 */
import {
  normaliseSupplierEvents,
  splitNameAndTaxonomy,
  parseStart,
  venueKeyFor,
  normaliseTeamName,
  isPlaceholderTeam,
  safeText,
  slugify,
  identityKeyFor,
} from '../api/_lib/events/supplier-normalise.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const eq = (a, b, label) => ok(a === b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/** Build a feed row without going through an object literal, so a "__proto__"
 *  key in a test fixture cannot quietly set a prototype instead of a field. */
const row = (supplier, id, name, start, venue, venueId) => {
  const o = Object.create(null);
  o.Supplier = supplier;
  o['Event ID For Searchbox'] = `${supplier === 'XS2Event' ? '144' : '179'}:${id}`;
  o['Event ID For Filters'] = id;
  o['Event Name'] = name;
  o['Start Date/Time'] = start;
  o['Venue Name'] = venue;
  o['Venue ID'] = venueId ?? 'v1';
  return o;
};

// ── safeText ─────────────────────────────────────────────────────────────────
{
  eq(safeText('<script>alert(1)</script>Chelsea'), 'alert(1)Chelsea', 'safeText strips tags');
  eq(safeText('a\u0000b\u001Fc'), 'a b c', 'safeText removes control characters');
  eq(safeText('  lots   of\n space '), 'lots of space', 'safeText collapses whitespace');
  eq(safeText('abcdef', 3), 'abc', 'safeText caps length');
  eq(safeText(null), '', 'safeText tolerates null');
  eq(safeText(undefined), '', 'safeText tolerates undefined');
  eq(safeText(42), '42', 'safeText coerces numbers');
  ok(safeText({}).length >= 0, 'safeText never throws on an object');
  eq(slugify('Estadio Santiago Bernabéu'), 'estadio-santiago-bernabeu', 'slugify strips diacritics');
  eq(slugify('!!!'), '', 'slugify returns empty when nothing survives');
}

// ── Name and taxonomy splitting ──────────────────────────────────────────────
{
  const complete = splitNameAndTaxonomy('Everton FC vs Crystal Palace (Football (Soccer), English Premier League)');
  eq(complete.subject, 'Everton FC vs Crystal Palace', 'complete name: subject');
  eq(complete.taxonomy, 'Football (Soccer), English Premier League', 'complete name: taxonomy');
  eq(complete.truncated, false, 'complete name: not truncated');

  // 100 chars and balanced — length alone would wrongly call this truncated.
  const atCap = splitNameAndTaxonomy('Second Qualifying Round: Gyori ETO FC vs FC Atert Bissen (Football (Soccer), UEFA Conference League)');
  eq(atCap.truncated, false, '100-char but balanced name is not truncated');
  eq(atCap.taxonomy, 'Football (Soccer), UEFA Conference League', '100-char balanced name keeps its taxonomy');

  const cut = splitNameAndTaxonomy('Second Qualifying Round: Hapoel Beer Sheva vs Vikingur Reykjavik (Football (Soccer), UEFA Champions');
  eq(cut.truncated, true, 'unbalanced name is truncated');
  eq(cut.subject, 'Second Qualifying Round: Hapoel Beer Sheva vs Vikingur Reykjavik', 'truncated name keeps its intact subject');

  // THE TRAP: ends with ')' but the outer group never closes. A backwards scan
  // reads the category as "tennis - Grand Slam"; only balance gets this right.
  const trap = splitNameAndTaxonomy('Session 9 - Grounds Admission Only (Tennis, US Open (tennis - Grand Slam)');
  eq(trap.truncated, true, 'trap: ends in ) but is truncated');
  ok(trap.taxonomy.startsWith('Tennis,'), 'trap: category read as Tennis, not the inner bracket');

  // A trailing bracket that is a description, not a taxonomy.
  const desc = splitNameAndTaxonomy('2026 Buffalo Bills Season Tickets (Includes Tickets To All Regular Season Home Games)');
  eq(desc.taxonomyMissing, true, 'description bracket is not taxonomy');
  eq(desc.subject, '2026 Buffalo Bills Season Tickets (Includes Tickets To All Regular Season Home Games)',
    'description bracket stays in the title');

  const bare = splitNameAndTaxonomy('Some Event With No Bracket');
  eq(bare.taxonomyMissing, true, 'no bracket at all is flagged');
  eq(bare.subject, 'Some Event With No Bracket', 'no bracket: title untouched');
}

// ── Dates ────────────────────────────────────────────────────────────────────
{
  const s = parseStart('2026-08-22 15:00:00');
  eq(s.startDate, '2026-08-22', 'parseStart: date');
  eq(s.startTime, '15:00', 'parseStart: time');
  eq(s.timeKnown, true, 'parseStart: time known');
  eq(s.startsAtLocal, '2026-08-22T15:00:00', 'parseStart: naive local, no Z');
  ok(!/Z|\+\d\d:\d\d/.test(s.startsAtLocal), 'parseStart never invents a timezone');

  const midnight = parseStart('2026-08-22 00:00:00');
  eq(midnight.timeKnown, false, 'midnight is treated as time-not-supplied');
  eq(midnight.startTime, null, 'midnight yields a null time');
  eq(midnight.startDate, '2026-08-22', 'midnight still trusts the date');

  eq(parseStart('2026-02-31 12:00:00'), null, 'parseStart rejects 31 February');
  eq(parseStart('2026-13-01 12:00:00'), null, 'parseStart rejects month 13');
  eq(parseStart('not a date'), null, 'parseStart rejects junk');
  eq(parseStart(''), null, 'parseStart rejects empty');
  ok(parseStart('2026-08-22T15:00:00') !== null, 'parseStart accepts a T separator');
}

// ── Venues ───────────────────────────────────────────────────────────────────
{
  eq(venueKeyFor('Jan Breydel Stadion'), venueKeyFor('Jan Breydelstadion'), 'venue key ignores spacing');
  eq(venueKeyFor('St Marys Stadium'), venueKeyFor("St. Mary's Stadium"), 'venue key ignores punctuation');
  eq(venueKeyFor('Estadio Ramon Sanchez Pizjuan'), venueKeyFor('Estadio Ramón Sánchez Pizjuán'), 'venue key ignores accents');
  eq(venueKeyFor('Celtic Park (Parkhead)'), venueKeyFor('Celtic Park'), 'venue key drops a parenthesised alternate');
  ok(venueKeyFor('Anfield') !== venueKeyFor('Emirates Stadium'), 'different venues keep different keys');
  ok(venueKeyFor('(Only Brackets)').length > 0, 'a fully parenthesised name still yields a key');
}

// ── Team names ───────────────────────────────────────────────────────────────
{
  eq(normaliseTeamName('Aberdeen FC'), normaliseTeamName('Aberdeen'), 'trailing FC does not change identity');
  eq(normaliseTeamName('AFC Ajax'), normaliseTeamName('Ajax'), 'leading AFC does not change identity');
  eq(normaliseTeamName('Crvena Zvezda ( Red Star Belgrade )'), 'crvena-zvezda', 'parenthesised alternate is dropped');
  eq(normaliseTeamName('Standard Liège'), normaliseTeamName('Standard Liege'), 'accents do not change identity');

  // The one that must never break.
  ok(normaliseTeamName('Manchester United') !== normaliseTeamName('Manchester City'),
    'United and City stay apart');
  ok(normaliseTeamName('Bolton Wanderers') !== normaliseTeamName('Bolton'),
    'Wanderers is part of the name, not a club-type token');
  eq(normaliseTeamName('FC'), 'fc', 'a name that is only a club token is not emptied');

  ok(isPlaceholderTeam('To be decided'), 'placeholder: to be decided');
  ok(isPlaceholderTeam('TBD'), 'placeholder: TBD');
  ok(isPlaceholderTeam('Winner of Group A'), 'placeholder: winner of');
  ok(!isPlaceholderTeam('Real Madrid'), 'a real club is not a placeholder');
}

// ── Cross-supplier merge ─────────────────────────────────────────────────────
{
  const { events, report } = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'Everton FC vs Crystal Palace (Football (Soccer), English Premier League)', '2026-08-22 15:00:00', 'Goodison Park', '11'),
    row('XS2Event', 'abc_spp', 'Everton vs Crystal Palace FC (Football, Premier League)', '2026-08-22 16:00:00', 'Goodison Park', 'x_vnx'),
  ]);
  eq(events.length, 1, 'the same fixture from both suppliers becomes one event');
  eq(report.crossSupplierMerges, 1, 'the merge is counted as cross-supplier');
  eq(events[0].competition, 'english-premier-league', 'both taxonomies resolve to one competition');
  eq(events[0].sources.length, 2, 'both suppliers stay bookable');
  ok(events[0].sources.some((s) => s.filterId === '1') && events[0].sources.some((s) => s.filterId === 'abc_spp'),
    'both supplier event ids survive the merge');
  eq(events[0].supplier ?? events[0].sources[0].supplier, 'sportsevents365', 'supplierPriority picks the display source');
  ok(events[0].conflicts && events[0].conflicts.startTime, 'the one-hour time disagreement is recorded, not hidden');
  eq(report.timeOffsets[0].offsetMinutes, 60, 'the offset is reported for review');
  eq(report.venues, 1, 'one venue, not two');
  eq(Object.keys(events[0].sources.reduce((a, s) => { a[s.supplier] = 1; return a; }, {})).length, 2,
    'the venue registry links both supplier id spaces');

  // Reversed sides still merge.
  const rev = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'Everton FC vs Crystal Palace (Football (Soccer), English Premier League)', '2026-08-22 15:00:00', 'Goodison Park', '11'),
    row('XS2Event', 'b_spp', 'Crystal Palace vs Everton (Football, Premier League)', '2026-08-22 15:00:00', 'Goodison Park', 'x_vnx'),
  ]);
  eq(rev.events.length, 1, 'a supplier listing the sides the other way round still merges');
}

// ── The taxonomy traps ───────────────────────────────────────────────────────
{
  const { events } = normaliseSupplierEvents([
    row('XS2Event', 'a_spp', 'Inter Milan vs Lazio (Football, Serie A)', '2026-09-01 20:45:00', 'San Siro', 'a_vnx'),
    row('SportsEvents365', '2', 'Flamengo vs Palmeiras (Football (Soccer), Brazilian Serie A)', '2026-09-01 20:45:00', 'Maracana', '22'),
    row('SportsEvents365', '3', 'Bayern Munich vs Mainz (Football (Soccer), German Bundesliga)', '2026-09-01 18:30:00', 'Allianz Arena', '33'),
    row('XS2Event', 'c_spp', 'Rapid Vienna vs SCR Altach (Football, Bundesliga AT)', '2026-09-01 18:30:00', 'Allianz Stadion', 'c_vnx'),
    row('XS2Event', 'd_spp', 'Union Berlin vs Koln (Football, Bundesliga)', '2026-09-01 18:30:00', 'Stadion An der Alten Forsterei', 'd_vnx'),
  ]);
  const byId = new Map(events.map((e) => [e.sources[0].filterId, e]));
  eq(byId.get('a_spp').competition, 'italian-serie-a', 'XS2Event "Serie A" is Italy');
  eq(byId.get('2').competition, 'brazilian-serie-a', 'SportsEvents365 "Brazilian Serie A" stays Brazil');
  ok(byId.get('a_spp').competition !== byId.get('2').competition, 'the two Serie As never collide');
  eq(byId.get('3').competition, 'german-bundesliga', 'German Bundesliga');
  eq(byId.get('d_spp').competition, 'german-bundesliga', 'XS2Event "Bundesliga" is Germany');
  eq(byId.get('c_spp').competition, 'austrian-bundesliga', 'XS2Event "Bundesliga AT" is Austria');
  eq(events.length, 5, 'five distinct fixtures stay five events');
}

// ── Truncation repair ────────────────────────────────────────────────────────
{
  const { events, report } = normaliseSupplierEvents([
    // Intact row supplies the vocabulary...
    row('SportsEvents365', '1', 'Real Madrid vs Kairat (Football (Soccer), UEFA Champions League)', '2026-09-16 20:00:00', 'Bernabeu', '1'),
    // ...which repairs the cut one.
    row('SportsEvents365', '2', 'Second Qualifying Round: Hapoel Beer Sheva vs Vikingur (Football (Soccer), UEFA Champions', '2026-09-16 19:00:00', 'Turner Stadium', '2'),
  ]);
  const cut = events.find((e) => e.sources[0].filterId === '2');
  eq(cut.competition, 'uefa-champions-league', 'a cut competition is repaired from the batch vocabulary');
  eq(cut.taxonomyRepaired, true, 'the repair is flagged on the record');
  eq(report.repairedCompetition, 1, 'the repair is counted');

  // Ambiguous prefix must NOT be guessed.
  const amb = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'A vs B (Football (Soccer), UEFA Europa League)', '2026-09-16 20:00:00', 'V1', '1'),
    row('SportsEvents365', '2', 'C vs D (Football (Soccer), UEFA Europa Conference)', '2026-09-16 20:00:00', 'V2', '2'),
    row('SportsEvents365', '3', 'E vs F (Football (Soccer), UEFA Europa', '2026-09-16 20:00:00', 'V3', '3'),
  ]);
  const guess = amb.events.find((e) => e.sources[0].filterId === '3');
  eq(guess.taxonomyRepaired, false, 'an ambiguous fragment is left unresolved rather than guessed');
}

// ── Doubleheaders and placeholders ───────────────────────────────────────────
{
  const dh = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'Toronto Blue Jays vs St. Louis Cardinals (Baseball, MLB (Baseball))', '2026-07-31 13:07:00', 'Rogers Centre', '1'),
    row('SportsEvents365', '2', 'Toronto Blue Jays vs St. Louis Cardinals (Baseball, MLB (Baseball))', '2026-07-31 19:37:00', 'Rogers Centre', '1'),
  ]);
  eq(dh.events.length, 2, 'a doubleheader stays two events');

  const same = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'Toronto Blue Jays vs St. Louis Cardinals (Baseball, MLB (Baseball))', '2026-07-31 19:07:00', 'Rogers Centre', '1'),
    row('SportsEvents365', '2', 'Toronto Blue Jays vs St. Louis Cardinals (Baseball, MLB (Baseball))', '2026-07-31 19:07:00', 'Rogers Centre', '1'),
  ]);
  eq(same.events.length, 1, 'the same game listed twice by one supplier is merged');
  eq(same.report.mergedAway, 1, 'the within-supplier duplicate is counted');

  // Four different quarter-finals, all named "To be decided vs To be decided".
  const ph = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'To be decided vs To be decided (Volleyball, 2026 Men European Volleyball Championship)', '2026-09-20 16:00:00', 'Arena', '1'),
    row('SportsEvents365', '2', 'To be decided vs To be decided (Volleyball, 2026 Men European Volleyball Championship)', '2026-09-20 19:00:00', 'Arena', '1'),
    row('SportsEvents365', '3', 'To be decided vs To be decided (Volleyball, 2026 Men European Volleyball Championship)', '2026-09-20 21:05:00', 'Arena', '1'),
    row('SportsEvents365', '4', 'To be decided vs To be decided (Volleyball, 2026 Men European Volleyball Championship)', '2026-09-20 16:00:00', 'Arena', '1'),
  ]);
  eq(ph.events.length, 4, 'placeholder fixtures are never merged into each other');
  eq(ph.report.placeholderTeams, 4, 'placeholder rows are counted');
  ok(ph.events.every((e) => e.hasPlaceholderTeams), 'placeholder rows are flagged for the UI');
}

// ── Rejection, never a throw ─────────────────────────────────────────────────
{
  const { events, report } = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'Good vs Row (Football (Soccer), English Premier League)', '2026-08-22 15:00:00', 'V', '1'),
    row('SportsEvents365', '2', '', '2026-08-22 15:00:00', 'V', '2'),
    row('SportsEvents365', '3', 'Bad date (Football (Soccer), English Premier League)', 'yesterday', 'V', '3'),
    row('', '4', 'No supplier (Football (Soccer), English Premier League)', '2026-08-22 15:00:00', 'V', '4'),
    null,
    'not an object',
  ]);
  eq(events.length, 1, 'only the good row survives');
  eq(report.rejected, 5, 'every bad row is rejected');
  eq(report.rejectedReasons['missing-name'], 1, 'a missing name is reported by reason');
  eq(report.rejectedReasons['unparseable-start'], 1, 'a bad date is reported by reason');
  eq(report.rejectedReasons['missing-supplier'], 1, 'a missing supplier is reported by reason');
  eq(report.rejectedReasons['not-an-object'], 2, 'junk entries are reported by reason');
  ok(report.rejectedRows.length > 0, 'rejected rows are listed for inspection, not just counted');

  eq(normaliseSupplierEvents([]).events.length, 0, 'empty input is fine');
  eq(normaliseSupplierEvents(null).events.length, 0, 'a null input is fine');
  eq(normaliseSupplierEvents(undefined).report.rowsIn, 0, 'an undefined input is fine');

  // A duplicate supplier id is a data fault, not a merge.
  const dup = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'A vs B (Football (Soccer), English Premier League)', '2026-08-22 15:00:00', 'V', '1'),
    row('SportsEvents365', '1', 'C vs D (Football (Soccer), English Premier League)', '2026-08-23 15:00:00', 'V', '1'),
  ]);
  eq(dup.report.rejectedReasons['duplicate-supplier-id'], 1, 'a repeated supplier id is rejected, not silently overwritten');
}

// ── Options ──────────────────────────────────────────────────────────────────
{
  const rows = [
    row('SportsEvents365', '1', 'A vs B (Football (Soccer), English Premier League)', '2026-08-01 15:00:00', 'V', '1'),
    row('SportsEvents365', '2', 'C vs D (Football (Soccer), English Premier League)', '2026-12-01 15:00:00', 'V', '2'),
  ];
  eq(normaliseSupplierEvents(rows, { notBefore: '2026-09-01' }).events.length, 1, 'notBefore drops earlier events');
  eq(normaliseSupplierEvents(rows, { notBefore: '2026-09-01' }).report.droppedPast, 1, 'the drop is counted');
  eq(normaliseSupplierEvents(rows, { notBefore: 'rubbish' }).events.length, 2, 'a malformed notBefore is ignored, not applied');

  const pair = [
    row('SportsEvents365', '1', 'A vs B (Football (Soccer), English Premier League)', '2026-08-01 15:00:00', 'V', '1'),
    row('XS2Event', 'x_spp', 'A vs B (Football, Premier League)', '2026-08-01 15:00:00', 'V', 'x'),
  ];
  eq(normaliseSupplierEvents(pair, { merge: false }).events.length, 2, 'merge:false keeps one record per row');
  eq(normaliseSupplierEvents(pair).events.length, 1, 'merge defaults on');
  eq(normaliseSupplierEvents(pair, { supplierPriority: ['xs2event', 'sportsevents365'] }).events[0].sources[0].supplier,
    'xs2event', 'supplierPriority chooses which supplier leads');

  // maxRows bounds the work and says so.
  const big = normaliseSupplierEvents(rows, { maxRows: 1 });
  eq(big.report.inputTruncated, true, 'exceeding maxRows is reported');
  eq(big.report.rowsProcessed, 1, 'maxRows is enforced');
}

// ── Concerts ─────────────────────────────────────────────────────────────────
{
  const { events } = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'AC/DC-Denver, CO, USA (Entertainment, Concerts)', '2026-07-28 19:00:00', 'Empower Field', '1'),
    row('SportsEvents365', '2', 'AC/DC-Denver, CO, USA (Entertainment, Concerts)', '2026-07-28 19:00:00', 'Empower Field', '1'),
    row('SportsEvents365', '3', 'Jay-Z-New York City, NY, USA (Entertainment, Concerts)', '2026-08-01 20:00:00', 'MSG', '2'),
  ]);
  eq(events.length, 2, 'a repeated concert listing is merged');
  const acdc = events.find((e) => e.startDate === '2026-07-28');
  eq(acdc.kind, 'performance', 'a concert is a performance, not a fixture');
  eq(acdc.performer, 'AC/DC', 'the performer keeps its slash');
  eq(acdc.locationText, 'Denver, CO, USA', 'the location is split out');
  const jayz = events.find((e) => e.startDate === '2026-08-01');
  eq(jayz.performer, 'Jay-Z', 'a hyphenated performer name is not split on its own hyphen');
  eq(jayz.locationText, 'New York City, NY, USA', 'the location is still found');
}

// ── Safety ───────────────────────────────────────────────────────────────────
{
  const before = Object.keys(Object.prototype).length;
  const { events, report } = normaliseSupplierEvents([
    row('__proto__', 'p1', 'constructor vs __proto__ (Football (Soccer), English Premier League)', '2026-08-22 15:00:00', '__proto__', 'toString'),
    row('SportsEvents365', 'p2', '<img src=x onerror=alert(1)> vs Chelsea (Football (Soccer), English Premier League)', '2026-08-22 15:00:00', 'V', '1'),
  ]);
  eq(Object.keys(Object.prototype).length, before, 'processing hostile keys does not touch Object.prototype');
  eq({}.polluted, undefined, 'no prototype pollution');
  ok(!('__proto__' in report.bySupplier) || typeof report.bySupplier.__proto__ !== 'string',
    'report buckets are not polluted by a hostile supplier name');
  const xss = events.find((e) => e.id === 'sportsevents365:p2');
  ok(xss, 'the injected row still parses rather than throwing');
  eq(xss.title, 'vs Chelsea', 'the tag is stripped out of the title');
  // With the home side gone the row is no longer a credible fixture, so it
  // degrades to a plain event instead of inventing a team out of the remains.
  eq(xss.kind, 'event', 'a row left without a home side is not treated as a fixture');
  eq(xss.homeTeam, null, 'no team is invented from the stripped remains');
  ok(!/[<>]/.test(JSON.stringify(events)), 'no angle brackets survive into the output');

  // Long input is capped rather than chewed on.
  const long = normaliseSupplierEvents([
    row('SportsEvents365', 'L', `${'A'.repeat(50000)} vs B (Football (Soccer), English Premier League)`, '2026-08-22 15:00:00', 'B'.repeat(50000), '1'),
  ]);
  ok(long.events.length <= 1, 'an oversized row does not blow up');
  ok(JSON.stringify(long.events).length < 5000, 'oversized fields are capped, not carried through');
}

// ── Identity key ─────────────────────────────────────────────────────────────
{
  const base = { kind: 'fixture', category: 'football', startDate: '2026-08-22', venue: { key: 'v' }, _subject: 's', uid: 'u1' };
  const a = identityKeyFor({ ...base, homeTeam: 'Everton FC', awayTeam: 'Crystal Palace' });
  const b = identityKeyFor({ ...base, homeTeam: 'Crystal Palace FC', awayTeam: 'Everton', uid: 'u2' });
  eq(a, b, 'identity is order-independent and club-suffix-independent');
  const c = identityKeyFor({ ...base, homeTeam: 'Everton FC', awayTeam: 'Crystal Palace', startDate: '2026-08-23' });
  ok(a !== c, 'a different date is a different event');
  const d = identityKeyFor({ ...base, homeTeam: 'To be decided', awayTeam: 'To be decided', hasPlaceholderTeams: true, uid: 'u3' });
  const e = identityKeyFor({ ...base, homeTeam: 'To be decided', awayTeam: 'To be decided', hasPlaceholderTeams: true, uid: 'u4' });
  ok(d !== e, 'two placeholder fixtures never share an identity');
}

// ── Report ───────────────────────────────────────────────────────────────────
{
  const { report } = normaliseSupplierEvents([
    row('SportsEvents365', '1', 'A vs B (Football (Soccer), English Premier League)', '2026-08-22 15:00:00', 'V', '1'),
  ]);
  for (const k of ['rowsIn', 'parsed', 'rejected', 'eventsOut', 'mergedAway', 'crossSupplierMerges',
    'venues', 'byCategory', 'bySupplier', 'timeOffsets', 'venueAliasCandidates']) {
    ok(k in report, `report exposes ${k}`);
  }
  eq(report.byCategory.football, 1, 'byCategory counts the event');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
