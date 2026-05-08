// =============================================================================
//  /api/_lib/destinations/google-sheets.js
// =============================================================================
//
//  Appends each lead as a new row in the agent's Google Sheet.
//
//  AUTHENTICATION — service account (not OAuth).
//  One service account for the whole TG Widget Suite. Agents share their
//  sheet with the service account email (Editor access). No per-client
//  OAuth flow, no refresh token management.
//
//  Setup (one-off, agent does this):
//    1. Create a Google Sheet in their Google account
//    2. Share it with the Travelgenix service account email
//       (whatever GOOGLE_SERVICE_ACCOUNT_EMAIL is set to on Vercel)
//       — granting "Editor" access
//    3. Paste the spreadsheet ID into the routing config
//    4. Optionally set the tab name (defaults to "Sheet1")
//
//  ROW SHAPE — adapts to the widget that produced the lead:
//    - "newsletter" widget: 9 compact columns (timestamp, contact, consent, tags)
//    - any other widget (enquiry form, etc): full 26-column layout
//  This means a sheet hooked up to a Newsletter Signup widget gets a tidy
//  9-column layout, while a sheet hooked up to an Enquiry Form gets the full
//  travel-brief layout. One dispatcher, two row shapes.
//
//  AUTO-HEADER:
//  On first write to a tab that's empty (row 1 has no values), we insert a
//  header row first, then append the data row. If row 1 already has any
//  values we trust the user's existing column layout and just append.
//
// =============================================================================

import { createSign } from 'crypto';

const GOOGLE_SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_SA_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 10_000;

const BOARD_BASIS_LABEL = {
  RO: 'Room only', BB: 'B&B', HB: 'Half board', FB: 'Full board', AI: 'All inclusive',
};

let cachedToken = null;
let cachedTokenExpiry = 0;

// Per-tab cache of "we already checked the header on this tab during this
// cold start". Avoids one extra API call per row after the first.
const headerCheckedCache = new Set();

