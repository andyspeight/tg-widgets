/**
 * World Map — Hotels mode backend.
 *
 * The three World Map endpoints learn a ?mode=hotels switch: the summary serves
 * the hotel country pins the cron builds (map:hotels:v1), resorts serve the
 * hotel resort summary (map:hotels-resorts:{CC}), and deals read the
 * accommodation cache (offers:extra:{CC}), keep only Accommodation offers and
 * apply the hotel filters (board, star rating, budget, nights) — never the
 * flight-only ones (direct, supplier). Default (no mode) is unchanged holidays.
 *
 * Drives the real handlers with a stubbed Redis (fetch to Upstash intercepted).
 *
 * Run: node test/worldmap-hotels-mode-smoke.mjs  (also: npm run test:worldmap-hotels)
 */
let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

// ── Canned Redis, keyed exactly as the cron writes ────────────────────────
const DB = {
  'map:offers:v1': { version: 1, currency: 'GBP', countries: [{ countryCode: 'GR', fromPrice: 410, fromPricePP: 205, offerCount: 12 }], airports: [{ airport: 'ATH', countryCode: 'GR' }] },
  'map:hotels:v1': { version: 1, currency: 'GBP', countries: [{ countryCode: 'GR', fromPrice: 260, fromPricePP: 130, offerCount: 7 }], airports: [] },
  'map:hotels-resorts:GR': { resorts: [{ resort: 'Rhodes', lat: 36.4, lng: 28.2, fromPrice: 260, fromPricePP: 130, offerCount: 4 }] },
  'offers:extra:GR': { offers: [
    { id: 'h1', type: 'Accommodation', hotel: 'Blue Bay', resort: 'Rhodes', resortLat: 36.4, resortLng: 28.2, price: 520, pricePP: 260, currency: 'GBP', rating: 4, boardBasis: 'All inclusive', nights: 7 },
    { id: 'h2', type: 'Accommodation', hotel: 'Sun Villas', resort: 'Crete', resortLat: 35.3, resortLng: 25.1, price: 900, pricePP: 450, currency: 'GBP', rating: 5, boardBasis: 'Bed & breakfast', nights: 10 },
    { id: 'h3', type: 'Accommodation', hotel: 'Budget Inn', resort: 'Rhodes', resortLat: 36.4, resortLng: 28.2, price: 300, pricePP: 150, currency: 'GBP', rating: 3, boardBasis: 'Room only', nights: 7 },
    { id: 'f1', type: 'Flights', price: 120, pricePP: 120, currency: 'GBP', nights: 0 },
  ] },
  'offers:packages:GR': { offers: [
    { id: 'p1', type: 'Packages', hotel: 'Pkg Resort', airport: 'ATH', resort: 'Rhodes', price: 410, pricePP: 205, currency: 'GBP', rating: 4, boardBasis: 'Half board', nights: 7, direct: true },
  ] },
};

process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';

