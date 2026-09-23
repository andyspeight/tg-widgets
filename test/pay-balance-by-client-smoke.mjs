/**
 * The balance payment, raised two ways: the My Booking widget's public
 * /api/pay-balance (keyed by widget) and Luna Travel's internal
 * /api/internal/pay-balance-by-client (keyed by Clients record). 23 Sep 2026.
 *
 * The traveller app shows what a booking still owes and needed the same Pay
 * button the widget has. The basket call moved out of the widget's handler
 * into createBasket so both endpoints raise the payment the same way, and the
 * amount comes from decideCharge over an order fetched on the server in both.
 *
 * So this checks three things, with Airtable and Travelify faked:
 *   1. the internal endpoint is shut to anyone without the key, and says
 *      nothing useful to a caller with bad input;
 *   2. it charges what decideCharge decides and nothing a caller asks for
 *      beyond that;
 *   3. the widget's own endpoint still answers exactly as it did before the
 *      move — the widget is live on customer sites.
 *
 * Run: node test/pay-balance-by-client-smoke.mjs
 */

let passed = 0, failed = 0;
const ok = (c, label, detail = '') => {
  if (c) passed++;
  else { failed++; console.error('  FAIL:', label, detail); }
};

process.env.TG_INTERNAL_KEY = 'test-internal-key-0123456789';
process.env.AIRTABLE_KEY = 'test-airtable-key';

const RECORD = 'recABCDEFGHIJKLMN';
const BASKET = 'https://pay.example-agency.co.uk/basket/42';

// ── Fake Travelify + Airtable ───────────────────────────────────────────────
let order;          // what Travelify returns for the order lookup
let basketReply;    // what addgenericitem returns
let basketCalls;    // payloads sent to addgenericitem
let orderLookups;   // bodies sent to the order lookup

function rawOrder(over = {}) {
  return {
    id: 120964,
    key: 'order-secret-key',
    currency: 'GBP',
    customerEmail: 'lead@example.com',
    customerFirstname: 'Tracy',
    customerSurname: 'Adams',
    items: [{ price: 4180 }],
    payments: [{ status: 'Success', amount: 836 }],
    ...over,
  };
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  if (u.startsWith('https://api.airtable.com/')) {
    if (u.includes(RECORD)) {
      return reply(200, { id: RECORD, fields: { fldE9dL05t0x0S88w: '1234', fld9X1nvAgy0sHQ4B: 'agency-api-key' } });
    }
    return reply(404, {});
  }
  if (u === 'https://api.travelify.io/account/order') {
    orderLookups.push(JSON.parse(init.body));
    return order ? reply(200, order) : reply(404, {});
  }
  if (u === 'https://api.travelify.io/addgenericitem') {
    basketCalls.push(JSON.parse(init.body));
    return reply(200, basketReply);
  }
  throw new Error('unexpected fetch ' + u);
};

function reset() {
  order = rawOrder();
  basketReply = { success: true, data: BASKET };
  basketCalls = [];
  orderLookups = [];
}

