/**
 * Widget list scoping — the client-isolation logic behind the dashboard.
 *
 * Born from the 23 Jul 2026 Worldchoice incident: their client account was
 * set up under a STAFF login email, so the legacy ClientEmail fallback
 * surfaced every ownerless test widget that staff member had ever created in
 * the client's own dashboard. This suite drives the REAL /api/widget-list
 * handler with a mocked Airtable and pins the scope formula it emits for
 * each session shape — above all: a staff-email client account must be
 * scoped by ClientRecordId ALONE.
 *
 * Run: node test/widget-list-scope-smoke.mjs
 */

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_PAT = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.TG_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';

const CLIENTS_TABLE = 'tblikekpaTKraMktZ';
const USERS_TABLE = 'tblIpeQeZmF7CM7OJ';
const UF_EMAIL = 'fldSQLKBfsAcVS2s3';
const UF_CLIENT = 'fldyXVZjZKUjlYCm6';
const CF_EMAIL = 'fldVRiIAlrTjxnNHP';

const WORLDCHOICE = 'recWORLDCHOICE001';
const OTHERCLIENT = 'recOTHERCLIENT001';

const state = {
  users: {},    // userRecId -> { email, clients: [recIds] }
  clients: {},  // clientRecId -> email
  lastListUrl: '',
};

global.fetch = async (url) => {
  const u = String(url);
  const json = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
  const userMatch = u.match(new RegExp(`/${USERS_TABLE}/(rec[A-Za-z0-9]{14})`));
  if (userMatch) {
    const rec = state.users[userMatch[1]];
    if (!rec) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return json({ id: userMatch[1], fields: { [UF_EMAIL]: rec.email, [UF_CLIENT]: (rec.clients || []).map(id => ({ id })) } });
  }
  const clientMatch = u.match(new RegExp(`/${CLIENTS_TABLE}/(rec[A-Za-z0-9]{14})`));
  if (clientMatch) {
    const email = state.clients[clientMatch[1]];
    if (email === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return json({ id: clientMatch[1], fields: { [CF_EMAIL]: email } });
  }
  if (u.includes('/Widgets?')) {
    state.lastListUrl = u;
    return json({ records: [] });
  }
  throw new Error('unmocked fetch: ' + u);
};

const { createToken } = await import('../api/_auth.js');
const { default: handler } = await import('../api/widget-list.js');

function mockRes() {
  return {
    statusCode: 200, body: undefined,
    setHeader() {}, getHeader() { return undefined; },
    status(n) { this.statusCode = n; return this; },
    json(o) { if (this.body === undefined) this.body = o; return this; },
    end() { return this; },
  };
}
async function listAs({ email, recordId, clientId }) {
  const token = createToken({ email, recordId, clientId });
  const res = mockRes();
  state.lastListUrl = '';
  await handler({
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, origin: 'https://widgets.travelify.io' },
    socket: { remoteAddress: '10.0.0.1' },
  }, res);
  return { res, formula: decodeURIComponent((state.lastListUrl.match(/filterByFormula=([^&]*)/) || [])[1] || '') };
}

// ── THE INCIDENT: client account set up under a STAFF email ──────────────────
// Jess signs into Worldchoice; the account's login email is Luke's staff
// address. The formula must scope by ClientRecordId alone — no email clause.
state.users.recJESS0000000001 = { email: 'jess@worldchoicesports.com', clients: [WORLDCHOICE] };
state.clients[WORLDCHOICE] = 'luke.livsey@agendas.group';
{
  const { res, formula } = await listAs({ email: 'jess@worldchoicesports.com', recordId: 'recJESS0000000001', clientId: WORLDCHOICE });
  ok(res.statusCode === 200, 'staff-email account: list still succeeds');
  ok(formula.includes(`{ClientRecordId}='${WORLDCHOICE}'`), 'staff-email account: scoped to the owning client id');
  ok(!formula.includes('luke.livsey'), 'staff-email account: the staff address appears NOWHERE in the scope');
  ok(!formula.includes('ClientEmail'), 'staff-email account: no legacy email fallback at all — staff test widgets cannot surface');
}

// ── A normal client keeps the legacy fallback (their own old widgets) ────────
state.users.recGEORGE00000001 = { email: 'george@freefromtravel.com', clients: [OTHERCLIENT] };
state.clients[OTHERCLIENT] = 'george@freefromtravel.com';
{
  const { formula } = await listAs({ email: 'george@freefromtravel.com', recordId: 'recGEORGE00000001', clientId: OTHERCLIENT });
  ok(formula.includes(`{ClientRecordId}='${OTHERCLIENT}'`), 'normal client: scoped to their client id');
  ok(formula.includes(`AND({ClientRecordId}='', LOWER({ClientEmail})='george@freefromtravel.com')`),
    'normal client: legacy fallback kept, and only for OWNERLESS widgets');
}

// ── Shared-email guard still works (one email owning two accounts) ───────────
const SECOND = 'recSECONDACCT0001';
state.users.recMULTI000000001 = { email: 'owner@twobrands.example', clients: [OTHERCLIENT, SECOND] };
state.clients[SECOND] = 'george@freefromtravel.com'; // same email as OTHERCLIENT
{
  const { formula } = await listAs({ email: 'owner@twobrands.example', recordId: 'recMULTI000000001', clientId: SECOND });
  ok(formula.includes(`{ClientRecordId}='${SECOND}'`) && !formula.includes('ClientEmail'),
    'shared email across two owned accounts: fallback dropped, id-only scope');
}

// ── No client context: old tokens scope purely by own email ──────────────────
state.users.recLONE0000000001 = { email: 'solo@example.com', clients: [] };
{
  const { formula } = await listAs({ email: 'solo@example.com', recordId: 'recLONE0000000001' });
  ok(formula === `LOWER({ClientEmail})='solo@example.com'`, 'no client context: own-email scope (legacy tokens unregressed)');
}

// ── Auth still required ──────────────────────────────────────────────────────
{
  const res = mockRes();
  await handler({ method: 'GET', headers: {}, socket: {} }, res);
  ok(res.statusCode === 401, 'unauthenticated → 401');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
