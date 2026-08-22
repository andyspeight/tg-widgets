/**
 * A site theme: the handful of things a client chooses about how their site looks.
 *
 * FOUR COLOURS, ONE CORNER STYLE, AND SEVEN TEXT STYLES
 *
 * app/globals.css declares about thirty custom properties. This exposes the
 * handful that are a brand decision and derives the rest.
 *
 * That is the important decision in this file. Asking a travel agent for a
 * "primary light" colour, a border colour and a muted text colour is asking
 * them to do design work they did not sign up for, and the usual result is a
 * site where the hairlines are black and the captions are unreadable. They know
 * their brand colour. Everything that follows from it is arithmetic, and
 * arithmetic belongs in lib/theme/tokens.ts.
 *
 * The same reasoning as the content model: pixel values are enums unless there
 * is a specific reason otherwise. Corner rounding is three named options rather
 * than a number, because "how round are the corners" is a brand decision with
 * three sensible answers, and a slider invites 7px.
 *
 * EVERY VALUE HERE ENDS UP IN A CSS CUSTOM PROPERTY, so the validation is a
 * whitelist rather than an escape. A colour is a six digit hex or it is
 * rejected; a font is an id from the table below, never a string a client
 * typed. Nothing from a client can contain a semicolon or a brace, so nothing
 * can close a declaration and open another one. There are tests that feed it
 * exactly that.
 */

import { z } from 'zod';

import { normaliseHex } from './colour';
import {
  DEFAULT_TYPOGRAPHY,
  parseTypography,
  TEXT_STYLES,
  TypographySchema,
  typographyIsDefault,
  type Typography,
} from './typography';

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * The font choices, as ids.
 *
 * THE BUILT-IN STACKS, which cost nothing to use because they are already on
 * the reader's device. Still the right default: no request, no wait, no reflow.
 *
 * They are no longer the only option. A tenant's font library holds imported
 * Google families and uploaded brand fonts, and a text style's `family` is a
 * slug that can name either one of those or one of these. lib/theme/fonts.ts
 * resolves a slug to a stack and does not care which kind it turned out to be.
 *
 * These also serve as the FALLBACK behind every custom font, chosen by
 * classification so a serif brand font falls back to a serif rather than
 * reflowing the page into a sans for the second before the woff2 lands.
 */
