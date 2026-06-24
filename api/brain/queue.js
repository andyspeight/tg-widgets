/**
 * GET /api/brain/queue
 *
 * The Luna Brain verification queue: every Knowledge item that is NOT yet
 * trusted-and-live, i.e. still Draft or flagged "Needs Review", and not
 * Archived. These are the only items a human needs to look at. Anything that
 * is Active + Verified is already serving and stays out of the queue.
 *
 * Auth: a signed-in user with Luna Brain access, or any Travelgenix staff.
 *
 * Response:
 *   { ok: true, count, items: [ { id, question, answer, type, status,
 *       confidence, source, clientName, createdAt, lastVerifiedAt, timesUsed,
 *       variants, keywords } ] }
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import {
  listKnowledge, clientNameMap, lunaConfigured,
  KF, STATUS, CONFIDENCE,
} from './_luna.js';

function clamp(s, n) {
  s = (s == null ? '' : String(s));
  return s.length > n ? s.slice(0, n) : s;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return jsonError(res, 405, 'method_not_allowed', 'GET only');

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  // Luna Brain access OR Travelgenix staff.
  const hasBrain = !!getProductRole(ctx, PRODUCTS.slugs.LUNA_BRAIN);
  if (!hasBrain && !isStaffEmail(ctx.email)) {
    return jsonError(res, 403, 'no_product_access', 'You do not have access to Luna Brain');
  }

  if (!lunaConfigured()) {
    return jsonError(res, 500, 'not_configured', 'Luna Brain is not configured');
  }

  // Two views: the verify queue (default) and the spot-check list (high-risk
  // items the gate auto-published but flagged for a human eyeball).
  const view = String(req.query?.view || 'queue');

  try {
    let formula, sortField, sortDir;
    if (view === 'spotcheck') {
      // Auto-published high-risk facts awaiting a spot-check.
      formula = `AND({Status}="${STATUS.ACTIVE}",{Confidence}="${CONFIDENCE.VERIFIED}",FIND("[spot-check]",{Notes}&"")>0)`;
      sortField = 'LastVerifiedAt'; sortDir = 'desc';
    } else {
      // Not archived, and either still a Draft or flagged Needs Review.
      formula = `AND({Status}!="${STATUS.ARCHIVED}",OR({Status}="${STATUS.DRAFT}",{Confidence}="${CONFIDENCE.NEEDS_REVIEW}"))`;
      sortField = 'CreatedAt'; sortDir = 'asc';
    }
    const records = await listKnowledge({ formula, sortField, sortDir });

    // Resolve client names only if there is anything to show.
    let names = new Map();
    if (records.length) {
      try { names = await clientNameMap(); } catch { names = new Map(); }
    }

    const items = records.map(r => {
      const f = r.fields;
      const clientIds = f[KF.client] || [];
      const clientName = clientIds.length ? (names.get(clientIds[0]) || '') : '';
      return {
        id: r.id,
        question: clamp(f[KF.question], 300),
        answer: clamp(f[KF.answer], 1200),
        variants: clamp(f[KF.variants], 400),
        keywords: clamp(f[KF.keywords], 300),
        type: f[KF.type] || '',
        status: f[KF.status] || '',
        confidence: f[KF.confidence] || '',
        source: f[KF.source] || '',
        clientName,
        createdAt: f[KF.createdAt] || null,
        lastVerifiedAt: f[KF.lastVerifiedAt] || null,
        timesUsed: f[KF.timesUsed] ?? 0,
        // Most recent gate decision line, so the UI can show why it's here.
        gateNote: clamp(String(f[KF.notes] || '').split('\n').find(l => l.startsWith('[gate')) || '', 240),
      };
    });

    return res.status(200).json({ ok: true, view, count: items.length, items });
  } catch (err) {
    console.error('[brain/queue] error:', err && err.message);
    return jsonError(res, 502, 'queue_failed', 'Could not load the verification queue');
  }
}
