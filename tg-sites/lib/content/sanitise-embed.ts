/**
 * The HTML block's markup, cleaned by a real parser.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT lib/content/sanitise.ts.
 *
 * That module guards rich text our own toolbar produced, and its header is
 * honest about what it is: a conservative allowlist TOKENISER, with a note
 * saying a parser-backed version was needed before real client content shipped,
 * and that until then the embed block stays staff-only.
 *
 * Andy, 20 Aug 2026: the HTML block has to be available to everyone, because
 * pasting an embed code is how some of our widgets get added. That makes this
 * module the prerequisite rather than a nicety. A regex walk over HTML a
 * stranger wrote is how MUTATION XSS happens: the sanitiser and the browser
 * disagree about where a tag ends, the sanitiser passes what IT read, and the
 * browser runs what it read instead. The rich text sanitiser survives that
 * because we control the editor writing its input. This one cannot assume it.
 *
 * THE ONE PROPERTY THAT MAKES IT SAFE, borrowed wholesale from the import
 * pipeline (lib/import/html.ts): nothing from the input is ever concatenated
 * into the output. parse5 builds a tree, this walks it, and every tag name,
 * attribute name and attribute value in the result was checked here and then
 * written by this function. There is no path by which an unparsed byte reaches
 * a page.
 *
 * WHY NOT JUST USE cleanImportHtml. Its header says, in as many words, that the
 * two must not become one another, and it is right: an import is a whole
 * document from a design tool, so it keeps structure and refuses style
 * attributes, iframes and scripts outright. An embed is the opposite shape. It
 * is small, it is usually one vendor's snippet, and the two things it most
 * needs are the ones an import refuses.
 *
 * WHAT IT ADMITS THAT NOTHING ELSE DOES: a <script> tag, and only when its src
 * is on our OWN widget origin. That is the whole point of the change. A
 * Travelgenix widget embed is a container div plus one script, so without the
 * script the div sits there empty forever, and without the container's
 * data-tg-* attributes the script has nothing to find. Both now survive.
 *
 * WHAT IT STILL REFUSES, none of it negotiable: inline script of any kind,
 * script from anybody else's origin, every on* handler, <style>, <form> and its
 * controls, <object>, <embed>, <base>, <meta>, <link>, and any URL whose scheme
 * is not http, https, mailto or tel. An iframe may point only at the same short
 * list of hosts it always could.
 */

import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

import { sanitiseStyle } from './styles';
import { WIDGET_ORIGIN } from './widgets';

type ChildNode = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];

/**
 * Hosts a <script src> may point at: ours, and only ours.
 *
 * Both spellings of the same deployment, because a client is given whichever
 * the dashboard showed them. WIDGET_ORIGIN is the canonical one and is read
 * from lib/content/widgets.ts rather than retyped, so a move cannot leave this
 * list behind pointing at a host we no longer control.
 *
 * ADDING A HOST HERE IS A SECURITY DECISION, not a configuration change. Any
 * script on this list runs with full access to the client's page.
 */
const WIDGET_HOSTS: ReadonlySet<string> = new Set(
  [WIDGET_ORIGIN, 'https://tg-widgets.vercel.app']
    .map((origin) => {
      try {
        return new URL(origin).host.toLowerCase();
      } catch {
        return '';
      }
    })
    .filter(Boolean),
);

/**
 * Hosts an iframe may point at.
 *
 * A CLOSED LIST, AND SHORT ON PURPOSE. An iframe is somebody else's page running
 * inside a client's, so each entry is a party we have decided to trust with that,
 * not a convenience. Anything not here is dropped along with the element, which
 * the client is told about rather than left with an empty box.
 *
 * calendar.google.com was added on 20 Aug 2026, at Andy's word, so a client can
 * show their own Google Calendar of departures or events. Same reasoning as the
 * two Google map hosts already here: a calendar embed is a read-only view served
 * by Google, and the client supplies nothing but the address.
 *
 * IF A CONTENT SECURITY POLICY EVER LANDS (see the note in lib/content/map.ts),
 * every host here needs a frame-src entry or the embed goes blank on a live page.
 */
