'use strict';

/**
 * api/check.js — the public scan endpoint.
 *
 * This route is unauthenticated and it fetches arbitrary user-supplied URLs
 * server-side, which is the highest-risk shape we ship. The order of the guards
 * below is deliberate and must not be rearranged:
 *
 *   1. method check
 *   2. CORS against an allowlist, never *
 *   3. input validation
 *   4. rate limit
 *   5. only then does anything leave the box
 *
 * Rate limiting sits before the fetch so this cannot be used as a free scanning
 * proxy. Errors returned to the client are generic. Nothing upstream, no stack,
 * no hostname, no secret ever reaches the response body or a log line.
 */

const engine = require('../lib/engine');
const { NetError } = require('../lib/net');
const { createLimiter } = require('../lib/ratelimit');

// One limiter per warm instance. The in-memory window survives between
// invocations on the same instance, and Upstash covers the rest.
const limiter = createLimiter();

const MAX_URL_LENGTH = 2048;

/** Messages a visitor can act on, with nothing internal in them. */
const CLIENT_MESSAGES = {
  BAD_URL: 'That does not look like a web address. Try something like yoursite.com.',
  BAD_SCHEME: 'We can only check http and https addresses.',
  BAD_PORT: 'We can only check sites on the standard web ports.',
  BLOCKED_IP: 'That address is not a public website, so there is nothing for us to check.',
  DNS_FAIL: 'We could not find that domain. Check the spelling and try again.',
  TIMEOUT: 'That site took too long to answer. Try again in a moment.',
  TOO_MANY_REDIRECTS: 'That address redirects in a loop, so we could not reach a page.',
  NETWORK: 'We could not reach that site. Check the address and try again.',
};

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return; // same-origin request, no header needed
  const list = allowedOrigins();
  if (list.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  // An origin that is not on the list simply gets no CORS header. The browser
  // does the refusing, and we never widen to *.
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded) && forwarded.length) return String(forwarded[0]).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length) return real.trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function readUrlParam(req) {
  if (req.method === 'GET') {
    const q = req.query || {};
    if (typeof q.url === 'string') return q.url;
    // Fall back to parsing when the platform has not populated req.query.
    try {
      return new URL(req.url, 'http://placeholder.invalid').searchParams.get('url');
    } catch {
      return null;
    }
  }
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (body && typeof body === 'object' && typeof body.url === 'string') return body.url;
  return null;
}

function fail(res, status, message, extra) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(Object.assign({ ok: false, error: message }, extra || {}));
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  applyCors(req, res);

  // 1. Method check.
  if (req.method === 'OPTIONS') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return fail(res, 405, 'That method is not allowed here.');
  }

  // 2. Input validation, before anything expensive.
  const raw = readUrlParam(req);
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fail(res, 400, 'Give us a web address to check.');
  }
  if (raw.length > MAX_URL_LENGTH) {
    return fail(res, 400, CLIENT_MESSAGES.BAD_URL);
  }

  // 3. Rate limit. This has to happen before the first outbound request,
  //    otherwise the tool becomes a free scanner for whoever wants one.
  let limit;
  try {
    limit = await limiter.check(clientIp(req));
  } catch {
    limit = { allowed: true, retryAfter: 0, degraded: true };
  }
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter || 60));
    return fail(res, 429, 'That is a lot of checks in a short time. Give it a minute and try again.', {
      retryAfter: limit.retryAfter || 60,
    });
  }

  // 4. The scan.
  try {
    const report = await engine.scan(raw);
    res.setHeader('Cache-Control', req.method === 'GET'
      ? 'public, s-maxage=300, stale-while-revalidate=60'
      : 'no-store');
    return res.status(200).json(Object.assign({ ok: true }, report));
  } catch (err) {
    if (err instanceof NetError) {
      const message = CLIENT_MESSAGES[err.code] || CLIENT_MESSAGES.NETWORK;
      return fail(res, 400, message, { reason: err.code });
    }
    // Log for us, say nothing useful to a stranger.
    console.error('[api/check] unexpected failure:', err && err.code ? err.code : 'unknown');
    return fail(res, 500, 'Something went wrong at our end. Try again in a moment.');
  }
};
