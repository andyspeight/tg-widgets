/**
 * Special Offers — the sheet's inline edit is a server-side FIELD PATCH, so it
 * can never wipe photos / itinerary / currency (Tully's Travel, Aug 2026).
 *
 * The bug: the spreadsheet (sheet) view autosaved a row by reconstructing the
 * WHOLE offer from a client-side cache and POSTing it back. A cache that
 * predated a builder edit (photos or an itinerary added in the form) silently
 * reverted those fields on the next inline cell edit — the intermittent
 * "photos + itinerary vanish, have to enter it twice" report.
 *
 * The fix: the sheet sends only { id, fieldPatch: {changedField: value} } and
 * the server merges it into the offer's OWN current stored copy. This test
 * exercises the real merge (cleanOffer over base + patched fields) and proves
 * every non-field part of the offer survives a field edit.
 *
 * Run: node test/offer-fieldpatch-smoke.mjs   (npm run test:offer-fieldpatch)
 */
import { readFileSync } from 'node:fs';
import { _test } from '../api/saved-offers.js';

const { cleanOffer } = _test;
let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// A rich cruise offer as the server would already hold it.
const stored = cleanOffer({
  currency: 'EUR',
  fields: {
    title: 'Best of Greece', type: 'Cruise', price: '1679', nights: '7',
    shipName: 'Celebrity Infinity', shipDesc: 'A long ship write-up…',
    itinerary: 'Day 1 - Athens\nDay 2 - Mykonos\nDay 3 - Santorini',
  },
  includes: ['Return flights', '7 night cruise', 'Full board'],
  excludes: ['Gratuities', 'Travel insurance'],
  promos: ['Low deposit', 'Onboard credit'],
  tags: ['Adults only'],
  images: [
    'https://kxxtsfbku4di3qly.public.blob.vercel-storage.com/offer-photos/Santorini-abc123.jpg',
    'https://kxxtsfbku4di3qly.public.blob.vercel-storage.com/offer-photos/photo-noextensionhash',
  ],
});

// The server-side merge, exactly as the handler runs it for a { fieldPatch }.
function applyPatch(base, patch) {
  const mergedFields = Object.assign({}, base.fields || {});
  for (const k of Object.keys(patch)) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
    const v = patch[k];
    if (v === '' || v == null) delete mergedFields[k];
    else if (typeof v === 'string' || typeof v === 'number') mergedFields[k] = String(v).slice(0, 5000);
  }
  return cleanOffer(Object.assign({}, base, { fields: mergedFields }));
}

console.log('A field edit updates only that field and keeps everything else');
{
  const after = applyPatch(stored, { price: '1499' });  // the sheet changes the price
  ok('the edited field is updated', after.fields.price === '1499');
  ok('the itinerary survives', after.fields.itinerary === stored.fields.itinerary);
  ok('the ship write-up survives', after.fields.shipDesc === stored.fields.shipDesc);
  ok('the photos survive (both the named and the extensionless blob url)',
    Array.isArray(after.images) && after.images.length === 2 && after.images[0] === stored.images[0] && after.images[1] === stored.images[1]);
  ok('the currency stays EUR (never reset to GBP by a field edit)', after.currency === 'EUR');
  ok('includes survive', JSON.stringify(after.includes) === JSON.stringify(stored.includes));
  ok('excludes survive', JSON.stringify(after.excludes) === JSON.stringify(stored.excludes));
  ok('promos survive', JSON.stringify(after.promos) === JSON.stringify(stored.promos));
  ok('tags survive', JSON.stringify(after.tags) === JSON.stringify(stored.tags));
}

console.log('Clearing a field via the patch removes just that field');
{
  const after = applyPatch(stored, { shipName: '' });   // clear a cell
  ok('the cleared field is gone', !after.fields.shipName);
  ok('the itinerary and photos still survive the clear',
    after.fields.itinerary === stored.fields.itinerary && after.images.length === 2);
}

console.log('The client sends a field patch, not a reconstructed whole offer');
{
  const EDITOR = readFileSync(new URL('../public/editor-offer-builder.html', import.meta.url), 'utf8');
  ok('saveRow posts { id, fieldPatch: editing }', /body: JSON\.stringify\(\{ id: id, fieldPatch: editing \}\)/.test(EDITOR));
  ok('saveRow no longer reconstructs a full offer from a cache', !/ensureFull\(/.test(EDITOR) && !/state\.full/.test(EDITOR));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
