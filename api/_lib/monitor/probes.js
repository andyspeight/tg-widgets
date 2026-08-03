/**
 * Synthetic monitor probes — the "robot client".
 *
 * These exercise the REAL user-facing paths and confirm the platform's
 * dependencies are alive, so we hear about a break before a client does. Run
 * every few minutes by api/cron/monitor.js; the results feed a de-duplicated
 * alert and the /api/status view.
 *
 * Each probe returns { name, ok, detail, latencyMs }. A probe never throws — a
 * thrown probe would blind the monitor, which is the opposite of the point.
 */
import { configured as redisConfigured, setString, getString } from '../../_redis.js';

const DEMO_APP_ID = '250';

// Required production settings. A missing one silently breaks a feature — the
// Supabase telemetry keys were absent for six days unseen, which is what let the
// offers Redis storm run. Every name here is proven-used by the shipped code, so
// a "missing" result is a real gap, never a false alarm.
export const REQUIRED_ENV = [
  'AIRTABLE_KEY', 'AIRTABLE_BASE_ID', 'AIRTABLE_PAT', 'TG_ENQUIRIES_AIRTABLE_PAT',
  'ANTHROPIC_API_KEY', 'SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'CRON_SECRET',
];

// Every required setting is present. Catches the "setting never added in Vercel"
// class before a client does.
export function checkConfig() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  return {
    name: 'config',
    ok: missing.length === 0,
    detail: missing.length ? 'missing: ' + missing.join(', ') : 'all ' + REQUIRED_ENV.length + ' required settings present',
  };
}

// The offers proxy end-to-end (proxy → Travelify) with the published demo
// credentials. This is the path that has broken most, so we drive the whole
// thing. The internal-cron secret exempts it from the per-IP rate limit and the
// abuse telemetry (known infra, not a visitor).
export async function checkOffers(selfOrigin, secret) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22000);
  try {
    const res = await fetch(selfOrigin + '/api/offers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': selfOrigin + '/',
        'Origin': selfOrigin,
        ...(secret ? { 'x-tgs-internal': secret } : {}),
      },
      body: JSON.stringify({ appId: DEMO_APP_ID, type: 'Accommodation', maxOffers: 3 }),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const latencyMs = Date.now() - started;
    if (!res.ok) return { name: 'offers', ok: false, detail: 'HTTP ' + res.status, latencyMs };
    if (!data || data.success === false) return { name: 'offers', ok: false, detail: (data && data.error) || 'empty/invalid body', latencyMs };
    const n = Array.isArray(data.data) ? data.data.length : 0;
    return { name: 'offers', ok: n > 0, detail: n > 0 ? n + ' offers returned' : 'no offers returned', latencyMs };
  } catch (e) {
    return { name: 'offers', ok: false, detail: (e && e.name === 'AbortError') ? 'timed out' : (e && e.message) || 'unreachable', latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// The config endpoint EVERY widget calls. A clean 200 or 404 proves the endpoint
// is alive and Airtable was reached (404 = reached, this probe id doesn't exist);
// a 5xx or a timeout is a real problem (Airtable down / function killed).
export async function checkWidgetConfig(selfOrigin, secret) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(selfOrigin + '/api/widget-config?id=tgw_monitor_probe', {
      // Mark the probe as internal so widget-config skips telemetry for it (its
      // throwaway id 404s by design and would otherwise pollute the config error
      // counts). Exempt only when the secret matches CRON_SECRET server-side.
      headers: secret ? { 'x-tgs-internal': secret } : {},
      signal: ctrl.signal,
    });
    await res.text().catch(() => '');
    const latencyMs = Date.now() - started;
    const ok = res.status === 200 || res.status === 404;
    return { name: 'widget-config', ok, detail: 'HTTP ' + res.status, latencyMs };
  } catch (e) {
    return { name: 'widget-config', ok: false, detail: (e && e.name === 'AbortError') ? 'timed out' : (e && e.message) || 'unreachable', latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// The cache endpoint EVERY offer widget now reads. Cache-only since 30 Jul: a
// visitor's browser reaches THIS and nothing else, so it is the single most
// important read path in the product. A clean 200 with a JSON body proves the
// function is alive and the Redis read path works.
//
// This is the central backstop for the per-visitor "offer cache unreachable"
// beacon, which widget-log deliberately does NOT email — a single blocked or
// aborted request is a client-side blip, not an outage (3 Aug 2026). With that
// beacon silenced, a REAL reachability break in this endpoint has to be caught
// here instead. Reachability only: an empty pool is not a fault (checkOffers
// covers supply), and a degraded body still means the function answered — Redis
// health is checkRedis's job.
export async function checkCachedOffers(selfOrigin, secret) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(selfOrigin + '/api/cached-offers?type=Accommodation&maxOffers=1', {
      headers: secret ? { 'x-tgs-internal': secret } : {},
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const latencyMs = Date.now() - started;
    if (!res.ok) return { name: 'cached-offers', ok: false, detail: 'HTTP ' + res.status, latencyMs };
    const ok = !!(data && data.success);
    return { name: 'cached-offers', ok, detail: ok ? 'read ok' : 'empty/invalid body', latencyMs };
  } catch (e) {
    return { name: 'cached-offers', ok: false, detail: (e && e.name === 'AbortError') ? 'timed out' : (e && e.message) || 'unreachable', latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// Redis (Upstash) — the rate-limit + telemetry-fallback backbone. A write/read
// roundtrip on a throwaway key.
export async function checkRedis() {
  const started = Date.now();
  if (!redisConfigured()) return { name: 'redis', ok: false, detail: 'not configured', latencyMs: 0 };
  try {
    const val = 'm' + Date.now();
    const setOk = await setString('monitor:ping', val);
    const got = await getString('monitor:ping');
    const ok = !!setOk && got === val;
    return { name: 'redis', ok, detail: ok ? 'read-write ok' : 'roundtrip mismatch', latencyMs: Date.now() - started };
  } catch (e) {
    return { name: 'redis', ok: false, detail: (e && e.message) || 'error', latencyMs: Date.now() - started };
  }
}

// Run every probe. Network probes run in parallel; config is synchronous.
export async function runAllProbes({ selfOrigin, secret }) {
  const [offers, cachedOffers, widgetConfig, redis] = await Promise.all([
    checkOffers(selfOrigin, secret),
    checkCachedOffers(selfOrigin, secret),
    checkWidgetConfig(selfOrigin, secret),
    checkRedis(),
  ]);
  return [offers, cachedOffers, widgetConfig, redis, checkConfig()];
}
