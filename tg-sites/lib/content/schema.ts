/**
 * Travelgenix Sites — the content model.
 *
 * A page is an ordered list of SECTIONS.
 * A section is an ordered list of ROWS.
 * A row is an ordered list of COLUMNS.
 * A column is an ordered list of BLOCKS.
 *
 * That is the whole model. Nothing nests deeper than a block.
 *
 * ON LAYOUT DATA
 * The V1 spec forbids layout data in the schema. Andy overruled that on
 * 29 Jul 2026 in favour of draggable column widths, which is what every
 * CMS an agent has used before behaves like. So `width` is stored, and it
 * is the ONLY layout number in the whole model. Everything else that could
 * be a pixel value is an enum instead (tone, width, padding, gap, align).
 *
 * The overrule is contained by three rules, enforced here rather than in
 * the editor, because the editor is not the only thing that can write:
 *
 *   1. Widths are percentages that always sum to 100 (normaliseRow).
 *   2. No column may be narrower than MIN_COLUMN_WIDTH.
 *   3. Columns ALWAYS stack on small screens. `stackBelow` chooses the
 *      breakpoint, it cannot choose "never". This is what stops a client
 *      producing the unreadable mobile view the spec was worried about,
 *      while leaving desktop widths completely free.
 *
 * There are still no positions, no margins and no per-breakpoint overrides.
 */

import { z } from 'zod';

import { escapeHtml } from './sanitise';

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

/** A column narrower than this is unreadable at any viewport. */
export const MIN_COLUMN_WIDTH = 10;

/** More than this many columns in one row cannot be made to read well. */
export const MAX_COLUMNS_PER_ROW = 6;

/** Rounding tolerance when checking that widths sum to 100. */
export const WIDTH_SUM_TOLERANCE = 0.01;

/**
 * Vertical breathing room on a section, in pixels.
 *
 * A NUMBER, NOT AN ENUM, and the second deliberate exception to "no layout
 * data in the schema". Same reason as the column widths: Andy asked to drag a
 * section taller, and every CMS an agent has used before lets them.
 *
 * Contained the same way the widths are. It snaps to the 4px grid so the site
 * keeps a rhythm, it is clamped at both ends so nothing can be dragged to
 * nothing or to absurdity, and the horizontal padding stays a token, so a
 * section can be taller or shorter but never a different shape.
 */
export const MIN_SECTION_PADDING = 0;
export const MAX_SECTION_PADDING = 240;
export const SECTION_PADDING_STEP = 4;
export const DEFAULT_SECTION_PADDING = 48;

/**
 * What the old named sizes meant.
 *
 * paddingY used to be 'none' | 'xs' | ... | 'xl'. Content saved before the
 * change still says so, and an editor that threw away a client's spacing on
 * upgrade would be unforgivable, so the names are translated on read.
 */
export const LEGACY_PADDING: Readonly<Record<string, number>> = {
  none: 0,
  xs: 8,
  s: 16,
  m: 32,
  l: 48,
  xl: 64,
};

/**
 * The quick answers in the properties pane.
 *
 * Numbers, so they are the same kind of thing the drag produces. Keeping a
 * separate enum for presets and a number for drags would mean two ways to say
 * the same height and a rounding argument about which one won.
 *
 * Used by a SECTION's vertical padding and by the four-sided padding box that
 * sections and columns share, so the same five words mean the same five numbers
 * wherever spacing is set. It was SECTION_PADDING_PRESETS while only sections
 * had it; the name moved with the meaning when columns got the same control on
 * 30 Jul 2026.
 */
export const PADDING_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'None' },
  { value: 16, label: 'S' },
  { value: 32, label: 'M' },
  { value: 48, label: 'L' },
  { value: 64, label: 'XL' },
];

/** Any input, coerced to a legal section padding. Never throws. */
export function normaliseSectionPadding(value: unknown): number {
  const raw = typeof value === 'string' ? LEGACY_PADDING[value] : value;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_SECTION_PADDING;
  const snapped = Math.round(n / SECTION_PADDING_STEP) * SECTION_PADDING_STEP;
  return Math.min(MAX_SECTION_PADDING, Math.max(MIN_SECTION_PADDING, snapped));
}

/** What the old named gaps meant, so stored rows keep their spacing. */
export const LEGACY_GAP: Readonly<Record<string, number>> = {
  none: 0,
  xs: 4,
  s: 8,
  m: 16,
  l: 32,
  xl: 64,
};