// ── Service account JWT → access token ──────────────────────────────────

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry - 30_000) {
    return cachedToken;
  }
  if (!GOOGLE_SA_EMAIL || !GOOGLE_SA_PRIVATE_KEY) {
    throw new Error('Google service account env vars not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: OAUTH_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const enc = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${enc(header)}.${enc(claim)}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  // Private key may have escaped \n in Vercel env — normalise
  const privateKey = GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n');
  const signature = signer.sign(privateKey).toString('base64url');
  const jwt = `${unsigned}.${signature}`;

  const params = new URLSearchParams();
  params.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  params.set('assertion', jwt);

  const resp = await timedFetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Google OAuth ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

function timedFetch(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// ── Verifier (used by /api/routing-test for the editor's "Test" button) ─

/**
 * Verify we can read the spreadsheet. Returns { ok, error?, sheetTitle?, availableTabs? }.
 */
export async function verifyGoogleSheets(spreadsheetId, sheetName) {
  if (!spreadsheetId || typeof spreadsheetId !== 'string') {
    return { ok: false, error: 'Missing spreadsheet ID' };
  }
  if (!GOOGLE_SA_EMAIL || !GOOGLE_SA_PRIVATE_KEY) {
    return { ok: false, error: 'Google service account is not configured on the server' };
  }

  let token;
  try { token = await getAccessToken(); }
  catch (err) { return { ok: false, error: 'Could not authenticate with Google: ' + err.message }; }

  // GET spreadsheet metadata — confirms (a) sheet exists, (b) service account has access
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties`;
  let resp;
  try {
    resp = await timedFetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  } catch (err) {
    return { ok: false, error: 'Network error contacting Google Sheets' };
  }

  if (resp.status === 403 || resp.status === 404) {
    return {
      ok: false,
      error: `Sheet not accessible. Check the spreadsheet ID and make sure you've shared the sheet with ${GOOGLE_SA_EMAIL} as Editor.`,
    };
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { ok: false, error: `Google Sheets returned ${resp.status}: ${txt.slice(0, 200)}` };
  }

  const data = await resp.json();
  const title = data?.properties?.title || '';
  const tabNames = (data?.sheets || []).map(s => s?.properties?.title).filter(Boolean);

  // If a tab name was specified, confirm it exists
  if (sheetName && !tabNames.includes(sheetName)) {
    return {
      ok: false,
      error: `Tab "${sheetName}" not found. Available tabs: ${tabNames.join(', ') || '(none)'}`,
      sheetTitle: title,
      availableTabs: tabNames,
    };
  }

  return {
    ok: true,
    sheetTitle: title,
    availableTabs: tabNames,
    serviceAccount: GOOGLE_SA_EMAIL,
  };
}

// ── Row shape — per-widget ──────────────────────────────────────────────

/** Newsletter widget — compact 9-column layout. */
function buildNewsletterRow(lead) {
  return [
    lead.receivedAt,                                  // A  Timestamp
    lead.contact.email,                               // B  Email
    lead.contact.firstName || '',                     // C  First name
    lead.contact.lastName || '',                      // D  Last name
    lead.consent.marketing ? 'Yes' : 'No',            // E  Marketing consent
    (lead.tags || []).join(', '),                     // F  Tags
    lead.source.sourceUrl || '',                      // G  Source page
    lead.leadId || '',                                // H  Lead ID
    lead.source.ipAddress || '',                      // I  IP
  ];
}
const NEWSLETTER_HEADERS = [
  'Timestamp', 'Email', 'First Name', 'Last Name',
  'Marketing Consent', 'Tags', 'Source Page', 'Lead ID', 'IP',
];

/** Enquiry-form / catch-all — full 26-column travel brief. */
function buildFullRow(lead) {
  const t = lead.travel || {};
  return [
    lead.leadId,
    lead.receivedAt,
    lead.source.widget,
    lead.source.sourceUrl,
    lead.contact.firstName,
    lead.contact.lastName,
    lead.contact.email,
    lead.contact.phone,
    (lead.tags || []).join(', '),
    (t.destinations || []).join(', '),
    t.departureAirport,
    t.departDate,
    t.returnDate,
    t.flexibleDates ? 'Yes' : '',
    t.durationNights ?? '',
    t.adults ?? '',
    t.children ?? '',
    (t.childAges || []).join(', '),
    t.infants ?? '',
    t.budgetPP ?? '',
    t.starRating ?? '',
    BOARD_BASIS_LABEL[t.boardBasis] || '',
    (t.interests || []).join(', '),
    lead.consent.marketing ? 'Yes' : 'No',
    Object.keys(lead.custom || {}).length ? JSON.stringify(lead.custom) : '',
    lead.source.referrer,
  ];
}
const FULL_HEADERS = [
  'Lead ID', 'Received At', 'Source Widget', 'Source URL',
  'First Name', 'Last Name', 'Email', 'Phone',
  'Tags', 'Destinations', 'Departure Airport', 'Depart Date', 'Return Date',
  'Flexible Dates', 'Duration Nights', 'Adults', 'Children', 'Child Ages',
  'Infants', 'Budget PP (GBP)', 'Star Rating', 'Board Basis', 'Interests',
  'Marketing Consent', 'Custom Fields (JSON)', 'Referrer',
];

function rowSpecForLead(lead) {
  const widget = lead?.source?.widget || '';
  if (widget === 'newsletter') {
    return { headers: NEWSLETTER_HEADERS, row: buildNewsletterRow(lead), cols: 'I' };
  }
  // Default — enquiry form & anything else uses the full 26-column layout
  return { headers: FULL_HEADERS, row: buildFullRow(lead), cols: 'Z' };
}

// ── Auto-header check ───────────────────────────────────────────────────

/**
 * If row 1 of the tab is empty, write a header row first. Skips after the
 * first lead in a cold start to avoid an extra round-trip on every signup.
 */
async function maybeWriteHeader(token, spreadsheetId, sheetName, headers, lastCol) {
  const cacheKey = `${spreadsheetId}:${sheetName}`;
  if (headerCheckedCache.has(cacheKey)) return;

  // GET the first row to see if it's empty
  const checkUrl = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetName)}!A1:${lastCol}1`;
  const checkResp = await timedFetch(checkUrl, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!checkResp.ok) {
    // Don't fail the whole dispatch — just skip the auto-header logic
    headerCheckedCache.add(cacheKey);
    return;
  }
  const data = await checkResp.json();
  const hasContent = Array.isArray(data?.values) && data.values.length > 0
    && Array.isArray(data.values[0]) && data.values[0].some(cell => String(cell || '').trim() !== '');

  if (!hasContent) {
    // Write the header row at A1
    const writeUrl = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetName)}!A1?valueInputOption=USER_ENTERED`;
    await timedFetch(writeUrl, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [headers] }),
    });
  }

  headerCheckedCache.add(cacheKey);
}

// ── Public dispatcher ───────────────────────────────────────────────────

export async function dispatchGoogleSheets(lead, job) {
  // Accept both `spreadsheetId` and `sheetId` for backward compat with the
  // editor's earlier field naming
  const spreadsheetId = job.config?.spreadsheetId || job.config?.sheetId;
  const sheetName = job.config?.sheetName || 'Sheet1';

  if (!spreadsheetId || typeof spreadsheetId !== 'string') {
    const e = new Error('Missing spreadsheet ID in config');
    e.statusCode = 400;
    throw e;
  }

  const token = await getAccessToken();
  const { headers, row, cols } = rowSpecForLead(lead);

  // Auto-write header on first run if sheet is empty
  try { await maybeWriteHeader(token, spreadsheetId, sheetName, headers, cols); }
  catch (err) { /* non-fatal — proceed to append */ }

  // Append the data row
  const range = `${encodeURIComponent(sheetName)}!A:${cols}`;
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const resp = await timedFetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  });

  const respText = await resp.text().catch(() => '');

  if (!resp.ok) {
    let friendly = `Sheets API ${resp.status}`;
    if (resp.status === 403 || resp.status === 404) {
      friendly = `Could not write to sheet. Check the spreadsheet ID and that the sheet is shared with ${GOOGLE_SA_EMAIL || 'the Travelgenix service account'} as Editor.`;
    }
    const e = new Error(friendly);
    e.statusCode = resp.status;
    throw e;
  }

  return {
    statusCode: resp.status,
    requestPayload: { spreadsheetId, sheetName, columnsWritten: row.length, rowShape: lead?.source?.widget === 'newsletter' ? 'newsletter' : 'full' },
    responseBody: respText.slice(0, 2000),
  };
}
