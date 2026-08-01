/**
 * Turning somebody else's HTML into markup this product will put on a live site.
 *
 * WHY THIS IS NOT lib/content/sanitise.ts, AND MUST NOT BECOME IT.
 *
 * That module guards rich text our own editor produced: a paragraph, a link, a
 * list. It is a conservative allowlist TOKENISER, and its own header admits as
 * much and says a parser-backed version is needed before real client content
 * ships. For text from our toolbar that trade is defensible, because we control
 * the thing writing it and the allowlist is twenty tags wide.
 *
 * A design export is a different animal. It is a whole document from a tool we
 * do not control, full of nested structure, and possibly malformed. A regex walk
 * over that is how mutation XSS happens: the sanitiser and the browser disagree
 * about where a tag ends, the sanitiser passes what it read and the browser runs
 * what it read instead. So this one is parser-backed, and the two live apart:
 * loosening the text sanitiser to admit a `<div>` would widen what a client can
 * type into a paragraph, which is not the thing being asked for.
 *
 * THE ONE PROPERTY THAT MAKES THIS SAFE: nothing from the input is ever
 * concatenated into the output. parse5 builds a tree, this walks it, and the
 * markup that comes out is built here from names and values that have each been
 * checked. There is no path by which an unparsed byte reaches a page.
 *
 * WHAT IT DELIBERATELY KEEPS. Divs, sections, spans, classes, SVG. A design is
 * its structure, and stripping the structure to a list of paragraphs would be a
 * faithful sanitiser and a useless importer.
 *
 * WHAT IT REFUSES, and none of these is negotiable for fidelity: script, style,
 * iframe, object, embed, form and its controls, every on* attribute, and any URL
 * whose scheme is not http, https, mailto, tel or data:image.
 */

import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ChildNode = DefaultTreeAdapterMap['childNode'];

/**
 * The tags a design may be made of.
 *
 * Wide on purpose, and every entry earns its place in a real export: layout
 * (div, section, header), text (h1 to h6, p, span), lists, tables, media and
 * inline SVG, which is how nearly every icon in a modern export arrives.
 */
export const IMPORT_TAGS = new Set([
  // Structure
  'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
  'figure', 'figcaption', 'hr', 'br',
  // Text
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'b', 'em', 'i',
  'u', 's', 'small', 'mark', 'abbr', 'sub', 'sup', 'blockquote', 'q', 'cite',
  'code', 'pre', 'time', 'address', 'label',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Links and media
  'a', 'img', 'picture', 'source', 'video', 'audio',
  // Interactive, which a design uses for accordions
  'details', 'summary',
  // Icons
  'svg', 'path', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline',
  'polygon', 'defs', 'clippath', 'lineargradient', 'radialgradient', 'stop',
  'use', 'symbol', 'title', 'desc', 'mask', 'pattern', 'text', 'tspan',
]);

/**
 * Attributes allowed on any element.
 *
 * `class` is the important one and the reason the CSS half of this pipeline
 * exists: without it a scoped stylesheet has nothing to attach to and the whole
 * design arrives unstyled.
 *
 * NO `id`. Two imported sections from the same export would carry the same ids
 * onto one page, which is invalid, breaks anchors and can silently rewire a
 * label. Nothing in a design needs one that a class cannot do.
 *
 * NO `style`. A design's styling belongs in its stylesheet, where it can be
 * scoped; an inline one cannot be, and it is the harder of the two to check.
 */
const GLOBAL_ATTRS = new Set(['class', 'title', 'lang', 'dir', 'role']);

