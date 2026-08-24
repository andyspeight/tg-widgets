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
import type { NavPage } from '../content/nav';
import { livePaths, MAX_PATH_DEPTH, type PageNode } from '../content/paths';
import { sanitisePage } from '../content/sanitise-page';
import type { SearchDoc } from '../content/search';
import { parsePage, type Page } from '../content/schema';
import { pageText } from '../seo/audit';
import { pageActivitySummary, recordActivity } from './activity';
import { addressesBefore, recordMove } from './redirects';
import { withPublicTenant, withTenant, type Tx } from './withTenant';

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

/** One page's draft, stripped to what copying a whole site needs. */
export interface PageContent {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  seo: Record<string, unknown>;
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
 * Every page with its draft content, PARENTS STRICTLY BEFORE CHILDREN.
 *
 * For duplicating a site. The copy walks these in order and remaps each
 * parent_id to the id it just minted for the page above, so the order has to be
 * a real topological one, not listPages's "top level, then the rest": a three
 * level tree would otherwise offer a grandchild before its parent had an id.
 *
 * The DRAFT only, on purpose. A clone is a draft the staff rebrand before it
 * goes anywhere, so the published column is left behind rather than copied.
 */
export async function listPagesWithContent(tenantId: string): Promise<PageContent[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, parent_id, slug, title, seo, draft_content from public.pages
    `;

    const pages = rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        id: String(row.id),
        parentId: row.parent_id ? String(row.parent_id) : null,
        slug: String(row.slug ?? ''),
        title: String(row.title),
        seo: asObject(row.seo) ?? {},
        content: hydrate(row, row.draft_content),
      };
    });

    return orderParentsFirst(pages);
  });
}

/**
 * Depth first from the roots, so every page lands after its parent.
 *
 * A parent_id pointing at a page this read did not return, which a scoped read
 * has no way to produce, is treated as a root rather than dropped: a copy that
 * quietly lost a page would be worse than one with a page reparented to the top.
 */
function orderParentsFirst<T extends { id: string; parentId: string | null }>(pages: T[]): T[] {
  const ids = new Set(pages.map((page) => page.id));
  const childrenOf = new Map<string | null, T[]>();

  for (const page of pages) {
    const key = page.parentId && ids.has(page.parentId) ? page.parentId : null;
    const bucket = childrenOf.get(key);
    if (bucket) bucket.push(page);
    else childrenOf.set(key, [page]);
  }

  const ordered: T[] = [];
  const walk = (parent: string | null) => {
    for (const page of childrenOf.get(parent) ?? []) {
      ordered.push(page);
      walk(page.id);
    }
  };
  walk(null);
  return ordered;
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

/** One published address, for the sitemap. */
export interface PublishedPath {
  /** The URL path, without a leading slash. Empty string is the home page. */
  path: string;
  /** When it last changed, for <lastmod>. */
  updatedAt: string | null;
  /** Asked to be left out of every index, so it is left out of the sitemap too. */
  noindex: boolean;
  /**
   * The page's own name, and its search description.
   *
   * The sitemap wants neither and ignores both. llms.txt is a READABLE map
   * rather than a list of addresses, so it needs to say what each page is. The
   * query already selected `seo` for the noindex flag, so carrying these costs
   * one more column and no extra read. See lib/seo/llms.ts.
   */
  title: string;
  description: string;
}

/**
 * Every published address on this site.
 *
 * ONE QUERY AND THE PATHS BUILT IN JS, rather than a recursive CTE. A site is
 * tens of pages, not thousands, and the recursive version has to be read twice
 * to be believed. This is also the query a sitemap is asked for, which is a
 * crawler rather than a visitor, so it is not on anybody's critical path.
 *
 * THE WALK ITSELF MOVED TO lib/content/paths.ts on 1 Aug 2026, when the redirect
 * table needed to work out what a page's address USED to be. Two copies of it
 * would drift, and the symptom of that drift would be a redirect pointing at an
 * address that does not exist. One definition, three callers.
 *
 * A CHILD UNDER AN UNPUBLISHED PARENT IS LEFT OUT, which is exactly right:
 * getPublishedPage walks the path a segment at a time and every segment has to be
 * published, so that child's URL 404s for a visitor. A sitemap listing URLs that
 * 404 is worse than a sitemap missing them.
 */
export async function listPublishedPaths(tenantId: string): Promise<PublishedPath[]> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, parent_id, slug, title, seo, updated_at
      from public.pages
      where published_content is not null
    `;

    const byId = new Map<string, Record<string, unknown>>();
    for (const raw of rows) byId.set(String((raw as Record<string, unknown>).id), raw as Record<string, unknown>);

    /*
     * `published: true` for every row, because the query has already narrowed to
     * pages with published content and the renderer's own policy narrowed it
     * again before that. The unpublished-parent case still works: that parent is
     * simply not in this list, so livePaths finds no ancestor and leaves the
     * child out, which is the same answer the old walk gave.
     */
    const nodes: PageNode[] = [...byId.values()].map((row) => ({
      id: String(row.id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      slug: String(row.slug ?? ''),
      published: true,
    }));

    const paths: PublishedPath[] = [];

    for (const [id, path] of livePaths(nodes)) {
      const row = byId.get(id);
      if (!row) continue;
      const seo = asObject(row.seo) ?? {};
      paths.push({
        path,
        updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
        noindex: seo.noindex === true,
        // The SEARCH title where the client (or #239) gave one, and the page's
        // own name otherwise. A search title is the better label: it is written
        // to be read by somebody who has not seen the site.
        title: String(seo.title ?? row.title ?? ''),
        description: String(seo.description ?? ''),
      });
    }

    return paths;
  });
}

