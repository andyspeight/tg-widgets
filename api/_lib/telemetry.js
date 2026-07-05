/**
 * Request telemetry sink for the public widget endpoints.
 *
 * Rows land in the Supabase `widget_events` table (Travelgenix CRM project).
 * Reads are done only by the authed admin traffic dashboard via SECURITY-
 * restricted RPCs; the table is RLS-locked so the anon key sees nothing.
 *
 * Design rules (match the brief):
 *   - NEVER add client-perceived latency. Callers send their HTTP response
 *     FIRST, then `await logWidgetEvent(...)`. The bytes are already flushed to
 *     the client, so this only extends the (billed) function lifetime — needed
 *     on Vercel's Node runtime so the insert completes before the instance is
 *     frozen. A tight AbortController timeout bounds that tail.
 *   - NEVER throw. Every path is wrapped; a logging failure must not fail the
 *     request or surface to the widget.
 *   - No PII beyond what abuse triage needs. We store the raw IP (inet, admin-
 *     only) AND a salted hash for privacy-preserving grouping.
 *
 * Required env (add in Vercel):
 *   SUPABASE_URL                — e.g. https://iexryjynfaktfbvzlwlx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — service role; server-side only, never shipped
 * Optional:
 *   TELEMETRY_IP_SALT           — salt for ip_hash (defaults to a build const)
 *   TELEMETRY_DISABLED='1'      — bypass logging entirely
 */

import { createHash } from 'crypto';
import { getRequestIp, getUserAgent } from './auth/http.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const IP_SALT = process.env.TELEMETRY_IP_SALT || 'tg-widgets-telemetry-v1';
const INSERT_TIMEOUT_MS = 1500;

export function telemetryConfigured() {
  return !!(SUPABASE_URL && SERVICE_KEY) && process.env.TELEMETRY_DISABLED !== '1';
}

function deploymentId() {
  return (
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_URL ||
    ''
  ).slice(0, 120);
}

function hashIp(ip) {
  if (!ip) return null;
  try {
    return createHash('sha256').update(IP_SALT + '|' + ip).digest('hex').slice(0, 32);
  } catch {
    return null;
  }
}

// inet columns reject anything that isn't a valid IP. Vercel's x-forwarded-for
// is normally clean, but a spoofed header could carry junk — validate loosely
// and pass null rather than let a bad value error the insert (which we swallow
// anyway, but null keeps the row useful).
function validIpOrNull(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const v4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const v6 = /^[0-9a-fA-F:]+$/;
  if (v4.test(ip) || (v6.test(ip) && ip.includes(':'))) return ip;
  return null;
}

function refererDomain(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().slice(0, 253) || null;
  } catch {
    return null;
  }
}

function str(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Build a telemetry row from the request plus caller-supplied attribution.
 * Attribution (account_name/client_id/widget_id) is whatever the endpoint has
 * already resolved for its own work — we never do an extra lookup here.
 *
 * @param {object} req
 * @param {object} fields
 * @param {string}  fields.event         offers|cached-offers|config|popup-lead
 * @param {string} [fields.widgetId]
 * @param {string} [fields.clientId]
 * @param {string} [fields.accountName]
 * @param {number} [fields.status]
 * @param {boolean}[fields.cacheHit]
 * @param {number} [fields.latencyMs]
 */
export function buildEvent(req, fields = {}) {
  const rawIp = getRequestIp(req) || '';
  const referer = req.headers?.referer || req.headers?.referrer || '';
  const origin = req.headers?.origin || '';
  const where = referer || origin;
  return {
    event: str(fields.event, 32),
    widget_id: str(fields.widgetId, 120),
    client_id: str(fields.clientId, 120),
    account_name: str(fields.accountName, 200),
    referer_domain: refererDomain(where),
    referer_url: str(where, 500),
    ip: validIpOrNull(rawIp),
    ip_hash: hashIp(rawIp),
    country: str(req.headers?.['x-vercel-ip-country'], 8),
    user_agent: getUserAgent(req),
    status: Number.isFinite(fields.status) ? fields.status : null,
    cache_hit: typeof fields.cacheHit === 'boolean' ? fields.cacheHit : null,
    latency_ms: Number.isFinite(fields.latencyMs) ? Math.round(fields.latencyMs) : null,
    deployment: deploymentId() || null,
  };
}

/**
 * Insert one telemetry row. Fire-and-forget semantics: never throws, bounded
 * by a short timeout. Call it AFTER sending the HTTP response.
 */
export async function logWidgetEvent(req, fields = {}) {
  if (!telemetryConfigured()) return;
  let ctrl;
  let timer;
  try {
    const row = buildEvent(req, fields);
    ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), INSERT_TIMEOUT_MS);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/widget_events`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[telemetry] insert non-2xx', res.status, body.slice(0, 200));
    }
  } catch (e) {
    // Includes AbortError on timeout — intentionally swallowed.
    console.warn('[telemetry] insert failed', e && e.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
