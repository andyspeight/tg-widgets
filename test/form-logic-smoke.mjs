/**
 * Form widget — branching logic (Phase 2).
 *
 * Rules are PURE DATA evaluated by a hardcoded dispatch table, the same stance
 * as tgse-rules.js: no eval, no Function constructor, so a rule can never carry
 * executable code. Every malformed input must FAIL OPEN to "go to the next
 * question" — a broken rule must never strand a visitor mid-form.
 *
 * Drives the REAL engine, and then drives a REAL branching form end to end in
 * jsdom to check the route, the Back button and the submitted payload.
 *
 * Run: node test/form-logic-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('jsdom not installed — skipping form logic smoke'); process.exit(0); }

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SRC = readFileSync(new URL('../public/widget-form.js', import.meta.url), 'utf8');

// ── Load the engine via a bare jsdom window ──────────────────────────────────
const bare = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.test/' });
bare.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
bare.window.eval(SRC);
const { resolveNext, hasBranching, ops } = bare.window.TGFormLogic;

const Q = (id, extra) => Object.assign({ id, label: id, type: 'short-text' }, extra || {});

// ── No logic: plain sequence ─────────────────────────────────────────────────
let qs = [Q('a'), Q('b'), Q('c')];
ok(resolveNext(qs, 0, {}) === 1, 'no logic → next question');
ok(resolveNext(qs, 2, {}) === -1, 'last question → finish (-1)');
ok(hasBranching(qs) === false, 'a form with no rules does not report branching');

// ── is / is-not ──────────────────────────────────────────────────────────────
qs = [
  Q('topic', { logic: { rules: [{ op: 'is', value: 'Careers', goTo: 'cv' }] } }),
  Q('budget'),
  Q('cv'),
];
ok(hasBranching(qs) === true, 'a form with rules reports branching');
ok(resolveNext(qs, 0, { 0: 'Careers' }) === 2, 'is → jumps to the named question');
ok(resolveNext(qs, 0, { 0: 'A new project' }) === 1, 'is (no match) → falls through to the next');
ok(resolveNext(qs, 0, { 0: 'careers' }) === 2, 'matching is case-insensitive');
ok(resolveNext(qs, 0, { 0: '  Careers  ' }) === 2, 'matching ignores surrounding space');

qs[0].logic = { rules: [{ op: 'is-not', value: 'Careers', goTo: 'cv' }] };
ok(resolveNext(qs, 0, { 0: 'Other' }) === 2, 'is-not → jumps when it differs');
ok(resolveNext(qs, 0, { 0: 'Careers' }) === 1, 'is-not → falls through on a match');

// ── contains / multi-select ──────────────────────────────────────────────────
qs[0].logic = { rules: [{ op: 'contains', value: 'urgent', goTo: 'cv' }] };
ok(resolveNext(qs, 0, { 0: 'This is Urgent please' }) === 2, 'contains matches inside a sentence');
ok(resolveNext(qs, 0, { 0: 'no rush' }) === 1, 'contains → falls through when absent');
ok(resolveNext(qs, 0, { 0: ['calm', 'urgent thing'] }) === 2, 'contains works across a multi-select answer');

qs[0].logic = { rules: [{ op: 'is', value: 'Blue', goTo: 'cv' }] };
ok(resolveNext(qs, 0, { 0: ['Red', 'Blue'] }) === 2, 'is matches ANY selected option in a multi-select');
ok(resolveNext(qs, 0, { 0: ['Red', 'Green'] }) === 1, 'is falls through when no option matches');

// ── is-any-of ────────────────────────────────────────────────────────────────
qs[0].logic = { rules: [{ op: 'is-any-of', value: ['Careers', 'Press'], goTo: 'cv' }] };
ok(resolveNext(qs, 0, { 0: 'Press' }) === 2, 'is-any-of matches one of a list');
ok(resolveNext(qs, 0, { 0: 'Sales' }) === 1, 'is-any-of falls through otherwise');

// ── answered / not-answered ──────────────────────────────────────────────────
qs[0].logic = { rules: [{ op: 'not-answered', goTo: 'cv' }] };
ok(resolveNext(qs, 0, { 0: '' }) === 2, 'not-answered matches an empty answer');
ok(resolveNext(qs, 0, { 0: 'x' }) === 1, 'not-answered falls through when answered');
qs[0].logic = { rules: [{ op: 'answered', goTo: 'cv' }] };
ok(resolveNext(qs, 0, { 0: 'x' }) === 2, 'answered matches a given answer');
ok(resolveNext(qs, 0, { 0: [] }) === 1, 'an empty multi-select counts as not answered');

// ── Numeric comparisons (rating / scale / number) ────────────────────────────
qs[0].logic = { rules: [{ op: 'lte', value: 6, goTo: 'cv' }] };
ok(resolveNext(qs, 0, { 0: 3 }) === 2, 'lte matches a low score (the NPS detractor branch)');
ok(resolveNext(qs, 0, { 0: 9 }) === 1, 'lte falls through on a high score');
ok(resolveNext(qs, 0, { 0: 6 }) === 2, 'lte is inclusive');
qs[0].logic = { rules: [{ op: 'gt', value: 8, goTo: 'cv' }] };
ok(resolveNext(qs, 0, { 0: 9 }) === 2, 'gt matches above the bound');
ok(resolveNext(qs, 0, { 0: 8 }) === 1, 'gt is exclusive');
ok(resolveNext(qs, 0, { 0: 'not a number' }) === 1, 'a non-numeric answer never satisfies a numeric rule');

// ── Rule order: first match wins ─────────────────────────────────────────────
qs = [Q('a', { logic: { rules: [
  { op: 'answered', goTo: 'b' },
  { op: 'answered', goTo: 'c' },
] } }), Q('b'), Q('c')];
ok(resolveNext(qs, 0, { 0: 'x' }) === 1, 'the FIRST matching rule wins');

// ── otherwise ────────────────────────────────────────────────────────────────
qs = [Q('a', { logic: { rules: [{ op: 'is', value: 'zzz', goTo: 'c' }], otherwise: 'c' } }), Q('b'), Q('c')];
ok(resolveNext(qs, 0, { 0: 'nope' }) === 2, 'otherwise applies when no rule matches');

// ── end ──────────────────────────────────────────────────────────────────────
qs = [Q('a', { logic: { rules: [{ op: 'answered', goTo: 'end' }] } }), Q('b')];
ok(resolveNext(qs, 0, { 0: 'x' }) === -1, "goTo 'end' finishes the form early");

// ── FAIL OPEN on anything malformed ──────────────────────────────────────────
qs = [Q('a'), Q('b')];
const failOpen = [
  { logic: null },
  { logic: {} },
  { logic: { rules: 'not an array' } },
  { logic: { rules: [null] } },
  { logic: { rules: [{ op: 'no-such-op', value: 'x', goTo: 'b' }] } },
  { logic: { rules: [{ op: 'is', value: 'x', goTo: 'deleted-question' }] } },
  { logic: { rules: [{}] } },
];
for (let i = 0; i < failOpen.length; i++) {
  const t = [Object.assign(Q('a'), failOpen[i]), Q('b')];
  ok(resolveNext(t, 0, { 0: 'x' }) === 1, 'malformed logic #' + (i + 1) + ' falls through to the next question');
}
ok(resolveNext(null, 0, {}) === -1, 'a missing question set is handled');
ok(resolveNext(qs, 99, {}) === -1, 'an out-of-range index is handled');

// A rule pointing at a deleted question must carry on, never dead-end.
qs = [Q('a', { logic: { rules: [{ op: 'answered', goTo: 'gone' }] } }), Q('b')];
ok(resolveNext(qs, 0, { 0: 'x' }) === 1, 'a jump to a deleted question falls through');

// ── Security: rules are data, never code ─────────────────────────────────────
ok(Array.isArray(ops) && ops.length >= 10, 'the operator dispatch table is a fixed list');
ok(!/\beval\s*\(/.test(SRC) && !/new Function/.test(SRC), 'no eval / Function constructor anywhere in the widget');
const evil = [Q('a', { logic: { rules: [{ op: 'constructor', value: 'x', goTo: 'b' }] } }), Q('b')];
ok(resolveNext(evil, 0, { 0: 'x' }) === 1, 'an inherited property name is NOT usable as an operator');
const proto = [Q('a', { logic: { rules: [{ op: '__proto__', value: 'x', goTo: 'b' }] } }), Q('b')];
ok(resolveNext(proto, 0, { 0: 'x' }) === 1, '__proto__ is not usable as an operator');

// ═══ End-to-end: a real branching form in the browser ════════════════════════
function mount(cfg) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div data-tg-widget="form" data-tg-config='${JSON.stringify(cfg).replace(/'/g, '&#39;')}'></div></body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://client.example.com/' }
  );
  const { window } = dom;
  const posted = [];
  window.fetch = async (url, opts) => {
    const u = String(url);
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    if (/\/api\/form-submit$/.test(u)) posted.push(body);
    return { ok: true, status: 200, json: async () => ({ ok: true, leadId: 'lead_1' }) };
  };
  window.eval(SRC);
  return { window, posted, el: window.document.querySelector('[data-tg-widget="form"]') };
}
const sel = (el, s) => el.__tgFormInstance.shadow.querySelector(s);
const txt = (el) => (el.__tgFormInstance.shadow.textContent || '').replace(/\s+/g, ' ');

const BRANCHING = {
  showWelcome: false,
  questions: [
    { id: 'topic', label: 'What is this about?', type: 'multiple-choice', required: true,
      options: ['Careers', 'Sales'],
      logic: { rules: [{ op: 'is', value: 'Careers', goTo: 'cv' }] } },
    { id: 'budget', label: 'What is your budget?', type: 'short-text', required: false,
      logic: { rules: [{ op: 'answered', goTo: 'email' }] } },
    { id: 'cv', label: 'Link to your CV', type: 'short-text', required: false },
    { id: 'email', label: 'Your email', type: 'email', required: true, mapTo: 'email' },
  ],
};

// Route A: Careers → skips budget, lands on the CV question.
{
  const m = mount(BRANCHING);
  await sleep(20);
  ok(/What is this about\?/.test(txt(m.el)), 'branching form opens on the first question');
  ok(/Question 1/.test(txt(m.el)) && !/of 4/.test(txt(m.el)),
    'the counter drops the total once the form branches (it cannot be known)');
  sel(m.el, '.tgf-choice-input').checked = true;   // "Careers"
  sel(m.el, '.tgf-choice-input').dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await sleep(260);
  ok(/Link to your CV/.test(txt(m.el)), 'Careers jumps past the budget question');
  ok(/Question 2/.test(txt(m.el)), 'the counter follows the route, not the question index');

  // Back must retrace the ROUTE, so it returns to the topic question.
  sel(m.el, '[data-back]').click();
  await sleep(20);
  ok(/What is this about\?/.test(txt(m.el)), 'Back retraces the route taken, not index-1');
}

// Route B: Sales → sees budget, and answering it jumps to email.
{
  const m = mount(BRANCHING);
  await sleep(20);
  const inputs = m.el.__tgFormInstance.shadow.querySelectorAll('.tgf-choice-input');
  inputs[1].checked = true;                       // "Sales"
  inputs[1].dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await sleep(260);
  ok(/What is your budget\?/.test(txt(m.el)), 'Sales continues to the budget question');

  sel(m.el, 'input').value = '£5,000';
  sel(m.el, '[data-next]').click();
  await sleep(20);
  ok(/Your email/.test(txt(m.el)), 'answering the budget jumps to the email question');

  sel(m.el, 'input').value = 'jane@example.com';
  sel(m.el, '[data-next]').click();
  await sleep(60);
  ok(m.posted.length === 1, 'the form submits from the end of the route');

  const ids = m.posted[0].answers.map((a) => a.id);
  ok(ids.join(',') === 'topic,budget,email', 'the payload contains ONLY the questions actually seen, in route order');
  ok(ids.indexOf('cv') === -1, 'the skipped branch is absent — no misleading blank column for a question never asked');
}

// A jump to 'end' submits without visiting the rest.
{
  const m = mount({
    showWelcome: false,
    questions: [
      { id: 'email', label: 'Your email', type: 'email', required: true, mapTo: 'email',
        logic: { rules: [{ op: 'answered', goTo: 'end' }] } },
      { id: 'extra', label: 'Never asked', type: 'short-text', required: true },
    ],
  });
  await sleep(20);
  // The label reflects only what is KNOWN. This question is unanswered, so the
  // "answered → end" rule has not fired yet and the widget cannot honestly
  // claim this is the last step. It says OK, and submits once the answer makes
  // the rule true. Guessing "Submit" here would be wrong whenever the visitor
  // leaves an optional question blank.
  ok(/OK/.test(txt(m.el)), 'the button does not claim to be the end before the rule can be evaluated');
  sel(m.el, 'input').value = 'jane@example.com';
  sel(m.el, '[data-next]').click();
  await sleep(60);
  ok(m.posted.length === 1, "goTo 'end' submits immediately");
  ok(m.posted[0].answers.length === 1, 'the unvisited question is not submitted');
}

// A form that loops must terminate rather than trap the visitor.
{
  const m = mount({
    showWelcome: false,
    questions: [
      { id: 'a', label: 'A', type: 'short-text', required: false, logic: { rules: [{ op: 'answered', goTo: 'b' }] } },
      { id: 'b', label: 'B', type: 'short-text', required: false, logic: { rules: [{ op: 'not-answered', goTo: 'a' }] } },
      { id: 'email', label: 'Your email', type: 'email', required: false, mapTo: 'email' },
    ],
  });
  await sleep(20);
  const inst = m.el.__tgFormInstance;
  // Drive the loop hard: A -> B -> A -> ... B is never answered, so it bounces.
  for (let i = 0; i < 260 && !m.posted.length; i++) {
    const f = inst.shadow.querySelector('input');
    if (f && inst.questions[inst.idx].id === 'a') f.value = 'x';
    const nx = inst.shadow.querySelector('[data-next]');
    if (nx) nx.click();
    await sleep(0);
  }
  ok(m.posted.length === 1, 'a looping form terminates and submits rather than trapping the visitor');
  ok(inst.path.length <= 210, 'the route is capped (MAX_STEPS), so it cannot run away');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
