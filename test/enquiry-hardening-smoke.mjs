/**
 * Enquiry pipeline hardening — locks in the fixes from the 2026-07-20 deep
 * audit (41-agent workflow, 34 verified findings). Server cases drive the
 * REAL submit handler with mocked Airtable; the rest are source guards on
 * the widget, editor and routing modules.
 *
 * Headline regression under test: a blank return date was serialised as null
 * and the server 400'd the WHOLE submission with an unactionable "One or
 * more fields are invalid." — the most likely reason Free From Travel's
 * visitors could never submit.
 *
 * Run: node test/enquiry-hardening-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.TG_ENQUIRIES_AIRTABLE_PAT = 'pat_test_enq';
process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID = 'appTESTENQ0000000';

const { default: handler } = await import('../api/enquiry/submit.js');

const STATUS_FIELD = 'fldTR9W1dhMRoT0MK';

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

// Each test uses a DISTINCT widgetId so the in-memory per-form rate limiter
// never interferes across cases.
let widgetSeq = 0;
function payload(extra) {
  widgetSeq++;
  return Object.assign({
    widgetId: `tgw_17841790411${String(widgetSeq).padStart(2, '0')}_test`,
    visitorId: 'visitor-1',
    honeypot: 'bot-filled',   // zero-write probe: fake 200 after the lookup
    fields: { first_name: 'Jo', last_name: 'B', email: 'jo@example.com', contact_consent: true },
  }, extra || {});
}

let fetchLog = [];
function installFetch(queue) {
  fetchLog = [];
  global.fetch = async (url, opts) => {
    fetchLog.push({ url: String(url), body: opts && opts.body });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next(String(url), opts);
  };
}
const liveRecord = () => ({ ok: true, status: 200, json: async () => ({ records: [{ id: 'recLIVE0000000000', fields: { [STATUS_FIELD]: 'Live' } }] }) });
const http = (status) => () => ({ ok: false, status, json: async () => ({}), text: async () => '' });

async function run(p, queue) {
  installFetch(queue);
  const res = mockRes();
  await handler({ method: 'POST', headers: { origin: 'https://client.example' }, body: p, socket: {} }, res);
  return res;
}

// ── 1. THE regression: blank return date must not 400 ────────────────────────
let res = await run(payload({ fields: { first_name: 'Jo', last_name: 'B', email: 'jo@example.com', contact_consent: true, travel_dates: { depart: '2026-09-10', return: null, flexible: false } } }), [liveRecord]);
ok(res.statusCode === 200 && res.body && res.body.ok === true, `travel_dates.return null → accepted (got ${res.statusCode})`);

res = await run(payload({ fields: { first_name: 'Jo', last_name: 'B', email: 'jo@example.com', contact_consent: true, travel_dates: { depart: null, return: '' } } }), [liveRecord]);
ok(res.statusCode === 200 && res.body && res.body.ok === true, 'both dates blank (null/empty) → accepted');

res = await run(payload({ fields: { first_name: 'Jo', last_name: 'B', email: 'jo@example.com', contact_consent: true, travel_dates: { depart: 'not-a-date' } } }), [liveRecord]);
ok(res.statusCode === 400, 'genuinely malformed date still 400s');

// ── 2. sourceUrl is telemetry: clamped or dropped, never a rejection ─────────
res = await run(payload({ sourceUrl: 'https://client.example/page?q=' + 'x'.repeat(3000) }), [liveRecord]);
ok(res.statusCode === 200 && res.body && res.body.ok === true, 'over-long sourceUrl → clamped, submission accepted');
res = await run(payload({ sourceUrl: 'not a url at all' }), [liveRecord]);
ok(res.statusCode === 200 && res.body && res.body.ok === true, 'unparseable sourceUrl → dropped, submission accepted');

// ── 3. Master-record write 429 → retryable 503 (widget silently retries) ─────
res = await run(payload({ honeypot: undefined }), [
  liveRecord,     // form lookup
  http(429),      // master record write → Airtable rate limit
]);
ok(res.statusCode === 503 && res.body && res.body.retryable === true, `write 429 → retryable 503 (got ${res.statusCode})`);
res = await run(payload({ honeypot: undefined }), [
  liveRecord,
  http(500),      // write 5xx MAY have committed — no auto-retry promise
]);
ok(res.statusCode === 500 && (!res.body || !res.body.retryable), 'write 5xx → 500 without retryable (manual retry only)');

// ── 4. Deterministic lookup failure → honest 500, not "try again" 503 ────────
res = await run(payload(), [http(401)]);
ok(res.statusCode === 500 && res.body && res.body.error === 'server_error', `lookup 401 → 500 server_error, not 503 (got ${res.statusCode} ${res.body && res.body.error})`);
ok(fetchLog.length === 1, 'deterministic failure is not retried');

// ── 5. Outbound calls carry timeouts; 429 body carries message ───────────────
const submitSrc = readFileSync(new URL('../api/enquiry/submit.js', import.meta.url), 'utf8');
ok((submitSrc.match(/AbortSignal\.timeout\(/g) || []).length >= 4, 'submit.js: all four outbound fetches have timeouts');
ok(/honeypotEnabled/.test(submitSrc), 'honeypot drop is gated on the form flag');
const authSrc = readFileSync(new URL('../api/_auth.js', import.meta.url), 'utf8');
ok(/message: friendly/.test(authSrc), 'shared 429 body carries a message key the widget can render');
for (const [file, min] of [['../api/enquiry/_lib/routing/sendgrid.js', 2], ['../api/enquiry/_lib/routing/google-sheets.js', 2], ['../api/enquiry/_lib/routing/airtable.js', 2]]) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8');
  ok((src.match(/AbortSignal\.timeout\(/g) || []).length >= min, `${file.split('/').pop()}: outbound fetches have timeouts`);
}

// ── 6. Routing correctness guards ────────────────────────────────────────────
const sheetsSrc = readFileSync(new URL('../api/enquiry/_lib/routing/google-sheets.js', import.meta.url), 'utf8');
ok(/Array\.isArray\(f\.departure_airport\)/.test(sheetsSrc), 'Sheets row joins array-shaped departure_airport');
const emailSrc = readFileSync(new URL('../api/enquiry/_lib/routing/email.js', import.meta.url), 'utf8');
ok(/<\(\[\^<>@/.test(emailSrc.replace(/\\/g, '')) || /Name <email>/.test(emailSrc), 'recipients accept "Name <email>" entries');

// ── 7. filterByFormula uses display names everywhere ─────────────────────────
const patSrc = readFileSync(new URL('../api/enquiry/airtable-pat.js', import.meta.url), 'utf8');
ok(/\{Widget ID\}/.test(patSrc) && /\{Owner Email\}/.test(patSrc) && !/\{\$\{F\.widgetId\}\}/.test(patSrc), 'airtable-pat formulas use display names');
const copySrc = readFileSync(new URL('../api/enquiry-form-copy.js', import.meta.url), 'utf8');
ok(/\{Widget ID\}/.test(copySrc) && !/\{\$\{EF\.widgetId\}\}/.test(copySrc), 'form-copy formula uses display names');
ok(/i18nJSON:\s*'fld0phLw3nKqM7UG6'/.test(copySrc), 'form-copy preserves translations');
const configSrc = readFileSync(new URL('../api/enquiry-form-config.js', import.meta.url), 'utf8');
ok(/sort%5B0%5D%5Bfield%5D=Sequential/.test(configSrc), 'sequential sort keys on the display name');

// ── 8. Widget source guards (v1.1.7+ hardening) ──────────────────────────────
const w = readFileSync(new URL('../public/widget-enquiry.js', import.meta.url), 'utf8');
// Assert the version is AT LEAST the hardening baseline, not an exact string —
// legitimate bumps (scroll fix, draft-form notice, retry contract) must not fail
// this guard; the feature assertions below are what actually matter.
const wv = (w.match(/WIDGET_VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
const atLeast = (a, b, c) => wv.length === 3 && (wv[0] > a || (wv[0] === a && (wv[1] > b || (wv[1] === b && wv[2] >= c))));
ok(atLeast(1, 1, 7), `widget-enquiry version >= 1.1.7 (is ${wv.join('.')})`);
ok(/if \(depart\.value\) td\.depart = depart\.value;/.test(w), 'daterange omits blank dates (no more null)');
ok(!/depart: depart\.value \|\| null/.test(w), 'null-date serialisation removed');
ok((w.match(/interests_required:/g) || []).length === 6, 'interests-required message in all six languages');
ok(/selected\.length === 0\) return t\('interests_required'\)/.test(w), 'required interests enforced');
ok(/name: 'tg_hp_check'/.test(w) && !/website_url/.test(w), 'honeypot renamed away from autofill-bait');
ok(/_showServerFieldErrors/.test(w) && /result\.body\.fields/.test(w), 'server validation errors mapped back to fields');
ok(/maxlength: '64'/.test(w) && /maxlength: '32'/.test(w) && /maxlength: '128'/.test(w), 'name/phone/destination inputs clamped to server caps');
ok(/function heartbeat\(/.test(w) && /heartbeat\(widgetId\)/.test(w), 'load heartbeat beacons on mount');
ok(/watchForLateContainers/.test(w) && /MutationObserver/.test(w), 'late-injected containers get mounted');
ok(/widget\._applyI18n\(\)/.test(w), 'live embeds apply author translations');
ok(/ty\.mode === 'redirect'/.test(w), 'redirect thank-you mode implemented');
ok(/options && fieldSpec\.options\.placeholder/.test(w), 'author notes placeholder honoured');
ok(/config load threw/.test(w) && /submit network failure/.test(w), 'network-level failures beacon too');
ok(/body\.message \|\| body\.error/.test(w), 'error text falls back to body.error (429 shape)');

// ── 8b. Sheets misconfiguration is named truthfully; editor scrolls on mobile ─
ok(/not configured on the platform \(service account missing\)/.test(sheetsSrc) || /not configured on the platform/.test(readFileSync(new URL('../api/enquiry/_lib/routing/google-sheets.js', import.meta.url), 'utf8')),
  'missing platform credentials get a truthful error, not "Google auth failed"');
const edCss = readFileSync(new URL('../public/editor-enquiry.html', import.meta.url), 'utf8');
ok(/@media \(max-width: 900px\)/.test(edCss) && /Stack the panels full width/.test(edCss),
  'editor stacks panels and page-scrolls on small screens');
ok((edCss.match(/min-height: 0;/g) || []).length >= 6 && /height: 100dvh;/.test(edCss),
  'panels can shrink below content height so their bodies scroll on short screens');

// ── 9. Editor: stale tab can no longer flip Live → Draft ─────────────────────
const ed = readFileSync(new URL('../public/editor-enquiry.html', import.meta.url), 'utf8');
ok(/statusTouched: false/.test(ed) && /state\.statusTouched = true/.test(ed) && /if \(!state\.statusTouched\) delete cfgToSend\.status;/.test(ed),
  'editor only sends status when the user changed it this session');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
