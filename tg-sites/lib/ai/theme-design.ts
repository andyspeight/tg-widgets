/**
 * Designing a site's THEME from its company profile.
 *
 * The piece that was missing from the AI builder. It planned pages and wrote
 * copy, but every site it produced rendered in the platform's own default navy
 * and system sans, because nothing on the AI path ever touched the theme. Two
 * AI-built sites were siblings at a glance whatever their briefs said, and
 * Andy's verdict on the result was the right one: AI standard fare, not
 * something you could hand a client.
 *
 * WHAT THE MODEL CHOOSES, AND WHAT IT CANNOT. The model picks a typeface
 * pairing from the curated list below and writes a four-colour palette. It
 * does NOT write font names (1,941 Google families are 1,900 ways to pick a
 * script face for headings), it does not write CSS, and every colour it
 * offers goes through the same normalisation and contrast guards a colour
 * typed into the theme screen gets. The pairings carry their own display
 * treatment - weight, tracking, scale - because "Playfair at 700 with the
 * default -3 tracking" is exactly the kind of almost-right that reads as
 * template. A pairing is a taste decision made once, here, not per site.
 *
 * The fonts themselves are imported into the tenant's own library by the
 * caller (self-hosted, like every font on the platform - see
 * lib/content/designed-fonts.ts for the pattern). This module is pure so the
 * tests can exercise it without a server.
 */

import { luminance, normaliseHex } from '../theme/colour';
import { DEFAULT_THEME } from '../theme/schema';
import { DEFAULT_TYPOGRAPHY, type TextStyleId, type TextStyle } from '../theme/typography';
import { familySlug } from '../fonts/google';

// ---------------------------------------------------------------------------
// The pairings
// ---------------------------------------------------------------------------

export interface FontPairing {
  /** Stable id the model answers with. */
  id: string;
  /** The display family, exactly as Google names it. */
  display: string;
  /** The body family, exactly as Google names it. */
  body: string;
  /** One line for the model: who this voice belongs to. */
  voice: string;
  /** Weight for h1-h3. Some display faces ship one weight; respect it. */
  displayWeight: number;
  /** Tracking for h1/h2. Serifs want less squeeze than grotesques. */
  displayTracking: number;
  /**
   * 'grand' opens with display-sized type (h1 56), 'classic' keeps the
   * platform scale (h1 48). Big type is a voice, not a default.
   */
  scale: 'grand' | 'classic';
}

/**
 * Sixteen voices. The first ten are the designed homes' own pairs, already
 * proven on committed pages; the rest widen the range so two luxury briefs do
 * not converge on one look. Every family here exists on Google Fonts and
 * imports through the standard pipeline.
 */
