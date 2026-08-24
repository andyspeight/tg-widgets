'use client';

/**
 * Which outline row a drag is over.
 *
 * WHY A CUSTOM ONE. dnd-kit's default is rectIntersection, which ranks targets
 * by how much of the dragged rect overlaps them. The outline nests: every block
 * row sits inside its section's box, so the section's rect contains the block's
 * entirely and would win the overlap contest every time. A block dragged onto a
 * block row would resolve to the section around it, and the move would either do
 * nothing or move the wrong thing.
 *
 * THE FILTER IS THE FIX, AND IT IS ALSO THE RULE. A section can only ever land on
 * a section row and a block only on a block row, so the two sets of targets are
 * disjoint and the nesting stops mattering: once the mismatched rows are removed
 * there is only ever one candidate under the pointer. Expressing the rule here
 * rather than in a resolver that says no afterwards is what makes the pane show
 * the truth as you drag, because a row that could never accept the drop never
 * lights up.
 *
 * pointerWithin RATHER THAN rectIntersection for what is left, because a list
 * row is small and the pointer is exactly what the client is aiming with. The
 * rect fallback catches the case pointerWithin cannot answer: a keyboard drag,
 * which has no pointer at all, and which is the next slice (#138).
 */

import { pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core';

import type { OutlineDragItem } from './outline-move';

/** What a draggable outline row puts in its dnd-kit data. */
export interface OutlineDragData {
  outlineDrag: OutlineDragItem;
}

/** What a droppable outline row puts in its dnd-kit data. */
export interface OutlineDropData {
  outlineDrop: OutlineDragItem;
}

function dragKindOf(data: unknown): OutlineDragItem['kind'] | null {
  const item = (data as OutlineDragData | undefined)?.outlineDrag;
  return item ? item.kind : null;
}

function dropKindOf(data: unknown): OutlineDragItem['kind'] | null {
  const item = (data as OutlineDropData | undefined)?.outlineDrop;
  return item ? item.kind : null;
}

export const outlineCollision: CollisionDetection = (args) => {
  const kind = dragKindOf(args.active.data.current);

  /*
   * Not an outline drag at all: a palette card, a block handle or a section
   * handle heading for the canvas. Those resolve their target from the document
   * under the pointer and never read `over`, so answering with nothing is both
   * correct and cheaper than ranking rows they will ignore.
   */
  if (!kind) return [];

  const matching = args.droppableContainers.filter(
    (container) => dropKindOf(container.data.current) === kind,
  );
  if (matching.length === 0) return [];

  const args2 = { ...args, droppableContainers: matching };
  const within = pointerWithin(args2);
  return within.length > 0 ? within : rectIntersection(args2);
};
