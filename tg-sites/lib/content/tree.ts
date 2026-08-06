/**
 * Pure tree operations.
 *
 * Every function takes a page and returns a NEW page. Nothing mutates.
 * That is what makes undo and redo a stack of references rather than a
 * diffing problem, and it is why the editor can keep 50 steps cheaply.
 *
 * Selection is addressed by a path rather than an id, because the editor
 * needs to know a block's position (which column, which row) as often as
 * it needs the block itself.
 */

import {
  MAX_COLUMNS_PER_ROW,
  MIN_COLUMN_WIDTH,
  normaliseWidths,
  type Block,
  type Box,
  type Column,
  type Page,
  type Row,
  type Section,
} from './schema';
import { createColumn } from './factory';

/**
 * The drag-and-drop type for a block dragged off the Add-block picker onto the
 * canvas. A private MIME so a stray text or file drag can never be read as a
 * block, and shared here so the picker that writes it and the canvas that reads
 * it cannot drift apart.
 */
export const BLOCK_DRAG_MIME = 'application/x-tg-block';

/*
 * ONE LEVEL OF NESTING, added 5 Aug 2026 for the container element. A container
 * is a block that holds its own columns, each holding its own blocks. Those two
 * live below `block` in the address as `k` (the container's inner column) and
 * `i` (a block inside that column). Bounded on purpose: a container's inner
 * blocks are leaves, so there is no `k`/`i` after an `i`, and the picker will
 * not offer a container inside a container. That keeps the address a fixed
 * grammar rather than an unbounded recursion the whole editor would have to learn.
 */
export type Path =
  | { kind: 'page' }
  | { kind: 'section'; section: number }
  | { kind: 'row'; section: number; row: number }
  | { kind: 'column'; section: number; row: number; column: number }
  | { kind: 'block'; section: number; row: number; column: number; block: number }
  | { kind: 'inner-column'; section: number; row: number; column: number; block: number; inner: number }
  | {
      kind: 'inner-block';
      section: number;
      row: number;
      column: number;
      block: number;
      inner: number;
      innerBlock: number;
    };

export function pathKey(path: Path): string {
  switch (path.kind) {
    case 'page':
      return 'page';
    case 'section':
      return `s${path.section}`;
    case 'row':
      return `s${path.section}r${path.row}`;
    case 'column':
      return `s${path.section}r${path.row}c${path.column}`;
    case 'block':
      return `s${path.section}r${path.row}c${path.column}b${path.block}`;
    case 'inner-column':
      return `s${path.section}r${path.row}c${path.column}b${path.block}k${path.inner}`;
    case 'inner-block':
      return `s${path.section}r${path.row}c${path.column}b${path.block}k${path.inner}i${path.innerBlock}`;
  }
}

export function samePath(a: Path | null, b: Path | null): boolean {
  if (!a || !b) return a === b;
  return pathKey(a) === pathKey(b);
}

/**
 * Inverse of pathKey. The renderer writes these onto `data-path`, so this is
 * how a click in the canvas becomes a selection. Returns null for anything
 * that is not a key we wrote.
 */
export function parsePathKey(key: string | null | undefined): Path | null {
  if (!key) return null;
  if (key === 'page') return { kind: 'page' };

  const match = key.match(/^s(\d+)(?:r(\d+)(?:c(\d+)(?:b(\d+)(?:k(\d+)(?:i(\d+))?)?)?)?)?$/);
  if (!match) return null;

  const [, s, r, c, b, k, i] = match;
  const section = Number(s);

  if (r === undefined) return { kind: 'section', section };
  const row = Number(r);

  if (c === undefined) return { kind: 'row', section, row };
  const column = Number(c);

  if (b === undefined) return { kind: 'column', section, row, column };
  const block = Number(b);

  if (k === undefined) return { kind: 'block', section, row, column, block };
  const inner = Number(k);

  if (i === undefined) return { kind: 'inner-column', section, row, column, block, inner };
  return { kind: 'inner-block', section, row, column, block, inner, innerBlock: Number(i) };
}

