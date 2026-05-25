/**
 * Admin gate for World Map admin routes.
 *
 * Two-step check:
 *   1. requireAuth() — the user must hold a valid session (Bearer token or the
 *      tg_session cookie), reusing the suite's existing auth in api/_auth.js.
 *   2. Admin allow-list — the authenticated user must be an admin. We accept
 *      EITHER an admin role on the session OR an email on the MAP_ADMIN_EMAILS
 *      allow-list. The email list is the robust path because the cookie auth
 *      flow can leave role/email partially populated; the env var is the single
 *      source of truth Andy controls.
 *
 * Why an env allow-list and not a clientName check: this dashboard edits the
 * GLOBAL MapSearches feed that every agency's map reads, so it must be locked
 * to Travelgenix staff only. A data-field check (clientName === 'Travelgenix')
 * would couple admin rights to mutable data; an explicit env list does not.
 *
 * Env:
 *   MAP_ADMIN_EMAILS — comma-separated admin emails (lower-cased on compare).
 *     Defaults to the two known Travelgenix addresses if unset, so the feature
 *     is never accidentally wide open.
 */
import { requireAuth } from '../_auth.js';

const DEFAULT_ADMINS = ['andy@travelgenix.io', 'andy.speight@agendas.group'];

function adminEmails() {
  const raw = process.env.MAP_ADMIN_EMAILS;
  if (!raw || !raw.trim()) return DEFAULT_ADMINS;
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

const ADMIN_ROLES = new Set(['admin', 'owner', 'superadmin', 'staff']);

/**
 * Returns { user } if the caller is an authenticated admin, or { error, status }
 * to send straight back. Never throws.
 */
export function requireAdmin(req) {
  const auth = requireAuth(req);
  if (auth.error) return { error: auth.error, status: auth.status || 401 };

  const user = auth.user || {};
  const email = String(user.email || '').toLowerCase().trim();
  const role = String(user.role || '').toLowerCase().trim();

  const byRole = role && ADMIN_ROLES.has(role);
  const byEmail = email && adminEmails().includes(email);

  if (!byRole && !byEmail) {
    return { error: 'Admin access required.', status: 403 };
  }
  return { user };
}

/** Same-origin-only CORS for admin routes. Never '*' on authenticated data
 *  (security rule). These routes are called same-origin from the admin page,
 *  so we simply do not enable cross-origin reads. */
export function setAdminCors(req, res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
}
