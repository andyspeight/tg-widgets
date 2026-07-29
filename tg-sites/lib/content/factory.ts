/**
 * Factories for new nodes, plus id generation.
 *
 * Ids are prefixed by node kind so a log line or a failing test tells you
 * what you are looking at without cross referencing the tree.
 */

import {
  CONTENT_VERSION,
  MIN_COLUMN_WIDTH,
  normaliseWidths,
  type Block,
  type Column,
  type Page,
  type Row,
  type Section,
} from './schema';
import { blockDefinition, defaultPropsFor } from './blocks';
import { DEFAULT_LAYOUT, type Layout } from './layouts';

let counter = 0;

/**
 * Ids only need to be unique within one page tree, not globally, so a
 * counter plus a short random suffix is enough. Deliberately not
 * crypto.randomUUID: this runs in the editor on every keystroke-adjacent
 * action and the ids end up in JSON the client can read.
 */
export function newId(prefix: string): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${counter.toString(36)}${random}`;
}

export function createBlock(type: string): Block {
  return { id: newId('blk'), type, props: defaultPropsFor(type) };
}

export function createColumn(width: number, blocks: Block[] = []): Column {
  return {
    id: newId('col'),
    width: Math.max(MIN_COLUMN_WIDTH, width),
    align: 'top',
    blocks,
  };
}

/**
 * Create a row from a layout preset like '1-2'.
 *
 * Presets are a convenience for the "add row" menu, not a constraint. Once
 * the row exists the client can drag the widths to anything they like, which
 * is the behaviour Andy asked for. The preset just decides where they start.
 */
export function createRow(preset = '1'): Row {
  const parts = preset
    .split('-')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part > 0);

  const ratios = parts.length > 0 ? parts : [1];
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const widths = normaliseWidths(ratios.map((ratio) => (ratio / total) * 100));

  return {
    id: newId('row'),
    columns: widths.map((width) => createColumn(width)),
    gap: 'm',
    stackBelow: 'mobile',
    reverseOnStack: false,
  };
}

export function createSection(preset = '1'): Section {
  return {
    id: newId('sec'),
    tone: 'light',
    width: 'contained',
    paddingY: 'l',
    rows: [createRow(preset)],
  };
}

/**
 * Build a section from a picked layout.
 *
 * A layout is a list of rows, each a list of relative column widths, so this
 * is createRow per row with the ratios turned back into the preset string
 * createRow already understands.
 */
export function createSectionFromLayout(layout: Layout = DEFAULT_LAYOUT): Section {
  return {
    id: newId('sec'),
    tone: 'light',
    width: 'contained',
    paddingY: 'l',
    rows: layout.rows.map((ratios) => createRow(ratios.join('-'))),
  };
}

export function createPage(title = 'Untitled page', slug = ''): Page {
  return {
    version: CONTENT_VERSION,
    id: newId('pg'),
    title,
    slug,
    seo: { noindex: false },
    sections: [createSection('1')],
  };
}

/** The row layouts offered in the "add row" menu. */
export const ROW_PRESETS: ReadonlyArray<{ preset: string; label: string }> = [
  { preset: '1', label: 'Full width' },
  { preset: '1-1', label: 'Two equal' },
  { preset: '1-2', label: 'Narrow then wide' },
  { preset: '2-1', label: 'Wide then narrow' },
  { preset: '1-1-1', label: 'Three equal' },
  { preset: '1-1-1-1', label: 'Four equal' },
];

/** Label for a block, for the outline tree. Falls back for unknown types. */
export function blockLabel(block: Block): string {
  const definition = blockDefinition(block.type);
  if (!definition) return `Unknown (${block.type})`;
  return definition.summarise?.(block.props) || definition.label;
}
