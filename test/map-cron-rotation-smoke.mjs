/**
 * The rotation has to actually rotate (17 Sep 2026).
 *
 * Travelnet's Travel Offers widget went empty. So had every other offers
 * widget: /api/cached-offers answered totalMatched 0 while the store still
 * held 26,605 offers, every one of them past the 70-hour expiry and therefore
 * filtered out on read.
 *
 * The cause was the order of two writes. refresh-map-offers sweeps a slice of
 * countries (5% of them, so four), then does its bookkeeping — a maintenance
 * purge that walks EVERY stored country key, then a full summary rebuild that
 * reads them all again — and only then saved the cursor that says where the
 * next run should resume. The function ceiling is 300s and it was killed
 * mid-bookkeeping 287 times, so that last write was never reached. The cursor
 * never moved. Every run for three days re-selected the SAME four countries,
 * and the other 59 were never swept again until they aged out.
 *
 * The tell was in the admin Cache tab: "map summary rebuilt 3d ago" and "last
 * sweep 3d ago" were the same moment, because all three writes sit at the end
 * of the run and all three froze together.
 *
 * A regex over the source would not have caught this, and a regex guard is
 * exactly what let a different bug through earlier the same day. So this drives
 * the real handler with Airtable, the offers proxy and Redis all answered by
 * one fetch stub, and asserts on what was written, in what order.
 *
 * Run: node test/map-cron-rotation-smoke.mjs  (npm run test:map-cron-rotation)
 */

// Before any import: _redis.js captures its credentials at module load, and
// the pacer would otherwise sleep a real second per request.
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.AIRTABLE_PAT = 'test-pat';
process.env.CRON_SECRET = 'test-secret';
process.env.OFFERS_PROXY_URL = 'https://offers.test.invalid/api/offers';
// Deliberately NOT setting OFFERS_MAX_RPM: no ceiling is the default and the
// only setting a country of this size fits inside the sweep budget under.

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const handler = (await import('../api/cron/refresh-map-offers.js')).default;

const CURSOR_KEY = 'map:offers:cursor';
const SUMMARY_KEY = 'map:offers:v1';

