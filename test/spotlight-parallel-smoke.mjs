/**
 * Spotlight family speed — Step 2: parallelise the independent Airtable calls.
 *
 * On a cache miss, destination-content resolves the record, then looks up the
 * inherited country facts AND the paired destinations. Those two are independent
 * and now run together (Promise.all) instead of one after the other.
 *
 * This drives the real handler with a fetch stub that (a) counts how many
 * requests are in flight at once and (b) returns canned Airtable data, then
 * asserts the two lookups overlapped and the payload is still correct.
 *
 * Run: node test/spotlight-parallel-smoke.mjs  (also: npm run test:spotlight-parallel)
 */
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

process.env.AIRTABLE_KEY = 'key_test';
process.env.AIRTABLE_BASE_ID = 'appWidgetsTest';
process.env.AIRTABLE_DESTINATION_CONTENT_PAT = 'pat_test';

// A resort with blank facts (forces the inherit lookup to the parent city) and
// a Best-Paired link (forces the paired lookup). Field IDs match LEVEL_MAP.
const RESORT = 'recRESORT00000001';   // rec + 14
const CITY   = 'recCITY0000000001';
const PAIR   = 'recPAIR0000000001';
const F = {
  resortName: 'fldnvOipaWpG3W1rx', resortParent: 'fldrUx3VrEMJPheIP', resortPaired: 'fldQflINufhsgS6so',
  resortSlug: 'fldwVxLg8V4CBi90B',
  cityCurrency: 'fldyVpNjyezPfVeRM',
  cityTable: 'tblTkKujdVZgWPAQe', resortTable: 'tblwV9gnbVEyZ99gI',
};

let inFlight = 0, maxInFlight = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.fetch = async (url) => {
  const u = String(url);
  inFlight++; if (inFlight > maxInFlight) maxInFlight = inFlight;
  try {
    await wait(30);
    if (u.indexOf('/appWidgetsTest/Widgets') !== -1) {
      const cfg = JSON.stringify({ destination: { level: 'resort', recordId: RESORT } });
      return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recW', fields: { Config: cfg } }] }) };
    }
    // Paired lookup (Best Paired With → resort table, OR() over the pair ids).
    if (u.indexOf(PAIR) !== -1) {
      return { ok: true, status: 200, json: async () => ({ records: [{ id: PAIR, fields: { [F.resortName]: 'Vilamoura', [F.resortSlug]: 'vilamoura' } }] }) };
    }
    // Parent city record (inherit fills the blank currency fact).
    if (u.indexOf(F.cityTable) !== -1) {
      return { ok: true, status: 200, json: async () => ({ records: [{ id: CITY, fields: { [F.cityCurrency]: 'EUR' } }] }) };
    }
    // The initial resort record: blank facts, a parent link and a paired link.
    if (u.indexOf(F.resortTable) !== -1) {
      return { ok: true, status: 200, json: async () => ({ records: [{ id: RESORT, fields: { [F.resortName]: 'Albufeira', [F.resortParent]: [CITY], [F.resortPaired]: [PAIR] } }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ records: [] }) };
  } finally {
    inFlight--;
  }
};

function makeRes() {
  const headers = {};
  return {
    statusCode: 0, body: null,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

const { default: handler } = await import('../api/destination-content.js');

console.log('The inherit and paired lookups run in parallel');
{
  const res = makeRes();
  await handler({ method: 'GET', query: { id: 'w_resort' }, headers: { 'x-forwarded-for': '203.0.113.9' } }, res);
  ok('responds 200', res.statusCode === 200);
  ok('two Airtable calls overlapped (maxInFlight >= 2)', maxInFlight >= 2);
  ok('inherited fact still resolved from the parent city', res.body && res.body.facts && res.body.facts.currency === 'EUR');
  ok('inheritance source recorded as city', res.body && res.body.factsInherited && res.body.factsInherited.currency === 'city');
  ok('paired destination still resolved', res.body && Array.isArray(res.body.pairedWith) && res.body.pairedWith.some((p) => p.name === 'Vilamoura'));
  ok('still carries the long edge cache', /stale-while-revalidate=604800/.test(res.getHeader('cache-control') || ''));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
