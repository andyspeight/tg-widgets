/**
 * Enquiry Form — three per-field options added for the Free From Travel
 * feedback (4 Aug 2026), each gated so every OTHER form is untouched:
 *
 *   board.options.default        → which board basis loads pre-selected (#9)
 *   contact.options.phoneRequired → phone becomes mandatory (#4)
 *   destination.options.placeholder → the in-field example text (#6)
 *
 * All three ride inside fieldsJSON (no server change) and the widget reads them
 * from field.options, the SAME place the editor writes them — a mismatch there
 * would silently do nothing, so this test mounts the REAL widget in jsdom and
 * asserts the rendered DOM, then proves the absent-option default is unchanged.
 *
 * Run: node test/enquiry-field-options-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const code = readFileSync(new URL('../public/widget-enquiry.js', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../public/editor-enquiry.html', import.meta.url), 'utf8');

/** Mount the real widget with a single-page form built from `fields`, return the shadow root. */
async function mount(fields, extra) {
  const dom = new JSDOM('<!doctype html><html><body><div id="m"></div></body></html>',
    { runScripts: 'dangerously', url: 'https://agency.example.com/', pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '' });
  const s = window.document.createElement('script'); s.textContent = code; window.document.body.appendChild(s);
  await sleep(10);
  const mountEl = window.document.getElementById('m');
  // No `step` on the fields → single-page render, so every field is present at once.
  new window.TGEnquiryWidget(mountEl, Object.assign({
    formId: 't', widgetId: 'demo', name: 'Test',
    header: { title: 'T', subtitle: 'S' },
    thankYou: { mode: 'inline', message: 'x' },
    branding: { buttonColour: '#111111', accentColour: '#222222', theme: 'light' },
    security: { honeypot: true, turnstile: false },
    fieldsJSON: fields,
  }, extra || {}));
  await sleep(40);
  const shadow = mountEl.shadowRoot;
  if (!shadow) throw new Error('widget did not attach a shadow root');
  return shadow;
}

const F = {
  destination: (opts) => ({ id: 'destination', type: 'destination', label: 'Where?', required: true, visible: true, options: opts || {} }),
  board: (opts) => ({ id: 'board', type: 'board', label: 'Board basis', required: true, visible: true, options: opts || {} }),
  contact: (opts) => ({ id: 'contact', type: 'contact', label: 'Contact', required: true, visible: true, options: opts || {} }),
  name: () => ({ id: 'name', type: 'name', label: 'Your name', required: true, visible: true }),
  consent: () => ({ id: 'consent', type: 'consent', label: 'Consent', required: true, visible: true }),
};

// ── With the three options SET ───────────────────────────────────────────────
{
  const shadow = await mount([
    F.destination({ placeholder: 'E.g. the Maldives, or "somewhere hot"' }),
    F.board({ default: 'AI' }),
    F.contact({ phoneRequired: true }),
    F.name(), F.consent(),
  ]);

  // #9 — All inclusive pre-selected
  const seg = [...shadow.querySelectorAll('.tg-seg-btn')];
  const ai = seg.find((b) => b.getAttribute('data-value') === 'AI');
  const ro = seg.find((b) => b.getAttribute('data-value') === 'RO');
  ok(ai && ai.classList.contains('is-active') && ai.getAttribute('aria-pressed') === 'true', '#9 AI board is pre-selected when options.default = AI');
  ok(ro && !ro.classList.contains('is-active'), '#9 RO is no longer the active default');

  // #4 — phone mandatory: required attribute present, "(optional)" hint gone
  const phone = shadow.querySelector('input[type="tel"]');
  ok(phone && phone.hasAttribute('required'), '#4 phone input carries required when phoneRequired = true');
  const phoneLabel = phone && phone.closest('div') && phone.closest('div').querySelector('label');
  ok(phoneLabel && !/optional/i.test(phoneLabel.textContent), '#4 the "(optional)" hint is dropped for a required phone');

  // #6 — destination placeholder is the author's text
  const dest = shadow.querySelector('.tg-dest-input');
  ok(dest && dest.getAttribute('placeholder') === 'E.g. the Maldives, or "somewhere hot"', '#6 destination shows the author example text');
}

