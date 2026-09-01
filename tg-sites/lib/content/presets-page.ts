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
 *
 * A `photo` QUERY IS THE ONE SANCTIONED EXCEPTION, and it is not a baked
 * picture: it is a search term resolved fresh at insert, into the client's own
 * media, credited and swappable (see PresetBlock.photo and lib/content/
 * photo-plan.ts). A preset author writes one where a picture names a SPECIFIC
 * thing (the CTA's planning desk, a feature's harbour), and it wins over any
 * page subject because it was chosen on purpose.
 *
 * TWO CATEGORIES PHOTOGRAPH WITHOUT NAMING ONE: heroes, and (since 1 Sep 2026,
 * Andy) the whole GALLERY category. A picture in either draws a travel subject
 * from the shared palette when the preset and the page name none, so those
 * layouts preview and insert photographed rather than as a wall of grey frames.
 * It is a FALLBACK, not an override: a page with a subject of its own still
 * steers the gallery (a St Lucia page gets St Lucia), which is what keeps an
 * AI-built page on theme. See heroPhotoQuery and the `isPhotographic` check in
 * both presets.ts (the preview) and photo-plan.ts (the fill).
 *
 * The one thing a picture never draws is a PERSON: a stock face presenting as
 * the client's team or customers would be inventing a fact, so the team and
 * testimonial presets keep their empty frames, and the blank category (neutral
 * by design) keeps its "choose an image" prompt. The whole point is a real feel
 * of the layout that the client then swaps for their own.
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
  /*
   * ---------------------------------------------------------------------------
   * Hero
   * ---------------------------------------------------------------------------
   *
   * The section a page OPENS with, and the one gap the library had until 2 Aug
   * 2026. Relume calls these "Header Sections"; everybody else calls them heroes,
   * and we cannot use their word because `header` already means the site's own
   * navbar region. See the note on PRESET_CATEGORIES.
   *
   * WHAT MAKES A HERO DIFFERENT FROM AN OPENER IN Blank: it is the FIRST thing
   * on the page, so its heading is the page's h1-sized statement rather than a
   * section title, it carries more vertical room, and it nearly always offers
   * somewhere to go next. The Blank openers stay where they are for use further
   * down a page.
   *
   * THE EIGHT ARE CHOSEN BY AXIS, NOT BY TASTE, because a design being mapped
   * onto one has to land somewhere sensible. Between them they cover every
   * combination a matcher will meet: picture none / left / right / below /
   * behind, words centred or left, and the two travel-specific closers that put
   * proof directly under the promise.
   */
  {
    id: 'hero-centred',
    category: 'hero',
    label: 'Centred, with two buttons',
    description: 'The classic opener. Works on any page and reads well on a phone.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Small group holidays, properly planned', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One or two lines on who you are and what somebody gets by booking with you rather than a screen.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
            {
              type: 'button-group',
              props: {
                align: 'centre',
                buttons: [
                  { label: 'See our holidays', href: '', variant: 'primary' },
                  { label: 'Talk to us', href: '', variant: 'secondary' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 96 },
  },

  {
    id: 'hero-split-right',
    category: 'hero',
    label: 'Words left, picture right',
    description: 'The most used shape there is. Put your best photograph in it.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'Thirty years of getting people to the right place', level: 'h2', style: 'h1' } },
            {
              type: 'text',
              props: {
                html: '<p>A sentence on what you do differently. Keep it to the thing a visitor could not get anywhere else.</p>',
                size: 'l',
              },
            },
            {
              type: 'button-group',
              props: {
                buttons: [
                  { label: 'Start planning', href: '', variant: 'primary' },
                  { label: 'How it works', href: '', variant: 'ghost' },
                ],
              },
            },
          ],
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
        ],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-split-left',
    category: 'hero',
    label: 'Picture left, words right',
    description: 'The same shape the other way round, for variety down a long site.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
          [
            { type: 'heading', props: { html: 'Where would you like to go?', level: 'h2', style: 'h1' } },
            {
              type: 'text',
              props: {
                html: '<p>A sentence on what you do differently. Keep it to the thing a visitor could not get anywhere else.</p>',
                size: 'l',
              },
            },
            {
              type: 'button-group',
              props: {
                buttons: [{ label: 'Start planning', href: '', variant: 'primary' }],
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-image-below',
    category: 'hero',
    label: 'Centred words over a wide picture',
    description: 'A strong statement with the photograph doing the work underneath.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'The Greek islands, without the guesswork', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line under the title. Say who it is for.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
            {
              type: 'button-group',
              props: {
                align: 'centre',
                buttons: [{ label: 'See the collection', href: '', variant: 'primary' }],
              },
            },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'image', props: { alt: '', ratio: '16/9', radius: 'md' } }]],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-background',
    category: 'hero',
    label: 'Words over a background photograph',
    description: 'Set the picture on the section itself. Tall, and the most dramatic.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Somewhere worth the flight', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line. On a picture, fewer words is always better.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
            {
              type: 'button-group',
              props: {
                align: 'centre',
                buttons: [{ label: 'Browse destinations', href: '', variant: 'primary' }],
              },
            },
          ],
        ],
      },
    ],
    /*
     * Dark toned and roomy, and a QUERY for the background rather than a frozen
     * URL. The preview draws this photograph and the fill-on-insert fetches it
     * into the client's own media, so nobody ships a stock file they meant to
     * swap. The dark tone is the fallback if the photo library is not connected.
     */
    section: { tone: 'dark', paddingY: 128, width: 'full', backgroundQuery: 'santorini sunset sea', minHeight: 560, alignY: 'centre' },
  },

  {
    /*
     * THE INSIDE-PAGE OPENER. Every page template starts with one of these, and
     * it is the difference between an About page that looks designed and a wall
     * of white with words on it. Shorter than the home heroes on purpose: an
     * inside page's banner introduces, it does not sell, so there is no button
     * and the page below is the content. The template overrides the photograph
     * per page (an About banner and a Holidays banner should not share a
     * picture): see StarterSection.photo in lib/content/starters.ts.
     */
    id: 'hero-page-banner',
    category: 'hero',
    label: 'Page banner',
    description: 'A short photographed opener for an inside page: the title and one line, no button.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'About us', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line under the title. What this page is, in plain words.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'dark', paddingY: 88, width: 'full', backgroundQuery: 'scenic coast road aerial' },
  },

  {
    id: 'hero-with-badges',
    category: 'hero',
    label: 'Opener with trust badges',
    description: 'ATOL, ABTA and the rest, right under the promise. Travel sells on trust.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Book with people you can ring', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line on the reassurance somebody is looking for before they part with money.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
            {
              type: 'button-group',
              props: {
                align: 'centre',
                buttons: [{ label: 'Send an enquiry', href: '', variant: 'primary' }],
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
              type: 'logos',
              props: {
                height: 's',
                align: 'centre',
                tone: 'grey',
                items: [{ alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }],
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 88 },
  },

  {
    id: 'hero-with-stats',
    category: 'hero',
    label: 'Opener with key numbers',
    description: 'The promise, then the proof. Years in business, holidays booked, review score.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Independent, and proud of it', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line on who you are. The numbers below say the rest.</p>',
                size: 'l',
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
              type: 'stats',
              props: {
                columns: '3',
                align: 'centre',
                divided: true,
                items: [
                  { value: '30', suffix: ' years', label: 'On the same high street' },
                  { value: '12,000', label: 'Holidays booked' },
                  { value: '4.9', suffix: '/5', label: 'From 800 reviews' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 88, tone: 'subtle' },
  },

  {
    id: 'hero-minimal',
    category: 'hero',
    label: 'Just a title and a button',
    description: 'For an inside page that needs an opening without a whole production.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Destinations', level: 'h2', style: 'h1' } },
            {
              type: 'text',
              props: { html: '<p>One line saying what is on this page.</p>', size: 'l' },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 64, tone: 'subtle' },
  },

  /*
   * A SECOND SET OF HEROES, added 3 Aug 2026 when Andy asked for more opening
   * sections. The first eight cover where the picture sits; these cover what the
   * hero DOES next: a tagline over the promise, a wall of pictures, the first
   * three things to book, and what is in the price. Same rules as above, and the
   * same one that matters most: no picture is baked in, every image starts empty
   * so nobody ships a stock photo they meant to swap.
   */
  {
    id: 'hero-eyebrow',
    category: 'hero',
    label: 'Tagline, then a big statement',
    description: 'A small line to set the scene, then the promise in full. Left aligned.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Tailor-made travel', style: 'h6', level: 'h3' } },
            { type: 'heading', props: { html: 'Holidays built around you, not a brochure', level: 'h2', style: 'h1' } },
            {
              type: 'text',
              props: {
                html: '<p>A sentence on what you do differently. Keep it to the thing a visitor could not get from a booking site.</p>',
                size: 'l',
              },
            },
            {
              type: 'button-group',
              props: {
                buttons: [
                  { label: 'Start planning', href: '', variant: 'primary' },
                  { label: 'See how it works', href: '', variant: 'ghost' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 96 },
  },

  {
    id: 'hero-split-gallery',
    category: 'hero',
    label: 'Words left, a wall of pictures right',
    description: 'For when one photograph is not enough. Show a few of the places at once.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'A few of the places we know inside out', level: 'h2', style: 'h1' } },
            {
              type: 'text',
              props: {
                html: '<p>One or two lines on the kind of trips you plan. The pictures beside this do the rest.</p>',
                size: 'l',
              },
            },
            {
              type: 'button-group',
              props: {
                buttons: [{ label: 'Browse destinations', href: '', variant: 'primary' }],
              },
            },
          ],
          [{ type: 'gallery', props: { columns: '2', gap: 's' } }],
        ],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-cards-below',
    category: 'hero',
    label: 'Opener with three featured trips',
    description: 'The promise, then somewhere to start. Puts your best three right up top.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Where would you like to go?', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>Pick a starting point, or tell us what you have in mind and we will build it from there.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
            {
              type: 'button-group',
              props: {
                align: 'centre',
                buttons: [{ label: 'See every destination', href: '', variant: 'primary' }],
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
              /*
               * A SUFFIX, not a whole query: each card searches as its own label
               * plus these words (Greece coast landscape...), so the photographs
               * match the places the sample copy names. See cardQueries in
               * lib/content/photo-plan.ts.
               */
              photo: 'coast landscape',
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
    section: { paddingY: 80 },
  },

  {
    id: 'hero-inclusions',
    category: 'hero',
    label: 'Statement with what is included',
    description: 'The promise beside a plain list of what the price covers. Travel sells on this.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'Everything sorted before you fly', level: 'h2', style: 'h1' } },
            {
              type: 'text',
              props: {
                html: '<p>One line on the reassurance somebody is looking for before they part with money.</p>',
                size: 'l',
              },
            },
            {
              type: 'button-group',
              props: {
                buttons: [{ label: 'Get a quote', href: '', variant: 'primary' }],
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'In the price', style: 'h6', level: 'h3' } },
            {
              type: 'list',
              props: {
                style: 'tick',
                items: [
                  { text: 'Return flights' },
                  { text: 'Transfers both ways' },
                  { text: 'ATOL protected' },
                  { text: 'Someone you can ring' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 80 },
  },

  /*
   * A THIRD SET, 3 Aug 2026, built from the design grid Andy sent. These are the
   * shapes in it the twelve above did not already cover: a pair of pictures over
   * the words, the picture leading and the words underneath, a message held
   * between two pictures, a big name over a strip of images, and words set to one
   * side of a full photograph. The near-duplicates of what already existed were
   * left out rather than added twice.
   */
  {
    id: 'hero-two-up',
    category: 'hero',
    label: 'Two pictures, then the title',
    description: 'A pair of images across the top with the opening line beneath. Bold and visual.',
    rows: [
      {
        widths: [1, 1],
        gap: 24,
        columns: [
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
        ],
      },
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Two of our favourite places to start', level: 'h2', style: 'h1' } },
            {
              type: 'button-group',
              props: { buttons: [{ label: 'See the collection', href: '', variant: 'primary' }] },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 72 },
  },

  {
    id: 'hero-image-top',
    category: 'hero',
    label: 'Picture first, words underneath',
    description: 'Lead with the photograph, then the title and a line below it. For a strong image.',
    rows: [
      {
        widths: [1],
        columns: [[{ type: 'image', props: { alt: '', ratio: '16/9', radius: 'md' } }]],
      },
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'heading', props: { html: 'A place worth the journey', level: 'h2', style: 'h1' } }],
          [
            {
              type: 'text',
              props: {
                html: '<p>Two lines under the picture, on who this is for and what to do next.</p>',
                size: 'l',
              },
            },
            {
              type: 'button-group',
              props: { buttons: [{ label: 'Start planning', href: '', variant: 'primary' }] },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-three-up',
    category: 'hero',
    label: 'A message between two pictures',
    description: 'The opening words in the middle with a photograph either side. Balanced and calm.',
    rows: [
      {
        widths: [1, 1, 1],
        gap: 24,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { alt: '', ratio: '3/4', radius: 'md' } }],
          [
            { type: 'heading', props: { html: 'A short, clear invitation', level: 'h2', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: { html: '<p>A line or two in the middle, with a picture either side.</p>', ...CENTRED },
            },
            {
              type: 'button-group',
              props: { align: 'centre', buttons: [{ label: 'Learn more', href: '', variant: 'primary' }] },
            },
          ],
          [{ type: 'image', props: { alt: '', ratio: '3/4', radius: 'md' } }],
        ],
        columnBox: [undefined, PANEL, undefined],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-brand-strip',
    category: 'hero',
    label: 'Big name over a strip of pictures',
    description: 'A dark opener with the name large and centred, then a row of images below.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Brand name', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: { html: '<p>One line under the name. Keep it short.</p>', size: 'l', ...CENTRED },
            },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'gallery', props: { columns: '3', gap: 's' } }]],
      },
    ],
    /*
     * Dark and full width, and NO picture baked in, the same as hero-background:
     * the gallery below and the tone make it obvious where the images go, and a
     * stock photo shipped in a preset is one somebody has to notice and remove.
     */
    section: { tone: 'dark', paddingY: 96, width: 'full' },
  },

  {
    id: 'hero-background-left',
    category: 'hero',
    label: 'Words to one side of a photograph',
    description: 'A full-bleed picture with the words set left rather than centred. Quieter, and easy to read.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Start the trip here', level: 'h2', style: 'h1' } },
            {
              type: 'text',
              props: { html: '<p>One line. On a picture, fewer words is always better.</p>', size: 'l' },
            },
            {
              type: 'button-group',
              props: {
                buttons: [
                  { label: 'Browse destinations', href: '', variant: 'primary' },
                  { label: 'Talk to us', href: '', variant: 'ghost' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'dark', paddingY: 128, width: 'full', backgroundQuery: 'coastal cliffs ocean view', minHeight: 560, alignY: 'centre' },
  },

  /*
   * A FOURTH SET, 3 Aug 2026, working through the design grid in full. Andy
   * counted five or six layouts in each screenshot and wanted them all, filed
   * under Hero. These are the ones the earlier sets had not built yet: a
   * statement on a brand band, a title with the picture below, a picture with a
   * bar beneath, a tall portrait beside the words, an editorial pair of pictures,
   * a centred title over two, a photograph with the words raised in a card, one
   * big title over an image, and a title with two columns of text. Pictures start
   * empty here too, ready for the imagery pass to fill from the client's media.
   */
  {
    id: 'hero-brand-statement',
    category: 'hero',
    label: 'A statement on a brand band',
    description: 'The name or the promise set large on a band of your brand colour. Bold and plain.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'heading', props: { html: 'Brand name', level: 'h2', style: 'h1' } }],
          [
            {
              type: 'text',
              props: { html: '<p>A line or two on who you are, set beside the name. Keep it short and sure.</p>', size: 'l' },
            },
            {
              type: 'button-group',
              props: { buttons: [{ label: 'Start here', href: '', variant: 'secondary' }] },
            },
          ],
        ],
      },
    ],
    section: { tone: 'accent', paddingY: 112, width: 'full' },
  },

  {
    id: 'hero-header-image-below',
    category: 'hero',
    label: 'Title and line, then a wide picture',
    description: 'The heading with a supporting line beside it, then a full-width photograph below.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'bottom',
        columns: [
          [{ type: 'heading', props: { html: 'Write the opening title here', level: 'h2', style: 'h1' } }],
          [
            {
              type: 'text',
              props: { html: '<p>A supporting line or two, then a wide picture underneath to set the scene.</p>', size: 'l' },
            },
            {
              type: 'button-group',
              props: { buttons: [{ label: 'Learn more', href: '', variant: 'primary' }] },
            },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'image', props: { alt: '', ratio: '16/9', radius: 'md' } }]],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-image-caption-bar',
    category: 'hero',
    label: 'Picture with a title bar under it',
    description: 'A wide photograph with the title and a button on a line beneath. Clean and modern.',
    rows: [
      {
        widths: [1],
        columns: [[{ type: 'image', props: { alt: '', ratio: '16/9', radius: 'md' } }]],
      },
      {
        widths: [1, 1],
        gap: 24,
        align: 'centre',
        columns: [
          [{ type: 'heading', props: { html: 'Add your title here', level: 'h2', style: 'h2' } }],
          [
            {
              type: 'button-group',
              props: { align: 'right', buttons: [{ label: 'Join now', href: '', variant: 'primary' }] },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 64 },
  },

  {
    id: 'hero-tall-image',
    category: 'hero',
    label: 'Words left, a tall picture right',
    description: 'A portrait photograph beside the words, for a person or one striking shot.',
    rows: [
      {
        widths: [3, 2],
        gap: 48,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'Write down an introduction title here', level: 'h2', style: 'h1' } },
            {
              type: 'text',
              props: { html: '<p>A sentence on what you do, beside a tall portrait picture.</p>', size: 'l' },
            },
            {
              type: 'button-group',
              props: { buttons: [{ label: 'Start planning', href: '', variant: 'primary' }] },
            },
          ],
          [{ type: 'image', props: { alt: '', ratio: '3/4', radius: 'md' } }],
        ],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-text-two-images',
    category: 'hero',
    label: 'A few words, then two pictures',
    description: 'A short intro and a button, a pair of images, and the title underneath. Editorial.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'text',
              props: { html: '<p>A short opening line, then two pictures and the title below.</p>', size: 'l' },
            },
            {
              type: 'button-group',
              props: { buttons: [{ label: 'Learn more', href: '', variant: 'ghost' }] },
            },
          ],
        ],
      },
      {
        widths: [1, 1],
        gap: 24,
        columns: [
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'heading', props: { html: 'An introduction title', level: 'h2', style: 'h1' } }]],
      },
    ],
    section: { paddingY: 72 },
  },

  {
    id: 'hero-centred-two-images',
    category: 'hero',
    label: 'Centred title, then two pictures',
    description: 'A centred opening line with a button, then two images side by side below it.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Add your medium length title here', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'button-group',
              props: { align: 'centre', buttons: [{ label: 'Learn more', href: '', variant: 'primary' }] },
            },
          ],
        ],
      },
      {
        widths: [1, 1],
        gap: 24,
        columns: [
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
        ],
      },
    ],
    section: { paddingY: 72 },
  },

  {
    id: 'hero-card-beside-image',
    category: 'hero',
    label: 'Picture, with the words in a card',
    description: 'A photograph on one side and the opening words raised in a card on the other.',
    rows: [
      {
        widths: [1, 1],
        gap: 0,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
          [
            { type: 'heading', props: { html: 'Add your medium length title here', level: 'h2', style: 'h2' } },
            { type: 'text', props: { html: '<p>A line or two, raised in a card beside the picture.</p>' } },
            {
              type: 'button-group',
              props: { buttons: [{ label: 'Learn more', href: '', variant: 'primary' }] },
            },
          ],
        ],
        columnBox: [undefined, CARD_ROOMY],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-big-title',
    category: 'hero',
    label: 'One big title over a picture',
    description: 'A large, plain title with a wide photograph beneath. Loud and confident.',
    rows: [
      {
        widths: [1],
        columns: [[{ type: 'heading', props: { html: 'This is a title', level: 'h2', style: 'h1' } }]],
      },
      {
        widths: [1],
        columns: [[{ type: 'image', props: { alt: '', ratio: '16/9', radius: 'md' } }]],
      },
    ],
    section: { paddingY: 72 },
  },

  {
    id: 'hero-title-two-paragraphs',
    category: 'hero',
    label: 'Title with two columns of text, then a picture',
    description: 'A heading beside two short paragraphs, with a wide image below. For saying a bit more.',
    rows: [
      {
        widths: [1, 1, 1],
        gap: 32,
        columns: [
          [{ type: 'heading', props: { html: 'Write down an intro title', level: 'h2', style: 'h1' } }],
          [{ type: 'text', props: { html: '<p>The first short paragraph, on one side of the title.</p>' } }],
          [{ type: 'text', props: { html: '<p>The second, so two ideas sit side by side rather than stacked.</p>' } }],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'image', props: { alt: '', ratio: '16/9', radius: 'md' } }]],
      },
    ],
    section: { paddingY: 80 },
  },

  /*
   * THE LAST OF THE GRID, 3 Aug 2026. The word card on a photograph, which the
   * screenshots had three ways round, plus the brand over a picture, a centred
   * opener that ends on the social links, and a picture beside a small titled
   * block. The card-on-photo turned out to want no new feature after all: it is a
   * full-bleed background with a light card floating in the middle column.
   */
  {
    id: 'hero-card-on-photo',
    category: 'hero',
    label: 'A card of words on a photograph',
    description: 'A full-bleed picture with the title raised in a card on top. The most magazine-like.',
    rows: [
      {
        widths: [1, 2, 1],
        align: 'centre',
        columns: [
          [],
          [
            { type: 'heading', props: { html: 'An intro title here', level: 'h2', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: { html: '<p>A line or two, raised in a card over the picture behind it.</p>', ...CENTRED },
            },
            {
              type: 'button-group',
              props: { align: 'centre', buttons: [{ label: 'Learn more', href: '', variant: 'primary' }] },
            },
          ],
          [],
        ],
        // A light card, so dark words read over any photograph, lifted off the
        // picture with a shadow. The side columns are empty spacers that centre it.
        columnBox: [
          undefined,
          { radius: 14, background: 'var(--tgs-surface)', padding: { top: 32, right: 32, bottom: 32, left: 32 }, shadow: 'medium' },
          undefined,
        ],
      },
    ],
    section: { paddingY: 112, width: 'full', backgroundQuery: 'mediterranean coast view', minHeight: 520, alignY: 'centre' },
  },

  {
    id: 'hero-brand-over-photo',
    category: 'hero',
    label: 'Brand name over a photograph',
    description: 'The name centred over a full-bleed picture. Simple, and striking on the right shot.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Brand name', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: { html: '<p>A line under the name, over the picture.</p>', size: 'l', ...CENTRED },
            },
          ],
        ],
      },
    ],
    section: { tone: 'dark', paddingY: 128, width: 'full', backgroundQuery: 'aerial turquoise coast', minHeight: 560, alignY: 'centre' },
  },

  {
    id: 'hero-gallery-social',
    category: 'hero',
    label: 'Centred opener with pictures and socials',
    description: 'A centred title and buttons, a row of pictures, then your social links beneath.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Add your medium length title here', level: 'h2', style: 'h1', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>One line under the title, then a few pictures and where to follow you.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
            {
              type: 'button-group',
              props: {
                align: 'centre',
                buttons: [
                  { label: 'See more', href: '', variant: 'primary' },
                  { label: 'Contact us', href: '', variant: 'ghost' },
                ],
              },
            },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'gallery', props: { columns: '4', gap: 's' } }]],
      },
      {
        widths: [1],
        columns: [[{ type: 'social', props: { align: 'centre' } }]],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'hero-image-textarea',
    category: 'hero',
    label: 'Picture left, title and a text block right',
    description: 'A photograph beside the title with a small labelled block of text under it.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { alt: '', ratio: '4/3', radius: 'md' } }],
          [
            { type: 'heading', props: { html: 'Write down an intro title', level: 'h2', style: 'h1' } },
            { type: 'heading', props: { html: 'This is the text area', style: 'h6', level: 'h3' } },
            {
              type: 'text',
              props: { html: '<p>A short block under the small heading, to the right of the picture.</p>' },
            },
            {
              type: 'button-group',
              props: { buttons: [{ label: 'Read more', href: '', variant: 'ghost' }] },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 80 },
  },

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
    section: { paddingY: 96, width: 'narrow', tone: 'subtle' },
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
          [{ type: 'image', photo: 'travel agent desk brochures planning', props: { ratio: '4/3', radius: 'lg' } }],
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
              // Same suffix contract as hero-cards-below: label + these words.
              photo: 'coast landscape',
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
          [{ type: 'image', photo: 'greek island harbour boats', props: { ratio: '4/3', radius: 'lg' } }],
        ],
      },
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [{ type: 'image', photo: 'old town street europe evening', props: { ratio: '4/3', radius: 'lg' } }],
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
    section: { tone: 'subtle' },
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
          [{ type: 'image', photo: 'travel planning map notebook coffee', props: { ratio: '4/3', radius: 'lg' } }],
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
    section: { width: 'narrow', paddingY: 80, tone: 'subtle' },
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
                style: 'striped',
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
    section: { tone: 'subtle' },
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
                style: 'raised',
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
                style: 'bordered',
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
        /*
         * THE FORM ON THE PAGE, THE DETAILS IN A PANEL. A gap in the array
         * leaves that column plain, which is what the form side wants: a form
         * inside a tinted box on a page reads as an advert for a form.
         */
        columnBox: [undefined, PANEL],
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
            /*
             * AN ICON PER WAY IN, and this is the case that earns them. A pin,
             * a phone and a clock are the three things a person scans a contact
             * page for, and each one is recognised before the words beside it
             * are read. That is an icon doing a job, which is the only reason
             * to spend one: the design skill lists icon-heading-paragraph
             * repeated across a grid as a sign of a machine having decorated
             * something, and it is right. Every icon in this library has to
             * name a thing that exists.
             */
            { type: 'icon-item', props: { icon: 'map-pin', title: 'The shop', body: 'Your address, over two or three lines.' } },
            { type: 'icon-item', props: { icon: 'phone', title: 'By phone or email', body: 'Your number, and the address people should write to.' } },
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
            /*
             * THE HOURS WERE IN THE DESCRIPTION AND NOT IN THE SECTION until
             * 2 Aug 2026. "The address and hours on the left" built an address
             * and no hours, which is the sort of gap somebody notices only
             * after they have already put it on a page.
             */
            { type: 'icon-item', props: { icon: 'map-pin', title: 'The address', body: 'Over two or three lines. Parking, the nearest station, that sort of thing.' } },
            { type: 'icon-item', props: { icon: 'clock', title: 'When we are open', body: 'Add the Opening Hours widget here, or type the times out.' } },
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
        /*
         * ICONS BUT NO CARDS, which is the difference between this and "Three
         * ways to reach you" one entry up. That one is carded and tinted; this
         * one is the same information laid out plainly, for a page that already
         * has enough panels on it. Two designs of a shape, not two decorations
         * of one.
         */
        columns: [
          [
            { type: 'icon-item', props: { icon: 'clock', title: 'Opening hours', body: 'Add the Opening Hours widget here, or type them out.' } },
          ],
          [
            { type: 'icon-item', props: { icon: 'phone', title: 'Talk to somebody', body: 'Your number, and the best time to ring it.' } },
            { type: 'button', props: { label: 'Send an enquiry', variant: 'ghost' } },
          ],
          [
            { type: 'icon-item', props: { icon: 'map-pin', title: 'Find us', body: 'Your address, then the Maps widget under it.' } },
          ],
        ],
      },
    ],
  },

  /*
   * ---------------------------------------------------------------------------
   * Logos and badges
   * ---------------------------------------------------------------------------
   *
   * ATOL, ABTA, IATA, the airlines and the tour operators. In travel this is not
   * decoration: it is the thing that turns a website into somewhere a person will
   * put four thousand pounds. Relume calls the category Logo Sections.
   *
   * NO LOGOS ARE SHIPPED IN THE PRESETS, only empty slots. A badge somebody has
   * not earned is the worst thing this library could put on a live site, and the
   * rule is already written down: A BADGE IS NEVER A PLACEHOLDER.
   */
  {
    id: 'logos-row',
    category: 'logos',
    label: 'A line and a row of logos',
    description: 'One line of context, then the badges. The usual arrangement.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'text',
              props: { html: '<p>Protected by the schemes you would want us to be in.</p>', size: 's', ...CENTRED },
            },
            {
              type: 'logos',
              props: { height: 'm', align: 'centre', tone: 'grey', items: [{ alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }] },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 48, tone: 'subtle' },
  },

  {
    id: 'logos-plain',
    category: 'logos',
    label: 'Just the row',
    description: 'No words at all. Good directly under a hero.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'logos',
              props: { height: 'm', align: 'centre', tone: 'grey', items: [{ alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }] },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 40, tone: 'light' },
  },

  {
    id: 'logos-titled',
    category: 'logos',
    label: 'Title, words and logos',
    description: 'A proper section for a page about who you work with.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Who we book with', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: { html: '<p>A line on why these names matter to somebody booking a holiday.</p>', ...CENTRED },
            },
            {
              type: 'logos',
              props: { height: 'm', align: 'centre', tone: 'grey-hover', items: [{ alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }] },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'logos-beside-words',
    category: 'logos',
    label: 'Words left, logos right',
    description: 'When the badges need a sentence of explanation next to them.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'Your money is protected', style: 'h3' } },
            {
              type: 'text',
              props: { html: '<p>Two lines on what the protection actually means, in plain words rather than scheme numbers.</p>' },
            },
          ],
          [
            {
              type: 'logos',
              props: { height: 'm', align: 'left', tone: 'colour', items: [{ alt: '' }, { alt: '' }, { alt: '' }, { alt: '' }] },
            },
          ],
        ],
      },
    ],
  },

  /*
   * ---------------------------------------------------------------------------
   * Key numbers
   * ---------------------------------------------------------------------------
   *
   * Relume calls these Stats Sections. The block already knew the important rule
   * and these follow it: A FIGURE IS TEXT, NOT A NUMBER, because 12,000 and 4.9
   * and 24/7 and £2m are all figures and only one of them is a number.
   */
  {
    id: 'stats-three',
    category: 'stats',
    label: 'Three numbers across',
    description: 'The quickest way to say how long you have been doing this.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'stats',
              props: {
                columns: '3',
                size: 'l',
                align: 'centre',
                divided: true,
                items: [
                  { value: '30', suffix: ' years', label: 'On the same high street' },
                  { value: '12,000', label: 'Holidays booked' },
                  { value: '4.9', suffix: '/5', label: 'From 800 reviews' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 64, tone: 'subtle' },
  },

  {
    id: 'stats-titled',
    category: 'stats',
    label: 'Title, then the numbers',
    description: 'A heading to frame the figures, for a page about the company.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'The short version', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: { html: '<p>One line under the title, then let the figures speak.</p>', ...CENTRED },
            },
            {
              type: 'stats',
              props: {
                columns: '4',
                align: 'centre',
                items: [
                  { value: '30', suffix: ' years', label: 'In business' },
                  { value: '60', suffix: '+', label: 'Countries' },
                  { value: '12,000', label: 'Holidays booked' },
                  { value: '92', suffix: '%', label: 'Book with us again' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'stats-beside-words',
    category: 'stats',
    label: 'Words left, numbers right',
    description: 'The story on one side and the evidence on the other.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'Small enough to care, big enough to deliver', style: 'h2' } },
            {
              type: 'text',
              props: { html: '<p>Two or three lines on how the business got here and what that means for somebody booking today.</p>' },
            },
          ],
          [
            {
              type: 'stats',
              props: {
                columns: '2',
                align: 'left',
                items: [
                  { value: '30', suffix: ' years', label: 'In business' },
                  { value: '12,000', label: 'Holidays booked' },
                  { value: '4.9', suffix: '/5', label: 'Review score' },
                  { value: '24/7', label: 'While you are away' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'stats-band',
    category: 'stats',
    label: 'A coloured band of figures',
    description: 'Toned so it breaks up a long page. Good between two white sections.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'stats',
              props: {
                columns: '4',
                size: 'l',
                align: 'centre',
                items: [
                  { value: '30', suffix: ' years', label: 'In business' },
                  { value: '60', suffix: '+', label: 'Countries' },
                  { value: '12,000', label: 'Holidays booked' },
                  { value: '4.9', suffix: '/5', label: 'Review score' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'accent', paddingY: 72 },
  },

  /*
   * ---------------------------------------------------------------------------
   * How it works
   * ---------------------------------------------------------------------------
   *
   * Relume calls these Timeline Sections. Ours is named for the job a travel
   * agent actually needs it for: explaining what happens after somebody gets in
   * touch, and laying out a day by day itinerary.
   */
  {
    id: 'steps-three-across',
    category: 'steps',
    label: 'Three numbered steps across',
    description: 'Tell us what you want, we plan it, you go. The reassurance section.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'How it works', style: 'h2', ...CENTRED } },
            {
              type: 'steps',
              props: {
                layout: 'across',
                marker: 'number',
                connector: true,
                items: [
                  { title: 'Tell us the shape of it', body: 'Where, roughly when, and what matters most. A phone call or a form.' },
                  { title: 'We put it together', body: 'Flights, rooms, transfers and the bits nobody thinks of until they are missing.' },
                  { title: 'You go', body: 'With one number to ring if anything needs sorting while you are away.' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'steps-down',
    category: 'steps',
    label: 'Steps down the page',
    description: 'More room per step. Use when each one needs a proper explanation.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'What happens next', style: 'h2' } },
            {
              type: 'steps',
              props: {
                layout: 'down',
                marker: 'number',
                connector: true,
                items: [
                  { title: 'Your first conversation', body: 'Twenty minutes on the phone, or an enquiry form if that suits you better.' },
                  { title: 'A first suggestion', body: 'Within two working days, with prices and a reason for each choice.' },
                  { title: 'Changes, as many as it takes', body: 'Nobody gets it right first time and we do not expect to.' },
                  { title: 'Booked and paid', body: 'Deposit now, balance twelve weeks before you fly.' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'steps-itinerary',
    category: 'steps',
    label: 'A day by day itinerary',
    description: 'Dots rather than numbers, for a trip laid out day by day.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Your week, day by day', style: 'h2' } },
            {
              type: 'steps',
              props: {
                layout: 'down',
                marker: 'dot',
                connector: true,
                items: [
                  { title: 'Day one, arrive', body: 'Transfer to the hotel, an evening to yourselves.' },
                  { title: 'Day two, the old town', body: 'A morning walk with a local guide, the afternoon free.' },
                  { title: 'Day three, the coast', body: 'Out to the islands by boat, back for dinner.' },
                  { title: 'Day four, home', body: 'A late flight, so the last morning is yours.' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'steps-beside-words',
    category: 'steps',
    label: 'Words left, steps right',
    description: 'When the process needs a paragraph of context beside it.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        columns: [
          [
            { type: 'heading', props: { html: 'Booking with a person', style: 'h2' } },
            {
              type: 'text',
              props: { html: '<p>Two or three lines on why this is different from booking on a screen at midnight.</p>' },
            },
            {
              type: 'button-group',
              props: { buttons: [{ label: 'Start a conversation', href: '', variant: 'primary' }] },
            },
          ],
          [
            {
              type: 'steps',
              props: {
                layout: 'down',
                marker: 'number',
                connector: true,
                items: [
                  { title: 'Tell us the shape of it', body: 'Where, when, and what matters.' },
                  { title: 'We put it together', body: 'With a reason for every choice.' },
                  { title: 'You go', body: 'And we are on the end of a phone.' },
                ],
              },
            },
          ],
        ],
      },
    ],
  },

  /*
   * ---------------------------------------------------------------------------
   * Blog
   * ---------------------------------------------------------------------------
   *
   * Relume calls these Blog Sections. Every one of these is the Cards block set
   * to `collection`, so the entries come from the site's own writing rather than
   * being typed into the section: add a post and it appears here, which is the
   * whole reason collections exist. The collection name is left EMPTY so the
   * client picks theirs rather than inheriting a guess.
   */
  {
    id: 'blog-latest-three',
    category: 'blog',
    label: 'The latest three posts',
    description: 'Pulls from your writing. Add a post and it turns up here on its own.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'From the blog', style: 'h2' } },
            {
              type: 'cards',
              props: {
                source: 'collection',
                collection: '',
                count: 3,
                columns: '3',
                style: 'raised',
                imagePosition: 'top',
                ratio: '16/9',
                radius: 'md',
                wholeCardLinks: true,
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'blog-titled-with-link',
    category: 'blog',
    label: 'Title, posts and a link to all',
    description: 'A heading, three posts, and a way through to the rest of them.',
    rows: [
      {
        widths: [2, 1],
        gap: 32,
        align: 'centre',
        columns: [
          [{ type: 'heading', props: { html: 'Travel notes', style: 'h2' } }],
          [
            {
              type: 'button-group',
              props: { align: 'right', buttons: [{ label: 'All posts', href: '', variant: 'ghost' }] },
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
                source: 'collection',
                collection: '',
                count: 3,
                columns: '3',
                style: 'bordered',
                imagePosition: 'top',
                ratio: '16/9',
                radius: 'md',
                wholeCardLinks: true,
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'blog-four-up',
    category: 'blog',
    label: 'Four posts, tighter',
    description: 'More posts, smaller cards. For a page that is mostly the blog.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Recent writing', style: 'h2', ...CENTRED } },
            {
              type: 'cards',
              props: {
                source: 'collection',
                collection: '',
                count: 4,
                columns: '4',
                gap: 's',
                style: 'bordered',
                imagePosition: 'top',
                ratio: '4/3',
                radius: 'sm',
                wholeCardLinks: true,
              },
            },
          ],
        ],
      },
    ],
  },

  {
    id: 'blog-list-no-pictures',
    category: 'blog',
    label: 'A plain list of posts',
    description: 'No pictures, just titles and summaries. Quick to read, quick to load.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Everything we have written', style: 'h2' } },
            {
              type: 'cards',
              props: {
                source: 'collection',
                collection: '',
                count: 6,
                columns: '2',
                style: 'plain',
                imagePosition: 'none',
                wholeCardLinks: true,
              },
            },
          ],
        ],
      },
    ],
  },

  /*
   * ---------------------------------------------------------------------------
   * Banner
   * ---------------------------------------------------------------------------
   *
   * A thin strip that says one thing: an offer closing, a new brochure, a change
   * to opening hours. Short by design, and toned so it reads as an announcement
   * rather than as part of the page.
   *
   * NOT THE POPUP WIDGET, and worth saying because they get confused. A banner is
   * content IN the page that a client edits like any other section. The popup is
   * a widget that floats over every page and is configured somewhere else.
   */
  {
    id: 'banner-line',
    category: 'banner',
    label: 'One line and a button',
    description: 'The whole point of a banner. Resist putting a paragraph in it.',
    rows: [
      {
        widths: [3, 1],
        gap: 24,
        align: 'centre',
        columns: [
          [
            {
              type: 'text',
              props: { html: '<p><strong>Book by 31 August</strong> and the deposit is half price on selected holidays.</p>' },
            },
          ],
          [
            {
              type: 'button-group',
              props: { align: 'right', buttons: [{ label: 'See which ones', href: '', variant: 'primary' }] },
            },
          ],
        ],
      },
    ],
    section: { tone: 'accent', paddingY: 24 },
  },

  {
    id: 'banner-centred',
    category: 'banner',
    label: 'Centred announcement',
    description: 'A single sentence across the page, with the link inside it.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            {
              type: 'text',
              props: { html: '<p>Our new winter sun brochure is out. <a href="">Ask for a copy</a>.</p>', ...CENTRED },
            },
          ],
        ],
      },
    ],
    section: { tone: 'dark', paddingY: 20 },
  },

  {
    id: 'banner-with-heading',
    category: 'banner',
    label: 'A heading and a line',
    description: 'A little more room, for something that needs a moment of attention.',
    rows: [
      {
        widths: [2, 1],
        gap: 32,
        align: 'centre',
        columns: [
          [
            { type: 'heading', props: { html: 'The shop is closed on Monday', style: 'h4' } },
            {
              type: 'text',
              props: { html: '<p>We are away at a trade show. Email or leave a message and we will come back to you Tuesday.</p>', size: 's' },
            },
          ],
          [
            {
              type: 'button-group',
              props: { align: 'right', buttons: [{ label: 'Email us', href: '', variant: 'secondary' }] },
            },
          ],
        ],
      },
    ],
    section: { tone: 'accent', paddingY: 32 },
  },

  /*
   * ---------------------------------------------------------------------------
   * Designed sections, 27 Aug 2026
   * ---------------------------------------------------------------------------
   *
   * Andy asked to raise the CRAFT of the library, not just its count: a handful
   * of ready-composed bands a travel operator reaches for and drops in finished,
   * rather than a single title or a bare card grid to assemble. Each is more than
   * one element working together, each is in the brand voice and rewords cleanly,
   * and none bakes in a picture or a regulated claim: a protection line is a
   * PROMPT ("say how you are protected"), never an asserted "ATOL protected" the
   * client might not be able to stand behind.
   *
   * They sit in existing categories, so they appear on the right tab with no
   * plumbing; the picker groups by category, not by position in this array.
   */

  {
    id: 'cta-phone',
    category: 'cta',
    label: 'Talk to a real person',
    description: 'A warm closing band with your phone number front and centre.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Would you rather just talk it through?', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>No call centre and no script. You get somebody who knows the places and can start on it there and then.</p>',
                size: 'l',
                ...CENTRED,
              },
            },
            { type: 'heading', props: { html: '01234 567 890', style: 'h3', level: 'h3', ...CENTRED } },
            {
              type: 'button-group',
              props: {
                align: 'centre',
                buttons: [{ label: 'Send an enquiry instead', href: '', variant: 'secondary' }],
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'accent', paddingY: 80 },
  },

  {
    id: 'features-reassurance',
    category: 'features',
    label: 'Why book with us, four reasons',
    description: 'A reassurance band: four short reasons with icons, under one line.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'Why people book with us', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: {
                html: '<p>The things that are easy to say and harder to do, kept to the ones you can stand behind.</p>',
                ...CENTRED,
              },
            },
          ],
        ],
      },
      {
        widths: [1, 1, 1, 1],
        gap: 32,
        columns: [
          [{ type: 'icon-item', props: { icon: 'phone', title: 'A real person', body: 'One number, and somebody who already knows your trip on the end of it.', ...CENTRED } }],
          [{ type: 'icon-item', props: { icon: 'compass', title: 'Been there', body: 'We send you where we have been, not where the screen ranks highest.', ...CENTRED } }],
          [{ type: 'icon-item', props: { icon: 'circle-check', title: 'Nothing hidden', body: 'The price you see is the price, with what is in it written down.', ...CENTRED } }],
          [{ type: 'icon-item', props: { icon: 'heart', title: 'Looked after', body: 'One number to ring while you are away, answered by us.', ...CENTRED } }],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'features-included',
    category: 'features',
    label: 'What is included, and what to know',
    description: 'Two plain columns: what is in the price, and what is worth knowing.',
    rows: [
      {
        widths: [1],
        columns: [[{ type: 'heading', props: { html: 'What is included', style: 'h2', ...CENTRED } }]],
      },
      {
        widths: [1, 1],
        gap: 32,
        columnBox: [CARD_ROOMY, CARD_ROOMY],
        columns: [
          [
            { type: 'heading', props: { html: 'In the price', style: 'h4' } },
            {
              type: 'list',
              props: {
                style: 'tick',
                items: [
                  { text: 'Flights and airport transfers' },
                  { text: 'Your rooms, chosen for the spot not the star rating' },
                  { text: 'A day by day plan you can change' },
                  { text: 'One number to ring the whole time you are away' },
                ],
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'Good to know', style: 'h4' } },
            {
              type: 'list',
              props: {
                style: 'bullet',
                items: [
                  { text: 'Deposit now, the balance twelve weeks before you fly' },
                  { text: 'Travel insurance is yours to arrange, and we will remind you' },
                  { text: 'Anything not listed here, ask, and we will say plainly' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { tone: 'subtle' },
  },

  {
    id: 'steps-plan-trip',
    category: 'steps',
    label: 'How we plan your trip, with a title',
    description: 'A short intro, four steps across, then somewhere to start.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'heading', props: { html: 'How we plan your trip', style: 'h2', ...CENTRED } },
            {
              type: 'text',
              props: { html: '<p>Four steps, and none of them is a form you fill in alone.</p>', ...CENTRED },
            },
          ],
        ],
      },
      {
        widths: [1],
        columns: [
          [
            {
              type: 'steps',
              props: {
                layout: 'across',
                marker: 'number',
                connector: true,
                items: [
                  { title: 'Tell us the shape of it', body: 'Where, roughly when, and what matters most. A call or a few lines.' },
                  { title: 'We put it together', body: 'Flights, rooms, transfers and the bits nobody thinks of until they are missing.' },
                  { title: 'We change it with you', body: 'Nobody gets it right first time, so we expect a second and a third look.' },
                  { title: 'You go', body: 'With one number to ring if anything needs sorting while you are away.' },
                ],
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
              type: 'button-group',
              props: { align: 'centre', buttons: [{ label: 'Start with a conversation', href: '', variant: 'primary' }] },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 88 },
  },

  {
    id: 'stats-proof',
    category: 'stats',
    label: 'A claim over the numbers',
    description: 'One line you can stand behind, then the numbers under it.',
    rows: [
      {
        widths: [1],
        columns: [[{ type: 'heading', props: { html: 'Thirty years, and still the same shop', style: 'h2', ...CENTRED } }]],
      },
      {
        widths: [1],
        columns: [
          [
            {
              type: 'stats',
              props: {
                columns: '4',
                align: 'centre',
                divided: true,
                items: [
                  { value: '30', suffix: ' years', label: 'On the same high street' },
                  { value: '12,000', label: 'Holidays booked' },
                  { value: '4.9', suffix: '/5', label: 'From 800 reviews' },
                  { value: '9', suffix: ' in 10', label: 'Book with us again' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 80 },
  },

  {
    id: 'banner-reassurance',
    category: 'banner',
    label: 'Protected and rated strip',
    description: 'A slim line for your protection, your rating and your hours.',
    rows: [
      {
        widths: [1, 1, 1],
        gap: 24,
        align: 'centre',
        columns: [
          [{ type: 'icon-item', props: { icon: 'circle-check', title: 'Fully protected', body: 'Say how: ABTA, ATOL, a trust account.', ...CENTRED } }],
          [{ type: 'icon-item', props: { icon: 'star', title: 'Rated by travellers', body: 'Name who rates you, and the score.', ...CENTRED } }],
          [{ type: 'icon-item', props: { icon: 'phone', title: 'Here all week', body: 'Your hours, or the number that always answers.', ...CENTRED } }],
        ],
      },
    ],
    section: { tone: 'subtle', paddingY: 32 },
  },
];
