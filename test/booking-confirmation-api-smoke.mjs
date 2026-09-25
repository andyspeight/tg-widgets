/**
 * The booking confirmation, on request from the Travelify core (25 Sep 2026).
 *
 * Andy: "We did an balance reminder API endpoint and now we want to add similar
 * functionality for sending the booking confirmation. We need an endpoint that
 * Darren can post to and then we will send the email."
 *
 * POST /api/v1/booking-confirmations is /api/v1/payment-reminders' shape (an
 * X-Api-Key, { applicationId, orderId, orderKey }, 202 and a reference) feeding
 * the confirmation queue the signed webhook already feeds. What this suite
 * holds it to:
 *
 *  - THE CONTRACT on /booking-confirmations-api: auth before anything else,
 *    per-field validation, an unknown application refused, 202 with a
 *    reference, and the worker nudged only after the answer has gone.
 *  - ONE REQUEST, ONE EMAIL, as for the reminders (Andy, 25 Sep 2026: "The
 *    email confirmation can get sent multiple times, but you have limited to
 *    only send once - this needs changing"). Every accepted request queues and
 *    sends, a booking already confirmed included; nothing is looked up to
 *    refuse it. The webhook still answers a booking the core has already
 *    confirmed as a duplicate, so it never adds an automatic second email.
 *  - THE SAME EMAIL, THE SAME SWITCHES. A direct request is sent by the same
 *    worker through /api/booking-email, and stops at the same gates: the
 *    global switch and the client's own.
 *  - APP 250 SENDS, END TO END (Andy, 25 Sep 2026: "on App 250, set it up to
 *    send so we can do a full test - please make sure there are no other
 *    blocks to sending"). Every block between a request for app 250 and an
 *    email leaving is driven here: the demo stop (gone), the global switch
 *    (the demo passes it as a test application), the App ID resolving to the
 *    client without a My Booking widget (the sibling that has one is used),
 *    and the send endpoint refusing the test inbox as a recipient (our own
 *    worker may now send there).
 *
 * The endpoints and the worker run for real; only Airtable, Travelify and our
 * own send endpoint are stood in for.
 *
 * Run: node test/booking-confirmation-api-smoke.mjs
 *      (npm run test:booking-confirmation-api)
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_PAT = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.BOOKING_WEBHOOK_SECRET = 'a-shared-security-key';
process.env.PAYMENT_REMINDER_API_KEY = 'the-reminder-key';
delete process.env.BOOKING_CONFIRMATION_API_KEY;
process.env.CRON_SECRET = 'cron-secret-value';
process.env.TG_INTERNAL_KEY = 'internal-key-value';
process.env.TG_SELF_ORIGIN = 'https://tg-widgets.test';
delete process.env.BOOKING_CONFIRMATION_SEND_ENABLED;

const lib = await import('../api/_lib/booking-confirmations.js');
const endpoint = (await import('../api/v1/booking-confirmations.js')).default;
const webhook = (await import('../api/v1/booking-webhook.js')).default;
const worker = await import('../api/cron/booking-confirmations.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const APP_ID = 100;
const ORDER_KEY = 'F461B152-B2EB-40AF-81B2-E8BEFDE80A43';
const BODY = { applicationId: APP_ID, orderId: 1, orderKey: ORDER_KEY };

const CLIENT = {
  record: { id: 'recCLIENT00000001', fields: {
    fldE9dL05t0x0S88w: '100',
    fld9X1nvAgy0sHQ4B: 'demo-api-key',
    fldx9CiWtSm5lX7MF: 'Sunrise Travel',
  } },
  widget: { id: 'recWIDGET00000001', fields: {
    WidgetType: 'My Booking', Status: 'Active', WidgetID: 'tgw_mybooking_1',
    ClientRecordId: 'recCLIENT00000001', ClientName: 'Sunrise Travel',
    Config: JSON.stringify({
      brand: { name: 'Sunrise Travel' }, support: { email: 'hi@sunrise.example' },
      confirmationEmail: { enabled: true, layout: [] },
    }),
  } },
};
const RAW_ORDER = {
  id: 1, key: ORDER_KEY, status: 'Confirmed', reference: 'ST24189',
  customerEmail: 'demo@travelgenix.io', currency: 'GBP',
  summary: { earliestStart: '2027-02-03T00:00:00' },
  items: [{ id: 1, product: 'Accommodation', startDate: '2027-02-03T00:00:00', bookingReference: 'ST24189' }],
};

/**
 * Airtable, Travelify and our own endpoints. `existing` are the rows already in
 * Booking Confirmations; the duplicate lookups are answered by reading the
 * formula they send, so a lookup that asks the wrong question gets the wrong
 * answer here too. `queue` is what the worker's sweep is handed.
 */
