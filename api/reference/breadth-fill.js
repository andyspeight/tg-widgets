/**
 * POST /api/reference/breadth-fill
 *
 * For airports the content references but has no record for, verify identity
 * against two independent API sources (OurAirports + Wikidata by IATA) and
 * report what would be created. Defaults to a DRY RUN (writes nothing). Pass
 * create:true to create identity-verified Draft skeletons (Status In progress,
 * both source URLs + today's date) for content enrichment.
 *
 * Body: { limit?: 1-30, create?: bool }
 * Auth: Luna Brain access or Travelgenix staff.
 *
 * Note: the fetch adapters are validated on deploy (the build sandbox blocks
 * outbound network). Keep create:false until a dry run looks right on preview.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { refConfigured } from './_ref.js';
import { runBreadthFill } from './_breadth_fill.js';

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
  if (!refConfigured()) return jsonError(res, 500, 'not_configured', 'Reference data is not configured');

  const body = await readBody(req).catch(() => ({}));
  let limit = parseInt(body.limit, 10); if (!Number.isFinite(limit)) limit = 10;
  limit = Math.max(1, Math.min(30, limit));
  const create = body.create === true;

  try {
    const summary = await runBreadthFill({ limit, create });
    return res.status(200).json({ ok: true, dryRun: !create, ...summary });
  } catch (err) {
    console.error('[reference/breadth-fill] error:', err && err.message);
    return jsonError(res, 502, 'breadth_fill_failed', 'The breadth fill could not finish');
  }
}
