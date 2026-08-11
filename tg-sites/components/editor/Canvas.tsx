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

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { escapeHtml } from '../../lib/content/sanitise';
import type { Page } from '../../lib/content/schema';
import {
  DEFAULT_SECTION_PADDING,
  normaliseSectionPadding,
  SECTION_PADDING_STEP,
  STACK_BREAKPOINTS,
} from '../../lib/content/schema';
import {
  blockAtPath,
  containerColumns,
  type Path,
  parsePathKey,
  pathKindLabel,
  resizeColumnBoundary,
  resizeInnerColumnBoundary,
  updateBlockPropsAtPath,
} from '../../lib/content/tree';
import { resolveAt, withOverride } from '../../lib/content/responsive';
import { PageRenderer } from '../render/PageRenderer';
import type { Viewport } from './EditorShell';

/**
 * Where a block is added or dropped.
 *
 * An ordinary column names its section, row and column. A CONTAINER's inner
 * column names those three (the container's own place) plus `block`, the
 * container within that column, and `inner`, the column within the container.
 * `at` is the index within whichever column, so a drop lands where the pointer
 * is rather than always at the end. The shell reads `inner` being present as
 * "this goes inside a container" and routes to addInnerBlock.
 */
export interface DropTarget {
  section: number;
  row: number;
  column: number;
  block?: number;
  inner?: number;
  at?: number;
}

interface Props {
  page: Page;
  selected: Path | null;
  selectedKey: string | null;
  viewportWidth: string;
  viewport: Viewport;
  onSelect: (path: Path | null) => void;
  onCommit: (next: (current: Page) => Page, coalesceKey?: string) => void;
  onPickBlock: (target: DropTarget) => void;
  onInsertSection: (index: number) => void;
  /**
   * The block being typed into on the canvas, as a path key, or null.
   *
   * Decided by EditorShell rather than here, because the canvas does not own
   * the selection and two places deciding what is being edited is one too many.
   */
  editingPath?: string | null;
  /**
   * The client's theme, as custom properties.
   *
   * Passed straight through to PageRenderer, which is the point: the canvas
   * shows the site in the client's real colours and fonts rather than in
   * Travelgenix navy. A preview in the wrong palette is a preview of a
   * different site.
   */
  theme?: CSSProperties;
  /** What the canvas says when there is nothing here yet. See PageRenderer. */
  emptyNote?: string;
  /** Which region is being edited, when it is one rather than a page. */
  region?: 'header' | 'footer' | null;
  /**
   * Show the page as it will be published, not as it is edited.
   *
   * In preview the render is editable=false, so it is the exact published DOM:
   * no data-path, no insert points, no empty-column adders, and a background
   * video plays where the editor only shows its poster. None of the editing
   * interactions are wired (select, resize, type in place), and a link is left
   * to behave rather than being swallowed. The shell hides the side panels at
   * the same time, so this is the whole canvas.
   */
  preview?: boolean;
}

/**
 * Live state of a height drag.
 *
 * Separate from the width drag rather than one union: they cannot both be in
 * progress, but keeping them apart means neither has to check which kind it
 * is on every pointer move.
 */
interface HeightDrag {
  section: number;
  startY: number;
  startPadding: number;
  handle: HTMLElement;
}

/** Live state of a width drag. Kept in a ref: it changes faster than React. */
interface DragState {
  section: number;
  row: number;
  index: number;
  rowWidthPx: number;
  startX: number;
  handle: HTMLElement;
  /**
   * Present when the drag resizes a CONTAINER's inner columns rather than a
   * row's. It names the container (its outer column and block index), so the
   * move commits through resizeInnerColumnBoundary and the badge reads the inner
   * columns' widths.
   */
  inner?: { column: number; block: number };
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
  onInsertSection,
  editingPath = null,
  theme,
  emptyNote,
  region = null,
  preview = false,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const heightRef = useRef<HeightDrag | null>(null);
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

  // ---------------------------------------------------------------------
  // Editing the words where they are
  // ---------------------------------------------------------------------

