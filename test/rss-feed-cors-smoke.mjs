/**
 * RSS feed API — CORS must allow ANY origin so the widget works on client sites.
 *
 * Bug: the endpoint only echoed Access-Control-Allow-Origin for an allow-listed
 * origin. A client's own website was never on the list, so no Allow-Origin
 * header was sent and the browser blocked the read ("CORS Missing Allow
 * Origin") — even though the request itself succeeded. The feed is public,
 * read-only (GET) and carries no credentials, so it now returns
 * Access-Control-Allow-Origin: '*', like the other public widget feeds.
 *
 * Drives the REAL handler (no network: OPTIONS returns 204, and a GET with no
 * url param fails validation at 400 before any fetch) and asserts every
 * response carries the open CORS header.
 *
 * Run: node test/rss-feed-cors-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import handler from '../api/rss-feed.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    body: undefined,
    headers,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(n) { this.statusCode = n; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; },
  };
}
const allowOrigin = (res) => res.headers['access-control-allow-origin'];

// ── OPTIONS preflight from an arbitrary client origin ────────────────────────
let res = mockRes();
await handler({ method: 'OPTIONS', headers: { origin: 'https://a-random-client-site.example' }, query: {} }, res);
ok(allowOrigin(res) === '*', 'OPTIONS from a client site → Allow-Origin: *');
ok(res.statusCode === 204, 'OPTIONS → 204');
ok(/GET/.test(res.headers['access-control-allow-methods'] || ''), 'Allow-Methods advertises GET');

// ── OPTIONS with NO origin header still gets '*' (unconditional) ─────────────
res = mockRes();
await handler({ method: 'OPTIONS', headers: {}, query: {} }, res);
ok(allowOrigin(res) === '*', 'no Origin header → Allow-Origin: * (unconditional)');

// ── A GET error response (missing url) still carries CORS ────────────────────
// This is the path a browser sees on the client site: the header must be there
// on the actual data/GET response, not only on the preflight.
res = mockRes();
await handler({ method: 'GET', headers: { origin: 'https://another-client.example' }, query: {}, socket: {} }, res);
ok(allowOrigin(res) === '*', 'GET response carries Allow-Origin: *');
ok(res.statusCode === 400, 'GET with no url → 400 (validated before any network fetch)');

// ── Source guard: the allow-list gate must not come back ─────────────────────
const src = readFileSync(new URL('../api/rss-feed.js', import.meta.url), 'utf8');
ok(/setHeader\('Access-Control-Allow-Origin',\s*'\*'\)/.test(src), "applyCors sets Allow-Origin: '*'");
ok(!/isAllowedOrigin/.test(src), 'origin allow-list gate removed (no isAllowedOrigin)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
