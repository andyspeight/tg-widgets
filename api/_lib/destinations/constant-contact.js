// =============================================================================
//  /api/_lib/destinations/constant-contact.js
// =============================================================================
//
//  Adds (or updates) a contact in Constant Contact and assigns them to lists.
//
//  Constant Contact V3 only supports OAuth2 — there is no static API key.
//  Access tokens expire after 24 hours. We store both the access token and
//  the refresh token (encrypted), and refresh on demand when the access
//  token has expired.
//
//  POST /v3/contacts/sign_up_form is the upsert-friendly endpoint —
//  if the contact exists, it updates them; if not, creates a new one.
//
//  Credentials shape:
//    {
//      accessToken: "...",
//      refreshToken: "...",
//      expiresAt: "2026-05-09T08:30:00Z",  // ISO timestamp
//      clientId: "...",                      // OAuth app client ID
//      clientSecret: "..."                   // OAuth app client secret
//    }
//
//  Config shape:
//    {
//      listIds: ["d13d60d0-f256-11e8-b47d-fa163e56c9b0"],  // required, UUIDs
//      customFields: [{ id: "...", value: "{{source.widget}}" }]  // optional
//    }
//
//  Docs: https://developer.constantcontact.com/api_guide/contacts_create_or_update.html
//
//  IMPORTANT: When this dispatcher refreshes the token, it returns the new
//  credentials in the result object so the caller can update the stored
//  credentials in Airtable. The caller is the router; we pass back
//  refreshedCredentials and the router persists them.
// =============================================================================

const TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token';
const API_BASE = 'https://api.cc.email/v3';

export async function dispatchConstantContact(lead, job) {
  const { credentials = {}, config = {} } = job;

  if (!credentials.accessToken) throw new Error('Constant Contact credentials missing accessToken');
  if (!Array.isArray(config.listIds) || config.listIds.length === 0) {
    throw new Error('Constant Contact config missing listIds');
  }

  // Refresh access token if it's expired or about to expire (within 60s)
  let accessToken = credentials.accessToken;
  let refreshedCredentials = null;
  if (isExpired(credentials.expiresAt)) {
    if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
      throw new Error('Constant Contact access token expired and refresh credentials are missing');
    }
    refreshedCredentials = await refreshToken(credentials);
    accessToken = refreshedCredentials.accessToken;
  }

  const body = {
    email_address: lead.contact.email,
    list_memberships: config.listIds.map(String),
    create_source: 'Account', // permitted values: 'Account' | 'Contact'
  };
  if (lead.contact.firstName) body.first_name = lead.contact.firstName;
  if (lead.contact.lastName)  body.last_name = lead.contact.lastName;
  if (lead.contact.phone)     body.phone_number = lead.contact.phone;

  // Custom fields — Constant Contact uses an array of { custom_field_id, value }
  if (Array.isArray(config.customFields) && config.customFields.length > 0) {
    const customFields = [];
    for (const cf of config.customFields) {
      if (!cf || !cf.id) continue;
      let value = cf.value;
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        value = resolveLeadPath(lead, value.slice(2, -2).trim());
      }
      if (value == null) continue;
      customFields.push({ custom_field_id: cf.id, value: String(value) });
    }
    if (customFields.length > 0) body.custom_fields = customFields;
  }

  const url = `${API_BASE}/contacts/sign_up_form`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseBody = await resp.text();
  if (!resp.ok) {
    const err = new Error(`Constant Contact ${resp.status}: ${responseBody.slice(0, 300)}`);
    err.statusCode = resp.status;
    throw err;
  }

  const result = {
    statusCode: resp.status,
    requestPayload: { url, method: 'POST', body: redactBody(body) },
    responseBody: responseBody.slice(0, 2000),
  };

  // If we refreshed the token, surface that to the caller so they can
  // persist the new tokens in Airtable RoutingConfig.
  if (refreshedCredentials) result.refreshedCredentials = refreshedCredentials;

  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (isNaN(t)) return true;
  return t - Date.now() < 60_000; // refresh if within 60s of expiry
}

async function refreshToken(creds) {
  const params = new URLSearchParams();
  params.set('refresh_token', creds.refreshToken);
  params.set('grant_type', 'refresh_token');

  // Constant Contact uses Basic auth for the token refresh
  const auth = 'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Constant Contact token refresh failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('Constant Contact token refresh returned invalid JSON'); }

  if (!data.access_token) {
    throw new Error('Constant Contact token refresh missing access_token in response');
  }

  // CC sometimes returns a new refresh_token, sometimes recycles the old one.
  // Use the new one if provided, fall back to the old one.
  const newRefresh = data.refresh_token || creds.refreshToken;
  const expiresIn = Number(data.expires_in) || 86400; // default 24h
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return {
    ...creds,
    accessToken: data.access_token,
    refreshToken: newRefresh,
    expiresAt,
  };
}

function redactBody(body) {
  if (!body || !body.email_address) return body;
  const e = body.email_address;
  return { ...body, email_address: e.replace(/^(.).*(@.*)$/, '$1***$2') };
}

function resolveLeadPath(lead, path) {
  const parts = path.split('.');
  let cur = lead;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}
