// =============================================================================
//  /api/routing-test.js
// =============================================================================
//
//  Tests that a destination's credentials work by making a read-only call
//  against the destination's API. Used by the editor's "Test connection"
//  button before the user saves a routing config.
//
//  Authenticated. Accepts plaintext credentials in the request body — they
//  are never stored or logged. Pure pass-through verification.
//
//  Each destination has a corresponding `verify` function that:
//    - hits a low-impact read endpoint with the supplied credentials
//    - returns 200 OK if the credentials are valid AND the resource exists
//    - returns a clear error message if not
//
// =============================================================================

import { requireAuth, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const TIMEOUT_MS = 10_000;

// ── Per-destination verifiers ───────────────────────────────────────────

// Mailchimp: GET /3.0/lists/{audienceId}
async function verifyMailchimp(credentials, config) {
  if (!credentials?.apiKey) throw new Error('apiKey is required');
  if (!config?.audienceId) throw new Error('audienceId is required');
  const m = String(credentials.apiKey).match(/-([a-z]{2}\d+)$/);
  if (!m) throw new Error('apiKey is missing data center suffix (e.g. -us21)');
  const dc = m[1];
  const url = `https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(config.audienceId)}`;
  const auth = 'Basic ' + Buffer.from(`anystring:${credentials.apiKey}`).toString('base64');
  const resp = await withTimeout(fetch(url, { headers: { 'Authorization': auth } }));
  if (resp.status === 401) throw new Error('Invalid Mailchimp API key');
  if (resp.status === 404) throw new Error('Audience not found — check the audience ID');
  if (!resp.ok) throw new Error(`Mailchimp returned ${resp.status}`);
  const data = await resp.json();
  return { audience: data.name || data.id, members: data.stats?.member_count };
}

// Brevo: GET /v3/contacts/lists/{listId}
async function verifyBrevo(credentials, config) {
  if (!credentials?.apiKey) throw new Error('apiKey is required');
  if (!Array.isArray(config?.listIds) || config.listIds.length === 0) throw new Error('At least one listId is required');
  const listId = Number(config.listIds[0]);
  if (!Number.isInteger(listId) || listId <= 0) throw new Error('listIds must be positive integers');
  const url = `https://api.brevo.com/v3/contacts/lists/${listId}`;
  const resp = await withTimeout(fetch(url, { headers: { 'api-key': credentials.apiKey } }));
  if (resp.status === 401) throw new Error('Invalid Brevo API key');
  if (resp.status === 404) throw new Error('List not found — check the list ID');
  if (!resp.ok) throw new Error(`Brevo returned ${resp.status}`);
  const data = await resp.json();
  return { list: data.name || `List ${listId}`, members: data.totalSubscribers };
}

// MailerLite: GET /api/groups/{groupId}  (or /api/groups if no group given)
async function verifyMailerlite(credentials, config) {
  if (!credentials?.apiKey) throw new Error('apiKey is required');
  let url = 'https://connect.mailerlite.com/api/groups';
  if (Array.isArray(config?.groups) && config.groups.length > 0) {
    url += `/${encodeURIComponent(String(config.groups[0]))}`;
  }
  const resp = await withTimeout(fetch(url, { headers: { 'Authorization': `Bearer ${credentials.apiKey}` } }));
  if (resp.status === 401) throw new Error('Invalid MailerLite API key');
  if (resp.status === 404) throw new Error('Group not found — check the group ID');
  if (!resp.ok) throw new Error(`MailerLite returned ${resp.status}`);
  const data = await resp.json();
  if (data?.data?.name) return { group: data.data.name, members: data.data.active_count };
  return { groups: Array.isArray(data?.data) ? data.data.length : 0 };
}

// Klaviyo: GET /api/lists/{listId}
async function verifyKlaviyo(credentials, config) {
  if (!credentials?.apiKey) throw new Error('apiKey is required');
  if (!config?.listId) throw new Error('listId is required');
  const url = `https://a.klaviyo.com/api/lists/${encodeURIComponent(config.listId)}/`;
  const resp = await withTimeout(fetch(url, {
    headers: {
      'Authorization': `Klaviyo-API-Key ${credentials.apiKey}`,
      'revision': '2025-01-15',
      'Accept': 'application/vnd.api+json',
    },
  }));
  if (resp.status === 401 || resp.status === 403) throw new Error('Invalid Klaviyo API key or insufficient scopes (need lists:read)');
  if (resp.status === 404) throw new Error('List not found — check the list ID');
  if (!resp.ok) throw new Error(`Klaviyo returned ${resp.status}`);
  const data = await resp.json();
  return { list: data?.data?.attributes?.name || config.listId };
}

// Constant Contact: GET /v3/contact_lists/{listId} (with token refresh on 401)
async function verifyConstantContact(credentials, config) {
  if (!credentials?.accessToken) throw new Error('accessToken is required');
  if (!Array.isArray(config?.listIds) || config.listIds.length === 0) throw new Error('At least one listId is required');
  const listId = String(config.listIds[0]);

  // First attempt with current token
  let url = `https://api.cc.email/v3/contact_lists/${encodeURIComponent(listId)}`;
  let resp = await withTimeout(fetch(url, {
    headers: { 'Authorization': `Bearer ${credentials.accessToken}`, 'Accept': 'application/json' },
  }));

  let refreshedCredentials = null;
  if (resp.status === 401 && credentials.refreshToken && credentials.clientId && credentials.clientSecret) {
    refreshedCredentials = await refreshConstantContactToken(credentials);
    resp = await withTimeout(fetch(url, {
      headers: { 'Authorization': `Bearer ${refreshedCredentials.accessToken}`, 'Accept': 'application/json' },
    }));
  }

  if (resp.status === 401) throw new Error('Invalid Constant Contact access token (refresh failed or no refreshToken)');
  if (resp.status === 404) throw new Error('List not found — check the list ID');
  if (!resp.ok) throw new Error(`Constant Contact returned ${resp.status}`);
  const data = await resp.json();
  const out = { list: data?.name || listId, members: data?.membership_count };
  if (refreshedCredentials) out.refreshedCredentials = refreshedCredentials;
  return out;
}

async function refreshConstantContactToken(creds) {
  const params = new URLSearchParams();
  params.set('refresh_token', creds.refreshToken);
  params.set('grant_type', 'refresh_token');
  const auth = 'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const resp = await withTimeout(fetch('https://authz.constantcontact.com/oauth2/default/v1/token', {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  }));
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Token refresh failed (${resp.status})`);
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('Token refresh missing access_token');
  const expiresIn = Number(data.expires_in) || 86400;
  return {
    ...creds,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || creds.refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

// Webhook: just check the URL responds (HEAD or OPTIONS)
async function verifyWebhook(credentials, config) {
  const url = String(config?.url || '');
  if (!/^https?:\/\//.test(url)) throw new Error('Webhook URL must start with http(s)://');
  // Probe with a small POST so we know the endpoint accepts our content type
  // (some services 405 OPTIONS but accept POST). Mark as test=true so receivers
  // can ignore.
  const resp = await withTimeout(fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: true, source: 'travelgenix-routing-test' }),
  }));
  if (resp.status >= 500) throw new Error(`Webhook server error (${resp.status})`);
  if (resp.status === 401 || resp.status === 403) throw new Error(`Webhook rejected (${resp.status}) — check auth`);
  // 2xx, 3xx, 4xx (not 401/403/5xx) is acceptable — endpoint is reachable
  return { url, statusCode: resp.status };
}

// Google Sheets — real verifier delegated to the dispatcher module
async function verifyGoogleSheets(credentials, config) {
  const { verifyGoogleSheets: realVerify } = await import('./_lib/destinations/google-sheets.js');
  const result = await realVerify(
    config?.spreadsheetId || config?.sheetId,
    config?.sheetName || 'Sheet1'
  );
  if (!result.ok) throw new Error(result.error || 'Verification failed');
  // Re-shape the success result so it matches what the editor's "Test
  // connection" code expects (it looks for `list`, `audience`, `group`)
  return {
    list: result.sheetTitle,           // shows as "Connected — found {sheetTitle}"
    serviceAccount: result.serviceAccount,
    availableTabs: result.availableTabs,
  };
}
async function verifyEmail() { return { note: 'Email destination test not yet implemented' }; }

const VERIFIERS = {
  'mailchimp':        verifyMailchimp,
  'brevo':            verifyBrevo,
  'mailerlite':       verifyMailerlite,
  'klaviyo':          verifyKlaviyo,
  'constant-contact': verifyConstantContact,
  'webhook':          verifyWebhook,
  'google-sheets':    verifyGoogleSheets,
  'email':            verifyEmail,
};

function withTimeout(promise) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Request timed out')), TIMEOUT_MS);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// ── Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user;

  if (!applyRateLimit(res, `routing-test:${user.email}`, { max: 30, windowMs: 60_000 })) return;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid request' });

  const destination = String(body.destination || '').trim().toLowerCase();
  const verifier = VERIFIERS[destination];
  if (!verifier) return res.status(400).json({ error: `Unknown destination "${destination}"` });

  try {
    const result = await verifier(body.credentials || {}, body.config || {});
    return res.status(200).json({ ok: true, destination, ...result });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      destination,
      error: (err && err.message) || 'Verification failed',
    });
  }
}
