/**
 * Session management.
 *
 * Hybrid JWT + Sessions model:
 * - User signs in → we create a Session record and issue a JWT containing sessionId+jti
 * - Every authenticated request: verify JWT cryptographically, then look up
 *   the Session row and confirm Revoked At is empty
 * - Sign out: set Revoked At on the session. JWT still validates but session
 *   check fails → 401
 * - "Sign out everywhere": revoke all of a user's sessions
 *
 * One Airtable read per authenticated request. For 300 clients this is fine.
 * If it ever becomes a hotspot we can layer Upstash Redis caching of valid
 * session IDs in front.
 */

import { SESSIONS } from './schema.js';
import { findOneByField, createRecord, updateRecord, listRecords, listAllRecords } from './airtable.js';
import { uuid } from './crypto.js';

/**
 * Create a new session row.
 * @param {object} args
 * @param {string} args.userRecordId — Airtable rec... ID of the User
 * @param {string} args.jti — JWT jti claim
 * @param {Date}   args.expiresAt
 * @param {string} args.userAgent
 * @param {string} args.ip
 * @returns {Promise<{ sessionId: string, recordId: string }>}
 */
export async function createSession({ userRecordId, jti, expiresAt, userAgent, ip }) {
  const sessionId = uuid();
  const now = new Date().toISOString();
  const rec = await createRecord(SESSIONS.tableId, {
    [SESSIONS.fields.sessionId]: sessionId,
    [SESSIONS.fields.user]:      [userRecordId],
    [SESSIONS.fields.jwtJti]:    jti,
    [SESSIONS.fields.userAgent]: (userAgent || '').slice(0, 500),
    [SESSIONS.fields.ipAddress]: ip || '',
    [SESSIONS.fields.created]:   now,
    [SESSIONS.fields.expiresAt]: expiresAt.toISOString(),
    [SESSIONS.fields.lastUsed]:  now
  });
  return { sessionId, recordId: rec.id };
}

/**
 * Look up a session by its public Session ID.
 * Returns null if the session doesn't exist, has been revoked, or has expired.
 */
export async function getActiveSession(sessionId) {
  if (!sessionId) return null;
  const rec = await findOneByField(SESSIONS.tableId, SESSIONS.fields.sessionId, sessionId);
  if (!rec) return null;

  const f = rec.fields;
  if (f[SESSIONS.fields.revokedAt]) return null;

  const exp = f[SESSIONS.fields.expiresAt];
  if (exp && new Date(exp) < new Date()) return null;

  return {
    recordId: rec.id,
    sessionId: f[SESSIONS.fields.sessionId],
    userRecordId: (f[SESSIONS.fields.user] || [])[0],
    jti: f[SESSIONS.fields.jwtJti]
  };
}

/**
 * Mark a session as revoked. Idempotent.
 */
export async function revokeSession(sessionRecordId, reason = 'signout') {
  return updateRecord(SESSIONS.tableId, sessionRecordId, {
    [SESSIONS.fields.revokedAt]:    new Date().toISOString(),
    [SESSIONS.fields.revokeReason]: reason
  });
}

/**
 * Revoke every active session for a user.
 * Used on "sign out everywhere", after password reset, and on every SSO
 * sign-in (one-active-session policy).
 *
 * Implementation note: Airtable formulas can't reliably compare a linked-
 * record array field against a record id — `{user}` in a formula resolves
 * to the array of primary-field values (in our case, emails), not record
 * IDs. The previous version of this function used `{user}='recXXX'` which
 * silently always returned 0 rows. Fix: pull all sessions and filter
 * client-side. Session counts are small (per-user typically 1–5, total
 * across the org currently in the hundreds), so the read is cheap.
 */
export async function revokeAllUserSessions(userRecordId, reason = 'signout_all') {
  if (!userRecordId) return 0;

  const all = await listAllRecords(SESSIONS.tableId);
  const nowMs = Date.now();

  const active = all.filter((rec) => {
    const userLinks = rec.fields[SESSIONS.fields.user] || [];
    if (!userLinks.includes(userRecordId)) return false;

    // Already revoked? skip
    if (rec.fields[SESSIONS.fields.revokedAt]) return false;

    // Expired? skip (it's effectively dead anyway)
    const exp = rec.fields[SESSIONS.fields.expiresAt];
    if (exp && new Date(exp).getTime() < nowMs) return false;

    return true;
  });

  if (active.length === 0) return 0;

  for (const r of active) {
    await revokeSession(r.id, reason);
  }
  return active.length;
}

/**
 * Touch the lastUsed timestamp. Called on each authenticated request.
 * Best-effort — we don't await this in the hot path.
 */
export async function touchSession(sessionRecordId) {
  try {
    await updateRecord(SESSIONS.tableId, sessionRecordId, {
      [SESSIONS.fields.lastUsed]: new Date().toISOString()
    });
  } catch {
    // Swallow — losing a lastUsed update is not worth failing the request
  }
}
