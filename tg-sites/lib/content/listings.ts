/**
 * Filling a Cards block from a collection, before anything renders.
 *
 * WHY IT HAPPENS HERE AND NOT IN THE BLOCK.
 *
 * A block is a plain component with no server-only code, deliberately: the same
 * one draws the published page and the editor preview, which is what stops the
 * two drifting. Giving it a database read would end that. It would also mean a
 * page with three listing blocks doing three round trips while a visitor waits,
 * inside the render, where nothing can batch them.
 *
 * So the route resolves them first. It walks the tree once, collects the
 * distinct (collection, count) pairs, reads each one, and hands back a page
 * whose Cards blocks have ordinary `items` in them. The renderer never learns
 * that collections exist.
 *
 * IN THE EDITOR IT DOES NOT RUN AT ALL. The canvas re-renders on every keystroke
 * and there is no server on the other side of it, so a collection-backed grid
 * draws a labelled placeholder there instead. Same arrangement the widget block
 * already uses, and for the same reason.
 */

import type { CollectionItem } from './collection';
import { readingTime } from './reading-time';
import type { Page, Section } from './schema';

/** What a listing block asks for. */
export interface ListingRequest {
  collection: string;
  count: number;
}

const MIN_COUNT = 1;
const MAX_COUNT = 60;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Is this block a grid fed from a collection, and which one?
 *
 * Null for a grid somebody typed into, which is the common case and must stay
 * untouched. `source` has to say 'collection' AND a collection has to be named:
 * a client who picked the source and has not chosen a collection yet gets the
 * placeholder rather than a silent empty grid.
 */
export function listingIn(block: { type: string; props?: Record<string, unknown> }): ListingRequest | null {
  if (block.type !== 'cards') return null;
  const props = block.props ?? {};
  if (asString(props.source) !== 'collection') return null;

  const collection = asString(props.collection).trim();
  if (!collection) return null;

  const raw = typeof props.count === 'number' ? props.count : Number(props.count);
  const count = Number.isFinite(raw)
    ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(raw)))
    : 6;

  return { collection, count };
}

/** Every distinct collection a tree wants, and the most any block asked for. */
export function listingsIn(trees: ReadonlyArray<{ sections: Section[] } | null | undefined>): ListingRequest[] {
  const wanted = new Map<string, number>();

  for (const tree of trees) {
    if (!tree) continue;
    for (const section of tree.sections) {
      for (const row of section.rows) {
        for (const column of row.columns) {
          for (const block of column.blocks) {
            const listing = listingIn(block);
            if (!listing) continue;
            // One read per collection, for the largest count anybody wanted.
            // Two blocks showing the same posts is one query, not two.
            wanted.set(listing.collection, Math.max(wanted.get(listing.collection) ?? 0, listing.count));
          }
        }
      }
    }
  }

  return [...wanted].map(([collection, count]) => ({ collection, count }));
}

/** A published item, as the card the grid already knows how to draw. */
export function itemAsCard(
  item: CollectionItem,
  collectionKey: string,
  slug: string,
): Record<string, unknown> {
  return {
    src: item.image,
    alt: item.alt,
    // The date is the small label above the title, which is what a blog card
    // wants there. An item with no date simply has no label.
    label: item.date,
    title: item.title,
    body: item.summary,
    // The post's tags, shown on the card as plain labels so a reader scanning
    // the listing sees what each post is about. Plain, not links: the whole card
    // already goes to the post, and a tag link fighting that cover is worse than
    // a label. Finding posts by a tag is the archive's job.
    tags: item.tags,
    // The byline and the reading time, so the card carries the same at-a-glance
    // signals the post does. Reading time is worked out from the body here, never
    // stored: see lib/content/reading-time.ts.
    author: item.author,
    readingMinutes: readingTime(item.sections),
    linkLabel: 'Read more',
    linkHref: `/${collectionKey}/${slug}`,
  };
}

export type ListingData = Map<string, Array<Record<string, unknown>>>;

/**
 * A page with its listing blocks filled in.
 *
 * Returns the SAME page object when there is nothing to fill, so the common
 * case costs one walk and no allocation. A block whose collection has no
 * published items comes back with an empty list, which the grid draws as its
 * "add some cards" placeholder on the canvas and as nothing at all on a
 * published page.
 */
export function fillListings<T extends { sections: Section[] }>(tree: T, data: ListingData): T {
  if (data.size === 0) return tree;

  let touched = false;

  const sections = tree.sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map((block) => {
          const listing = listingIn(block);
          if (!listing) return block;

          const items = data.get(listing.collection);
          if (!items) return block;

          touched = true;
          return { ...block, props: { ...block.props, items: items.slice(0, listing.count) } };
        }),
      })),
    })),
  }));

  return touched ? { ...tree, sections } : tree;
}

/** The same, typed for a page, which is what the routes hold. */
export function fillPageListings(page: Page, data: ListingData): Page {
  return fillListings(page, data);
}