export const MAX_GAP = 96;
export const DEFAULT_GAP = 16;

/** Any input, coerced to a legal column gap. Never throws. */
export function normaliseGap(value: unknown): number {
  const raw = typeof value === 'string' ? LEGACY_GAP[value] : value;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_GAP;
  return Math.min(MAX_GAP, Math.max(0, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Box style: padding, background, corners, border, shadow
// ---------------------------------------------------------------------------

/**
 * ONE SHAPE, USED BY BOTH SECTIONS AND COLUMNS.
 *
 * Andy asked for the same spacing and style controls on sections and on
 * columns. Writing that twice would guarantee they drift, so it is written
 * once and embedded in both. The properties pane renders the same component
 * for either, and the renderer emits the same custom properties, so a control
 * added here appears in both places by construction.
 *
 * Pixels, not percentages. Percentage padding in CSS resolves against the
 * container's WIDTH even for top and bottom, so "10%" on a wide section is a
 * huge vertical gap and on a narrow one is nothing. That surprise is not
 * worth the flexibility. The unit shows in the UI so the fixed choice is
 * visible rather than hidden.
 */
export const MAX_PADDING = 240;
export const MAX_RADIUS = 64;
export const MAX_BORDER = 16;
export const MAX_MIN_HEIGHT = 1200;

/** A length in pixels, clamped and rounded. Never throws, never NaN. */
export function px(value: unknown, max: number, fallback = 0): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, Math.round(n)));
}

export const PaddingSchema = z.object({
  top: z.unknown().transform((v) => px(v, MAX_PADDING)),
  right: z.unknown().transform((v) => px(v, MAX_PADDING)),
  bottom: z.unknown().transform((v) => px(v, MAX_PADDING)),
  left: z.unknown().transform((v) => px(v, MAX_PADDING)),
});

export type Padding = z.infer<typeof PaddingSchema>;

export const Shadow = z.enum(['none', 'soft', 'medium', 'strong']);
export type Shadow = z.infer<typeof Shadow>;

/**
 * A colour, or nothing.
 *
 * Whitelisted rather than free text, because this string goes into a CSS
 * custom property that the renderer emits. Hex, rgb/rgba and the theme token
 * names only, so nothing can smuggle a url() or a closing brace through it.
 */
export function safeColour(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const colour = value.trim().toLowerCase();
  if (!colour) return undefined;

  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{4}$|^#[0-9a-f]{6}$|^#[0-9a-f]{8}$/.test(colour)) return colour;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/.test(colour)) {
    return colour;
  }
  if (/^(transparent|inherit|currentcolor)$/.test(colour)) return colour;

  return undefined;
}

export const BoxSchema = z.object({
  padding: PaddingSchema.default({ top: 0, right: 0, bottom: 0, left: 0 }),
  /** Overrides the tone's background when set. */
  background: z.unknown().transform(safeColour).optional(),
  radius: z.unknown().transform((v) => px(v, MAX_RADIUS)),
  borderWidth: z.unknown().transform((v) => px(v, MAX_BORDER)),
  borderColour: z.unknown().transform(safeColour).optional(),
  shadow: Shadow.catch('none').default('none'),
});

export type Box = z.infer<typeof BoxSchema>;

export const EMPTY_BOX: Box = {
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  radius: 0,
  borderWidth: 0,
  shadow: 'none',
};

/** True when a box would render nothing, so the UI can say "not set". */
export function boxIsEmpty(box: Box): boolean {
  const { padding: p } = box;
  return (
    p.top === 0 && p.right === 0 && p.bottom === 0 && p.left === 0 &&
    !box.background && box.radius === 0 && box.borderWidth === 0 && box.shadow === 'none'
  );
}

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const Tone = z.enum(['light', 'subtle', 'dark', 'accent']);
export const SectionWidth = z.enum(['narrow', 'contained', 'wide', 'full']);
export const Spacing = z.enum(['none', 'xs', 's', 'm', 'l', 'xl']);
export const VerticalAlign = z.enum(['top', 'centre', 'bottom']);
export const TextAlign = z.enum(['left', 'centre', 'right']);

