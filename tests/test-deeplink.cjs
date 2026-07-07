/**
 * Deeplink builder tests (plain Node, no jsdom).
 *
 * The deeplink builders live inside each widget's browser IIFE and are not
 * exported, so we extract their real source (plus their tiny brdCode helper)
 * straight from the shipped files and evaluate it with light stubs. That way
 * the test exercises the ACTUAL code that ships, not a copy.
 *
 * Covers the v1.10.6 / v3.11.3 fix: anchor the accommodation search on the
 * destination airport (loc=<IATA> + loct=Airport) rather than the resort/atoll
 * name (which fails Travelify's City gazetteer for e.g. Maldives atolls), and
 * drop the undocumented `refn` param.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OFFERS = path.join(__dirname, '..', 'public', 'widget-offers.js');
const WORLDMAP = path.join(__dirname, '..', 'public', 'widget-worldmap.js');

let passed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; } else { failures.push(msg); }
}
function eq(actual, expected, msg) {
  assert(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Slice a balanced {...} block starting at the first '{' after `fromIdx`,
// skipping string literals and comments so braces inside them do not count.
function sliceBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx);
  const open = i;
  let depth = 0, str = null, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced block');
}
function extractFn(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) throw new Error('not found: ' + signature);
  return signature + sliceBalanced(src, at + signature.length);
}

// Build a callable deeplink function from a widget file, injecting the needed
// closure values via a wrapper.
function buildOffersDeeplink(src, appId) {
  const brd = extractFn(src, 'function brdCode(b)');
  const fn = extractFn(src, 'function offersDeeplink(o)');
  // eslint-disable-next-line no-new-func
  return new Function('APPID', `const ACTIVE_APPID = APPID; ${brd}\n${fn}\nreturn offersDeeplink;`)(appId);
}
function buildMapDeeplink(src) {
  const brd = extractFn(src, 'function brdCode(b)');
  const fn = extractFn(src, 'function buildDeeplink(o, appId)');
  // eslint-disable-next-line no-new-func
  return new Function(`const TVLLNK_BASE = 'https://dl.tvllnk.com'; ${brd}\n${fn}\nreturn buildDeeplink;`)();
}

const offersSrc = fs.readFileSync(OFFERS, 'utf8');
const mapSrc = fs.readFileSync(WORLDMAP, 'utf8');
const offersDeeplink = buildOffersDeeplink(offersSrc, '370');
const offersDeeplinkNoApp = buildOffersDeeplink(offersSrc, '');
const buildDeeplink = buildMapDeeplink(mapSrc);

const qp = (url) => new URL(url).searchParams;

// ── Offers: Maldives package (the reported failing case) ──────────────────
{
  const o = {
    type: 'Packages', adults: 2,
    flight: { origin: { iataCode: 'BHX' }, destination: { iataCode: 'MLE', countryCode: 'MV' }, outboundDate: '2026-10-01T21:30:00Z', cabinClass: 'Economy', carrier: { code: 'AI' } },
    accommodation: { destination: { name: 'South Male Atoll', countryCode: 'MV' }, nights: 7, boardBasis: 'BedAndBreakfast', rating: 3, uniqueRef: 'TTI:55364582' },
  };
  const url = offersDeeplink(o);
  const q = qp(url);
  eq(q.get('st'), 'DynamicPackaging', 'offers/MV st');
  eq(q.get('loc'), 'MLE', 'offers/MV loc is the airport, not the atoll');
  eq(q.get('loct'), 'Airport', 'offers/MV loct=Airport');
  eq(q.get('ctry'), 'MV', 'offers/MV ctry');
  eq(q.get('dst'), 'MLE', 'offers/MV dst');
  eq(q.get('org'), 'BHX', 'offers/MV org');
  eq(q.get('brd'), 'BedAndBreakfast', 'offers/MV brd');
  eq(q.get('rat'), '3', 'offers/MV rat');
  eq(q.get('carrier'), 'AI', 'offers/MV carrier');
  assert(!/[?&]refn=/.test(url), 'offers/MV: no refn param');
  assert(!/South\+?Male/i.test(url), 'offers/MV: atoll name never appears in the URL');
}

// ── Offers: Spain package (regression — airport anchor, no town name) ─────
{
  const o = {
    type: 'Packages', adults: 2,
    flight: { origin: { iataCode: 'LGW' }, destination: { iataCode: 'AGP', countryCode: 'ES' }, outboundDate: '2026-08-01' },
    accommodation: { destination: { name: 'Estepona', countryCode: 'ES' }, nights: 7, boardBasis: 'AllInclusive', rating: 4 },
  };
  const q = qp(offersDeeplink(o));
  eq(q.get('loc'), 'AGP', 'offers/ES loc is the airport');
  eq(q.get('loct'), 'Airport', 'offers/ES loct=Airport');
  eq(q.get('ctry'), 'ES', 'offers/ES ctry');
}

// ── Offers: accommodation-only (no flight → fall back to resort name) ──────
{
  const o = { type: 'Accommodation', adults: 2, accommodation: { destination: { name: 'Barcelona', countryCode: 'ES' }, nights: 5, boardBasis: 'RoomOnly' } };
  const q = qp(offersDeeplink(o));
  eq(q.get('st'), 'Accommodation', 'offers/acc st');
  eq(q.get('loc'), 'Barcelona', 'offers/acc loc falls back to the location name');
  eq(q.get('loct'), null, 'offers/acc no loct when anchoring on a name');
  eq(q.get('dst'), null, 'offers/acc no flight dst');
}

// ── Offers: flight-only (no accommodation location at all) ────────────────
{
  const o = { type: 'Flights', adults: 2, flight: { origin: { iataCode: 'LON' }, destination: { iataCode: 'AGP', countryCode: 'ES' }, outboundDate: '2026-08-01', cabinClass: 'Economy' } };
  const q = qp(offersDeeplink(o));
  eq(q.get('st'), 'Flights', 'offers/flt st');
  eq(q.get('org'), 'LON', 'offers/flt org');
  eq(q.get('dst'), 'AGP', 'offers/flt dst');
  eq(q.get('loc'), null, 'offers/flt no loc');
  eq(q.get('loct'), null, 'offers/flt no loct');
  eq(q.get('ctry'), null, 'offers/flt no ctry');
}

// ── Offers: no AppID → empty string (caller falls back to raw link) ───────
eq(offersDeeplinkNoApp({ type: 'Packages', flight: { destination: { iataCode: 'MLE' } } }), '', 'offers: empty when no AppID');

// ── World Map: Maldives package ───────────────────────────────────────────
{
  const o = { type: 'Packages', adults: 2, origin: 'BHX', airport: 'MLE', countryCode: 'MV', resort: 'South Male Atoll', outboundDate: '2026-10-01T21:30:00Z', nights: 7, boardBasis: 'BedAndBreakfast', rating: 3, currency: 'GBP', cabinClass: 'Economy', carrierCode: 'AI', accommodationUniqueRef: 'TTI:55364582' };
  const url = buildDeeplink(o, '370');
  const q = qp(url);
  eq(q.get('st'), 'DynamicPackaging', 'map/MV st');
  eq(q.get('loc'), 'MLE', 'map/MV loc is the airport, not the atoll');
  eq(q.get('loct'), 'Airport', 'map/MV loct=Airport');
  eq(q.get('ctry'), 'MV', 'map/MV ctry');
  eq(q.get('dst'), 'MLE', 'map/MV dst');
  eq(q.get('org'), 'BHX', 'map/MV org');
  assert(!/[?&]refn=/.test(url), 'map/MV: no refn param');
  assert(!/South\+?Male/i.test(url), 'map/MV: atoll name never appears in the URL');
}

// ── World Map: accommodation-only WITH a gateway airport (robust anchor) ───
{
  const o = { type: 'Accommodation', adults: 2, airport: 'MLE', countryCode: 'MV', resort: 'Raa Atoll', nights: 7, boardBasis: 'AllInclusive', rating: 5, checkinDate: '2026-10-01' };
  const q = qp(buildDeeplink(o, '370'));
  eq(q.get('st'), 'Accommodation', 'map/acc st');
  eq(q.get('loc'), 'MLE', 'map/acc loc anchors on the airport');
  eq(q.get('loct'), 'Airport', 'map/acc loct=Airport');
  eq(q.get('ctry'), 'MV', 'map/acc ctry');
  eq(q.get('dst'), null, 'map/acc no dst (accommodation has no flight leg)');
}

// ── World Map: accommodation-only with NO airport → resort-name fallback ──
{
  const o = { type: 'Accommodation', adults: 2, countryCode: 'ES', resort: 'Barcelona', nights: 5, boardBasis: 'RoomOnly' };
  const q = qp(buildDeeplink(o, '370'));
  eq(q.get('loc'), 'Barcelona', 'map/acc-noapt loc falls back to resort name');
  eq(q.get('loct'), null, 'map/acc-noapt no loct');
}

// ── World Map: no AppID → empty string ────────────────────────────────────
eq(buildDeeplink({ type: 'Packages', airport: 'MLE' }, ''), '', 'map: empty when no AppID');

// ── Report ────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ deeplink tests: ${failures.length} failed, ${passed} passed\n`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ deeplink tests: ${passed} assertions passed`);
