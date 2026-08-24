/**
 * Reviews feed — Google source via Wextractor (Aug 2026).
 *
 * Andy: the Reviews widget had no way to link to a Google business and pull its
 * reviews in. We now do it server-side through Wextractor (a BILLED provider),
 * so two things must hold and are worth locking down:
 *   1. The parser maps Wextractor's real Google shape onto the widget's card
 *      shape (reviewer→author, datetime→date, totals→overall rating/count) and
 *      drops rating-only / empty entries. Owner replies arrive as an object OR
 *      a bare string — both normalise to text.
 *   2. Cost safety: a missing platform key fails clean at 503 WITHOUT spending a
 *      call, and the source is wired for the persistent-cache / stale-on-error
 *      path (asserted against the source text — the live cache needs Redis).
 *
 * No network and no Wextractor credits are used: the parser is a pure function
 * and the 503 path short-circuits before any fetch.
 *
 * Run: node test/reviews-google-smoke.mjs   (npm run test:reviews-google)
 */
import { readFileSync } from 'node:fs';

// Make the "not configured" path deterministic regardless of the environment.
delete process.env.WEXTRACTOR_API_KEY;

import handler, { _test } from '../api/reviews-feed.js';

const SRC = readFileSync(new URL('../api/reviews-feed.js', import.meta.url), 'utf8');
const { SOURCES } = _test;

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

function mockRes() {
  const headers = {};
  return {
    statusCode: 200, body: undefined, headers,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(n) { this.statusCode = n; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; },
  };
}

// ─── A realistic Wextractor Google response ──────────────────────────────────
const PLACE = 'ChIJ58OtM8pZwokRbd6DT6gcVys';
const SAMPLE = {
  totals: { review_count: 1234, average_rating: 4.7 },
  place: { name: 'Sunshine Travel', address: '1 High St' },
  reviews: [
    { id: 'g1', reviewer: 'Jane Smith', reviewer_avatar: 'https://x/a.jpg', rating: 5, text: 'Booked our honeymoon, faultless service from start to finish.', datetime: '2026-07-03T11:32:00Z', likes: 2, reply: { text: 'Thank you Jane, safe travels!', datetime: '2026-07-04T09:00:00Z' } },
    { id: 'g2', reviewer: 'Tom Brown', rating: 4, text: 'Good value, would use again.', datetime: '2026-06-15T08:00:00Z' },
    { id: 'g3', reviewer: 'No Text', rating: 5, text: '', datetime: '2026-06-01T08:00:00Z' },     // dropped — no testimonial
    { id: 'g4', reviewer: 'Zero', rating: 0, text: 'weird', datetime: '2026-05-01T08:00:00Z' },  // dropped — no rating
    { id: 'g5', reviewer: 'Amy', rating: 5, text: 'Lovely team.', datetime: '2026-05-20T08:00:00Z', owner_reply: 'Cheers Amy' }, // reply as a bare string
  ],
};

console.log('The Google parser maps Wextractor onto the widget card shape');
{
  const parsed = SOURCES.google.parse(SAMPLE, PLACE);
  ok('rating-only and empty reviews are dropped (3 of 5 kept)', parsed.reviews.length === 3);

  const r0 = parsed.reviews[0];
  ok('reviewer maps to author', r0.author === 'Jane Smith');
  ok('rating carries through', r0.rating === 5);
  ok('text carries through', /faultless service/.test(r0.text));
  ok('datetime (ISO 8601) becomes a YYYY-MM-DD date', r0.date === '2026-07-03');
  ok('every card is tagged source:google', parsed.reviews.every(r => r.source === 'google'));
  ok('an owner reply object normalises to its text', r0.reply === 'Thank you Jane, safe travels!');

  const amy = parsed.reviews.find(r => r.author === 'Amy');
  ok('an owner reply given as a bare string also normalises', amy && amy.reply === 'Cheers Amy');

  ok('the overall average comes from totals.average_rating', parsed.rating.average === 4.7);
  ok('the overall count comes from totals.review_count (not the page size)', parsed.rating.count === 1234);
  ok('the business name comes from place.name', parsed.business.name === 'Sunshine Travel');
}

console.log('The Google identifier validator is strict but accepts real place ids');
{
  const v = SOURCES.google.valid;
  ok('accepts a ChIJ… place id', v('ChIJ58OtM8pZwokRbd6DT6gcVys'));
  ok('accepts a hex data id (0x…:0x…)', v('0x808fba02425bbf9f:0x123abc'));
  ok('rejects empty', !v(''));
  ok('rejects a value with spaces', !v('has space in it'));
  ok('rejects a too-short value', !v('abc'));
  ok('rejects an over-long value', !v('C'.repeat(400)));
}

console.log('Google is wired for cost safety (billed source)');
{
  ok('the source is flagged costly (routes through the Redis cache)', /google:\s*\{[\s\S]*?costly:\s*true/.test(SRC));
  ok('the source requires the WEXTRACTOR_API_KEY env var', /requiresKey:\s*'WEXTRACTOR_API_KEY'/.test(SRC));
  ok('wextractor.com is allow-listed as an upstream host', /ALLOWED_UPSTREAM_HOSTS[\s\S]*wextractor\.com/.test(SRC));
  ok('costly fetch keeps the last good copy under revcache:', /revcache:/.test(SRC));
  ok('a single-flight lock (revlock:) guards the refresh', /revlock:/.test(SRC));
  ok('a stale copy is served when the upstream errors', /keep serving whatever we last stored/.test(SRC));
  ok('the refresh window is env-tunable (WEXTRACTOR_REVIEWS_TTL_HOURS)', /WEXTRACTOR_REVIEWS_TTL_HOURS/.test(SRC));
}

console.log('A missing key fails clean at 503 with no billed call');
{
  const res = mockRes();
  await handler({ method: 'GET', headers: { origin: 'https://widgets.travelify.io' }, query: { source: 'google', id: PLACE }, socket: {} }, res);
  ok('returns 503 (not configured) rather than calling Wextractor', res.statusCode === 503);
  ok('the body is a clean { ok:false, error }', res.body && res.body.ok === false && typeof res.body.error === 'string');
  ok('CORS is still echoed for the widget origin', res.headers['access-control-allow-origin'] === 'https://widgets.travelify.io');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
