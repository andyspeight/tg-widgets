/**
 * Per-client supplier filter tests (plain Node, no jsdom).
 *
 * The filter functions live inside each widget's browser IIFE and are not
 * exported, so we extract their real source straight from the shipped files and
 * evaluate them — the test exercises the ACTUAL code that ships.
 *
 * Covers the v3.11.4 / v1.10.7 fix: a per-client operator whitelist must NOT
 * hide dynamic packages. A dynamic package (flight + hotel from two different
 * suppliers) has no single operator id — flight.sid !== accommodation.sid — so
 * the operator list can never name it. Only operator packages (PackageHolidays,
 * flight.sid === accommodation.sid === the operator id) are gated. Modelled on
 * the real Cypher Travel case: Spain offers were 57 DynamicPackages
 * (flightSid 27 / accommodationSid 45) + 3 PackageHolidays (TUI, 157/157), and
 * the client's whitelist [110,61,123] wrongly wiped all 60.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OFFERS = path.join(__dirname, '..', 'public', 'widget-offers.js');
const WORLDMAP = path.join(__dirname, '..', 'public', 'widget-worldmap.js');

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
function build(src, signature, ret) {
  // eslint-disable-next-line no-new-func
  return new Function(`${extractFn(src, signature)}\nreturn ${ret};`)();
}

const supplierAllows = build(fs.readFileSync(OFFERS, 'utf8'), 'function supplierAllows(o, sf)', 'supplierAllows');
const mapSupplierAllows = build(fs.readFileSync(WORLDMAP, 'utf8'), 'function mapSupplierAllows(o, sf)', 'mapSupplierAllows');

const SF = { flights: [], accommodation: [], packages: [110, 61, 123] };

// ── Offers widget (raw shape: o.flight.sid / o.accommodation.sid) ─────────────
{
  const dyn = { type: 'Packages', packageType: 'DynamicPackages', flight: { sid: 27 }, accommodation: { sid: 45 } };
  assert(supplierAllows(dyn, SF) === true, 'offers: dynamic package (packageType) survives a whitelist it is not on');

  const dynNoType = { type: 'Packages', flight: { sid: 27 }, accommodation: { sid: 45 } };
  assert(supplierAllows(dynNoType, SF) === true, 'offers: dynamic package (sid inequality fallback) survives');

  const tui = { type: 'Packages', packageType: 'PackageHolidays', flight: { sid: 157 }, accommodation: { sid: 157 } };
  assert(supplierAllows(tui, SF) === false, 'offers: operator package NOT on the whitelist is hidden');

  const jet2 = { type: 'Packages', packageType: 'PackageHolidays', flight: { sid: 61 }, accommodation: { sid: 61 } };
  assert(supplierAllows(jet2, SF) === true, 'offers: operator package ON the whitelist is shown');

  const operatorNoType = { type: 'Packages', flight: { sid: 157 }, accommodation: { sid: 157 } };
  assert(supplierAllows(operatorNoType, { packages: [110] }) === false, 'offers: operator package (sid-equal fallback) off list is hidden');

  assert(supplierAllows(dyn, null) === true, 'offers: no filter → show all');
  assert(supplierAllows(dyn, { packages: [] }) === true, 'offers: empty packages list → show all');
  assert(supplierAllows({ type: 'Packages', packageType: 'PackageHolidays' }, SF) === true, 'offers: missing sid → keep (never blank mid-rollout)');

  // Flights / Accommodation gating unchanged
  assert(supplierAllows({ type: 'Flights', flight: { sid: 5 } }, { flights: [5] }) === true, 'offers: flight on flights list kept');
  assert(supplierAllows({ type: 'Flights', flight: { sid: 5 } }, { flights: [9] }) === false, 'offers: flight off flights list hidden');
  assert(supplierAllows({ type: 'Accommodation', accommodation: { sid: 8 } }, { accommodation: [9] }) === false, 'offers: hotel off list hidden');
}

// ── World Map (flat cache shape: o.flightSid / o.accommodationSid) ────────────
{
  const dyn = { flightSid: 27, accommodationSid: 45, packageType: 'DynamicPackages' };
  assert(mapSupplierAllows(dyn, SF) === true, 'map: dynamic package survives a whitelist it is not on');

  const dynNoType = { flightSid: 27, accommodationSid: 45 };
  assert(mapSupplierAllows(dynNoType, SF) === true, 'map: dynamic package (sid inequality fallback) survives');

  const tui = { flightSid: 157, accommodationSid: 157, packageType: 'PackageHolidays' };
  assert(mapSupplierAllows(tui, SF) === false, 'map: operator package NOT on the whitelist is hidden');

  const jet2 = { flightSid: 61, accommodationSid: 61 };
  assert(mapSupplierAllows(jet2, SF) === true, 'map: operator package (sid-equal fallback) ON the whitelist is shown');

  assert(mapSupplierAllows(dyn, null) === true, 'map: no filter → show all');
  assert(mapSupplierAllows(dyn, { packages: [] }) === true, 'map: empty packages list → show all');
  assert(mapSupplierAllows({ packageType: 'PackageHolidays' }, SF) === true, 'map: missing sid → keep');
}

if (failures.length) {
  console.error(`\n✗ supplier-filter tests: ${failures.length} failed, ${passed} passed\n`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ supplier-filter tests: ${passed} assertions passed`);
