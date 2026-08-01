/**
 * Cutting a pasted design into sections.
 *
 * WHY IT IS CUT UP AT ALL. Somebody pastes a whole Relume page, and if that
 * arrives as one enormous block then the page outline has one row in it, the
 * sections cannot be reordered, and deleting the bit you did not want means
 * deleting the lot. A CMS whose unit is "the entire design" is a hosting
 * service. So the paste is split on the boundaries the design already has, and
 * each piece becomes a section that can be moved, hidden or thrown away on its
 * own.
 *
 * THE BOUNDARIES ARE THE DESIGN'S, NOT OURS. Every export tool wraps its output
 * in something, so the first job is to walk past the wrappers to the level where
 * the actual sections sit: the first node with more than one element child, or
 * the first semantic tag. Relume, Webflow and the slicer all produce a run of
 * <section> elements at that level, which is exactly the shape wanted.
 *
 * WHEN IN DOUBT, ONE SECTION. A design that does not split cleanly comes through
 * whole rather than chopped in a place the designer did not choose. A wrong
 * split is worse than no split: it breaks a layout that was working, and the
 * person who pasted it has no way to know why.
 */

import { parseFragment, serializeOuter, type DefaultTreeAdapterMap } from 'parse5';

import { cleanImportHtml } from './html';
import { trimCssToClasses } from './css';
import { tokeniseImport, type ImportField } from './tokenise';

type ChildNode = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];

export interface ImportCandidate {
  /** A name for the outline, taken from the section's own heading. */
  label: string;
  /** Cleaned, tokenised markup. */
  html: string;
  /** Only the rules that can reach this section. */
  css: string;
  fields: ImportField[];
}

export interface SplitResult {
  candidates: ImportCandidate[];
  /** What the cleaner threw away, so the screen can say so rather than differ. */
  removed: string[];
}

export interface SplitOptions {
  /** How many sections to offer. A paste is not a hundred sections. */
  maxSections?: number;
  maxFieldsPerSection?: number;
}

/** Tags that are a section boundary by their own definition. */
const SECTIONING = new Set(['section', 'header', 'footer', 'article', 'aside', 'nav', 'main']);

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

function elementChildren(node: { childNodes?: ChildNode[] }): Element[] {
  return ((node.childNodes ?? []) as ChildNode[]).filter(isElement);
}

/** Whether there is anything a visitor would read inside this node. */
function hasWords(node: ChildNode): boolean {
  if (node.nodeName === '#text') {
    return /[A-Za-z0-9]/.test((node as { value?: string }).value ?? '');
  }
  if (!isElement(node)) return false;
  // A picture on its own is content even with no words beside it.
  if (node.tagName.toLowerCase() === 'img') return true;
  return ((node.childNodes ?? []) as ChildNode[]).some(hasWords);
}

/**
 * Walk past the wrappers to the level the sections actually sit at.
 *
 * Every tool wraps its output: a <div id="page">, a <main>, a React root. Each
 * of those is one element containing one element, and splitting at that level
 * would produce a single candidate containing the whole design. Descending
 * while there is exactly one element child, and stopping at anything sectioning,
 * lands on the run of siblings the designer laid out.
 */
function contentRoot(nodes: Element[]): Element[] {
  let level = nodes;

  // A bounded walk. A malformed document could otherwise be deep enough to
  // matter, and no real export nests its wrapper more than a few times.
  for (let depth = 0; depth < 12; depth += 1) {
    if (level.length !== 1) return level;

    const only = level[0];
    if (SECTIONING.has(only.tagName.toLowerCase())) return level;

    const children = elementChildren(only);
    if (!children.length) return level;

    level = children;
  }

  return level;
}

/**
 * A name for this section, from the section itself.
 *
 * The first heading it contains, which for a designed section is nearly always
 * the thing a person would call it by. A row of identical "Imported section"
 * entries in the outline is how somebody loses track of which one is the hero.
 */
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function textOf(node: ChildNode): string {
  if (node.nodeName === '#text') return (node as { value?: string }).value ?? '';
  if (!isElement(node)) return '';
  return ((node.childNodes ?? []) as ChildNode[]).map(textOf).join('');
}

function labelFor(element: Element, index: number): string {
  const find = (node: Element): Element | null => {
    for (const child of elementChildren(node)) {
      if (HEADINGS.has(child.tagName.toLowerCase())) return child;
      const deeper = find(child);
      if (deeper) return deeper;
    }
    return null;
  };

  const heading = HEADINGS.has(element.tagName.toLowerCase()) ? element : find(element);
  const words = heading ? textOf(heading).trim().replace(/\s+/g, ' ') : '';

  if (!words) return `Section ${index + 1}`;
  return words.length > 48 ? `${words.slice(0, 48).trimEnd()}...` : words;
}

/**
 * Turn a paste into sections we can put on a page.
 *
 * The whole document is cleaned ONCE and then cut up, rather than cut up and
 * cleaned piece by piece. It has to be that way round: a fragment cut out of a
 * malformed document is a different fragment from the one the browser would
 * have built, and the cleaner is only trustworthy on a tree the parser made from
 * the whole thing.
 */
export function splitImport(html: string, css: string, options: SplitOptions = {}): SplitResult {
  const maxSections = options.maxSections ?? 40;

  const cleaned = cleanImportHtml(html);
  if (!cleaned.html.trim()) return { candidates: [], removed: cleaned.removed };

  const fragment = parseFragment(cleaned.html);
  const top = contentRoot(elementChildren(fragment));

  const usable = top.filter(hasWords);
  const chosen = (usable.length ? usable : top).slice(0, maxSections);

  const candidates: ImportCandidate[] = chosen.map((element, index) => {
    const markup = serializeOuter(element);
    const { html: tokenised, fields } = tokeniseImport(markup, {
      maxFields: options.maxFieldsPerSection,
    });

    /*
     * EACH SECTION GETS ONLY THE RULES THAT CAN REACH IT. Handing every section
     * the whole stylesheet is correct and would put eight copies of a Tailwind
     * build on one page, which is most of a megabyte of CSS to draw a page that
     * needs a few kilobytes of it.
     */
    return {
      label: labelFor(element, index),
      html: tokenised,
      css: trimCssToClasses(css, cleanImportHtml(markup).classes),
      fields,
    };
  });

  return { candidates, removed: cleaned.removed };
}