function network({ existing = [], queue = [], client = CLIENT, order = RAW_ORDER, sendOk = true,
  airtableDown = false, createFails = false, out = null } = {}) {
  const calls = [], created = [], patched = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method: opts.method || 'GET', body, headers: opts.headers || {}, answeredYet: out ? out.ended : null });
    const reply = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload, text: async () => JSON.stringify(payload) });

    if (u.includes('/api/booking-email')) {
      return sendOk ? reply({ ok: true, messageId: 'sg-msg-1' }) : reply({ error: 'send_failed' }, 500);
    }
    if (u.includes('/api/cron/booking-confirmations')) return reply({ ok: true });
    if (u.includes('api.travelify.io/account/order/')) return order ? reply(order) : reply({ code: '404' }, 404);
    if (u.includes(lib.CONFIRMATIONS_TABLE)) {
      const method = opts.method || 'GET';
      if (method === 'POST') {
        if (createFails) return reply({ error: 'boom' }, 500);
        created.push(body.records[0].fields);
        return reply({ records: [{ id: 'recNEW0000000001' }] });
      }
      if (method === 'PATCH') { patched.push(body.fields); return reply({ id: 'recNEW0000000001' }); }
      if (airtableDown) return reply({ error: 'down' }, 503);
      const formula = decodeURIComponent((u.split('filterByFormula=')[1] || '').split('&')[0]);
      const keyMatch = /\{IdempotencyKey\}='([^']*)'/.exec(formula);
      if (keyMatch) {
        const statuses = formula.includes('{Status}')
          ? [...formula.matchAll(/\{Status\}='([A-Za-z]+)'/g)].map((m) => m[1]) : null;
        return reply({ records: existing.filter((r) => r.fields.IdempotencyKey === keyMatch[1]
          && (!statuses || statuses.includes(r.fields.Status))) });
      }
      return reply({ records: queue });
    }
    if (u.includes('tblVAThVqAjqtria2')) return reply({ records: client?.widget ? [client.widget] : [] });
    return reply({ records: client ? [client.record] : [] });
  };
  return { calls, created, patched, restore: () => { globalThis.fetch = real; } };
}

function request(body, { method = 'POST', key = 'the-reminder-key', headers = {} } = {}) {
  const h = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers };
  if (key !== null) h['x-api-key'] = key;
  return { method, headers: h, body };
}
function response() {
  const out = { code: 0, body: null, ended: false };
  const res = {
    status(c) { out.code = c; return res; },
    json(b) { out.body = b; out.ended = true; return res; },
    end() { out.ended = true; return res; },
    setHeader() { return res; },
  };
  return { res, out };
}
async function post(body, opts = {}, netOpts = {}) {
  const { res, out } = response();
  const net = network({ ...netOpts, out });
  try { await endpoint(request(body, opts), res); } finally { net.restore(); }
  return { out, net };
}
const airtableCalls = (net) => net.calls.filter((c) => c.url.includes('api.airtable.com'));

