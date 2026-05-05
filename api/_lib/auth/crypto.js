/**
 * Cryptographic helpers for the auth system.
 *
 * Required env vars:
 *   JWT_SECRET — 256+ bit random string. Used to sign session JWTs.
 *                Generate: `openssl rand -base64 48`
 *
 * Dependencies:
 *   bcryptjs (pure JS — no native compile step on Vercel)
 *   jsonwebtoken
 *
 * Algorithm choices:
 *   - bcrypt cost 12 (~250ms per hash on Vercel — slow enough to deter
 *     brute force, fast enough for sign-in UX)
 *   - JWT HS256 with a strong secret
 *   - 32-byte (256-bit) random tokens for password reset and invites
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = 'tg-widget-suite';
const JWT_ALGORITHM = 'HS256';
const SESSION_LIFETIME_DAYS = 30;
const BCRYPT_COST = 12;

if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
  console.warn('[auth/crypto] JWT_SECRET not set — token signing will fail');
}

// ----------------------------------------------------------------------------
// Password hashing
// ----------------------------------------------------------------------------

export async function hashPassword(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('hashPassword: password must be a non-empty string');
  }
  // bcrypt has a 72-byte input cap. Reject anything beyond that to avoid
  // silent truncation (which can create surprising "two passwords match" bugs).
  if (Buffer.byteLength(plaintext, 'utf8') > 72) {
    throw new Error('Password exceeds 72-byte bcrypt limit');
  }
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyPassword(plaintext, hash) {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// JWT signing / verifying
// ----------------------------------------------------------------------------

/**
 * Sign a session JWT.
 *
 * @param {object} payload — must include userId, clientId, role, sessionId
 * @returns {{ token: string, jti: string, expiresAt: Date }}
 */
export function signSessionToken(payload) {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
  const token = jwt.sign(payload, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    issuer: JWT_ISSUER,
    jwtid: jti,
    expiresIn: `${SESSION_LIFETIME_DAYS}d`
  });
  return { token, jti, expiresAt };
}

/**
 * Verify a JWT. Returns the decoded payload or null if invalid.
 * Does NOT check session-revocation status — callers must do that
 * via the sessions table (defence in depth).
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER
    });
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Secure random tokens (password reset, invites, magic links)
// ----------------------------------------------------------------------------

/**
 * Generate a URL-safe random token. 256 bits of entropy.
 * Returns the raw token (send this to the user) — store the SHA-256 hash.
 */
export function generateSecureToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Hash a token for storage. We never store raw tokens — only the hash.
 * Lookup: take the token from the URL, hash it, look up by the hash.
 */
export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// ----------------------------------------------------------------------------
// Constant-time string comparison
// ----------------------------------------------------------------------------

export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ----------------------------------------------------------------------------
// UUID
// ----------------------------------------------------------------------------

export function uuid() {
  return crypto.randomUUID();
}
