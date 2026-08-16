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

/** A page and the pages filed inside it, nested to any depth. */
export interface PageNode {
  page: PageLink;
  /** 0 at the top level, 1 for a page filed inside one, and so on. */
  depth: number;
  children: PageNode[];
}

/**
 * Group the flat page list into the tree the panel draws: top-level pages, each
 * with the pages filed inside it, to any depth (Andy, 15 Aug folders, 16 Aug
 * multi-tier).
 *
 * A FOLDER IS JUST A PAGE WITH CHILDREN. There is no separate folder type; a page
 * becomes a folder the moment another is dropped onto it. So this does not read a
 * "kind", it reads parentId, the nesting the database has always had.
 *
 * NO DEPTH CAP HERE. The tree mirrors the data whatever its depth; the move guard
 * is what keeps a page addressable (a page nested past the URL limit would have no
 * address). A page whose parent is missing sits at the top, where it can be seen
 * and moved.
 *
 * ONE SHARED `seen` SET does two jobs. It stops a page being drawn twice, and it
 * ends the walk on a cycle in the data rather than recursing forever. A cycle
 * cannot be built through the UI, but if one ever existed the pages caught in it
 * are surfaced at the top rather than hidden where the panel would never draw
 * them: a page you cannot see is worse than one drawn in the wrong place. Order is
 * preserved from the incoming list at every level.
 */
export function buildPageTree(pages: readonly PageLink[]): PageNode[] {
  const byId = new Map(pages.map((page) => [page.id, page]));

  const childrenOf = new Map<string | null, PageLink[]>();
  for (const page of pages) {
    const key = page.parentId && byId.has(page.parentId) ? page.parentId : null;
    const list = childrenOf.get(key) ?? [];
    list.push(page);
    childrenOf.set(key, list);
  }

  const seen = new Set<string>();
  const build = (children: readonly PageLink[], depth: number): PageNode[] =>
    children.flatMap((page) => {
      if (seen.has(page.id)) return [];
      seen.add(page.id);
      return [{ page, depth, children: build(childrenOf.get(page.id) ?? [], depth + 1) }];
    });

  const roots = build(childrenOf.get(null) ?? [], 0);

  // Anything a cycle left unreachable from a root, surfaced at the top.
  const orphans = pages
    .filter((page) => !seen.has(page.id))
    .flatMap((page) => build([page], 0));

  return [...roots, ...orphans];
}

/**
 * Every page filed under this one, at any depth. The page itself is not included.
 *
 * WHY THE DRAG NEEDS IT. A page cannot be filed inside itself or inside any page
 * beneath it: that would cut a whole branch off and loop it back on itself, and
 * the pages caught in the loop would have no route to the top. So a drop is
 * refused when the target is in this set. A seen guard ends the walk on a cycle in
 * the data rather than looping for ever.
 */
export function descendantIds(pages: readonly PageLink[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const page of pages) {
    if (!page.parentId) continue;
    const kids = childrenOf.get(page.parentId) ?? [];
    kids.push(page.id);
    childrenOf.set(page.parentId, kids);
  }

  const out = new Set<string>();
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}