console.log('\nThe door: method, key and body\n');
{
  let r = await post(BODY, { method: 'GET' });
  ok('only POST', r.out.code === 405);

  r = await post(BODY, { key: 'wrong' });
  ok('a wrong key is 401 with no detail', r.out.code === 401 && JSON.stringify(r.out.body) === '{}');
  ok('and nothing is looked up before the key is checked', airtableCalls(r.net).length === 0);
  r = await post(BODY, { key: null });
  ok('no key at all is 401 too', r.out.code === 401);

  r = await post(BODY);
  ok('the key Darren already holds for the payment reminders works here', r.out.code === 202, JSON.stringify(r.out));

  process.env.BOOKING_CONFIRMATION_API_KEY = 'a-confirmation-only-key';
  r = await post(BODY);
  ok('once a confirmation key of its own is set, the reminder key no longer opens this door', r.out.code === 401);
  r = await post(BODY, { key: 'a-confirmation-only-key' });
  ok('and the confirmation key does', r.out.code === 202);
  delete process.env.BOOKING_CONFIRMATION_API_KEY;

  delete process.env.PAYMENT_REMINDER_API_KEY;
  r = await post(BODY, { key: '' });
  ok('with no key configured at all it refuses rather than falling open', r.out.code === 500 && r.net.created.length === 0);
  process.env.PAYMENT_REMINDER_API_KEY = 'the-reminder-key';

  r = await post({ ...BODY, applicationId: '100' });
  ok('applicationId must be a JSON number, as on the reminders', r.out.code === 400 && !!r.out.body.fields.applicationId);
  r = await post({ applicationId: APP_ID, orderKey: ORDER_KEY });
  ok('a missing orderId is named', r.out.code === 400 && !!r.out.body.fields.orderId);
  r = await post({ ...BODY, orderKey: 'not-a-guid' });
  ok('an orderKey that is not a GUID is named', r.out.code === 400 && !!r.out.body.fields.orderKey);
  r = await post('{not json');
  ok('a body that is not JSON is a validation error, not a crash', r.out.code === 400 && r.out.body.error === 'validation_failed');
  r = await post([BODY]);
  ok('an array is not a request', r.out.code === 400);
  r = await post({ ...BODY, email: 'not an address' });
  ok('an email that is not an address is named', r.out.code === 400 && !!r.out.body.fields.email);
  r = await post({ ...BODY, email: 'a@example.com, b@example.com' });
  ok('a list of addresses is refused (one recipient per request)', r.out.code === 400 && !!r.out.body.fields.email);
  r = await post({ ...BODY, email: 42 });
  ok('an email that is not a string is refused', r.out.code === 400 && !!r.out.body.fields.email);
  ok('and nothing invalid was ever recorded', r.net.created.length === 0);

  r = await post(BODY, {}, { client: null });
  ok('an application we do not hold is 400 Unknown applicationId, as on the reminders',
    r.out.code === 400 && r.out.body.fields.applicationId === 'Unknown applicationId' && r.net.created.length === 0);
}

console.log('\nAccepted: one row, queued for the worker\n');
{
  const r = await post({ ...BODY, reminderType: 'ignored', amountDue: 5 });
  ok('202 with a reference and the time we received it',
    r.out.code === 202 && r.out.body.status === 'accepted' && /^bc_[0-9a-f-]{36}$/.test(r.out.body.reference)
    && !Number.isNaN(Date.parse(r.out.body.receivedAtUtc)));
  const row = r.net.created[0] || {};
  ok('one row, queued not processed', r.net.created.length === 1 && row.Status === 'Accepted' && row.Attempts === 0);
  ok('carrying the id and key the order is fetched with', row.ApplicationId === 100 && row.OrderId === 1 && row.OrderKey === ORDER_KEY);
  ok('marked as a direct request (api.confirmation), so the table shows which door it came through', row.EventType === 'api.confirmation');
  ok('under the SAME key as the webhook\'s order.complete for this booking', row.IdempotencyKey === '100|1|order.complete');
  ok('with the client named', row.ClientName === 'Sunrise Travel');
  ok('the reference in the answer is the one on the row', row.Reference === r.out.body.reference);
  ok('extra fields are ignored rather than stored', !('ReminderType' in row) && !('AmountDue' in row));
  ok('with no email given, no ToEmail is stored (the order\'s own email will be used)', !('ToEmail' in row));
  const withEmail = await post({ ...BODY, email: '  Jo.Smith@Example.com ' });
  ok('the address Darren sends is accepted and stored as ToEmail, tidied',
    withEmail.out.code === 202 && withEmail.net.created[0].ToEmail === 'jo.smith@example.com');
  ok('and kept apart from CustomerEmail (the order\'s address, which the booking is looked up by)',
    !('CustomerEmail' in withEmail.net.created[0]));
  const kick = r.net.calls.find((c) => c.url.includes('/api/cron/booking-confirmations'));
  ok('the worker is nudged with the cron secret', !!kick && kick.headers.Authorization === 'Bearer cron-secret-value');
  ok('only after the answer has gone back', kick && kick.answeredYet === true);
  ok('nothing is emailed on the request itself', !r.net.calls.some((c) => c.url.includes('booking-email')));
}

