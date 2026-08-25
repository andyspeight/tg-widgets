/**
 * GET/POST /api/cron/reference-freshness  (Vercel Cron, daily)
 *
 * Re-checks reference airports whose Verified Date has lapsed against their
 * cited sources and logs a freshness report. Report-only by default: it does
 * not re-stamp Verified Date or change any record, so a wrong AI call can never
 * silently refresh stale data. Set BRAIN_FRESHNESS_FLAG_DRIFT=true to let it
 * move clearly-drifted records to "In progress" for a human.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET}.
 */

import { runFreshness } from '../reference/_freshness.js';

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized'); }
  if (!process.env.ANTHROPIC_API_KEY) { res.statusCode = 500; return res.end('ANTHROPIC_API_KEY not set'); }

  const ttlDays = parseInt(process.env.BRAIN_FRESHNESS_TTL_DAYS || '60', 10);
  const flagDrift = process.env.BRAIN_FRESHNESS_FLAG_DRIFT === 'true';
  // 25 a week against a 60 day TTL never caught up even on 230 records, so every
  // record sat permanently overdue and nothing was ever re-stamped. Daily now,
  // with a batch that can clear the table inside the TTL as it grows to 593.
  const freshnessLimit = parseInt(process.env.BRAIN_FRESHNESS_LIMIT || '40', 10);

  try {
    const summary = await runFreshness({ ttlDays, limit: freshnessLimit, restampValid: false, flagDrift });
    console.log('[cron/reference-freshness]', JSON.stringify({
      ttlDays: summary.ttlDays, due: summary.due, checked: summary.checked,
      holds: summary.holds, drifted: summary.drifted, unverifiable: summary.unverifiable, flagged: summary.flagged,
      driftedAirports: summary.items.filter(i => i.verdict === 'drifted').map(i => ({ a: i.airport, changes: i.changes })),
    }));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, ...summary }));
  } catch (err) {
    console.error('[cron/reference-freshness] error:', err && err.message);
    res.statusCode = 500;
    return res.end('error');
  }
}
