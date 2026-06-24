/**
 * GET /api/reference/breadth
 *
 * Reports airports the destination content references (by parenthesised IATA
 * code) that have no record in the Airports table — the breadth gap. Read-only,
 * no fabrication: it tells you what to add, sourced by a human.
 *
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { refConfigured } from './_ref.js';
import { runBreadth } from './_breadth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return jsonError(res, 405, 'method_not_allowed', 'GET only');

  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  const hasBrain = !!getProductRole(ctx, PRODUCTS.slugs.LUNA_BRAIN);
  if (!hasBrain && !isStaffEmail(ctx.email)) {
    return jsonError(res, 403, 'no_product_access', 'You do not have access to Luna Brain');
  }
  if (!refConfigured()) return jsonError(res, 500, 'not_configured', 'Reference data is not configured');

  try {
    const report = await runBreadth();
    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    console.error('[reference/breadth] error:', err && err.message);
    return jsonError(res, 502, 'breadth_failed', 'Could not build the breadth report');
  }
}
