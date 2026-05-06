/**
 * GET /api/auth/me
 *
 * Returns the current user, their client, and their resolved permissions.
 * Used by:
 *   - Product front-ends on load to confirm the session and gate UI
 *   - Identity Console to refresh after a permission change
 *
 * Accepts auth via either Authorization: Bearer header OR the
 * tg_session cookie (set on .travelify.io for cross-subdomain SSO).
 */

import { setCors, requireMethod, jsonOk } from '../_lib/auth/http.js';
import { requireAuth, loadClientForCtx } from '../_lib/auth/middleware.js';

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (!requireMethod(req, res, 'GET')) return;

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const client = await loadClientForCtx(ctx);

  return jsonOk(res, {
    user: {
      email: ctx.email,
      fullName: ctx.fullName,
      role: ctx.role
    },
    client,
    permissions: (ctx.permissions || []).map(p => ({
      product: p.product,
      role: p.role,
      expiresAt: p.expiresAt || null
    }))
  });
}
