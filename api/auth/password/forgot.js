/**
 * POST /api/auth/password/forgot
 *
 * Body: { email }
 * Returns: always { ok: true } regardless of whether the email exists.
 *
 * Security:
 *   - Always returns 200 — no email enumeration
 *   - Rate limited per IP (5 per hour)
 *   - Token is 256-bit random, stored hashed in Invites table
 *   - 1 hour expiry
 *   - Sending failures are silent to the client (logged server-side)
 */

import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent, isValidEmail, normaliseEmail
} from '../../_lib/auth/http.js';
import { limiters } from '../../_lib/auth/ratelimit.js';
import { findOneByField, createRecord } from '../../_lib/auth/airtable.js';
import { USERS, INVITES, AUTH_EVENTS } from '../../_lib/auth/schema.js';
import { generateSecureToken, hashToken } from '../../_lib/auth/crypto.js';
import { sendPasswordResetEmail } from '../../_lib/auth/email.js';
import { logAuthEvent } from '../../_lib/auth/audit.js';

const RESET_LIFETIME_HOURS = 1;

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid request body');

  const email = normaliseEmail(body.email);
  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  // Validate format (cheap) — but if it's malformed, still respond ok
  // to prevent format-based enumeration. We just won't do any work.
  if (!isValidEmail(email)) return jsonOk(res);

  const rl = await limiters.forgot({ key: ip });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many requests. Try again later.');
  }

  const userRec = await findOneByField(USERS.tableId, USERS.fields.email, email);

  // Whether or not the user exists, we return ok. Only do work if they do.
  if (userRec) {
    try {
      const rawToken = generateSecureToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_LIFETIME_HOURS * 60 * 60 * 1000);
      const clientRecordId = (userRec.fields[USERS.fields.client] || [])[0];

      await createRecord(INVITES.tableId, {
        [INVITES.fields.tokenHash]: tokenHash,
        [INVITES.fields.email]:     email,
        [INVITES.fields.client]:    clientRecordId ? [clientRecordId] : [],
        [INVITES.fields.invitedBy]: [userRec.id], // self-initiated
        [INVITES.fields.role]:      userRec.fields[USERS.fields.role] || USERS.roles.MEMBER,
        [INVITES.fields.status]:    INVITES.statuses.PENDING,
        [INVITES.fields.expiresAt]: expiresAt.toISOString(),
        [INVITES.fields.created]:   new Date().toISOString()
      });

      await sendPasswordResetEmail({
        to: email,
        resetToken: rawToken,
        fullName: userRec.fields[USERS.fields.fullName] || ''
      });

      await logAuthEvent({
        type: AUTH_EVENTS.types.PASSWORD_RESET_REQUEST,
        success: true,
        userRecordId: userRec.id,
        clientRecordId,
        emailAttempted: email,
        ip, userAgent: ua
      });
    } catch (err) {
      console.error('[forgot-password] error:', err.message);
      await logAuthEvent({
        type: AUTH_EVENTS.types.PASSWORD_RESET_REQUEST,
        success: false,
        userRecordId: userRec.id,
        emailAttempted: email,
        ip, userAgent: ua,
        detail: { error: err.message }
      });
      // Still return ok to client
    }
  } else {
    await logAuthEvent({
      type: AUTH_EVENTS.types.PASSWORD_RESET_REQUEST,
      success: false,
      emailAttempted: email,
      ip, userAgent: ua,
      detail: { reason: 'unknown_email' }
    });
  }

  return jsonOk(res);
}
