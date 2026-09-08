/**
 * Enquiry Form — George at Free From Travel's second round (8 Sep 2026).
 *
 * Eight items, each gated so every other form is untouched:
 *   1. notes.required is honoured (his "Dietary restrictions" was set mandatory
 *      and still showed "(optional)" and accepted blank)
 *   2. the thank-you HEADLINE is linkified (his Calendly link sat in the first
 *      block and was drawn as plain text)
 *   3. daterange options.mode === 'single' → one departure date box
 *   4. daterange options.flex === false → no "flexible by a week" switch
 *   5. travellers options.adultMinAge === 18 → "Age 18+", child ages to 17
 *   6. a duration option that says "Other" reveals a nights box, submitted as
 *      duration.nights; blank it submits the label as before
 *   7. budget: the default title reads "per person", markers sit on the real
 *      slider breakpoints (£1.5k at a quarter, £10k+ at the end), and a live
 *      "Approximate total for N travellers" follows the travellers steppers
 *   8. the editor writes the same option keys the widget reads
 *
 * Mounts the REAL widget in jsdom, drives a real submission through a mocked
 * fetch, and finally mounts George's live fieldsJSON with the planned settings.
 *
 * Run: node test/enquiry-freefrom-smoke.mjs  (npm run test:enquiry-freefrom)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const code = readFileSync(new URL('../public/widget-enquiry.js', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../public/editor-enquiry.html', import.meta.url), 'utf8');

/** Mount the real widget single-page; returns the shadow, the instance and the captured submit body. */
async function mount(fields, extra) {
  const dom = new JSDOM('<!doctype html><html><body><div id="m"></div></body></html>',
    { runScripts: 'dangerously', url: 'https://agency.example.com/', pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const posted = { body: null };
  window.fetch = async (url, init) => {
    if (/\/api\/enquiry\/submit/.test(String(url))) {
      posted.body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, reference: 'TG-TEST' }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '' };
  };
  const s = window.document.createElement('script'); s.textContent = code; window.document.body.appendChild(s);
  await sleep(10);
  const mountEl = window.document.getElementById('m');
  const inst = new window.TGEnquiryWidget(mountEl, Object.assign({
    formId: 't', widgetId: 'demo', name: 'Test',
    header: { title: 'T', subtitle: 'S' },
    thankYou: { mode: 'inline', message: 'Thanks {firstName}' },
    branding: { buttonColour: '#111111', accentColour: '#222222', theme: 'light' },
    security: { honeypot: true, turnstile: false },
    fieldsJSON: fields,
  }, extra || {}));
  await sleep(40);
  const shadow = mountEl.shadowRoot;
  if (!shadow) throw new Error('widget did not attach a shadow root');
  return { shadow, inst, window, posted };
}

const F = {
  name: () => ({ id: 'name', type: 'name', label: 'Your name', required: true, visible: true }),
  contact: () => ({ id: 'contact', type: 'contact', label: 'How to reach you', required: true, visible: true }),
  consent: () => ({ id: 'consent', type: 'consent', label: 'Consent', required: true, visible: true }),
  travellers: (opts) => ({ id: 'travellers', type: 'travellers', label: "Who's travelling?", required: true, visible: true, options: opts || {} }),
  budget: (label) => ({ id: 'budget_pp', type: 'budget', label: label, required: false, visible: true, options: {} }),
  dates: (opts) => ({ id: 'travel_dates', type: 'daterange', label: 'Travel dates', required: true, visible: true, options: opts || {} }),
};
const GEORGE_DURATION = ['3 nights', '5 nights', '7 nights', '10 nights', '14 nights', 'Other'].map((l) => ({ value: l, label: l }));

const fire = (win, node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true }));
function fillRequired(shadow, win) {
  const first = shadow.querySelector('input[aria-label="First name"]');
  const last = shadow.querySelector('input[aria-label="Last name"]');
  const email = shadow.querySelector('input[type="email"]');
  if (first) { first.value = 'George'; fire(win, first, 'input'); }
  if (last) { last.value = 'Test'; fire(win, last, 'input'); }
  if (email) { email.value = 'george@example.com'; fire(win, email, 'input'); }
  const consent = shadow.querySelector('.tg-check input[type="checkbox"]');
  if (consent) { consent.checked = true; fire(win, consent, 'change'); }
}
async function submit(shadow, win) {
  shadow.querySelector('.tg-submit').click();
  await sleep(80);
}
const fieldError = (node) => { const f = node.closest('.tg-field'); const e = f && f.querySelector('.tg-field-error'); return (e && e.classList.contains('is-shown')) ? e.querySelector('.tg-field-error-text').textContent : ''; };
const rowFor = (shadow, heading) => [...shadow.querySelectorAll('.tg-trav-row')].find((r) => r.querySelector('h4').textContent === heading);
const plus = (row) => row.querySelectorAll('.tg-step-btn')[1];
const minus = (row) => row.querySelectorAll('.tg-step-btn')[0];