/** Human label for a path kind, shown on the selection badge in the canvas. */
export function pathKindLabel(path: Path): string {
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
      return 'Block';
    case 'inner-column':
      return 'Column';
    case 'inner-block':
      return 'Block';
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getSection(page: Page, index: number): Section | null {
  return page.sections[index] ?? null;
}

export function getRow(page: Page, section: number, row: number): Row | null {
  return page.sections[section]?.rows[row] ?? null;
}

export function getColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
): Column | null {
  return page.sections[section]?.rows[row]?.columns[column] ?? null;
}

export function getBlock(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
): Block | null {
  return page.sections[section]?.rows[row]?.columns[column]?.blocks[block] ?? null;
}

/** Resolve a path to the node it points at, or null if the path is stale. */
export function resolve(page: Page, path: Path | null): unknown {
  if (!path) return null;
  switch (path.kind) {
    case 'page':
      return page;
    case 'section':
      return getSection(page, path.section);
    case 'row':
      return getRow(page, path.section, path.row);
    case 'column':
      return getColumn(page, path.section, path.row, path.column);
    case 'block':
      return getBlock(page, path.section, path.row, path.column, path.block);
    case 'inner-column': {
      const container = getBlock(page, path.section, path.row, path.column, path.block);
      return (container ? containerColumns(container)[path.inner] : null) ?? null;
    }
    case 'inner-block': {
      const container = getBlock(page, path.section, path.row, path.column, path.block);
      const inner = container ? containerColumns(container)[path.inner] : null;
      return inner?.blocks[path.innerBlock] ?? null;
    }
  }
}

// ---------------------------------------------------------------------------
// Structural edits
// ---------------------------------------------------------------------------

function replaceSections(page: Page, sections: Section[]): Page {
  return { ...page, sections };
}

function mapSection(page: Page, index: number, fn: (section: Section) => Section): Page {
  if (!page.sections[index]) return page;
  return replaceSections(
    page,
    page.sections.map((section, i) => (i === index ? fn(section) : section)),
  );
}

function mapRow(
  page: Page,
  section: number,
  row: number,
  fn: (row: Row) => Row,
): Page {
  return mapSection(page, section, (s) => {
    if (!s.rows[row]) return s;
    return { ...s, rows: s.rows.map((r, i) => (i === row ? fn(r) : r)) };
  });
}

function mapColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
  fn: (column: Column) => Column,
): Page {
  return mapRow(page, section, row, (r) => {
    if (!r.columns[column]) return r;
    return { ...r, columns: r.columns.map((c, i) => (i === column ? fn(c) : c)) };
  });
}

// --- sections ---

export function addSection(page: Page, section: Section, at?: number): Page {
  const index = at ?? page.sections.length;
  const sections = [...page.sections];
  sections.splice(clamp(index, 0, sections.length), 0, section);
  return replaceSections(page, sections);
}

export function removeSection(page: Page, index: number): Page {
  if (!page.sections[index]) return page;
  return replaceSections(
    page,
    page.sections.filter((_, i) => i !== index),
  );
}

export function moveSection(page: Page, from: number, to: number): Page {
  return replaceSections(page, moveInArray(page.sections, from, to));
}

export function updateSection(
  page: Page,
  index: number,
  patch: Partial<Section>,
): Page {
  return mapSection(page, index, (section) => ({ ...section, ...patch }));
}

export function duplicateSection(page: Page, index: number, reid: Reid): Page {
  const section = page.sections[index];
  if (!section) return page;
  return addSection(page, reidSection(section, reid), index + 1);
}

// --- rows ---

export function addRow(page: Page, section: number, row: Row, at?: number): Page {
  return mapSection(page, section, (s) => {
    const index = at ?? s.rows.length;
    const rows = [...s.rows];
    rows.splice(clamp(index, 0, rows.length), 0, row);
    return { ...s, rows };
  });
}

export function removeRow(page: Page, section: number, row: number): Page {
  return mapSection(page, section, (s) => ({
    ...s,
    rows: s.rows.filter((_, i) => i !== row),
  }));
}

export function moveRow(page: Page, section: number, from: number, to: number): Page {
  return mapSection(page, section, (s) => ({ ...s, rows: moveInArray(s.rows, from, to) }));
}

export function updateRow(
  page: Page,
  section: number,
  row: number,
  patch: Partial<Row>,
): Page {
  return mapRow(page, section, row, (r) => ({ ...r, ...patch }));
}

