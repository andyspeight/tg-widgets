/**
 * Form widget white-labelling — every form email carries the CLIENT's brand
 * and no form widget renders a "Powered by Travelgenix" footer.
 *
 * Andy's call, 20 Jul 2026: form emails must send from the client's business
 * name (sourced from the account the widget is on), never "Travelgenix", and
 * the powered-by footer comes off all forms. This drives the REAL routing
 * modules (agent notification + visitor auto-reply) with a captured SendGrid
 * fetch and asserts the From display name, then guards the widget sources.
 *
 * The verified sender ADDRESS never changes — only the display name. The
 * platform-name fallback inside buildFromField remains for forms with a
 * genuinely blank Client Name (new accounts before their first save).
 *
 * Run: node test/enquiry-email-brand-smoke.mjs
 */
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Env before import — routing/sendgrid.js reads it at module scope.
process.env.SENDGRID_API_KEY = 'SG.test.key';
process.env.SENDGRID_FROM_EMAIL = 'noreply@travelify.io';
delete process.env.SENDGRID_FROM_NAME_FALLBACK;

const { default: sendAgentEmail } = await import('../api/enquiry/_lib/routing/email.js');
const { default: sendAutoReply } = await import('../api/enquiry/_lib/routing/auto-reply.js');

const CLIENT_NAME_FIELD = 'fldrw1eTFYCFIo0pp';
const ROUTING_TO_FIELD = 'fldlu1HcErBfp2wh2';
const OWNER_EMAIL_FIELD = 'fldLzWF0XnEXeZYH1';

let captured = [];
// SendGrid's authenticated-domain list, as the mock API serves it.
// null → the API errors (e.g. key without the read scope).
let authDomains = null;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('/v3/whitelabel/domains')) {
    if (!authDomains) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => authDomains.map(d => ({ domain: d, valid: true })) };
  }
  captured.push({ url: u, body: JSON.parse(opts.body) });
  return { ok: true, status: 202, headers: { get: () => 'msg-id-1' }, text: async () => '' };
};

function ctx(clientName, ownerEmail) {
  const fields = { [ROUTING_TO_FIELD]: 'george@freefromtravel.com' };
  if (clientName !== undefined) fields[CLIENT_NAME_FIELD] = clientName;
  if (ownerEmail !== undefined) fields[OWNER_EMAIL_FIELD] = ownerEmail;
  return {
    form: { id: 'rec5oGBRzbuDV9vuv', fields },
    payload: {
      fields: {
        first_name: 'Jo', last_name: 'Bloggs', email: 'jo@example.com',
      },
    },
    reference: 'FFT-2026-00001',
    submissionId: 'recSUBMISSION0001',
    meta: { ip: '1.2.3.4', userAgent: 'test' },
  };
}

// ── Agent notification: From name is the client's brand ──────────────────────
captured = [];
let result = await sendAgentEmail(ctx('Free From Travel'));
ok(result.status !== 'failed', `agent email sends (got ${result.status}: ${result.error || 'ok'})`);
ok(captured.length === 1, 'exactly one SendGrid call');
let body = captured[0] && captured[0].body;
ok(body && body.from && body.from.name === 'Free From Travel', `agent email From name is the client (got "${body && body.from && body.from.name}")`);
ok(body && body.from.email === 'noreply@travelify.io', 'sender ADDRESS stays on the verified domain');
ok(body && body.reply_to && body.reply_to.email === 'jo@example.com', 'Reply-To is the visitor');

// ── Agent notification: blank Client Name → platform fallback, not empty ─────
captured = [];
result = await sendAgentEmail(ctx(undefined));
body = captured[0] && captured[0].body;
ok(body && body.from.name === 'Travelgenix', `blank Client Name falls back to platform name (got "${body && body.from.name}")`);

