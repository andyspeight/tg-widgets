/**
 * GET/POST /api/cron/reference-identity  (Vercel Cron, daily)
 *
 * Works the airport table towards full coverage, a batch at a time, using the
 * two-independent-source model. Two passes per run:
 *
 *   1. Backfill  records we already have that were never sourced. Fills only
 *      blanks, only with values BOTH OurAirports and Wikidata saw. On by
 *      default: it cannot overwrite anything and cannot touch narrative.
 *   2. Create    identity-verified skeletons for airports on the worklist we
 *      have no record for. Status In progress, so the picker never offers them
 *      until a human has written and verified the narrative. OFF unless
 *      REFERENCE_BREADTH_CREATE=true, because creating hundreds of records is a
 *      bigger step than filling blanks and deserves a deliberate switch.
 *
 * Batch sizes keep each run inside the function timeout; the daily schedule is
 * what gets through the backlog. See docs/airport-data-plan.md.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET}.
 */

import { runIdentityBackfill, runBreadthFill } from '../reference/_breadth_fill.js';

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized'); }

  const backfillLimit = parseInt(process.env.REFERENCE_BACKFILL_LIMIT || '25', 10);
  const createLimit = parseInt(process.env.REFERENCE_CREATE_LIMIT || '25', 10);
  const create = process.env.REFERENCE_BREADTH_CREATE === 'true';

  try {
    const backfill = await runIdentityBackfill({ limit: backfillLimit, write: true });
    const fill = await runBreadthFill({ limit: createLimit, create });

    const summary = {
      backfill: {
        due: backfill.due, processed: backfill.processed, filled: backfill.filled,
        conflict: backfill.conflict, unverifiable: backfill.unverifiable,
      },
      create: {
        enabled: create, missing: fill.missing, processed: fill.processed,
        verified: fill.verified, created: fill.created,
        conflict: fill.conflict, unverifiable: fill.unverifiable,
      },
      // Anything two sources would not agree on is a human's call, never a guess.
      needsHuman: [
        ...backfill.items.filter(i => i.verdict !== 'verified').map(i => ({ iata: i.iata, why: i.verdict, detail: i.conflicts || i.reason })),
        ...fill.items.filter(i => i.verdict !== 'verified').map(i => ({ iata: i.iata, why: i.verdict, detail: i.conflicts || i.reason })),
      ],
    };
    console.log('[cron/reference-identity]', JSON.stringify(summary));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, ...summary }));
  } catch (err) {
    console.error('[cron/reference-identity] error:', err && err.message);
    res.statusCode = 500;
    return res.end('error');
  }
}
