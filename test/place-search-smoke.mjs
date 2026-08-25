/**
 * Place search — Google business lookup for the Reviews editor (Aug 2026).
 *
 * The Reviews editor lets a client type their business name and pick from a
 * dropdown instead of hunting for a Google Place ID. Wextractor can't search by
 * name, so /api/place-search proxies Google Places Text Search (New) with our
 * key. Two things matter and are locked down here:
 *   1. The parser maps the Text Search (New) shape onto our small result shape
 *      (id→placeId, displayName.text→name, formattedAddress, rating, count),
 *      caps the list, and drops entries missing an id or name.
 *   2. Cost / setup safety: a missing key fails clean at 503 with no call, and a
 *      too-short query is rejected at 400 before any call.
 *
 * No network, no Google credits: the parser is pure and the guard paths
 * short-circuit before any fetch.
 *
 * Run: node test/place-search-smoke.mjs   (npm run test:place-search)
 */
delete process.env.GOOGLE_PLACES_API_KEY; // make the "not set up" path deterministic

import handler, { _test } from '../api/place-search.js';

const { parsePlaces } = _test;

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

console.log('The parser maps Google Places Text Search (New) onto our result shape');
{
  const sample = {
    places: [
      { id: 'ChIJa', displayName: { text: 'Sunshine Travel', languageCode: 'en' }, formattedAddress: '1 High St, London', rating: 4.7, userRatingCount: 1234 },
      { id: 'ChIJb', displayName: { text: 'Sunshine Travel Brighton' }, formattedAddress: '2 Sea Rd, Brighton', rating: 4.5, userRatingCount: 88 },
      { displayName: { text: 'No ID here' }, formattedAddress: 'nowhere' }, // dropped — no id
      { id: 'ChIJc' }, // dropped — no name
    ],
  };
  const out = parsePlaces(sample);
  ok('entries without an id or name are dropped (2 of 4 kept)', out.length === 2);
  ok('id maps to placeId', out[0].placeId === 'ChIJa');
  ok('displayName.text maps to name', out[0].name === 'Sunshine Travel');
  ok('formattedAddress carries through', out[0].address === '1 High St, London');
  ok('rating and count carry through', out[0].rating === 4.7 && out[0].total === 1234);
}

console.log('The list is capped');
{
  const many = { places: Array.from({ length: 10 }, (_, i) => ({ id: 'ChIJ' + i, displayName: { text: 'Branch ' + i }, formattedAddress: 'Road ' + i })) };
  ok('at most 6 results are returned', parsePlaces(many).length === 6);
}

console.log('A missing key fails clean at 503 with no billed call');
{
  const res = mockRes();
  await handler({ method: 'GET', headers: { origin: 'https://widgets.travelify.io' }, query: { q: 'sunshine travel' }, socket: {} }, res);
  ok('returns 503 (not set up) rather than calling Google', res.statusCode === 503);
  ok('the body is a clean { ok:false, error }', res.body && res.body.ok === false && typeof res.body.error === 'string');
  ok('CORS is echoed for the editor origin', res.headers['access-control-allow-origin'] === 'https://widgets.travelify.io');
}

console.log('A too-short query is rejected before any call');
{
  const res = mockRes();
  await handler({ method: 'GET', headers: {}, query: { q: 'ab' }, socket: {} }, res);
  ok('a 2-character query returns 400', res.statusCode === 400);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
