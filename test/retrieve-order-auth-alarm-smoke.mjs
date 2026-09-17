/**
 * The alarm has to actually ring (17 Sep 2026).
 *
 * The companion suite, travelify-credentials-alert-smoke.mjs, reads the source
 * and checks the shape of the change. It passed 23 out of 23 while the feature
 * did not work at all: the branch that records a refusal read two variables
 * that were block-scoped to an `else` it sat outside, so every 401 threw a
 * ReferenceError into the outer catch, the marker was never written and the
 * monitor had nothing to find. A regex over the source cannot see a scope.
 *
 * So this suite RUNS the endpoint. Airtable, Travelify and Redis are all
 * answered by one fetch stub, and the assertions are about what actually
 * happened: what the visitor was sent, and what reached storage.
 *
 * It lives in its own file because api/_redis.js captures its credentials in
 * module constants at load, so "storage configured" and "storage absent" are
 * facts about a PROCESS, not about a test case. The companion suite needs the
 * second; this one needs the first.
 *
 * Run: node test/retrieve-order-auth-alarm-smoke.mjs
 *      (npm run test:retrieve-order-auth-alarm)
 */

// Before any import: api/_redis.js reads these once, at load.
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.AIRTABLE_KEY = 'test-airtable-key';

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const handler = (await import('../api/retrieve-order.js')).default;

const WIDGET_ID = 'tgw_1784117967744_5z7g2d';
const CLIENT_REC = 'recwcIVJl0fKOswaJ';
const APP_ID = 474;
// Not a real key. Long enough to be recognisable if it ever leaked into a log.
const API_KEY = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

const CLIENT_FIELDS = {
  appId: 'fldE9dL05t0x0S88w',
  apiKey: 'fld9X1nvAgy0sHQ4B',
  clientName: 'fldx9CiWtSm5lX7MF',
  email: 'fldVRiIAlrTjxnNHP',
};

let ipSeq = 0;

/**
 * Drive one lookup with Travelify answering however the case needs.
 *
 * Returns what the visitor was sent, every Redis write that was attempted and
 * everything that was logged, so a case can assert on the outcome rather than
 * on the shape of the code that produced it.
 */
async function lookup({ travelifyStatus, travelifyBody, widgetOverrides = {} }) {
  const redisWrites = [];
  const logged = [];
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const realWarn = console.warn;
  const realLog = console.log;
  console.error = (...a) => logged.push(a.join(' '));
  console.warn = (...a) => logged.push(a.join(' '));
  console.log = (...a) => logged.push(a.join(' '));

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://redis.test.invalid')) {
      redisWrites.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
    }
    if (u.includes('api.airtable.com') && u.includes('tblVAThVqAjqtria2')) {
      return new Response(JSON.stringify({ records: [{
        id: 'recIXzjOF90a9TEqX',
        fields: Object.assign({
          WidgetID: WIDGET_ID,
          WidgetType: 'My Booking',
          Status: 'Active',
          ClientRecordId: CLIENT_REC,
          ClientEmail: 'luke.livsey@agendas.group',
        }, widgetOverrides),
      }] }), { status: 200 });
    }
    if (u.includes('api.airtable.com') && u.includes('tblikekpaTKraMktZ')) {
      return new Response(JSON.stringify({
        id: CLIENT_REC,
        fields: {
          [CLIENT_FIELDS.appId]: APP_ID,
          [CLIENT_FIELDS.apiKey]: API_KEY,
          [CLIENT_FIELDS.clientName]: 'Better Lifestyle',
          [CLIENT_FIELDS.email]: 'cgeorge@betterlifestyle.com',
        },
      }), { status: 200 });
    }
    if (u.includes('api.travelify.io')) {
      return new Response(travelifyBody, { status: travelifyStatus });
    }
    throw new Error('unexpected fetch in test: ' + u);
  };

  // A fresh IP per case: the endpoint rate limits per IP and per IP+widget,
  // and a shared address would turn a later case into a 429.
  const ip = '203.0.113.' + (++ipSeq);
  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    body: {
      widgetId: WIDGET_ID,
      orderRef: 'TG120486',
      emailAddress: 'chandnin@tripgift.com',
      departDate: '2026-09-09',
    },
  };
  const sent = { status: 0, body: null, headers: {} };
  const res = {
    setHeader: (k, v) => { sent.headers[k] = v; },
    status(code) { sent.status = code; return this; },
    json(obj) { sent.body = obj; return this; },
    end() { return this; },
  };

  try {
    await handler(req, res);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    console.warn = realWarn;
    console.log = realLog;
  }
  return { sent, redisWrites, logged };
}

