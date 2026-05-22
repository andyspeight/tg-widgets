// =============================================================================
//  /api/routing-configs.js
// =============================================================================
//
//  CRUD endpoint for RoutingConfig records — the per-widget destination
//  configurations that tell the routing pipeline where to send each lead.
//
//  Authenticated. Scoped by the user's clientEmail so a Travelgenix client
//  can only see/edit their own routing configs, not anyone else's.
//
//  Endpoints (all on this single handler, dispatched by req.method + body.op):
//    GET    ?widgetId=recXXX           → list configs for a widget
//    POST   { op: "create", ... }       → create a new RoutingConfig
//    POST   { op: "update", id, ... }   → update an existing RoutingConfig
//    POST   { op: "delete", id }        → delete a RoutingConfig
//
//  Why one endpoint instead of REST routes? Vercel's routing makes path-
//  parameter routes (DELETE /api/routing-configs/:id) require a separate
//  file or a rewrites rule. Cleaner to dispatch on op for now.
//
//  Credentials handling — CRITICAL:
//    - Browser sends plaintext credentials over HTTPS (e.g. Mailchimp API key).
//    - Server encrypts via pat-crypt (AES-256-GCM) before writing to Airtable.
//    - On read, credentials are NEVER returned to the browser. The list endpoint
//      returns a redacted form like { hasCredentials: true } so the UI can show
//      "credentials configured" without ever decrypting.
//    - To replace credentials, the user submits a fresh plaintext value.
//
// =============================================================================

import { requireAuth, setCors, applyRateLimit, RATE_LIMITS, sanitiseForFormula } from './_auth.js';
import { encryptPat } from './_lib/routing/pat-crypt.js';
import { getRecord } from './_lib/auth/airtable.js';
import { USERS } from './_lib/auth/schema.js';

const ENQUIRIES_BASE_ID = process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID;
const ENQUIRIES_PAT = process.env.TG_ENQUIRIES_AIRTABLE_PAT;
const WIDGETS_BASE_ID = process.env.AIRTABLE_BASE_ID;
const WIDGETS_PAT = process.env.AIRTABLE_KEY;

const ROUTING_CONFIG_TABLE_ID = 'tblZO9mRFpD1eMcKx';
const WIDGETS_TABLE_ID = 'tblVAThVqAjqtria2';

// Cookie/SSO sessions issue a JWT that carries userId but NOT email.
// Every ownership check here compares the widget's ClientEmail against
// user.email, so a missing email makes every check fail with
// "Widget not found or not yours". This resolves the email from the USERS
// record when the session didn't carry it — mirroring the hydration that
// widget-config.js already does. Returns nothing; mutates user in place.
async function hydrateUserEmail(user) {
  if (!user || user.email || !user.recordId) return;
  try {
    const u = await getRecord(USERS.tableId, user.recordId);
    const email = u?.fields?.[USERS.fields.email];
    if (typeof email === 'string' && email.trim()) {
      user.email = email.trim();
    }
  } catch (err) {
    console.warn('[routing-configs] email hydration failed:', err.message);
  }
}

// Field IDs from the live RoutingConfig table
const F = {
  name:           'flddEbJI8dRIjjO9p',
  widgetType:     'flduxQu6qlFU1GJhI',
  widgetRecordId: 'fldvhIuUMZ8wfKMN8',
  clientName:     'fldZxnhYrf6UY89Zg',
  clientEmail:    'fldqQA8EwGXA4gnIA',
  destination:    'fld7CL01oCQWcal3U',
  enabled:        'fldTzl9alTonLX7k4',
  testMode:       'fldfwrXvimwCFeRXQ',
  configJson:     'fld9z6pPdhXwm7tun',
  credentialsEnc: 'fldmbEIDSs9XFPosT',
  lastVerifiedAt:     'fldB6r6bFUM3EMPYT',
  lastVerifiedStatus: 'fld8CBagHhBcWDEiI',
  lastVerifiedError:  'fldnUrF7Gbq9fSbea',
  lastUsedAt:         'fldZOVXwrLvWe3Sbp',
  lastErrorAt:        'fldWaYy78qqbBDH2Y',
  lastErrorMessage:   'fldM93ZFZvwrkHhna',
};

