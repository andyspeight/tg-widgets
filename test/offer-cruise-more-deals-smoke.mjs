/**
 * Special Offers — cruise page "More great holiday deals" strip (Andy, 10 Aug 2026).
 *
 * The cruise offer page shows a few of the client's OTHER offers at the bottom.
 * The grid passes its feed key into the /offer link → the server puts it in cfg
 * → the page fetches /api/saved-offers?client=<key>, drops the current offer and
 * renders compact related cards. Fails safe: no key, empty feed or fetch error →
 * the section removes itself and the page is unaffected.
 *
 * Source guards over the grid, the server bootstrap and the page widget.
 *
 * Run: node test/offer-cruise-more-deals-smoke.mjs  (also: npm run test:offer-cruise-more)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const page = readFileSync(new URL('../public/widget-offer-page.js', import.meta.url), 'utf8');
const grid = readFileSync(new URL('../public/widget-offers-grid.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../api/offer-page.js', import.meta.url), 'utf8');

// Feed key flows grid → link → server cfg → page.
ok(/q\.push\('client=' \+ encodeURIComponent\(this\.cfg\.client\)\)/.test(grid), 'grid carries the feed key onto the /offer link');
ok(/client: typeof q\.client === 'string' \? q\.client\.replace\(/.test(server), 'server reads + sanitises the client key into cfg');
ok(/client: typeof c\.client === 'string' \? c\.client : ''/.test(page), 'page keeps the client key in its config');

// The section is only emitted when there is a feed key.
ok(/const fMore = cfg\.client[\s\S]{0,140}data-more/.test(page), 'more-deals container only when a feed key is present');

// Fetch, exclude the current offer, cap the count.
{
  const b = page.slice(page.indexOf('_loadMoreDeals()'), page.indexOf('_loadMoreDeals()') + 900);
  ok(/api\/saved-offers.*client=/.test(page.slice(page.indexOf('_loadMoreDeals'), page.indexOf('_loadMoreDeals') + 900)), 'fetches the client feed');
  ok(/!== curId/.test(b) && /self\.cfg\.offerId/.test(b), 'excludes the current offer');
  ok(/\.slice\(0, 4\)/.test(b), 'caps at four related offers');
}
ok(/if \(!cards\) \{ wrap\.remove\(\); return; \}/.test(page) && /try \{ wrap\.remove\(\); \} catch \(e\)/.test(page), 'removes the section on empty/error (fails safe)');
ok(/this\._loadMoreDeals\(\);/.test(page), '_bind kicks off the fetch');
ok(/_moreCard\(o\) \{/.test(page) && /_offerQuery\(\) \{/.test(page), 'compact card + link-query helpers defined');
ok(/SCRIPT_BASE \+ 'offer\/'/.test(page), 'related cards link to /offer/<slug>-<id>');
ok(/function slugify\(s\)/.test(page), 'page has a slugify for tidy related links');

// Labels + styles.
ok(/moreDeals: 'More great holiday deals'/.test(page), 'section label present');
ok(/\.tgop-more-grid \{/.test(page) && /\.tgop-more-card \{/.test(page), 'more-deals styles present');

// Version.
{
  const vm = page.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok(vm && (+vm[1] > 0 || (+vm[1] === 0 && +vm[2] >= 4)), 'page version at or beyond 0.4');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