const IFRAME_HOSTS: ReadonlySet<string> = new Set([
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'www.google.com',
  'maps.google.com',
  'calendar.google.com',
]);

/**
 * The tags an embed may be made of, each with the attributes it may carry.
 *
 * `style` and `class` are added to nearly everything by the walk rather than
 * repeated here, so this table says only what is particular to a tag.
 */
const EMBED_TAGS: Record<string, readonly string[]> = {
  p: [], br: [], strong: [], b: [], em: [], i: [], u: [], s: [],
  a: ['href', 'title', 'target', 'rel'],
  ul: [], ol: [], li: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  blockquote: [], code: [], pre: [], span: [], sup: [], sub: [], hr: [],
  div: [], section: [], article: [], aside: [], header: [], footer: [], nav: [],
  figure: [], figcaption: [],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  picture: [],
  source: ['srcset', 'type', 'media'],
  video: ['src', 'poster', 'controls', 'muted', 'loop', 'playsinline', 'width', 'height'],
  audio: ['src', 'controls', 'loop'],
  iframe: ['src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'loading'],
  table: [], thead: [], tbody: [], tfoot: [], tr: [],
  th: ['colspan', 'rowspan', 'scope'],
  td: ['colspan', 'rowspan'],
  caption: [],
  script: ['src', 'defer', 'async'],
};

/** Emitted self-closing. `script` is NOT one: it needs a closing tag. */
const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'source']);

/**
 * Tags dropped along with everything inside them.
 *
 * Unknown tags are UNWRAPPED instead (their content survives), so this list is
 * only for the ones whose content is itself the danger: CSS that would leak
 * into the page, form controls that would post somewhere, and the legacy plugin
 * embeds. `script` is absent because it is handled properly below.
 */
const DROP_WITH_CONTENTS: ReadonlySet<string> = new Set([
  'style', 'noscript', 'template', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'textarea', 'option', 'label',
  'link', 'meta', 'base', 'title', 'svg', 'math', 'canvas',
]);

/** `<` and `&` are the two that matter; `>` closes a tag a stray `<` opened. */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A URL an embed may point at, or null.
 *
 * Deliberately its own function rather than safeUrl from sanitise.ts: importing
 * that would make the two modules circular, since sanitise.ts hands embed mode
 * to this one. It is also a different policy, because an embed has no business
 * carrying a `data:` URL of any kind.
 */
function safeEmbedUrl(value: string): string | null {
  /*
   * Control characters are how `java<NUL>script:` style bypasses are smuggled
   * in. Written as ESCAPE SEQUENCES rather than literal control bytes: raw
   * bytes survive Node's parser and then get mangled by a bundler into an
   * invalid character class at runtime. sanitise.ts says the same thing in
   * the same place, having been caught by it.
   */
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!trimmed || trimmed.length > 2048) return null;

  // Relative, anchor or query. No scheme, so nothing to abuse. A
  // protocol-relative `//evil.com` is a scheme in disguise and is refused.
  if (/^[/?#]/.test(trimmed)) return trimmed.startsWith('//') ? null : trimmed;

  const scheme = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!scheme) return /^[\w.\-]+(?:\/|$)/.test(trimmed) ? trimmed : null;

  const protocol = scheme[1].toLowerCase();
  return protocol === 'https' || protocol === 'http' || protocol === 'mailto' || protocol === 'tel'
    ? trimmed
    : null;
}

