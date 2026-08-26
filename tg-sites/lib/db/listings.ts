import { itemAsCard, listingKey, listingsIn } from '../content/listings';
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
): Promise<ListingCards> {
  const wanted = listingsIn(trees);
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
      listing.items.map((row) => itemAsCard(row.item, request.collection, row.slug, listing.fields)),
    );
  }

  return cards;
}
