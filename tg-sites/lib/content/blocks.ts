/**
 * The built-in block library.
 *
 * These are the CMS primitives: text, images, video, buttons and so on. They
 * are NOT the Travelgenix widgets. A TG widget will arrive later as a single
 * `widget` block that renders an embed by id, which is why nothing in here
 * knows anything about widgets.
 *
 * This module is DATA ONLY. It is imported by both the server renderer and
 * the client editor, so it must not import React or touch the DOM. The
 * components live in components/render/blocks/.
 *
 * Adding a block type means three things:
 *   1. An entry in BLOCKS below.
 *   2. A component in components/render/blocks.tsx.
 *   3. A case in the switch in components/render/BlockRenderer.tsx.
 *
 * Add a test alongside if the block has non-trivial props.
 */
import type { IconName } from '../../components/editor/Icon';
import { summariseImported } from './imported';
import { SOCIAL_OPTIONS } from './social';
import { WIDGET_KINDS } from './widgets';

// ---------------------------------------------------------------------------
// Editor field definitions
// ---------------------------------------------------------------------------

export type SelectOption = { value: string; label: string };

/**
 * Which collapsible section of the properties pane a field belongs to.
 *
 * The pane groups a block's settings the way the section pane already groups a
 * section's, Content first and open and the rest shut. A field with no group is
 * Content, so a block nobody has grouped yet is one open Content section, which
 * is what it always was. Added 5 Aug 2026.
 */
export type FieldGroup = 'content' | 'colours' | 'border' | 'spacing' | 'layout' | 'effects';

export type Field = { group?: FieldGroup } & (
  | { kind: 'text'; key: string; label: string; placeholder?: string; max?: number; help?: string }
  | { kind: 'textarea'; key: string; label: string; rows?: number; max?: number; help?: string }
  | { kind: 'richtext'; key: string; label: string; help?: string }
  | { kind: 'url'; key: string; label: string; placeholder?: string; help?: string }
  /*
   * `focus` turns on the image editor, the focus point and the adjustments,
   * beside the chooser. Only the image block sets it: a gallery tile, a logo or
   * a background is a picture too, but not one a client sets a focus point on
   * from here, so they get the plain chooser. Set where the block that owns the
   * five props is, so the button and the props it writes cannot drift apart.
   */
  | { kind: 'image'; key: string; label: string; help?: string; focus?: boolean; crop?: boolean }
  /*
   * Four corner radii in pixels, linked or each on its own, the way the padding
   * box does the four sides. Its value is a { tl, tr, br, bl } object. The image
   * block uses it to override the named Corners preset with exact per-corner
   * rounding, which is what a client asks for when one corner is meant to be
   * square and the rest round.
   */
  | { kind: 'corners'; key: string; label: string; help?: string }
  /*
   * An icon from the library. Stores a NAME, not markup, and the field also
   * accepts a typed character so that every page built before the library
   * existed keeps drawing what it drew. See lib/content/icons.ts.
   */
  | { kind: 'icon'; key: string; label: string; help?: string }
  /*
   * A colour, chosen from the site's own theme or as a plain hex.
   *
   * Stores what the text toolbar stores: a `var(--tgs-token)` from the theme or
   * a `#hex`, both of which safeColour (lib/content/schema.ts) validates on the
   * way out, so a block colour is never a free-text style attribute. Empty means
   * "leave it to the theme", which is the honest default for a colour nobody has
   * overridden. Added 3 Aug 2026 so the icon and the words in a block can be
   * coloured, which no block field could do before.
   */
  | { kind: 'colour'; key: string; label: string; help?: string }
  | { kind: 'select'; key: string; label: string; options: SelectOption[]; help?: string }
  | { kind: 'toggle'; key: string; label: string; help?: string }
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; help?: string }
  | { kind: 'repeater'; key: string; label: string; itemLabel: string; max?: number; fields: Field[]; help?: string }
  /*
   * The editable slots of an imported design.
   *
   * THE ONLY FIELD WHOSE SHAPE IS NOT KNOWN HERE. Every other kind describes
   * one named prop, because a block's props are decided when the block is
   * written. An import's slots are decided by the design somebody pasted, so
   * this says "draw the slots this block has" and the pane reads them off
   * props.fields. See lib/content/imported.ts.
   */
  | { kind: 'imported'; key: string; label: string; help?: string }
);

export type BlockGroup = 'Text' | 'Media' | 'Actions' | 'Layout' | 'Advanced';

export interface BlockDefinition {
  type: string;
  label: string;
  group: BlockGroup;
  /** Icon shown in the block picker and the outline. */
  icon: IconName;
  description: string;
  defaults: Record<string, unknown>;
  fields: Field[];
  /** One-line label for the outline tree, derived from current props. */
  summarise?: (props: Record<string, unknown>) => string;
  /**
   * True when the block's content should only ever be authored by
   * Travelgenix staff. The spec gates arbitrary code injection to staff and
   * the editor greys these out for client roles.
   */
  staffOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Shared option sets
// ---------------------------------------------------------------------------

const ALIGN_OPTIONS: SelectOption[] = [
  { value: 'left', label: 'Left' },
  { value: 'centre', label: 'Centre' },
  { value: 'right', label: 'Right' },
];

/**
 * A shadow behind a heading, so it stays legible over a photograph.
 *
 * Andy asked for this on 4 Aug 2026: headings were getting lost on images.
 * HEADINGS ONLY, not paragraphs, which is why the Text block scopes it to its
 * own h1-h6 rather than the whole block. Two strengths and off, a closed set,
 * the same shape as every other select so nothing free reaches the CSS.
 */
const SHADOW_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'None' },
  { value: 'soft', label: 'Soft' },
  { value: 'strong', label: 'Strong' },
];

const SPACING_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'None' },
  { value: 'xs', label: 'Extra small' },
  { value: 's', label: 'Small' },
  { value: 'm', label: 'Medium' },
  { value: 'l', label: 'Large' },
  { value: 'xl', label: 'Extra large' },
];

const RATIO_OPTIONS: SelectOption[] = [
  { value: 'auto', label: 'Original' },
  { value: '16/9', label: 'Widescreen 16:9' },
  { value: '4/3', label: 'Landscape 4:3' },
  { value: '1/1', label: 'Square' },
  { value: '3/4', label: 'Portrait 3:4' },
];

const RADIUS_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'Square' },
  { value: 'sm', label: 'Slightly rounded' },
  { value: 'md', label: 'Rounded' },
  { value: 'lg', label: 'Very rounded' },
  { value: 'full', label: 'Circle' },
];

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

