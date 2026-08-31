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
  DEFAULT_SECTION_PADDING,
  DEFAULT_GAP,
  EMPTY_BOX,
} from './schema';
import { blockDefinition, defaultPropsFor } from './blocks';
import { hasInnerColumns } from './inner-columns';
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
  const block: Block = { id: newId('blk'), type, props: defaultPropsFor(type), box: EMPTY_BOX };
  /*
   * A CONTAINER STARTS WITH TWO EQUAL COLUMNS, minted here rather than in the
   * registry defaults. Every other block's defaults are plain JSON the registry
   * can clone, but a container's columns each carry an id, and an id baked into
   * the defaults would be the same on every container ever added. So the two are
   * built fresh, the same way createRow builds a row's columns.
   */
  if (hasInnerColumns(type)) {
    /*
     * A LOOP STARTS WITH ONE COLUMN HOLDING A DESIGNED CARD, not the even split a
     * container or grid gets. The loop repeats this ONE card over a collection
     * (lib/content/loop.ts), so a second column would be a second card design with
     * no meaning. It is seeded with a card that already carries the tokens a listing
     * wants, so a freshly added loop shows a real card the moment a collection is
     * named, and the client shapes it from there rather than from an empty box.
     */
    if (type === 'loop') {
      block.props = { ...block.props, columns: [createColumn(100, starterLoopCard())] };
      return block;
    }

    /*
     * A GRID STARTS WITH THREE CELLS, a container with two columns. Both are
     * minted here rather than in the registry defaults, because each carries an
     * id and an id baked into the defaults would be the same on every one ever
     * added. The width is what a container resizes and a grid ignores: a grid's
     * tracks come from its `across` count, so its cells are even by definition.
     */
    const cells = type === 'grid' ? 3 : 2;
    block.props = {
      ...block.props,
      columns: Array.from({ length: cells }, () => createColumn(100 / cells)),
    };
  }
  return block;
}

/**
 * The card a new loop starts with: a picture, a title, a line of summary and a
 * link, each bound to the item it will repeat over through a token. Built from
 * real blocks (so they carry valid default props and fresh ids) with the token
 * written into the one prop that holds the item's data. See lib/content/loop.ts
 * for what each token resolves to.
 *
 * The link is the CARD'S OWN, not a whole-card overlay: a plain button bound to
 * `{{link}}`. The whole card is clickable too (the render lays a covering anchor
 * over it), and a button here gives a client a visible, editable call to action
 * to keep or remove. It sits last so it lands at the foot of every card in a row.
 */
function starterLoopCard(): Block[] {
  const withProps = (type: string, extra: Record<string, unknown>): Block => {
    const block = createBlock(type);
    block.props = { ...block.props, ...extra };
    return block;
  };
  return [
    withProps('image', { src: '{{image}}', alt: '{{alt}}', ratio: '4/3' }),
    withProps('heading', { html: '{{title}}', level: 'h3', style: 'h3', fluid: false }),
    withProps('text', { html: '<p>{{summary}}</p>' }),
    withProps('button', { label: 'Read more', href: '{{link}}', variant: 'ghost' }),
  ];
}

export function createColumn(width: number, blocks: Block[] = []): Column {
  return {
    id: newId('col'),
    width: Math.max(MIN_COLUMN_WIDTH, width),
    align: 'top',
    flow: 'stacked' as const,
    box: { ...EMPTY_BOX },
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
    gap: DEFAULT_GAP,
    stackBelow: 'mobile',
    reverseOnStack: false,
  };
}

export function createSection(preset = '1'): Section {
  return {
    id: newId('sec'),
    tone: 'light',
    width: 'contained',
    paddingY: DEFAULT_SECTION_PADDING,
    minHeight: 0,
    // The scrim strength over a background. 60 is what it was fixed at.
    overlay: 60,
    box: { ...EMPTY_BOX },
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
    paddingY: DEFAULT_SECTION_PADDING,
    minHeight: 0,
    // The scrim strength over a background. 60 is what it was fixed at.
    overlay: 60,
    box: { ...EMPTY_BOX },
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
