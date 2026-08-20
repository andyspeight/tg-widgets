/**
 * HTML sanitisation.
 *
 * Two things in this CMS carry HTML: the `text` block's rich text, and the
 * `embed` block. This module is the door both go through.
 *
 * The rule from the security skill is sanitise on save AND again on render,
 * because stored HTML is never trusted. Every one of those calls lands here, so
 * there is one place to audit rather than two.
 *
 * DESIGN NOTE
 * The tag walk below is a conservative allowlist tokeniser, not a full HTML
 * parser. It errs towards dropping what it does not understand, which is the
 * right trade for RICH TEXT, because we also control the editor producing it
 * and the allowlist is twenty tags wide.
 *
 * It is NOT the right trade for markup a stranger pasted, and this file used to
 * say so, ending "until then, the embed block stays staff-only". On 20 Aug 2026
 * Andy needed that block open to every client, because pasting an embed code is
 * how some of our widgets get added. So the prerequisite was built rather than
 * waived: embed mode is handed to lib/content/sanitise-embed.ts, which parses
 * with parse5 and rebuilds the markup from values it has checked itself. The
 * interface here did not change, which is what that old note was buying.
 */

import { sanitiseEmbedHtml } from './sanitise-embed';
import { sanitiseStyle } from './styles';

/**
 * Tags allowed in rich text, mapped to the attributes each may carry.
 *
 * `style` is on nearly all of them, and the allowlist that matters for it is in
 * lib/content/styles.ts rather than here: the attribute is admitted, and then
 * every property and every value inside it has to be named before it survives.
 * That is what lets the toolbar offer a colour and a size without a free-text
 * style attribute being the price. `br` has none because there is nothing to
 * paint.
 */
const RICH_TEXT_TAGS: Record<string, readonly string[]> = {
  p: ['style'],
  br: [],
  strong: ['style'],
  b: ['style'],
  em: ['style'],
  i: ['style'],
  u: ['style'],
  s: ['style'],
  a: ['href', 'title', 'target', 'rel', 'style'],
  ul: ['style'],
  ol: ['style'],
  li: ['style'],
  h2: ['style'],
  h3: ['style'],
  h4: ['style'],
  blockquote: ['style'],
  code: [],
  pre: [],
  span: ['style'],
  sup: ['style'],
  sub: ['style'],
  /*
   * NO `font` TAG, deliberately.
   *
   * A browser asked for a colour through execCommand reaches for <font color>,
   * which is why the toolbar does not ask it: colour, size and family are
   * applied by wrapping the selection ourselves (see TextToolbar's applyInline),
   * so the value stored is the theme token we chose rather than whatever the
   * browser resolved it to. A <font> reaching here therefore did not come from
   * us. Allowing it would mean translating three presentational attributes into
   * the CSS they mean, which is surface bought for a case that should not
   * happen. Dropped, and because the tag walk keeps what is inside an unknown
   * tag, the words survive even if the colour does not.
   */
};

/**
 * Tags allowed inside a HEADING, which is a strict subset of the above.
 *
 * WHY A THIRD MODE RATHER THAN REUSING RICH TEXT
 *
 * Andy, 31 Jul 2026: "the text toolbar only appears on paragraph text, it needs
 * to work on every style of text". Giving a heading rich text is what makes that
 * possible, and it cannot simply be the paragraph's allowlist, because a heading
 * is an h2, h3 or h4 element and this list is what may legally live inside one.
 *
 * A `p`, a `ul` or a `blockquote` inside an h2 is invalid HTML. Browsers do not
 * refuse it, they SILENTLY RESTRUCTURE it: the block element is hoisted out of
 * the heading and becomes its sibling, so the second half of a heading falls out
 * of the heading and the page layout quietly changes. A nested h3 is worse,
 * because it also corrupts the document outline a screen reader navigates by.
 *
 * Everything that survives is inline, which is exactly the set the toolbar's
 * commands produce for a heading: bold, italics, underline, strike, a link, and
 * a span carrying a colour, size or family from lib/content/styles.ts. No `br`
 * either, because Enter is refused in a heading (see Canvas.tsx) and a heading
 * that wraps does so on its own.
 */
const HEADING_TAGS: Record<string, readonly string[]> = {
  strong: ['style'],
  b: ['style'],
  em: ['style'],
  i: ['style'],
  u: ['style'],
  s: ['style'],
  a: ['href', 'title', 'target', 'rel', 'style'],
  span: ['style'],
  sup: ['style'],
  sub: ['style'],
};