export function duplicateRow(
  page: Page,
  section: number,
  row: number,
  reid: Reid,
): Page {
  const existing = page.sections[section]?.rows[row];
  if (!existing) return page;
  return addRow(page, section, reidRow(existing, reid), row + 1);
}

// --- columns ---

/**
 * Add a column to a row, taking its width proportionally from the existing
 * columns so the row still sums to 100.
 */
export function addColumn(page: Page, section: number, row: number): Page {
  return mapRow(page, section, row, (r) => {
    if (r.columns.length >= 6) return r;
    const share = 100 / (r.columns.length + 1);
    const widths = normaliseWidths([
      ...r.columns.map((column) => column.width * (1 - share / 100)),
      share,
    ]);
    const columns = [...r.columns, createColumn(share)];
    return {
      ...r,
      columns: columns.map((column, index) => ({ ...column, width: widths[index] })),
    };
  });
}

/**
 * Remove a column. Its blocks are moved into the previous column (or the
 * next one, if it was first) rather than being silently deleted. Losing a
 * client's copy because they tidied a layout would be unforgivable.
 */
export function removeColumn(page: Page, section: number, row: number, column: number): Page {
  return mapRow(page, section, row, (r) => {
    if (r.columns.length <= 1) return r;
    const doomed = r.columns[column];
    if (!doomed) return r;

    const survivors = r.columns.filter((_, i) => i !== column);
    const rescueIndex = column === 0 ? 0 : column - 1;
    const rescued = survivors.map((c, i) =>
      i === rescueIndex ? { ...c, blocks: [...c.blocks, ...doomed.blocks] } : c,
    );

    const widths = normaliseWidths(rescued.map((c) => c.width));
    return {
      ...r,
      columns: rescued.map((c, i) => ({ ...c, width: widths[i] })),
    };
  });
}

/**
 * Move a column left or right within its row.
 *
 * THE WIDTH TRAVELS WITH IT. A 70/30 row whose wide column is moved right
 * becomes 30/70, not 70/30 with the contents swapped. Andy asked for this on
 * 31 Jul 2026, and the other reading is the one that surprises: moving a hero's
 * picture to the other side and having it come out a different width is not
 * "moved", it is "swapped with something else".
 *
 * No renormalising, because nothing about the total changed: the same widths in
 * a different order still sum to what they summed to before.
 */
export function moveColumn(
  page: Page,
  section: number,
  row: number,
  from: number,
  to: number,
): Page {
  return mapRow(page, section, row, (r) => {
    if (to < 0 || to >= r.columns.length) return r;
    return { ...r, columns: moveInArray(r.columns, from, to) };
  });
}

export function updateColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
  patch: Partial<Column>,
): Page {
  return mapColumn(page, section, row, column, (c) => ({ ...c, ...patch }));
}

/**
 * Resize the boundary between column `index` and the one after it.
 *
 * This is what the drag handle calls. Only the two adjacent columns change,
 * which is what makes a drag feel predictable: everything else stays put.
 * Both sides are clamped to MIN_COLUMN_WIDTH so a drag can never collapse a
 * column to nothing.
 */
export function resizeColumnBoundary(
  page: Page,
  section: number,
  row: number,
  index: number,
  deltaPercent: number,
): Page {
  return mapRow(page, section, row, (r) => ({ ...r, columns: resizeColumns(r.columns, index, deltaPercent) }));
}

/**
 * Move the boundary between columns `index` and `index+1`, clamped and
 * renormalised. Pure on a Column[], so a row and a container's inner columns
 * share the one piece of arithmetic rather than two copies that drift.
 */
function resizeColumns(columns: Column[], index: number, deltaPercent: number): Column[] {
  const left = columns[index];
  const right = columns[index + 1];
  if (!left || !right) return columns;

  const pair = left.width + right.width;
  const nextLeft = clamp(left.width + deltaPercent, MIN_COLUMN_WIDTH, pair - MIN_COLUMN_WIDTH);
  const nextRight = pair - nextLeft;

  const next = columns.map((column, i) => {
    if (i === index) return { ...column, width: round2(nextLeft) };
    if (i === index + 1) return { ...column, width: round2(nextRight) };
    return column;
  });

  const widths = normaliseWidths(next.map((column) => column.width));
  return next.map((c, i) => ({ ...c, width: widths[i] }));
}

