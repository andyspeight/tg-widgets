/**
 * GET /api/brain/clients
 *
 * The list of businesses (Luna clients) for the "Add knowledge" picker.
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { clientNameMap, lunaConfigured } from './_luna.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return jsonError(res, 405, 'method_not_allowed', 'GET only');

  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  const hasBrain = !!getProductRole(ctx, PRODUCTS.slugs.LUNA_BRAIN);
  if (!hasBrain && !isStaffEmail(ctx.email)) {
    return jsonError(res, 403, 'no_product_access', 'You do not have access to Luna Brain');
  }
  if (!lunaConfigured()) return jsonError(res, 500, 'not_configured', 'Luna Brain is not configured');

  try {
    const map = await clientNameMap();
    const clients = [...map.entries()]
      .filter(([, name]) => name)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ ok: true, clients });
  } catch (err) {
    console.error('[brain/clients] error:', err && err.message);
    return jsonError(res, 502, 'clients_failed', 'Could not load the client list');
  }
}
