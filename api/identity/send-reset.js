/**
 * POST /api/identity/send-reset
 *
 * Admin action: trigger a password-reset email for a staff member.
 * Used by the "Send reset link" button on a staff row.
 *
 * Body: { userId }
 * Returns: { ok: true }
 *
 * Security:
 *   - Caller must be widget_suite owner or admin
 *   - Target user must be in the same Client as the caller
 *   - Target user must have an active/suspended status (not invited — for
 *     invited users use Resend Invite instead)
 *   - Token mechanics identical to /api/auth/password/forgot
 *   - Auth event logged
 *
 * This is a separate endpoint from /api/auth/password/forgot because:
 *   1. forgot is gated only on email (no auth) and rate limited per IP
 *   2. this is gated on admin auth and rate limited per inviter
 *   3. this can be used even when there's no email-enumeration concern
 *      because the admin already knows which users exist
 */

import { requireAuth, requireProductAccess } from '../_lib/auth/middleware.js';
import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent,
} from '../_lib/auth/http.js';
import { limiters } from '../_lib/auth/ratelimit.js';
import { getRecord, createRecord } from '../_lib/auth/airtable.js';
import {
  USERS, INVITES, CLIENTS, PERMISSIONS, PRODUCTS, AUTH_EVENTS,
} from '../_lib/auth/schema.js';
import { generateSecureToken, hashToken } from '../_lib/auth/crypto.js';
import { sendPasswordResetEmail } from '../_lib/auth/email.js';
import { logAuthEvent } from '../_lib/auth/audit.js';

const RESET_LIFETIME_HOURS = 1;

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const role = requireProductAccess(
    ctx,
    PRODUCTS.slugs.WIDGET_SUITE,
    [PERMISSIONS.roles.OWNER, PERMISSIONS.roles.ADMIN],
    res
  );
  if (!role) return;

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid JSON body');

  const userId = String(body.userId || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(userId)) {
    return jsonError(res, 400, 'bad_user_id', 'Invalid userId');
  }

  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  // Rate limit per admin to prevent abuse
  const rl = await limiters.forgot({ key: ctx.userRecordId });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many reset emails. Try again later.');
  }

  // Look up the target user
  let userRec;
  try {
    userRec = await getRecord(USERS.tableId, userId);
  } catch (err) {
    if (err.status === 404) return jsonError(res, 404, 'not_found', 'User not found');
    throw err;
  }

  // Must be in the same Client
  const userClientLinks = userRec.fields[USERS.fields.client] || [];
  if (!userClientLinks.includes(ctx.clientRecordId)) {
    return jsonError(res, 403, 'wrong_client', 'You can only reset passwords for users in your client');
  }

  // Refuse on invited-status users (they should accept the original invite,
  // or have a fresh one sent via Resend Invite)
  const userStatus = userRec.fields[USERS.fields.status];
  if (userStatus === USERS.statuses.INVITED) {
    return jsonError(res, 400, 'still_invited', 'This user has not accepted their invite yet. Use Resend Invite instead.');
  }

  const email = String(userRec.fields[USERS.fields.email] || '').toLowerCase();
  const fullName = userRec.fields[USERS.fields.fullName] || '';

  // Mint a reset token (same mechanism as /api/auth/password/forgot)
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_LIFETIME_HOURS * 60 * 60 * 1000);

  await createRecord(INVITES.tableId, {
    [INVITES.fields.tokenHash]: tokenHash,
    [INVITES.fields.email]:     email,
    [INVITES.fields.client]:    userClientLinks,
    [INVITES.fields.invitedBy]: [ctx.userRecordId],
    [INVITES.fields.role]:      userRec.fields[USERS.fields.role] || USERS.roles.MEMBER,
    [INVITES.fields.status]:    INVITES.statuses.PENDING,
    [INVITES.fields.expiresAt]: expiresAt.toISOString(),
    [INVITES.fields.created]:   new Date().toISOString(),
  });

  // Send the reset email
  try {
    await sendPasswordResetEmail({ to: email, resetToken: rawToken, fullName });
  } catch (err) {
    console.error('[identity/send-reset] email failed:', err.message);
    // Don't roll back — admin can retry
  }

  await logAuthEvent({
    type: AUTH_EVENTS.types.PASSWORD_RESET_REQUEST,
    success: true,
    userRecordId: userId,
    clientRecordId: ctx.clientRecordId,
    emailAttempted: email,
    ip, userAgent: ua,
    detail: { triggeredBy: ctx.userRecordId, source: 'identity_console' },
  }).catch(() => {});

  return jsonOk(res, { ok: true });
}
