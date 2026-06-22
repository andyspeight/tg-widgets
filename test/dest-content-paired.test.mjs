/**
 * "Pairs well with" resolution test for /api/destination-content.
 *
 * Runs the real handler with a stubbed fetch that returns linked records by ID,
 * proving resolvePaired turns the Best Paired With links into a list of sibling
 * destinations with names and /destinations/<plural>/<slug> URLs, in order.
 *
 * Run: node test/dest-content-paired.test.mjs
 */
process.env.AIRTABLE_KEY = 'key_test';
process.env.AIRTABLE_BASE_ID = 'appWIDGETSXXXXXXX';
process.env.AIRTABLE_DESTINATION_CONTENT_PAT = 'pat_test';

const GREECE_ID = 'recGREECE00000001';
const TURKEY_ID = 'recTURKEY00000001';
const CYPRUS_ID = 'recCYPRUS00000001';

// Country field IDs from LEVEL_MAP.country.fields
const F = { name: 'flddJJrpwcXOwWIow', slug: 'fldDwZVR1C63K4HGT', bestPaired: 'fldgP3ncmDU6LNOS4' };

const canned = {
  [GREECE_ID]: { [F.name]: 'Greece', [F.slug]: 'greece', [F.bestPaired]: [TURKEY_ID, CYPRUS_ID] },
  [TURKEY_ID]: { [F.name]: 'Turkey', [F.slug]: 'turkey' },
  [CYPRUS_ID]: { [F.name]: 'Cyprus', [F.slug]: 'cyprus' },
};

function jsonResp(obj) { return { ok: true, status: 200, json: async () => obj }; }

global.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  if (/\/Widgets/.test(u)) {
    return jsonResp({ records: [{ id: 'recWIDGET00000001', fields: { Config: JSON.stringify({ destination: { level: 'country', recordId: GREECE_ID } }) } }] });
  }
  if (u.includes('tblsxbqbyhTDoWhbo')) { // Countries table (main fetch + paired OR-fetch)
    const ids = (u.match(/rec[A-Za-z0-9]{14}/g) || []).filter((v, i, a) => a.indexOf(v) === i);
    const recs = ids.filter(id => canned[id]).map(id => ({ id, fields: canned[id] }));
    return jsonResp({ records: recs });
  }
  throw new Error('Unexpected fetch URL in test: ' + u);
};

function makeRes() {
  return {
    _status: 200, _json: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    end() { return this; },
  };
}
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { console.log('  ok  ' + msg); }
}

const handler = (await import('../api/destination-content.js')).default;

const req = { method: 'GET', query: { id: 'tgs_test' }, headers: { 'x-forwarded-for': '203.0.113.9' }, socket: { remoteAddress: '203.0.113.9' } };
const res = makeRes();
await handler(req, res);

const p = res._json || {};
console.log('HTTP', res._status);
console.log('pairedWith:', JSON.stringify(p.pairedWith));

assert(res._status === 200, 'responds 200');
assert(Array.isArray(p.pairedWith) && p.pairedWith.length === 2, 'two pairs resolved');
assert(p.pairedWith[0].name === 'Turkey' && p.pairedWith[1].name === 'Cyprus', 'order preserved (Turkey, Cyprus)');
assert(p.pairedWith[0].url === '/destinations/countries/turkey', 'url is /destinations/<plural>/<slug>');
assert(p.pairedWith[1].slug === 'cyprus', 'slug carried through');

console.log(process.exitCode ? '\nRESULT: FAILURES' : '\nRESULT: ALL PASS');