// ── 1. A required notes field is required ────────────────────────────────────
console.log('1. notes honours required');
{
  const { shadow, window } = await mount([
    { id: 'notes_diet', type: 'notes', label: 'Dietary restrictions', required: true, visible: true, options: { placeholder: 'Allergies...' } },
    F.name(), F.contact(), F.consent(),
  ]);
  const ta = shadow.querySelector('textarea');
  const label = ta.closest('.tg-field').querySelector('.tg-label');
  ok(label && !/optional/i.test(label.textContent), 'a required notes field shows no "(optional)" suffix');
  fillRequired(shadow, window);
  await submit(shadow, window);
  ok(fieldError(ta) === 'Please add a few words here.', 'submitting it blank shows the notes error (got "' + fieldError(ta) + '")');
  ok(ta.getAttribute('aria-invalid') === 'true', 'the textarea is marked invalid');
  ta.value = 'Coeliac, severe'; fire(window, ta, 'input');
  ok(fieldError(ta) === '' && !ta.hasAttribute('aria-invalid'), 'typing clears the error');
}
{
  const { shadow, window, posted } = await mount([
    { id: 'notes', type: 'notes', label: 'Anything else?', required: false, visible: true },
    F.name(), F.contact(), F.consent(),
  ]);
  const ta = shadow.querySelector('textarea');
  const label = ta.closest('.tg-field').querySelector('.tg-label');
  ok(label && /optional/i.test(label.textContent), 'default: an optional notes field still says "(optional)"');
  fillRequired(shadow, window);
  await submit(shadow, window);
  ok(fieldError(ta) === '', 'default: blank optional notes raise no error');
  ok(posted.body && posted.body.fields, 'default: the form submitted');
}

