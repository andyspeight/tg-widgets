/**
 * The designed sections a client can drop into a PAGE.
 *
 * WHAT THESE ARE AND WHAT LAYOUTS ARE
 *
 * A layout (lib/content/layouts.ts) is a SHAPE: a section with empty columns
 * waiting for blocks. A preset here is a shape WITH CONTENT already in it, so
 * somebody adding "Title and paragraph" gets a heading and a paragraph sized and
 * aligned to look right together, and edits the words rather than assembling it.
 * Andy asked for both on 30 Jul 2026, as two tabs of the same dialog.
 *
 * ONLY THE OVERRIDES ARE WRITTEN DOWN. Every block starts from the defaults in
 * lib/content/blocks.ts, so a preset says "a heading, but centred and H1-sized"
 * rather than restating every property. A new field on a block type reaches every
 * preset without any of them being edited.
 *
 * THE COPY IS PLACEHOLDER AND IS MEANT TO BE REPLACED. It follows the brand
 * voice, because a client who leaves a line in should not be left with something
 * that reads like it came from a machine. It also leans travel, because that is
 * who uses this: a client replacing "Seven nights in the Cyclades" has a clearer
 * idea of what goes there than one replacing "Lorem ipsum".
 *
 * PICTURES ARE LEFT EMPTY, ON PURPOSE. An image block with no src draws its
 * "Choose an image" placeholder, which is a prompt. A stock photograph baked
 * into a preset is a picture somebody has to notice and remove, and the ones
 * that get missed end up on a live client site.
 */