// ── With NONE of the options set: everything is exactly as before ─────────────
{
  const shadow = await mount([
    F.destination(), F.board(), F.contact(), F.name(), F.consent(),
  ]);

  const seg = [...shadow.querySelectorAll('.tg-seg-btn')];
  const ai = seg.find((b) => b.getAttribute('data-value') === 'AI');
  const ro = seg.find((b) => b.getAttribute('data-value') === 'RO');
  ok(ro && ro.classList.contains('is-active'), 'default: RO is still the pre-selected board (unchanged)');
  ok(ai && !ai.classList.contains('is-active'), 'default: AI is not pre-selected without the option');

  const phone = shadow.querySelector('input[type="tel"]');
  ok(phone && !phone.hasAttribute('required'), 'default: phone stays optional (no required attribute)');
  const phoneLabel = phone && phone.closest('div') && phone.closest('div').querySelector('label');
  ok(phoneLabel && /optional/i.test(phoneLabel.textContent), 'default: the "(optional)" hint is still shown');

  const dest = shadow.querySelector('.tg-dest-input');
  ok(dest && /search/i.test(dest.getAttribute('placeholder') || ''), 'default: destination keeps its built-in search placeholder');
}

// ── An unrecognised board default must fall back, never render a dead button ──
{
  const shadow = await mount([F.board({ default: 'ZZ' }), F.name(), F.consent()]);
  const seg = [...shadow.querySelectorAll('.tg-seg-btn')];
  const active = seg.filter((b) => b.classList.contains('is-active'));
  ok(active.length === 1 && active[0].getAttribute('data-value') === 'RO', 'a bogus board default falls back to RO (exactly one active button)');
}

// ── Editor writes to the SAME keys the widget reads (the mismatch guard) ──────
// The widget reads field.options.{default,phoneRequired,placeholder}; the editor
// inspectors must write to those same paths or the controls do nothing.
ok(/field\.type === 'board'[\s\S]*field\.options\.default = v/.test(editor), 'editor board inspector writes options.default');
ok(/field\.type === 'contact'[\s\S]*field\.options\.phoneRequired = v/.test(editor), 'editor contact inspector writes options.phoneRequired');
ok(/field\.type === 'destination'[\s\S]*field\.options\.placeholder = v/.test(editor), 'editor destination inspector writes options.placeholder');
ok(/fieldSpec\.options && fieldSpec\.options\.default/.test(code), 'widget board reads options.default');
ok(/fieldSpec\.options && fieldSpec\.options\.phoneRequired/.test(code), 'widget contact reads options.phoneRequired');
ok(/fieldSpec\.options && fieldSpec\.options\.placeholder/.test(code), 'widget destination reads options.placeholder');

