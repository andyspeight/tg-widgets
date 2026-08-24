/**
 * Where a drag in the OUTLINE pane lands.
 *
 * The pure half of task #137, kept apart from the pane so it can be driven in
 * Node. The pane decides what is being dragged and what it is over; this decides
 * what that MEANS, and hands back a new page or null for "nothing to do".
 *
 * WHY THE OUTLINE RESOLVES ITS TARGET DIFFERENTLY FROM THE CANVAS. The canvas
 * asks the document what is under the pointer, because a canvas is a picture and
 * a drop between two blocks is a place rather than a thing. The outline is a
 * LIST: every row is an element with a known identity, so the row under the
 * pointer IS the answer, and dnd-kit's own droppables say which one. Same drag
 * system, two ways of naming a target, each suited to what it is dropping onto.
 *
 * A SECTION ONLY EVER LANDS ON A SECTION and a block only on a block. Nothing
 * here has to enforce that (the collision filter never offers a mismatched
 * target) but it is checked anyway, because a resolver that trusts its caller is
 * one refactor away from moving a section into a column.
 */

import { moveBlockTo, moveSection } from '../../lib/content/tree';
import type { Page } from '../../lib/content/schema';

export type OutlineDragItem =
  | { kind: 'section'; section: number }
  | { kind: 'block'; section: number; row: number; column: number; block: number };

/** Whether two descriptors point at the very same thing. */
function same(a: OutlineDragItem, b: OutlineDragItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'section' && b.kind === 'section') return a.section === b.section;
  if (a.kind === 'block' && b.kind === 'block') {
    return (
      a.section === b.section &&
      a.row === b.row &&
      a.column === b.column &&
      a.block === b.block
    );
  }
  return false;
}

/**
 * The page after an outline drag, or null if the drag changes nothing.
 *
 * Null rather than the same page, so the caller can skip the commit entirely: an
 * undo step that undoes nothing is worse than no step at all, and a drag that
 * ends where it started is the commonest way to get one.
 *
 * CROSS-COLUMN IS THE POINT OF THIS SLICE. The outline used to refuse a block
 * drag unless the source and target were in the same column, which made the pane
 * able to reorder within a column and nothing else. moveBlockTo already speaks
 * full column coordinates and already handles the index shift when a block is
 * lifted out of the column it lands back in, so the restriction was the outline's
 * alone and simply comes off.
 */
export function resolveOutlineMove(
  page: Page,
  source: OutlineDragItem,
  target: OutlineDragItem,
): Page | null {
  if (source.kind !== target.kind) return null;
  if (same(source, target)) return null;

  if (source.kind === 'section' && target.kind === 'section') {
    return moveSection(page, source.section, target.section);
  }

  if (source.kind === 'block' && target.kind === 'block') {
    return moveBlockTo(
      page,
      { section: source.section, row: source.row, column: source.column, block: source.block },
      { section: target.section, row: target.row, column: target.column, index: target.block },
    );
  }

  return null;
}

/**
 * What a screen reader is told when the drag lands. Also what #138 will speak
 * aloud, which is why the wording is decided here rather than in the markup.
 */
export function outlineMoveLabel(target: OutlineDragItem): string {
  return target.kind === 'section'
    ? `position ${target.section + 1}`
    : `row ${target.row + 1}, column ${target.column + 1}, position ${target.block + 1}`;
}
