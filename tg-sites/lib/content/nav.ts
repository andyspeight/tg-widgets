/**
 * Filling a Menu's folder links with the pages inside them, before render.
 *
 * FOLDERS FILL DROPDOWNS (Andy, 15 Aug 2026). A folder is just a page that holds
 * others (see lib/editor/page-list.ts). The menu stays curated, the client
 * chooses which links appear, but a link that points at a folder gains a dropdown
 * of the pages filed inside it. No new field and no page picker: the client links
 * a menu item to a folder's address exactly as they link to any page, and it
 * becomes a dropdown on its own.
 *
 * WHY IT HAPPENS HERE AND NOT IN THE BLOCK, the same reason the Cards block's
 * collection is filled here (see lib/content/listings.ts). A block is a plain
 * component with no server-only code, so the same one draws the published page
 * and the editor preview and the two cannot drift. Giving the Menu block the page
 * list would end that. So the caller resolves the folders first and hands the
 * block ordinary items, each carrying its own children, and the renderer never
 * learns that folders exist.
 *
 * UNLIKE LISTINGS, THIS RUNS IN THE EDITOR TOO. A listing needs a database read,
 * so the canvas draws a placeholder instead; a folder's children are pages the
 * editor already holds, so the preview can show the real dropdown with no round
 * trip. The caller passes published: true for every page there, so a folder the
 * client is still building shows its drafts in the preview.
 *
 * PURE, rows in and a filled tree out, so it is tested without a DOM and cannot
 * reach the database. The one address definition in the product, livePaths, does
 * the path work, so a dropdown link and the sitemap agree on where a page lives.
 */

import { livePaths, normalisePath, type PageNode } from './paths';
import type { Section } from './schema';

/** A page as the menu needs it: enough to place it, name it and link to it. */
export interface NavPage {
  id: string;
  title: string;
  /** The page's own segment, as stored. The full address is composed here. */
  slug: string;
  parentId: string | null;
  /** Whether this page has a public address. The live site passes the truth; the
   *  editor passes true for all, so a draft child still shows in the preview. */
  published: boolean;
}

/**
 * A dropdown link: the label and address of one page inside a folder, and the
 * pages inside IT, if any. The nesting is the multi-tier change: a dropdown item
 * that is itself a folder carries its own children, which the Menu draws as a
 * flyout off the side.
 */
export interface NavChild {
  label: string;
  href: string;
  children?: NavChild[];
}

/**
 * The address a Menu item points at, if it is one on this site.
 *
 * Only a same-site absolute path can name a folder. An external URL, a
 * protocol-relative `//host`, a `mailto:` or an anchor never do, so they can
 * never turn into a dropdown. A query or a hash is dropped: the folder is named
 * by the path alone.
 */
export function navItemPath(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const raw = href.trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  const path = raw.split(/[?#]/)[0];
  return normalisePath(path);
}

/**
 * Every page that holds others, keyed by its own address, each with the pages
 * inside it nested to any depth.
 *
 * MULTI-TIER, matching the sidebar (Andy, 16 Aug 2026): a dropdown item that is
 * itself a folder carries its own children, so a menu link to a folder opens the
 * whole branch beneath it. A page with no live address (its parent is a draft) is
 * left out at every level, because a dropdown link to a page that 404s is worse
 * than no dropdown. A shared depth is not needed; livePaths already dropped
 * anything past the address limit, so the recursion is naturally bounded, and a
 * seen set ends it on a cycle in the data.
 */
export function navFolders(pages: readonly NavPage[]): Map<string, NavChild[]> {
  const nodes: PageNode[] = pages.map((page) => ({
    id: page.id,
    parentId: page.parentId,
    slug: page.slug,
    published: page.published,
  }));
  const paths = livePaths(nodes);

  const childrenOf = new Map<string, NavPage[]>();
  for (const page of pages) {
    if (!page.parentId) continue;
    const kids = childrenOf.get(page.parentId) ?? [];
    kids.push(page);
    childrenOf.set(page.parentId, kids);
  }

  // The pages inside one, and inside those, and so on. Only pages with a live
  // address; the seen set means a cycle ends the walk rather than looping.
  const treeOf = (parentId: string, seen: ReadonlySet<string>): NavChild[] =>
    (childrenOf.get(parentId) ?? []).flatMap((kid) => {
      const path = paths.get(kid.id);
      if (path === undefined || seen.has(kid.id)) return [];
      const grandchildren = treeOf(kid.id, new Set(seen).add(kid.id));
      const child: NavChild = { label: kid.title || 'Untitled', href: `/${path}` };
      if (grandchildren.length > 0) child.children = grandchildren;
      return [child];
    });

  const folders = new Map<string, NavChild[]>();
  for (const page of pages) {
    const path = paths.get(page.id);
    // undefined, not falsy: '' is the home page, a real address.
    if (path === undefined) continue;
    const children = treeOf(page.id, new Set([page.id]));
    if (children.length > 0) folders.set(path, children);
  }

  return folders;
}

/**
 * A tree with its Menu blocks' folder links filled in.
 *
 * Returns the SAME tree when nothing is a folder, so the common case, a menu of
 * plain links, costs one walk and no allocation. Walks section, row, column,
 * block exactly as fillListings does, so the two treat the tree the same way.
 * Each matched item gains a `children` array the Menu block renders as a
 * dropdown; every other item is returned untouched.
 */
export function fillNavFolders<T extends { sections: Section[] }>(
  tree: T,
  pages: readonly NavPage[],
): T {
  const folders = navFolders(pages);
  if (folders.size === 0) return tree;

  let touched = false;

  const sections = tree.sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map((block) => {
          if (block.type !== 'nav') return block;
          const items = (block.props as { items?: unknown }).items;
          if (!Array.isArray(items)) return block;

          let itemTouched = false;
          const filled = items.map((item) => {
            const href = (item as { href?: unknown })?.href;
            const path = navItemPath(href);
            if (path === null) return item;
            const children = folders.get(path);
            if (!children) return item;
            itemTouched = true;
            return { ...(item as Record<string, unknown>), children };
          });

          if (!itemTouched) return block;
          touched = true;
          return { ...block, props: { ...block.props, items: filled } };
        }),
      })),
    })),
  }));

  return touched ? { ...tree, sections } : tree;
}

/** The same, tolerant of a null region so a caller need not guard each use. */
export function fillNavRegion<T extends { sections: Section[] }>(
  region: T | null,
  pages: readonly NavPage[],
): T | null {
  return region ? fillNavFolders(region, pages) : null;
}