/**
 * Where a row's columns collapse to a single stacked column.
 *
 * There is deliberately no 'never'. See the header note: a row that refuses to
 * stack is a row that runs off the side of a phone.
 *
 * `always` is the opposite end and is safe, so it is allowed. Andy asked for it
 * on 31 Jul 2026: a way to say "these columns sit one above the other" without
 * having to make a row per item. It is the same field rather than a second
 * `direction` one, because two fields that both decide whether a row is stacked
 * can disagree, and then what you see depends on which was touched last.
 */
export const StackBelow = z.enum(['always', 'tablet', 'mobile']);

/** How the blocks inside one column sit. */
export const ColumnFlow = z.enum(['stacked', 'row']);
export type ColumnFlow = z.infer<typeof ColumnFlow>;

export type Tone = z.infer<typeof Tone>;
export type SectionWidth = z.infer<typeof SectionWidth>;
export type Spacing = z.infer<typeof Spacing>;
export type VerticalAlign = z.infer<typeof VerticalAlign>;
export type TextAlign = z.infer<typeof TextAlign>;
export type StackBelow = z.infer<typeof StackBelow>;

/**
 * Pixel widths the stack breakpoints resolve to. Used by the renderer.
 *
 * `always` is Infinity, so "is this width below the stacking point" is true at
 * every width without the caller needing a special case for it.
 */
export const STACK_BREAKPOINTS: Record<StackBelow, number> = {
  always: Number.POSITIVE_INFINITY,
  tablet: 1024,
  mobile: 768,
};

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/**
 * Block props are validated per block type by the registry, not here.
 * Keeping this loose at the tree level means an unknown block type round
 * trips through a save instead of being destroyed by it, which is what
 * makes the model forward compatible. The renderer skips what it does not
 * know and logs a warning.
 */
export const BlockSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  props: z.record(z.unknown()).default({}),
});

export type Block = z.infer<typeof BlockSchema>;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export const ColumnSchema = z.object({
  id: z.string().min(1),
  /** Percentage of the row. Normalised so a row's columns sum to 100. */
  width: z.number().min(MIN_COLUMN_WIDTH).max(100),
  align: VerticalAlign.default('top'),
  /**
   * How the blocks inside this column sit: one above the other, or side by side.
   *
   * Stacked is the default and is what a column has always done. Side by side is
   * for the small cases that want it, like two buttons or an icon beside a line
   * of text, without having to make a row of columns to hold two things. Andy
   * asked for it on 31 Jul 2026, in the same breath as the row version.
   *
   * It always falls back to stacked on a phone. The reason is the same one the
   * row's stacking has: two things side by side in a 390px column is two things
   * nobody can read.
   */
  flow: ColumnFlow.default('stacked'),
  /** The same shape a section has. See BoxSchema. */
  box: BoxSchema.default(EMPTY_BOX),
  blocks: z.array(BlockSchema).default([]),
});

export type Column = z.infer<typeof ColumnSchema>;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const RowSchema = z
  .object({
    id: z.string().min(1),
    columns: z.array(ColumnSchema).min(1).max(MAX_COLUMNS_PER_ROW),
  /**
   * Space between columns, in pixels.
   *
   * A number rather than one of six names, for the same reason section height
   * is: it is a thing people want to nudge. LEGACY_GAP translates what the
   * field used to hold.
   */
  gap: z.unknown().transform(normaliseGap),
    stackBelow: StackBelow.default('mobile'),
    /** Reverse the visual order once stacked, so an image can lead on mobile. */
    reverseOnStack: z.boolean().default(false),
  })
  .refine(
    (row) => {
      const sum = row.columns.reduce((total, column) => total + column.width, 0);
      return Math.abs(sum - 100) <= WIDTH_SUM_TOLERANCE;
    },
    { message: 'Column widths in a row must sum to 100', path: ['columns'] },
  );

