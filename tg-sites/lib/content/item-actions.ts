/**
 * What the contextual toolbar can do to the item you clicked.
 *
 * WHY THIS IS A MODULE OF ITS OWN, and a pure one. Andy asked on 2 Aug 2026 for
 * the editing to happen ON THE PAGE: click a section or a block and a toolbar
 * appears on it with that item's actions, the way Duda and Webflow work, rather
 * than the actions living only in the far pane. The toolbar is a React
 * component and hard to test; deciding WHICH actions an item has, and what each
 * one does to the page, is arithmetic on the tree and easy to test. So the
 * decision lives here as data, and ItemToolbar just draws it.
 *
 * EACH ACTION CARRIES ITS OWN TRANSFORM where it has one. duplicate, the two
 * moves and delete are pure Page -> Page (duplicate also wants an id factory),
 * so the component hands `run` straight to onCommit and never learns the shape
 * of the tree. edit and add carry no `run`: they need the DOM or a picker, so
 * the shell handles them. That split is the whole point. A test can assert that
 * a first section has no "move up", that the last block still has a "delete",
 * and that duplicate lands the copy immediately after the original, with no
 * component and no browser in sight.
 *
 * THE ORDER IS THE ORDER THEY ARE DRAWN, left to right, ending on delete
 * because a destructive control at the end is the one you reach for last and
 * mis-click least.
 */

import type { Page } from './schema';
import {
  duplicateBlock,
  duplicateRow,
  duplicateSection,
  moveBlockWithinColumn,
  moveColumn,
  moveRow,
  moveSection,
  removeBlock,
  removeColumn,
  removeRow,
  removeSection,
  type Path,
  type Reid,
} from './tree';

export type ItemActionId = 'edit' | 'add' | 'duplicate' | 'up' | 'down' | 'delete';

export interface ItemAction {
  id: ItemActionId;
  /** What the button says for a screen reader and on hover. */
  label: string;
  /** An editor Icon name. See components/editor/Icon.tsx. */
  icon: string;
  /** Delete, so the toolbar can set it apart. */
  danger?: boolean;
  /**
   * The change this action makes, for the pure ones. Absent for `edit` and
   * `add`: edit opens the item where it sits (inline typing for text, an
   * options popover for everything else) and add opens a picker, both of which
   * are the shell's job because they touch the DOM.
   */
  run?: (page: Page, reid: Reid) => Page;
}

/**
 * The friendly name for the label tab, e.g. "Section" or "Text".
 *
 * A block says what KIND of block it is rather than the bare word "Block",
 * because "Text", "Image" and "Buttons" are what a client is looking at and
 * "Block" tells them nothing. The block's own label is passed in rather than
 * looked up here, so this module keeps no dependency on the registry.
 */
export function itemLabel(path: Path, blockLabel?: string): string {
  switch (path.kind) {
    case 'page':
      return 'Page';
    case 'section':
      return 'Section';
    case 'row':
      return 'Row';
    case 'column':
      return 'Column';
    case 'block':
      return blockLabel || 'Block';
  }
}

/** The actions available for the item at `path`, in the order they are drawn. */
export function itemActions(page: Page, path: Path): ItemAction[] {
  switch (path.kind) {
    case 'section':
      return sectionActions(page, path.section);
    case 'row':
      return rowActions(page, path.section, path.row);
    case 'column':
      return columnActions(page, path.section, path.row, path.column);
    case 'block':
      return blockActions(page, path.section, path.row, path.column, path.block);
    // The page root is reached through the breadcrumb, never by clicking the
    // canvas, so it has no on-canvas toolbar.
    case 'page':
      return [];
  }
}

const EDIT: ItemAction = { id: 'edit', label: 'Edit', icon: 'edit' };
const ADD: ItemAction = { id: 'add', label: 'Add', icon: 'plus' };

