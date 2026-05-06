/**
 * Shared invite helper for admin-side onboarding flows.
 *
 * The existing /api/auth/invite/send endpoint can only invite users into the
 * caller's own workspace (caller's clientRecordId). The admin onboarding flow
 * creates brand-new clients and needs to invite a user into a different
 * client, so we need a parallel helper that takes the target clientRecordId
 * as an explicit param.
 *
 * Mirrors the same security model:
 *   - Creates an 'invited' User row
 *   - Creates an Invite token (256-bit random, stored hashed)
 *   - Sends an email via the shared sendInviteEmail helper
 *   - 7-day expiry to match the rest of the auth system
 *
 * Returns:
 *   { ok: true, userRecordId, inviteRecordId }
 *
 * Throws on failure. Caller is responsible for catching and rolling back any
 * upstream work if needed.
 */

import {
  findOneByField,
  createRecord,
  getRecord,
} from '../../_lib/auth/airtable.js';
import {
  USERS,
  INVITES,
  CLIENTS,
} from '../../_lib/auth/schema.js';
import { generateSecureToken, hashToken } from '../../_lib/auth/crypto.js';
import { sendInviteEmail } from '../../_lib/auth/email.js';

const INVITE_LIFETIME_DAYS = 7;
const ALLOWED_ROLES = new Set([USERS.roles.OWNER, USERS.roles.ADMIN, USERS.roles.MEMBER]);

/**
 * Send an invite to a specific client workspace.
 *
 * @param {object} opts
 * @param {string} opts.email — invitee's email (will be normalised)
 * @param {string} opts.role — one of 'owner' | 'admin' | 'member'
 * @param {string} opts.targetClientRecordId — Airtable record id of the client they're being invited into
 * @param {string} opts.invitedByUserRecordId — record id of the inviter (for audit + email signature)
 * @param {string} [opts.fullName] — invitee's display name to seed on the User row
 * @param {string} [opts.inviterName] — display name shown in the invite email
 * @returns {Promise<{ ok: true, userRecordId: string, inviteRecordId: string, alreadyMember?: boolean }>}
 */
export async function sendAdminInvite(opts) {
  const email = String(opts.email || '').trim().toLowerCase();
  const role = String(opts.role || '').toLowerCase();
  const targetClientRecordId = String(opts.targetClientRecordId || '').trim();
  const invitedByUserRecordId = String(opts.invitedByUserRecordId || '').trim();
  const fullName = (opts.fullName || '').trim();
  const inviterName = (opts.inviterName || '').trim();

  if (!email || !email.includes('@')) {
    throw new Error('sendAdminInvite: invalid email');
  }
  if (!ALLOWED_ROLES.has(role)) {
    throw new Error(`sendAdminInvite: invalid role "${role}"`);
  }
  if (!/^rec[A-Za-z0-9]{14}$/.test(targetClientRecordId)) {
    throw new Error('sendAdminInvite: invalid targetClientRecordId');
  }

  // Idempotency: if there's already a User with this email assigned to this
  // client, don't double-invite.
  const existingUser = await findOneByField(USERS.tableId, USERS.fields.email, email);
  if (existingUser) {
    const existingClientIds = existingUser.fields[USERS.fields.client] || [];
    if (existingClientIds.includes(targetClientRecordId)) {
      return {
        ok: true,
        alreadyMember: true,
        userRecordId: existingUser.id,
        inviteRecordId: null,
      };
    }
    // Same email exists at a different client — refuse so we don't silently
    // hijack their account.
    const err = new Error(`Email ${email} already has an account elsewhere`);
    err.code = 'email_taken';
    throw err;
  }

  // Load client name for the email body
  let clientName = '';
  try {
    const clientRec = await getRecord(CLIENTS.tableId, targetClientRecordId);
    clientName = clientRec.fields[CLIENTS.fields.clientName] || '';
  } catch (err) {
    console.warn('[sendAdminInvite] could not load client name:', err.message);
  }

  // 1. Create the invited User row
  const userRec = await createRecord(USERS.tableId, {
    [USERS.fields.email]:       email,
    [USERS.fields.client]:      [targetClientRecordId],
    [USERS.fields.fullName]:    fullName || '',
    [USERS.fields.role]:        role,
    [USERS.fields.status]:      USERS.statuses.INVITED,
    [USERS.fields.authMethods]: [],
    [USERS.fields.created]:     new Date().toISOString(),
  });

  // 2. Generate the token + create the Invite row
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  const inviteRec = await createRecord(INVITES.tableId, {
    [INVITES.fields.tokenHash]: tokenHash,
    [INVITES.fields.email]:     email,
    [INVITES.fields.client]:    [targetClientRecordId],
    [INVITES.fields.invitedBy]: [invitedByUserRecordId],
    [INVITES.fields.role]:      role,
    [INVITES.fields.status]:    INVITES.statuses.PENDING,
    [INVITES.fields.expiresAt]: expiresAt.toISOString(),
    [INVITES.fields.created]:   new Date().toISOString(),
  });

  // 3. Send the email — non-fatal if it fails
  try {
    await sendInviteEmail({
      to: email,
      inviteToken: rawToken,
      inviterName: inviterName || 'Travelgenix',
      clientName,
      role,
    });
  } catch (err) {
    console.error('[sendAdminInvite] email send failed:', err.message);
    // Don't throw — the User and Invite rows are good. Admin can resend later.
  }

  return {
    ok: true,
    userRecordId: userRec.id,
    inviteRecordId: inviteRec.id,
  };
}