  /*
   * TAKE OVER THE SELECTED TEXT BLOCK AND LET THE DOM OWN IT.
   *
   * PageRenderer renders this one element with no children (see TextBlock's
   * editingHost), so React has nothing in there to rewrite. That is what makes
   * a contentEditable survivable: every keystroke commits, every commit
   * re-renders, and a React-managed contentEditable would have its children
   * replaced and its caret thrown to the start on every letter.
   */

  /**
   * What the block being edited currently holds, read from state rather than
   * from the DOM.
   *
   * ONE KIND NOW. A paragraph and a heading both store markup since 31 Jul 2026,
   * which is what let the formatting toolbar reach a heading. This used to have a
   * `plain` branch that read block.props.text as textContent for headings.
   *
   * A heading written before that change has only `text`, so it is still read
   * here and escaped, exactly as HeadingBlock does when it renders. Without this
   * fallback, clicking an old heading would show an empty box and typing one
   * letter would replace the whole thing.
   */
  const editingValue = useMemo(() => {
    if (!editingPath) return null;
    const path = parsePathKey(editingPath);
    // A block in a column, or a block inside a container: both are typed into in
    // place, so both are read back here through the one path-aware lookup.
    if (path?.kind !== 'block' && path?.kind !== 'inner-block') return null;

    const block = blockAtPath(page, path);
    if (!block) return null;

    const html = block.props?.html;
    if (typeof html === 'string' && html) return { value: html };

    const text = block.props?.text;
    return { value: typeof text === 'string' ? escapeHtml(text) : '' };
  }, [editingPath, page]);

