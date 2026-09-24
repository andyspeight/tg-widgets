/**
 * Every API function is an ES module, and every one of them loads
 * (24 Sep 2026).
 *
 * This repo is "type": "module". A file under api/ that ends with
 * `module.exports =` or calls `require()` cannot load, and Vercel answers every
 * call to it with FUNCTION_INVOCATION_FAILED. /api/weather-current had been
 * doing exactly that on production, found while proving the move to Node 24;
 * api/enquiry-form-config.js carried a `require('crypto')` in a fallback that
 * would have thrown the day it ran. Nothing caught either, because no test ever
 * loaded them.
 *
 * So this checks the whole class: no CommonJS in any server file, every API
 * route loads and exports a handler, and the weather endpoint answers properly
 * with the weather service stubbed out.
 *
 * The one exception is api/api/luna-copilot.js: a stray copy of a Luna Chat
 * file (it requires ../lib/luna-auth, which lives in andyspeight/
 * luna-chat-endpoint, not here). It is Luna Chat's, so it is named here rather
 * than edited.
 *
 * Run: node test/api-esm-smoke.mjs   (npm run test:api-esm)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const ROOT = new URL('../', import.meta.url).pathname;
const STRAY = new Set(['api/api/luna-copilot.js']);

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.js$/.test(f)) out.push(relative(ROOT, p));
  }
  return out;
}

// Code only: drop block comments and line comments before looking.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

console.log('\nNo CommonJS in server code\n');
const serverFiles = [
  ...walk(join(ROOT, 'api')),
  ...readdirSync(ROOT).filter((f) => /\.js$/.test(f) && !/\.config\./.test(f)),
  ...readdirSync(join(ROOT, 'public')).filter((f) => /^_.*\.js$/.test(f)).map((f) => 'public/' + f),
].filter((f) => !STRAY.has(f));
const offenders = [];
for (const f of serverFiles) {
  const code = codeOf(readFileSync(join(ROOT, f), 'utf8'));
  if (/(^|[^.\w])module\.exports\b|(^|[^.\w$])exports\.\w+\s*=|(^|[^.\w$'"`])require\(\s*['"`]/m.test(code)) offenders.push(f);
}
ok(serverFiles.length + ' server files checked: none uses module.exports or require()', offenders.length === 0, offenders.join(', '));

console.log('\nEvery API route loads\n');
const routes = walk(join(ROOT, 'api')).filter((f) => !f.split('/').some((seg) => seg.startsWith('_')) && !STRAY.has(f));
const broken = [];
const quiet = console.warn; const quietLog = console.log;
for (const f of routes) {
  try {
    console.warn = () => {}; console.log = () => {};
    const mod = await import(pathToFileURL(join(ROOT, f)).href);
    if (typeof mod.default !== 'function') broken.push(f + ' (no default handler)');
  } catch (e) {
    broken.push(f + ' (' + String(e.message).split('\n')[0].slice(0, 80) + ')');
  } finally { console.warn = quiet; console.log = quietLog; }
}
ok(routes.length + ' routes load and export a handler', broken.length === 0, broken.join('; '));

console.log('\nThe weather endpoint answers\n');
{
  const { default: handler } = await import(pathToFileURL(join(ROOT, 'api/weather-current.js')).href);
  const call = async (method, query, headers = {}) => {
    const res = { statusCode: 200, headers: {}, body: undefined,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method, query, headers: { 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200), ...headers } }, res);
    return res;
  };
  const realFetch = globalThis.fetch;
  let asked = '';
  globalThis.fetch = async (url) => {
    asked = String(url);
    return { ok: true, json: async () => ({ current: { temperature_2m: 27.4, apparent_temperature: 29.1, weather_code: 1, wind_speed_10m: 12.2, relative_humidity_2m: 58, is_day: 1 } }) };
  };
  try {
    ok('a preflight is answered', (await call('OPTIONS', {})).statusCode === 204);
    ok('only GET is accepted', (await call('POST', {})).statusCode === 405);
    ok('nonsense coordinates are refused', (await call('GET', { lat: '999', lng: 'x' })).statusCode === 400);
    const r = await call('GET', { lat: '35.3728', lng: '25.75', units: 'c' });
    ok('a real place gets the weather', r.statusCode === 200 && r.body.ok === true && r.body.temp === 27 && r.body.desc === 'Mainly clear' && r.body.isDay === true, JSON.stringify(r.body));
    ok('from Open-Meteo, with only the two coordinates we checked', asked.startsWith('https://api.open-meteo.com/v1/forecast?') && /latitude=35\.3728/.test(asked) && /longitude=25\.75/.test(asked));
    ok('cached at the edge for 15 minutes', /s-maxage=900/.test(r.headers['cache-control'] || ''));
    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
    const bad = await call('GET', { lat: '51.5', lng: '-0.12' });
    ok('an upstream failure is a clean 502, not a crash', bad.statusCode === 502 && bad.body.ok === false);
  } finally { globalThis.fetch = realFetch; }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