/**
 * Every published page reduced to what the site's own search reads.
 *
 * SAME READ-ONLY ROLE, SAME NARROWING, SAME PATH WALK as listPublishedPaths,
 * for the same reasons: search must never surface a page a visitor cannot
 * reach, and a site is tens of pages so one read and the paths built in JS
 * beats a recursive query. The one addition is the text, pulled from the
 * published content by the same pageText the writing assistant uses, so search
 * reads exactly the words a reader sees rather than the JSON around them.
 *
 * A NOINDEXED PAGE IS LEFT OUT, the same page the sitemap leaves out: a client
 * who asked for a page to stay out of every index means the site's own search
 * too, not only Google's.
 *
 * PAGES ONLY, AND THAT IS NOT THE WHOLE CORPUS. Blog posts live in
 * public.collection_items and are read by listPublishedItemsForSearch in
 * lib/db/collections.ts; the search route asks for both and ranks them together.
 * If you are adding a new kind of published thing, it needs a read of its own
 * here or next door, or it will be invisible to search while being perfectly
 * visible on the site.
 */
export async function listPublishedForSearch(tenantId: string): Promise<SearchDoc[]> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, parent_id, slug, title, seo, published_content
      from public.pages
      where published_content is not null
    `;

    const byId = new Map<string, Record<string, unknown>>();
    for (const raw of rows) byId.set(String((raw as Record<string, unknown>).id), raw as Record<string, unknown>);

    const nodes: PageNode[] = [...byId.values()].map((row) => ({
      id: String(row.id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      slug: String(row.slug ?? ''),
      published: true,
    }));

    const docs: SearchDoc[] = [];
    for (const [id, path] of livePaths(nodes)) {
      const row = byId.get(id);
      if (!row) continue;
      const seo = asObject(row.seo) ?? {};
      if (seo.noindex === true) continue;
      docs.push({
        path,
        title: String(row.title ?? ''),
        text: pageText(hydrate(row, row.published_content), 8000),
      });
    }

    return docs;
  });
}

/**
 * Every published page as the menu needs it, to fill a folder's dropdown.
 *
 * SAME READ-ONLY ROLE AND SAME NARROWING as listPublishedPaths, and for the same
 * reason: a dropdown must never link to a page a visitor cannot reach. The query
 * takes only pages with published content, so `published: true` for every row and
 * a child under a draft parent is simply absent, exactly as it is from the site.
 * The title is the link's words; the address is composed by fillNavFolders from
 * the same livePaths the sitemap uses, so a dropdown link and the sitemap agree.
 */
export async function listPublishedNavPages(tenantId: string): Promise<NavPage[]> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, parent_id, slug, title
      from public.pages
      where published_content is not null
    `;
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ''),
      slug: String(row.slug ?? ''),
      parentId: row.parent_id ? String(row.parent_id) : null,
      published: true,
    }));
  });
}

