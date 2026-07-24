/**
 * Outside calls stay time-bounded (23 Jul 2026 audit, Stage 1 finding #1/#3/#4).
 *
 * The dominant reliability weakness across the suite was calls to Airtable, the
 * AI model and Redis with no timeout: under upstream slowness the function ran to
 * its ceiling and returned an empty gateway body, which surfaced to clients as
 * "Failed to fetch". This guard asserts every such call carries a timeout so the
 * class cannot quietly regress. It is a source scan, not a runtime test.
 *
 * Run: node test/timeout-guards-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

// Every fetch() in these endpoints must be timeout-bounded (signal within its
// options object). A window of 400 chars covers both inline and multiline calls.
const STRICT_FILES = [
  'api/widget-config.js', 'api/destination-map.js', 'api/destination-content.js',
  'api/airport-content.js', 'api/attraction-content.js', 'api/events-content.js',
  'api/attraction-search.js', 'api/airport-search.js', 'api/destination-search.js',
  'api/offer-draft.js', 'api/faq-translate.js', 'api/enquiry-translate.js',
];
for (const f of STRICT_FILES) {
  const src = read(f);
  const re = /[^A-Za-z.]fetch\(/g;
  let m, total = 0, unguarded = 0;
  while ((m = re.exec(src))) {
    total++;
    if (!/signal\s*:/.test(src.slice(m.index, m.index + 400))) unguarded++;
  }
  ok(total > 0 && unguarded === 0, `${f}: all ${total} outside call(s) timeout-guarded (${unguarded} unguarded)`);
}

// Redis WRITE helpers share the write timeout, matching lpushCapped.
const redis = read('api/_redis.js');
for (const fn of ['setJson', 'setString', 'setNxEx']) {
  const start = redis.indexOf('function ' + fn);
  const body = start >= 0 ? redis.slice(start, start + 900) : '';
  ok(/signal:\s*AbortSignal\.timeout\(REDIS_WRITE_TIMEOUT_MS\)/.test(body), `_redis ${fn} bounded by REDIS_WRITE_TIMEOUT_MS`);
}

// The enquiry submit routing-summary PATCH (awaited before the visitor's
// confirmation) is bounded so a hung Airtable cannot stall the response.
const submit = read('api/enquiry/submit.js');
ok(/routingStatusJSON[\s\S]{0,120}signal:\s*AbortSignal\.timeout/.test(submit),
  'enquiry submit routing-summary PATCH is timeout-bounded');

// The three content widgets guard their fetch with a 9s AbortController so a
// hung upstream reaches the error state instead of an eternal loading skeleton.
for (const f of ['public/widget-attraction.js', 'public/widget-airport.js', 'public/widget-spotlight.js']) {
  const src = read(f);
  ok(/ctrl\.abort\(\), 9000/.test(src) && /signal: ctrl\.signal/.test(src),
    `${f}: content fetch has a 9s abort guard`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
