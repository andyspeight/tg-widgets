'use client';

/**
 * The live preview.
 *
 * Renders the real page components, so what you see is what the server
 * will emit. Two interactions live here and nowhere else:
 *
 *   1. Click to select. One delegated listener reads `data-path` off the
 *      closest ancestor, which is why PageRenderer can stay free of event
 *      handlers and remain usable as a server component.
 *   2. Drag a column edge to resize. Also delegated, via pointer events, so
 *      it keeps working when the pointer leaves the handle mid-drag.
 *
 * The viewport switcher changes this element's width. Because the page is a
 * CSS container, rows restack for real at the chosen width. There is no
 * separate mobile preview mode to drift out of sync, and no iframe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../../lib/content/schema';
import { STACK_BREAKPOINTS } from '../../lib/content/schema';
import {
  type Path,
  parsePathKey,
  pathKindLabel,
  resizeColumnBoundary,
} from '../../lib/content/tree';
import { PageRenderer } from '../render/PageRenderer';
import type { Viewport } from './EditorShell';

interface Props {
  page: Page;
  selected: Path | null;
  selectedKey: string | null;
  viewportWidth: string;
  viewport: Viewport;
  onSelect: (path: Path) => void;
  onCommit: (next: (current: Page) => Page, coalesceKey?: string) => void;
  onPickBlock: (target: { section: number; row: number; column: number }) => void;
}

/** Live state of a width drag. Kept in a ref: it changes faster than React. */
interface DragState {
  section: number;
  row: number;
  index: number;
  rowWidthPx: number;
  startX: number;
  handle: HTMLElement;
}

