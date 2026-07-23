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
import { lpushCapped, configured as redisConfigured } from '../_redis.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const IP_SALT = process.env.TELEMETRY_IP_SALT || 'tg-widgets-telemetry-v1';
const INSERT_TIMEOUT_MS = 1500;

// Fallback sink: until the Supabase env vars are set, we keep a capped rolling
// buffer of recent events in the Upstash Redis that's ALREADY provisioned, so
// the traffic dashboard has something to show. This was only ever a stopgap,
// but with the Supabase vars never set it became the LIVE sink and — writing
// lpush+ltrim to one hot key on every request to the three busiest public
// endpoints — overwhelmed Upstash (2,900+ operation-timeout errors, 17-23 Jul
// 2026), which held functions open and starved the cache reads on the same
// instance, surfacing to visitors as "Failed to fetch" / "Unexpected end of
// JSON input". The fallback is now deliberately CHEAP and SELF-THROTTLING:
//   - sample: write only 1-in-N events (per instance) so one key isn't hammered
//   - single bounded pipeline write (lpushCapped), not two serial round-trips
//   - trim only occasionally (the cap is a ceiling, not a per-write invariant)
//   - circuit-breaker: after a failed/timed-out write, stop writing for a
//     cooldown so a struggling Upstash is never fed harder by our telemetry.
// The real cure is setting SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, which
// routes telemetry to Supabase (its own 1.5s-bounded insert) and off Redis.
export const REDIS_BUFFER_KEY = 'widget:events:recent:v1';
const REDIS_BUFFER_CAP = 800;
// 1-in-N sampling for the Redis fallback. Env-tunable: raise it to shed more
// load, set to 1 to record every event once Upstash has headroom again.
const REDIS_SAMPLE = Math.max(1, parseInt(process.env.TELEMETRY_REDIS_SAMPLE || '5', 10) || 5);
// Trim the buffer roughly every this-many actual writes (not every request).
const REDIS_TRIM_EVERY = 40;
// After a failed/timed-out write, skip the Redis buffer for this long.
const REDIS_COOLDOWN_MS = 60 * 1000;
let _redisSeq = 0;          // per-instance request counter (drives sampling)
let _redisWrites = 0;       // per-instance successful-write counter (drives trim)
let _redisCooldownUntil = 0;

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
    widget_type: str(fields.widgetType, 60),
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
 * Log one telemetry row. Fire-and-forget semantics: never throws, bounded by a
 * short timeout. Call it AFTER sending the HTTP response.
 *
 * Primary sink is Supabase. When Supabase isn't configured yet, we fall back to
 * a capped Redis rolling buffer so the dashboard still has recent data — this
 * is the stopgap that lets traffic be watched before the Supabase env vars land.
 */
export async function logWidgetEvent(req, fields = {}) {
  const row = buildEvent(req, fields);
  if (telemetryConfigured()) {
    await insertSupabase(row);
    return;
  }
  await pushRedisBuffer(row);
}

async function insertSupabase(row) {
  let ctrl;
  let timer;
  try {
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

async function pushRedisBuffer(row) {
  if (!redisConfigured()) return;
  // Circuit-breaker: if a recent write failed/timed out, Upstash is under
  // pressure — do not add to it. Self-heals after the cooldown.
  if (Date.now() < _redisCooldownUntil) return;
  // Sample: only 1-in-N events reach Redis, so a single hot key is not written
  // on every request across the three busiest endpoints.
  if ((++_redisSeq % REDIS_SAMPLE) !== 0) return;
  try {
    // Store ts as an ISO string so the dashboard can filter by window.
    const entry = { ...row, ts: new Date().toISOString() };
    // Trim only occasionally — the cap is a ceiling, so an exact trim on every
    // write is wasted work (and a second round-trip). One bounded pipeline call.
    const includeTrim = (_redisWrites % REDIS_TRIM_EVERY) === 0;
    const ok = await lpushCapped(REDIS_BUFFER_KEY, JSON.stringify(entry), REDIS_BUFFER_CAP, includeTrim);
    if (ok) _redisWrites++;
    else _redisCooldownUntil = Date.now() + REDIS_COOLDOWN_MS;
  } catch (e) {
    _redisCooldownUntil = Date.now() + REDIS_COOLDOWN_MS;
    console.warn('[telemetry] redis buffer push failed', e && e.message);
  }
}