/** Reset a row to equal column widths. */
export function evenColumns(page: Page, section: number, row: number): Page {
  return mapRow(page, section, row, (r) => {
    const widths = normaliseWidths(r.columns.map(() => 1));
    return { ...r, columns: r.columns.map((c, i) => ({ ...c, width: widths[i] })) };
  });
}

// --- blocks ---

export function addBlock(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: Block,
  at?: number,
): Page {
  return mapColumn(page, section, row, column, (c) => {
    const index = at ?? c.blocks.length;
    const blocks = [...c.blocks];
    blocks.splice(clamp(index, 0, blocks.length), 0, block);
    return { ...c, blocks };
  });
}

export function removeBlock(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
): Page {
  return mapColumn(page, section, row, column, (c) => ({
    ...c,
    blocks: c.blocks.filter((_, i) => i !== block),
  }));
}

export function updateBlockProps(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  patch: Record<string, unknown>,
): Page {
  return mapColumn(page, section, row, column, (c) => ({
    ...c,
    blocks: c.blocks.map((b, i) =>
      i === block ? { ...b, props: { ...b.props, ...patch } } : b,
    ),
  }));
}

/** Replace a block's design box. The box is a sibling of props, not a prop. */
export function updateBlockBox(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  box: Box,
): Page {
  return mapColumn(page, section, row, column, (c) => ({
    ...c,
    blocks: c.blocks.map((b, i) => (i === block ? { ...b, box } : b)),
  }));
}

// ---------------------------------------------------------------------------
// The container element: a block that holds its own columns, one level deep.
// Its columns are ordinary Columns kept in props.columns, so they carry the same
// widths, boxes and validation as a section's columns. These helpers reach into
// that inner tree; everything else in this file stays flat.
// ---------------------------------------------------------------------------

/** A container's own columns, or an empty list for anything that is not one. */
export function containerColumns(block: Block): Column[] {
  const columns = (block.props as { columns?: unknown }).columns;
  return Array.isArray(columns) ? (columns as Column[]) : [];
}

/** Map the columns of one container block, writing them back into its props. */
function mapContainerColumns(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  fn: (columns: Column[]) => Column[],
): Page {
  return mapColumn(page, section, row, column, (c) => ({
    ...c,
    blocks: c.blocks.map((b, i) =>
      i === block ? { ...b, props: { ...b.props, columns: fn(containerColumns(b)) } } : b,
    ),
  }));
}

/** Map the blocks of one inner column within a container. */
function mapInnerColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  inner: number,
  fn: (blocks: Block[]) => Block[],
): Page {
  return mapContainerColumns(page, section, row, column, block, (columns) =>
    columns.map((col, index) => (index === inner ? { ...col, blocks: fn(col.blocks) } : col)),
  );
}

/** Replace a container's whole set of columns (used by width resize and add/remove). */
export function updateContainerColumns(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  columns: Column[],
): Page {
  return mapContainerColumns(page, section, row, column, block, () => columns);
}

/** Add a block into one of a container's inner columns, at `at` or the end. */
export function addInnerBlock(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  inner: number,
  newBlock: Block,
  at?: number,
): Page {
  return mapInnerColumn(page, section, row, column, block, inner, (blocks) => {
    const index = at ?? blocks.length;
    const next = [...blocks];
    next.splice(clamp(index, 0, next.length), 0, newBlock);
    return next;
  });
}

/** Remove a block from a container's inner column. */
export function removeInnerBlock(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  inner: number,
  innerBlock: number,
): Page {
  return mapInnerColumn(page, section, row, column, block, inner, (blocks) =>
    blocks.filter((_, i) => i !== innerBlock),
  );
}

/** Patch the props of a block inside a container's inner column. */
export function updateInnerBlockProps(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  inner: number,
  innerBlock: number,
  patch: Record<string, unknown>,
): Page {
  return mapInnerColumn(page, section, row, column, block, inner, (blocks) =>
    blocks.map((b, i) => (i === innerBlock ? { ...b, props: { ...b.props, ...patch } } : b)),
  );
}

/** Replace the design box of a block inside a container's inner column. */
export function updateInnerBlockBox(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  inner: number,
  innerBlock: number,
  box: Box,
): Page {
  return mapInnerColumn(page, section, row, column, block, inner, (blocks) =>
    blocks.map((b, i) => (i === innerBlock ? { ...b, box } : b)),
  );
}

