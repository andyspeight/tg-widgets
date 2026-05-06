/**
 * Admin auth gate.
 *
 * Every endpoint under /api/admin/* must call requireAdmin(req, res) at the top.
 * Returns the resolved user record on success, or false after sending a 401/403
 * response. If false is returned, the caller MUST stop.
 *
 * Access rule: user must have an active permission on the widget_suite product
 * with role = 'owner' or 'admin'. Anyone else gets 403.
 *
 * This piggybacks on the existing tg-widgets auth platform — same JWT, same
 * .travelify.io SSO cookie, same Permissions table.
 */

import { verifyToken } from '../../_lib/auth/jwt.js';
import { readCookie } from '../../_lib/auth/cookie.js';
import { resolveUserPermissions } from '../../_lib/auth/permissions.js';

const ADMIN_PRODUCT_SLUG = 'widget_suite';
const ADMIN_ROLES = new Set(['owner', 'admin']);

/**
 * Resolve and authorise the caller as a Travelgenix staff admin.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<{userId: string, email: string, role: string} | false>}
 */
export async function requireAdmin(req, res) {
  // 1. Find the JWT — cookie first, then Authorization header
  let token = readCookie(req, 'tg_session');
  if (!token) {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) token = match[1];
  }

  if (!token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'unauthenticated' }));
    return false;
  }

  // 2. Verify signature and expiry
  let payload;
  try {
    payload = await verifyToken(token);
  } catch (err) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'invalid_token' }));
    return false;
  }

  if (!payload?.userRecordId) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'invalid_token' }));
    return false;
  }

  // 3. Check this user has admin or owner on widget_suite
  // Permissions are in the JWT but we re-resolve to bypass any stale cached set.
  // 30s in-memory cache in the resolver keeps this snappy.
  const perms = await resolveUserPermissions(payload.userRecordId);
  const adminPerm = perms.find(
    (p) => p.product === ADMIN_PRODUCT_SLUG && ADMIN_ROLES.has(p.role)
  );

  if (!adminPerm) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'forbidden', detail: 'admin access required' }));
    return false;
  }

  return {
    userId: payload.userRecordId,
    email: payload.email,
    role: adminPerm.role,
  };
}

/**
 * Standard JSON response helper.
 */
export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Standard CORS headers for admin routes — locked to the admin origin.
 * The admin UI lives on the same Vercel project, so same-origin requests
 * don't need CORS at all. We still set a strict allowlist as defence in depth.
 */
export function setAdminCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = [
    'https://widgets.travelify.io',
    'https://id.travelify.io',
    'https://control.travelify.io',
    'https://tg-widgets.vercel.app',
  ];
  // Allow Vercel preview deploys
  const isPreview = /^https:\/\/tg-widgets-[a-z0-9-]+\.vercel\.app$/.test(origin);

  if (allowed.includes(origin) || isPreview) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}
