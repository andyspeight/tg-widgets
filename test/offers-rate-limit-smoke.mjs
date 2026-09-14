/**
 * Offers cache refresh — honouring HTTP 429, and pacing our own fan-out.
 *
 * Since late July the monitor has emailed "offers is failing / HTTP 429"
 * several times a day. The client-facing path was never affected (widgets read
 * the cache, never the live proxy), but our own cache fill was being throttled
 * by Travelify — and then made it worse two ways:
 *
 *   1. A 429 was retried after a flat 500ms. That is asking the same question
 *      again while still being told to wait.
 *   2. Nothing bounded the RATE. A country swept at concurrency six as fast as
 *      responses came back, so the average looked survivable and the bursts
 *      were not.
 *
 * This drives the REAL callOffersProxy out of the shipped cron, and the REAL
 * pacer/circuit out of api/_lib/offers/throttle.js.
 *
 * Run: node test/offers-rate-limit-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { createPacer, createCircuit, parseRetryAfter } from '../api/_lib/offers/throttle.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

function sliceBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx); const open = i;
  let d = 0, str = null, line = false, block = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced');
}
function ex(src, sig) { const at = src.indexOf(sig); if (at < 0) throw new Error('not found: ' + sig); return sig + sliceBalanced(src, at + sig.length); }

const cron = readFileSync(new URL('../api/cron/refresh-map-offers.js', import.meta.url), 'utf8');
const SIG = 'async function callOffersProxy(payload, timeoutMs = PER_REQUEST_TIMEOUT_MS, retries = 1)';
const makeCall = new Function(
  'circuit', 'pacer', 'parseRetryAfter', 'OFFERS_PROXY', 'SELF_ORIGIN', 'PER_REQUEST_TIMEOUT_MS', 'fetch',
  'return ' + ex(cron, SIG) + ';'
);

// A fetch stub that records calls and answers from a script of responses.
function stubFetch(script) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const next = script[Math.min(calls.length - 1, script.length - 1)];
    if (next.throw) throw Object.assign(new Error(next.throw), { name: next.name || 'Error' });
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (h) => (next.headers || {})[String(h).toLowerCase()] ?? null },
      json: async () => next.body ?? { success: true, data: [] },
    };
  };
  fn.calls = calls;
  return fn;
}
// A pacer that never really sleeps, so the suite runs instantly.
const fastPacer = () => createPacer({ perMinute: 6000, burst: 1000, sleep: async () => {} });

// ── parseRetryAfter ────────────────────────────────────────────────────────
ok(parseRetryAfter('120') === 120000, 'delta-seconds form');
ok(parseRetryAfter('0') === 0, 'zero seconds is a real answer, not "absent"');
ok(parseRetryAfter(null) === null, 'absent header');
ok(parseRetryAfter('') === null, 'empty header');
ok(parseRetryAfter('soon please') === null, 'unparseable header');
ok(parseRetryAfter('99999') === 300000, 'a huge wait is clamped to 5 minutes');
{
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  ok(parseRetryAfter(new Date(now + 45000).toUTCString(), now) === 45000, 'HTTP-date form');
  ok(parseRetryAfter(new Date(now - 45000).toUTCString(), now) === 0, 'a date in the past is no wait at all');
}

// ── pacer ──────────────────────────────────────────────────────────────────
{
  let t = 0;
  const p = createPacer({ perMinute: 60, burst: 0, now: () => t, sleep: async (ms) => { t += ms; } });
  const delays = [];
  for (let i = 0; i < 4; i++) delays.push(await p.take());
  ok(delays[0] === 0, 'the first request goes straight out');
  ok(delays.slice(1).every((d) => d === 1000), '60/min spaces the rest one second apart');
  ok(p.stats().taken === 4 && p.stats().waitedMs === 3000, 'the pacer reports what it cost');
}
{
  let t = 0;
  const p = createPacer({ perMinute: 60, burst: 3, now: () => t, sleep: async (ms) => { t += ms; } });
  const d = [];
  for (let i = 0; i < 4; i++) d.push(await p.take());
  ok(d.filter((x) => x === 0).length >= 3, 'a burst allowance lets a short sweep through unslowed');
}
{
  // The real point: the same work, spread out rather than fired at once.
  let t = 0;
  const p = createPacer({ perMinute: 120, burst: 0, now: () => t, sleep: async (ms) => { t += ms; } });
  for (let i = 0; i < 120; i++) await p.take();
  ok(t >= 59000 && t <= 60000, '120 requests at 120/min occupy about a minute, not an instant');
}

// ── circuit ────────────────────────────────────────────────────────────────
{
  let t = 0;
  const c = createCircuit({ now: () => t, defaultCooloffMs: 60000 });
  ok(c.open() === false, 'starts closed');
  c.trip(5000);
  ok(c.open() === true && c.remainingMs() === 5000, 'a trip opens it for the stated wait');
  t += 4999; ok(c.open() === true, 'still open a millisecond early');
  t += 1; ok(c.open() === false, 'closes when the wait has passed');
  c.trip(null);
  ok(c.remainingMs() === 60000, 'no Retry-After falls back to the default cool-off');
  c.trip(1000);
  ok(c.remainingMs() === 60000, 'a shorter later trip never shortens a longer wait');
  ok(c.stats().trips === 3, 'trips are counted for the Cache tab');
}

// ── the real callOffersProxy ───────────────────────────────────────────────
{
  // A 429 is not retried, and it trips the circuit.
  const circuit = createCircuit({ defaultCooloffMs: 60000 });
  const fetchStub = stubFetch([{ status: 429 }, { status: 200 }]);
  const call = makeCall(circuit, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  const r = await call({ appId: '250' });
  ok(fetchStub.calls.length === 1, 'a 429 is asked once, never retried');
  ok(r.ok === false && r.rateLimited === true, 'the result says it was rate limited, not that the feed failed');
  ok(circuit.open() === true, 'the circuit is open after a 429');
}
{
  // Retry-After is honoured over the default.
  const circuit = createCircuit({ defaultCooloffMs: 60000 });
  const fetchStub = stubFetch([{ status: 429, headers: { 'retry-after': '30' } }]);
  const call = makeCall(circuit, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  await call({ appId: '250' });
  ok(circuit.remainingMs() > 29000 && circuit.remainingMs() <= 30000, "the supplier's own Retry-After is used");
}
{
  // While open, no further request is spent at all.
  const circuit = createCircuit({ defaultCooloffMs: 60000 });
  const fetchStub = stubFetch([{ status: 429 }]);
  const call = makeCall(circuit, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  await call({ appId: '250' });
  const before = fetchStub.calls.length;
  const second = await call({ appId: '250' });
  const third = await call({ appId: '250' });
  ok(fetchStub.calls.length === before, 'the rest of the run spends no requests while backing off');
  ok(second.skipped === true && third.skipped === true, 'those jobs report themselves as skipped');
  ok(second.rateLimited === true, 'and as rate limited, so the tally can tell them from failures');
}
{
  // A 500 is still retried — this fix must not stop the cron healing a blip.
  const circuit = createCircuit();
  const fetchStub = stubFetch([{ status: 500 }, { status: 200, body: { success: true, data: [{ id: 1 }] } }]);
  const call = makeCall(circuit, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  const r = await call({ appId: '250' });
  ok(fetchStub.calls.length === 2, 'a 500 is still retried once');
  ok(r.ok === true, 'and the retry succeeding still returns the offers');
  ok(circuit.open() === false, 'a 500 does not trip the back-off — only a 429 does');
}
{
  // A timeout is still retried too.
  const circuit = createCircuit();
  const fetchStub = stubFetch([{ throw: 'aborted', name: 'AbortError' }, { status: 200 }]);
  const call = makeCall(circuit, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  const r = await call({ appId: '250' });
  ok(fetchStub.calls.length === 2 && r.ok === true, 'a network blip still self-heals');
}
{
  // Every request goes through the pacer, including the ones that succeed.
  const circuit = createCircuit();
  const p = createPacer({ perMinute: 6000, burst: 1000, sleep: async () => {} });
  const fetchStub = stubFetch([{ status: 200 }]);
  const call = makeCall(circuit, p, parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  await call({ appId: '250' }); await call({ appId: '250' });
  ok(p.stats().taken === 2, 'the pacer sees every outgoing request');
}

// ── the shipped wiring ─────────────────────────────────────────────────────
ok(/OFFERS_MAX_RPM/.test(cron), 'the rate ceiling is tunable from the environment');
ok(/const pacer = createPacer\(\{ perMinute: MAX_REQUESTS_PER_MIN \}\)/.test(cron), 'the cron builds a pacer');
ok(/if \(circuit\.open\(\)\) \{/.test(cron), 'the cron checks the circuit before spending a request');
ok(!/if \(!res\.ok\) \{ last = \{ ok: false, status: res\.status \}; continue; \}[\s\S]{0,40}$/.test(cron.slice(cron.indexOf('callOffersProxy'))), 'sanity');
ok(/throttle: \{ \.\.\.pacer\.stats\(\), \.\.\.circuit\.stats\(\) \}/.test(cron), 'the run records what throttling cost it');
ok(/if \(r\.skipped\)/.test(cron) && /if \(r\.rateLimited\)/.test(cron), 'rate-limited jobs are tallied apart from real failures');

const admin = readFileSync(new URL('../public/admin-worldmap.html', import.meta.url), 'utf8');
ok(/requests \(\$\{perOffer/.test(admin) || /per offer kept/.test(admin), 'the Cache tab shows requests per offer kept, the cost side of each product');
ok(/rate limited</.test(admin), 'and shows how many requests the supplier refused');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
