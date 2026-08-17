/**
 * The activity log: recording what happened to a site, and reading it back.
 *
 * One human line per event and no content, so the table can hold every kind of
 * event rather than just a publish. See db/migrations/0021_site_activity.sql for
 * why this is separate from publish_events, which keeps the published bytes for
 * rollback.
 *
 * recordActivity is meant to be called FROM INSIDE the mutation it describes, a
 * page publish or a delete. withTenant reuses an already-open transaction for the
 * same tenant and role (see lib/db/withTenant.ts), so the event is written in the
 * same atomic unit as the change and rolled back with it if the change fails. A
 * caller outside any transaction still works: it simply opens its own.
 *
 * The summary is built by the caller from TRUSTED data, a page title that was
 * sanitised on save, and stored and shown as text. It is never free client
 * input, so there is nothing to escape here beyond what the view does on render.
 */

import { withTenant } from './withTenant';

/**
 * A stable machine tag for the kind of event, which the screen groups and icons
 * off. Widened as later slices record regions, members and settings. Slice one
 * records the three page events that nothing else already keeps: a page created,
 * deleted, or published. (A publish is also kept in publish_events, for its
 * bytes; here it earns its line in the timeline.)
 */
export type ActivityAction = 'page.create' | 'page.delete' | 'page.publish';

export interface ActivityEntry {
  id: string;
  /** The user who did it, or null for an event no person triggered. */
  actorId: string | null;
  action: ActivityAction;
  summary: string;
  createdAt: Date;
}

interface RecordInput {
  actorId?: string | null;
  action: ActivityAction;
  summary: string;
}

/**
 * Append one event. Call it from within the mutation it records so it shares
 * that transaction; the log is append-only, so there is no update or delete
 * here and none granted in the database.
 */
export async function recordActivity(tenantId: string, input: RecordInput): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx`
      insert into public.site_activity (tenant_id, actor_id, action, summary)
      values (
        ${tenantId}::uuid,
        ${input.actorId ?? null}::text,
        ${input.action},
        ${input.summary}
      )
    `;
  });
}

/**
 * The most recent events for a site, newest first.
 *
 * Ordered by (created_at desc, id desc) so two events in the same clock tick
 * still have a stable order, and read straight off the (tenant_id, created_at)
 * index. Capped, because a timeline is scrolled not paged in slice one.
 */
export async function listActivity(tenantId: string, limit = 50): Promise<ActivityEntry[]> {
  const capped = Math.min(Math.max(1, Math.trunc(limit)), 200);
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, actor_id, action, summary, created_at
      from public.site_activity
      where tenant_id = ${tenantId}::uuid
      order by created_at desc, id desc
      limit ${capped}
    `;
    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        id: String(row.id),
        actorId: row.actor_id != null ? String(row.actor_id) : null,
        action: row.action as ActivityAction,
        summary: String(row.summary),
        createdAt: new Date(row.created_at as string),
      };
    });
  });
}

/**
 * The one line shown for a page event, built from the page's own title.
 *
 * A single place so the wording stays consistent across the three call sites and
 * a test can hold it honest. The title is trimmed and falls back the same way
 * createPage does, so a page saved with no name still reads sensibly.
 */
export function pageActivitySummary(action: ActivityAction, title: string): string {
  const name = title.trim() || 'Untitled page';
  switch (action) {
    case 'page.create':
      return `Created the ${name} page`;
    case 'page.delete':
      return `Deleted the ${name} page`;
    case 'page.publish':
      return `Published the ${name} page`;
  }
}
