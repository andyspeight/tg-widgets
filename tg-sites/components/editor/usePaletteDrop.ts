'use client';

/**
 * Resolving where a canvas drag lands, and drawing the drop line.
 *
 * Serves BOTH a new block dragged off the palette and a placed block dragged to
 * move it. The resolution is identical either way, so the hook stays ignorant of
 * intent: it hands the shell one onDrop with the resolved target and index, and
 * the shell decides add-or-move from which drag is live.
 *
 * WHY THIS LIVES IN A HOOK, NOT IN THE CANVAS
 * The drag is driven by dnd-kit now, whose DndContext has to wrap BOTH the drag
 * sources (the elements palette in the left pane, and the grip on a placed
 * block's toolbar) and the drop target (the canvas). That context lives up in
 * EditorShell, so the drop maths has to be reachable from there rather than
 * buried in the canvas's own event handlers. It
 * is pure DOM work, `document.elementFromPoint` and a few rectangles, so it does
 * not care which component calls it: give it a viewport point and it finds the
 * column, the index between the blocks, and draws the line.
 *
 * It is the SAME maths the canvas used to run off a native dragover. The one
 * change is the pointer: a native drag handed us `event.target` and
 * `event.clientY`; dnd-kit hands us the pointer coordinates, and we ask the
 * document what is under them. The insertion index, the container awareness and
 * the imperative drop slot are unchanged, on purpose, because they already told
 * the truth about where a block would land.
 */

import { useCallback, useRef } from 'react';

import type { DropTarget } from './Canvas';
import { parsePathKey } from '../../lib/content/tree';

/** The column the pointer is over, plus how to count its direct blocks. */
type Hit = { columnEl: HTMLElement; target: DropTarget; key: string; sep: 'b' | 'i' };

export interface PaletteDrop {
  /** Attach to the imperatively-positioned drop-slot element. */
  slotRef: React.RefObject<HTMLDivElement | null>;
  /** A canvas drag began; forget any target the last one left. */
  start: () => void;
  /** The pointer moved to this viewport point; redraw the slot. */
  update: (clientX: number, clientY: number) => void;
  /** The drag ended; place the block if it was over a valid spot. */
  end: () => void;
  /** Hide the slot and forget the drag (a cancel, or leaving the canvas). */
  hide: () => void;
}

export function usePaletteDrop(
  onDrop: (target: DropTarget) => void,
): PaletteDrop {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef<{ target: DropTarget; index: number } | null>(null);

  /*
   * The column under a point, and whether its direct blocks are keyed with `b`
   * (an ordinary column) or `i` (a container's inner column). A container counts
   * as ONE block of its outer column, while its own inner blocks are what an
   * inner drop lands among. Same resolution the click handler uses, off the same
   * data-path, so the two agree about what is where.
   */
  const columnUnder = useCallback((el: HTMLElement | null): Hit | null => {
    const node = el?.closest<HTMLElement>('[data-path], [data-add]');
    if (!node) return null;
    const path = parsePathKey(node.dataset.path ?? node.dataset.add);
    if (!path) return null;

    if (path.kind === 'inner-column' || path.kind === 'inner-block') {
      const key = `s${path.section}r${path.row}c${path.column}b${path.block}k${path.inner}`;
      const columnEl = node.closest<HTMLElement>(`[data-path="${CSS.escape(key)}"]`);
      if (!columnEl) return null;
      const target: DropTarget = {
        section: path.section,
        row: path.row,
        column: path.column,
        block: path.block,
        inner: path.inner,
      };
      return { columnEl, target, key, sep: 'i' };
    }

    if (path.kind === 'block' || path.kind === 'column') {
      const key = `s${path.section}r${path.row}c${path.column}`;
      const columnEl =
        node.closest<HTMLElement>(`[data-path="${CSS.escape(key)}"]`) ??
        (path.kind === 'column' ? node : null);
      if (!columnEl) return null;
      const target: DropTarget = { section: path.section, row: path.row, column: path.column };
      return { columnEl, target, key, sep: 'b' };
    }

    return null;
  }, []);

  const hide = useCallback(() => {
    if (slotRef.current) slotRef.current.style.display = 'none';
    dropRef.current = null;
  }, []);

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const hit = columnUnder(document.elementFromPoint(clientX, clientY) as HTMLElement | null);
      const slot = slotRef.current;
      if (!hit || !slot) {
        hide();
        return;
      }

      // The column's direct blocks, exactly one level deep: a block's own innards
      // carry longer paths and must not be counted as its siblings.
      const isBlock = new RegExp(`^${hit.key}${hit.sep}\\d+$`);
      const blockEls = Array.from(
        hit.columnEl.querySelectorAll<HTMLElement>('[data-path]'),
      ).filter((b) => isBlock.test(b.dataset.path ?? ''));

      // Land before the first block whose middle is below the pointer, else last.
      let index = blockEls.length;
      for (let i = 0; i < blockEls.length; i += 1) {
        const r = blockEls[i].getBoundingClientRect();
        if (clientY < r.top + r.height / 2) {
          index = i;
          break;
        }
      }

      // The line the slot straddles, in viewport space (it is position: fixed).
      const colRect = hit.columnEl.getBoundingClientRect();
      let y: number;
      if (blockEls.length === 0) y = colRect.top + Math.min(colRect.height / 2, 28);
      else if (index < blockEls.length) y = blockEls[index].getBoundingClientRect().top;
      else y = blockEls[blockEls.length - 1].getBoundingClientRect().bottom;

      const inset = 6;
      const height = 22;
      slot.style.display = 'block';
      slot.style.left = `${colRect.left + inset}px`;
      slot.style.width = `${Math.max(0, colRect.width - inset * 2)}px`;
      slot.style.top = `${y - height / 2}px`;
      slot.style.height = `${height}px`;

      dropRef.current = { target: hit.target, index };
    },
    [columnUnder, hide],
  );

  const start = useCallback(() => {
    // A fresh drag: drop any target the last one left, so an immediate release
    // that resolves nothing can never land on a stale column.
    dropRef.current = null;
  }, []);

  const end = useCallback(() => {
    const drop = dropRef.current;
    hide();
    if (drop) onDrop({ ...drop.target, at: drop.index });
  }, [hide, onDrop]);

  return { slotRef, start, update, end, hide };
}