/** The host of an absolute https URL, lowercased, or null for anything else. */
function httpsHost(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Is this a script we are willing to run on a client's page?
 *
 * Three conditions, all required. It must have a src, that src must resolve to
 * one of OUR hosts over https, and it must carry no inline code. The third is
 * belt and braces, since a browser ignores the body of a script that has a src,
 * but a sanitiser should not depend on that to be safe.
 */
function widgetScriptSrc(node: Element): string | null {
  const src = node.attrs?.find((attr) => attr.name.toLowerCase() === 'src')?.value ?? '';
  if (!src) return null;

  const safe = safeEmbedUrl(src);
  if (!safe) return null;

  const host = httpsHost(safe);
  if (!host || !WIDGET_HOSTS.has(host)) return null;

  const hasInlineCode = (node.childNodes ?? []).some(
    (child) => child.nodeName === '#text' && ((child as { value?: string }).value ?? '').trim() !== '',
  );
  return hasInlineCode ? null : safe;
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

/**
 * The attributes one element may keep, rebuilt from checked values.
 *
 * `data-*` survives on everything, which is what carries a widget's
 * data-tg-widget and data-tg-id. A data attribute is inert markup: it does
 * nothing on its own, and the only script that could read it is one of ours.
 *
 * NO `id`, for the same reason the import pipeline refuses it, plus one more.
 * Two embeds on a page would collide, and an element with an id can shadow a
 * same-named property on `document` or `window` (DOM clobbering), which is a
 * real way to confuse other scripts on the page. Nothing a widget needs.
 */
function attributes(node: Element, tag: string): string {
  const permitted = EMBED_TAGS[tag] ?? [];
  let out = '';

  for (const attr of node.attrs ?? []) {
    const name = attr.name.toLowerCase();
    const raw = attr.value ?? '';

    // Every event handler, always, whatever the tag. The allowlist below would
    // refuse them anyway; this is the line that must never be reachable.
    if (name.startsWith('on')) continue;

    if (name === 'data' || name === 'id') continue;

    if (name.startsWith('data-')) {
      // A name with anything but letters, digits and dashes in it is not a
      // data attribute somebody typed, it is somebody probing the parser.
      if (!/^data-[a-z0-9-]+$/.test(name)) continue;
      out += ` ${name}="${escapeAttr(raw.slice(0, 300))}"`;
      continue;
    }

    if (name === 'class') {
      const value = raw.replace(/[^\w\s-]/g, '').trim().slice(0, 300);
      if (value) out += ` class="${escapeAttr(value)}"`;
      continue;
    }

    if (name === 'style') {
      const value = sanitiseStyle(raw);
      if (value) out += ` style="${escapeAttr(value)}"`;
      continue;
    }

    if (!permitted.includes(name)) continue;

    // The URL-bearing ones, each checked against what that tag may point at.
    if (name === 'src' || name === 'href' || name === 'poster') {
      // A script's src was resolved before we got here, and an iframe's host is
      // checked below; both are written by the caller rather than here.
      if (tag === 'script') continue;

      const safe = safeEmbedUrl(raw);
      if (!safe) continue;

      if (tag === 'iframe' && name === 'src') {
        const host = httpsHost(safe);
        if (!host || !IFRAME_HOSTS.has(host)) continue;
      }

      out += ` ${name}="${escapeAttr(safe)}"`;
      continue;
    }

    if (name === 'srcset') {
      // Each candidate is a URL plus an optional descriptor. Rebuilt from the
      // parts that pass rather than passed through as one string.
      const kept = raw
        .split(',')
        .map((candidate) => {
          const [url, ...rest] = candidate.trim().split(/\s+/);
          const safe = url ? safeEmbedUrl(url) : null;
          if (!safe) return null;
          const descriptor = rest.join(' ').replace(/[^\w.\s]/g, '').slice(0, 20);
          return descriptor ? `${safe} ${descriptor}` : safe;
        })
        .filter((candidate): candidate is string => candidate !== null);
      if (kept.length) out += ` srcset="${escapeAttr(kept.join(', '))}"`;
      continue;
    }

    if (name === 'target') {
      // A new tab always gets the opener severed with it. Without noopener the
      // page opened can reach back through window.opener and navigate ours.
      out += ` target="${escapeAttr(raw.slice(0, 40))}" rel="noopener noreferrer"`;
      continue;
    }

    // A bare boolean (controls, muted, allowfullscreen, defer, async) keeps its
    // name and nothing else.
    if (raw === '') {
      out += ` ${name}`;
      continue;
    }

    out += ` ${name}="${escapeAttr(raw.slice(0, 500))}"`;
  }

  return out;
}

export interface EmbedCleanResult {
  html: string;
  /** What was thrown away, so a screen can say so rather than silently differ. */
  removed: string[];
}

/**
 * Clean a fragment of embed HTML, and say what was dropped.
 *
 * Never throws. Malformed input is what parse5 is for: it produces a tree for
 * anything, and a tree is what this walks.
 */
export function cleanEmbedHtml(source: unknown): EmbedCleanResult {
  if (typeof source !== 'string' || source.length === 0) return { html: '', removed: [] };

  const removed: string[] = [];
  const note = (what: string) => {
    if (!removed.includes(what)) removed.push(what);
  };

  const MAX_DEPTH = 30;
  const MAX_ELEMENTS = 500;
  let elements = 0;

  const walk = (nodes: readonly ChildNode[], depth: number): string => {
    if (depth > MAX_DEPTH) {
      note('content nested too deeply');
      return '';
    }

    let out = '';

    for (const node of nodes) {
      if (node.nodeName === '#text') {
        out += escapeText((node as { value?: string }).value ?? '');
        continue;
      }

      // Comments go entirely: they can carry conditional-comment markup, and an
      // embed has no use for them.
      if (node.nodeName === '#comment') continue;
      if (!isElement(node)) continue;

      const tag = node.tagName.toLowerCase();
      const children = (node.childNodes ?? []) as ChildNode[];

      if (DROP_WITH_CONTENTS.has(tag)) {
        note(`<${tag}>`);
        continue;
      }

      if (elements >= MAX_ELEMENTS) {
        note('the embed was larger than we allow in one block');
        break;
      }

      /*
       * THE SCRIPT RULE. Ours runs, everybody else's is dropped with a note, so
       * a client pasting a third-party snippet is told rather than left staring
       * at a box that never fills.
       */
      if (tag === 'script') {
        const src = widgetScriptSrc(node);
        if (!src) {
          note('a script that was not one of ours');
          continue;
        }
        elements += 1;
        const defer = (node.attrs ?? []).some((attr) => attr.name.toLowerCase() === 'defer');
        const async = (node.attrs ?? []).some((attr) => attr.name.toLowerCase() === 'async');
        out += `<script src="${escapeAttr(src)}"${defer ? ' defer' : ''}${async ? ' async' : ''}></script>`;
        continue;
      }

      /*
       * A TAG WHOSE WHOLE PURPOSE IS ITS URL GOES WITH THE URL.
       *
       * Stripping a refused src and keeping the element leaves `<iframe></iframe>`
       * or a broken-image icon: a visible empty box on a client's page, which
       * reads as a fault rather than as something we declined. So the element
       * goes too, and the client is told what was dropped.
       */
      if (tag === 'iframe' || tag === 'img') {
        const src = node.attrs?.find((attr) => attr.name.toLowerCase() === 'src')?.value ?? '';
        const safe = src ? safeEmbedUrl(src) : null;
        const host = safe && tag === 'iframe' ? httpsHost(safe) : null;
        const usable = tag === 'iframe' ? Boolean(host && IFRAME_HOSTS.has(host)) : Boolean(safe);
        if (!usable) {
          note(tag === 'iframe' ? 'a frame from a site we do not embed' : 'an image with no usable address');
          continue;
        }
      }

      if (!EMBED_TAGS[tag]) {
        /*
         * UNKNOWN, SO UNWRAPPED RATHER THAN DROPPED. A tag we have no opinion
         * about is usually a custom element, and its CONTENT is still content.
         * Losing the wrapper costs some layout; losing the words costs the page.
         */
        note(`<${tag}>`);
        out += walk(children, depth + 1);
        continue;
      }

      elements += 1;

      out += `<${tag}`;
      out += attributes(node, tag);

      if (VOID_TAGS.has(tag)) {
        out += ' />';
        continue;
      }

      out += '>';
      out += walk(children, depth + 1);
      out += `</${tag}>`;
    }

    return out;
  };

  const html = walk(parseFragment(source).childNodes as ChildNode[], 0);
  return { html, removed };
}

/** The markup alone, for the save and render paths that only want the string. */
export function sanitiseEmbedHtml(source: unknown): string {
  return cleanEmbedHtml(source).html;
}
