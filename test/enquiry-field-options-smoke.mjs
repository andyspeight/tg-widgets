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
async function mount(fields) {
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
  new window.TGEnquiryWidget(mountEl, {
    formId: 't', widgetId: 'demo', name: 'Test',
    header: { title: 'T', subtitle: 'S' },
    thankYou: { mode: 'inline', message: 'x' },
    branding: { buttonColour: '#111111', accentColour: '#222222', theme: 'light' },
    security: { honeypot: true, turnstile: false },
    fieldsJSON: fields,
  });
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
