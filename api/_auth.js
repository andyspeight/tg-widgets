/**
 * Shared Auth & Security Utilities
 * Used by all Widget Suite API endpoints
 * 
 * Env vars required:
 *   TG_SESSION_SECRET — HMAC signing key for session tokens (min 32 chars)
 */
import { createHmac, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// JWT settings — must match _lib/auth/crypto.js for the cookie session to
// validate here. We accept the cookie as an alternative to the legacy
// Bearer token so the unified Travelgenix sign-in flow (id.travelify.io)
// gives access to the widget editor without re-authenticating.
const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'tg-widget-suite';
const COOKIE_NAME = 'tg_session';

// ── Rate Limiter (in-memory, per-instance) ──────────────────────
// KNOWN LIMITATION: Vercel serverless functions have per-instance memory.
// An attacker hitting multiple cold starts can bypass this. In practice
// this catches buggy clients, naive brute force, and opportunistic abuse —
// good defence in depth on top of HMAC auth, ownership checks, and plan
// gates. For stronger defence, migrate to Upstash Redis when the suite
// faces targeted abuse.

const rateLimitStore = new Map();
const MAX_STORE_SIZE = 10000; // bound memory — sweep stale entries when full

// Presets for common endpoint types. Tune these by endpoint class, not
// by individual endpoint, so limits stay consistent and easy to reason about.
export const RATE_LIMITS = {
  auth:        { max: 8,   windowMs: 15 * 60 * 1000 }, // login: strict — brute-force defence
  widgetRead:  { max: 120, windowMs: 15 * 60 * 1000 }, // list/load: generous — dashboard refreshes
  widgetWrite: { max: 60,  windowMs: 15 * 60 * 1000 }, // save: moderate — bounded human action
};

/**
 * Check whether a request keyed by `key` is within the given rate limit.
 * Returns { allowed, remaining, retryAfter? }.
 * Most callers should use applyRateLimit() instead of this directly.
 */
export function checkRateLimit(key, limit = RATE_LIMITS.widgetRead) {
  if (typeof key !== 'string' || !key) {
    return { allowed: false, remaining: 0, retryAfter: 60 };
  }
  const { max, windowMs } = limit;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // Lazy cleanup: expired entry → start fresh window
  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitStore.set(key, { windowStart: now, count: 1 });
    if (rateLimitStore.size > MAX_STORE_SIZE) sweepStale(now);
    return { allowed: true, remaining: max - 1 };
  }

  entry.count++;
  if (entry.count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.windowStart + windowMs - now) / 1000),
    };
  }
  return { allowed: true, remaining: max - entry.count };
}

// Sweep entries older than 1 hour — conservative, covers all current window sizes.
function sweepStale(now) {
  const cutoff = 60 * 60 * 1000;
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > cutoff) rateLimitStore.delete(key);
  }
}

/**
 * Apply rate limit and write response headers.
 * Returns true if the request may proceed, false if a 429 has been sent.
 *
 * Usage:
 *   if (!applyRateLimit(res, `list:${user.email}`, RATE_LIMITS.widgetRead)) return;
 */
export function applyRateLimit(res, key, limit = RATE_LIMITS.widgetRead) {
  const result = checkRateLimit(key, limit);
  res.setHeader('X-RateLimit-Limit', limit.max);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfter);
    res.status(429).json({
      error: `Too many requests. Please try again in ${result.retryAfter} second${result.retryAfter === 1 ? '' : 's'}.`,
    });
    return false;
  }
  return true;
}


// ── Session Token (HMAC-SHA256) ─────────────────────────────────
// Token format: base64(JSON({email, clientName, plan, exp})):signature

export function createToken(payload) {
  const secret = process.env.TG_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('TG_SESSION_SECRET not configured or too short');

  const data = {
    ...payload,
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  const secret = process.env.TG_SESSION_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;

  // Verify signature using timing-safe comparison
  const expectedSig = createHmac('sha256', secret).update(encoded).digest('base64url');
  try {
    const sigBuf = Buffer.from(sig, 'base64url');
    const expectedBuf = Buffer.from(expectedSig, 'base64url');
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  } catch {
    return null;
  }

  // Decode and check expiry
  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// Extract token from Authorization header or query param
export function getTokenFromRequest(req) {
  // Check Authorization: Bearer <token>
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Check query param (for simple cases)
  return req.query?.token || null;
}

/**
 * Extract the tg_session cookie value from a request. Returns the raw JWT
 * string or null. Used by requireAuth to accept users signed in via the
 * unified Travelgenix flow (id.travelify.io).
 */
function getCookieToken(req) {
  const header = req.headers.cookie || '';
  if (!header) return null;
  // Cookie header is like "a=1; tg_session=<jwt>; b=2". Parse it.
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === COOKIE_NAME) {
      const value = part.slice(eq + 1).trim();
      // Cookie values can be URL-encoded by setSessionCookie (which we do).
      try { return decodeURIComponent(value); } catch { return value; }
    }
  }
  return null;
}