/** Patch one inner column of a container (its align, flow or box, not its blocks). */
export function updateInnerColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  inner: number,
  patch: Partial<Column>,
): Page {
  return mapContainerColumns(page, section, row, column, block, (columns) =>
    columns.map((col, i) => (i === inner ? { ...col, ...patch } : col)),
  );
}

/**
 * Resize the boundary between a container's inner columns `index` and `index+1`.
 * The inner twin of resizeColumnBoundary, sharing its arithmetic.
 */
export function resizeInnerColumnBoundary(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  index: number,
  deltaPercent: number,
): Page {
  return mapContainerColumns(page, section, row, column, block, (columns) =>
    resizeColumns(columns, index, deltaPercent),
  );
}

/** Add a column to a container, taking its width proportionally from the rest. */
export function addInnerColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
): Page {
  return mapContainerColumns(page, section, row, column, block, (columns) => {
    if (columns.length >= MAX_COLUMNS_PER_ROW) return columns;
    const share = 100 / (columns.length + 1);
    const widths = normaliseWidths([
      ...columns.map((col) => col.width * (1 - share / 100)),
      share,
    ]);
    const next = [...columns, createColumn(share)];
    return next.map((col, index) => ({ ...col, width: widths[index] }));
  });
}

/**
 * Remove a container's inner column, moving its blocks into the neighbour rather
 * than dropping them, the same rescue removeColumn does for a section column.
 */
export function removeInnerColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  inner: number,
): Page {
  return mapContainerColumns(page, section, row, column, block, (columns) => {
    if (columns.length <= 1) return columns;
    const doomed = columns[inner];
    if (!doomed) return columns;

    const survivors = columns.filter((_, i) => i !== inner);
    const rescueIndex = inner === 0 ? 0 : inner - 1;
    const rescued = survivors.map((col, i) =>
      i === rescueIndex ? { ...col, blocks: [...col.blocks, ...doomed.blocks] } : col,
    );

    const widths = normaliseWidths(rescued.map((col) => col.width));
    return rescued.map((col, i) => ({ ...col, width: widths[i] }));
  });
}

/** Move a container's inner column, its width travelling with it (as moveColumn does). */
export function moveInnerColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  from: number,
  to: number,
): Page {
  return mapContainerColumns(page, section, row, column, block, (columns) => {
    if (to < 0 || to >= columns.length) return columns;
    return moveInArray(columns, from, to);
  });
}

/** Reset a container's inner columns to equal widths. */
export function evenInnerColumns(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
): Page {
  return mapContainerColumns(page, section, row, column, block, (columns) => {
    const widths = normaliseWidths(columns.map(() => 1));
    return columns.map((col, i) => ({ ...col, width: widths[i] }));
  });
}

/** Reorder a block within one inner column. */
export function moveInnerBlockWithinColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  inner: number,
  from: number,
  to: number,
): Page {
  return mapInnerColumn(page, section, row, column, block, inner, (blocks) =>
    moveInArray(blocks, from, to),
  );
}

/** Copy an inner block, landing the copy immediately after the original. */
export function duplicateInnerBlock(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  inner: number,
  innerBlock: number,
  reid: Reid,
): Page {
  return mapInnerColumn(page, section, row, column, block, inner, (blocks) => {
    const existing = blocks[innerBlock];
    if (!existing) return blocks;
    const next = [...blocks];
    next.splice(innerBlock + 1, 0, reidBlock(existing, reid));
    return next;
  });
}

// ---------------------------------------------------------------------------
// Block-or-inner-block, addressed by path. The editor's inline editing and its
// text toolbar act on "the selected block" without caring whether it sits in an
// ordinary column or a container's inner one, so these dispatch on the path kind
// and keep that branch out of the components.
// ---------------------------------------------------------------------------

type AnyBlockPath = Extract<Path, { kind: 'block' | 'inner-block' }>;

/** The block a block-or-inner-block path points at, or null if stale. */
export function blockAtPath(page: Page, path: AnyBlockPath): Block | null {
  if (path.kind === 'block') {
    return getBlock(page, path.section, path.row, path.column, path.block);
  }
  const container = getBlock(page, path.section, path.row, path.column, path.block);
  const col = container ? containerColumns(container)[path.inner] : null;
  return col?.blocks[path.innerBlock] ?? null;
}