function sectionActions(page: Page, s: number): ItemAction[] {
  if (!page.sections[s]) return [];
  const last = page.sections.length - 1;

  const actions: ItemAction[] = [
    EDIT,
    ADD,
    { id: 'duplicate', label: 'Duplicate', icon: 'copy', run: (p, reid) => duplicateSection(p, s, reid) },
  ];
  if (s > 0) actions.push({ id: 'up', label: 'Move up', icon: 'arrow-up', run: (p) => moveSection(p, s, s - 1) });
  if (s < last) actions.push({ id: 'down', label: 'Move down', icon: 'arrow-down', run: (p) => moveSection(p, s, s + 1) });
  // A section can be the last one deleted; the canvas has an empty state for a
  // page with none, so there is nothing to guard against.
  actions.push({ id: 'delete', label: 'Delete', icon: 'trash', danger: true, run: (p) => removeSection(p, s) });
  return actions;
}

function rowActions(page: Page, s: number, r: number): ItemAction[] {
  const rows = page.sections[s]?.rows;
  if (!rows?.[r]) return [];
  const last = rows.length - 1;

  const actions: ItemAction[] = [
    EDIT,
    ADD,
    { id: 'duplicate', label: 'Duplicate', icon: 'copy', run: (p, reid) => duplicateRow(p, s, r, reid) },
  ];
  if (r > 0) actions.push({ id: 'up', label: 'Move up', icon: 'arrow-up', run: (p) => moveRow(p, s, r, r - 1) });
  if (r < last) actions.push({ id: 'down', label: 'Move down', icon: 'arrow-down', run: (p) => moveRow(p, s, r, r + 1) });
  // A section keeps at least one row: the last one has no delete, matching the
  // outline's own rule.
  if (rows.length > 1) {
    actions.push({ id: 'delete', label: 'Delete', icon: 'trash', danger: true, run: (p) => removeRow(p, s, r) });
  }
  return actions;
}

function columnActions(page: Page, s: number, r: number, c: number): ItemAction[] {
  const columns = page.sections[s]?.rows[r]?.columns;
  if (!columns?.[c]) return [];
  const last = columns.length - 1;

  // No duplicate: a column has no duplicate op, because widening a row past
  // what it can hold is a decision rather than a copy. The + adds one instead.
  const actions: ItemAction[] = [EDIT, ADD];
  // Left and right, not up and down: a column sits beside its siblings, so the
  // arrows have to point the way it actually moves.
  if (c > 0) actions.push({ id: 'up', label: 'Move left', icon: 'arrow-left', run: (p) => moveColumn(p, s, r, c, c - 1) });
  if (c < last) actions.push({ id: 'down', label: 'Move right', icon: 'arrow-right', run: (p) => moveColumn(p, s, r, c, c + 1) });
  if (columns.length > 1) {
    actions.push({ id: 'delete', label: 'Delete', icon: 'trash', danger: true, run: (p) => removeColumn(p, s, r, c) });
  }
  return actions;
}

function blockActions(page: Page, s: number, r: number, c: number, b: number): ItemAction[] {
  const blocks = page.sections[s]?.rows[r]?.columns[c]?.blocks;
  if (!blocks?.[b]) return [];
  const last = blocks.length - 1;

  const actions: ItemAction[] = [
    EDIT,
    ADD,
    { id: 'duplicate', label: 'Duplicate', icon: 'copy', run: (p, reid) => duplicateBlock(p, s, r, c, b, reid) },
  ];
  if (b > 0) actions.push({ id: 'up', label: 'Move up', icon: 'arrow-up', run: (p) => moveBlockWithinColumn(p, s, r, c, b, b - 1) });
  if (b < last) actions.push({ id: 'down', label: 'Move down', icon: 'arrow-down', run: (p) => moveBlockWithinColumn(p, s, r, c, b, b + 1) });
  // A block can be the last one removed; the column falls back to its empty
  // state with the + in the middle.
  actions.push({ id: 'delete', label: 'Delete', icon: 'trash', danger: true, run: (p) => removeBlock(p, s, r, c, b) });
  return actions;
}