// ── 2. The thank-you headline carries its link ───────────────────────────────
console.log('2. thank-you headline link');
{
  const URL_ = 'https://calendly.com/george-freefromtravel/enquiry-discovery';
  const msg = 'Grab a time that suits you: ' + URL_ + '\n\nAs mentioned, the most useful thing we can do next is have a quick chat.\n';
  const { shadow, inst } = await mount([
    { id: 'contactpref_x', type: 'contactpref', label: 'How can we get in touch?', required: true, visible: true, options: { branches: [{ match: 'A quick call', message: msg }] } },
    F.name(), F.consent(),
  ]);
  inst._renderThankYou({ ok: true, reference: 'TG-1' }, 'George', { contact_preference: ['A quick call'] });
  const h2 = shadow.querySelector('.tg-ty h2');
  const a = h2 && h2.querySelector('a');
  ok(a && a.getAttribute('href') === URL_, 'the Calendly link in the headline is a real anchor');
  ok(a && a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel') || ''), 'it opens in a new tab with noopener');
  ok(h2 && /^Grab a time that suits you: /.test(h2.textContent), 'the headline text is kept around the link');
  ok(shadow.querySelector('.tg-ty p') && /quick chat/.test(shadow.querySelector('.tg-ty p').textContent), 'the paragraph below still renders');
}
{
  const { shadow, inst } = await mount([F.name(), F.consent()]);
  inst._renderThankYou({ ok: true, reference: 'TG-2' }, 'Ann', {});
  const h2 = shadow.querySelector('.tg-ty h2');
  ok(h2 && !h2.querySelector('a') && h2.textContent === 'Thanks Ann', 'a plain headline stays plain text');
}

// ── 3 + 4. One date box, no flexible switch ──────────────────────────────────
console.log('3 + 4. single date, no flex');
{
  const { shadow, window, posted } = await mount([F.dates({ mode: 'single', flex: false }), F.name(), F.contact(), F.consent()]);
  const dates = shadow.querySelectorAll('input[type="date"]');
  ok(dates.length === 1, 'single mode renders exactly one date box');
  ok(!shadow.querySelector('.tg-flex-toggle'), 'flex:false removes the flexible switch');
  ok(![...shadow.querySelectorAll('.tg-label')].some((l) => /Return on/.test(l.textContent)), 'no "Return on" label');
  dates[0].value = '2027-03-01'; fire(window, dates[0], 'change');
  fillRequired(shadow, window);
  await submit(shadow, window);
  ok(posted.body && JSON.stringify(posted.body.fields.travel_dates) === JSON.stringify({ flexible: false, depart: '2027-03-01' }), 'submits depart only, flexible false, no return key');
}
{
  const { shadow } = await mount([F.dates(), F.name(), F.contact(), F.consent()]);
  ok(shadow.querySelectorAll('input[type="date"]').length === 2, 'default: departure and return boxes');
  ok(!!shadow.querySelector('.tg-flex-toggle'), 'default: the flexible switch is shown');
}
{
  const { shadow } = await mount([F.dates({ mode: 'single' }), F.name(), F.contact(), F.consent()]);
  ok(shadow.querySelectorAll('input[type="date"]').length === 1 && !!shadow.querySelector('.tg-flex-toggle'), 'single mode alone keeps the flexible switch');
}

// ── 5. Adults 18 and over, children to 17 ────────────────────────────────────
console.log('5. adult age 18');
{
  const { shadow, window, posted } = await mount([F.travellers({ adultMinAge: 18 }), F.name(), F.contact(), F.consent()]);
  ok(rowFor(shadow, 'Adults').querySelector('p').textContent === 'Age 18+', 'adults read "Age 18+"');
  ok(rowFor(shadow, 'Children').querySelector('p').textContent === 'Age 2–17', 'children read "Age 2–17"');
  plus(rowFor(shadow, 'Children')).click();
  const sel = shadow.querySelector('.tg-child-ages select');
  const opts = [...sel.options].map((o) => o.value);
  ok(opts[opts.length - 1] === '17' && /oldest/.test(sel.options[sel.options.length - 1].textContent), 'child ages run to 17 (oldest)');
  sel.value = '17'; fire(window, sel, 'change');
  fillRequired(shadow, window);
  await submit(shadow, window);
  ok(posted.body && posted.body.fields.travellers.childAges[0] === 17, 'a 17-year-old child submits as 17');
}
{
  const { shadow } = await mount([F.travellers(), F.name(), F.contact(), F.consent()]);
  ok(rowFor(shadow, 'Adults').querySelector('p').textContent === 'Age 16+', 'default: adults still "Age 16+"');
  ok(rowFor(shadow, 'Children').querySelector('p').textContent === 'Age 2–15', 'default: children still "Age 2–15"');
  plus(rowFor(shadow, 'Children')).click();
  const sel = shadow.querySelector('.tg-child-ages select');
  ok(sel.options[sel.options.length - 1].value === '15', 'default: child ages still run to 15');
}

// ── 6. "Other" asks how many nights ──────────────────────────────────────────
console.log('6. duration Other');
{
  const { shadow, window, posted } = await mount([
    { id: 'duration', type: 'duration', label: 'Duration', required: true, visible: true, choices: GEORGE_DURATION },
    F.name(), F.contact(), F.consent(),
  ]);
  const pills = [...shadow.querySelectorAll('.tg-pill')];
  const other = pills.find((p) => p.textContent === 'Other');
  const box = shadow.querySelector('.tg-duration-other');
  ok(other && box && box.style.display === 'none', 'the nights box is hidden while 7 nights is selected');
  other.click();
  ok(box.style.display === '', 'choosing Other reveals the nights box');
  ok(box.querySelector('label').textContent === 'How many nights?', 'the box is labelled "How many nights?"');
  const num = box.querySelector('input[type="number"]');
  ok(num && num.getAttribute('min') === '1' && num.getAttribute('max') === '90', 'a whole number of nights, 1 to 90');
  fillRequired(shadow, window);
  await submit(shadow, window);
  ok(fieldError(num) === 'Please enter the number of nights.', 'required + Other + blank box is refused with the nights message');
  num.value = '8'; fire(window, num, 'input');
  await submit(shadow, window);
  ok(posted.body && JSON.stringify(posted.body.fields.duration) === JSON.stringify({ nights: 8 }), 'the number submits as duration.nights');
  pills.find((p) => p.textContent === '5 nights').click();
  ok(box.style.display === 'none', 'picking a fixed option hides the box again');
}
{
  const { shadow, window, posted } = await mount([
    { id: 'duration', type: 'duration', label: 'Duration', required: false, visible: true, choices: GEORGE_DURATION },
    F.name(), F.contact(), F.consent(),
  ]);
  [...shadow.querySelectorAll('.tg-pill')].find((p) => p.textContent === 'Other').click();
  fillRequired(shadow, window);
  await submit(shadow, window);
  ok(posted.body && JSON.stringify(posted.body.fields.duration) === JSON.stringify({ custom: 'Other' }), 'optional + Other + blank submits the label, as before');
}
{
  const { shadow } = await mount([{ id: 'duration', type: 'duration', label: 'Duration', required: true, visible: true }, F.name(), F.consent()]);
  ok(!shadow.querySelector('.tg-duration-other') || shadow.querySelector('.tg-duration-other').style.display === 'none', 'default durations: no nights box in view');
}

// ── 7. Budget: per-person title, true markers, live total ────────────────────
console.log('7. budget');
{
  const { shadow, window } = await mount([F.travellers(), F.budget('Approximate total budget'), F.name(), F.consent()]);
  const field = shadow.querySelector('.tg-range').closest('.tg-field');
  ok(field.querySelector('.tg-label').textContent === 'Approximate budget per person', 'the old default title now reads per person');
  ok(field.querySelector('.tg-budget-pp').textContent === 'per person', 'the amount is marked per person');
  const markers = [...field.querySelectorAll('.tg-budget-markers span')];
  ok(markers.map((m) => m.textContent).join('|') === '£250|£1.5k|£3k|£5k|£10k+', 'five markers ending at £10k+');
  ok(markers.map((m) => m.style.left).join('|') === '0%|25%|50%|75%|100%', 'markers sit on the real slider breakpoints');
  const total = field.querySelector('.tg-budget-total');
  ok(total && total.style.display === '' && total.textContent === 'Approximate total for 2 travellers: £6,000', 'total = £3,000 x 2 adults on load');
  plus(rowFor(shadow, 'Children')).click();
  ok(total.textContent === 'Approximate total for 3 travellers: £9,000', 'adding a child moves the total to 3 travellers');
  const range = field.querySelector('.tg-range');
  range.value = '25'; fire(window, range, 'input');
  ok(field.querySelector('.tg-budget-amount').textContent === '£1,500', 'a quarter along the slider is £1,500 (under the £1.5k marker)');
  ok(total.textContent === 'Approximate total for 3 travellers: £4,500', 'the total follows the slider');
  plus(rowFor(shadow, 'Infants')).click();
  ok(total.textContent === 'Approximate total for 3 travellers: £4,500', 'infants do not count towards the total');
  minus(rowFor(shadow, 'Children')).click(); minus(rowFor(shadow, 'Adults')).click();
  ok(total.textContent === 'Approximate total for 1 traveller: £1,500', 'one traveller reads in the singular');
  range.value = '100'; fire(window, range, 'input');
  ok(field.querySelector('.tg-budget-amount').textContent === '£10,000+' && /£10,000\+$/.test(total.textContent), 'the top of the scale carries its plus sign into the total');
}
{
  const { shadow } = await mount([F.budget('My budget'), F.name(), F.consent()]);
  const field = shadow.querySelector('.tg-range').closest('.tg-field');
  ok(field.querySelector('.tg-label').textContent === 'My budget', "an agent's own title is kept");
  ok(field.querySelector('.tg-budget-total').style.display === 'none', 'no travellers field, no total line');
}
{
  const { shadow } = await mount([F.budget(''), F.name(), F.consent()]);
  ok(shadow.querySelector('.tg-range').closest('.tg-field').querySelector('.tg-label').textContent === 'Approximate budget per person', 'no title falls back to the per-person default');
}

// ── 8. The editor writes what the widget reads ───────────────────────────────
console.log('8. editor keys');
ok(/field\.type === 'daterange'[\s\S]*?field\.options\.mode = 'single'/.test(editor), 'editor dates inspector writes options.mode = single');
ok(/field\.type === 'daterange'[\s\S]*?field\.options\.flex = false/.test(editor), 'editor dates inspector writes options.flex = false');
ok(/field\.type === 'travellers'[\s\S]*?field\.options\.adultMinAge = 18/.test(editor), 'editor travellers inspector writes options.adultMinAge = 18');
ok(/defaultLabel: 'Approximate budget per person'/.test(editor), 'the editor seeds new budget fields with the per-person title');
ok(!/Approximate total budget/.test(editor), 'the old "total budget" default is gone from the editor');
ok(/dOpts\.mode === 'single'/.test(code) && /dOpts\.flex !== false/.test(code), 'widget reads daterange options.mode and options.flex');
ok(/fieldSpec\.options\.adultMinAge\) === '18'/.test(code), 'widget reads travellers options.adultMinAge');

