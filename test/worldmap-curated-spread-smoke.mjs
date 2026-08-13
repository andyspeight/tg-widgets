/**
 * Offer map — respect a client's curated country list on the embedded map
 * (Travel Cheaper, 13 Aug 2026).
 *
 * THE REPORT. Their map had 27 countries curated (cfg.countries), but the small
 * embedded (non-fullscreen) map showed only ~10 pins — Europe collapsed to
 * Spain/Malta/Turkey and the Caribbean vanished.
 *
 * WHY. _selectFeatured curates the envelope map down to ~12 well-spaced pins,
 * culling any pin that collides with an already-placed one (MIN_LAT 9°, MIN_LNG
 * 13°). That tidy auto-curation is right for the un-curated whole-world default,
 * but it was also applied when the CLIENT had explicitly chosen the countries —
 * so 17 of their 27 picks were hidden.
 *
 * THE FIX. When cfg.countries is set, the client has chosen the places, so show
 * as many as stay legible: a lighter de-overlap (5°/7°) and no 12-pin ceiling
 * (cap = number of curated countries). The tidy default is unchanged. Fullscreen
 * still shows every country either way.
 *
 * Verifies the real _selectFeatured (extracted + evaluated with a fake `this`)
 * and source-guards the wiring.
 *
 * Run: node test/worldmap-curated-spread-smoke.mjs  (npm run test:worldmap-curated-spread)
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../public/widget-worldmap.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const m = SRC.match(/_selectFeatured\(countries\) \{[\s\S]*?\n    \}/);
ok('_selectFeatured is defined', !!m);
const make = (cfg) => new Function(`return { cfg: ${JSON.stringify(cfg)}, ${m[0]} };`)();
const select = (cfg, countries) => make(cfg)._selectFeatured(countries);

const C = (countryCode, lat, lng, fromPricePP, airportCount = 5) => ({ countryCode, lat, lng, fromPricePP, airportCount });

console.log('Two close neighbours: culled by the tidy default, shown when curated');
{
  const italy = C('IT', 42, 12, 100);
  const greece = C('GR', 39, 22, 100); // 10° of longitude apart — inside 13°, outside 7°
  ok('un-curated collapses them to one pin', select({ countries: [] }, [italy, greece]).length === 1);
  ok('curated shows both, because the client picked them', select({ countries: ['IT', 'GR'] }, [italy, greece]).length === 2);
}

// A realistic curated set (Travel Cheaper's kind of list): dense Europe/Med plus
// spread long-haul.
const SET = [
  C('ES', 40, -3, 12, 8), C('FR', 46, 2, 40, 8), C('IT', 42, 12, 35, 8), C('GR', 39, 22, 29, 8),
  C('PT', 39, -8, 20, 6), C('MT', 35.9, 14.4, 33, 4), C('TR', 39, 35, 29, 6),
  C('US', 36, -115, 8, 11), C('MX', 23, -102, 43, 4), C('IN', 21, 78, 7, 6),
  C('TH', 15, 101, 11, 4), C('ID', -2, 118, 28, 3), C('AE', 24, 54, 18, 3), C('SA', 24, 45, 6, 3),
];
const CODES = SET.map(c => c.countryCode);

console.log('A curated map surfaces far more of the chosen countries');
{
  const tidy = select({ countries: [] }, SET);
  const curated = select({ countries: CODES }, SET);
  ok('the tidy default stays capped at 12 or fewer', tidy.length <= 12);
  ok('curated shows strictly more than the tidy default', curated.length > tidy.length);
  ok('curated shows a rich spread (>= 12 here)', curated.length >= 12);
  ok('curated adds European neighbours the default dropped (France + Italy)',
    curated.some(c => c.countryCode === 'FR') && curated.some(c => c.countryCode === 'IT'));
  ok('the cheapest country is still present', curated.some(c => c.countryCode === 'SA'));
}

console.log('An explicit maxPins still wins, curated or not');
{
  ok('curated map honours maxPins', select({ countries: CODES, maxPins: 3 }, SET).length === 3);
  ok('un-curated map honours maxPins', select({ countries: [], maxPins: 4 }, SET).length === 4);
}

console.log('Wiring');
{
  ok('curation is detected from cfg.countries', /const curated = Array\.isArray\(this\.cfg\.countries\) && this\.cfg\.countries\.length > 0;/.test(SRC));
  ok('curated maps use a lighter de-overlap (5°/7°)', /const MIN_LAT = curated \? 5 : 9;/.test(SRC) && /const MIN_LNG = curated \? 7 : 13;/.test(SRC));
  ok('curated cap fits all chosen countries, default stays 12',
    /const max = this\.cfg\.maxPins \|\| \(curated \? Math\.max\(countries\.length, 12\) : 12\);/.test(SRC));
  const vm = SRC.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok('widget version >= 3.18.0', vm && (+vm[1] > 3 || (+vm[1] === 3 && +vm[2] >= 18)));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
