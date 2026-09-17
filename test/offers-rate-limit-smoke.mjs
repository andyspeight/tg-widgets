/**
 * Offers cache refresh — handling Travelify's 429s without stalling the sweep.
 *
 * HISTORY, because this suite has specified two opposite designs.
 *
 * On 14 Sep 2026 a 429 stopped being retried and instead tripped a breaker
 * that turned every remaining job in the run into a no-op, and a 60/min
 * ceiling was put on the whole sweep. Both were aimed at a real nuisance: the
 * monitor had been emailing "offers is failing / HTTP 429" for weeks.
 *
 * They broke the cache. A country is swept per gateway airport, per market and
 * currency, per product, with Flights fanning out again over 30 UK departure
 * airports. Spain has 17 airports: 734 requests. At 60/min that needs 734
 * seconds inside a function killed at 300, so Spain never finished, never
 * stored and never advanced the rotation. Offers aged out at the 70-hour mark
 * on 17 Sep and every offers widget went empty. Andy: "go back to how it was
 * when it was working, we need a complete fix, not a change in what we do."
 *
 * So the ceiling is off unless OFFERS_MAX_RPM is deliberately set, and a 429
 * fails one request rather than abandoning 63 countries. What this suite now
 * holds:
 *
 *   1. A 429 is retried, honouring Retry-After but never parking a worker for
 *      longer than the sweep budget it sits inside.
 *   2. A refused request is reported as rate limited, so the tally can tell it
 *      from the feed actually failing.
 *   3. One refusal never silences the requests after it.
 *   4. The pacer exists only when a ceiling was asked for.
 *
 * It drives the REAL callOffersProxy out of the shipped cron, and the REAL
 * pacer out of api/_lib/offers/throttle.js.
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
  'MAX_RETRY_WAIT_MS', 'pacer', 'parseRetryAfter', 'OFFERS_PROXY', 'SELF_ORIGIN', 'PER_REQUEST_TIMEOUT_MS', 'fetch',
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
  // A 429 fails THIS request and is retried, exactly as it was for the months
  // the cache worked. It briefly abandoned the whole run instead, which cost
  // the rotation a run's progress every time Travelify refused one request.
  const fetchStub = stubFetch([{ status: 429 }, { status: 200, body: { success: true, data: [] } }]);
  const call = makeCall(20, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  const r = await call({ appId: '250' });
  ok(fetchStub.calls.length === 2, 'a 429 is retried, not abandoned');
  ok(r.ok === true, 'and a retry that succeeds still returns the offers');
}
{
  // Refused twice: the request fails, and says WHY it failed.
  const fetchStub = stubFetch([{ status: 429 }, { status: 429 }]);
  const call = makeCall(20, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  const r = await call({ appId: '250' });
  ok(r.ok === false, 'a request refused twice fails');
  ok(r.rateLimited === true, 'the result says it was rate limited, not that the feed failed');
}
{
  // Their Retry-After is honoured, but capped. A sweep has a 200s budget and a
  // worker parked for the five minutes Retry-After may legally ask for spends
  // it on nothing.
  const fetchStub = stubFetch([{ status: 429, headers: { 'retry-after': '300' } }, { status: 200, body: { success: true, data: [] } }]);
  const call = makeCall(20, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  const t0 = Date.now();
  await call({ appId: '250' });
  const elapsed = Date.now() - t0;
  ok(fetchStub.calls.length === 2, 'it comes back for the retry');
  ok(elapsed < 1000, 'a five-minute Retry-After never parks a worker for five minutes');
}
{
  // One refusal must not silence the requests after it. This is the exact
  // behaviour whose absence emptied the cache: every job after the first 429
  // returned a no-op without spending a request.
  const fetchStub = stubFetch([{ status: 429 }, { status: 429 }, { status: 200, body: { success: true, data: [] } }]);
  const call = makeCall(20, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  await call({ appId: '250' });
  const before = fetchStub.calls.length;
  const next = await call({ appId: '250' });
  ok(fetchStub.calls.length > before, 'the next job still spends its request');
  ok(next.ok === true, 'and succeeds once the supplier has moved on');
}
{
  // A 500 is still retried — this fix must not stop the cron healing a blip.
  const fetchStub = stubFetch([{ status: 500 }, { status: 200, body: { success: true, data: [{ id: 1 }] } }]);
  const call = makeCall(20, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  const r = await call({ appId: '250' });
  ok(fetchStub.calls.length === 2, 'a 500 is still retried once');
  ok(r.ok === true, 'and the retry succeeding still returns the offers');
  ok(!r.rateLimited, 'a 500 is a feed failure, not a rate limit');
}
{
  // A timeout is still retried too.
  const fetchStub = stubFetch([{ throw: 'aborted', name: 'AbortError' }, { status: 200 }]);
  const call = makeCall(20, fastPacer(), parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  const r = await call({ appId: '250' });
  ok(fetchStub.calls.length === 2 && r.ok === true, 'a network blip still self-heals');
}
{
  // Every request goes through the pacer, including the ones that succeed.
  const p = createPacer({ perMinute: 6000, burst: 1000, sleep: async () => {} });
  const fetchStub = stubFetch([{ status: 200 }]);
  const call = makeCall(20, p, parseRetryAfter, 'https://x/api/offers', 'https://x', 10000, fetchStub);
  await call({ appId: '250' }); await call({ appId: '250' });
  ok(p.stats().taken === 2, 'the pacer sees every outgoing request');
}

// ── the shipped wiring ─────────────────────────────────────────────────────
ok(/OFFERS_MAX_RPM/.test(cron), 'the rate ceiling is tunable from the environment');
ok(/\? n : 0;\s*\/\/ 0 = no ceiling/.test(cron), 'and is OFF unless somebody deliberately sets it');
ok(/const pacer = MAX_REQUESTS_PER_MIN \? createPacer/.test(cron), 'the pacer exists only when a ceiling was asked for');
ok(/if \(pacer\) await pacer\.take\(\)/.test(cron), 'and is consulted only when it exists');
ok(/734 requests/.test(cron), 'the arithmetic that must be done before setting one is written down beside it');
ok(!/if \(!res\.ok\) \{ last = \{ ok: false, status: res\.status \}; continue; \}[\s\S]{0,40}$/.test(cron.slice(cron.indexOf('callOffersProxy'))), 'sanity');
ok(/rateLimitedRequests/.test(cron), 'the run still records how many requests the supplier refused');
ok(/if \(r\.skipped\)/.test(cron) && /if \(r\.rateLimited\)/.test(cron), 'rate-limited jobs are tallied apart from real failures');

const admin = readFileSync(new URL('../public/admin-worldmap.html', import.meta.url), 'utf8');
ok(/requests \(\$\{perOffer/.test(admin) || /per offer kept/.test(admin), 'the Cache tab shows requests per offer kept, the cost side of each product');
ok(/rate limited</.test(admin), 'and shows how many requests the supplier refused');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
