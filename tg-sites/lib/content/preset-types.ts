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
/*
 * ONE NAMING TRAP, AND IT IS RELUME'S FAULT AS MUCH AS OURS. Relume calls the
 * big opening section of a page a "Header Section". We already use `header` for
 * the site's own header REGION, the navbar that sits on every page. They are
 * completely different things and the two words are the same. So ours is `hero`,
 * which is what everybody outside Relume calls it, and `header` keeps meaning
 * the region. Do not rename either one to match the other.
 */
export const PRESET_CATEGORIES = [
  { id: 'blank', label: 'Blank', scope: 'page' },
  { id: 'hero', label: 'Hero', scope: 'page' },
  { id: 'text', label: 'Text', scope: 'page' },
  { id: 'features', label: 'Features', scope: 'page' },
  { id: 'cta', label: 'Call to action', scope: 'page' },
  { id: 'gallery', label: 'Gallery', scope: 'page' },
  { id: 'testimonials', label: 'Testimonials', scope: 'page' },
  { id: 'logos', label: 'Logos and badges', scope: 'page' },
  { id: 'stats', label: 'Key numbers', scope: 'page' },
  { id: 'steps', label: 'How it works', scope: 'page' },
  { id: 'pricing', label: 'Pricing', scope: 'page' },
  { id: 'faq', label: 'FAQ', scope: 'page' },
  { id: 'team', label: 'Team', scope: 'page' },
  { id: 'blog', label: 'Blog', scope: 'page' },
  { id: 'banner', label: 'Banner', scope: 'page' },
  { id: 'contact', label: 'Contact', scope: 'page' },
  { id: 'header', label: 'Header', scope: 'header' },
  { id: 'footer', label: 'Footer', scope: 'footer' },
] as const;

export type PresetCategory = (typeof PRESET_CATEGORIES)[number]['id'];

/** Where a category belongs: a page, or one of the two site regions. */
export type PresetScope = (typeof PRESET_CATEGORIES)[number]['scope'];

/**
 * What a block in a preset is FOR.
 *
 * WHY THIS EXISTS AT ALL: so a design from Figma, Relume or the slicer can be
 * MAPPED onto one of our sections rather than carried in frozen. A matcher can
 * already read the shape of a preset off its rows, because the blocks are right
 * there. What it cannot read is intent. "There is an h6 and an h2 here" does not
 * say which one is the section's title and which is the small line above it, and
 * that is exactly the question that decides where the design's own heading goes.
 *
 * THIS IS NOT THEORETICAL. lib/content/starters.ts had to grow titleBlock()
 * because firstBlock(section, 'heading') wrote the company name into the h6
 * eyebrow and left the h2 saying "Everything in one place". Same mistake, found
 * by reading the built page rather than by any assertion.
 */
export type SlotRole =
  /** The small line above the title. Relume calls it a tagline. */
  | 'eyebrow'
  /** The section's own heading. Exactly one per section. */
  | 'title'
  /** The sentence under the title, when it is doing a different job from body. */
  | 'subtitle'
  /** Ordinary prose. */
  | 'body'
  /** The section's main picture or video. */
  | 'media'
  /** A button, or a group of them. */
  | 'action'
  /** A repeater: cards, logos, figures, questions, steps. */
  | 'items'
  /** Present, but not what the section is about. */
  | 'aside';

/**
 * A block in a preset: its type, and only what differs from its defaults.
 *
 * `role` is OPTIONAL BY DESIGN, and the default is derived rather than blank.
 * Annotating all eighty-odd existing presets by hand would be churn with a
 * mistake in it somewhere; deriving means the whole library gains the contract
 * at once, and a preset only says anything when the derivation would be wrong.
 * See roleOf() in presets.ts for what is derived and how.
 */
export interface PresetBlock {
  type: string;
  props?: Record<string, unknown>;
  role?: SlotRole;
  /**
   * A search term for the picture that goes here, for image and gallery blocks.
   *
   * OPTIONAL, and only used by hero presets so far. It drives two things that
   * have to agree: the photograph the picker preview shows, and the one that is
   * fetched into the client's own media when the hero is added. Left off, a hero
   * image gets a fitting travel query chosen from a small palette by its
   * position, so the previews carry photographs without every preset having to
   * spell one out. Set it when a particular section wants a particular subject.
   *
   * It is a QUERY, not a URL. A frozen stock URL in a preset is the thing the
   * "pictures start empty" rule at the top of presets-page.ts exists to prevent;
   * a query is resolved fresh, into the client's media, credited and swappable.
   */
  photo?: string;
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
  /**
   * How the blocks INSIDE a column sit: stacked, or in a row. One entry per
   * column, a gap leaving that column its stacked default.
   *
   * The floating header bars use it: a logo, a menu and a button ride side by
   * side inside one rounded column so the whole bar is a single pill rather than
   * three cells across the open width. The column already carries `flow` (see
   * ColumnFlow in schema.ts); this is how a preset sets it, the same way
   * columnBox sets the box. It stacks on a phone like every flow-row column does.
   */
  columnFlow?: ReadonlyArray<Column['flow'] | undefined>;
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
  section?: {
    paddingY?: number;
    width?: Section['width'];
    tone?: Section['tone'];
    /**
     * A search term for a photograph behind the whole section, for the heroes
     * whose picture IS the background rather than a block. Same contract as a
     * block's `photo`: a query resolved into the client's media, never a frozen
     * URL, and it drives both the preview and the fill on insert.
     */
    backgroundQuery?: string;
  };
}