/** And the ones that only make sense on particular elements. */
const TAG_ATTRS: Record<string, readonly string[]> = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading', 'srcset', 'sizes'],
  source: ['src', 'srcset', 'sizes', 'media', 'type'],
  video: ['src', 'poster', 'width', 'height', 'controls', 'muted', 'loop', 'playsinline', 'autoplay'],
  audio: ['src', 'controls', 'loop'],
  time: ['datetime'],
  td: ['colspan', 'rowspan', 'headers'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span'],
  colgroup: ['span'],
  details: ['open'],
  ol: ['start', 'reversed', 'type'],
  // SVG. Deliberately the same list lib/content/icons.ts settled on, plus the
  // few a whole illustration needs that a single icon does not.
  svg: ['viewbox', 'width', 'height', 'fill', 'stroke', 'xmlns', 'preserveaspectratio', 'aria-hidden', 'focusable'],
  path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'opacity', 'transform'],
  g: ['fill', 'stroke', 'stroke-width', 'opacity', 'transform', 'clip-path', 'mask'],
  circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
  line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-linecap', 'opacity', 'transform'],
  polyline: ['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
  polygon: ['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
  lineargradient: ['x1', 'y1', 'x2', 'y2', 'gradientunits', 'gradienttransform'],
  radialgradient: ['cx', 'cy', 'r', 'fx', 'fy', 'gradientunits', 'gradienttransform'],
  use: ['x', 'y', 'width', 'height'],
  symbol: ['viewbox'],
  mask: ['x', 'y', 'width', 'height', 'maskunits'],
  pattern: ['x', 'y', 'width', 'height', 'patternunits', 'viewbox'],
  clippath: ['clippathunits'],
  text: ['x', 'y', 'dx', 'dy', 'fill', 'font-size', 'font-family', 'text-anchor', 'transform'],
  tspan: ['x', 'y', 'dx', 'dy', 'fill'],
};

/** Elements that hold no children, so a closing tag would be wrong. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'source', 'col']);

/**
 * Tags whose CONTENT is dropped along with them, rather than kept.
 *
 * The difference matters. A `<b>` we did not allow should still yield its
 * words, because the words are the design's content. A `<script>` must take its
 * body with it, or the sanitiser removes the tag and leaves the source of the
 * program sitting in the page as text, ready for the next thing that puts it
 * back inside one.
 *
 * THE FORM CONTROLS ARE HERE FOR A DIFFERENT REASON, and it is a product one
 * rather than a security one. Unwrapping them would be perfectly safe: the
 * <form> goes, so its fields post nowhere. What it would leave is a contact
 * form on a client's live site that looks completely real, that a visitor
 * types their name and their holiday dates into, and that silently does
 * nothing with them. An enquiry that never arrives is worse than an enquiry
 * form that was never there, so the whole thing goes and the client adds a
 * real one.
 */
const DROP_WITH_CONTENTS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template',
  'form', 'input', 'button', 'select', 'option', 'textarea', 'fieldset',
  'link', 'meta', 'base', 'head', 'title',
]);

/**
 * A URL this product is willing to put in a page.
 *
 * SCHEME FIRST AND NOTHING CLEVER. Whitespace and control characters are
 * stripped before the check because `java\nscript:` is the oldest trick there
 * is, and a scheme is matched at the very start of the string so a value like
 * `/x?u=javascript:alert(1)` stays a perfectly ordinary relative path.
 *
 * data: is allowed for images only. An inline SVG data URL is a script vector,
 * so the media type has to be a raster one by name.
 */
export function safeImportUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  // Control characters and every kind of space, anywhere in the value.
  const tidy = value.replace(/[\u0000-\u0020\u007F\u00A0\u2000-\u200D\uFEFF]/g, '');
  if (tidy === '') return null;
  if (tidy.length > 4000) return null;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(tidy);

  if (!scheme) {
    // No scheme at all: a relative or root-relative path, or a fragment.
    return value.trim();
  }

  const name = scheme[1].toLowerCase();
  if (name === 'http' || name === 'https' || name === 'mailto' || name === 'tel') {
    return value.trim();
  }

  if (name === 'data') {
    // Raster images only. image/svg+xml carries script.
    return /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(tidy)
      ? value.trim()
      : null;
  }

  return null;
}

