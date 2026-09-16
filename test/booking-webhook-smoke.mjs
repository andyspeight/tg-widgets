/**
 * A new booking emails its own confirmation (16 Sep 2026).
 *
 * Andy: "We are going to add more functionality to the My Booking widget using
 * webhooks to be told when there is a new booking, and then use the existing
 * API to call the booking details and then send out a confirmation to the
 * client (this is something we are taking over from Travelify, which used to
 * send the email)."
 *
 * The payloads below are the published ones, copied from
 * https://university.travelgenix.io/webhooks verbatim, because the whole
 * endpoint is a promise about what that page says we will accept.
 *
 * What the contract forces, and what this suite therefore checks:
 *
 *  - FIVE SECONDS to answer, so the endpoint only verifies, records and
 *    replies. Anything slower is the worker's job.
 *  - THE SIGNATURE COVERS THE RAW BYTES. Re-serialising the parsed JSON would
 *    change the whitespace and never match, so the endpoint reads the stream
 *    itself and checks the signature before it trusts a single field.
 *  - ONE EMAIL PER BOOKING. A confirmation must never go twice, so a repeat of
 *    the same event is answered 200 as a duplicate rather than queued.
 *  - OFF BY DEFAULT, twice over: the global switch, and each client's own in
 *    their My Booking editor. Travelify still sends its own confirmation until
 *    a client is moved across, so the failure we are guarding against is a
 *    customer getting two emails about the same booking.
 *
 * The endpoint and the worker are driven for real, with only Airtable,
 * Travelify and SendGrid replaced.
 *
 * Run: node test/booking-webhook-smoke.mjs   (npm run test:booking-webhook)
 */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_PAT = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.BOOKING_WEBHOOK_SECRET = 'a-shared-security-key';
process.env.CRON_SECRET = 'cron-secret-value';
process.env.TG_INTERNAL_KEY = 'internal-key-value';
process.env.TG_SELF_ORIGIN = 'https://tg-widgets.test';
delete process.env.BOOKING_CONFIRMATION_SEND_ENABLED;

const lib = await import('../api/_lib/booking-confirmations.js');
const endpoint = (await import('../api/v1/booking-webhook.js')).default;
const worker = await import('../api/cron/booking-confirmations.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const SECRET = 'a-shared-security-key';
const APP_ID = 100;
const ORDER_KEY = 'F461B152-B2EB-40AF-81B2-E8BEFDE80A43';

/** The published order.complete payload, verbatim. */
const ORDER_COMPLETE = {
  eventtype: 'order.complete',
  appid: APP_ID,
  appidentifier: 'demoapp',
  data: {
    id: 1, key: ORDER_KEY, status: 'Confirmed', language: 'en', currency: 'GBP',
    amount: 1125.98, itemscount: 2, customertitle: 'Mr', customerfirstname: 'Demo',
    customersurname: 'Customer', customeremail: 'demo@travelgenix.io',
    created: '2023-01-26T11:33:10Z',
  },
  url: '/admin/orders/1/F461B152-B2EB-40AF-81B2-E8BEFDE80A43',
  timestamp: '2023-01-26T12:00:00Z',
};
const CUSTOMER_CREATE = {
  eventtype: 'customer.create', appid: APP_ID, appidentifier: 'demoapp',
  data: { id: 1, key: ORDER_KEY, title: 'Mr', firstname: 'Demo', surname: 'Customer',
    email: 'demo@travelgenix.io', created: '2023-01-26T11:33:10Z' },
  url: '/admin/customers/1/' + ORDER_KEY, timestamp: '2023-01-26T12:00:00Z',
};
const sign = (body, secret = SECRET) =>
  crypto.createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('base64');

/** A request the way Vercel hands one to a bodyParser:false function. */
function request(bodyText, { method = 'POST', signature, headers = {} } = {}) {
  const req = Readable.from([Buffer.from(bodyText, 'utf8')]);
  req.method = method;
  req.headers = { 'content-type': 'application/json; charset=utf-8',
    'user-agent': 'Travelgenix-Webhook', 'x-forwarded-for': '203.0.113.7', ...headers };
  if (signature !== null) req.headers['travelgenix-signature'] = signature ?? sign(bodyText);
  return req;
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

/** Airtable, Travelify and our own endpoints, all stubbed. */
function network({ rows = [], client = null, order = null, sendOk = true } = {}) {
  const calls = [];
  const created = [];
  const patched = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method: opts.method || 'GET', body, headers: opts.headers || {} });
    const reply = (payload, status = 200) => ({
      ok: status < 400, status,
      json: async () => payload, text: async () => JSON.stringify(payload),
    });

    if (u.includes('/api/booking-email')) {
      return sendOk ? reply({ ok: true, messageId: 'sg-msg-1', sentTo: body.toEmail })
        : reply({ error: 'send_failed' }, 500);
    }
    if (u.includes('/api/cron/booking-confirmations')) return reply({ ok: true });
    if (u.includes('api.travelify.io/account/order/')) {
      return order ? reply(order) : reply({ code: '404' }, 404);
    }
    // Airtable
    if (u.includes(lib.CONFIRMATIONS_TABLE)) {
      if ((opts.method || 'GET') === 'POST') { created.push(body.records[0].fields); return reply({ records: [{ id: 'recNEW0000000001' }] }); }
      if (opts.method === 'PATCH') { patched.push(body.fields); return reply({ id: 'recNEW0000000001' }); }
      return reply({ records: rows });
    }
    // Clients lookup (by Travelify App ID) and the widget lookup
    if (u.includes('tblVAThVqAjqtria2')) {
      return reply({ records: client?.widget ? [client.widget] : [] });
    }
    return reply({ records: client ? [client.record] : [] });
  };
  return { calls, created, patched, restore: () => { globalThis.fetch = real; } };
}