export const FONT_PAIRINGS: readonly FontPairing[] = [
  { id: 'young-serif-hanken', display: 'Young Serif', body: 'Hanken Grotesk', voice: 'Warm and sunlit. An island or beach specialist with sand in their shoes.', displayWeight: 400, displayTracking: -1, scale: 'classic' },
  { id: 'baloo-nunito', display: 'Baloo 2', body: 'Nunito Sans', voice: 'Bright and friendly. Family holidays, kids clubs, no dawn flights.', displayWeight: 600, displayTracking: -1, scale: 'classic' },
  { id: 'lora-dm-sans', display: 'Lora', body: 'DM Sans', voice: 'Gentle and dependable. A family specialist parents trust.', displayWeight: 600, displayTracking: -1, scale: 'classic' },
  { id: 'source-serif-pt-sans', display: 'Source Serif 4', body: 'PT Sans', voice: 'Steady and nautical. Cruises, itineraries, a specialist on the phone.', displayWeight: 600, displayTracking: -1, scale: 'classic' },
  { id: 'albert-literata', display: 'Albert Sans', body: 'Literata', voice: 'Considered and scholarly. Cultural touring, expert-led, long reads.', displayWeight: 700, displayTracking: -2, scale: 'classic' },
  { id: 'oswald-source-sans', display: 'Oswald', body: 'Source Sans 3', voice: 'Bold and outdoorsy. Treks, expeditions, honest grades.', displayWeight: 500, displayTracking: 0, scale: 'grand' },
  { id: 'bricolage-figtree', display: 'Bricolage Grotesque', body: 'Figtree', voice: 'Loud and fast. Budget city breaks, deposits, deals.', displayWeight: 700, displayTracking: -2, scale: 'grand' },
  { id: 'fraunces-archivo', display: 'Fraunces', body: 'Archivo', voice: 'A studio with taste. Bespoke trips designed one client at a time.', displayWeight: 600, displayTracking: -1, scale: 'grand' },
  { id: 'playfair-manrope', display: 'Playfair Display', body: 'Manrope', voice: 'Classic luxury. Villas with staff, a limited book of clients.', displayWeight: 500, displayTracking: 0, scale: 'grand' },
  { id: 'bodoni-jost', display: 'Bodoni Moda', body: 'Jost', voice: 'High fashion. Private travel as couture, spare and editorial.', displayWeight: 500, displayTracking: 0, scale: 'grand' },
  { id: 'cormorant-inter', display: 'Cormorant Garamond', body: 'Inter', voice: 'Quiet refinement. Understated luxury that never raises its voice.', displayWeight: 600, displayTracking: 0, scale: 'grand' },
  { id: 'libre-caslon-karla', display: 'Libre Caslon Text', body: 'Karla', voice: 'Literary and boutique. Small hotels, slow travel, good writing.', displayWeight: 400, displayTracking: -1, scale: 'classic' },
  { id: 'dm-serif-work-sans', display: 'DM Serif Display', body: 'Work Sans', voice: 'Polished and modern. Grown-up hotels and city stays.', displayWeight: 400, displayTracking: -1, scale: 'grand' },
  { id: 'archivo-archivo', display: 'Archivo', body: 'Archivo', voice: 'One modern grotesque for everything. Confident, practical, coastal.', displayWeight: 700, displayTracking: -2, scale: 'classic' },
  { id: 'space-grotesk-inter', display: 'Space Grotesk', body: 'Inter', voice: 'Contemporary and sharp. City breaks for people who book on their phone.', displayWeight: 700, displayTracking: -2, scale: 'classic' },
  { id: 'newsreader-archivo', display: 'Newsreader', body: 'Archivo', voice: 'A travel journal. Editorial, photographic, destination-led.', displayWeight: 500, displayTracking: -1, scale: 'grand' },
];

