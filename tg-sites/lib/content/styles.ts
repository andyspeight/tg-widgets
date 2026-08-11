/**
 * What inline CSS is allowed to survive a save.
 *
 * WHY THIS EXISTS
 *
 * The sanitiser used to drop every `style` attribute, which was the safe answer
 * and the wrong one. It meant a colour picker or a size picker in the toolbar
 * would look like it worked and then quietly lose the formatting on save, so
 * those controls were left out and Andy asked for them back on 30 Jul 2026:
 * "we need to overcome the problem you raised with losing on saving and get a
 * much better text toolbar".
 *
 * THE RULE: A CLOSED SET, NOT A BLOCKED SET
 *
 * A free-text style attribute is a real hole. Not for scripts any more, but for
 * `background: url(https://someone-else/pixel)`, which turns a paragraph into a
 * tracking beacon, and for `position: fixed; inset: 0; z-index: 9999`, which
 * turns one into an invisible sheet over the whole page that swallows clicks.
 *
 * So this module names the properties that are allowed, and for each of them
 * the exact shapes of value that are allowed. Anything else is dropped. There is
 * no blocklist to keep ahead of, because nothing gets through without a rule
 * saying it may. A new property means a new entry here and a test, which is the
 * point at which somebody has to think about it.
 *
 * Every validator is anchored end to end and returns a NORMALISED value rather
 * than the input, so what is stored is our string and not the author's. That is
 * what stops a value being waved through by a check and then meaning something
 * else to a browser.
 *
 * WHEN A CONTENT SECURITY POLICY IS ADDED TO THE RENDERED SITE, READ THIS
 *
 * Everything this module allows is emitted as a `style` ATTRIBUTE, and a CSP
 * with a `style-src` directive blocks those unless it carries `unsafe-inline`.
 * So a CSP added without thinking about it will not error, will not warn, and
 * will silently strip the colour off every phrase a client has coloured. The
 * options at that point are `style-src 'unsafe-inline'`, which gives away most
 * of what a style-src is for, or moving these to generated classes. Neither is a
 * five-minute change, which is why it is written down here rather than found.
 */

/**
 * Theme tokens a client may point at.
 *
 * Listed rather than matched with a pattern like `--tgs-[a-z-]+`. A pattern
 * would quietly admit every token invented later, including ones that are not
 * colours at all, and `var(--tgs-radius-lg)` as a text colour is a paragraph
 * that renders in whatever the browser makes of it.
 *
 * EXPORTED SINCE 2 AUG 2026 so `safeColour` in schema.ts can share it rather
 * than keep a second copy. That function's own comment has always said it takes
 * "hex, rgb/rgba and the theme token names" and it never took the token names,
 * which is how a tinted panel became a design nobody could express: a column
 * background could only be a frozen hex, and a frozen hex in a preset is a
 * colour that stops matching the day a client changes their theme.
 */
export const COLOUR_TOKENS = new Set([
  'primary',
  'primary-light',
  'accent',
  'text',
  'text-muted',
  'text-invert',
  'surface',
  'surface-alt',
  'surface-dark',
  'border',
  'border-strong',
  'on-primary',
  'on-accent',
]);

/** The named text styles, whose font and size tokens the theme screen sets. */
const TEXT_STYLES = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'] as const;

/**
 * The sizes the toolbar offers: THE SITE'S OWN, plus a small free scale.
 *
 * The named ones come first and are what most people want. They are the sizes
 * set on the Theme screen, one per text style, so a phrase set to H2 is the same
 * size as every H2 on the site and moves with it if the theme is changed later.
 * Andy asked for these on 30 Jul 2026: "You don't have all of the text sizes
 * (H1-H6 and paragraph)". The first version offered only the abstract scale
 * below, which is a different set of sizes from the ones the site actually uses,
 * so picking "Large" gave you something that matched nothing.
 *
 * The fixed scale stays underneath for the times a phrase genuinely needs to be
 * a bit bigger than the text around it without being a heading. It is a closed
 * list, and the one thing outside it, a size typed by hand, is bounded to whole
 * pixels in PX_SIZE_MIN..PX_SIZE_MAX by the validator below, so nobody can type
 * `font-size: 400vw` and push the page off the screen.
 */
export const FONT_SIZES: ReadonlyArray<{ value: string; label: string; group: string }> = [
  { value: 'var(--tgs-p-size)', label: 'Paragraph', group: 'From your theme' },
  { value: 'var(--tgs-h1-size)', label: 'H1', group: 'From your theme' },
  { value: 'var(--tgs-h2-size)', label: 'H2', group: 'From your theme' },
  { value: 'var(--tgs-h3-size)', label: 'H3', group: 'From your theme' },
  { value: 'var(--tgs-h4-size)', label: 'H4', group: 'From your theme' },
  { value: 'var(--tgs-h5-size)', label: 'H5', group: 'From your theme' },
  { value: 'var(--tgs-h6-size)', label: 'H6', group: 'From your theme' },

  { value: '0.75rem', label: 'Tiny', group: 'A fixed size' },
  { value: '0.875rem', label: 'Small', group: 'A fixed size' },
  { value: '1rem', label: 'Normal', group: 'A fixed size' },
  { value: '1.25rem', label: 'Large', group: 'A fixed size' },
  { value: '1.5rem', label: 'Bigger', group: 'A fixed size' },
  { value: '2rem', label: 'Huge', group: 'A fixed size' },
  { value: '2.5rem', label: 'Giant', group: 'A fixed size' },
];

