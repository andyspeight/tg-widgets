/**
 * Rebuilding an imported design as native blocks.
 *
 * WHAT THIS IS FOR. An imported section keeps the source's exact look but is a
 * sealed lump of markup: a client can fill in its words and its pictures, and
 * nothing else. This turns that lump into ordinary blocks, a heading, a
 * paragraph, an image, a button, an icon-and-text, so every tool the editor has
 * reaches it. The trade is deliberate and was Andy's call on 3 Aug 2026:
 * rebuilt, a section takes on the site's own theme rather than the captured
 * pixels. Both paths exist, the frozen import and this, and the rebuild is one
 * undo away.
 *
 * IT READS REAL MARKUP, NOT TIDY MARKUP. The first cut assumed a designer's
 * semantic tags, an h3 for a card's title and a p for its body, and fell apart
 * on a real marketing page, where a "card" is a div or a link full of utility
 * classes and its title and body are spans styled to look like a heading. So the
 * shape is read from STRUCTURE, not tags: a run of similar siblings is a grid, a
 * card's own child elements are its pieces, and the first piece is the title.
 * Text is separated at every element boundary, so two spans never run together
 * into "millionsJoin".
 *
 * DETERMINISTIC, AND CONTENT PRESERVING. The words a client sliced are theirs
 * and are never rewritten, and the same design always rebuilds the same way. The
 * client's current edits come across, read from the block's own props. What it
 * cannot do is invent: a source icon is an arbitrary SVG we cannot name, so a
 * card's icon is guessed from its title and left for the client to change.
 *
 * IT PRODUCES A MODEL, NOT A SECTION. The output is the same shape the AI
 * builder returns, so lib/ai/section-build.ts's sectionFromModel does the rest:
 * validates against the schema, squares the column widths, fills the defaults
 * and sanitises every value. On the server, because parse5 has no business in
 * the editor's browser bundle.
 */

import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

import { importContent, importFields } from '../content/imported';
import { isIconName, searchIcons } from '../content/icons';
import { sectionFromModel } from '../ai/section-build';
import { safeColour, type Section, type Tone } from '../content/schema';
import type { ImportField } from './tokenise';
import { escapeText } from './html';

type ChildNode = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];

interface ModelBlock {
  type: string;
  props: Record<string, unknown>;
}

/** The shape sectionFromModel accepts. Widths are worked out for us. */
export interface RebuildModel {
  name?: string;
  rows: { columns: { blocks: ModelBlock[] }[] }[];
  /** The design's own background colour, carried onto the section's box. */
  background?: string;
  /** Set dark when that background is dark, so the section's text stays light. */
  tone?: Tone;
}

const TOKEN = /\{\{tg:([a-z]\d{1,3})\}\}/g;
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Tags whose text belongs in the run of words around them, not a block each. */
const INLINE = new Set([
  'a', 'abbr', 'b', 'br', 'cite', 'code', 'em', 'i', 'label', 'mark', 'small',
  'span', 'strong', 'sub', 'sup', 'time', 'u',
]);

/** Tags we never read: they are drawing or noise, not content. */
const IGNORE = new Set(['style', 'script', 'template', 'noscript', 'path', 'use', 'defs', 'symbol']);

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

function classOf(node: Element): string {
  return (attr(node, 'class') ?? '').toLowerCase();
}

/** Whether there is anything a visitor would read inside this node. */
function hasWords(node: ChildNode): boolean {
  if (node.nodeName === '#text') return /[A-Za-z0-9]/.test((node as { value?: string }).value ?? '');
  if (!isElement(node)) return false;
  const tag = tagOf(node);
  if (tag === 'img') return true;
  if (IGNORE.has(tag) || tag === 'svg') return false;
  return childNodes(node).some(hasWords);
}

// ---------------------------------------------------------------------------
// Content, with the client's edits put back
// ---------------------------------------------------------------------------

function makeResolver(fields: readonly ImportField[], stored: Record<string, string>) {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return (raw: string): string =>
    raw.replace(TOKEN, (_whole, key: string) => stored[key] ?? byKey.get(key)?.value ?? '');
}

