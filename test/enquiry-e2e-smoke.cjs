// =============================================================================
// End-to-end test: REAL public/widget-enquiry.js in jsdom driving the
// REAL api/enquiry/submit.js handler. Airtable + SendGrid are mocked at the
// node global.fetch layer; the widget's window.fetch routes /api/enquiry/submit
// into the real handler.
//
// Run:  cd /home/user/tg-widgets && node <this file>
// =============================================================================
'use strict';

process.env.AIRTABLE_KEY = 'pat_widget_suite_test';
process.env.AIRTABLE_BASE_ID = 'appAYzWZxvK6qlwXK';
process.env.TG_ENQUIRIES_AIRTABLE_PAT = 'pat_enquiries_test';
process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID = 'appQJYiPZVU5jMAml';
// SENDGRID_API_KEY deliberately unset -> email routing returns
// {status:'failed'} without network, matching a mocked-out mail layer.

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const { JSDOM, VirtualConsole } = require(path.join(REPO, 'node_modules/jsdom'));

const WIDGET_SRC = fs.readFileSync(path.join(REPO, 'public/widget-enquiry.js'), 'utf8');
const WIDGET_ID = 'tgw_1784179041137_anycbh';

// ── Production config for form MAIN (captured live 2026-07-20) ───────────────
const INTEREST_CHOICES = [
  { value: 'beach', label: 'Beach', icon: 'wave' },
  { value: 'city', label: 'City break', icon: 'building' },
  { value: 'culture', label: 'Culture', icon: 'museum' },
  { value: 'food', label: 'Food & wine', icon: 'utensils' },
  { value: 'adventure', label: 'Adventure', icon: 'compass' },
  { value: 'family', label: 'Family', icon: 'users' },
  { value: 'wellness', label: 'Wellness', icon: 'pin' },
  { value: 'honeymoon', label: 'Honeymoon', icon: 'heart' },
  { value: 'cruise', label: 'Cruise', icon: 'wave' },
];
const FIELDS = [
  { id: 'interests',    type: 'interests',  label: 'What kind of trip?',            required: true,  visible: true, step: 1, choices: INTEREST_CHOICES },
  { id: 'destination',  type: 'destination',label: 'Where are you dreaming of?',    required: true,  visible: true, step: 2 },
  { id: 'duration',     type: 'duration',   label: 'Duration',                      required: true,  visible: true, step: 2 },
  { id: 'travel_dates', type: 'daterange',  label: 'Travel dates',                  required: true,  visible: true, step: 2 },
  { id: 'travellers',   type: 'travellers', label: "Who's travelling?",             required: true,  visible: true, step: 3 },
  { id: 'budget_pp',    type: 'budget',     label: 'Approximate total budget',      required: true,  visible: true, step: 4 },
  { id: 'stars',        type: 'stars',      label: 'Star rating preference',        required: false, visible: true, step: 4 },
  { id: 'board',        type: 'board',      label: 'Board basis',                   required: false, visible: true, step: 4 },
  { id: 'notes',        type: 'notes',      label: 'Anything else?',                required: false, visible: true, step: 4 },
  { id: 'name',         type: 'name',       label: 'Your name',                     required: true,  visible: true, step: 5 },
  { id: 'contact',      type: 'contact',    label: 'How to reach you',              required: true,  visible: true, step: 5 },
  { id: 'consent',      type: 'consent',    label: 'Consent',                       required: true,  visible: true, step: 5 },
];
const STEPS = [
  { id: 1, label: 'Trip' },
  { id: 2, label: 'Where & when' },
  { id: 3, label: 'Travellers' },
  { id: 4, label: 'Details' },
  { id: 5, label: 'Contact' },
];
// Shape mirrors the publicConfig block in api/enquiry-form-config.js:676-709
const PUBLIC_CONFIG = {
  formId: 'EF-0025',
  widgetId: WIDGET_ID,
  name: 'MAIN',
  header: { title: '', subtitle: '' },
  submitText: 'Send my enquiry',
  thankYou: { mode: 'inline', message: "Thanks {firstName} — we're on it", redirectUrl: '' },
  i18n: {},
  branding: { buttonColour: '#1B2B5B', accentColour: '#00B4D8', theme: 'light' },
  fieldsJSON: JSON.stringify(FIELDS),
  layoutMode: 'multi-step',
  steps: STEPS,
  security: { honeypot: true, turnstile: false },
};

