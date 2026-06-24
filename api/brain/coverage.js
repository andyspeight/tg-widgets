/**
 * POST /api/brain/coverage
 *
 * Run the coverage gap engine for one business: find the canonical travel-agent
 * topics it has no verified answer for, draft the ones its own source material
 * supports (through the gate), and raise owner-questions (Knowledge Gaps) for
 * the rest. Owner-questions then appear in the Gaps tab.
 *
 * Body: { clientId: "recXXX", limit?: number (1-17) }
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { lunaConfigured } from './_luna.js';
import { runCoverage } from './_coverage.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

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
    return jsonError(res, 500, 'not_configured', 'Luna Brain is not configured');
  }

  const body = await readBody(req).catch(() => ({}));
  const clientId = String(body.clientId || '').trim();
  if (!REC_ID_RE.test(clientId)) return jsonError(res, 400, 'invalid_client', 'A valid clientId is required');
  let limit = parseInt(body.limit, 10);
  if (!Number.isFinite(limit)) limit = 12;
  limit = Math.max(1, Math.min(17, limit));

  try {
    const summary = await runCoverage(clientId, { limit });
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error('[brain/coverage] error:', err && err.message);
    return jsonError(res, 502, 'coverage_failed', 'The coverage check could not finish');
  }
}
