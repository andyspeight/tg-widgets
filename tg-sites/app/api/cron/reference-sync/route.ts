import { NextResponse } from 'next/server';

import { syncAllReference } from '../../../../lib/db/reference';

/**
 * Fill the local copy of the destination corpus, on a schedule.
 *
 * WHY A VISITOR NEVER TOUCHES ANY OF THIS. The rule in CLAUDE.md is that a
 * visitor's browser must never trigger a supplier call, and it was written after
 * a "fall back to live if the cache is empty" path cost four thousand searches a
 * week. A destination page that waited on Airtable would be the same mistake in
 * different clothes, so the corpus is pulled on our own schedule and every page
 * renders from Postgres.
 *
 * ONE KIND AT A TIME, and a kind that fails does not take the others with it.
 * Five tables, three status vocabularies and a schema that has changed five times
 * this year: the likeliest failure is one of them, not all of them, and losing
 * four good kinds because the fifth moved would be a worse outcome than a partial
 * sync somebody can read in a log.
 *
 * IT ANSWERS 500 WHEN ANY KIND FAILED, even though the rest were written. A cron
 * that reports success while a table quietly stopped syncing is how a corpus goes
 * stale for a fortnight without anybody noticing, which is the exact shape of the
 * font 404 and the four missing scripts. The body says which kinds and why.
 *
 * AUTH is the same bearer secret every cron in this estate uses. Vercel sends it;
 * nothing else can call this.
 */

/* The sync writes, reads a network and takes seconds. Nothing about it is static. */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';

  // No secret configured is a closed door, not an open one.
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { ok, failed } = await syncAllReference();

  const summary = {
    synced: ok.map((outcome) => ({
      kind: outcome.kind,
      written: outcome.written,
      // Only when some were refused. A quiet run should read as a quiet run.
      ...(outcome.refused.length ? { refused: outcome.refused } : {}),
    })),
    failed,
  };

  if (failed.length) {
    for (const failure of failed) {
      console.error('[reference-sync]', failure.kind, failure.reason);
    }
    return NextResponse.json(summary, { status: 500 });
  }

  return NextResponse.json(summary);
}
