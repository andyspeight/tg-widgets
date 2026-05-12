/**
 * POST /api/admin/clients/send-reset
 *
 * Cross-tenant admin action: trigger a password-reset email for a user in
 * a specific client (not the caller's own). Used from the Travelgenix
 * Control Client Detail page → Users tab.
 *
 * Body: { userId, clientId }
 * Returns: { ok: true }
 *
 * Security:
 *   - Caller must be widget_suite owner or admin
 *   - Target user must belong to the specified client (defence against
 *     id-guessing — won't reset users in unrelated clients)
 *   - Target user must NOT be 'invited' (those use resend-invite instead)
 *   - Same token mechanism as /api/auth/password/forgot
 *   - Rate limited per admin via forgot bucket
 *   - Logs PASSWORD_RESET_REQUEST event with source: 'admin_client_detail'
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent,
} from '../../_lib/auth/http.js';
import { limiters } from '../../_lib/auth/ratelimit.js';
import { getRecord, createRecord } from '../../_lib/auth/airtable.js';
import {
  USERS, INVITES, PERMISSIONS, PRODUCTS, AUTH_EVENTS,
} from '../../_lib/auth/schema.js';
import { generateSecureToken, hashToken } from '../../_lib/auth/crypto.js';
import { sendPasswordResetEmail } from '../../_lib/auth/email.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
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
  const clientId = String(body.clientId || '');
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  if (!REC_ID_RE.test(userId)) {
    return jsonError(res, 400, 'invalid_user_id', 'Invalid userId');
  }
  if (!REC_ID_RE.test(clientId)) {
    return jsonError(res, 400, 'invalid_client_id', 'Invalid clientId');
  }

  // Rate limit per admin
  const rl = await limiters.forgot({ key: ctx.userRecordId });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many reset emails. Try again later.');
  }

  // Look up target user
  let userRec;
  try {
    userRec = await getRecord(USERS.tableId, userId);
  } catch (err) {
    if (err?.status === 404) return jsonError(res, 404, 'not_found', 'User not found');
    throw err;
  }

  // Verify target user belongs to the specified client
  const userClients = userRec.fields[USERS.fields.client] || [];
  if (!userClients.includes(clientId)) {
    return jsonError(res, 404, 'not_found', 'User not found in that client');
  }

  // Refuse invited-status users
  if (userRec.fields[USERS.fields.status] === USERS.statuses.INVITED) {
    return jsonError(res, 400, 'still_invited',
      'This user has not accepted their invite yet. Use Resend Invite instead.');
  }

  const email = String(userRec.fields[USERS.fields.email] || '').toLowerCase();
  const fullName = userRec.fields[USERS.fields.fullName] || '';

  // Mint reset token (same mechanism as /api/auth/password/forgot)
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_LIFETIME_HOURS * 60 * 60 * 1000);

  await createRecord(INVITES.tableId, {
    [INVITES.fields.tokenHash]: tokenHash,
    [INVITES.fields.email]:     email,
    [INVITES.fields.client]:    [clientId],
    [INVITES.fields.invitedBy]: [ctx.userRecordId],
    [INVITES.fields.role]:      userRec.fields[USERS.fields.role] || USERS.roles.MEMBER,
    [INVITES.fields.status]:    INVITES.statuses.PENDING,
    [INVITES.fields.expiresAt]: expiresAt.toISOString(),
    [INVITES.fields.created]:   new Date().toISOString(),
  });

  try {
    await sendPasswordResetEmail({ to: email, resetToken: rawToken, fullName });
  } catch (err) {
    console.error('[admin/clients/send-reset] email failed:', err.message);
    // Don't roll back — admin can retry
  }

  await logAuthEvent({
    type: AUTH_EVENTS.types.PASSWORD_RESET_REQUEST,
    success: true,
    userRecordId: userId,
    clientRecordId: clientId,
    emailAttempted: email,
    ip, userAgent: ua,
    detail: {
      triggeredBy: ctx.userRecordId,
      source: 'admin_client_detail',
    },
  }).catch(() => {});

  return jsonOk(res, { ok: true });
}
