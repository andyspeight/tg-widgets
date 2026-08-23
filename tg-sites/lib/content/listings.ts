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
import { fieldFacts, type FieldDef } from './collection-fields';
import { readingTime } from './reading-time';
import type { Page, Section } from './schema';

/** What a listing block asks for. */
export interface ListingRequest {
  collection: string;
  count: number;
  /**
   * How many of the collection's declared fields each card shows.
   *
   * NOT WHICH ONES. The order on the collections screen decides that, so moving
   * a field up with the arrows there is how a client chooses what a card leads
   * with. A key-picker on the block would have meant the editor knowing the
   * collection's schema, and the editor has no server on the other side of it:
   * it would have had to guess, or fetch on every keystroke.
   */
  facts: number;
}

const MIN_COUNT = 1;
const MAX_COUNT = 60;

/*
 * Two facts on a card by default, and four at most.
 *
 * Two because that is what a travel card actually leads with, a price and a
 * length, and because two fit on one line at every card width the grid draws.
 * Four is the ceiling rather than the target: past that a card is a spec sheet
 * and the thing a reader came for, the title and the photograph, is losing.
 */
const DEFAULT_FACTS = 2;
const MAX_FACTS = 4;

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

  const rawFacts = typeof props.facts === 'number' ? props.facts : Number(props.facts);
  const facts = Number.isFinite(rawFacts)
    ? Math.min(MAX_FACTS, Math.max(0, Math.round(rawFacts)))
    : DEFAULT_FACTS;

  return { collection, count, facts };
}

/** Every distinct collection a tree wants, and the most any block asked for. */
export function listingsIn(trees: ReadonlyArray<{ sections: Section[] } | null | undefined>): ListingRequest[] {
  const wanted = new Map<string, { count: number; facts: number }>();

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
            const so_far = wanted.get(listing.collection);
            wanted.set(listing.collection, {
              count: Math.max(so_far?.count ?? 0, listing.count),
              // The most facts any block asked for. Each block still shows its
              // own number: fillListings trims the list per block, so a page
              // with a four-fact grid and a no-fact one gets both from one read.
              facts: Math.max(so_far?.facts ?? 0, listing.facts),
            });
          }
        }
      }
    }
  }

  return [...wanted].map(([collection, { count, facts }]) => ({ collection, count, facts }));
}

/**
 * A published item, as the card the grid already knows how to draw.
 *
 * `defs` is the collection's own schema, so an entry's declared answers become
 * a facts line on the card: "From £1,299 · 7 nights" under the title. Left out,
 * or empty, and the card is exactly what a blog post has always produced.
 */
export function itemAsCard(
  item: CollectionItem,
  collectionKey: string,
  slug: string,
  defs: readonly FieldDef[] = [],
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
    /*
     * The collection's declared facts, already formatted into words, in the
     * order the collections screen puts them in. Formatted HERE rather than in
     * the renderer because the definitions are what a number means (£1,299 or
     * 7 nights), and a block has no way to see them: see the header of this
     * file on why a block never learns collections exist.
     *
     * The whole list travels; each block trims it to its own facts count in
     * fillListings, so two grids sharing a collection still share one read.
     */
    facts: fieldFacts(defs, item.fields),
    linkLabel: 'Read more',
    linkHref: `/${collectionKey}/${slug}`,
  };
}

export type ListingData = Map<string, Array<Record<string, unknown>>>;

/**
 * One card's facts, cut to what this particular block asked for.
 *
 * Returns the SAME card when there is nothing to cut, so a blog listing (no
 * declared fields, so no facts) costs no allocation at all.
 */
function trimFacts(card: Record<string, unknown>, limit: number): Record<string, unknown> {
  const facts = card.facts;
  if (!Array.isArray(facts) || facts.length === 0) return card;
  if (facts.length <= limit) return card;
  return { ...card, facts: facts.slice(0, limit) };
}

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
          return {
            ...block,
            props: {
              ...block.props,
              items: items.slice(0, listing.count).map((card) => trimFacts(card, listing.facts)),
            },
          };
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
