/**
 * Serve-time stale guard tests (plain Node, no jsdom).
 *
 * The cron purges stale offers on its own ~45-minute cadence, but between runs
 * an offer can cross the 70-hour / past-travel-date line while still stored.
 * Two read endpoints therefore enforce the expiry rules independently so
 * nothing stale ever reaches a client:
 *   - api/cached-offers.js      (offer-box widgets)  → isServable()
 *   - api/destination-map-deals.js (world map cards) → isServable()
 *
 * This suite extracts the REAL isServable() source from both shipped files and
 * evaluates it, so the test exercises the code that actually ships. It locks in
 * the July 2026 fix that added the guard to the world-map deals endpoint (it
 * previously had none, so the admin's "never served to widgets" promise did not
 * hold for the map during the between-runs window).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHED = path.join(__dirname, '..', 'api', 'cached-offers.js');
const DEALS = path.join(__dirname, '..', 'api', 'destination-map-deals.js');

let passed = 0;
const failures = [];
function assert(cond, msg) { if (cond) { passed++; } else { failures.push(msg); } }

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
function build(file, signature, ret) {
  const src = fs.readFileSync(file, 'utf8');
  // eslint-disable-next-line no-new-func
  return new Function(`const STALE_AGE_MS = 70 * 60 * 60 * 1000;\n${extractFn(src, signature)}\nreturn ${ret};`)();
}

const cachedServable = build(CACHED, 'function isServable(o, nowMs)', 'isServable');
const dealsServable = build(DEALS, 'function isServable(o, nowMs)', 'isServable');

const NOW = Date.parse('2026-07-09T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const hoursAgo = (h) => iso(NOW - h * 60 * 60 * 1000);
const daysAhead = (d) => iso(NOW + d * 24 * 60 * 60 * 1000).slice(0, 10);
const daysAgo = (d) => iso(NOW - d * 24 * 60 * 60 * 1000).slice(0, 10);

// Both guards must agree on every case — the map endpoint now mirrors the
// offer-box endpoint exactly.
function both(o, expected, label) {
  assert(cachedServable(o, NOW) === expected, `cached-offers: ${label}`);
  assert(dealsServable(o, NOW) === expected, `deals: ${label}`);
}

// Fresh: future travel date, fetched well within 70h → served.
both({ outboundDate: daysAhead(30), fetchedAt: hoursAgo(2) }, true, 'fresh future package is served');
both({ checkinDate: daysAhead(14), fetchedAt: hoursAgo(10) }, true, 'fresh future hotel (checkinDate) is served');

// Past travel date → never served, however recently fetched.
both({ outboundDate: daysAgo(1), fetchedAt: hoursAgo(1) }, false, 'past travel date is not served');
both({ checkinDate: daysAgo(3), fetchedAt: hoursAgo(1) }, false, 'past checkin date is not served');

// Fetched > 70h ago → never served, however far in the future the travel date.
both({ outboundDate: daysAhead(60), fetchedAt: hoursAgo(71) }, false, 'fetched 71h ago is not served');
both({ outboundDate: daysAhead(60), fetchedAt: hoursAgo(69) }, true, 'fetched 69h ago is still served');

// Boundary: exactly 70h is the cliff — strictly greater-than expires it, so 70h
// on the nose is still servable.
both({ outboundDate: daysAhead(60), fetchedAt: hoursAgo(70) }, true, 'exactly 70h old is still served (strict >)');

// Missing/blank fields must not crash and must not wrongly expire an offer:
// an offer with no dates at all is servable (defensive — never blank a pin).
both({}, true, 'no dates at all → served (never blank a pin on missing data)');
both({ fetchedAt: hoursAgo(2) }, true, 'no travel date, fresh fetch → served');
both({ outboundDate: daysAhead(30) }, true, 'future travel date, no fetchedAt → served');
both({ outboundDate: 'not-a-date', fetchedAt: 'nonsense' }, true, 'unparseable dates → served (guard never throws)');

// outboundDate takes precedence over checkinDate when both present.
both({ outboundDate: daysAgo(1), checkinDate: daysAhead(30), fetchedAt: hoursAgo(1) }, false, 'past outbound wins over future checkin');

if (failures.length) {
  console.error(`\n✗ stale-guard tests: ${failures.length} failed, ${passed} passed\n`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ stale-guard tests: ${passed} assertions passed (cached-offers + destination-map-deals agree)`);