const AUTH_BODY = JSON.stringify({ code: '401', message: 'Missing or invalid application credentials' });

console.log('A refused key raises the alarm');
{
  const r = await lookup({ travelifyStatus: 401, travelifyBody: AUTH_BODY });
  const write = r.redisWrites.find((w) => String(w[1] || '').startsWith('travelify:cred-rejected:'));
  ok('the marker reaches storage', !!write,
    'redis writes: ' + JSON.stringify(r.redisWrites));
  // The bug this file exists for: the branch threw before it could write.
  ok('and nothing threw on the way there',
    !r.logged.some((l) => /is not defined|ReferenceError/.test(l)),
    r.logged.join('\n      '));

  const payload = write ? JSON.parse(write[2]) : {};
  ok('it names the app somebody has to ask Travelify about', String(payload.appId) === String(APP_ID),
    JSON.stringify(payload));
  ok('and the widget, so the embed can be found', payload.widgetId === WIDGET_ID);
  ok('and the client it belongs to', String(write ? write[1] : '').endsWith(CLIENT_REC),
    write ? write[1] : 'no write');
  ok('it repeats what Travelify actually said',
    /Missing or invalid application credentials/.test(payload.reason || ''), payload.reason);
  ok('it is written NX, so retries cannot overwrite the first one',
    !!write && write.includes('NX'));
  ok('and with an expiry, so a fixed key clears itself',
    !!write && write.includes('EX'));
}

console.log('The visitor learns nothing from it');
{
  const r = await lookup({ travelifyStatus: 401, travelifyBody: AUTH_BODY });
  ok('a refused key still answers 404, not 401', r.sent.status === 404, String(r.sent.status));
  ok('with the same words a wrong reference gets',
    /couldn't find a confirmed booking/.test(r.sent.body?.message || ''), JSON.stringify(r.sent.body));
  const body = JSON.stringify(r.sent.body);
  ok('nothing about the credentials travels in the response',
    !body.includes(String(APP_ID)) && !body.includes(API_KEY) && !/credential/i.test(body), body);
}

console.log('The key itself is never written down');
{
  const echo = JSON.stringify({ message: 'Bad key ' + API_KEY + ' for app 474' });
  const r = await lookup({ travelifyStatus: 401, travelifyBody: echo });
  const write = r.redisWrites.find((w) => String(w[1] || '').startsWith('travelify:cred-rejected:'));
  const payload = write ? JSON.parse(write[2]) : {};
  // An upstream that echoes the key back must not make us the one that logs it.
  ok('a key echoed back by Travelify is scrubbed out of the reason',
    !!payload.reason && !payload.reason.includes(API_KEY), payload.reason);
  ok('the reason still says what went wrong', /Bad key/.test(payload.reason || ''), payload.reason);
  ok('and it never reaches the log either',
    !r.logged.some((l) => l.includes(API_KEY)), r.logged.join('\n      '));
}

console.log('Only an auth refusal raises it');
{
  for (const [status, body, why] of [
    [404, JSON.stringify({ code: '404', message: 'Order not found' }), 'a booking that is not there'],
    [500, 'upstream exploded', 'an upstream fault'],
    [503, 'unavailable', 'an upstream outage'],
  ]) {
    const r = await lookup({ travelifyStatus: status, travelifyBody: body });
    const write = r.redisWrites.find((w) => String(w[1] || '').startsWith('travelify:cred-rejected:'));
    ok(why + ' is not a credentials alarm', !write, 'wrote: ' + JSON.stringify(write || null));
    ok('and the visitor still gets the calm answer (' + status + ')', r.sent.status === 404, String(r.sent.status));
  }
}

console.log('A 403 is treated the same as a 401');
{
  const r = await lookup({ travelifyStatus: 403, travelifyBody: JSON.stringify({ message: 'Forbidden for this application' }) });
  const write = r.redisWrites.find((w) => String(w[1] || '').startsWith('travelify:cred-rejected:'));
  ok('a refusal by any name is recorded', !!write);
  ok('and carries the reason', /Forbidden for this application/.test(write ? JSON.parse(write[2]).reason || '' : ''));
}

console.log('An upstream that says nothing still raises the alarm');
{
  const r = await lookup({ travelifyStatus: 401, travelifyBody: '' });
  const write = r.redisWrites.find((w) => String(w[1] || '').startsWith('travelify:cred-rejected:'));
  ok('an empty body does not lose the marker', !!write);
  ok('the reason is simply blank rather than invented',
    write ? JSON.parse(write[2]).reason === '' : false);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