/** The order the groups appear in, so the theme's own sizes are found first. */
export const FONT_SIZE_GROUPS = ['From your theme', 'A fixed size'] as const;

/**
 * The bounds on a size typed by hand, in whole pixels.
 *
 * The dropdown offers the theme's own sizes and a short scale, which is what
 * most people want. Andy asked on 3 Aug 2026 for a box to set any size as well:
 * "there is no manual override, only the choices that are given on the toolbar,
 * add the ability to set your own size, from 6px up to 200px". Six is about the
 * smallest that stays legible; two hundred is a line that fills a hero, and past
 * it a "size" is really a display graphic that wants an image block.
 *
 * The two numbers live here, next to the validator that enforces them, so the
 * toolbar (which clamps a typed number to this range) and the sanitiser (which
 * drops one outside it) cannot drift apart.
 */
export const PX_SIZE_MIN = 6;
export const PX_SIZE_MAX = 200;

const SIZE_VALUES = new Set(
  FONT_SIZES.map((size) => size.value).filter((value) => !value.startsWith('var(')),
);

/**
 * The colours the toolbar offers, as TOKENS rather than as hexes.
 *
 * Stored as `var(--tgs-accent)` and not as the hex it happens to resolve to
 * today, so a client who changes their brand colour on the Theme screen finds
 * that the words they coloured have changed with it. A hex would freeze them at
 * whatever the brand was on the day, and nobody would connect the two.
 *
 * Here rather than in the toolbar so that what is offered and what is allowed
 * cannot drift: both read this list.
 */
export const COLOUR_SWATCHES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'var(--tgs-text)', label: 'Body text' },
  { value: 'var(--tgs-text-muted)', label: 'Muted' },
  { value: 'var(--tgs-primary)', label: 'Brand' },
  { value: 'var(--tgs-primary-light)', label: 'Brand light' },
  { value: 'var(--tgs-accent)', label: 'Accent' },
  { value: 'var(--tgs-text-invert)', label: 'For a dark background' },
];

/** The same idea for a highlight, minus the ones nothing would read on. */
export const HIGHLIGHT_SWATCHES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'var(--tgs-surface-alt)', label: 'Subtle' },
  { value: 'var(--tgs-accent)', label: 'Accent' },
  { value: 'var(--tgs-primary)', label: 'Brand' },
  { value: 'var(--tgs-surface)', label: 'Page' },
];

/**
 * The fonts a phrase may be set in: the site's own two, and nothing else.
 *
 * Short on purpose. Andy's reference toolbar had a long list of families, and a
 * long list is only honest for a product that loads them. This site carries its
 * own fonts, chosen on the Theme screen, and a family it has not loaded renders
 * as whatever the visitor's machine happens to have. That is a different site on
 * every screen, so it is not offered.
 */
export const FONT_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'var(--tgs-font-body)', label: 'Body' },
  { value: 'var(--tgs-font-display)', label: 'Headings' },
];

/**
 * Alignments, spelled the way CSS spells them.
 *
 * `center`, with the American spelling, because this is a CSS value and CSS has
 * only one. The block's own `align` field says `centre`, because that is a value
 * of ours and the product is written in UK English. Two spellings for one idea
 * is a trap, so: this set is CSS, that field is ours, and the toolbar's alignment
 * buttons drive the field rather than this.
 */
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

/**
 * Characters that end the conversation wherever they appear in a value.
 *
 * Checked before any property is looked at, because these are the shapes that
 * smuggle something past a validator rather than values in their own right:
 * a CSS escape can spell `url` without the letters, a comment can hide the rest
 * of a declaration from a naive split, and `@` starts an at-rule.
 */
