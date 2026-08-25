/**
 * POST /api/reference/identity-backfill
 *
 * For airport records that already exist but were never sourced, verify their
 * identity against two independent APIs (OurAirports + Wikidata by IATA) and
 * fill ONLY the fields both sources saw. Defaults to a DRY RUN (writes
 * nothing). Pass write:true to apply.
 *
 * This is the companion to breadth-fill: that one creates records we are
 * missing, this one repairs records we have. The 25 Aug 2026 audit found 123
 * records carrying narrative with no coordinates and no cited source at all.
 *
 * Body: { limit?: 1-50, write?: bool }
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { refConfigured } from './_ref.js';
import { runIdentityBackfill } from './_breadth_fill.js';

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
  limit = Math.max(1, Math.min(50, limit));
  const write = body.write === true;

  try {
    const summary = await runIdentityBackfill({ limit, write });
    return res.status(200).json({ ok: true, dryRun: !write, ...summary });
  } catch (err) {
    console.error('[reference/identity-backfill] error:', err && err.message);
    return jsonError(res, 502, 'identity_backfill_failed', 'The identity backfill could not finish');
  }
}
