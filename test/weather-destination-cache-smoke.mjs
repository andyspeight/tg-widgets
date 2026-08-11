/**
 * destination-content — cache must keep absorbing repeat loads (incident guard).
 *
 * /api/destination-content is BOTH long-cached AND rate-limited (120 / 15 min
 * per IP). Those only coexist safely while the browser cache (a non-zero
 * max-age) absorbs repeat loads so they never reach the rate-limited origin.
 *
 * On 11 Aug 2026 a weather tweak dropped max-age to 0 to make a changed
 * destination appear within a minute. That removed the browser cache, so a
 * developer reloading a page hit the origin every time and burned through the
 * rate limit → 429 → widgets stopped loading (Chrome; Firefox still had the old
 * cached response). This guards against re-introducing that.
 *
 * Run: node test/weather-destination-cache-smoke.mjs  (also: npm run test:weather-dest-cache)
 */
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/destination-content.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The public cache absorbs repeat loads (browser max-age > 0)');
{
  const m = api.match(/const PUBLIC_CACHE = '([^']*)';/);
  ok('PUBLIC_CACHE is defined', !!m);
  const cc = m ? m[1] : '';
  const ma = cc.match(/(?:^|[,\s])max-age=(\d+)/);
  ok('has a non-zero browser max-age (repeat loads served from browser cache)', !!ma && Number(ma[1]) > 0);
  ok('caches at the edge too (s-maxage)', /s-maxage=\d+/.test(cc));
}

console.log('No cache header on this endpoint uses max-age=0 (the incident trigger)');
{
  // Any Cache-Control value the handler sets must not disable the browser cache,
  // because this endpoint is rate-limited and relies on it to absorb reloads.
  const badConst = /const \w+ = '[^']*max-age=0[^']*';/.test(api);
  const badInline = /setHeader\('Cache-Control',\s*'[^']*max-age=0/.test(api);
  ok('no max-age=0 cache constant', !badConst);
  ok('no inline max-age=0 Cache-Control', !badInline);
}

console.log('The fixed-destination public path uses the long public cache');
{
  ok('both fixed-destination responses use PUBLIC_CACHE',
    (api.match(/res\.setHeader\('Cache-Control', isDirect \? PREVIEW_CACHE : PUBLIC_CACHE\);/g) || []).length === 2);
}

console.log('The endpoint is rate-limited (why the browser cache matters)');
{
  ok('destination-content applies a per-IP rate limit',
    /applyRateLimit\(res, `destcontent:\$\{getClientIp\(req\)\}`/.test(api));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