export type Row = z.infer<typeof RowSchema>;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const SectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(80).optional(),
  tone: Tone.default('light'),
  width: SectionWidth.default('contained'),
  /**
   * Pixels above and below.
   *
   * Kept alongside box.padding rather than folded into it. This is what the
   * foot handle drags and what the presets set, and it is how a section's
   * rhythm is normally expressed. box.padding is the fine control for when a
   * section needs something the presets cannot say. The renderer adds the
   * two, so neither silently wins.
   */
  paddingY: z.unknown().transform(normaliseSectionPadding),
  /** Floor on the section's height, so a short section can still be tall. */
  minHeight: z.unknown().transform((v) => px(v, MAX_MIN_HEIGHT)),
  /** The same shape a column has. See BoxSchema. */
  box: BoxSchema.default(EMPTY_BOX),
  /** Media id or absolute URL. Rendered behind the content with a scrim. */
  backgroundImage: z.string().max(2048).optional(),
  /**
   * A video behind the section, over the picture above.
   *
   * BOTH ARE RENDERED WHEN BOTH ARE SET, and that is what makes this safe to
   * offer. The video sits over the picture, and a visitor who has asked their
   * system for less motion gets the video hidden and the picture showing
   * through. Without a picture they get the section's plain tone, which is
   * honest but plainer, so the editor says to set one.
   */
  backgroundVideo: z.string().max(2048).optional(),
  /**
   * How dark the scrim over a background is, 0 to 100.
   *
   * It used to be a fixed 55 to 65 per cent, chosen so text on a photograph
   * still cleared 4.5:1. That is still the default and it is still the reason
   * the scrim exists. It is settable because a pale photograph with dark
   * lettering over it is a legitimate design the fixed value made impossible,
   * and because a video usually wants more of it than a still does.
   */
  overlay: z.unknown().transform((v) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return 60;
    return Math.min(100, Math.max(0, Math.round(n)));
  }),
  /**
   * A name a link can point at, rendered as the section's id.
   *
   * Without one there is no such thing as in-page navigation: a button could
   * say "#prices" and there would be nothing on the page called that. Slugified
   * on the way in rather than validated and refused, because somebody typing
   * "Our prices" means `our-prices` and being told off for it helps nobody.
   */
  anchor: z.unknown().transform(safeAnchor).optional(),
  rows: z.array(RowSchema).default([]),
});

/**
 * A section name, reduced to something that can be an id and a URL fragment.
 *
 * Undefined rather than an empty string when there is nothing usable left, so
 * the renderer's `id` attribute is simply absent rather than present and empty.
 */
export function safeAnchor(value: unknown): string | undefined {
  const slug = anchorInput(value).replace(/^-+|-+$/g, '');
  return slug || undefined;
}

/**
 * The same reduction, minus the trim, for a box somebody is still typing into.
 *
 * safeAnchor strips hyphens off both ends, which is right for the stored value
 * and wrong while a name is being written: typing "our" then "-" would have the
 * hyphen removed the instant it appeared, and "our-prices" could never be
 * reached. So the editor uses this on every keystroke and safeAnchor when the
 * box is left, and the schema uses safeAnchor whatever the editor did.
 */
export function anchorInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60);
}

export type Section = z.infer<typeof SectionSchema>;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const SeoSchema = z.object({
  title: z.string().max(70).optional(),
  description: z.string().max(200).optional(),
  ogImage: z.string().max(2048).optional(),
  canonical: z.string().max(2048).optional(),
  noindex: z.boolean().default(false),
});

export type Seo = z.infer<typeof SeoSchema>;

