/**
 * Special Offers — a tag or promo can be set as a BADGE on the main image
 * instead of a body pill (Andrea, Aug 2026).
 *
 * Each tag/promo pill in the builder now carries a ★ toggle. Flagging it adds
 * the text to offer.imageBadges; on the card those items render as flashes on
 * the image (a stacked badge for vertical/split, a ribbon for cruise) and drop
 * out of the in-body tag/promo lists. Unflagged items stay in the body.
 *
 * Exercises the real builder, the real card, and the real save-API sanitiser.
 *
 * Run: node test/offer-image-badges-smoke.mjs   (npm run test:offer-image-badges)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { _test } from '../api/saved-offers.js';

const BUILDER = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');
const CARD = readFileSync(new URL('../public/widget-offer-card.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The save API whitelists imageBadges');
{
  const cleaned = _test.cleanOffer({ fields: { title: 'X' }, tags: ['Beachfront'], promos: ['Free drinks'], imageBadges: ['Beachfront', 'Free drinks'] });
  ok('imageBadges survives the sanitiser', JSON.stringify(cleaned.imageBadges) === JSON.stringify(['Beachfront', 'Free drinks']));
}

console.log('The builder flags a tag/promo to the image and round-trips it');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = BUILDER; window.document.body.appendChild(s);
  const d = window.document.createElement('div'); window.document.body.appendChild(d);
  const b = new window.TGOfferBuilderWidget(d, { currency: 'GBP' });

  // add a tag + a promo, then star the tag.
  const addTo = (list, text) => { const g = b.root.querySelector('.ob-pillgroup[data-list="' + list + '"]'); const inp = g.querySelector('.ob-pill-input'); inp.value = text; g.querySelector('.ob-pill-go').click(); };
  addTo('tags', 'Beachfront');
  addTo('promos', 'Free drinks package');
  const tagStar = b.root.querySelector('.ob-pillgroup[data-list="tags"] .ob-pill-star');
  ok('a ★ toggle is present on a tag pill', !!tagStar);
  tagStar.click();
  ok('the pill shows as flagged (is-badge)', !!b.root.querySelector('.ob-pillgroup[data-list="tags"] .ob-pill.is-badge'));

  const offer = b._collect();
  ok('the flagged tag is collected into imageBadges', Array.isArray(offer.imageBadges) && offer.imageBadges.indexOf('Beachfront') !== -1);
  ok('the tag is still in tags (so it still filters)', offer.tags.indexOf('Beachfront') !== -1);
  ok('the un-flagged promo is not in imageBadges', offer.imageBadges.indexOf('Free drinks package') === -1);

  // Removing a flagged pill also clears its image flag (no stale flag left).
  const rm = b.root.querySelector('.ob-pillgroup[data-list="tags"] .ob-pill [data-rm]');
  rm.click();
  ok('removing the pill clears its image flag', b._collect().imageBadges === undefined || b._collect().imageBadges.indexOf('Beachfront') === -1);

  // Reopen an offer that saved image badges → restored + starred.
  const d2 = window.document.createElement('div'); window.document.body.appendChild(d2);
  const b2 = new window.TGOfferBuilderWidget(d2, { currency: 'GBP', offer: { fields: { title: 'Y' }, tags: ['Adults only'], imageBadges: ['Adults only'] } });
  ok('a saved image badge reopens as a flagged pill', !!b2.root.querySelector('.ob-pillgroup[data-list="tags"] .ob-pill.is-badge'));
  ok('a saved image badge round-trips through collect', b2._collect().imageBadges.indexOf('Adults only') !== -1);
}

console.log('The card shows flagged items on the image and drops them from the body');
{
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const s = window.document.createElement('script'); s.textContent = CARD; window.document.body.appendChild(s);
  const offer = { currency: 'GBP', fields: { title: 'Med', type: 'Cruise', price: '999' },
    tags: ['Beachfront', 'Family friendly'], promos: ['Free drinks', 'Kids sail free'], imageBadges: ['Beachfront', 'Free drinks'] };
  const render = (layout) => { const el = window.document.createElement('div'); window.document.body.appendChild(el); new window.TGOfferCardWidget(el, { layout, offer, offerPage: '/o' }); return el.shadowRoot.innerHTML; };

  const v = render('vertical');
  ok('vertical: the image flag stack is present', /<div class="tgoc-flags">/.test(v));
  ok('vertical: a flagged tag shows as an image flag', /tgoc-badge--flag">Beachfront</.test(v));
  ok('vertical: a flagged promo shows as an image flag', /tgoc-badge--flag">Free drinks</.test(v));
  ok('vertical: the flagged tag is NOT a body tag pill', !/tgoc-tag">Beachfront</.test(v));
  ok('vertical: an un-flagged tag stays in the body', /tgoc-tag">Family friendly</.test(v));
  ok('vertical: the flagged promo is NOT a body promo pill', !/tgoc-promo">Free drinks</.test(v));
  ok('vertical: an un-flagged promo stays in the body', /tgoc-promo">Kids sail free</.test(v));

  const c = render('cruise');
  ok('cruise: flagged items ride as ribbons', c.includes('Beachfront') && c.includes('Free drinks') && /tgoc-ribbon--promo/.test(c));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