  const findHost = useCallback(() => {
    const frame = frameRef.current;
    if (!frame || !editingPath) return null;
    return frame.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(editingPath)}"] [data-rt-host]`,
    );
  }, [editingPath]);

  // Take the element over, seed it, and put the caret in it. Once per block.
  useEffect(() => {
    const host = findHost();
    if (!host || !editingValue) return;

    host.innerHTML = editingValue.value;

    host.contentEditable = 'true';
    host.spellcheck = true;

    /*
     * Focused because somebody just clicked this block, which is a real user
     * action and a genuine step change: the exception the no-focus-on-render
     * rule names. Keyed on editingPath, so it happens once per block and not on
     * the re-render that every keystroke causes.
     */
    host.focus();

    return () => {
      host.contentEditable = 'false';
    };
    // Deliberately not depending on editingValue: re-seeding from state while
    // somebody is typing is the caret fight by another route. Catching up is the
    // next effect's job, and it knows when it is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPath, findHost]);

  /*
   * CATCH UP WITH AN EDIT THAT CAME FROM SOMEWHERE ELSE.
   *
   * The properties pane edits the same words. Without this the canvas kept
   * showing the content as it was when it was taken over, so typing in the pane
   * changed the page and the canvas silently disagreed with it, and the next
   * keystroke on the canvas committed the stale version over the top.
   *
   * Only when this element is NOT the one being typed into. That condition is
   * the whole thing: writing into a focused contentEditable is exactly the caret
   * fight the no-children trick exists to avoid. The pane field has the same
   * rule in the other direction, which is what makes the two safe together.
   */
  useEffect(() => {
    const host = findHost();
    if (!host || !editingValue) return;
    if (document.activeElement === host) return;

    if (host.innerHTML !== editingValue.value) host.innerHTML = editingValue.value;
  }, [editingValue, findHost]);

  /*
   * Paste as plain text, on both kinds of host.
   *
   * Pasting from Word or a web page otherwise drags in a paragraph of spans and
   * inline styles. The sanitiser strips them on save, so the formatting appears
   * to take and then vanishes, which reads as the save having failed. Taking the
   * text only means what you see after pasting is what you get. Same reasoning,
   * same handler, as the properties pane field.
   */
  const onPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const host = (event.target as HTMLElement).closest<HTMLElement>('[data-rt-host]');
    if (!host) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, []);

  /*
   * Read the words back out on input.
   *
   * Straight to the same updateBlockProps the properties pane uses, so both
   * ways of editing land in one place. Coalesced under one key so a paragraph
   * of typing is one undo step rather than one per letter, which is what the
   * pane field already does.
   */
  const onInput = useCallback(
    (event: React.FormEvent<HTMLDivElement>) => {
      const host = (event.target as HTMLElement).closest<HTMLElement>('[data-rt-host]');
      if (!host || !editingPath) return;

      const path = parsePathKey(editingPath);
      if (path?.kind !== 'block' && path?.kind !== 'inner-block') return;

      /*
       * ALWAYS innerHTML NOW. There used to be a data-rt-plain branch here that
       * read textContent into `text` for headings, because a heading stored a
       * plain string. A heading stores markup since 31 Jul 2026 (see
       * HeadingBlock), so both kinds of host read back the same way and the
       * formatting toolbar works in both.
       *
       * A heading is still one line: that is data-rt-oneline and the Enter
       * handler below, which is the half of the old attribute that survived.
       *
       * updateBlockPropsAtPath, not the fixed-depth version, so the same commit
       * reaches a block in a column or one inside a container.
       */
      const patch = { html: host.innerHTML };

      onCommit((current) => updateBlockPropsAtPath(current, path, patch), `rt:${editingPath}`);
    },
    [editingPath, onCommit],
  );

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

      // "Add Section" on the seam between two sections.
      const inserter = target.closest<HTMLElement>('[data-insert]');
      if (inserter) {
        onInsertSection(Number(inserter.dataset.insert));
        return;
      }

      // The empty-column placeholder opens the block picker instead. An empty
      // inner column of a container does the same, targeting that inner column.
      const adder = target.closest<HTMLElement>('[data-add]');
      if (adder) {
        const path = parsePathKey(adder.dataset.add);
        if (path?.kind === 'column') {
          onPickBlock({ section: path.section, row: path.row, column: path.column });
        } else if (path?.kind === 'inner-column') {
          onPickBlock({
            section: path.section,
            row: path.row,
            column: path.column,
            block: path.block,
            inner: path.inner,
          });
        }
        return;
      }

      if (target.closest('.ed-resize')) return;

      // A preview is for editing, not for browsing. Following a link would
      // navigate away from the editor.
      const link = target.closest('a');
      if (link) event.preventDefault();

      const node = target.closest<HTMLElement>('[data-path]');
      if (!node) {
        /*
         * A CLICK THAT LANDS ON NO ITEM IS A CLICK AWAY. Clear the selection so
         * the contextual toolbar goes with it, which is what Andy meant by the
         * tools not disappearing when you have finished with them (3 Aug 2026).
         * The seam, the column adder and the resize handles have all returned
         * above, so what is left here is the canvas around the page: the margin,
         * the space under the last section, the gaps a section's own padding
         * leaves. Clicking any of them now puts the toolbar away.
         */
        onSelect(null);
        return;
      }
      const path = parsePathKey(node.dataset.path);
      // Inner columns and inner blocks select themselves, the same as any other
      // node: their panes, toolbars and inline editing are all wired now.
      if (path) onSelect(path);
    },
    [onSelect, onPickBlock, onInsertSection],
  );

  /*
   * The only click handling PREVIEW keeps: let a link behave.
   *
   * Editing swallows every link so following one cannot navigate away from the
   * editor. Preview is the opposite promise, so an in-page anchor is left to
   * scroll and any other link opens in a new tab, which keeps the browsing live
   * without losing the editor and the edits that have not saved yet. Nothing
   * here selects: preview has no selection.
   */
  const onPreviewClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    if (href === '' || href.startsWith('#')) return;
    event.preventDefault();
    window.open(link.href, '_blank', 'noopener,noreferrer');
  }, []);

  // ---------------------------------------------------------------------
  // Column resize
  // ---------------------------------------------------------------------

  /*
   * Commit a section's vertical padding for the CURRENT screen size. On desktop
   * it sets the base, as the drag always did; on tablet or phone (the device
   * switcher) it sets that size's override, so dragging the section's foot at a
   * phone width tunes the phone spacing and leaves the desktop alone. The pane's
   * spacing control writes the same way, so the two agree.
   */
  const commitPad = useCallback(
    (sectionIndex: number, value: number) => {
      onCommit((current) => {
        const section = current.sections[sectionIndex];
        if (!section) return current;
        const sections = [...current.sections];
        if (viewport === 'desktop') {
          if (section.paddingY === value) return current;
          sections[sectionIndex] = { ...section, paddingY: value };
        } else {
          sections[sectionIndex] = {
            ...section,
            responsive: withOverride(section.responsive, 'paddingY', viewport, value),
          };
        }
        return { ...current, sections };
      }, `pad:${sectionIndex}:${viewport}`);
    },
    [onCommit, viewport],
  );

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const grip = (event.target as HTMLElement).closest<HTMLElement>('.ed-vresize');
    if (grip?.dataset.vresize) {
      const path = parsePathKey(grip.dataset.vresize);
      if (path?.kind !== 'section') return;

      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      grip.classList.add('is-dragging');

      const target = page.sections[path.section];
      heightRef.current = {
        section: path.section,
        startY: event.clientY,
        // The value the CURRENT screen actually takes, so the drag starts from
        // what is on the canvas rather than always from the desktop base.
        startPadding: resolveAt(target?.paddingY ?? DEFAULT_SECTION_PADDING, target?.responsive, 'paddingY', viewport),
        handle: grip,
      };
      return;
    }

    const handle = (event.target as HTMLElement).closest<HTMLElement>('.ed-resize');
    if (!handle) return;

    const spec = handle.dataset.resize;
    if (!spec) return;

    const [rowKey, indexPart] = spec.split(':');
    const path = parsePathKey(rowKey);
    if (!path) return;
    // A row's columns name a row; a container's inner columns name the container
    // block. Both split the same and are measured the same; only the commit
    // differs. Anything else on a resize handle is not ours.
    let inner: { column: number; block: number } | undefined;
    let section: number;
    let dragRow: number;
    if (path.kind === 'row') {
      section = path.section;
      dragRow = path.row;
    } else if (path.kind === 'block') {
      section = path.section;
      dragRow = path.row;
      inner = { column: path.column, block: path.block };
    } else {
      return;
    }

    const rowElement = handle.closest<HTMLElement>('.tgs-row');
    if (!rowElement) return;

    /*
     * THE SPACE THE COLUMNS SHARE, not the width of the row.
     *
     * The two differ by the gaps between them, and the widths this drag edits
     * are shares of the former: the grid is `minmax(0, 37fr) minmax(0, 63fr)`,
     * and a fraction divides what is LEFT after the gaps. Measuring the row
     * instead makes every drag about five per cent too slow on a three-column
     * row, and since the origin resets on each move that is not a one-off
     * offset, it is the handle steadily drifting behind the pointer holding it.
     *
     * Summed from the columns rather than worked out from the gap, because that
     * is the same number by definition and needs nothing parsed out of a
     * computed style.
     */
    const rowWidthPx = [...rowElement.children]
      .reduce((total, child) => total + child.getBoundingClientRect().width, 0);
    if (rowWidthPx <= 0) return;

    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('is-dragging');

    dragRef.current = {
      section,
      row: dragRow,
      index: Number(indexPart),
      rowWidthPx,
      startX: event.clientX,
      handle,
      ...(inner ? { inner } : {}),
    };
  }, [page]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const height = heightRef.current;
      if (height) {
        // Halved because the padding applies top AND bottom: without it the
        // section grows at twice the speed of the pointer and the grip runs
        // away from the finger holding it.
        const delta = (event.clientY - height.startY) / 2;
        const next = normaliseSectionPadding(height.startPadding + delta);

        // Writes the base or the current screen's override, one undo step for the
        // whole drag (commitPad coalesces on section and tier).
        commitPad(height.section, next);

        setBadge({ x: event.clientX, y: event.clientY, text: `${next}px` });
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;

      const deltaPx = event.clientX - drag.startX;
      const deltaPercent = (deltaPx / drag.rowWidthPx) * 100;
      if (Math.abs(deltaPercent) < 0.05) return;

      // Reset the origin each move so the next delta is relative to where we
      // are now. Clamping inside resizeColumnBoundary otherwise causes the
      // pointer to drift away from the handle once a column hits its floor.
      drag.startX = event.clientX;

      const inner = drag.inner;
      onCommit(
        (current) =>
          inner
            ? resizeInnerColumnBoundary(current, drag.section, drag.row, inner.column, inner.block, drag.index, deltaPercent)
            : resizeColumnBoundary(current, drag.section, drag.row, drag.index, deltaPercent),
        // One undo step for the whole drag rather than one per pixel.
        inner
          ? `iresize:${drag.section}:${drag.row}:${inner.column}:${inner.block}:${drag.index}`
          : `resize:${drag.section}:${drag.row}:${drag.index}`,
      );

      // Reads from the page one render behind the commit above. At pointer
      // rates that is imperceptible, and it self-corrects on the next move.
      const containerBlock = inner
        ? page.sections[drag.section]?.rows[drag.row]?.columns[inner.column]?.blocks[inner.block]
        : undefined;
      const columns = inner
        ? containerBlock
          ? containerColumns(containerBlock)
          : undefined
        : page.sections[drag.section]?.rows[drag.row]?.columns;
      const text = columns
        ? `${Math.round(columns[drag.index]?.width ?? 0)}% / ${Math.round(columns[drag.index + 1]?.width ?? 0)}%`
        : '';

      setBadge({ x: event.clientX, y: event.clientY, text });
    },
    [onCommit, page, commitPad],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const height = heightRef.current;
    if (height) {
      try {
        height.handle.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may already be gone. Nothing to release.
      }
      height.handle.classList.remove('is-dragging');
      heightRef.current = null;
      setBadge(null);
      return;
    }

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
      /*
       * A heading is one line, so Enter inside one does nothing.
       *
       * Left alone, the browser puts a <div> or a <br> inside the heading. The
       * div is dropped by the heading sanitiser, which welds the two lines into
       * one word with no space between them, and refusing the key is honest
       * about what a heading is. Paragraphs keep Enter: that is how you get a
       * second paragraph.
       *
       * data-rt-oneline, not the old data-rt-plain. That attribute meant two
       * things, "one line" and "holds no markup", and a heading is only the
       * first of those now.
       */
      const oneLine = (event.target as HTMLElement).closest<HTMLElement>('[data-rt-oneline]');
      if (oneLine && event.key === 'Enter') {
        event.preventDefault();
        return;
      }

      // Height first: same keys would otherwise be ambiguous on a page that
      // has both handles focusable.
      const grip = (event.target as HTMLElement).closest<HTMLElement>('.ed-vresize');
      if (grip?.dataset.vresize) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const path = parsePathKey(grip.dataset.vresize);
        if (path?.kind !== 'section') return;

        event.preventDefault();
        // One step a press, five with shift, matching the widths' 2 and 10.
        const step = (event.shiftKey ? 5 : 1) * SECTION_PADDING_STEP;
        const delta = event.key === 'ArrowUp' ? -step : step;

        // From the value the CURRENT screen shows, and written back to the same
        // level, so the keyboard nudges the size you are looking at.
        const section = page.sections[path.section];
        if (!section) return;
        const from = resolveAt(section.paddingY, section.responsive, 'paddingY', viewport);
        commitPad(path.section, normaliseSectionPadding(from + delta));
        return;
      }

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const handle = (event.target as HTMLElement).closest<HTMLElement>('.ed-resize');
      if (!handle?.dataset.resize) return;

      const [rowKey, indexPart] = handle.dataset.resize.split(':');
      const path = parsePathKey(rowKey);
      // A row's columns, or a container's inner ones. Same keys, same step, the
      // commit apart.
      if (path?.kind !== 'row' && path?.kind !== 'block') return;

      event.preventDefault();
      const index = Number(indexPart);
      const step = (event.shiftKey ? 10 : 2) * (event.key === 'ArrowLeft' ? -1 : 1);
      onCommit((current) =>
        path.kind === 'block'
          ? resizeInnerColumnBoundary(current, path.section, path.row, path.column, path.block, index, step)
          : resizeColumnBoundary(current, path.section, path.row, index, step),
      );
    },
    [onCommit, commitPad, page, viewport],
  );

  // ---------------------------------------------------------------------

  /*
   * Every preview has a real width now, desktop included, so the stacking note
   * no longer has to special-case it. Desktop used to be '100%', which parsed
   * to NaN and was treated as infinitely wide, which was wrong in the one
   * direction that mattered: on a 1440px screen the canvas was 752px and the
   * page was drawing itself as a phone while the note said otherwise.
   */
  const widthPx = parseInt(viewportWidth, 10);

  const stackNote = describeStacking(page, widthPx);

  return (
    <div
      className="ed-canvas-wrap"
      ref={wrapRef}
      /*
       * THE CLICK HANDLER SITS ON THE WRAP, NOT THE PAGE FRAME, so that clicking
       * the canvas AROUND the page counts. The frame hugs its content, so a
       * click below the last section or out in the margin missed it entirely and
       * the selection, and its toolbar, stayed put. On the wrap every click in
       * the canvas lands here: on an item it selects, on the empty canvas it
       * clears. onClick reads data-path with closest(), so it works the same from
       * up here.
       *
       * In preview the editor click is swapped for the one that only lets links
       * behave: no select, no clear, no resize.
       */
      onClick={preview ? onPreviewClick : onClick}
    >
      {/*
        A CAP, NOT A FIXED WIDTH, and this is the third answer to the same
        question rather than the first.
        
        The preview follows the CANVAS width, so on a 1440px screen with both
        panels open it had 800px and drew the phone layout. Andy asked for a real
        desktop. Two attempts failed:
        
          1. A fixed width overflowed. A 1200px preview in 800px of room put
             424px off the right, taking the whole right-hand column of every
             section somewhere unreachable.
          2. Shrinking it to fit fixed that and broke something worse: the editor
             chrome shrank with the page, so the insert buttons came out at 20px
             and the height handle at 13px. Measured. A handle nobody can hit is
             not a preview improvement.
        
        So the width is a ceiling, and the ROOM is what makes it reachable. That
        is what the fold buttons are for, and why Desktop folds the panels when
        it has to: at 1440 with both folded the canvas is 1392px, which holds a
        1200px preview at 1:1 with every handle full size. When there is not
        enough room, the preview says what it is actually showing rather than
        pretending.
      */}
      <div style={{ width: '100%', maxWidth: viewportWidth }}>
        <div
          ref={frameRef}
          className="ed-canvas-frame"
          style={{ maxWidth: '100%' }}
          /*
            None of the editing interactions are wired in preview: no typing in
            place, no column or height drag, no resize keys. The render below is
            editable=false, so there are no handles or hosts for them to find
            anyway, but leaving them off is what makes preview a preview.
          */
          onInput={preview ? undefined : onInput}
          onPaste={preview ? undefined : onPaste}
          onPointerDown={preview ? undefined : onPointerDown}
          onPointerMove={preview ? undefined : onPointerMove}
          onPointerUp={preview ? undefined : endDrag}
          onPointerCancel={preview ? undefined : endDrag}
          onKeyDown={preview ? undefined : onKeyDown}
        >
          <PageRenderer
            page={page}
            editable={!preview}
            editingPath={preview ? null : editingPath}
            emptyNote={preview ? undefined : emptyNote}
            theme={theme}
            /*
              So a header draws as a header here, not as a page. See the note on
              PageRenderer's own `region` prop: without it every rule keyed on
              .tgs-region missed the canvas, and the preview quietly showed
              something the published site does not.
            */
            region={region}
          />
        </div>

        {!preview && stackNote && <p className="ed-stack-note">{stackNote}</p>}
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