console.log('\nThe nudge outlives the answer (waitUntil)\n');
{
  // 25 Sep 2026: Darren's request was accepted at 10:51:43 and nothing ran
  // until the sweep at 10:55:01. Vercel freezes a function once it has
  // answered, so a nudge awaited after the 202 never left. It is now handed to
  // waitUntil, which @vercel/functions reads from this request context.
  const REQ_CTX = Symbol.for('@vercel/request-context');
  const held = [];
  globalThis[REQ_CTX] = { get: () => ({ waitUntil: (p) => { held.push(p); } }) };
  let r;
  try { r = await post(BODY); } finally { delete globalThis[REQ_CTX]; }
  ok('the nudge is handed to the platform\'s waitUntil, so it survives the 202',
    r.out.code === 202 && held.length === 1 && typeof held[0]?.then === 'function', 'held ' + held.length);
  await Promise.allSettled(held);
  ok('and it is the worker nudge that is held',
    r.net.calls.some((c) => c.url.includes('/api/cron/booking-confirmations')));
  const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const doors = ['api/v1/booking-confirmations.js', 'api/v1/booking-webhook.js', 'api/v1/payment-reminders.js'];
  ok('all three intake endpoints hold their nudge the same way, none awaits it bare',
    doors.every((p) => src(p).includes('afterResponse(kickWorker())') && !/await kickWorker\(\)/.test(src(p))),
    doors.filter((p) => !src(p).includes('afterResponse(kickWorker())')).join(', '));
  ok('the helper uses Vercel\'s own waitUntil, and the package is a dependency Vercel installs',
    /import \{ waitUntil \} from '@vercel\/functions'/.test(src('api/_lib/after-response.js'))
    && !!JSON.parse(src('package.json')).dependencies?.['@vercel/functions']);
}

console.log('\nOne request, one email: repeats send too\n');
{
  const KEY = '100|1|order.complete';
  const existingRow = (Status, EventType = 'api.confirmation') =>
    ({ id: 'recOLD000000000' + Status.length, fields: { Reference: 'bc_first_' + Status, IdempotencyKey: KEY, Status, EventType } });

  for (const status of ['Accepted', 'Fetched', 'Sent', 'Skipped', 'Failed']) {
    const r = await post(BODY, {}, { existing: [existingRow(status)] });
    ok(`a booking whose earlier confirmation is ${status} is accepted and queued again`,
      r.out.code === 202 && r.out.body.status === 'accepted' && r.net.created.length === 1, JSON.stringify(r.out));
  }
  let r = await post(BODY, {}, { existing: [existingRow('Sent', 'order.complete')] });
  ok('so is a booking already confirmed through the webhook', r.out.code === 202 && r.net.created.length === 1);

  r = await post(BODY);
  const second = await post(BODY);
  ok('two requests for the same booking are two rows with two references (two emails)',
    r.out.code === 202 && second.out.code === 202 && r.out.body.reference !== second.out.body.reference);
  ok('nothing is looked up to refuse a repeat: the only Airtable call is the row itself',
    airtableCalls(second.net).filter((c) => c.url.includes(lib.CONFIRMATIONS_TABLE)).every((c) => c.method === 'POST'),
    airtableCalls(second.net).map((c) => c.method + ' ' + c.url.slice(0, 90)).join(' | '));
  ok('each row still carries the booking\'s key, for audit', second.net.created[0].IdempotencyKey === KEY);
  ok('the answer never says duplicate', second.out.body.status === 'accepted' && !('duplicate' in second.out.body));

  r = await post(BODY, {}, { createFails: true });
  ok('if the row cannot be written, 500 and no kick (nothing was queued)',
    r.out.code === 500 && !r.net.calls.some((c) => c.url.includes('/api/cron/')));

  // The webhook keeps its own rule: it does not add an automatic confirmation
  // for a booking the core has already asked us to confirm.
  const payload = { eventtype: 'order.complete', appid: APP_ID, data: { id: 1, key: ORDER_KEY }, timestamp: '2026-09-25T10:00:00Z' };
  const text = JSON.stringify(payload);
  const req = Readable.from([Buffer.from(text, 'utf8')]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7',
    'travelgenix-signature': crypto.createHmac('sha256', 'a-shared-security-key').update(Buffer.from(text, 'utf8')).digest('base64') };
  const { res, out } = response();
  const net = network({ existing: [existingRow('Accepted')], out });
  try { await webhook(req, res); } finally { net.restore(); }
  ok('the webhook still answers a booking the core already confirmed as a duplicate (no automatic second email)',
    out.code === 200 && out.body.status === 'duplicate' && out.body.reference === 'bc_first_Accepted' && net.created.length === 0,
    JSON.stringify(out));
}