function mockRes() {
  const r = { statusCode: 200, body: undefined, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}

const { default: internal } = await import('../api/internal/pay-balance-by-client.js');
const { default: publicPay } = await import('../api/pay-balance.js');

let n = 0;
const call = async (handler, body, { key = process.env.TG_INTERNAL_KEY, method = 'POST' } = {}) => {
  const res = mockRes();
  // A different booking each time, so the per-booking limit is exercised only
  // where a test means to.
  await handler({ method, headers: { 'x-tg-internal-key': key, 'x-forwarded-for': `10.0.0.${++n % 250}` }, body }, res);
  return res;
};
const good = (over = {}) => ({
  recordId: RECORD, emailAddress: 'lead@example.com', departDate: '2026-10-22', orderRef: 'CYPHTR-120964', ...over,
});

// ── 1. The door ─────────────────────────────────────────────────────────────
reset();
ok((await call(internal, good(), { key: '' })).statusCode === 401, 'no key → 401');
ok((await call(internal, good(), { key: 'wrong' })).statusCode === 401, 'wrong key → 401');
ok(basketCalls.length === 0 && orderLookups.length === 0, 'a refused caller reaches neither Travelify call');
ok((await call(internal, good(), { method: 'GET' })).statusCode === 405, 'GET → 405');
for (const bad of [
  { recordId: 'recShort' }, { recordId: 'nope' }, { emailAddress: 'not-an-email' },
  { departDate: '22/10/2026' }, { orderRef: '<script>' },
]) {
  const r = await call(internal, good(bad));
  ok(r.statusCode === 400 && r.body.error === 'bad_request', 'bad input → generic 400', JSON.stringify(bad));
}
ok((await call(internal, good({ recordId: 'recZZZZZZZZZZZZZZ' }))).statusCode === 404, 'a client with no credentials → 404');

// ── 2. The payment ──────────────────────────────────────────────────────────
reset();
let r = await call(internal, good());
ok(r.statusCode === 200 && r.body.ok === true && r.body.url === BASKET, 'owes money → basket url', JSON.stringify(r.body));
ok(r.body.payment && r.body.payment.amount === 3344 && r.body.payment.currency === 'GBP', 'charges the outstanding decideCharge worked out');
ok(orderLookups[0] && orderLookups[0].orderRef === 'CYPHTR-120964' && orderLookups[0].emailAddress === 'lead@example.com',
  'the order is fetched on the server with the lookup triplet');
const sent = basketCalls[0] || {};
ok(sent.Price === 3344 && sent.Currency === 'GBP', 'the basket carries the server-decided amount');
ok(sent.OrderRef === '120964/order-secret-key', 'the order key is joined server-side and never returned');
ok(!JSON.stringify(r.body).includes('order-secret-key'), 'the response does not leak the order key');
ok(sent.ContactInfo && sent.ContactInfo.EmailAddress === 'lead@example.com', 'contact info comes from the order');

reset();
r = await call(internal, good({ amount: 500 }));
ok(r.body.ok === true && basketCalls[0].Price === 500 && r.body.payment.remainingAmount === 2844, 'a part payment is allowed and re-validated');

reset();
r = await call(internal, good({ amount: 999999 }));
ok(r.statusCode === 400 && r.body.error === 'invalid_amount' && basketCalls.length === 0, 'asking for more than is owed raises nothing');

reset();
r = await call(internal, good({ amount: -5 }));
ok(r.statusCode === 400 && basketCalls.length === 0, 'a negative amount raises nothing');

reset();
order = rawOrder({ payments: [{ status: 'Success', amount: 4180 }] });
r = await call(internal, good());
ok(r.statusCode === 200 && r.body.noBalance === true && basketCalls.length === 0, 'paid in full → noBalance, no basket');

reset();
order = null;
r = await call(internal, good());
ok(r.statusCode === 404 && basketCalls.length === 0, 'no such order → 404, no basket');

reset();
order = rawOrder({ key: undefined });
r = await call(internal, good());
ok(r.statusCode === 502 && basketCalls.length === 0, 'an order with no key cannot be charged');

reset();
basketReply = { success: true, data: 'http://insecure.example/basket' };
r = await call(internal, good());
ok(r.statusCode === 502 && !r.body.url, 'a non-https basket url is never handed back');

reset();
basketReply = { success: false };
r = await call(internal, good());
ok(r.statusCode === 502, 'Travelify refusing the basket → 502');

// The per-booking limit.
reset();
const same = good({ orderRef: 'LIMIT-TEST-1' });
let last;
for (let i = 0; i < 11; i++) last = await call(internal, same);
ok(last.statusCode === 429, 'the eleventh request for one booking is rate limited');

// ── 3. The widget's endpoint is unchanged ───────────────────────────────────
const widget = (over = {}) => ({
  widgetId: 'DEMO_WIDGET_ID', emailAddress: 'lead@example.com', departDate: '2026-10-22', orderRef: 'CYPHTR-120964', ...over,
});

reset();
r = await call(publicPay, widget());
ok(r.statusCode === 200 && r.body.success === true && r.body.url === BASKET, 'widget: owes money → basket url', JSON.stringify(r.body));
ok(JSON.stringify(Object.keys(r.body.payment).sort()) === JSON.stringify(['amount', 'currency', 'dueDate', 'isInstalment', 'remainingAmount']),
  'widget: the payment block has the same fields as before');
ok(basketCalls[0].Price === 3344 && basketCalls[0].Title === 'Balance Payment' && basketCalls[0].Reference === 'CYPHTR-120964',
  'widget: the basket payload is the same as before');

reset();
basketReply = { success: false };
r = await call(publicPay, widget());
ok(r.statusCode === 200 && r.body.success === false && !r.body.url, 'widget: Travelify refusing → {success:false}, as before');

reset();
basketReply = { success: true, data: 'http://insecure.example/basket' };
r = await call(publicPay, widget());
ok(r.statusCode === 200 && r.body.success === false, 'widget: a non-https url is still refused');

reset();
order = rawOrder({ payments: [{ status: 'Success', amount: 4180 }] });
r = await call(publicPay, widget());
ok(r.body.success === false && r.body.noBalance === true && basketCalls.length === 0, 'widget: paid in full → noBalance, as before');

reset();
order = rawOrder({ key: undefined });
r = await call(publicPay, widget());
ok(r.body.success === false && basketCalls.length === 0, 'widget: an order with no key still fails before any basket');

reset();
r = await call(publicPay, widget({ amount: 999999 }));
ok(r.statusCode === 400 && /more than the balance/i.test(r.body.error) && basketCalls.length === 0, 'widget: over-payment still rejected with its message');

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
