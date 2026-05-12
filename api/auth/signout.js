/**
 * POST /api/auth/signout
 *
 * Revokes the current session and clears the tg_session cookie.
 *
 * Note: this file was previously a duplicate of me.js (copy-paste bug);
 * sign out would silently fail. This is the proper implementation.
 *
 * For "sign out everywhere", use /api/auth/signout-all.
 */

import {
  setCors, requireMethod, jsonOk,
  getRequestIp, getUserAgent,
} from '../_lib/auth/http.js';
import { requireAuth } from '../_lib/auth/middleware.js';
import { revokeSession } from '../_lib/auth/sessions.js';
import { clearSessionCookie } from '../_lib/auth/cookie.js';
import { logAuthEvent } from '../_lib/auth/audit.js';
import { AUTH_EVENTS } from '../_lib/auth/schema.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return; // requireAuth already wrote a 401

  if (ctx.sessionRecordId) {
    revokeSession(ctx.sessionRecordId, 'signout')
      .catch((err) => console.error('[auth/signout] revoke failed:', err.message));
  }

  logAuthEvent({
    type: AUTH_EVENTS.types.SIGNOUT, success: true,
    userRecordId: ctx.userRecordId,
    clientRecordId: ctx.clientRecordId,
    ip: getRequestIp(req),
    userAgent: getUserAgent(req),
  }).catch(() => {});

  clearSessionCookie(res, { req });

  return jsonOk(res, { ok: true });
}
