/**
 * Shared HTTP helpers for the auth routes.
 *
 * Each route should:
 *   1. setCors(req, res) — and bail early if OPTIONS
 *   2. requireMethod(req, res, 'POST') — bail early if wrong method
 *   3. parseJson(req) — read and validate the body
 *   4. Identify the actor via getRequestIp / getUserAgent
 *   5. Process the request
 *   6. Return jsonOk / jsonError
 */

// CORS — auth routes are called from the dashboard / sign-in page only.
// Allowlist explicitly. We never use '*' here.
const ALLOWED_ORIGINS = [
  'https://tg-widgets.vercel.app',
  'https://widgets.travelify.io',
  'http://localhost:3000',
  'http://localhost:5173'
];

export function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true; // signal caller to bail
  }
  return false;
}

export function requireMethod(req, res, method) {
  if (req.method !== method) {
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  return true;
}

/**
 * Parse JSON body. Returns null if invalid.
 * Vercel typically pre-parses but we defend in depth.
 */
export async function parseJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Extract the requesting IP. Vercel sets x-forwarded-for; first entry is the
 * real client when behind their proxy. Fall back to socket if missing.
 */
export function getRequestIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

export function getUserAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 500);
}

// ----------------------------------------------------------------------------
// Response shapers — uniform error envelope, no stack traces to client
// ----------------------------------------------------------------------------

export function jsonOk(res, data = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, ...data });
}

export function jsonError(res, status, code, message) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ ok: false, code, error: message });
}

// ----------------------------------------------------------------------------
// Input validators
// ----------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(s) {
  return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
}

export function normaliseEmail(s) {
  return String(s || '').trim().toLowerCase();
}

export function isValidPassword(s) {
  // Minimum bar: 10+ chars, not all whitespace, not over bcrypt's 72-byte cap.
  // We deliberately don't enforce character-class rules — modern guidance
  // (NIST SP 800-63B) prefers length over composition.
  if (typeof s !== 'string') return false;
  if (s.trim().length < 10) return false;
  if (Buffer.byteLength(s, 'utf8') > 72) return false;
  return true;
}

export function passwordValidationMessage() {
  return 'Password must be at least 10 characters.';
}
