'use client';

/**
 * The contextual toolbar that appears on the item you clicked.
 *
 * WHAT ANDY ASKED FOR, 2 Aug 2026: "everything all blocks, sections everything
 * should be editable on the page (a toolbar for the item you click on should
 * appear with that items options)", with a Duda screenshot. So clicking a
 * section or a block raises this pill on it: a label saying what it is, then
 * Edit, Add, Duplicate, the moves and Delete. Edit opens that item's fields in
 * a popover right there on the canvas rather than sending you to the far pane.
 *
 * IT DOES NOT OWN THE SELECTION. The shell decides what is selected; this reads
 * it and draws the toolbar for it. Nor does it own the tree: the pure actions
 * (duplicate, move, delete) arrive from itemActions carrying their own
 * transform, and this hands each straight to onCommit. Add and Edit are the two
 * that need more than a transform, so they go back to the shell (Add opens a
 * picker or adds a column) or open the popover here (Edit).
 *
 * POSITIONED BY MEASURING, not by living inside the page. The canvas is the
 * real page components and this must not be a child of them, so it is a fixed
 * pill placed from the selected element's rect, re-measured on scroll, on
 * resize and whenever the page changes under it. It sits above the element, or
 * flips below when the element is hard against the top of the canvas.
 *
 * TEXT IS THE ONE EXCEPTION. Selecting a paragraph or a heading already drops
 * you into typing it, with the formatting toolbar up, so Edit would be a button
 * that does what just happened. It is dropped from the pill while editing, and
 * the structural actions stay.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { blockDefinition } from '../../lib/content/blocks';
import type { ItemMeta } from '../../lib/content/collection-page';
import { itemActions, itemLabel, type ItemAction } from '../../lib/content/item-actions';
import type { Page, RegionName } from '../../lib/content/schema';
import { getBlock, type Path, type Reid } from '../../lib/content/tree';
import { Icon, type IconName } from './Icon';
import { ItemOptions } from './Properties';

/** What the popover needs to draw an item's fields. Built once by the shell. */
export interface OptionsProps {
  isStaff: boolean;
  region: RegionName | null;
  regionFlags?: { sticky: boolean; overlay: boolean };
  onRegionFlags?: (next: { sticky: boolean; overlay: boolean }) => void;
  isItem: boolean;
  itemMeta?: ItemMeta;
  onItemMeta?: (next: ItemMeta) => void;
}

interface Anchor {
  top: number;
  left: number;
  /** True when the pill had no room above the element and sits below instead. */
  flip: boolean;
}

/** Rough pill width, for keeping it off the right edge before it has rendered. */
const PILL_WIDTH = 280;
/** Rough pill height, for deciding whether it fits above the element. */
const PILL_HEIGHT = 38;