import type { SectionPreset } from './preset-types';
import { CARD, CARD_ROOMY, CENTRED, PANEL } from './preset-types';

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
export const PAGE_PRESETS: readonly SectionPreset[] = [
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
            { type: 'icon-item', props: { icon: 'plane-takeoff', title: 'Short title', body: 'One sentence on what this is and why it matters.' } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost' } },
          ],
          [
            { type: 'icon-item', props: { icon: 'flag', title: 'Short title', body: 'One sentence on what this is and why it matters.' } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost' } },
          ],
          [
            { type: 'icon-item', props: { icon: 'star', title: 'Short title', body: 'One sentence on what this is and why it matters.' } },
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
            { type: 'icon-item', props: { icon: 'plane-takeoff', title: 'Short title', body: 'One line on this point.', ...CENTRED } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost', align: 'centre' } },
          ],
          [
            { type: 'icon-item', props: { icon: 'flag', title: 'Short title', body: 'One line on this point.', ...CENTRED } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost', align: 'centre' } },
          ],
          [
            { type: 'icon-item', props: { icon: 'star', title: 'Short title', body: 'One line on this point.', ...CENTRED } },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost', align: 'centre' } },
          ],
          [
            { type: 'icon-item', props: { icon: 'heart', title: 'Short title', body: 'One line on this point.', ...CENTRED } },
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

  /*
   * -------------------------------------------------------------------------
   * Features
   * -------------------------------------------------------------------------
   *
   * What you get, why it is worth it, how it works. The most-used category on
   * any site that sells something, which is why it sits third.
   *
   * Mostly built from the Cards block rather than from columns of icon-items,
   * and the difference matters: a card grid is ONE block a client edits as a
   * list, so adding a fourth feature is an Add button rather than dragging a
   * column in and rebuilding it. Columns are used only where the two sides are
   * genuinely different, like words beside a picture.
   */
  {
    id: 'features-three-icons',
    category: 'features',
    label: 'Three points with icons',
    description: 'A title, then three short points across the page. The everyday one.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Why book with us', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line under the title saying what the three points add up to.</p>',
                ...CENTRED,
              },
            },
          ],
        ],
      },
      {
        widths: [1, 1, 1],
        gap: 32,
        columns: [
          [{ type: 'icon-item', props: { icon: 'plane-takeoff', title: 'Everything arranged', body: 'Flights, transfers and the hotel, booked as one thing so nothing falls between them.', ...CENTRED } }],
          [{ type: 'icon-item', props: { icon: 'phone', title: 'A person to call', body: 'The same person who booked it, on a number that reaches them.', ...CENTRED } }],
          [{ type: 'icon-item', props: { icon: 'circle-check', title: 'Protected money', body: 'ATOL and ABTA, so what you pay is covered before you go and while you are away.', ...CENTRED } }],
        ],
      },
    ],
  },

  {
    id: 'features-four-cards',
    category: 'features',
    label: 'Four bordered features',
    description: 'Four cards in a row. Stacks in pairs on a tablet, singly on a phone.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Tagline here', style: 'h6', level: 'h3', ...CENTRED } },
            { type: 'heading', props: { html: 'What you get', style: 'h2', ...CENTRED } },
          ],
        ],
      },
      {
        widths: [1, 1, 1, 1],
        gap: 24,
        columnBox: [CARD, CARD, CARD, CARD],
        columns: [
          [{ type: 'icon-item', props: { icon: 'flag', title: 'Short title', body: 'One sentence on this one.' } }],
          [{ type: 'icon-item', props: { icon: 'star', title: 'Short title', body: 'One sentence on this one.' } }],
          [{ type: 'icon-item', props: { icon: 'heart', title: 'Short title', body: 'One sentence on this one.' } }],
          [{ type: 'icon-item', props: { icon: 'smile', title: 'Short title', body: 'One sentence on this one.' } }],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'features-picture-beside-points',
    category: 'features',
    label: 'Picture beside the points',
    description: 'A photograph on one side, a title and a ticked list on the other.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: '4/3', radius: 'lg' } }],
          [
            { type: 'heading', props: { html: 'Tagline here', style: 'h6', level: 'h3' } },
            { type: 'heading', props: { html: 'Everything in one place', style: 'h2' } },
            {
              type: 'text',
              props: {
                html: '<p>A short paragraph saying what this is, then the list underneath doing the detail.</p>',
              },
            },
            {
              type: 'list',
              props: {
                style: 'tick',
                items: [
                  { text: 'The first thing it covers' },
                  { text: 'The second thing it covers' },
                  { text: 'The third thing it covers' },
                  { text: 'And the one people always ask about' },
                ],
              },
            },
            { type: 'button', props: { label: 'See how it works' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'features-cards-with-pictures',
    category: 'features',
    label: 'Three cards with pictures',
    description: 'A card grid with a photograph on each. Edited as one list.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Where our customers go', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line saying what these have in common.</p>',
                ...CENTRED,
              },
            },
          ],
        ],
      },
      {
        widths: [1],
        columns: [
          [
            {
              type: 'cards',
              props: {
                columns: '3',
                style: 'bordered',
                items: [
                  { src: '', alt: '', label: 'Greece', title: 'Island hopping, planned properly', body: 'Seven nights across three islands, with the ferries booked for you.', linkLabel: 'See the trip', linkHref: '' },
                  { src: '', alt: '', label: 'Italy', title: 'The Amalfi coast, slowly', body: 'A week between Positano and Ravello, with a driver for the coast road.', linkLabel: 'See the trip', linkHref: '' },
                  { src: '', alt: '', label: 'Portugal', title: 'Lisbon and the Algarve', body: 'Three nights in the city, then four with your feet up by the sea.', linkLabel: 'See the trip', linkHref: '' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'features-two-rows-alternating',
    category: 'features',
    label: 'Two features, alternating',
    description: 'Words then picture, then picture then words. For explaining two things properly.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'The first thing', style: 'h3' } },
            {
              type: 'text',
              props: {
                html: '<p>Two or three sentences on what it is and why somebody would want it. Keep the two halves about the same length or the page looks lopsided.</p>',
              },
            },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost' } },
          ],
          [{ type: 'image', props: { ratio: '4/3', radius: 'lg' } }],
        ],
      },
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: '4/3', radius: 'lg' } }],
          [
            { type: 'heading', props: { html: 'The second thing', style: 'h3' } },
            {
              type: 'text',
              props: {
                html: '<p>Two or three sentences on this one. Swapping which side the picture is on stops a page of these reading as a list.</p>',
              },
            },
            { type: 'button', props: { label: 'Learn more', variant: 'ghost' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'features-six-points',
    category: 'features',
    label: 'Six points, three across',
    description: 'Two rows of three. For a longer list that still has to be skimmable.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'heading', props: { html: 'What is included', style: 'h2', ...CENTRED } }],
        ],
      },
      {
        widths: [1, 1, 1],
        gap: 32,
        columns: [
          [{ type: 'icon-item', props: { icon: 'plane-takeoff', title: 'Short title', body: 'One line on this point.' } }],
          [{ type: 'icon-item', props: { icon: 'flag', title: 'Short title', body: 'One line on this point.' } }],
          [{ type: 'icon-item', props: { icon: 'star', title: 'Short title', body: 'One line on this point.' } }],
        ],
      },
      {
        widths: [1, 1, 1],
        gap: 32,
        columns: [
          [{ type: 'icon-item', props: { icon: 'heart', title: 'Short title', body: 'One line on this point.' } }],
          [{ type: 'icon-item', props: { icon: 'smile', title: 'Short title', body: 'One line on this point.' } }],
          [{ type: 'icon-item', props: { icon: 'circle-check', title: 'Short title', body: 'One line on this point.' } }],
        ],
      },
    ],
  },

  {
    id: 'features-how-it-works',
    category: 'features',
    label: 'How it works',
    description: 'Numbered steps down the page, joined up. For explaining a process.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Tagline here', style: 'h6', level: 'h3', ...CENTRED } },
            { type: 'heading', props: { html: 'How it works', style: 'h2', ...CENTRED } },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'steps', props: { layout: 'down', marker: 'number', connector: true } }]],
      },
    ],
    section: { width: 'narrow' },
  },

  {
    id: 'features-three-steps-across',
    category: 'features',
    label: 'Three steps across',
    description: 'The same sequence side by side. For three short ones on a wide page.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'heading', props: { html: 'Three steps and you are booked', style: 'h2', ...CENTRED } }],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'steps', props: { layout: 'across', marker: 'number', connector: true } }]],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'features-by-the-numbers',
    category: 'features',
    label: 'By the numbers',
    description: 'Four figures across, with lines between them. The quickest way to say how long you have been at it.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'A few numbers', style: 'h2', ...CENTRED } },
            {
              type: 'stats',
              props: {
                columns: '4',
                size: 'l',
                align: 'centre',
                divided: true,
                items: [
                  { value: '20', suffix: '+', label: 'Years on the high street', detail: '' },
                  { value: '12,000', label: 'Holidays booked', detail: '' },
                  { value: '4.9', suffix: '/5', label: 'Average review score', detail: '' },
                  { value: '60', suffix: '+', label: 'Countries', detail: '' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'features-numbers-beside-words',
    category: 'features',
    label: 'Numbers beside the story',
    description: 'A paragraph on one side and the figures that back it up on the other.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'Twenty years of getting people away', style: 'h2' } },
            {
              type: 'text',
              props: {
                html: '<p>Two or three sentences on how the shop started and what has kept it going. The numbers next door do the boasting so this part does not have to.</p>',
              },
            },
          ],
          [
            {
              type: 'stats',
              props: {
                columns: '2',
                size: 'm',
                align: 'left',
                divided: false,
                items: [
                  { value: '20', suffix: '+', label: 'Years', detail: '' },
                  { value: '12,000', label: 'Holidays booked', detail: '' },
                  { value: '4.9', suffix: '/5', label: 'Review score', detail: '' },
                  { value: '100', suffix: '%', label: 'ATOL protected', detail: '' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  /*
   * THE BADGES, and the reason they are in Features rather than a category of
   * their own: a client looking for somewhere to put ABTA and ATOL is looking
   * for a reason to trust, which is what this whole category is.
   *
   * The logos arrive EMPTY, like every other picture in this library. A badge
   * is the one thing that must never be a placeholder: a site showing an ABTA
   * logo it is not entitled to is a trading standards problem, not a design
   * one.
   */
  {
    id: 'features-badges',
    category: 'features',
    label: 'Badges and memberships',
    description: 'A quiet row of trade body logos: ABTA, ATOL, IATA. Add your own.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'text',
              props: {
                html: '<p>Your money is protected. Here is who by.</p>',
                ...CENTRED,
              },
            },
            { type: 'logos', props: { height: 'm', gap: 'xl', tone: 'grey', align: 'centre', items: [] } },
          ],
        ],
      },
    ],
    // Tighter than a normal band: a row of badges is a strip, not a section
    // with something in it. The default 48 makes it look like an empty gallery.
    section: { tone: 'subtle', paddingY: 32 },
  },

  {
    id: 'features-partners',
    category: 'features',
    label: 'Who we work with',
    description: 'A heading over a row of operator or airline logos, in colour.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'The people we book with', style: 'h3', ...CENTRED } },
            { type: 'logos', props: { height: 'l', gap: 'l', tone: 'grey-hover', align: 'centre', items: [] } },
          ],
        ],
      },
    ],
  },

  /*
   * -------------------------------------------------------------------------
   * Call to action
   * -------------------------------------------------------------------------
   *
   * The band that asks for the thing: ring us, send an enquiry, get the
   * brochure. Short by design. A call to action with three paragraphs in it is
   * not a call to action, it is a section with a button at the bottom, and
   * those live in Features.
   *
   * Most of these are `accent` or `dark` toned, because the whole job is to
   * look different from the page around them.
   */
  {
    id: 'cta-centred',
    category: 'cta',
    label: 'Centred, with two buttons',
    description: 'A title, a line, and the two things somebody might do next.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Ready when you are', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line on what happens when they get in touch. No obligation, no hard sell, that sort of thing, but in your own words.</p>',
                ...CENTRED,
              },
            },
            {
              type: 'button-group',
              props: {
                align: 'centre',
                buttons: [
                  { label: 'Send an enquiry', href: '', variant: 'primary' },
                  { label: 'Call us', href: '', variant: 'secondary' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'accent' },
  },

  {
    id: 'cta-split',
    category: 'cta',
    label: 'Words left, button right',
    description: 'A tidy band across the page. Good at the bottom of a long one.',
    rows: [
      {
        widths: [2, 1],
        gap: 32,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'Talk to somebody who has been', style: 'h3' } },
            {
              type: 'text',
              props: { html: '<p>One sentence. This one is meant to be read at a glance.</p>' },
            },
          ],
          [{ type: 'button', props: { label: 'Send an enquiry', align: 'right' } }],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'cta-dark-panel',
    category: 'cta',
    label: 'Dark panel',
    description: 'A dark band with one button. The loudest of these without being shouty.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Tagline here', style: 'h6', level: 'h3', ...CENTRED } },
            { type: 'heading', props: { html: 'Somewhere in mind already?', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>Tell us roughly what you are after and we will come back with something worth reading.</p>',
                ...CENTRED,
                size: 'l',
              },
            },
            { type: 'button', props: { label: 'Start here', align: 'centre', size: 'l' } },
          ],
        ],
      },
    ],
    section: { tone: 'dark', paddingY: 80 },
  },

  {
    id: 'cta-with-picture',
    category: 'cta',
    label: 'Picture beside the ask',
    description: 'A photograph on one side and the invitation on the other.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: '4/3', radius: 'lg' } }],
          [
            { type: 'heading', props: { html: 'Let us plan it for you', style: 'h2' } },
            {
              type: 'text',
              props: {
                html: '<p>Two sentences on why it is worth having somebody do this rather than doing it yourself.</p>',
              },
            },
            {
              type: 'button-group',
              props: {
                buttons: [
                  { label: 'Send an enquiry', href: '', variant: 'primary' },
                  { label: 'See our trips', href: '', variant: 'ghost' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'cta-newsletter',
    category: 'cta',
    label: 'Sign up for offers',
    description: 'A short invitation with room for the newsletter widget underneath.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'The good ones, before everybody else', style: 'h3', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One email a month, the offers worth knowing about, and nothing else. Add the Newsletter widget below this line.</p>',
                ...CENTRED,
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'subtle', width: 'narrow' },
  },

  {
    id: 'cta-statement',
    category: 'cta',
    label: 'One line and a button',
    description: 'The shortest of them. A statement, a rule, and one thing to press.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Somewhere worth going, sorted properly.', style: 'h2', ...CENTRED } },
            { type: 'divider' },
            { type: 'button', props: { label: 'Talk to us', align: 'centre' } },
          ],
        ],
      },
    ],
    section: { width: 'narrow' },
  },

  /*
   * -------------------------------------------------------------------------
   * Gallery
   * -------------------------------------------------------------------------
   *
   * Photographs, which is most of what sells a holiday. The Gallery block does
   * the grid, so these are mostly about what sits around it.
   */
  {
    id: 'gallery-grid',
    category: 'gallery',
    label: 'Titled grid',
    description: 'A title over a grid of pictures, three across.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'From our travellers', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: { html: '<p>One line saying whose pictures these are.</p>', ...CENTRED },
            },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'gallery', props: { columns: '3', gap: 'm' } }]],
      },
    ],
  },

  {
    id: 'gallery-wide',
    category: 'gallery',
    label: 'Full width grid',
    description: 'A grid edge to edge, four across, with no title. For a big visual break.',
    rows: [
      {
        widths: [1],
        columns: [[{ type: 'gallery', props: { columns: '4', gap: 's', radius: 'none' } }]],
      },
    ],
    section: { width: 'full', paddingY: 0 },
  },

  {
    id: 'gallery-words-beside',
    category: 'gallery',
    label: 'Words beside the pictures',
    description: 'A title and a paragraph on the left, a two-column grid on the right.',
    rows: [
      {
        widths: [1, 2],
        gap: 48,
        columns: [
          [
            { type: 'heading', props: { html: 'The place itself', style: 'h2' } },
            {
              type: 'text',
              props: {
                html: '<p>A short paragraph on what these pictures are showing, so the grid is not left to explain itself.</p>',
              },
            },
            { type: 'button', props: { label: 'See more', variant: 'ghost' } },
          ],
          [{ type: 'gallery', props: { columns: '2', gap: 'm' } }],
        ],
      },
    ],
  },

  {
    id: 'gallery-single-wide',
    category: 'gallery',
    label: 'One wide photograph',
    description: 'A single picture across the page with a caption under it.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'image', props: { ratio: '16/9', radius: 'lg', caption: 'Where this was taken, and when.' } }],
        ],
      },
    ],
  },

  {
    id: 'gallery-scroll',
    category: 'gallery',
    label: 'A rail you scroll',
    description: 'Pictures on a sideways rail. Takes as many as you like without growing the page.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Recently booked', style: 'h2' } },
            {
              type: 'text',
              props: { html: '<p>One line, then the rail. Drag it sideways or use the arrow keys.</p>' },
            },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'slider', props: { slideWidth: 'medium', style: 'plain' } }]],
      },
    ],
  },

  {
    id: 'gallery-two-up',
    category: 'gallery',
    label: 'Two tall pictures',
    description: 'A pair side by side, portrait shaped. For a before and after, or a pair of places.',
    rows: [
      {
        widths: [1, 1],
        gap: 24,
        columns: [
          [{ type: 'image', props: { ratio: '3/4', radius: 'lg', caption: 'The first one.' } }],
          [{ type: 'image', props: { ratio: '3/4', radius: 'lg', caption: 'The second one.' } }],
        ],
      },
    ],
  },

  /*
   * -------------------------------------------------------------------------
   * Testimonials
   * -------------------------------------------------------------------------
   *
   * NOT THE REVIEWS OR TESTIMONIALS WIDGET, and that is a real choice. Those
   * two are configured in the widgets dashboard and pull from a feed, which is
   * right when a client has one and useless the day they are building their
   * first page and have three quotes in an email. These use the Quote block, so
   * they work with nothing set up, and a client who later gets the widget can
   * swap the block for it.
   */
  {
    id: 'testimonials-three',
    category: 'testimonials',
    label: 'Three quotes',
    description: 'A title, then three short quotes across the page.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'heading', props: { html: 'What people say', style: 'h2', ...CENTRED } }],
        ],
      },
      {
        widths: [1, 1, 1],
        gap: 24,
        columnBox: [CARD, CARD, CARD],
        columns: [
          [{ type: 'quote', props: { text: 'They booked the whole thing in an afternoon and it went off without a hitch.', attribution: 'A customer', role: 'Ten nights in Crete' } }],
          [{ type: 'quote', props: { text: 'Somebody actually answered the phone, which is more than I can say for the last lot.', attribution: 'A customer', role: 'A week in Madeira' } }],
          [{ type: 'quote', props: { text: 'The hotel was exactly as described, which sounds like a low bar until you have been caught out.', attribution: 'A customer', role: 'Two weeks in Portugal' } }],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'testimonials-one-big',
    category: 'testimonials',
    label: 'One big quote',
    description: 'A single quote, large and centred. For the best one you have.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'quote',
              props: {
                text: 'We have used them four times now and I would not go anywhere else. They know us, they know what we like, and they never try to sell us something we did not ask for.',
                attribution: 'A customer',
                role: 'Booked with us since 2019',
              },
            },
          ],
        ],
      },
    ],
    section: { width: 'narrow', paddingY: 80 },
  },

  {
    id: 'testimonials-quote-beside-picture',
    category: 'testimonials',
    label: 'Quote beside a picture',
    description: 'One quote with a photograph next to it. For a story worth a face.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: '1/1', radius: 'lg' } }],
          [
            { type: 'heading', props: { html: 'Tagline here', style: 'h6', level: 'h3' } },
            {
              type: 'quote',
              props: {
                text: 'They talked us out of the resort we had picked and put us somewhere better for less. That is worth something.',
                attribution: 'A customer',
                role: 'A fortnight in the Algarve',
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'testimonials-with-stats',
    category: 'testimonials',
    label: 'Quotes over numbers',
    description: 'Two quotes with a row of numbers under them. Trust, twice over.',
    rows: [
      {
        widths: [1, 1],
        gap: 32,
        columnBox: [CARD, CARD],
        columns: [
          [{ type: 'quote', props: { text: 'Straightforward, quick and no surprises on the invoice.', attribution: 'A customer' } }],
          [{ type: 'quote', props: { text: 'They sorted a flight change on a Sunday. I did not expect that.', attribution: 'A customer' } }],
        ],
      },
      /*
       * MOVED OFF Icon and text, 1 Aug 2026. This row was three icon-items with
       * a star and a heart standing in for the numbers, because until the Key
       * numbers block there was no way to set a figure at figure size. It was
       * the clearest evidence that the block was missing, so it is the first
       * thing to use it.
       */
      {
        widths: [1],
        columns: [
          [{
            type: 'stats',
            props: {
              columns: '3',
              size: 'l',
              align: 'centre',
              divided: true,
              items: [
                { value: '4.9', suffix: '/5', label: 'Average review score', detail: 'Across 300 reviews.' },
                { value: '20', suffix: '+', label: 'Years on the high street', detail: '' },
                { value: '100', suffix: '%', label: 'ATOL protected', detail: 'Every package we sell.' },
              ],
            },
          }],
        ],
      },
    ],
  },

  {
    id: 'testimonials-rail',
    category: 'testimonials',
    label: 'Quotes on a rail',
    description: 'As many as you like, on a rail you scroll sideways.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'heading', props: { html: 'In their own words', style: 'h2' } }],
        ],
      },
      {
        widths: [1],
        columns: [
          [
            {
              type: 'slider',
              props: {
                slideWidth: 'medium',
                style: 'bordered',
                items: [
                  { src: '', alt: '', label: '', title: 'A customer', body: 'They booked the whole thing in an afternoon and it went off without a hitch.', linkLabel: '', linkHref: '' },
                  { src: '', alt: '', label: '', title: 'A customer', body: 'Somebody actually answered the phone, which is more than I can say for the last lot.', linkLabel: '', linkHref: '' },
                  { src: '', alt: '', label: '', title: 'A customer', body: 'The hotel was exactly as described, which sounds like a low bar until you have been caught out.', linkLabel: '', linkHref: '' },
                  { src: '', alt: '', label: '', title: 'A customer', body: 'They sorted a flight change on a Sunday. I did not expect that.', linkLabel: '', linkHref: '' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  /*
   * -------------------------------------------------------------------------
   * Pricing
   * -------------------------------------------------------------------------
   *
   * Three panels with a list of what is in each is the shape everybody knows,
   * so it is here twice: once plain and once with one panel picked out. The
   * comparison table is the honest answer when the difference between two
   * things is a dozen small ones rather than three big ones.
   */
  {
    id: 'pricing-three-panels',
    category: 'pricing',
    label: 'Three panels',
    description: 'Three bordered panels with a price and what is included.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'What it costs', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line under the title. Say what the prices include, or what they are per.</p>',
                ...CENTRED,
              },
            },
          ],
        ],
      },
      {
        widths: [1, 1, 1],
        gap: 24,
        columnBox: [CARD_ROOMY, CARD_ROOMY, CARD_ROOMY],
        columns: [
          [
            { type: 'heading', props: { html: 'Bed and breakfast', style: 'h5', level: 'h3' } },
            { type: 'heading', props: { html: 'From £549', style: 'h3' } },
            { type: 'text', props: { html: '<p>Per person, seven nights, flights included.</p>', size: 's' } },
            { type: 'list', props: { style: 'tick', items: [{ text: 'Return flights' }, { text: 'Transfers both ways' }, { text: 'Breakfast every day' }] } },
            { type: 'button', props: { label: 'Enquire', variant: 'secondary' } },
          ],
          [
            { type: 'heading', props: { html: 'Half board', style: 'h5', level: 'h3' } },
            { type: 'heading', props: { html: 'From £699', style: 'h3' } },
            { type: 'text', props: { html: '<p>Per person, seven nights, flights included.</p>', size: 's' } },
            { type: 'list', props: { style: 'tick', items: [{ text: 'Everything in bed and breakfast' }, { text: 'Dinner every evening' }, { text: 'A drink with dinner' }] } },
            { type: 'button', props: { label: 'Enquire' } },
          ],
          [
            { type: 'heading', props: { html: 'All inclusive', style: 'h5', level: 'h3' } },
            { type: 'heading', props: { html: 'From £899', style: 'h3' } },
            { type: 'text', props: { html: '<p>Per person, seven nights, flights included.</p>', size: 's' } },
            { type: 'list', props: { style: 'tick', items: [{ text: 'Everything in half board' }, { text: 'Lunch and snacks' }, { text: 'Drinks all day' }] } },
            { type: 'button', props: { label: 'Enquire', variant: 'secondary' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'pricing-one-picked-out',
    category: 'pricing',
    label: 'Three panels, one picked out',
    description: 'The same three with the middle one tinted, so there is an obvious answer.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'heading', props: { html: 'Pick the one that suits', style: 'h2', ...CENTRED } }],
        ],
      },
      {
        widths: [1, 1.15, 1],
        gap: 24,
        align: 'centre',
        /*
         * The middle one lifted with a SHADOW rather than a background colour.
         * A box background has to be a real colour, and a real colour baked
         * into a preset is a colour that stops matching the day a client
         * changes their theme. A shadow says "this is the one" in any palette.
         */
        columnBox: [CARD, { ...CARD_ROOMY, shadow: 'medium' }, CARD],
        columns: [
          [
            { type: 'heading', props: { html: 'Standard', style: 'h5', level: 'h3', ...CENTRED } },
            { type: 'heading', props: { html: '£549', style: 'h3', ...CENTRED } },
            { type: 'list', props: { style: 'tick', items: [{ text: 'The first thing' }, { text: 'The second thing' }] } },
            { type: 'button', props: { label: 'Enquire', variant: 'ghost', align: 'centre' } },
          ],
          [
            { type: 'heading', props: { html: 'Most booked', style: 'h6', level: 'h3', ...CENTRED } },
            { type: 'heading', props: { html: 'Popular', style: 'h5', level: 'h3', ...CENTRED } },
            { type: 'heading', props: { html: '£699', style: 'h2', ...CENTRED } },
            { type: 'list', props: { style: 'tick', items: [{ text: 'The first thing' }, { text: 'The second thing' }, { text: 'And the one that makes it worth it' }] } },
            { type: 'button', props: { label: 'Enquire', align: 'centre' } },
          ],
          [
            { type: 'heading', props: { html: 'Everything', style: 'h5', level: 'h3', ...CENTRED } },
            { type: 'heading', props: { html: '£899', style: 'h3', ...CENTRED } },
            { type: 'list', props: { style: 'tick', items: [{ text: 'The first thing' }, { text: 'The second thing' }, { text: 'The third thing' }] } },
            { type: 'button', props: { label: 'Enquire', variant: 'ghost', align: 'centre' } },
          ],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'pricing-comparison-table',
    category: 'pricing',
    label: 'Comparison table',
    description: 'A table across the options. For when the difference is a dozen small things.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Side by side', style: 'h2' } },
            {
              type: 'text',
              props: { html: '<p>One line saying what somebody should be looking for in this table.</p>' },
            },
            {
              type: 'table',
              props: {
                headerRow: true,
                firstColumnHeader: true,
                style: 'lined',
                caption: 'What is included at each level',
                data: [
                  'What you get\tBed and breakfast\tHalf board\tAll inclusive',
                  'Return flights\tYes\tYes\tYes',
                  'Transfers\tYes\tYes\tYes',
                  'Breakfast\tYes\tYes\tYes',
                  'Dinner\tNo\tYes\tYes',
                  'Lunch\tNo\tNo\tYes',
                  'Drinks\tNo\tWith dinner\tAll day',
                  'From, per person\t£549\t£699\t£899',
                ].join('\n'),
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'pricing-two-panels',
    category: 'pricing',
    label: 'Two panels',
    description: 'A pair of options side by side. For a straight either or.',
    rows: [
      {
        widths: [1, 1],
        gap: 24,
        columnBox: [CARD_ROOMY, CARD_ROOMY],
        columns: [
          [
            { type: 'heading', props: { html: 'Package holiday', style: 'h4' } },
            { type: 'heading', props: { html: 'From £549', style: 'h3' } },
            { type: 'text', props: { html: '<p>Who this one suits, in a sentence.</p>' } },
            { type: 'list', props: { style: 'tick', items: [{ text: 'Flights and hotel together' }, { text: 'Transfers included' }, { text: 'ATOL protected' }] } },
            { type: 'button', props: { label: 'Enquire' } },
          ],
          [
            { type: 'heading', props: { html: 'Tailor made', style: 'h4' } },
            { type: 'heading', props: { html: 'Priced for you', style: 'h3' } },
            { type: 'text', props: { html: '<p>Who this one suits, in a sentence.</p>' } },
            { type: 'list', props: { style: 'tick', items: [{ text: 'Built round your dates' }, { text: 'Any combination of places' }, { text: 'Financially protected' }] } },
            { type: 'button', props: { label: 'Talk to us', variant: 'secondary' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'pricing-with-small-print',
    category: 'pricing',
    label: 'Panels with the small print',
    description: 'Three panels with the conditions folded up underneath.',
    rows: [
      {
        widths: [1, 1, 1],
        gap: 24,
        columnBox: [CARD, CARD, CARD],
        columns: [
          [
            { type: 'heading', props: { html: 'Standard', style: 'h5', level: 'h3' } },
            { type: 'heading', props: { html: '£549', style: 'h3' } },
            { type: 'button', props: { label: 'Enquire', variant: 'ghost' } },
          ],
          [
            { type: 'heading', props: { html: 'Popular', style: 'h5', level: 'h3' } },
            { type: 'heading', props: { html: '£699', style: 'h3' } },
            { type: 'button', props: { label: 'Enquire' } },
          ],
          [
            { type: 'heading', props: { html: 'Everything', style: 'h5', level: 'h3' } },
            { type: 'heading', props: { html: '£899', style: 'h3' } },
            { type: 'button', props: { label: 'Enquire', variant: 'ghost' } },
          ],
        ],
      },
      {
        widths: [1],
        columns: [
          [
            {
              type: 'accordion',
              props: {
                style: 'ruled',
                items: [
                  { title: 'What the price includes', body: 'Return flights, transfers both ways and seven nights at the board level shown.' },
                  { title: 'What it does not', body: 'Travel insurance, checked bags beyond the allowance, and anything you buy while you are there.' },
                  { title: 'Deposits and balances', body: 'A deposit holds it. The balance is due twelve weeks before you go.' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  /*
   * -------------------------------------------------------------------------
   * FAQ
   * -------------------------------------------------------------------------
   *
   * The Accordion block does all the real work, so these differ only in what
   * sits round it: a title above, a title beside, a pair of columns, or a
   * closing offer to just ring somebody. That last one earns its place: the
   * point of an FAQ is to stop a phone call, and the point of the section under
   * it is to make the call easy when it did not work.
   */
  {
    id: 'faq-simple',
    category: 'faq',
    label: 'Questions in a column',
    description: 'A centred title with the questions underneath. The plain one.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Common questions', style: 'h2', ...CENTRED } },
            { type: 'accordion', props: { style: 'ruled' } },
          ],
        ],
      },
    ],
    section: { width: 'narrow' },
  },

  {
    id: 'faq-title-beside',
    category: 'faq',
    label: 'Title beside the questions',
    description: 'The heading and a line on the left, the questions on the right.',
    rows: [
      {
        widths: [1, 2],
        gap: 48,
        columns: [
          [
            { type: 'heading', props: { html: 'Questions', style: 'h2' } },
            {
              type: 'text',
              props: {
                html: '<p>If the answer is not here, ring us. We would rather tell you than have you guess.</p>',
              },
            },
            { type: 'button', props: { label: 'Get in touch', variant: 'ghost' } },
          ],
          [{ type: 'accordion', props: { style: 'separated' } }],
        ],
      },
    ],
  },

  {
    id: 'faq-two-columns',
    category: 'faq',
    label: 'Two columns of questions',
    description: 'Questions split across two columns. For a long list.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'heading', props: { html: 'Everything people ask', style: 'h2', ...CENTRED } }],
        ],
      },
      {
        widths: [1, 1],
        gap: 32,
        columns: [
          [
            {
              type: 'accordion',
              props: {
                style: 'ruled',
                items: [
                  { title: 'How do I book?', body: 'Send an enquiry or ring us, and we will take it from there.' },
                  { title: 'When do I pay?', body: 'A deposit holds it. The balance is due twelve weeks before you travel.' },
                  { title: 'Can I change my dates?', body: 'Usually, and what it costs depends on the airline. Ask us before you book if the dates are not fixed.' },
                ],
              },
            },
          ],
          [
            {
              type: 'accordion',
              props: {
                style: 'ruled',
                items: [
                  { title: 'Is my money protected?', body: 'Yes. Every package we sell is ATOL protected.' },
                  { title: 'Do I need insurance?', body: 'Yes, and get it the day you book rather than the week you go.' },
                  { title: 'What about passports and visas?', body: 'We will tell you what you need. Checking it is yours to do, and worth doing early.' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'faq-with-contact',
    category: 'faq',
    label: 'Questions, then ring us',
    description: 'The questions with a tinted panel underneath for the ones they miss.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Common questions', style: 'h2', ...CENTRED } },
            { type: 'accordion', props: { style: 'separated' } },
          ],
        ],
      },
      {
        widths: [1],
        columnBox: [PANEL],
        columns: [
          [
            { type: 'heading', props: { html: 'Still not sure?', style: 'h4', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>Ring us and ask. It is usually quicker than reading.</p>',
                ...CENTRED,
              },
            },
            { type: 'button', props: { label: 'Get in touch', align: 'centre' } },
          ],
        ],
      },
    ],
    section: { width: 'narrow' },
  },

  {
    id: 'faq-tabs',
    category: 'faq',
    label: 'Questions in tabs',
    description: 'Grouped into tabs. For when the questions fall into obvious kinds.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Before you go', style: 'h2' } },
            {
              type: 'tabs',
              props: {
                style: 'underline',
                items: [
                  { title: 'Booking', body: 'How to book, when to pay, and what happens after you do.' },
                  { title: 'Travelling', body: 'Bags, seats, transfers, and what to do if a flight moves.' },
                  { title: 'While you are there', body: 'Who to ring, what is included, and what is not.' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  /*
   * -------------------------------------------------------------------------
   * Team
   * -------------------------------------------------------------------------
   *
   * A high-street agency's biggest advantage over a booking site is that there
   * is somebody to talk to, so this category is about faces and names rather
   * than job titles. Built from Cards where the people are a list, and from
   * columns where one person is being introduced properly.
   */
  {
    id: 'team-grid',
    category: 'team',
    label: 'The team, in a grid',
    description: 'Photographs, names and roles. Edited as one list.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'The people you will speak to', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line saying how long they have been doing this between them.</p>',
                ...CENTRED,
              },
            },
          ],
        ],
      },
      {
        widths: [1],
        columns: [
          [
            {
              type: 'cards',
              props: {
                columns: '4',
                style: 'plain',
                ratio: '1/1',
                align: 'centre',
                imagePosition: 'top',
                wholeCardLinks: false,
                items: [
                  { src: '', alt: '', label: '', title: 'A name', body: 'What they look after, and where they have been.', linkLabel: '', linkHref: '' },
                  { src: '', alt: '', label: '', title: 'A name', body: 'What they look after, and where they have been.', linkLabel: '', linkHref: '' },
                  { src: '', alt: '', label: '', title: 'A name', body: 'What they look after, and where they have been.', linkLabel: '', linkHref: '' },
                  { src: '', alt: '', label: '', title: 'A name', body: 'What they look after, and where they have been.', linkLabel: '', linkHref: '' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'team-three-cards',
    category: 'team',
    label: 'Three, with a note each',
    description: 'Three bordered cards with room for a proper sentence about each person.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'heading', props: { html: 'Who we are', style: 'h2', ...CENTRED } }],
        ],
      },
      {
        widths: [1, 1, 1],
        gap: 24,
        columnBox: [CARD, CARD, CARD],
        columns: [
          [
            { type: 'image', props: { ratio: '1/1', radius: 'md' } },
            { type: 'heading', props: { html: 'A name', style: 'h5', level: 'h3' } },
            { type: 'text', props: { html: '<p>Their role, then a sentence on what they know best.</p>', size: 's' } },
          ],
          [
            { type: 'image', props: { ratio: '1/1', radius: 'md' } },
            { type: 'heading', props: { html: 'A name', style: 'h5', level: 'h3' } },
            { type: 'text', props: { html: '<p>Their role, then a sentence on what they know best.</p>', size: 's' } },
          ],
          [
            { type: 'image', props: { ratio: '1/1', radius: 'md' } },
            { type: 'heading', props: { html: 'A name', style: 'h5', level: 'h3' } },
            { type: 'text', props: { html: '<p>Their role, then a sentence on what they know best.</p>', size: 's' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'team-one-person',
    category: 'team',
    label: 'One person, introduced',
    description: 'A photograph beside a proper introduction. For the owner, or the founder.',
    rows: [
      {
        widths: [1, 2],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: '3/4', radius: 'lg' } }],
          [
            { type: 'heading', props: { html: 'Tagline here', style: 'h6', level: 'h3' } },
            { type: 'heading', props: { html: 'A name', style: 'h2' } },
            {
              type: 'text',
              props: {
                html: '<p>Two or three sentences in their own voice. Where they have been, what they book most, and why somebody should ask for them by name.</p>',
              },
            },
            { type: 'button', props: { label: 'Get in touch', variant: 'secondary' } },
          ],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'team-with-hiring',
    category: 'team',
    label: 'The team, and a job advert',
    description: 'A grid of people with a band underneath saying you are hiring.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'heading', props: { html: 'The team', style: 'h2', ...CENTRED } }],
        ],
      },
      {
        widths: [1],
        columns: [
          [
            {
              type: 'cards',
              props: {
                columns: '3',
                style: 'plain',
                ratio: '1/1',
                align: 'centre',
                wholeCardLinks: false,
                items: [
                  { src: '', alt: '', label: '', title: 'A name', body: 'Their role.', linkLabel: '', linkHref: '' },
                  { src: '', alt: '', label: '', title: 'A name', body: 'Their role.', linkLabel: '', linkHref: '' },
                  { src: '', alt: '', label: '', title: 'A name', body: 'Their role.', linkLabel: '', linkHref: '' },
                ],
              },
            },
          ],
        ],
      },
      {
        widths: [1],
        columnBox: [PANEL],
        columns: [
          [
            { type: 'heading', props: { html: 'We are hiring', style: 'h4', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line on the sort of person you are after and how to reach you.</p>',
                ...CENTRED,
              },
            },
            { type: 'button', props: { label: 'See the role', align: 'centre', variant: 'secondary' } },
          ],
        ],
      },
    ],
  },

  {
    id: 'team-two-across',
    category: 'team',
    label: 'Two, side by side',
    description: 'A pair introduced together. For a partnership or a husband and wife shop.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        columns: [
          [
            { type: 'image', props: { ratio: '4/3', radius: 'lg' } },
            { type: 'heading', props: { html: 'A name', style: 'h4' } },
            {
              type: 'text',
              props: { html: '<p>Their role, and a sentence or two on what they know.</p>' },
            },
          ],
          [
            { type: 'image', props: { ratio: '4/3', radius: 'lg' } },
            { type: 'heading', props: { html: 'A name', style: 'h4' } },
            {
              type: 'text',
              props: { html: '<p>Their role, and a sentence or two on what they know.</p>' },
            },
          ],
        ],
      },
    ],
  },

  /*
   * -------------------------------------------------------------------------
   * Contact
   * -------------------------------------------------------------------------
   *
   * These leave a hole for a widget on purpose, and say so in the copy. The
   * Enquiry, Form, Contact Card, Opening Hours and Maps widgets already exist
   * and are better than anything a preset could put here, so the preset's job
   * is the words and the shape round them.
   */
  {
    id: 'contact-form-beside-details',
    category: 'contact',
    label: 'Form beside the details',
    description: 'Room for an enquiry form on one side, the address and hours on the other.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Get in touch', style: 'h2' } },
            {
              type: 'text',
              props: {
                html: '<p>One line on how quickly somebody will come back to them, and what to include.</p>',
              },
            },
          ],
        ],
      },
      {
        widths: [3, 2],
        gap: 48,
        columns: [
          [
            { type: 'heading', props: { html: 'Send us a message', style: 'h5', level: 'h3' } },
            {
              type: 'text',
              props: {
                html: '<p>Add the Enquiry or Form widget below this line and delete this paragraph.</p>',
                size: 's',
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'Or come and see us', style: 'h5', level: 'h3' } },
            {
              type: 'text',
              props: {
                html: '<p>Your address, over two or three lines.</p><p>Your phone number, and the email people should use.</p>',
              },
            },
            {
              type: 'text',
              props: {
                html: '<p>Add the Opening Hours widget under this for the times.</p>',
                size: 's',
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'contact-follow-us',
    category: 'contact',
    label: 'Follow us',
    description: 'A short line and a row of social icons. Good above a footer.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Somewhere to see what we are up to', style: 'h3', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>Pictures from the trips we have booked, and the offers worth knowing about.</p>',
                ...CENTRED,
              },
            },
            { type: 'social', props: { style: 'circle', size: 'l', align: 'centre' } },
          ],
        ],
      },
    ],
    section: { tone: 'subtle', width: 'narrow' },
  },

  {
    id: 'contact-three-ways',
    category: 'contact',
    label: 'Three ways to reach you',
    description: 'Phone, email and the shop, side by side.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'However suits you', style: 'h2', ...CENTRED } },
          ],
        ],
      },
      {
        widths: [1, 1, 1],
        gap: 24,
        columnBox: [CARD, CARD, CARD],
        columns: [
          [{ type: 'icon-item', props: { icon: 'phone', title: 'Ring us', body: 'Your number here. Say the hours if they are not obvious.', ...CENTRED } }],
          [{ type: 'icon-item', props: { icon: 'mail', title: 'Email us', body: 'Your address here. Say how quickly you answer.', ...CENTRED } }],
          [{ type: 'icon-item', props: { icon: 'map-pin', title: 'Come in', body: 'Your street and town. Add the Maps widget underneath.', ...CENTRED } }],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'contact-map-beside',
    category: 'contact',
    label: 'Map beside the address',
    description: 'The address and hours on the left, room for the map on the right.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        columns: [
          [
            { type: 'heading', props: { html: 'Where to find us', style: 'h2' } },
            {
              type: 'text',
              props: { html: '<p>Your address, over two or three lines.</p><p>Parking, the nearest station, that sort of thing.</p>' },
            },
            { type: 'button', props: { label: 'Get directions', variant: 'secondary' } },
          ],
          [
            {
              type: 'text',
              props: {
                html: '<p>Add the Maps widget here and delete this paragraph.</p>',
                size: 's',
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'contact-simple-form',
    category: 'contact',
    label: 'Just a form',
    description: 'A narrow column with a title and room for the form. Nothing else in the way.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Tell us what you are after', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>Roughly where, roughly when, and roughly how many of you. We will do the rest.</p>',
                ...CENTRED,
              },
            },
            {
              type: 'text',
              props: {
                html: '<p>Add the Enquiry widget below this line and delete this paragraph.</p>',
                size: 's',
                ...CENTRED,
              },
            },
          ],
        ],
      },
    ],
    section: { width: 'narrow' },
  },

  {
    id: 'contact-hours-and-phone',
    category: 'contact',
    label: 'Hours, phone and a map',
    description: 'Three across for a shop: when you are open, how to ring, where you are.',
    rows: [
      {
        widths: [1, 1, 1],
        gap: 32,
        columns: [
          [
            { type: 'heading', props: { html: 'Opening hours', style: 'h5', level: 'h3' } },
            {
              type: 'text',
              props: { html: '<p>Add the Opening Hours widget here, or type them out.</p>', size: 's' },
            },
          ],
          [
            { type: 'heading', props: { html: 'Talk to somebody', style: 'h5', level: 'h3' } },
            {
              type: 'text',
              props: { html: '<p>Your number, and the best time to ring it.</p>' },
            },
            { type: 'button', props: { label: 'Send an enquiry', variant: 'ghost' } },
          ],
          [
            { type: 'heading', props: { html: 'Find us', style: 'h5', level: 'h3' } },
            {
              type: 'text',
              props: { html: '<p>Your address, then the Maps widget under it.</p>' },
            },
          ],
        ],
      },
    ],
  },
];
