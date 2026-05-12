/**
 * POST /api/auth/password/change
 *
 * Self-service password change while signed in.
 *
 * Body: { currentPassword, newPassword, signOutOthers? }
 * Returns: { ok: true }
 *
 * Security:
 *   - Caller must be authenticated (live session)
 *   - Current password must verify against stored hash
 *   - New password must pass isValidPassword (10+ chars, <=72 bytes)
 *   - Rate limited per user (uses resetPassword bucket: 10/hour)
 *   - Optionally revokes all OTHER active sessions on success
 *     (the current session is kept — UI sets signOutOthers=true by default)
 *   - Confirmation email sent
 *   - Auth event logged
 *
 * Mirrors api/auth/password/reset.js but token-less and gated on auth.
 */

import { requireAuth } from '../../_lib/auth/middleware.js';
import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent, isValidPassword, passwordValidationMessage,
} from '../../_lib/auth/http.js';
import { limiters } from '../../_lib/auth/ratelimit.js';
import { getRecord, updateRecord, listRecords } from '../../_lib/auth/airtable.js';
import { USERS, SESSIONS, AUTH_EVENTS } from '../../_lib/auth/schema.js';
import { hashPassword, verifyPassword } from '../../_lib/auth/crypto.js';
import { revokeSession } from '../../_lib/auth/sessions.js';
import { sendPasswordChangedEmail } from '../../_lib/auth/email.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid request body');

  const currentPassword = body.currentPassword;
  const newPassword = body.newPassword;
  const signOutOthers = body.signOutOthers !== false;
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return jsonError(res, 400, 'missing_current', 'Current password required');
  }
  if (!isValidPassword(newPassword)) {
    return jsonError(res, 400, 'invalid_password', passwordValidationMessage());
  }

  // Rate-limit per user (re-use the reset bucket — same concept, 10/hour)
  const rl = await limiters.resetPassword({ key: ctx.userRecordId });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many attempts. Try again later.');
  }

  // Load the user to get their current password hash
  let userRec;
  try {
    userRec = await getRecord(USERS.tableId, ctx.userRecordId);
  } catch (err) {
    console.error('[password/change] getRecord failed:', err.message);
    return jsonError(res, 500, 'lookup_failed', 'Unable to load account');
  }

  const storedHash = userRec.fields[USERS.fields.passwordHash];
  if (!storedHash) {
    // User has no password set yet (e.g. SSO-only or invited but not accepted).
    // We refuse rather than silently set one — they should use the reset flow.
    return jsonError(res, 400, 'no_password_set', 'Your account does not use a password. Use the reset link instead.');
  }

  // Verify current password
  const ok = await verifyPassword(currentPassword, storedHash);
  if (!ok) {
    await logAuthEvent({
      type: AUTH_EVENTS.types.PASSWORD_CHANGE,
      success: false,
      userRecordId: ctx.userRecordId,
      clientRecordId: ctx.clientRecordId,
      ip, userAgent: ua,
      detail: { reason: 'wrong_current_password' },
    }).catch(() => {});
    return jsonError(res, 401, 'wrong_password', 'Current password is incorrect');
  }

  // Refuse no-op
  const sameAsOld = await verifyPassword(newPassword, storedHash);
  if (sameAsOld) {
    return jsonError(res, 400, 'same_password', 'New password must be different from the current one');
  }

  // Hash and store the new password
  const newHash = await hashPassword(newPassword);
  try {
    await updateRecord(USERS.tableId, ctx.userRecordId, {
      [USERS.fields.passwordHash]: newHash,
    });
  } catch (err) {
    console.error('[password/change] update failed:', err.message);
    return jsonError(res, 500, 'update_failed', 'Failed to change password');
  }

  // Revoke other sessions (keep the current one so Andy stays signed in)
  if (signOutOthers) {
    try {
      const formula = `AND(` +
        `{${SESSIONS.fields.user}}='${ctx.userRecordId}',` +
        `{${SESSIONS.fields.revokedAt}}=BLANK(),` +
        `OR({${SESSIONS.fields.expiresAt}}=BLANK(), IS_AFTER({${SESSIONS.fields.expiresAt}}, NOW()))` +
        `)`;
      const sessions = await listRecords(SESSIONS.tableId, { formula, maxRecords: 100 });
      for (const s of sessions) {
        if (s.id === ctx.sessionRecordId) continue; // skip the current session
        await revokeSession(s.id, 'password_reset').catch(() => {});
      }
    } catch (err) {
      // Best-effort — don't fail the request if cleanup falters
      console.error('[password/change] session cleanup failed:', err.message);
    }
  }

  // Confirmation email
  try {
    await sendPasswordChangedEmail({
      to: ctx.email,
      fullName: ctx.fullName,
      ip,
    });
  } catch (err) {
    console.error('[password/change] confirmation email failed:', err.message);
  }

  // Log success
  await logAuthEvent({
    type: AUTH_EVENTS.types.PASSWORD_CHANGE,
    success: true,
    userRecordId: ctx.userRecordId,
    clientRecordId: ctx.clientRecordId,
    ip, userAgent: ua,
    detail: { signOutOthers },
  }).catch(() => {});

  return jsonOk(res, { ok: true });
}
