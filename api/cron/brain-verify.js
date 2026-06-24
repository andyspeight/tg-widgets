/**
 * GET/POST /api/cron/brain-verify  (Vercel Cron)
 *
 * Daily Luna Brain maintenance:
 *   1. Run the two-step gate over any new pending knowledge (auto-publishing
 *      what passes, leaving exceptions in the human queue).
 *   2. Re-check Active+Verified items whose freshness has lapsed (per-Type TTL),
 *      re-stamping the ones that still hold and dropping the rest back to
 *      Needs Review.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET} (same convention as the other crons).
 */

import { processPending, recheckStale } from '../brain/_gate.js';

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    res.statusCode = 401;
    return res.end('Unauthorized');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.statusCode = 500;
    return res.end('ANTHROPIC_API_KEY not set');
  }

  try {
    const pending = await processPending({ limit: 25 });
    const stale = await recheckStale({ limit: 15 });
    console.log('[cron/brain-verify]', JSON.stringify({ pending: { processed: pending.processed, published: pending.published, escalated: pending.escalated }, stale: { due: stale.due } }));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, pending, stale }));
  } catch (err) {
    console.error('[cron/brain-verify] error:', err && err.message);
    res.statusCode = 500;
    return res.end('error');
  }
}
