/**
 * Widget AI endpoint (FAQ generation) — born from the 23 Jul 2026 client
 * report of "Error: HTTP 500" in the FAQ editor's AI modal. Three stacked
 * defects fixed and pinned here:
 *   1. The endpoint DEMANDED a bespoke AIRTABLE_USERS_TABLE env var nothing
 *      else uses (never set in Vercel → permanent 500 "AI service not
 *      configured"). The table id now defaults in code.
 *   2. The account lookup's filterByFormula used FIELD IDS in braces — the
 *      third occurrence of this bug class this week — which matches nothing,
 *      so every account would have looked inactive (403) once the env
 *      existed. Formulas now use display names.
 *   3. The model was hardcoded to claude-sonnet-4-20250514 (May 2025) with
 *      no env override, unlike every other AI endpoint. Now
 *      WIDGET_AI_MODEL || claude-sonnet-5.
 *
 * Drives the REAL handler with a mocked Airtable + Anthropic and a real
 * signed session token.
 *
 * Run: node test/widget-ai-smoke.mjs
 */

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Env BEFORE import — deliberately NO AIRTABLE_USERS_TABLE (defect 1).
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.AIRTABLE_PAT = 'pat_test';
process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.TG_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';
delete process.env.AIRTABLE_USERS_TABLE;
delete process.env.WIDGET_AI_MODEL;

const CLIENTS_TABLE = 'tblikekpaTKraMktZ';
const F = { plan: 'fldBgDeQdtwMqTIS4', count: 'fldlyipF5vQLUUxoh', date: 'fldlJ8nMB41hqdRnS' };

const state = {
  account: { plan: 'Boost', count: 0, date: '' }, // served for george
  lookupFormulas: [],
  anthropicBodies: [],
  patches: [],
};

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = opts.body ? String(opts.body) : '';
  const json = (status, obj) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });

  if (u.includes(`/${CLIENTS_TABLE}?`)) {
    const decoded = decodeURIComponent(u);
    const m = decoded.match(/filterByFormula=([^&]*)/);
    state.lookupFormulas.push(m ? m[1] : '');
    const matches = /\{Email\}/.test(decoded) && /george@freefromtravel\.com/.test(decoded) && /\{Status\}='Active'/.test(decoded);
    return json(200, { records: matches ? [{ id: 'recCLIENT00000001', fields: { [F.plan]: state.account.plan } }] : [] });
  }
  if (u.includes(`/${CLIENTS_TABLE}/recCLIENT00000001`)) {
    if ((opts.method || 'GET') === 'PATCH') {
      state.patches.push(JSON.parse(body).fields);
      return json(200, {});
    }
    return json(200, { id: 'recCLIENT00000001', fields: { [F.count]: state.account.count, [F.date]: state.account.date } });
  }
  if (u.startsWith('https://api.anthropic.com/')) {
    state.anthropicBodies.push(JSON.parse(body));
    const reply = JSON.stringify({
      questions: [
        { question: 'Do you offer ATOL protection?', answer: 'Yes, every package holiday we sell is ATOL protected.', category: '', popular: true },
        { question: 'Can I pay in instalments?', answer: 'Yes, spread the cost with a deposit and monthly payments.', category: '', popular: false },
      ],
      categories: [],
    });
    return json(200, { content: [{ type: 'text', text: reply }] });
  }
  throw new Error('unmocked fetch: ' + u);
};

const { createToken } = await import('../api/_auth.js');
const { default: handler } = await import('../api/widget-ai.js');

function mockRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    status(n) { this.statusCode = n; return this; },
    json(o) { if (this.body === undefined) this.body = o; return this; },
    end() { return this; },
  };
}
const request = (body, email = 'george@freefromtravel.com') => ({
  method: 'POST',
  headers: { authorization: `Bearer ${createToken({ email })}`, origin: 'https://widgets.travelify.io' },
  body,
  socket: { remoteAddress: '10.0.0.1' },
});
const faqReq = (over = {}) => ({
  widgetType: 'FAQ', action: 'generate',
  prompt: 'sidney faq',
  options: { count: 8, tone: 'professional', existingCategories: [] },
  ...over,
});

// ── The reported case: thin prompt, healthy account ──────────────────────────
let res = mockRes();
await handler(request(faqReq()), res);
ok(res.statusCode === 200, `thin-but-valid prompt generates instead of erroring (got ${res.statusCode}: ${JSON.stringify(res.body).slice(0, 120)})`);
ok(Array.isArray(res.body?.questions) && res.body.questions.length === 2, 'questions returned to the editor');
ok(!process.env.AIRTABLE_USERS_TABLE, 'no bespoke env var needed — the 500 "AI service not configured" path is gone');
{
  const f = decodeURIComponent(state.lookupFormulas.at(-1) || '');
  ok(/\{Email\}/.test(f) && /\{Status\}='Active'/.test(f) && !/\{fld/.test(f), 'account lookup filters on DISPLAY NAMES (field ids matched nothing)');
}
ok(state.anthropicBodies.at(-1)?.model === 'claude-sonnet-5', 'current-generation model by default (was hardcoded to a May 2025 id)');
ok(state.anthropicBodies.at(-1)?.max_tokens >= 2500, 'token headroom raised so 12 FAQs cannot truncate mid-JSON');
ok(state.patches.at(-1)?.[F.count] === 1, 'daily usage counter incremented');

// ── Unknown / inactive account → 403 with a human message ────────────────────
res = mockRes();
await handler(request(faqReq(), 'stranger@nowhere.example'), res);
ok(res.statusCode === 403 && /Account not found or inactive/.test(res.body?.error || ''), 'unknown account → 403, not a mystery 500');

// ── Plan gates ───────────────────────────────────────────────────────────────
state.account.plan = 'Spark';
res = mockRes();
await handler(request(faqReq()), res);
ok(res.statusCode === 403 && /Boost plan or higher/.test(res.body?.error || ''), 'Spark plan blocked with an upgrade message');
state.account.plan = 'Boost';

// ── Daily limit ──────────────────────────────────────────────────────────────
state.account.count = 15;
state.account.date = new Date().toISOString().slice(0, 10);
res = mockRes();
await handler(request(faqReq()), res);
ok(res.statusCode === 429 && /Daily AI generation limit reached/.test(res.body?.error || ''), 'daily cap → 429 with the reset time');
state.account.count = 0; state.account.date = '';

// ── Prompt validation ────────────────────────────────────────────────────────
res = mockRes();
await handler(request(faqReq({ prompt: 'hi' })), res);
ok(res.statusCode === 400 && /at least 5 characters/.test(res.body?.error || ''), 'genuinely too-short prompt → 400 with guidance');

// ── Model override honoured ──────────────────────────────────────────────────
// (module already imported, so assert the source wiring instead of re-importing)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../api/widget-ai.js', import.meta.url), 'utf8');
ok(/process\.env\.WIDGET_AI_MODEL \|\| 'claude-sonnet-5'/.test(src), 'model is env-overridable like every other AI endpoint');
ok(/process\.env\.AIRTABLE_USERS_TABLE \|\| 'tblikekpaTKraMktZ'/.test(src), 'table id defaults in code');
ok(!/\{\$\{FIELD_EMAIL\}\}|\{\$\{FIELD_STATUS\}\}/.test(src), 'no field-id formulas remain');
const faqEd = readFileSync(new URL('../public/editor-faq.html', import.meta.url), 'utf8');
ok(/if \(b && b\.error\) msg = b\.error/.test(faqEd), 'FAQ editor surfaces the server message instead of a bare HTTP status');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