// ── #3 Editable duration options ─────────────────────────────────────────────
// Pure parser, reimplemented from widget-enquiry.js normaliseDurationOptions.
function normDur(choices) {
  if (!Array.isArray(choices) || !choices.length) return null;
  const out = [];
  for (let i = 0; i < choices.length && out.length < 12; i++) {
    let label = (choices[i] && typeof choices[i] === 'object') ? (choices[i].label ?? choices[i].value ?? '') : choices[i];
    label = String(label == null ? '' : label).trim().slice(0, 40);
    if (!label) continue;
    const m = label.match(/^(\d{1,3})(?:\s*nights?)?$/i);
    let nights = m ? parseInt(m[1], 10) : null;
    if (nights != null && (nights < 1 || nights > 90)) nights = null;
    out.push(nights != null ? { nights, custom: null } : { nights: null, custom: label });
  }
  return out.length ? out : null;
}
ok(normDur(null) === null && normDur([]) === null, 'no custom durations → null (built-in [3,5,7,10,14])');
ok(JSON.stringify(normDur(['7'])) === JSON.stringify([{ nights: 7, custom: null }]), 'a bare number is an N-night option');
ok(normDur(['7 nights'])[0].nights === 7, '"7 nights" parses to a night count');
ok(normDur(['3-5 nights'])[0].custom === '3-5 nights' && normDur(['3-5 nights'])[0].nights === null, 'a range is a custom option (submitted verbatim)');
ok(normDur(['200'])[0].nights === null && normDur(['200'])[0].custom === '200', 'an out-of-range number falls back to a custom label, never a bad nights value');
{
  const d = normDur(['3 nights', '5 nights']);
  ok(d.length === 2 && d[0].nights === 3 && d[1].nights === 5, '"3-5 nights" split into two options each map to their own night count');
}
ok(/function normaliseDurationOptions\(fieldSpec\)/.test(code), 'widget exposes normaliseDurationOptions');
ok(/fields\.duration = \(o\.nights != null\) \? \{ nights: o\.nights \} : \{ custom:/.test(code), 'duration submits nights for a count and custom for a range');

// Real render: custom pills, and defaults untouched.
{
  const shadow = await mount([
    { id: 'duration', type: 'duration', label: 'Duration', required: true, visible: true, choices: [{ value: '3 nights', label: '3 nights' }, { value: '5 nights', label: '5 nights' }, { value: '3-5 nights', label: '3-5 nights' }, { value: '10 nights', label: '10 nights' }] },
    F.name(), F.consent(),
  ]);
  const pills = [...shadow.querySelectorAll('.tg-pill')].map(p => p.textContent);
  ok(pills.length === 4, '#3 custom duration renders exactly the author options');
  ok(pills.join('|') === '3 nights|5 nights|3-5 nights|10 nights', '#3 pills show the author labels (3 and 5 as separate options)');
  const active = [...shadow.querySelectorAll('.tg-pill.is-active')];
  ok(active.length === 1 && active[0].textContent === '3 nights', '#3 without 7 nights present, the first option is pre-selected');
}
{
  const shadow = await mount([{ id: 'duration', type: 'duration', label: 'Duration', required: true, visible: true }, F.name(), F.consent()]);
  const pills = [...shadow.querySelectorAll('.tg-pill')];
  ok(pills.length === 5, 'default: still the five built-in night options');
  const active = [...shadow.querySelectorAll('.tg-pill.is-active')];
  ok(active.length === 1 && /7 nights/.test(active[0].textContent), 'default: 7 nights stays pre-selected (unchanged)');
}

// ── #7 Open-text destination mode ────────────────────────────────────────────
{
  const shadow = await mount([{ id: 'destination', type: 'destination', label: 'Where?', required: true, visible: true, options: { mode: 'text' } }, F.name(), F.consent()]);
  ok(!shadow.querySelector('.tg-dest-input'), '#7 open-text mode does NOT render the search combobox');
  ok(shadow.querySelector('input[aria-label="Where?"]'), '#7 open-text mode renders a plain text box');
}
{
  const shadow = await mount([F.destination(), F.name(), F.consent()]);
  ok(shadow.querySelector('.tg-dest-input'), 'default: destination is still the live search box');
}
ok(/fieldSpec\.options && fieldSpec\.options\.mode === 'text'/.test(code), 'widget branches destination on options.mode');
ok(/type: 'free-text'/.test(code), 'open-text submits the same free-text shape the search field already produces');
ok(/field\.type === 'destination'[\s\S]*field\.options\.mode = 'text'/.test(editor), 'editor destination inspector writes options.mode');
ok(/field\.type === 'duration'[\s\S]*field\.choices = lines\.map/.test(editor), 'editor duration inspector writes field.choices');

// ── #10 "Include flights?" toggle reveals the airport field ──────────────────
const airportField = { id: 'airport_x', type: 'airport', label: 'Departure airport', required: true, visible: true, options: {} };
const flightsField = (opts) => ({ id: 'flights', type: 'flights', label: 'Include flights?', required: false, visible: true, options: opts || {} });
// True when an element or any ancestor is display:none (jsdom has no layout).
function isHidden(elm) {
  let n = elm;
  while (n && n.nodeType === 1) { if (n.style && n.style.display === 'none') return true; n = n.parentNode; }
  return false;
}
const airportInputOf = (shadow) => shadow.querySelector('input[aria-label="Search airports"]');

{
  const shadow = await mount([flightsField(), airportField, F.name(), F.consent()]);
  const yes = shadow.querySelector('.tg-seg-btn[data-v="yes"]');
  const no = shadow.querySelector('.tg-seg-btn[data-v="no"]');
  ok(yes && no, '#10 flights field renders Yes and No');
  ok(no.classList.contains('is-active') && !yes.classList.contains('is-active'), '#10 defaults to No');
  const ap = airportInputOf(shadow);
  ok(ap && isHidden(ap), '#10 airport is hidden while the answer is No');
  yes.click();
  ok(!isHidden(ap), '#10 answering Yes reveals the airport field');
  no.click();
  ok(isHidden(ap), '#10 answering No again hides it');
}
{
  // Pre-answered Yes: airport visible from the start.
  const shadow = await mount([flightsField({ default: 'yes' }), airportField, F.name(), F.consent()]);
  const yes = shadow.querySelector('.tg-seg-btn[data-v="yes"]');
  ok(yes.classList.contains('is-active'), '#10 default: yes pre-selects Yes');
  ok(!isHidden(airportInputOf(shadow)), '#10 default: yes shows the airport immediately');
}
{
  // Airport WITHOUT a flights field: shows exactly as before (no gating).
  const shadow = await mount([airportField, F.name(), F.consent()]);
  ok(!isHidden(airportInputOf(shadow)), '#10 an airport field with no flights toggle is shown as always');
}
ok(/flights:     renderFlights/.test(code), 'flights type is registered in RENDERERS');
ok(/function renderFlights\(instance, fieldSpec, t\)/.test(code), 'widget has a flights renderer');
ok(/fields\.flights_included = value/.test(code), 'flights submits flights_included (the server already stores it)');
ok(/airportInst\.validate = function \(\) \{ return on \? baseValidate/.test(code), 'a hidden airport is not validated');
ok(/airportInst\.writeTo = function \(f\) \{ if \(on\) baseWriteTo/.test(code), 'a hidden airport is not submitted');
ok(/id: 'flights'[\s\S]*category: 'Core'/.test(editor), 'editor palette lists the flights field');
ok(/case 'flights':/.test(editor), 'editor canvas has a flights preview');
// #3 follow-through: the canvas preview no longer shows a single "3–5 nights"
// pill (which is what made 3 and 5 look grouped in the editor).
ok(!/'3–5 nights', '7 nights', '10 nights', '14 nights', 'Custom'/.test(editor), 'the misleading grouped duration preview is gone');

// ── #5 Contact-preferences field ─────────────────────────────────────────────
{
  const shadow = await mount([
    { id: 'cpref', type: 'contactpref', label: 'How can we get in touch?', required: true, visible: true,
      help: 'A quick call tells me far more than a form can.',
      choices: [{ value: 'A quick call', label: 'A quick call' }, { value: 'WhatsApp', label: 'WhatsApp' }, { value: 'Email', label: 'Email' }] },
    F.name(), F.consent(),
  ]);
  const chips = [...shadow.querySelectorAll('.tg-pill')];
  ok(chips.length === 3 && chips.map(c => c.getAttribute('data-value')).join('|') === 'A quick call|WhatsApp|Email', '#5 renders the author choices as a multi-select');
  ok([...shadow.querySelectorAll('.tg-help')].some(h => /far more than a form/.test(h.textContent)), '#5 the description (help) is shown above the options');
  // Multi-select: two can be active at once.
  chips[0].click(); chips[2].click();
  ok(chips[0].classList.contains('is-active') && chips[2].classList.contains('is-active') && !chips[1].classList.contains('is-active'), '#5 more than one option can be chosen');
}
{
  // No choices set → the built-in call/WhatsApp/Email default.
  const shadow = await mount([{ id: 'cpref', type: 'contactpref', label: 'How can we get in touch?', required: false, visible: true }, F.name(), F.consent()]);
  const chips = [...shadow.querySelectorAll('.tg-pill')].map(c => c.getAttribute('data-value'));
  ok(chips.join('|') === 'A quick call|WhatsApp|Email', '#5 default choices are call / WhatsApp / Email');
}
ok(/contactpref: renderContactPref/.test(code), 'contactpref is registered in RENDERERS');
ok(/fields\.contact_preference = selected\.slice\(\)/.test(code), 'contactpref submits contact_preference');
ok(/f\.contact_preference !== undefined/.test(readFileSync(new URL('../api/enquiry/submit.js', import.meta.url), 'utf8')), 'server validates contact_preference');
ok(/contactPreference: contactPrefStr/.test(readFileSync(new URL('../api/enquiry/_lib/routing/email.js', import.meta.url), 'utf8')), 'agent email carries the contact preference');
ok(/Preferred contact', t\.contactPreference/.test(readFileSync(new URL('../public/_enquiry-agent-email.js', import.meta.url), 'utf8')), 'the email template shows a Preferred contact row');
ok(/id: 'contactpref'/.test(editor) && /field\.type === 'contactpref'/.test(editor) && /case 'contactpref':/.test(editor), 'editor has the contactpref palette entry, inspector and preview');

// ── #8 Branched thank-you + link/paragraph formatting ────────────────────────
async function mountWidget(fields, thankYou) {
  const dom = new JSDOM('<!doctype html><html><body><div id="m"></div></body></html>',
    { runScripts: 'dangerously', url: 'https://agency.example.com/', pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '' });
  const s = window.document.createElement('script'); s.textContent = code; window.document.body.appendChild(s);
  await sleep(10);
  const mountEl = window.document.getElementById('m');
  const inst = new window.TGEnquiryWidget(mountEl, {
    formId: 't', widgetId: 'demo', name: 'Test',
    header: { title: 'T', subtitle: 'S' },
    thankYou: thankYou || { mode: 'inline', message: "Thanks {firstName} — we're on it" },
    branding: { buttonColour: '#111111', accentColour: '#222222', theme: 'light' },
    security: { honeypot: true, turnstile: false },
    fieldsJSON: fields,
  });
  await sleep(20);
  return { inst, shadow: mountEl.shadowRoot };
}
const CPREF_BRANCHED = {
  id: 'cpref', type: 'contactpref', label: 'How can we get in touch?', required: false, visible: true,
  choices: [{ value: 'A quick call', label: 'A quick call' }, { value: 'Email', label: 'Email' }],
  options: { branches: [{ match: 'A quick call', message: 'Great, {firstName} — grab a slot:\n\nhttps://calendly.com/george/chat\n\nSpeak soon.' }] }
};
{
  const { inst, shadow } = await mountWidget([CPREF_BRANCHED, F.name(), F.consent()]);
  inst._renderThankYou({ reference: 'TG-1' }, 'George', { contact_preference: ['A quick call'] });
  const link = shadow.querySelector('.tg-ty a');
  ok(link && link.getAttribute('href') === 'https://calendly.com/george/chat', '#8 caller sees the Calendly link, clickable');
  ok(link.getAttribute('rel') === 'noopener noreferrer' && link.getAttribute('target') === '_blank', '#8 the link opens safely in a new tab');
  ok(/Great, George/.test(shadow.querySelector('.tg-ty h2').textContent), '#8 the branch message is used and {firstName} filled in');
  ok(shadow.querySelectorAll('.tg-ty > p').length >= 1, '#8 a multi-paragraph message renders body paragraphs, not one giant heading');
}
{
  const { inst, shadow } = await mountWidget([CPREF_BRANCHED, F.name(), F.consent()]);
  inst._renderThankYou({ reference: 'TG-2' }, 'George', { contact_preference: ['Email'] });
  ok(!shadow.querySelector('.tg-ty a'), '#8 a non-caller does NOT see the Calendly link');
  ok(/we're on it/.test(shadow.querySelector('.tg-ty h2').textContent), '#8 a non-caller gets the base thank-you');
}
{
  // Formatting alone: a raw URL in any thank-you becomes clickable, no branches needed.
  const { inst, shadow } = await mountWidget([F.name(), F.consent()], { mode: 'inline', message: 'Thanks {firstName}.\n\nBook here: https://example.com/book' });
  inst._renderThankYou({ reference: 'TG-3' }, 'Sam', {});
  const a = shadow.querySelector('.tg-ty a');
  ok(a && a.getAttribute('href') === 'https://example.com/book', '#8 a raw URL in the thank-you is made clickable');
}
{
  // A simple one-line custom message is visually unchanged (headline + fixed body, no link parsing).
  const { inst, shadow } = await mountWidget([F.name(), F.consent()], { mode: 'inline', message: 'Thanks {firstName}, all done' });
  inst._renderThankYou({ reference: 'TG-4' }, 'Sam', {});
  ok(/Thanks Sam, all done/.test(shadow.querySelector('.tg-ty h2').textContent) && !shadow.querySelector('.tg-ty a'), '#8 a simple message keeps the classic thank-you unchanged');
}
ok(/ff\.type === 'contactpref' && ff\.options && Array\.isArray\(ff\.options\.branches\)/.test(code), 'widget reads branches from the contactpref field (rides in fieldsJSON, no config plumbing)');
ok(/function makeRichParagraph/.test(code) && /function linkifyInto/.test(code), 'widget has the safe link/paragraph helpers');
ok(/href: url, target: '_blank', rel: 'noopener noreferrer'/.test(code), 'links are built as attributes (no innerHTML), http(s) only');
ok(/Branch by contact preference/.test(editor) && /cf\.options\.branches/.test(editor), 'editor thank-you inspector edits the contactpref branches');

// ── #1 Reply-time badge (per-form) ───────────────────────────────────────────
{
  const shadow = await mount([F.name(), F.consent()], { replyBadge: '2 business days reply' });
  const trust = [...shadow.querySelectorAll('.tg-trust span')].map(s => s.textContent);
  ok(trust.some(x => /2 business days reply/.test(x)), '#1 the reply badge shows the per-form text');
  ok(!trust.some(x => /24hr reply/.test(x)), '#1 the default "24hr reply" is replaced');
}
{
  const shadow = await mount([F.name(), F.consent()]);
  const trust = [...shadow.querySelectorAll('.tg-trust span')].map(s => s.textContent);
  ok(trust.some(x => /24hr reply/.test(x)), '#1 default: the badge falls back to "24hr reply"');
}
ok(/config\.replyBadge \|\| t\('reply24hr'\)/.test(code), 'widget prefers config.replyBadge over the built-in');
ok(/replyBadge: \(typeof config\.replyBadge === 'string'\)/.test(code), '_normalise preserves replyBadge');
{
  const cfgApi = readFileSync(new URL('../api/enquiry-form-config.js', import.meta.url), 'utf8');
  ok(/replyBadge:\s*'fld3quHF9gDUo0xS2'/.test(cfgApi), 'config API maps replyBadge to its Airtable column');
  ok(/payload\.replyBadge !== undefined\)\s*fields\[EF\.replyBadge\] = safeStr\(payload\.replyBadge, 40\)/.test(cfgApi), 'config API saves replyBadge (bounded)');
  ok(/replyBadge: f\[EF\.replyBadge\] \|\| ''/.test(cfgApi), 'config API reads replyBadge for the editor');
  ok(/replyBadge: pub\.replyBadge/.test(cfgApi), 'config API surfaces replyBadge to the widget');
  ok(/Reply-time badge/.test(editor), 'editor header inspector has a reply-badge control');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
