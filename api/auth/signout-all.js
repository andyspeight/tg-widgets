/**
 * POST /api/auth/signout-all
 *
 * Revokes every active session for the current user. Use cases:
 *   - "Sign out everywhere" button in account settings
 *   - After a password change (this endpoint is also called internally
 *     by /password/reset)
 */

import { setCors, requireMethod, jsonOk, getRequestIp, getUserAgent } from '../_lib/auth/http.js';
import { requireAuth } from '../_lib/auth/middleware.js';
import { revokeAllUserSessions } from '../_lib/auth/sessions.js';
import { logAuthEvent } from '../_lib/auth/audit.js';
import { AUTH_EVENTS, SESSIONS } from '../_lib/auth/schema.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const count = await revokeAllUserSessions(ctx.userRecordId, SESSIONS.revokeReasons.SIGNOUT_ALL);

  await logAuthEvent({
    type: AUTH_EVENTS.types.SIGNOUT_ALL,
    success: true,
    userRecordId: ctx.userRecordId,
    clientRecordId: ctx.clientRecordId,
    ip: getRequestIp(req),
    userAgent: getUserAgent(req),
    detail: { revokedCount: count }
  });

  return jsonOk(res, { revokedCount: count });
}