export const BLOCKS: readonly BlockDefinition[] = [
  // --- Text -------------------------------------------------------------
  {
    type: 'heading',
    label: 'Heading',
    group: 'Text',
    icon: 'heading',
    description: 'A section or sub-section title.',
    /*
     * `html`, not `text`, since 31 Jul 2026.
     *
     * A heading used to hold a plain string, which is why the formatting toolbar
     * was kept away from it: bold inside one could not have survived a save.
     * Andy asked for the toolbar on every style of text, so a heading holds
     * markup now. Only INLINE markup: see the 'heading' mode in sanitise.ts for
     * why a list inside an h2 is not a styling choice but a layout bug.
     *
     * A heading written before that has its words in `text`, and upgradeBlock in
     * schema.ts moves them across on the way in, so nothing here has to carry a
     * fallback and no page needs rewriting in the database.
     */
    defaults: { html: 'A new heading', level: 'h2', style: 'h3', align: 'left', shadow: 'none' },
    summarise: (props) =>
      firstWords(stripTags(asString(props.html)), 6) || asString(props.text) || 'Heading',
    fields: [
      { kind: 'richtext', key: 'html', label: 'Text' },
      {
        kind: 'select',
        key: 'level',
        label: 'Level',
        // No h1. The page title owns the single h1, so a client cannot
        // produce two of them or skip a level.
        options: [
          { value: 'h2', label: 'Heading 2' },
          { value: 'h3', label: 'Heading 3' },
          { value: 'h4', label: 'Heading 4' },
        ],
        help: 'The page title is the h1, so headings start at level 2.',
      },
      {
        kind: 'select',
        key: 'style',
        label: 'Style',
        /*
         * The seven text styles from the theme, minus paragraph.
         *
         * These are APPEARANCE, and the Level field above is the tag. Keeping
         * them separate is what lets a section open with H1-sized text while
         * still being an h2 in the markup, so a page has exactly one h1 without
         * every large heading having to be it.
         *
         * Named H1 to H6 because that is what everybody already calls them, and
         * because it matches the Type panel on the theme screen where the
         * client set what each one looks like.
         */
        options: [
          { value: 'h1', label: 'H1, the largest' },
          { value: 'h2', label: 'H2' },
          { value: 'h3', label: 'H3' },
          { value: 'h4', label: 'H4' },
          { value: 'h5', label: 'H5' },
          { value: 'h6', label: 'H6, the smallest' },
        ],
        help: 'How it looks, set on the Theme screen. The Level above is the tag.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS },
      {
        kind: 'select',
        key: 'shadow',
        label: 'Shadow',
        options: SHADOW_OPTIONS,
        help: 'A shadow behind the heading, so it stays readable over a picture.',
      },
    ],
  },
  {
    type: 'text',
    label: 'Text',
    group: 'Text',
    icon: 'text',
    description: 'A paragraph or a few. Bold, italics, links and lists.',
    defaults: {
      html: '<p>Write something here. Keep it plain and say the useful thing first.</p>',
      align: 'left',
      size: 'm',
      shadow: 'none',
    },
    summarise: (props) => firstWords(stripTags(asString(props.html)), 6) || 'Text',
    fields: [
      { kind: 'richtext', key: 'html', label: 'Content' },
      {
        kind: 'select',
        key: 'size',
        label: 'Size',
        options: [
          { value: 's', label: 'Small' },
          { value: 'm', label: 'Normal' },
          { value: 'l', label: 'Large' },
        ],
      },
      {
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        group: 'colours',
        help: 'The colour of the words in this block. Leave blank to follow the theme.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS, group: 'layout' },
      {
        kind: 'select',
        key: 'shadow',
        label: 'Heading shadow',
        options: SHADOW_OPTIONS,
        group: 'effects',
        help: 'A shadow behind any headings here, so they stay readable over a picture. Paragraphs are left alone.',
      },
    ],
  },
  {
    type: 'quote',
    label: 'Quote',
    group: 'Text',
    icon: 'quote',
    description: 'A pulled-out quotation with an attribution.',
    defaults: { text: 'Something worth repeating.', attribution: '', role: '' },
    summarise: (props) => firstWords(asString(props.text), 5) || 'Quote',
    fields: [
      { kind: 'textarea', key: 'text', label: 'Quote', rows: 3, max: 500 },
      { kind: 'text', key: 'attribution', label: 'Who said it', max: 80 },
      { kind: 'text', key: 'role', label: 'Their role', max: 80 },
      { kind: 'colour', key: 'textColour', label: 'Text colour', help: 'Colours the quotation. Blank follows the section.' },
    ],
  },
  {
    type: 'list',
    label: 'List',
    group: 'Text',
    icon: 'list',
    description: 'Bulleted, numbered or ticked points.',
    defaults: {
      style: 'bullet',
      items: [{ text: 'First point' }, { text: 'Second point' }, { text: 'Third point' }],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `List (${count} item${count === 1 ? '' : 's'})`;
    },
    fields: [
      {
        kind: 'select',
        key: 'style',
        label: 'Style',
        options: [
          { value: 'bullet', label: 'Bullets' },
          { value: 'number', label: 'Numbers' },
          { value: 'tick', label: 'Ticks' },
        ],
      },
      {
        kind: 'repeater',
        key: 'items',
        label: 'Items',
        itemLabel: 'Item',
        max: 20,
        fields: [{ kind: 'text', key: 'text', label: 'Text', max: 200 }],
      },
    ],
  },
  {
    type: 'icon-item',
    label: 'Icon and text',
    group: 'Text',
    icon: 'sparkle',
    description: 'An icon with a short title and a line of copy.',
    /*
     * A REAL ICON BY DEFAULT since 1 Aug 2026. This used to be a star typed as
     * a character, which is the practice the note at the top of Icon.tsx bans
     * in our own interface and which was left in the client's content.
     */
    defaults: { icon: 'sparkles', title: 'A benefit', body: 'One sentence on why it matters.', align: 'left' },
    summarise: (props) => asString(props.title) || 'Icon and text',
    fields: [
      {
        kind: 'icon',
        key: 'icon',
        label: 'Icon',
        help: 'Pick one, or type an emoji if you would rather.',
      },
      { kind: 'text', key: 'title', label: 'Title', max: 80 },
      { kind: 'textarea', key: 'body', label: 'Body', rows: 3, max: 300 },
      /*
       * ADDED 1 AUG 2026, and it should have been here from the start. Four
       * designed sections were already setting `align: 'centre'` on this block:
       * the prop was carried through, ignored by the renderer, and drawn
       * centred in the picker's thumbnail. Centred puts the icon ABOVE the
       * words rather than beside them, which is what a row of three points
       * under a centred heading wants.
       */
      {
        kind: 'select',
        key: 'align',
        label: 'Alignment',
        options: ALIGN_OPTIONS,
        help: 'Centred puts the icon above the words rather than beside them.',
      },
      {
        kind: 'colour',
        key: 'iconColour',
        label: 'Icon colour',
        help: 'Left blank the icon follows the section, brand by default.',
      },
      {
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        help: 'Colours the title and body together. Blank follows the section.',
      },
    ],
  },

  {
    /*
     * PANELS THAT OPEN AND CLOSE, WITH NO JAVASCRIPT.
     *
     * `details` and `summary`, which the browser opens, closes, focuses and
     * announces by itself. Same argument as the Menu block, and the same reason
     * it matters: the render tree ships no bundle at all, so a scripted
     * accordion would be the one thing on a client's page that needs
     * JavaScript before it can be read.
     *
     * NOT THE FAQ WIDGET. That is questions and answers, configured in the
     * widgets dashboard and reusable across sites. This is arbitrary page
     * content: what is included, the itinerary day by day, the small print.
     * Different jobs, and a client should not have to open another product to
     * fold up three paragraphs.
     */
    type: 'accordion',
    label: 'Accordion',
    group: 'Text',
    icon: 'accordion',
    description: 'Headings that open to show what is under them.',
    defaults: {
      style: 'separated',
      single: true,
      openFirst: false,
      items: [
        { title: "What's included", body: 'Flights, transfers and seven nights bed and breakfast.' },
        { title: "What's not", body: 'Travel insurance, and anything you buy while you are there.' },
        { title: 'How to book', body: 'Call us, or send an enquiry and we will call you.' },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Accordion (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Sections',
        itemLabel: 'Section',
        max: 20,
        fields: [
          { kind: 'text', key: 'title', label: 'Heading', max: 200 },
          { kind: 'textarea', key: 'body', label: 'Text', rows: 4, max: 2000 },
        ],
      },
      {
        kind: 'select',
        key: 'style',
        label: 'Style',
        options: [
          { value: 'plain', label: 'Plain' },
          { value: 'ruled', label: 'Ruled' },
          { value: 'separated', label: 'Separate boxes' },
        ],
      },
      {
        kind: 'toggle',
        key: 'single',
        label: 'Only one open at a time',
        help: 'Opening one closes the last. Older browsers let both stay open, which is no worse.',
      },
      { kind: 'toggle', key: 'openFirst', label: 'Open the first one to start' },
    ],
  },
  {
    /*
     * THE SAME CONTENT, SIDE BY SIDE INSTEAD OF STACKED, AND STILL NO JAVASCRIPT.
     *
     * Real ARIA tabs need a script: arrow-key roving focus, aria-selected,
     * aria-controls. This is hidden radio buttons and their labels instead, which
     * the browser already gives arrow-key movement, already groups, and already
     * announces ("Overview, radio button, 1 of 3, selected"). It is not a
     * tablist and it does not claim to be one, which is the honest trade: a
     * `role="tablist"` with none of the behaviour behind it would be worse for a
     * screen reader than plain radios that work.
     *
     * See the CSS in globals.css for why the radios sit as siblings of the
     * panels, and lib/content/blocks.ts's cap of eight for why there are exactly
     * eight rules there.
     */
    type: 'tabs',
    label: 'Tabs',
    group: 'Text',
    icon: 'tabs',
    description: 'A few panels of text with a row of headings to pick between them.',
    defaults: {
      style: 'underline',
      align: 'left',
      items: [
        { title: 'Overview', body: 'A week in the Cyclades, at a pace you set yourself.' },
        { title: 'Day by day', body: 'Two nights on Paros, three on Naxos, two back in Athens.' },
        { title: 'Getting there', body: 'Direct from Manchester and Gatwick, then the fast ferry.' },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Tabs (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Tabs',
        itemLabel: 'Tab',
        // EIGHT, and the number is load-bearing. The panels are shown by eight
        // hand-written CSS rules, one per position, so a ninth tab would have a
        // heading nobody could open. See the note above those rules.
        max: 8,
        fields: [
          { kind: 'text', key: 'title', label: 'Heading', max: 60 },
          { kind: 'textarea', key: 'body', label: 'Text', rows: 5, max: 2000 },
        ],
      },
      {
        kind: 'select',
        key: 'style',
        label: 'Style',
        options: [
          { value: 'underline', label: 'Underlined' },
          { value: 'pills', label: 'Pills' },
          { value: 'boxed', label: 'Boxed' },
        ],
      },
      { kind: 'select', key: 'align', label: 'Headings', options: ALIGN_OPTIONS },
    ],
  },

  // --- Media ------------------------------------------------------------
  {
    type: 'image',
    label: 'Image',
    group: 'Media',
    icon: 'image',
    description: 'A picture, with the alt text search engines and screen readers need.',
    /*
     * width and height are RECORDED, NOT EDITED. They are facts about the file,
     * written by the picker when a picture is chosen, and they exist so the
     * renderer can reserve the right space before the image loads. There is no
     * field for them below and there should not be: a client typing a wrong
     * number would make the page jump rather than stop it.
     *
     * focusX, focusY and the three adjustments are SET IN THE IMAGE EDITOR, not
     * by a field either. Focus is a percentage across and down, so 50/50 is the
     * middle, and it is what the picture crops around when a shape crops it.
     * Brightness, contrast and saturation are percentages where 100 is the
     * photograph untouched. All five are edited by clicking and dragging in the
     * editor rather than typed, and the renderer clamps them, so there is no
     * field and nothing to sanitise on the way in beyond the numbers the render
     * already pins to their range.
     */
    defaults: {
      src: '', alt: '', ratio: 'auto', fit: 'cover', radius: 'md', caption: '', href: '', width: 0, height: 0,
      focusX: 50, focusY: 50, brightness: 100, contrast: 100, saturation: 100,
      crop: { x: 0, y: 0, w: 100, h: 100, aspect: 0 },
      corners: { tl: 0, tr: 0, br: 0, bl: 0 },
      borderWidth: 0, borderStyle: 'solid', borderColour: '',
      slides: [], transition: 'fade', interval: 5, arrows: true, dots: true,
    },
    summarise: (props) => {
      const extra = Array.isArray(props.slides) ? props.slides.length : 0;
      if (extra > 0) return `Slideshow (${extra + 1})`;
      return asString(props.alt) || asString(props.caption) || 'Image';
    },
    fields: [
      { kind: 'image', key: 'src', label: 'Image', focus: true, crop: true },
      {
        kind: 'text',
        key: 'alt',
        label: 'Alt text',
        max: 200,
        help: 'Describe the picture for anyone who cannot see it. Leave blank only if it is purely decorative.',
      },
      { kind: 'select', key: 'ratio', label: 'Shape', options: RATIO_OPTIONS },
      {
        kind: 'select',
        key: 'fit',
        label: 'Fit',
        options: [
          { value: 'cover', label: 'Fill the shape (may crop)' },
          { value: 'contain', label: 'Fit inside (no crop)' },
        ],
      },
      { kind: 'select', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS, group: 'border' },
      {
        kind: 'corners',
        key: 'corners',
        label: 'Custom corners',
        group: 'border',
        help: 'Rounds each corner by an exact amount, overriding the preset above. Leave at 0 to keep the preset.',
      },
      { kind: 'number', key: 'borderWidth', label: 'Border width', min: 0, max: 40, step: 1, group: 'border' },
      {
        kind: 'select',
        key: 'borderStyle',
        label: 'Border style',
        group: 'border',
        options: [
          { value: 'solid', label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ],
      },
      { kind: 'colour', key: 'borderColour', label: 'Border colour', group: 'border' },
      { kind: 'text', key: 'caption', label: 'Caption', max: 200 },
      { kind: 'url', key: 'href', label: 'Links to', placeholder: 'https://' },
      /*
       * ADD MORE IMAGES AND THE BLOCK BECOMES A SLIDESHOW. Andy, 4 Aug 2026.
       * Empty, it is the single picture above with all its focus, crop and frame
       * tools. With even one more, it auto-plays through the lot. The transition,
       * the speed and the arrows and dots ride below, and matter only once there
       * is more than one to move between.
       */
      {
        kind: 'repeater',
        key: 'slides',
        label: 'More images (turns it into a slideshow)',
        itemLabel: 'Slide',
        max: 7,
        fields: [
          // focus, so each slide carries its own Edit button and its own focus
          // point and adjustments, the same as the block's first picture and the
          // gallery's tiles. No crop: a slideshow covers its frame, so a crop
          // rectangle has nothing to act on.
          { kind: 'image', key: 'src', label: 'Image', focus: true },
          { kind: 'text', key: 'alt', label: 'Alt text', max: 200 },
        ],
      },
      {
        kind: 'select',
        key: 'transition',
        label: 'Transition',
        options: [
          { value: 'fade', label: 'Fade' },
          { value: 'slide', label: 'Slide' },
        ],
      },
      { kind: 'number', key: 'interval', label: 'Seconds per slide', min: 2, max: 15, step: 1 },
      { kind: 'toggle', key: 'arrows', label: 'Arrows to move between slides' },
      { kind: 'toggle', key: 'dots', label: 'Dots showing which slide is up' },
    ],
  },
  {
    type: 'video',
    label: 'Video',
    group: 'Media',
    icon: 'video',
    description: 'A YouTube or Vimeo video, or a hosted file.',
    defaults: { url: '', ratio: '16/9', radius: 'md', caption: '' },
    summarise: (props) => asString(props.caption) || 'Video',
    fields: [
      {
        kind: 'url',
        key: 'url',
        label: 'Video link',
        placeholder: 'https://www.youtube.com/watch?v=...',
        help: 'YouTube, Vimeo, or a direct link to an .mp4 file.',
      },
      {
        kind: 'select',
        key: 'ratio',
        label: 'Shape',
        options: RATIO_OPTIONS.filter((option) => option.value !== 'auto'),
      },
      { kind: 'select', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS },
      { kind: 'text', key: 'caption', label: 'Caption', max: 200 },
    ],
  },
  {
    type: 'gallery',
    label: 'Gallery',
    group: 'Media',
    icon: 'gallery',
    description: 'A grid of images.',
    defaults: { columns: '3', gap: 'm', radius: 'md', images: [] },
    summarise: (props) => {
      const count = Array.isArray(props.images) ? props.images.length : 0;
      return `Gallery (${count} image${count === 1 ? '' : 's'})`;
    },
    fields: [
      {
        kind: 'select',
        key: 'columns',
        label: 'Columns',
        options: [
          { value: '2', label: 'Two' },
          { value: '3', label: 'Three' },
          { value: '4', label: 'Four' },
        ],
      },
      { kind: 'select', key: 'gap', label: 'Gap', options: SPACING_OPTIONS },
      { kind: 'select', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS },
      {
        kind: 'repeater',
        key: 'images',
        label: 'Images',
        itemLabel: 'Image',
        max: 24,
        fields: [
          { kind: 'image', key: 'src', label: 'Image', focus: true },
          { kind: 'text', key: 'alt', label: 'Alt text', max: 200 },
        ],
      },
    ],
  },

  {
    /*
     * ONE CARD SHAPE, REPEATED, EDITED AS A LIST.
     *
     * Andy, 31 Jul 2026, on what the block library still needs: this was top of
     * the list after the header, and it is the one that decides whether an
     * imported design is EDITABLE or merely accurate. Relume's blog grids,
     * portfolios, team pages, event listings, job listings and feature grids are
     * all the same pattern underneath: one shape, repeated. Expressed as loose
     * blocks in a row they render correctly and are horrible to change, because
     * adding a seventh card means building a seventh column by hand and matching
     * six other cards' settings from memory. As one block they are a list with an
     * Add button, and the shape is set once for all of them.
     *
     * WHY IT IS NOT JUST COLUMNS. A three-column row of image-plus-heading-plus-
     * text is already possible and always was. What it cannot do is stay
     * consistent: the pictures end up different heights, the padding drifts, and
     * reordering means dragging blocks between columns. A card grid trades some
     * freedom for the thing a grid is actually for.
     *
     * SO THE FIELDS ARE DELIBERATELY FEW. Every one of them is set once and
     * applies to every card. If a design needs one card to differ from the rest,
     * that design wants columns, not a grid, and it still has them.
     */
    type: 'cards',
    label: 'Cards',
    group: 'Media',
    icon: 'cards',
    description: 'A grid of the same shape repeated: destinations, offers, the team.',
    defaults: {
      source: 'typed',
      collection: '',
      count: 6,
      columns: '3',
      gap: 'm',
      style: 'bordered',
      imagePosition: 'top',
      ratio: '4/3',
      radius: 'md',
      align: 'left',
      wholeCardLinks: true,
      items: [
        {
          src: '',
          alt: '',
          label: 'Greece',
          title: 'Island hopping, planned properly',
          body: 'Seven nights across three islands, with the ferries booked for you.',
          linkLabel: 'See the trip',
          linkHref: '',
        },
        {
          src: '',
          alt: '',
          label: 'Italy',
          title: 'The Amalfi coast, slowly',
          body: 'A week between Positano and Ravello, with a driver for the coast road.',
          linkLabel: 'See the trip',
          linkHref: '',
        },
        {
          src: '',
          alt: '',
          label: 'Portugal',
          title: 'Lisbon and the Algarve',
          body: 'Three nights in the city, then four with your feet up by the sea.',
          linkLabel: 'See the trip',
          linkHref: '',
        },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Cards (${count})`;
    },
    fields: [
      {
        /*
         * TYPED IN HERE, OR FED FROM A COLLECTION.
         *
         * The second is the blog: a listing that stays in step with what has
         * been written, rather than a grid somebody has to remember to update
         * every time a post goes out. Same block either way, because it is the
         * same grid, and a client should not have to learn a second one to get
         * their posts on the home page.
         */
        kind: 'select',
        key: 'source',
        label: 'Where the cards come from',
        options: [
          { value: 'typed', label: 'Typed in here' },
          { value: 'collection', label: 'From a collection' },
        ],
      },
      {
        kind: 'text',
        key: 'collection',
        label: 'Which collection',
        placeholder: 'blog',
        max: 120,
        help: 'The short name from the Collections screen. Only used when the cards come from one.',
      },
      {
        kind: 'number',
        key: 'count',
        label: 'How many',
        min: 1,
        max: 60,
        step: 1,
        help: 'The newest this many. Only used when the cards come from a collection.',
      },
      {
        kind: 'repeater',
        key: 'items',
        label: 'Cards',
        itemLabel: 'Card',
        max: 24,
        fields: [
          { kind: 'image', key: 'src', label: 'Image' },
          {
            kind: 'text',
            key: 'alt',
            label: 'Alt text',
            max: 200,
            help: 'Describe the picture for anyone who cannot see it.',
          },
          {
            kind: 'text',
            key: 'label',
            label: 'Small label',
            max: 60,
            help: 'The line above the title. A destination, a date, a price.',
          },
          { kind: 'text', key: 'title', label: 'Title', max: 120 },
          { kind: 'textarea', key: 'body', label: 'Text', rows: 3, max: 400 },
          { kind: 'text', key: 'linkLabel', label: 'Link text', max: 60 },
          { kind: 'url', key: 'linkHref', label: 'Links to', placeholder: '/greece or https://' },
        ],
      },
      {
        kind: 'select',
        key: 'columns',
        label: 'Across',
        options: [
          { value: '2', label: 'Two' },
          { value: '3', label: 'Three' },
          { value: '4', label: 'Four' },
        ],
        help: 'Fewer on a tablet and one on a phone, automatically.',
      },
      { kind: 'select', key: 'gap', label: 'Space between', options: SPACING_OPTIONS },
      {
        kind: 'select',
        key: 'style',
        label: 'Card style',
        options: [
          { value: 'plain', label: 'Plain' },
          { value: 'bordered', label: 'Outlined' },
          { value: 'raised', label: 'Raised' },
          { value: 'tinted', label: 'Tinted' },
        ],
      },
      {
        kind: 'select',
        key: 'imagePosition',
        label: 'Picture',
        options: [
          { value: 'top', label: 'Above the words' },
          { value: 'left', label: 'Beside the words' },
          { value: 'none', label: 'No pictures' },
        ],
      },
      {
        kind: 'select',
        key: 'ratio',
        label: 'Picture shape',
        // No 'Original' here, unlike the Image block, and that is the point of a
        // grid: pictures of three different heights in one row is the exact mess
        // this block exists to prevent.
        options: RATIO_OPTIONS.filter((option) => option.value !== 'auto'),
      },
      { kind: 'select', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS, group: 'border' },
      {
        kind: 'select',
        key: 'align',
        label: 'Alignment',
        group: 'layout',
        options: ALIGN_OPTIONS.filter((option) => option.value !== 'right'),
      },
      {
        kind: 'toggle',
        key: 'wholeCardLinks',
        label: 'The whole card is clickable',
        help: 'Still one link, so a keyboard tabs through the cards once each.',
      },
    ],
  },

  {
    /*
     * THE SAME CARDS, ON A RAIL THAT SCROLLS SIDEWAYS.
     *
     * A separate block rather than a setting on Cards, because a client looking
     * for a slider looks for the word "slider" and would never find it inside
     * a grid. It shares the drawing though: renderCard is the same function,
     * so a card looks identical whichever of the two it is in and a change to
     * one cannot leave the other behind.
     *
     * NO ARROWS, AND THAT IS A DECISION RATHER THAN AN OMISSION. Arrow buttons
     * need a script to move the rail, and this render tree ships no JavaScript
     * at all, which is the property the whole project is built on. What it does
     * instead is what a modern carousel does anyway: swipe on a phone, trackpad
     * or shift-wheel on a desktop, a real scrollbar, arrow keys once the rail
     * has focus, and Tab through the cards. The next slide always peeks in from
     * the edge so it is obvious there is more. If arrows are ever wanted badly
     * enough to ship a bundle for them, that is a decision to take out loud.
     */
    type: 'slider',
    label: 'Slider',
    group: 'Media',
    icon: 'slider',
    description: 'Cards on a rail. Swipe or scroll sideways through them.',
    defaults: {
      slideWidth: 'medium',
      gap: 'm',
      style: 'bordered',
      ratio: '4/3',
      radius: 'md',
      align: 'left',
      wholeCardLinks: true,
      items: [
        {
          src: '', alt: '', label: 'Greece',
          title: 'Island hopping, planned properly',
          body: 'Seven nights across three islands, with the ferries booked for you.',
          linkLabel: 'See the trip', linkHref: '',
        },
        {
          src: '', alt: '', label: 'Italy',
          title: 'The Amalfi coast, slowly',
          body: 'A week between Positano and Ravello, with a driver for the coast road.',
          linkLabel: 'See the trip', linkHref: '',
        },
        {
          src: '', alt: '', label: 'Portugal',
          title: 'Lisbon and the Algarve',
          body: 'Three nights in the city, then four with your feet up by the sea.',
          linkLabel: 'See the trip', linkHref: '',
        },
        {
          src: '', alt: '', label: 'Spain',
          title: 'Northern Spain by train',
          body: 'San Sebastian, Bilbao and Santander, with no driving at all.',
          linkLabel: 'See the trip', linkHref: '',
        },
        {
          src: '', alt: '', label: 'Croatia',
          title: 'Dalmatia, end to end',
          body: 'Split, Hvar and Dubrovnik, with the ferry times worked out.',
          linkLabel: 'See the trip', linkHref: '',
        },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Slider (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Slides',
        itemLabel: 'Slide',
        max: 30,
        fields: [
          { kind: 'image', key: 'src', label: 'Image' },
          {
            kind: 'text',
            key: 'alt',
            label: 'Alt text',
            max: 200,
            help: 'Describe the picture for anyone who cannot see it.',
          },
          {
            kind: 'text',
            key: 'label',
            label: 'Small label',
            max: 60,
            help: 'The line above the title. A destination, a date, a price.',
          },
          { kind: 'text', key: 'title', label: 'Title', max: 120 },
          { kind: 'textarea', key: 'body', label: 'Text', rows: 3, max: 400 },
          { kind: 'text', key: 'linkLabel', label: 'Link text', max: 60 },
          { kind: 'url', key: 'linkHref', label: 'Links to', placeholder: '/greece or https://' },
        ],
      },
      {
        kind: 'select',
        key: 'slideWidth',
        label: 'Slide width',
        options: [
          { value: 'narrow', label: 'Narrow' },
          { value: 'medium', label: 'Medium' },
          { value: 'wide', label: 'Wide' },
        ],
        help: 'How much of the next one shows depends on this.',
      },
      { kind: 'select', key: 'gap', label: 'Space between', options: SPACING_OPTIONS },
      {
        kind: 'select',
        key: 'style',
        label: 'Card style',
        options: [
          { value: 'plain', label: 'Plain' },
          { value: 'bordered', label: 'Outlined' },
          { value: 'raised', label: 'Raised' },
          { value: 'tinted', label: 'Tinted' },
        ],
      },
      {
        kind: 'select',
        key: 'ratio',
        label: 'Picture shape',
        options: RATIO_OPTIONS.filter((option) => option.value !== 'auto'),
      },
      { kind: 'select', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS },
      {
        kind: 'select',
        key: 'align',
        label: 'Alignment',
        options: ALIGN_OPTIONS.filter((option) => option.value !== 'right'),
      },
      {
        kind: 'toggle',
        key: 'wholeCardLinks',
        label: 'The whole card is clickable',
        help: 'Still one link, so a keyboard tabs through the slides once each.',
      },
    ],
  },

  // --- Actions ----------------------------------------------------------
  {
    type: 'button',
    label: 'Button',
    group: 'Actions',
    icon: 'button',
    description: 'A call to action.',
    defaults: {
      label: 'Enquire',
      href: '',
      variant: 'primary',
      size: 'm',
      align: 'left',
      newTab: false,
    },
    summarise: (props) => asString(props.label) || 'Button',
    fields: [
      { kind: 'text', key: 'label', label: 'Label', max: 60 },
      { kind: 'url', key: 'href', label: 'Links to', placeholder: '/contact or https://' },
      {
        kind: 'select',
        key: 'variant',
        label: 'Style',
        options: [
          { value: 'primary', label: 'Primary' },
          { value: 'secondary', label: 'Secondary' },
          { value: 'ghost', label: 'Text only' },
        ],
      },
      {
        kind: 'select',
        key: 'size',
        label: 'Size',
        options: [
          { value: 's', label: 'Small' },
          { value: 'm', label: 'Medium' },
          { value: 'l', label: 'Large' },
        ],
      },
      { kind: 'colour', key: 'colour', label: 'Button colour', group: 'colours', help: 'Fills the button. Blank uses the style above.' },
      { kind: 'colour', key: 'textColour', label: 'Label colour', group: 'colours', help: 'The words on it. Blank follows the style.' },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS, group: 'layout' },
      { kind: 'toggle', key: 'newTab', label: 'Open in a new tab' },
    ],
  },
  {
    type: 'button-group',
    label: 'Button group',
    group: 'Actions',
    icon: 'buttons',
    description: 'Two or more buttons side by side.',
    defaults: {
      align: 'left',
      buttons: [
        { label: 'Enquire', href: '', variant: 'primary', newTab: false },
        { label: 'Read more', href: '', variant: 'secondary', newTab: false },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.buttons) ? props.buttons.length : 0;
      return `Buttons (${count})`;
    },
    fields: [
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS },
      {
        kind: 'repeater',
        key: 'buttons',
        label: 'Buttons',
        itemLabel: 'Button',
        max: 4,
        fields: [
          { kind: 'text', key: 'label', label: 'Label', max: 60 },
          { kind: 'url', key: 'href', label: 'Links to' },
          {
            kind: 'select',
            key: 'variant',
            label: 'Style',
            options: [
              { value: 'primary', label: 'Primary' },
              { value: 'secondary', label: 'Secondary' },
              { value: 'ghost', label: 'Text only' },
            ],
          },
          {
            kind: 'select',
            key: 'size',
            label: 'Size',
            options: [
              { value: 's', label: 'Small' },
              { value: 'm', label: 'Medium' },
              { value: 'l', label: 'Large' },
            ],
          },
          { kind: 'colour', key: 'colour', label: 'Button colour', help: 'Fills this button. Blank uses the style.' },
          { kind: 'colour', key: 'textColour', label: 'Label colour', help: 'The words on it. Blank follows the style.' },
          { kind: 'toggle', key: 'newTab', label: 'New tab' },
        ],
      },
    ],
  },

  {
    /*
     * THE MENU.
     *
     * Added 31 Jul 2026 with the header and the footer, and it only makes sense
     * alongside them. A menu block dropped on a single page would be a menu on
     * that page alone, which is nobody's idea of navigation. Put in the header,
     * which is one document drawn on every page, the links are edited once and
     * change everywhere, so there is no separate menu manager to keep in step
     * with anything. That is the entire reason there is no menus screen.
     *
     * It sits in Actions rather than a group of its own because that is where
     * links already live, next to Button and Button group.
     */
    type: 'nav',
    label: 'Menu',
    group: 'Actions',
    icon: 'nav',
    description: 'The links across your header, or down your footer.',
    defaults: {
      layout: 'row',
      align: 'left',
      gap: 'm',
      collapse: true,
      items: [
        { label: 'Home', href: '/', newTab: false },
        { label: 'Holidays', href: '/holidays', newTab: false },
        { label: 'About us', href: '/about', newTab: false },
        { label: 'Contact', href: '/contact', newTab: false },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Menu (${count} link${count === 1 ? '' : 's'})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Links',
        itemLabel: 'Link',
        max: 12,
        fields: [
          { kind: 'text', key: 'label', label: 'Label', max: 60 },
          { kind: 'url', key: 'href', label: 'Links to', placeholder: '/about or https://' },
          { kind: 'toggle', key: 'newTab', label: 'New tab' },
        ],
      },
      {
        kind: 'select',
        key: 'layout',
        label: 'Direction',
        options: [
          { value: 'row', label: 'Across' },
          { value: 'column', label: 'Down' },
        ],
        help: 'Across for a header, down for a footer.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS },
      { kind: 'select', key: 'gap', label: 'Space between', options: SPACING_OPTIONS },
      {
        kind: 'toggle',
        key: 'collapse',
        label: 'Menu button on phones',
        help: 'Seven links across a phone do not fit. This tucks them behind a button.',
      },
    ],
  },

  {
    /*
     * NUMBERED STEPS, OR A TIMELINE. The same block either way, because it is
     * the same thing: an ordered list where the order is the point.
     *
     * "How it works" and "day by day" are the two pages every travel site has
     * and neither could be built properly. Cards can fake it and get the two
     * things that matter wrong: a card grid is not an ordered list to anything
     * reading the page, and nothing joins one card to the next, so three steps
     * read as three unrelated boxes.
     *
     * AN `ol`, AND THE NUMBERS COME FROM CSS COUNTERS rather than from stored
     * text. A client who drags step three above step two gets 1, 2, 3 without
     * touching anything, which is the whole reason not to type them in.
     */
    type: 'steps',
    label: 'Steps',
    group: 'Text',
    icon: 'steps',
    description: 'Numbered steps or a day by day timeline, joined up in order.',
    defaults: {
      layout: 'down',
      marker: 'number',
      connector: true,
      items: [
        { title: 'Tell us what you are after', body: 'Roughly where, roughly when, and roughly how many of you.' },
        { title: 'We put something together', body: 'A couple of options, priced, with the reasons we picked them.' },
        { title: 'You say yes', body: 'A deposit holds it and we do the rest.' },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Steps (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Steps',
        itemLabel: 'Step',
        max: 12,
        fields: [
          { kind: 'text', key: 'title', label: 'Title', max: 120 },
          { kind: 'textarea', key: 'body', label: 'What happens', rows: 3, max: 400 },
        ],
      },
      {
        kind: 'select',
        key: 'layout',
        label: 'Direction',
        options: [
          { value: 'down', label: 'Down the page' },
          { value: 'across', label: 'Across the page' },
        ],
        help: 'Down suits a long list. Across suits three or four short ones.',
      },
      {
        kind: 'select',
        key: 'marker',
        label: 'Marker',
        options: [
          { value: 'number', label: 'Numbers' },
          { value: 'dot', label: 'Dots' },
          { value: 'none', label: 'Nothing' },
        ],
      },
      {
        kind: 'toggle',
        key: 'connector',
        label: 'Join them up',
        help: 'A line from one step to the next, so they read as a sequence.',
      },
      { kind: 'colour', key: 'markerColour', label: 'Marker colour', help: 'The numbers or dots. Blank uses your brand colour.' },
      { kind: 'colour', key: 'textColour', label: 'Text colour', help: 'The step titles and text. Blank follows the section.' },
    ],
  },

  {
    /*
     * THE STATS ROW: 20 years, 4.9 out of 5, 12,000 holidays booked.
     *
     * WHAT IT REPLACES. Two designed sections were already faking this with the
     * Icon and text block, one of them using a star and a heart where the number
     * should be, because there was no way to make a figure big. A stat set at
     * body size is not a stat, it is a sentence: the entire point is that the
     * number is the loudest thing in the section and the words underneath
     * explain it.
     *
     * THE FIGURE IS TEXT, NOT A NUMBER, and this is the decision to keep. What
     * an agency actually writes in this slot is "12,000" and "4.9" and "24/7"
     * and "£2m". A number input strips the comma, refuses the slash and cannot
     * hold the pound sign, so it would be wrong for three of those four. A max
     * length keeps the layout honest instead.
     *
     * SO WHY A SEPARATE PREFIX AND SUFFIX, if the figure is free text and could
     * hold them? Because they are set smaller and lighter than the figure. A
     * pound sign or a plus at the full size of a 56px number is the single
     * thing that makes a stats row look homemade, and nobody can fix that by
     * typing.
     */
    type: 'stats',
    label: 'Key numbers',
    group: 'Text',
    icon: 'stats',
    description: 'Big figures with a word under each: years, reviews, holidays booked.',
    defaults: {
      columns: '3',
      size: 'l',
      align: 'centre',
      divided: false,
      items: [
        { value: '20', suffix: '', label: 'Years on the high street', detail: '' },
        { value: '4.9', suffix: '/5', label: 'Average review score', detail: 'Across 300 reviews.' },
        { value: '12,000', suffix: '+', label: 'Holidays booked', detail: '' },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Key numbers (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Numbers',
        itemLabel: 'Number',
        max: 8,
        fields: [
          {
            kind: 'text',
            key: 'value',
            label: 'Figure',
            max: 12,
            help: 'Whatever you would write: 12,000 or 4.9 or 24/7.',
          },
          { kind: 'text', key: 'prefix', label: 'Before it', max: 4, help: 'A £ or a ~, set smaller.' },
          { kind: 'text', key: 'suffix', label: 'After it', max: 8, help: 'A + or a % or /5, set smaller.' },
          { kind: 'text', key: 'label', label: 'What it counts', max: 80 },
          { kind: 'text', key: 'detail', label: 'Detail', max: 120, help: 'Optional, a size smaller again.' },
        ],
      },
      {
        kind: 'select',
        key: 'columns',
        label: 'Across',
        options: [
          { value: '2', label: 'Two' },
          { value: '3', label: 'Three' },
          { value: '4', label: 'Four' },
        ],
      },
      {
        kind: 'select',
        key: 'size',
        label: 'Figure size',
        options: [
          { value: 'm', label: 'Medium' },
          { value: 'l', label: 'Large' },
          { value: 'xl', label: 'Extra large' },
        ],
      },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS },
      {
        kind: 'toggle',
        key: 'divided',
        label: 'Lines between them',
        help: 'A hairline between each one. Suits four across.',
      },
      { kind: 'colour', key: 'figureColour', label: 'Number colour', help: 'The big figures. Blank uses your brand colour.' },
      { kind: 'colour', key: 'textColour', label: 'Label colour', help: 'The words under each figure. Blank follows the section.' },
    ],
  },

  {
    /*
     * THE LOGO STRIP: ABTA, ATOL, IATA, and the operators a shop sells.
     *
     * WHY IT IS NOT THE GALLERY BLOCK, which is the tool a client would reach
     * for today and which gets it wrong twice. A gallery crops every image to
     * one ratio, and logos have no common ratio: ABTA's is wide, ATOL's is
     * near square, an airline's is wider still. Cropped to 4:3 they are
     * mangled, and a mangled trade body logo is worse than none. A gallery also
     * treats them as photographs, in a grid, at whatever size the column gives.
     *
     * SO THE RULE HERE IS A COMMON HEIGHT AND CONTAINED SCALING. Every logo
     * gets the same vertical space and keeps its own width, which is how a
     * strip of badges is meant to sit and the one thing a grid cannot do.
     *
     * IN UK TRAVEL THIS IS NOT DECORATION. An agency displays its ABTA and ATOL
     * membership because that is what tells somebody their money is protected,
     * and until now the whole product could show those two facts only as words
     * in a paragraph.
     */
    type: 'logos',
    label: 'Logo strip',
    group: 'Media',
    icon: 'logos',
    description: 'A row of badges or partner logos, all on a common height.',
    defaults: { height: 'm', gap: 'l', tone: 'colour', align: 'centre', items: [] },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Logo strip (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Logos',
        itemLabel: 'Logo',
        max: 24,
        fields: [
          { kind: 'image', key: 'src', label: 'Logo' },
          {
            kind: 'text',
            key: 'alt',
            label: 'Name',
            max: 200,
            help: 'ABTA, ATOL, the operator. A logo without a name cannot be linked.',
          },
          { kind: 'url', key: 'href', label: 'Link', help: 'Optional. Their site, or your membership page.' },
        ],
      },
      {
        kind: 'select',
        key: 'height',
        label: 'Height',
        options: [
          { value: 's', label: 'Small' },
          { value: 'm', label: 'Medium' },
          { value: 'l', label: 'Large' },
        ],
        help: 'Every logo gets this height and keeps its own width.',
      },
      { kind: 'select', key: 'gap', label: 'Space between', options: SPACING_OPTIONS },
      {
        kind: 'select',
        key: 'tone',
        label: 'Colour',
        options: [
          { value: 'colour', label: 'As they are' },
          { value: 'grey', label: 'Grey' },
          { value: 'grey-hover', label: 'Grey, colour on hover' },
        ],
        help: 'Grey keeps a row of clashing brand colours quiet.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS },
    ],
  },

  {
    /*
     * A ROW OF SOCIAL LINKS, which every footer wants and nothing else here did.
     *
     * NOT THE SOCIAL SHARE WIDGET. That one shares the page somebody is looking
     * at, which is a different job in the opposite direction: this points at
     * accounts you own. A client wanting both wants both.
     *
     * The other three near-misses, and why none of them worked: a Button has no
     * icon, the Icon and text block takes a single emoji and draws it beside a
     * title, and a Menu is words. A row of recognisable marks is its own thing.
     *
     * THE NETWORK IS PICKED FROM A CLOSED LIST and the drawing is entirely ours.
     * See lib/content/social.ts: if a client could supply the picture, this
     * block would be a way to put arbitrary SVG on a page, and SVG carries
     * script. The only client input is an address, and that goes through safeUrl
     * exactly as every other link does.
     */
    type: 'social',
    label: 'Social links',
    group: 'Actions',
    icon: 'social',
    description: 'A row of icons linking to your accounts.',
    defaults: {
      style: 'plain',
      size: 'm',
      align: 'left',
      showLabels: false,
      items: [
        { network: 'facebook', href: '' },
        { network: 'instagram', href: '' },
        { network: 'x', href: '' },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Social links (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Accounts',
        itemLabel: 'Account',
        max: 12,
        fields: [
          { kind: 'select', key: 'network', label: 'Where', options: SOCIAL_OPTIONS },
          {
            kind: 'url',
            key: 'href',
            label: 'Address',
            placeholder: 'https://facebook.com/yourpage',
            help: 'The full address of your page. An email or a phone number works too.',
          },
        ],
      },
      {
        kind: 'select',
        key: 'style',
        label: 'Style',
        options: [
          { value: 'plain', label: 'Plain' },
          { value: 'circle', label: 'In a circle' },
          { value: 'square', label: 'In a square' },
          { value: 'filled', label: 'Filled' },
        ],
      },
      {
        kind: 'select',
        key: 'size',
        label: 'Size',
        options: [
          { value: 's', label: 'Small' },
          { value: 'm', label: 'Normal' },
          { value: 'l', label: 'Large' },
        ],
      },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS },
      {
        kind: 'toggle',
        key: 'showLabels',
        label: 'Show the names',
        help: 'Off is a row of icons. On puts the name beside each one.',
      },
    ],
  },

  {
    /*
     * A TABLE, PASTED RATHER THAN TYPED INTO A NESTED REPEATER.
     *
     * The obvious editor for a table is a repeater of rows each holding a
     * repeater of cells, and it is miserable: adding a column means opening
     * every row and adding a cell to each, in the right position, from memory.
     * A four-by-six table is twenty-four boxes to fill in one at a time.
     *
     * So the whole grid is one box, one row per line. Cells split on a TAB, and
     * a tab is exactly what a spreadsheet puts on the clipboard, so selecting a
     * range in Excel or Sheets and pasting it here just works. A pipe is
     * accepted too, for anybody typing one out by hand.
     *
     * The cost is that a cell cannot contain a line break or a tab. For a
     * comparison table, a price list or a spec, that is not a cost anybody
     * notices; for prose there is the Text block.
     */
    type: 'table',
    label: 'Table',
    group: 'Layout',
    icon: 'table',
    description: 'A grid of figures or facts. Paste it straight from a spreadsheet.',
    defaults: {
      headerRow: true,
      firstColumnHeader: true,
      style: 'lined',
      caption: '',
      data: [
        'Board basis\tSpark\tBoost\tIgnite',
        'Room only\tYes\tYes\tYes',
        'Bed and breakfast\tNo\tYes\tYes',
        'All inclusive\tNo\tNo\tYes',
      ].join('\n'),
    },
    summarise: (props) => {
      const rows = asString(props.data).split('\n').filter((line) => line.trim()).length;
      return `Table (${rows} row${rows === 1 ? '' : 's'})`;
    },
    fields: [
      {
        kind: 'textarea',
        key: 'data',
        label: 'The table',
        rows: 8,
        max: 8000,
        help: 'One row per line. Copy a range from a spreadsheet and paste it here, or type the columns apart with a | between them.',
      },
      {
        kind: 'toggle',
        key: 'headerRow',
        label: 'The first line is the headings',
      },
      {
        kind: 'toggle',
        key: 'firstColumnHeader',
        label: 'The first column is headings too',
        help: 'For a comparison table, where the left column says what each row is.',
      },
      {
        kind: 'select',
        key: 'style',
        label: 'Style',
        options: [
          { value: 'plain', label: 'Plain' },
          { value: 'lined', label: 'Ruled' },
          { value: 'striped', label: 'Banded' },
          { value: 'boxed', label: 'Boxed' },
        ],
      },
      {
        kind: 'text',
        key: 'caption',
        label: 'Caption',
        max: 200,
        help: 'Read out before the table by a screen reader, and shown under it.',
      },
    ],
  },

  // --- Layout -----------------------------------------------------------
  {
    type: 'divider',
    label: 'Divider',
    group: 'Layout',
    icon: 'divider',
    description: 'A horizontal rule.',
    defaults: { style: 'line', spacing: 'm' },
    summarise: () => 'Divider',
    fields: [
      {
        kind: 'select',
        key: 'style',
        label: 'Style',
        options: [
          { value: 'line', label: 'Line' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dots', label: 'Dots' },
        ],
      },
      { kind: 'select', key: 'spacing', label: 'Space around', options: SPACING_OPTIONS },
    ],
  },
  {
    type: 'spacer',
    label: 'Spacer',
    group: 'Layout',
    icon: 'spacer',
    description: 'Empty vertical space.',
    defaults: { height: 'm' },
    summarise: (props) => `Spacer (${asString(props.height) || 'm'})`,
    fields: [
      {
        kind: 'select',
        key: 'height',
        label: 'Height',
        options: SPACING_OPTIONS.filter((option) => option.value !== 'none'),
      },
    ],
  },

  // --- Advanced ---------------------------------------------------------
  {
    /*
     * A TRAVELGENIX WIDGET, PICKED FROM A LIST.
     *
     * Andy, 31 Jul 2026: widgets are what Travelgenix is about, and until this
     * there was no way to put one on a page. Pasting the dashboard's embed
     * snippet into the Embed block below produced a bare <div></div>: the script
     * went, and so did both data attributes.
     *
     * NOT STAFF ONLY, and that is the point of doing it this way. The widget is
     * chosen from lib/content/widgets.ts and the script address is built there,
     * so nothing a client types becomes a URL or code. Same shape as the
     * analytics setting: they give an id, we generate what runs.
     */
    type: 'widget',
    label: 'Travelgenix widget',
    group: 'Advanced',
    icon: 'sparkle',
    description: 'One of your own widgets: offers, reviews, an enquiry form.',
    defaults: { widget: 'hours', widgetId: '' },
    summarise: (props) =>
      WIDGET_KINDS.find((kind) => kind.tag === props.widget)?.label ?? 'Widget',
    fields: [
      {
        kind: 'select',
        key: 'widget',
        label: 'Which widget',
        options: WIDGET_KINDS.map((kind) => ({ value: kind.tag, label: kind.label })),
        help: 'The ones that sit in a column. Site-wide widgets like the cookie banner are not here.',
      },
      {
        kind: 'text',
        key: 'widgetId',
        label: 'Widget ID',
        placeholder: 'tgw_...',
        max: 80,
        help: 'From your widgets dashboard, on the widget you want to show.',
      },
    ],
  },
  {
    /*
     * SOMEBODY ELSE'S WIDGET, IN A SEALED BOX.
     *
     * Andy's requirement alongside the block above: "it's important that a user
     * can place a non-Travelgenix widget as well as our own." Trustpilot, a chat
     * tool, another vendor's booking engine.
     *
     * That means arbitrary third-party script, which is the thing the sanitiser
     * exists to keep off a page. So it does not go on the page: it goes inside a
     * sandboxed iframe at a null origin, where it can draw in its own rectangle
     * and do nothing else. It cannot read the page around it, reach the client's
     * session, or touch another widget.
     *
     * The sealing is what makes this safe enough for a CLIENT rather than
     * staff-only. See components/render/blocks.tsx for the sandbox tokens and
     * the one combination that is deliberately not offered.
     */
    type: 'embed-widget',
    label: 'Embedded widget',
    group: 'Advanced',
    icon: 'code',
    description: "Code from somewhere else, run in a sealed box that cannot reach your page.",
    defaults: { html: '', height: 420, title: '' },
    summarise: (props) => asString(props.title) || 'Embedded widget',
    fields: [
      {
        kind: 'textarea',
        key: 'html',
        label: 'The code they gave you',
        rows: 6,
        max: 20000,
        help: 'Paste it exactly. It runs sealed off from the rest of your page.',
      },
      {
        kind: 'number',
        key: 'height',
        label: 'Height',
        min: 80,
        max: 2000,
        step: 20,
        help: 'A sealed box cannot make the page taller by itself, so tell it how tall to be.',
      },
      {
        kind: 'text',
        key: 'title',
        label: 'What it is',
        placeholder: 'Trustpilot reviews',
        max: 120,
        help: 'Read out by a screen reader, and it names the block in the outline.',
      },
    ],
  },
  {
    type: 'embed',
    label: 'Embed code',
    group: 'Advanced',
    icon: 'code',
    description: 'Raw HTML that runs in the page itself. Travelgenix staff only.',
    staffOnly: true,
    defaults: { html: '' },
    summarise: () => 'Embed code',
    fields: [
      {
        kind: 'textarea',
        key: 'html',
        label: 'HTML',
        rows: 8,
        max: 20000,
        help: 'Sanitised on save and again on render. Scripts and event handlers are stripped.',
      },
    ],
  },
  {
    type: 'imported',
    label: 'Imported design',
    group: 'Advanced',
    icon: 'code',
    /*
     * NOT staffOnly, and that is the point of the whole import pipeline.
     *
     * The embed block above is staff only because it holds markup nobody
     * checks. Everything in this one has been through lib/import: parsed,
     * rebuilt from a tree, and confined to its own section by an ancestor
     * selector. Safe by construction rather than by permission is what lets a
     * client paste their own design in.
     */
    description: 'A design brought in from Relume, Figma or the slicer. Add one from Import.',
    defaults: { html: '', css: '', label: '', fields: [], content: {} },
    summarise: (props) => summariseImported(props),
    fields: [
      /*
       * ONE FIELD THAT STANDS FOR MANY. A design's editable slots are not known
       * until it is imported, so they cannot be listed here the way every other
       * block lists its own. This tells the properties pane to draw whatever
       * slots THIS block turned out to have, from props.fields.
       */
      {
        kind: 'imported',
        key: 'content',
        label: 'Content',
        help: 'The words and pictures from the design. Its layout and styling are kept as they were.',
      },
      { kind: 'text', key: 'label', label: 'Name', max: 60, help: 'What this section is called in the outline.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const BY_TYPE = new Map(BLOCKS.map((definition) => [definition.type, definition]));

export function blockDefinition(type: string): BlockDefinition | undefined {
  return BY_TYPE.get(type);
}

export function isKnownBlock(type: string): boolean {
  return BY_TYPE.has(type);
}

/** A fresh copy of a type's defaults. Deep enough for repeater arrays. */
export function defaultPropsFor(type: string): Record<string, unknown> {
  const definition = BY_TYPE.get(type);
  if (!definition) return {};
  return structuredCloneish(definition.defaults);
}

export const BLOCK_GROUPS: readonly BlockGroup[] = [
  'Text',
  'Media',
  'Actions',
  'Layout',
  'Advanced',
];

/** Blocks grouped for the picker, staff-only ones filtered when not staff. */
export function blocksByGroup(isStaff: boolean): Array<{ group: BlockGroup; blocks: BlockDefinition[] }> {
  return BLOCK_GROUPS.map((group) => ({
    group,
    blocks: BLOCKS.filter(
      (definition) => definition.group === group && (isStaff || !definition.staffOnly),
    ),
  })).filter((entry) => entry.blocks.length > 0);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstWords(text: string, count: number): string {
  const words = text.split(' ').filter(Boolean);
  if (words.length <= count) return words.join(' ');
  return `${words.slice(0, count).join(' ')}…`;
}

/**
 * structuredClone is not available in every runtime this module reaches
 * (older Node in a test harness, some edge runtimes), and the defaults are
 * always plain JSON, so a JSON round trip is both safe and cheaper.
 */
function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
