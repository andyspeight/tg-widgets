/**
 * POST /api/auth/switch-client
 *
 * Switches the current user's active session to a different company they're
 * linked to. Mints a new tg_session JWT with the new clientId, revokes the
 * old session, and sets the new cookie.
 *
 * Body: { clientId: 'rec...' }
 * Returns: { ok: true, client: { recordId, clientName, plan, status } }
 *
 * Security model:
 *   - Must have a valid current session (requireAuth)
 *   - Target clientId MUST be in the user's USERS.client[] array
 *     (defends against id-guessing privilege escalation)
 *   - Target client MUST not be suspended
 *   - Rate limited per user (20/min — generous but stops thrash)
 *   - Old session record is revoked
 *   - New session record created
 *   - Origin header validated against allowlist (CSRF defence)
 *   - Logs SIGNIN_SUCCESS with source: 'client_switch'
 */

import {
  setCors, requireMethod, parseJson, jsonOk, jsonError,
  getRequestIp, getUserAgent,
} from '../_lib/auth/http.js';
import { requireAuth } from '../_lib/auth/middleware.js';
import { limiters } from '../_lib/auth/ratelimit.js';
import { getRecord, createRecord, updateRecord } from '../_lib/auth/airtable.js';
import {
  USERS, CLIENTS, SESSIONS, AUTH_EVENTS,
} from '../_lib/auth/schema.js';
import { signSessionToken, uuid } from '../_lib/auth/crypto.js';
import { setSessionCookie } from '../_lib/auth/cookie.js';
import { revokeSession } from '../_lib/auth/sessions.js';
import { resolveUserPermissions, invalidateUserPermissions } from '../_lib/auth/permissions.js';
import { logAuthEvent } from '../_lib/auth/audit.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

// Origin allowlist — only same-family travelify.io origins can call this.
// CSRF defence: this endpoint changes credentials (sets a new cookie), so
// SameSite=Lax alone isn't enough belt-and-braces.
function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    return h === 'travelify.io' || h.endsWith('.travelify.io') ||
           h === 'localhost' || h === '127.0.0.1';
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'POST')) return;

  // Reject cross-origin POSTs explicitly
  const origin = req.headers.origin || req.headers.referer || '';
  if (origin && !isAllowedOrigin(origin)) {
    return jsonError(res, 403, 'forbidden_origin', 'Forbidden');
  }

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const ip = getRequestIp(req);
  const ua = getUserAgent(req);

  const rl = await limiters.clientSwitch({ key: ctx.userRecordId });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return jsonError(res, 429, 'rate_limit', 'Too many switches. Try again in a moment.');
  }

  const body = await parseJson(req);
  if (!body) return jsonError(res, 400, 'bad_json', 'Invalid request body');

  const targetClientId = String(body.clientId || '').trim();
  if (!REC_ID_RE.test(targetClientId)) {
    return jsonError(res, 400, 'invalid_client_id', 'A valid clientId is required');
  }

  // No-op short-circuit: already on this client
  if (targetClientId === ctx.clientRecordId) {
    return jsonOk(res, {
      noChange: true,
      currentClientId: ctx.clientRecordId,
    });
  }

  // 1. Load user, verify target is in their client[] array
  let userRec;
  try {
    userRec = await getRecord(USERS.tableId, ctx.userRecordId);
  } catch (err) {
    console.error('[auth/switch-client] user lookup failed:', err);
    return jsonError(res, 500, 'lookup_failed', 'Could not load your account');
  }

  const userClientIds = userRec.fields[USERS.fields.client] || [];
  if (!userClientIds.includes(targetClientId)) {
    logAuthEvent({
      type: AUTH_EVENTS.types.SIGNIN_FAIL, success: false,
      userRecordId: ctx.userRecordId,
      clientRecordId: ctx.clientRecordId,
      ip, userAgent: ua,
      detail: {
        source: 'client_switch',
        reason: 'not_linked_to_target',
        attemptedClientId: targetClientId,
      },
    }).catch(() => {});
    return jsonError(res, 403, 'not_authorised', "You don't have access to that company");
  }

  // 2. Load target client, verify active
  let targetClient;
  try {
    targetClient = await getRecord(CLIENTS.tableId, targetClientId);
  } catch (err) {
    if (err?.status === 404) {
      return jsonError(res, 404, 'client_not_found', 'Company not found');
    }
    console.error('[auth/switch-client] client lookup failed:', err);
    return jsonError(res, 500, 'lookup_failed', 'Could not load target company');
  }

  const targetStatus = String(targetClient.fields[CLIENTS.fields.status] || '').toLowerCase();
  if (targetStatus === 'suspended') {
    return jsonError(res, 403, 'target_suspended', 'That company is suspended. Contact support.');
  }

  // 3. Resolve fresh permissions (bypass cache — recent grants matter)
  invalidateUserPermissions(ctx.userRecordId);
  const permissions = await resolveUserPermissions(ctx.userRecordId, ctx.email, {
    bypassCache: true,
  });

  // 4. Mint new session (mirrors signin.js exactly — sessionId, then JWT,
  //    then create SESSIONS row inline so jwtJti / sessionId stay in sync)
  const userRole = userRec.fields[USERS.fields.role] || USERS.roles.MEMBER;
  const sessionId = uuid();
  const { token, jti, expiresAt } = signSessionToken({
    userId: ctx.userRecordId,
    clientId: targetClientId,
    role: userRole,
    sessionId,
    permissions: permissions.map((p) => ({ product: p.product, role: p.role })),
  });

  const nowIso = new Date().toISOString();
  try {
    await createRecord(SESSIONS.tableId, {
      [SESSIONS.fields.sessionId]: sessionId,
      [SESSIONS.fields.user]:      [ctx.userRecordId],
      [SESSIONS.fields.jwtJti]:    jti,
      [SESSIONS.fields.userAgent]: ua,
      [SESSIONS.fields.ipAddress]: ip,
      [SESSIONS.fields.created]:   nowIso,
      [SESSIONS.fields.expiresAt]: expiresAt.toISOString(),
      [SESSIONS.fields.lastUsed]:  nowIso,
    });
  } catch (err) {
    console.error('[auth/switch-client] failed to create new session:', err);
    return jsonError(res, 500, 'session_create_failed', 'Could not switch company');
  }

  // 5. Revoke the old session row (best-effort, idempotent)
  if (ctx.sessionRecordId) {
    revokeSession(ctx.sessionRecordId, 'client_switch')
      .catch((err) => console.error('[auth/switch-client] old session revoke failed:', err.message));
  }

  // 6. Bump lastLogin (mirrors signin.js)
  updateRecord(USERS.tableId, ctx.userRecordId, {
    [USERS.fields.lastLogin]:   nowIso,
    [USERS.fields.lastLoginIp]: ip,
  }).catch(() => {});

  // 7. Set the new cookie
  setSessionCookie(res, token, expiresAt, { req });

  // 8. Audit log
  logAuthEvent({
    type: AUTH_EVENTS.types.SIGNIN_SUCCESS, success: true,
    userRecordId: ctx.userRecordId,
    clientRecordId: targetClientId,
    emailAttempted: ctx.email,
    ip, userAgent: ua,
    detail: {
      source: 'client_switch',
      fromClientId: ctx.clientRecordId,
      toClientId: targetClientId,
    },
  }).catch(() => {});

  return jsonOk(res, {
    client: {
      recordId: targetClient.id,
      clientName: targetClient.fields[CLIENTS.fields.clientName] || '',
      plan: targetClient.fields[CLIENTS.fields.plan] || '',
      status: targetClient.fields[CLIENTS.fields.status] || '',
    },
  });
}