globalThis.fetch = async (url) => {
  const u = String(url);
  // Upstash REST GET: <URL>/get/<encoded key>
  const m = u.match(/\/get\/(.+)$/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    const val = Object.prototype.hasOwnProperty.call(DB, key) ? JSON.stringify(DB[key]) : null;
    return { ok: true, status: 200, json: async () => ({ result: val }) };
  }
  return { ok: true, status: 200, json: async () => ({ result: null }) };
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

const offersHandler = (await import('../api/destination-map-offers.js')).default;
const resortsHandler = (await import('../api/destination-map-resorts.js')).default;
const dealsHandler = (await import('../api/destination-map-deals.js')).default;

console.log('Summary endpoint: mode switches the source');
{
  const rHol = makeRes();
  await offersHandler({ method: 'GET', query: {} }, rHol);
  ok('holidays serves the package summary', rHol.body && rHol.body.countries[0] && rHol.body.countries[0].fromPricePP === 205);

  const rHot = makeRes();
  await offersHandler({ method: 'GET', query: { mode: 'hotels' } }, rHot);
  ok('hotels serves the hotel summary', rHot.body && rHot.body.countries[0] && rHot.body.countries[0].fromPricePP === 130);
  ok('hotels summary has no airport tier', rHot.body && Array.isArray(rHot.body.airports) && rHot.body.airports.length === 0);
}

console.log('Summary endpoint: empty hotel cache is the calm empty, not a seed');
{
  // Point the hotel key at nothing by asking for a mode with no data.
  const saved = DB['map:hotels:v1'];
  delete DB['map:hotels:v1'];
  const r = makeRes();
  await offersHandler({ method: 'GET', query: { mode: 'hotels' } }, r);
  ok('empty hotels → source empty', r.body && r.body.source === 'empty');
  ok('empty hotels → no package seed leaked in', r.body && r.body.countries.length === 0 && !r.body.destinations);
  DB['map:hotels:v1'] = saved;
}

console.log('Resorts endpoint: hotels reads the hotel resort summary');
{
  const r = makeRes();
  await resortsHandler({ method: 'GET', query: { country: 'GR', mode: 'hotels' } }, r);
  ok('serves hotel resorts', r.body && r.body.ok && r.body.resorts[0] && r.body.resorts[0].resort === 'Rhodes');
}

console.log('Deals endpoint: hotels reads accommodation and applies hotel filters');
{
  const rAll = makeRes();
  await dealsHandler({ method: 'GET', query: { country: 'GR', mode: 'hotels' } }, rAll);
  ok('only Accommodation offers (flight excluded)', rAll.body && rAll.body.offers.length === 3 && rAll.body.offers.every(o => o.type === 'Accommodation'));
  ok('exposes a nights facet', rAll.body && Array.isArray(rAll.body.nightsOptions) && rAll.body.nightsOptions.join(',') === '7,10');
  ok('exposes board facet', rAll.body && rAll.body.boardBases.length === 3);

  const rBudget = makeRes();
  await dealsHandler({ method: 'GET', query: { country: 'GR', mode: 'hotels', maxPrice: '200' } }, rBudget);
  ok('budget filter (pricePP<=200 keeps only h3)', rBudget.body && rBudget.body.offers.every(o => o.pricePP <= 200) && rBudget.body.offers.length === 1 && rBudget.body.offers[0].id === 'h3');

  const rRating = makeRes();
  await dealsHandler({ method: 'GET', query: { country: 'GR', mode: 'hotels', minRating: '5' } }, rRating);
  ok('star-rating filter (5★)', rRating.body && rRating.body.offers.length === 1 && rRating.body.offers[0].id === 'h2');

  const rBoard = makeRes();
  await dealsHandler({ method: 'GET', query: { country: 'GR', mode: 'hotels', board: 'All inclusive' } }, rBoard);
  ok('board filter', rBoard.body && rBoard.body.offers.length === 1 && rBoard.body.offers[0].id === 'h1');

  const rNights = makeRes();
  await dealsHandler({ method: 'GET', query: { country: 'GR', mode: 'hotels', nights: '10' } }, rNights);
  ok('nights filter', rNights.body && rNights.body.offers.length === 1 && rNights.body.offers[0].nights === 10);

  // Package-only filters must not affect hotels: a supplier list should be ignored.
  const rSup = makeRes();
  await dealsHandler({ method: 'GET', query: { country: 'GR', mode: 'hotels', pkgSuppliers: '999' } }, rSup);
  ok('supplier whitelist is ignored in hotels mode', rSup.body && rSup.body.offers.length === 3);
}

console.log('Deals endpoint: default (holidays) is unchanged');
{
  const r = makeRes();
  await dealsHandler({ method: 'GET', query: { country: 'GR' } }, r);
  ok('holidays still serves packages only', r.body && r.body.offers.length === 1 && r.body.offers[0].type === 'Packages');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
