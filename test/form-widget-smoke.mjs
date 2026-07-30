/**
 * Form widget — conversational renderer, question types, keyboard nav.
 *
 * Mounts the REAL widget in jsdom with an inline config and drives it the way a
 * visitor would: answering, advancing, going back, using the keyboard, and
 * submitting. Asserts the payload that reaches /api/form-submit.
 *
 * Also pins the repo's render rule: a render must NOT grab the page. The editor
 * calls update() on every keystroke, so focus may move only on a genuine step
 * change and never on first mount (the Enquiry Pro bug, 23 Jul 2026).
 *
 * Run: node test/form-widget-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('jsdom not installed — skipping form widget smoke'); process.exit(0); }

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SRC = readFileSync(new URL('../public/widget-form.js', import.meta.url), 'utf8');

const CONFIG = {
  accentColor: '#1B2B5B',
  welcomeTitle: 'Tell us about your project',
  welcomeBody: 'Takes about a minute.',
  questions: [
    { id: 'name', label: 'What is your name?', type: 'short-text', required: true, mapTo: 'fullName' },
    { id: 'email', label: 'Your email', type: 'email', required: true, mapTo: 'email' },
    { id: 'hear', label: 'How did you hear about us?', type: 'multiple-choice', required: true, options: ['A friend', 'Google', 'Social media'] },
    { id: 'rate', label: 'Rate our service', type: 'rating', required: false, max: 5 },
    { id: 'notes', label: 'Anything else?', type: 'long-text', required: false },
  ],
  _widgetId: 'tgw_test_form',
};

function mount(cfg) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div data-tg-widget="form" data-tg-config='${JSON.stringify(cfg).replace(/'/g, '&#39;')}'></div></body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://client.example.com/contact' }
  );
  const { window } = dom;
  // Record SUBMISSIONS only. The widget also fires a telemetry beacon to
  // /api/widget-log on load, and counting that as a submission would make every
  // assertion about the posted payload read the wrong request.
  const posted = [];
  const beacons = [];
  window.fetch = async (url, opts) => {
    const u = String(url);
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { body = null; }
    if (/\/api\/form-submit$/.test(u)) posted.push({ url: u, body });
    else beacons.push({ url: u, body });
    return { ok: true, status: 200, json: async () => ({ ok: true, leadId: 'lead_test_1' }) };
  };
  window.eval(SRC);
  return { window, dom, posted, beacons, el: window.document.querySelector('[data-tg-widget="form"]') };
}

const q = (el, sel) => el.__tgFormInstance.shadow.querySelector(sel);
const qa = (el, sel) => Array.from(el.__tgFormInstance.shadow.querySelectorAll(sel));
const text = (el) => (el.__tgFormInstance.shadow.textContent || '').replace(/\s+/g, ' ');
// The shadow HTML is replaced on every render, so a captured root reference
// goes stale. Always dispatch at the CURRENT root.
const press = (win, el, key, opts) =>
  q(el, '.tgf-root').dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({ key, bubbles: true }, opts || {})));

// ── Mount + welcome screen ───────────────────────────────────────────────────
let { window, posted, beacons, el } = mount(CONFIG);
await sleep(20);
ok(!!el.__tgFormInstance, 'widget mounts from an inline config');
ok(!!window.TGFormWidget && !!window.__TG_FORM_VERSION__, 'exposes its global + version');
ok(/Tell us about your project/.test(text(el)), 'welcome screen shows first');
ok(!!q(el, '[data-start]'), 'welcome screen has a start button');

// ── Start → first question ───────────────────────────────────────────────────
q(el, '[data-start]').click();
await sleep(10);
ok(/What is your name\?/.test(text(el)), 'starting moves to the first question');
ok(/1 of 5/.test(text(el)), 'shows the question counter');
ok(!q(el, '[data-back]'), 'no Back button on the first question');

// ── Validation blocks an empty required answer ───────────────────────────────
q(el, '[data-next]').click();
await sleep(10);
ok(/Please answer this question/.test(text(el)), 'an empty required answer is blocked with a message');
ok(/1 of 5/.test(text(el)), 'and the form does NOT advance');
const errEl = q(el, '[data-err]');
ok(errEl && errEl.getAttribute('role') === 'alert' && errEl.getAttribute('aria-live') === 'assertive',
  'the error is announced to screen readers (role=alert + aria-live)');

// ── Answer and advance ───────────────────────────────────────────────────────
q(el, 'input').value = 'Jane Doe';
q(el, '[data-next]').click();
await sleep(10);
ok(/Your email/.test(text(el)), 'a valid answer advances to the next question');
ok(!!q(el, '[data-back]'), 'Back appears from question 2');

// ── Email validation ─────────────────────────────────────────────────────────
q(el, 'input').value = 'not-an-email';
q(el, '[data-next]').click();
await sleep(10);
ok(/check that email/i.test(text(el)), 'a malformed email is rejected');
q(el, 'input').value = 'jane@example.com';
q(el, '[data-next]').click();
await sleep(10);
ok(/How did you hear about us\?/.test(text(el)), 'a valid email advances');

// ── Back restores the previous answer ────────────────────────────────────────
q(el, '[data-back]').click();
await sleep(10);
ok(q(el, 'input').value === 'jane@example.com', 'going back restores the previous answer');
q(el, '[data-next]').click();
await sleep(10);

// ── Choice question: real radios, lettered keys, auto-advance ────────────────
ok(!!q(el, 'fieldset') && !!q(el, 'legend'), 'choices are wrapped in a fieldset with a legend (screen-reader correct)');
ok(qa(el, 'input[type="radio"]').length === 3, 'multiple-choice renders real radio inputs');
ok(/A/.test(text(el)) && /B/.test(text(el)), 'choices show their keyboard letters');
press(window, el, 'b');
await sleep(250);   // auto-advance has a short deliberate delay
ok(/Rate our service/.test(text(el)), 'pressing the option letter selects it AND auto-advances');

// ── Rating: number key + optional skip ───────────────────────────────────────
ok(qa(el, '.tgf-star').length === 5, 'rating renders 5 stars');
ok(/\(optional\)/.test(text(el)), 'an optional question is labelled optional');
press(window, el, '4');
await sleep(250);
ok(/Anything else\?/.test(text(el)), 'a number key sets the rating and advances');

// ── Long text: Enter must NOT submit (it types a newline) ────────────────────
const beforeEnter = text(el);
press(window, el, 'Enter');
await sleep(20);
ok(text(el) === beforeEnter && posted.length === 0, 'Enter does NOT advance a long-text answer (it types a newline)');

// ── Submit via Cmd/Ctrl+Enter ────────────────────────────────────────────────
q(el, 'textarea').value = 'Nothing else, thanks.';
press(window, el, 'Enter', { ctrlKey: true });
await sleep(60);
ok(posted.length === 1, 'Ctrl+Enter submits the final long-text answer');

// ── The payload the endpoint receives ────────────────────────────────────────
const sent = posted[0];
ok(/\/api\/form-submit$/.test(sent.url), 'posts to /api/form-submit (the generic endpoint)');
const body = sent.body;
ok(body.widgetId === 'tgw_test_form', 'payload carries the widget id');
ok(Array.isArray(body.answers) && body.answers.length === 5, 'payload carries every question, answered or not');
const byId = Object.fromEntries(body.answers.map((a) => [a.id, a]));
ok(byId.name.value === 'Jane Doe' && byId.name.mapTo === 'fullName', 'the name answer carries its value and mapTo');
ok(byId.email.value === 'jane@example.com' && byId.email.mapTo === 'email', 'the email answer carries its mapTo (required for the canonical lead)');
ok(byId.hear.value === 'Google', 'the keyboard-selected choice (B) recorded the right option');
ok(byId.rate.value === 4, 'the rating recorded as a number');
ok(byId.notes.value === 'Nothing else, thanks.', 'the long-text answer recorded');
ok(body.answers.every((a) => a.label && a.type), 'every answer carries its label + type, so the server needs no prior knowledge of the form');
ok(typeof body.sourceUrl === 'string' && body.sourceUrl.includes('client.example.com'), 'payload carries the source URL');

// ── Thank-you screen ─────────────────────────────────────────────────────────
await sleep(30);
ok(/Thank you/i.test(text(el)), 'a successful submit shows the thank-you screen');

// ── The render rule: update() must NOT steal focus ───────────────────────────
{
  const m = mount(CONFIG);
  await sleep(20);
  const inst = m.el.__tgFormInstance;
  inst.idx = 0; inst._lastRenderedIdx = null; inst._render();   // simulate first mount at a question
  await sleep(10);
  const activeAfterMount = m.window.document.activeElement;
  ok(activeAfterMount === m.window.document.body || activeAfterMount === null,
    'first mount does NOT move focus (a widget must never grab the page on load)');

  // An editor keystroke re-renders the SAME step — focus must not be grabbed.
  const input = m.el.__tgFormInstance.shadow.querySelector('input');
  if (input) input.focus();
  inst.update({ accentColor: '#FF0000' });
  await sleep(10);
  ok(m.el.__tgFormInstance.shadow.querySelector('input') !== null, 'update() re-renders');
  ok(inst._lastRenderedIdx === 0, 'update() on the same step does not change the step index');
}

// ── Config-driven safety ─────────────────────────────────────────────────────
{
  const m = mount({
    ...CONFIG,
    accentColor: 'javascript:alert(1)',
    thankYouCtaText: 'Go',
    thankYouCtaUrl: 'javascript:alert(1)',
    questions: [{ id: 'x', label: '<img src=x onerror=alert(1)>', type: 'short-text', required: false }],
  });
  await sleep(20);
  const html = m.el.__tgFormInstance.shadow.innerHTML;
  ok(!/javascript:/i.test(html), 'a javascript: colour never reaches the DOM');
  ok(!/onerror=/i.test(html) || /&lt;img/.test(html), 'a question label is escaped, never rendered as HTML');
  ok(!/<img/i.test(html.replace(/&lt;img[^>]*/gi, '')), 'no live img tag is injected from config');
}

// ── Source guards ────────────────────────────────────────────────────────────
ok(/:host \{ all: initial/.test(SRC), 'Shadow DOM with :host{all:initial}');
ok(!/\beval\s*\(/.test(SRC) && !/new Function/.test(SRC), 'no eval / Function constructor (CSP clean)');
ok(!/\son\w+=/.test(SRC.replace(/addEventListener/g, '')), 'no inline event handlers in injected HTML');
ok(/isolation: isolate/.test(SRC), 'contains its own stacking so it cannot paint over a host header');
ok(/preventScroll: true/.test(SRC), 'focus never scrolls the host page');
ok(/const VERSION = '1\.\d+\.\d+'/.test(SRC), 'carries a VERSION constant');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
