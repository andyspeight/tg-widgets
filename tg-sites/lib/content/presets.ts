/**
 * Designed sections: ready-made arrangements a client can drop in and edit.
 *
 * WHAT THESE ARE AND WHAT LAYOUTS ARE
 *
 * A layout (lib/content/layouts.ts) is a SHAPE: a section with empty columns
 * waiting for blocks. A preset here is a shape WITH CONTENT already in it, so
 * somebody adding "Title and paragraph" gets a heading and a paragraph sized and
 * aligned to look right together, and edits the words rather than assembling it.
 * Andy asked for both on 30 Jul 2026, as two tabs of the same dialog.
 *
 * WHY THIS IS DATA RATHER THAN A FUNCTION PER PRESET
 *
 * Because the thumbnail is drawn from it. layouts.ts learned that lesson first
 * and says so: a hand-made picture per entry can promise something the entry
 * does not build, and nothing catches it. Here the same rows-and-blocks
 * description is what builds the section AND what draws the wireframe, so a
 * preset cannot show a picture of a different section.
 *
 * ONLY THE OVERRIDES ARE WRITTEN DOWN. Every block starts from the defaults in
 * lib/content/blocks.ts, so a preset says "a heading, but centred and H1-sized"
 * rather than restating every property. A new field on a block type reaches every
 * preset without any of them being edited.
 *
 * THE COPY IS PLACEHOLDER AND IS MEANT TO BE REPLACED. It follows the brand
 * voice, because a client who leaves a line in should not be left with something
 * that reads like it came from a machine.
 */

import { createBlock, createColumn, newId } from './factory';
import {
  DEFAULT_GAP,
  DEFAULT_SECTION_PADDING,
  EMPTY_BOX,
  normaliseWidths,
  type Block,
  type Column,
  type Row,
  type Section,
} from './schema';

/**
 * The tabs down the side of the Designed panel.
 *
 * A union rather than a string, so adding a category is a deliberate edit in one
 * place and the picker cannot render a heading for a category with nothing in it.
 * Text is the whole list today, which is what Andy asked to start with.
 */
export const PRESET_CATEGORIES = [
  { id: 'blank', label: 'Blank' },
  { id: 'text', label: 'Text' },
] as const;

export type PresetCategory = (typeof PRESET_CATEGORIES)[number]['id'];

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
// The library
// ---------------------------------------------------------------------------

const CENTRED = { align: 'centre' } as const;

/**
 * A column drawn as a card: a hairline border, soft corners, room inside.
 *
 * One constant rather than repeated per preset, so the cards in the Blank
 * category are the same card. A client who changes one afterwards changes only
 * theirs, which is the point of it being a starting arrangement.
 */
const CARD = { borderWidth: 1, radius: 12, padding: { top: 24, right: 24, bottom: 24, left: 24 } } as const;

/*
 * ---------------------------------------------------------------------------
 * Blank
 * ---------------------------------------------------------------------------
 *
 * Andy asked for these on 31 Jul 2026, as a category of their own. They are the
 * neutral starting arrangements every site needs and no site is defined by: an
 * opener, a picture beside some words, a row of cards, an about line. Nothing
 * here is about travel, which is exactly why they are called Blank and sit above
 * Text in the list.
 */