// Allowlist of destination keys the editor may submit
const ALLOWED_DESTINATIONS = [
  'mailchimp', 'brevo', 'mailerlite', 'klaviyo', 'constant-contact',
  'webhook', 'google-sheets', 'email',
];

// Map widget canonical key → Airtable singleSelect display name
const WIDGET_DISPLAY_NAMES = {
  'newsletter':           'Newsletter Signup',
  'enquiry-form':         'Enquiry Form',
  'popup':                'Popup',
  'brochure':             'Brochure Library',
  'quiz':                 'Quiz',
  'calculator':           'Calculator',
  'booking-confirmation': 'Booking Confirmation',
};

// ── Helpers ─────────────────────────────────────────────────────────────

function airtableUrl(tableId, recordId, query) {
  let u = `https://api.airtable.com/v0/${ENQUIRIES_BASE_ID}/${tableId}`;
  if (recordId) u += `/${recordId}`;
  if (query) u += `?${query}`;
  return u;
}

async function airtableRequest(method, tableId, body, recordId, query) {
  // CRITICAL: publicShape() reads record.fields by FIELD ID (e.g. fld7CL01...).
  // By default the Airtable API returns fields keyed by field NAME, which would
  // make every publicShape read undefined (blank name, blank destination, OFF).
  // returnFieldsByFieldId=true makes responses keyed by ID for both reads and
  // the create/update echo. Applied centrally so no call site can forget it.
  let q = query || '';
  if (!/returnFieldsByFieldId=/.test(q)) {
    q += (q ? '&' : '') + 'returnFieldsByFieldId=true';
  }
  // For writes, the flag must also be in the body so the echoed record (which
  // we pass straight to publicShape) is keyed by ID.
  let outBody = body;
  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    outBody = { ...body, returnFieldsByFieldId: true };
  }

  const resp = await fetch(airtableUrl(tableId, recordId, q), {
    method,
    headers: {
      'Authorization': `Bearer ${ENQUIRIES_PAT}`,
      'Content-Type': 'application/json',
    },
    body: outBody ? JSON.stringify(outBody) : undefined,
  });
  const txt = await resp.text();
  if (!resp.ok) {
    throw new Error(`Airtable ${resp.status}: ${txt.slice(0, 200)}`);
  }
  try { return JSON.parse(txt); } catch { return null; }
}

