/**
 * Weather (live) — widen the edge stale window.
 *
 * /api/weather-current stays fresh for 15 min, but the stale-while-revalidate
 * window was only 30 min, so a quiet client site could still make the odd
 * visitor wait on Open-Meteo after an idle spell. It now serves stale for up to
 * 4 hours while it refreshes in the background.
 *
 * Drives the real handler with a stubbed Open-Meteo and checks the header.
 *
 * Run: node test/weather-cache-smoke.mjs   (also: npm run test:weather-cache)
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

// Stub Open-Meteo before loading the handler (it uses the global fetch).
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({
    current: {
      temperature_2m: 21, apparent_temperature: 20, weather_code: 1,
      wind_speed_10m: 9, relative_humidity_2m: 55, is_day: 1,
    },
    current_units: { temperature_2m: '°C' },
  }),
});

// The API is CommonJS (module.exports) but the repo is type:module, so a plain
// require/import treats it as ESM and fails. Evaluate the source with a CJS
// shim, giving it a require scoped to api/ so its own ./_auth import resolves.
const apiPath = join(__dirname, '..', 'api', 'weather-current.js');
const scopedRequire = createRequire(apiPath);
const SRC = readFileSync(apiPath, 'utf8');
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', SRC)(mod, mod.exports, scopedRequire);
const handler = mod.exports;

function makeRes() {
  const headers = {};
  return {
    statusCode: 0, body: null,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

console.log('Weather serves stale for hours on a quiet site');
{
  const res = makeRes();
  await handler({ method: 'GET', query: { lat: '51.5', lng: '-0.12', units: 'c' }, headers: { origin: 'https://client.example' }, socket: {} }, res);
  const cc = res.getHeader('cache-control') || '';
  ok('responds 200', res.statusCode === 200);
  ok('still fresh for 15 min (s-maxage=900)', /s-maxage=900/.test(cc));
  ok('stale window widened to 4 hours (stale-while-revalidate=14400)', /stale-while-revalidate=14400/.test(cc));
  ok('no longer the old 30 min stale window', cc.indexOf('stale-while-revalidate=1800') === -1);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
