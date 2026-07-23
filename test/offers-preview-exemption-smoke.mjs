/**
 * Public rate limiter — our own editor/preview is exempt, the public surface is not.
 *
 * The 23 Jul 2026 incident: a client building an offers widget in the dashboard
 * tripped the public per-IP offers limit, because the editor's availability
 * probe fans out several live /api/offers calls per edit. That exhausted the
 * shared per-IP bucket and blanked the client's own live site for an hour.
 *
 * Fix: evaluatePublicRateLimit exempts requests that carry X-TG-Preview:1 AND
 * originate from one of our own platform hosts (a browser cannot forge
 * Origin/Referer). The live widget on a customer site sends neither, so the
 * public surface stays throttled. Write paths (popup-lead) are never relaxed.
 *
 * No Redis env is set here, so the NON-exempt path fails open (allowed:true but
 * failOpen:true). The exemption returns early with preview:true BEFORE any
 * counting, so the two paths are distinguishable even without a live Redis.
 *
 * Run: node test/offers-preview-exemption-smoke.mjs
 */
let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Ensure the limiter takes its normal (non-disabled, no-Redis) path.
delete process.env.RL_DISABLED;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const { evaluatePublicRateLimit } = await import('../api/_lib/rate-limit-public.js');

const res = { setHeader() {} };
const mkReq = (headers) => ({ headers, socket: { remoteAddress: '203.0.113.7' } });

// 1. Trusted preview (our own editor) → exempt: returns early with preview:true.
let d = await evaluatePublicRateLimit(
  mkReq({ 'x-tg-preview': '1', origin: 'https://id.travelify.io' }),
  res, { event: 'offers', widgetId: 'tgw_test' });
ok(d.allowed === true && d.preview === true, 'editor preview from id.travelify.io is exempt from the offers limit');

// Same via Referer only (id domain strips the path to the bare origin).
d = await evaluatePublicRateLimit(
  mkReq({ 'x-tg-preview': '1', referer: 'https://widgets.travelify.io/editor-offers' }),
  res, { event: 'offers', widgetId: 'tgw_test' });
ok(d.allowed === true && d.preview === true, 'preview recognised from a widgets.travelify.io Referer too');

// Vercel preview deploys and localhost dev are trusted origins as well.
for (const origin of ['https://tg-widgets.vercel.app', 'http://localhost:5173']) {
  d = await evaluatePublicRateLimit(
    mkReq({ 'x-tg-preview': '1', origin }),
    res, { event: 'offers', widgetId: 'tgw_test' });
  ok(d.allowed === true && d.preview === true, `preview trusted from ${origin}`);
}

// 2. The header from an UNTRUSTED origin must NOT exempt (not forgeable off-platform).
d = await evaluatePublicRateLimit(
  mkReq({ 'x-tg-preview': '1', origin: 'https://evil.example.com' }),
  res, { event: 'offers', widgetId: 'tgw_test' });
ok(d.allowed === true && !d.preview && d.failOpen === true, 'X-TG-Preview from an untrusted origin is NOT exempt (took the counting path)');

// A near-miss host that merely contains our domain as a substring is untrusted.
d = await evaluatePublicRateLimit(
  mkReq({ 'x-tg-preview': '1', origin: 'https://travelify.io.evil.com' }),
  res, { event: 'offers', widgetId: 'tgw_test' });
ok(d.allowed === true && !d.preview, 'a look-alike host (travelify.io.evil.com) is not treated as ours');

// 3. Ordinary visitor traffic (no header) still goes through the limiter.
d = await evaluatePublicRateLimit(
  mkReq({ origin: 'https://www.travelhubworld.com' }),
  res, { event: 'offers', widgetId: 'tgw_test' });
ok(d.allowed === true && !d.preview && d.failOpen === true, 'a real visitor on the client site still goes through the limiter');

// 4. A write path (popup-lead) is NEVER exempted, even with a valid preview signature.
d = await evaluatePublicRateLimit(
  mkReq({ 'x-tg-preview': '1', origin: 'https://id.travelify.io' }),
  res, { event: 'popup-lead', widgetId: 'tgw_test' });
ok(d.allowed === true && !d.preview, 'popup-lead (a write) is never relaxed by the preview signal');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
