/**
 * Quote shape inspector — the staff tool that shows what a Travelify quote
 * actually carries (8 Sep 2026).
 *
 * Built because the Quote PDF's Location card reads field names that were
 * never confirmed against a live quote, and no fixture, record or mailbox
 * held one. The inspector returns a SHAPE report: keys, types, location
 * items in full, and every weather-looking key with its path. It must never
 * return a price or a customer's details.
 *
 * Drives the REAL link parser and the REAL report builder on synthetic quotes
 * in all three shapes, then guards the handler's gate.
 *
 * Run: node test/quote-shape-smoke.mjs   (npm run test:quote-shape)
 */
import { readFileSync } from 'node:fs';
process.env.SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || 'SG.test';
process.env.SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@travelify.io';

const { parseQuoteRef, buildQuoteShapeReport } = await import('../api/admin/quote-shape.js');
const SRC = readFileSync(new URL('../api/admin/quote-shape.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('The link parser accepts both viewer address forms');
{
  const a = parseQuoteRef('https://www.traveldemo.site/quick-quote?key=2F0752A0-2AF4-46B4-922C-5B490DE7FEA3&id=17820');
  ok('?id=&key= form', a && a.quoteId === '17820' && a.key === '2F0752A0-2AF4-46B4-922C-5B490DE7FEA3');
  const b = parseQuoteRef('https://www.justsardinia.co.uk/quote-viewer#quoteid=20418/C55B523B-75F2-4C54-BE21-D3F80A084CC5');
  ok('#quoteid=ID/KEY form', b && b.quoteId === '20418' && b.key === 'C55B523B-75F2-4C54-BE21-D3F80A084CC5');
  ok('a bare quoteid=ID/KEY fragment works too', parseQuoteRef('quoteid=1/ABCDEFGH')?.quoteId === '1');
  ok('a link with neither is null', parseQuoteRef('https://www.justsardinia.co.uk/home/') === null && parseQuoteRef('') === null);
}

console.log('\nThe report shows shape and keys, never prices or people');
const LOCATION = {
  type: 'locations', locationName: 'Dubai', monthOfTravel: 6, localCurrency: 'AED',
  overviewHtml: '<p>Sun.</p>',
  weatherAverages: [{ month: 6, high: 38, low: 27, rainfall: 0, sunHours: 12 }],
  price: 0, nettPrice: 0,
};
const HOTEL = { type: 'hotels', hotelName: 'Atlantis', checkIn: '2027-06-10', nights: 7, price: 4200, nettPrice: 3900, memberPrice: 3800 };
const QD = {
  data: {
    id: 20418, name: 'Dubai in June', customerFirstname: 'Sarah', customerSurname: 'Jones', contactEmail: 'sarah@example.com',
    quoteDocument: {
      setup: { quoteId: 20418, leadName: 'Sarah Jones', leadEmail: 'sarah@example.com', startDate: '2027-06-10', adults: 2, tripDestination: 'Dubai', quoteTotal: 4200 },
      items: [HOTEL, LOCATION],
      total: 4200,
    },
  },
};
{
  const r = buildQuoteShapeReport(QD);
  ok('detects the quoteDocument shape', r.shape === 'quoteDocument' && r.itemCount === 2);
  ok('lists each item with its type and keys', r.items[0].type === 'hotels' && r.items[0].keys.includes('checkIn') && r.items[1].type === 'locations');
  ok('returns the location item in full', r.locations.length === 1 && r.locations[0].locationName === 'Dubai' && r.locations[0].monthOfTravel === 6);
  const loc = JSON.stringify(r.locations[0]);
  ok('with cost and price keys removed', !/nettPrice|"price"/.test(loc) && loc.includes('weatherAverages'));
  ok('setup shows date-like values only', r.setup.dates.startDate === '2027-06-10' && r.setup.dates.leadName === undefined && !('quoteTotal' in r.setup.dates));
  ok('setup drops the lead name and email keys entirely', !r.setup.keys.includes('leadName') && !r.setup.keys.includes('leadEmail'));
  ok('top-level customer keys are dropped', !r.topLevelKeys.includes('customerFirstname') && !r.topLevelKeys.includes('contactEmail'));
  ok('every weather-looking key is surfaced with its path', r.weatherLike.some((h) => h.path === 'items[1].weatherAverages') && r.weatherLike.some((h) => h.path === 'items[1].weatherAverages') );
  const all = JSON.stringify(r);
  ok('no price value or person leaks into the report', !all.includes('4200') && !all.includes('3900') && !all.includes('Sarah') && !all.includes('sarah@example.com'));
}
{
  const raw = { data: { id: 1, items: [{ product: { name: 'Hotel', pricing: { price: 900 } }, price: 950 }, { product: { name: 'Dubai', location: { city: 'Dubai' }, climate: { june: { avgTemp: 36 } } } }] } };
  const r = buildQuoteShapeReport(raw);
  ok('detects the raw hotlist shape', r.shape === 'raw');
  ok('finds weather-looking keys nested inside a product', r.weatherLike.some((h) => h.path === 'items[1].product.climate' && h.value.june.avgTemp === 36));
  ok('does not treat an ordinary product as a location', r.locations.length === 0);
}
{
  const flat = { setup: { quoteTitle: 'Test', checkIn: '2027-01-02' }, items: [{ accommodationName: 'X', price: 10 }] };
  ok('detects the legacy flat shape', buildQuoteShapeReport(flat).shape === 'flat');
  ok('an empty document does not throw', buildQuoteShapeReport({}).shape === 'empty' && buildQuoteShapeReport(null).shape === 'empty');
}

console.log('\nThe handler is gated like every admin route');
{
  ok('uses requireAdmin from the admin guard', /import \{ requireAdmin, setAdminCors \} from '\.\/_guard\.js'/.test(SRC) && /const gate = requireAdmin\(req\);/.test(SRC));
  ok('GET only, rate limited per user', /req\.method !== 'GET'/.test(SRC) && /applyRateLimit\(res, `quote-shape:\$\{who\}`/.test(SRC));
  ok('validates the id, key and widget id before any lookup', /ID_RE\.test\(ref\.quoteId\) \|\| !KEY_RE\.test\(ref\.key\)/.test(SRC) && /ID_RE\.test\(q\.widgetId\)/.test(SRC));
  ok('a bare visit shows the paste-a-link form', /<form method="get" action="\/api\/admin\/quote-shape">/.test(SRC) && !/onclick|onsubmit|<script/.test(SRC));
  ok('the report is also logged with a marker', /console\.error\('\[quote-shape\] '/.test(SRC));
  const { default: handler } = await import('../api/admin/quote-shape.js');
  const out = { status: 0, body: null, headers: {} };
  const res = { setHeader: (k, v) => { out.headers[k] = v; }, status: (c) => { out.status = c; return res; }, json: (b) => { out.body = b; return res; }, send: (b) => { out.body = b; return res; }, end: () => res };
  await handler({ method: 'GET', query: { url: 'https://x/quote-viewer#quoteid=1/ABCDEFGH' }, headers: {}, socket: {} }, res);
  ok('an anonymous call is refused', out.status === 401 || out.status === 403);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
