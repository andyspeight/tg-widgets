/**
 * Attraction + Airport Spotlight content-override tests (plain Node).
 *
 * Both widgets take the same "rewrite in your own voice" override layer as
 * Destination Spotlight, but with a flat whitelist of scalar prose fields
 * (no nested arrays) and different keys: Attraction keys by attraction
 * recordId, Airport keys by the payload's IATA code. As elsewhere we extract
 * the ACTUAL shipped source so the test exercises the code that ships.
 *
 * Covers:
 *  - only whitelisted prose fields are overridden; facts are never touched
 *  - _withOverrides selects the right per-record bucket (recordId / IATA)
 *  - a non-string v falls back to the live value
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0;
const failures = [];
function assert(cond, msg) { if (cond) { passed++; } else { failures.push(msg); } }
function eq(a, b, msg) { assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

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
function extractVar(src, decl) {
  // e.g. 'var OVERRIDABLE_FIELDS = [' → capture through the matching ']'
  const at = src.indexOf(decl);
  if (at < 0) throw new Error('not found: ' + decl);
  const open = src.indexOf('[', at);
  let i = open, depth = 0, str = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  return decl + src.slice(open, i + 1) + ';';
}

const ov = (v, o) => ({ v, o: o == null ? '' : o });

// ── Attraction ─────────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'widget-attraction.js'), 'utf8');
  const apply = new Function(
    extractVar(src, 'var OVERRIDABLE_FIELDS = ') + '\n' +
    extractFn(src, 'function applyContentOverrides(data, ov)') + '\n' +
    'return applyContentOverrides;'
  )();
  const withOverrides = new Function(
    extractVar(src, 'var OVERRIDABLE_FIELDS = ') + '\n' +
    extractFn(src, 'function applyContentOverrides(data, ov)') + '\n' +
    'const proto = { ' + extractFn(src, '_withOverrides(data)') + ' };\n' +
    'return (c, data) => proto._withOverrides.call({ c }, data);'
  )();

  const live = () => ({ name: 'Alton Towers', tagline: 'Live tagline', overview: 'Live overview', priceBand: '£££', lat: 52.98 });

  // Whitelisted prose overridden, facts untouched
  const out = apply(live(), { tagline: ov('Our favourite theme park'), overview: ov('We book loads of families in.'), priceBand: ov('CHEAP'), lat: ov('999') });
  eq(out.tagline, 'Our favourite theme park', 'attraction: tagline overridden');
  eq(out.overview, 'We book loads of families in.', 'attraction: overview overridden');
  eq(out.priceBand, '£££', 'attraction: priceBand (fact) NOT overridable');
  eq(out.lat, 52.98, 'attraction: lat (fact) NOT overridable');

  // non-string v falls back
  eq(apply(live(), { tagline: { o: 'x' } }).tagline, 'Live tagline', 'attraction: missing v falls back');

  // _withOverrides keys by attraction.recordId
  const all = { recABC: { tagline: ov('Keyed!') } };
  eq(withOverrides({ attraction: { recordId: 'recABC' }, contentOverrides: all }, live()).tagline, 'Keyed!', 'attraction: keyed by attraction.recordId');
  eq(withOverrides({ attraction: { recordId: 'recZZZ' }, contentOverrides: all }, live()).tagline, 'Live tagline', 'attraction: wrong key → live');
  eq(withOverrides({ recordId: 'recABC', contentOverrides: all }, live()).tagline, 'Keyed!', 'attraction: legacy top-level recordId honoured');
}

// ── Airport ─────────────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'widget-airport.js'), 'utf8');
  const apply = new Function(
    extractVar(src, 'var OVERRIDABLE_FIELDS = ') + '\n' +
    extractFn(src, 'function applyContentOverrides(data, ov)') + '\n' +
    'return applyContentOverrides;'
  )();
  const withOverrides = new Function(
    extractVar(src, 'var OVERRIDABLE_FIELDS = ') + '\n' +
    extractFn(src, 'function applyContentOverrides(data, ov)') + '\n' +
    'const proto = { ' + extractFn(src, '_withOverrides(data)') + ' };\n' +
    'return (c, data) => proto._withOverrides.call({ c }, data);'
  )();

  const live = () => ({ iata: 'LGW', name: 'London Gatwick', overview: 'Live overview', parking: 'Live parking', cityServed: 'London', distanceToCity: '28 miles', flightTimeFromUK: 'n/a' });

  const out = apply(live(), { overview: ov('Our nearest big airport'), parking: ov('Book parking with us'), cityServed: ov('NOWHERE'), distanceToCity: ov('1 mile') });
  eq(out.overview, 'Our nearest big airport', 'airport: overview overridden');
  eq(out.parking, 'Book parking with us', 'airport: parking overridden');
  eq(out.cityServed, 'London', 'airport: cityServed (fact) NOT overridable');
  eq(out.distanceToCity, '28 miles', 'airport: distance (fact) NOT overridable');

  // _withOverrides keys by the payload's IATA (uppercased)
  const all = { LGW: { overview: ov('Keyed by IATA') } };
  eq(withOverrides({ contentOverrides: all }, live()).overview, 'Keyed by IATA', 'airport: keyed by payload IATA');
  const lower = () => Object.assign(live(), { iata: 'lgw' });
  eq(withOverrides({ contentOverrides: all }, lower()).overview, 'Keyed by IATA', 'airport: IATA match is case-insensitive');
  eq(withOverrides({ contentOverrides: { JFK: { overview: ov('x') } } }, live()).overview, 'Live overview', 'airport: wrong IATA → live');
}

if (failures.length) {
  console.error(`\nspotlight-family-overrides: ${passed} passed, ${failures.length} FAILED`);
  failures.forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`spotlight-family-overrides: ${passed} passed`);
