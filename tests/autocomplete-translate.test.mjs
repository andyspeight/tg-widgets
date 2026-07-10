/**
 * Autocomplete translation logic — unit tests (plain Node, ESM).
 *
 * Exercises the pure translation engine in api/_lib/exonyms.js: the query
 * resolver (typed language -> canonical English) and the display re-localiser
 * (English -> typed language). No network, no Travelify — just the mechanism
 * that the MVP rides on.
 *
 * Run: npm run test:autocomplete   (node tests/autocomplete-translate.test.mjs)
 */

import { normalise, resolveQuery, toLocal, hasLanguage } from '../api/_lib/exonyms.js';

let passed = 0;
const failures = [];
function assert(cond, msg) { if (cond) passed++; else failures.push(msg); }
function eq(actual, expected, msg) {
  assert(actual === expected, `${msg}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
}

// --- normalise: case + accent folding -------------------------------------
eq(normalise('München'), 'munchen', 'normalise folds the umlaut');
eq(normalise('Veneția'), 'venetia', 'normalise folds the Romanian comma-below');
eq(normalise('VENEȚIA'), 'venetia', 'normalise lowercases and folds together');
eq(normalise('  Londra  '), 'londra', 'normalise trims');
eq(normalise(null), '', 'normalise handles null');

// --- resolveQuery: typed language -> canonical English --------------------
eq(resolveQuery('Londra', 'ro').canonical, 'London', 'Londra resolves to London (exact)');
eq(resolveQuery('Londra', 'ro').via, 'exact', 'Londra is an exact match');
eq(resolveQuery('londra', 'ro').canonical, 'London', 'resolve is case-insensitive');
eq(resolveQuery('Veneția', 'ro').canonical, 'Venice', 'accented exonym resolves');
eq(resolveQuery('Venetia', 'ro').canonical, 'Venice', 'unaccented spelling resolves the same');
eq(resolveQuery('Munchen', 'ro').canonical, 'Munich', 'Munchen without umlaut resolves');
eq(resolveQuery('Franța', 'ro').canonical, 'France', 'country exonym resolves');

// Guarded prefix matching: resolve early only when unambiguous.
eq(resolveQuery('Lo', 'ro').canonical, 'London', 'Lo uniquely prefixes Londra');
eq(resolveQuery('Lo', 'ro').via, 'prefix', 'Lo is a prefix match');
eq(resolveQuery('Lond', 'ro').canonical, 'London', 'Lond still resolves to London');
eq(resolveQuery('L', 'ro').matched, false, 'single letter is too ambiguous to guess');

// Long tail: no exonym, pass the raw text through (null canonical).
eq(resolveQuery('Hersonissos', 'ro').canonical, null, 'unknown place passes through');
eq(resolveQuery('Paris', 'ro').canonical, null, 'same-in-both-languages passes through');

// Unknown language behaves as a transparent passthrough.
eq(resolveQuery('Londra', 'en').canonical, null, 'no table for en means no rewrite');
eq(resolveQuery('Londra', 'fr').canonical, null, 'no table for fr means no rewrite');

// --- toLocal: English -> typed language for display -----------------------
eq(toLocal('London', 'ro'), 'Londra', 'London displays as Londra');
eq(toLocal('Venice', 'ro'), 'Veneția', 'Venice displays as Veneția');
eq(toLocal('Heathrow, London', 'ro'), 'Heathrow, Londra', 'compound name re-localises the known segment');
eq(toLocal('Hersonissos', 'ro'), 'Hersonissos', 'long-tail name is unchanged (correct by default)');
eq(toLocal('London', 'en'), 'London', 'no table for en leaves the name alone');
eq(toLocal('Netherlands', 'ro'), 'Olanda', 'first local form wins for display');
eq(toLocal(null, 'ro'), null, 'toLocal handles null');

// --- round trip -----------------------------------------------------------
const canonical = resolveQuery('Londra', 'ro').canonical;
eq(toLocal(canonical, 'ro'), 'Londra', 'Londra -> London -> Londra round trips');

// --- hasLanguage ----------------------------------------------------------
eq(hasLanguage('ro'), true, 'ro is seeded');
eq(hasLanguage('ro-RO'), true, 'ro-RO maps to ro');
eq(hasLanguage('en'), false, 'en is not seeded');

// --- report ---------------------------------------------------------------
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed:\n`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`✓ all ${passed} autocomplete translation assertions passed`);
