/**
 * The trail, when a client has chosen where to put it.
 *
 * THE TRAIL ALREADY EXISTED before this file did, and that is the important
 * thing to understand here. components/render/Breadcrumb.tsx draws it
 * automatically on every nested published page, between the header and the
 * content, because we emit BreadcrumbList structured data for those pages and
 * Google's guidance is that markup must represent content a visitor can SEE. A
 * BreadcrumbList with no breadcrumb anywhere is a mismatch, and a mismatch is
 * what gets structured data ignored.
 *
 * SO WHY A BLOCK AS WELL. Because "between the header and the content" is one
 * answer to a question that has several. A travel site often wants the trail
 * inside the hero, over the picture, or under a page banner rather than above
 * it, and an automatic trail in a fixed place cannot do that.
 *
 * THE RULE THAT KEEPS BOTH HONEST: a page carrying a breadcrumbs block does not
 * ALSO get the automatic one. hasBreadcrumbsBlock is what the published route
 * asks, so the client is choosing where the trail goes, never whether there is
 * one. That is the difference between this and the usual CMS version of the
 * feature, where the element is opt-in and a page somebody forgot simply has no
 * trail and a structured-data mismatch nobody notices for a year.
 *
 * FILLED HERE, NOT IN THE BLOCK, which is the same shape lib/content/nav.ts uses
 * for folder dropdowns and lib/content/listings.ts uses for a collection. A block
 * is a plain component that draws the published page and the editor preview
 * alike, so it must not need to know the request. The caller works out the trail
 * and hands the block a finished list of crumbs.
 *
 * PURE: a path and a title in, a filled tree out. No database, no request, no
 * DOM, so the derivation is tested directly.
 */

import type { Section } from './schema';

/** One step of the trail. A null href is the page somebody is already on. */
export interface Crumb {
  name: string;
  href: string | null;
}

/** greek-island-hopping becomes Greek island hopping. */
function titleFromSlug(slug: string): string {
  const words = slug.replace(/-+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

/**
 * The trail for one address.
 *
 * BUILT FROM THE ADDRESS, exactly as breadcrumbLd and the automatic component
 * are, because the address IS the hierarchy: a child page's path is its parent's
 * plus its own slug. A second source would be a second thing that can disagree,
 * and disagreeing with the structured data is the one outcome that makes a
 * visible trail worse than none.
 *
 * Empty for the home page. A trail of one is not a trail, and the renderer draws
 * nothing rather than drawing the word "Home" on its own.
 */
export function crumbsFor(path: string, pageTitle: string): Crumb[] {
  const segments = String(path ?? '')
    .split('/')
    .filter(Boolean);
  if (segments.length === 0) return [];

  const crumbs: Crumb[] = [{ name: 'Home', href: '/' }];

  let walked = '';
  for (const [index, segment] of segments.entries()) {
    walked += `/${segment}`;
    const last = index === segments.length - 1;
    crumbs.push({
      /*
       * The last crumb is this page, whose real title we know. The ones between
       * are addresses this render has not loaded, so the slug becomes words.
       * Derived, and honest about it, and identical to what breadcrumbLd does so
       * the two never disagree.
       */
      name: last ? pageTitle : titleFromSlug(segment),
      // The page somebody is on is not a link to itself.
      href: last ? null : walked,
    });
  }

  return crumbs;
}

/** Does this tree hold a breadcrumbs block anywhere, including inside a container? */
export function hasBreadcrumbsBlock(tree: { sections: Section[] } | null | undefined): boolean {
  if (!tree || !Array.isArray(tree.sections)) return false;
  return tree.sections.some((section) =>
    section.rows?.some((row) =>
      row.columns?.some((column) => columnHasBreadcrumbs(column.blocks)),
    ),
  );
}

/**
 * Recurses into a container's or a grid's own columns.
 *
 * A trail dropped into an inner column is still a trail on the page, and missing
 * it would put two of them there. Reading props.columns directly rather than
 * importing the block registry keeps this module a leaf, which is what lets the
 * published route call it without pulling the registry along.
 */
function columnHasBreadcrumbs(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false;
  return blocks.some((block) => {
    const b = block as { type?: unknown; props?: { columns?: unknown } };
    if (b?.type === 'breadcrumbs') return true;
    const inner = b?.props?.columns;
    if (!Array.isArray(inner)) return false;
    return inner.some((column) => columnHasBreadcrumbs((column as { blocks?: unknown })?.blocks));
  });
}

/**
 * Write the trail into every breadcrumbs block in the tree.
 *
 * Returns the tree untouched when there is nothing to fill, so a page without one
 * costs a walk and no allocation, and the published route can call it
 * unconditionally.
 */
export function fillBreadcrumbs<T extends { sections: Section[] }>(
  tree: T,
  path: string,
  pageTitle: string,
): T {
  if (!hasBreadcrumbsBlock(tree)) return tree;
  const crumbs = crumbsFor(path, pageTitle);

  const fillBlocks = (blocks: unknown): unknown => {
    if (!Array.isArray(blocks)) return blocks;
    return blocks.map((block) => {
      const b = block as { type?: unknown; props?: Record<string, unknown> };
      if (b?.type === 'breadcrumbs') {
        return { ...(block as object), props: { ...(b.props ?? {}), crumbs } };
      }
      const inner = b?.props?.columns;
      if (!Array.isArray(inner)) return block;
      return {
        ...(block as object),
        props: {
          ...(b.props ?? {}),
          columns: inner.map((column) => {
            const c = column as { blocks?: unknown };
            if (!Array.isArray(c?.blocks)) return column;
            return { ...(column as object), blocks: fillBlocks(c.blocks) };
          }),
        },
      };
    });
  };

  return {
    ...tree,
    sections: tree.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => ({
          ...column,
          blocks: fillBlocks(column.blocks) as typeof column.blocks,
        })),
      })),
    })),
  };
}
