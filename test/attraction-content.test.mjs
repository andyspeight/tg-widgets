/**
 * Stub-fetch test for /api/attraction-content (recordId mode).
 * Confirms the handler shapes the Theme Parks record into the public payload,
 * including selects, checkboxes, coords and the url allowlist.
 *
 * Run: node test/attraction-content.test.mjs
 */
process.env.AIRTABLE_KEY = 'key_test';
process.env.AIRTABLE_BASE_ID = 'appWIDGETSXXXXXXX';
process.env.AIRTABLE_DESTINATION_CONTENT_PAT = 'pat_test';

const REC = 'recEUROPA00000001';
// Field IDs mirror the AF catalogue in api/attraction-content.js
const fields = {
  fldboK0kstNohXgqJ: 'Europa-Park',
  fld1UMHOpugpUm865: 'Resort Complex',
  flduUYklGYPVCvvfV: { name: 'Europa-Park' },          // object form tolerated
  fldYpnpQzBV01Ogoa: "The world's best theme park",
  fldyoIhTvHu2NI3gn: 'Rust, Baden-Württemberg',
  fldlx9YGIZQ797rem: 'Germany',
  fldcffvJT5D2DhJwT: 'Mid (£100-£200)',
  flds4rCmkrt4FXl5j: '2-4 days',
  fld2RxBaZGkt9yfa8: ['Families', 'Thrill-seekers', 'First-timers'],
  fld9SSaWcif4a9Id6: true,
  fldB36rcwri2ITwFV: undefined,
  fldojtl6BCSVGJka0: 'Silver Star, Blue Fire and the wooden coaster Wodan.',
  fldOM08zdOuuOpjBX: 'Basel (BSL) 50 minutes by car.',
  fldxmLHlNM0GYndlb: 48.266,
  fldywVEVFPKDZgXWn: 7.722,
  fldaYcpCsTaJO5tqe: 'https://www.europapark.de',
  fld3srQgBZZYtx1LJ: '2026-05-11',
};

global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('tblhVDUdpwaLabDmQ')) return { ok: true, status: 200, json: async () => ({ records: [{ id: REC, fields }] }) };
  throw new Error('Unexpected fetch URL: ' + u);
};

function makeRes() {
  return { _status: 200, _json: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; }, end() { return this; } };
}
function assert(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { console.log('  ok  ' + msg); } }

const handler = (await import('../api/attraction-content.js')).default;
const res = makeRes();
await handler({ method: 'GET', query: { recordId: REC }, headers: { 'x-forwarded-for': '203.0.113.5' }, socket: {} }, res);

const a = (res._json && res._json.attraction) || {};
console.log('HTTP', res._status, JSON.stringify({ name: a.name, priceBand: a.priceBand, bestFor: a.bestFor, hasOnSiteHotels: a.hasOnSiteHotels }));

assert(res._status === 200 && res._json.found === true, 'responds 200 found:true');
assert(a.name === 'Europa-Park', 'name shaped');
assert(a.type === 'Resort Complex', 'singleSelect type shaped');
assert(a.operator === 'Europa-Park', 'object-form select normalised to name');
assert(a.priceBand === 'Mid (£100-£200)', 'price band shaped');
assert(Array.isArray(a.bestFor) && a.bestFor.includes('Thrill-seekers'), 'multipleSelects shaped to array');
assert(a.hasOnSiteHotels === true, 'checkbox true');
assert(a.dogFriendly === false, 'missing checkbox is false');
assert(a.lat === 48.266 && a.lng === 7.722, 'coords shaped as numbers');
assert(a.officialWebsite === 'https://www.europapark.de', 'https url allowed');
assert(a.starAttractions.includes('Blue Fire'), 'prose field shaped');

// not found (use a different, uncached id)
const res2 = makeRes();
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ records: [] }) });
await handler({ method: 'GET', query: { recordId: 'recMISSING0000001' }, headers: {}, socket: {} }, res2);
assert(res2._status === 404 && res2._json.found === false, 'missing record -> 404 found:false');

// bad id
const res3 = makeRes();
await handler({ method: 'GET', query: { recordId: 'not-a-rec' }, headers: {}, socket: {} }, res3);
assert(res3._status === 400, 'invalid recordId -> 400');

console.log(process.exitCode ? '\nRESULT: FAILURES' : '\nRESULT: ALL PASS');
