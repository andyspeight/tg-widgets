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
 * The band a line-spacing value is held to, as a UNITLESS multiple.
 *
 * Below about 0.8 the lines of a wrapped heading collide; past 3 it is not
 * spacing any more, it is a paragraph gap a spacer block wants. The two numbers
 * live here, next to the validator, so the block pane and the sanitiser cannot
 * drift, the same arrangement the pixel-size bounds have above.
 */
export const LINE_HEIGHT_MIN = 0.8;
export const LINE_HEIGHT_MAX = 3;

/**
 * A block's line spacing, validated the way its size is.
 *
 * UNITLESS on purpose. Set on the block it inherits into every span the copy is
 * wrapped in, and a unitless line-height is re-multiplied by each span's OWN font
 * size, so it scales every line box to the size that span actually is. That is
 * what lets a heading whose words sit inside a stack of leftover size spans (the
 * hero that started this, wrapped eleven deep with 100px and 120px still on the
 * outer spans) be pulled back to the height of the text you see, by tightening
 * one value rather than unpicking the spans by hand.
 *
 * Takes a number or a numeric string, clamps it to the band, and returns a short
 * unitless string. Anything that is not a finite number returns undefined, so a
 * stray value drops out of an optional field and a spread cleanly, exactly as a
 * size does, and the element keeps its own natural leading.
 */
export function normaliseLineHeight(value: unknown): string | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, n));
  // Two decimals with no trailing zeros, so 1.5 stores as "1.5" not "1.50" and a
  // stored value round-trips to the same option the block pane offers.
  return String(Math.round(clamped * 100) / 100);
}

/** The line-spacing choices the block pane offers, tight to loose. Unitless. */
export const LINE_HEIGHTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '0.8', label: 'Very tight' },
  { value: '0.9', label: 'Tight' },
  { value: '1', label: 'Snug' },
  { value: '1.15', label: 'Normal' },
  { value: '1.3', label: 'Relaxed' },
  { value: '1.5', label: 'Loose' },
  { value: '1.8', label: 'Very loose' },
];

/**
 * The bands a letter-spacing value is held to, one per unit.
 *
 * Tighter than -0.1em and the letters of a heading start to touch; past 0.5em the
 * words stop reading as words. The pixel band is the same idea in absolute terms,
 * wide enough for a spaced-out display line and no wider. Both pairs live here,
 * next to the validator, so the block pane and the sanitiser cannot drift, the
 * same arrangement the line-spacing and pixel-size bounds have above.
 */
export const LETTER_SPACING_EM_MIN = -0.1;
export const LETTER_SPACING_EM_MAX = 0.5;
export const LETTER_SPACING_PX_MIN = -10;
export const LETTER_SPACING_PX_MAX = 40;

/** An em letter-spacing, clamped and shortened. Shared by both entry paths. */
function emTracking(n: number): string | undefined {
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.min(LETTER_SPACING_EM_MAX, Math.max(LETTER_SPACING_EM_MIN, n));
  // Three decimals, no trailing zeros, which is the precision the theme's own
  // tracking tokens are written to (--tgs-h1-tracking is -0.03em). So a stored
  // value round-trips to the same option the block pane offers.
  return `${Math.round(clamped * 1000) / 1000}em`;
}

/**
 * A block's letter spacing, validated the way its size and line spacing are.
 *
 * EM BY DEFAULT, because tracking that does not follow the size is tracking that
 * breaks the moment somebody changes the size, and this is a per-screen control
 * sitting next to a per-screen size. The em resolves against the font size of the
 * element it is set on, which is .tgs-heading or .tgs-text carrying its own
 * per-screen size, so a heading tracked in on desktop stays in proportion when a
 * phone override shrinks it. That is also the unit the theme states its own
 * tracking in (--tgs-p-tracking and the six heading twins), so the block-level
 * value and the value it overrides are in the same currency.
 *
 * IT IS NOT THE UNITLESS LINE-HEIGHT TRICK, and the difference matters. A unitless
 * line-height inherits as a NUMBER and every nested span re-multiplies it by its
 * own size, which is what lets tightening one value rescue a heading wrapped in a
 * stack of oversized size spans. letter-spacing computes to an absolute length at
 * the element it is set on and inherits THAT, so every span inside gets the same
 * gap in px whatever size it is (measured: 0.2em on a 48px heading gives 9.6px,
 * and a 16px span inside it also gets 9.6px, where line-height 1.5 gives 72px and
 * 24px). So on a heading built from mixed-size spans the small words carry the big
 * words' tracking, and the remedy is the one that already exists: clear the sizing
 * spans first (see clearTextSizing), then track the block.
 *
 * PIXELS ARE ACCEPTED because a client who wants one exact gap should be able to
 * type it, and refusing the unit would only push them to guess an em. A bare
 * number is read as em, matching the theme convention rather than the CSS one,
 * where a unitless letter-spacing is invalid and would render as nothing.
 *
 * ZERO IS A REAL ANSWER, not an absence: an h1 carries -0.03em of its own, so
 * '0em' means take that tracking off, which is a different instruction from
 * leaving the control unset. Both bands therefore keep 0 rather than dropping it,
 * and only a value that is not a number at all returns undefined, so a stray one
 * falls out of an optional field and a spread cleanly and the element keeps its
 * own tracking.
 */
