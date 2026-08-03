/**
 * Rebuilding an imported design as native blocks.
 *
 * WHAT THIS IS FOR. An imported section keeps the source's exact look but is a
 * sealed lump of markup: a client can fill in its words and its pictures, and
 * nothing else. This turns that lump into ordinary blocks, a heading, a
 * paragraph, an image, a button, an icon-and-text, so every tool the editor has
 * reaches it: inline typing, the toolbar, colours, sizes, adding and removing.
 * The trade is deliberate and was Andy's call on 3 Aug 2026: rebuilt, a section
 * takes on the site's own theme rather than the captured pixels. Both paths
 * exist, the frozen import and this, and the rebuild is one undo away.
 *
 * DETERMINISTIC, NOT A MODEL. The Slicer's own emit is local "so it can't time
 * out, truncate or drift from the source", and the same reasoning holds here:
 * the content a client sliced is preserved exactly, the words are theirs and are
 * never rewritten, and the same paste always rebuilds the same way. All this
 * does is decide which native block each piece becomes and how they group.
 *
 * IT PRODUCES A MODEL, NOT A SECTION. The output is the same shape the AI
 * builder returns, so lib/ai/section-build.ts's sectionFromModel does the rest:
 * it validates against the schema, squares the column widths, fills the defaults
 * and runs every value through the sanitiser. What comes out the far side is a
 * Section as valid as one built by hand, which is the whole point, that it can
 * be edited the instant it lands.
 *
 * WHERE IT RUNS. On the server, because parse5 has no business in the editor's
 * browser bundle, exactly as the rest of lib/import already is.
 */

import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

import { importContent, importFields } from '../content/imported';
import { isIconName, searchIcons } from '../content/icons';
import type { ImportField } from './tokenise';
import { escapeText } from './html';

type ChildNode = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];

/** A block as sectionFromModel wants it: a type and a bag of props. */
interface ModelBlock {
  type: string;
  props: Record<string, unknown>;
}

/** The shape sectionFromModel accepts. Widths are worked out for us. */
export interface RebuildModel {
  name?: string;
  rows: { columns: { blocks: ModelBlock[] }[] }[];
}

/** The slot marker lib/import/tokenise.ts leaves behind. */
const TOKEN = /\{\{tg:([a-z]\d{1,3})\}\}/g;

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Tags whose text belongs in the run of words around them, not a block each. */
const INLINE = new Set([
  'a', 'abbr', 'b', 'br', 'cite', 'code', 'em', 'i', 'label', 'mark', 'small',
  'span', 'strong', 'sub', 'sup', 'time', 'u',
]);

/** Tags we never read: they are drawing or noise, not content. */
const IGNORE = new Set(['svg', 'style', 'script', 'template', 'noscript', 'path', 'use']);

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

function tagOf(node: Element): string {
  return node.tagName.toLowerCase();
}

function elementChildren(node: { childNodes?: ChildNode[] }): Element[] {
  return ((node.childNodes ?? []) as ChildNode[]).filter(isElement);
}

function childNodes(node: Element): ChildNode[] {
  return (node.childNodes ?? []) as ChildNode[];
}

function attr(node: Element, name: string): string | undefined {
  return (node.attrs ?? []).find((a) => a.name === name)?.value;
}

/** Whether there is anything a visitor would read inside this node. */
function hasWords(node: ChildNode): boolean {
  if (node.nodeName === '#text') return /[A-Za-z0-9]/.test((node as { value?: string }).value ?? '');
  if (!isElement(node)) return false;
  if (tagOf(node) === 'img') return true;
  return childNodes(node).some(hasWords);
}

// ---------------------------------------------------------------------------
// Content, with the client's edits put back
// ---------------------------------------------------------------------------

/** A reader that turns a slot key into the client's word for it, or the design's. */
function makeResolver(fields: readonly ImportField[], stored: Record<string, string>) {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return (raw: string): string =>
    raw.replace(TOKEN, (_whole, key: string) => stored[key] ?? byKey.get(key)?.value ?? '');
}

/** The visible text of an element, slots resolved, inline structure flattened. */
function textOf(node: ChildNode, resolve: (raw: string) => string): string {
  if (node.nodeName === '#text') return resolve((node as { value?: string }).value ?? '');
  if (!isElement(node)) return '';
  if (IGNORE.has(tagOf(node))) return '';
  return childNodes(node).map((child) => textOf(child, resolve)).join('');
}

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

