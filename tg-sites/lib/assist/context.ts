/**
 * What the assistant is looking at: a page as a compact outline.
 *
 * WHY AN OUTLINE AND NOT THE PAGE. A page is a tree of sections, rows, columns
 * and blocks with a settings object on every node, and the whole thing runs to
 * tens of thousands of characters for a busy page. The model does not need the
 * padding of every column to say what the hero should say. It needs the shape:
 * which sections, in what order, holding which blocks, saying what. That is a
 * few hundred tokens, it caches well, and it leaves the model room to think.
 * When it needs more it has read_page for the words in full.
 *
 * THE IDS ARE KEPT. Every section and block is named by its own id, because
 * slice 2's operations point at a block by id, and a model that has only ever
 * seen the page through this outline has to be able to say "b_x9".
 *
 * BOUND BLOCKS ARE MARKED. The one data binding in tg-sites is the collection
 * loop's token ({{title}}, {{image}}, {{field:price}}), filled per item at
 * render time. A block whose words or picture hold a token is drawn from the
 * collection, and the brief's rule 6 says the model must know that: Duda's
 * copilot cannot see a binding and overwrites it with plain text. So any
 * block with a token anywhere in its settings carries [bound {{...}}] here,
 * and the operation validator (slice 2) refuses to drop one.
 *
 * PURE. A Page in, an outline and its text out, tested with fixtures.
 */

import { blockDefinition } from '../content/blocks';
import type { Block, Page, Section } from '../content/schema';

/** The same shape lib/content/loop.ts fills: {{name}} or {{field:key}}. */
const TOKEN = /\{\{\s*[a-z][a-z0-9]*(?::[a-z0-9_-]+)?\s*\}\}/gi;

/** Where a block keeps its words, most likely first. */
const TEXT_KEYS = ['html', 'text', 'title', 'heading', 'label', 'caption', 'question', 'name', 'quote', 'body', 'alt'];

/** Settings that hold blocks of their own. */
const CHILD_KEYS = ['template', 'blocks'];

export interface OutlineBlock {
  id: string;
  type: string;
  label: string;
  /** The block's own words, stripped of markup and cut short. */
  text: string;
  /** How many repeated items (cards, steps, questions) it holds, when it holds any. */
  items: number;
  /** The tokens found in its settings, so a bound block says which. */
  tokens: string[];
  children: OutlineBlock[];
}

export interface OutlineSection {
  id: string;
  name: string;
  tone: string;
  blocks: OutlineBlock[];
}

export interface PageOutline {
  id: string;
  title: string;
  path: string;
  seo: { title: string; description: string; noindex: boolean };
  sections: OutlineSection[];
  /** True when the rendering had to stop early to stay inside the budget. */
  truncated: boolean;
}

/** Characters of outline a turn carries by default. */
export const OUTLINE_BUDGET = 7_000;

const MAX_TEXT = 140;

export function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(value: string, max = MAX_TEXT): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** Every {{token}} in any string anywhere under a value, once each. */
export function tokensIn(value: unknown, found = new Set<string>(), depth = 0): string[] {
  if (depth > 8) return [...found];
  if (typeof value === 'string') {
    for (const hit of value.match(TOKEN) ?? []) found.add(hit.replace(/\s+/g, ''));
  } else if (Array.isArray(value)) {
    for (const entry of value) tokensIn(entry, found, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) tokensIn(entry, found, depth + 1);
  }
  return [...found];
}

export function isBound(block: Pick<Block, 'props'>): boolean {
  return tokensIn(block.props).length > 0;
}

function looksLikeBlock(value: unknown): value is Block {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as Block).type === 'string'
    && typeof (value as Block).id === 'string';
}

function blockText(block: Block): string {
  for (const key of TEXT_KEYS) {
    const raw = block.props[key];
    if (typeof raw === 'string') {
      const text = stripMarkup(raw);
      if (text) return shorten(text);
    }
  }
  const definition = blockDefinition(block.type);
  const summary = definition?.summarise?.(block.props);
  return summary && summary !== definition?.label ? shorten(stripMarkup(summary)) : '';
}

