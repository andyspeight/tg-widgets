/**
 * POST /api/brain/verify
 *
 * Apply a human decision to a single Knowledge item. This is the action the
 * Knowledge schema refers to as "Mark verified" — it stamps LastVerifiedAt so
 * the freshness clock resets.
 *
 * Body: { id: "recXXXX", action: "verify" | "archive" | "reactivate" | "needs_review" }
 *   - verify       -> Status=Active,   Confidence=Verified,     LastVerifiedAt=now
 *   - reactivate   -> Status=Active                                (un-archive)
 *   - archive      -> Status=Archived                             (retire it)
 *   - needs_review -> Confidence="Needs Review"                   (send it back)
 *
 * Auth: a signed-in user with Luna Brain access, or any Travelgenix staff.
 * Fails closed on auth/validation. The action set is a fixed allowlist so the
 * endpoint can never write an arbitrary status.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import {
  getKnowledge, updateKnowledge, lunaConfigured,
  KF, STATUS, CONFIDENCE,
} from './_luna.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const ACTIONS = new Set(['verify', 'archive', 'reactivate', 'needs_review']);

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

  if (!lunaConfigured()) {
    return jsonError(res, 500, 'not_configured', 'Luna Brain is not configured');
  }

  const body = await readBody(req).catch(() => ({}));
  const id = String(body.id || '').trim();
  const action = String(body.action || '').trim();

  if (!REC_ID_RE.test(id)) return jsonError(res, 400, 'invalid_id', 'A valid record id is required');
  if (!ACTIONS.has(action)) return jsonError(res, 400, 'invalid_action', 'Unknown action');

  try {
    // Confirm the record exists and is in this base before writing.
    const existing = await getKnowledge(id).catch((e) => {
      if (e?.status === 404) return null;
      throw e;
    });
    if (!existing) return jsonError(res, 404, 'not_found', 'No knowledge item with that id');

    const fields = {};
    if (action === 'verify') {
      fields[KF.status] = STATUS.ACTIVE;
      fields[KF.confidence] = CONFIDENCE.VERIFIED;
      fields[KF.lastVerifiedAt] = new Date().toISOString();
    } else if (action === 'reactivate') {
      fields[KF.status] = STATUS.ACTIVE;
    } else if (action === 'archive') {
      fields[KF.status] = STATUS.ARCHIVED;
    } else if (action === 'needs_review') {
      fields[KF.confidence] = CONFIDENCE.NEEDS_REVIEW;
    }

    const updated = await updateKnowledge(id, fields);
    const f = updated.fields || {};
    return res.status(200).json({
      ok: true,
      id,
      action,
      status: f[KF.status] || '',
      confidence: f[KF.confidence] || '',
      lastVerifiedAt: f[KF.lastVerifiedAt] || null,
    });
  } catch (err) {
    console.error('[brain/verify] error:', err && err.message);
    return jsonError(res, 502, 'verify_failed', 'Could not update the knowledge item');
  }
}