// 63 enabled countries, the live number, so the 5% slice is the live 4.
const COUNTRY_CODES = Array.from({ length: 63 }, (_, i) =>
  String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

// Spain's real gateway list. A country is swept per airport, per market and
// currency, per product, with Flights fanning out again over 30 UK departure
// airports — 734 requests for this row alone. At the 60/min ceiling added on
// 14 Sep 2026 that needed 734 seconds inside a function that is killed at 300,
// so Spain never finished, never stored and never advanced the rotation. The
// fixture is this size on purpose: a smaller one would pass either way.
const SPAIN_AIRPORTS = 'TFS,PMI,ACE,IBZ,LPA,AGP,ALC,FUE,SPC,REU,MAH,MAD,BCN,VLC,BIO,SVQ,TFN';

const store = new Map();
let writeOrder = [];
let sweptDestinations = [];
let proxyCalls = 0;
let failNextWith = null;

function redisRespond(url, init) {
  // Writes: POST /set/{key} with the value as the body.
  const setMatch = url.match(/\/set\/([^/?]+)$/);
  if (setMatch && (init.method || 'GET').toUpperCase() === 'POST') {
    const key = decodeURIComponent(setMatch[1]);
    store.set(key, init.body);
    writeOrder.push(key);
    return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
  }
  const parts = url.replace('https://redis.test.invalid/', '').split('/');
  const cmd = parts[0];
  const arg = parts[1] ? decodeURIComponent(parts[1]) : '';
  if (cmd === 'get') return new Response(JSON.stringify({ result: store.get(arg) ?? null }), { status: 200 });
  if (cmd === 'del') { store.delete(arg); return new Response(JSON.stringify({ result: 1 }), { status: 200 }); }
  if (cmd === 'keys') {
    const rx = new RegExp('^' + arg.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return new Response(JSON.stringify({ result: [...store.keys()].filter(k => rx.test(k)) }), { status: 200 });
  }
  return new Response(JSON.stringify({ result: null }), { status: 200 });
}

async function runOnce() {
  writeOrder = [];
  sweptDestinations = [];
  proxyCalls = 0;
  const realFetch = globalThis.fetch;
  const realLog = console.log, realWarn = console.warn, realError = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://redis.test.invalid')) return redisRespond(u, init);
    if (u.includes('api.airtable.com')) {
      // MapSearches: every country enabled, plus the refresh-interval config
      // read, which lives in the same base and must not look like a country.
      if (u.includes('tblrI1BihuDcpoV1A')) {
        return new Response(JSON.stringify({
          records: COUNTRY_CODES.map((cc, i) => ({
            id: 'rec' + String(i).padStart(14, '0'),
            fields: { CountryCode: cc, Country: 'Country ' + cc, Enabled: true, AirportCodes: SPAIN_AIRPORTS },
          })),
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    }
    if (u.startsWith('https://offers.test.invalid')) {
      proxyCalls++;
      try {
        const body = JSON.parse(init.body || '{}');
        for (const d of (body.destinations || [])) sweptDestinations.push(d);
      } catch { /* not our business here */ }
      // A supplier refusal, injected on a chosen call, to prove one 429 does
      // not cost the rest of the run.
      if (failNextWith !== null && proxyCalls >= failNextWith) {
        return new Response('rate limited', { status: 429, headers: { 'retry-after': '1' } });
      }
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    }
    throw new Error('unexpected fetch in test: ' + u);
  };

  const req = { method: 'GET', headers: { authorization: 'Bearer test-secret' }, query: {} };
  const sent = { status: 0, body: null };
  const res = {
    setHeader() { return this; },
    status(c) { sent.status = c; return this; },
    json(o) { sent.body = o; return this; },
    end() { return this; },
  };
  try { await handler(req, res); }
  finally {
    globalThis.fetch = realFetch;
    console.log = realLog; console.warn = realWarn; console.error = realError;
  }
  return { sent, writeOrder: [...writeOrder], swept: [...new Set(sweptDestinations)], proxyCalls };
}

console.log('The cursor is saved before the bookkeeping that outlives the run');
{
  const r = await runOnce();
  ok('the run answers ok', r.sent.status === 200 && r.sent.body && r.sent.body.ok === true,
    JSON.stringify(r.sent.body && r.sent.body.error));
  const cursorAt = r.writeOrder.indexOf(CURSOR_KEY);
  const summaryAt = r.writeOrder.indexOf(SUMMARY_KEY);
  ok('the cursor is written at all', cursorAt !== -1, r.writeOrder.join(', '));
  ok('the summary is written at all', summaryAt !== -1, r.writeOrder.join(', '));
  // The whole bug in one assertion: the cursor used to be the LAST write of
  // the run, after the purge and the rebuild, and the run never got there.
  ok('and it is written BEFORE the summary rebuild', cursorAt !== -1 && cursorAt < summaryAt,
    `cursor at ${cursorAt}, summary at ${summaryAt}`);
  const countryWrites = r.writeOrder.filter(k => /^offers:(packages|extra):/.test(k));
  const lastCountryAt = r.writeOrder.lastIndexOf(countryWrites[countryWrites.length - 1]);
  ok('the countries it swept were stored before the cursor moved past them',
    countryWrites.length > 0 && lastCountryAt < cursorAt,
    `last country write at ${lastCountryAt}, cursor at ${cursorAt}`);
}

console.log('Two consecutive runs do not sweep the same countries');
{
  store.clear();
  const first = await runOnce();
  const second = await runOnce();
  ok('the first run swept something', first.swept.length > 0, JSON.stringify(first.swept));
  ok('the second run swept something', second.swept.length > 0, JSON.stringify(second.swept));
  const overlap = first.swept.filter(c => second.swept.includes(c));
  // Before the fix this was a total overlap: the cursor never persisted, so
  // selectSlice handed back the same four countries every ten minutes for
  // three days while the rest of the world aged out of the cache.
  ok('and they are different countries', overlap.length === 0,
    `first=${first.swept.join(',')} second=${second.swept.join(',')} overlap=${overlap.join(',')}`);
}

console.log('The cursor advances by what was processed, and wraps');
{
  store.clear();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const r = await runOnce();
    seen.push(...r.swept);
    const cur = JSON.parse(store.get(CURSOR_KEY) || '{}');
    ok('run ' + (i + 1) + ' left the cursor at a sane position',
      Number.isInteger(cur.i) && cur.i >= 0 && cur.i < COUNTRY_CODES.length, JSON.stringify(cur));
  }
  ok('four runs covered four distinct slices', new Set(seen).size === seen.length,
    seen.join(','));
  ok('and got further than one slice into the rotation',
    new Set(seen).size >= 8, String(new Set(seen).size));
}

console.log('A country the size of the biggest one still finishes');
{
  store.clear();
  failNextWith = null;
  const r = await runOnce();
  // 17 airports: Packages 17x3, Hotels 1x3, Flights 17x(30+5+5) = 734 each.
  ok('the run costs what a real country costs', r.proxyCalls > 2000,
    'proxy calls: ' + r.proxyCalls);
  const stored = r.writeOrder.filter(k => /^offers:packages:/.test(k));
  ok('and every country in the slice was stored, not abandoned mid-sweep',
    stored.length >= 4, 'stored ' + stored.length + ' country keys');
  ok('the cursor still moved past them', r.writeOrder.includes(CURSOR_KEY));
}

console.log('One supplier refusal does not cost the rest of the run');
{
  store.clear();
  // Refuse everything from early in the first country onward. Before this the
  // first 429 tripped a breaker that turned every remaining job into a no-op
  // and broke out of the country loop entirely.
  failNextWith = 50;
  const r = await runOnce();
  failNextWith = null;
  ok('the run still answers ok', r.sent.status === 200 && r.sent.body.ok === true);
  ok('it kept asking rather than abandoning the rotation', r.proxyCalls > 2000,
    'proxy calls after the first 429: ' + r.proxyCalls);
  ok('and the cursor still advanced', r.writeOrder.includes(CURSOR_KEY));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
