/**
 * Offers widget — hotel-only "View deal" deeplink no longer dead-ends.
 *
 * A client (yourticketgenie, 28 Jul 2026) reported the FIRST card's "View deal"
 * landing on a Travelify error: {"success":false,"error":"Unable to match
 * location City: Miami International Airport, US"}. Cause: a hotel-only offer has
 * no flight leg, so the deeplink had no airport IATA to anchor on and fell back
 * to a City lookup on the destination NAME — which is an AIRPORT name here, not a
 * city, so Travelify rejected the whole link. Real-city cards ("Miami", "Newark")
 * worked, which is why only the first card broke.
 *
 * Fix: a hotel-only offer now always pins the exact property (loct=Property + the
 * offer's uniqueRef), which lands on that hotel and mirrors Travelify's own links.
 * Package offers (which DO carry an airport IATA) are unchanged.
 *
 * Drives the REAL offersDeeplink from the shipped file.
 * Run: node test/offers-deeplink-hotel-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Brace-balanced slice that also skips string, comment and regex literals.
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

// ── The reported offer: hotel-only, destination name IS an airport ────────────
const miamiHotel = {
  type: 'Accommodation',
  accommodation: {
    name: 'Doral Inn & Suites Miami Airport West',
    boardBasis: 'Bed & Breakfast', nights: 5, rating: 3, checkinDate: '2026-09-14',
    uniqueRef: 'TTI:HOTEL123', pricing: { currency: 'GBP' },
    destination: { name: 'Miami International Airport', countryCode: 'US', latitude: 25.79, longitude: -80.29 },
  },
  adults: 2,
};
let url = offersDeeplink(miamiHotel);
let p = q(url);
ok(url !== '', 'hotel-only offer produces a deeplink');
ok(p.st === 'Accommodation', 'st is Accommodation');
ok(p.loct === 'Property', 'hotel-only pins to loct=Property (was defaulting to a City lookup)');
ok(p.refn === 'TTI:HOTEL123', 'the property code is carried as refn');
ok(/Doral Inn/.test(p.loc || ''), 'loc names the exact property');
ok(!('ctry' in p), 'a pinned link omits ctry (mirrors Travelify’s own generator)');
ok(p.lat === '25.79' && p.lng === '-80.29' && p.rad === '1', 'coordinates + 1-mile radius pin the property tightly');
// The bug was a bare City lookup on the airport name. Assert we are NOT doing that.
ok(!(p.loc === 'Miami International Airport' && p.loct == null), 'NOT the broken bare-City lookup on the airport name');
ok(p.brd === 'BedAndBreakfast', 'board basis carried (Bed & Breakfast -> BedAndBreakfast)');
ok(p.fr === '2026-09-14' && p.dur === '5' && p.adt === '2' && p.rat === '3' && p.curr === 'GBP', 'dates, nights, pax, rating, currency all carried');

// ── A real city still works, and now also pins precisely ──────────────────────
const miamiCity = JSON.parse(JSON.stringify(miamiHotel));
miamiCity.accommodation.name = 'La Quinta Inn Miami Airport East';
miamiCity.accommodation.destination.name = 'Miami';
url = offersDeeplink(miamiCity); p = q(url);
ok(p.loct === 'Property' && /La Quinta/.test(p.loc || ''), 'a real-city hotel-only offer also pins to the exact property');

// ── Hotel-only WITHOUT a property code → falls back to the name (documented) ───
const noRef = JSON.parse(JSON.stringify(miamiHotel));
delete noRef.accommodation.uniqueRef;
url = offersDeeplink(noRef); p = q(url);
ok(p.loct !== 'Property' && p.loc === 'Miami International Airport' && p.ctry === 'US',
  'no property code → falls back to the destination-name lookup (unchanged; the residual case)');

// ── Package offer (has a flight IATA) is UNCHANGED: airport anchor, not pinned ─
const pkg = {
  type: 'Packages',
  flight: { destination: { iataCode: 'ALC', countryCode: 'ES' }, origin: { iataCode: 'LGW' }, outboundDate: '2026-09-14', pricing: { currency: 'GBP' } },
  accommodation: { name: 'Hotel Benidorm', nights: 7, rating: 4, boardBasis: 'All Inclusive', uniqueRef: 'TTI:PKG999', checkinDate: '2026-09-14', destination: { name: 'Benidorm', countryCode: 'ES' }, pricing: { currency: 'GBP' } },
  adults: 2,
};
url = offersDeeplink(pkg); p = q(url);
ok(p.loct === 'Airport' && p.loc === 'ALC', 'package offer still anchors on the destination airport IATA (unchanged)');
ok(!('refn' in p), 'package offer is NOT auto-pinned (behaviour unchanged unless the widget opts in)');
ok(p.dst === 'ALC' && p.org === 'LGW', 'package flight legs carried');

// ── Opt-in still pins packages when the widget asks for it ────────────────────
setPropertyPin(true);
url = offersDeeplink(pkg); p = q(url);
ok(p.loct === 'Property' && p.refn === 'TTI:PKG999', 'with propertyDeeplinks on, a package pins the property too');
setPropertyPin(false);

// ── Source guard ──────────────────────────────────────────────────────────────
ok(/const pinned = \(PROPERTY_PIN \|\| !destIata\) && setPropertyAnchor\(/.test(src),
  'hotel-only offers (no destIata) always attempt the property pin');
const _v = (src.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
ok(_v.length === 3 && (_v[0] > 1 || (_v[0] === 1 && (_v[1] > 15 || (_v[1] === 15 && _v[2] >= 1)))), `VERSION is at least 1.15.1 (is ${_v.join('.')})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
