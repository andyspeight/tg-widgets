/**
 * The shapes a designed section is made of, and the categories they sit in.
 *
 * SPLIT OUT OF presets.ts ON 1 AUG 2026, when the library went from two
 * categories to twelve and the one file stopped being readable. Nothing here
 * changed in the move: same types, same names, same meanings. What it buys is
 * that the data files can import a type without importing the builder, and the
 * builder can import the data without the data importing it back.
 *
 * A preset is DATA, not a function, and that is the load-bearing decision. The
 * thumbnail in the picker is drawn from this same description, so a preset
 * cannot show a picture of a section it does not build. lib/content/layouts.ts
 * learned that first and says so.
 */

import type { Column, Section } from './schema';

/**
 * The tabs down the side of the Designed panel.
 *
 * SCOPE IS WHY THIS IS NOT JUST A LIST OF NAMES. A header preset and a page
 * section are the same shape, so nothing in the data stops somebody dropping a
 * four-column footer into the middle of a page. The scope says where each
 * category belongs, the picker asks for the ones that fit what is being edited,
 * and a category cannot appear on a screen it makes no sense on.
 *
 * Ordered the way somebody builds a page: the neutral shapes, then the words,
 * then the things a page is actually made of, then the two site-chrome ones at
 * the end where they are out of the way until you are on that screen.
 */
export const PRESET_CATEGORIES = [
  { id: 'blank', label: 'Blank', scope: 'page' },
  { id: 'text', label: 'Text', scope: 'page' },
  { id: 'features', label: 'Features', scope: 'page' },
  { id: 'cta', label: 'Call to action', scope: 'page' },
  { id: 'gallery', label: 'Gallery', scope: 'page' },
  { id: 'testimonials', label: 'Testimonials', scope: 'page' },
  { id: 'pricing', label: 'Pricing', scope: 'page' },
  { id: 'faq', label: 'FAQ', scope: 'page' },
  { id: 'team', label: 'Team', scope: 'page' },
  { id: 'contact', label: 'Contact', scope: 'page' },
  { id: 'header', label: 'Header', scope: 'header' },
  { id: 'footer', label: 'Footer', scope: 'footer' },
] as const;

export type PresetCategory = (typeof PRESET_CATEGORIES)[number]['id'];

/** Where a category belongs: a page, or one of the two site regions. */
export type PresetScope = (typeof PRESET_CATEGORIES)[number]['scope'];

/** A block in a preset: its type, and only what differs from its defaults. */
export interface PresetBlock {
  type: string;
  props?: Record<string, unknown>;
}

export interface PresetRow {
  /** Relative widths, exactly as a layout expresses them. */
  widths: number[];
  /** One list of blocks per column. Must be the same length as widths. */
  columns: PresetBlock[][];
  /**
   * Style on the columns themselves, for the presets built out of cards.
   *
   * A card is a column with a border, a radius and some padding, which the
   * column already supports: the preset just needs a way to say so. One entry
   * per column, and a gap in the array leaves that column plain.
   */
  columnBox?: ReadonlyArray<Partial<Column['box']> | undefined>;
  /** Space between the columns, when the default is not right for a card grid. */
  gap?: number;
  /**
   * How the columns line up against each other.
   *
   * Default is stretch, which is right for cards. A header wants `centre`, so a
   * logo and a menu of different heights sit on the same line rather than the
   * menu clinging to the top of the taller one.
   */
  align?: 'top' | 'centre' | 'bottom';
  /**
   * Which breakpoint the columns stack at.
   *
   * NOT "never", and the schema will not let it be: columns ALWAYS stack on a
   * small screen, which is rule 3 at the top of lib/content/schema.ts and is
   * what stops a client producing an unreadable phone view. 'mobile' is the
   * loosest there is and is the default.
   */
  stackBelow?: 'always' | 'tablet' | 'mobile';
}

export interface SectionPreset {
  id: string;
  category: PresetCategory;
  label: string;
  /** One line under the name in the picker. What it is FOR, not what it contains. */
  description: string;
  rows: PresetRow[];
  /** Overrides on the section itself, for the few that need more room. */
  section?: { paddingY?: number; width?: Section['width']; tone?: Section['tone'] };
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export const CENTRED = { align: 'centre' } as const;

/**
 * A column drawn as a card: a hairline border, soft corners, room inside.
 *
 * One constant rather than repeated per preset, so a card is the same card
 * wherever it appears. A client who changes one afterwards changes only theirs,
 * which is the point of a preset being a starting arrangement.
 */
export const CARD = {
  borderWidth: 1,
  radius: 12,
  padding: { top: 24, right: 24, bottom: 24, left: 24 },
} as const;

/** The same card with more room inside, for a pricing panel or a testimonial. */
export const CARD_ROOMY = {
  borderWidth: 1,
  radius: 12,
  padding: { top: 32, right: 32, bottom: 32, left: 32 },
} as const;

/** A panel with no border, for a tinted section where a hairline would fight it. */
export const PANEL = {
  radius: 12,
  padding: { top: 28, right: 28, bottom: 28, left: 28 },
} as const;
