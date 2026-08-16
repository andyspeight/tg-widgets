/**
 * The seam between "the editor edits a Page" and "a blog post is not a Page".
 *
 * The third of these, after lib/content/region-page.ts, and for the same reason:
 * the editor is a large, well-tested thing that knows how to select, drag, undo,
 * style and save a Page, and a blog post is a Page in every way the editor cares
 * about. Wrapping it on the way in and unwrapping on the way out means one
 * editor with the whole block library, rather than a box that can only hold
 * paragraphs.
 *
 * WHAT AN ITEM CARRIES THAT A PAGE DOES NOT: a summary, a picture and a date.
 * Those are not sections, so they travel beside the Page rather than inside it,
 * the same way a header's sticky and overlay do. The item's TITLE is the one
 * field that maps onto a Page field, and it maps onto the right one: the editor
 * already has a title box in the top bar, and a post's title belongs there.
 */

import type { CollectionItem } from './collection';
import { CONTENT_VERSION, type Page } from './schema';

/** The fields of an item that are not its body. */
export interface ItemMeta {
  title: string;
  summary: string;
  image: string;
  alt: string;
  /** The post's byline, edited beside the date. */
  author: string;
  date: string;
  /** The post's tags, edited beside the summary and the date. */
  tags: string[];
  /** The address, which is a column on the row rather than part of the JSON. */
  slug: string;
}

export function itemMeta(item: CollectionItem, slug: string): ItemMeta {
  return {
    title: item.title,
    summary: item.summary,
    image: item.image,
    alt: item.alt,
    author: item.author,
    date: item.date,
    tags: item.tags,
    slug,
  };
}

/** An item's body as something the editor will accept. */
export function itemAsPage(item: CollectionItem, id: string, slug: string): Page {
  return {
    version: CONTENT_VERSION,
    /*
     * The real item id. Unlike a region's fake one this IS a lookup key: the
     * save action needs it, and taking it from the Page the editor is holding
     * means nothing has to be threaded separately.
     */
    id,
    // Falls back so the top bar is never empty, which PageSchema requires
    // anyway: a title of nothing fails min(1).
    title: item.title || 'Untitled',
    slug,
    seo: { noindex: false },
    sections: item.sections,
  };
}

/**
 * What the editor is holding, back into an item worth saving.
 *
 * The TITLE comes from the Page, because that is the box in the top bar somebody
 * types it into. Everything else comes from the meta, because a Page has nowhere
 * to put it. The slug is not here at all: it is a column, and saveItem takes it
 * as its own argument.
 */
export function pageAsItem(page: Page, meta: ItemMeta): CollectionItem {
  return {
    version: CONTENT_VERSION,
    title: page.title,
    summary: meta.summary,
    image: meta.image,
    alt: meta.alt,
    author: meta.author,
    date: meta.date,
    tags: meta.tags,
    sections: page.sections,
  };
}