// Look up a widget by record ID and verify it belongs to this user
async function verifyWidgetOwnership(widgetRecordId, userEmail) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(widgetRecordId)) return null;
  try {
    const url = `https://api.airtable.com/v0/${WIDGETS_BASE_ID}/${WIDGETS_TABLE_ID}/${widgetRecordId}`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${WIDGETS_PAT}` } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const fields = data.fields || {};
    const clientEmail = String(fields['ClientEmail'] || fields['Client Email'] || '').toLowerCase();
    if (clientEmail !== userEmail.toLowerCase()) return null;
    return {
      recordId: data.id,
      clientEmail,
      clientName: fields['ClientName'] || fields['Client Name'] || fields['Client'] || '',
      widgetType: fields['WidgetType'] || fields['Widget Type'] || '',
    };
  } catch (err) {
    console.error('[routing-configs] widget lookup failed:', err.message);
    return null;
  }
}

// Sanitise + validate the config JSON (keep it small, no nested junk)
function sanitiseConfig(c) {
  if (!c || typeof c !== 'object') return {};
  // Cap at 8KB serialised
  let s = JSON.stringify(c);
  if (s.length > 8192) s = s.slice(0, 8192);
  try { return JSON.parse(s); } catch { return {}; }
}

function sanitiseCredentials(creds) {
  if (!creds || typeof creds !== 'object') return null;
  // Strip obviously bogus / oversized values
  const out = {};
  for (const [k, v] of Object.entries(creds)) {
    if (typeof k !== 'string' || k.length > 100) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.length > 4096) out[k] = v.slice(0, 4096);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    // Allow simple object credentials (e.g. CC's structured token blob)
    else if (typeof v === 'object' && JSON.stringify(v).length < 4096) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// ── Public read shape ───────────────────────────────────────────────────
// Strip credentials from records before returning to the browser
function publicShape(rec) {
  const f = rec.fields || {};
  let parsedConfig = {};
  try { parsedConfig = JSON.parse(f[F.configJson] || '{}'); } catch {}
  return {
    id: rec.id,
    name: f[F.name] || '',
    widgetType: f[F.widgetType] || '',
    widgetRecordId: f[F.widgetRecordId] || '',
    destination: f[F.destination] || '',
    enabled: !!f[F.enabled],
    testMode: !!f[F.testMode],
    config: parsedConfig,
    hasCredentials: !!(f[F.credentialsEnc] && String(f[F.credentialsEnc]).length > 10),
    lastVerifiedAt: f[F.lastVerifiedAt] || null,
    lastVerifiedStatus: f[F.lastVerifiedStatus] || null,
    lastVerifiedError: f[F.lastVerifiedError] || null,
    lastUsedAt: f[F.lastUsedAt] || null,
    lastErrorAt: f[F.lastErrorAt] || null,
    lastErrorMessage: f[F.lastErrorMessage] || null,
  };
}

// ── Operations ──────────────────────────────────────────────────────────

async function listForWidget(widgetRecordId, userEmail) {
  const widget = await verifyWidgetOwnership(widgetRecordId, userEmail);
  if (!widget) return { error: 'Widget not found or not yours', status: 404 };

  const safe = widgetRecordId.replace(/[^a-zA-Z0-9]/g, '');
  const safeEmail = sanitiseForFormula(userEmail.toLowerCase());
  const formula = encodeURIComponent(`AND({${F.widgetRecordId}} = "${safe}", LOWER({${F.clientEmail}}) = "${safeEmail}")`);
  const data = await airtableRequest('GET', ROUTING_CONFIG_TABLE_ID, null, null, `filterByFormula=${formula}&pageSize=50`);
  const records = (data && data.records) || [];
  return { configs: records.map(publicShape) };
}

async function createConfig(body, user) {
  const widgetRecordId = String(body.widgetRecordId || '');
  const widget = await verifyWidgetOwnership(widgetRecordId, user.email);
  if (!widget) return { error: 'Widget not found or not yours', status: 404 };

  const destination = String(body.destination || '').trim().toLowerCase();
  if (!ALLOWED_DESTINATIONS.includes(destination)) {
    return { error: `Unknown destination "${destination}"`, status: 400 };
  }

  const name = String(body.name || '').slice(0, 200) || `${destination} for ${widget.clientName || 'widget'}`;
  const config = sanitiseConfig(body.config);
  const credentials = sanitiseCredentials(body.credentials);

  // Encrypt credentials before storing
  let credentialsEnc = '';
  if (credentials) {
    try { credentialsEnc = encryptPat(JSON.stringify(credentials)); }
    catch (err) {
      console.error('[routing-configs] credential encryption failed:', err.message);
      return { error: 'Server credential storage unavailable', status: 500 };
    }
  }

  // Build the record. widgetType is the canonical short key (e.g. "newsletter")
  // mapped to its Airtable display name.
  const widgetTypeKey = String(body.widgetType || 'newsletter').trim();
  const widgetTypeDisplay = WIDGET_DISPLAY_NAMES[widgetTypeKey] || widgetTypeKey;

  const fields = {
    [F.name]: name,
    [F.widgetType]: widgetTypeDisplay,
    [F.widgetRecordId]: widget.recordId,
    [F.clientName]: widget.clientName || '',
    [F.clientEmail]: user.email.toLowerCase(),
    [F.destination]: destination,
    [F.enabled]: body.enabled !== false,
    [F.testMode]: !!body.testMode,
    [F.configJson]: JSON.stringify(config),
  };
  if (credentialsEnc) fields[F.credentialsEnc] = credentialsEnc;

  const result = await airtableRequest('POST', ROUTING_CONFIG_TABLE_ID, {
    records: [{ fields }],
    typecast: true,
  });
  const created = result && result.records && result.records[0];
  if (!created) return { error: 'Failed to create config', status: 500 };

  return { config: publicShape(created), status: 201 };
}

async function updateConfig(body, user) {
  const id = String(body.id || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return { error: 'Invalid config ID', status: 400 };

  // Verify the existing record belongs to this user
  let existing;
  try {
    existing = await airtableRequest('GET', ROUTING_CONFIG_TABLE_ID, null, id);
  } catch (err) {
    return { error: 'Config not found', status: 404 };
  }
  const existingEmail = String((existing.fields || {})[F.clientEmail] || '').toLowerCase();
  if (existingEmail !== user.email.toLowerCase()) {
    return { error: 'Config not yours', status: 403 };
  }

  const fields = {};

  // Allow updating: name, enabled, testMode, config, credentials
  if (typeof body.name === 'string') fields[F.name] = body.name.slice(0, 200);
  if (typeof body.enabled === 'boolean') fields[F.enabled] = body.enabled;
  if (typeof body.testMode === 'boolean') fields[F.testMode] = body.testMode;
  if (body.config !== undefined) fields[F.configJson] = JSON.stringify(sanitiseConfig(body.config));

  // Credentials only updated if a new value was sent. Empty/missing means
  // "leave the existing credentials alone".
  if (body.credentials) {
    const creds = sanitiseCredentials(body.credentials);
    if (creds) {
      try {
        fields[F.credentialsEnc] = encryptPat(JSON.stringify(creds));
      } catch (err) {
        console.error('[routing-configs] credential encryption failed:', err.message);
        return { error: 'Server credential storage unavailable', status: 500 };
      }
    }
  }

  if (Object.keys(fields).length === 0) {
    return { config: publicShape(existing) };  // nothing to do
  }

  const result = await airtableRequest('PATCH', ROUTING_CONFIG_TABLE_ID, {
    records: [{ id, fields }],
    typecast: true,
  });
  const updated = result && result.records && result.records[0];
  if (!updated) return { error: 'Failed to update config', status: 500 };

  return { config: publicShape(updated) };
}

async function deleteConfig(body, user) {
  const id = String(body.id || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return { error: 'Invalid config ID', status: 400 };

  // Verify ownership before delete
  let existing;
  try {
    existing = await airtableRequest('GET', ROUTING_CONFIG_TABLE_ID, null, id);
  } catch (err) {
    return { error: 'Config not found', status: 404 };
  }
  const existingEmail = String((existing.fields || {})[F.clientEmail] || '').toLowerCase();
  if (existingEmail !== user.email.toLowerCase()) {
    return { error: 'Config not yours', status: 403 };
  }

  await airtableRequest('DELETE', ROUTING_CONFIG_TABLE_ID, null, id);
  return { ok: true, deleted: id };
}

// ── Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!ENQUIRIES_BASE_ID || !ENQUIRIES_PAT) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Auth
  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user;

  // Cookie/SSO sessions don't carry email in the JWT — resolve it now so the
  // ownership checks (which match on ClientEmail) and the per-user rate limit
  // work. Without this, every operation fails "Widget not found or not yours".
  await hydrateUserEmail(user);
  if (!user.email) {
    return res.status(401).json({ error: 'Could not resolve your account email. Please sign in again.' });
  }

  // Per-user rate limit
  if (!applyRateLimit(res, `routing-configs:${user.email}`, RATE_LIMITS.widgetWrite || { max: 60, windowMs: 60_000 })) return;

  try {
    if (req.method === 'GET') {
      const widgetId = String(req.query?.widgetId || '');
      if (!widgetId) return res.status(400).json({ error: 'widgetId required' });
      const result = await listForWidget(widgetId, user.email);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
      }
      if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid request' });

      const op = String(body.op || '').toLowerCase();
      let result;
      if (op === 'create')      result = await createConfig(body, user);
      else if (op === 'update') result = await updateConfig(body, user);
      else if (op === 'delete') result = await deleteConfig(body, user);
      else return res.status(400).json({ error: 'Unknown op (expected: create|update|delete)' });

      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      return res.status(result.status || 200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[routing-configs] crashed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
