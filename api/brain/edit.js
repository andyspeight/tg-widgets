/**
 * POST /api/brain/edit
 *
 * Edit a knowledge item's content before (or instead of) verifying it. Any
 * content change drops it back to Needs Review so it cannot stay live on an
 * unverified edit, then optionally re-runs the gate.
 *
 * Body: { id, question?, answer?, variants?, keywords?, type?, runGate? }
 * Auth: Luna Brain access or Travelgenix staff.
 */

import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { getKnowledge, updateKnowledge, lunaConfigured, KF, CONFIDENCE } from './_luna.js';
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
  const id = String(body.id || '').trim();
  if (!REC_ID_RE.test(id)) return jsonError(res, 400, 'invalid_id', 'A valid record id is required');

  const fields = {};
  if (typeof body.question === 'string') fields[KF.question] = clamp(body.question, 400).trim();
  if (typeof body.answer === 'string') fields[KF.answer] = clamp(body.answer, 4000).trim();
  if (typeof body.variants === 'string') fields[KF.variants] = clamp(body.variants, 1000);
  if (typeof body.keywords === 'string') fields[KF.keywords] = clamp(body.keywords, 500);
  if (typeof body.type === 'string' && TYPES.has(body.type)) fields[KF.type] = body.type;

  if (!Object.keys(fields).length) return jsonError(res, 400, 'nothing_to_change', 'No editable fields supplied');
  if (fields[KF.question] === '') return jsonError(res, 400, 'empty_question', 'Question cannot be empty');
  if (fields[KF.answer] === '') return jsonError(res, 400, 'empty_answer', 'Answer cannot be empty');

  const runGate = body.runGate !== false;

  try {
    const existing = await getKnowledge(id).catch((e) => { if (e?.status === 404) return null; throw e; });
    if (!existing) return jsonError(res, 404, 'not_found', 'No knowledge item with that id');

    // A content edit is unverified by definition — send it back for checking.
    fields[KF.confidence] = CONFIDENCE.NEEDS_REVIEW;
    await updateKnowledge(id, fields);

    let gate = null;
    if (runGate) gate = await gateOne(id).catch((e) => ({ outcome: 'error', reason: e?.message || 'gate error' }));

    return res.status(200).json({
      ok: true, id,
      gate: gate ? { outcome: gate.outcome, spotCheck: !!gate.spotCheck, reason: gate.reason } : null,
    });
  } catch (err) {
    console.error('[brain/edit] error:', err && err.message);
    return jsonError(res, 502, 'edit_failed', 'Could not save the edit');
  }
}
