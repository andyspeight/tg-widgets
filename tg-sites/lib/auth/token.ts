/**
 * Signing and reading a session token. No cookies, no Next, no database.
 *
 * Kept separate from session.ts on purpose. Everything here is a pure function
 * of its arguments, which means the crypto can be tested properly rather than
 * only through a request, and the tests can forge tokens to prove the checks
 * work. session.ts is the thin part that reads and writes the cookie.
 *
 * WHY A SIGNED TOKEN AND NOT A SESSIONS TABLE
 *
 * A sessions table would allow "sign out everywhere" and instant revocation.
 * It also means a database round trip on every request that needs a user,
 * which is all of them, plus a table to expire and a job to expire it.
 *
 * The trade is deliberate and worth stating plainly: a stolen token stays
 * valid until it expires, and there is no way to kill it early short of
 * rotating SESSION_SECRET, which signs everybody out at once. For a CMS whose
 * users are a handful of staff and agents that is the right trade. If it ever
 * stops being the right trade, the fix is a revocation list keyed on the id
 * below, not a rewrite: everything else here stays.
 *
 * WHAT THE SIGNATURE IS FOR
 *
 * The payload is readable by anyone holding the cookie. It is not a secret; it
 * is a claim. The HMAC is what makes the claim trustworthy, so the only thing
 * that matters is that a payload the server did not sign is refused. There is
 * nothing in it worth hiding, so it is not encrypted.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Bumped if the payload shape changes, so old cookies are refused not misread. */
const VERSION = 'v1';

/** Thirty days. Long enough not to nag, short enough that a leak ages out. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SessionClaims {
  /** The subject: whatever id the identity provider issued. */
  userId: string;
  /** Seconds since the epoch, after which the token is refused. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/*
 * base64url, not base64. A cookie value may not contain a comma, a semicolon
 * or whitespace, and base64's "+" and "/" survive but read badly in a URL if
 * this ever moves to a query string. Node can do it directly.
 */
function encode(value: Buffer | string): string {
  return Buffer.from(value as never).toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

// ---------------------------------------------------------------------------
// Making one
// ---------------------------------------------------------------------------

/**
 * A session token for this user.
 *
 * `now` is a parameter rather than a call to Date.now() so a test can prove
 * expiry works without waiting a month for it.
 */
export function signSession(
  userId: string,
  secret: string,
  now: number = Date.now(),
): string {
  if (!userId) throw new Error('Cannot sign a session with no user id.');
  assertUsableSecret(secret);

  const claims = {
    v: 1,
    sub: userId,
    exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS,
    // Random per token, so two sessions signed for the same user in the same
    // second are still different strings. Without it a token would be
    // reproducible from the user id and the clock, which makes it look like an
    // identifier and invites someone to treat it as one.
    jti: randomBytes(8).toString('base64url'),
  };

  const body = `${VERSION}.${encode(JSON.stringify(claims))}`;
  return `${body}.${sign(body, secret)}`;
}

// ---------------------------------------------------------------------------
// Reading one
// ---------------------------------------------------------------------------

/**
 * The claims in a token, or null.
 *
 * Null for every kind of failure: wrong shape, wrong version, bad signature,
 * expired, nonsense inside. A caller cannot tell which, and does not need to.
 * Never throws on input, because the input is a cookie and a cookie is
 * whatever the client felt like sending.
 */
export function readSession(
  token: unknown,
  secret: string,
  now: number = Date.now(),
): SessionClaims | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    return null;
  }
  if (!isUsableSecret(secret)) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [version, payload, signature] = parts;
  if (version !== VERSION) return null;

  // Signature first, always. Nothing in the payload is looked at, let alone
  // parsed, until the server has confirmed it wrote it.
  if (!signatureMatches(`${version}.${payload}`, signature, secret)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(decode(payload).toString('utf8'));
  } catch {
    return null;
  }

  if (!claims || typeof claims !== 'object') return null;
  const { sub, exp } = claims as Record<string, unknown>;

  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 255) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;

  // The cookie's own Max-Age is a request to the browser, not a rule. This is
  // the rule: a token past its expiry is refused however it arrived.
  if (Math.floor(now / 1000) >= exp) return null;

  return { userId: sub, expiresAt: exp };
}

/**
 * Constant-time signature comparison.
 *
 * timingSafeEqual throws when the two buffers are different lengths, which is
 * exactly what a forged signature looks like, so the length is checked first.
 * A plain === would leak how much of the signature was right through how long
 * the comparison took, which is enough to forge one a byte at a time.
 */
function signatureMatches(body: string, provided: string, secret: string): boolean {
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(provided);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

// ---------------------------------------------------------------------------
// The secret
// ---------------------------------------------------------------------------

/**
 * Long enough to be a secret.
 *
 * 32 characters is the floor, which rules out the two real mistakes: leaving
 * it empty, and typing a password in. HMAC-SHA256 will happily accept "abc"
 * and produce a signature that looks exactly as convincing as a good one.
 */
export function isUsableSecret(secret: unknown): secret is string {
  return typeof secret === 'string' && secret.trim().length >= 32;
}

export function assertUsableSecret(secret: unknown): asserts secret is string {
  if (isUsableSecret(secret)) return;
  throw new Error(
    'SESSION_SECRET is missing or too short. It signs every session cookie, ' +
      'so a weak one means anyone can mint a session for anyone. Generate one ' +
      'with:\n\n  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"\n\n' +
      'then add it to the environment. Changing it later signs everyone out, ' +
      'which is the intended way to revoke every session at once.',
  );
}