export function pairingById(id: string): FontPairing | undefined {
  return FONT_PAIRINGS.find((pairing) => pairing.id === id);
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/** The pairings, one per line, the way the section catalogue is offered. */
export function pairingCatalogue(): string {
  return FONT_PAIRINGS.map((pairing) => `- ${pairing.id}: ${pairing.voice}`).join('\n');
}

export const THEME_RULES = `Your job here is to design the LOOK of a travel company's website: its colours and its typefaces. Not the words, not the pages.

- Design for THIS company, from the profile. A luxury house and a family-budget operator must never get the same look. If the profile names a place, let the palette come from that place: its sea, its stone, its evenings.
- The palette is four colours. "brand" carries buttons, links and the dark closing band, so it must be a colour with some depth to it. "accent" is the highlight; it should genuinely contrast with the brand, not be its neighbour. "pageBackground" is the paper: white, or a very pale tint with a temperature (warm bone, cool chalk); never a mid tone. "text" is near-black, warmed or cooled to match the paper.
- NEVER the platform's own defaults (navy ${DEFAULT_THEME.brand}, cyan ${DEFAULT_THEME.accent}). A site the platform designed for nobody is the look we are replacing.
- Avoid the AI cliches: purple-to-blue gradients, corporate #0066ff blue, and teal-plus-coral as a pair. When the place hands you a teal sea, keep the sea and take the accent from somewhere else in that place: the stone, the shutters, the dark of the harbour at dusk.
- Choose ONE typeface pairing from the catalogue by its id. The pairing is the site's voice; pick the one whose line reads most like the company, not the fanciest.
- "corners": "sharp" for editorial or luxury, "soft" for most, "round" only for a genuinely playful family brand.`;

export const THEME_OUTPUT_SHAPE = `Return a JSON object and NOTHING else. No prose, no markdown fences:

{ "pair": "<id from the catalogue>", "brand": "#1b333d", "accent": "#c8452c", "pageBackground": "#f7f4ee", "text": "#16181a", "corners": "soft" }

Every colour is a six-digit hex. All six fields are required.`;

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

export type ThemeDesignResult =
  | { ok: true; theme: Record<string, unknown>; pairing: FontPairing }
  | { ok: false; error: string };

/** Sizes for the two scales. 'classic' is the platform default, restated. */
const SCALE: Record<FontPairing['scale'], Partial<Record<TextStyleId, number>>> = {
  classic: {},
  grand: { h1: 56, h2: 40, h3: 30 },
};

/**
 * The seven text styles for a pairing: display face and treatment on h1-h3,
 * body face on the rest. Only the fields that differ from the defaults are
 * meaningful, but every style is stated so the intent is in the data rather
 * than in whatever the defaults happen to be on the day it is read back.
 */
export function typographyFor(pairing: FontPairing): Record<TextStyleId, TextStyle> {
  const display = familySlug(pairing.display);
  const body = familySlug(pairing.body);

  const style = (id: TextStyleId): TextStyle => {
    const base = DEFAULT_TYPOGRAPHY[id];
    const heading = id === 'h1' || id === 'h2' || id === 'h3';
    const size = SCALE[pairing.scale][id] ?? base.size;
    if (!heading) return { ...base, size, family: body };
    return {
      ...base,
      size,
      family: display,
      weight: pairing.displayWeight,
      // h3 keeps a gentler squeeze than the two openers whatever the pair says.
      tracking: id === 'h3' ? Math.max(pairing.displayTracking, -1) : pairing.displayTracking,
    };
  };

  return {
    h1: style('h1'), h2: style('h2'), h3: style('h3'), h4: style('h4'),
    h5: style('h5'), h6: style('h6'), p: style('p'),
  };
}

/**
 * The model's answer, made safe.
 *
 * Same posture as planFromModel: the answer is text from a model, so nothing
 * in it is trusted past its own field. Colours go through normaliseHex (a
 * six-digit hex or nothing), the pairing must exist in the catalogue, and two
 * structural guards keep a wayward palette from breaking the page: the paper
 * must actually be pale (a mid-tone background breaks every 'light' section
 * the presets assume) and the text must actually be dark. A guard failing
 * falls back to the safe value rather than failing the design: the palette
 * survives, corrected.
 */
export function themeFromModel(raw: string): ThemeDesignResult {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The answer was not JSON.' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The answer was not an object.' };
  }
  const fields = parsed as Record<string, unknown>;

  const pairing = pairingById(typeof fields.pair === 'string' ? fields.pair : '');
  if (!pairing) return { ok: false, error: 'The answer did not name a pairing from the catalogue.' };

  const brand = normaliseHex(fields.brand);
  const accent = normaliseHex(fields.accent);
  let pageBackground = normaliseHex(fields.pageBackground);
  let textColour = normaliseHex(fields.text);
  if (!brand || !accent || !pageBackground || !textColour) {
    return { ok: false, error: 'A colour was missing or was not a six-digit hex.' };
  }

  // The paper must be paper. A mid-tone "background" breaks the light
  // sections every preset assumes; a pale tint keeps its temperature.
  if (luminance(pageBackground) < 0.72) pageBackground = DEFAULT_THEME.pageBackground;
  // And the ink must be ink.
  if (luminance(textColour) > 0.35) textColour = DEFAULT_THEME.text;

  const corners = fields.corners === 'sharp' || fields.corners === 'round' ? fields.corners : 'soft';

  return {
    ok: true,
    pairing,
    theme: {
      brand,
      accent,
      pageBackground,
      text: textColour,
      corners,
      typography: typographyFor(pairing),
    },
  };
}
