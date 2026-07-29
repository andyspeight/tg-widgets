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
 */
export const SECTION_PADDING_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
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
 * There is deliberately no 'never'. See the header note.
 */
export const StackBelow = z.enum(['tablet', 'mobile']);

export type Tone = z.infer<typeof Tone>;
export type SectionWidth = z.infer<typeof SectionWidth>;
export type Spacing = z.infer<typeof Spacing>;
export type VerticalAlign = z.infer<typeof VerticalAlign>;
export type TextAlign = z.infer<typeof TextAlign>;
export type StackBelow = z.infer<typeof StackBelow>;

/** Pixel widths the stack breakpoints resolve to. Used by the renderer. */
export const STACK_BREAKPOINTS: Record<StackBelow, number> = {
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
    gap: Spacing.default('m'),
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
  /** Pixels above and below. See normaliseSectionPadding. */
  paddingY: z.unknown().transform(normaliseSectionPadding),
  /** Media id or absolute URL. Rendered behind the content with a scrim. */
  backgroundImage: z.string().max(2048).optional(),
  rows: z.array(RowSchema).default([]),
});

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
            columns: r.columns.map((column, index) =>
              column && typeof column === 'object'
                ? { ...(column as Record<string, unknown>), width: widths[index] }
                : column,
            ),
          };
        }),
      };
    }),
  };
}
