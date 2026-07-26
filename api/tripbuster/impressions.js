/**
 * Tripbuster impression recorder
 * POST /api/tripbuster/impressions   { dealIds: [uuid, …], surface? }
 *
 * Batched by design. A widget showing six deals sends one call, and impressions
 * land in a daily counter (one row per deal per day) rather than one row per view
 * — they run orders of magnitude higher than clicks and are only ever read in
 * aggregate.
 *
 * Obvious bots are dropped rather than counted, so an agent's click-through rate
 * is not diluted by crawlers that were never going to book.
 *
 * Nothing here is stored per visitor: no IP hash, no user agent. An impression is
 * a number, so there is nothing to attach it to.
 */
import { setCors } from '../_auth.js';
import { evaluatePublicRateLimit } from '../_lib/rate-limit-public.js';
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import { userAgentInfo } from '../_lib/tripbuster/visitor.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 60;

export default async function handler(req, res) {
  setCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  const raw = Array.isArray(body.dealIds) ? body.dealIds : [];
  const ids = [...new Set(raw.filter((x) => typeof x === 'string' && UUID_RE.test(x.trim())).map((x) => x.trim()))]
    .slice(0, MAX_IDS);
  if (!ids.length) return res.status(400).json({ error: 'At least one valid deal id is required' });

  const rl = await evaluatePublicRateLimit(req, res, { event: 'tb-impression' });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  if (!tbConfigured()) return res.status(503).json({ recorded: 0 });

  // Counted silently rather than rejected: a crawler getting a 200 has no reason
  // to retry, and the agent's click-through rate stays honest.
  if (userAgentInfo(req).bot) return res.status(200).json({ recorded: 0 });

  try {
    const recorded = await tbRpc('tb_record_impressions', { p_deal_ids: ids });
    return res.status(200).json({ recorded: Number(recorded) || 0 });
  } catch (e) {
    console.error('[tripbuster/impressions] failed', e && e.code, e && e.message);
    // Never surfaced to the traveller: a missed impression count is not worth
    // an error on someone's holiday search.
    return res.status(200).json({ recorded: 0 });
  }
}