/**
 * The visible text of an element, slots resolved.
 *
 * A SPACE GOES BETWEEN TWO ELEMENT CHILDREN, because a design that put "Loved by
 * millions" and "Join over 19 million" in two spans with no whitespace between
 * them means two lines, not one word. tidy() collapses the doubles this makes.
 */
function textOf(node: ChildNode, resolve: (raw: string) => string): string {
  if (node.nodeName === '#text') return resolve((node as { value?: string }).value ?? '');
  if (!isElement(node)) return '';
  const tag = tagOf(node);
  if (IGNORE.has(tag) || tag === 'svg') return '';

  let out = '';
  let previousWasElement = false;
  for (const child of childNodes(node)) {
    const element = isElement(child);
    if (element && previousWasElement) out += ' ';
    out += textOf(child, resolve);
    previousWasElement = element;
  }
  return out;
}

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Leaf block builders
// ---------------------------------------------------------------------------

function headingBlock(el: Element, resolve: (raw: string) => string): ModelBlock | null {
  const words = tidy(textOf(el, resolve));
  if (!words) return null;
  const tag = tagOf(el);
  const level = tag === 'h2' || tag === 'h3' ? tag : tag === 'h4' ? 'h4' : tag === 'h1' ? 'h2' : 'h4';
  const style = HEADINGS.has(tag) ? tag : 'h3';
  return { type: 'heading', props: { html: escapeText(words), level, style } };
}

/** A heading for a card's title, which is never one of the source's own h tags. */
function titleHeading(words: string): ModelBlock {
  return { type: 'heading', props: { html: escapeText(words.slice(0, 120)), level: 'h4', style: 'h5' } };
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

function imageBlock(src: string, alt = ''): ModelBlock | null {
  const clean = src.trim();
  if (!clean) return null;
  return { type: 'image', props: { src: clean, alt: tidy(alt) } };
}

function buttonBlock(el: Element, resolve: (raw: string) => string): ModelBlock | null {
  const label = tidy(textOf(el, resolve));
  if (!label) return null;
  return {
    type: 'button',
    props: { label: label.slice(0, 60), href: resolve(attr(el, 'href') ?? '').trim(), variant: 'primary' },
  };
}

/** Whether an <a> is a button rather than a link in a sentence, on class or role. */
function isButtonLike(el: Element): boolean {
  if (attr(el, 'role') === 'button') return true;
  const cls = classOf(el);
  return /(^|[\s_-])(btn|button|cta)([\s_-]|$)/.test(cls) || /\bbutton\b/.test(cls);
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICON_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/protect|secure|safe|atol|abta|cover|guarantee|guaranteed|trust|bonded/, 'shield-check'],
  [/\bpay\b|payment|deposit|price|pricing|cost|money|wallet|\bfee\b|value|cheap|save|saving|flexible/, 'wallet'],
  [/support|help|assist|service|advice|advis|\b24\b|always|call|contact/, 'life-buoy'],
  [/love|million|people|customer|happy|review|rated|rating|star/, 'heart'],
  [/best|promise|beat|match|deal|offer|lowest/, 'badge-check'],
  [/flight|\bfly\b|plane|airport|\bair\b/, 'plane'],
  [/hotel|stay|room|resort|accommodation/, 'bed-double'],
  [/expert|knowledge|\bknow\b|experience/, 'graduation-cap'],
  [/\btime\b|fast|quick|instant|speed|easy|simple/, 'clock'],
  [/search|find|choice|1 search|choose/, 'search'],
];

/** A card's icon, from its title. A real one, always, or a safe default. */
function guessIcon(title: string): string {
  const t = title.toLowerCase();
  for (const [pattern, name] of ICON_HINTS) {
    if (pattern.test(t) && isIconName(name)) return name;
  }
  const first = t.split(/[^a-z]+/).find(Boolean);
  const hit = first ? searchIcons(first, 1)[0] : undefined;
  return hit && isIconName(hit) ? hit : 'sparkles';
}

