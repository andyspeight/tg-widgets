/**
 * POST /api/auth/invite/accept
 *
 * Body: { token, fullName, password }
 * Returns: { ok: true, token: <session-jwt>, user, client }
 *
 * Three modes (decided by the lookup):
 *   - invite: no User exists yet — fill in fullName + password on the
 *     'invited'-status User row, mark accepted, sign in
 *   - set_password: User exists in 'invited' status with no password — same
 *     as above. (Edge case if invite/send and accept rows get out of sync.)
 *   - reset: existing User with password hash — this branch shouldn't be
 *     hit through invite/accept; the client should redirect to the reset flow.
 *     We still handle it: treat it like a password reset.
 *
 * Security:
 *   - Rate limited per IP (5 per hour)
 *   - Token single-use; marked accepted on success
 *   - Expiry checked
 *   - Password strength enforced
 *   - On success, signs in immediately (creates a session and JWT)
 */

import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent, isValidPassword, passwordValidationMessage
} from '../../_lib/auth/http.js';
import { limiters } from '../../_lib/auth/ratelimit.js';
import {
  findOneByField, updateRecord, createRecord, getRecord
} from '../../_lib/auth/airtable.js';
import { USERS, INVITES, SESSIONS, CLIENTS, AUTH_EVENTS } from '../../_lib/auth/schema.js';
import { hashToken, hashPassword, signSessionToken, uuid } from '../../_lib/auth/crypto.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid request body');

  const rawToken = typeof body.token === 'string' ? body.token : '';
  const fullName = String(body.fullName || '').trim().slice(0, 100);
  const password = body.password;
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  if (!rawToken) return jsonError(res, 400, 'invalid_token', 'Invitation link is invalid');
  if (!fullName) return jsonError(res, 400, 'invalid_name', 'Full name required');
  if (!isValidPassword(password)) {
    return jsonError(res, 400, 'invalid_password', passwordValidationMessage());
  }

  const rl = await limiters.inviteAccept({ key: ip });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many attempts. Try again later.');
  }

  // Look up the invite
  const tokenHash = hashToken(rawToken);
  const inviteRec = await findOneByField(INVITES.tableId, INVITES.fields.tokenHash, tokenHash);
  if (!inviteRec) return jsonError(res, 400, 'invalid_token', 'Invitation is invalid');

  const inv = inviteRec.fields;
  if (inv[INVITES.fields.status] !== INVITES.statuses.PENDING) {
    return jsonError(res, 400, 'invalid_token', 'Invitation has already been used');
  }
  const expiresAt = inv[INVITES.fields.expiresAt];
  if (!expiresAt || new Date(expiresAt) < new Date()) {
    await updateRecord(INVITES.tableId, inviteRec.id, {
      [INVITES.fields.status]: INVITES.statuses.EXPIRED
    }).catch(() => {});
    return jsonError(res, 400, 'expired_token', 'Invitation has expired');
  }

  const email = String(inv[INVITES.fields.email] || '').toLowerCase();
  const role = inv[INVITES.fields.role] || USERS.roles.MEMBER;
  const clientRecordId = (inv[INVITES.fields.client] || [])[0];

  // Find or create the User
  let userRec = await findOneByField(USERS.tableId, USERS.fields.email, email);
  const newHash = await hashPassword(password);
  const nowIso = new Date().toISOString();

  if (userRec) {
    // Existing User (invited or migrated). Set password + activate.
    const existingMethods = userRec.fields[USERS.fields.authMethods] || [];
    const methods = existingMethods.includes(USERS.authMethodValues.PASSWORD)
      ? existingMethods
      : [...existingMethods, USERS.authMethodValues.PASSWORD];

    await updateRecord(USERS.tableId, userRec.id, {
      [USERS.fields.fullName]:           fullName,
      [USERS.fields.passwordHash]:       newHash,
      [USERS.fields.status]:             USERS.statuses.ACTIVE,
      [USERS.fields.forcePasswordReset]: false,
      [USERS.fields.authMethods]:        methods
    });
  } else {
    // No User yet — create one. (Should be rare since invite/send creates
    // the row up front, but defend against it anyway.)
    userRec = await createRecord(USERS.tableId, {
      [USERS.fields.email]:        email,
      [USERS.fields.client]:       clientRecordId ? [clientRecordId] : [],
      [USERS.fields.fullName]:     fullName,
      [USERS.fields.passwordHash]: newHash,
      [USERS.fields.role]:         role,
      [USERS.fields.status]:       USERS.statuses.ACTIVE,
      [USERS.fields.authMethods]:  [USERS.authMethodValues.PASSWORD],
      [USERS.fields.created]:      nowIso
    });
  }

  // Mark invite accepted
  await updateRecord(INVITES.tableId, inviteRec.id, {
    [INVITES.fields.status]:     INVITES.statuses.ACCEPTED,
    [INVITES.fields.acceptedAt]: nowIso
  });

  // Sign in: create session + JWT
  const sessionId = uuid();
  const { token, jti, expiresAt: jwtExpires } = signSessionToken({
    userId: userRec.id,
    clientId: clientRecordId,
    role,
    sessionId
  });

  await createRecord(SESSIONS.tableId, {
    [SESSIONS.fields.sessionId]: sessionId,
    [SESSIONS.fields.user]:      [userRec.id],
    [SESSIONS.fields.jwtJti]:    jti,
    [SESSIONS.fields.userAgent]: ua,
    [SESSIONS.fields.ipAddress]: ip,
    [SESSIONS.fields.created]:   nowIso,
    [SESSIONS.fields.expiresAt]: jwtExpires.toISOString(),
    [SESSIONS.fields.lastUsed]:  nowIso
  });

  // Update last-login on User
  updateRecord(USERS.tableId, userRec.id, {
    [USERS.fields.lastLogin]:   nowIso,
    [USERS.fields.lastLoginIp]: ip
  }).catch(() => {});

  // Build client payload
  let clientPayload = null;
  if (clientRecordId) {
    try {
      const c = await getRecord(CLIENTS.tableId, clientRecordId);
      clientPayload = {
        recordId: c.id,
        clientName: c.fields[CLIENTS.fields.clientName] || '',
        plan: c.fields[CLIENTS.fields.plan] || ''
      };
    } catch {}
  }

  await logAuthEvent({
    type: AUTH_EVENTS.types.INVITE_ACCEPTED,
    success: true,
    userRecordId: userRec.id,
    clientRecordId,
    emailAttempted: email,
    ip, userAgent: ua
  });

  return jsonOk(res, {
    token,
    user: { email, fullName, role, mustResetPassword: false },
    client: clientPayload
  });
}
