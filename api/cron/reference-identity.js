/**
 * POST /api/cron/reference-identity
 *
 * SCHEDULED AGAIN 26 Aug 2026, every two hours, at Andy's instruction to start
 * creating the airports we do not yet carry.
 *
 * It was unscheduled on 25 Aug 2026 for a good reason and that reason has now
 * expired. The objection then was that filling coordinates on 368 new airports
 * while the 102 records already live on client sites had never been audited
 * would widen a problem instead of fixing it. Those records have since been
 * audited: all 225 are Status Done, two-sourced, and carry an August 2026
 * Verified Date. The condition the old note set, that the identity cross-check
 * is the right first step "once the manual audit reaches it", is now met.
 *
 * TURN THIS BACK OFF once coverage is reached. Every run scans four tables in
 * full to work out what is missing, which is pure waste when nothing is. When
 * the create pass reports missing 0 on consecutive runs, drop the entry from
 * vercel.json crons or move it to daily.
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
 * Batch sizes keep each run inside the function timeout; the schedule is what
 * gets through the backlog. See docs/airport-data-plan.md.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET}.
 */

import { runIdentityBackfill, runBreadthFill } from '../reference/_breadth_fill.js';

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized'); }

  // Sized against the 300s maxDuration in vercel.json, not against ambition.
  // Both passes are sequential and each record costs one SPARQL round trip, so
  // 25 + 50 leaves room for a slow Wikidata. A run killed by the timeout is not
  // dangerous, since records already written stay written and the next run
  // recomputes what is missing, but it is wasted work. Leave the margin alone.
  const backfillLimit = parseInt(process.env.REFERENCE_BACKFILL_LIMIT || '25', 10);
  const createLimit = parseInt(process.env.REFERENCE_CREATE_LIMIT || '50', 10);
  const create = process.env.REFERENCE_BREADTH_CREATE !== 'false';

  try {
    const backfill = await runIdentityBackfill({ limit: backfillLimit, write: true });
    const fill = await runBreadthFill({ limit: createLimit, create });

    const summary = {
      backfill: {
        due: backfill.due, processed: backfill.processed, filled: backfill.filled,
        failed: backfill.failed, conflict: backfill.conflict, unverifiable: backfill.unverifiable,
      },
      create: {
        enabled: create, missing: fill.missing, processed: fill.processed,
        verified: fill.verified, created: fill.created, failed: fill.failed,
        conflict: fill.conflict, unverifiable: fill.unverifiable,
      },
      // A record that verified cleanly but could not be written is a different
      // problem from one the sources disagreed on, and it must not be summarised
      // away: it is the difference between "we created it" and "we tried to".
      writeFailures: [
        ...backfill.items.filter(i => i.writeError).map(i => ({ iata: i.iata, error: i.writeError })),
        ...fill.items.filter(i => i.writeError).map(i => ({ iata: i.iata, error: i.writeError })),
      ],
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