/** Patch the props of whichever block a block-or-inner-block path points at. */
export function updateBlockPropsAtPath(
  page: Page,
  path: AnyBlockPath,
  patch: Record<string, unknown>,
): Page {
  if (path.kind === 'block') {
    return updateBlockProps(page, path.section, path.row, path.column, path.block, patch);
  }
  return updateInnerBlockProps(
    page, path.section, path.row, path.column, path.block, path.inner, path.innerBlock, patch,
  );
}

/** Replace the design box of whichever block a block-or-inner-block path points at. */
export function updateBlockBoxAtPath(page: Page, path: AnyBlockPath, box: Box): Page {
  if (path.kind === 'block') {
    return updateBlockBox(page, path.section, path.row, path.column, path.block, box);
  }
  return updateInnerBlockBox(
    page, path.section, path.row, path.column, path.block, path.inner, path.innerBlock, box,
  );
}

export function moveBlockWithinColumn(
  page: Page,
  section: number,
  row: number,
  column: number,
  from: number,
  to: number,
): Page {
  return mapColumn(page, section, row, column, (c) => ({
    ...c,
    blocks: moveInArray(c.blocks, from, to),
  }));
}

/** Move a block to a different column, possibly in a different row or section. */
export function moveBlockTo(
  page: Page,
  from: { section: number; row: number; column: number; block: number },
  to: { section: number; row: number; column: number; index?: number },
): Page {
  const block = getBlock(page, from.section, from.row, from.column, from.block);
  if (!block) return page;

  const sameColumn =
    from.section === to.section && from.row === to.row && from.column === to.column;

  if (sameColumn) {
    const target = to.index ?? Number.MAX_SAFE_INTEGER;
    // Removing first shifts anything after it down by one.
    const adjusted = target > from.block ? target - 1 : target;
    return moveBlockWithinColumn(page, from.section, from.row, from.column, from.block, adjusted);
  }

  const without = removeBlock(page, from.section, from.row, from.column, from.block);
  return addBlock(without, to.section, to.row, to.column, block, to.index);
}

export function duplicateBlock(
  page: Page,
  section: number,
  row: number,
  column: number,
  block: number,
  reid: Reid,
): Page {
  const existing = getBlock(page, section, row, column, block);
  if (!existing) return page;
  return addBlock(page, section, row, column, reidBlock(existing, reid), block + 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Id minting is injected rather than imported so tree operations stay pure
 * and testable. The editor passes newId; tests pass a counter.
 */
export type Reid = (prefix: string) => string;

function reidSection(section: Section, reid: Reid): Section {
  return {
    ...section,
    id: reid('sec'),
    rows: section.rows.map((row) => reidRow(row, reid)),
  };
}

function reidRow(row: Row, reid: Reid): Row {
  return {
    ...row,
    id: reid('row'),
    columns: row.columns.map((column) => ({
      ...column,
      id: reid('col'),
      blocks: column.blocks.map((block) => reidBlock(block, reid)),
    })),
  };
}

/**
 * A fresh copy of a block with a new id, deep enough for a container.
 *
 * An ordinary block only needs its own id changed and a shallow props copy, the
 * same as the outline's copy always did. A CONTAINER also holds its own columns
 * and their blocks in props.columns, and each of those carries an id too: left
 * shared, a duplicated container and its original would point React at two
 * copies of the same inner ids. So the container's inner columns and their
 * blocks are reid'd as well. Inner blocks are leaves (no container inside a
 * container), so one level down is the whole of it.
 */
function reidBlock(block: Block, reid: Reid): Block {
  const base: Block = { ...block, id: reid('blk'), props: { ...block.props } };
  const columns = containerColumns(block);
  if (columns.length === 0) return base;

  return {
    ...base,
    props: {
      ...base.props,
      columns: columns.map((column) => ({
        ...column,
        id: reid('col'),
        blocks: column.blocks.map((inner) => ({
          ...inner,
          id: reid('blk'),
          props: { ...inner.props },
        })),
      })),
    },
  };
}

function moveInArray<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(clamp(to, 0, next.length), 0, moved);
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
