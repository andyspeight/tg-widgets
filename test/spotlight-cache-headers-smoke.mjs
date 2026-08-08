/**
 * Spotlight family speed — Step 1: strong edge caching on the content APIs.
 *
 * The public (visitor) answer from /api/destination-content should now carry a
 * long-lived edge cache (fresh 1h, then stale-served for a week while it
 * revalidates), so a low-traffic client site never makes a visitor wait for the
 * Airtable waterfall. The auth-gated editor preview must stay live (no-store).
 *
 * This drives the real handler with a stubbed Airtable and checks the header on
 * the public path, plus source guards for the preview path (which needs auth we
 * don't mock here).
 *
 * Run: node test/spotlight-cache-headers-smoke.mjs  (also: npm run test:spotlight-cache)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

// ── Environment + Airtable stub, set before the handler runs ──────────────
process.env.AIRTABLE_KEY = 'key_test';
process.env.AIRTABLE_BASE_ID = 'appWidgetsTest';
process.env.AIRTABLE_DESTINATION_CONTENT_PAT = 'pat_test';

const REC = 'recABCDEFGHIJKLMN'; // rec + 14 chars
// A country destination keeps the server work minimal (no parent to inherit,
// no paired lookups), so we only need two canned Airtable responses.
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.indexOf('/appWidgetsTest/Widgets') !== -1) {
    const config = JSON.stringify({ destination: { level: 'country', recordId: REC } });
    return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recW', fields: { Config: config } }] }) };
  }
  // Destination Content base (any table): return a minimal country record.
  if (u.indexOf('/appuZdlMJ7HKUt6qS/') !== -1) {
    return { ok: true, status: 200, json: async () => ({ records: [{ id: REC, fields: { flddJJrpwcXOwWIow: 'Greece' } }] }) };
  }
  return { ok: true, status: 200, json: async () => ({ records: [] }) };
};

function makeRes() {
  const headers = {};
  const res = {
    statusCode: 0,
    body: null,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; }
  };
  res._headers = headers;
  return res;
}

const { default: handler } = await import('../api/destination-content.js');

console.log('Public path carries the long edge cache');
{
  const res = makeRes();
  await handler({ method: 'GET', query: { id: 'w_test' }, headers: { 'x-forwarded-for': '203.0.113.7' } }, res);
  const cc = res.getHeader('cache-control') || '';
  ok('responds 200', res.statusCode === 200);
  ok('is public + edge-cached (s-maxage=3600)', /s-maxage=3600/.test(cc));
  ok('serves stale for a week (stale-while-revalidate=604800)', /stale-while-revalidate=604800/.test(cc));
  ok('keeps a short browser cache (max-age=300)', /(^|[ ,])max-age=300/.test(cc));
  ok('is not the old short 1h SWR', cc.indexOf('stale-while-revalidate=3600') === -1);
}

// ── Source guards for the editor-preview path (auth-gated; not mocked here) ──
console.log('Editor preview stays live, and no short public cache remains');
{
  const SRC = readFileSync(join(ROOT, 'api', 'destination-content.js'), 'utf8');
  ok('PREVIEW_CACHE is no-store', /const PREVIEW_CACHE = 'private, no-store'/.test(SRC));
  ok('PUBLIC_CACHE has the long SWR', /const PUBLIC_CACHE = '[^']*stale-while-revalidate=604800'/.test(SRC));
  ok('shared record path guards preview', SRC.indexOf('isDirect ? PREVIEW_CACHE : PUBLIC_CACHE') !== -1);
  ok('no leftover 5-min/1h public cache literals', SRC.indexOf("max-age=300, stale-while-revalidate=3600") === -1);
}

// ── The rest of the family: airport, attraction, events ──────────────────
console.log('Airport / attraction / events: public path long-cached, preview short');
{
  const read = (f) => readFileSync(join(ROOT, 'api', f), 'utf8');
  const LONG = /const PUBLIC_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=604800'/;

  const airport = read('airport-content.js');
  ok('airport defines the long public cache', LONG.test(airport));
  ok('airport applies it on the live widget path', /res\.setHeader\('Cache-Control', PUBLIC_CACHE\)/.test(airport));
  ok('airport keeps the iata/recordId preview short', /const PREVIEW_CACHE = 'public, s-maxage=300, stale-while-revalidate=1800'/.test(airport));

  const attraction = read('attraction-content.js');
  ok('attraction defines the long public cache', LONG.test(attraction));
  ok('attraction picks by mode (recordId => preview)', attraction.indexOf('directRecord ? PREVIEW_CACHE : PUBLIC_CACHE') !== -1);
  ok('attraction no longer hard-codes the short public cache', attraction.indexOf("res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')") === -1);

  const events = read('events-content.js');
  ok('events defines the long public cache', LONG.test(events));
  ok('events picks by mode (preview flag)', events.indexOf('isPreview ? PREVIEW_CACHE : PUBLIC_CACHE') !== -1);
  ok('events no longer hard-codes the short public cache', events.indexOf("res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')") === -1);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
