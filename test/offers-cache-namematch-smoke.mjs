/**
 * Offers cache — free-text destination name matching + package-type classifier.
 *
 * Two client-reported gaps, both traced to the READ side of the offer cache:
 *
 *   1. A widget whose destination was saved as a place NAME ("Orlando") never
 *      used the cache — _cacheEligible required 2-3 letter codes — so it always
 *      hit slow live Travelify. The cache in fact holds Orlando offers; it just
 *      needed to resolve the name against its own airport index. An unresolved
 *      name must stay a MISS (fall through to live), never widen to worldwide.
 *
 *   2. A "UK to anywhere, dynamic" widget kept missing a cache that held the
 *      offers. cached-offers tested `packageType === 'DynamicPackages'`
 *      literally, but Travelify leaves a large share of offers UNTYPED
 *      (packageType null). The cron and the widget both fall back to
 *      supplier-sid inequality; the cache did not, so it hid every untyped
 *      offer from a type-specific widget. Now it uses the same classifier.
 *
 * We extract and drive the REAL functions from the shipped files.
 * Run: node test/offers-cache-namematch-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Brace-balanced slice that also skips over string, comment AND regex literals
// (the shipped helpers carry regex char classes like [A-Za-z .'-], whose stray
// apostrophe would otherwise be mistaken for a string open and mangle the count).
function sliceBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx); const open = i;
  let d = 0, str = null, line = false, block = false, regex = false, cls = false, prevSig = '';
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (regex) {
      if (c === '\\') { i++; continue; }
      if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) regex = false;
      continue;
    }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    // A '/' where a value is expected (after ( , = : [ ! & | ? { ; or nothing)
    // opens a regex literal, not a division.
    if (c === '/' && (prevSig === '' || /[(,=:[!&|?{;]/.test(prevSig))) { regex = true; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(open, i + 1); }
    if (!/\s/.test(c)) prevSig = c;
  }
  throw new Error('unbalanced');
}
function ex(src, sig) { const at = src.indexOf(sig); if (at < 0) throw new Error('not found: ' + sig); return sig + sliceBalanced(src, at + sig.length); }

const cached = readFileSync(new URL('../api/cached-offers.js', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');

// ── Pull the real functions out of api/cached-offers.js (shared scope so
//    typePredicate can see packageKindOf). ────────────────────────────────────
const combined =
  ex(cached, 'function packageKindOf(o)') + '\n' +
  ex(cached, 'function typePredicate(requested)') + '\n' +
  ex(cached, 'function nameMatchesAirport(airportName, token)') + '\n' +
  ex(cached, 'function parseDestinations(v, cap = 60)');
// eslint-disable-next-line no-eval
const api = eval('(function(){' + combined + '\nreturn { packageKindOf, typePredicate, nameMatchesAirport, parseDestinations };})')();
const { packageKindOf, typePredicate, nameMatchesAirport, parseDestinations } = api;

// ── packageKindOf: sid fallback when packageType is absent ────────────────────
ok(packageKindOf({ packageType: 'DynamicPackages' }) === 'DynamicPackages', 'explicit DynamicPackages tag → dynamic');
ok(packageKindOf({ packageType: 'PackageHolidays' }) === 'PackageHolidays', 'explicit PackageHolidays tag → holiday');
ok(packageKindOf({ packageType: null, flightSid: 1, accommodationSid: 2 }) === 'DynamicPackages', 'untyped + different suppliers → dynamic (the fix)');
ok(packageKindOf({ packageType: null, flightSid: 5, accommodationSid: 5 }) === 'PackageHolidays', 'untyped + same supplier → holiday');
ok(packageKindOf({ packageType: null }) === 'PackageHolidays', 'untyped + no sids → holiday (safe default)');

// ── typePredicate: the cache now sees untyped offers a type widget asks for ───
const dynUntyped = { type: 'Packages', packageType: null, flightSid: 1, accommodationSid: 2 };
const holUntyped = { type: 'Packages', packageType: null, flightSid: 7, accommodationSid: 7 };
const dynTagged = { type: 'Packages', packageType: 'DynamicPackages' };
const holTagged = { type: 'Packages', packageType: 'PackageHolidays' };
const hotel = { type: 'Accommodation' };
const flight = { type: 'Flights' };

const isDyn = typePredicate('DynamicPackages');
ok(isDyn(dynUntyped) === true, 'DynamicPackages widget MATCHES an untyped dynamic offer (was excluded before)');
ok(isDyn(dynTagged) === true, 'DynamicPackages widget matches a tagged dynamic offer');
ok(isDyn(holUntyped) === false, 'DynamicPackages widget does NOT match an untyped holiday offer');
ok(isDyn(holTagged) === false, 'DynamicPackages widget does NOT match a tagged holiday offer');
ok(isDyn(hotel) === false, 'DynamicPackages widget does NOT match a hotel-only offer');

const isHol = typePredicate('PackageHolidays');
ok(isHol(holUntyped) === true, 'PackageHolidays widget MATCHES an untyped holiday offer');
ok(isHol(dynUntyped) === false, 'PackageHolidays widget does NOT match an untyped dynamic offer');

const isFamily = typePredicate('BothPackages');
ok(isFamily(dynUntyped) && isFamily(holUntyped) && isFamily(dynTagged) && isFamily(holTagged), 'the broad Packages family matches every package flavour');
ok(isFamily(hotel) === false && isFamily(flight) === false, 'the Packages family excludes hotel-only and flight-only');

ok(typePredicate('Accommodation')(hotel) === true && typePredicate('Accommodation')(dynUntyped) === false, 'Accommodation type matches hotels only');
ok(typePredicate('Flights')(flight) === true && typePredicate('Flights')(hotel) === false, 'Flights type matches flights only');
const isAny = typePredicate('Any');
ok(isAny(hotel) && isAny(flight) && isAny(dynUntyped), 'Any matches every stored type');

// ── nameMatchesAirport: whole-word / phrase match, no fragment false hits ─────
ok(nameMatchesAirport('Orlando International Airport', 'ORLANDO') === true, 'Orlando → Orlando International Airport');
ok(nameMatchesAirport('Orlando Sanford International Airport', 'ORLANDO') === true, 'Orlando → Orlando Sanford (second gateway)');
ok(nameMatchesAirport('Dubai International Airport', 'DUBAI') === true, 'Dubai matches');
ok(nameMatchesAirport('London Gatwick', 'GATWICK') === true, 'a later word matches (Gatwick)');
ok(nameMatchesAirport('London Gatwick', 'LONDON') === true, 'a first word matches (London)');
ok(nameMatchesAirport('Alicante Airport', 'AL') === false, 'a fragment ("AL" of Alicante) does NOT match');
ok(nameMatchesAirport('Newport News/Williamsburg', 'PORT') === false, '"PORT" inside "Newport" does NOT match');
ok(nameMatchesAirport(null, 'ORLANDO') === false, 'null airport name → no match');
ok(nameMatchesAirport('Orlando International Airport', '') === false, 'empty token → no match');
ok(nameMatchesAirport('Palma de Mallorca', 'MALLORCA') === true, 'accented/multi-word city resolves on a real word');

// ── parseDestinations: codes vs names vs garbage ──────────────────────────────
let p = parseDestinations('MCO');
ok(p.codes.length === 1 && p.codes[0] === 'MCO' && p.names.length === 0 && !p.invalid, 'a 3-letter code → code');
p = parseDestinations('es,gr');
ok(p.codes.join(',') === 'ES,GR' && !p.invalid, 'lowercase 2-letter codes → uppercased codes');
p = parseDestinations('Orlando');
ok(p.names.join(',') === 'ORLANDO' && p.codes.length === 0 && !p.invalid, 'a place name → name (not a code)');
p = parseDestinations('Costa del Sol');
ok(p.names.join(',') === 'COSTA DEL SOL' && !p.invalid, 'a multi-word place name is allowed');
p = parseDestinations('MCO,Orlando');
ok(p.codes.join(',') === 'MCO' && p.names.join(',') === 'ORLANDO' && !p.invalid, 'mixed codes and names split correctly');
p = parseDestinations('Orlando123');
ok(p.invalid === true, 'a token with digits is invalid (neither code nor name)');
p = parseDestinations('');
ok(p.codes.length === 0 && p.names.length === 0 && !p.invalid, 'empty destinations → no filter, not invalid');
p = parseDestinations(Array.from({ length: 61 }, (_, i) => 'ES').join(','));
ok(p.invalid === true, 'over the token cap → invalid');

// ── Free-text destinations still reach the cache ──────────────────────────────
// _cacheEligible is GONE as of v1.16.0: there is no live path left to be
// eligible FOR, so every widget reads the cache and the gate would only have
// been a way to send some of them nowhere. The behaviour it protected is now
// enforced server-side by parseDestinations, which is asserted above: a name
// that resolves is used, a name that does not is an honest miss, and neither
// can widen a widget's filters. These pin the removal so it cannot creep back.
// Scoped past the changelog, which legitimately still names the removed gate
// when describing the v1.15.0 change that introduced it.
const widgetCode = widget.slice(widget.indexOf("'use strict'"));
ok(!/_cacheEligible/.test(widgetCode), 'the _cacheEligible gate is gone (every widget reads the cache)');
ok(!/OFFERS_PROXY/.test(widgetCode), 'the widget holds no reference to the live offers proxy at all');
ok(!/api\/offers['"`]/.test(widgetCode) && !/'\/offers'/.test(widgetCode),
  'no live /api/offers URL is built anywhere in the widget');

// ── canonBoard: Travelify's B&B synonyms all fold to one class ────────────────
// (the CT-Travel-Offer-Ribbon's ~41% miss — a "BedAndBreakfast" filter dropped
// every offer Travelify labelled "Bed & Breakfast" or "Breakfast").
const normBoardSrc = (cached.match(/const normBoard = [^\n]+/) || [])[0];
const boardCanonSrc = ex(cached, 'const BOARD_CANON =');
const canonBoardSrc = (cached.match(/const canonBoard = [^\n]+/) || [])[0];
// eslint-disable-next-line no-eval
const { canonBoard } = eval('(function(){' + normBoardSrc + '\n' + boardCanonSrc + '\n' + canonBoardSrc + '\nreturn { canonBoard };})')();

const bb = canonBoard('BedAndBreakfast'); // the value the editor stores
ok(canonBoard('Bed & Breakfast') === bb, '"Bed & Breakfast" (Travelify ampersand form) matches a BedAndBreakfast filter');
ok(canonBoard('Bed and Breakfast') === bb, '"Bed and Breakfast" matches');
ok(canonBoard('Breakfast') === bb, '"Breakfast" (Travelify short form) matches');
ok(canonBoard('Breakfast Included') === bb, '"Breakfast Included" matches');
ok(canonBoard('All Inclusive') === canonBoard('AllInclusive'), 'All Inclusive folds by spacing/case');
ok(canonBoard('All Inclusive') !== bb, 'All Inclusive is NOT the same class as B&B');
ok(canonBoard('AllInclusivePlus') !== canonBoard('AllInclusive'), 'All Inclusive Plus stays distinct from All Inclusive');
ok(canonBoard('Half Board') === canonBoard('HalfBoard'), 'Half Board folds by spacing');
ok(canonBoard('Room Only') === canonBoard('RoomOnly'), 'Room Only folds by spacing');
ok(canonBoard('Some New Board') === 'somenewboard', 'an unknown board falls back to its normalised self (still filterable)');

// ── Source guards: the handler wires the new helpers on the hot path ──────────
ok(/const hasDestFilter =/.test(cached), 'handler tracks hasDestFilter (never falls into "read everything" for a named place)');
ok(/parseDestinations\(q\.destinations\)/.test(cached), 'handler parses destinations via parseDestinations (codes + names)');
ok(/nameMatchesAirport\(a\.airportName, name\)/.test(cached), 'handler resolves free-text names against the summary airport index');
ok(/if \(!resolved\)[\s\S]{0,220}unresolvedFilters: true/.test(cached), 'an unresolved place name is an honest miss (unresolvedFilters), never a widened filter');
ok(!/destTokens/.test(cached), 'the old destTokens variable is fully removed');
ok(/const boards = new Set\(boardsCsv\.tokens\.map\(canonBoard\)\)/.test(cached), 'the board filter uses canonBoard (synonym-aware), not the exact normBoard');
ok(/if \(boards\.size && !boards\.has\(canonBoard\(o\.boardBasis\)\)\)/.test(cached), 'offers are board-matched through canonBoard too');
// A hotel-only offer (no o.origin) must not be excluded by an airport-only
// origin filter — that was the 100% miss on the Accommodation "cards" widgets.
ok(/if \(!o\.origin\)\s*\{[\s\S]{0,160}originMarkets\.size && !mkOk[\s\S]{0,60}\} else if \(!apOk && !mkOk\)/.test(cached), 'a flightless (hotel-only) offer is gated on market only, never on departure airport');
const _v = (widget.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
ok(_v.length === 3 && (_v[0] > 1 || (_v[0] === 1 && _v[1] >= 15)), `widget VERSION is at least 1.15.0 (is ${_v.join('.')})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
