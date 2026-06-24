/**
 * POST /api/reference/refresh
 *
 * Run the reference freshness re-verify engine on demand. Defaults to a pure
 * report (writes nothing). Pass restampValid / flagDrift to enable the
 * conservative writes once you trust it.
 *
 * Body: { ttlDays?: 1-365, limit?: 1-30, restampValid?: bool, flagDrift?: bool }
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { refConfigured } from './_ref.js';
import { runFreshness } from './_freshness.js';

async function readBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
    return req.body;
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', 'POST only');

  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  const hasBrain = !!getProductRole(ctx, PRODUCTS.slugs.LUNA_BRAIN);
  if (!hasBrain && !isStaffEmail(ctx.email)) {
    return jsonError(res, 403, 'no_product_access', 'You do not have access to Luna Brain');
  }
  if (!refConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return jsonError(res, 500, 'not_configured', 'Reference freshness is not configured');
  }

  const body = await readBody(req).catch(() => ({}));
  let ttlDays = parseInt(body.ttlDays, 10); if (!Number.isFinite(ttlDays)) ttlDays = 30;
  ttlDays = Math.max(1, Math.min(365, ttlDays));
  let limit = parseInt(body.limit, 10); if (!Number.isFinite(limit)) limit = 15;
  limit = Math.max(1, Math.min(30, limit));

  try {
    const summary = await runFreshness({
      ttlDays, limit,
      restampValid: body.restampValid === true,
      flagDrift: body.flagDrift === true,
    });
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error('[reference/refresh] error:', err && err.message);
    return jsonError(res, 502, 'refresh_failed', 'The freshness check could not finish');
  }
}
