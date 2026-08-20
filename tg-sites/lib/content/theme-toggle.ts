/**
 * Does a tree hold a Light / dark switch?
 *
 * The switch is the ONE thing that turns a published site's dark mode on, so
 * this is the opt-in test the route runs before it emits the dark palette and
 * the script. Same shape as hasSlideshow: a plain walk over a page shape,
 * testable without a DOM, and the components only map its answer to markup.
 *
 * RECURSES INTO CONTAINERS, unlike the slideshow walk, because a switch is small
 * enough that somebody will reasonably drop one inside an inner container in a
 * header. A slideshow is a whole section's worth of block and never lands there,
 * so its walk stays flat; this one cannot afford to miss a switch and leave it
 * dead.
 */

import type { widgetTagsIn } from './widgets';

/** Anything with sections: a Page, a header, a footer. */
export type Tree = Parameters<typeof widgetTagsIn>[0];

type LooseBlock = { type?: unknown; props?: { columns?: unknown } };

/** A switch anywhere in a list of blocks, following container columns down. */
function blocksHaveToggle(blocks: readonly unknown[]): boolean {
  for (const raw of blocks) {
    const block = raw as LooseBlock;
    if (block?.type === 'theme-toggle') return true;

    // A container block carries its own columns of blocks. Follow them, so a
    // switch tucked inside one still counts.
    const columns = block?.props?.columns;
    if (Array.isArray(columns)) {
      for (const column of columns) {
        const inner = (column as { blocks?: unknown }).blocks;
        if (Array.isArray(inner) && blocksHaveToggle(inner)) return true;
      }
    }
  }
  return false;
}

export function hasThemeToggle(tree: Tree | null | undefined): boolean {
  if (!tree) return false;
  for (const section of tree.sections) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        if (blocksHaveToggle(column.blocks)) return true;
      }
    }
  }
  return false;
}
