/**
 * The monthly client report: the tenant-scoped reads.
 *
 * Every count is over a table this directory already owns, filtered to a UTC
 * month, and every read runs inside withTenant, so RLS scopes it to the one site
 * and a query outside a scope returns zero rows (fail-closed, like the rest of
 * this directory). No web-analytics numbers here: those tables do not exist yet.
 *
 * ONE TRANSACTION PER MONTH. readMonthReport runs the shown month's counts,
 * totals and enquiry list in a single scope; readMonthMetrics runs just the
 * counts for the previous month, for the deltas. The report page is not hot, so
 * two scopes is fine and keeps each function's shape plain.
 */

import 'server-only';

import { withTenant } from './withTenant';
import type { EnquiryLine, MonthMetrics, SiteTotals } from '../content/report';

export interface MonthReport {
  metrics: MonthMetrics;
  totals: SiteTotals;
  /** The month's enquiries, newest first, capped: a list to scan, not to page. */
  enquiries: EnquiryLine[];
}

/** A count(*) query's single integer, or 0. */
function count(rows: readonly unknown[]): number {
  return rows.length ? Number((rows[0] as Record<string, unknown>).n ?? 0) : 0;
}

/** The counts a month yields, the same set for the shown and the previous month. */
export async function readMonthMetrics(tenantId: string, from: Date, to: Date): Promise<MonthMetrics> {
  return withTenant(tenantId, async (tx) => {
    const enquiries = count(
      await tx`select count(*)::int as n from public.form_submissions where created_at >= ${from} and created_at < ${to}`,
    );
    const pagesPublished = count(
      await tx`select count(*)::int as n from public.site_activity where action = 'page.publish' and created_at >= ${from} and created_at < ${to}`,
    );
    const pagesCreated = count(
      await tx`select count(*)::int as n from public.site_activity where action = 'page.create' and created_at >= ${from} and created_at < ${to}`,
    );
    const itemsPublished = count(
      await tx`
        select count(*)::int as n
        from public.collection_items ci
        join public.collections c on c.id = ci.collection_id
        where ci.published_at >= ${from} and ci.published_at < ${to}
      `,
    );
    const mediaAdded = count(
      await tx`select count(*)::int as n from public.media where created_at >= ${from} and created_at < ${to}`,
    );
    return { enquiries, pagesPublished, pagesCreated, itemsPublished, mediaAdded };
  });
}

/**
 * Enquiries by UTC day over the last `days` days, for the results screen's
 * tile and its sparkline. Twice the window is fetched so the screen can compare
 * with the window before. Only days with an enquiry come back; the summariser
 * zero-fills the rest.
 */
export async function readEnquiryDays(tenantId: string, days = 30): Promise<Array<{ day: string; count: number }>> {
  const span = Math.max(1, Math.min(365, Math.floor(days))) * 2;
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select (created_at at time zone 'utc')::date::text as day, count(*)::int as count
      from public.form_submissions
      where created_at >= (now() at time zone 'utc')::date - ${span}
      group by 1
      order by 1
    `;
    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return { day: String(row.day ?? ''), count: Number(row.count ?? 0) };
    });
  });
}

/** The full report for the shown month: its counts, the site's current totals,
 * and the month's enquiries to list. */
export async function readMonthReport(tenantId: string, from: Date, to: Date): Promise<MonthReport> {
  const metrics = await readMonthMetrics(tenantId, from, to);
  return withTenant(tenantId, async (tx) => {
    const livePages = count(
      await tx`select count(*)::int as n from public.pages where status = 'published'`,
    );
    const publishedEntries = count(
      await tx`
        select count(*)::int as n
        from public.collection_items ci
        join public.collections c on c.id = ci.collection_id
        where ci.status = 'published' and ci.published_at is not null and ci.published_at <= now()
      `,
    );
    const totalEnquiries = count(await tx`select count(*)::int as n from public.form_submissions`);
    const unreadEnquiries = count(
      await tx`select count(*)::int as n from public.form_submissions where read_at is null`,
    );

    const rows = await tx`
      select id, form_name, meta, created_at
      from public.form_submissions
      where created_at >= ${from} and created_at < ${to}
      order by created_at desc, id desc
      limit 50
    `;
    const enquiries: EnquiryLine[] = rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const meta = row.meta && typeof row.meta === 'object' ? (row.meta as { path?: string }) : {};
      return {
        id: String(row.id),
        formName: String(row.form_name ?? '') || 'Form',
        path: meta.path || '/',
        createdAt: String(row.created_at ?? ''),
      };
    });

    const totals: SiteTotals = { livePages, publishedEntries, totalEnquiries, unreadEnquiries };
    return { metrics, totals, enquiries };
  });
}