/** Whether an element is an inline glyph icon (an svg, or a font-icon span). */
function isIconElement(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === 'svg') return true;
  if ((tag === 'i' || tag === 'span') && !hasWords(el)) {
    return /icon|fa-|material|glyph/.test(classOf(el));
  }
  return false;
}

/** An icon anywhere inside, since a design often wraps it in its own box. */
function containsIcon(el: Element): boolean {
  for (const child of elementChildren(el)) {
    if (isIconElement(child) || containsIcon(child)) return true;
  }
  return false;
}

/** Text that is not split any further: none of its child elements have words. */
function isLeafText(el: Element): boolean {
  return hasWords(el) && !elementChildren(el).some(hasWords);
}

/** A resolver that changes nothing, for the structural passes that ignore edits. */
const IDENTITY = (raw: string): string => raw;

function firstHeading(el: Element): Element | null {
  for (const child of elementChildren(el)) {
    if (HEADINGS.has(tagOf(child))) return child;
    const deeper = firstHeading(child);
    if (deeper) return deeper;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cards: a repeated tile of icon, title and body
// ---------------------------------------------------------------------------

type Piece =
  | { kind: 'text'; value: string }
  | { kind: 'icon' }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'button'; el: Element };

/**
 * A card's content, split into pieces by its own child elements.
 *
 * This is the part that reads real markup rather than tidy markup. A designer
 * puts each logical thing, the icon, the title, the line under it, in its own
 * element, whatever tag it happens to be, so each direct child is one piece. A
 * child that is only a wrapper around several pieces is descended into once, so
 * a title and a body nested in a shared box still come out as two.
 */
function contentPieces(card: Element, resolve: (raw: string) => string): Piece[] {
  const pieces: Piece[] = [];

  const walk = (el: Element): void => {
    for (const node of childNodes(el)) {
      if (node.nodeName === '#text') {
        const value = tidy(resolve((node as { value?: string }).value ?? ''));
        if (value) pieces.push({ kind: 'text', value });
        continue;
      }
      if (!isElement(node)) continue;

      const tag = tagOf(node);
      if (isIconElement(node)) {
        pieces.push({ kind: 'icon' });
        continue;
      }
      if (IGNORE.has(tag) || tag === 'svg') continue;
      if (tag === 'img') {
        const src = resolve(attr(node, 'src') ?? '').trim();
        if (src) pieces.push({ kind: 'image', src, alt: resolve(attr(node, 'alt') ?? '') });
        continue;
      }
      if (tag === 'a' && isButtonLike(node)) {
        pieces.push({ kind: 'button', el: node });
        continue;
      }
      // A run of text that is not split further is one piece; a wrapper is
      // walked to its own leaves; a wordless box that only holds the icon
      // contributes the icon. This is what walks through the three or four
      // nesting boxes a real card puts between the link and its title.
      if (isLeafText(node)) {
        const value = tidy(textOf(node, resolve));
        if (value) pieces.push({ kind: 'text', value });
      } else if (hasWords(node)) {
        walk(node);
      } else if (containsIcon(node)) {
        pieces.push({ kind: 'icon' });
      }
    }
  };

  walk(card);
  return pieces;
}

/**
 * One card to its blocks.
 *
 * An icon and words become an icon-and-text, the block that pattern wants, with
 * the icon guessed from the title since the source's own is an unnameable SVG. A
 * picture and words keep the picture. Words alone become a small heading and a
 * line under it. The first piece of text is the title, the rest the body.
 */
function cardToBlocks(card: Element, resolve: (raw: string) => string): ModelBlock[] {
  const pieces = contentPieces(card, resolve);
  const texts = pieces.filter((p): p is Extract<Piece, { kind: 'text' }> => p.kind === 'text').map((p) => p.value);
  const hasGlyph = pieces.some((p) => p.kind === 'icon');
  const image = pieces.find((p): p is Extract<Piece, { kind: 'image' }> => p.kind === 'image');
  const buttons = pieces.filter((p): p is Extract<Piece, { kind: 'button' }> => p.kind === 'button');

  const out: ModelBlock[] = [];

  if (texts.length === 0) {
    if (image) {
      const block = imageBlock(image.src, image.alt);
      if (block) out.push(block);
    }
    for (const button of buttons) {
      const block = buttonBlock(button.el, resolve);
      if (block) out.push(block);
    }
    return out.length ? out : blocksFrom(card, resolve);
  }

  const title = texts[0];
  const body = texts.slice(1).join(' ');

  if (hasGlyph) {
    out.push({
      type: 'icon-item',
      props: { icon: guessIcon(title), title: title.slice(0, 80), body: body.slice(0, 300) },
    });
  } else if (image) {
    const block = imageBlock(image.src, image.alt);
    if (block) out.push(block);
    out.push(titleHeading(title));
    const text = textBlock(body);
    if (text) out.push(text);
  } else {
    out.push(titleHeading(title));
    const text = textBlock(body);
    if (text) out.push(text);
  }

  for (const button of buttons) {
    const block = buttonBlock(button.el, resolve);
    if (block) out.push(block);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image cards: a uniform grid of linked picture tiles becomes one Cards block
// ---------------------------------------------------------------------------

/**
 * The first run of words at the leaves of an element.
 *
 * Used for a link's label, so "<span>View deals</span> View deals" gives the
 * span's words once rather than the doubled text the trailing node would add.
 */
function firstLeafText(el: Element, resolve: (raw: string) => string): string {
  for (const node of childNodes(el)) {
    if (node.nodeName === '#text') {
      const value = tidy(resolve((node as { value?: string }).value ?? ''));
      if (value) return value;
    } else if (isElement(node)) {
      const tag = tagOf(node);
      if (IGNORE.has(tag) || tag === 'svg') continue;
      const deeper = firstLeafText(node, resolve);
      if (deeper) return deeper;
    }
  }
  return '';
}

/**
 * A card's own link: the first real destination, and the words on it.
 *
 * A picture card is usually one big link, sometimes with a "View deals" link
 * inside it as well. The href is the first that goes somewhere (a bare "#" is
 * not a destination); the label is the first link's own words, read from its
 * leaves so a doubled span does not repeat.
 */
function cardLink(card: Element, resolve: (raw: string) => string): { href: string; label: string } {
  let href = '';
  let label = '';
  const walk = (el: Element): void => {
    for (const child of elementChildren(el)) {
      const tag = tagOf(child);
      if (IGNORE.has(tag) || tag === 'svg') continue;
      if (tag === 'a') {
        const candidate = resolve(attr(child, 'href') ?? '').trim();
        if (!href && candidate && candidate !== '#') href = candidate;
        if (!label) label = firstLeafText(child, resolve);
      }
      walk(child);
    }
  };
  walk(card);
  return { href, label };
}

interface CardItem {
  src: string;
  alt: string;
  label: string;
  title: string;
  body: string;
  linkLabel: string;
  linkHref: string;
}

/**
 * One card as a Cards-block item, or null if it is not a linked picture card.
 *
 * The pattern this is for is a destination, an offer or a post: a picture, a
 * title, maybe a line under it, and a link through to the thing. It needs the
 * picture AND the link, so a linkless badge grid (a trust mark over two words)
 * stays as its own blocks rather than being forced into a Cards list. The link's
 * own words are lifted out of the title and body, so "View deals" is the button,
 * not the heading.
 */
function cardItem(card: Element, resolve: (raw: string) => string): CardItem | null {
  const pieces = contentPieces(card, resolve);
  const image = pieces.find((piece): piece is Extract<Piece, { kind: 'image' }> => piece.kind === 'image');
  if (!image) return null;

  const link = cardLink(card, resolve);
  if (!link.href) return null;

  const linkLabel = link.label;
  const texts = pieces
    .filter((piece): piece is Extract<Piece, { kind: 'text' }> => piece.kind === 'text')
    .map((piece) => piece.value)
    .filter((value) => !linkLabel || value.toLowerCase() !== linkLabel.toLowerCase());
  if (!texts.length) return null;

  return {
    src: image.src,
    alt: tidy(image.alt),
    label: '',
    title: texts[0].slice(0, 120),
    body: texts.slice(1).join(' ').slice(0, 400),
    linkLabel: linkLabel.slice(0, 60),
    linkHref: link.href,
  };
}

/** A row of image cards as one editable Cards block, columns from the count. */
function cardsBlock(items: CardItem[]): ModelBlock {
  const columns = String(Math.min(4, Math.max(2, perRow(items.length))));
  return { type: 'cards', props: { source: 'typed', columns, items } };
}

// ---------------------------------------------------------------------------
// Walking a subtree into blocks (the non-grid path)
// ---------------------------------------------------------------------------

function emitLeaf(el: Element, resolve: (raw: string) => string, out: ModelBlock[]): boolean {
  const tag = tagOf(el);
  const push = (block: ModelBlock | null) => {
    if (block) out.push(block);
  };

  if (HEADINGS.has(tag)) return push(headingBlock(el, resolve)), true;
  if (tag === 'p') return push(textBlock(textOf(el, resolve))), true;
  if (tag === 'ul' || tag === 'ol') return push(listBlock(el, resolve)), true;
  if (tag === 'img') return push(imageBlock(resolve(attr(el, 'src') ?? ''), resolve(attr(el, 'alt') ?? ''))), true;
  if (tag === 'blockquote') return push(textBlock(textOf(el, resolve))), true;
  if (tag === 'button') return push(buttonBlock(el, resolve)), true;
  return false;
}

/**
 * Turn one element's content into a run of blocks, in the order it reads. Bare
 * text and inline dressing gather into a paragraph; a heading, a list, an image
 * or a button breaks it; a link that is really a card is walked, not swallowed.
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
    if (IGNORE.has(tag) || tag === 'svg') continue;

    if (INLINE.has(tag)) {
      if (tag === 'a' && isButtonLike(node)) {
        flush();
        const button = buttonBlock(node, resolve);
        if (button) out.push(button);
      } else if (tag === 'a' && elementChildren(node).length > 0) {
        // A link wrapping a block of content is not a word in a sentence.
        flush();
        out.push(...blocksFrom(node, resolve));
      } else if (tag === 'br') {
        buffer += ' ';
      } else {
        if (buffer && !/\s$/.test(buffer)) buffer += ' ';
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

// ---------------------------------------------------------------------------
// Layout: finding the grid
// ---------------------------------------------------------------------------

const LEAF = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'img', 'blockquote', 'button']);

/**
 * Whether an element is card shaped: an icon and words, a heading, or two or
 * more pieces of content. A single-word link is not a card, so a row of them is
 * a menu rather than a grid.
 */
function isCardish(el: Element): boolean {
  if (tagOf(el) === 'img') return true;
  if (!hasWords(el)) return false;
  if (firstHeading(el)) return true;
  const pieces = contentPieces(el, IDENTITY);
  if (pieces.some((piece) => piece.kind === 'icon' || piece.kind === 'image')) return true;
  return pieces.filter((piece) => piece.kind === 'text').length >= 2;
}

/**
 * Whether a run of similar siblings is a grid worth making columns of.
 *
 * Same tag, most of them card shaped, AND uniform in how much they hold. The
 * uniformity is what stops the outer box that carries a heading beside the card
 * grid from being read as a two-column grid itself: its two children are wildly
 * different in size, where the six real cards are all alike. Read from
 * structure, not tags, so a grid of utility-class divs or links reads the same.
 */
function isGrid(el: Element): boolean {
  const kids = elementChildren(el).filter((kid) => !IGNORE.has(tagOf(kid)));
  if (kids.length < 2 || kids.length > 12) return false;
  const firstTag = tagOf(kids[0]);
  if (!kids.every((kid) => tagOf(kid) === firstTag)) return false;

  const cards = kids.filter(isCardish).length;
  if (cards < Math.max(2, Math.ceil(kids.length * 0.6))) return false;

  const counts = kids.map((kid) => contentPieces(kid, IDENTITY).length);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return max - min <= 2 || max <= min * 2;
}

/** Descend past the wrappers to the run of siblings the design laid out. */
function workingSequence(nodes: Element[]): Element[] {
  let level = nodes;
  for (let depth = 0; depth < 16; depth += 1) {
    if (level.length !== 1) return level;
    const only = level[0];
    if (LEAF.has(tagOf(only))) return level;
    if (isGrid(only)) return level;
    const children = elementChildren(only);
    if (children.length === 0) return level;
    level = children;
  }
  return level;
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
    const tag = tagOf(el);
    if (IGNORE.has(tag) || tag === 'svg') continue;

    if (isGrid(el)) {
      flushStack();
      const cards = elementChildren(el).filter((kid) => !IGNORE.has(tagOf(kid)));

      // A uniform grid of linked picture cards becomes ONE editable Cards block,
      // a list with an Add button, rather than a column of loose image and
      // heading blocks per card that a client would have to keep in step by
      // hand. Every card has to be a picture-and-link tile for this; an icon
      // grid or a linkless badge row falls through to the per-card blocks below.
      const items = cards
        .map((card) => cardItem(card, resolve))
        .filter((item): item is CardItem => item !== null);
      if (items.length >= 2 && items.length === cards.length) {
        rows.push({ columns: [{ blocks: [cardsBlock(items)] }] });
        continue;
      }

      const columns = cards
        .map((card) => ({ blocks: cardToBlocks(card, resolve) }))
        .filter((column) => column.blocks.length > 0);
      if (columns.length) {
        const per = perRow(columns.length);
        for (let i = 0; i < columns.length; i += per) {
          rows.push({ columns: columns.slice(i, i + per) });
        }
      }
      continue;
    }

    if (tag === 'a') {
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

  // Carry the design's own background so the rebuild is not stripped to white.
  const css = typeof props.css === 'string' ? props.css : '';
  const background = rootBackground(html, css);
  if (background) {
    model.background = background.colour;
    if (background.dark) model.tone = 'dark';
  }

  return model;
}

/**
 * The outermost element's solid background colour, if it set one.
 *
 * Read from the design's own CSS, matched to the first element's classes, and
 * put through safeColour so nothing but a real colour reaches the section. A
 * transparent or white background is nothing to carry, so it is skipped. The
 * luminance decides the tone: a dark band gets tone 'dark' so its text stays
 * light, which is what the source did with a white-on-blue panel like this one.
 */
function rootBackground(html: string, css: string): { colour: string; dark: boolean } | undefined {
  const opening = /<[a-z][a-z0-9]*[^>]*\bclass="([^"]+)"/i.exec(html);
  if (!opening) return undefined;

  for (const raw of opening[1].split(/\s+/)) {
    const cls = raw.replace(/[^a-z0-9_-]/gi, '');
    if (!cls) continue;
    const rule = new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}', 'i').exec(css);
    if (!rule) continue;
    const declared = /background-color:\s*([^;]+)/i.exec(rule[1]);
    if (!declared) continue;

    const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)/i.exec(declared[1]);
    if (rgb && rgb[4] !== undefined && Number.parseFloat(rgb[4]) === 0) continue; // transparent

    const colour = safeColour(declared[1].trim());
    if (!colour || colour === 'transparent') continue;
    if (colour === '#fff' || colour === '#ffffff' || colour === 'rgb(255, 255, 255)') continue;

    const dark = rgb
      ? (0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])) / 255 < 0.55
      : false;
    return { colour, dark };
  }
  return undefined;
}