export const FONTS = {
  system: {
    label: 'System sans',
    note: 'Matches whatever device it is read on. Fastest, and never wrong.',
    stack:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  humanist: {
    label: 'Humanist sans',
    note: 'Slightly warmer and rounder. Good for a friendly brand.',
    stack:
      "'Optima', 'Segoe UI', 'Trebuchet MS', 'Gill Sans', 'Gill Sans MT', Candara, sans-serif",
  },
  grotesque: {
    label: 'Neutral sans',
    note: 'Flat and businesslike. Good when the photography does the talking.',
    stack:
      "'Helvetica Neue', Helvetica, 'Arial Nova', Arial, sans-serif",
  },
  serif: {
    label: 'Serif',
    note: 'Traditional and unhurried. Suits luxury and heritage travel.',
    stack:
      "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  },
  slab: {
    label: 'Modern serif',
    note: 'Higher contrast than the serif above. Editorial, magazine feel.',
    stack:
      "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  },
} as const;

export type FontId = keyof typeof FONTS;

export const FONT_IDS = Object.keys(FONTS) as FontId[];

// ---------------------------------------------------------------------------
// Corners
// ---------------------------------------------------------------------------

/**
 * How round things are. Three scales, not three numbers.
 *
 * Each option sets the whole radius scale at once, so a card, a button and an
 * image stay in proportion with each other. Letting them be set separately is
 * how a site ends up with square buttons on rounded cards.
 */
export const CORNERS = {
  sharp: { label: 'Sharp', sm: 0, md: 0, lg: 0 },
  soft: { label: 'Soft', sm: 4, md: 10, lg: 20 },
  round: { label: 'Round', sm: 8, md: 18, lg: 32 },
} as const;

export type CornerId = keyof typeof CORNERS;

export const CORNER_IDS = Object.keys(CORNERS) as CornerId[];

const CornerEnum = z.enum(CORNER_IDS as [CornerId, ...CornerId[]]);

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * The Travelgenix defaults, and the exact values already in globals.css.
 *
 * They have to match, so that a tenant whose theme is {} renders byte for byte
 * as it did before themes existed. There is a test that reads globals.css and
 * compares, because two lists of hex codes in two files WILL drift and the
 * symptom would be every unthemed site shifting colour on deploy.
 */
export const DEFAULT_THEME = {
  brand: '#1b2b5b',
  accent: '#00b4d8',
  pageBackground: '#ffffff',
  text: '#0f172a',
  corners: 'soft',
} as const;

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

/**
 * A colour field.
 *
 * catch() rather than a hard failure, and this is the one place it is right to
 * be lenient. The value comes out of a jsonb column that has been through
 * several shapes already, and a site that renders in Travelgenix navy because
 * one field was unreadable is better than a site that 500s. A theme is
 * decoration; refusing to serve the page over it would be the wrong trade.
 *
 * Anything invalid still cannot reach the CSS: it is replaced by the default,
 * which is a value from this file.
 */
/** An optional colour: a valid hex, or empty for "derive it". */
function optionalColour() {
  return z
    .unknown()
    .transform((value) => normaliseHex(value) ?? '')
    .catch('');
}

function colour(fallback: string) {
  return z
    .unknown()
    .transform((value) => normaliseHex(value) ?? fallback)
    .catch(fallback);
}

export const ThemeSchema = z.object({
  /** The main brand colour. Buttons, links, the dark band. */
  brand: colour(DEFAULT_THEME.brand),
  /** A second colour, for highlights and secondary actions. */
  accent: colour(DEFAULT_THEME.accent),
  /** The page itself. Usually white, sometimes a very pale tint. */
  pageBackground: colour(DEFAULT_THEME.pageBackground),
  /** Body text. Everything else in the type palette is derived from it. */
  text: colour(DEFAULT_THEME.text),

  corners: CornerEnum.catch(DEFAULT_THEME.corners),

  /*
   * OPTIONAL OVERRIDES for three colours the theme otherwise derives: the dark
   * band, the alternating band and muted text. Empty means "derive as always",
   * which is every theme saved before these existed. They exist because the
   * derivation, correct as arithmetic, drifts from a committed design world:
   * Coastwise's deep #1B333D became a near-black band and its warm bone-2 a
   * cool grey (the 21 Aug review). An override is a hint, not a licence: the
   * token layer still passes each one through the same contrast guards the
   * derived value gets, so a careless override cannot ship unreadable text.
   */
  surfaceDark: optionalColour(),
  surfaceAlt: optionalColour(),
  textMuted: optionalColour(),

  /*
   * The DATA typeface: day numbers, fares, key figures, card labels. A slug
   * from the site's own font library, resolved exactly as a text style's
   * family is; empty means data inherits its surroundings, which is every
   * existing site unchanged. This is the slot that lets a world like
   * Coastwise's ("plotting-room mono for data only") actually happen.
   */
  dataFamily: z
    .unknown()
    .transform((value) =>
      typeof value === 'string'
        ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80)
        : '',
    )
    .catch(''),

  /**
   * The seven text styles. See lib/theme/typography.ts.
   *
   * Replaced the single bodyFont and headingFont pair, which could say only
   * "everything is this typeface" and "headings are that one". Andy asked for
   * H1 to H6 and paragraph, which is what a client actually thinks in.
   */
  typography: TypographySchema,
});

export type Theme = z.infer<typeof ThemeSchema>;

/**
 * A theme from whatever came out of the database.
 *
 * Total: every input produces a theme. An empty object, a null, a string, an
 * array or a hand edited row with nonsense in it all end up as a valid theme
 * with the defaults filling the gaps.
 */
export function parseTheme(value: unknown): Theme {
  const input: Record<string, unknown> =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return ThemeSchema.parse({
    ...DEFAULT_THEME,
    ...input,
    // Parsed separately, because it fills all seven styles from the defaults
    // before layering the input on. Spreading it above would replace the whole
    // object and a theme holding only h1 would lose the other six.
    // parseTypography rather than leaving it to ThemeSchema, because it fills
    // all seven styles from the defaults first. TypographySchema on its own has
    // no default, so handing it undefined fails the whole parse, which is how
    // the first version of this broke every theme including the empty one.
    typography: parseTypography(input.typography ?? migrateFonts(input)),
  });
}

/**
 * Typography, honouring the two font fields this replaced.
 *
 * bodyFont and headingFont were the whole of the type system until the styles
 * below existed. A theme saved with them and no typography should keep the
 * typefaces somebody chose rather than silently reverting to the system stack,
 * so they are read once and mapped: the body font becomes the paragraph, the
 * heading font becomes all six headings.
 *
 * Only when there is no typography at all. Once a theme has been saved through
 * the new screen, the old fields are ignored and will drop out of the column the
 * next time it is written, because parseTheme never puts them back.
 */
function migrateFonts(input: Record<string, unknown>): unknown {
  if (input.typography) return input.typography;

  const body = typeof input.bodyFont === 'string' ? input.bodyFont : null;
  const heading = typeof input.headingFont === 'string' ? input.headingFont : null;
  // Nothing to carry across. parseTypography turns undefined into the defaults.
  if (!body && !heading) return undefined;

  const migrated: Record<string, unknown> = {};
  for (const id of TEXT_STYLES) {
    migrated[id] = {
      ...DEFAULT_TYPOGRAPHY[id],
      family: id === 'p' ? body : (heading ?? body),
    };
  }
  return migrated;
}

/** True when this theme is the default one, so a screen can say "not set yet". */
export function themeIsDefault(theme: Theme): boolean {
  const scalarsMatch = (Object.keys(DEFAULT_THEME) as Array<keyof typeof DEFAULT_THEME>).every(
    (key) => theme[key] === DEFAULT_THEME[key],
  );
  return scalarsMatch && typographyIsDefault(theme.typography);
}

export type { Typography };
