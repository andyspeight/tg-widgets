// Client Control provisions Luna Chat.
//
// Switching Luna Chat on in Client Control has to create the client in Luna
// Chat too. Until now it did not, and every Luna Chat record was made by hand.
// In one week that produced:
//
//   - a client live in Client Control with no Luna Chat record at all, so they
//     appeared nowhere — not in its client list, not under "Act as"
//   - a client with no App ID, so Luna had no search and invented booking links
//     on the client's own domain that all 404'd
//   - a client with no AuthClientId, so they hit "No Luna Chat client linked to
//     your account" and could not open their dashboard
//
// Run: node test/luna-chat-provision.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { provisionLunaChat } = await import('../api/_lib/luna-chat-provision.js');
const { CLIENTS } = await import('../api/_lib/auth/schema.js');

function clientRecord(overrides = {}) {
  return {
    id: 'recCLIENT1234567',
    fields: Object.assign({
      [CLIENTS.fields.clientName]: 'Snow Dragons Ltd',
      [CLIENTS.fields.tradingName]: 'Snow Dragons',
      [CLIENTS.fields.email]: 'hello@snowdragons.co.uk',
      [CLIENTS.fields.travelifyAppId]: '412'
    }, overrides)
  };
}

// Capture what we would send to Luna Chat.
function stubFetch(response = { ok: true, status: 200, body: { success: true, action: 'created' } }) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts, body: JSON.parse(opts.body) });
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body
    };
  };
  return calls;
}

test('enabling Luna Chat sends the client to Luna Chat', async () => {
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  const calls = stubFetch();
  const r = await provisionLunaChat(clientRecord(), true);
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/clients$/);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].body.active, true);
});

test('it is authenticated with the Luna Chat admin secret', async () => {
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  const calls = stubFetch();
  await provisionLunaChat(clientRecord(), true);
  assert.equal(calls[0].opts.headers['X-Admin-Pass'], 'secret');
});

test('the App ID is passed, so Luna has a real search to link to', async () => {
  // Without it Luna has no search configured and invents booking URLs on the
  // client's own domain — every one a 404, at the moment of booking.
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  const calls = stubFetch();
  await provisionLunaChat(clientRecord(), true);
  assert.equal(calls[0].body.appId, '412');
});

test('externalId and authClientId are BOTH the Client Control record id', async () => {
  // externalId is the stable upsert key. authClientId is what Luna Chat compares
  // against client.recordId from /api/auth/me to decide who may open the client.
  // They are genuinely the same value.
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  const calls = stubFetch();
  await provisionLunaChat(clientRecord(), true);
  assert.equal(calls[0].body.externalId, 'recCLIENT1234567');
  assert.equal(calls[0].body.authClientId, 'recCLIENT1234567',
    'without this the client cannot sign in to their dashboard');
});

test('switching Luna Chat off deactivates rather than deleting', async () => {
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  const calls = stubFetch();
  await provisionLunaChat(clientRecord(), false);
  assert.equal(calls[0].body.active, false);
});

test('the trading name is preferred — it is what the public sees', async () => {
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  const calls = stubFetch();
  await provisionLunaChat(clientRecord(), true);
  assert.equal(calls[0].body.name, 'Snow Dragons');
});

test('it falls back to the legal name when there is no trading name', async () => {
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  const calls = stubFetch();
  await provisionLunaChat(clientRecord({ [CLIENTS.fields.tradingName]: '' }), true);
  assert.equal(calls[0].body.name, 'Snow Dragons Ltd');
});

test('a client with no email is skipped with a clear reason, not a crash', async () => {
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  const calls = stubFetch();
  const r = await provisionLunaChat(clientRecord({ [CLIENTS.fields.email]: '' }), true);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.match(r.warning, /name and a contact email/);
  assert.equal(calls.length, 0, 'must not send an unusable record');
});

test('a missing integration secret is reported, never silently ignored', async () => {
  delete process.env.LUNA_CHAT_ADMIN_PASS;
  const calls = stubFetch();
  const r = await provisionLunaChat(clientRecord(), true);
  assert.equal(r.skipped, true);
  assert.match(r.warning, /not configured/);
  assert.equal(calls.length, 0);
});

test('a Luna Chat outage returns a warning, not a thrown error', async () => {
  // The entitlement in Client Control is the source of truth and must save even
  // when Luna Chat is down. Failing the whole request would be worse.
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const r = await provisionLunaChat(clientRecord(), true);
  assert.equal(r.ok, false);
  assert.match(r.warning, /could not be reached/);
});

test('an error response from Luna Chat is reported with its status', async () => {
  process.env.LUNA_CHAT_ADMIN_PASS = 'secret';
  stubFetch({ ok: false, status: 401, body: { error: 'Unauthorized' } });
  const r = await provisionLunaChat(clientRecord(), true);
  assert.equal(r.ok, false);
  assert.match(r.warning, /401/);
});

// ── wiring ──

test('the entitlement toggle provisions Luna Chat, and only for Luna Chat', async () => {
  const SRC = read('api/admin/clients/update-entitlement.js');
  assert.match(SRC, /provisionLunaChat\(client, enabled\)/);
  assert.match(SRC, /=== PRODUCTS\.slugs\.LUNA_CHAT/,
    'toggling any other product must not touch Luna Chat');
});

test('onboarding provisions Luna Chat too', async () => {
  const SRC = read('api/admin/clients/create.js');
  assert.match(SRC, /provisionLunaChat\(clientRec, true\)/);
  assert.match(SRC, /lunaChatRecordCreated: !!\(lunaChat && lunaChat\.ok\)/,
    'the response must report what actually happened, not a hardcoded false');
});

test('neither caller lets a Luna Chat failure fail the save', async () => {
  const TOG = read('api/admin/clients/update-entitlement.js');
  const CRE = read('api/admin/clients/create.js');
  [TOG, CRE].forEach((src) => {
    assert.doesNotMatch(src, /await provisionLunaChat\([^)]*\)\s*;\s*\n\s*if \(!luna/,
      'provisioning must not gate the response');
  });
  assert.match(TOG, /\.\.\.\(lunaChat && lunaChat\.warning \? \{ warning: lunaChat\.warning \} : \{\}\)/);
});

test('the admin UI surfaces the warning instead of a false success', async () => {
  const UI = read('public/admin/client-detail.html');
  assert.match(UI, /if \(data\.warning\) \{\s*\n\s*toast\(data\.warning, 'err'\);/,
    'a silent failure here is how a client ends up live in Client Control and missing from Luna Chat');
});
