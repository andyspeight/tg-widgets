/**
 * GET /api/auth/invite/info?token=...
 *
 * Returns the invitee email and company name so the accept-invite page can
 * show "You've been invited to join Acme Travel as a member".
 *
 * Returns minimal info — does not leak the user's password hash or full name.
 *
 * NOTE: this endpoint serves both real invites and migration password-reset
 * tokens. The UI uses the `mode` field to pick the right screen.
 */
import {
  setCors, requireMethod, jsonOk, jsonError
} from '../../_lib/auth/http.js';
import { findOneByField, getRecord } from '../../_lib/auth/airtable.js';
import { INVITES, CLIENTS, USERS } from '../../_lib/auth/schema.js';
import { hashToken } from '../../_lib/auth/crypto.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'GET')) return;

  const rawToken = (req.query && req.query.token) || new URL(req.url, 'http://x').searchParams.get('token') || '';
  if (!rawToken || typeof rawToken !== 'string') {
    return jsonError(res, 400, 'invalid_token', 'Token required');
  }

  const tokenHash = hashToken(rawToken);
  const inviteRec = await findOneByField(INVITES.tableId, INVITES.fields.tokenHash, tokenHash);
  if (!inviteRec) {
    return jsonError(res, 404, 'invalid_token', 'Invitation not found');
  }
  const inv = inviteRec.fields;

  if (inv[INVITES.fields.status] !== INVITES.statuses.PENDING) {
    return jsonError(res, 410, 'used_token', 'Invitation has already been used or revoked');
  }

  const expiresAt = inv[INVITES.fields.expiresAt];
  if (!expiresAt || new Date(expiresAt) < new Date()) {
    return jsonError(res, 410, 'expired_token', 'Invitation has expired');
  }

  const email = String(inv[INVITES.fields.email] || '').toLowerCase();
  const role = inv[INVITES.fields.role] || USERS.roles.MEMBER;

  // Determine mode: existing user with hash → 'reset', existing user without → 'set_password',
  // no user yet → 'invite'
  const userRec = await findOneByField(USERS.tableId, USERS.fields.email, email);
  const mode = userRec && userRec.fields[USERS.fields.passwordHash] ? 'reset'
             : userRec ? 'set_password'
             : 'invite';

  // Look up client name
  let clientName = '';
  const clientRecordId = (inv[INVITES.fields.client] || [])[0];
  if (clientRecordId) {
    try {
      const c = await getRecord(CLIENTS.tableId, clientRecordId);
      clientName = c.fields[CLIENTS.fields.clientName] || '';
    } catch {}
  }

  return jsonOk(res, {
    mode,
    email,
    role,
    clientName,
    fullName: userRec?.fields[USERS.fields.fullName] || ''
  });
}