// ── Airtable form record as the submit handler's fetchForm sees it ───────────
// (returnFieldsByFieldId=true -> keys are field IDs from FORM_FIELDS)
const FORM_RECORD = {
  id: 'recFORMMAIN0000001',
  fields: {
    fldC0MLSyJqg6U1zT: 'MAIN',                               // formName
    fldZTiyzyhXjCIapn: 'EF-0025',                             // formId formula
    fldatpd9Ms5J5JGPy: 25,                                    // sequential
    fldrw1eTFYCFIo0pp: 'Free From Travel',                    // clientName
    fldTR9W1dhMRoT0MK: 'Live',                                // status
    fldYdK8X3BgN7hPCx: JSON.stringify(FIELDS),                // fieldsJSON
    fldTy6oSMKUwYEYjQ: 'inline',                              // thankYouMode
    fldiB3PkfcsHRKEWd: "Thanks {firstName} — we're on it",    // thankYouMessage
    fldXJxPXCLBnQeb7f: 'TG-',                                 // referencePrefix
    fldVTzbUzzLjVldEk: true,                                  // honeypot on
    fldgwmG6xCrGuniEa: 'standard',                            // rate limit tier
    fldl0efl9oLr2hngY: false,                                 // turnstile off
    fldLzWF0XnEXeZYH1: 'george@freefromtravel.com',           // ownerEmail
    fldkwZwxheNZJ8CrH: true,                                  // routingEmail
    fldlu1HcErBfp2wh2: 'george@freefromtravel.com',           // routingEmailTo
  },
};