/**
 * The whole job: an imported block's props to a validated, editable Section.
 *
 * modelFromImport reads it, sectionFromModel makes it real and safe, and the
 * design's own background is set on the section afterwards, since that is a
 * section property sectionFromModel does not carry. Shared by the real action
 * and the standalone double so the two cannot drift.
 */
export function rebuildSection(
  props: Record<string, unknown>,
): { ok: true; section: Section } | { ok: false; error: string } {
  const model = modelFromImport(props);
  if (!model) {
    return { ok: false, error: 'There was nothing in this design we could rebuild as blocks.' };
  }

  const built = sectionFromModel(model);
  if (!built.ok) {
    return { ok: false, error: 'We could not rebuild this design as blocks.' };
  }

  let section = built.section;
  if (model.background) {
    section = {
      ...section,
      tone: model.tone ?? section.tone,
      box: { ...section.box, background: model.background },
    };
  }
  return { ok: true, section };
}

// ---------------------------------------------------------------------------
// The AI fallback: an outline for the model, and a test for when to reach for it
// ---------------------------------------------------------------------------

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

/**
 * The captured content as a plain outline, for the model to lay out afresh.
 *
 * When a design's markup is too unusual for the deterministic pass to structure,
 * the words are still all there; they have just landed in the wrong shape. This
 * hands the model the content and nothing else: a heading marked with #, a list
 * item with *, a picture and a button noted, every other run of words on its own
 * line. The model rebuilds from this, so it is working from the client's exact
 * words rather than from a brief, which is what keeps it from inventing.
 */
