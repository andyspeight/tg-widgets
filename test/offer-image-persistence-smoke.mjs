/**
 * Special Offers — an UPDATE must never wipe stored images/content by omission
 * (Andrea/Andy: "the images keep disappearing", Aug 2026).
 *
 * The recurring root cause, found after three path-specific fixes: the full-form
 * direct save ({offer, id}) REPLACED the whole stored offer. cleanOffer coerces
 * an absent `images` array to [], so a payload that simply did not carry images
 * zeroed the stored ones — and _collect used to omit images (and excludes /
 * promos / imageBadges) whenever the list was momentarily empty.
 *
 * The fix has two halves, both exercised here against the REAL functions:
 *   SERVER  preserveOmittedContent(): on update, a content key ABSENT from the
 *           raw payload keeps the stored value; a key PRESENT (even []) stays
 *           authoritative so an author can still clear photos.
 *   CLIENT  _collect(): always sends images/excludes/promos/imageBadges, even
 *           empty, so the form is authoritative and "no photos yet" is never
 *           confused with "don't touch the photos".
 *
 * Run: node test/offer-image-persistence-smoke.mjs   (npm run test:offer-image-persistence)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { _test } from '../api/saved-offers.js';

const { cleanOffer, preserveOmittedContent } = _test;
const BUILDER = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');
const IMG = 'https://kxxtsfbku4di3qly.public.blob.vercel-storage.com/offer-photos/abc-1.jpg';
const IMG2 = 'https://kxxtsfbku4di3qly.public.blob.vercel-storage.com/offer-photos/def-2.jpg';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The server preserves stored content the update payload OMITTED (the bug)');
{
  // Exactly the server flow: a stored offer with photos + promos, then an update
  // whose raw payload carries neither (a full-form save that dropped images, or
  // any partial/legacy caller).
  const existing = cleanOffer({ fields: { title: 'Greek Isles Cruise', price: '1200' }, images: [IMG, IMG2], promos: ['Free drinks'], excludes: ['Gratuities'], tags: ['Adults only'], imageBadges: ['Free drinks'] });
  const rawPayload = { fields: { title: 'Greek Isles Cruise', price: '999' }, currency: 'EUR' }; // no images / promos / etc
  const cleaned = cleanOffer(rawPayload);
  ok('cleanOffer alone would have zeroed the images', Array.isArray(cleaned.images) && cleaned.images.length === 0);

  preserveOmittedContent(cleaned, rawPayload, existing);
  ok('images are preserved from the stored offer', JSON.stringify(cleaned.images) === JSON.stringify([IMG, IMG2]));
  ok('promos are preserved', JSON.stringify(cleaned.promos) === JSON.stringify(['Free drinks']));
  ok('excludes are preserved', JSON.stringify(cleaned.excludes) === JSON.stringify(['Gratuities']));
  ok('tags are preserved', JSON.stringify(cleaned.tags) === JSON.stringify(['Adults only']));
  ok('imageBadges are preserved', JSON.stringify(cleaned.imageBadges) === JSON.stringify(['Free drinks']));
  ok('the edited price still applies', cleaned.fields.price === '999');
}

console.log('An author CAN still clear photos (an explicit empty array wins)');
{
  const existing = cleanOffer({ fields: { title: 'X' }, images: [IMG, IMG2] });
  const rawPayload = { fields: { title: 'X' }, images: [] };   // present, empty = "I removed them"
  const cleaned = cleanOffer(rawPayload);
  preserveOmittedContent(cleaned, rawPayload, existing);
  ok('a present empty images array clears the photos', Array.isArray(cleaned.images) && cleaned.images.length === 0);
}

console.log('New/replacement photos win');
{
  const existing = cleanOffer({ fields: { title: 'X' }, images: [IMG] });
  const rawPayload = { fields: { title: 'X' }, images: [IMG2] };
  const cleaned = cleanOffer(rawPayload);
  preserveOmittedContent(cleaned, rawPayload, existing);
  ok('a provided images array replaces the stored one', JSON.stringify(cleaned.images) === JSON.stringify([IMG2]));
}

console.log('Preserve only touches content arrays, not fields');
{
  const existing = cleanOffer({ fields: { title: 'X', shipDesc: 'A big ship' }, images: [IMG] });
  const rawPayload = { fields: { title: 'X' } };   // shipDesc omitted from the payload's fields
  const cleaned = cleanOffer(rawPayload);
  preserveOmittedContent(cleaned, rawPayload, existing);
  ok('images are preserved', cleaned.images.length === 1);
  ok('an omitted FIELD is NOT resurrected (fields keep their existing drop semantics)', cleaned.fields.shipDesc === undefined);
}

console.log('The builder _collect() always sends the content arrays (authoritative)');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = BUILDER; window.document.body.appendChild(s);

  // An offer opened WITH photos round-trips them through collect.
  const d = window.document.createElement('div'); window.document.body.appendChild(d);
  const withImgs = new window.TGOfferBuilderWidget(d, { currency: 'GBP', offer: { fields: { title: 'Y' }, images: [IMG, IMG2] } });
  const c1 = withImgs._collect();
  ok('images round-trip through collect', Array.isArray(c1.images) && c1.images.length === 2 && c1.images[0] === IMG);

  // A photoless offer collects an EMPTY images array — present, not omitted.
  const d2 = window.document.createElement('div'); window.document.body.appendChild(d2);
  const noImgs = new window.TGOfferBuilderWidget(d2, { currency: 'GBP', offer: { fields: { title: 'Z' } } });
  const c2 = noImgs._collect();
  ok('images is always present (an empty array, never omitted)', Array.isArray(c2.images) && c2.images.length === 0);
  ok('excludes is always present', Array.isArray(c2.excludes));
  ok('promos is always present', Array.isArray(c2.promos));
  ok('imageBadges is always present', Array.isArray(c2.imageBadges));
}

console.log('The server actually calls preserveOmittedContent on update');
{
  const SRC = readFileSync(new URL('../api/saved-offers.js', import.meta.url), 'utf8');
  ok('the update branch calls preserveOmittedContent', /preserveOmittedContent\(offer, body\.offer, existing\.offer\)/.test(SRC));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
