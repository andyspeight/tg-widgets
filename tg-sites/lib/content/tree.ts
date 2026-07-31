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
  MIN_COLUMN_WIDTH,
  normaliseWidths,
  type Block,
  type Column,
  type Page,
  type Row,
  type Section,
} from './schema';
import { createColumn } from './factory';

export type Path =
  | { kind: 'page' }
  | { kind: 'section'; section: number }
  | { kind: 'row'; section: number; row: number }
  | { kind: 'column'; section: number; row: number; column: number }
  | { kind: 'block'; section: number; row: number; column: number; block: number };

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

  const match = key.match(/^s(\d+)(?:r(\d+)(?:c(\d+)(?:b(\d+))?)?)?$/);
  if (!match) return null;

  const [, s, r, c, b] = match;
  const section = Number(s);

  if (r === undefined) return { kind: 'section', section };
  const row = Number(r);

  if (c === undefined) return { kind: 'row', section, row };
  const column = Number(c);

  if (b === undefined) return { kind: 'column', section, row, column };
  return { kind: 'block', section, row, column, block: Number(b) };
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
  return mapRow(page, section, row, (r) => {
    const left = r.columns[index];
    const right = r.columns[index + 1];
    if (!left || !right) return r;

    const pair = left.width + right.width;
    const nextLeft = clamp(left.width + deltaPercent, MIN_COLUMN_WIDTH, pair - MIN_COLUMN_WIDTH);
    const nextRight = pair - nextLeft;

    const columns = r.columns.map((column, i) => {
      if (i === index) return { ...column, width: round2(nextLeft) };
      if (i === index + 1) return { ...column, width: round2(nextRight) };
      return column;
    });

    const widths = normaliseWidths(columns.map((column) => column.width));
    return { ...r, columns: columns.map((c, i) => ({ ...c, width: widths[i] })) };
  });
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
  return addBlock(
    page,
    section,
    row,
    column,
    { ...existing, id: reid('blk'), props: { ...existing.props } },
    block + 1,
  );
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
      blocks: column.blocks.map((block) => ({
        ...block,
        id: reid('blk'),
        props: { ...block.props },
      })),
    })),
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
