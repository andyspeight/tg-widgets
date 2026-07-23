/**
 * Cross-instance rate limiting for the PUBLIC widget endpoints.
 *
 * Why this exists: api/_auth.js has an in-memory limiter, but Vercel functions
 * are stateless and fan out across instances, so a per-instance counter can't
 * throttle a burst — a 40 req/sec flood spreads thin and never trips. This
 * helper counts in Upstash Redis (already provisioned for the suite; same env
 * vars the auth limiter and world-map cache use) so the window is shared across
 * every instance.
 *
 * Policy: FAIL-OPEN. If Redis is unreachable we ALLOW and log — a limiter blip
 * must never blank a client's widget. The only rejection is a deliberate 429
 * when a real limit is exceeded. (The auth limiter fails closed; public widgets
 * must not.)
 *
 * Windows are per-endpoint and env-configurable. We count two scopes:
 *   - per IP                (the abuse vector: one source flooding)
 *   - per IP + widgetId     (a secondary key, applied when a widgetId is present)
 * Both scopes share the same numeric limits per window.
 *
 * Required env (already set in Vercel):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Optional overrides (integers; sensible defaults below):
 *   RL_OFFERS_PER_MIN (20)  RL_OFFERS_PER_HR (300)
 *   RL_CACHED_PER_MIN (60)  RL_CACHED_PER_HR (1200)
 *   RL_CONFIG_PER_MIN (120) RL_CONFIG_PER_HR (2000)
 *   RL_POPUP_PER_MIN (20)   RL_POPUP_PER_HR (200)
 *   RL_DISABLED — set to '1' to bypass entirely (emergency escape hatch).
 */

import { getRequestIp } from './auth/http.js';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Per-event window definitions. Each window: { name, max, seconds }.
// `name` is short and stable (it forms part of the Redis key).
export function limitsFor(event) {
  switch (event) {
    case 'offers':
      return [
        { name: 'm', max: envInt('RL_OFFERS_PER_MIN', 20), seconds: 60 },
        { name: 'h', max: envInt('RL_OFFERS_PER_HR', 300), seconds: 3600 },
      ];
    case 'cached-offers':
      return [
        { name: 'm', max: envInt('RL_CACHED_PER_MIN', 60), seconds: 60 },
        { name: 'h', max: envInt('RL_CACHED_PER_HR', 1200), seconds: 3600 },
      ];
    case 'config':
      return [
        { name: 'm', max: envInt('RL_CONFIG_PER_MIN', 120), seconds: 60 },
        { name: 'h', max: envInt('RL_CONFIG_PER_HR', 2000), seconds: 3600 },
      ];
    case 'popup-lead':
      return [
        { name: 'm', max: envInt('RL_POPUP_PER_MIN', 20), seconds: 60 },
        { name: 'h', max: envInt('RL_POPUP_PER_HR', 200), seconds: 3600 },
      ];
    default:
      return null;
  }
}

// Redis-safe key fragment: keep it short and free of the '/' separator the
// Upstash REST path uses. The pipeline endpoint takes JSON so this is only
// defensive, but it also bounds key length under adversarial input.
function safeFrag(s, max = 80) {
  return String(s == null ? '' : s)
    .replace(/[^A-Za-z0-9._:-]/g, '_')
    .slice(0, max);
}

// Requests from our OWN editor/preview must never trip the PUBLIC abuse limit.
// A logged-in staff member or client building a widget on our platform is not
// the abuse vector: the offers editor legitimately fans out several live
// availability lookups per edit (one per destination), which far exceeds the
// visitor-facing budget. Counting those against the shared per-IP bucket locked
// a real client out for an hour and blanked their live site too (the 23 Jul
// 2026 incident). Editor/preview calls send X-TG-Preview:1 AND originate from
// one of our own platform hosts; a browser cannot forge Origin/Referer to our
// domain, and the live widget on a customer site sends neither header, so the
// public surface stays fully throttled. READ endpoints only — a write path
// (popup-lead) is never relaxed this way.
function isTrustedPreviewRequest(req) {
  try {
    const h = (req && req.headers) || {};
    if (String(h['x-tg-preview'] || '') !== '1') return false;
    const hostOf = (v) => { try { return new URL(v).host.toLowerCase(); } catch { return ''; } };
    const cands = [hostOf(h.origin || ''), hostOf(h.referer || h.referrer || '')];
    return cands.some((host) => !!host && (
      host === 'localhost' || host.indexOf('localhost:') === 0 ||
      /(^|\.)travelify\.io$/.test(host) ||
      /(^|\.)vercel\.app$/.test(host)
    ));
  } catch { return false; }
}

