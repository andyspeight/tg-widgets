import { readFileSync } from 'node:fs';
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
    // When a test queues pages, serve them in order so the handler's offset loop
    // is exercised; otherwise the default single empty page (existing cases).
    if (state.widgetPages && state.widgetPages.length) return json(state.widgetPages.shift());
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
async function listAs({ email, recordId, clientId, query, headers }) {
  const token = createToken({ email, recordId, clientId });
  const res = mockRes();
  state.lastListUrl = '';
  await handler({
    method: 'GET',
    query: query || {},
    headers: Object.assign(
      { authorization: `Bearer ${token}`, origin: 'https://widgets.travelify.io' },
      headers || {}),
    socket: { remoteAddress: '10.0.0.1' },
  }, res);
  // The URL is built with URLSearchParams, which writes a space as "+", so the
  // inverse has to put spaces back before decodeURIComponent. Without it the
  // formula read as "...,+LOWER(..." and an assertion that spelt the formula
  // with its normal spaces failed against code that was perfectly correct.
  // (Found 11 Sep 2026.)
  const raw = (state.lastListUrl.match(/filterByFormula=([^&]*)/) || [])[1] || '';
  return { res, formula: decodeURIComponent(raw.replace(/\+/g, ' ')) };
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

// ── scope=self: the personal scheduler companion sees the CALLER'S OWN widgets ─
// A staff member working INSIDE a client account (activeClientId = the client)
// still needs their own booking pages in the Gmail companion. ?scope=self scopes
// by their own login email and ignores the active client entirely, so their
// scheduler stops vanishing when they act as a client. This must NOT reintroduce
// the Worldchoice leak: it is the staff member's own private view of their own
// widgets, never a client dashboard showing staff widgets.
state.users.recANDY0000000001 = { email: 'andy.speight@agendas.group', clients: [WORLDCHOICE] };
{
  const { res, formula } = await listAs({ email: 'andy.speight@agendas.group', recordId: 'recANDY0000000001', clientId: WORLDCHOICE, query: { scope: 'self' } });
  ok(res.statusCode === 200, 'scope=self: list succeeds');
  ok(formula === `LOWER({ClientEmail})='andy.speight@agendas.group'`, 'scope=self: scoped to the caller OWN email only');
  ok(!formula.includes(WORLDCHOICE) && !formula.includes('ClientRecordId'),
    'scope=self: the active client id / record scoping is absent — purely own widgets');
}
{
  // Same session WITHOUT scope=self stays strictly client-scoped — no regression.
  const { formula } = await listAs({ email: 'andy.speight@agendas.group', recordId: 'recANDY0000000001', clientId: WORLDCHOICE });
  ok(formula.includes(`{ClientRecordId}='${WORLDCHOICE}'`) && !formula.includes('agendas.group'),
    'default scope unchanged: staff-email account still id-only, own email absent');
}

// ── No client context: old tokens scope purely by own email ──────────────────
state.users.recLONE0000000001 = { email: 'solo@example.com', clients: [] };
{
  const { formula } = await listAs({ email: 'solo@example.com', recordId: 'recLONE0000000001' });
  ok(formula === `LOWER({ClientEmail})='solo@example.com'`, 'no client context: own-email scope (legacy tokens unregressed)');
}

// ── Pagination: an account with MORE than one page returns ALL its widgets ────
// Better Lifestyle had 66 widgets; the old maxRecords=50 single request dropped
// the 16 oldest, so a whole widget type showed short and looked like deletion.
// The handler now pages until Airtable stops handing back an offset.
{
  const mkRecs = (n, prefix) => Array.from({ length: n }, (_, i) => ({
    id: 'rec' + prefix + String(i).padStart(12, '0'),
    fields: { WidgetID: 'tgw_' + prefix + '_' + i, Name: prefix + i, WidgetType: 'Weather', Status: 'Active' },
  }));
  state.widgetPages = [
    { records: mkRecs(100, 'p1'), offset: 'offPAGE2' }, // full first page + more
    { records: mkRecs(23, 'p2') },                       // last page, no offset
  ];
  const { res } = await listAs({ email: 'solo@example.com', recordId: 'recLONE0000000001' });
  ok(res.statusCode === 200, 'pagination: list succeeds across pages');
  ok(Array.isArray(res.body) && res.body.length === 123,
    'pagination: returns EVERY widget across pages (123), not a truncated 50');
  state.widgetPages = null;
}

// ── Auth still required ──────────────────────────────────────────────────────
{
  const res = mockRes();
  await handler({ method: 'GET', headers: {}, socket: {} }, res);
  ok(res.statusCode === 401, 'unauthenticated → 401');
}

// ── THE BROWSER EXTENSION IS A PERSONAL TOOL (11 Sep 2026) ──────────────────
// The scheduler panel's first screen listed every Appointment scheduler in the
// CLIENT, so two people working in one agency account each saw the other's
// meeting types. Reported three times as "it is showing my meetings", and it
// was never the diary.
//
// Fixing the panel alone only helps someone who reinstalls, and three updates
// had already gone out, so the server recognises the extension itself. Chrome
// sends NO Origin and NO Referer for an extension's fetch to a host it holds
// permission for (verified in Chromium, not assumed). Sec-Fetch-Site is the
// marker the browser controls and page script cannot forge.
const EXTENSION = { 'sec-fetch-site': 'none', 'sec-fetch-dest': 'empty' };
const DASHBOARD = { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty' };
const TYPED_IN_BAR = { 'sec-fetch-site': 'none', 'sec-fetch-dest': 'document' };

state.users.recANDYSPEIGHT001 = { email: 'andy.speight@agendas.group', clients: [OTHERCLIENT] };
state.clients[OTHERCLIENT] = 'andy.speight@agendas.group';
{
  const own = `LOWER({ClientEmail})='andy.speight@agendas.group'`;

  const ext = await listAs({ email: 'andy.speight@agendas.group', recordId: 'recANDYSPEIGHT001', clientId: OTHERCLIENT, headers: EXTENSION });
  ok(ext.formula === own, 'extension: scoped to the caller alone, so a colleague\'s schedulers cannot appear');

  const dash = await listAs({ email: 'andy.speight@agendas.group', recordId: 'recANDYSPEIGHT001', clientId: OTHERCLIENT, headers: DASHBOARD });
  ok(dash.formula.includes(`{ClientRecordId}='${OTHERCLIENT}'`) && dash.formula !== own,
    'dashboard: unchanged, still the whole client');

  const typed = await listAs({ email: 'andy.speight@agendas.group', recordId: 'recANDYSPEIGHT001', clientId: OTHERCLIENT, headers: TYPED_IN_BAR });
  ok(typed.formula !== own, 'a URL typed into the address bar is not mistaken for the extension');

  const plain = await listAs({ email: 'andy.speight@agendas.group', recordId: 'recANDYSPEIGHT001', clientId: OTHERCLIENT });
  ok(plain.formula !== own, 'a caller sending no Sec-Fetch headers keeps the default');

  const optOut = await listAs({ email: 'andy.speight@agendas.group', recordId: 'recANDYSPEIGHT001', clientId: OTHERCLIENT, headers: EXTENSION, query: { scope: 'client' } });
  ok(optOut.formula !== own, '?scope=client lets the extension ask for the whole account on purpose');

  const asked = await listAs({ email: 'andy.speight@agendas.group', recordId: 'recANDYSPEIGHT001', clientId: OTHERCLIENT, headers: DASHBOARD, query: { scope: 'self' } });
  ok(asked.formula === own, '?scope=self still works on its own, whatever the headers say');

  // The header can only ever NARROW what a caller sees.
  ok(!ext.formula.includes(OTHERCLIENT),
    'the extension path grants no client-wide visibility at all');
}

// The panel must actually ask, so it does not depend on the header rule.
{
  const panel = readFileSync(new URL('../extension/scheduler-companion/panel.js', import.meta.url), 'utf8');
  ok(/widget-list\?scope=self/.test(panel), 'the panel asks for its own schedulers');
  ok(!/['"]\/api\/widget-list['"]|widget-list['"], \{/.test(panel.replace(/widget-list\?scope=self/g, '')),
    'and no longer asks for the whole client list as well');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
