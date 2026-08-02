/**
 * Designed sections: ready-made arrangements a client can drop in and edit.
 *
 * THE PUBLIC SURFACE. The library itself is next door, split on 1 Aug 2026 when
 * it went from two categories to twelve:
 *
 *   lib/content/preset-types.ts    the shapes, the categories, the shared bits
 *   lib/content/presets-page.ts    everything you can put on a page
 *   lib/content/presets-region.ts  headers and footers
 *
 * Everything still imports from here, so the split cost nothing at the call
 * sites. What is left in this file is the two things that are code rather than
 * data: turning a preset into a real section, and drawing its thumbnail.
 *
 * WHY THE LIBRARY IS DATA RATHER THAN A FUNCTION PER PRESET
 *
 * Because the thumbnail is drawn from it. layouts.ts learned that lesson first
 * and says so: a hand-made picture per entry can promise something the entry
 * does not build, and nothing catches it. Here the same rows-and-blocks
 * description is what builds the section AND what draws the wireframe, so a
 * preset cannot show a picture of a different section.
 */

import { createBlock, createColumn, newId } from './factory';
import {
  PRESET_CATEGORIES,
  type PresetBlock,
  type PresetCategory,
  type PresetRow,
  type PresetScope,
  type SectionPreset,
} from './preset-types';
import { PAGE_PRESETS } from './presets-page';
import { REGION_PRESETS } from './presets-region';
import {
  DEFAULT_GAP,
  DEFAULT_SECTION_PADDING,
  EMPTY_BOX,
  normaliseWidths,
  type Block,
  type Row,
  type Section,
} from './schema';

export {
  CARD,
  CARD_ROOMY,
  CENTRED,
  PANEL,
  PRESET_CATEGORIES,
  presetBlocks,
  presetRoles,
  presetSignature,
  type PresetBlock,
  type PresetCategory,
  type PresetRow,
  type PresetScope,
  type PresetSignature,
  type SectionPreset,
  type SlotRole,
} from './preset-types';

/** Every designed section there is, pages and regions together. */
export const SECTION_PRESETS: readonly SectionPreset[] = [...PAGE_PRESETS, ...REGION_PRESETS];

export function presetById(id: string): SectionPreset | undefined {
  return SECTION_PRESETS.find((preset) => preset.id === id);
}

export function presetsIn(category: PresetCategory): SectionPreset[] {
  return SECTION_PRESETS.filter((preset) => preset.category === category);
}

/**
 * The categories that belong on the screen somebody is looking at.
 *
 * A header preset and a page section are the same shape, so nothing in the data
 * stops a four-column footer being dropped into the middle of an About page.
 * This is what stops it, and it is asked of the picker rather than enforced in
 * the builder on purpose: putting a footer arrangement on a page is not
 * dangerous, it is just never what anybody meant, so the right answer is not to
 * offer it rather than to refuse it afterwards.
 */
export function categoriesFor(
  scope: PresetScope,
): ReadonlyArray<{ id: PresetCategory; label: string }> {
  return PRESET_CATEGORIES
    .filter((entry) => entry.scope === scope)
    // A category with nothing in it would draw a tab that leads to an empty
    // grid. Cheaper to leave it out than to explain it.
    .filter((entry) => presetsIn(entry.id).length > 0)
    .map((entry) => ({ id: entry.id, label: entry.label }));
}

// ---------------------------------------------------------------------------
// Building one
// ---------------------------------------------------------------------------

/**
 * Turn a preset into a real section, with fresh ids throughout.
 *
 * Fresh ids matter more than it looks. Adding the same preset twice must produce
 * two independent sections; sharing a block id would make the outline's keys
 * collide and the editor's path lookups ambiguous, and the failure would show up
 * as the wrong block being edited rather than as an error.
 *
 * Props are MERGED over the block's defaults rather than replacing them, so a
 * preset that says nothing about alignment gets whatever the block type says
 * alignment should be.
 */
