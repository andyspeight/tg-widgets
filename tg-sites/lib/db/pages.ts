/**
 * Pages: the list, the draft, the published copy, and publishing.
 *
 * WHERE THE TRUTH LIVES
 *
 * A page's id, slug, title and SEO exist twice: as columns on `pages`, and
 * inside the content JSON. That is not an accident and it is not free, so it
 * is worth being explicit: THE COLUMNS WIN. They are indexed, constrained and
 * queryable, which the JSON is not, and a uniqueness rule on a slug can only
 * be enforced by the database if the slug is a column.
 *
 * The JSON keeps its copies so that a page exported to a file is complete and
 * can be opened without the row it came from. Every read re-stamps them from
 * the columns, so the two cannot drift apart even if something writes only
 * one of them.
 */

import { createPage as blankPage } from '../content/factory';
import { sanitisePage } from '../content/sanitise-page';
import { parsePage, type Page } from '../content/schema';
import { withPublicTenant, withTenant, type Tx } from './withTenant';

/** How deep a path may nest. A guard against a cycle, not a product limit. */
const MAX_PATH_DEPTH = 6;

export interface PageSummary {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  /** True when the draft has moved on since the last publish. */
  hasUnpublishedChanges: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface PageWithContent extends PageSummary {
  content: Page;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * The columns every read wants, as a composable fragment.
 *
 * Built from the transaction's own tagged template rather than pasted into a
 * string, so it stays a parameterised query all the way down and there is no
 * raw SQL concatenation anywhere in this file.
 */
function summary(tx: Tx) {
  return tx`
    id, parent_id, slug, title, status, published_at, updated_at,
    (published_at is null or updated_at > published_at) as has_unpublished_changes
  `;
}

function toSummary(row: Record<string, unknown>): PageSummary {
  return {
    id: String(row.id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    slug: String(row.slug ?? ''),
    title: String(row.title),
    status: row.status as 'draft' | 'published',
    hasUnpublishedChanges: Boolean(row.has_unpublished_changes),
    publishedAt: row.published_at ? new Date(row.published_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Turn a stored tree back into a Page, with the columns overwriting the
 * JSON's copies of id, slug, title and SEO.
 *
 * Throws rather than salvages. Every write goes through parsePage, so stored
 * content that will not parse means something has written round this module,
 * and a silent repair would hide that until it mattered.
 */
function hydrate(row: Record<string, unknown>, raw: unknown): Page {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const parsed = parsePage({
    version: 1,
    sections: [],
    ...source,
    id: String(row.id),
    slug: String(row.slug ?? ''),
    title: String(row.title),
    seo: row.seo ?? {},
  });

  if (!parsed.ok) {
    throw new Error(
      `Stored content for page ${String(row.id)} will not parse: ${parsed.errors.join('; ')}`,
    );
  }

  return parsed.page;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Every page this tenant has, parents before their children. */
export async function listPages(tenantId: string): Promise<PageSummary[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select ${summary(tx)} from public.pages
      order by (parent_id is not null), slug
    `;
    return rows.map((row) => toSummary(row as Record<string, unknown>));
  });
}

/** One page and its draft content, or null if it is not this tenant's. */
export async function getPage(
  tenantId: string,
  pageId: string,
): Promise<PageWithContent | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select ${summary(tx)}, seo, draft_content
      from public.pages where id = ${pageId}::uuid
    `;
    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    return { ...toSummary(row), content: hydrate(row, row.draft_content) };
  });
}

/**
 * A published page, by URL path, for the public website.
 *
 * Runs as the read-only role, so a draft is invisible here even with the
 * right tenant set. Walks the path a segment at a time rather than joining,
 * because each step is an index lookup on (tenant_id, parent_id, slug) and
 * the common case, a home page, is a single query.
 */
export async function getPublishedPage(
  tenantId: string,
  path: string,
): Promise<{ id: string; title: string; content: Page } | null> {
  const segments = path.split('/').map((s) => s.trim()).filter(Boolean);

  if (segments.length > MAX_PATH_DEPTH) return null;

  return withPublicTenant(tenantId, async (tx) => {
    let parentId: string | null = null;
    let row: Record<string, unknown> | null = null;

    // An empty path is the home page: one row with slug '' and no parent.
    for (const slug of segments.length ? segments : ['']) {
      const rows: Record<string, unknown>[] = parentId === null
        ? await tx`
            select id, slug, title, seo, published_content
            from public.pages
            where parent_id is null and slug = ${slug}
            limit 1
          `
        : await tx`
            select id, slug, title, seo, published_content
            from public.pages
            where parent_id = ${parentId}::uuid and slug = ${slug}
            limit 1
          `;

      if (!rows.length) return null;
      row = rows[0];
      parentId = String(row.id);
    }

    if (!row) return null;

    // Published but never given content is not a page anyone should see.
    if (row.published_content == null) return null;

    return {
      id: String(row.id),
      title: String(row.title),
      content: hydrate(row, row.published_content),
    };
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface NewPage {
  title: string;
  slug?: string;
  parentId?: string | null;
}

/**
 * Create a page with an empty tree.
 *
 * The slug is not made unique here on purpose. Two partial unique indexes
 * already enforce it, and letting the database refuse means two requests
 * racing cannot both win, which a read-then-write check in here could not
 * promise.
 */
export async function createPage(
  tenantId: string,
  input: NewPage,
): Promise<PageWithContent> {
  const title = input.title.trim() || 'Untitled page';
  const slug = (input.slug ?? '').trim();

  return withTenant(tenantId, async (tx) => {
    const content = sanitisePage(blankPage(title, slug));

    const rows = await tx`
      insert into public.pages (tenant_id, parent_id, slug, title, draft_content)
      values (
        ${tenantId}::uuid,
        ${input.parentId ?? null}::uuid,
        ${slug},
        ${title},
        ${JSON.stringify(content)}::jsonb
      )
      returning ${summary(tx)}, seo, draft_content
    `;

    const row = rows[0] as Record<string, unknown>;
    return { ...toSummary(row), content: hydrate(row, row.draft_content) };
  });
}

/** Rename, re-slug or re-parent a page. Content is untouched. */
export async function updatePageMeta(
  tenantId: string,
  pageId: string,
  changes: { title?: string; slug?: string; parentId?: string | null },
): Promise<PageSummary | null> {
  if (changes.parentId && changes.parentId === pageId) {
    throw new Error('A page cannot be its own parent.');
  }

  return withTenant(tenantId, async (tx) => {
    const movingParent = 'parentId' in changes;

    const rows = await tx`
      update public.pages set
        title     = coalesce(${changes.title?.trim() || null}::text, title),
        slug      = coalesce(${changes.slug?.trim() ?? null}::text, slug),
        parent_id = case when ${movingParent}
                      then ${changes.parentId ?? null}::uuid
                      else parent_id end
      where id = ${pageId}::uuid
      returning ${summary(tx)}
    `;

    return rows.length ? toSummary(rows[0] as Record<string, unknown>) : null;
  });
}

/**
 * Save the editor's draft.
 *
 * Parsed, normalised and sanitised before it is stored, in that order, and
 * none of it is optional. The editor does the same work client side for
 * immediate feedback, but the editor is not the only thing that can write
 * here and the client half of a check is a courtesy, not a control.
 */
export async function saveDraft(
  tenantId: string,
  pageId: string,
  input: unknown,
  userId?: string,
): Promise<PageSummary | null> {
  const parsed = parsePage(input);
  if (!parsed.ok) {
    throw new Error(`Refusing to save a malformed page: ${parsed.errors.join('; ')}`);
  }

  const content = sanitisePage(parsed.page);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.pages set
        draft_content = ${JSON.stringify(content)}::jsonb,
        title         = ${content.title},
        seo           = ${JSON.stringify(content.seo)}::jsonb,
        updated_by    = ${userId ?? null}::text
      where id = ${pageId}::uuid
      returning ${summary(tx)}
    `;

    return rows.length ? toSummary(rows[0] as Record<string, unknown>) : null;
  });
}

/**
 * Publish: copy the draft to the live copy and record what was published.
 *
 * Both statements are inside one withTenant call, so they are one
 * transaction. A publish that wrote the live copy but lost the audit row
 * would leave nothing to roll back to, which is the one thing the audit row
 * exists for.
 */
export async function publishPage(
  tenantId: string,
  pageId: string,
  userId?: string,
): Promise<PageSummary | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.pages set
        published_content = draft_content,
        status            = 'published',
        published_at      = now(),
        updated_by        = ${userId ?? null}::text
      where id = ${pageId}::uuid
      returning ${summary(tx)}
    `;

    if (!rows.length) return null;

    // The snapshot is read back out of the row rather than passed through
    // JavaScript, so it is exactly the bytes that were published and cannot
    // drift from them.
    await tx`
      insert into public.publish_events (tenant_id, page_id, user_id, snapshot)
      select tenant_id, id, ${userId ?? null}::text, published_content
      from public.pages where id = ${pageId}::uuid
    `;

    return toSummary(rows[0] as Record<string, unknown>);
  });
}

/**
 * Take a page off the live site.
 *
 * The published copy is kept rather than cleared. Unpublishing is usually
 * temporary, and throwing away the last known good version to achieve it
 * would be a poor trade.
 */
export async function unpublishPage(
  tenantId: string,
  pageId: string,
): Promise<PageSummary | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.pages set status = 'draft'
      where id = ${pageId}::uuid
      returning ${summary(tx)}
    `;
    return rows.length ? toSummary(rows[0] as Record<string, unknown>) : null;
  });
}

/**
 * Delete a page.
 *
 * Children are orphaned to the top level rather than deleted with it, which
 * is what the schema's `on delete set null` does. Losing a whole branch of a
 * site because someone tidied up a landing page would be unforgivable, and an
 * orphaned page is recoverable in a way a deleted one is not.
 */
export async function deletePage(tenantId: string, pageId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      delete from public.pages where id = ${pageId}::uuid returning id
    `;
    return rows.length > 0;
  });
}

/** The last few publishes, newest first, for a rollback list. */
export async function listPublishes(
  tenantId: string,
  pageId: string,
  limit = 20,
): Promise<Array<{ id: string; userId: string | null; createdAt: Date }>> {
  const capped = Math.min(Math.max(1, Math.floor(limit) || 1), 100);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, user_id, created_at from public.publish_events
      where page_id = ${pageId}::uuid
      order by created_at desc
      limit ${capped}
    `;
    return rows.map((row) => ({
      id: String(row.id),
      userId: row.user_id ? String(row.user_id) : null,
      createdAt: new Date(row.created_at as string),
    }));
  });
}