export function outlineBlock(block: Block, depth = 0): OutlineBlock {
  const definition = blockDefinition(block.type);
  const children: OutlineBlock[] = [];
  if (depth < 4) {
    for (const key of CHILD_KEYS) {
      const raw = block.props[key];
      if (!Array.isArray(raw)) continue;
      for (const entry of raw) if (looksLikeBlock(entry)) children.push(outlineBlock(entry, depth + 1));
    }
  }
  const items = Array.isArray(block.props.items) ? block.props.items.length : 0;
  /* The tokens of the block itself, not of its card template: a loop is not
     bound, the heading inside its card is. */
  const own: Record<string, unknown> = { ...block.props };
  for (const key of CHILD_KEYS) delete own[key];
  return {
    id: block.id,
    type: block.type,
    label: definition?.label ?? block.type,
    text: blockText(block),
    items,
    tokens: tokensIn(own),
    children,
  };
}

function sectionBlocks(section: Section): Block[] {
  const out: Block[] = [];
  for (const row of section.rows ?? []) {
    for (const column of row.columns ?? []) out.push(...(column.blocks ?? []));
  }
  return out;
}

export function outlinePage(page: Page, path: string): PageOutline {
  return {
    id: page.id,
    title: page.title,
    path,
    seo: {
      title: page.seo?.title ?? '',
      description: page.seo?.description ?? '',
      noindex: Boolean(page.seo?.noindex),
    },
    sections: (page.sections ?? []).map((section) => ({
      id: section.id,
      name: section.name ?? '',
      tone: section.tone ?? 'light',
      blocks: sectionBlocks(section).map((block) => outlineBlock(block)),
    })),
    truncated: false,
  };
}

function renderBlock(block: OutlineBlock, indent: string): string[] {
  const parts = [`${indent}${block.type}#${block.id}`];
  if (block.tokens.length) parts.push(`[bound ${block.tokens.join(' ')}]`);
  if (block.items) parts.push(`(${block.items} items)`);
  const head = parts.join(' ');
  const lines = [block.text ? `${head}: ${block.text}` : head];
  for (const child of block.children) lines.push(...renderBlock(child, `${indent}  `));
  return lines;
}

/**
 * The outline as text for the model, inside the budget. Sections are whole or
 * absent: a section cut in half would read as a shorter section, which is a
 * lie about the page, where "and 4 more sections" is not.
 *
 * `selectedId` is the section the person has clicked in the editor, marked
 * [selected] on its own line. That is the whole of what "this section" means
 * when somebody types it: the mark is in the material, the system prompt says
 * how to read it, and nothing about it is an instruction.
 */
export function renderOutline(
  outline: PageOutline,
  budget = OUTLINE_BUDGET,
  selectedId: string | null = null,
): { text: string; truncated: boolean } {
  const head = [
    `Page "${outline.title}" at ${outline.path || '/'}${outline.seo.noindex ? ' (hidden from search)' : ''}`,
    outline.seo.title ? `Search title: ${outline.seo.title}` : 'Search title: not set',
    outline.seo.description ? `Search description: ${outline.seo.description}` : 'Search description: not set',
    `Sections (${outline.sections.length}):`,
  ];
  const lines = [...head];
  let length = lines.join('\n').length;
  let shown = 0;
  for (const section of outline.sections) {
    const mark = selectedId && section.id === selectedId ? ' [selected]' : '';
    const block = [`[section ${section.id}] ${section.name || 'Untitled'} (${section.tone})${mark}`];
    for (const item of section.blocks) block.push(...renderBlock(item, '  '));
    const text = block.join('\n');
    if (shown > 0 && length + text.length + 1 > budget) break;
    lines.push(text);
    length += text.length + 1;
    shown += 1;
  }
  const truncated = shown < outline.sections.length;
  if (truncated) {
    lines.push(`… and ${outline.sections.length - shown} more sections not shown. Call read_page for the whole page.`);
  }
  return { text: lines.join('\n'), truncated };
}
