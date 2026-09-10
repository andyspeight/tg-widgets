#!/usr/bin/env node
/**
 * build-offer-csv.cjs · Travelgenix Widget Suite
 *
 * Turn a JSON offer file into the Special Offers import spreadsheet, using the
 * widget's own column spec so the header row always matches what the editor
 * accepts. Hand-writing that CSV invites a quoting or column-order slip that
 * only shows up as "This does not match the template" at upload time.
 *
 *   node scripts/build-offer-csv.cjs <offers.json> [out.csv]
 *
 * Input shape (the same body /api/saved-offers takes for a bulk import):
 *   { offers: [ { currency, fields:{...}, includes:[], tags:[], images:[] } ] }
 * A leading "_meta" key is ignored, so the source file can carry its own notes.
 *
 * Columns the CSV cannot carry (excludes, promos, imageBadges, cruiseRoute,
 * i18n) are reported rather than dropped silently.
 */
const fs = require('fs');
const path = require('path');

// offer-import.js is a browser IIFE that also does module.exports, but the repo
// is `type: module`, so a plain require() of a .js file gets ESM-loaded and
// hands back an empty namespace. Evaluate the source with a CommonJS shim
// instead, which keeps this script honest: it uses the widget's own column spec
// rather than a second copy of it.
function loadOfferImport() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'offer-import.js'), 'utf8');
  const shim = { exports: {} };
  new Function('module', 'exports', src)(shim, shim.exports);
  return shim.exports;
}
const { offersToCsv, headerCheck, parseCsv, rowsToOffers } = loadOfferImport();

const NON_CSV_KEYS = ['excludes', 'promos', 'imageBadges', 'cruiseRoute', 'i18n'];

function main(argv) {
  const src = argv[0];
  if (!src) {
    console.error('Usage: node scripts/build-offer-csv.cjs <offers.json> [out.csv]');
    process.exit(2);
  }
  const out = argv[1] || src.replace(/\.json$/i, '') + '.csv';

  const doc = JSON.parse(fs.readFileSync(src, 'utf8'));
  const offers = Array.isArray(doc) ? doc : (doc && doc.offers);
  if (!Array.isArray(offers) || !offers.length) {
    console.error('No offers found in ' + src + ' (expected { offers: [...] }).');
    process.exit(1);
  }

  // offersToCsv wants stored records ({ id, offer }); a blank id means "create
  // a new offer" on import rather than update an existing one.
  const csv = offersToCsv(offers.map((offer) => ({ id: '', offer })));
  fs.writeFileSync(out, csv, 'utf8');

  // Round-trip what we just wrote, so a broken file never reaches the client.
  const chk = headerCheck(csv);
  if (!chk.ok) {
    console.error('Generated CSV does not match the template. Missing: ' + chk.missing.join(', '));
    process.exit(1);
  }
  const mapped = rowsToOffers(parseCsv(csv));
  const bad = mapped.filter((m) => m.errors.length);
  if (bad.length) {
    bad.forEach((m) => console.error('Row ' + m.rowNumber + ': ' + m.errors.join(', ')));
    process.exit(1);
  }

  const lost = new Set();
  offers.forEach((o) => NON_CSV_KEYS.forEach((k) => {
    const v = o && o[k];
    if (v && (Array.isArray(v) ? v.length : Object.keys(v).length)) lost.add(k);
  }));

  console.log('Wrote ' + path.relative(process.cwd(), out) + ' (' + offers.length + ' offers, ' + csv.length + ' bytes).');
  if (lost.size) {
    console.log('Note: the spreadsheet has no column for ' + [...lost].join(', ')
      + '. Add those in the builder after importing.');
  }
}

main(process.argv.slice(2));
