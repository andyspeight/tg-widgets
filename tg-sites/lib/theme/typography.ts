/**
 * Seven text styles: H1 to H6, and paragraph.
 *
 * WHAT A "TEXT STYLE" IS HERE, AND WHY IT IS NOT A HEADING LEVEL
 *
 * The content model already separates the two, deliberately, and that separation
 * has to survive.
 *
 * A heading block has a LEVEL, which is the HTML tag, and the block only offers
 * h2 to h4 because the page title owns the single h1 and a client must not be
 * able to make a second one or skip a level. That is an accessibility and SEO
 * property, enforced in lib/content/blocks.ts.
 *
 * A heading block also has a STYLE, which is how it looks. These seven are the
 * styles. So "H1" here means "the biggest text style", and a block can use it
 * while still being an h2 in the markup. That is how a section can open with
 * display-sized text without there being two h1s on the page.
 *
 * Wix and Squarespace both work this way, for the same reason. Naming them H1 to
 * H6 rather than "Display, Title, Heading, Subheading..." is deliberate too:
 * everybody already knows what H1 means, and inventing a vocabulary for it would
 * be the kind of cleverness that needs a manual.
 *
 * WHY SIZES ARE NUMBERS HERE
 *
 * The rest of this product turns pixel values into enums, and that rule was
 * about LAYOUT: padding, gaps, widths, positions. Type is different. A type
 * scale is the thing a brand is most recognisable by after its colours, and no
 * six fixed steps fit every brand. So sizes are numbers, clamped at both ends
 * and snapped, and the guard rails do the work the enum was doing: nothing can
 * be smaller than readable or larger than the viewport.
 */

import { z } from 'zod';

/** The seven styles, in the order the UI shows them. */
export const TEXT_STYLES = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'] as const;
export type TextStyleId = (typeof TEXT_STYLES)[number];

export const TEXT_STYLE_LABEL: Record<TextStyleId, string> = {
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  h4: 'Heading 4',
  h5: 'Heading 5',
  h6: 'Heading 6',
  p: 'Paragraph',
};

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * 15px is the floor for every style, not just paragraph.
 *
 * The design rules already say body text never drops below 15px, and a heading
 * cannot be an exception: an h6 at 12px is still text somebody has to read, and
 * "it is a heading" is not a reason for it to be smaller than the thing it
 * introduces.
 */
export const MIN_FONT_SIZE = 15;

/**
 * 96px is the ceiling.
 *
 * Larger than that overflows a phone before the text has anywhere to wrap, and
 * a display size that only works on a desktop is a display size that breaks the
 * site for most visitors. Genuinely enormous type is a job for a hero image.
 */
export const MAX_FONT_SIZE = 96;

/** Below about 1.05 the lines touch; above 2.2 it stops reading as a paragraph. */
export const MIN_LINE_HEIGHT = 1.0;
export const MAX_LINE_HEIGHT = 2.2;

/** Tracking, in hundredths of an em. Tight headings are a real style; -0.1em is not. */
export const MIN_TRACKING = -8;
export const MAX_TRACKING = 20;

/** Weights a font can be asked for. Matches what the Google importer fetches. */
export const FONT_WEIGHTS = [400, 500, 600, 700] as const;

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * A number, clamped and rounded, or the fallback.
 *
 * Total, like every other coercion in this codebase: a string, a null, a NaN
 * and Infinity all end up as a usable number rather than as a broken CSS
 * declaration. A theme is decoration and must never be the reason a page fails
 * to render.
 */
function clamped(min: number, max: number, fallback: number, step = 1) {
  return z.unknown().transform((value) => {
    /*
     * Number() is not usable on its own here, because of what it does with
     * things that are not numbers: Number(null), Number('') and Number([]) are
     * all 0, and 0 is finite. So a null size sailed through the check below and
     * clamped to the 15px floor, which turned a missing h1 size into body text
     * rather than into the h1 default. Only a real number, or a string that
     * parses to one, counts.
     */
    let n: number;
    if (typeof value === 'number') n = value;
    else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
    else return fallback;

    if (!Number.isFinite(n)) return fallback;

    const snapped = Math.round(n / step) * step;
    // Rounded back, because 1.1 / 0.05 * 0.05 is 1.1000000000000001 and that
    // would end up in the stylesheet.
    return Math.min(max, Math.max(min, Number(snapped.toFixed(2))));
  });
}

/**
 * Which font a style uses.
 *
 * A SLUG FROM THE LIBRARY, or one of the built-in stack ids, or null. Null means
 * "whatever the paragraph style uses", which is what makes setting up a site
 * quick: pick a heading font once and the six heading styles follow it.
 *
 * Never a font-family string. The value is looked up against the tenant's own
 * library, so a hand-edited theme naming a font the tenant does not have falls
 * back rather than emitting a family nobody has, and a value from a request
 * cannot become CSS.
 */