console.log('\nThe worker sends it exactly as it sends a webhook booking\n');
{
  const row = (over = {}) => ({ id: 'recROW0000000001', fields: {
    Reference: 'bc_' + crypto.randomUUID(), ApplicationId: APP_ID, OrderId: 1, OrderKey: ORDER_KEY,
    EventType: 'api.confirmation', Status: 'Accepted', Attempts: 0, IdempotencyKey: '100|1|order.complete',
    ReceivedAtUtc: new Date().toISOString(), ...over } });
  const sweep = async (rows, opts = {}) => {
    const net = network({ queue: rows, ...opts });
    const { res, out } = response();
    try { await worker.default({ headers: { authorization: 'Bearer cron-secret-value' } }, res); } finally { net.restore(); }
    return { out, net };
  };

  ok('api.confirmation is a sending event', lib.eventSends('api.confirmation'));

  let r = await sweep([row()]);
  ok('with the global switch off it stops at Fetched and emails no one',
    r.net.patched[0].Status === 'Fetched' && !r.net.calls.some((c) => c.url.includes('booking-email')));

  process.env.BOOKING_CONFIRMATION_SEND_ENABLED = 'true';
  r = await sweep([row()]);
  const send = r.net.calls.find((c) => c.url.includes('booking-email'));
  ok('with it on, the confirmation is sent', !!send && r.net.patched[0].Status === 'Sent');
  ok('through /api/booking-email, the one send path', send && send.url === 'https://tg-widgets.test/api/booking-email');
  ok('for the right booking, to the customer, from the client\'s widget',
    send && send.body.emailAddress === 'demo@travelgenix.io' && send.body.departDate === '2027-02-03'
    && send.body.orderRef === 'ST24189' && send.body.toEmail === 'demo@travelgenix.io' && send.body.widgetId === 'tgw_mybooking_1',
    send && JSON.stringify(send.body));

  r = await sweep([row({ ToEmail: 'jo.smith@example.com' })]);
  const toReq = r.net.calls.find((c) => c.url.includes('booking-email'));
  ok('a row with the address Darren sent goes to that address',
    toReq && toReq.body.toEmail === 'jo.smith@example.com' && r.net.patched[0].SentTo === 'jo.smith@example.com');
  ok('while the booking is still looked up by the order\'s own email', toReq && toReq.body.emailAddress === 'demo@travelgenix.io');
  r = await sweep([row({ ToEmail: 'not an address' })]);
  ok('a stored address that is not one falls back to the order\'s email rather than failing',
    r.net.calls.find((c) => c.url.includes('booking-email')).body.toEmail === 'demo@travelgenix.io');
  process.env.BOOKING_CONFIRMATION_TEST_APP_IDS = '100';
  process.env.BOOKING_CONFIRMATION_TEST_RECIPIENT = 'inbox@travelgenix.example';
  r = await sweep([row({ ToEmail: 'jo.smith@example.com' })]);
  ok('for a test application the test inbox wins over the requested address, so a test never reaches a real person',
    r.net.calls.find((c) => c.url.includes('booking-email')).body.toEmail === 'inbox@travelgenix.example');
  delete process.env.BOOKING_CONFIRMATION_TEST_APP_IDS;
  delete process.env.BOOKING_CONFIRMATION_TEST_RECIPIENT;

  const offClient = { ...CLIENT, widget: { ...CLIENT.widget, fields: { ...CLIENT.widget.fields,
    Config: JSON.stringify({ confirmationEmail: { enabled: false } }) } } };
  r = await sweep([row()], { client: offClient });
  ok('a client who has not switched confirmations on gets none, whoever asked',
    r.net.patched[0].Status === 'Skipped' && /not switched on/.test(r.net.patched[0].LastError)
    && !r.net.calls.some((c) => c.url.includes('booking-email')));

  r = await sweep([row({ ApplicationId: 250 })]);
  ok('the demo application sends too (Andy, 25 Sep: set 250 up to send)',
    r.net.patched[0].Status === 'Sent' && r.net.calls.some((c) => c.url.includes('booking-email')));

  r = await sweep([row({ ReceivedAtUtc: new Date(Date.now() - 13 * 3600000).toISOString() })]);
  ok('a request more than twelve hours old is skipped, not sent late', r.net.patched[0].Status === 'Skipped' && /too old/.test(r.net.patched[0].LastError));
  delete process.env.BOOKING_CONFIRMATION_SEND_ENABLED;
}