/** Tags additionally allowed inside a staff embed. */
const EMBED_TAGS: Record<string, readonly string[]> = {
  ...RICH_TEXT_TAGS,
  div: ['class'],
  section: ['class'],
  figure: ['class'],
  figcaption: ['class'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  picture: [],
  source: ['srcset', 'type', 'media'],
  iframe: ['src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'loading'],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
};

/** Void elements, emitted self-closing. */
const VOID_TAGS = new Set(['br', 'img', 'source']);

/** Hosts an iframe may point at. Anything else is dropped entirely. */
const IFRAME_HOSTS = new Set([
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'www.google.com',
  'maps.google.com',
]);

export type SanitiseMode = 'richtext' | 'heading' | 'embed';

const ALLOWED_BY_MODE: Record<SanitiseMode, Record<string, readonly string[]>> = {
  richtext: RICH_TEXT_TAGS,
  heading: HEADING_TAGS,
  embed: EMBED_TAGS,
};

/**
 * Sanitise an HTML string against the allowlist for the given mode.
 * Always returns a string. Never throws.
 */
export function sanitiseHtml(input: unknown, mode: SanitiseMode = 'richtext'): string {
  if (typeof input !== 'string' || input.length === 0) return '';

  /*
   * EMBED IS PARSER-BACKED AND LIVES ELSEWHERE, since 20 Aug 2026.
   *
   * The header above used to end "until then, the embed block stays staff-only",
   * because a regex walk over HTML a stranger pasted is how mutation XSS gets
   * in. Andy needed the block open to every client, so the prerequisite was
   * built rather than skipped: lib/content/sanitise-embed.ts parses with parse5
   * and rebuilds the markup from values it checked itself.
   *
   * The two are still one call for every caller, so the save path and the
   * renderer did not have to learn anything new. The tag walk below now guards
   * only the rich text our own toolbar produces, which is the job it is
   * actually sound for.
   */
  if (mode === 'embed') return sanitiseEmbedHtml(input);

  /*
   * A map rather than a chain of ternaries, so a fourth mode is one line here
   * and cannot accidentally fall through to rich text, which is the most
   * permissive of the three that a client can reach.
   */
  const allowed = ALLOWED_BY_MODE[mode] ?? RICH_TEXT_TAGS;

  // Strip anything whose CONTENT is dangerous, not just its tag. Dropping
  // only the <script> tag would leave its body behind as visible text, and
  // for <style> it would leak CSS into the page.
  let html = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<(?:script|style)\b[^>]*>/gi, '')
    .replace(/<\/?(?:noscript|template|object|embed|applet|form|input|button|select|textarea|link|meta|base|svg|math)\b[^>]*>/gi, '');

  const openStack: string[] = [];

  html = html.replace(
    // A tag name, then attributes where quoted runs may contain '>'.
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g,
    (_match, closing: string, rawName: string, rawAttrs: string) => {
      const name = rawName.toLowerCase();
      const permitted = allowed[name];

      // Unknown tag: drop the tag, keep whatever is inside it.
      if (!permitted) return '';

      if (closing) {
        if (VOID_TAGS.has(name)) return '';
        const index = openStack.lastIndexOf(name);
        if (index === -1) return '';
        openStack.splice(index, 1);
        return `</${name}>`;
      }

      const attrs = filterAttributes(name, rawAttrs, permitted);
      if (attrs === null) return ''; // e.g. an iframe pointing somewhere we do not allow

      if (VOID_TAGS.has(name)) return `<${name}${attrs} />`;

      openStack.push(name);
      return `<${name}${attrs}>`;
    },
  );

  // Anything still looking like a tag was not matched above, so it is
  // malformed. Escape it rather than leaving it to the browser's parser.
  html = html.replace(/<(?![a-zA-Z/!])/g, '&lt;');

  // Close anything the author left open, innermost first.
  while (openStack.length > 0) {
    html += `</${openStack.pop()}>`;
  }

  return html;
}

/** Strip every tag and return readable text. Used for previews and summaries. */
export function htmlToText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

/**
 * Returns the attribute string to emit (with a leading space), or null if
 * the whole element should be dropped.
 */
function filterAttributes(
  tag: string,
  rawAttrs: string,
  permitted: readonly string[],
): string | null {
  const out: string[] = [];
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';

    // Event handlers and anything that can execute never survive, even if
    // some future edit accidentally adds them to an allowlist.
    if (name.startsWith('on')) continue;
    if (!permitted.includes(name)) continue;

    if (name === 'href' || name === 'src' || name === 'srcset') {
      const safe = safeUrl(value, { allowContact: name === 'href' });
      if (!safe) {
        // A dead iframe or image is worse than none. Drop the element.
        if (tag === 'iframe' || tag === 'img' || tag === 'source') return null;
        continue;
      }
      if (tag === 'iframe' && !allowedIframeUrl(safe)) return null;
      out.push(`${name}="${escapeAttribute(safe)}"`);
      continue;
    }

    if (name === 'style') {
      /*
       * Every property and every value has to be named in styles.ts before it
       * survives. An empty result means nothing in the attribute was allowed, so
       * the attribute goes rather than being emitted as style="".
       */
      const clean = sanitiseStyle(value);
      if (clean) out.push(`style="${escapeAttribute(clean)}"`);
      continue;
    }

    if (name === 'target') {
      // Only _blank is useful, and it must not be able to reach window.opener.
      if (value !== '_blank') continue;
      out.push('target="_blank"');
      continue;
    }

    if (name === 'allowfullscreen') {
      out.push('allowfullscreen');
      continue;
    }

    if (name === 'width' || name === 'height' || name === 'colspan' || name === 'rowspan') {
      const numeric = String(parseInt(value, 10));
      if (numeric === 'NaN') continue;
      out.push(`${name}="${numeric}"`);
      continue;
    }

    out.push(`${name}="${escapeAttribute(value)}"`);
  }

  // Any link opening a new tab gets rel="noopener noreferrer", whatever the
  // author wrote.
  if (tag === 'a') {
    const opensNewTab = out.some((attr) => attr === 'target="_blank"');
    const relIndex = out.findIndex((attr) => attr.startsWith('rel='));
    if (opensNewTab) {
      if (relIndex >= 0) out.splice(relIndex, 1);
      out.push('rel="noopener noreferrer"');
    } else if (relIndex >= 0) {
      out.splice(relIndex, 1);
    }
  }

  return out.length > 0 ? ` ${out.join(' ')}` : '';
}