const FamilyRef = z
  .unknown()
  .transform((value) => {
    if (typeof value !== 'string') return null;
    const slug = value.trim().toLowerCase();
    if (!slug) return null;
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? slug : null;
  })
  .catch(null);

/**
 * A schema for ONE style, built from that style's own defaults.
 *
 * Built per style rather than shared, and that is not ceremony. A shared schema
 * has to name one fallback size, and whatever it names is wrong for six of the
 * seven: with 17 in there, an h1 whose size arrived unreadable fell back to 17px
 * and silently became body text. A heading quietly shrinking to paragraph size
 * because one field was garbled is exactly the kind of failure nobody traces
 * back.
 *
 * So every fallback below is the default for the style being parsed, which means
 * a bad field costs that field and nothing else.
 */
export function textStyleSchema(defaults: {
  weight: number;
  size: number;
  lineHeight: number;
  tracking: number;
}) {
  return z.object({
    /** A library slug, a built-in stack id, or null to inherit from paragraph. */
    family: FamilyRef,
    weight: z
      .unknown()
      .transform((v) => {
        const n = Number(v);
        return (FONT_WEIGHTS as readonly number[]).includes(n) ? n : defaults.weight;
      })
      .catch(defaults.weight),
    size: clamped(MIN_FONT_SIZE, MAX_FONT_SIZE, defaults.size),
    lineHeight: clamped(MIN_LINE_HEIGHT, MAX_LINE_HEIGHT, defaults.lineHeight, 0.05),
    /** Hundredths of an em, so it is an integer in the JSON and in the UI. */
    tracking: clamped(MIN_TRACKING, MAX_TRACKING, defaults.tracking),
  });
}

export type TextStyle = {
  family: string | null;
  weight: number;
  size: number;
  lineHeight: number;
  tracking: number;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * The scale the product shipped with, written out per style.
 *
 * Taken from the type scale that was in globals.css, so a site that has never
 * been near this screen keeps the sizes it already had. The tracking gets
 * tighter as the size grows, which is the one typographic rule worth building
 * in: letter spacing that looks right at 17px looks loose at 48px.
 *
 * family is null throughout, meaning "follow the paragraph", so the defaults
 * describe a scale and not a typeface.
 */
export const DEFAULT_TYPOGRAPHY: Record<TextStyleId, TextStyle> = {
  h1: { family: null, weight: 700, size: 48, lineHeight: 1.1, tracking: -3 },
  h2: { family: null, weight: 700, size: 36, lineHeight: 1.15, tracking: -2 },
  h3: { family: null, weight: 700, size: 28, lineHeight: 1.2, tracking: -2 },
  h4: { family: null, weight: 600, size: 22, lineHeight: 1.25, tracking: -1 },
  h5: { family: null, weight: 600, size: 19, lineHeight: 1.3, tracking: 0 },
  h6: { family: null, weight: 600, size: 17, lineHeight: 1.35, tracking: 0 },
  p: { family: null, weight: 400, size: 17, lineHeight: 1.6, tracking: 0 },
};

export const TypographySchema = z.object({
  h1: textStyleSchema(DEFAULT_TYPOGRAPHY.h1),
  h2: textStyleSchema(DEFAULT_TYPOGRAPHY.h2),
  h3: textStyleSchema(DEFAULT_TYPOGRAPHY.h3),
  h4: textStyleSchema(DEFAULT_TYPOGRAPHY.h4),
  h5: textStyleSchema(DEFAULT_TYPOGRAPHY.h5),
  h6: textStyleSchema(DEFAULT_TYPOGRAPHY.h6),
  p: textStyleSchema(DEFAULT_TYPOGRAPHY.p),
});

export type Typography = Record<TextStyleId, TextStyle>;

/**
 * Typography from whatever came out of the database.
 *
 * Total. Every style is filled from the defaults before the input is layered on,
 * so a theme holding only h1 comes back with all seven and a theme holding
 * nonsense comes back with the defaults.
 */
export function parseTypography(value: unknown): Typography {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const merged: Record<string, unknown> = {};
  for (const id of TEXT_STYLES) {
    const style = input[id];
    merged[id] = {
      ...DEFAULT_TYPOGRAPHY[id],
      ...(style && typeof style === 'object' && !Array.isArray(style) ? style : {}),
    };
  }

  return TypographySchema.parse(merged);
}

/** True when nothing has been changed, so a screen can say "not set yet". */
export function typographyIsDefault(typography: Typography): boolean {
  return TEXT_STYLES.every((id) => {
    const a = typography[id];
    const b = DEFAULT_TYPOGRAPHY[id];
    return (
      a.family === b.family &&
      a.weight === b.weight &&
      a.size === b.size &&
      a.lineHeight === b.lineHeight &&
      a.tracking === b.tracking
    );
  });
}
