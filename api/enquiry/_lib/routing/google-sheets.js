// =============================================================================
//  /api/enquiry/_lib/routing/google-sheets.js
// =============================================================================
//
//  Appends each submission as a new row in the agent's Google Sheet.
//
//  AUTHENTICATION PATTERN — service account, not OAuth.
//  One service account for the whole TG Widget Suite. Agents share their
//  sheet with the service account email (Editor access). No per-client
//  OAuth flow, no refresh token management. Industry standard for B2B
//  form→sheets integrations.
//
//  Setup for the agent is a one-off:
//    1. Create a Google Sheet
//    2. Share it with: enquiries@tg-widgets.iam.gserviceaccount.com (Editor)
//    3. Paste the sheet ID into the form routing config
//
//  COLUMN ORDER (stable, written in this order every time):
//    A  Reference
//    B  Submitted At (UTC ISO)
//    C  Form Name
//    D  First Name
//    E  Last Name
//    F  Email
//    G  Phone
//    H  Destinations
//    I  Departure Airport
//    J  Depart Date
//    K  Return Date
//    L  Flexible Dates
//    M  Duration
//    N  Adults
//    O  Children
//    P  Child Ages
//    Q  Infants
//    R  Budget PP (GBP)
//    S  Stars
//    T  Board Basis
//    U  Interests
//    V  Notes
//    W  Marketing Consent
//    X  Source URL
//    Y  IP Address
//    Z  Submission ID
//
//  Agent's sheet doesn't need headers — we use USER_ENTERED valueInputOption
//  and the "append" endpoint, which handles insertion safely regardless.
//  If they've set headers in row 1, new rows land below them. If not, rows
//  land from the top.
//
// =============================================================================

import crypto from 'crypto';

const GOOGLE_SA_EMAIL       = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_SA_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
const SHEETS_API_BASE       = 'https://sheets.googleapis.com/v4/spreadsheets';
const OAUTH_TOKEN_URL       = 'https://oauth2.googleapis.com/token';

const BOARD_BASIS_LABEL = {
  RO: 'Room only', BB: 'B&B', HB: 'Half board', FB: 'Full board', AI: 'All inclusive',
};

// Form field IDs we need
const F = {
  sheetId:  'fldtfW0lFELg7yiv2',
  sheetTab: 'fldJ9KIeaiVsU4jP4',
  formName: 'fldC0MLSyJqg6U1zT',
};

