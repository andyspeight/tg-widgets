/**
 * Tripbuster agent authentication.
 *
 * Tripbuster is a separate product, so agents sign in to Tripbuster — not to the
 * Travelgenix client dashboard. The token crypto mirrors api/_auth.js (HMAC-SHA256
 * over a base64url payload, timing-safe comparison) but with two deliberate
 * differences:
 *
 *   1. Its own secret, TRIPBUSTER_SESSION_SECRET. A leaked Travelgenix secret must
 *      not be able to mint Tripbuster sessions, or the reverse.
 *   2. A `scope` claim. Even if the two secrets were ever accidentally set to the
 *      same value, a Travelgenix token still could not authenticate as an agent.
 *
 * Required env:
 *   TRIPBUSTER_SESSION_SECRET — min 32 chars
 */
import { createHmac, timingSafeEqual } from 'crypto';

const SCOPE = 'tb-agent';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours, same as the Travelgenix session

function secret() {
  const s = process.env.TRIPBUSTER_SESSION_SECRET;
  if (!s || s.length < 32) return null;
  return s;
}

export function authConfigured() {
  return !!secret();
}

export function createAgentToken({ agentId, slug, plan, email }) {
  const s = secret();
  if (!s) throw new Error('TRIPBUSTER_SESSION_SECRET not configured or too short');
  const data = { scope: SCOPE, agentId, slug, plan, email, exp: Date.now() + TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = createHmac('sha256', s).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyAgentToken(token) {
  const s = secret();
  if (!s || !token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;

  const expected = createHmac('sha256', s).update(encoded).digest('base64url');
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (data.scope !== SCOPE) return null;              // not an agent token
    if (!data.agentId || !data.exp) return null;
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Sign a link we email to ourselves, such as "approve this agency".
 *
 * Same secret and the same HMAC as a session token, but a different shape and
 * its own purpose string, so an approval link can never be presented as a
 * session and a session can never be presented as an approval. The expiry is
 * inside the signed material rather than beside it, or anybody could extend it.
 *
 * Deliberately NOT a session: an approval link lands in an inbox, gets forwarded,
 * and sits in a mail archive for years. It has to be narrow and short-lived.
 */
const ADMIN_PURPOSE = 'tb-approve';
const ADMIN_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000; // a fortnight to notice an email

export function signAdminLink(agentId, ttlMs = ADMIN_LINK_TTL_MS) {
  const s = secret();
  if (!s) throw new Error('TRIPBUSTER_SESSION_SECRET not configured or too short');
  const exp = Date.now() + ttlMs;
  const material = `${ADMIN_PURPOSE}.${agentId}.${exp}`;
  const sig = createHmac('sha256', s).update(material).digest('base64url');
  return { exp: String(exp), sig };
}

/** True only for a link we signed, for this agent, that has not expired. */
export function verifyAdminLink(agentId, exp, sig) {
  const s = secret();
  if (!s || !agentId || !exp || !sig) return false;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  const material = `${ADMIN_PURPOSE}.${agentId}.${expiry}`;
  const expected = createHmac('sha256', s).update(material).digest('base64url');
  try {
    const a = Buffer.from(String(sig), 'base64url');
    const b = Buffer.from(expected, 'base64url');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function bearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/**
 * Gate a request on a valid agent session. Fails closed: any missing, malformed,
 * expired or wrong-scope token is a 401, and the reason stays generic in the body.
 * Returns { ok: true, agent } or { ok: false, status, error }.
 */
export function requireAgent(req) {
  if (!authConfigured()) {
    console.warn('[tripbuster/auth] TRIPBUSTER_SESSION_SECRET missing or too short');
    return { ok: false, status: 503, error: 'Sign-in is not configured yet' };
  }
  const data = verifyAgentToken(bearer(req));
  if (!data) return { ok: false, status: 401, error: 'Sign in again to continue' };
  return { ok: true, agent: data };
}
