/**
 * POST /api/auth/password/reset
 *
 * Body: { token, newPassword }
 * Returns: { ok: true }
 *
 * Security:
 *   - Token looked up by SHA-256 hash, never raw
 *   - Single-use: marked accepted on success
 *   - Expiry checked
 *   - Password strength checked (>=10 chars, <=72 bytes)
 *   - All sessions for the user revoked after reset (forced re-login)
 *   - Rate limited per IP (10 per hour)
 *   - Confirmation email sent on success
 */

import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent, isValidPassword, passwordValidationMessage
} from '../../_lib/auth/http.js';
import { limiters } from '../../_lib/auth/ratelimit.js';
import { findOneByField, getRecord, updateRecord } from '../../_lib/auth/airtable.js';
import { USERS, INVITES, AUTH_EVENTS, SESSIONS } from '../../_lib/auth/schema.js';
import { hashToken, hashPassword } from '../../_lib/auth/crypto.js';
import { revokeAllUserSessions } from '../../_lib/auth/sessions.js';
import { sendPasswordChangedEmail } from '../../_lib/auth/email.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid request body');

  const rawToken = typeof body.token === 'string' ? body.token : '';
  const newPassword = body.newPassword;
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  if (!rawToken) {
    return jsonError(res, 400, 'invalid_token', 'Reset link is invalid');
  }
  if (!isValidPassword(newPassword)) {
    return jsonError(res, 400, 'invalid_password', passwordValidationMessage());
  }

  const rl = await limiters.resetPassword({ key: ip });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many attempts. Try again later.');
  }

  // Look up the invite/reset record by token hash
  const tokenHash = hashToken(rawToken);
  const inviteRec = await findOneByField(INVITES.tableId, INVITES.fields.tokenHash, tokenHash);

  if (!inviteRec) {
    return jsonError(res, 400, 'invalid_token', 'Reset link is invalid or has been used');
  }

  const inv = inviteRec.fields;
  if (inv[INVITES.fields.status] !== INVITES.statuses.PENDING) {
    return jsonError(res, 400, 'invalid_token', 'Reset link is invalid or has been used');
  }

  const expiresAt = inv[INVITES.fields.expiresAt];
  if (!expiresAt || new Date(expiresAt) < new Date()) {
    // Mark expired so it can't be retried
    await updateRecord(INVITES.tableId, inviteRec.id, {
      [INVITES.fields.status]: INVITES.statuses.EXPIRED
    }).catch(() => {});
    return jsonError(res, 400, 'expired_token', 'Reset link has expired');
  }

  // Find the User by email
  const email = String(inv[INVITES.fields.email] || '').toLowerCase();
  const userRec = await findOneByField(USERS.tableId, USERS.fields.email, email);

  if (!userRec) {
    // Should not happen — invite without matching user. Mark revoked.
    await updateRecord(INVITES.tableId, inviteRec.id, {
      [INVITES.fields.status]: INVITES.statuses.REVOKED
    }).catch(() => {});
    return jsonError(res, 400, 'invalid_token', 'Reset link is invalid');
  }

  // Hash the new password
  const newHash = await hashPassword(newPassword);
  const clientRecordId = (userRec.fields[USERS.fields.client] || [])[0];

  // Update the user
  const existingMethods = userRec.fields[USERS.fields.authMethods] || [];
  const methods = existingMethods.includes(USERS.authMethodValues.PASSWORD)
    ? existingMethods
    : [...existingMethods, USERS.authMethodValues.PASSWORD];

  await updateRecord(USERS.tableId, userRec.id, {
    [USERS.fields.passwordHash]:       newHash,
    [USERS.fields.forcePasswordReset]: false,
    [USERS.fields.authMethods]:        methods,
    // If they were 'invited' (never set a password), promote to 'active'
    [USERS.fields.status]:             USERS.statuses.ACTIVE
  });

  // Mark the invite as accepted so it can't be reused
  await updateRecord(INVITES.tableId, inviteRec.id, {
    [INVITES.fields.status]:     INVITES.statuses.ACCEPTED,
    [INVITES.fields.acceptedAt]: new Date().toISOString()
  });

  // Revoke all existing sessions — force re-login everywhere
  await revokeAllUserSessions(userRec.id, SESSIONS.revokeReasons.PASSWORD_RESET);

  // Confirmation email (best effort)
  sendPasswordChangedEmail({
    to: email,
    fullName: userRec.fields[USERS.fields.fullName] || '',
    ip
  }).catch(err => console.error('[reset] confirmation email failed:', err.message));

  await logAuthEvent({
    type: AUTH_EVENTS.types.PASSWORD_RESET_COMPLETE,
    success: true,
    userRecordId: userRec.id,
    clientRecordId,
    emailAttempted: email,
    ip, userAgent: ua
  });

  return jsonOk(res);
}