/**
 * Increment every counter in one Redis round trip. Returns an array of new
 * counts aligned to `entries`, or null on ANY failure (→ caller fails open).
 * @param {{key:string, ttl:number}[]} entries
 */
// This runs BEFORE the response is sent, so it must be bounded: a slow or hung
// Upstash can never delay a widget. On timeout we abort and fail open.
const PIPELINE_TIMEOUT_MS = 800;

async function pipelineIncr(entries) {
  if (!REDIS_URL || !REDIS_TOKEN || entries.length === 0) return null;
  const commands = [];
  for (const e of entries) {
    commands.push(['INCR', e.key]);
    commands.push(['EXPIRE', e.key, e.ttl, 'NX']); // set TTL only on first write
  }
  let ctrl;
  let timer;
  try {
    ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), PIPELINE_TIMEOUT_MS);
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    // INCR results sit at the even indices (0, 2, 4, …).
    return entries.map((_, i) => {
      const r = data[i * 2];
      const v = r && Object.prototype.hasOwnProperty.call(r, 'result') ? r.result : r;
      return Number(v);
    });
  } catch (e) {
    // Includes AbortError on timeout — fail open.
    console.warn('[ratelimit] pipeline error', e && e.message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Evaluate the rate limit for a public request and write the standard headers.
 * Does NOT send the response — returns a decision the caller acts on, so the
 * caller can log telemetry for the 429 in one place.
 *
 * @returns {Promise<{allowed:boolean, retryAfter?:number, ip:string,
 *   widgetId:string, failOpen?:boolean, limit?:number, remaining?:number}>}
 */
export async function evaluatePublicRateLimit(req, res, { event, widgetId } = {}) {
  const ip = safeFrag(getRequestIp(req) || 'unknown', 64);
  const wid = widgetId ? safeFrag(widgetId, 64) : '';

  if (process.env.RL_DISABLED === '1') {
    return { allowed: true, ip, widgetId: wid, failOpen: false };
  }

  // Our own editor/preview never counts against the public limit (read paths).
  // popup-lead is a write and keeps its full protection regardless.
  if (event !== 'popup-lead' && isTrustedPreviewRequest(req)) {
    return { allowed: true, ip, widgetId: wid, preview: true };
  }

  const windows = limitsFor(event);
  if (!windows) return { allowed: true, ip, widgetId: wid };

  // Build the counter set: per-IP for each window, plus per-(IP+widgetId).
  const entries = [];
  const meta = [];
  for (const w of windows) {
    entries.push({ key: `rl:pub:${event}:ip:${w.name}:${ip}`, ttl: w.seconds });
    meta.push(w);
  }
  if (wid) {
    for (const w of windows) {
      entries.push({ key: `rl:pub:${event}:iw:${w.name}:${ip}:${wid}`, ttl: w.seconds });
      meta.push(w);
    }
  }

  const counts = await pipelineIncr(entries);

  // FAIL-OPEN: Redis unreachable → allow. Never blank a widget on a limiter blip.
  if (counts === null) {
    console.warn(`[ratelimit] fail-open (redis unavailable) event=${event} ip=${ip}`);
    return { allowed: true, ip, widgetId: wid, failOpen: true };
  }

  // Find the tightest window (least headroom) for headers, and whether any
  // window is over its limit (→ block, using the shortest such window's TTL).
  let tightest = null;
  let blocked = null;
  for (let i = 0; i < meta.length; i++) {
    const w = meta[i];
    const count = counts[i];
    if (!Number.isFinite(count)) continue; // a single bad reply → treat as non-blocking
    const remaining = Math.max(0, w.max - count);
    if (!tightest || remaining < tightest.remaining) {
      tightest = { limit: w.max, remaining, retryAfter: w.seconds };
    }
    if (count > w.max && (!blocked || w.seconds < blocked.retryAfter)) {
      blocked = { limit: w.max, retryAfter: w.seconds };
    }
  }

  if (blocked) {
    res.setHeader('Retry-After', blocked.retryAfter);
    res.setHeader('X-RateLimit-Limit', blocked.limit);
    res.setHeader('X-RateLimit-Remaining', 0);
    return { allowed: false, retryAfter: blocked.retryAfter, ip, widgetId: wid, limit: blocked.limit, remaining: 0 };
  }

  if (tightest) {
    res.setHeader('X-RateLimit-Limit', tightest.limit);
    res.setHeader('X-RateLimit-Remaining', tightest.remaining);
    return { allowed: true, ip, widgetId: wid, limit: tightest.limit, remaining: tightest.remaining };
  }

  return { allowed: true, ip, widgetId: wid };
}
