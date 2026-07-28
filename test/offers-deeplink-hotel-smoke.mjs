/**
 * Offers widget — deeplink board-basis synonyms + hotel-location behaviour.
 *
 * Two things this locks down:
 *   1. brdCode maps every B&B synonym Travelify uses ("Bed & Breakfast" ->
 *      bedbreakfast, "Breakfast" -> breakfast), so the deeplink board filter is
 *      not silently dropped. (Same synonym gap fixed on the cache read side.)
 *   2. The property-pin OPT-IN contract is intact: a hotel-only offer pins ONLY
 *      when the widget turned propertyDeeplinks on; otherwise it anchors on the
 *      destination name. This is the behaviour task #14 deliberately chose.
 *
 * Airport-named location fix (v1.15.2): a hotel-only offer whose destination
 * NAME is an airport ("Miami International Airport") used to dead-end with the
 * default City lookup ("Unable to match location City"). The Travelify Deep
 * Linking Instructions define loct=Airport (matched by name), so an airport-
 * named location is now sent with loct=Airport. Real city names keep City.
 *
 * Drives the REAL offersDeeplink from the shipped file.
 * Run: node test/offers-deeplink-hotel-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

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
    if (c === '/' && (prevSig === '' || /[(,=:[!&|?{;]/.test(prevSig))) { regex = true; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(open, i + 1); }
    if (!/\s/.test(c)) prevSig = c;
  }
  throw new Error('unbalanced');
}
function ex(src, sig) { const at = src.indexOf(sig); if (at < 0) throw new Error('not found: ' + sig); return sig + sliceBalanced(src, at + sig.length); }

const src = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');

// eslint-disable-next-line no-eval
const { offersDeeplink, setPropertyPin } = eval('(function(){'
  + 'let ACTIVE_APPID = "250";'
  + 'let PROPERTY_PIN = false;'
  + 'function setPropertyPin(on){ PROPERTY_PIN = on === true; }'
  + ex(src, 'function setPropertyAnchor(p, hotel, city, lat, lng, refn)') + '\n'
  + ex(src, 'function brdCode(b)') + '\n'
  + ex(src, 'function offersDeeplink(o)') + '\n'
  + 'return { offersDeeplink, setPropertyPin };'
  + '})')();

const q = (url) => Object.fromEntries(new URL(url).searchParams.entries());

const mkHotel = (destName, board, refn) => ({
  type: 'Accommodation',
  accommodation: {
    name: 'Doral Inn & Suites', boardBasis: board, nights: 5, rating: 3, checkinDate: '2026-09-14',
    ...(refn ? { uniqueRef: refn } : {}),
    pricing: { currency: 'GBP' },
    destination: { name: destName, countryCode: 'US', latitude: 25.79, longitude: -80.29 },
  },
  adults: 2,
});

// ── 1. brdCode: Travelify's B&B synonyms all reach the deeplink ───────────────
ok(q(offersDeeplink(mkHotel('Miami', 'Bed & Breakfast'))).brd === 'BedAndBreakfast', '"Bed & Breakfast" -> brd=BedAndBreakfast (was dropped)');
ok(q(offersDeeplink(mkHotel('Miami', 'Breakfast'))).brd === 'BedAndBreakfast', '"Breakfast" -> brd=BedAndBreakfast');
ok(q(offersDeeplink(mkHotel('Miami', 'Bed and Breakfast'))).brd === 'BedAndBreakfast', '"Bed and Breakfast" -> brd=BedAndBreakfast');
ok(q(offersDeeplink(mkHotel('Miami', 'All Inclusive'))).brd === 'AllInclusive', 'All Inclusive still maps');
ok(q(offersDeeplink(mkHotel('Miami', 'Half Board'))).brd === 'HalfBoard', 'Half Board still maps');

// ── 2. Opt-in pin contract intact: OFF anchors on the name, not the property ──
let p = q(offersDeeplink(mkHotel('Miami', 'Room Only', 'TTI:HOTEL123')));
ok(p.loct == null && p.loc === 'Miami' && p.ctry === 'US', 'pin OFF: a real-city hotel anchors on the city name (contract from task #14)');
ok(!('refn' in p), 'pin OFF: no property code leaks into the link');

// pin ON: the exact property is pinned
setPropertyPin(true);
p = q(offersDeeplink(mkHotel('Miami', 'Room Only', 'TTI:HOTEL123')));
ok(p.loct === 'Property' && p.refn === 'TTI:HOTEL123' && /Doral Inn/.test(p.loc || ''), 'pin ON: pins the exact property');
setPropertyPin(false);

// ── 3. Package offer is unaffected: airport anchor ────────────────────────────
const pkg = {
  type: 'Packages',
  flight: { destination: { iataCode: 'ALC', countryCode: 'ES' }, origin: { iataCode: 'LGW' }, outboundDate: '2026-09-14', pricing: { currency: 'GBP' } },
  accommodation: { name: 'Hotel Benidorm', nights: 7, rating: 4, boardBasis: 'Bed & Breakfast', destination: { name: 'Benidorm', countryCode: 'ES' }, pricing: { currency: 'GBP' } },
  adults: 2,
};
p = q(offersDeeplink(pkg));
ok(p.loct === 'Airport' && p.loc === 'ALC', 'package offer anchors on the destination airport IATA');
ok(p.brd === 'BedAndBreakfast', 'package board synonym also mapped');

// ── 4. Airport-named hotel now resolves via loct=Airport (the fix) ────────────
p = q(offersDeeplink(mkHotel('Miami International Airport', 'Room Only')));
ok(p.loc === 'Miami International Airport' && p.loct === 'Airport' && p.ctry === 'US',
  'airport-named hotel location is sent with loct=Airport (was defaulting to City and dead-ending)');
// A real city is NOT mistaken for an airport, and names like "Newport" that merely
// contain "port" must not trigger the airport type.
ok(q(offersDeeplink(mkHotel('Miami', 'Room Only'))).loct == null, 'a real city keeps the City default (no loct)');
ok(q(offersDeeplink(mkHotel('Newport', 'Room Only'))).loct == null, '"Newport" is not treated as an airport (word-boundary match)');
ok(q(offersDeeplink(mkHotel('Gatwick Airport', 'Room Only'))).loct === 'Airport', '"Gatwick Airport" -> loct=Airport');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