// ── Node-side global.fetch mock (Airtable etc. as seen by the REAL handler) ──
const at = {
  lookupMode: 'live',      // 'live' | '429x2' | 'empty'
  lookupCalls: 0,
  lookupUrls: [],
  masterCreates: [],
  routingLogs: [],
  other: [],
};
function nodeResp(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
global.fetch = async function mockNodeFetch(url, opts = {}) {
  url = String(url);
  if (url.indexOf('api.airtable.com') !== -1) {
    if (url.indexOf('tblpw4TCmQfJHZIlF') !== -1) { // Enquiry Forms lookup
      at.lookupCalls++;
      at.lookupUrls.push(url);
      if (at.lookupMode === '429x2' && at.lookupCalls <= 2) return nodeResp(429, { error: { type: 'RATE_LIMIT_REACHED' } });
      if (at.lookupMode === 'empty') return nodeResp(200, { records: [] });
      return nodeResp(200, { records: [FORM_RECORD] });
    }
    if (url.indexOf('tblxtRPhALFjeMVA6') !== -1) { // Submissions
      if ((opts.method || 'GET') === 'POST') {
        at.masterCreates.push(JSON.parse(opts.body));
        // Single-record create shape, as real Airtable answers a {fields:...} POST
        return nodeResp(200, { id: 'recSUB0000000001', createdTime: '2026-07-20T10:00:00.000Z', fields: {} });
      }
      return nodeResp(200, { id: 'recSUB0000000001', fields: {} }); // PATCH routing summary
    }
    if (url.indexOf('tblYPXs1yFkXuwPHQ') !== -1) { // Routing Log
      at.routingLogs.push(opts.body ? JSON.parse(opts.body) : null);
      return nodeResp(200, { id: 'recLOG0000000001' });
    }
    return nodeResp(200, {});
  }
  at.other.push(url);
  return nodeResp(200, {});
};

// ── Real handler bridge ──────────────────────────────────────────────────────
let submitHandler = null;
async function callRealHandler(bodyStr, ip) {
  const req = {
    method: 'POST',
    headers: {
      origin: 'https://www.freefromtravel.com',
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'user-agent': 'e2e-jsdom-harness',
    },
    body: bodyStr, // widget posts a JSON STRING body
    socket: { remoteAddress: ip },
    query: {},
  };
  let statusCode = 0;
  let jsonBody = null;
  const headers = {};
  const res = {
    setHeader(k, v) { headers[k] = v; },
    status(c) { statusCode = c; return res; },
    json(b) { jsonBody = b; return res; },
    end() { return res; },
  };
  await submitHandler(req, res);
  return { status: statusCode, body: jsonBody, headers };
}

// ── jsdom widget environment ─────────────────────────────────────────────────
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeWidget(opts = {}) {
  const { configBehaviour = 'ok', hostileLocalStorage = false, ip = '203.0.113.10' } = opts;
  const virtualConsole = new VirtualConsole();
  const consoleLines = [];
  virtualConsole.on('error', (...a) => consoleLines.push(['error', a.map(String).join(' ')]));
  virtualConsole.on('warn', (...a) => consoleLines.push(['warn', a.map(String).join(' ')]));
  virtualConsole.on('jsdomError', (e) => consoleLines.push(['jsdomError', String(e && e.message)]));

  const dom = new JSDOM(
    '<!doctype html><html><head></head><body>' +
    '<div data-tg-widget="enquiry" data-tg-id="' + WIDGET_ID + '"></div>' +
    '<script src="https://id.travelify.io/widget-enquiry.js" defer></script>' +
    '</body></html>',
    { url: 'https://www.freefromtravel.com/enquire', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole }
  );
  const window = dom.window;

  const state = { configCalls: 0, submitCalls: [], handlerResults: [], beacons: [], searchCalls: 0, consoleLines };

  window.fetch = function (url, fopts = {}) {
    url = String(url);
    if (url.indexOf('/api/enquiry-form-config') !== -1) {
      state.configCalls++;
      if (configBehaviour === 'failThenOk' && state.configCalls === 1) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PUBLIC_CONFIG) });
    }
    if (url.indexOf('/api/enquiry/submit') !== -1) {
      const bodyStr = fopts.body;
      state.submitCalls.push(JSON.parse(bodyStr));
      return callRealHandler(bodyStr, ip).then(function (r) {
        state.handlerResults.push(r);
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.body) };
      });
    }
    if (url.indexOf('/api/destinations/search') !== -1) {
      state.searchCalls++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ groups: [{ label: 'Countries', results: [{ id: 'recDestGreece01', name: 'Greece', type: 'country' }] }] }),
      });
    }
    if (url.indexOf('/api/widget-log') !== -1) {
      state.beacons.push(fopts.body ? String(fopts.body) : '');
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };

  if (hostileLocalStorage) {
    // Safari-private-mode style: the Storage API exists but every call throws.
    const boom = function () { throw new Error('QuotaExceededError: The quota has been exceeded.'); };
    Object.defineProperty(window.Storage.prototype, 'getItem', { value: boom });
    Object.defineProperty(window.Storage.prototype, 'setItem', { value: boom });
  }

  window.eval(WIDGET_SRC); // autoInit runs (document.readyState === 'complete')

  // Let the config fetch (plus the 600ms retry in scenario f) settle
  const settleMs = configBehaviour === 'failThenOk' ? 900 : 80;
  await wait(settleMs);

  const container = window.document.querySelector('[data-tg-widget="enquiry"]');
  const shadow = container.shadowRoot;
  return { dom, window, container, shadow, state };
}

// ── Shadow-DOM interaction helpers ───────────────────────────────────────────
function section(shadow, stepId) {
  return shadow.querySelector('.tg-step-section[data-step-id="' + stepId + '"]');
}
function visibleStepId(shadow) {
  const secs = shadow.querySelectorAll('.tg-step-section');
  for (const s of secs) if (s.style.display !== 'none') return s.getAttribute('data-step-id');
  return null;
}
function clickNext(shadow) { shadow.querySelector('.tg-nav-next').click(); }
function summaryText(shadow) {
  const s = shadow.querySelector('.tg-summary-error');
  if (!s || !s.classList.contains('is-shown')) return null;
  return s.querySelector('.tg-summary-error-text').textContent;
}

