/**
 * POST /api/brain/run-gate
 *
 * Run the two-step verification gate over the pending queue on demand (the
 * "Run verification now" button in the Brain dashboard). Auto-publishes the
 * items that pass both checks and leaves the exceptions in the queue.
 *
 * Body (optional): { limit?: number (1-30), force?: boolean }
 *   force re-runs items already gate-seen (normally they wait for a human).
 *
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { lunaConfigured } from './_luna.js';
import { processPending } from './_gate.js';

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
  if (!lunaConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return jsonError(res, 500, 'not_configured', 'Luna Brain gate is not configured');
  }

  const body = await readBody(req).catch(() => ({}));
  let limit = parseInt(body.limit, 10);
  if (!Number.isFinite(limit)) limit = 20;
  limit = Math.max(1, Math.min(30, limit));
  const force = body.force === true;

  try {
    const summary = await processPending({ limit, force });
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error('[brain/run-gate] error:', err && err.message);
    return jsonError(res, 502, 'gate_failed', 'The verification gate could not finish');
  }
}