// ── Every new string exists in all six languages ─────────────────────────────
console.log('languages');
for (const key of ['notes_required', 'duration_otherNights', 'duration_nightsRequired', 'budget_total', 'budget_totalOne']) {
  const n = (code.match(new RegExp('^\\s+' + key + ': ', 'gm')) || []).length;
  ok(n === 6, key + ' is defined in six languages (found ' + n + ')');
}
ok((code.match(/^\s+label_budget: /gm) || []).length === 6 && !/label_budget: 'Approximate total budget'/.test(code), 'label_budget is per person in six languages');

// ── George's live form (EF-0025) with the planned settings ───────────────────
console.log("George's form");
{
  const george = [
    { id: 'interests', type: 'interests', label: 'What type of trip are you looking for?', required: true, visible: true, options: {}, choices: ['Beach', 'City break', 'Adventure'].map((l) => ({ value: l, label: l })) },
    { id: 'destination', type: 'destination', label: 'Where are you dreaming of?', required: true, visible: true, options: { mode: 'text' }, help: 'E.g. Mediterranean, Italy, Cancun...' },
    { id: 'duration', type: 'duration', label: 'Duration', required: true, visible: true, options: {}, choices: GEORGE_DURATION },
    { id: 'travel_dates', type: 'daterange', label: 'Travel dates', required: true, visible: true, options: { mode: 'single', flex: false } },
    { id: 'travellers', type: 'travellers', label: "Who's travelling?", required: true, visible: true, options: { adultMinAge: 18 }, help: 'If under 18s are travelling, please provide age accurate at the time of the return flight' },
    { id: 'budget_pp', type: 'budget', label: 'Approximate budget per person', required: true, visible: true, options: {} },
    { id: 'flights_ia0pkxo', type: 'flights', label: 'Would you like this to include flights?', required: true, visible: true, options: {} },
    { id: 'airport_ucatgzj', type: 'airport', label: 'Departure airport', required: false, visible: true, options: {} },
    { id: 'stars', type: 'stars', label: 'Star rating preference', required: false, visible: true, options: {} },
    { id: 'board', type: 'board', label: 'Board basis', required: true, visible: true, options: { default: 'AI' } },
    { id: 'notes_k9rozpq', type: 'notes', label: 'Dietary restrictions', required: true, visible: true, options: { placeholder: 'Dietary requirements, severity of allergy/intolerance, any specific food requests' } },
    { id: 'notes', type: 'notes', label: "Tell me more about what's needed for your trip", required: false, visible: true, options: {} },
    F.name(), { id: 'contact', type: 'contact', label: 'How to reach you', required: true, visible: true, options: { phoneRequired: true } },
    { id: 'contactpref_rq2zf2a', type: 'contactpref', label: 'How can we get in touch?', required: true, visible: true, options: { branches: [{ match: 'A quick call', message: 'Grab a time that suits you: https://calendly.com/george-freefromtravel/enquiry-discovery\n\nAs mentioned, the most useful thing we can do next is have a quick chat.\n' }] } },
    F.consent(),
  ];
  const { shadow } = await mount(george);
  const destField = shadow.querySelector('input[aria-label="Where are you dreaming of?"]');
  ok(destField && destField.classList.contains('tg-input') && !destField.closest('.tg-field').querySelector('.tg-dest-drop'), 'destination is a plain text box with no suggestions list');
  ok(shadow.querySelectorAll('input[type="date"]').length === 1 && !shadow.querySelector('.tg-flex-toggle'), 'one date box, no flexible switch');
  ok(rowFor(shadow, 'Adults').querySelector('p').textContent === 'Age 18+', 'adults 18 and over');
  ok([...shadow.querySelectorAll('.tg-pill')].some((p) => p.textContent === 'Other') && !!shadow.querySelector('.tg-duration-other'), 'Other is there with its nights box');
  const diet = [...shadow.querySelectorAll('textarea')].find((t) => t.closest('.tg-field').querySelector('.tg-label').textContent.indexOf('Dietary') === 0);
  ok(diet && !/optional/i.test(diet.closest('.tg-field').querySelector('.tg-label').textContent), 'Dietary restrictions no longer says optional');
  const budgetField = shadow.querySelector('.tg-range').closest('.tg-field');
  ok(budgetField.querySelector('.tg-label').textContent === 'Approximate budget per person' && budgetField.querySelector('.tg-budget-total').textContent === 'Approximate total for 2 travellers: £6,000', 'budget titled per person with the total underneath');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