// ---------------------------------------------------------------------------
// The mapping contract
// ---------------------------------------------------------------------------

/**
 * What a preset looks like to something trying to map a design onto it.
 *
 * EVERYTHING HERE IS DERIVED FROM `rows`, not declared alongside them, and that
 * is deliberate. presets.ts says at the top that a preset is DATA so the picker
 * thumbnail cannot show a section it does not build; a hand-written shape could
 * disagree with the rows the same way. So the only thing a preset ever states is
 * a role, and only to correct the derivation. The rest is read off the blocks.
 */
export interface PresetSignature {
  category: PresetCategory;
  /**
   * Where the main picture sits relative to the words.
   *
   * The axis a matcher needs most: a Figma hero with the photograph on the right
   * should not land in the preset that puts it on the left.
   */
  media: 'none' | 'left' | 'right' | 'above' | 'below';
  align: 'left' | 'centre';
  /** The widest row. 1 is a stack, more is a grid. */
  columns: number;
  /** True when several columns carry the same pattern, i.e. it is a grid of items. */
  repeated: boolean;
  /** Every role present, de-duplicated, in reading order. */
  roles: SlotRole[];
}

/** How big a heading is, so the biggest one can be found. */
const HEADING_RANK: Record<string, number> = { h1: 6, h2: 5, h3: 4, h4: 3, h5: 2, h6: 1 };

/** Block types that are a list of things rather than one thing. */
const ITEM_BLOCKS = new Set([
  'cards', 'slider', 'gallery', 'logos', 'stats', 'steps',
  'accordion', 'tabs', 'list', 'social', 'nav', 'table',
]);

const MEDIA_BLOCKS = new Set(['image', 'video']);
const ACTION_BLOCKS = new Set(['button', 'button-group']);

function headingRank(block: PresetBlock): number {
  const style = block.props?.style;
  return typeof style === 'string' ? (HEADING_RANK[style] ?? 0) : 0;
}

/** Every block in a preset, flattened, in reading order. */
export function presetBlocks(preset: SectionPreset): PresetBlock[] {
  return preset.rows.flatMap((row) => row.columns.flat());
}

/**
 * What each block is for.
 *
 * DERIVED, WITH A DECLARED ROLE ALWAYS WINNING. The rules below are the ones
 * that are safe to guess:
 *
 *   title    the BIGGEST heading in the section, never the first. This is the
 *            titleBlock() rule from starters.ts, which exists because "first
 *            heading" put the company name in the eyebrow.
 *   eyebrow  a smaller heading that comes BEFORE the title.
 *   items    a block that is a list of things by its nature.
 *   media    a picture or a video.
 *   action   a button or a group of them.
 *   body     anything else with words in it.
 *
 * A heading AFTER the title is left as body rather than guessed at, because in
 * a grid of columns it is an item's own heading and calling it a subtitle would
 * be worse than saying nothing.
 */
export function presetRoles(preset: SectionPreset): Map<PresetBlock, SlotRole> {
  const blocks = presetBlocks(preset);
  const roles = new Map<PresetBlock, SlotRole>();

  let best: PresetBlock | null = null;
  for (const block of blocks) {
    if (block.type !== 'heading') continue;
    if (!best || headingRank(block) > headingRank(best)) best = block;
  }

  let seenTitle = false;
  for (const block of blocks) {
    if (block.role) {
      roles.set(block, block.role);
      if (block.role === 'title') seenTitle = true;
      continue;
    }

    if (block === best) {
      roles.set(block, 'title');
      seenTitle = true;
      continue;
    }

    if (block.type === 'heading') {
      roles.set(block, seenTitle ? 'body' : 'eyebrow');
      continue;
    }

    if (ITEM_BLOCKS.has(block.type)) roles.set(block, 'items');
    else if (MEDIA_BLOCKS.has(block.type)) roles.set(block, 'media');
    else if (ACTION_BLOCKS.has(block.type)) roles.set(block, 'action');
    else roles.set(block, 'body');
  }

  return roles;
}