/**
 * Verify a tg_session cookie JWT. Returns the decoded payload (or null).
 * This is the new auth flow — issued by /api/auth/signin and /api/auth/sso.
 *
 * Trade-off vs the new _lib/auth middleware: we only check the JWT
 * signature + expiry. We do NOT verify the session row in Airtable.
 * That's a deliberate choice to keep this function synchronous (so the
 * existing requireAuth(req) call sites don't need to become async).
 * Cost: a session revoked via "sign me out" still works on widget
 * endpoints until the JWT naturally expires. Acceptable for widget
 * editing; never weaken this for admin/identity endpoints.
 */
function verifyCookieJwt(token) {
  if (!token) return null;
  const secret = process.env.TG_SESSION_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
    });
    return payload;
  } catch {
    return null;
  }
}

// Middleware: verify auth and attach user to context.
//
// Tries two auth mechanisms in order:
//   1. Legacy Bearer token (Authorization header / ?token= query param)
//   2. New tg_session cookie (issued by id.travelify.io)
//
// First one to validate wins. Returns the same shape regardless of which
// path matched, so downstream code doesn't care.
export function requireAuth(req) {
  // 1. Legacy Bearer token
  const bearer = getTokenFromRequest(req);
  if (bearer) {
    const user = verifyToken(bearer);
    if (user) return { user };
  }

  // 2. New tg_session cookie
  const cookieJwt = getCookieToken(req);
  if (cookieJwt) {
    const payload = verifyCookieJwt(cookieJwt);
    if (payload) {
      // Map the new payload shape to the legacy user shape expected by
      // downstream code. The legacy token had { email, recordId, clientId,
      // clientName, plan, role, exp }. The new JWT has { userId, clientId,
      // role, sessionId, permissions, iat, exp }.
      //
      // Fields not present in the new payload (email, clientName, plan)
      // are left undefined; widget endpoints that need them should fall
      // back to looking them up by recordId. In practice they look up
      // by clientId or just need the recordId for ownership checks, so
      // this works.
      return {
        user: {
          recordId: payload.userId,
          clientId: payload.clientId,
          role: payload.role,
          // Legacy compatibility fields (may be undefined; that's OK):
          email: payload.email,
          clientName: payload.clientName,
          plan: payload.plan,
          // Carry through new fields so endpoints can use them if they want:
          sessionId: payload.sessionId,
          permissions: payload.permissions,
          // Mark which auth path validated this, for diagnostics
          _authSource: 'cookie',
        }
      };
    }
  }

  return {
    error: bearer || cookieJwt
      ? 'Invalid or expired session. Please sign in again.'
      : 'Authentication required',
    status: 401
  };
}


// ── Input Sanitisation ──────────────────────────────────────────

// Sanitise string for use in Airtable filter formulas
// Prevents formula injection by escaping quotes and special chars
export function sanitiseForFormula(str) {
  if (typeof str !== 'string') return '';
  // Remove any characters that could break Airtable formula syntax
  return str
    .replace(/\\/g, '\\\\')   // Escape backslashes first
    .replace(/'/g, "\\'")      // Escape single quotes
    .replace(/"/g, '\\"')      // Escape double quotes
    .replace(/\n/g, ' ')       // Replace newlines
    .replace(/\r/g, '')        // Remove carriage returns
    .slice(0, 500);            // Max length cap
}

// Sanitise a widget config object before storing
export function sanitiseConfig(config) {
  if (typeof config !== 'object' || config === null) return {};
  
  // Deep clone to avoid mutation
  const clean = JSON.parse(JSON.stringify(config));
  
  // Remove any __proto__ or constructor pollution attempts
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  function scrub(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    for (const key of Object.keys(obj)) {
      if (dangerous.includes(key)) { delete obj[key]; continue; }
      if (typeof obj[key] === 'object') scrub(obj[key]);
      // Strip any <script> tags from string values
      if (typeof obj[key] === 'string') {
        obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      }
    }
    return obj;
  }
  
  return scrub(clean);
}

// Validate email format
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}


// ── CORS Helper ─────────────────────────────────────────────────

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
