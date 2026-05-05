/**
 * POST /api/auth/signout
 *
 * Revokes the current session. JWT will still validate cryptographically
 * but session lookup will fail → 401 on next request.
 */

import { setCors, requireMethod, jsonOk, getRequestIp, getUserAgent } from '../_lib/auth/http.js';
import { requireAuth } from '../_lib/auth/middleware.js';
import { revokeSession } from '../_lib/auth/sessions.js';
import { logAuthEvent } from '../_lib/auth/audit.js';
import { AUTH_EVENTS, SESSIONS } from '../_lib/auth/schema.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  await revokeSession(ctx.sessionRecordId, SESSIONS.revokeReasons.SIGNOUT);

  await logAuthEvent({
    type: AUTH_EVENTS.types.SIGNOUT,
    success: true,
    userRecordId: ctx.userRecordId,
    clientRecordId: ctx.clientRecordId,
    ip: getRequestIp(req),
    userAgent: getUserAgent(req)
  });

  return jsonOk(res);
}
