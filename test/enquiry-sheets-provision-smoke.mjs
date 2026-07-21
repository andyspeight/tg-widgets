/**
 * Google Sheets one-click provisioning — the platform creates the spreadsheet,
 * writes headers, shares it with the FORM OWNER's email and returns the wiring.
 *
 * Replaces the manual flow (client creates a sheet, shares it with our service
 * account, pastes the ID) which was too much to ask of every client — and
 * whose builder setup note showed a service account email that never existed.
 *
 * Drives the REAL /api/enquiry/sheets-provision handler with mocked Google +
 * Airtable and a real signed session token. The service-account key is a
 * throwaway RSA pair generated in-test, so the real JWT signing path runs.
 *
 * Run: node test/enquiry-sheets-provision-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

// Env BEFORE imports — modules read it at load time.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appTESTBASE000000';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'tg-widget-enquiries@travelgenix-widgets.iam.gserviceaccount.com';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.TG_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';

const { createToken } = await import('../api/_auth.js');
const { default: handler } = await import('../api/enquiry/sheets-provision.js');

const OWNER_FIELD = 'fldLzWF0XnEXeZYH1';
const CLIENT_NAME_FIELD = 'fldrw1eTFYCFIo0pp';

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

// URL-routed Google/Airtable mock, with call capture.
let calls = [];
let driveResponds = () => ({ ok: true, status: 200, json: async () => ({ id: 'perm1' }), text: async () => '' });
function installFetch(ownerEmail) {
  calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    const body = opts && opts.body ? String(opts.body) : '';
    calls.push({ url: u, method: (opts && opts.method) || 'GET', body });
    if (u.includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'gtok', expires_in: 3600 }), text: async () => '' };
    }
    if (u.includes('api.airtable.com') && u.includes('filterByFormula')) {
      return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recFORM0000000001', fields: { [OWNER_FIELD]: ownerEmail, [CLIENT_NAME_FIELD]: 'Free From Travel' } }] }), text: async () => '' };
    }
    if (u === 'https://sheets.googleapis.com/v4/spreadsheets') {
      return { ok: true, status: 200, json: async () => ({ spreadsheetId: 'SHEET123', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET123/edit' }), text: async () => '' };
    }
    if (u.includes('/values/')) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    if (u.includes('googleapis.com/drive/v3/files/')) {
      return driveResponds();
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
}

function request(email, widgetId) {
  const token = createToken({ email });
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: 'https://widgets.travelify.io' },
    body: { widgetId: widgetId || 'tgw_1784179041137_anycbh' },
    socket: {},
  };
}

// ── 1. Owner provisions: create → headers → share → wiring returned ──────────
installFetch('george@freefromtravel.com');
let res = mockRes();
await handler(request('george@freefromtravel.com'), res);
ok(res.statusCode === 200 && res.body && res.body.created === true, `owner provision → 200 created (got ${res.statusCode} ${res.body && res.body.error})`);
ok(res.body && res.body.sheetId === 'SHEET123' && res.body.tab === 'Enquiries', 'returns sheetId + Enquiries tab');
ok(res.body && res.body.sharedWith === 'george@freefromtravel.com', 'shared with the FORM OWNER');
const createCall = calls.find(c => c.url === 'https://sheets.googleapis.com/v4/spreadsheets');
ok(createCall && /Free From Travel enquiries/.test(createCall.body), 'spreadsheet titled after the client');
ok(createCall && /frozenRowCount/.test(createCall.body), 'header row frozen');
const headerCall = calls.find(c => c.url.includes('/values/'));
ok(headerCall && /"Reference","Submitted At \(UTC\)","Form Name"/.test(headerCall.body), 'header row written in routing column order');
const shareCall = calls.find(c => c.url.includes('/drive/v3/files/'));
ok(shareCall && /"emailAddress":"george@freefromtravel.com"/.test(shareCall.body) && /"role":"writer"/.test(shareCall.body), 'Drive share: owner as writer');
ok(shareCall && shareCall.url.includes('sendNotificationEmail=true'), 'owner gets the Google notification email');
const tokenCall = calls.find(c => c.url.includes('oauth2.googleapis.com'));
ok(tokenCall && /assertion=/.test(tokenCall.body), 'real JWT signing path exercised');

// ── 2. Staff can provision for a client; sheet still shared with the owner ───
installFetch('george@freefromtravel.com');
res = mockRes();
await handler(request('andy.speight@agendas.group', 'tgw_1784179041137_anycbb'), res);
ok(res.statusCode === 200 && res.body && res.body.sharedWith === 'george@freefromtravel.com', 'staff provision shares with the client, not the staff member');

// ── 3. A stranger is refused ─────────────────────────────────────────────────
installFetch('george@freefromtravel.com');
res = mockRes();
await handler(request('intruder@elsewhere.example', 'tgw_1784179041137_anycbc'), res);
ok(res.statusCode === 403, `non-owner non-staff → 403 (got ${res.statusCode})`);

// ── 4. Drive API disabled → clear one-off setup message, not a generic error ─
installFetch('george@freefromtravel.com');
driveResponds = () => ({ ok: false, status: 403, json: async () => ({}), text: async () => JSON.stringify({ error: { message: 'Google Drive API has not been used in project 12345 before or it is disabled.' } }) });
res = mockRes();
await handler(request('george@freefromtravel.com', 'tgw_1784179041137_anycbd'), res);
ok(res.statusCode === 503 && /Drive API/.test((res.body && res.body.error) || ''), 'Drive API disabled → names the real fix');
driveResponds = () => ({ ok: true, status: 200, json: async () => ({ id: 'perm1' }), text: async () => '' });

// ── 5. Source guards: editor button + no ghost service accounts anywhere ─────
const ed = readFileSync(new URL('../public/editor-enquiry.html', import.meta.url), 'utf8');
ok(/Create my spreadsheet/.test(ed) && /\/api\/enquiry\/sheets-provision/.test(ed), 'builder has the one-click provision button');
ok(/tg-widget-enquiries@travelgenix-widgets\.iam\.gserviceaccount\.com/.test(ed), 'manual fallback shows the REAL service account');
ok(!/travelgenix-forms@travelgenix-io/.test(ed), 'ghost service account removed from the builder');
const sheetsSrc = readFileSync(new URL('../api/enquiry/_lib/routing/google-sheets.js', import.meta.url), 'utf8');
ok(!/enquiries@tg-widgets\.iam/.test(sheetsSrc), 'ghost service account removed from the routing docs');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