export function Canvas({
  page,
  selected,
  selectedKey,
  viewportWidth,
  viewport,
  onSelect,
  onCommit,
  onPickBlock,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [badge, setBadge] = useState<{ x: number; y: number; text: string } | null>(null);

  // ---------------------------------------------------------------------
  // Selection outlines
  // ---------------------------------------------------------------------

  // Applied to the DOM rather than rendered as props, so changing selection
  // does not re-render the whole page tree.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const previous = frame.querySelectorAll('[data-path].is-selected');
    previous.forEach((node) => {
      node.classList.remove('is-selected');
      node.removeAttribute('data-kind');
    });

    if (!selectedKey || !selected) return;
    const node = frame.querySelector(`[data-path="${CSS.escape(selectedKey)}"]`);
    if (!node) return;

    node.classList.add('is-selected');
    node.setAttribute('data-kind', pathKindLabel(selected));
  }, [selectedKey, selected, page]);

  // Scroll the selection into view, but only when the selection actually
  // changes. Doing it on every render would yank the page around while the
  // agent is typing in the properties pane.
  const lastScrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedKey || selectedKey === lastScrolled.current) return;
    lastScrolled.current = selectedKey;

    const frame = frameRef.current;
    const node = frame?.querySelector(`[data-path="${CSS.escape(selectedKey)}"]`);
    if (!node) return;

    const rect = node.getBoundingClientRect();
    const offscreen = rect.top < 0 || rect.bottom > window.innerHeight;
    if (offscreen) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedKey]);

  // ---------------------------------------------------------------------
  // Click to select
  // ---------------------------------------------------------------------

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;

      // The empty-column placeholder opens the block picker instead.
      const adder = target.closest<HTMLElement>('[data-add]');
      if (adder) {
        const path = parsePathKey(adder.dataset.add);
        if (path?.kind === 'column') {
          onPickBlock({ section: path.section, row: path.row, column: path.column });
        }
        return;
      }

      if (target.closest('.ed-resize')) return;

      // A preview is for editing, not for browsing. Following a link would
      // navigate away from the editor.
      const link = target.closest('a');
      if (link) event.preventDefault();

      const node = target.closest<HTMLElement>('[data-path]');
      if (!node) return;
      const path = parsePathKey(node.dataset.path);
      if (path) onSelect(path);
    },
    [onSelect, onPickBlock],
  );

  // ---------------------------------------------------------------------
  // Column resize
  // ---------------------------------------------------------------------

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const handle = (event.target as HTMLElement).closest<HTMLElement>('.ed-resize');
    if (!handle) return;

    const spec = handle.dataset.resize;
    if (!spec) return;

    const [rowKey, indexPart] = spec.split(':');
    const path = parsePathKey(rowKey);
    if (path?.kind !== 'row') return;

    const rowElement = handle.closest<HTMLElement>('.tgs-row');
    if (!rowElement) return;

    const rowWidthPx = rowElement.getBoundingClientRect().width;
    if (rowWidthPx <= 0) return;

    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('is-dragging');

    dragRef.current = {
      section: path.section,
      row: path.row,
      index: Number(indexPart),
      rowWidthPx,
      startX: event.clientX,
      handle,
    };
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;

      const deltaPx = event.clientX - drag.startX;
      const deltaPercent = (deltaPx / drag.rowWidthPx) * 100;
      if (Math.abs(deltaPercent) < 0.05) return;

      // Reset the origin each move so the next delta is relative to where we
      // are now. Clamping inside resizeColumnBoundary otherwise causes the
      // pointer to drift away from the handle once a column hits its floor.
      drag.startX = event.clientX;

      onCommit(
        (current) => resizeColumnBoundary(current, drag.section, drag.row, drag.index, deltaPercent),
        // One undo step for the whole drag rather than one per pixel.
        `resize:${drag.section}:${drag.row}:${drag.index}`,
      );

      // Reads from the page one render behind the commit above. At pointer
      // rates that is imperceptible, and it self-corrects on the next move.
      const columns = page.sections[drag.section]?.rows[drag.row]?.columns;
      const text = columns
        ? `${Math.round(columns[drag.index]?.width ?? 0)}% / ${Math.round(columns[drag.index + 1]?.width ?? 0)}%`
        : '';

      setBadge({ x: event.clientX, y: event.clientY, text });
    },
    [onCommit, page],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    try {
      drag.handle.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone. Nothing to release.
    }
    drag.handle.classList.remove('is-dragging');
    dragRef.current = null;
    setBadge(null);
  }, []);

  // Keyboard equivalent for the drag, so column widths are reachable without
  // a mouse. 2% a press, 10% with shift.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const handle = (event.target as HTMLElement).closest<HTMLElement>('.ed-resize');
      if (!handle?.dataset.resize) return;

      const [rowKey, indexPart] = handle.dataset.resize.split(':');
      const path = parsePathKey(rowKey);
      if (path?.kind !== 'row') return;

      event.preventDefault();
      const step = (event.shiftKey ? 10 : 2) * (event.key === 'ArrowLeft' ? -1 : 1);
      onCommit((current) =>
        resizeColumnBoundary(current, path.section, path.row, Number(indexPart), step),
      );
    },
    [onCommit],
  );

  // ---------------------------------------------------------------------

  const widthPx = viewport === 'desktop' ? Number.POSITIVE_INFINITY : parseInt(viewportWidth, 10);
  const stackNote = describeStacking(page, widthPx);

  return (
    <div className="ed-canvas-wrap">
      <div style={{ width: '100%', maxWidth: viewportWidth }}>
        <div
          ref={frameRef}
          className="ed-canvas-frame"
          style={{ maxWidth: '100%' }}
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
        >
          <PageRenderer page={page} editable />
        </div>

        {stackNote && <p className="ed-stack-note">{stackNote}</p>}
      </div>

      {badge && (
        <div className="ed-width-badge" style={{ left: badge.x, top: badge.y }}>
          {badge.text || 'Drag to resize'}
        </div>
      )}
    </div>
  );
}

/**
 * Explain, in plain words, when the preview is showing stacked columns.
 * Without this an agent drags a width at phone size, sees nothing move, and
 * concludes the editor is broken.
 */
function describeStacking(page: Page, viewportPx: number): string | null {
  if (!Number.isFinite(viewportPx)) return null;

  let stacked = 0;
  for (const section of page.sections) {
    for (const row of section.rows) {
      if (row.columns.length < 2) continue;
      if (viewportPx <= STACK_BREAKPOINTS[row.stackBelow] - 1) stacked += 1;
    }
  }

  if (stacked === 0) return null;
  return `${stacked} row${stacked === 1 ? '' : 's'} stack to a single column at this width, so column widths do not apply here. Switch to Desktop to change them.`;
}