/** A heading keeps its size but never the h1: the page title owns that. */
function headingBlock(el: Element, resolve: (raw: string) => string): ModelBlock | null {
  const words = tidy(textOf(el, resolve));
  if (!words) return null;
  const tag = tagOf(el);
  const level = tag === 'h2' || tag === 'h3' ? tag : tag === 'h4' ? 'h4' : tag === 'h1' ? 'h2' : 'h4';
  const style = HEADINGS.has(tag) ? tag : 'h3';
  return { type: 'heading', props: { html: escapeText(words), level, style } };
}

function textBlock(words: string): ModelBlock | null {
  const clean = tidy(words);
  if (!clean) return null;
  return { type: 'text', props: { html: `<p>${escapeText(clean)}</p>` } };
}

function listBlock(el: Element, resolve: (raw: string) => string): ModelBlock | null {
  const items = elementChildren(el)
    .filter((li) => tagOf(li) === 'li')
    .map((li) => ({ text: tidy(textOf(li, resolve)) }))
    .filter((item) => item.text)
    .slice(0, 20);
  if (!items.length) return null;
  return { type: 'list', props: { style: tagOf(el) === 'ol' ? 'number' : 'bullet', items } };
}

function imageBlock(el: Element, resolve: (raw: string) => string): ModelBlock | null {
  const src = resolve(attr(el, 'src') ?? '').trim();
  if (!src) return null;
  return { type: 'image', props: { src, alt: tidy(resolve(attr(el, 'alt') ?? '')) } };
}

function buttonBlock(el: Element, resolve: (raw: string) => string): ModelBlock | null {
  const label = tidy(textOf(el, resolve));
  if (!label) return null;
  return {
    type: 'button',
    props: { label: label.slice(0, 60), href: resolve(attr(el, 'href') ?? '').trim(), variant: 'primary' },
  };
}

/**
 * Whether an <a> is a button rather than a link in a sentence.
 *
 * On the class or the role, not on a guess about where it sits. A design that
 * styled something as a button said so in its class, and reading that is exact
 * where "a short link on its own" is a heuristic that turns real links into
 * buttons. A link we do not promote stays part of the text around it, which is
 * where a link in a sentence belongs.
 */
function isButtonLike(el: Element): boolean {
  if (attr(el, 'role') === 'button') return true;
  const cls = (attr(el, 'class') ?? '').toLowerCase();
  return /(^|[\s_-])(btn|button|cta)([\s_-]|$)/.test(cls) || /\bbutton\b/.test(cls);
}

// ---------------------------------------------------------------------------
// Icons, for a feature card
// ---------------------------------------------------------------------------

/** Common trust and travel words, pointed at an icon the set actually has. */
const ICON_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/protect|secure|safe|atol|abta|cover|guarantee|guaranteed|trust/, 'shield-check'],
  [/\bpay\b|payment|deposit|price|pricing|cost|money|wallet|\bfee\b|value|cheap|save|saving/, 'wallet'],
  [/support|help|assist|service|advice|advis|\b24\b|always on|call/, 'life-buoy'],
  [/love|million|people|customer|happy|review|rated|rating|star/, 'heart'],
  [/flex|easy|simple|manage|change|amend/, 'calendar-check'],
  [/best|promise|beat|match|deal|offer/, 'badge-check'],
  [/flight|\bfly\b|plane|airport|air /, 'plane'],
  [/hotel|stay|room|resort|accommodation/, 'bed-double'],
  [/expert|knowledge|\bknow\b|experience/, 'graduation-cap'],
  [/\btime\b|fast|quick|instant|speed/, 'clock'],
];

/** A card's icon, chosen from its title. Falls back to a safe default. */
function guessIcon(title: string): string {
  const t = title.toLowerCase();
  for (const [pattern, name] of ICON_HINTS) {
    if (pattern.test(t) && isIconName(name)) return name;
  }
  const first = t.split(/[^a-z]+/).find(Boolean);
  const hit = first ? searchIcons(first, 1)[0] : undefined;
  return hit && isIconName(hit) ? hit : 'sparkles';
}

