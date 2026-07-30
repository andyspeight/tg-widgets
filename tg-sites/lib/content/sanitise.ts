/**
 * HTML sanitisation.
 *
 * Two things in this CMS carry HTML: the `text` block's rich text, and the
 * staff-only `embed` block. Both are sanitised here.
 *
 * The rule from the security skill is sanitise on save AND again on render,
 * because stored HTML is never trusted. This module is the single place both
 * of those calls land, so there is one allowlist to audit rather than two.
 *
 * DESIGN NOTE
 * This is a conservative allowlist tokeniser, not a full HTML parser. It errs
 * towards dropping things it does not understand. That is the right trade for
 * a CMS where we also control the editor producing the markup.
 *
 * Before real client content ships, swap the tag walk for a parser-backed
 * sanitiser (DOMPurify under jsdom on the server). The interface here is
 * deliberately narrow so that swap is a one-file change. Until then, the
 * embed block stays staff-only.
 */

/** Tags allowed in rich text, mapped to the attributes each may carry. */
const RICH_TEXT_TAGS: Record<string, readonly string[]> = {
  p: [],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  a: ['href', 'title', 'target', 'rel'],
  ul: [],
  ol: [],
  li: [],
  h2: [],
  h3: [],
  h4: [],
  blockquote: [],
  code: [],
  pre: [],
  span: [],
  sup: [],
  sub: [],
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

export type SanitiseMode = 'richtext' | 'embed';

/**
 * Sanitise an HTML string against the allowlist for the given mode.
 * Always returns a string. Never throws.
 */
export function sanitiseHtml(input: unknown, mode: SanitiseMode = 'richtext'): string {
  if (typeof input !== 'string' || input.length === 0) return '';

  const allowed = mode === 'embed' ? EMBED_TAGS : RICH_TEXT_TAGS;

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
      const safe = safeUrl(value, { allowMailto: name === 'href' });
      if (!safe) {
        // A dead iframe or image is worse than none. Drop the element.
        if (tag === 'iframe' || tag === 'img' || tag === 'source') return null;
        continue;
      }
      if (tag === 'iframe' && !allowedIframeUrl(safe)) return null;
      out.push(`${name}="${escapeAttribute(safe)}"`);
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
export function safeUrl(value: unknown, options: { allowMailto?: boolean } = {}): string | null {
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
  if (protocol === 'mailto' && options.allowMailto) return trimmed;
  if (protocol === 'tel' && options.allowMailto) return trimmed;

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