const NEVER = /url\s*\(|expression\s*\(|@|\\|\/\*|<|>/i;

type Validator = (value: string) => string | null;

const ALLOWED: Record<string, Validator> = {
  color: colourValue,
  'background-color': colourValue,
  'font-family': fontValue,
  'font-size': sizeValue,
  'font-weight': weightValue,
  'text-align': alignValue,
};

/**
 * Sanitise a style attribute. Returns the declarations to keep, or ''.
 *
 * Never throws, and never returns anything it was given verbatim.
 */
export function sanitiseStyle(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  // A style attribute long enough to matter is a style attribute somebody is
  // doing something with, and no legitimate one from this editor is near this.
  if (input.length > 600) return '';
  if (NEVER.test(input)) return '';

  const kept: string[] = [];

  for (const declaration of input.split(';')) {
    const at = declaration.indexOf(':');
    if (at === -1) continue;

    const property = declaration.slice(0, at).trim().toLowerCase();
    const raw = declaration.slice(at + 1).trim();
    if (!property || !raw) continue;

    /*
     * !important would let one phrase outrank the theme's own rules.
     *
     * UNREACHABLE TODAY, and worth saying so rather than leaving somebody to
     * work it out. Every validator below is anchored end to end, so
     * `#fff !important` already fails to match a colour and the declaration is
     * dropped without this line. Proved by deleting it: no test changed.
     *
     * It stays as the one belt-and-braces line in the file, because the cost is
     * a regex and the thing it guards against is a future validator written a
     * little more loosely than these ones.
     */
    if (/!\s*important/i.test(raw)) continue;

    const validate = ALLOWED[property];
    if (!validate) continue;

    const value = validate(raw.toLowerCase());
    if (value) kept.push(`${property}: ${value}`);
  }

  return kept.join('; ');
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * A colour: a hex, an rgb() triple, or one of the theme's own tokens.
 *
 * rgb() is here because that is what browsers hand back from a colour command:
 * setting #ff0000 and reading the style attribute afterwards gives
 * `rgb(255, 0, 0)`. Rejecting it would mean every colour applied through the
 * toolbar was dropped on save, which is the exact bug this module exists to fix.
 * It is normalised to hex so what is stored is one shape rather than two.
 */
function colourValue(value: string): string | null {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) return `#${hex[1]}`;

  const rgb = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/);
  if (rgb) {
    const parts = [rgb[1], rgb[2], rgb[3]].map(Number);
    if (parts.some((part) => part > 255)) return null;
    return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }

  const token = value.match(/^var\(--tgs-([a-z-]+)\)$/);
  if (token && COLOUR_TOKENS.has(token[1])) return `var(--tgs-${token[1]})`;

  // Deliberately no named colours and no `transparent`. The toolbar cannot
  // produce them, so anything sending one is not the toolbar.
  return null;
}

/**
 * A font: one of the site's own, named by the style whose family it is.
 *
 * Never a raw family name. A client picking "Georgia" would get whatever the
 * visitor's machine happens to have, which is a different site on every screen,
 * and the whole point of the font library is that the site carries its own.
 */
function fontValue(value: string): string | null {
  const token = value.match(/^var\(--tgs-([a-z0-9]+)-font\)$/);
  if (token && (TEXT_STYLES as readonly string[]).includes(token[1])) {
    return `var(--tgs-${token[1]}-font)`;
  }
  if (value === 'var(--tgs-font-body)' || value === 'var(--tgs-font-display)') return value;
  return null;
}

function sizeValue(value: string): string | null {
  if (SIZE_VALUES.has(value)) return value;

  const token = value.match(/^var\(--tgs-([a-z0-9]+)-size\)$/);
  if (token && (TEXT_STYLES as readonly string[]).includes(token[1])) {
    return `var(--tgs-${token[1]}-size)`;
  }

  /*
   * A size typed by hand, in whole pixels, inside the bound above.
   *
   * OUT OF RANGE IS DROPPED, NOT CLAMPED, the same as an rgb() channel past 255
   * is dropped rather than pinned to 255. Clamping belongs in the toolbar, where
   * the person watches the number they typed become the number that took, not in
   * a sanitiser that would silently turn a saved 9000px into 200px with nobody
   * the wiser. The digit cap keeps a pathological input short before Number sees
   * it; the leading zeros a value like 007px carries are normalised away by
   * going through Number.
   */
  const px = /^(\d{1,4})px$/.exec(value);
  if (px) {
    const n = Number(px[1]);
    if (n >= PX_SIZE_MIN && n <= PX_SIZE_MAX) return `${n}px`;
  }
  return null;
}

/**
 * A whole block's text size, validated the same way an inline one is.
 *
 * The per-screen text-size control stores a block's size, base and per-screen
 * overrides, from the very list the toolbar offers a phrase (FONT_SIZES, a theme
 * token, or a hand-typed pixel size in range). Sharing `sizeValue` is the point:
 * what a phrase may be set to inline and what a whole block may be set to per
 * screen cannot drift. Anything off the list is dropped, not coerced, and a
 * non-string is nothing, so a stray value renders as the block's own size rather
 * than as broken CSS. Returns undefined rather than null so it drops cleanly out
 * of an optional schema field and an object spread.
 */
export function normaliseTextSize(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return sizeValue(value) ?? undefined;
}

/**
 * Weight. Only the two that mean something in running text.
 *
 * Browsers emit `font-weight: bold` for a bold command when they are asked to
 * use CSS rather than tags, so this is here to stop that being dropped. The
 * numeric equivalents are accepted and normalised to the keywords.
 */
function weightValue(value: string): string | null {
  if (value === 'bold' || value === '700') return 'bold';
  if (value === 'normal' || value === '400') return 'normal';
  return null;
}

function alignValue(value: string): string | null {
  return ALIGNMENTS.has(value) ? value : null;
}
