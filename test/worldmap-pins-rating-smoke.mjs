/**
 * Offer map (World Map) — rating-aware country + resort PINS (Andy, 11 Aug 2026).
 *
 * The deal-card star filter (worldmap-star-filter-smoke) hides individual cards,
 * but the country/resort PINS come from a cheapest-price summary that used to
 * carry no per-offer rating, so a pin for a country whose only 5-star deal is
 * hidden still showed (priced from an unshown star). This follow-up teaches the
 * cron summary to emit, per destination, the cheapest per-person price for each
 * WHOLE star (`ratings` + `ppByRating`), and teaches the widget to (a) drop a pin
 * when none of its stars are shown and (b) re-price the survivors to the cheapest
 * shown star. Older caches (no `ratings`) pass through untouched so pins never
 * vanish while the cache catches up.
 *
 * Verifies the real cron helpers (accRating / ratingFields, extracted + eval'd)
 * and the real widget _gateByRating (extracted + eval'd), plus source-guards the
 * summary + load wiring.
 *
 * Run: node test/worldmap-pins-rating-smoke.mjs  (also: npm run test:worldmap-pins)
 */
import { readFileSync } from 'node:fs';

const cron = readFileSync(new URL('../api/cron/refresh-map-offers.js', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../public/widget-worldmap.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// ── Behavioural: the real cron rating helpers, extracted + evaluated ──
// accRating depends on num(); ratingFields is self-contained.
const numM = cron.match(/function num\(v\) \{[^\n]*\}/);
const accM = cron.match(/function accRating\(byRating, o\) \{[\s\S]*?\n\}/);
const fieldsM = cron.match(/function ratingFields\(byRating\) \{[\s\S]*?\n\}/);
ok('cron defines num / accRating / ratingFields', !!numM && !!accM && !!fieldsM);

let accRating = () => { throw new Error('not loaded'); };
let ratingFields = () => { throw new Error('not loaded'); };
if (numM && accM && fieldsM) {
  const factory = new Function(`${numM[0]}\n${accM[0]}\n${fieldsM[0]}\n return { accRating, ratingFields };`);
  ({ accRating, ratingFields } = factory());
}

console.log('accRating keeps the cheapest per-person price per whole star');
{
  const by = {};
  accRating(by, { rating: 5, pricePP: 800 });
  accRating(by, { rating: 5, pricePP: 600 });   // cheaper 5-star wins
  accRating(by, { rating: 4, pricePP: 500 });
  accRating(by, { rating: 4.4, price: 999 });    // rounds to 4, dearer → ignored
  ok('rounds fractional stars to nearest whole', by[4] === 500);
  ok('keeps the cheapest for a star', by[5] === 600);
  ok('falls back to total price when pricePP missing', (() => { const b = {}; accRating(b, { rating: 3, price: 250 }); return b[3] === 250; })());
  ok('ignores out-of-range stars', (() => { const b = {}; accRating(b, { rating: 6, pricePP: 1 }); accRating(b, { rating: 0, pricePP: 1 }); return Object.keys(b).length === 0; })());
  ok('ignores a ratingless offer', (() => { const b = {}; accRating(b, { rating: null, pricePP: 100 }); accRating(b, { pricePP: 100 }); return Object.keys(b).length === 0; })());
  ok('ignores a priceless offer', (() => { const b = {}; accRating(b, { rating: 4 }); return Object.keys(b).length === 0; })());
}

console.log('ratingFields emits sorted stars + the price map, or nothing');
{
  const f = ratingFields({ 5: 600, 4: 500 });
  ok('ratings sorted ascending', JSON.stringify(f.ratings) === '[4,5]');
  ok('ppByRating carried through', f.ppByRating[4] === 500 && f.ppByRating[5] === 600);
  ok('empty map → no fields (older widgets ignore them)', JSON.stringify(ratingFields({})) === '{}');
}

// ── Behavioural: the real widget _gateByRating, extracted + evaluated ──
const gateM = widget.match(/_gateByRating\(rows\) \{[\s\S]*?\n    \}/);
ok('widget defines _gateByRating', !!gateM);
let makeGate = () => { throw new Error('not loaded'); };
if (gateM) {
  makeGate = (showRatings) => {
    const obj = new Function(`return { cfg: { showRatings: ${JSON.stringify(showRatings)} }, ${gateM[0]} };`)();
    return obj;
  };
}

console.log('_gateByRating drops unshown pins, re-prices survivors, exempts ratingless');
{
  const rows = () => ([
    { countryCode: 'ES', fromPricePP: 300, ratings: [3, 5], ppByRating: { 3: 300, 5: 700 } },
    { countryCode: 'GR', fromPricePP: 250, ratings: [3], ppByRating: { 3: 250 } },
    { countryCode: 'IT', fromPricePP: 400 }, // older cache, no ratings
  ]);

  // Show only 5-star.
  const g5 = makeGate([5]).cfg;
  const out5 = makeGate([5])._gateByRating(rows());
  ok('empty showRatings is a no-op', makeGate([])._gateByRating(rows()).length === 3);
  ok('drops a country with no shown star (GR: only 3-star)', !out5.some(c => c.countryCode === 'GR'));
  ok('keeps a country that has the shown star (ES)', out5.some(c => c.countryCode === 'ES'));
  ok('re-prices ES to its 5-star price, not its overall cheapest', out5.find(c => c.countryCode === 'ES').fromPricePP === 700);
  ok('ratingless row (IT) passes through untouched', out5.find(c => c.countryCode === 'IT').fromPricePP === 400);

  // Show 3 + 5: ES re-priced to the cheaper of the two shown stars.
  const out35 = makeGate([3, 5])._gateByRating(rows());
  ok('ES with 3+5 shown re-prices to the cheapest shown star', out35.find(c => c.countryCode === 'ES').fromPricePP === 300);
  ok('GR (3-star) now shown', out35.some(c => c.countryCode === 'GR'));

  // Does not mutate the input rows.
  const src = rows();
  makeGate([5])._gateByRating(src);
  ok('does not mutate the caller\'s rows', src.find(c => c.countryCode === 'ES').fromPricePP === 300);
}

console.log('Cron summary wiring');
{
  ok('summariseByCountry accumulates ratings per country', /_byRating: \{\}[\s\S]*?accRating\(c\._byRating, o\)/.test(cron));
  ok('summariseByCountry strips _byRating and spreads ratingFields', /const \{ _airports, _byRating, \.\.\.rest \} = c;[\s\S]*?\.\.\.ratingFields\(_byRating\)/.test(cron));
  ok('summariseByResort accumulates ratings per resort', /accRating\(ex\._byRating, o\)/.test(cron));
  ok('summariseByResort strips _byRating and spreads ratingFields', /const \{ _airports, _byRating, \.\.\.rest \} = r;[\s\S]*?\.\.\.ratingFields\(_byRating\)/.test(cron));
}

console.log('Widget load + resort wiring');
{
  ok('_applyRatingGate defined and gates the country list', /_applyRatingGate\(offers\) \{[\s\S]*?_gateByRating\(offers\.countries\)/.test(widget));
  ok('country gate chained after the allow-list at load', /this\.data = this\._applyRatingGate\(this\._applyCountryAllowList\(offers\)\);/.test(widget));
  ok('resort summary gated the same way', /const resorts = this\._gateByRating\(\(data && Array\.isArray\(data\.resorts\)\) \? data\.resorts : \[\]\);/.test(widget));
  const vm = widget.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok('widget version >= 3.17.0', vm && (+vm[1] > 3 || (+vm[1] === 3 && +vm[2] >= 17)));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
