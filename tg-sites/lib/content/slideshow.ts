/**
 * Does a tree hold a slideshow?
 *
 * The logic lives here, not in the component, for the same reason widgetTagsIn
 * does: it is a plain walk over a page shape, testable without a DOM or a JSX
 * transform, and the SlideshowScript component only maps its answer to a tag.
 *
 * The rule matches the renderer's exactly. An image block turns into a slideshow
 * when it carries more than one usable picture, so the extra `slides` must hold
 * at least one entry with a real address. A block whose only extra slides are
 * blank stays a single image and needs no script.
 */

import type { widgetTagsIn } from './widgets';

/** Anything with sections: a Page, a header, a footer. */
export type Tree = Parameters<typeof widgetTagsIn>[0];

export function hasSlideshow(tree: Tree | null | undefined): boolean {
  if (!tree) return false;
  for (const section of tree.sections) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (block.type !== 'image') continue;
          const slides = block.props?.slides;
          if (
            Array.isArray(slides) &&
            slides.some(
              (slide) =>
                !!slide &&
                typeof (slide as { src?: unknown }).src === 'string' &&
                (slide as { src: string }).src.trim() !== '',
            )
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}
