/**
 * Generic Sheets provisioning for Widgets-table form types (Newsletter and
 * friends) — POST /api/sheets-provision with a Widgets record id.
 *
 * The lead router's Sheets destination writes its own per-widget header on
 * first append into the default "Sheet1" tab, so this endpoint creates and
 * shares only — no tab rename, no header row. The sheet is always shared
 * with the widget's owning ACCOUNT (Clients record email preferred over
 * ClientEmail, which can be a staff address on staff-created widgets).
 *
 * Drives the REAL handler with mocked Google + Airtable, a real signed
 * session token and a throwaway RSA service-account key (real JWT signing).
 * Shared Drive mode throughout — that is the only mode Google still permits.
 *
 * Run: node test/sheets-provision-generic-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'tg-widget-enquiries@travelgenix-widgets.iam.gserviceaccount.com';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.TG_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';
process.env.TG_SHEETS_SHARED_DRIVE_ID = '0ASharedDrive123';

const { createToken } = await import('../api/_auth.js');
const { default: handler } = await import('../api/sheets-provision.js');

const WIDGET_REC = 'recWIDGET00000001';
const CLIENT_REC = 'recCLIENT00000001';

function mockRes() {
  const headers = {};
  return {
    statusCode: 200, body: undefined, headers,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(n) { this.statusCode = n; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; },
  };
}

let calls = [];
function installFetch({ clientEmail, clientRecordId, accountEmail }) {
  calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    const body = opts && opts.body ? String(opts.body) : '';
    calls.push({ url: u, method: (opts && opts.method) || 'GET', body });
    if (u.includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'gtok', expires_in: 3600 }), text: async () => '' };
    }
    if (u.includes(`/tblVAThVqAjqtria2/${WIDGET_REC}`)) {
      const fields = { Name: 'Newsletter signup', ClientName: 'Free From Travel', ClientEmail: clientEmail };
      if (clientRecordId) fields.ClientRecordId = clientRecordId;
      return { ok: true, status: 200, json: async () => ({ id: WIDGET_REC, fields }), text: async () => '' };
    }
    if (u.includes('/tblikekpaTKraMktZ/')) {
      return { ok: true, status: 200, json: async () => ({ id: CLIENT_REC, fields: { fldVRiIAlrTjxnNHP: accountEmail } }), text: async () => '' };
    }
    if (u.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      return { ok: true, status: 200, json: async () => ({ id: 'SHEET789' }), text: async () => '' };
    }
    if (u.includes('/drive/v3/files/SHEET789/permissions')) {
      return { ok: true, status: 200, json: async () => ({ id: 'perm1' }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
}

function request(email, recId) {
  const token = createToken({ email });
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: 'https://widgets.travelify.io' },
    body: { widgetRecordId: recId || WIDGET_REC },
    socket: {},
  };
}

// ── 1. Owner provisions; share goes to the ACCOUNT email via ClientRecordId ──
installFetch({ clientEmail: 'george@freefromtravel.com', clientRecordId: CLIENT_REC, accountEmail: 'accounts@freefromtravel.com' });
let res = mockRes();
await handler(request('george@freefromtravel.com'), res);
ok(res.statusCode === 200 && res.body && res.body.created === true, `owner provision → 200 (got ${res.statusCode} ${res.body && res.body.error} ${res.body && res.body.detail || ''})`);
ok(res.body && res.body.sheetId === 'SHEET789' && res.body.tab === 'Sheet1', 'default Sheet1 tab kept (auto-header owns the layout)');
ok(res.body && res.body.sharedWith === 'accounts@freefromtravel.com', 'shared with the owning ACCOUNT email, not ClientEmail');
const createCall = calls.find(c => c.url.startsWith('https://www.googleapis.com/drive/v3/files?'));
ok(createCall && /"name":"Free From Travel leads"/.test(createCall.body) && /"parents":\["0ASharedDrive123"\]/.test(createCall.body), 'created in the Shared Drive, titled after the client');
ok(!calls.some(c => c.url.includes(':batchUpdate')) && !calls.some(c => c.url.includes('/values/')), 'no tab rename and no header write (destination auto-header handles it)');

// ── 2. No ClientRecordId → falls back to ClientEmail ─────────────────────────
installFetch({ clientEmail: 'george@freefromtravel.com', clientRecordId: null, accountEmail: null });
res = mockRes();
await handler(request('george@freefromtravel.com'), res);
ok(res.statusCode === 200 && res.body && res.body.sharedWith === 'george@freefromtravel.com', 'legacy widget without ClientRecordId shares with ClientEmail');

// ── 3. Staff can provision for a client ──────────────────────────────────────
installFetch({ clientEmail: 'george@freefromtravel.com', clientRecordId: CLIENT_REC, accountEmail: 'accounts@freefromtravel.com' });
res = mockRes();
await handler(request('andy.speight@agendas.group'), res);
ok(res.statusCode === 200 && res.body && res.body.sharedWith === 'accounts@freefromtravel.com', 'staff provision still shares with the client account');

// ── 4. A stranger is refused ─────────────────────────────────────────────────
installFetch({ clientEmail: 'george@freefromtravel.com', clientRecordId: CLIENT_REC, accountEmail: 'accounts@freefromtravel.com' });
res = mockRes();
await handler(request('intruder@elsewhere.example'), res);
ok(res.statusCode === 403, `non-owner non-staff → 403 (got ${res.statusCode})`);

// ── 5. Malformed record id → 400 ─────────────────────────────────────────────
res = mockRes();
await handler(request('george@freefromtravel.com', 'not-a-rec-id'), res);
ok(res.statusCode === 400, 'malformed widgetRecordId → 400');

// ── 6. Source guards: newsletter editor wiring ───────────────────────────────
const ed = readFileSync(new URL('../public/editor-newsletter.html', import.meta.url), 'utf8');
ok(/dc-provision-btn/.test(ed) && /\/api\/sheets-provision/.test(ed), 'newsletter editor has the one-click provision button');
ok(/Create my spreadsheet/.test(ed), 'button labelled consistently with the enquiry builder');
ok(/widgetRecordId: state\.recordId/.test(ed), 'button provisions for the current widget');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
