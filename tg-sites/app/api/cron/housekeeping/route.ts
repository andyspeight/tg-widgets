import { NextResponse } from 'next/server';

import { pruneVisits } from '../../../../lib/db/visits';

/**
 * Nightly housekeeping: keep the page-visit tally to ninety days.
 *
 * Its own route rather than a line in reference-sync, because the two have
 * nothing in common but the clock: one pulls a corpus from Airtable, this one
 * trims a table, and a corpus failure should not stop the trim or the other
 * way round. Anything else that needs a nightly tidy joins this route.
 *
 * AUTH is the same bearer secret every cron in this estate uses. Vercel sends
 * it; nothing else can call this. No secret configured is a closed door.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Ninety days: long enough for a quarter's chart, short enough to mean nothing to anyone. */
const KEEP_VISIT_DAYS = 90;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const pruned = await pruneVisits(KEEP_VISIT_DAYS);
    return NextResponse.json({ visits: { kept: KEEP_VISIT_DAYS, pruned } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[housekeeping]', reason);
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
