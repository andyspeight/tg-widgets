/**
 * Payment Reminder API (phase 1) — POST /api/v1/payment-reminders and the
 * cron worker. Drives the REAL handlers with a URL-routed mocked fetch
 * (Airtable, Upstash Redis, Travelify, the self-kick), per the house test
 * convention. Also pins the _auth.js filterByFormula fix: field IDS in
 * {braces} silently match nothing, so the credential lookups must use
 * display names ("Travelify App ID", "Email").
 *
 * Run: node test/payment-reminders-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// ── Env BEFORE imports ───────────────────────────────────────────────────────
const REDIS_URL = 'https://redis.test.local';
process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.PAYMENT_REMINDER_API_KEY = 'shared-secret-for-the-core-0123456789';
process.env.CRON_SECRET = 'cron-secret-test';
process.env.UPSTASH_REDIS_REST_URL = REDIS_URL;
process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token-test';
process.env.TG_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';
process.env.TG_SELF_ORIGIN = 'https://self.test.local';

const CLIENTS_TABLE = 'tblikekpaTKraMktZ';
const REMINDERS_TABLE = 'tblHwa7PI2BSGjXZV';
const F = { appId: 'fldE9dL05t0x0S88w', apiKey: 'fld9X1nvAgy0sHQ4B', clientName: 'fldx9CiWtSm5lX7MF' };

// ── Mock world ───────────────────────────────────────────────────────────────
const state = {
  redis: new Map(),
  redisDown: false,
  clients: {},          // appId(number) -> { apiKey, name }
  creates: [],          // captured reminder-record creates
  createFail: false,
  dedupeFail: false,
  accepted: [],         // worker queue
  patches: [],          // captured PATCHes
  travelify: null,      // (url) => ({ status, body })
  kicks: [],
  calls: [],
};

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? String(opts.body) : '';
  state.calls.push({ url: u, method, body, headers: opts.headers || {} });
  const json = (status, obj) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });

  // Upstash Redis
  if (u === REDIS_URL) { // claimNxEx: ["SET", key, value, "NX", "EX", ttl]
    if (state.redisDown) return json(500, {});
    const [cmd, key, value] = JSON.parse(body);
    if (cmd !== 'SET') return json(400, {});
    if (state.redis.has(key)) return json(200, { result: null });
    state.redis.set(key, value);
    return json(200, { result: 'OK' });
  }
  if (u.startsWith(REDIS_URL + '/get/')) {
    if (state.redisDown) return json(500, {});
    const key = decodeURIComponent(u.slice((REDIS_URL + '/get/').length));
    return json(200, { result: state.redis.get(key) ?? null });
  }
  if (u.startsWith(REDIS_URL + '/del/')) {
    const key = decodeURIComponent(u.slice((REDIS_URL + '/del/').length));
    return json(200, { result: state.redis.delete(key) ? 1 : 0 });
  }

  // Airtable: Clients registry lookup
  if (u.includes(`/${CLIENTS_TABLE}?`)) {
    const decoded = decodeURIComponent(u);
    const m = decoded.match(/\{Travelify App ID\}=(\d+)/);
    const client = m ? state.clients[Number(m[1])] : null;
    const records = client
      ? [{ id: 'recCLIENT0000001', fields: { [F.appId]: Number(m[1]), [F.apiKey]: client.apiKey, [F.clientName]: client.name } }]
      : [];
    return json(200, { records });
  }

  // Airtable: Payment Reminders table
  if (u.includes(`/${REMINDERS_TABLE}?`)) {
    const decoded = decodeURIComponent(u);
    if (decoded.includes(`{IdempotencyKey}=`)) {
      if (state.dedupeFail) return json(500, { error: 'boom' });
      // Behave like the real table: return the record if one was created.
      const m2 = decoded.match(/\{IdempotencyKey\}='([^']*)'/);
      const hit = m2 ? state.creates.find(c => c.IdempotencyKey === m2[1]) : null;
      return json(200, { records: hit ? [{ id: 'recHIT', fields: { Reference: hit.Reference } }] : [] });
    }
    if (decoded.includes(`{Status}='Accepted'`)) {
      return json(200, { records: state.accepted });
    }
    return json(200, { records: [] });
  }
  if (u.endsWith(`/${REMINDERS_TABLE}`) && method === 'POST') {
    if (state.createFail) return json(500, { error: 'boom' });
    const rec = JSON.parse(body).records[0];
    state.creates.push(rec.fields);
    return json(200, { records: [{ id: `recREM${state.creates.length}`, fields: rec.fields }] });
  }
  if (u.includes(`/${REMINDERS_TABLE}/rec`) && method === 'PATCH') {
    state.patches.push({ id: u.split('/').pop(), fields: JSON.parse(body).fields });
    return json(200, { id: 'rec', fields: {} });
  }

  // Travelify order fetch
  if (u.startsWith('https://api.travelify.io/account/order/')) {
    const r = state.travelify ? state.travelify(u) : { status: 404, body: {} };
    return json(r.status, r.body);
  }

  // Self-kick
  if (u.startsWith(process.env.TG_SELF_ORIGIN)) {
    state.kicks.push({ url: u, headers: opts.headers || {} });
    return json(200, { ok: true });
  }

  throw new Error(`unmocked fetch: ${method} ${u}`);
};

const { default: intake } = await import('../api/v1/payment-reminders.js');
const { default: worker } = await import('../api/cron/payment-reminders.js');

function mockRes() {
  return {
    statusCode: 200, body: undefined,
    setHeader() {}, getHeader() { return undefined; },
    status(n) { this.statusCode = n; return this; },
    json(o) { if (this.body === undefined) this.body = o; return this; },
    end() { return this; },
  };
}
const request = (body, { key = process.env.PAYMENT_REMINDER_API_KEY, method = 'POST', idem } = {}) => ({
  method,
  headers: { 'x-api-key': key, ...(idem ? { 'idempotency-key': idem } : {}) },
  body,
  socket: { remoteAddress: '10.0.0.1' },
});
const GUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const valid = (over = {}) => ({
  applicationId: 777, orderId: 100482113, orderKey: GUID.toUpperCase(),
  reminderType: 'DepositBalance', amountDue: 749.5, currency: 'gbp', dueDate: '2026-08-15',
  ...over,
});
state.clients[777] = { apiKey: 'KEY-777', name: 'Free From Travel' };

// ── A. Method, auth, validation ──────────────────────────────────────────────
let res = mockRes();
await intake(request(valid(), { method: 'GET' }), res);
ok(res.statusCode === 405, 'GET → 405');

state.calls = [];
res = mockRes();
await intake(request(valid(), { key: '' }), res);
ok(res.statusCode === 401 && res.body && Object.keys(res.body).length === 0, 'missing X-Api-Key → 401 with an EMPTY body (no detail leaks)');
ok(!state.calls.some(c => c.url.includes('airtable')), 'no Airtable touched before auth passes');

res = mockRes();
await intake(request(valid(), { key: 'wrong-key-entirely-wrong-wrong-wrong' }), res);
ok(res.statusCode === 401 && res.body && Object.keys(res.body).length === 0, 'wrong X-Api-Key → 401 with an empty body');

const realSecret = process.env.PAYMENT_REMINDER_API_KEY;
process.env.PAYMENT_REMINDER_API_KEY = '';
res = mockRes();
await intake(request(valid()), res);
ok(res.statusCode === 500, 'unset shared secret fails CLOSED (500) — never open intake');
process.env.PAYMENT_REMINDER_API_KEY = realSecret;

res = mockRes();
await intake(request({}), res);
ok(res.statusCode === 400 && res.body.error === 'validation_failed', 'empty payload → 400 validation_failed');
for (const f of ['applicationId', 'orderId', 'orderKey', 'reminderType', 'amountDue', 'currency']) {
  ok(res.body.fields && res.body.fields[f], `field error present: ${f}`);
}

res = mockRes();
await intake(request(valid({ orderKey: 'not-a-guid' })), res);
ok(res.statusCode === 400 && res.body.fields.orderKey && !res.body.fields.orderId, 'bad orderKey → only that field flagged');
res = mockRes();
await intake(request(valid({ currency: 'GBPP' })), res);
ok(res.statusCode === 400 && res.body.fields.currency, 'four-letter currency → 400');
res = mockRes();
await intake(request(valid({ amountDue: 0 })), res);
ok(res.statusCode === 400 && res.body.fields.amountDue, 'zero amountDue → 400');
res = mockRes();
await intake(request(valid({ amountDue: -5 })), res);
ok(res.statusCode === 400 && res.body.fields.amountDue, 'negative amountDue → 400');
res = mockRes();
await intake(request(valid({ dueDate: '15-08-2026' })), res);
ok(res.statusCode === 400 && res.body.fields.dueDate, 'non-ISO dueDate → 400');

res = mockRes();
await intake(request(valid({ applicationId: 999 })), res);
ok(res.statusCode === 400 && /unknown/i.test(res.body.fields?.applicationId || ''), 'unregistered applicationId → 400 Unknown applicationId');

// ── B. Accept, dedupe, degrade ───────────────────────────────────────────────
res = mockRes();
await intake(request(valid()), res);
const accepted = res.body;
ok(res.statusCode === 202 && accepted.status === 'accepted', 'valid notification → 202 accepted');
ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accepted.reference || ''), 'reference is a server-generated GUID');
ok(!Number.isNaN(Date.parse(accepted.receivedAtUtc || '')), 'receivedAtUtc is a parseable timestamp');

const created = state.creates[0];
const today = new Date().toISOString().slice(0, 10);
ok(created && created.Reference === accepted.reference && created.Status === 'Accepted', 'record created with the returned reference, queued as Accepted');
ok(created.ApplicationId === 777 && created.OrderId === 100482113 && created.OrderKey === GUID, 'identity fields stored (orderKey normalised to lower case)');
ok(created.AmountDue === 749.5 && created.Currency === 'GBP' && created.DueDate === '2026-08-15', 'amount, currency (upper-cased) and due date stored');
ok(created.IdempotencyKey === `777|${GUID}|DepositBalance|${today}`, 'natural idempotency key: app|orderKey|type|receipt-day');
ok(created.Attempts === 0 && created.ClientName === 'Free From Travel', 'attempts start at 0; client name resolved from the registry');
ok(state.redis.get(`payrem:idem:${created.IdempotencyKey}`) === accepted.reference, 'Redis claim holds the original reference');
ok(state.kicks.length === 1 && /Bearer cron-secret-test/.test(state.kicks[0].headers.Authorization || ''), 'worker kicked once with the cron secret');

res = mockRes();
await intake(request(valid()), res);
ok(res.statusCode === 409 && res.body.status === 'duplicate' && res.body.reference === accepted.reference,
  'same-day duplicate → 409 with the ORIGINAL reference');
ok(state.creates.length === 1, 'duplicate creates no second record');
ok(state.kicks.length === 1, 'a duplicate does not kick the worker again');

res = mockRes();
await intake(request(valid({ applicationId: 250, orderKey: '11111111-2222-4333-8444-555555555555' })), res);
ok(res.statusCode === 202 && state.creates[1]?.ClientName === 'Travelgenix demo', 'Travelify demo app 250 accepted without a Clients record');

res = mockRes();
await intake(request(valid({ orderKey: '99999999-8888-4777-8666-555555555555' }), { idem: 'core-batch-42' }), res);
ok(res.statusCode === 202 && state.creates[2]?.IdempotencyKey === 'hdr:core-batch-42', 'caller Idempotency-Key header preferred over the natural key');
res = mockRes();
await intake(request(valid({ orderKey: '99999999-8888-4777-8666-000000000000' }), { idem: 'core-batch-42' }), res);
ok(res.statusCode === 409, 'same Idempotency-Key header dedupes even across different orders');

// Redis down → storage arbitration, INCLUDING the retry-after-recovery case
state.redisDown = true;
state.calls = [];
const outageKey = '12121212-3434-4545-8656-787878787878';
res = mockRes();
await intake(request(valid({ orderKey: outageKey })), res);
const outageRef = res.body?.reference;
ok(res.statusCode === 202, 'Redis outage: notification still accepted via storage fallback');
ok(state.calls.some(c => decodeURIComponent(c.url).includes(`{IdempotencyKey}='`)), 'fallback consulted the IdempotencyKey lookup');

res = mockRes();
await intake(request(valid({ orderKey: outageKey })), res);
ok(res.statusCode === 409 && res.body.reference === outageRef, 'Redis still down: storage arbitration returns 409 + original reference');

state.redisDown = false; // recovery — the outage-accepted record has NO Redis claim
const createsBefore = state.creates.length;
res = mockRes();
await intake(request(valid({ orderKey: outageKey })), res);
ok(res.statusCode === 409 && res.body.reference === outageRef && state.creates.length === createsBefore,
  'retry AFTER Redis recovery still 409s with the original reference (storage backs the claim up)');

state.redisDown = true;
state.dedupeFail = true;
res = mockRes();
await intake(request(valid({ orderKey: '34343434-5656-4777-8888-909090909090' })), res);
ok(res.statusCode === 500, 'Redis down AND fallback down → 500 (refuse rather than risk a double-send)');
state.redisDown = false;

res = mockRes();
await intake(request(valid({ orderKey: '45454545-6767-4888-8999-010101010101' })), res);
ok(res.statusCode === 202, 'storage-check blip while Redis holds the claim does not block intake');
state.dedupeFail = false;

// Per-IP burst protection (distinct IP so the main tests are unaffected)
const burstReq = () => ({ method: 'POST', headers: { 'x-api-key': 'wrong' }, body: {}, socket: { remoteAddress: '10.9.9.9' } });
const realWarn = console.warn; console.warn = () => {};
let burstRes;
for (let i = 0; i < 2001; i++) { burstRes = mockRes(); await intake(burstReq(), burstRes); }
console.warn = realWarn;
ok(burstRes.statusCode === 429 && burstRes.body.error === 'rate_limited', 'per-IP burst beyond the cap → 429 rate_limited');

// Failed record write releases the claim so the core's retry is not 409'd
state.createFail = true;
const retryKey = 'abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd';
res = mockRes();
await intake(request(valid({ orderKey: retryKey })), res);
ok(res.statusCode === 500, 'record write failure → 500 (core retries)');
state.createFail = false;
res = mockRes();
await intake(request(valid({ orderKey: retryKey })), res);
ok(res.statusCode === 202, 'retry after failed write succeeds (idempotency claim was released)');

// ── C. Worker ────────────────────────────────────────────────────────────────
res = mockRes();
await worker({ method: 'GET', headers: {} }, res);
ok(res.statusCode === 401, 'worker without auth → 401');
res = mockRes();
await worker({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, res);
ok(res.statusCode === 401, 'worker with wrong bearer → 401');
const cronReq = () => ({ method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

state.accepted = [];
res = mockRes();
await worker(cronReq(), res);
ok(res.statusCode === 200 && res.body.picked === 0, 'empty queue → clean 200');

const queued = (over = {}) => ({
  id: 'recREMWORK1',
  fields: {
    Reference: 'ref-work-1', ApplicationId: 777, OrderId: 100482113,
    OrderKey: GUID, ReminderType: 'DepositBalance', Attempts: 0, ...over,
  },
});
state.accepted = [queued()];
state.patches = [];
state.travelify = () => ({ status: 200, body: { id: 100482113, status: 'Confirmed', currency: 'GBP', items: [{}], customerEmail: 'george@freefromtravel.com' } });
res = mockRes();
await worker(cronReq(), res);
ok(res.statusCode === 200 && res.body.fetched === 1, 'worker fetches the order and reports it');
const tCall = state.calls.findLast(c => c.url.includes('api.travelify.io'));
ok(tCall && tCall.url.includes(`/account/order/100482113/${GUID}`), 'order fetched on the id+key path');
ok(tCall && tCall.headers.Authorization === 'Token 777:KEY-777' && tCall.headers.Origin, 'Travelify called with the client credentials + mandatory Origin header');
const patch = state.patches[0];
ok(patch && patch.fields.Status === 'Fetched' && patch.fields.Attempts === 1 && patch.fields.LastError === '', 'record advanced to Fetched, error cleared');
ok(!Number.isNaN(Date.parse(patch.fields.ProcessedAtUtc || '')), 'ProcessedAtUtc stamped');

state.redis.clear(); // release the processing lock between worker runs
state.accepted = [queued({ Reference: 'ref-work-2' })];
state.patches = [];
state.travelify = () => ({ status: 500, body: {} });
res = mockRes();
await worker(cronReq(), res);
ok(state.patches[0] && state.patches[0].fields.Attempts === 1 && /HTTP 500/.test(state.patches[0].fields.LastError), 'upstream failure stamps LastError + attempt');
ok(state.patches[0].fields.Status === undefined, 'failure below the cap keeps the row queued (no status change)');

state.redis.clear();
state.accepted = [queued({ Reference: 'ref-work-3', Attempts: 4, ProcessedAtUtc: new Date(Date.now() - 13 * 3600000).toISOString() })];
state.patches = [];
res = mockRes();
await worker(cronReq(), res);
ok(state.patches[0] && state.patches[0].fields.Status === 'Failed', 'attempt cap reached → Failed');

state.redis.clear();
state.accepted = [queued({ Reference: 'ref-work-4' })];
state.patches = [];
state.travelify = () => ({ status: 200, body: { id: 555 } });
res = mockRes();
await worker(cronReq(), res);
ok(state.patches[0] && /mismatch/.test(state.patches[0].fields.LastError || ''), 'order id mismatch is treated as a failure, not a success');

state.redis.clear();
state.accepted = [queued({ Reference: 'ref-work-bkoff', Attempts: 1, ProcessedAtUtc: new Date().toISOString() })];
state.patches = [];
state.calls = [];
res = mockRes();
await worker(cronReq(), res);
ok(res.body.waiting === 1 && state.patches.length === 0 && !state.calls.some(c => c.url.includes('travelify')),
  'a freshly-failed record backs off — no immediate re-attempt on the next sweep');

state.redis.clear();
state.accepted = [queued({ Reference: 'ref-work-bkoff2', Attempts: 1, ProcessedAtUtc: new Date(Date.now() - 20 * 60000).toISOString() })];
state.patches = [];
state.travelify = () => ({ status: 500, body: {} });
res = mockRes();
await worker(cronReq(), res);
ok(state.patches.length === 1 && state.patches[0].fields.Attempts === 2, 'backoff window elapsed → retried (attempt 2)');

state.redis.clear();
state.redis.set('payrem:lock:ref-work-5', '1');
state.accepted = [queued({ Reference: 'ref-work-5' })];
state.patches = [];
state.calls = [];
res = mockRes();
await worker(cronReq(), res);
ok(res.body.skipped === 1 && state.patches.length === 0 && !state.calls.some(c => c.url.includes('travelify')),
  'a locked record is skipped entirely (kick/cron overlap defused)');

state.redis.clear();
state.accepted = [queued({ Reference: 'ref-work-6', ApplicationId: 999 })];
state.patches = [];
res = mockRes();
await worker(cronReq(), res);
ok(state.patches[0] && /no client found/.test(state.patches[0].fields.LastError || ''), 'unknown applicationId at processing time is stamped, not thrown');

// ── D. Source guards ─────────────────────────────────────────────────────────
const auth = readFileSync(new URL('../api/_auth.js', import.meta.url), 'utf8');
ok(/\{\$\{TG_CLIENT_FIELD_NAMES\.travelifyAppId\}\}=/.test(auth), 'appId lookup filters on the DISPLAY NAME (field ids in formulas match nothing)');
ok(/LOWER\(\{\$\{TG_CLIENT_FIELD_NAMES\.email\}\}\)/.test(auth) && /LOWER\(\{\$\{TG_USER_FIELD_NAMES\.email\}\}\)/.test(auth), 'email lookups filter on display names too');
ok(!/filterByFormula[^\n]*TG_CLIENT_FIELDS\./.test(auth), 'no formula still built from the field-ID map');

const lib = readFileSync(new URL('../api/_lib/payment-reminders.js', import.meta.url), 'utf8');
ok(/timingSafeEqual/.test(lib), 'API key compare is constant-time');
const ep = readFileSync(new URL('../api/v1/payment-reminders.js', import.meta.url), 'utf8');
ok(!/Access-Control-Allow-Origin/.test(ep), 'no CORS on the server-to-server intake');
ok(!/req\.headers\.host/.test(ep), 'self-kick origin is never derived from request headers (CRON_SECRET cannot be redirected)');

const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
ok(/"\/api\/cron\/payment-reminders"/.test(vercel) && /"api\/cron\/payment-reminders\.js"/.test(vercel), 'cron schedule + function config registered');
ok(/"api\/v1\/payment-reminders\.js"/.test(vercel), 'intake endpoint has its function config');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
