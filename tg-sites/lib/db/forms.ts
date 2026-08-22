/**
 * Form submissions: the public site files them, the tool reads them.
 *
 * The write goes through public.submit_form, a definer function that is the
 * renderer role's ONLY privilege here (migration 0025 has the argument in
 * full). It enforces the tenant, the payload caps and a per-tenant rate cap,
 * and answers with a boolean rather than an exception, so the route can treat
 * "not stored" exactly like "stored" where that is the right face to show.
 *
 * Reads and mark-as-read are the app role's, tenant-scoped like everything
 * else in this directory. There is deliberately no delete: see the migration.
 */

import 'server-only';

import { withPublicTenant, withTenant } from './withTenant';

export interface FormSubmission {
  id: string;
  pageId: string | null;
  formBlockId: string;
  formName: string;
  data: Record<string, string>;
  meta: { path?: string; ua?: string };
  readAt: string | null;
  createdAt: string;
}

function toSubmission(row: Record<string, unknown>): FormSubmission {
  const data = row.data && typeof row.data === 'object' ? (row.data as Record<string, string>) : {};
  const meta = row.meta && typeof row.meta === 'object' ? (row.meta as { path?: string; ua?: string }) : {};
  return {
    id: String(row.id),
    pageId: row.page_id === null || row.page_id === undefined ? null : String(row.page_id),
    formBlockId: String(row.form_block_id ?? ''),
    formName: String(row.form_name ?? ''),
    data,
    meta,
    readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at ?? ''),
  };
}

/**
 * File one submission as the public site. True when stored; false when the
 * function refused it (over the rate cap, over a size cap, no tenant), which
 * the caller does not distinguish for the visitor.
 */
export async function storeSubmission(
  tenantId: string,
  input: {
    pageId: string | null;
    formBlockId: string;
    formName: string;
    data: Record<string, string>;
    meta: { path?: string; ua?: string };
  },
): Promise<boolean> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select public.submit_form(
        ${input.pageId}::uuid,
        ${input.formBlockId},
        ${input.formName},
        ${tx.json(input.data)},
        ${tx.json(input.meta)}
      ) as stored
    `;
    return rows.length > 0 && (rows[0] as Record<string, unknown>).stored === true;
  });
}

/** Newest first. A site's enquiries are tens, not thousands; one page of 200
 * covers a long while and keeps the screen simple. */
export async function listSubmissions(tenantId: string, limit = 200): Promise<FormSubmission[]> {
  const capped = Math.min(500, Math.max(1, Math.floor(limit)));
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, page_id, form_block_id, form_name, data, meta, read_at, created_at
      from public.form_submissions
      order by created_at desc, id desc
      limit ${capped}
    `;
    return rows.map((row) => toSubmission(row as Record<string, unknown>));
  });
}

/** How many are unread, for the badge. */
export async function countUnreadSubmissions(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select count(*)::int as n from public.form_submissions where read_at is null
    `;
    return rows.length ? Number((rows[0] as Record<string, unknown>).n ?? 0) : 0;
  });
}

/** Mark one read. Reading is not un-doable from the tool, on purpose: the
 * badge is "needs a first look", not an inbox workflow. */
export async function markSubmissionRead(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx`
      update public.form_submissions
      set read_at = now()
      where id = ${id}::uuid and read_at is null
    `;
  });
}