export function buildPresetSection(preset: SectionPreset): Section {
  return {
    id: newId('sec'),
    tone: preset.section?.tone ?? 'light',
    width: preset.section?.width ?? 'contained',
    paddingY: preset.section?.paddingY ?? DEFAULT_SECTION_PADDING,
    minHeight: 0,
    // The scrim strength over a background. 60 is what it was fixed at.
    overlay: 60,
    box: { ...EMPTY_BOX },
    rows: preset.rows.map(buildRow),
  };
}

function buildRow(row: PresetRow): Row {
  const total = row.widths.reduce((sum, width) => sum + width, 0);
  const widths = normaliseWidths(row.widths.map((width) => (width / total) * 100));

  return {
    id: newId('row'),
    columns: widths.map((width, index) => {
      const column = createColumn(width, (row.columns[index] ?? []).map(buildBlock));
      const box = row.columnBox?.[index];
      /*
       * VERTICAL ALIGNMENT LIVES ON THE COLUMN, not on the row, which is worth
       * knowing before reaching for it: a row says how wide its columns are and
       * each column says how it sits beside the others. The preset expresses it
       * once because a row where two columns disagree about it is a mistake
       * rather than a design, so it is set on every column here.
       *
       * This is why a logo and a menu sit on the same line. Without it the
       * columns are top-aligned and the menu clings to the top of the taller
       * logo beside it.
       */
      const aligned = row.align ? { ...column, align: row.align } : column;
      return box ? { ...aligned, box: { ...aligned.box, ...box } } : aligned;
    }),
    gap: row.gap ?? DEFAULT_GAP,
    stackBelow: row.stackBelow ?? 'mobile',
    reverseOnStack: false,
  };
}

function buildBlock(spec: PresetBlock): Block {
  const block = createBlock(spec.type);
  return { ...block, props: { ...block.props, ...spec.props } };
}

// ---------------------------------------------------------------------------
// The thumbnail
// ---------------------------------------------------------------------------

/**
 * A wireframe of a preset, in a 0..1 box, for the picker to draw.
 *
 * Derived from the same rows and blocks that build the section, which is the
 * whole reason the library is data. Each block becomes one or more bars: a
 * heading is a solid bar whose height follows its style, text is a stack of thin
 * lines, a button is a short rounded bar, a picture is a block of frame tone.
 * The result reads as a miniature of the real thing without rendering it.
 *
 * Returned as plain numbers so this is testable with no DOM, same as layoutCells.
 */
export interface ThumbBar {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Solid for a heading or a button, light for body text, mid for anything
   * that is a picture or a panel rather than words.
   *
   * THE THIRD TONE ARRIVED WITH THE EIGHT NEW CATEGORIES, and it had to. Half of
   * them are built from pictures, cards and panels, all of which fell into the
   * catch-all case and drew one thin grey line each. Twelve categories of
   * near-identical thumbnails is a picker nobody can use, which would have
   * undone the reason the library is data in the first place.
   */
  tone: 'strong' | 'soft' | 'frame';
  /** Rounded ends, for a button. */
  pill?: boolean;
}

/** How tall each block draws, and how many lines it becomes. */
const HEADING_HEIGHT: Readonly<Record<string, number>> = {
  h1: 0.13, h2: 0.11, h3: 0.09, h4: 0.075, h5: 0.065, h6: 0.05,
};

const LINE = 0.035;
const LINE_GAP = 0.025;
const BLOCK_GAP = 0.045;

/** What a picture-shaped block draws as, by its ratio. */
const RATIO_HEIGHT: Readonly<Record<string, number>> = {
  '16/9': 0.16, '4/3': 0.2, '1/1': 0.24, '3/4': 0.3, auto: 0.2,
};