/** One page, with everything the visibility report needs to judge it. */
export interface PageForAudit {
  id: string;
  title: string;
  /** The URL path, without a leading slash. Empty string is the home page. */
  path: string;
  published: boolean;
  /** The PUBLISHED tree, or null when the page has never been published. */
  content: Page | null;
}

/**
 * Every page, with its published content, for the visibility report.
 *
 * THE PUBLISHED TREE, NEVER THE DRAFT, and that is the whole reason this is its
 * own function rather than listPages plus a loop. A draft with a lovely search
 * description that nobody has published is not findable, and a report that
 * scored the draft would tell a client their page is fine while the version on
 * the internet is not. That is the one thing a report like this must never do.
 *
 * The authenticated role rather than the renderer's, because this runs on a
 * dashboard for a member of the site and it has to be able to SEE the drafts in
 * order to say they are not published.
 *
 * ONE QUERY, paths assembled here, same as listPublishedPaths. A parent that is
 * itself a draft is still visible to this role, so a child's path assembles
 * correctly and the report can say "not published" about both.
 */
export async function listPagesForAudit(tenantId: string): Promise<PageForAudit[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, parent_id, slug, title, seo, published_content
      from public.pages
    `;

    const byId = new Map<string, Record<string, unknown>>();
    for (const raw of rows) byId.set(String((raw as Record<string, unknown>).id), raw as Record<string, unknown>);

    const out: PageForAudit[] = [];

    for (const row of byId.values()) {
      const segments: string[] = [];
      let current: Record<string, unknown> | undefined = row;
      let hops = 0;

      while (current && hops <= MAX_PATH_DEPTH) {
        segments.unshift(String(current.slug ?? ''));
        const parent: Record<string, unknown> | undefined = current.parent_id
          ? byId.get(String(current.parent_id))
          : undefined;
        current = parent;
        hops += 1;
      }

      const published = asObject(row.published_content) !== null;

      out.push({
        id: String(row.id),
        title: String(row.title),
        path: segments.filter(Boolean).join('/'),
        published,
        content: published ? hydrate(row, row.published_content) : null,
      });
    }

    return out.sort((a, b) => a.path.localeCompare(b.path));
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface NewPage {
  title: string;
  slug?: string;
  parentId?: string | null;
  /**
   * The sections to start the page with, from a chosen page template. Built
   * server side from the closed template registry (the browser sends only a
   * template id), so these are ours, not a caller's markup. Absent or empty
   * gives the blank page this function has always made.
   */
  sections?: Page['sections'];
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
  userId?: string,
): Promise<PageWithContent> {
  const title = input.title.trim() || 'Untitled page';
  const slug = (input.slug ?? '').trim();

  return withTenant(tenantId, async (tx) => {
    const base = blankPage(title, slug);
    // A template's sections are ours and already schema-shaped, but they still
    // go through parse and sanitise like every write, and a set that somehow
    // fails the schema falls back to the blank page rather than refusing the
    // create. The blank path is byte-for-byte what it always was.
    let content = sanitisePage(base);
    if (input.sections && input.sections.length > 0) {
      const parsed = parsePage({ ...base, sections: input.sections });
      if (parsed.ok) content = sanitisePage(parsed.page);
    }

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
    await recordActivity(tenantId, {
      actorId: userId,
      action: 'page.create',
      summary: pageActivitySummary('page.create', title),
    });
    return { ...toSummary(row), content: hydrate(row, row.draft_content) };
  });
}

/**
 * Rename, re-slug or re-parent a page. Content is untouched.
 *
 * AND THE OLD ADDRESS KEEPS WORKING, since 1 Aug 2026. Before that, renaming a
 * published page silently 404d every link anybody had ever made to it: the page
 * was still there, the editor showed nothing wrong, and a visitor arriving from
 * a search result got nothing. See lib/db/redirects.ts.
 *
 * IN THIS TRANSACTION, not after it and not in the action. A redirect written
 * after a rename that then failed would forward an address that never moved; a
 * rename that succeeded with the redirect lost would break the links it was
 * supposed to protect. Both halves or neither.
 *
 * THE ADDRESSES ARE READ BEFORE THE UPDATE, because afterwards there is nothing
 * left to work the old ones out from.
 */
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

    /*
     * A PAGE NESTS TO ANY DEPTH, BUT NOT INTO ITS OWN BRANCH AND NOT PAST THE
     * ADDRESS LIMIT (Andy, 16 Aug 2026, multi-tier folders). Two moves would break
     * the tree: filing a page inside one of its own pages loops a branch back on
     * itself, and nesting past MAX_PATH_DEPTH segments leaves the deepest page with
     * no address at all (see livePaths). Both are checked here in the transaction,
     * not only in the drag UI, because a server action is a public endpoint and the
     * UI's rules are a courtesy to the person dragging. One read of the id/parent
     * graph answers both; a site is tens of pages, so the walk is cheap.
     */
    if (changes.parentId) {
      const graph = (await tx`select id, parent_id from public.pages`) as Array<Record<string, unknown>>;
      const parentOf = new Map<string, string | null>();
      const childrenOf = new Map<string, string[]>();
      for (const row of graph) {
        const id = String(row.id);
        const parent = row.parent_id ? String(row.parent_id) : null;
        parentOf.set(id, parent);
        if (parent) {
          const kids = childrenOf.get(parent) ?? [];
          kids.push(id);
          childrenOf.set(parent, kids);
        }
      }

      if (!parentOf.has(changes.parentId)) throw new Error('That page is not here.');

      // The new parent may not be the page itself (caught above) or any page
      // beneath it: a walk down from the page collects its whole branch.
      const subtree = new Set<string>();
      const down = [pageId];
      while (down.length > 0) {
        const id = down.pop() as string;
        for (const kid of childrenOf.get(id) ?? []) {
          if (!subtree.has(kid)) {
            subtree.add(kid);
            down.push(kid);
          }
        }
      }
      if (subtree.has(changes.parentId)) {
        throw new Error('A page cannot go inside one of its own pages.');
      }

      // The deepest page in the moved branch must still have an address. A page's
      // depth is its number of ancestors; livePaths drops anything whose path runs
      // past MAX_PATH_DEPTH segments, so the new parent's depth plus one plus the
      // branch's own height must stay under that.
      let parentDepth = 0;
      for (let cur: string | null = changes.parentId, hops = 0; cur && hops <= MAX_PATH_DEPTH; hops += 1) {
        cur = parentOf.get(cur) ?? null;
        if (cur) parentDepth += 1;
      }
      let height = 0;
      const measure: Array<[string, number]> = [[pageId, 0]];
      while (measure.length > 0) {
        const [id, depth] = measure.pop() as [string, number];
        if (depth > height) height = depth;
        for (const kid of childrenOf.get(id) ?? []) measure.push([kid, depth + 1]);
      }
      if (parentDepth + 1 + height >= MAX_PATH_DEPTH) {
        throw new Error('That would nest the pages too deep to have an address.');
      }
    }

    // A title-only change moves no addresses, so it reads no tree and writes no
    // redirects. Renaming to fix a typo in a page's name is the common edit and
    // it should stay one statement.
    const mightMove = changes.slug !== undefined || movingParent;
    const before = mightMove ? await addressesBefore(tx, pageId) : null;

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

    // Nothing was updated, so nothing moved. Writing redirects here would record
    // a move that did not happen.
    if (!rows.length) return null;

    if (before) await recordMove(tx, tenantId, before);

    return toSummary(rows[0] as Record<string, unknown>);
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

    const published = toSummary(rows[0] as Record<string, unknown>);
    await recordActivity(tenantId, {
      actorId: userId,
      action: 'page.publish',
      summary: pageActivitySummary('page.publish', published.title),
    });
    return published;
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
export async function deletePage(
  tenantId: string,
  pageId: string,
  userId?: string,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    // The title is read back on the way out, because after the delete there is
    // nothing left to name the log line from.
    const rows = await tx`
      delete from public.pages where id = ${pageId}::uuid returning id, title
    `;
    if (!rows.length) return false;
    await recordActivity(tenantId, {
      actorId: userId,
      action: 'page.delete',
      summary: pageActivitySummary(
        'page.delete',
        String((rows[0] as Record<string, unknown>).title ?? ''),
      ),
    });
    return true;
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
