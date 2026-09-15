/**
 * Page visits: the public site counts them, the tool reads them.
 *
 * The write goes through public.record_visit, a definer function that is the
 * renderer role's only privilege here (migration 0034 has the argument in
 * full). It takes the tenant from the transaction, checks the shape and
 * increments one row per day, path, kind and source. Reads are the app role's,
 * tenant-scoped like everything else in this directory, and the one deletion
 * is the housekeeping cron's, through a second definer function.
 *
 * Every function here is best effort at the call site: a count that fails is
 * not a page that fails, and a dashboard whose table is not there yet shows no
 * panel rather than no page.
 *
 * THIS FILE IS A DOOR (tests/db.test.ts pins the list). The prune runs across
 * every site at once, so there is no tenant to scope its transaction to; it
 * opens the app pool directly, like lib/db/reference.ts does for the shared
 * corpus, and the definer function it calls is the only thing the app role
 * may delete through. Nothing else here opens a connection of its own.
 */

import 'server-only';

import type { VisitClass } from '../visits/classify';
import type { VisitRow } from '../visits/summary';
import { db } from './client';
import { withPublicTenant, withTenant } from './withTenant';

/** Count one request. True when the function took it. */
export async function recordVisit(tenantId: string, visit: VisitClass & { path: string }): Promise<boolean> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select public.record_visit(${visit.path}, ${visit.kind}, ${visit.source}) as stored
    `;
    return rows.length > 0 && (rows[0] as Record<string, unknown>).stored === true;
  });
}

/**
 * Every row for this site in the last `days` UTC days, oldest first. The
 * summary in lib/visits/summary.ts does the shaping; this only fetches.
 */
export async function listVisitRows(tenantId: string, days = 60): Promise<VisitRow[]> {
  const span = Math.max(1, Math.min(365, Math.floor(days)));
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select day::text as day, path, kind, source, count
      from public.page_visits
      where day >= (now() at time zone 'utc')::date - ${span}
      order by day asc
    `;
    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        day: String(row.day ?? ''),
        path: String(row.path ?? '/'),
        kind: String(row.kind ?? 'visitor') as VisitRow['kind'],
        source: String(row.source ?? ''),
        count: Number(row.count ?? 0),
      };
    });
  });
}

/**
 * Drop rows older than `days`, across every site, for the nightly cron. The
 * function runs with definer rights, which is what lets one call cross tenants;
 * the app role calling it holds no delete of its own.
 */
export async function pruneVisits(days = 90): Promise<number> {
  return db('app').begin(async (tx) => {
    const rows = await tx`select public.prune_page_visits(${Math.floor(days)}) as pruned`;
    return rows.length ? Number((rows[0] as Record<string, unknown>).pruned ?? 0) : 0;
  }) as Promise<number>;
}
