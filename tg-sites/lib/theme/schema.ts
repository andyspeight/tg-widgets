/**
 * A site theme: the handful of things a client chooses about how their site looks.
 *
 * SEVEN SETTINGS, NOT THIRTY
 *
 * app/globals.css declares about thirty custom properties. This exposes seven
 * of them, and derives the rest.
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

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * The font choices, as ids.
 *
 * SYSTEM STACKS ONLY, and no webfonts yet. A hosted font is a network request
 * from a client's page to somewhere else, which costs the thing this whole
 * renderer exists to protect: the page arriving complete in the first response.
 * Google Fonts also means every visitor to a travel agency hits Google, which
 * is somebody else's decision to make.
 *
 * Keyed by id so a client picks from a list and the stack string is always
 * ours. That is also the seam for real fonts later: adding a hosted family
 * means adding a row here and a preload, and no schema change, because the
 * stored value was never the font name.
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

const FontEnum = z.enum(FONT_IDS as [FontId, ...FontId[]]);

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
  bodyFont: 'system',
  headingFont: 'system',
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

  bodyFont: FontEnum.catch(DEFAULT_THEME.bodyFont),
  headingFont: FontEnum.catch(DEFAULT_THEME.headingFont),
  corners: CornerEnum.catch(DEFAULT_THEME.corners),
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
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return ThemeSchema.parse({ ...DEFAULT_THEME, ...input });
}

/** True when this theme is the default one, so a screen can say "not set yet". */
export function themeIsDefault(theme: Theme): boolean {
  return (Object.keys(DEFAULT_THEME) as Array<keyof Theme>).every(
    (key) => theme[key] === DEFAULT_THEME[key],
  );
}
