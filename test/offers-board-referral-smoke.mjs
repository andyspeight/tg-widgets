/**
 * A client's board must not book through our demo account (21 Sep 2026).
 *
 * Rashad at Cypher Travel: the Flights departure board on cyphertravel.com/flights
 * "is sending all referrals to the travel demo site, not his website".
 *
 * His widget was configured correctly. /api/widget-config injected appId 370
 * and agencyName "Cypher Travel", and the deeplink builder was ready to mint
 * dl.tvllnk.com/deeplink/370. The fault was WHERE the render identity is set.
 *
 * ACTIVE_APPID, the active currency and the property pin are module-level and
 * were claimed by _renderOffers. The departure board never goes through it:
 * _fetchAndRender hands off to _renderDepartureBoard directly, and its own
 * refresh calls _renderBoardRows directly again. So on a board ACTIVE_APPID
 * stayed '', offersDeeplink() returned '' for every row, and each link fell
 * back to the offer's own cached url — a Travelify click-through minted under
 * whichever application SWEPT it. The country pool is swept under our demo
 * application 250, so every board on every client site was sending its
 * bookings to the Travelgenix demo site.
 *
 * Two things are held here:
 *
 *   1. The board claims its own identity, in the function that builds the
 *      links, so neither entry path can miss it.
 *   2. A cached url is used ONLY when it was minted under this widget's own
 *      application. The per-client TTI pool is swept under the client's app,
 *      where the url is exactly right; the shared country pool is not.
 *
 * Run: node test/offers-board-referral-smoke.mjs  (npm run test:offers-board-referral)
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const SRC = readFileSync(new URL('../public/widget-offers.js', import.meta.url), 'utf8');

/** Lift a function's source out of the widget by its signature. */
function grab(sig) {
  const i = SRC.indexOf(sig);
  if (i < 0) throw new Error('not found: ' + sig);
  let depth = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}') { depth--; if (!depth) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + sig);
}

console.log('A cached link is used only when we minted it');
{
  // The real function, compiled against an injectable app id.
  let appId = '';
  const cachedUrlFor = new Function('getAppId',
    'return ' + grab('function cachedUrlFor(o)').split('ACTIVE_APPID').join('getAppId()')
  )(() => appId);

  const swept = (app) => ({ url: `https://api.travelify.io/travelofferclk/${app}/3/22218006/en/GBP/GB/abc` });

  appId = '370';
  ok('an offer swept under our demo account is refused to a client widget',
    cachedUrlFor(swept('250')) === '', cachedUrlFor(swept('250')));
  ok('the client\'s own swept offer is kept', cachedUrlFor(swept('370')) === swept('370').url);
  ok('another client\'s offer is refused too', cachedUrlFor(swept('474')) === '');

  appId = '250';
  ok('the demo widget may still use its own demo links', cachedUrlFor(swept('250')) === swept('250').url);

  appId = '';
  ok('no app id means no cached link rather than a demo one', cachedUrlFor(swept('250')) === '');

  appId = '370';
  ok('a url with no application segment is refused', cachedUrlFor({ url: 'https://example.com/x' }) === '');
  ok('a missing or malformed offer is handled', cachedUrlFor({}) === '' && cachedUrlFor(null) === '');
}

console.log('The board claims its own render identity');
{
  const rows = grab('_renderBoardRows() {');
  ok('it sets the application the links are minted under', /setActiveAppId\(this\.cfg\.appId\)/.test(rows));
  ok('and the currency, which _renderOffers also sets', /setActiveCur\(this\.cur\)/.test(rows));
  ok('and the property pin, so it cannot inherit another widget\'s',
    /setPropertyPin\(/.test(rows));
  // Ordering is the whole point: the identity must be claimed BEFORE the rows
  // that build links are built. Measured against the CALL, not the word —
  // the explanation above the calls names offersDeeplink too, and matching
  // that put the needle inside a comment.
  const setAt = rows.indexOf('setActiveAppId(this.cfg.appId)');
  const linkAt = rows.indexOf('offersDeeplink(o) || cachedUrlFor(o)');
  ok('it does so BEFORE building any link', setAt !== -1 && linkAt !== -1 && setAt < linkAt,
    `setActiveAppId call at ${setAt}, link built at ${linkAt}`);
}

console.log('No link anywhere falls back to a foreign cached url');
{
  // The old shape, which is what leaked the bookings.
  ok('no template uses the raw o.url fallback any more',
    !/offersDeeplink\(o\) \|\| o\.url/.test(SRC),
    (SRC.match(/offersDeeplink\(o\) \|\| o\.url[^\n]*/g) || []).join('\n      '));
  const sites = (SRC.match(/offersDeeplink\(o\) \|\| cachedUrlFor\(o\)/g) || []).length;
  ok('every link site goes through the guard instead', sites >= 16, 'guarded sites: ' + sites);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