/** The first inline icon in a card: an <svg>, or a glyph element by its class. */
function hasIcon(el: Element): boolean {
  for (const child of elementChildren(el)) {
    const tag = tagOf(child);
    if (tag === 'svg') return true;
    if ((tag === 'i' || tag === 'span') && /icon|fa-|material/i.test(attr(child, 'class') ?? '')) return true;
    if (hasIcon(child)) return true;
  }
  return false;
}

function firstHeading(el: Element): Element | null {
  for (const child of elementChildren(el)) {
    if (HEADINGS.has(tagOf(child))) return child;
    const deeper = firstHeading(child);
    if (deeper) return deeper;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Walking a subtree into blocks
// ---------------------------------------------------------------------------

/** Emit one element as a leaf block if it is one. Returns whether it handled it. */
function emitLeaf(el: Element, resolve: (raw: string) => string, out: ModelBlock[]): boolean {
  const tag = tagOf(el);
  const push = (block: ModelBlock | null) => {
    if (block) out.push(block);
  };

  if (HEADINGS.has(tag)) return push(headingBlock(el, resolve)), true;
  if (tag === 'p') return push(textBlock(textOf(el, resolve))), true;
  if (tag === 'ul' || tag === 'ol') return push(listBlock(el, resolve)), true;
  if (tag === 'img') return push(imageBlock(el, resolve)), true;
  if (tag === 'blockquote') return push(textBlock(textOf(el, resolve))), true;
  if (tag === 'button') return push(buttonBlock(el, resolve)), true;
  return false;
}

/**
 * Turn one element's content into a run of blocks, in the order it reads.
 *
 * Bare text and inline dressing (a bold word, a link in a sentence) gather into
 * one paragraph; a heading, a list, an image or a button breaks it and becomes
 * its own block; anything else is a container we walk into.
 */
function blocksFrom(el: Element, resolve: (raw: string) => string): ModelBlock[] {
  const out: ModelBlock[] = [];
  let buffer = '';
  const flush = () => {
    const block = textBlock(buffer);
    if (block) out.push(block);
    buffer = '';
  };

  for (const node of childNodes(el)) {
    if (node.nodeName === '#text') {
      buffer += resolve((node as { value?: string }).value ?? '');
      continue;
    }
    if (!isElement(node)) continue;

    const tag = tagOf(node);
    if (IGNORE.has(tag)) continue;

    if (INLINE.has(tag)) {
      if (tag === 'a' && isButtonLike(node)) {
        flush();
        const button = buttonBlock(node, resolve);
        if (button) out.push(button);
      } else if (tag === 'br') {
        buffer += ' ';
      } else {
        buffer += textOf(node, resolve);
      }
      continue;
    }

    flush();
    if (!emitLeaf(node, resolve, out)) out.push(...blocksFrom(node, resolve));
  }

  flush();
  return out;
}

/**
 * One card of a grid to its blocks.
 *
 * A card with an icon and a heading becomes an icon-and-text, which is the
 * block that pattern wants and is fully editable, icon included. Anything else
 * is walked like any other container.
 */
function cardBlocks(card: Element, resolve: (raw: string) => string): ModelBlock[] {
  const heading = firstHeading(card);
  if (heading && hasIcon(card)) {
    const title = tidy(textOf(heading, resolve));
    // The card's words minus the heading's, which is the body under the title.
    const bodyBits: string[] = [];
    const gather = (el: Element) => {
      for (const child of elementChildren(el)) {
        const tag = tagOf(child);
        if (child === heading || HEADINGS.has(tag) || IGNORE.has(tag)) continue;
        if (tag === 'p' || tag === 'span' || tag === 'div') bodyBits.push(tidy(textOf(child, resolve)));
        else gather(child);
      }
    };
    gather(card);
    const body = tidy(bodyBits.filter(Boolean).join(' '));
    if (title || body) {
      return [{ type: 'icon-item', props: { icon: guessIcon(title), title: title.slice(0, 80), body: body.slice(0, 300) } }];
    }
  }
  return blocksFrom(card, resolve);
}

// ---------------------------------------------------------------------------
// Layout: rows and columns
// ---------------------------------------------------------------------------

/** Leaf content tags: reaching one means we have descended far enough. */
const LEAF = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'img', 'blockquote', 'button', 'a']);

