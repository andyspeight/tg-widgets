/**
 * Scoped "act as client" grant.
 *
 * A short-lived, HMAC-SHA256 signed token that lets a Travelgenix staff member
 * act as one client for the requests that carry it, WITHOUT changing the shared
 * tg_session cookie. This is the per-tool, per-tab replacement for the old
 * global switch (see docs/act-as-scoping-spec.md).
 *
 * The grant is stateless (not stored): it is signed, carries the staff user id
 * and the target client id, and expires. requireAuth applies it only when the
 * caller is staff and the grant's staffUserId matches them, and fails closed to
 * the real staff user on any problem. Early revocation (before expiry) would
 * need a server-side store and is deferred; the short TTL bounds exposure.
 *
 * Secret: derived from JWT_SECRET (the auth system's secret), so no new env var
 * is needed. Pattern mirrors the calendar OAuth state token in
 * api/_lib/calendar/state.js.
 */

import crypto from 'node:crypto';

// 30 minutes. The front-end re-mints while the staff member is active to give
// idle-timeout semantics; the server only enforces this absolute cap per grant.
export const ACT_AS_TTL_MS = 30 * 60 * 1000;

// Lower-case: Node normalises incoming request header names to lower-case.
export const ACT_AS_HEADER = 'x-tg-act-as';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

function secret() {
  const raw = process.env.JWT_SECRET || '';
  if (!raw) throw new Error('JWT_SECRET missing');
  return crypto.createHash('sha256').update('tg-act-as|' + raw).digest();
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Sign an act-as grant. Returns the token string.
 * @param {{ staffUserId: string, targetClientId: string }} p
 * @param {number} [ttlMs] override the default TTL
 */
export function signActAsGrant(p, ttlMs) {
  const body = {
    staffUserId: String(p.staffUserId || ''),
    targetClientId: String(p.targetClientId || ''),
    iat: Date.now(),
    exp: Date.now() + (ttlMs || ACT_AS_TTL_MS),
  };
  const json = b64url(Buffer.from(JSON.stringify(body), 'utf8'));
  const sig = b64url(crypto.createHmac('sha256', secret()).update(json).digest());
  return json + '.' + sig;
}

/**
 * Verify a grant token. Returns the payload { staffUserId, targetClientId,
 * iat, exp } or null. Null on any tamper, bad shape, or expiry. Never throws.
 */
export function verifyActAsGrant(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [json, sig] = token.split('.');
  if (!json || !sig) return null;
  let expect;
  try { expect = b64url(crypto.createHmac('sha256', secret()).update(json).digest()); }
  catch { return null; }
  let match = false;
  try { match = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect)); }
  catch { match = false; }
  if (!match) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(json).toString('utf8')); }
  catch { return null; }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (typeof payload.staffUserId !== 'string' || !payload.staffUserId) return null;
  if (typeof payload.targetClientId !== 'string' || !REC_ID_RE.test(payload.targetClientId)) return null;
  return payload;
}

/**
 * Read the act-as grant token from a request, if present. Tolerates the header
 * arriving as an array (rare) and either header casing.
 */
export function readActAsHeader(req) {
  const h = req && req.headers && (req.headers[ACT_AS_HEADER] || req.headers['X-TG-Act-As']);
  if (!h) return '';
  return Array.isArray(h) ? String(h[0] || '') : String(h);
}

/**
 * The whole act-as decision as a pure function, so requireAuth stays simple and
 * this security-critical branch can be tested without the Airtable/session
 * layers. Returns { targetClientId } when a valid grant should apply for this
 * request, else null (run as the real staff user). Fails closed:
 *   - non-staff callers never get an overlay,
 *   - no header, or an invalid / expired / tampered grant, returns null,
 *   - a grant whose staffUserId is not this caller returns null (no replay).
 *
 * @param {{ isStaff: boolean, req: object, userRecordId: string }} args
 */
export function resolveActAs({ isStaff, req, userRecordId }) {
  if (!isStaff) return null;
  const tok = readActAsHeader(req);
  if (!tok) return null;
  const grant = verifyActAsGrant(tok);
  if (!grant || grant.staffUserId !== userRecordId) return null;
  return { targetClientId: grant.targetClientId };
}
