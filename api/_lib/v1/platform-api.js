/**
 * Shared plumbing for the Travelify platform endpoints under /api/v1/.
 *
 * Travelify's backend calls these server to server to merge our widgets into
 * its own Widget Directory and My Widgets pages. The contract (14 Sep 2026) is
 * in docs/travelify-widget-integration.md. Everything here is the part that is
 * identical across both endpoints: shared-key auth, the error envelope, the
 * Application ID lookup, caching and the audit log line.
 *
 * Auth model: ONE shared secret, not per user and not per application. Once
 * the key validates the caller is trusted to ask about any Application ID, so
 * the only remaining check is that the application actually exists. The key
 * never reaches a browser — these endpoints are backend to backend.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { listRecords } from '../auth/airtable.js';
import { CLIENTS } from '../auth/schema.js';
import { checkRateLimit } from '../../_auth.js';

/** Field NAME (not id) for formulas — a field id in braces matches nothing. */
const APP_ID_FIELD = 'Travelify App ID';

/** Env var holding the shared secret agreed with Travelify. */
export const API_KEY_ENV = 'TRAVELIFY_PLATFORM_API_KEY';

/** Generous: Travelify calls these on page load for its whole customer base. */
export const PLATFORM_RATE_LIMIT = { max: 600, windowMs: 15 * 60 * 1000 };

/**
 * The spec's error body. One shape for every failure, no partial widget data
 * alongside it, and never an internal identifier or a stack trace in message.
 */
export function sendError(res, status, code, message) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error: { code, message } });
}

/** Constant-time secret comparison that tolerates unequal lengths. */
function secretsMatch(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Gate a request: HTTPS, shared key, method, rate limit.
 *
 * Returns true when the caller may proceed. On refusal it has already written
 * the response, so callers just return.
 */
export function guardRequest(req, res, { endpoint }) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    logCall({ endpoint, applicationId: null, outcome: 'method_not_allowed' });
    return sendError(res, 405, 'method_not_allowed', 'Only GET is supported.');
  }

  // Vercel terminates TLS and forwards the original scheme. Plain HTTP is
  // redirected upstream in practice, so this is defence in depth rather than
  // the primary control.
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto && proto !== 'https') {
    logCall({ endpoint, applicationId: null, outcome: 'https_required' });
    return sendError(res, 400, 'https_required', 'This endpoint is available over HTTPS only.');
  }

  const expected = process.env[API_KEY_ENV] || '';
  if (!expected) {
    // Refuse rather than fall open if the secret was never configured.
    console.error(`[v1] ${API_KEY_ENV} is not configured — refusing every request`);
    logCall({ endpoint, applicationId: null, outcome: 'not_configured' });
    return sendError(res, 500, 'server_error', 'The service is not available.');
  }

  const supplied = req.headers['x-api-key'];
  const key = Array.isArray(supplied) ? supplied[0] : supplied;
  if (typeof key !== 'string' || !key.trim() || !secretsMatch(key.trim(), expected)) {
    logCall({ endpoint, applicationId: null, outcome: 'unauthorised' });
    return sendError(res, 401, 'invalid_api_key', 'A valid API key is required.');
  }

  // Keyed on the secret's fingerprint, never the secret itself.
  const bucket = 'v1:' + createHash('sha256').update(key.trim()).digest('hex').slice(0, 16);
  const limit = checkRateLimit(bucket, PLATFORM_RATE_LIMIT);
  res.setHeader('X-RateLimit-Limit', PLATFORM_RATE_LIMIT.max);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, limit.remaining));
  if (!limit.allowed) {
    res.setHeader('Retry-After', limit.retryAfter);
    logCall({ endpoint, applicationId: null, outcome: 'rate_limited' });
    return sendError(res, 429, 'rate_limited', 'Too many requests. Please retry shortly.');
  }

  return true;
}

/**
 * Validate the Application ID path parameter.
 *
 * Integer only, which is what Travelify sends and what CLIENTS.travelifyAppId
 * is validated as everywhere else in this codebase (1–10 digits).
 * Returns { ok: true, applicationId } or { ok: false }, having responded.
 */
export function readApplicationId(req, res, { endpoint }) {
  const raw = req.query?.applicationId;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const str = typeof value === 'string' ? value.trim() : '';

  if (!/^\d{1,10}$/.test(str)) {
    logCall({ endpoint, applicationId: str || null, outcome: 'bad_application_id' });
    sendError(res, 400, 'invalid_application_id', 'Application ID must be an integer.');
    return { ok: false };
  }
  return { ok: true, applicationId: Number(str), applicationIdRaw: str };
}

/**
 * Find the client behind an Application ID.
 *
 * A client row is created the first time someone signs into the widget
 * platform through SSO, so an application Travelify knows about but that has
 * never signed in here legitimately has no row. That is a 404, and Travelify
 * treats it as "not set up yet" and shows its existing More Tools SSO link.
 *
 * Returns the Airtable record, or null.
 */
export async function findClientByApplicationId(applicationIdRaw) {
  // Match whether the column is stored as a number or as text: the admin
  // console writes it as a string, the older lookup path compares it as a
  // numeric literal, and a mismatch here would 404 a real client.
  const formula = `OR({${APP_ID_FIELD}}=${applicationIdRaw},{${APP_ID_FIELD}}&''='${applicationIdRaw}')`;
  const rows = await listRecords(CLIENTS.tableId, { formula, maxRecords: 1 });
  return rows && rows.length ? rows[0] : null;
}

/** Absolute HTTPS origin for image URLs. Never return a relative path. */
export function publicOrigin(req) {
  const configured = (process.env.TG_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `https://${host}` : 'https://tg-widgets.vercel.app';
}

/**
 * Send a JSON body with an ETag, answering 304 when the caller already has it.
 *
 * The directory is close to static per application, so Travelify can cache it.
 * My Widgets changes whenever someone adds a widget, so that endpoint passes a
 * conservative cacheControl instead.
 */
export function sendJson(req, res, body, { cacheControl }) {
  const payload = JSON.stringify(body);
  const etag = '"' + createHash('sha256').update(payload).digest('hex').slice(0, 32) + '"';

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const inm = req.headers['if-none-match'];
  if (typeof inm === 'string' && inm.split(',').some((t) => t.trim() === etag)) {
    return res.status(304).end();
  }
  return res.status(200).send(payload);
}

/**
 * One line per call for support and audit: Application ID, endpoint, outcome.
 * Never the API key.
 */
export function logCall({ endpoint, applicationId, outcome, detail }) {
  const parts = [`[v1] ${endpoint}`, `app=${applicationId ?? '-'}`, `outcome=${outcome}`];
  if (detail) parts.push(detail);
  console.log(parts.join(' '));
}