/**
 * Descend past the wrappers to the run of siblings the design laid out.
 *
 * The same walk lib/import/sections.ts does, stopping at the first level with
 * more than one child or at a piece of real content, so a section wrapped in a
 * container and a React root all land on the same working sequence.
 */
function workingSequence(nodes: Element[]): Element[] {
  let level = nodes;
  for (let depth = 0; depth < 16; depth += 1) {
    if (level.length !== 1) return level;
    const only = level[0];
    if (LEAF.has(tagOf(only))) return level;
    // Stop if the single child IS a grid, or descending into it would lose the
    // row: its cards would become the sequence and each read as a stack.
    if (isGrid(only)) return level;
    const children = elementChildren(only);
    if (children.length === 0) return level;
    level = children;
  }
  return level;
}

/**
 * Whether a run of similar sibling clusters is a grid we should make columns of.
 *
 * Same tag, each with real words, and each a cluster in its own right (it holds
 * a heading, a paragraph, an image or a list rather than being a line of text).
 * The cluster test is what stops a paragraph of inline spans reading as a row.
 */
function isGrid(el: Element): boolean {
  const kids = elementChildren(el);
  if (kids.length < 2 || kids.length > 12) return false;
  const firstTag = tagOf(kids[0]);
  if (!kids.every((kid) => tagOf(kid) === firstTag)) return false;
  if (!kids.every(hasWords)) return false;
  return kids.every((kid) =>
    elementChildren(kid).some((child) => {
      const tag = tagOf(child);
      return HEADINGS.has(tag) || tag === 'p' || tag === 'img' || tag === 'ul' || tag === 'ol';
    }),
  );
}

/** How many columns to a row, so a grid of six reads as two rows of three. */
function perRow(count: number): number {
  if (count <= 4) return count;
  if (count % 3 === 0) return 3;
  if (count % 4 === 0) return 4;
  return 3;
}

// ---------------------------------------------------------------------------
// The whole rebuild
// ---------------------------------------------------------------------------

/**
 * An imported block's stored props to a native block model, or null if there is
 * nothing in it we can rebuild (in which case the caller keeps the import).
 */
export function modelFromImport(props: Record<string, unknown>): RebuildModel | null {
  const html = typeof props.html === 'string' ? props.html : '';
  if (!html.trim()) return null;

  const fields = importFields(props);
  const stored = importContent(props);
  const resolve = makeResolver(fields, stored);

  let fragment;
  try {
    fragment = parseFragment(html);
  } catch {
    return null;
  }

  const sequence = workingSequence(elementChildren(fragment));

  const rows: RebuildModel['rows'] = [];
  let stack: ModelBlock[] = [];
  const flushStack = () => {
    if (stack.length) {
      rows.push({ columns: [{ blocks: stack }] });
      stack = [];
    }
  };

  for (const el of sequence) {
    if (IGNORE.has(tagOf(el))) continue;

    if (isGrid(el)) {
      flushStack();
      const columns = elementChildren(el)
        .map((card) => ({ blocks: cardBlocks(card, resolve) }))
        .filter((column) => column.blocks.length > 0);
      if (columns.length) {
        const per = perRow(columns.length);
        for (let i = 0; i < columns.length; i += per) {
          rows.push({ columns: columns.slice(i, i + per) });
        }
      }
      continue;
    }

    // A link on its own at this level is a call to action if it says so, a
    // stray line of text otherwise. Inside flowing text it stays part of the
    // sentence; that case is handled in blocksFrom.
    if (tagOf(el) === 'a') {
      const block = isButtonLike(el) ? buttonBlock(el, resolve) : textBlock(textOf(el, resolve));
      if (block) stack.push(block);
      continue;
    }

    if (!emitLeaf(el, resolve, stack)) stack.push(...blocksFrom(el, resolve));
  }
  flushStack();

  const total = rows.reduce(
    (sum, row) => sum + row.columns.reduce((n, column) => n + column.blocks.length, 0),
    0,
  );
  if (total === 0) return null;

  const model: RebuildModel = { rows };
  const label = typeof props.label === 'string' ? props.label.trim() : '';
  if (label) model.name = label.slice(0, 80);
  return model;
}
