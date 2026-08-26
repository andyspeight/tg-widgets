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
import { carriesOwnBanner } from './collection-layout';
import { readingTime } from './reading-time';
import type { Page, Section } from './schema';

/** What a listing block asks for. */
/**
 * The orders a collection listing can be shown in.
 *
 * INTRINSIC, so they work on a collection that declares no fields of its own.
 * The field-based sort below can only sort by something the collection
 * declares, which is right for "cheapest first" and useless for the common
 * case: Coastwise's guides collection declares nothing at all, so there was no
 * order a client could choose and no control offering one. Andy, 26 Aug 2026:
 * "in the cards i can't see a way to reorder them".
 *
 * 'manual' is the one that is not a rule at all: the order the client set by
 * hand on the collections screen, stored per item (migration 0031). An agency
 * featuring a destination wants it first because they decided so, and no rule
 * derived from a date or a title can say that.
 */
export const LISTING_ORDERS = ['newest', 'oldest', 'title', 'title-desc', 'manual'] as const;
export type ListingOrder = (typeof LISTING_ORDERS)[number];

export interface ListingRequest {
  collection: string;
  count: number;
  /** Which way round, before any field sort. Newest is what it has always done. */
  order: ListingOrder;
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
  /**
   * Narrowing, as the block stored it. SHAPE-CHECKED HERE AND SCHEMA-CHECKED
   * LATER: whether the named field exists, and whether that operator belongs to
   * its kind, can only be answered next to the collection's definitions, and
   * those come back with the query. So this carries what was asked for and
   * lib/content/collection-filter.ts decides what it means. Null is the common
   * case and costs nothing: the query keeps its LIMIT and reads no more rows
   * than it ever did.
   */
  filter: RawFilter | null;
  sort: RawSort | null;
}

/** A filter as stored on the block, before the schema has had a look at it. */
export interface RawFilter {
  field: string;
  op: string;
  value: string;
}

/** A sort as stored on the block. */
export interface RawSort {
  field: string;
  dir: 'asc' | 'desc';
}

/**
 * What makes two blocks' listings the SAME read.
 *
 * It used to be the collection's name alone, because that was all a listing was:
 * the newest N of a collection, so two blocks naming one collection wanted the
 * same rows and shared a query. Narrowing breaks that. "The half board tours"
 * and "the tours under a thousand pounds" are both the tours collection and are
 * not the same answer, so the key has to carry everything that changes the
 * answer or one block would quietly be handed the other's rows.
 *
 * The count and the facts are deliberately NOT in it: those trim a shared
 * answer rather than change it, so two blocks wanting six and twelve of the same
 * filtered tours still share one read of twelve.
 */
export function listingKey(request: ListingRequest): string {
  const filter = request.filter
    ? `${request.filter.field}\u0000${request.filter.op}\u0000${request.filter.value}`
    : '';
  const sort = request.sort ? `${request.sort.field}\u0000${request.sort.dir}` : '';
  // The order is part of the request. Without it, a page with a newest-first
  // grid and an A to Z one would ask once and draw the same cards twice.
  return `${request.collection}\u0001${filter}\u0001${sort}\u0001${request.order}`;
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

  return {
    collection,
    count,
    facts,
    order: orderIn(props),
    filter: filterIn(props),
    sort: sortIn(props),
  };
}

/**
 * The filter a block stored, or null.
 *
 * Null for anything incomplete, which is the state the pane leaves while a
 * client is halfway through choosing one: a field picked and no value yet must
 * show the whole listing rather than an empty grid.
 */
function filterIn(props: Record<string, unknown>): RawFilter | null {
  const field = asString(props.filterField).trim();
  const op = asString(props.filterOp).trim();
  const value = asString(props.filterValue).trim();
  return field && op && value ? { field, op, value } : null;
}

/** The sort a block stored, or null for newest first, which is the default. */
/** The chosen order, falling back to what every listing did before this existed. */
function orderIn(props: Record<string, unknown>): ListingOrder {
  const raw = asString(props.order).trim();
  return (LISTING_ORDERS as readonly string[]).includes(raw) ? (raw as ListingOrder) : 'newest';
}

function sortIn(props: Record<string, unknown>): RawSort | null {
  const field = asString(props.sortField).trim();
  if (!field) return null;
  return { field, dir: asString(props.sortDir) === 'desc' ? 'desc' : 'asc' };
}

/** Every distinct collection a tree wants, and the most any block asked for. */
/**
 * Every listing block on a set of trees, with the props it was read from.
 *
 * The props travel because the EDITOR needs them: when the canvas finds it has
 * no cards for a block it asks the server for that one listing, and the server
 * validates the ask by running listingIn over the same props rather than
 * trusting a request assembled on the client. Rebuilding a props bag from a
 * ListingRequest would be a second copy of that mapping to keep in step.
 */
export function listingBlocksIn(
  trees: ReadonlyArray<{ sections: Section[] } | null | undefined>,
): Array<{ request: ListingRequest; props: Record<string, unknown> }> {
  const found: Array<{ request: ListingRequest; props: Record<string, unknown> }> = [];

  for (const tree of trees) {
    if (!tree) continue;
    for (const section of tree.sections) {
      for (const row of section.rows) {
        for (const column of row.columns) {
          for (const block of column.blocks) {
            const request = listingIn(block);
            if (request) found.push({ request, props: block.props ?? {} });
          }
        }
      }
    }
  }

  return found;
}

export function listingsIn(trees: ReadonlyArray<{ sections: Section[] } | null | undefined>): ListingRequest[] {
  const wanted = new Map<string, ListingRequest>();

  for (const tree of trees) {
    if (!tree) continue;
    for (const section of tree.sections) {
      for (const row of section.rows) {
        for (const column of row.columns) {
          for (const block of column.blocks) {
            const listing = listingIn(block);
            if (!listing) continue;
            // One read per distinct REQUEST, for the largest count anybody
            // wanted. Two blocks showing the same posts is one query, not two;
            // two blocks showing differently narrowed posts is two, because
            // they are not the same rows. See listingKey.
            const key = listingKey(listing);
            const so_far = wanted.get(key);
            wanted.set(key, {
              ...listing,
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

  return [...wanted.values()];
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
  id?: string,
): Record<string, unknown> {
  return {
    /*
     * The row's id, carried so the EDITOR can offer the hand-set order without
     * a second read. Nothing renders it: the card renderer reads known keys and
     * this is not one of them.
     *
     * It never reaches a saved page. fillListings writes these cards into
     * props.items, and the editor deliberately fills a COPY of the tree rather
     * than the document, which is the same guard that stops today's cards being
     * baked into tomorrow's page. See lib/db/listings.ts.
     */
    id,
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
    /*
     * A READING TIME IS AN ARTICLE'S, AND A DESTINATION GUIDE IS NOT ONE.
     *
     * "3 min read" under a photograph of Hvar is the same blog furniture that
     * was showing above the banner until the entry header learned to stand
     * down, and it looks just as odd on the card. Somebody scanning a grid of
     * places is not deciding how long a read is; on a post they are.
     *
     * The same signal decides it: an item that builds its own banner is a page
     * rather than a post. See carriesOwnBanner in collection-layout.ts.
     */
    readingMinutes: carriesOwnBanner(item) ? 0 : readingTime(item.sections),
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

          const items = data.get(listingKey(listing));
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
