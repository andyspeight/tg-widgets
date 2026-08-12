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