/** srcset is a comma-separated list of URL plus descriptor. Each is checked. */
function safeSrcset(value: string): string | null {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  const kept: string[] = [];

  for (const part of parts) {
    const [url, ...descriptor] = part.split(/\s+/);
    const safe = safeImportUrl(url);
    if (!safe) continue;
    // A descriptor is a width or a density, and nothing else.
    const tail = descriptor.filter((d) => /^\d+(\.\d+)?[wx]$/.test(d));
    kept.push([safe, ...tail].join(' '));
  }

  return kept.length ? kept.join(', ') : null;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Text, made safe to sit between two tags.
 *
 * `<` and `&` are the two that matter; `>` is escaped as well because a lone
 * one after an unescaped `<` is what turns a stray character into a tag.
 */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** A value, made safe to sit inside double quotes. */
function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

export interface CleanOptions {
  /**
   * A prefix put on every class name.
   *
   * DEFAULTS TO NOTHING, and for a frozen import that is the right answer: the
   * stylesheet is confined by an ancestor selector instead, which is what
   * lib/import/css.ts does and why it does not have to rewrite a single name.
   * Set it when a caller is rebuilding a fragment as native content and wants
   * the leftover classes not to look like ours.
   */
  classPrefix?: string;
  /** How deep to go before giving up. A design is not a thousand levels deep. */
  maxDepth?: number;
  /** How many elements to keep. A guard against a pasted megabyte. */
  maxElements?: number;
}

export interface CleanResult {
  html: string;
  /**
   * Every class name kept, after any prefixing.
   *
   * Not used for scoping, which the CSS half does by ancestor. It is here so a
   * recogniser can ask what a section calls itself, and so the import screen
   * can tell a design with no classes at all from one whose stylesheet simply
   * did not come with it.
   */
  classes: Set<string>;
  /** What was thrown away, so the screen can say so rather than silently differ. */
  removed: string[];
}

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

/**
 * Clean a fragment of somebody else's HTML.
 *
 * REBUILT, NOT FILTERED. Every tag name, attribute name and attribute value in
 * the output was checked here and then written by this function. The input
 * string is parsed once and never appears in the result, which is what closes
 * off the whole family of "the sanitiser and the browser read it differently"
 * attacks.
 */
export function cleanImportHtml(source: string, options: CleanOptions = {}): CleanResult {
  const prefix = options.classPrefix ?? '';
  const maxDepth = options.maxDepth ?? 40;
  const maxElements = options.maxElements ?? 4000;

  const classes = new Set<string>();
  const removed: string[] = [];
  const note = (what: string) => {
    if (!removed.includes(what)) removed.push(what);
  };

  let elements = 0;

  const walk = (nodes: ChildNode[], depth: number): string => {
    if (depth > maxDepth) {
      note('content nested too deeply');
      return '';
    }

    let out = '';

    for (const node of nodes) {
      if (node.nodeName === '#text') {
        out += escapeText((node as { value?: string }).value ?? '');
        continue;
      }

      /*
       * Comments go entirely. They can carry conditional-comment markup, and
       * nothing in a design needs them.
       *
       * Said out loud even though the isElement guard below would also drop
       * them, because "comments are removed" is a decision and the reader
       * should not have to infer it from a type check three lines down.
       */
      if (node.nodeName === '#comment') continue;

      if (!isElement(node)) continue;

      const tag = node.tagName.toLowerCase();

      if (DROP_WITH_CONTENTS.has(tag)) {
        note(`<${tag}>`);
        continue;
      }

      if (elements >= maxElements) {
        note('the design was larger than we import in one go');
        break;
      }

      const children = node.childNodes ?? [];

      if (!IMPORT_TAGS.has(tag)) {
        /*
         * UNKNOWN, SO UNWRAPPED RATHER THAN DROPPED. A tag we have no opinion
         * about is almost always a custom element or something new, and its
         * CONTENT is still the design's content. Losing the wrapper costs some
         * layout; losing the words costs the page.
         */
        note(`<${tag}>`);
        out += walk(children as ChildNode[], depth + 1);
        continue;
      }

      elements += 1;

      out += `<${tag}`;
      out += attributes(node, tag, prefix, classes, note);

      if (VOID_TAGS.has(tag)) {
        out += ' />';
        continue;
      }

      out += '>';
      out += walk(children as ChildNode[], depth + 1);
      out += `</${tag}>`;
    }

    return out;
  };

  const html = walk(parseFragment(source).childNodes as ChildNode[], 0);
  return { html, classes, removed };
}

function attributes(
  node: Element,
  tag: string,
  prefix: string,
  classes: Set<string>,
  note: (what: string) => void,
): string {
  const allowed = TAG_ATTRS[tag] ?? [];
  let out = '';

  for (const attr of node.attrs ?? []) {
    const name = attr.name.toLowerCase();
    const raw = attr.value ?? '';

    /*
     * EVERY on* ATTRIBUTE, BY PREFIX, before anything else looks at it. Naming
     * them individually is how one gets missed: the list is whatever the
     * browser decides it is this year, and it only ever grows.
     */
    if (name.startsWith('on')) {
      note('event handlers');
      continue;
    }

    // xlink:href on a <use> is a URL, and an old one that still resolves.
    if (name === 'xlink:href' || name === 'href' || name === 'src' || name === 'poster') {
      if (!GLOBAL_ATTRS.has(name) && !allowed.includes(name) && name !== 'xlink:href') continue;
      const safe = safeImportUrl(raw);
      if (!safe) {
        note('links we could not vouch for');
        continue;
      }
      out += ` ${name === 'xlink:href' ? 'href' : name}="${escapeAttr(safe)}"`;
      continue;
    }

    if (name === 'srcset') {
      if (!allowed.includes('srcset')) continue;
      const safe = safeSrcset(raw);
      if (safe) out += ` srcset="${escapeAttr(safe)}"`;
      continue;
    }

    if (name === 'class') {
      const named = classNames(raw, prefix, classes);
      if (named) out += ` class="${escapeAttr(named)}"`;
      continue;
    }

    // aria-* is safe by construction and is most of a design's accessibility.
    if (name.startsWith('aria-')) {
      out += ` ${name}="${escapeAttr(raw.slice(0, 300))}"`;
      continue;
    }

    if (!GLOBAL_ATTRS.has(name) && !allowed.includes(name)) continue;

    /*
     * `target` gets `rel` whether the design asked for it or not. A link that
     * opens a new tab without noopener hands that tab a handle on the page it
     * came from, and a design export is exactly where that gets forgotten.
     */
    if (name === 'target') {
      out += ` target="${escapeAttr(raw.slice(0, 40))}" rel="noopener noreferrer"`;
      continue;
    }

    if (name === 'rel') continue; // Written above, beside target.

    out += ` ${name}="${escapeAttr(raw.slice(0, 2000))}"`;
  }

  return out;
}

/**
 * A class name we are willing to carry.
 *
 * WIDE ON PURPOSE, AND THIS WAS A CORRECTION. The first version of this
 * required a plain CSS identifier, `^-?[A-Za-z_][A-Za-z0-9_-]*$`, on the
 * reasoning that the CSS half had to be able to write the same name back out.
 * That reasoning was sound and the premise was wrong: the CSS half scopes by
 * ancestor and never rewrites a class name, so it never has to write one out.
 * Meanwhile the rule threw away most of a real export, because a Relume design
 * is Tailwind and `md:flex`, `w-1/2`, `p-[10px]` and `[&>*]:mt-2` are all
 * illegal identifiers. Every class stripped is a rule in the stylesheet with
 * nothing left to match, so the test was quietly deleting the design.
 *
 * So the bar is printable ASCII and nothing else. Control characters cannot
 * appear, non-ASCII cannot appear (a homoglyph is a class name waiting to be
 * mistaken for the one it resembles), and the double quote cannot appear.
 * escapeAttr would neutralise that last one, and not admitting it means never
 * having to depend on that being true.
 *
 * Written as a loop rather than a character class because the range that needs
 * excluding is the control characters, and writing that range in a regex is how
 * a literal control byte ends up in the source, invisible in the diff. Same
 * warning as safeImportUrl carries, for the same reason.
 */
function usableClassName(name: string): boolean {
  if (name.length === 0 || name.length > 120) return false;

  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) return false;
    if (ch === '"') return false;
  }

  return true;
}

/**
 * Class names, recorded and optionally prefixed.
 *
 * A NAME AT A TIME rather than the attribute as a whole, so that one unusable
 * name costs its own class and not the element's entire styling.
 *
 * THE PREFIX IS OFF BY DEFAULT. It exists for the recogniser path, where an
 * imported fragment is being rebuilt as native content and its leftover classes
 * should not look like ours. For a frozen import it is the wrong tool: the
 * stylesheet is confined by an ancestor selector, which already stops two
 * imports colliding, and prefixing a Tailwind class would mean rewriting the
 * escaped form in the CSS to match.
 */
function classNames(value: string, prefix: string, seen: Set<string>): string {
  const kept: string[] = [];

  for (const name of value.split(/\s+/).filter(Boolean).slice(0, 120)) {
    if (!usableClassName(name)) continue;
    const prefixed = prefix ? `${prefix}${name}` : name;
    seen.add(prefixed);
    kept.push(prefixed);
  }

  return kept.join(' ');
}
