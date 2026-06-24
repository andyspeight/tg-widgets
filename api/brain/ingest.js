/**
 * POST /api/brain/ingest
 *
 * The front door for adding knowledge to Luna Brain. A new fact lands as
 * Draft + Needs Review (never trusted on arrival), is checked for duplicates
 * against the same client's existing knowledge, and then runs straight through
 * the two-step gate. If it passes it is published on the spot; if not it waits
 * in the human queue. Nothing is ever auto-trusted without passing the gate.
 *
 * Auth (either):
 *   - SSO: a signed-in user with Luna Brain access, or Travelgenix staff.
 *   - Service key: header `x-brain-key: <BRAIN_INGEST_KEY>` for programmatic
 *     ingestion from other systems (e.g. Luna Chat escalations). Only enabled
 *     if BRAIN_INGEST_KEY is set in the environment.
 *
 * Body: {
 *   clientId: "recXXXX",            // required — which business this fact is for
 *   question: "...",                // required
 *   answer: "...",                  // required
 *   type?: "FAQ"|"Pricing"|...,     // defaults to "Other"
 *   source?: "Manual"|"From Escalation"|"From Correction"|"Suggested by Luna"|"Imported",
 *   variants?: "alt phrasing\n...",
 *   keywords?: "kw1, kw2",
 *   conversationIds?: ["recYYY"],   // grounding evidence for the gate
 *   runGate?: boolean               // default true
 * }
 *
 * Duplicate handling: if a very similar question already exists for this client
 * we do NOT touch the live record. We return { duplicate: true, existingId } so
 * the caller can edit that item instead. A moderate match is created but tagged
 * so the human sees the possible overlap.
 */

import crypto from 'crypto';
import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import {
  listKnowledge, createKnowledge, lunaConfigured,
  KF, STATUS, CONFIDENCE,
} from './_luna.js';
import { gateOne } from './_gate.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const TYPES = new Set(['FAQ', 'Policy', 'Preference', 'Supplier Rule', 'Destination Note', 'Pricing', 'Booking Process', 'Other']);
const SOURCES = new Set(['Manual', 'From Escalation', 'From Correction', 'Suggested by Luna', 'Imported']);

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

// Normalised token set for cheap question similarity (Jaccard).
function tokens(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
}
function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) { crypto.timingSafeEqual(ab, ab); return false; }
  return crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', 'POST only');
  if (!lunaConfigured()) return jsonError(res, 500, 'not_configured', 'Luna Brain is not configured');

  // Auth: service key OR SSO.
  let actor = 'service';
  const svcKey = process.env.BRAIN_INGEST_KEY;
  const presented = req.headers['x-brain-key'];
  const keyOk = !!svcKey && typeof presented === 'string' && timingSafeEq(presented, svcKey);

  if (!keyOk) {
    const ctx = await requireAuth(req, res);
    if (!ctx) return;
    const hasBrain = !!getProductRole(ctx, PRODUCTS.slugs.LUNA_BRAIN);
    if (!hasBrain && !isStaffEmail(ctx.email)) {
      return jsonError(res, 403, 'no_product_access', 'You do not have access to Luna Brain');
    }
    actor = ctx.email || 'user';
  }

  const body = await readBody(req).catch(() => ({}));
  const clientId = String(body.clientId || '').trim();
  const question = clamp(body.question, 400).trim();
  const answer = clamp(body.answer, 4000).trim();
  const type = TYPES.has(body.type) ? body.type : 'Other';
  const source = SOURCES.has(body.source) ? body.source : (keyOk ? 'Imported' : 'Manual');
  const variants = clamp(body.variants, 1000).trim();
  const keywords = clamp(body.keywords, 500).trim();
  const conversationIds = Array.isArray(body.conversationIds)
    ? body.conversationIds.filter(id => REC_ID_RE.test(id)).slice(0, 5) : [];
  const runGate = body.runGate !== false;

  if (!REC_ID_RE.test(clientId)) return jsonError(res, 400, 'invalid_client', 'A valid clientId is required');
  if (!question) return jsonError(res, 400, 'missing_question', 'A question is required');
  if (!answer) return jsonError(res, 400, 'missing_answer', 'An answer is required');

  try {
    // Duplicate check against this client's non-archived knowledge.
    const existing = (await listKnowledge({
      formula: `{Status}!="${STATUS.ARCHIVED}"`, maxRecords: 500, sortField: 'CreatedAt', sortDir: 'desc',
    }).catch(() => []))
      .filter(r => (r.fields[KF.client] || []).includes(clientId));

    let best = { sim: 0, id: null, question: '' };
    for (const r of existing) {
      const q = r.fields[KF.question] || '';
      const sim = Math.max(similarity(question, q), similarity(question, r.fields[KF.variants] || ''));
      if (sim > best.sim) best = { sim, id: r.id, question: q };
    }

    // Strong duplicate — don't create, point the caller at the existing item.
    if (best.sim >= 0.7) {
      return res.status(200).json({
        ok: true, duplicate: true, existingId: best.id, existingQuestion: best.question, similarity: Number(best.sim.toFixed(2)),
        message: 'A very similar item already exists. Edit that one instead of adding a duplicate.',
      });
    }

    const fields = {
      [KF.question]: question,
      [KF.answer]: answer,
      [KF.type]: type,
      [KF.source]: source,
      [KF.status]: STATUS.DRAFT,
      [KF.confidence]: CONFIDENCE.NEEDS_REVIEW,
      [KF.client]: [clientId],
    };
    if (variants) fields[KF.variants] = variants;
    if (keywords) fields[KF.keywords] = keywords;
    if (conversationIds.length) fields[KF.conversations] = conversationIds;
    // Moderate match — create, but flag the possible overlap for the human.
    if (best.sim >= 0.45 && best.id) {
      fields[KF.notes] = `[possible-duplicate ${best.id}] similar to: ${clamp(best.question, 160)}`;
    }

    const created = await createKnowledge(fields);

    // Run the gate inline so a clean fact can publish immediately.
    let gate = null;
    if (runGate) {
      gate = await gateOne(created.id).catch((e) => ({ outcome: 'error', reason: e?.message || 'gate error' }));
    }

    console.log('[brain/ingest]', JSON.stringify({ by: actor, clientId, id: created.id, gate: gate?.outcome }));
    return res.status(201).json({
      ok: true,
      id: created.id,
      duplicate: false,
      possibleDuplicateOf: best.sim >= 0.45 ? best.id : null,
      gate: gate ? { outcome: gate.outcome, spotCheck: !!gate.spotCheck, reason: gate.reason } : null,
    });
  } catch (err) {
    console.error('[brain/ingest] error:', err && err.message);
    return jsonError(res, 502, 'ingest_failed', 'Could not add the knowledge item');
  }
}
