/**
 * Enquiry submit — form lookup must resolve the RIGHT record and never turn an
 * Airtable failure into "Form not found."
 *
 * The bug this guards against (2026-07-18): the create path never stamped the
 * Sequential field, so the Form ID formula rendered the SAME "EF-000" for
 * every form. The submit endpoint looked forms up by {Form ID} with
 * maxRecords=1, resolved an arbitrary (Draft) record, and told every visitor
 * on every Live form "Form not found." on send. Two clients reported it before
 * it was caught. Fixes under test, driving the REAL handler with mocked fetch:
 *   - the lookup keys on {Widget ID} (unique) when the payload carries one,
 *     with {Form ID} kept only as legacy fallback for cached widget code;
 *   - an Airtable non-OK (429/5xx) THROWS and answers a retryable 503 —
 *     never a false 404 — with one server-side retry first;
 *   - a Draft form answers a distinct message, not "Form not found.";
 *   - source guards on the widget + config endpoint changes.
 *
 * Uses honeypot-filled payloads as a zero-write probe: the handler resolves
 * the form (steps 6-7), then honeypot short-circuits with a fake 200 BEFORE
 * rate limiting and any Airtable write — so a 200 proves the lookup succeeded
 * with no other mocks needed.
 *
 * Run: node test/enquiry-submit-lookup-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Env must exist BEFORE import — submit.js reads it at module scope.
process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.TG_ENQUIRIES_AIRTABLE_PAT = 'pat_test_enq';
process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID = 'appTESTENQ0000000';

const { default: handler } = await import('../api/enquiry/submit.js');

const STATUS_FIELD = 'fldTR9W1dhMRoT0MK';
const FORM_ID_FIELD = 'fldZTiyzyhXjCIapn';

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

function basePayload(extra) {
  return Object.assign({
    widgetId: 'tgw_1784179041137_anycbh',
    formId: 'EF-0025',
    visitorId: 'visitor-1',
    honeypot: 'bot-filled-this',   // zero-write probe — fake 200 after lookup
    fields: {
      first_name: 'Jo', last_name: 'Bloggs', email: 'jo@example.com',
      contact_consent: true,
    },
  }, extra || {});
}

// Queue-driven fetch mock. Each entry: a function(url) → Response-ish or throw.
let fetchLog = [];
function installFetch(queue) {
  fetchLog = [];
  global.fetch = async (url) => {
    fetchLog.push(String(url));
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next(String(url));
  };
}
const liveRecord = (id) => ({
  ok: true, status: 200,
  json: async () => ({ records: [{ id: id || 'rec5oGBRzbuDV9vuv', fields: { [STATUS_FIELD]: 'Live', [FORM_ID_FIELD]: 'EF-0025' } }] }),
});
const draftRecord = () => ({
  ok: true, status: 200,
  json: async () => ({ records: [{ id: 'recDRAFT000000000', fields: { [STATUS_FIELD]: 'Draft' } }] }),
});
const emptyResult = () => ({ ok: true, status: 200, json: async () => ({ records: [] }) });
const airtable429 = () => ({ ok: false, status: 429, json: async () => ({}) });

async function run(payload, queue) {
  installFetch(queue);
  const res = mockRes();
  await handler({ method: 'POST', headers: { origin: 'https://client-site.example' }, body: payload, socket: {} }, res);
  return res;
}

// URLSearchParams encodes spaces as '+'; restore them before decoding.
const decodedUrl = (u) => decodeURIComponent(String(u || '').replace(/\+/g, ' '));

// ── 1. widgetId present → lookup keys on {Widget ID}, resolves, submits ──────
let res = await run(basePayload(), [liveRecord]);
ok(res.statusCode === 200 && res.body && res.body.ok === true, `widgetId lookup → 200 ok (got ${res.statusCode})`);
ok(fetchLog.length === 1, `exactly one Airtable read (got ${fetchLog.length})`);
ok(decodedUrl(fetchLog[0]).includes('{Widget ID}'), 'formula filters on {Widget ID}');
ok(decodedUrl(fetchLog[0]).includes('tgw_1784179041137_anycbh'), 'formula carries the widgetId');

// ── 2. THE regression: colliding Form IDs must not matter when widgetId is set.
// The mock returns the CORRECT Live record for the {Widget ID} query — under
// the old {Form ID} = "EF-000" lookup this same scenario resolved an arbitrary
// Draft and answered 404 "Form not found.".
res = await run(basePayload({ formId: 'EF-000' }), [liveRecord]);
ok(res.statusCode === 200 && res.body && res.body.ok === true, 'collided legacy formId ignored when widgetId present');
ok(decodedUrl(fetchLog[0]).includes('{Widget ID}'), 'lookup still keyed on {Widget ID}');

// ── 3. Legacy payload (formId only, cached old widget) still resolves ────────
res = await run(basePayload({ widgetId: undefined }), [liveRecord]);
ok(res.statusCode === 200 && res.body && res.body.ok === true, 'formId-only legacy payload → 200 ok');
ok(decodedUrl(fetchLog[0]).includes('{Form ID}'), 'legacy lookup keys on {Form ID}');

// ── 4. Airtable 429 then 200 → server-side retry wins, submission proceeds ───
res = await run(basePayload(), [airtable429, liveRecord]);
ok(res.statusCode === 200 && res.body && res.body.ok === true, '429 then 200 → retry succeeds → 200 ok');
ok(fetchLog.length === 2, `two Airtable reads on retry (got ${fetchLog.length})`);

// ── 5. Airtable 429 twice → honest retryable 503, NEVER "Form not found." ────
res = await run(basePayload(), [airtable429]);
ok(res.statusCode === 503, `persistent 429 → 503 (got ${res.statusCode})`);
ok(res.body && res.body.error === 'service_busy' && res.body.retryable === true, '503 carries service_busy + retryable:true');
ok(!/form not found/i.test((res.body && res.body.message) || ''), 'failure message is NOT "Form not found."');
ok(res.headers['retry-after'] === '2', 'Retry-After header set');

// ── 6. Network reject twice → 503 too (was a generic 500 before) ─────────────
res = await run(basePayload(), [() => { throw new TypeError('fetch failed'); }]);
ok(res.statusCode === 503 && res.body && res.body.retryable === true, 'network reject → retryable 503');

// ── 7. Genuine empty result → 404 form_not_found (the only true not-found) ───
res = await run(basePayload(), [emptyResult]);
ok(res.statusCode === 404 && res.body && res.body.error === 'form_not_found', 'no matching record → 404 form_not_found');
ok(fetchLog.length === 1, 'genuine empty result is not retried');

// ── 8. Draft form → distinct message, not "Form not found." ──────────────────
res = await run(basePayload(), [draftRecord]);
ok(res.statusCode === 404 && res.body && res.body.error === 'form_not_live', 'Draft form → form_not_live');
ok(!/form not found/i.test((res.body && res.body.message) || ''), 'Draft message names the real state');

// ── 9. Validation: identity keys ─────────────────────────────────────────────
res = await run(basePayload({ widgetId: undefined, formId: undefined }), [liveRecord]);
ok(res.statusCode === 400, 'neither widgetId nor formId → 400');
res = await run(basePayload({ widgetId: 'not-a-tgw-id' }), [liveRecord]);
ok(res.statusCode === 400, 'malformed widgetId → 400');
res = await run(basePayload({ formId: undefined }), [liveRecord]);
ok(res.statusCode === 200 && res.body && res.body.ok === true, 'widgetId alone is sufficient');

// ── 10. Source guards — widget + config endpoint sides of the fix ────────────
const widgetSrc = readFileSync(new URL('../public/widget-enquiry.js', import.meta.url), 'utf8');
ok(/widgetId:\s*config\.widgetId/.test(widgetSrc), 'widget submit payload carries widgetId');
ok(/result\.status === 503 && result\.body && result\.body\.retryable/.test(widgetSrc), 'widget auto-retries a retryable 503 once');
ok(/\/api\/widget-log/.test(widgetSrc), 'widget beacons /api/widget-log on failures');
ok(/WIDGET_VERSION = '1\.1\.5'/.test(widgetSrc), 'widget version bumped to 1.1.5');

const configSrc = readFileSync(new URL('../api/enquiry-form-config.js', import.meta.url), 'utf8');
ok(/nextFormSequential/.test(configSrc) && /efFields\[EF\.sequential\] = nextSeq/.test(configSrc),
  'create path stamps Sequential (Form ID badge)');
ok(/setHeader\('Cache-Control', 'no-store'\)/.test(configSrc), 'config 404s are explicitly no-store');

const copySrc = readFileSync(new URL('../api/enquiry-form-copy.js', import.meta.url), 'utf8');
ok(/nextFormSequential/.test(copySrc), 'copy path stamps Sequential too');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
