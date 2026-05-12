/**
 * POST /api/identity/resend-invite
 *
 * Admin action: send a fresh invite to a staff member whose status is
 * still 'invited' (they haven't accepted the original invite yet).
 *
 * Body: { userId }
 * Returns: { ok: true }
 *
 * Security:
 *   - Caller must be widget_suite owner or admin
 *   - Target user must be in the same Client
 *   - Target user MUST be in 'invited' status (for active users, use
 *     send-reset instead)
 *   - Reuses the existing INVITES table mechanism — mints a new token,
 *     marks any pending tokens for the same email as revoked
 *   - Rate limited per inviter
 */

import { requireAuth, requireProductAccess } from '../_lib/auth/middleware.js';
import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent,
} from '../_lib/auth/http.js';
import { limiters } from '../_lib/auth/ratelimit.js';
import { getRecord, listRecords, createRecord, updateRecord } from '../_lib/auth/airtable.js';
import {
  USERS, INVITES, CLIENTS, PERMISSIONS, PRODUCTS, AUTH_EVENTS,
} from '../_lib/auth/schema.js';
import { generateSecureToken, hashToken } from '../_lib/auth/crypto.js';
import { sendInviteEmail } from '../_lib/auth/email.js';
import { logAuthEvent } from '../_lib/auth/audit.js';

const INVITE_LIFETIME_DAYS = 7;

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

  const rl = await limiters.inviteSend({ key: ctx.userRecordId });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many invites. Try again later.');
  }

  let userRec;
  try {
    userRec = await getRecord(USERS.tableId, userId);
  } catch (err) {
    if (err.status === 404) return jsonError(res, 404, 'not_found', 'User not found');
    throw err;
  }

  const userClientLinks = userRec.fields[USERS.fields.client] || [];
  if (!userClientLinks.includes(ctx.clientRecordId)) {
    return jsonError(res, 403, 'wrong_client', 'User is not in your client');
  }

  if (userRec.fields[USERS.fields.status] !== USERS.statuses.INVITED) {
    return jsonError(res, 400, 'not_invited', 'This user has already accepted. Use Send Reset Link to send a password reset.');
  }

  const email = String(userRec.fields[USERS.fields.email] || '').toLowerCase();
  const userRole = userRec.fields[USERS.fields.role] || USERS.roles.MEMBER;

  // Revoke any existing pending invites for this email (so old links stop working)
  try {
    const formula = `AND({${INVITES.fields.email}}='${email.replace(/'/g, "\\'")}',{${INVITES.fields.status}}='${INVITES.statuses.PENDING}')`;
    const existingInvites = await listRecords(INVITES.tableId, { formula, maxRecords: 20 });
    for (const inv of existingInvites) {
      await updateRecord(INVITES.tableId, inv.id, {
        [INVITES.fields.status]: INVITES.statuses.REVOKED,
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[identity/resend-invite] revoke old invites failed:', err.message);
    // Continue — worst case the old link still works for 7 days
  }

  // Look up client name for the email
  let clientName = '';
  try {
    const c = await getRecord(CLIENTS.tableId, ctx.clientRecordId);
    clientName = c.fields[CLIENTS.fields.clientName] || '';
  } catch {}

  // Mint a fresh invite token
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  await createRecord(INVITES.tableId, {
    [INVITES.fields.tokenHash]: tokenHash,
    [INVITES.fields.email]:     email,
    [INVITES.fields.client]:    [ctx.clientRecordId],
    [INVITES.fields.invitedBy]: [ctx.userRecordId],
    [INVITES.fields.role]:      userRole,
    [INVITES.fields.status]:    INVITES.statuses.PENDING,
    [INVITES.fields.expiresAt]: expiresAt.toISOString(),
    [INVITES.fields.created]:   new Date().toISOString(),
  });

  try {
    await sendInviteEmail({
      to: email,
      inviteToken: rawToken,
      inviterName: ctx.fullName || ctx.email,
      clientName,
      role: userRole,
    });
  } catch (err) {
    console.error('[identity/resend-invite] sendInviteEmail failed:', err.message);
    return jsonError(res, 500, 'email_failed', 'New token created but email failed to send. Try again.');
  }

  await logAuthEvent({
    type: AUTH_EVENTS.types.INVITE_SENT,
    success: true,
    userRecordId: ctx.userRecordId,
    clientRecordId: ctx.clientRecordId,
    emailAttempted: email,
    ip, userAgent: ua,
    detail: { role: userRole, invitedUserRecordId: userId, source: 'identity_console_resend' },
  }).catch(() => {});

  return jsonOk(res, { ok: true });
}