export function presetBars(preset: SectionPreset, gap = 0.05): ThumbBar[] {
  const bars: ThumbBar[] = [];
  const rowCount = preset.rows.length;
  const rowHeight = (1 - gap * (rowCount - 1)) / rowCount;

  preset.rows.forEach((row, rowIndex) => {
    const total = row.widths.reduce((sum, width) => sum + width, 0);
    const available = 1 - gap * (row.widths.length - 1);
    const top = rowIndex * (rowHeight + gap);

    /*
     * Laid out relative to the row, then CENTRED in it.
     *
     * Drawn top-aligned first, and every thumbnail came out with its bars
     * hugging the top and a third of the box empty underneath. A real section
     * does not look like that: its padding sits above and below the content.
     * Centring per row rather than over the whole box matters for the
     * multi-row presets, where otherwise the second row starts at the halfway
     * mark with a gap above it.
     */
    const rowBars: ThumbBar[] = [];
    let tallest = 0;
    let x = 0;

    row.widths.forEach((width, columnIndex) => {
      const columnWidth = (width / total) * available;
      let y = 0;

      for (const spec of row.columns[columnIndex] ?? []) {
        const centred = spec.props?.align === 'centre';
        const right = spec.props?.align === 'right';

        for (const bar of barsForBlock(spec, columnWidth)) {
          rowBars.push({
            ...bar,
            // Alignment is drawn, not just stored, or a centred preset and a
            // left-aligned one would show the same picture. Right matters as
            // much as centre now the headers are in here: a menu pushed right
            // is the whole difference between two of them.
            x: x + (centred ? (columnWidth - bar.width) / 2 : right ? columnWidth - bar.width : 0),
            y,
          });
          y += bar.height + LINE_GAP;
        }
        y += BLOCK_GAP - LINE_GAP;
      }

      // The gap after the last block is not content, so it does not count
      // towards the height being centred.
      tallest = Math.max(tallest, Math.max(0, y - BLOCK_GAP));
      x += columnWidth + gap;
    });

    /*
     * A ROW TALLER THAN ITS SHARE IS SHRUNK TO FIT, rather than allowed to run
     * over the bottom of the box.
     *
     * Every preset was text until 1 Aug 2026, and text is short enough that
     * this never came up. The picture-heavy categories broke it immediately:
     * "Titled grid" is a heading over a two-deep gallery, and the gallery alone
     * was taller than the half of the box its row had been given, so the last
     * bar was drawn past the bottom edge. The suite caught it, which is what
     * that check has been sitting there for.
     *
     * Scaled rather than clipped, and scaled per row, so the shape of the
     * thumbnail survives: a portrait picture beside some words still reads as
     * portrait, it is simply smaller.
     */
    const scale = tallest > rowHeight ? rowHeight / tallest : 1;
    const offset = Math.max(0, (rowHeight - tallest * scale) / 2);

    for (const bar of rowBars) {
      bars.push({
        ...bar,
        y: top + offset + bar.y * scale,
        height: bar.height * scale,
      });
    }
  });

  return bars;
}

