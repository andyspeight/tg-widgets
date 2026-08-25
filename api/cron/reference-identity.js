/**
 * POST /api/cron/reference-identity  (NOT SCHEDULED, manual invocation only)
 *
 * UNSCHEDULED 25 Aug 2026 at Andy's instruction. The automated fill was solving
 * the wrong problem: it can verify that an airport exists and where it is, but
 * the value in this table is the narrative, and no cron can verify that. Filling
 * coordinates on 368 new airports while the 102 records already live on client
 * sites had never been audited would have widened a problem instead of fixing
 * it. The data is being rebuilt by hand, record by record, against the
 * airport-spotlight methodology.
 *
 * Kept because the identity cross-check is still the right first step for any
 * record once the manual audit reaches it, and because the backfill pass is the
 * cheapest way to give an audited record its coordinates. Invoke deliberately,
 * do not re-add to vercel.json crons without deciding that automation is
 * wanted again.
 *
 * Works the airport table towards full coverage, a batch at a time, using the
 * two-independent-source model. Two passes per run:
 *
 *   1. Backfill  records we already have that were never sourced. Fills only
 *      blanks, only with values BOTH OurAirports and Wikidata saw. On by
 *      default: it cannot overwrite anything and cannot touch narrative.
 *   2. Create    identity-verified skeletons for airports on the worklist we
 *      have no record for. Status In progress, so the picker never offers them
 *      and no client site can reach them until a human has written and verified
 *      the narrative. On by default: reaching full coverage is the job, every
 *      created record is corroborated by both sources, and nothing created here
 *      is servable. Set REFERENCE_BREADTH_CREATE=false to stop it.
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
  const create = process.env.REFERENCE_BREADTH_CREATE !== 'false';

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
