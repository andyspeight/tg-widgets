/**
 * Auth middleware: verify a request is from an authenticated, active user.
 *
 * Usage in any protected API route:
 *
 *   import { requireAuth } from '../_lib/auth/middleware.js';
 *
 *   export default async function handler(req, res) {
 *     const ctx = await requireAuth(req, res);
 *     if (!ctx) return; // requireAuth has already responded with 401
 *     // ctx = { userRecordId, clientRecordId, role, email, sessionRecordId, sessionId }
 *   }
 *
 * Hybrid model: JWT is verified cryptographically, AND the session row
 * is looked up to check it isn't revoked or expired.
 */

import { verifySessionToken } from './crypto.js';
import { getActiveSession, touchSession } from './sessions.js';
import { USERS, CLIENTS } from './schema.js';
import { getRecord } from './airtable.js';
import { jsonError } from './http.js';

/**
 * Extract a Bearer token from the Authorization header.
 */
function extractBearer(req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || typeof auth !== 'string') return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * @returns {Promise<object|null>} ctx object or null if unauthorised
 *   ctx = {
 *     userRecordId,
 *     clientRecordId,
 *     role,
 *     email,
 *     fullName,
 *     sessionRecordId,
 *     sessionId
 *   }
 */
export async function requireAuth(req, res) {
  const token = extractBearer(req);
  if (!token) {
    jsonError(res, 401, 'no_token', 'Authentication required');
    return null;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    jsonError(res, 401, 'invalid_token', 'Authentication required');
    return null;
  }

  const { sessionId } = payload;
  if (!sessionId) {
    jsonError(res, 401, 'invalid_token', 'Authentication required');
    return null;
  }

  // Confirm the session is still active in Airtable
  const session = await getActiveSession(sessionId);
  if (!session) {
    jsonError(res, 401, 'session_revoked', 'Session is no longer valid');
    return null;
  }

  // Confirm jti matches what we issued — defends against a JWT forged with
  // the right secret but a stolen sessionId
  if (session.jti && payload.jti && session.jti !== payload.jti) {
    jsonError(res, 401, 'jti_mismatch', 'Session is no longer valid');
    return null;
  }

  // Load the user
  const userRec = await getRecord(USERS.tableId, session.userRecordId).catch(() => null);
  if (!userRec) {
    jsonError(res, 401, 'user_missing', 'Session is no longer valid');
    return null;
  }

  const f = userRec.fields;
  if (f[USERS.fields.status] === USERS.statuses.SUSPENDED) {
    jsonError(res, 403, 'suspended', 'Account suspended');
    return null;
  }

  const clientRecordId = (f[USERS.fields.client] || [])[0] || null;

  // Touch the session asynchronously; don't await
  touchSession(session.recordId).catch(() => {});

  return {
    userRecordId: userRec.id,
    clientRecordId,
    role: f[USERS.fields.role] || USERS.roles.MEMBER,
    email: f[USERS.fields.email] || '',
    fullName: f[USERS.fields.fullName] || '',
    sessionRecordId: session.recordId,
    sessionId: session.sessionId
  };
}

/**
 * Stricter variant: require an admin or owner role.
 */
export async function requireAdmin(req, res) {
  const ctx = await requireAuth(req, res);
  if (!ctx) return null;
  if (ctx.role !== USERS.roles.ADMIN && ctx.role !== USERS.roles.OWNER) {
    jsonError(res, 403, 'forbidden', 'Admins only');
    return null;
  }
  return ctx;
}

/**
 * Owner-only — for actions like deleting the workspace, transferring ownership.
 */
export async function requireOwner(req, res) {
  const ctx = await requireAuth(req, res);
  if (!ctx) return null;
  if (ctx.role !== USERS.roles.OWNER) {
    jsonError(res, 403, 'forbidden', 'Owners only');
    return null;
  }
  return ctx;
}

/**
 * Helper: fetch the Client record for the current user, e.g. to render
 * Plan / ClientName on the dashboard.
 */
export async function loadClientForCtx(ctx) {
  if (!ctx?.clientRecordId) return null;
  const rec = await getRecord(CLIENTS.tableId, ctx.clientRecordId).catch(() => null);
  if (!rec) return null;
  return {
    recordId: rec.id,
    email: rec.fields[CLIENTS.fields.email] || '',
    clientName: rec.fields[CLIENTS.fields.clientName] || '',
    plan: rec.fields[CLIENTS.fields.plan] || '',
    status: rec.fields[CLIENTS.fields.status] || ''
  };
}
