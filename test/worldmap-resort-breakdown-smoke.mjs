/**
 * Offer map admin — per-city breakdown in the cache drill-down (Andy, Aug 2026).
 *
 * The country drill-down lists offers cheapest-first, capped at 200. A country
 * with one very cheap city (Las Vegas in the USA) fills that whole page, so a
 * well-spread cache looked one-city deep and you couldn't tell New York/Orlando
 * were even stored. The API now returns a per-resort tally over the WHOLE
 * filtered set, and the admin renders it as chips, so coverage is visible at a
 * glance without paging.
 *
 * Verifies the tally semantics (re-implemented from the endpoint) and
 * source-guards the endpoint + admin wiring.
 *
 * Run: node test/worldmap-resort-breakdown-smoke.mjs  (npm run test:worldmap-resort-breakdown)
 */
import { readFileSync } from 'node:fs';

const API = readFileSync(new URL('../api/admin/map-cache.js', import.meta.url), 'utf8');
const ADMIN = readFileSync(new URL('../public/admin-worldmap.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// ── Behavioural: mirror the endpoint's tally to pin the semantics ──
function tally(pool) {
  const byResort = new Map();
  for (const o of pool) {
    const r = (o && o.resort) ? String(o.resort) : '—';
    const e = byResort.get(r) || { resort: r, count: 0, fromPP: null };
    e.count += 1;
    const pp = Number.isFinite(o.pricePP) ? o.pricePP : (Number.isFinite(o.price) ? o.price : null);
    if (pp != null && (e.fromPP == null || pp < e.fromPP)) e.fromPP = pp;
    byResort.set(r, e);
  }
  return Array.from(byResort.values())
    .sort((a, b) => b.count - a.count || (a.fromPP || Infinity) - (b.fromPP || Infinity))
    .slice(0, 80);
}

console.log('The tally counts every city over the whole set, cheapest-first list notwithstanding');
{
  // 200 cheap Vegas rooms + a scatter of other US cities.
  const pool = [];
  for (let i = 0; i < 200; i++) pool.push({ resort: 'Las Vegas', pricePP: 30 + i });
  for (let i = 0; i < 12; i++) pool.push({ resort: 'New York', pricePP: 180 + i });
  for (let i = 0; i < 18; i++) pool.push({ resort: 'Orlando', pricePP: 90 + i });
  for (let i = 0; i < 6; i++) pool.push({ resort: 'Miami', pricePP: 140 + i });
  const out = tally(pool);
  ok('every city appears, not just the cheap one', out.map(r => r.resort).sort().join(',') === 'Las Vegas,Miami,New York,Orlando');
  ok('cities are ranked by how many are stored', out[0].resort === 'Las Vegas' && out[0].count === 200);
  ok('New York is visible even though its rooms are dearer than 200 Vegas ones', out.some(r => r.resort === 'New York' && r.count === 12));
  ok('each city carries its cheapest price', out.find(r => r.resort === 'Orlando').fromPP === 90);
  ok('a missing resort name folds into "—"', tally([{ pricePP: 5 }]).some(r => r.resort === '—'));
  ok('caps at 80 cities', tally(Array.from({ length: 200 }, (_, i) => ({ resort: 'city' + i, pricePP: i }))).length === 80);
}

console.log('Endpoint wiring');
{
  ok('builds the per-resort tally over the filtered pool', /const byResort = new Map\(\);[\s\S]*?for \(const o of pool\)/.test(API));
  ok('sorts by count then cheapest, caps at 80', /sort\(\(a, b\) => b\.count - a\.count[\s\S]*?\.slice\(0, 80\)/.test(API));
  ok('resortBreakdown is returned in the response', /resortBreakdown,/.test(API));
}

console.log('Admin wiring');
{
  ok('renders the resort spread when present', /Array\.isArray\(d\.resortBreakdown\) && d\.resortBreakdown\.length/.test(ADMIN));
  ok('shows each city with its count as a chip', /rs-chip">\$\{esc\(r\.resort\)\} <b>\$\{r\.count\.toLocaleString/.test(ADMIN));
  ok('the spread line is inserted into the drill-down', /\$\{resortSpread\}/.test(ADMIN));
  ok('chip styles exist', /\.rs-chip \{/.test(ADMIN));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
