/**
 * The collection loop's binding engine: fill one designed card with one item.
 *
 * THE SHAPE OF THE FEATURE (Elementor gap #1, 31 Aug 2026). Today a collection loop
 * pours its items into one fixed card. The loop we are building instead lets a client
 * design the card ONCE, with tokens where the item's data should go, and repeats that
 * design over the query. This module is the part that does the repeating: given a card
 * template (a small set of blocks) and one item, it returns a new set of blocks with
 * the tokens filled in. It is a pure function over the stored shape, no DOM and no
 * database, so the semantics are unit-tested here and the render and the editor only
 * have to call it.
 *
 * WHY TOKENS RATHER THAN A `bind` PROP PER BLOCK. A token in a string is the one
 * mechanism that reaches every place an item's data belongs without a special case per
 * block type: a heading's text is `{{title}}`, an image's source is `{{image}}`, a
 * button's link is `{{link}}` and its label `{{field:price}}`. The client (or a preset,
 * or the AI builder) writes the token; the loop substitutes it. Anything with no token
 * is a fixed part of the card, the same on every item, which is exactly what a label
 * like "From" or a decorative divider wants to be.
 *
 * ESCAPING IS BY CONTEXT. A token in the `html` prop is rich text, so the item's title
 * (plain text, possibly containing a `<` or an `&`) is HTML-escaped before it is put
 * there, or a place called "Marks & Spencer" would inject a stray entity. A token in
 * any other prop is a source, a link, a label or an alt: substituted raw and sanitised
 * downstream by the renderer's own safeUrl and esc, exactly like a value a client typed.
 *
 * INDEXABLE BY DESIGN. The output is ordinary blocks, so the render draws them on the
 * server into the client's own design. The tours become real pages' worth of markup a
 * crawler and an AI engine read, which is the whole point of the gap: our best data,
 * visible rather than hidden behind a script.
 */

import { formatFieldValue, type FieldDef } from './collection-fields';
import { hasInnerColumns } from './inner-columns';
import { escapeHtml } from './sanitise';
import type { Block } from './schema';

/**
 * The item a card is filled from: the fixed fields every collection item has, its
 * declared custom fields, and the href of its own page for `{{link}}`.
 */
export type LoopItem = {
  title?: string;
  summary?: string;
  image?: string;
  alt?: string;
  author?: string;
  date?: string;
  tags?: readonly string[];
  fields?: Record<string, string | number | boolean>;
  /** The item's own page, what `{{link}}` resolves to. */
  href: string;
};

/**
 * The props whose value is HTML (rich text). A token substituted into one of these is
 * escaped; everything else is a source, link, label or alt, substituted raw and left
 * for the renderer to sanitise like any typed value.
 */
const HTML_PROPS: ReadonlySet<string> = new Set(['html']);

/**
 * A token is `{{name}}` or `{{field:key}}`, letters and digits with an optional single
 * colon segment for a field key (which may carry hyphens and underscores). Kept tight
 * on purpose: an unrecognised token resolves to an empty string rather than being left
 * on the page, so a typo shows as a blank rather than as `{{titel}}` to a visitor.
 */
const TOKEN = /\{\{\s*([a-z][a-z0-9]*(?::[a-z0-9_-]+)?)\s*\}\}/gi;

/** Resolve one token name against the item. An unknown name, or a missing value, is ''. */
function resolveToken(name: string, item: LoopItem, defs: readonly FieldDef[]): string {
  const lower = name.toLowerCase();
  if (lower.startsWith('field:')) {
    const key = name.slice(name.indexOf(':') + 1);
    const def = defs.find((d) => d.key === key);
    return def ? formatFieldValue(def, item.fields?.[key]) : '';
  }
  switch (lower) {
    case 'title': return item.title ?? '';
    case 'summary': return item.summary ?? '';
    case 'author': return item.author ?? '';
    case 'date': return item.date ?? '';
    case 'tags': return (item.tags ?? []).join(', ');
    case 'image': return item.image ?? '';
    case 'alt': return item.alt ?? '';
    case 'link': return item.href;
    default: return '';
  }
}

