/**
 * GET /api/reference/lookup?q=...   or   POST { query }
 *
 * The bridge: turn a visitor question into verified reference facts (countries
 * + airports) so any client's Luna can ground its answer in the shared data.
 * Deterministic entity match, no model call, so the lookup never invents.
 *
 * Returns both a ready-to-drop `context` string (for the chatbot's prompt) and
 * structured `countries` / `airports` arrays.
 *
 * Auth: read-only public reference data. If REFERENCE_LOOKUP_KEY is set it is
 * required (header x-brain-key) unless the caller is a signed-in Brain/staff
 * user. This lets the Luna Chat backend call it with a shared secret while the
 * dashboard can call it via SSO.
 *
 * Integration (Luna Chat): before answering, POST the visitor's message here,
 * and if `context` is non-empty, prepend it to the grounding context as
 * trusted, quotable facts.
 */

import crypto from 'crypto';
import { requireAuth, getProductRole } from '../_lib/auth/middleware.js';
import { isStaffEmail } from '../_lib/auth/staff.js';
import { PRODUCTS } from '../_lib/auth/schema.js';
import { jsonError } from '../_lib/auth/http.js';
import { refConfigured } from './_ref.js';
import { getIndex, matchEntities, formatContext, shapeMatches } from './_index.js';

function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) { crypto.timingSafeEqual(ab, ab); return false; }
  return crypto.timingSafeEqual(ab, bb);
}

async function readBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
    return req.body;
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 8000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonError(res, 405, 'method_not_allowed', 'GET or POST only');
  }
  if (!refConfigured()) return jsonError(res, 500, 'not_configured', 'Reference data is not configured');

  // Auth: service key gates it only if one is configured.
  const svcKey = process.env.REFERENCE_LOOKUP_KEY;
  if (svcKey) {
    const presented = req.headers['x-brain-key'];
    const keyOk = typeof presented === 'string' && timingSafeEq(presented, svcKey);
    if (!keyOk) {
      const ctx = await requireAuth(req, res);
      if (!ctx) return;
      const ok = !!getProductRole(ctx, PRODUCTS.slugs.LUNA_BRAIN) || isStaffEmail(ctx.email);
      if (!ok) return jsonError(res, 403, 'forbidden', 'Not authorised');
    }
  }

  let query = '';
  if (req.method === 'GET') query = String(req.query?.q || '');
  else { const body = await readBody(req).catch(() => ({})); query = String(body.query || body.q || ''); }
  query = query.slice(0, 500).trim();
  if (!query) return jsonError(res, 400, 'no_query', 'A query is required');

  try {
    const index = await getIndex();
    const matches = matchEntities(index, query);
    const shaped = shapeMatches(matches);
    return res.status(200).json({
      ok: true,
      query,
      matched: { countries: shaped.countries.length, airports: shaped.airports.length },
      context: formatContext(matches),
      ...shaped,
    });
  } catch (err) {
    console.error('[reference/lookup] error:', err && err.message);
    return jsonError(res, 502, 'lookup_failed', 'Reference lookup could not finish');
  }
}
