/**
 * Travelgenix Widget Suite — Shared Travelify helpers
 *
 * Single source of truth for the bits that the My Booking endpoints all need:
 *   - widgetId → owning client → Travelify credentials  (resolveWidgetCredentials)
 *   - POST /account/order to fetch a raw order            (fetchTravelifyOrderRaw)
 *   - input validation + rate limiting + client IP        (shared utilities)
 *
 * This was lifted VERBATIM out of api/retrieve-order.js (v1.4.1) so behaviour
 * is byte-identical. retrieve-order.js and the new cancel-product.js both
 * import from here, killing the duplication the codebase already flagged as a
 * post-show TODO. The credential lookups themselves still live in _auth.js —
 * this module only orchestrates them.
 *
 * SECURITY:
 *   - Travelify credentials never leave the server.
 *   - Callers must NEVER log apiKey — only a masked preview if needed.
 */

import {
  sanitiseForFormula,
  lookupClientCredentialsByEmail,
  lookupClientCredentialsByRecordId,
} from '../_auth.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';

// Widgets table fields
const WF = {
  WidgetID: 'fldXkwI3mmSrKeY9N',
  ClientEmail: 'fldppykJf1w4YvFNC',
};

export const TRAVELIFY_ORDER_API = 'https://api.travelify.io/account/order';

// Travelify requires an Origin header on server-to-server calls or it silently
// 401s with "Missing or invalid application credentials". This is the product
// origin we present on every Travelify call.
export const TRAVELIFY_ORIGIN = 'https://www.travelgenix.io';

// ----- Demo bypass -----
// When widgetId === DEMO_WIDGET_SENTINEL, skip the Airtable widget lookup and
// use the published Travelgenix demo Travelify credentials (App 250). Demo
// credentials are published in Travelify's own docs so it is safe to ship them.
export const DEMO_WIDGET_SENTINEL = 'DEMO_WIDGET_ID';
const DEMO_APP_ID = '250';
const DEMO_PUBLIC_KEY = 'A41D180E-CBFE-4E30-A47D-FAAB424A650D';

// ----- Rate limiting (in-memory, same pattern as _auth.js) -----

const rateLimitStore = new Map(); // key -> { count, resetAt }
const RL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function rateLimit(key, max) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // Cleanup expired entries periodically
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.resetAt < now) rateLimitStore.delete(k);
    }
  }

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true, remaining: max - 1 };
  }
  if (entry.count >= max) {
    return { ok: false, remaining: 0, retryAfterMs: entry.resetAt - now };
  }
  entry.count++;
  return { ok: true, remaining: max - entry.count };
}

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// ----- Validation -----