async function fillAllStepsAndSubmit(env) {
  const { window, shadow } = env;
  const doc = window.document;
  const fire = (elm, type) => elm.dispatchEvent(new window.Event(type, { bubbles: true }));

  // Step 1 (Trip): pick an interest chip
  const s1 = section(shadow, 1);
  const beachPill = s1.querySelector('.tg-pill[data-value="beach"]');
  beachPill.click();
  clickNext(shadow);
  if (visibleStepId(shadow) !== '2') throw new Error('did not reach step 2 (on ' + visibleStepId(shadow) + ')');

  // Step 2 (Where & when): destination via live search, duration pill, dates
  const s2 = section(shadow, 2);
  const destInput = s2.querySelector('.tg-dest-input');
  destInput.focus();
  destInput.value = 'Greece';
  fire(destInput, 'input');
  await wait(450); // 250ms debounce + mocked search round-trip
  const destOpt = s2.querySelector('.tg-dest-option');
  if (!destOpt) throw new Error('destination dropdown offered no option');
  destOpt.click();
  const chip = s2.querySelector('.tg-chip');
  if (!chip) throw new Error('destination chip not rendered after selection');

  const tenNights = s2.querySelector('.tg-pill[data-n="10"]');
  tenNights.click();

  const dateInputs = s2.querySelectorAll('input[type="date"]');
  dateInputs[0].value = '2026-09-10'; fire(dateInputs[0], 'change');
  dateInputs[1].value = '2026-09-17'; fire(dateInputs[1], 'change');
  clickNext(shadow);
  if (visibleStepId(shadow) !== '3') throw new Error('did not reach step 3: ' + (summaryText(shadow) || '(no error text)'));

  // Step 3 (Travellers): bump adults 2 -> 3 for realism
  const s3 = section(shadow, 3);
  const plus = s3.querySelectorAll('.tg-trav-row')[0].querySelectorAll('.tg-step-btn')[1];
  plus.click();
  clickNext(shadow);
  if (visibleStepId(shadow) !== '4') throw new Error('did not reach step 4: ' + (summaryText(shadow) || ''));

  // Step 4 (Details): nudge the budget slider, skip optional stars/board/notes
  const s4 = section(shadow, 4);
  const range = s4.querySelector('input[type="range"]');
  range.value = '60'; fire(range, 'input'); // ~£3,800pp
  clickNext(shadow);
  if (visibleStepId(shadow) !== '5') throw new Error('did not reach step 5: ' + (summaryText(shadow) || ''));

  // Step 5 (Contact): name, email, consent
  const s5 = section(shadow, 5);
  const first = s5.querySelector('input[autocomplete="given-name"]');
  const last = s5.querySelector('input[autocomplete="family-name"]');
  first.value = 'Jo'; fire(first, 'input');
  last.value = 'Bloggs'; fire(last, 'input');
  const email = s5.querySelector('input[type="email"]');
  email.value = 'jo@example.com'; fire(email, 'input');
  const consentBox = s5.querySelector('.tg-check input[type="checkbox"]');
  consentBox.click();

  // Submit
  const submitBtn = shadow.querySelector('.tg-submit');
  if (submitBtn.style.display === 'none') throw new Error('submit button hidden on final step');
  submitBtn.click();

  // Wait for thank-you (scenario c needs ~2.5s: 400ms lookup retry + 2s widget retry)
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (shadow.querySelector('.tg-ty h2')) break;
    if (summaryText(shadow)) break;
    await wait(50);
  }
  return {
    thankYouH2: shadow.querySelector('.tg-ty h2') ? shadow.querySelector('.tg-ty h2').textContent : null,
    thankYouRef: shadow.querySelector('.tg-ty-ref') ? shadow.querySelector('.tg-ty-ref').textContent : null,
    errorText: summaryText(shadow),
  };
}

