/**
 * Working out where a page lives, from the tree it lives in.
 *
 * PURE, AND THAT IS THE POINT. No database, no network, no React: rows in,
 * addresses out. This is the only definition of "the address of a page" in the
 * product, and it needs to be, because three things now depend on it agreeing
 * with itself. The sitemap lists addresses. The visibility report scores them.
 * And since 1 Aug 2026 the redirect table records what a page's address USED to
 * be, which is only correct if "used to be" and "is now" are worked out the same
 * way. Two implementations of this would drift, and the symptom would be a
 * redirect pointing somewhere that does not exist.
 *
 * IN JAVASCRIPT RATHER THAN A RECURSIVE CTE, which is the call lib/db/pages.ts
 * already made for the sitemap and the reason holds: a site is tens of pages,
 * not thousands, so one flat select and a walk is cheaper to run and far cheaper
 * to read than SQL that has to be read twice to be believed. It is also what
 * makes this testable without a database.
 */

/** How deep a path may nest. A guard against a cycle, not a product limit. */
export const MAX_PATH_DEPTH = 6;

export interface PageNode {
  id: string;
  parentId: string | null;
  /** The page's own segment. Empty is the home page. */
  slug: string;
  /** Whether this page itself has ever been published. */
  published: boolean;
}

/**
 * Every page that has a public address, and what it is.
 *
 * A CHILD UNDER AN UNPUBLISHED PARENT HAS NO ADDRESS, which is not a rule
 * invented here so much as one the site already enforces: getPublishedPage walks
 * a path a segment at a time and every segment has to resolve, so a page whose
 * parent is a draft cannot be reached however published it is itself. Leaving it
 * out is what stops the sitemap listing URLs that 404 and stops a redirect
 * pointing at one.
 *
 * The empty string is a real answer and means the home page, so callers have to
 * check for `undefined` rather than for falsiness. That has bitten before.
 */
export function livePaths(nodes: readonly PageNode[]): Map<string, string> {
  const byId = new Map<string, PageNode>();
  for (const node of nodes) if (node.published) byId.set(node.id, node);

  const paths = new Map<string, string>();

  for (const node of byId.values()) {
    const segments: string[] = [];
    let current: PageNode | undefined = node;
    let hops = 0;
    let broken = false;

    /*
     * The depth cap is not because the schema allows a loop. It is because a
     * self-referencing row would HANG the request rather than fail it, and
     * neither a sitemap nor a 404 may ever be the thing that takes a site down.
     */
    while (current && hops <= MAX_PATH_DEPTH) {
      segments.unshift(current.slug);

      const parent: PageNode | undefined = current.parentId
        ? byId.get(current.parentId)
        : undefined;

      // A parent that is not in the published set: the address does not resolve.
      if (current.parentId && !parent) {
        broken = true;
        break;
      }

      current = parent;
      hops += 1;
    }

    if (broken || hops > MAX_PATH_DEPTH) continue;

    // filter(Boolean) drops the home page's empty segment, so a child of the
    // home page is /about rather than //about.
    paths.set(node.id, segments.filter(Boolean).join('/'));
  }

  return paths;
}

/**
 * A page and everything under it.
 *
 * WHY A RENAME NEEDS THIS. Changing one page's slug changes the address of every
 * page beneath it, so recording a redirect for the page alone would leave its
 * children broken and nothing would say so. Dragging /greece under
 * /destinations is one edit and can move a dozen addresses.
 *
 * Breadth first from the root, with a visited set, so a cycle in the data ends
 * the walk instead of running forever.
 */
export function subtreeIds(nodes: readonly PageNode[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId);
    if (siblings) siblings.push(node.id);
    else children.set(node.parentId, [node.id]);
  }

  const found: string[] = [];
  const seen = new Set<string>();
  const queue = [rootId];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    found.push(id);
    for (const child of children.get(id) ?? []) queue.push(child);
  }

  return found;
}

/**
 * A requested URL path, in the shape the database stores.
 *
 * Leading and trailing slashes off, blank segments dropped, so /about/,
 * //about and about all ask the same question. Null when it could not be an
 * address on this site: deeper than the tree can go, or long enough to be
 * somebody probing rather than a visitor.
 *
 * NULL RATHER THAN A TRIMMED VERSION, because the caller's next move is a
 * database query and there is no useful answer to give a 10,000 character path
 * except no.
 */
export function normalisePath(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  if (path.length > 2000) return null;

  const segments = path.split('/').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length > MAX_PATH_DEPTH) return null;

  return segments.join('/');
}
