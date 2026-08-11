'use client';

/**
 * Resolving where a SECTION drag lands, and drawing the boundary line.
 *
 * The sibling of usePaletteDrop, one level up: that hook resolves a column and a
 * gap between blocks; this one resolves a gap between whole sections. Same shape
 * so the shell drives it the same way — start, update on the pointer, end — and
 * the same reason it lives in a hook rather than the canvas: the one dnd-kit
 * DndContext up in EditorShell wraps both the drag source (the section's handle)
 * and the drop target (the page), so the maths has to be reachable from there.
 *
 * It answers with a GAP index in the current sections array: 0 is before the
 * first section, sections.length is after the last. The shell turns that into the
 * argument moveSection wants (which counts positions AFTER the dragged section is
 * lifted out), so this stays ignorant of what is moving.
 */

import { useCallback, useRef } from 'react';

import { parsePathKey } from '../../lib/content/tree';

export interface SectionDrop {
  /** Attach to the imperatively-positioned boundary line element. */
  slotRef: React.RefObject<HTMLDivElement | null>;
  /** A section drag began; forget any gap the last one left. */
  start: () => void;
  /** The pointer moved to this viewport point; redraw the line. */
  update: (clientX: number, clientY: number) => void;
  /** The drag ended; hand the shell the gap if it was over a section. */
  end: () => void;
  /** Hide the line and forget the drag. */
  hide: () => void;
}

export function useSectionDrop(onDrop: (gap: number) => void): SectionDrop {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const gapRef = useRef<number | null>(null);

  const hide = useCallback(() => {
    if (slotRef.current) slotRef.current.style.display = 'none';
    gapRef.current = null;
  }, []);

  const start = useCallback(() => {
    gapRef.current = null;
  }, []);

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const node = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>(
        '.tgs-section[data-path]',
      );
      const slot = slotRef.current;
      if (!node || !slot) {
        hide();
        return;
      }
      const path = parsePathKey(node.dataset.path);
      if (!path || path.kind !== 'section') {
        hide();
        return;
      }

      // Above the section's middle drops before it, below drops after it. The two
      // read the same boundary from either side, which is what you want: the line
      // sits on the edge between two sections.
      const rect = node.getBoundingClientRect();
      const before = clientY < rect.top + rect.height / 2;
      const gap = before ? path.section : path.section + 1;
      const y = before ? rect.top : rect.bottom;

      const height = 4;
      slot.style.display = 'block';
      slot.style.left = `${rect.left}px`;
      slot.style.width = `${rect.width}px`;
      slot.style.top = `${y - height / 2}px`;
      slot.style.height = `${height}px`;

      gapRef.current = gap;
    },
    [hide],
  );

  const end = useCallback(() => {
    const gap = gapRef.current;
    hide();
    if (gap != null) onDrop(gap);
  }, [hide, onDrop]);

  return { slotRef, start, update, end, hide };
}
