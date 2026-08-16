/**
 * The site's pages, reduced to what the rail's Pages panel needs (12 Aug 2026).
 *
 * A page carries its content, its dates and its publish history; a row in a
 * list needs none of that. PageLink is the little that is left: a name, an
 * address, whether it is published and who its parent is. The panel is drawn in
 * PagesPanel.tsx; the one piece of behaviour, the search, lives here so it can
 * be tested without a DOM. The runner imports only from lib for exactly this
 * reason (see vitest.config.ts).
 */

/** The little a page needs to sit in the list. Dates and content stay behind. */
export type PageLink = {
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'published';
  parentId: string | null;
};

/**
 * The pages a search shows: those whose name or address contains the words,
 * case and surrounding space ignored. An empty search shows them all.
 *
 * Name AND address on purpose. A child page's address carries its parent's
 * slug, so searching the parent's name turns up its children too, and somebody
 * who remembers the address but not the title still finds the page.
 */
export function filterPages(pages: readonly PageLink[], query: string): readonly PageLink[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return pages;
  return pages.filter((page) => `${page.title} ${page.slug}`.toLowerCase().includes(needle));
}

/** A top-level page and the pages filed inside it. Folders are one level deep. */
export interface PageNode {
  page: PageLink;
  children: PageLink[];
}

/**
 * Group the flat page list into the one-level tree the panel draws: top-level
 * pages, each with the pages filed inside it (Andy, 15 Aug 2026: folders).
 *
 * A FOLDER IS JUST A PAGE WITH CHILDREN. There is no separate folder type; a page
 * becomes a folder the moment another is dropped onto it. So this does not read a
 * "kind", it reads parentId, the nesting the database has always had.
 *
 * ONE LEVEL, AND NOTHING LOST. A page is top level when it has no parent, its
 * parent is missing, OR its parent is itself a child. That last case is a data
 * anomaly the move guard forbids, but if one ever exists this surfaces it at the
 * top rather than hiding it two levels down where the panel would never draw it.
 * Order is preserved from the incoming list on both tiers.
 */
export function buildPageTree(pages: readonly PageLink[]): PageNode[] {
  const byId = new Map(pages.map((page) => [page.id, page]));

  const isTopLevel = (page: PageLink): boolean => {
    if (!page.parentId) return true;
    const parent = byId.get(page.parentId);
    return !parent || parent.parentId != null;
  };

  const childrenOf = new Map<string, PageLink[]>();
  for (const page of pages) {
    if (isTopLevel(page)) continue;
    const list = childrenOf.get(page.parentId as string) ?? [];
    list.push(page);
    childrenOf.set(page.parentId as string, list);
  }

  return pages
    .filter(isTopLevel)
    .map((page) => ({ page, children: childrenOf.get(page.id) ?? [] }));
}
