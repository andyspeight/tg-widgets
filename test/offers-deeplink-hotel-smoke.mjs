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
 * KNOWN-OPEN, documented here as a characterisation test (NOT asserted fixed):
 * a hotel-only offer whose destination NAME is not a Travelify city — e.g.
 * "Miami International Airport" — still anchors on that name with the default
 * City lookup, which Travelify rejects ("Unable to match location City"). The
 * name is a genuine Travelify location; the real fix is to pass the correct
 * location TYPE, which the cached offer does not yet carry. Under investigation.
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

// ── 4. KNOWN-OPEN characterisation: airport-named hotel still City-anchors ────
// This documents the still-broken case so a future fix has a red test to turn
// green. It is NOT the desired end state.
p = q(offersDeeplink(mkHotel('Miami International Airport', 'Room Only', 'TTI:HOTEL123')));
ok(p.loct == null && p.loc === 'Miami International Airport',
  'KNOWN-OPEN: airport-named hotel still anchors on the name with a City lookup (Travelify rejects this — fix pending the location type)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