export function importOutline(props: Record<string, unknown>): string {
  const html = typeof props.html === 'string' ? props.html : '';
  if (!html.trim()) return '';

  const fields = importFields(props);
  const stored = importContent(props);
  const resolve = makeResolver(fields, stored);

  let fragment;
  try {
    fragment = parseFragment(html);
  } catch {
    return '';
  }

  const lines: string[] = [];
  const emit = (node: ChildNode): void => {
    if (node.nodeName === '#text') {
      const value = tidy(resolve((node as { value?: string }).value ?? ''));
      if (value) lines.push(value);
      return;
    }
    if (!isElement(node)) return;

    const tag = tagOf(node);
    if (IGNORE.has(tag) || tag === 'svg') return;
    if (HEADINGS.has(tag)) {
      const value = tidy(textOf(node, resolve));
      if (value) lines.push(`# ${value}`);
      return;
    }
    if (tag === 'img') {
      lines.push(`[image: ${tidy(resolve(attr(node, 'alt') ?? '')) || 'illustration'}]`);
      return;
    }
    if (tag === 'a' && isButtonLike(node)) {
      const label = tidy(textOf(node, resolve));
      if (label) lines.push(`[button: ${label}]`);
      return;
    }
    if (tag === 'li') {
      const value = tidy(textOf(node, resolve));
      if (value) lines.push(`* ${value}`);
      return;
    }
    if (isLeafText(node)) {
      const value = tidy(textOf(node, resolve));
      if (value) lines.push(value);
      return;
    }
    for (const child of childNodes(node)) emit(child);
  };

  for (const el of workingSequence(elementChildren(fragment))) emit(el);
  return lines.filter(Boolean).join('\n').slice(0, 6000);
}

/**
 * Whether a deterministic rebuild is poor enough to hand to the model.
 *
 * Deliberately conservative, so the free path keeps everything it already reads
 * well and the model is only paid for when the deterministic pass genuinely
 * could not structure the design. Two signals: a single block carrying a wall of
 * run-together words, or a section that is nearly all prose with next to no
 * structure. Nothing at all is weak too.
 */
export function looksWeak(section: Section): boolean {
  const blocks = section.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
  if (blocks.length === 0) return true;

  const texts = blocks.filter((block) => block.type === 'text');
  const longText = texts.some(
    (block) => stripTags(typeof block.props.html === 'string' ? block.props.html : '').length > 220,
  );
  if (longText) return true;

  const structured = blocks.filter((block) => block.type !== 'text').length;
  const mostlyProse = blocks.length >= 3 && texts.length / blocks.length >= 0.7;
  return mostlyProse && structured <= 1;
}