export const PageSchema = z.object({
  /** Bumped when the shape changes so stored trees can be migrated. */
  version: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  slug: z
    .string()
    .max(120)
    .regex(/^[a-z0-9]*(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words separated by hyphens'),
  seo: SeoSchema.default({ noindex: false }),
  sections: z.array(SectionSchema).default([]),
});

export type Page = z.infer<typeof PageSchema>;

export const CONTENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Regions: the header and the footer
// ---------------------------------------------------------------------------

/**
 * A region is a page's worth of sections that appears on every page.
 *
 * SAME SECTIONS, DELIBERATELY. A header is not a special kind of object with a
 * logo slot and a menu slot: it is sections, rows, columns and blocks, exactly
 * like a page. That is what lets the same renderer draw it, the same editor
 * edit it, and every block in the library work inside it, widgets included. The
 * alternative, a bespoke header model, would have needed its own renderer and
 * its own editor and would still have been less capable than the one we have.
 *
 * What a region does NOT have is a slug, a title, a parent or SEO. None of them
 * mean anything for furniture that appears on every URL.
 */
export const REGIONS = ['header', 'footer'] as const;

export const RegionName = z.enum(REGIONS);
export type RegionName = (typeof REGIONS)[number];

export const RegionSchema = z.object({
  /** Bumped when the shape changes, exactly as a page's is. */
  version: z.literal(1),
  region: RegionName,
  /**
   * Stay put as the page scrolls. Header only.
   *
   * Pure CSS, `position: sticky`. Stored here rather than as a section property
   * because it is a fact about the header as a whole: two sticky sections in one
   * header would stack up and eat the screen.
   */
  sticky: z.boolean().default(false),
  /**
   * Sit OVER the first section instead of above it. Header only.
   *
   * The look every travel site opens with: a full-bleed hero photograph with the
   * logo and menu floating on top of it. Without this the header is a white bar
   * pushing the photograph down the page.
   *
   * It only works when the first section has something behind it, so the editor
   * says so rather than letting somebody turn it on over a white section and
   * wonder why nothing changed.
   */
  overlay: z.boolean().default(false),
  sections: z.array(SectionSchema).default([]),
});

export type Region = z.infer<typeof RegionSchema>;

// ---------------------------------------------------------------------------
// Width normalisation
// ---------------------------------------------------------------------------

/**
 * Force a set of column widths to be legal: at least MIN_COLUMN_WIDTH each,
 * summing to exactly 100.
 *
 * Called on every write that touches columns. The editor cannot be trusted
 * as the only guard because an import or an API call can write a tree too.
 *
 * Rounds to two decimal places, then puts any residue from that rounding on
 * the widest column, which is where it is least visible.
 */
export function normaliseWidths(widths: number[]): number[] {
  if (widths.length === 0) return [];

  const count = widths.length;

  // A row that cannot satisfy the minimum gets equal columns instead. This
  // only happens above 10 columns, which MAX_COLUMNS_PER_ROW already blocks,
  // but an import could still try it.
  if (count * MIN_COLUMN_WIDTH > 100) {
    return Array.from({ length: count }, () => round2(100 / count));
  }

  // Anything non-finite or non-positive is treated as an equal share, so a
  // NaN from a bad drag cannot poison the row.
  const safe = widths.map((width) =>
    Number.isFinite(width) && width > 0 ? width : 100 / count,
  );

  const total = safe.reduce((sum, width) => sum + width, 0);
  let scaled = safe.map((width) => (width / total) * 100);

  // Lift anything under the minimum, then take the difference back off the
  // columns that have room, proportionally to their surplus.
  const deficit = scaled.reduce(
    (sum, width) => sum + Math.max(0, MIN_COLUMN_WIDTH - width),
    0,
  );

  if (deficit > 0) {
    const surplus = scaled.reduce(
      (sum, width) => sum + Math.max(0, width - MIN_COLUMN_WIDTH),
      0,
    );
    scaled = scaled.map((width) => {
      if (width <= MIN_COLUMN_WIDTH) return MIN_COLUMN_WIDTH;
      if (surplus <= 0) return width;
      const share = (width - MIN_COLUMN_WIDTH) / surplus;
      return width - deficit * share;
    });
  }

  const rounded = scaled.map(round2);

  // Rounding leaves a residue. Park it on the widest column.
  const residue = round2(100 - rounded.reduce((sum, width) => sum + width, 0));
  if (residue !== 0) {
    let widest = 0;
    for (let i = 1; i < rounded.length; i += 1) {
      if (rounded[i] > rounded[widest]) widest = i;
    }
    rounded[widest] = round2(rounded[widest] + residue);
  }

  return rounded;
}

/** Apply normaliseWidths to a row, returning a new row. */
export function normaliseRow(row: Row): Row {
  const widths = normaliseWidths(row.columns.map((column) => column.width));
  return {
    ...row,
    columns: row.columns.map((column, index) => ({ ...column, width: widths[index] })),
  };
}

/** Apply normaliseRow across a whole page. */
export function normalisePage(page: Page): Page {
  return {
    ...page,
    sections: page.sections.map((section) => ({
      ...section,
      rows: section.rows.map(normaliseRow),
    })),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; page: Page }
  | { ok: false; errors: string[] };

/**
 * Parse an unknown value into a Page.
 *
 * Widths are normalised BEFORE validation, so a tree that is merely untidy
 * (widths summing to 99.98 after a drag) is repaired rather than rejected.
 * A tree that is actually malformed still fails.
 */
export function parsePage(input: unknown): ParseResult {
  const pre = preNormalise(input);
  const result = PageSchema.safeParse(pre);

  if (result.success) return { ok: true, page: normalisePage(result.data) };

  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}

export type RegionParseResult =
  | { ok: true; region: Region }
  | { ok: false; errors: string[] };

/**
 * Parse an unknown value into a header or a footer.
 *
 * The same two steps parsePage takes, over the same preNormalise, which is why
 * that function keys off `sections` rather than off anything page-shaped: a
 * region's stored tree gets its column widths repaired and its old blocks
 * upgraded by exactly the code a page's does, and neither can quietly drift
 * from the other.
 *
 * `region` is stamped by the caller rather than trusted from the JSON. It comes
 * from the primary key of the row being read, and a stored blob claiming to be
 * the footer while sitting in the header row should not be able to say so.
 */
export function parseRegion(input: unknown, region: RegionName): RegionParseResult {
  const pre = preNormalise(input);
  const base = pre && typeof pre === 'object' ? (pre as Record<string, unknown>) : {};
  const result = RegionSchema.safeParse({ version: 1, ...base, region });

  if (result.success) {
    return {
      ok: true,
      region: {
        ...result.data,
        sections: result.data.sections.map((section) => ({
          ...section,
          rows: section.rows.map(normaliseRow),
        })),
      },
    };
  }

  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}

/** An empty header or footer, for a tenant that has never had one. */
export function emptyRegion(region: RegionName): Region {
  return { version: CONTENT_VERSION, region, sticky: false, overlay: false, sections: [] };
}

/** Normalise widths on a raw object before it has been validated. */
function preNormalise(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const page = input as Record<string, unknown>;
  if (!Array.isArray(page.sections)) return input;

  return {
    ...page,
    sections: page.sections.map((section) => {
      if (!section || typeof section !== 'object') return section;
      const s = section as Record<string, unknown>;
      if (!Array.isArray(s.rows)) return section;

      return {
        ...s,
        rows: s.rows.map((row) => {
          if (!row || typeof row !== 'object') return row;
          const r = row as Record<string, unknown>;
          if (!Array.isArray(r.columns) || r.columns.length === 0) return row;

          const widths = normaliseWidths(
            r.columns.map((column) =>
              column && typeof column === 'object'
                ? Number((column as Record<string, unknown>).width)
                : Number.NaN,
            ),
          );

          return {
            ...r,
            columns: r.columns.map((column, index) => {
              if (!column || typeof column !== 'object') return column;
              const c = column as Record<string, unknown>;
              return {
                ...c,
                width: widths[index],
                blocks: Array.isArray(c.blocks) ? c.blocks.map(upgradeBlock) : c.blocks,
              };
            }),
          };
        }),
      };
    }),
  };
}

/**
 * Bring a block written by an older deploy up to the shape today's code expects.
 *
 * THE COMPLEMENT TO THE LOOSE BLOCK SCHEMA. BlockSchema deliberately does not
 * validate props, so an unknown block round trips through a save instead of
 * being destroyed by it. That makes the model forward compatible. This is the
 * other direction: a block whose props have MOVED still has to render.
 *
 * It runs inside preNormalise, which every read, every save and every restore
 * passes through (lib/db/pages.ts calls parsePage in all three), so a page is
 * upgraded once on the way in and saved in the new shape from then on. No
 * database migration, and nothing downstream has to carry a fallback.
 *
 * WHAT IT DOES TODAY: a heading used to store `text`, a plain string the
 * renderer escaped. Since 31 Jul 2026 it stores `html`, which is what let the
 * formatting toolbar reach a heading at all. So a heading with words in `text`
 * and nothing in `html` gets its words escaped into `html`.
 *
 * `text` is LEFT IN PLACE rather than deleted, on purpose. Between this deploy
 * and the next save, a rollback to the previous release must still find a
 * heading it can render. It costs a few bytes and it buys a safe rollback.
 */
function upgradeBlock(block: unknown): unknown {
  if (!block || typeof block !== 'object') return block;
  const b = block as Record<string, unknown>;
  if (b.type !== 'heading') return block;

  const props = (b.props && typeof b.props === 'object' ? b.props : {}) as Record<string, unknown>;
  const html = props.html;
  if (typeof html === 'string' && html) return block;

  const text = props.text;
  if (typeof text !== 'string' || !text) return block;

  return { ...b, props: { ...props, html: escapeHtml(text) } };
}