export function ItemToolbar({
  page,
  selected,
  selectedKey,
  editing,
  newId,
  onAdd,
  onCommit,
  options,
}: {
  page: Page;
  selected: Path;
  selectedKey: string;
  /** True when the selected block is being typed into: Edit is then redundant. */
  editing: boolean;
  newId: Reid;
  onAdd: () => void;
  onCommit: (next: (page: Page) => Page, coalesceKey?: string) => void;
  options: OptionsProps;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const node = document.querySelector<HTMLElement>(
      `.ed-canvas-frame [data-path="${CSS.escape(selectedKey)}"]`,
    );
    const wrap = document.querySelector('.ed-canvas-wrap');
    if (!node || !wrap) {
      setAnchor(null);
      return;
    }

    const r = node.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();

    // The element can be scrolled clean out of the canvas. Hide rather than
    // pin the pill to an edge, so it does not hover over a section it has
    // nothing to do with.
    if (r.bottom < w.top || r.top > w.bottom) {
      setAnchor(null);
      return;
    }

    // The pill sits above the element by default and CSS lifts it there. When
    // the element is hard against the top of the canvas there is no room above,
    // so it flips to just below the element's top edge instead.
    const flip = r.top - PILL_HEIGHT < w.top + 4;
    // Keep the whole pill inside the canvas, left and right.
    const left = Math.min(Math.max(w.left + 4, r.left), Math.max(w.left + 4, w.right - PILL_WIDTH));
    setAnchor({ top: r.top, left, flip });
  }, [selectedKey]);

  // Re-measure on the things that move the element: scrolling the canvas,
  // resizing the window, and any change to the page (a move or a duplicate
  // shifts everything below it). `page` in the deps is what catches the last.
  useEffect(() => {
    measure();
    const wrap = document.querySelector('.ed-canvas-wrap');
    wrap?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      wrap?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure, page]);

  // A fresh selection starts with the popover closed: the options belong to the
  // thing that was clicked, and carrying the open state onto a different item
  // would show one item's fields framed as another's.
  useEffect(() => {
    setOptionsOpen(false);
  }, [selectedKey]);

  /*
   * PLACE THE POPOVER SO IT ALWAYS FITS, measured rather than guessed.
   *
   * It opens just under the item's top, over the content, so it stays next to
   * the toolbar whether the item is a short image or a whole section. Then it is
   * clamped to the canvas: if it would run off the bottom it lifts until it
   * fits, and it never runs off the top, which is the bug the first version
   * had (a tall popover on an item near the top drew straight up into the top
   * bar). A layout effect, so the clamp happens before the browser paints it.
   */
  useLayoutEffect(() => {
    if (!optionsOpen || !anchor) {
      setPopPos(null);
      return;
    }
    const pop = popRef.current;
    const wrap = document.querySelector('.ed-canvas-wrap')?.getBoundingClientRect();
    const height = pop?.getBoundingClientRect().height ?? 0;
    const width = pop?.getBoundingClientRect().width ?? 320;
    const top = wrap?.top ?? 0;
    const bottom = wrap?.bottom ?? window.innerHeight;
    const right = wrap?.right ?? window.innerWidth;

    const wantedTop = anchor.top + 28;
    setPopPos({
      top: Math.max(top + 8, Math.min(wantedTop, bottom - height - 8)),
      left: Math.min(anchor.left, right - width - 8),
    });
  }, [optionsOpen, anchor]);

  // Close the popover on Escape or a click outside it. The pill's own Edit
  // button is outside the popover, so toggling stays possible.
  useEffect(() => {
    if (!optionsOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOptionsOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('.ed-bar')) return;
      setOptionsOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [optionsOpen]);

  if (!anchor) return null;

  const blockLabel =
    selected.kind === 'block'
      ? blockDefinition(
          getBlock(page, selected.section, selected.row, selected.column, selected.block)?.type ?? '',
        )?.label
      : undefined;
  const label = itemLabel(selected, blockLabel);

  let actions = itemActions(page, selected);
  if (editing) actions = actions.filter((action) => action.id !== 'edit');
  if (!actions.length) return null;

  const run = (action: ItemAction) => {
    if (action.id === 'edit') {
      setOptionsOpen((open) => !open);
      return;
    }
    if (action.id === 'add') {
      onAdd();
      return;
    }
    if (action.run) onCommit((current) => action.run!(current, newId));
  };

  const pillStyle: CSSProperties = { top: anchor.top, left: anchor.left };

  return (
    <>
      <div
        className="ed-bar"
        data-flip={anchor.flip ? 'true' : undefined}
        style={pillStyle}
        role="toolbar"
        aria-label={`${label} actions`}
      >
        <span className="ed-bar__label">{label}</span>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="ed-bar__btn"
            data-danger={action.danger ? 'true' : undefined}
            data-on={action.id === 'edit' && optionsOpen ? 'true' : undefined}
            title={action.label}
            aria-label={action.label}
            aria-pressed={action.id === 'edit' ? optionsOpen : undefined}
            onClick={() => run(action)}
          >
            {/* Every id in item-actions maps to an editor Icon name; the cast is
                the one place the two lists meet. A wrong name draws nothing,
                which the browser check would catch. */}
            <Icon name={action.icon as IconName} size={16} />
          </button>
        ))}
      </div>

      {optionsOpen && (
        <div
          ref={popRef}
          className="ed-pop"
          // Hidden for the one frame before the layout effect measures and
          // places it, so it is never seen in the wrong spot.
          style={popPos ? { top: popPos.top, left: popPos.left } : { top: anchor.top, left: anchor.left, visibility: 'hidden' }}
          role="dialog"
          aria-label={`${label} options`}
        >
          <div className="ed-pop__head">
            <span>{label}</span>
            <button
              type="button"
              className="ed-btn"
              data-variant="ghost"
              data-icon="true"
              aria-label="Close"
              title="Close"
              onClick={() => setOptionsOpen(false)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="ed-pop__body">
            <ItemOptions
              page={page}
              selected={selected}
              isStaff={options.isStaff}
              onCommit={onCommit}
              region={options.region}
              regionFlags={options.regionFlags}
              onRegionFlags={options.onRegionFlags}
              isItem={options.isItem}
              itemMeta={options.itemMeta}
              onItemMeta={options.onItemMeta}
            />
          </div>
        </div>
      )}
    </>
  );
}