export function validateEmail(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  if (v.length < 5 || v.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

export function validateDate(s) {
  if (typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const yr = parseInt(s.slice(0, 4), 10);
  if (yr < 2020 || yr > 2050) return null;
  return s;
}

export function validateOrderRef(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toUpperCase();
  if (!/^[A-Z0-9_\-]{3,40}$/.test(v)) return null;
  return v;
}

export function validateWidgetId(s) {
  if (typeof s !== 'string') return null;
  // Widget IDs follow tgw_{ts}_{rand}; demo sentinel is allowed too.
  if (!/^[a-zA-Z0-9_\-]{8,80}$/.test(s)) return null;
  return s;
}

// productId is an item.id — Travelify item ids are positive integers.
export function validateProductId(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1e12) {
    return String(v);
  }
  if (typeof v === 'string' && /^\d{1,12}$/.test(v.trim())) {
    return v.trim();
  }
  return null;
}

// ----- Airtable helpers -----

function airtableHeaders() {
  const key = process.env.AIRTABLE_KEY;
  if (!key) throw new Error('AIRTABLE_KEY env var missing');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function findWidgetById(widgetId) {
  const safe = sanitiseForFormula(widgetId);
  const formula = `{WidgetID}='${safe}'`;
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${WIDGETS_TABLE}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('maxRecords', '1');

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) throw new Error(`Widget lookup failed: ${res.status}`);
  const data = await res.json();
  return data.records?.[0] || null;
}

// ----- User → Client resolver -----
// Widgets store ClientEmail = the email of the USER who created the widget,
// but Travelify credentials live on the parent CLIENT record. This walks the
// user→client link to find the parent client's canonical email.
const USERS_TABLE = 'tblIpeQeZmF7CM7OJ';
const CLIENTS_TABLE = 'tblikekpaTKraMktZ';
const UF_email  = 'fldSQLKBfsAcVS2s3';
const UF_client = 'fldyXVZjZKUjlYCm6';
const CF_email  = 'fldVRiIAlrTjxnNHP';
const UF_email_NAME = 'Email';
const CF_email_NAME = 'Email';

async function resolveUserToClientEmail(userEmail) {
  if (!userEmail) return null;
  const safe = sanitiseForFormula(userEmail.toLowerCase());

  const userUrl = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${USERS_TABLE}`);
  userUrl.searchParams.set('filterByFormula', `LOWER({${UF_email_NAME}})='${safe}'`);
  userUrl.searchParams.set('maxRecords', '1');
  userUrl.searchParams.set('returnFieldsByFieldId', 'true');
  userUrl.searchParams.append('fields[]', UF_client);
  userUrl.searchParams.append('fields[]', UF_email);

  const userRes = await fetch(userUrl.toString(), { headers: airtableHeaders() });
  if (!userRes.ok) throw new Error(`User lookup failed: ${userRes.status}`);
  const userData = await userRes.json();
  const user = userData.records?.[0];
  if (!user) return null;

  const clientLinks = user.fields?.[UF_client];
  const clientId = Array.isArray(clientLinks) ? (clientLinks[0]?.id || clientLinks[0]) : null;
  if (!clientId) return null;

  const clientUrl = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}/${clientId}`);
  clientUrl.searchParams.set('returnFieldsByFieldId', 'true');
  const clientRes = await fetch(clientUrl.toString(), { headers: airtableHeaders() });
  if (!clientRes.ok) throw new Error(`Client lookup failed: ${clientRes.status}`);
  const clientRec = await clientRes.json();
  const clientEmail = clientRec.fields?.[CF_email];
  if (!clientEmail || typeof clientEmail !== 'string') return null;
  return clientEmail.toLowerCase().trim();
}

// Legacy fallback: direct Clients table lookup (pre-May 2026 widgets).
async function findClientEmailDirect(possibleClientEmail) {
  if (!possibleClientEmail) return null;
  const safe = sanitiseForFormula(possibleClientEmail.toLowerCase());

  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}`);
  url.searchParams.set('filterByFormula', `LOWER({${CF_email_NAME}})='${safe}'`);
  url.searchParams.set('maxRecords', '1');
  url.searchParams.set('returnFieldsByFieldId', 'true');
  url.searchParams.append('fields[]', CF_email);

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) throw new Error(`Client direct lookup failed: ${res.status}`);
  const data = await res.json();
  const rec = data.records?.[0];
  if (!rec) return null;

  const email = rec.fields?.[CF_email];
  if (!email || typeof email !== 'string') return null;
  return email.toLowerCase().trim();
}

async function resolveWidgetEmailToClientEmail(widgetClientEmail) {
  const viaUser = await resolveUserToClientEmail(widgetClientEmail);
  if (viaUser) return viaUser;
  return await findClientEmailDirect(widgetClientEmail);
}

// ----- Public: widget → Travelify credentials -----
//
// Resolves a widgetId to the owning client's Travelify { appId, apiKey }.
// Returns null on ANY failure (unknown widget, wrong type, inactive, no creds,
// orphaned email) so callers can degrade to a generic response without
// leaking which step failed. Demo sentinel returns the published demo creds.
//
// `expectType` (default 'My Booking') guards against a widgetId of the wrong
// type being used to drive a booking call.
export async function resolveWidgetCredentials(widgetId, expectType = 'My Booking') {
  if (widgetId === DEMO_WIDGET_SENTINEL) {
    return { appId: DEMO_APP_ID, apiKey: DEMO_PUBLIC_KEY, isDemo: true };
  }

  let widget;
  try {
    widget = await findWidgetById(widgetId);
  } catch (err) {
    console.error('[travelify] widget lookup failed for', widgetId, '—', err.message);
    return null;
  }
  if (!widget) return null;

  const widgetType = widget.fields?.WidgetType;
  if (expectType && widgetType !== expectType) return null;

  const widgetStatus = widget.fields?.Status;
  if (widgetStatus && widgetStatus !== 'Active' && widgetStatus !== 'Draft') {
    return null;
  }

  const ownerRecordId = (widget.fields?.ClientRecordId || '').trim();
  const clientEmail = (widget.fields?.ClientEmail || '').toLowerCase().trim();
  if (!ownerRecordId && !clientEmail) return null;

  // Primary: unambiguous owning-client record id captured at save.
  // Fallback: legacy email-based resolution (user→client link, then direct).
  let creds;
  try {
    if (ownerRecordId) {
      creds = await lookupClientCredentialsByRecordId(ownerRecordId);
    }
    if (!creds && clientEmail) {
      const resolvedClientEmail = await resolveWidgetEmailToClientEmail(clientEmail);
      if (!resolvedClientEmail) {
        console.warn(`[travelify] no parent client for widget ClientEmail (widgetId=${widgetId})`);
        return null;
      }
      creds = await lookupClientCredentialsByEmail(resolvedClientEmail);
    }
  } catch (err) {
    console.error('[travelify] credential resolution failed for',
      ownerRecordId || clientEmail, '—', err.message);
    return null;
  }

  if (!creds || !creds.appId || !creds.apiKey) {
    console.warn(`[travelify] no Travelify credentials resolved for widgetId=${widgetId}`);
    return null;
  }

  return { appId: creds.appId, apiKey: creds.apiKey, isDemo: false };
}

// ----- Public: fetch a raw order from Travelify -----
//
// POSTs the lookup triplet to /account/order with Token auth + Origin header.
// Returns the parsed raw order object, or null on 404 / error / timeout.
// The raw object is what carries both the order id and the per-order key that
// the cancellation API needs — neither is exposed to the browser by callers.
export async function fetchTravelifyOrderRaw({ appId, apiKey }, { emailAddress, departDate, orderRef }) {
  let res;
  try {
    res = await fetch(TRAVELIFY_ORDER_API, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${appId}:${apiKey}`,
        'Content-Type': 'application/json',
        'Origin': TRAVELIFY_ORIGIN,
      },
      body: JSON.stringify({ emailAddress, departDate, orderRef }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error('[travelify] order fetch network error:', err.message);
    return null;
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`[travelify] order fetch returned ${res.status}`);
    return null;
  }

  let raw;
  try {
    raw = await res.json();
  } catch {
    return null;
  }

  // Travelify's documented 404 shape is { code: '404', message: ... }
  if (raw && (raw.code === '404' || raw.code === 404)) return null;
  if (!raw || typeof raw !== 'object' || raw.id == null) return null;

  return raw;
}

// ----- Public: read the per-order security key from a raw order -----
//
// The exact field name carrying the order key in the /account/order response
// has not been confirmed against a live payload. Travelify pairs id+key on its
// quote objects (data.id / data.key), so `key` is the most likely name; we
// also accept the obvious alternatives. Returns the key string or null.
export function readOrderKey(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw.key
    || raw.orderKey
    || raw.securityKey
    || raw.orderSecurityKey
    || raw.orderKeyValue
    || null;
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  return candidate.trim();
}
