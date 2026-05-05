/**
 * POST /api/auth/signin
 *
 * Body: { email, password }
 * Returns: { ok: true, token, user, client, mustResetPassword }
 *
 * Security:
 *   - Rate limited per IP+email (10 per 10min)
 *   - Generic error messages — never leak whether the email exists
 *   - bcrypt verification uses dummy hash on unknown email for timing parity
 *   - Failed attempts logged with email_attempted for pattern detection
 *   - Suspended accounts cannot sign in
 *   - forcePasswordReset users sign in but get a flag back; the UI must
 *     redirect them to set a new password before letting them do anything
 */

import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent, isValidEmail, normaliseEmail
} from '../_lib/auth/http.js';
import { limiters } from '../_lib/auth/ratelimit.js';
import { findOneByField, getRecord, updateRecord, createRecord } from '../_lib/auth/airtable.js';
import { USERS, CLIENTS, SESSIONS, AUTH_EVENTS } from '../_lib/auth/schema.js';
import { verifyPassword, signSessionToken, uuid } from '../_lib/auth/crypto.js';
import { logAuthEvent } from '../_lib/auth/audit.js';

const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789ABCDEFGHIJKLMNOPQRSTUV01234';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid request body');

  const email = normaliseEmail(body.email);
  const password = body.password;
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  if (!isValidEmail(email) || typeof password !== 'string' || !password) {
    return jsonError(res, 400, 'invalid_input', 'Email and password required');
  }

  const rl = await limiters.signin({ key: `${ip}|${email}` });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many attempts. Try again later.');
  }

  const userRec = await findOneByField(USERS.tableId, USERS.fields.email, email);

  let valid = false;
  let userFields = null;
  if (userRec) {
    userFields = userRec.fields;
    const hash = userFields[USERS.fields.passwordHash];
    valid = hash ? await verifyPassword(password, hash) : false;
    if (!hash) await verifyPassword(password, DUMMY_HASH); // timing parity
  } else {
    await verifyPassword(password, DUMMY_HASH);
  }

  if (!valid) {
    await logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_FAIL,
      success: false,
      userRecordId: userRec?.id,
      emailAttempted: email,
      ip, userAgent: ua,
      detail: { reason: userRec ? 'bad_password' : 'unknown_email' }
    });
    return jsonError(res, 401, 'invalid_credentials', 'Email or password is incorrect');
  }

  if (userFields[USERS.fields.status] === USERS.statuses.SUSPENDED) {
    await logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_FAIL,
      success: false,
      userRecordId: userRec.id,
      emailAttempted: email,
      ip, userAgent: ua,
      detail: { reason: 'suspended' }
    });
    return jsonError(res, 403, 'suspended', 'Account suspended. Contact support.');
  }

  const clientRecordId = (userFields[USERS.fields.client] || [])[0];
  const role = userFields[USERS.fields.role] || USERS.roles.MEMBER;
  const fullName = userFields[USERS.fields.fullName] || '';
  const mustResetPassword = !!userFields[USERS.fields.forcePasswordReset];

  const sessionId = uuid();
  const { token, jti, expiresAt } = signSessionToken({
    userId: userRec.id,
    clientId: clientRecordId,
    role,
    sessionId
  });

  const nowIso = new Date().toISOString();
  await createRecord(SESSIONS.tableId, {
    [SESSIONS.fields.sessionId]: sessionId,
    [SESSIONS.fields.user]:      [userRec.id],
    [SESSIONS.fields.jwtJti]:    jti,
    [SESSIONS.fields.userAgent]: ua,
    [SESSIONS.fields.ipAddress]: ip,
    [SESSIONS.fields.created]:   nowIso,
    [SESSIONS.fields.expiresAt]: expiresAt.toISOString(),
    [SESSIONS.fields.lastUsed]:  nowIso
  });

  updateRecord(USERS.tableId, userRec.id, {
    [USERS.fields.lastLogin]:   nowIso,
    [USERS.fields.lastLoginIp]: ip
  }).catch(() => {});

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
    type: AUTH_EVENTS.types.SIGNIN_SUCCESS,
    success: true,
    userRecordId: userRec.id,
    clientRecordId,
    emailAttempted: email,
    ip, userAgent: ua
  });

  return jsonOk(res, {
    token,
    user: { email, fullName, role, mustResetPassword },
    client: clientPayload
  });
}
