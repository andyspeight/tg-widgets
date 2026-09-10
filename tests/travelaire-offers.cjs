/**
 * Checks the hand-built Halal World Travel (Travelaire) offers in
 * content/travelaire/ before they go anywhere near the live account.
 *
 * The offers are written as JSON and the import spreadsheet is generated from
 * it (scripts/build-offer-csv.cjs). This suite proves three things:
 *   1. the CSV still matches the JSON, so the committed pair cannot drift;
 *   2. the editor's own importer accepts the CSV with no row errors;
 *   3. every offer survives the server-side whitelist in api/saved-offers.js
 *      unchanged (field key pattern, per-field and per-list caps, 48KB record).
 * Plus a brand-voice guard for the no-em-dash rule in CLAUDE.md.
 *
 * Plain Node, no dependencies. The repo is type:module so this file is .cjs.
 *
 * Run: node tests/travelaire-offers.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'content', 'travelaire', 'offers-sep-2026.json');
const CSV_PATH = path.join(ROOT, 'content', 'travelaire', 'offers-sep-2026.csv');

// Mirrors api/saved-offers.js cleanOffer(). Kept as literals rather than
// imported because that module is server-side ESM with Redis imports.
const MAX_OFFER_BYTES = 48 * 1024;
const FIELD_KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const CAPS = {
  fields: { max: 100, len: 5000 },
  includes: { max: 40, len: 200 },
  tags: { max: 30, len: 60 },
  images: { max: 20, len: 1000 },
};

let passed = 0;
const failures = [];
function ok(label, cond) {
  if (cond) { passed++; return; }
  failures.push(label);
}

// public/offer-import.js is a browser IIFE with a module.exports tail, but the
// repo is type:module so require() would ESM-load it into an empty namespace.
function loadOfferImport() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'offer-import.js'), 'utf8');
  const shim = { exports: {} };
  new Function('module', 'exports', src)(shim, shim.exports);
  return shim.exports;
}

const { offersToCsv, headerCheck, parseCsv, rowsToOffers } = loadOfferImport();
const doc = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const offers = doc.offers;
const csv = fs.readFileSync(CSV_PATH, 'utf8');

ok('the JSON carries all four offers', Array.isArray(offers) && offers.length === 4);

// 1. The committed CSV is exactly what the JSON generates.
const regenerated = offersToCsv(offers.map((offer) => ({ id: '', offer })));
ok('the CSV is in step with the JSON (re-run scripts/build-offer-csv.cjs)', regenerated === csv);

// 2. The editor's importer accepts it.
const chk = headerCheck(csv);
ok('the CSV passes the editor template check' + (chk.ok ? '' : ' — missing: ' + chk.missing.join(', ')), chk.ok);

const mapped = rowsToOffers(parseCsv(csv));
ok('every CSV row maps to an offer', mapped.length === 4);
mapped.forEach((m) => {
  ok('row ' + m.rowNumber + ' imports without errors: ' + m.errors.join(', '), m.errors.length === 0);
});

// 3. Each offer survives the server-side whitelist untouched.
offers.forEach((offer, i) => {
  const where = 'offer ' + (i + 1) + ' (' + (offer.fields.title || 'untitled') + ')';
  const f = offer.fields || {};
  const keys = Object.keys(f);

  ok(where + ': at most ' + CAPS.fields.max + ' fields', keys.length <= CAPS.fields.max);
  ok(where + ': every field key survives the server pattern',
    keys.every((k) => FIELD_KEY_RE.test(k)));
  ok(where + ': no field is truncated at ' + CAPS.fields.len + ' characters',
    keys.every((k) => typeof f[k] === 'string' && f[k].length <= CAPS.fields.len));

  ['includes', 'tags', 'images'].forEach((list) => {
    const arr = offer[list] || [];
    ok(where + ': ' + list + ' is an array', Array.isArray(arr));
    ok(where + ': ' + list + ' within ' + CAPS[list].max + ' items', arr.length <= CAPS[list].max);
    ok(where + ': no ' + list + ' entry is truncated',
      arr.every((x) => typeof x === 'string' && x.length <= CAPS[list].len));
  });

  ok(where + ': record is under the 48KB store limit',
    JSON.stringify(offer).length <= MAX_OFFER_BYTES);

  // The fields a card needs before it is worth publishing.
  ok(where + ': has a title', !!f.title);
  ok(where + ': has a numeric price', /[0-9]/.test(f.price || ''));
  ok(where + ': prices in sterling', offer.currency === 'GBP');
  ok(where + ': names the departure airport', !!f.origin);
  ok(where + ': names the airline', !!f.airline);
  ok(where + ': lists what is included', (offer.includes || []).length > 0);

  // A show-until date must parse the way isLiveOffer() reads it, or the offer
  // silently never appears.
  if (f.showUntil) {
    ok(where + ': showUntil is YYYY-MM-DD', /^\d{4}-\d{1,2}-\d{1,2}$/.test(f.showUntil));
  }

  // Brand voice: UK English, no em dashes (CLAUDE.md).
  const prose = keys.map((k) => f[k]).join(' ') + ' ' + (offer.includes || []).join(' ') + ' ' + (offer.tags || []).join(' ');
  ok(where + ': no em dashes in the copy', !/[—–]/.test(prose));
});

console.log('\nTravelaire offers: ' + passed + ' checks passed, ' + failures.length + ' failed.');
if (failures.length) {
  failures.forEach((f) => console.error('  FAIL  ' + f));
  process.exit(1);
}
