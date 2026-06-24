/**
 * GET /api/brain/gaps
 *
 * Open knowledge gaps — questions Luna could not answer in live chats. These
 * are the brain growing itself: each one is a real thing a visitor asked that
 * the business has no verified answer for yet. Promote one (see promote-gap)
 * to draft an answer that runs through the gate.
 *
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { listGaps, clientNameMap, lunaConfigured, GF, GAP_STATUS } from './_luna.js';

function clamp(s, n) { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n) : s; }

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
    // Open or in-progress gaps, most-asked first.
    const formula = `OR({Status}="${GAP_STATUS.OPEN}",{Status}="${GAP_STATUS.IN_PROGRESS}")`;
    const records = await listGaps({ formula, sortField: 'Occurrences', sortDir: 'desc' });

    let names = new Map();
    if (records.length) { try { names = await clientNameMap(); } catch { names = new Map(); } }

    const items = records.map(r => {
      const f = r.fields;
      const clientIds = f[GF.client] || [];
      return {
        id: r.id,
        question: clamp(f[GF.question], 300),
        topic: clamp(f[GF.topic], 120),
        suggestedAnswer: clamp(f[GF.suggestedAnswer], 1200),
        occurrences: f[GF.occurrences] ?? 0,
        status: f[GF.status] || '',
        clientName: clientIds.length ? (names.get(clientIds[0]) || '') : '',
        lastSeenAt: f[GF.lastSeenAt] || null,
      };
    });

    return res.status(200).json({ ok: true, count: items.length, items });
  } catch (err) {
    console.error('[brain/gaps] error:', err && err.message);
    return jsonError(res, 502, 'gaps_failed', 'Could not load knowledge gaps');
  }
}
