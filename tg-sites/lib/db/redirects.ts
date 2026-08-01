/**
 * Old addresses, and where they lead now.
 *
 * WHY THIS EXISTS. Until 1 Aug 2026 renaming a published page silently broke
 * every link to it. The page is still there, the editor shows nothing wrong, and
 * anybody arriving from a search result, a newsletter or an AI answer gets a
 * 404. See db/migrations/0018_page_redirects.sql for the full reasoning,
 * including why a row points at a PAGE rather than at a new address.
 *
 * TWO HALVES, AND THEY RUN AS DIFFERENT ROLES.
 *
 * Recording happens inside the rename's own transaction, as the app role, so a
 * rename that fails leaves no redirect and a redirect that fails takes the
 * rename with it. Resolving happens on a visitor's request as the renderer,
 * which can read the redirect table but is still held to published pages, so a
 * redirect to a draft resolves to nothing.
 */

import { livePaths, normalisePath, subtreeIds, type PageNode } from '../content/paths';
import { withPublicTenant, withTenant, type Tx } from './withTenant';

/**
 * Every page in the tenant, in the shape lib/content/paths.ts works on.
 *
 * ONE FLAT SELECT rather than a recursive query, matching listPublishedPaths.
 * As the app role this is every page including drafts; as the renderer the row
 * policy has already removed the drafts, and `published` narrows it again to
 * pages that have actually been published rather than merely marked so.
 */
async function tree(tx: Tx): Promise<PageNode[]> {
  const rows = await tx`
    select id, parent_id, slug, published_content is not null as published
    from public.pages
  `;

  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id),
      parentId: row.parent_id === null || row.parent_id === undefined
        ? null
        : String(row.parent_id),
      slug: String(row.slug ?? ''),
      published: row.published === true,
    };
  });
}

/**
 * What the addresses under this page are RIGHT NOW, before it is moved.
 *
 * Called before the update, because after it the old addresses are gone and
 * there is nothing left to work them out from. Returns the subtree as well as
 * the paths, so the caller does not walk the tree twice.
 */
export async function addressesBefore(
  tx: Tx,
  pageId: string,
): Promise<{ moving: string[]; paths: Map<string, string> }> {
  const nodes = await tree(tx);
  return { moving: subtreeIds(nodes, pageId), paths: livePaths(nodes) };
}

/**
 * Record what moved, now that it has.
 *
 * WHAT GETS A ROW: a page in the moved subtree that HAD a public address and no
 * longer has that one. That covers the three cases worth covering, and the third
 * is easy to miss:
 *
 *  - its own slug changed
 *  - an ancestor's slug changed, so its address changed without it being touched
 *  - it moved somewhere with no address at all, under a draft parent
 *
 * The last one still gets a row on purpose. It resolves to nothing today,
 * because resolveRedirect asks where the page is NOW and the answer is nowhere.
 * Publish that parent and the old address starts working again, which is the
 * behaviour somebody would want and nobody would think to ask for.
 *
 * THE NEWEST CLAIM WINS on a conflict. If /offers once led to page A and later
 * a different page lived at /offers and moved away too, the most recent thing to
 * have been at that address is the one a visitor following an old link most
 * likely means.
 *
 * AND ANY REDIRECT AT A NEW ADDRESS IS DELETED. Rename /about to /about-us and
 * back again, and without this there would be a redirect from 'about' to a page
 * that now lives at 'about'. Harmless while the page is there, because a live
 * page is found before the redirect table is consulted, and a loop waiting to
 * happen the next time it moves.
 */
export async function recordMove(
  tx: Tx,
  tenantId: string,
  before: { moving: string[]; paths: Map<string, string> },
): Promise<void> {
  const after = livePaths(await tree(tx));

  for (const id of before.moving) {
    const was = before.paths.get(id);
    // Never had a public address, so nobody can have linked to one.
    if (was === undefined) continue;

    const now = after.get(id);
    if (now === was) continue;

    await tx`
      insert into public.page_redirects (tenant_id, from_path, page_id)
      values (${tenantId}::uuid, ${was}, ${id}::uuid)
      on conflict (tenant_id, from_path)
        do update set page_id = excluded.page_id, created_at = now()
    `;

    if (now !== undefined) {
      await tx`delete from public.page_redirects where from_path = ${now}`;
    }
  }
}

/**
 * Where an address that no longer resolves should send somebody.
 *
 * ONLY CALLED AFTER THE PAGE LOOKUP HAS FAILED, which is what keeps this off the
 * critical path: a request that reaches here was already going to be a 404.
 *
 * Returns the path without a leading slash, or null. The empty string is a real
 * answer and means the home page, so a caller has to test for null rather than
 * for falsiness.
 */
export async function resolveRedirect(
  tenantId: string,
  path: string,
): Promise<string | null> {
  const from = normalisePath(path);
  if (from === null) return null;

  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select page_id from public.page_redirects where from_path = ${from} limit 1
    `;
    if (!rows.length) return null;

    const pageId = String((rows[0] as Record<string, unknown>).page_id);
    const now = livePaths(await tree(tx)).get(pageId);

    // The page has been unpublished, or moved under a draft parent. There is
    // nowhere to send anybody, so this is an honest 404 rather than a redirect
    // into one.
    if (now === undefined) return null;

    /*
     * NEVER BACK TO WHERE THEY CAME FROM. This should be unreachable, because a
     * page living at `from` would have been found before we got here, and
     * recordMove deletes any row that would make it possible. It is checked
     * anyway: a redirect loop on a client's live site is a far worse failure
     * than the 404 it was trying to avoid, and it is one line.
     */
    return now === from ? null : now;
  });
}

/**
 * How many old addresses are still being honoured.
 *
 * For the visibility report, where it is the only visible evidence that any of
 * this happened. Somebody who renamed a page wants to know their links did not
 * break, and a silent feature is one nobody trusts.
 */
export async function countRedirects(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`select count(*)::int as total from public.page_redirects`;
    const total = (rows[0] as Record<string, unknown> | undefined)?.total;
    return typeof total === 'number' ? total : 0;
  });
}