/**
 * Validate a URL. Returns the URL to emit, or null to reject.
 * Allows same-site relative URLs, https, http, mailto and tel.
 */
export function safeUrl(value: unknown, options: { allowContact?: boolean } = {}): string | null {
  if (typeof value !== 'string') return null;

  // Control characters are how javascript&#58; style bypasses are smuggled in.
  // Escape sequences, not literal control bytes. Raw bytes here survive
  // Node's parser but get mangled by a bundler, which turns this into an
  // invalid character class at runtime.
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;

  // Relative, anchor, or query. No scheme, so nothing to abuse.
  if (/^[/?#]/.test(trimmed)) {
    // Protocol-relative '//evil.com' is a scheme in disguise.
    if (trimmed.startsWith('//')) return null;
    return trimmed;
  }

  const scheme = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!scheme) {
    // No scheme and not clearly relative: treat as a relative path.
    return /^[\w.\-]+(?:\/|$)/.test(trimmed) ? trimmed : null;
  }

  const protocol = scheme[1].toLowerCase();
  if (protocol === 'https' || protocol === 'http') return trimmed;
  /*
   * mailto: and tel: TOGETHER, under one option, because they are one decision:
   * "may this link reach a person rather than a page". Neither can execute
   * anything — a browser hands them to a mail client or a dialler — so the only
   * question is whether the caller is somewhere a contact link makes sense.
   *
   * The option was called allowMailto until 20 Aug 2026 and gated tel: as well,
   * which is how seven of the eight block renderers came to omit it: it reads
   * like an email-only flag, so nobody adding a link field thought it applied to
   * a phone number. Renamed for what it does.
   */
  if ((protocol === 'mailto' || protocol === 'tel') && options.allowContact) return trimmed;

  return null;
}

function allowedIframeUrl(url: string): boolean {
  try {
    /*
     * A base only so a relative URL does not throw. Nothing from it is emitted.
     *
     * .invalid is reserved by RFC 2606 and can never be registered, which is the
     * point: this used to be tgsites.io, a domain we do not own, and a base that
     * names a REAL host is one line away from being a hole. If that host ever
     * appeared in IFRAME_HOSTS, every relative URL would resolve to it and pass.
     */
    const parsed = new URL(url, 'https://base.invalid');
    if (parsed.protocol !== 'https:') return false;
    return IFRAME_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape text for safe interpolation into HTML. */
export function escapeHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