// ── Scenario runner ──────────────────────────────────────────────────────────
const results = [];
function record(scenario, pass, detail) {
  results.push({ scenario, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + scenario + '\n      ' + detail + '\n');
}

(async function main() {
  submitHandler = (await import(path.join(REPO, 'api/enquiry/submit.js'))).default;

  // ---- Scenario a: happy path --------------------------------------------
  try {
    at.lookupMode = 'live'; at.lookupCalls = 0; at.masterCreates.length = 0;
    const env = await makeWidget({ ip: '203.0.113.11' });
    if (!env.shadow || !env.shadow.querySelector('.tg-card')) throw new Error('widget did not render');
    const out = await fillAllStepsAndSubmit(env);
    const payload = env.state.submitCalls[0];
    const master = at.masterCreates[0];
    const firstNameField = master && master.fields && master.fields.fldHIsFu8aTma2Udh;
    const checks = [];
    if (!out.thankYouH2) checks.push('thank-you did not render (error: ' + out.errorText + ')');
    else if (out.thankYouH2 !== "Thanks Jo — we're on it") checks.push('thank-you text was: "' + out.thankYouH2 + '"');
    if (!out.thankYouRef || !/TG-2026-\d{5}/.test(out.thankYouRef)) checks.push('reference missing/bad: ' + out.thankYouRef);
    if (!payload || payload.widgetId !== WIDGET_ID) checks.push('payload widgetId=' + (payload && payload.widgetId));
    if (!at.lookupUrls[0] || at.lookupUrls[0].indexOf(encodeURIComponent(WIDGET_ID)) === -1) checks.push('handler did not look up by widgetId');
    if (firstNameField !== 'Jo') checks.push('master record firstName=' + JSON.stringify(firstNameField));
    if (!master || master.typecast !== true) checks.push('typecast missing on create');
    record('a. happy path (5 steps, real handler, master record)', checks.length === 0,
      checks.length ? checks.join('; ')
      : 'thank-you "' + out.thankYouH2 + '" + "' + out.thankYouRef + '"; handler looked up {Widget ID}="' + WIDGET_ID + '"; master record firstName=Jo, email routing attempted (no SendGrid key -> logged failed, submission still 200). visitorId sent: ' + payload.visitorId);
  } catch (e) { record('a. happy path (5 steps, real handler, master record)', false, 'threw: ' + e.message); }

  // ---- Scenario b: validation wall on step 1 -----------------------------
  try {
    const env = await makeWidget({ ip: '203.0.113.12' });
    const before = visibleStepId(env.shadow);
    clickNext(env.shadow);
    const after = visibleStepId(env.shadow);
    const err = summaryText(env.shadow);
    const fieldErrShown = !!env.shadow.querySelector('.tg-field-error.is-shown');
    const blocked = (after === before) && (!!err || fieldErrShown);
    // extra probe: does step 2 block when empty?
    let step2Blocked = null;
    if (after === '2') {
      clickNext(env.shadow);
      step2Blocked = visibleStepId(env.shadow) === '2' && !!summaryText(env.shadow);
    }
    record('b. validation wall: advance step 1 with nothing selected', blocked,
      blocked ? 'blocked on step 1 with error "' + err + '"'
      : 'NOT blocked: step advanced ' + before + '->' + after + ', no error shown. Required interests field is never validated (renderInterests.validate() always returns null).' +
        (step2Blocked !== null ? ' (Contrast: empty step 2 ' + (step2Blocked ? 'DOES block with "' + summaryText(env.shadow) + '"' : 'also does NOT block') + ')' : ''));
  } catch (e) { record('b. validation wall: advance step 1 with nothing selected', false, 'threw: ' + e.message); }

  // ---- Scenario c: submit-time 503 with silent widget retry --------------
  try {
    at.lookupMode = '429x2'; at.lookupCalls = 0; at.masterCreates.length = 0; at.lookupUrls.length = 0;
    const env = await makeWidget({ ip: '203.0.113.13' });
    const out = await fillAllStepsAndSubmit(env);
    at.lookupMode = 'live';
    const posts = env.state.submitCalls.length;
    const first = env.state.handlerResults[0];
    const second = env.state.handlerResults[1];
    const ok = out.thankYouH2 && posts === 2 && first && first.status === 503 && first.body && first.body.retryable === true && second && second.status === 200;
    record('c. submit-time 503 -> silent auto-retry lands on thank-you', !!ok,
      ok ? 'POST#1: Airtable 429 x2 -> handler 503 {retryable:true, Retry-After:' + (first.headers['Retry-After'] || '?') + '}; widget silently retried after 2s; POST#2 -> 200; thank-you "' + out.thankYouH2 + '". Airtable lookup called ' + at.lookupCalls + 'x total.'
      : 'posts=' + posts + ' first=' + JSON.stringify(first && { s: first.status, b: first.body }) + ' second=' + JSON.stringify(second && { s: second.status }) + ' thankYou=' + out.thankYouH2 + ' err=' + out.errorText);
  } catch (e) { at.lookupMode = 'live'; record('c. submit-time 503 -> silent auto-retry lands on thank-you', false, 'threw: ' + e.message); }

  // ---- Scenario d: genuine 404 -------------------------------------------
  try {
    at.lookupMode = 'empty'; at.lookupCalls = 0;
    const env = await makeWidget({ ip: '203.0.113.14' });
    const out = await fillAllStepsAndSubmit(env);
    at.lookupMode = 'live';
    const r = env.state.handlerResults[0];
    const ok = !out.thankYouH2 && r && r.status === 404 && r.body.error === 'form_not_found' && out.errorText === 'Form not found.';
    record('d. genuine 404 (empty lookup result)', !!ok,
      ok ? 'handler answered 404 form_not_found once (no retry); visitor sees exactly: "' + out.errorText + '" in the summary banner; widget beaconed /api/widget-log (' + env.state.beacons.length + ' beacon).'
      : 'status=' + (r && r.status) + ' code=' + (r && r.body && r.body.error) + ' visitor text="' + out.errorText + '" thankYou=' + out.thankYouH2);
  } catch (e) { at.lookupMode = 'live'; record('d. genuine 404 (empty lookup result)', false, 'threw: ' + e.message); }

  // ---- Scenario e: hostile localStorage ----------------------------------
  try {
    at.lookupMode = 'live'; at.masterCreates.length = 0;
    const env = await makeWidget({ ip: '203.0.113.15', hostileLocalStorage: true });
    const rendered = !!(env.shadow && env.shadow.querySelector('.tg-card'));
    if (!rendered) throw new Error('widget failed to init with throwing localStorage');
    const out = await fillAllStepsAndSubmit(env);
    const payload = env.state.submitCalls[0];
    const vid = payload && payload.visitorId;
    const r = env.state.handlerResults[0];
    const ok = rendered && out.thankYouH2 && r && r.status === 200 && typeof vid === 'string' && vid.length >= 1 && vid.length <= 128;
    record('e. hostile localStorage (Safari private mode)', !!ok,
      ok ? 'widget still inits + renders; getVisitorId() fell back to ephemeral id "' + vid + '" (' + vid.length + ' chars, non-persistent so returning visitors get a new id each submit); real handler accepted it (200, master record written).'
      : 'rendered=' + rendered + ' visitorId=' + JSON.stringify(vid) + ' status=' + (r && r.status) + ' body=' + JSON.stringify(r && r.body && r.body.fields) + ' err=' + out.errorText);
  } catch (e) { record('e. hostile localStorage (Safari private mode)', false, 'threw: ' + e.message); }

  // ---- Scenario f: config load failure then recovery ---------------------
  try {
    const env = await makeWidget({ ip: '203.0.113.16', configBehaviour: 'failThenOk' });
    const rendered = !!(env.shadow && env.shadow.querySelector('.tg-card'));
    const steps = env.shadow ? env.shadow.querySelectorAll('.tg-progress-step').length : 0;
    const oops = env.shadow && env.shadow.querySelector('.tg-oops');
    const ok = rendered && steps === 5 && env.state.configCalls === 2 && !oops;
    record('f. config GET network failure then recovery', !!ok,
      ok ? 'first GET rejected (network), widget silently retried after 600ms, second GET 200 -> full 5-step form rendered.'
      : 'rendered=' + rendered + ' steps=' + steps + ' configCalls=' + env.state.configCalls + (oops ? ' error card shown: "' + oops.textContent + '"' : ''));
  } catch (e) { record('f. config GET network failure then recovery', false, 'threw: ' + e.message); }

  const passed = results.filter(r => r.pass).length;
  console.log('Done. ' + passed + '/' + results.length + ' passed.');
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(1); });
