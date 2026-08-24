/**
 * Which stored sizes exist for each picture on a page.
 *
 * THE SIDE CHANNEL, AND WHY IT IS ONE. A block stores a `src` string and nothing
 * else, so at render time the tree knows an address and not what other sizes of
 * that address were stored. The sizes live on the media row. Rather than put them
 * on the block's props, where they would be written once and then drift every
 * time the bank changed, they are looked up per request and threaded BESIDE the
 * tree, exactly as lib/content/prepared.ts threads cleaned markup and for the
 * same reason: props come from the database and a row carrying its own srcset
 * would be a row that could be forged.
 *
 * NO HEAVY IMPORTS. This is reached from the renderer, which the editor canvas
 * also mounts, so it must not drag the database layer or a parser into a browser
 * bundle. Types only.
 */

import type { MediaVariant } from '../media/types';

/**
 * url -> every stored size of that picture, ascending, INCLUDING the primary.
 *
 * A plain object rather than a Map so it crosses the server boundary the same
 * way PreparedMap does.
 */
export type ImageSizes = Record<string, MediaVariant[]>;

/** Nothing known. The renderer falls back to a single src, as it always did. */
export const NO_SIZES: ImageSizes = {};

/**
 * The srcset and sizes attributes for one picture, or null when there is nothing
 * useful to say.
 *
 * NULL FOR A SINGLE SIZE. A srcset with one candidate is bytes on every page for
 * no benefit, and it is the state every image uploaded before variants existed
 * is in.
 */
export function srcSetFor(url: string, sizes: ImageSizes | undefined): string | null {
  const found = sizes?.[url];
  if (!Array.isArray(found) || found.length < 2) return null;

  return found
    .filter((v) => v && typeof v.url === 'string' && Number.isFinite(v.width) && v.width > 0)
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');
}

/**
 * What share of the viewport this picture occupies, as a `sizes` attribute.
 *
 * DELIBERATELY CONSERVATIVE, and the direction of the error is the point. Tell a
 * browser an image is narrower than it really is and it picks a candidate too
 * small, which is a visibly soft photograph on somebody's homepage. Tell it the
 * image is wider and the worst case is some wasted bytes. So the default is the
 * full viewport, which can never be too small.
 *
 * Refining this per column is a real further win and a separate piece of work:
 * an image in a three-up grid needs about a third of this, and the tree knows
 * the column width. Doing it wrong is worse than not doing it, so it waits for
 * its own measurement rather than being guessed at here.
 */
export const FULL_WIDTH_SIZES = '100vw';

/** Every image address on a tree, for a single lookup rather than one per block. */
export function imageUrlsIn(sections: readonly unknown[] | undefined): string[] {
  const found = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim() !== '') found.add(value.trim());
  };

  const walkBlocks = (blocks: readonly unknown[] | undefined, depth: number): void => {
    if (!Array.isArray(blocks) || depth > 6) return;

    for (const raw of blocks) {
      if (!raw || typeof raw !== 'object') continue;
      const props = ((raw as { props?: Record<string, unknown> }).props ?? {}) as Record<string, unknown>;
      add(props.src);

      /*
       * A repeater's rows carry the same keys, and an inner container's blocks
       * live in the same place, so one loop covers both. The depth cap is the
       * same one the alt-text walk uses.
       */
      for (const value of Object.values(props)) {
        if (!Array.isArray(value)) continue;
        for (const row of value) {
          if (!row || typeof row !== 'object') continue;
          const item = row as Record<string, unknown>;
          add(item.src);
          if (Array.isArray(item.blocks)) walkBlocks(item.blocks, depth + 1);
        }
      }
    }
  };

  if (!Array.isArray(sections)) return [];

  for (const raw of sections) {
    if (!raw || typeof raw !== 'object') continue;
    const section = raw as Record<string, unknown>;

    // A section's own background, and the extras it cycles through.
    add(section.backgroundImage);
    if (Array.isArray(section.backgroundSlides)) {
      for (const slide of section.backgroundSlides) {
        if (slide && typeof slide === 'object') add((slide as Record<string, unknown>).src);
      }
    }

    if (!Array.isArray(section.rows)) continue;
    for (const row of section.rows) {
      if (!row || typeof row !== 'object') continue;
      const columns = (row as { columns?: unknown[] }).columns;
      if (!Array.isArray(columns)) continue;
      for (const column of columns) {
        if (!column || typeof column !== 'object') continue;
        walkBlocks((column as { blocks?: unknown[] }).blocks, 0);
      }
    }
  }

  return [...found];
}
