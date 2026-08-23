/**
 * The parser-free half of the import pipeline.
 *
 * WHY IT IS A MODULE RATHER THAN A FEW FUNCTIONS WHERE THEY WERE. Everything
 * here is plain string work, but it used to sit in html.ts and tokenise.ts
 * beside the parse5 walks. The renderer needs exactly these pieces to put a
 * client's words into an already-cleaned design, and importing them from there
 * dragged the whole parser into the browser for the sake of a regular
 * expression. Splitting the file is what lets the editor canvas substitute a
 * slot without shipping a parser. See task #94.
 *
 * MOVED VERBATIM, deliberately. Not one character of the escaping or the URL
 * check changed on the way across, because this is the code that decides what a
 * stranger's markup is allowed to put on a client's page, and a tidy-up during a
 * move is how a sanitiser quietly loses a rule. html.ts and tokenise.ts re-export
 * their old names, so every existing caller still reads the same way.
 */

/** What a slot holds, which decides how it is edited and how it is escaped. */
export type ImportFieldKind = 'text' | 'image' | 'link';

export interface ImportField {
  /** `t1`, `i2`, `u3`. Short because it is written into the markup. */
  key: string;
  kind: ImportFieldKind;
  /** What the properties pane calls it, taken from the design itself. */
  label: string;
  /** What the design said, which is the starting value. */
  value: string;
}

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

export const TOKEN = /\{\{tg:([a-z]\d{1,3})\}\}/g;

export function token(key: string): string {
  return `{{tg:${key}}}`;
}

/**
 * Put the client's words back into the design.
 *
 * ESCAPED BY WHAT THE SLOT IS, not by where it happens to sit. A text slot is
 * escaped as text, an image or a link goes through the same URL allowlist the
 * cleaner uses, so a client typing `javascript:` into a link field gets nothing
 * rather than a working one. Neither is a second line of defence for the
 * import: it is the first and only one for what the CLIENT types, which the
 * import pipeline has never seen.
 *
 * A slot with nothing stored falls back to what the design said, so a section
 * added and never edited looks exactly like the design it came from.
 */
export function applyImportContent(
  html: string,
  values: Record<string, unknown>,
  fields: readonly ImportField[],
): string {
  const byKey = new Map(fields.map((field) => [field.key, field]));

  /*
   * ONE PASS. String.replace with a function never re-reads what it has just
   * written, so a client whose words happen to contain `{{tg:t1}}` gets those
   * characters on the page rather than a second substitution.
   */
  return html.replace(TOKEN, (whole, key: string) => {
    const field = byKey.get(key);
    if (!field) return '';

    const stored = values[key];
    const value = typeof stored === 'string' ? stored : field.value;

    if (field.kind === 'text') return escapeText(value);

    const safe = safeImportUrl(value);
    if (safe === null) return '';

    // An attribute value, and the cleaner has already written the quotes.
    return escapeText(safe).replace(/"/g, '&quot;');
  });
}
