/**
 * AI plan gate (audit finding #13).
 *
 * The paid AI translate endpoints (faq-translate, enquiry-translate) had no
 * plan-tier check, so a Spark account — not entitled to AI — could drive paid
 * translation by calling the API directly. The gate now lives in the shared
 * api/_lib/ai-plan.js: aiEntitlement() decides allow/deny from a plan name, and
 * resolveClientPlan() reads the plan fresh from Airtable (Active-gated).
 *
 * Drives the REAL functions (aiEntitlement pure; resolveClientPlan with a mocked
 * fetch) and source-scans that both endpoints gate before the model call.
 * Run: node test/ai-plan-gate-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { aiEntitlement, resolveClientPlan, PLAN_DAILY_LIMITS } from '../api/_lib/ai-plan.js';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// ── aiEntitlement (pure) ─────────────────────────────────────────────────────
ok(aiEntitlement('Boost').allowed === true && aiEntitlement('Boost').limit === 15, 'Boost is entitled (15/day)');
ok(aiEntitlement('Ignite').allowed === true && aiEntitlement('Ignite').limit === 40, 'Ignite is entitled (40/day)');
ok(aiEntitlement('Bespoke').allowed === true && aiEntitlement('Bespoke').limit === 100, 'Bespoke is entitled (100/day)');

const spark = aiEntitlement('Spark');
ok(spark.allowed === false && /Boost/.test(spark.reason), 'Spark is blocked with an upgrade message');

const unknown = aiEntitlement('Freeloader');
ok(unknown.allowed === false && /plan/i.test(unknown.reason), 'unknown plan is blocked (fail closed)');
ok(aiEntitlement(undefined).allowed === false && aiEntitlement('').allowed === false, 'missing/empty plan is blocked');

// The four canonical tiers, no extras.
ok(Object.keys(PLAN_DAILY_LIMITS).sort().join(',') === 'Bespoke,Boost,Ignite,Spark', 'exactly the four Title-Case tiers');

// ── resolveClientPlan (mocked Airtable) ──────────────────────────────────────
const realFetch = global.fetch;
const savedPat = process.env.AIRTABLE_PAT;
process.env.AIRTABLE_PAT = 'pat_test';
const REC = 'recABCDEFGHIJKLMN';
let lastUrl = null;
const mockOnce = (impl) => { global.fetch = async (url, opts) => { lastUrl = String(url); return impl(String(url), opts); }; };

// Active client resolved by record id (the SSO cookie path).
mockOnce(() => ({ ok: true, json: async () => ({ records: [{ id: REC, fields: { fldBgDeQdtwMqTIS4: 'Ignite' } }] }) }));
let p = await resolveClientPlan({ clientId: REC });
ok(p && p.plan === 'Ignite' && p.recordId === REC, 'resolves plan by record id');
ok(/RECORD_ID\(\)/.test(decodeURIComponent(lastUrl)) && /Active/.test(decodeURIComponent(lastUrl)), 'record-id lookup is Active-gated');

// Resolved by email (the legacy bearer path).
mockOnce(() => ({ ok: true, json: async () => ({ records: [{ id: REC, fields: { fldBgDeQdtwMqTIS4: 'Boost' } }] }) }));
p = await resolveClientPlan({ email: 'Agent@Example.com' });
ok(p && p.plan === 'Boost', 'resolves plan by email');
ok(/LOWER\(\{Email\}\)='agent@example.com'/.test(decodeURIComponent(lastUrl)) && /Active/.test(decodeURIComponent(lastUrl)), 'email lookup is lowercased + Active-gated');

// No active record → null (a real "denied", not a throw).
mockOnce(() => ({ ok: true, json: async () => ({ records: [] }) }));
p = await resolveClientPlan({ clientId: REC });
ok(p === null, 'no active record → null (denied)');

// A plan gate on the null: aiEntitlement of an unresolved account is denied by
// the caller returning 403; resolveClientPlan itself just returns null.
// Airtable error → THROW so the caller fails closed (503), never a free pass.
mockOnce(() => ({ ok: false, status: 500, json: async () => ({}) }));
let threw = false;
try { await resolveClientPlan({ clientId: REC }); } catch { threw = true; }
ok(threw === true, 'Airtable error throws (caller fails closed, not open)');

// A garbage identifier matches nothing and calls Airtable with neither branch.
global.fetch = async () => { throw new Error('should not be called'); };
p = await resolveClientPlan({ clientId: 'not-a-rec', email: 'notanemail' });
ok(p === null, 'unusable identifiers → null without an Airtable call');

global.fetch = realFetch;
if (savedPat === undefined) delete process.env.AIRTABLE_PAT; else process.env.AIRTABLE_PAT = savedPat;

// ── Wiring guard: both translate endpoints gate before the model call ────────
for (const file of ['../api/faq-translate.js', '../api/enquiry-translate.js']) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8');
  const name = file.split('/').pop();
  ok(/resolveClientPlan\(user\)/.test(src), `${name}: resolves the plan for the session user`);
  ok(/aiEntitlement\(plan\.plan\)/.test(src), `${name}: checks entitlement`);
  ok(/entitlement\.allowed/.test(src) && /status\(403\)/.test(src), `${name}: 403 when not entitled`);
  // The gate must sit BEFORE the anthropic call, so an unentitled client never
  // reaches the paid model.
  const gateAt = src.indexOf('resolveClientPlan');
  const modelAt = src.indexOf('api.anthropic.com');
  ok(gateAt > 0 && modelAt > 0 && gateAt < modelAt, `${name}: plan gate precedes the model call`);
}

// widget-ai now shares the same caps map (single source of truth).
const wai = readFileSync(new URL('../api/widget-ai.js', import.meta.url), 'utf8');
ok(/import \{ PLAN_DAILY_LIMITS \} from '\.\/_lib\/ai-plan\.js'/.test(wai), 'widget-ai imports the shared caps map');
ok(!/const PLAN_DAILY_LIMITS = \{/.test(wai), 'widget-ai no longer defines its own caps map');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