export function normaliseLetterSpacing(value: unknown): string | undefined {
  if (typeof value === 'number') return emTracking(value);
  if (typeof value !== 'string') return undefined;

  const text = value.trim().toLowerCase();
  if (text === '') return undefined;

  const px = /^(-?\d{1,3}(?:\.\d{1,2})?)px$/.exec(text);
  if (px) {
    const n = Number(px[1]);
    if (!Number.isFinite(n)) return undefined;
    const clamped = Math.min(LETTER_SPACING_PX_MAX, Math.max(LETTER_SPACING_PX_MIN, n));
    return `${Math.round(clamped * 100) / 100}px`;
  }

  // em, or a bare number read as em. Anchored at both ends, so nothing with a
  // second unit, a calc() or a trailing character can reach the stylesheet.
  const em = /^(-?\d{1,3}(?:\.\d{1,4})?)(?:em)?$/.exec(text);
  return em ? emTracking(Number(em[1])) : undefined;
}

/**
 * The letter-spacing choices the block pane offers, tight to wide.
 *
 * 'None' is not the same as leaving the control alone: it sets 0em, taking off
 * the tracking the heading style carries of its own, where unset keeps it.
 */
export const LETTER_SPACINGS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '-0.05em', label: 'Very tight' },
  { value: '-0.03em', label: 'Tight' },
  { value: '-0.015em', label: 'Snug' },
  { value: '0em', label: 'None' },
  { value: '0.02em', label: 'Relaxed' },
  { value: '0.05em', label: 'Loose' },
  { value: '0.1em', label: 'Very loose' },
  { value: '0.2em', label: 'Widest' },
];

/**
 * Strip the fixed font sizes off the words in a block's HTML, unwrapping any span
 * that then held nothing else.
 *
 * The one-click clean for a heading whose words are wrapped in a stack of size
 * spans (the hero that started this, eleven deep, with 100px and 120px still on
 * the outer ones). Those spans override the block's own size, its per-screen
 * override and the auto-resize option, and each reserves its own line box. Taking
 * the font-size off every one of them hands control of the whole block back to the
 * size controls. A span that carried only a size is left with no attributes and is
 * unwrapped, so the markup comes back as clean as it went in wrong; a span that
 * also carried a colour keeps the colour, and bold, links and lists are untouched.
 *
 * Browser and jsdom only, by design: it is a click in the editor, never a step on
 * the server, so it parses with the DOM rather than a regex over markup. The result
 * goes back through the sanitiser on the next save like any other edit.
 */
export function clearTextSizing(html: string): string {
  if (typeof html !== 'string' || html === '') return '';
  const root = document.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll('[style]').forEach((node) => {
    const el = node as HTMLElement;
    el.style.removeProperty('font-size');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  });
  // Unwrap any span now left with no attributes at all, so a stack of size-only
  // spans collapses to the words rather than lingering as empty wrappers.
  root.querySelectorAll('span').forEach((span) => {
    if (span.attributes.length === 0) span.replaceWith(...Array.from(span.childNodes));
  });
  return root.innerHTML;
}

/** True when a block's HTML carries a fixed font size on any of its words. */
export function hasInlineTextSizing(html: unknown): boolean {
  return typeof html === 'string' && /font-size\s*:/i.test(html);
}

/**
 * The ways a section's content can arrive when Reveal on scroll is on.
 *
 * Each value is the tail of a keyframes name in globals.css and the value the
 * render puts in data-reveal, so the set here, the CSS and the pane cannot drift.
 * A closed list, which is what keeps data-reveal safe: the attribute can only ever
 * be one of these, never anything a client typed.
 */
/**
 * The motion recipes an editor can actually pick, in plain words.
 *
 * NAMED FOR WHAT THEY DO, not for their catalogue code. A travel agent choosing how
 * their page moves should not have to know that A6 is ambient-drift; the codes stay
 * in the model, in the stylesheet and in the catalogue, and never reach a label.
 *
 * ONLY LIVE RECIPES BELONG HERE. This list is the picker, so a recipe with no CSS
 * behind it must not appear in it, however agreed its name is. tests/motion.test.ts
 * holds this against MOTION_LIVE_RECIPES.
 *
 * LIMITING THE PICKER BY THE TENANT'S ASSIGNED PRIMARY IS STILL TO COME. The segment
 * lock in the taste skill gives each travel segment its own primary ambient recipe so
 * two client sites never move the same way, and with every tenant self-serving that
 * assignment has to live on the tenant rather than in a picker. It waits on the
 * DESIGN.md and design_brief canonicalisation question, which is Andy's to settle.
 */
export const MOTION_CHOICES = [
  { value: 'none', label: 'None' },
  { value: 'A5', label: 'Pictures breathe' },
  { value: 'A6', label: 'Background drifts' },
  { value: 'A2', label: 'Scenes change' },
  { value: 'A4', label: 'Layers drift apart' },
  { value: 'A7', label: 'Film behind the words' },
  { value: 'S5', label: 'Background settles' },
  { value: 'S1', label: 'Words rise like a tide' },
  { value: 'S3', label: 'Cards stack up' },
  { value: 'A3', label: 'Cards drift past' },
] as const;

/**
 * How much it moves. A BAND, never an on and off switch: the gentlest setting still
 * moves, because a recipe that can be turned down to nothing is a checkbox wearing a
 * slider's clothes.
 */
export const MOTION_INTENSITIES = [
  { value: 1, label: 'Gentle' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Strong' },
] as const;

export const REVEAL_STYLES = [
  { value: 'rise', label: 'Rise up' },
  { value: 'fade', label: 'Fade in' },
  { value: 'slide-left', label: 'Slide from the left' },
  { value: 'slide-right', label: 'Slide from the right' },
  { value: 'zoom', label: 'Zoom in' },
  { value: 'blur', label: 'Blur in' },
] as const;

export type RevealStyle = (typeof REVEAL_STYLES)[number]['value'];

/** A stored reveal style, or the rise default for anything off the list. */
export function normaliseRevealStyle(value: unknown): RevealStyle {
  return REVEAL_STYLES.some((style) => style.value === value) ? (value as RevealStyle) : 'rise';
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
