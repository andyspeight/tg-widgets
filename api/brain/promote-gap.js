/**
 * POST /api/brain/promote-gap
 *
 * Turn a knowledge gap into a drafted Knowledge item and run it through the
 * gate. The answer comes from the reviewer (or falls back to Luna's suggested
 * answer). The new item lands as Draft + Needs Review like any other, so a gap
 * can never become a live fact without passing the gate or a human verify.
 *
 * Body: { gapId: "recXXX", answer?: "...", type?: "FAQ"|... }
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import {
  getGap, updateGap, createKnowledge, lunaConfigured,
  KF, GF, STATUS, CONFIDENCE, GAP_STATUS,
} from './_luna.js';
import { gateOne } from './_gate.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const TYPES = new Set(['FAQ', 'Policy', 'Preference', 'Supplier Rule', 'Destination Note', 'Pricing', 'Booking Process', 'Other']);

function clamp(s, n) { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n) : s; }

async function readBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
    return req.body;
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 60000) req.destroy(); });
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
  if (!lunaConfigured()) return jsonError(res, 500, 'not_configured', 'Luna Brain is not configured');

  const body = await readBody(req).catch(() => ({}));
  const gapId = String(body.gapId || '').trim();
  const type = TYPES.has(body.type) ? body.type : 'FAQ';
  if (!REC_ID_RE.test(gapId)) return jsonError(res, 400, 'invalid_gap', 'A valid gapId is required');

  try {
    const gap = await getGap(gapId).catch((e) => { if (e?.status === 404) return null; throw e; });
    if (!gap) return jsonError(res, 404, 'not_found', 'No gap with that id');

    const question = clamp(gap.fields[GF.question], 400).trim();
    const answer = (clamp(body.answer, 4000) || clamp(gap.fields[GF.suggestedAnswer], 4000)).trim();
    const clientIds = gap.fields[GF.client] || [];

    if (!question) return jsonError(res, 400, 'empty_question', 'The gap has no question');
    if (!answer) return jsonError(res, 400, 'no_answer', 'Provide an answer (the gap has no suggested answer)');
    if (!clientIds.length) return jsonError(res, 400, 'no_client', 'The gap is not linked to a business');

    // Create the draft. Source = From Escalation (gaps come from live chats).
    const fields = {
      [KF.question]: question,
      [KF.answer]: answer,
      [KF.type]: type,
      [KF.source]: 'From Escalation',
      [KF.status]: STATUS.DRAFT,
      [KF.confidence]: CONFIDENCE.NEEDS_REVIEW,
      [KF.client]: [clientIds[0]],
      [KF.notes]: `[from-gap ${gapId}]`,
    };
    const created = await createKnowledge(fields);

    // Run the gate inline.
    const gate = await gateOne(created.id).catch((e) => ({ outcome: 'error', reason: e?.message || 'gate error' }));

    // Link the gap to the new item and move it along. Resolved if it published,
    // otherwise In Progress (waiting in the human queue).
    const linked = (gap.fields[GF.linkedKnowledge] || []).concat(created.id);
    await updateGap(gapId, {
      [GF.status]: gate.outcome === 'publish' ? GAP_STATUS.RESOLVED : GAP_STATUS.IN_PROGRESS,
      [GF.linkedKnowledge]: linked,
    }).catch(() => {});

    return res.status(201).json({
      ok: true, id: created.id, gapId,
      gapStatus: gate.outcome === 'publish' ? GAP_STATUS.RESOLVED : GAP_STATUS.IN_PROGRESS,
      gate: { outcome: gate.outcome, spotCheck: !!gate.spotCheck, reason: gate.reason },
    });
  } catch (err) {
    console.error('[brain/promote-gap] error:', err && err.message);
    return jsonError(res, 502, 'promote_failed', 'Could not promote the gap');
  }
}