console.log('\nApp 250 end to end: nothing left in the way\n');
{
  // App 250 as it really is in Airtable: two Clients rows share it, the FIRST
  // one (what the App ID lookup returns) has no My Booking widget, and the
  // second owns "My Booking test".
  const TRAVELGENIX = { id: 'recRCZl6afFpBFSW6', fields: { fldE9dL05t0x0S88w: 250, fld9X1nvAgy0sHQ4B: 'A41D180E-KEY', fldx9CiWtSm5lX7MF: 'Travelgenix' } };
  const DEMO_TES = { id: 'recZNjh3ME4gOg9F0', fields: { fldE9dL05t0x0S88w: 250, fld9X1nvAgy0sHQ4B: 'A41D180E-KEY', fldx9CiWtSm5lX7MF: 'Travel Demo Tes Ltd' } };
  const TEST_WIDGET = { id: 'recl7meFbp2iIfpCD', fields: {
    WidgetType: 'My Booking', Status: 'Active', WidgetID: 'tgw_1777215362250_tlpgd4', ClientRecordId: 'recZNjh3ME4gOg9F0',
    Config: JSON.stringify({ pageUrl: 'https://tg-widgets.vercel.app/demo-mybooking', confirmationEmail: { enabled: true, layout: [] } }) } };
  const DEMO_ORDER = { ...RAW_ORDER, customerEmail: 'andy@example.com' };

  function app250Network() {
    const calls = [], patched = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const u = decodeURIComponent(String(url));
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url: u, body, headers: opts.headers || {} });
      const reply = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload, text: async () => JSON.stringify(payload) });
      if (u.includes('/api/booking-email')) return reply({ ok: true, messageId: 'sg-250' });
      if (u.includes('api.travelify.io/account/order/')) return reply(DEMO_ORDER);
      if (u.includes(lib.CONFIRMATIONS_TABLE)) {
        if (opts.method === 'PATCH') { patched.push(body.fields); return reply({}); }
        return reply({ records: [{ id: 'recQ', fields: { Reference: 'bc_250', ApplicationId: 250, OrderId: 1, OrderKey: ORDER_KEY,
          EventType: 'api.confirmation', Status: 'Accepted', Attempts: 0, ReceivedAtUtc: new Date().toISOString() } }] });
      }
      if (u.includes('tblVAThVqAjqtria2')) {
        return reply({ records: u.includes('recZNjh3ME4gOg9F0') ? [TEST_WIDGET] : [] });
      }
      if (u.includes('tblikekpaTKraMktZ')) {
        if (u.includes('maxRecords=1&') || u.endsWith('maxRecords=1') || /maxRecords=1(&|$)/.test(u)) return reply({ records: [TRAVELGENIX] });
        return reply({ records: [TRAVELGENIX, DEMO_TES] });
      }
      return reply({ records: [] });
    };
    return { calls, patched, restore: () => { globalThis.fetch = real; } };
  }
  const sweep250 = async () => {
    const net = app250Network();
    const { res, out } = response();
    try { await worker.default({ headers: { authorization: 'Bearer cron-secret-value' } }, res); } finally { net.restore(); }
    return { out, net };
  };

  delete process.env.BOOKING_CONFIRMATION_SEND_ENABLED;
  delete process.env.BOOKING_CONFIRMATION_TEST_APP_IDS;
  delete process.env.BOOKING_CONFIRMATION_TEST_RECIPIENT;
  let r = await sweep250();
  const send = r.net.calls.find((c) => c.url.includes('/api/booking-email'));
  ok('with the global switch off and no test settings at all, a request for app 250 is SENT',
    !!send && r.net.patched[0] && r.net.patched[0].Status === 'Sent', JSON.stringify(r.net.patched[0]));
  ok('from "My Booking test", although the App ID lookup landed on the client with no widget',
    send && send.body.widgetId === 'tgw_1777215362250_tlpgd4');
  ok('to the email on the booking', send && send.body.toEmail === 'andy@example.com' && send.body.emailAddress === 'andy@example.com');

  process.env.BOOKING_CONFIRMATION_TEST_RECIPIENT = 'inbox@travelgenix.example';
  r = await sweep250();
  const redirected = r.net.calls.find((c) => c.url.includes('/api/booking-email'));
  ok('with a test inbox set, it goes to the test inbox, still looked up by the customer\'s email',
    redirected && redirected.body.toEmail === 'inbox@travelgenix.example' && redirected.body.emailAddress === 'andy@example.com');
  delete process.env.BOOKING_CONFIRMATION_TEST_RECIPIENT;

  // The send endpoint itself: a stranger may not send a booking to someone
  // else, but our own worker (the internal key) may send it to the test inbox.
  process.env.SENDGRID_API_KEY = 'SG.test-key';
  process.env.SENDGRID_FROM_EMAIL = 'bookings@travelgenix.example';
  const emailHandler = (await import('../api/booking-email.js')).default;
  const drive = async (internal) => {
    const sent = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      const reply = (payload, status = 200, extra = {}) => ({ ok: status < 400, status, headers: { get: (k) => (k.toLowerCase() === 'x-message-id' ? 'sg-real-1' : null) },
        json: async () => payload, text: async () => JSON.stringify(payload), arrayBuffer: async () => Buffer.from('%PDF-1.4 test').buffer, ...extra });
      if (u.includes('/api/retrieve-order')) return reply({ order: { ...DEMO_ORDER, id: 1, items: [] }, upsell: [], atol: null });
      if (u.includes('/api/booking-pdf')) return reply({});
      if (u.includes('sendgrid')) { sent.push(JSON.parse(opts.body)); return reply({}, 202); }
      return reply({ records: [TEST_WIDGET] });
    };
    const headers = { host: 'tg-widgets.test', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.' + Math.floor(Math.random() * 200) };
    if (internal) { headers['x-tg-internal-key'] = 'internal-key-value'; headers['x-tg-real-ip'] = 'bookconf:250'; }
    const { res, out } = response();
    try {
      await emailHandler({ method: 'POST', headers, body: { widgetId: 'tgw_1777215362250_tlpgd4', emailAddress: 'andy@example.com',
        departDate: '2027-02-03', orderRef: 'ST24189', toEmail: 'inbox@travelgenix.example', message: '' } }, res);
    } finally { globalThis.fetch = real; }
    return { out, sent };
  };
  const stranger = await drive(false);
  ok('a public caller still cannot send a booking to anyone but its customer', stranger.out.code === 400 && stranger.out.body.error === 'recipient_mismatch');
  const ours = await drive(true);
  ok('our own worker can send it to the test inbox', ours.out.code === 200 && ours.sent.length === 1,
    JSON.stringify(ours.out.body));
}

