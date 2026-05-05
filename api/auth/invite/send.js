/**
 * POST /api/auth/invite/send
 *
 * Body: { email, role: 'admin' | 'member' }
 * Returns: { ok: true }
 *
 * Security:
 *   - Caller must be admin or owner of a client workspace
 *   - Cannot invite an email that already has a User
 *   - Cannot invite as 'owner' — owners are created at signup or transferred
 *   - Rate limited per user (30 per hour)
 *   - Token is 256-bit, stored hashed
 *   - Creates a 'invited' status User row up front, plus the Invite token
 *   - 7-day expiry
 */

import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent, isValidEmail, normaliseEmail
} from '../../_lib/auth/http.js';
import { limiters } from '../../_lib/auth/ratelimit.js';
import { requireAdmin } from '../../_lib/auth/middleware.js';
import { findOneByField, createRecord, getRecord } from '../../_lib/auth/airtable.js';
import { USERS, INVITES, CLIENTS, AUTH_EVENTS } from '../../_lib/auth/schema.js';
import { generateSecureToken, hashToken } from '../../_lib/auth/crypto.js';
import { sendInviteEmail } from '../../_lib/auth/email.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';

const INVITE_LIFETIME_DAYS = 7;
const ALLOWED_ROLES = [USERS.roles.ADMIN, USERS.roles.MEMBER];

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid request body');

  const email = normaliseEmail(body.email);
  const role = String(body.role || '').toLowerCase();
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  if (!isValidEmail(email)) {
    return jsonError(res, 400, 'invalid_email', 'Valid email required');
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return jsonError(res, 400, 'invalid_role', 'Role must be admin or member');
  }

  const rl = await limiters.inviteSend({ key: ctx.userRecordId });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many invites. Try again later.');
  }

  // Already a user?
  const existing = await findOneByField(USERS.tableId, USERS.fields.email, email);
  if (existing) {
    // If they're already in this workspace, idempotent ok. Otherwise refuse.
    const existingClient = (existing.fields[USERS.fields.client] || [])[0];
    if (existingClient === ctx.clientRecordId) {
      return jsonOk(res, { alreadyMember: true });
    }
    return jsonError(res, 409, 'email_taken', 'That email already has an account elsewhere');
  }

  // Load client name for the email
  let clientName = '';
  try {
    const c = await getRecord(CLIENTS.tableId, ctx.clientRecordId);
    clientName = c.fields[CLIENTS.fields.clientName] || '';
  } catch {}

  // 1. Create an 'invited' User row
  const userRec = await createRecord(USERS.tableId, {
    [USERS.fields.email]:       email,
    [USERS.fields.client]:      [ctx.clientRecordId],
    [USERS.fields.role]:        role,
    [USERS.fields.status]:      USERS.statuses.INVITED,
    [USERS.fields.authMethods]: [],
    [USERS.fields.created]:     new Date().toISOString()
  });

  // 2. Create the Invite token
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  await createRecord(INVITES.tableId, {
    [INVITES.fields.tokenHash]: tokenHash,
    [INVITES.fields.email]:     email,
    [INVITES.fields.client]:    [ctx.clientRecordId],
    [INVITES.fields.invitedBy]: [ctx.userRecordId],
    [INVITES.fields.role]:      role,
    [INVITES.fields.status]:    INVITES.statuses.PENDING,
    [INVITES.fields.expiresAt]: expiresAt.toISOString(),
    [INVITES.fields.created]:   new Date().toISOString()
  });

  // 3. Send the email
  try {
    await sendInviteEmail({
      to: email,
      inviteToken: rawToken,
      inviterName: ctx.fullName || ctx.email,
      clientName,
      role
    });
  } catch (err) {
    console.error('[invite/send] email failed:', err.message);
    // Don't roll back — the admin can resend if needed
  }

  await logAuthEvent({
    type: AUTH_EVENTS.types.INVITE_SENT,
    success: true,
    userRecordId: ctx.userRecordId,
    clientRecordId: ctx.clientRecordId,
    emailAttempted: email,
    ip, userAgent: ua,
    detail: { role, invitedUserRecordId: userRec.id }
  });

  return jsonOk(res, { invitedUserRecordId: userRec.id });
}