/** The bars one block becomes, positioned later by the caller. */
function barsForBlock(
  spec: PresetBlock,
  columnWidth: number,
): Array<Omit<ThumbBar, 'x' | 'y'>> {
  const props = spec.props ?? {};
  const items = Array.isArray(props.items) ? props.items.length : 0;

  switch (spec.type) {
    case 'heading': {
      const style = typeof props.style === 'string' ? props.style : 'h3';
      return [{
        width: columnWidth * 0.85,
        height: HEADING_HEIGHT[style] ?? 0.09,
        tone: 'strong',
      }];
    }

    case 'text': {
      // Large text gets fewer, thicker lines, which is what large text looks
      // like from a distance.
      const large = props.size === 'l';
      const count = large ? 2 : 3;
      return Array.from({ length: count }, (_, index) => ({
        // The last line short, because the last line of a paragraph is.
        width: columnWidth * (index === count - 1 ? 0.55 : 0.95),
        height: large ? LINE * 1.6 : LINE,
        tone: 'soft' as const,
      }));
    }

    case 'list':
      return Array.from({ length: items || 3 }, () => ({
        width: columnWidth * 0.8,
        height: LINE,
        tone: 'soft' as const,
      }));

    case 'button':
      return [{ width: columnWidth * 0.45, height: 0.07, tone: 'strong', pill: true }];

    case 'button-group':
      return [{ width: columnWidth * 0.7, height: 0.07, tone: 'strong', pill: true }];

    /*
     * A PICTURE IS A BLOCK, NOT A LINE, and its shape follows its ratio, so a
     * portrait photograph beside some words looks portrait in the thumbnail.
     * This is the difference between the Gallery category reading as five
     * variations and reading as five identical grey smudges.
     */
    case 'image':
    case 'video': {
      const ratio = typeof props.ratio === 'string' ? props.ratio : 'auto';
      return [{ width: columnWidth, height: RATIO_HEIGHT[ratio] ?? 0.2, tone: 'frame' }];
    }

    /* A grid of pictures: one row of frames across the column. */
    case 'gallery': {
      const across = Number(props.columns) || 3;
      const cell = columnWidth / across;
      return Array.from({ length: 2 }, () => ({
        width: columnWidth,
        height: cell * 0.75,
        tone: 'frame' as const,
      }));
    }

    /*
     * A card grid draws as one frame with a strong bar under it, which is what
     * a card is: a picture and a title. Drawn once rather than per card,
     * because at thumbnail size three cards and four look the same and the
     * height is what carries the meaning.
     */
    case 'cards':
    case 'slider':
      return [
        { width: columnWidth, height: 0.18, tone: 'frame' },
        { width: columnWidth * 0.6, height: LINE, tone: 'strong' },
      ];

    /* Folded panels: one strong line per item, evenly spaced. */
    case 'accordion':
      return Array.from({ length: items || 3 }, () => ({
        width: columnWidth,
        height: LINE * 1.4,
        tone: 'soft' as const,
      }));

    /* Tabs: a short strong bar for the strip, then the panel under it. */
    case 'tabs':
      return [
        { width: columnWidth * 0.7, height: LINE, tone: 'strong' },
        { width: columnWidth, height: 0.14, tone: 'frame' },
      ];

    /* A quote: a wide soft block with a short attribution under it. */
    case 'quote':
      return [
        { width: columnWidth * 0.95, height: LINE * 1.8, tone: 'soft' },
        { width: columnWidth * 0.4, height: LINE * 0.8, tone: 'strong' },
      ];

    /* An icon and some words: a small square, a title, a line. */
    case 'icon-item':
      return [
        { width: columnWidth * 0.18, height: 0.05, tone: 'strong' },
        { width: columnWidth * 0.7, height: LINE * 1.2, tone: 'strong' },
        { width: columnWidth * 0.9, height: LINE, tone: 'soft' },
      ];

    /* A table: a strong header line, then banded rows. */
    case 'table': {
      const rows = typeof props.data === 'string' ? props.data.split('\n').length : 4;
      return [
        { width: columnWidth, height: LINE, tone: 'strong' },
        ...Array.from({ length: Math.min(4, Math.max(1, rows - 1)) }, () => ({
          width: columnWidth,
          height: LINE * 0.9,
          tone: 'soft' as const,
        })),
      ];
    }

    /* A menu is a row of short links, drawn as one bar of link-ish width. */
    case 'nav':
      return [{ width: columnWidth * Math.min(1, 0.22 * (items || 4)), height: LINE, tone: 'strong' }];

    case 'divider':
      return [{ width: columnWidth, height: 0.008, tone: 'soft' }];

    case 'spacer':
      return [{ width: 0, height: 0.06, tone: 'soft' }];

    default:
      return [{ width: columnWidth * 0.9, height: LINE, tone: 'soft' }];
  }
}