/** Read a preset's shape, for matching a design against it. */
export function presetSignature(preset: SectionPreset): PresetSignature {
  const roles = presetRoles(preset);
  const columns = Math.max(1, ...preset.rows.map((row) => row.widths.length));

  /*
   * A GRID IS TWO COLUMNS THAT SAY THE SAME THING, not just two columns. A hero
   * with words on the left and a photograph on the right is also two columns and
   * is not a grid, so counting alone would call every split section a repeater.
   */
  const repeated = preset.rows.some((row) => {
    if (row.columns.length < 2) return false;
    const shape = row.columns.map((column) => column.map((block) => block.type).join('+'));
    return shape.every((entry) => entry === shape[0]);
  });

  /*
   * Where the picture is, relative to the title.
   *
   * COMPARED ACROSS ROWS AS WELL AS WITHIN ONE. The first version only looked
   * inside a row, so a hero with the words in row one and a wide photograph in
   * row two came out as "above" when the picture is plainly below. A matcher
   * using that would have put a Figma hero's image over its own heading.
   */
  const find = (role: SlotRole): { row: number; column: number; index: number } | null => {
    for (let row = 0; row < preset.rows.length; row += 1) {
      const columns = preset.rows[row].columns;
      for (let column = 0; column < columns.length; column += 1) {
        const index = columns[column].findIndex((block) => roles.get(block) === role);
        if (index !== -1) return { row, column, index };
      }
    }
    return null;
  };

  const mediaAt = find('media');
  const titleAt = find('title');

  let media: PresetSignature['media'] = 'none';
  if (mediaAt && !titleAt) media = 'above';
  else if (mediaAt && titleAt) {
    if (mediaAt.row !== titleAt.row) media = mediaAt.row < titleAt.row ? 'above' : 'below';
    else if (mediaAt.column !== titleAt.column) {
      media = mediaAt.column < titleAt.column ? 'left' : 'right';
    } else media = mediaAt.index < titleAt.index ? 'above' : 'below';
  }

  // How the words are set, taken from the title itself.
  let align: PresetSignature['align'] = 'left';
  for (const [block, role] of roles) {
    if (role !== 'title') continue;
    align = block.props?.align === 'centre' ? 'centre' : 'left';
    break;
  }

  const order: SlotRole[] = [];
  for (const block of presetBlocks(preset)) {
    const role = roles.get(block);
    if (role && !order.includes(role)) order.push(role);
  }

  return { category: preset.category, media, align, columns, repeated, roles: order };
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
 *
 * THE HAIRLINE WAS TRANSPARENT UNTIL 2 AUG 2026, which is the same failure
 * PANEL had and from the same cause. A width with no colour renders as
 * `border: 1px solid transparent`: a one-pixel ring of nothing, reserved and
 * never drawn. Every carded design in the library, eleven presets of pricing
 * panels and team cards and feature grids, drew as columns with generous
 * padding and no edges. Nobody could have written a colour here either, because
 * `safeColour` took hex and nothing else and a hex is a colour that stops
 * matching the day a client themes their site. Found by rendering a page and
 * reading `--tgs-bc: transparent` off the column.
 *
 * `--tgs-border` and not a fixed grey, because the tones remap it: a card on a
 * dark band gets the border measured against navy rather than one that vanishes
 * into it. See the tone rules at the top of app/globals.css.
 */
export const CARD = {
  borderWidth: 1,
  borderColour: 'var(--tgs-border)',
  radius: 12,
  padding: { top: 24, right: 24, bottom: 24, left: 24 },
} as const;

/** The same card with more room inside, for a pricing panel or a testimonial. */
export const CARD_ROOMY = {
  borderWidth: 1,
  borderColour: 'var(--tgs-border)',
  radius: 12,
  padding: { top: 32, right: 32, bottom: 32, left: 32 },
} as const;

/**
 * A tinted panel with no border, for the times a hairline would be too much.
 *
 * IT WAS INVISIBLE UNTIL 2 AUG 2026 and that is worth writing down, because it
 * failed the quiet way. A box with a radius, some padding and no background
 * renders as padding: no border, no fill, nothing an eye can find. Two presets
 * carried one for a fortnight and drew a panel nobody could see.
 *
 * The reason it had no background is the same one that made it worth fixing
 * properly. `safeColour` would take a hex and nothing else, and a hex baked into
 * a preset is a colour that stops matching the day a client themes their site,
 * so a real colour was the wrong answer and no colour was the one that shipped.
 * Now it takes theme tokens, so this is the site's own subtle surface and it
 * moves with the theme.
 *
 * WHICH TONES IT SUITS. `surface-alt` is a pale tint, so this belongs on a light
 * or subtle section. On a dark band, use CARD: the tones remap the border to
 * something that shows, and a pale panel on navy is a different design.
 */
export const PANEL = {
  radius: 12,
  background: 'var(--tgs-surface-alt)',
  padding: { top: 28, right: 28, bottom: 28, left: 28 },
} as const;
