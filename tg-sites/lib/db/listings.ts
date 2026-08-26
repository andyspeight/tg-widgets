import { LISTING_ORDERS, itemAsCard, listingKey, listingsIn } from '../content/listings';
import type { Section } from '../content/schema';
import { listPublished } from './collections';

/**
 * The cards every listing block on a set of trees wants, read in one round.
 *
 * EXTRACTED SO THE EDITOR AND THE PUBLISHED PAGE CANNOT DRIFT. The site route
 * had this inline and the editor had nothing, which is why a collection grid
 * drew real cards on the site and a grey "will show here" box on the canvas.
 * Andy published a destination, looked at the editor, and was told nothing had
 * happened. A client would have concluded the feature was broken, and they would
 * have been right to.
 *
 * One read per distinct REQUEST rather than per block: two grids showing the
 * same collection share an answer, two grids narrowing it differently do not.
 * See listingKey in lib/content/listings.ts.
 *
 * WHAT THE CALLER DOES WITH IT DIFFERS, AND THAT MATTERS. The published route
 * folds the result into the tree it is about to render and throws the tree away.
 * The editor must NOT: its tree is the document somebody is editing, and
 * fillListings writes the cards into `props.items`, so folding them in there
 * would let the next save bake a snapshot of today's cards into the page. The
 * editor passes this map down beside the tree instead, the way prepared markup
 * and image sizes already travel.
 */
export type ListingCards = Map<string, Array<Record<string, unknown>>>;

export async function resolveListings(
  tenantId: string,
  trees: ReadonlyArray<{ sections: Section[] } | null | undefined>,
  options: { everyOrder?: boolean } = {},
): Promise<ListingCards> {
  const asked = listingsIn(trees);
  /*
   * EVERY ORDER, FOR THE EDITOR ONLY.
   *
   * This map is built on the server, once, from the tree as it was when the
   * page loaded. The canvas then fills a COPY of the tree on every keystroke,
   * looking each block up by listingKey, and that key carries the order. So the
   * moment somebody picked a different order the key stopped matching anything
   * in the map, fillListings found nothing, and every card vanished until a
   * reload. Andy hit it on the first click of the control that had just been
   * added, 26 Aug 2026.
   *
   * The published and preview routes render once from a tree that cannot change
   * underneath them, so they ask for exactly the order the page stored and this
   * does nothing for them.
   *
   * Reading each order rather than reordering what came back, because an order
   * changes WHICH items you get and not only their sequence: the oldest six of
   * twenty are not the newest six rearranged. Four small reads in an editor is
   * the honest price of the canvas telling the truth.
   */
  const wanted = options.everyOrder
    ? [
        ...new Map(
          asked.flatMap((request) =>
            LISTING_ORDERS.map((order) => {
              const variant = { ...request, order };
              return [listingKey(variant), variant] as const;
            }),
          ),
        ).values(),
      ]
    : asked;

  const cards: ListingCards = new Map();
  if (wanted.length === 0) return cards;

  const results = await Promise.all(
    wanted.map(async (request) => ({
      request,
      listing: await listPublished(tenantId, request.collection, request.count, {
        filter: request.filter,
        sort: request.sort,
        order: request.order,
      }),
    })),
  );

  for (const { request, listing } of results) {
    cards.set(
      listingKey(request),
      // The collection's own field definitions came back with its items, so a
      // card can carry a price and a number of nights without a second read.
      listing.items.map((row) => itemAsCard(row.item, request.collection, row.slug, listing.fields, row.id)),
    );
  }

  return cards;
}
