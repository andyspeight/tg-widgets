/**
 * Weather / destination-content — a widget's fixed destination must refresh fast.
 *
 * Feedback (Andrea via Andy, 11 Aug 2026): changing a Weather widget's location
 * (Paris → France) did not show on the live embed — "as if it never saved" —
 * forcing a brand-new widget. Cause: the live widget fetches its climate from
 * /api/destination-content?id=<widgetId>, and that response (resolved from the
 * widget's MUTABLE destination config) was cached at the edge with the long
 * CONTENT cache: s-maxage=3600 + stale-while-revalidate=604800 (7 days). So the
 * OLD destination's climate kept serving for up to a week; a new widget id had
 * no cache entry, so it worked. The widget-config endpoint was shortened to 60s
 * on 28 Jul for the same reason; this sibling endpoint was missed.
 *
 * Fix: the fixed-destination public response now uses a short cache (60s), while
 * the stable by-slug content and the auth-gated editor preview keep their caches.
 *
 * Source guards over api/destination-content.js + public/widget-weather.js.
 *
 * Run: node test/weather-destination-cache-smoke.mjs  (also: npm run test:weather-dest-cache)
 */
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/destination-content.js', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../public/widget-weather.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The live widget fetches climate by widget id (mutable → must be short-cached)');
{
  ok('widget-weather.js fetches /api/destination-content?id=<widgetId>',
    /CONTENT_API \+ '\?id=' \+ encodeURIComponent\(/.test(widget));
}

console.log('A short cache exists for the widget-config-driven response');
{
  ok('WIDGET_CACHE is defined and short (s-maxage=60)',
    /const WIDGET_CACHE = 's-maxage=60, max-age=0, stale-while-revalidate=60';/.test(api));
  ok('WIDGET_CACHE does NOT carry the week-long stale window',
    /const WIDGET_CACHE = '[^']*';/.test(api) && !/const WIDGET_CACHE = '[^']*604800/.test(api));
}

console.log('The fixed-destination public path uses the short cache');
{
  const matches = api.match(/res\.setHeader\('Cache-Control', isDirect \? PREVIEW_CACHE : WIDGET_CACHE\);/g) || [];
  ok('both fixed-destination responses (cached hit + miss) use WIDGET_CACHE', matches.length === 2);
  ok('no fixed-destination response still uses the long PUBLIC_CACHE',
    !/isDirect \? PREVIEW_CACHE : PUBLIC_CACHE/.test(api));
}

console.log('The stable + editor paths are unchanged (no regression)');
{
  ok('the long content cache is still defined for stable destination content',
    /const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800';/.test(api));
  ok('the by-slug (auto-detect) path still uses PUBLIC_CACHE',
    (api.match(/res\.setHeader\('Cache-Control', PUBLIC_CACHE\);/g) || []).length >= 3);
  ok('the editor preview branch stays auth-gated + no-store',
    /Branch 1: Editor preview \(auth-gated/.test(api) && /const PREVIEW_CACHE = 'private, no-store';/.test(api));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
