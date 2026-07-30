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

/**
 * How many publishes are kept per page.
 *
 * A snapshot is the whole page, so this is real storage: a busy page published
 * twice a day reaches this in three months and then stops growing. Fifty is far
 * more than anybody scrolls and far less than unbounded.
 *
 * Pruned inside the publish transaction rather than by a trigger or a cron. A
 * trigger would be more robust against a second writer, and there is exactly one
 * writer, asserted by a test. Doing it in code keeps it visible next to the insert
 * it belongs to, and testable without a database.
 */
export const PUBLISH_HISTORY_LIMIT = 50;

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

/**
 * Hand a value to the driver as JSON.
 *
 * The cast is unavoidable rather than lazy: the driver types its JSON
 * parameter as an index-signature shape, and TypeScript will not accept a
 * concrete interface like Page as one even though every value inside it is
 * plain JSON. Everything reaching here has already been through parsePage.
 */
function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
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
 * A jsonb column as an object, whatever shape it arrives in.
 *
 * WHY THIS IS NOT PARANOIA
 *
 * Every jsonb write here used to be `${JSON.stringify(x)}::jsonb`, which
 * double encodes: the driver serialises the JS string to JSON, and the cast
 * then reads it back as a JSON *string* containing JSON. `jsonb_typeof` says
 * "string" instead of "object". The writes use tx.json() now, but rows saved
 * before that fix are still wrapped, and there is no version of this worth
 * failing to read a client's page over.
 *
 * The old code did `typeof raw === 'object' ? raw : {}`, which turned a
 * wrapped page into an EMPTY one and silently threw the content away. That
 * was the worse half of the bug: the 500 on `seo` was at least loud.
 */
function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      // A string can nest more than once. Keep unwrapping.
      return asObject(parsed);
    } catch {
      return null;
    }
  }

  return null;
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
  const source = asObject(raw) ?? {};

  const parsed = parsePage({
    version: 1,
    sections: [],
    ...source,
    id: String(row.id),
    slug: String(row.slug ?? ''),
    title: String(row.title),
    seo: asObject(row.seo) ?? {},
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
    if (asObject(row.published_content) === null) return null;

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
        ${json(tx, content)}
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
        draft_content = ${json(tx, content)},
        title         = ${content.title},
        seo           = ${json(tx, content.seo)},
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
    // drift from them. The title comes from the same row for the same reason.
    await tx`
      insert into public.publish_events (tenant_id, page_id, user_id, snapshot, title)
      select tenant_id, id, ${userId ?? null}::text, published_content, title
      from public.pages where id = ${pageId}::uuid
    `;

    /*
     * Prune, in the same transaction as the insert.
     *
     * Deleting by id from a subquery rather than by a date or a row number
     * comparison, because created_at has no uniqueness: two publishes inside the
     * same clock tick would either both survive a `<` comparison or both be
     * deleted by a `<=` one. Ordering by (created_at desc, id desc) is total, so
     * the set of survivors is exactly the newest PUBLISH_HISTORY_LIMIT rows
     * whatever the timestamps do.
     *
     * Scoped to this page: another page's history is not this publish's business,
     * and the tenant scope is the policy's job as everywhere else in this file.
     */
    await tx`
      delete from public.publish_events
      where page_id = ${pageId}::uuid
        and id not in (
          select id from public.publish_events
          where page_id = ${pageId}::uuid
          order by created_at desc, id desc
          limit ${PUBLISH_HISTORY_LIMIT}
        )
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

export interface PublishRecord {
  id: string;
  /** Who pressed publish. Null when it was published before sign-in existed. */
  userId: string | null;
  /** The page's title at that moment. Null for rows written before 0014. */
  title: string | null;
  createdAt: Date;
}

/**
 * The last few publishes, newest first, for a rollback list.
 *
 * Deliberately does NOT select the snapshot. Each one is a whole page, so a list of
 * twenty would drag twenty page-sized blobs across the wire to render twenty lines
 * of text. The title column exists precisely so this query does not have to.
 *
 * Ordered by (created_at desc, id desc) to match the prune in publishPage. Two
 * publishes in the same clock tick would otherwise come back in an order the
 * database is free to change between calls, which reads as rows jumping about.
 */
export async function listPublishes(
  tenantId: string,
  pageId: string,
  limit = 20,
): Promise<PublishRecord[]> {
  const capped = Math.min(Math.max(1, Math.floor(limit) || 1), 100);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, user_id, title, created_at from public.publish_events
      where page_id = ${pageId}::uuid
      order by created_at desc, id desc
      limit ${capped}
    `;
    return rows.map(toPublishRecord);
  });
}

function toPublishRecord(row: Record<string, unknown>): PublishRecord {
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    title: row.title == null ? null : String(row.title),
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Put an old version back, AS A DRAFT.
 *
 * THE RESTORE DOES NOT PUBLISH, and that is the whole design. Somebody reaching for
 * this is already having a bad day: they have published something wrong and want
 * Tuesday's version back. Restoring straight to live would be a second unreviewed
 * publish inside a minute, made by the person least able to check it calmly. So it
 * lands in the draft, they look at it, and they press Publish like any other change,
 * which also writes its own snapshot and keeps the history honest.
 *
 * The side effect of that: the live page is unchanged until they publish. Worth
 * saying in the UI, because "restore" sounds instant.
 *
 * WHAT COMES BACK. The snapshot is the whole Page object, so the title and the SEO
 * come with it. They are re-stamped onto their columns from the snapshot's own JSON
 * rather than from the title column, which is only a projection for the list. That
 * keeps the rule at the top of this file intact: the columns win, and they are
 * written from the same object that becomes the content.
 *
 * Everything goes through parsePage and sanitisePage on the way out. A snapshot is
 * stored bytes, and stored bytes from an older version of the schema are exactly the
 * case where a shape can have drifted. It is also the one path in this file that
 * writes content the current editor did not just produce.
 */
export async function restorePublish(
  tenantId: string,
  pageId: string,
  publishId: string,
  userId?: string,
): Promise<PageWithContent | null> {
  return withTenant(tenantId, async (tx) => {
    const found = await tx`
      select snapshot from public.publish_events
      where id = ${publishId}::uuid and page_id = ${pageId}::uuid
    `;
    /*
     * Both ids in the WHERE, so a publish id belonging to another page of the same
     * tenant restores nothing rather than restoring the wrong page. The tenant scope
     * is the policy's job; this is the scope the policy does not cover.
     */
    if (!found.length) return null;

    const parsed = parsePage(found[0].snapshot);
    if (!parsed.ok) {
      throw new Error(
        `That version cannot be restored, its stored content will not parse: ${parsed.errors.join('; ')}`,
      );
    }

    const content = sanitisePage(parsed.page);

    const rows = await tx`
      update public.pages set
        draft_content = ${json(tx, content)},
        title         = ${content.title},
        seo           = ${json(tx, content.seo)},
        updated_by    = ${userId ?? null}::text
      where id = ${pageId}::uuid
      returning ${summary(tx)}, seo, draft_content
    `;

    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    return { ...toSummary(row), content: hydrate(row, row.draft_content) };
  });
}