const CLIENT = {
  record: { id: 'recCLIENT00000001', fields: {
    fldE9dL05t0x0S88w: '100',            // Travelify App ID
    fld9X1nvAgy0sHQ4B: 'demo-api-key',   // API key
    fldx9CiWtSm5lX7MF: 'Sunrise Travel', // Client name
  } },
  widget: { id: 'recWIDGET00000001', fields: {
    WidgetType: 'My Booking', Status: 'Active', WidgetID: 'tgw_mybooking_1',
    ClientRecordId: 'recCLIENT00000001', ClientName: 'Sunrise Travel',
    Config: JSON.stringify({
      brand: { name: 'Sunrise Travel' }, support: { email: 'hi@sunrise.example', phone: '01202 1' },
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

console.log('The signature is checked against the raw bytes');
{
  const text = JSON.stringify(ORDER_COMPLETE);
  ok('the published signature scheme verifies', lib.verifyWebhookSignature(text, sign(text), SECRET));
  ok('a Buffer body verifies the same', lib.verifyWebhookSignature(Buffer.from(text), sign(text), SECRET));
  ok('a different key does not', !lib.verifyWebhookSignature(text, sign(text, 'other-key'), SECRET));
  ok('a tampered body does not',
    !lib.verifyWebhookSignature(text.replace('1125.98', '9999.99'), sign(text), SECRET));
  ok('re-serialised JSON does NOT verify, which is why we read the stream',
    !lib.verifyWebhookSignature(JSON.stringify(JSON.parse(text), null, 2), sign(text), SECRET));
  ok('no signature does not', !lib.verifyWebhookSignature(text, '', SECRET)
    && !lib.verifyWebhookSignature(text, undefined, SECRET));
  ok('no configured key refuses everything rather than accepting anything',
    !lib.verifyWebhookSignature(text, sign(text), ''));
  ok('a signature of the wrong length is refused rather than compared',
    !lib.verifyWebhookSignature(text, 'AAAA', SECRET)
    && !lib.verifyWebhookSignature(text, Buffer.alloc(64).toString('base64'), SECRET));
  ok('one wrong byte is refused', (() => {
    const b = Buffer.from(sign(text), 'base64'); b[0] ^= 0xff;
    return !lib.verifyWebhookSignature(text, b.toString('base64'), SECRET);
  })());
  ok('rubbish where base64 should be does not throw', !lib.verifyWebhookSignature(text, '!!!not base64!!!', SECRET));
}

console.log('The published payloads validate, and nothing else does');
{
  const good = lib.validateWebhookPayload(ORDER_COMPLETE);
  ok('order.complete is accepted', Object.keys(good.errors).length === 0, JSON.stringify(good.errors));
  ok('and read into the fields the worker needs',
    good.value.orderId === 1 && good.value.orderKey === ORDER_KEY
    && good.value.applicationId === 100 && good.value.eventType === 'order.complete'
    && good.value.customerEmail === 'demo@travelgenix.io' && good.value.amount === 1125.98
    && good.value.currency === 'GBP');
  ok('order.cancel and order.update are accepted too, so the connection stays healthy',
    !Object.keys(lib.validateWebhookPayload({ ...ORDER_COMPLETE, eventtype: 'order.cancel' }).errors).length
    && !Object.keys(lib.validateWebhookPayload({ ...ORDER_COMPLETE, eventtype: 'order.update' }).errors).length);
  ok('a customer event is not one of ours', !!lib.validateWebhookPayload(CUSTOMER_CREATE).errors.eventtype);
  ok('basket.create is not either', !!lib.validateWebhookPayload({ ...ORDER_COMPLETE, eventtype: 'basket.create' }).errors.eventtype);

  const bad = (over) => lib.validateWebhookPayload({ ...ORDER_COMPLETE, ...over }).errors;
  ok('a missing appid is a validation error', !!bad({ appid: undefined }).appid);
  ok('so is a non-numeric one', !!bad({ appid: 'abc' }).appid && !!bad({ appid: -1 }).appid);
  ok('a missing order id is', !!bad({ data: { ...ORDER_COMPLETE.data, id: undefined } })['data.id']);
  ok('a key that is not a GUID is', !!bad({ data: { ...ORDER_COMPLETE.data, key: 'not-a-guid' } })['data.key']);
  ok('rubbish in does not throw',
    !!lib.validateWebhookPayload(null).errors.eventtype && !!lib.validateWebhookPayload('nope').errors.eventtype
    && !!lib.validateWebhookPayload({ data: 'string' }).errors['data.id']);
  ok('only order.complete sends an email',
    lib.eventSends('order.complete') && !lib.eventSends('order.cancel') && !lib.eventSends('order.update'));
  ok('the natural key is one booking, one event',
    lib.buildIdempotencyKey(good.value) === '100|1|order.complete');
  ok('nothing sends until the switch is flipped in Vercel', lib.sendingEnabled() === false);
  // The documented sample payloads all carry appid 100. That is an
  // illustration, not a registration, and treating it as the demo application
  // would have silently swallowed every confirmation for a real client holding
  // that App ID. Only the platform's own demo id counts.
  ok('the demo application is 250, the platform constant',
    lib.isDemoApp(250) && lib.isDemoApp('250') && lib.DEMO_APP_IDS.length === 1);
  ok('the appid in the documentation examples is NOT treated as a demo',
    !lib.isDemoApp(100) && !lib.isDemoApp('100'));
}

console.log('The endpoint answers the caller the way the contract says');
{
  const text = JSON.stringify(ORDER_COMPLETE);

  let net = network({ client: CLIENT });
  let { res, out } = response();
  await endpoint(request(text, { method: 'GET' }), res);
  ok('GET is refused', out.code === 405);
  net.restore();

  net = network({ client: CLIENT });
  ({ res, out } = response());
  await endpoint(request(text, { signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=' }), res);
  ok('a wrong signature is 401 with no detail', out.code === 401 && JSON.stringify(out.body) === '{}');
  ok('and nothing was looked up before it was checked',
    !net.calls.some((c) => c.url.includes('airtable')), net.calls.map((c) => c.url).join(' '));
  net.restore();

  net = network({ client: CLIENT });
  ({ res, out } = response());
  await endpoint(request(text, { signature: null }), res);
  ok('no signature at all is 401 too', out.code === 401);
  net.restore();

  net = network({ client: CLIENT });
  ({ res, out } = response());
  await endpoint(request('not json at all'), res);
  ok('a correctly signed non-JSON body is a validation error, not a crash',
    out.code === 400 && out.body.error === 'validation_failed');
  net.restore();

  net = network({ client: CLIENT });
  ({ res, out } = response());
  const badText = JSON.stringify({ ...ORDER_COMPLETE, appid: 'nope' });
  await endpoint(request(badText), res);
  ok('a signed but invalid payload names the field', out.code === 400 && !!out.body.fields.appid);
  net.restore();

  net = network({ client: null });
  ({ res, out } = response());
  await endpoint(request(text), res);
  ok('an application we do not hold is 200 ignored, so a healthy connection is not failed',
    out.code === 200 && out.body.status === 'ignored');
  ok('and no row was written', net.created.length === 0);
  net.restore();

  net = network({ client: CLIENT });
  ({ res, out } = response());
  await endpoint(request(text), res);
  ok('a real one is accepted', out.code === 200 && out.body.status === 'accepted');
  ok('with a reference for the caller to quote', /^bc_[0-9a-f-]{36}$/.test(out.body.reference || ''));
  ok('one row was queued', net.created.length === 1);
  ok('carrying the id and key the order is fetched with',
    net.created[0].OrderId === 1 && net.created[0].OrderKey === ORDER_KEY);
  ok('queued, not processed', net.created[0].Status === 'Accepted' && net.created[0].Attempts === 0);
  ok('and stamped with the event and the client',
    net.created[0].EventType === 'order.complete' && net.created[0].ClientName === 'Sunrise Travel');
  ok('nothing was emailed on the request path',
    !net.calls.some((c) => c.url.includes('booking-email')));
  ok('the worker was nudged instead',
    net.calls.some((c) => c.url.includes('/api/cron/booking-confirmations')));
  net.restore();

  net = network({ client: CLIENT, rows: [{ id: 'recOLD', fields: { Reference: 'bc_first', IdempotencyKey: '100|1|order.complete' } }] });
  ({ res, out } = response());
  await endpoint(request(text), res);
  ok('a repeat of the same booking is a duplicate, never a second email',
    out.code === 200 && out.body.status === 'duplicate' && out.body.reference === 'bc_first');
  ok('and queues nothing', net.created.length === 0);
  net.restore();

  process.env.BOOKING_WEBHOOK_SECRET = '';
  net = network({ client: CLIENT });
  ({ res, out } = response());
  await endpoint(request(text, { signature: 'anything' }), res);
  ok('a missing Security Key refuses rather than falling open', out.code === 500 && net.created.length === 0);
  process.env.BOOKING_WEBHOOK_SECRET = SECRET;
  net.restore();
}

console.log('Reading a booking date as a calendar date, not an instant');
{
  ok('the departure date is the numbers Travelify wrote',
    worker.departureDateOf(RAW_ORDER) === '2027-02-03');
  ok('the earliest start wins when a trip moves between properties',
    worker.departureDateOf({ items: [
      { startDate: '2027-02-10T00:00:00' }, { startDate: '2027-02-03T00:00:00' }] }) === '2027-02-03');
  ok('a midnight start does not slide to the day before for a reader behind UTC',
    worker.departureDateOf({ items: [{ startDate: '2027-02-03T00:00:00' }] }) === '2027-02-03');
  ok('no start date at all answers nothing rather than today',
    worker.departureDateOf({ items: [] }) === null && worker.departureDateOf(null) === null);
  ok('the reference comes off the order', worker.bookingRefOf(RAW_ORDER) === 'ST24189');
  ok('or off an item when the order has none',
    worker.bookingRefOf({ items: [{ bookingReference: 'et121109' }] }) === 'ET121109');
  ok('and is nothing rather than invented', worker.bookingRefOf({ items: [] }) === null);
}

console.log('The worker sends only what should be sent');
{
  const row = (over = {}) => ({
    id: 'recROW0000000001',
    fields: {
      Reference: 'bc_' + Math.random().toString(16).slice(2),
      ApplicationId: APP_ID, OrderId: 1, OrderKey: ORDER_KEY,
      EventType: 'order.complete', Status: 'Accepted', Attempts: 0,
      ReceivedAtUtc: new Date().toISOString(), ...over,
    },
  });
  const sweep = async (rows, opts = {}) => {
    const net = network({ rows, client: CLIENT, order: RAW_ORDER, ...opts });
    const { res, out } = response();
    await worker.default({ headers: { authorization: 'Bearer cron-secret-value' } }, res);
    net.restore();
    return { out, net };
  };

  let r = await sweep([], {});
  ok('the cron is behind the shared secret', r.out.code === 200);
  {
    const { res, out } = response();
    await worker.default({ headers: { authorization: 'Bearer wrong' } }, res);
    ok('and refuses a wrong one', out.code === 401);
  }

  r = await sweep([row({ EventType: 'order.cancel' })]);
  ok('a cancellation is recorded and skipped, not emailed',
    r.net.patched[0].Status === 'Skipped' && /does not send/.test(r.net.patched[0].LastError));
  ok('and nothing reached the email endpoint', !r.net.calls.some((c) => c.url.includes('booking-email')));

  r = await sweep([row({ ReceivedAtUtc: new Date(Date.now() - 20 * 3600 * 1000).toISOString() })]);
  ok('a push older than twelve hours is skipped rather than surprising someone',
    r.net.patched[0].Status === 'Skipped' && /too old/.test(r.net.patched[0].LastError));

  r = await sweep([row({ ApplicationId: 250 })]);
  ok('the demo application (250, the platform constant) never emails a real person',
    r.net.patched[0].Status === 'Skipped' && /demo application/.test(r.net.patched[0].LastError));

  const offClient = { ...CLIENT, widget: { ...CLIENT.widget, fields: { ...CLIENT.widget.fields,
    Config: JSON.stringify({ brand: { name: 'Sunrise Travel' }, confirmationEmail: { enabled: false, layout: [] } }) } } };
  r = await sweep([row()], { client: offClient });
  ok('a client who has not switched confirmations on gets none',
    r.net.patched[0].Status === 'Skipped' && /not switched on/.test(r.net.patched[0].LastError));
  ok('which is the guard against a customer receiving ours AND Travelify\'s',
    !r.net.calls.some((c) => c.url.includes('booking-email')));

  r = await sweep([row()]);
  ok('with the global switch off, a real booking stops at Fetched',
    r.net.patched[0].Status === 'Fetched' && r.out.body.fetched === 1);
  ok('and still nothing is emailed', !r.net.calls.some((c) => c.url.includes('booking-email')));

  process.env.BOOKING_CONFIRMATION_SEND_ENABLED = 'true';
  r = await sweep([row()]);
  const sendCall = r.net.calls.find((c) => c.url.includes('booking-email'));
  ok('with the switch on, the confirmation is sent', !!sendCall && r.net.patched[0].Status === 'Sent');
  ok('through the endpoint that already owns this email, not a second copy',
    sendCall.url === 'https://tg-widgets.test/api/booking-email' && sendCall.method === 'POST');
  ok('with the three details worked out from the order',
    sendCall.body.emailAddress === 'demo@travelgenix.io'
    && sendCall.body.departDate === '2027-02-03' && sendCall.body.orderRef === 'ST24189',
    JSON.stringify(sendCall.body));
  ok('addressed to the customer, and the client\'s own widget',
    sendCall.body.toEmail === 'demo@travelgenix.io' && sendCall.body.widgetId === 'tgw_mybooking_1');
  ok('identified as us so it is not throttled as if it were one visitor',
    sendCall.headers['X-TG-Internal-Key'] === 'internal-key-value'
    && sendCall.headers['X-TG-Real-IP'] === 'bookconf:100');
  ok('and the row records who it went to', r.net.patched[0].SentTo === 'demo@travelgenix.io'
    && r.net.patched[0].MessageId === 'sg-msg-1');

  r = await sweep([row()], { sendOk: false });
  ok('a failed send is parked for retry, not thrown away',
    r.net.patched[0].Status === 'Fetched' && r.net.patched[0].Attempts === 1
    && /send failed/.test(r.net.patched[0].LastError));
  ok('and the fifth failure gives up rather than retrying for ever',
    (await sweep([row({ Attempts: 4, ProcessedAtUtc: new Date(Date.now() - 86400000).toISOString() })], { sendOk: false }))
      .net.patched[0].Status === 'Failed');

  r = await sweep([row()], { order: null });
  ok('an order we cannot fetch is retried rather than skipped',
    r.net.patched[0].Status !== 'Skipped' && r.net.patched[0].Attempts === 1);
  delete process.env.BOOKING_CONFIRMATION_SEND_ENABLED;
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