export const SECTION_PRESETS: readonly SectionPreset[] = [
  {
    id: 'blank-opener',
    category: 'blank',
    label: 'Title, words and a button',
    description: 'A centred opener with somewhere to go next. Good at the top of a page.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Add your title here', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html:
                  '<p>Two or three sentences that say what this page is for and why it is '
                  + 'worth reading. Say the useful thing first.</p>',
                ...CENTRED,
              },
            },
            { type: 'button', props: { label: 'Learn more', align: 'centre' } },
          ],
        ],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'blank-image-and-words',
    category: 'blank',
    label: 'Picture beside words',
    description: 'A picture on one side, the explanation and a button on the other.',
    rows: [
      {
        widths: [1, 1],
        columns: [
          [{ type: 'image', props: { alt: '' } }],
          [
            { type: 'heading', props: { html: 'Tagline here', style: 'h6', level: 'h3' } },
            { type: 'heading', props: { html: 'Add your title here', style: 'h2' } },
            {
              type: 'text',
              props: {
                html:
                  '<p>A short paragraph about what is in the picture, or about the thing '
                  + 'the picture is standing in for.</p>',
              },
            },
            { type: 'button', props: { label: 'Learn more' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'blank-three-cards',
    category: 'blank',
    label: 'Three cards',
    description: 'A title, then three bordered cards. For three things of equal weight.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Tagline here', style: 'h6', level: 'h3', ...CENTRED } },
            { type: 'heading', props: { html: 'Add your title here', style: 'h2', ...CENTRED } },
          ],
        ],
      },
      {
        widths: [1, 1, 1],
        gap: 24,
        columnBox: [CARD, CARD, CARD],
        columns: [
          [
            { type: 'icon-item', props: { icon: '\u2708', title: 'Short title', body: 'One sentence on what this is and why it matters.' } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost' } },
          ],
          [
            { type: 'icon-item', props: { icon: '\u2691', title: 'Short title', body: 'One sentence on what this is and why it matters.' } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost' } },
          ],
          [
            { type: 'icon-item', props: { icon: '\u2605', title: 'Short title', body: 'One sentence on what this is and why it matters.' } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'blank-two-cards',
    category: 'blank',
    label: 'Two cards',
    description: 'Two bordered panels side by side. For a pair of choices.',
    rows: [
      {
        widths: [1, 1],
        gap: 24,
        columnBox: [CARD, CARD],
        columns: [
          [
            { type: 'heading', props: { html: 'Short title', style: 'h4' } },
            {
              type: 'text',
              props: {
                html:
                  '<p>A few lines on what this one is, and who it suits. Keep the two '
                  + 'cards about the same length so neither looks like the afterthought.</p>',
              },
            },
            { type: 'button', props: { label: 'Learn more', variant: 'secondary' } },
          ],
          [
            { type: 'heading', props: { html: 'Short title', style: 'h4' } },
            {
              type: 'text',
              props: {
                html:
                  '<p>A few lines on what this one is, and who it suits. Keep the two '
                  + 'cards about the same length so neither looks like the afterthought.</p>',
              },
            },
            { type: 'button', props: { label: 'Learn more', variant: 'secondary' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'blank-four-points',
    category: 'blank',
    label: 'Four points',
    description: 'Four short points across the page. Stacks in pairs, then singly.',
    rows: [
      {
        widths: [1, 1, 1, 1],
        gap: 24,
        columns: [
          [
            { type: 'icon-item', props: { icon: '\u2708', title: 'Short title', body: 'One line on this point.', ...CENTRED } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost', align: 'centre' } },
          ],
          [
            { type: 'icon-item', props: { icon: '\u2691', title: 'Short title', body: 'One line on this point.', ...CENTRED } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost', align: 'centre' } },
          ],
          [
            { type: 'icon-item', props: { icon: '\u2605', title: 'Short title', body: 'One line on this point.', ...CENTRED } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost', align: 'centre' } },
          ],
          [
            { type: 'icon-item', props: { icon: '\u2665', title: 'Short title', body: 'One line on this point.', ...CENTRED } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost', align: 'centre' } },
          ],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'blank-statement',
    category: 'blank',
    label: 'Statement with a rule',
    description: 'A large centred title over a line, then the detail underneath.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Add your title here', style: 'h1', ...CENTRED } },
            { type: 'divider' },
            {
              type: 'text',
              props: {
                html:
                  '<p>The first paragraph, centred under the rule. This is where the '
                  + 'thing you most want read should go.</p>'
                  + '<p>A second paragraph, if there is more to say. Two is usually the '
                  + 'point at which somebody stops reading.</p>',
                ...CENTRED,
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 96 },
  },

  {
    id: 'blank-words-and-video',
    category: 'blank',
    label: 'Words beside a video',
    description: 'The explanation on one side, something to watch on the other.',
    rows: [
      {
        widths: [1, 1],
        columns: [
          [
            { type: 'heading', props: { html: 'Tagline here', style: 'h6', level: 'h3' } },
            { type: 'heading', props: { html: 'Add your title here', style: 'h2' } },
            {
              type: 'text',
              props: {
                html:
                  '<p>A short paragraph setting up what the video shows, so somebody can '
                  + 'decide whether to watch it before they press play.</p>',
              },
            },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost' } },
          ],
          [{ type: 'video' }],
        ],
      },
    ],
  },

  {
    id: 'blank-about',
    category: 'blank',
    label: 'About',
    description: 'A heading on the left and the writing beside it, on a tinted band.',
    rows: [
      {
        widths: [1, 2],
        columns: [
          [{ type: 'heading', props: { html: 'About', style: 'h2' } }],
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>Who you are, in the words somebody would use out loud. Two or three '
                  + 'sentences is plenty here: this is the part people read on the way to '
                  + 'something else.</p>',
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'text-intro',
    category: 'text',
    label: 'Title and paragraph',
    description: 'A heading on the left, the explanation beside it.',
    rows: [
      {
        widths: [1, 1],
        columns: [
          [{ type: 'heading', props: { html: 'Add your medium length title here', style: 'h2' } }],
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>This is the text area for this paragraph. Say the useful thing first, '
                  + 'then give the detail. Two or three sentences is usually plenty.</p>',
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'text-centred-intro',
    category: 'text',
    label: 'Centred introduction',
    description: 'A small label, a big title and a line underneath. Opens a page well.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Where to next', style: 'h6', level: 'h3', ...CENTRED } },
            { type: 'heading', props: { html: 'Add your medium length title here', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: {
                html:
                  '<p>One or two sentences that tell somebody what this page is for '
                  + 'and why it is worth their time.</p>',
                ...CENTRED,
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 96 },
  },

  {
    id: 'text-statement',
    category: 'text',
    label: 'Statement',
    description: 'One paragraph, large and centred. For the thing you most want read.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>This is the text area for this paragraph. Make it the sentence you '
                  + 'would say first if you only had one.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 96, width: 'narrow' },
  },

  {
    id: 'text-four-points',
    category: 'text',
    label: 'Four short points',
    description: 'Four small headings side by side. Stacks on a phone.',
    rows: [
      {
        widths: [1, 1, 1, 1],
        columns: [1, 2, 3, 4].map(() => [
          { type: 'heading', props: { html: 'Short title', style: 'h5', level: 'h3' } },
          {
            type: 'text',
            props: {
              html: '<p>A line or two on what this is and why it matters.</p>',
              size: 's',
            },
          },
        ]),
      },
    ],
  },

  {
    id: 'text-three-points',
    category: 'text',
    label: 'Statement and three points',
    description: 'A large opening line, then three supporting columns.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>This is the text area for this paragraph. Once you have added your '
                  + 'content, you can change how it looks on the Theme screen.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
          ],
        ],
      },
      {
        widths: [1, 1, 1],
        columns: [1, 2, 3].map(() => [
          {
            type: 'text',
            props: {
              html: '<p>A short paragraph. Three of these read as a set, so keep them a similar length.</p>',
              size: 's',
            },
          },
        ]),
      },
    ],
  },

  {
    id: 'text-two-columns',
    category: 'text',
    label: 'Two columns of text',
    description: 'For when there is more to say than one column can hold comfortably.',
    rows: [
      {
        widths: [1, 1],
        columns: [
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>This is a paragraph. Writing in paragraphs lets visitors find what '
                  + 'they are looking for quickly and easily.</p>',
              },
            },
          ],
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>A second column, the same size as the first. Long copy is easier to '
                  + 'read in two narrow columns than in one wide one.</p>',
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'text-title-points',
    category: 'text',
    label: 'Title with a list',
    description: 'A short title and a button, with the points beside them.',
    rows: [
      {
        widths: [1, 2],
        columns: [
          [
            { type: 'heading', props: { html: 'This is a short title', style: 'h3' } },
            { type: 'button', props: { label: 'Start an enquiry' } },
          ],
          [
            {
              type: 'list',
              props: {
                style: 'tick',
                items: [
                  { text: 'The first thing somebody gets' },
                  { text: 'The second thing, kept about as short' },
                  { text: 'And a third, because three reads as complete' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'text-heading-actions',
    category: 'text',
    label: 'Heading with buttons',
    description: 'A title, a line of copy and somewhere to go next.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Add your medium length title here', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One sentence on what happens if they carry on.</p>',
                ...CENTRED,
              },
            },
            { type: 'button-group', props: { align: 'centre' } },
          ],
        ],
      },
    ],
  },

  // --- from Andy's second reference, 30 Jul 2026 ---------------------------

  {
    id: 'text-lead-and-pair',
    category: 'text',
    label: 'Lead and two points',
    description: 'A paragraph that sets it up, with two shorter points beside it.',
    rows: [
      {
        widths: [2, 1, 1],
        columns: [
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>This is a paragraph. Writing in paragraphs lets visitors find what '
                  + 'they are looking for quickly and easily.</p>',
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'First point', style: 'h5', level: 'h3' } },
            { type: 'text', props: { html: '<p>A couple of lines on this one.</p>', size: 's' } },
          ],
          [
            { type: 'heading', props: { html: 'Second point', style: 'h5', level: 'h3' } },
            { type: 'text', props: { html: '<p>And a couple on this one.</p>', size: 's' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'text-label-and-copy',
    category: 'text',
    label: 'Label and copy',
    description: 'A small label in the margin, the writing beside it. Good for a long page.',
    rows: [
      {
        widths: [1, 2],
        columns: [
          [{ type: 'heading', props: { html: 'About us', style: 'h6', level: 'h3' } }],
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>This is a paragraph. Writing in paragraphs lets visitors find what '
                  + 'they are looking for quickly and easily.</p>'
                  + '<p>A second paragraph, because one long block of text is harder to '
                  + 'read than two short ones.</p>',
              },
            },
            { type: 'button-group' },
          ],
        ],
      },
    ],
  },

  {
    id: 'text-title-and-bullets',
    category: 'text',
    label: 'Title and two lists',
    description: 'A title and an introduction, with the points split into two columns.',
    rows: [
      {
        widths: [1, 2],
        columns: [
          [{ type: 'heading', props: { html: 'What you get', style: 'h6', level: 'h3' } }],
          [
            { type: 'heading', props: { html: 'Add your medium length title here', style: 'h2' } },
            {
              type: 'text',
              props: {
                html: '<p>One or two sentences before the list, so the points have something to hang on.</p>',
              },
            },
          ],
        ],
      },
      {
        widths: [1, 1],
        columns: [
          [
            {
              type: 'list',
              props: {
                items: [{ text: 'Bullet point' }, { text: 'Bullet point' }, { text: 'Bullet point' }],
              },
            },
          ],
          [
            {
              type: 'list',
              props: {
                items: [{ text: 'Bullet point' }, { text: 'Bullet point' }, { text: 'Bullet point' }],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'text-six-points',
    category: 'text',
    label: 'Six points',
    description: 'A title over two rows of three. For a list of features or destinations.',
    rows: [
      {
        widths: [1],
        columns: [[{ type: 'heading', props: { html: 'Add your medium length title here', style: 'h2' } }]],
      },
      ...[0, 1].map(() => ({
        widths: [1, 1, 1],
        columns: [1, 2, 3].map(() => [
          { type: 'heading', props: { html: 'This is a short title', style: 'h5', level: 'h3' } },
          {
            type: 'text',
            props: {
              html: '<p>Two or three lines. Keep the six about the same length or the grid looks uneven.</p>',
              size: 's',
            },
          },
        ]),
      })),
    ],
  },

  {
    id: 'text-large-title',
    category: 'text',
    label: 'Large title, two columns',
    description: 'A title that takes up the width, with the detail underneath in two columns.',
    rows: [
      {
        widths: [2, 1],
        columns: [
          [{ type: 'heading', props: { html: 'Add your large length title here and here too', style: 'h1' } }],
          [{ type: 'heading', props: { html: 'Where to next', style: 'h6', level: 'h3' } }],
        ],
      },
      {
        widths: [1, 1],
        columns: [
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>This is the text area for this paragraph. Once you have added your '
                  + 'content, you can change how it looks on the Theme screen.</p>',
              },
            },
          ],
          [
            {
              type: 'text',
              props: {
                html:
                  '<p>The second column. Two narrow columns of text are easier to read '
                  + 'than one that runs the full width of a screen.</p>',
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'text-centred-links',
    category: 'text',
    label: 'Centred title with links',
    description: 'A title and a short row of places to go next.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Add your medium length title here', style: 'h2', ...CENTRED } },
            { type: 'button-group', props: { align: 'centre' } },
            {
              type: 'text',
              props: {
                html: '<p>A line underneath, for anything the buttons do not say.</p>',
                size: 's',
                ...CENTRED,
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'text-definitions',
    category: 'text',
    label: 'Title and definitions',
    description: 'A heading beside a set of short question and answer pairs.',
    rows: [
      {
        widths: [1, 2],
        columns: [
          [{ type: 'heading', props: { html: 'Add title here', style: 'h2' } }],
          [
            { type: 'heading', props: { html: 'This is a short title', style: 'h5', level: 'h3' } },
            {
              type: 'text',
              props: {
                html: '<p>The answer, in a sentence or two. Short answers get read.</p>',
                size: 's',
              },
            },
            { type: 'divider' },
            { type: 'heading', props: { html: 'This is a short title', style: 'h5', level: 'h3' } },
            {
              type: 'text',
              props: {
                html: '<p>Another one. Three or four of these is usually enough.</p>',
                size: 's',
              },
            },
          ],
        ],
      },
    ],
  },
];

export function presetById(id: string): SectionPreset | undefined {
  return SECTION_PRESETS.find((preset) => preset.id === id);
}

export function presetsIn(category: PresetCategory): SectionPreset[] {
  return SECTION_PRESETS.filter((preset) => preset.category === category);
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
      return box ? { ...column, box: { ...column.box, ...box } } : column;
    }),
    gap: row.gap ?? DEFAULT_GAP,
    stackBelow: 'mobile',
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
 * whole reason this file is data. Each block becomes one or more bars: a heading
 * is a solid bar whose height follows its style, text is a stack of thin lines,
 * a button is a short rounded bar. The result reads as a miniature of the real
 * thing without rendering the real thing.
 *
 * Returned as plain numbers so this is testable with no DOM, same as layoutCells.
 */
export interface ThumbBar {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Solid for a heading or a button, light for body text. */
  tone: 'strong' | 'soft';
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

        for (const bar of barsForBlock(spec, columnWidth)) {
          rowBars.push({
            ...bar,
            // Centring is drawn, not just stored, or a centred preset and a
            // left-aligned one would show the same picture.
            x: x + (centred ? (columnWidth - bar.width) / 2 : 0),
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

    const offset = Math.max(0, (rowHeight - tallest) / 2);
    for (const bar of rowBars) bars.push({ ...bar, y: top + offset + bar.y });
  });

  return bars;
}

/** The bars one block becomes, positioned later by the caller. */
function barsForBlock(
  spec: PresetBlock,
  columnWidth: number,
): Array<Omit<ThumbBar, 'x' | 'y'>> {
  switch (spec.type) {
    case 'heading': {
      const style = typeof spec.props?.style === 'string' ? spec.props.style : 'h3';
      return [{
        width: columnWidth * 0.85,
        height: HEADING_HEIGHT[style] ?? 0.09,
        tone: 'strong',
      }];
    }

    case 'text': {
      // Large text gets fewer, thicker lines, which is what large text looks
      // like from a distance.
      const large = spec.props?.size === 'l';
      const count = large ? 2 : 3;
      return Array.from({ length: count }, (_, index) => ({
        // The last line short, because the last line of a paragraph is.
        width: columnWidth * (index === count - 1 ? 0.55 : 0.95),
        height: large ? LINE * 1.6 : LINE,
        tone: 'soft' as const,
      }));
    }

    case 'list': {
      const items = Array.isArray(spec.props?.items) ? spec.props.items.length : 3;
      return Array.from({ length: items }, () => ({
        width: columnWidth * 0.8,
        height: LINE,
        tone: 'soft' as const,
      }));
    }

    case 'button':
      return [{ width: columnWidth * 0.45, height: 0.07, tone: 'strong', pill: true }];

    case 'button-group':
      return [{ width: columnWidth * 0.7, height: 0.07, tone: 'strong', pill: true }];

    default:
      return [{ width: columnWidth * 0.9, height: LINE, tone: 'soft' }];
  }
}
