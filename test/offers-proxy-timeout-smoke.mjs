/**
 * /api/offers upstream-timeout hardening — the SERVER half of the 23 Jul 2026
 * offers incident.
 *
 * The proxy called Travelify with no timeout and had no vercel.json maxDuration,
 * so a slow flight query let Vercel kill the function mid-flight and return an
 * EMPTY-bodied gateway response — which the widget parsed into "Unexpected end
 * of JSON input" (and a no-CORS 504 read as "Failed to fetch"). The proxy now
 * bounds the upstream fetch and ALWAYS returns its own clean JSON: a 504 on
 * timeout, a 502 on a genuine network error, so the browser always gets a body
 * it can parse.
 *
 * Drives the REAL handler with a stubbed global.fetch and NO env, so the Redis
 * rate-limiter fails open and telemetry is a no-op. The demo appId ('250') path
 * skips the Airtable credential lookup.
 *
 * Run: node test/offers-proxy-timeout-smoke.mjs
 */

// A dummy session secret so importing the shared _auth.js is clean. Deliberately
// NO Upstash/Supabase (rate-limiter fails open, telemetry no-ops) and NO Airtable.
process.env.TG_SESSION_SECRET = process.env.TG_SESSION_SECRET || 'test-secret-0123456789abcdef0123456789';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const { default: handler } = await import('../api/offers.js');

function mockRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    status(n) { this.statusCode = n; return this; },
    json(o) { if (this.body === undefined) this.body = o; return this; },
    end() { return this; },
  };
}
const req = (body = {}) => ({
  method: 'POST',
  headers: {
    'user-agent': 'test-runner',
    referer: 'https://www.travelhubworld.com/last-minute-deals',
    origin: 'https://www.travelhubworld.com',
  },
  body,
  socket: { remoteAddress: '10.0.0.1' },
});

const realFetch = global.fetch;

// 1. Upstream timeout (AbortSignal.timeout fires a TimeoutError) → clean 504 JSON.
global.fetch = async () => { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; };
let res = mockRes();
await handler(req({ appId: '250', type: 'Flights' }), res);
ok(res.statusCode === 504, 'upstream timeout → HTTP 504 (never a platform-killed empty body)');
ok(res.body && res.body.success === false && /timed out/i.test(res.body.error || ''),
  '504 carries a clean JSON body the widget can parse (no "Unexpected end of JSON input")');

// 2. Upstream AbortError → also 504 (same class of infra stall).
global.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
res = mockRes();
await handler(req({ appId: '250' }), res);
ok(res.statusCode === 504 && res.body && res.body.success === false, 'upstream abort → 504 JSON');

// 3. Genuine network error (not an abort) → 502 JSON — a bad gateway, not our 500.
global.fetch = async () => { throw new TypeError('Failed to fetch'); };
res = mockRes();
await handler(req({ appId: '250' }), res);
ok(res.statusCode === 502 && res.body && res.body.success === false,
  'upstream network error → 502 JSON, not an internal 500');

// 4. Happy path still passes the upstream JSON straight through.
global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: [{ id: 1 }] }) });
res = mockRes();
await handler(req({ appId: '250' }), res);
ok(res.statusCode === 200 && res.body && res.body.success === true,
  'a good upstream response is passed through unchanged (200)');

// 5. The upstream Travelify fetch is actually bounded by an abort signal.
let sawSignal = false;
global.fetch = async (url, opts) => { sawSignal = !!(opts && opts.signal); return { ok: true, status: 200, text: async () => '{"success":true,"data":[]}' }; };
res = mockRes();
await handler(req({ appId: '250' }), res);
ok(sawSignal === true, 'the upstream fetch carries an abort signal (the timeout is wired)');

global.fetch = realFetch;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
