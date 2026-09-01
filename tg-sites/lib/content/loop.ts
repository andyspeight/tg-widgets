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

// ---------------------------------------------------------------------------
// The token catalogue: what the editor's inserter offers, kept beside resolveToken
// ---------------------------------------------------------------------------

/**
 * What a token stands for, which decides where it belongs.
 *
 * A `picture` token is a source and belongs in an image's `src`; a `link` token is
 * an address and belongs in a button's or an image's `href`; a `text` token is words
 * and belongs in a heading, a paragraph, a label or an alt. The inserter uses this to
 * offer the right tokens for the field a client is filling, rather than every token
 * everywhere, which is how {{image}} would end up in a heading.
 */
export type LoopTokenKind = 'text' | 'picture' | 'link';

/** One offer in the inserter: the token to write, a human label, and what it stands for. */
export interface LoopToken {
  /** The name inside the braces, e.g. `title` or `field:price`. */
  name: string;
  /** What the inserter shows a client. */
  label: string;
  kind: LoopTokenKind;
}

/**
 * The fixed tokens every collection item has, in the order the inserter shows them.
 *
 * THE SAME SET resolveToken ABOVE ANSWERS. The two are pinned together by a test, so
 * a token offered here always resolves and a token resolved there is always offered:
 * the failure this guards is an inserter that writes `{{byline}}` onto a card that
 * then renders blank because the resolver never learned that name.
 */
export const LOOP_FIXED_TOKENS: readonly LoopToken[] = [
  { name: 'title', label: 'Title', kind: 'text' },
  { name: 'summary', label: 'Summary', kind: 'text' },
  { name: 'author', label: 'Author', kind: 'text' },
  { name: 'date', label: 'Date', kind: 'text' },
  { name: 'tags', label: 'Tags', kind: 'text' },
  { name: 'image', label: 'Picture', kind: 'picture' },
  { name: 'alt', label: 'Picture description', kind: 'text' },
  { name: 'link', label: 'Link to the entry', kind: 'link' },
];

/** The names of the fixed tokens, for the test that pins the catalogue to the resolver. */
export const LOOP_FIXED_TOKEN_NAMES: readonly string[] = LOOP_FIXED_TOKENS.map((token) => token.name);

/**
 * A collection's declared fields as tokens: `field:key`, one per definition.
 *
 * An image field becomes a `picture` token (it holds a second picture, a map or a
 * deck plan) so the inserter offers it for an image source; everything else is words.
 * A longtext field is included: it is words a card can carry, even if it is not a
 * facts-line fact. See fieldFacts, which drops longtext from the facts row for a
 * different reason (length), not from the tokens.
 */
export function fieldTokens(defs: readonly FieldDef[]): LoopToken[] {
  return defs.map((def) => ({
    name: `field:${def.key}`,
    label: def.label,
    kind: def.kind === 'image' ? 'picture' : 'text',
  }));
}

/** Every token the inserter can offer for a collection: the fixed set then its fields. */
export function loopTokens(defs: readonly FieldDef[] = []): LoopToken[] {
  return [...LOOP_FIXED_TOKENS, ...fieldTokens(defs)];
}

/** Wrap a token name in its braces, the exact form the binding engine reads. */
export function tokenText(name: string): string {
  return `{{${name}}}`;
}

/**
 * Where a token can go in one block: a prop that accepts data, and which KINDS of
 * token belong in it.
 *
 * A block has one or two such slots. A heading takes words in its `html`; an image
 * takes a picture in its `src` and words in its `alt`; a button takes a link in its
 * `href` and words in its `label`. The inserter draws one group per target and offers
 * only the tokens whose kind fits, so a client never drops `{{image}}` into a heading
 * or `{{title}}` into an image source.
 */
export interface LoopTokenTarget {
  /** The prop the token is written into. */
  prop: string;
  /** What the group is called in the inserter. */
  label: string;
  /** Which token kinds this prop accepts. */
  kinds: readonly LoopTokenKind[];
  /** True when the prop holds HTML (a token there is escaped): the inserter APPENDS
   *  rather than replaces, since rich text is usually a token amongst fixed words. */
  html?: boolean;
}

/**
 * Which props of a block accept tokens, by block type.
 *
 * Covers the block types a designed card is actually built from. A type not listed
 * takes no tokens (the inserter shows nothing for it), which is the safe default: a
 * divider or a spacer has no data to bind, and a block we have not thought about
 * should not be handed a half-working control.
 */
const LOOP_TARGETS: Record<string, readonly LoopTokenTarget[]> = {
  heading: [{ prop: 'html', label: 'Heading', kinds: ['text'], html: true }],
  text: [{ prop: 'html', label: 'Text', kinds: ['text'], html: true }],
  image: [
    { prop: 'src', label: 'Picture', kinds: ['picture'] },
    { prop: 'alt', label: 'Picture description', kinds: ['text'] },
  ],
  button: [
    { prop: 'href', label: 'Link', kinds: ['link'] },
    { prop: 'label', label: 'Button label', kinds: ['text'] },
  ],
};

/** The token slots a block type offers, or none for a block that binds no data. */
export function loopTargetsFor(blockType: string): readonly LoopTokenTarget[] {
  return LOOP_TARGETS[blockType] ?? [];
}

/** Can this block type carry any token at all? What the inserter's presence keys off. */
export function blockTakesTokens(blockType: string): boolean {
  return loopTargetsFor(blockType).length > 0;
}
