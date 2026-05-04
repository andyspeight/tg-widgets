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
//    1. Create a Google Sheet
//    2. Share it with: enquiries@tg-widgets.iam.gserviceaccount.com (Editor)
//    3. Paste the sheet ID into the routing config
//
//  COLUMN ORDER (stable, written in this order every time):
//    A  Lead ID
//    B  Received At (UTC ISO)
//    C  Source Widget
//    D  Source URL
//    E  First Name
//    F  Last Name
//    G  Email
//    H  Phone
//    I  Tags
//    J  Destinations
//    K  Departure Airport
//    L  Depart Date
//    M  Return Date
//    N  Flexible Dates
//    O  Duration Nights
//    P  Adults
//    Q  Children
//    R  Child Ages
//    S  Infants
//    T  Budget PP (GBP)
//    U  Star Rating
//    V  Board Basis
//    W  Interests
//    X  Marketing Consent
//    Y  Custom Fields (JSON)
//    Z  Referrer
//
// =============================================================================

import { createSign } from 'crypto';

const GOOGLE_SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_SA_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const BOARD_BASIS_LABEL = {
  RO: 'Room only', BB: 'B&B', HB: 'Half board', FB: 'Full board', AI: 'All inclusive',
};

let cachedToken = null;
let cachedTokenExpiry = 0;

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

  const resp = await fetch(OAUTH_TOKEN_URL, {
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

// ── Row builder ─────────────────────────────────────────────────────────

function buildRow(lead) {
  const t = lead.travel;
  return [
    lead.leadId,
    lead.receivedAt,
    lead.source.widget,
    lead.source.sourceUrl,
    lead.contact.firstName,
    lead.contact.lastName,
    lead.contact.email,
    lead.contact.phone,
    lead.tags.join(', '),
    t.destinations.join(', '),
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
    t.interests.join(', '),
    lead.consent.marketing ? 'Yes' : 'No',
    Object.keys(lead.custom || {}).length ? JSON.stringify(lead.custom) : '',
    lead.source.referrer,
  ];
}

// ── Public dispatcher ───────────────────────────────────────────────────

export async function dispatchGoogleSheets(lead, job) {
  const spreadsheetId = job.config?.spreadsheetId;
  const sheetName = job.config?.sheetName || 'Sheet1';

  if (!spreadsheetId || typeof spreadsheetId !== 'string') {
    const e = new Error('Missing spreadsheetId in config');
    e.statusCode = 400;
    throw e;
  }

  const token = await getAccessToken();
  const range = `${encodeURIComponent(sheetName)}!A:Z`;
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const row = buildRow(lead);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  });

  const respText = await resp.text().catch(() => '');

  if (!resp.ok) {
    const e = new Error(`Sheets API ${resp.status}: ${respText.slice(0, 200)}`);
    e.statusCode = resp.status;
    throw e;
  }

  return {
    statusCode: resp.status,
    requestPayload: { spreadsheetId, sheetName, columnsWritten: row.length },
    responseBody: respText.slice(0, 2000),
  };
}
