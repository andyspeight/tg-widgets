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
import { readSessionCookie } from './cookie.js';
import { resolveUserPermissions } from './permissions.js';

/**
 * Extract a session token from either the Authorization header (Bearer)
 * or the cross-subdomain session cookie. The cookie path enables SSO
 * across *.travelify.io products without each one having to manage the
 * token in localStorage.
 */
function extractToken(req) {
  // 1. Authorization: Bearer <token>
  const auth = req.headers.authorization || req.headers.Authorization;
  if (auth && typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  // 2. Cookie: tg_session=...
  return readSessionCookie(req);
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
  const token = extractToken(req);
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

  // Resolve current permissions. These come from the cache (30s TTL) so
  // hot paths don't all hit Airtable, but a freshly-granted permission
  // takes effect within seconds.
  const userEmail = f[USERS.fields.email] || '';
  const permissions = await resolveUserPermissions(userRec.id, userEmail);

  return {
    userRecordId: userRec.id,
    clientRecordId,
    role: f[USERS.fields.role] || USERS.roles.MEMBER,
    email: f[USERS.fields.email] || '',
    fullName: f[USERS.fields.fullName] || '',
    sessionRecordId: session.recordId,
    sessionId: session.sessionId,
    permissions
  };
}

/**
 * Helper for product API endpoints: return the user's role for a specific
 * Travelgenix product, or null if they have no active permission.
 *
 * Usage:
 *   const role = getProductRole(ctx, 'luna_marketing');
 *   if (!role) return jsonError(res, 403, 'no_access', 'Not granted access');
 *   if (role !== 'admin' && role !== 'owner') return jsonError(res, 403, ...);
 */
export function getProductRole(ctx, productSlug) {
  if (!ctx || !Array.isArray(ctx.permissions)) return null;
  const match = ctx.permissions.find(p => p.product === productSlug);
  return match ? match.role : null;
}

/**
 * Stricter helper: require the user to have access to a product, optionally
 * with one of the specified roles. Responds with 403 and returns null
 * if the check fails.
 */
export function requireProductAccess(ctx, productSlug, allowedRoles, res) {
  const role = getProductRole(ctx, productSlug);
  if (!role) {
    jsonError(res, 403, 'no_product_access', 'You do not have access to this product');
    return null;
  }
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(role)) {
    jsonError(res, 403, 'insufficient_role', 'Your role does not permit this action');
    return null;
  }
  return role;
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