// ── Visitor auto-reply: From name is the client's brand ──────────────────────
captured = [];
result = await sendAutoReply(ctx('Free From Travel'));
ok(result.status !== 'failed', `auto-reply sends (got ${result.status}: ${result.error || 'ok'})`);
body = captured[0] && captured[0].body;
ok(body && body.from && body.from.name === 'Free From Travel', `auto-reply From name is the client (got "${body && body.from && body.from.name}")`);
ok(body && body.personalizations[0].to[0].email === 'jo@example.com', 'auto-reply goes to the visitor');
ok(body && body.reply_to && body.reply_to.email === 'george@freefromtravel.com', 'auto-reply Reply-To is the agent');

// ── Client-domain sending: authenticated domain → client's own address ───────
authDomains = ['freefromtravel.com'];
captured = [];
result = await sendAgentEmail(ctx('Free From Travel', 'george@freefromtravel.com'));
body = captured[0] && captured[0].body;
ok(body && body.from.email === 'george@freefromtravel.com', `authenticated domain → From is the client's own address (got "${body && body.from.email}")`);
ok(body && body.from.name === 'Free From Travel', 'client display name kept alongside their address');

// ── Unauthenticated domain → platform sender (deliverability guard) ──────────
captured = [];
result = await sendAgentEmail(ctx('Sunny Breaks', 'owner@gmail.com'));
body = captured[0] && captured[0].body;
ok(body && body.from.email === 'noreply@travelify.io', `unauthenticated domain falls back to the platform sender (got "${body && body.from.email}")`);

// ── Env allowlist wins even when the domain list lacks the domain ────────────
process.env.TG_AUTHENTICATED_SENDER_DOMAINS = 'dreamhols.example';
captured = [];
result = await sendAgentEmail(ctx('Dream Hols', 'sales@dreamhols.example'));
body = captured[0] && captured[0].body;
ok(body && body.from.email === 'sales@dreamhols.example', 'TG_AUTHENTICATED_SENDER_DOMAINS allowlist honoured');
delete process.env.TG_AUTHENTICATED_SENDER_DOMAINS;

// ── Auto-reply gets the same treatment ───────────────────────────────────────
captured = [];
result = await sendAutoReply(ctx('Free From Travel', 'george@freefromtravel.com'));
body = captured[0] && captured[0].body;
ok(body && body.from.email === 'george@freefromtravel.com' && body.from.name === 'Free From Travel',
  'auto-reply sends from the client\'s own authenticated address');

// ── Source guards: no hardcoded platform From name, no powered-by footers ────
const emailSrc = readFileSync(new URL('../api/enquiry/_lib/routing/email.js', import.meta.url), 'utf8');
ok(!/Travelgenix Enquiries/.test(emailSrc), 'agent email no longer hardcodes "Travelgenix Enquiries"');
ok(/resolveFromIdentity\(agentBrandName, ownerEmail\)/.test(emailSrc), 'agent email From is built from the client identity');

const enquirySrc = readFileSync(new URL('../public/widget-enquiry.js', import.meta.url), 'utf8');
ok(!/tg-brand/.test(enquirySrc), 'Enquiry widget: powered-by footer fully removed');
ok(/WIDGET_VERSION = '1\.1\.6'/.test(enquirySrc), 'Enquiry widget version bumped to 1.1.6');

const proSrc = readFileSync(new URL('../public/widget-enquirypro.js', import.meta.url), 'utf8');
ok(!/ep-brand/.test(proSrc), 'Enquiry Pro widget: powered-by footer fully removed');
ok(/WIDGET_VERSION = '1\.2\.3'/.test(proSrc), 'Enquiry Pro version bumped to 1.2.3');

const configSrc = readFileSync(new URL('../api/enquiry-form-config.js', import.meta.url), 'utf8');
ok(/efFields\[EF\.clientName\] = safeStr\(user\.clientName, 200\)/.test(configSrc), 'config stamps the account client name');
ok(/CLIENTS\.tableId, user\.clientId/.test(configSrc), 'hydrate resolves client name from the Clients table');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