// ---------- Service account JWT → access token -----------------------------
// Google service accounts use RS256-signed JWTs exchanged for short-lived
// access tokens. We cache the token for ~55 minutes (they last 60) to avoid
// re-signing on every request.

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExpiresAt > now + 60) {
    return cachedToken;
  }

  if (!GOOGLE_SA_EMAIL || !GOOGLE_SA_PRIVATE_KEY) {
    throw new Error('Google service account credentials missing');
  }

  // Build and sign JWT
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj) => Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const signingInput = `${encode(header)}.${encode(claims)}`;

  // Private key comes from env as a PEM string. If stored in Vercel env,
  // real newlines may be escaped as "\n" — normalise before signing.
  const privateKey = GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${signingInput}.${signature}`;

  // Exchange JWT for access token
  const body = new URLSearchParams();
  body.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  body.set('assertion', jwt);

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = now + (data.expires_in || 3600);
  return cachedToken;
}

// ---------- Build the row ---------------------------------------------------

function buildRow({ form, payload, reference, submissionId }) {
  const f = payload.fields;
  const dates = f.travel_dates || {};
  const travellers = f.travellers || {};
  const duration = f.duration || {};

  const destinations = (f.destinations || []).map(d => d.name).join(' + ');
  const durationStr = duration.custom || (duration.nights ? `${duration.nights} nights` : '');
  const interests = (f.interests || []).join(', ');
  const boardLabel = f.board ? (BOARD_BASIS_LABEL[f.board] || f.board) : '';

  // Single row — order matches the column documentation at the top of this file
  return [
    reference,                                      // A
    new Date().toISOString(),                       // B
    form.fields[F.formName] || '',                  // C
    f.first_name || '',                             // D
    f.last_name || '',                              // E
    f.email || '',                                  // F
    f.phone || '',                                  // G
    destinations,                                   // H
    f.departure_airport || '',                      // I
    dates.depart || '',                             // J
    dates.return || '',                             // K
    dates.flexible ? 'Yes' : 'No',                  // L
    durationStr,                                    // M
    travellers.adults ?? '',                        // N
    travellers.children ?? '',                      // O
    (travellers.childAges || []).join(', '),        // P
    travellers.infants ?? '',                       // Q
    typeof f.budget_pp === 'number' ? f.budget_pp : '', // R
    f.stars ?? '',                                  // S
    boardLabel,                                     // T
    interests,                                      // U
    (f.notes || '').replace(/\r?\n/g, ' ').trim(),  // V — flatten newlines for sheet cell
    f.marketing_consent ? 'Yes' : 'No',             // W
    payload.sourceUrl || '',                        // X
    // IP Address and Submission ID come from ctx.meta and ctx.submissionId
    // (injected below, not from payload.fields)
  ];
}

// ---------- Validate sheet ID format ----------------------------------------

function isValidSheetId(id) {
  // Google Sheet IDs are typically 44 chars, alphanumeric + - and _
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{20,100}$/.test(id);
}

function isValidTabName(name) {
  if (!name) return true; // optional — falls back to first sheet
  // Tab names allow most characters; cap length and forbid control chars / quotes
  return typeof name === 'string' &&
    name.length <= 100 &&
    !/['"\u0000-\u001F]/.test(name);
}

// ---------- Public interface -------------------------------------------------

export default async function sendToGoogleSheets(ctx) {
  const { form, payload, reference, submissionId, meta } = ctx;

  const sheetId = (form.fields[F.sheetId] || '').trim();
  if (!sheetId) {
    return { status: 'failed', error: 'No Google Sheet ID configured' };
  }
  if (!isValidSheetId(sheetId)) {
    return { status: 'failed', error: 'Invalid Google Sheet ID format' };
  }

  const tabName = (form.fields[F.sheetTab] || '').trim();
  if (!isValidTabName(tabName)) {
    return { status: 'failed', error: 'Invalid Sheet tab name' };
  }

  // Build row + append metadata not in payload
  const row = buildRow({ form, payload, reference, submissionId });
  row.push(meta?.ip || '');   // Y — IP Address
  row.push(submissionId);     // Z — Submission ID

  // Range: default to Sheet1 if no tab specified. "A:Z" appends to the data range.
  const range = tabName ? `${tabName}!A:Z` : 'A:Z';
  const encodedRange = encodeURIComponent(range);

  const url = `${SHEETS_API_BASE}/${sheetId}/values/${encodedRange}:append` +
              `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error('[routing/google-sheets] Token fetch failed:', err);
    return { status: 'failed', error: 'Google auth failed' };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const errShort = errText.slice(0, 300);
      console.error('[routing/google-sheets] Append failed:', response.status, errShort);

      // Surface useful errors back to the agent via routing log
      let friendly = `Google Sheets returned ${response.status}`;
      if (response.status === 403) {
        friendly = 'Permission denied — has the sheet been shared with the service account?';
      } else if (response.status === 404) {
        friendly = 'Sheet not found — check the Sheet ID is correct';
      } else if (response.status === 400 && errShort.includes('tab')) {
        friendly = `Sheet tab "${tabName}" not found`;
      }

      return {
        status: 'failed',
        statusCode: response.status,
        error: friendly,
      };
    }

    return { status: 'ok', statusCode: response.status };
  } catch (err) {
    console.error('[routing/google-sheets] Fetch error:', err);
    return { status: 'failed', error: err.message };
  }
}