/** Replace every token in a string, escaping the resolved value when the context is HTML. */
function bindString(value: string, item: LoopItem, defs: readonly FieldDef[], escape: boolean): string {
  if (value.indexOf('{{') === -1) return value;
  return value.replace(TOKEN, (_match, name: string) => {
    const resolved = resolveToken(name, item, defs);
    return escape ? escapeHtml(resolved) : resolved;
  });
}

/**
 * Bind one block to one item: substitute tokens in its string props, and recurse into
 * the inner columns of a container or a grid so a card can be more than a flat stack.
 * Returns a NEW block; the template is never mutated, the same guard the listing fill
 * already relies on so today's cards are not baked into tomorrow's page.
 */
export function bindBlock(block: Block, item: LoopItem, defs: readonly FieldDef[] = []): Block {
  const anyBlock = block as { type?: unknown; props?: Record<string, unknown> };
  const props = anyBlock.props ?? {};
  const bound: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === 'columns' && hasInnerColumns(anyBlock.type) && Array.isArray(value)) {
      bound[key] = value.map((column) => {
        const col = column as { blocks?: unknown };
        return Array.isArray(col.blocks)
          ? { ...col, blocks: col.blocks.map((b) => bindBlock(b as Block, item, defs)) }
          : column;
      });
    } else if (typeof value === 'string') {
      bound[key] = bindString(value, item, defs, HTML_PROPS.has(key));
    } else {
      bound[key] = value;
    }
  }

  return { ...(block as object), props: bound } as Block;
}

/** Fill a whole card template with one item, returning a new set of blocks. Pure. */
export function bindCardTemplate(
  template: readonly Block[],
  item: LoopItem,
  defs: readonly FieldDef[] = [],
): Block[] {
  return template.map((block) => bindBlock(block, item, defs));
}

/**
 * The designed card a loop repeats: the blocks of its FIRST inner column. A loop is
 * stored like a container with one column, so the client designs the card in the same
 * nested editor a container uses, and the render expands that one design over the items.
 */
export function loopCardTemplate(block: Block): Block[] {
  const columns = (block as { props?: { columns?: unknown } }).props?.columns;
  if (!Array.isArray(columns) || !columns[0] || typeof columns[0] !== 'object') return [];
  const first = (columns[0] as { blocks?: unknown }).blocks;
  return Array.isArray(first) ? (first as Block[]) : [];
}

/**
 * One expanded cell: the bound card for an item, the item's own page to link to,
 * and its title. The title is the accessible name for the whole-card link, which
 * is otherwise a rectangle a screen reader cannot announce (the card's own words
 * are in `blocks` and a covering anchor has no text of its own). See InnerLoop in
 * components/render/PageRenderer.tsx.
 */
export type LoopCell = { blocks: Block[]; href: string; label: string };

/**
 * Expand a loop block over its items: fill the one designed card once per item and
 * carry each item's link. Returns a NEW block whose `props.columns` are the per-item
 * cells, which the render lays out like a grid with each cell wrapped in its link.
 *
 * Pure, and it runs on a COPY of the tree at render time (see fillLoops), so the
 * stored block keeps its single template column and can be re-expanded on the next
 * request. The caller has already cut the items to the block's count.
 */
export function expandLoop(
  block: Block,
  items: readonly LoopItem[],
  defs: readonly FieldDef[] = [],
): Block {
  const template = loopCardTemplate(block);
  const props = (block as { props?: Record<string, unknown> }).props ?? {};
  const cells: LoopCell[] = items.map((item) => ({
    blocks: bindCardTemplate(template, item, defs),
    href: item.href,
    label: item.title ?? '',
  }));
  return { ...(block as object), props: { ...props, columns: cells } } as unknown as Block;
}
