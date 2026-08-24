/**
 * One image in the bank, as everything downstream sees it.
 *
 * In its own file with no imports on purpose. The database layer produces it,
 * the server actions pass it, the picker renders it and the standalone doubles
 * satisfy it, and three of those four are client code. A shape shared through
 * lib/db would drag 'server-only' and the Postgres driver into the browser
 * bundle; a shape duplicated in the client is a shape that drifts.
 */

/** Where an image came from, which decides whether a credit line is owed. */
export type MediaSource = 'upload' | 'pexels';

/**
 * Attribution for anything that came out of a library.
 *
 * Captured at import time because that is the only moment it exists: search
 * results are not stored, so a credit not taken here cannot be recovered later
 * without matching the photograph back up by eye.
 */
export interface MediaCredit {
  /** The photographer's name, as the provider spells it. */
  photographer?: string;
  /** Their page on the provider. */
  photographerUrl?: string;
  /** The photo's own page, which is the link back the API terms ask for. */
  providerUrl?: string;
  /** The provider's id for it, so a duplicate import can be spotted. */
  providerId?: string;
}

/**
 * One smaller copy of an image, for an srcset.
 *
 * The width is stored rather than parsed back out of the filename, because a
 * client can upload a picture called "photo-800.webp" and a renderer that
 * believed the name would then serve it as an 800px copy of itself.
 */
export interface MediaVariant {
  url: string;
  width: number;
  height: number;
  bytes: number;
}

export interface MediaItem {
  id: string;
  /** The public URL. Goes straight into an img tag. */
  url: string;
  /** The object's address in the store. Needed to delete it, shown nowhere. */
  storageKey: string;
  filename: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /**
   * Alt text, held on the image rather than on each use.
   *
   * Set once when the picture goes into the bank and inherited everywhere it is
   * placed. The alternative is asking for it again at every use, which is how
   * sites end up with empty alt attributes: the person placing an image for the
   * fourth time has already described it three times and will skip it.
   */
  alt: string;
  source: MediaSource;
  credit: MediaCredit;
  /**
   * Smaller copies of this same picture, ascending by width.
   *
   * EMPTY IS NORMAL AND IS NOT AN ERROR. Every image uploaded before variants
   * existed has none, a stock photograph has none because it is resized at its
   * own origin instead, and a GIF has none because we never touch one. A renderer
   * given an empty list emits a single src, which is what it did for all of them
   * yesterday.
   */
  variants: MediaVariant[];
  createdAt: Date;
}

/**
 * A photo in a search result, before anybody has chosen it.
 *
 * Not a MediaItem and deliberately not shaped like one. Nothing here is stored:
 * these are rendered into a grid, and at most one of them becomes a MediaItem
 * when somebody picks it. Keeping the types apart is what stops a search result
 * being passed to something expecting a row that exists.
 */
export interface StockPhoto {
  /** The provider's id, as a string. */
  id: string;
  /** A small version, for the grid. Never stored. */
  thumbUrl: string;
  /** The version that gets imported if this one is chosen. */
  fullUrl: string;
  width: number;
  height: number;
  /** The provider's own description, which becomes the starting alt text. */
  description: string;
  credit: MediaCredit;
  /** A flat colour to paint while the thumbnail loads, so the grid does not jump. */
  averageColour: string | null;
}
