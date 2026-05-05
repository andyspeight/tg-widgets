/**
 * GET /api/auth/me
 *
 * Returns the current user and their client. Used by the dashboard on load
 * to verify the token and hydrate UI state.
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
    client
  });
}
