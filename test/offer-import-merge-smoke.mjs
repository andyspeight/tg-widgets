/**
 * Special Offers — a re-uploaded spreadsheet must not wipe images/content
 * (Andrea, Aug 2026).
 *
 * The bulk CSV import used to REPLACE the whole offer with the uploaded row.
 * The spreadsheet carries most fields, but if the Image URLs cell came back
 * blank on an update (a new variant row, or a spreadsheet app dropping the long
 * pipe-joined blob URLs) the images were wiped — and any field the CSV has no
 * column for (promos, excludes, imageBadges, cruiseRoute, i18n) was wiped too.
 * That was the "the photos on the cruise offers are gone" report.
 *
 * The import now MERGES the row onto the stored offer: a blank cell keeps the
 * stored value, an empty list cell keeps the stored list, and columnless fields
 * are always preserved. A cell that DOES carry a value still overwrites.
 *
 * Run: node test/offer-import-merge-smoke.mjs   (npm run test:offer-import-merge)
 */
import { readFileSync } from 'node:fs';
import { _test } from '../api/saved-offers.js';

const { cleanOffer, mergeImportOntoExisting } = _test;
const SERVER = readFileSync(new URL('../api/saved-offers.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// A rich stored cruise offer, exactly as the server holds it.
const existing = cleanOffer({
  currency: 'EUR',
  fields: { title: 'Greek Isles Cruise', price: '1200', itinerary: 'Day 1 Athens\nDay 2 Santorini', shipDesc: 'A big five-star ship.' },
  images: ['https://blob.vercel-storage.com/offer-photos/1.jpg', 'https://blob.vercel-storage.com/offer-photos/2.jpg'],
  includes: ['Return flights', '7 night cruise'],
  promos: ['Free drinks package'],
  excludes: ['Gratuities'],
  tags: ['Adults only'],
  imageBadges: ['Free drinks package'],
  cruiseRoute: { ports: [{ name: 'Athens', lat: 37.94, lng: 23.63 }, { name: 'Santorini', lat: 36.39, lng: 25.43 }], line: [[23.63, 37.94], [25.43, 36.39]] },
});

console.log('A re-uploaded row that changed only the price keeps everything else');
{
  // The spreadsheet came back with a new price and a BLANK Image URLs cell, and
  // (as the CSV has no such columns) no promos/excludes/cruiseRoute.
  const row = cleanOffer({ currency: 'EUR', fields: { title: 'Greek Isles Cruise', price: '999' }, includes: ['Return flights', '7 night cruise'], tags: ['Adults only'], images: [] });
  const merged = mergeImportOntoExisting(existing, row);

  ok('the edited price is applied', merged.fields.price === '999');
  ok('the IMAGES are preserved (blank Image URLs cell no longer wipes them)', Array.isArray(merged.images) && merged.images.length === 2);
  ok('the itinerary is preserved', merged.fields.itinerary === existing.fields.itinerary);
  ok('the ship write-up is preserved', merged.fields.shipDesc === 'A big five-star ship.');
  ok('promos are preserved (no CSV column)', JSON.stringify(merged.promos) === JSON.stringify(['Free drinks package']));
  ok('excludes are preserved (no CSV column)', JSON.stringify(merged.excludes) === JSON.stringify(['Gratuities']));
  ok('image badges are preserved (no CSV column)', JSON.stringify(merged.imageBadges) === JSON.stringify(['Free drinks package']));
  ok('the cruise route is preserved (no CSV column)', merged.cruiseRoute && merged.cruiseRoute.ports.length === 2);
}

console.log('A cell that DOES carry a value still overwrites');
{
  const rowNewImgs = cleanOffer({ currency: 'EUR', fields: { title: 'x', price: '1' }, images: ['https://blob.vercel-storage.com/offer-photos/new.jpg'] });
  const merged = mergeImportOntoExisting(existing, rowNewImgs);
  ok('new Image URLs replace the stored ones', merged.images.length === 1 && merged.images[0].includes('new.jpg'));

  const rowNewTags = cleanOffer({ currency: 'EUR', fields: { title: 'x', price: '1' }, tags: ['Family friendly'] });
  const merged2 = mergeImportOntoExisting(existing, rowNewTags);
  ok('a provided Tags cell overwrites', JSON.stringify(merged2.tags) === JSON.stringify(['Family friendly']));
  ok('but its blank Image cell still keeps the stored images', merged2.images.length === 2);
}

console.log('The import path actually uses the merge (not a raw replace)');
{
  ok('the bulk update merges onto the existing offer', /const merged = mergeImportOntoExisting\(existing\.offer, cleaned\);/.test(SERVER));
  ok('the update stores the merged offer, not the raw row', /setJson\('offer:' \+ wantId, \{\s*id: wantId, offer: merged,/.test(SERVER));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