console.log('\nThe published contract matches the code\n');
{
  const doc = readFileSync(new URL('../public/booking-confirmations-api.html', import.meta.url), 'utf8');
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  ok('the page names this endpoint', doc.includes('/api/v1/booking-confirmations'));
  ok('and its four fields, and no others', ['applicationId', 'orderId', 'orderKey', 'email'].every((f) => doc.includes('>' + f + ' <'))
    && !/reminderType|amountDue/.test(doc.replace(/Payment Reminders/g, '')));
  ok('the example sends an email address', /"email"<\/span>:\s*<span class="s">"[^"@]+@[^"]+"/.test(doc));
  ok('and every status the endpoint answers with, and no 409 (repeats send)',
    ['202', '400', '401', '429', '500'].every((c) => doc.includes('>' + c + '<')) && !doc.includes('>409<') && !/status:\s*"duplicate"|"duplicate"<\/span>/.test(doc));
  ok('it tells the caller that every request sends', /every (accepted )?request sends/i.test(doc));
  ok('the page is served at /booking-confirmations-api',
    (vercel.rewrites || []).some((r) => r.source === '/booking-confirmations-api' && r.destination === '/booking-confirmations-api.html'));
  ok('no em dashes in the new copy (house style)', !doc.slice(doc.indexOf('<body>')).includes('&mdash;') && !doc.includes('—'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
