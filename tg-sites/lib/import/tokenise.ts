/**
 * Making an imported design editable.
 *
 * WHY THIS EXISTS AT ALL. A frozen block of somebody else's markup on a page is
 * a picture of a design, not a website. Andy's whole reason for us building a
 * CMS rather than buying one was designs that arrive from Relume, Figma or the
 * slicer AND STAY EDITABLE, so a client can change "Escape to Crete" to
 * "Escape to Rhodes" without opening a code editor or asking us.
 *
 * THE ANSWER IS THE ONE TG SLICER ALREADY LANDED ON. Walk the cleaned markup,
 * take every scrap of real content out of it, and leave a numbered slot behind.
 * The design keeps its structure and its styling, which is the part nobody
 * wants to retype, and the words and pictures become ordinary fields in the
 * properties pane. Slicer's emit-local.js does exactly this for its Duda build
 * sheets, so a client who has seen one will recognise the other.
 *
 * WHAT COUNTS AS CONTENT: text with a letter or a digit in it, image sources,
 * and link destinations. Not the classes, not the layout, not the icons.
 *
 * WHY THE ICONS ARE LEFT ALONE. An inline SVG is full of text nodes: the `d` of
 * a path is not words, and a <title> inside one is the icon's accessible name
 * rather than anything a client would want to rewrite. Tokenising them would
 * bury the six real fields on the section under forty pieces of noise, which is
 * the same as having no fields at all.
 *
 * THE SLOTS SURVIVE BEING RE-CLEANED, and they have to. Stored HTML is never
 * trusted here, so the renderer runs the whole thing back through
 * cleanImportHtml before it draws anything, and only then puts the client's
 * words in. A slot is plain text with no scheme and no markup in it, so it
 * comes out of that unchanged.
 */

import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

/*
 * The slot shape, the token pattern and the substitution moved to ./slots, so
 * the renderer can use them without parse5 (task #94). Re-exported here because
 * this is where callers already look.
 */
import { TOKEN, token, type ImportField, type ImportFieldKind } from './slots';
export { applyImportContent, TOKEN } from './slots';
export type { ImportField, ImportFieldKind } from './slots';

type ChildNode = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];


export interface TokeniseResult {
  html: string;
  fields: ImportField[];
}

export interface TokeniseOptions {
  /**
   * How many slots to make.
   *
   * A cap rather than no limit, because a whole page pasted as one section
   * would otherwise produce a properties pane hundreds of fields long, which
   * nobody can use. Past the cap the content stays in the markup exactly as the
   * design wrote it: still correct on the page, just not editable here.
   */
  maxFields?: number;
}

/** The slot marker, and the one shape everything here agrees on. */

/**
 * Whether a run of text is content or furniture.
 *
 * A letter or a digit somewhere in it. That rules out the whitespace between
 * two tags, and the lone bullets, arrows and pipes a design uses as separators,
 * which are drawing rather than words.
 */
function looksLikeContent(value: string): boolean {
  return /[A-Za-z0-9]/.test(value);
}

/** A short name for the properties pane, from the content itself. */
function labelFrom(value: string, fallback: string): string {
  const words = value.trim().replace(/\s+/g, ' ');
  if (!words) return fallback;
  return words.length > 44 ? `${words.slice(0, 44).trimEnd()}...` : words;
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

/** The text of an element, for naming a link's slot after what it says. */
function textOf(node: Element): string {
  let out = '';
  for (const child of (node.childNodes ?? []) as ChildNode[]) {
    if (child.nodeName === '#text') out += (child as { value?: string }).value ?? '';
    else if (isElement(child)) out += textOf(child);
  }
  return out;
}

/**
 * Take the content out of a cleaned design and leave numbered slots behind.
 *
 * The markup that comes back still has to go through cleanImportHtml before it
 * reaches a page. This function does not sanitise anything and is not the place
 * to start: it is given already-clean markup and its only job is to decide what
 * a client should be able to change.
 */
export function tokeniseImport(html: string, options: TokeniseOptions = {}): TokeniseResult {
  const maxFields = options.maxFields ?? 60;
  const fields: ImportField[] = [];

  /*
   * A design that already contains the marker would have a client's words
   * appear where it asked for the literal text. Nothing legitimate looks like
   * this, and it is cheaper to refuse it than to invent an escape for it.
   */
  const source = html.replace(TOKEN, '');

  let texts = 0;
  let images = 0;
  let links = 0;

  const add = (kind: ImportFieldKind, key: string, label: string, value: string): boolean => {
    if (fields.length >= maxFields) return false;
    fields.push({ key, kind, label, value });
    return true;
  };

  const walk = (nodes: ChildNode[], insideSvg: boolean): void => {
    for (const node of nodes) {
      if (node.nodeName === '#text') {
        if (insideSvg) continue;

        const raw = (node as { value?: string }).value ?? '';
        if (!looksLikeContent(raw)) continue;

        /*
         * The whitespace around the words is kept and only the middle becomes a
         * slot. "Hello " before a <strong> is a text node whose trailing space
         * is doing real work, and swallowing it into the slot would run the two
         * words together the moment anybody edited either.
         */
        const lead = raw.slice(0, raw.length - raw.trimStart().length);
        const trail = raw.slice(raw.trimEnd().length);
        const middle = raw.trim();

        texts += 1;
        const key = `t${texts}`;
        if (!add('text', key, labelFrom(middle, `Text ${texts}`), middle)) {
          texts -= 1;
          continue;
        }

        (node as { value: string }).value = `${lead}${token(key)}${trail}`;
        continue;
      }

      if (!isElement(node)) continue;

      const tag = node.tagName.toLowerCase();
      const svg = insideSvg || tag === 'svg';

      if (!svg) {
        for (const attr of node.attrs ?? []) {
          if (tag === 'img' && attr.name === 'src' && attr.value) {
            images += 1;
            const key = `i${images}`;
            const alt = (node.attrs ?? []).find((a) => a.name === 'alt')?.value ?? '';
            if (add('image', key, labelFrom(alt, `Image ${images}`), attr.value)) {
              attr.value = token(key);
            } else {
              images -= 1;
            }
            continue;
          }

          if (tag === 'a' && attr.name === 'href' && attr.value) {
            links += 1;
            const key = `u${links}`;
            if (add('link', key, labelFrom(textOf(node), `Link ${links}`), attr.value)) {
              attr.value = token(key);
            } else {
              links -= 1;
            }
          }
        }
      }

      walk((node.childNodes ?? []) as ChildNode[], svg);
    }
  };

  const fragment = parseFragment(source);
  walk(fragment.childNodes as ChildNode[], false);

  return { html: serialize(fragment), fields };
}


/** Every slot the markup actually uses, in the order it uses them. */
export function tokensUsed(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(TOKEN)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}
