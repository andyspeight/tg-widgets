/**
 * Special Offers — multiple promos + "What's not included" (Andrea, Aug 2026).
 *
 * Two additions across the whole offer flow:
 *   1. promos  — a free-text list of extra promo flashes beyond the single lead
 *      badge (e.g. "Free drinks package", "Kids sail free", "£90 onboard credit").
 *   2. excludes — a "What's not included" list (flights, gratuities, transfers,
 *      travel insurance…), mirroring the includes list.
 *
 * Both are entered in the builder, whitelisted by the save API (or they would be
 * scrubbed), and rendered on the card AND the offer page. This guards each link
 * in that chain so a drop anywhere is caught.
 *
 * Run: node test/offer-promos-excludes-smoke.mjs  (npm run test:offer-promos-excludes)
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const API = read('api/saved-offers.js');
const BUILDER = read('public/widget-offer-builder.js');
const CARD = read('public/widget-offer-card.js');
const PAGE = read('public/widget-offer-page.js');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The save API persists promos + excludes (or they get scrubbed)');
{
  ok('excludes is whitelisted', /excludes: strArr\(s\.excludes, 40, 200\)/.test(API));
  ok('promos is whitelisted', /promos: strArr\(s\.promos, 20, 80\)/.test(API));
}

console.log('The builder collects promos + not-included as free-text pill lists');
{
  ok('an excludes pill group is rendered', /data-list="excludes"[\s\S]*?data-pills="excludes"/.test(BUILDER));
  ok('a promos pill group is rendered', /data-list="promos"[\s\S]*?data-pills="promos"/.test(BUILDER));
  ok('the pill machinery is keyed by list name (includes/excludes/promos)',
    /_listFor\(key\)[\s\S]*?_promos[\s\S]*?_excludes[\s\S]*?_includes/.test(BUILDER));
  ok('excludes are prefilled from a saved offer', /this\._excludes = Array\.isArray\(offer\.excludes\)/.test(BUILDER));
  ok('promos are prefilled from a saved offer', /this\._promos = Array\.isArray\(offer\.promos\)/.test(BUILDER));
  ok('excludes are serialised onto the offer (always, even empty)', /offer\.excludes = \(this\._excludes/.test(BUILDER));
  ok('promos are serialised onto the offer (always, even empty)', /offer\.promos = \(this\._promos/.test(BUILDER));
  ok('all three lists render on load', /_renderPills\('includes'\)[\s\S]*?_renderPills\('excludes'\)[\s\S]*?_renderPills\('promos'\)/.test(BUILDER));
}

console.log('The card renders promos, but NOT the not-included list (that lives on the offer page only)');
{
  ok('the card derives promos', /promos: promos,/.test(CARD));
  ok('a promos block of coloured pills exists', /_promosBlock\(d\)[\s\S]*?tgoc-promo/.test(CARD));
  ok('cruise promos ride as extra ribbons', /tgoc-ribbon--promo/.test(CARD));
  ok('the body renders promos + includes (no excludes on the card)', /_promosBlock\(d\) \+ teaser[\s\S]*?_includesBlock\(d\) \+ tags/.test(CARD));
  ok('the card no longer references an excludes block (removed from the card box)', !/_excludesBlock/.test(CARD));
  ok('the card no longer carries not-included markup or CSS', !/tgoc-excludes/.test(CARD) && !/tgoc-nots/.test(CARD));
}

console.log('The offer page renders promos + a What\'s not included section');
{
  ok('the page derives promos + excludes', /excludes: Array\.isArray\(o\.excludes\)[\s\S]*?promos: Array\.isArray\(o\.promos\)/.test(PAGE));
  ok('promos join the hero badge row as promo flashes', /tgop-badge promo/.test(PAGE));
  ok('a What\'s not included section is built with a cross marker', /fExcludes[\s\S]*?whatsNotIncluded[\s\S]*?tgop-excl[\s\S]*?class="cross"/.test(PAGE));
  ok('the not-included section is placed after included in all layouts',
    (PAGE.match(/fIncludes \+ fExcludes/g) || []).length >= 3);
  ok('whatsNotIncluded is localised across languages (EN + a translation)',
    /whatsNotIncluded: "What's not included"/.test(PAGE) && /whatsNotIncluded: 'Was ist nicht inbegriffen'/.test(PAGE));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
