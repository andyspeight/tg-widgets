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
const F = {
  plan: 'fldBgDeQdtwMqTIS4', count: 'fldlyipF5vQLUUxoh', date: 'fldlJ8nMB41hqdRnS',
  clientName: 'fldx9CiWtSm5lX7MF', tradingName: 'fldDbFv039Bip6W8u', website: 'fld9zVc9PHgu18RVW',
};

const state = {
  account: { plan: 'Boost', count: 0, date: '', clientName: 'Free From Travel Ltd', tradingName: 'Free From Travel', website: 'https://freefromtravel.com' },
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
    return json(200, { records: matches ? [{ id: 'recCLIENT00000001', fields: {
      [F.plan]: state.account.plan,
      [F.clientName]: state.account.clientName,
      [F.tradingName]: state.account.tradingName,
      [F.website]: state.account.website,
    } }] : [] });
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
// A genuinely substantive description — what a good prompt looks like.
const GOOD_DESC = 'We are Free From Travel, an ABTA agency in Bristol arranging allergy-friendly family holidays to Spain, Greece and Portugal, plus escorted tours.';
const faqReq = (over = {}) => ({
  widgetType: 'FAQ', action: 'generate',
  prompt: GOOD_DESC,
  options: { count: 8, tone: 'professional', existingCategories: [] },
  ...over,
});
const uniqueDesc = (n) => `${GOOD_DESC} Ref ${n} for cache isolation between test cases.`;

// ── THE REPORTED CASE: "sidney faq" is now rejected BEFORE any cost ───────────
let res = mockRes();
const beforeCalls = state.anthropicBodies.length;
const beforePatches = state.patches.length;
await handler(request(faqReq({ prompt: 'sidney faq' })), res);
ok(res.statusCode === 400 && res.body?.code === 'prompt_too_thin', '"sidney faq" → 400 prompt_too_thin, not a wasted generation');
ok(/who you are, what you sell and who your customers are/.test(res.body?.error || ''), 'rejection message coaches the client with the three things to include');
ok(/Sunshine Travel/.test(res.body?.error || ''), 'rejection message shows a concrete example');
ok(state.anthropicBodies.length === beforeCalls, 'thin prompt never reached the model (£0)');
ok(state.patches.length === beforePatches, 'thin prompt never touched the daily counter');

// ── A substantive description generates, grounded in the real account ────────
res = mockRes();
await handler(request(faqReq({ prompt: uniqueDesc('A') })), res);
ok(res.statusCode === 200 && res.body?.questions?.length === 2, 'a good description generates FAQs');
ok(!process.env.AIRTABLE_USERS_TABLE, 'no bespoke env var needed — the 500 "AI service not configured" path is gone');
{
  const f = decodeURIComponent(state.lookupFormulas.at(-1) || '');
  ok(/\{Email\}/.test(f) && /\{Status\}='Active'/.test(f) && !/\{fld/.test(f), 'account lookup filters on DISPLAY NAMES (field ids matched nothing)');
  const sent = state.anthropicBodies.at(-1);
  ok(sent?.model === 'claude-sonnet-5', 'current-generation model by default');
  ok(sent?.max_tokens >= 2500, 'token headroom raised so 12 FAQs cannot truncate mid-JSON');
  const userMsg = sent?.messages?.[0]?.content || '';
  ok(/account_context/.test(userMsg) && /Free From Travel/.test(userMsg) && /freefromtravel\.com/.test(userMsg),
    'account brand context (trading name + website) is injected so thin descriptions still produce on-brand output');
  ok(state.patches.at(-1)?.[F.count] === 1, 'daily usage counter incremented on a real generation');
}

// ── Identical retry is free: no model call, no counter increment ─────────────
{
  const dupPrompt = uniqueDesc('DUP');
  let r1 = mockRes(); await handler(request(faqReq({ prompt: dupPrompt })), r1);
  const callsAfterFirst = state.anthropicBodies.length;
  const patchesAfterFirst = state.patches.length;
  ok(r1.statusCode === 200 && r1.getHeader('x-tg-ai-cache') === 'miss', 'first call generates (cache miss)');
  let r2 = mockRes(); await handler(request(faqReq({ prompt: dupPrompt })), r2);
  ok(r2.statusCode === 200 && r2.getHeader('x-tg-ai-cache') === 'hit', 'identical retry served from cache (hit)');
  ok(JSON.stringify(r2.body) === JSON.stringify(r1.body), 'cached retry returns the same result');
  ok(state.anthropicBodies.length === callsAfterFirst, 'identical retry makes NO model call (£0)');
  ok(state.patches.length === patchesAfterFirst, 'identical retry does NOT spend a daily credit');
}

// ── Per-type floors ──────────────────────────────────────────────────────────
// Weather's AI generates palette + CTA copy FROM a business description, so it
// carries the full business floor: a bare place name is too thin.
res = mockRes();
await handler(request({ widgetType: 'WEATHER', action: 'generate', prompt: 'Santorini', options: {} }), res);
ok(res.statusCode === 400 && res.body?.code === 'prompt_too_thin', 'Weather rejects a bare place name — it needs the business description');
// Countdown describes a campaign, not a whole business, so a lower floor.
res = mockRes();
await handler(request({ widgetType: 'COUNTDOWN TIMER', action: 'generate', prompt: 'Black Friday cruise sale ends Friday', options: {} }), res);
ok(res.statusCode !== 400 || res.body?.code !== 'prompt_too_thin', 'Countdown accepts a concise campaign description');
res = mockRes();
await handler(request({ widgetType: 'COUNTDOWN TIMER', action: 'generate', prompt: 'sale', options: {} }), res);
ok(res.statusCode === 400 && res.body?.code === 'prompt_too_thin', 'Countdown still rejects a one-word prompt');

// ── Unknown / inactive account → 403 with a human message ────────────────────
res = mockRes();
await handler(request(faqReq(), 'stranger@nowhere.example'), res);
ok(res.statusCode === 403 && /Account not found or inactive/.test(res.body?.error || ''), 'unknown account → 403, not a mystery 500');

// ── Plan gates ───────────────────────────────────────────────────────────────
state.account.plan = 'Spark';
res = mockRes();
await handler(request(faqReq({ prompt: uniqueDesc('SPARK') })), res);
ok(res.statusCode === 403 && /Boost plan or higher/.test(res.body?.error || ''), 'Spark plan blocked with an upgrade message');
state.account.plan = 'Boost';

// ── Daily limit ──────────────────────────────────────────────────────────────
state.account.count = 15;
state.account.date = new Date().toISOString().slice(0, 10);
res = mockRes();
await handler(request(faqReq({ prompt: uniqueDesc('CAP') })), res);
ok(res.statusCode === 429 && /Daily AI generation limit reached/.test(res.body?.error || ''), 'daily cap → 429 with the reset time');
state.account.count = 0; state.account.date = '';

// ── Model override honoured ──────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../api/widget-ai.js', import.meta.url), 'utf8');
ok(/process\.env\.WIDGET_AI_MODEL \|\| 'claude-sonnet-5'/.test(src), 'model is env-overridable like every other AI endpoint');
ok(/process\.env\.AIRTABLE_USERS_TABLE \|\| 'tblikekpaTKraMktZ'/.test(src), 'table id defaults in code');
ok(!/\{\$\{FIELD_EMAIL\}\}|\{\$\{FIELD_STATUS\}\}/.test(src), 'no field-id formulas remain');
const faqEd = readFileSync(new URL('../public/editor-faq.html', import.meta.url), 'utf8');
ok(/if \(b && b\.error\) msg = b\.error/.test(faqEd), 'FAQ editor surfaces the server message instead of a bare HTTP status');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
