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
 *
 * ---------------------------------------------------------------------------
 * THE RULE EVERY BLOCK HERE KEEPS: THE PAGE WORKS BEFORE ANY SCRIPT RUNS
 * ---------------------------------------------------------------------------
 *
 * This replaced an absolute ban on 20 Aug 2026 (Andy). The old rule was "a
 * published page ships no JavaScript" and it was the right rule for the year
 * that built these blocks. It is set out here with what changed and why,
 * because a rule this load-bearing must not quietly become a different one.
 *
 * WHAT THE OLD RULE WAS PROTECTING, and still is. Three things: these pages are
 * fast, they work with JavaScript off or blocked, and a crawler sees the same
 * page a visitor does. A blanket ban was the cheapest way to guarantee all
 * three. It also ruled out the motion layer, and motion on a client homepage is
 * a large part of why an agency leaves Duda for us. So the ban is replaced by
 * the thing it was standing in for, in four clauses.
 *
 * 1. A PAGE THAT ASKS FOR NOTHING SHIPS NOTHING. Zero is still the default and
 *    most pages stay there. Every script is conditional on the page actually
 *    using the feature, the way ThemeToggleScript, SlideshowScript and
 *    WidgetScripts already are. A page with no motion, no slideshow, no widget
 *    and no light and dark switch renders exactly the bytes it does today.
 *
 * 2. THE CONTENT NEVER DEPENDS ON A SCRIPT. Every word, picture, link and form
 *    action is in the server-rendered HTML and usable with JavaScript off. A
 *    script may add motion, controls or polish on top of that. It may never be
 *    how the content arrives. This clause is what actually protected the three
 *    properties above, and it is the one to check a new block against.
 *
 * 3. OURS, HAND-WRITTEN, NO LIBRARIES. Not GSAP, not Lenis, not Three.js, not a
 *    Lottie player. Every script we ship is in this repo and reviewable, and it
 *    is why the motion recipes are all vanilla.
 *
 * 4. A NAMED COST AND A PAGE BUDGET. Tier 0 is CSS only and free. Tier 1 is a
 *    few KB and two or three per page is fine. Tier 2 is WebGL, one per page,
 *    maximum. A budget nobody enforces is a wish, so it belongs in a test.
 *
 * Everything already built still keeps the strictest reading, and should: Tabs
 * and Read more use a hidden input and `:checked ~`, Accordion uses <details>,
 * the Slider is scroll-snap, Search is a plain GET form, Copyright is computed
 * on the server. Reach for a script when a block genuinely cannot be done
 * without one, not when it is the first thing that comes to mind.
 *
 * STILL DECIDED AGAINST: LOTTIE (Andy, 20 Aug 2026), and the new rule does not
 * reopen it. A Lottie is a JSON animation plus a ~250KB third-party player, so
 * it fails clause 3 on its own and its weight fails clause 4. It was raised
 * from the Duda element list with three ways forward, load the player only on
 * pages using one, do not do it, or ship it everywhere, and Andy chose not to
 * do it. A client who wants that animation exports it as a looping MP4, which
 * the Video block already plays.
 *
 * REDUCED MOTION IS A SECOND DESIGNED PAGE, never a switch turned off. Ambient
 * loops never start, pinned sections become ordinary stacked ones, rails become
 * swipeable carousels, reveals resolve to their finished state. Every animation
 * in globals.css is already built this way and anything new must be too.
 *
 * This is written down so it is not re-opened by accident. If it ever is
 * re-opened it should be on purpose, with the cost named out loud.
 */
import type { IconName } from '../../components/editor/Icon';
import { summariseImported } from './imported';
import { SOCIAL_OPTIONS } from './social';
import { FONT_CHOICES, FONT_SIZES } from './styles';
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
  /*
   * An address, with matches as you type. Stores the same plain string a text
   * field would; the difference is the control, which searches an open geocoder
   * (see lib/content/geocode.ts) and offers a short menu so a client can see the
   * product found their place. Picking a match, or just typing an address in
   * full, is what sets the value, so the map still reads one address string and
   * nothing about coordinates leaks into the content. Only the map uses it.
   */
  | { kind: 'place'; key: string; label: string; placeholder?: string; max?: number; help?: string }
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
   * A DOCUMENT the client has uploaded, chosen from the file half of the media
   * library. Its own kind rather than an image field with a flag, because what
   * it writes is different: a picture field writes an address and pixel
   * dimensions, this one writes an address, the original filename, the size in
   * bytes and the format's name, so the block can say "Brochure.pdf, PDF, 2.4MB"
   * without a database read per visitor.
   *
   * The three companion keys are named here rather than assumed by convention.
   * The alt convention in the image field above fails softly, which is fine for
   * a description; a file whose size landed in the wrong prop would show the
   * wrong number on a live page, which is not.
   */
  | {
      kind: 'file';
      key: string;
      label: string;
      help?: string;
      nameKey: string;
      sizeKey: string;
      formatKey: string;
    }
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

/**
 * How many columns a grid may be, per screen. Two to six: one is a stack, and
 * past six a cell is too narrow to hold anything on any screen worth the name.
 * Strings because a select's value is a string, and the renderer clamps anyway.
 */
const ACROSS_OPTIONS: SelectOption[] = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: '6', label: '6' },
];

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
    /*
     * fluid: true, so a NEW heading auto-resizes with the screen from the off. Andy,
     * 13 Aug 2026: a client should not have to know to toggle it for a hero heading
     * to fit a phone. The clamp caps at the set size, so desktop is unchanged and
     * only smaller screens scale down, and the toggle is still there to switch it
     * off. Only the block default, so it reaches a heading a client adds, not the
     * headings already stored in a page.
     */
    defaults: { html: 'A new heading', level: 'h2', style: 'h3', align: 'left', shadow: 'none', fluid: true },
    summarise: (props) =>
      firstWords(stripTags(asString(props.html)), 6) || asString(props.text) || 'Heading',
    fields: [
      { kind: 'richtext', key: 'html', label: 'Text' },
      {
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        help: 'The colour of the heading. Leave blank to follow the theme.',
      },
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
      {
        kind: 'toggle',
        key: 'gradient',
        label: 'Animated gradient',
        help: 'Fills the heading with a slow, shifting gradient on the live site. It eases off for anyone who prefers less motion. Set the two colours below, or leave them blank for your brand colours.',
      },
      {
        kind: 'colour',
        key: 'gradientFrom',
        label: 'Gradient colour one',
        group: 'effects',
        help: 'The first colour in the animated gradient. Blank uses your accent colour.',
      },
      {
        kind: 'colour',
        key: 'gradientTo',
        label: 'Gradient colour two',
        group: 'effects',
        help: 'The second colour. Blank uses your brand colour.',
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
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        help: 'The colour of the points. Leave blank to follow the theme.',
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
      textColour: '',
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
      {
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        help: 'The headings and the text inside. Blank follows the section.',
      },
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
      textColour: '',
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
      {
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        help: 'The text inside the panels. Blank follows the section.',
      },
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
    /*
     * A PICTURE BESIDE A TINTED PANEL, AND MORE THAN ONE OF THEM IS A SLIDER.
     *
     * Andy, 20 Aug 2026, from Duda's Half Overlay Slider. Worth being clear why
     * this is a block of its own rather than something a client assembles: a
     * COLUMN CANNOT CARRY A PHOTOGRAPH. A Box has a background colour, a
     * gradient, a radius, a border and a blur, and no picture, so the tinted half
     * — a photo with a colour scrim over it and words on top — has nowhere to
     * live in a two-column row. Section backgrounds can do it, but a section is
     * the whole width, not half of it.
     *
     * IT REUSES THE SLIDESHOW RATHER THAN INVENTING A SECOND ONE. The markup is
     * the same `.tgs-slideshow` wrapper the Image block emits, so it cycles in
     * pure CSS on its own AND public/slideshow.js gives it arrows, dots and a
     * pause button without a line of that file changing. One slide draws a plain
     * static panel with no slideshow chrome, exactly as one picture in an Image
     * block is just a picture.
     */
    type: 'half-overlay',
    label: 'Half overlay',
    group: 'Media',
    icon: 'slider',
    description: 'A picture beside a tinted panel carrying your message. Add more than one and it becomes a slider.',
    defaults: {
      tint: '#2f5bd8',
      tintOpacity: 78,
      height: 'medium',
      transition: 'fade',
      interval: 6,
      arrows: true,
      dots: true,
      items: [
        {
          src: '', alt: '', panelSrc: '', panelAlt: '', side: 'left',
          title: 'Greece, island by island',
          body: 'Seven nights across three islands, with every ferry booked for you and someone to call if the weather turns.',
          primaryLabel: 'See the trip', primaryHref: '',
          secondaryLabel: 'Talk to us', secondaryHref: '',
        },
        {
          src: '', alt: '', panelSrc: '', panelAlt: '', side: 'right',
          title: 'The Amalfi coast, slowly',
          body: 'A week between Positano and Ravello, with a driver for the coast road so nobody has to think about the hairpins.',
          primaryLabel: 'See the trip', primaryHref: '',
          secondaryLabel: 'Talk to us', secondaryHref: '',
        },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return count > 1 ? `Half overlay (${count} slides)` : 'Half overlay';
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Slides',
        itemLabel: 'Slide',
        max: 12,
        fields: [
          { kind: 'image', key: 'src', label: 'Picture' },
          { kind: 'text', key: 'alt', label: 'Picture description', max: 200, help: 'What the picture shows, for a screen reader.' },
          {
            kind: 'image',
            key: 'panelSrc',
            label: 'Picture under the panel',
            help: 'Optional. The tint sits over this. Leave it blank for a plain colour panel.',
          },
          { kind: 'text', key: 'panelAlt', label: 'Panel picture description', max: 200 },
          {
            kind: 'select',
            key: 'side',
            label: 'Picture on the',
            options: [
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ],
            help: 'Alternating them down a page reads well.',
          },
          { kind: 'text', key: 'title', label: 'Title', max: 120 },
          { kind: 'textarea', key: 'body', label: 'Paragraph', rows: 4, max: 600 },
          { kind: 'text', key: 'primaryLabel', label: 'First button', max: 40 },
          { kind: 'url', key: 'primaryHref', label: 'First button links to', placeholder: '/holidays or https://' },
          { kind: 'text', key: 'secondaryLabel', label: 'Second button', max: 40 },
          { kind: 'url', key: 'secondaryHref', label: 'Second button links to', placeholder: '/contact or https://' },
        ],
      },
      {
        kind: 'colour',
        key: 'tint',
        label: 'Panel colour',
        help: 'The wash over the panel picture. Set once here so every slide matches.',
      },
      {
        kind: 'number',
        key: 'tintOpacity',
        label: 'Panel strength',
        min: 40,
        max: 100,
        step: 1,
        help: 'How much of the picture shows through. Below 40 the words stop being readable, so it does not go there.',
      },
      {
        kind: 'select',
        key: 'height',
        label: 'Height',
        options: [
          { value: 'short', label: 'Short' },
          { value: 'medium', label: 'Medium' },
          { value: 'tall', label: 'Tall' },
        ],
      },
      { kind: 'colour', key: 'buttonColour', label: 'Button colour', help: 'The filled button. The second one is an outline of the same colour. Blank uses your theme.' },
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
    /*
     * CARDS THAT OPEN WHEN YOU CLICK THEM (Andy, 20 Aug 2026, from Duda's
     * Travelgenix Expanding Cards).
     *
     * A row of narrow panels, one of them open. Clicking a closed one opens it
     * and closes the other, which is RADIO BUTTON BEHAVIOUR exactly — one of a
     * set, never none — so that is what it is built from. Same trick Tabs uses,
     * and it means a published page still ships no JavaScript for this: the
     * browser does the choosing, the arrow keys work between the cards on their
     * own, and each card is a real form control a screen reader announces.
     */
    type: 'expanding-cards',
    label: 'Expanding cards',
    group: 'Media',
    icon: 'slider',
    description: 'A row of pictures where the one you click opens to show its story.',
    defaults: {
      height: 'medium',
      radius: 'md',
      scrim: '#0d1420',
      scrimStrength: 55,
      items: [
        { src: '', alt: '', title: 'Greece', body: 'Seven nights across three islands, with every ferry booked for you.', linkLabel: 'See the trip', linkHref: '' },
        { src: '', alt: '', title: 'Italy', body: 'A week on the Amalfi coast, with a driver for the coast road.', linkLabel: 'See the trip', linkHref: '' },
        { src: '', alt: '', title: 'Portugal', body: 'Three nights in Lisbon, then four with your feet up in the Algarve.', linkLabel: 'See the trip', linkHref: '' },
        { src: '', alt: '', title: 'Croatia', body: 'Split, Hvar and Dubrovnik, with the ferry times worked out.', linkLabel: 'See the trip', linkHref: '' },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Expanding cards (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Cards',
        itemLabel: 'Card',
        /*
         * SIX, and the number is a design limit rather than a technical one.
         * Every card that is not open is a strip a few centimetres wide with a
         * word down it; past six there is not enough room left for the open one
         * to be worth opening.
         */
        max: 6,
        fields: [
          { kind: 'image', key: 'src', label: 'Picture' },
          { kind: 'text', key: 'alt', label: 'Picture description', max: 200, help: 'What the picture shows, for a screen reader.' },
          { kind: 'text', key: 'title', label: 'Title', max: 60, help: 'Shown down the side of a closed card, so keep it short.' },
          { kind: 'textarea', key: 'body', label: 'Text', rows: 3, max: 400 },
          { kind: 'text', key: 'linkLabel', label: 'Button', max: 40 },
          { kind: 'url', key: 'linkHref', label: 'Button links to', placeholder: '/greece or https://' },
        ],
      },
      {
        kind: 'select',
        key: 'height',
        label: 'Height',
        options: [
          { value: 'short', label: 'Short' },
          { value: 'medium', label: 'Medium' },
          { value: 'tall', label: 'Tall' },
        ],
      },
      { kind: 'select', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS },
      {
        kind: 'colour',
        key: 'scrim',
        label: 'Shading',
        help: 'The wash over each picture. Without it, words over a photograph are a lottery.',
      },
      {
        kind: 'number',
        key: 'scrimStrength',
        label: 'Shading strength',
        min: 25,
        max: 90,
        step: 1,
      },
      { kind: 'colour', key: 'buttonColour', label: 'Button colour', help: 'Blank uses your theme.' },
    ],
  },
  {
    /*
     * PICTURES PLAYING ON A SCREEN (Andy, 20 Aug 2026, from Duda's Travelgenix
     * Screen Carousel).
     *
     * THE FRAME IS DRAWN IN CSS, not a PNG of a laptop. A picture of a device
     * would be one fixed size, one fixed colour, and a file to ship; a few
     * rounded boxes cost nothing, stay sharp on any screen, and can follow the
     * client's own light or dark choice. It also means there is no photograph of
     * somebody else's hardware on a client's homepage.
     *
     * IT BORROWS THE SLIDESHOW WHOLE, exactly as Half overlay does: the same
     * `.tgs-slideshow` wrapper, so it cycles in pure CSS and public/slideshow.js
     * gives it arrows, dots and a pause button with nothing added to that file.
     * One picture is not a carousel and renders as a still screen.
     */
    type: 'screen-carousel',
    label: 'Screen carousel',
    group: 'Media',
    icon: 'slider',
    description: 'Your pictures playing on a laptop or phone screen.',
    defaults: {
      device: 'laptop',
      frame: 'light',
      transition: 'fade',
      interval: 5,
      arrows: true,
      dots: true,
      items: [{ src: '', alt: '' }, { src: '', alt: '' }, { src: '', alt: '' }],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return count > 1 ? `Screen carousel (${count})` : 'Screen';
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Pictures',
        itemLabel: 'Picture',
        max: 20,
        fields: [
          { kind: 'image', key: 'src', label: 'Picture' },
          { kind: 'text', key: 'alt', label: 'Description', max: 200, help: 'What the picture shows, for a screen reader.' },
        ],
      },
      {
        kind: 'select',
        key: 'device',
        label: 'Device',
        options: [
          { value: 'laptop', label: 'Laptop' },
          { value: 'phone', label: 'Phone' },
        ],
        help: 'The shape of the screen your pictures play on.',
      },
      {
        kind: 'select',
        key: 'frame',
        label: 'Frame',
        options: [
          { value: 'light', label: 'Silver' },
          { value: 'dark', label: 'Graphite' },
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
      { kind: 'number', key: 'interval', label: 'Seconds per picture', min: 2, max: 15, step: 1 },
      { kind: 'toggle', key: 'arrows', label: 'Arrows to move between pictures' },
      { kind: 'toggle', key: 'dots', label: 'Dots showing which picture is up' },
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
    /*
     * A MAP FROM AN ADDRESS, no key and no pasted embed code.
     *
     * Every agency shows where it is, and the honest way to let a client do so is
     * to ask for the one thing they know, their address, and generate the rest.
     * The embed is built in lib/content/map.ts from a fixed host, so nothing the
     * client types becomes a URL or an origin: the same arrangement the widget
     * blocks and the analytics id use. No API key, so there is nothing to set up,
     * leak or bill.
     */
    type: 'map',
    label: 'Map',
    group: 'Media',
    icon: 'map',
    description: 'An office or destination map, from just an address.',
    defaults: { address: '', zoom: 14, height: 360, radius: 'md', caption: '' },
    summarise: (props) => {
      const address = asString(props.address).trim();
      return address ? `Map: ${firstWords(address, 5)}` : 'Map';
    },
    fields: [
      {
        kind: 'place',
        key: 'address',
        label: 'Address or place',
        max: 200,
        placeholder: 'Start typing an address',
        help: 'Type your address and pick it from the list, or type it in full. The map appears as soon as you choose.',
      },
      {
        kind: 'number',
        key: 'zoom',
        label: 'Zoom',
        min: 1,
        max: 20,
        step: 1,
        group: 'layout',
        help: 'Higher is closer in. 14 shows the street, lower shows the whole town.',
      },
      { kind: 'number', key: 'height', label: 'Height', min: 120, max: 1200, step: 20, group: 'layout' },
      { kind: 'select', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS, group: 'border' },
      { kind: 'text', key: 'caption', label: 'Caption', max: 200 },
    ],
  },
  {
    /*
     * TWO PICTURES AND A DIVIDER YOU DRAG. One season against another, a room
     * before and after, the same view either side of a change.
     *
     * The reveal is pure CSS, no client script, the same rule the slider and the
     * tabs keep: the top picture sits in a box the browser lets you resize, and
     * dragging its edge uncovers the one beneath. Both pictures go through the
     * image field and safeUrl like every other picture, and the shape is fixed so
     * the two line up rather than argue over the height.
     */
    type: 'before-after',
    label: 'Before & After',
    group: 'Media',
    icon: 'compare',
    description: 'Two photos with a divider you drag to compare them.',
    defaults: {
      before: '',
      beforeAlt: '',
      after: '',
      afterAlt: '',
      beforeLabel: 'Before',
      afterLabel: 'After',
      start: 50,
      ratio: '16/9',
    },
    summarise: () => 'Before & After',
    fields: [
      { kind: 'image', key: 'before', label: 'Before image' },
      {
        kind: 'text',
        key: 'beforeAlt',
        label: 'Before alt text',
        max: 200,
        help: 'What the before photo shows, for search engines and screen readers.',
      },
      { kind: 'image', key: 'after', label: 'After image' },
      { kind: 'text', key: 'afterAlt', label: 'After alt text', max: 200, help: 'What the after photo shows.' },
      {
        kind: 'text',
        key: 'beforeLabel',
        label: 'Before badge',
        max: 40,
        help: 'The label on the before photo. Leave empty for no badge.',
      },
      { kind: 'text', key: 'afterLabel', label: 'After badge', max: 40 },
      {
        kind: 'number',
        key: 'start',
        label: 'Start position',
        min: 0,
        max: 100,
        step: 5,
        group: 'layout',
        help: 'How much of the before photo shows before anyone drags it. 50 is halfway.',
      },
      {
        kind: 'select',
        key: 'ratio',
        label: 'Shape',
        options: RATIO_OPTIONS.filter((option) => option.value !== 'auto'),
        group: 'layout',
      },
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
      textColour: '',
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
      {
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        help: 'The titles and body text. The small label and the link keep your brand colour.',
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
      rows: '1',
      scrollbar: 'thin',
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
      /*
       * ORIGINAL IS BACK ON THE LIST, and only on the rail (Andy, 20 Aug 2026).
       * It was filtered out because a card frame with no shape has no height to
       * give its picture and collapses. On a two-row rail it is the whole point:
       * "a mosaic, so the images can be of different heights in the same
       * carousel" was how Andy described the Duda one. The stylesheet gives the
       * frame back its height for this one setting; see the note beside
       * .tgs-slider[data-ratio='auto'].
       */
      {
        kind: 'select',
        key: 'ratio',
        label: 'Picture shape',
        options: RATIO_OPTIONS,
        help: 'Original lets every picture keep its own shape, which is what makes two rows read as a mosaic rather than a grid.',
      },
      { kind: 'select', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS },
      {
        kind: 'select',
        key: 'align',
        label: 'Alignment',
        options: ALIGN_OPTIONS.filter((option) => option.value !== 'right'),
      },
      /*
       * TWO ROWS ON ONE RAIL (Andy, 20 Aug 2026, from Duda's Double Row
       * Carousel). Not two sliders stacked: one rail, filling downwards then
       * across, so a swipe moves both rows together and the pair stays a pair.
       * Twice the trips in the same height of page, which is what a homepage
       * with a lot to show actually needs.
       */
      {
        kind: 'select',
        key: 'rows',
        label: 'Rows',
        options: [
          { value: '1', label: 'One' },
          { value: '2', label: 'Two' },
        ],
        help: 'Two stacks the cards in pairs and moves them together. Each row is as tall as it needs to be, so pictures of different shapes still line up.',
      },
      /*
       * HOW THE RAIL SAYS "THIS MOVES" (Andy, 20 Aug 2026, from Duda's Scrollbar
       * Carousel). Both are the browser's own scrollbar rather than anything
       * drawn: it stays draggable, keyboard reachable and honest about how far
       * along you are, which a div pretending to be a scrollbar is not.
       */
      {
        kind: 'select',
        key: 'scrollbar',
        label: 'Scroll bar',
        options: [
          { value: 'thin', label: 'Thin' },
          { value: 'bar', label: 'Bold' },
        ],
        help: 'Bold gives the wide track under the cards, and fades the rail at whichever end has more to show.',
      },
      {
        kind: 'toggle',
        key: 'wholeCardLinks',
        label: 'The whole card is clickable',
        help: 'Still one link, so a keyboard tabs through the slides once each.',
      },
    ],
  },
  {
    /*
     * WHAT YOUR CLIENTS SAID, ON A RAIL. The native version of the widget, so
     * the cards are the site's own type and colours and a client edits them in
     * place rather than in a second tool.
     *
     * The rail is the same pure-CSS scroll-snap the slider uses, no script. Each
     * card carries a rating, a quote, a name, a line of detail and a photo, and
     * the photo goes through the image field and safeUrl like every other. It
     * arrives with three example testimonials so the block is never a blank rail.
     */
    type: 'testimonials',
    label: 'Testimonial slider',
    group: 'Media',
    icon: 'testimonial',
    description: 'What your clients said, on a rail: a rating, a quote, a name and a photo.',
    defaults: {
      textColour: '',
      cardColour: '',
      items: [
        {
          quote: 'They thought of everything. We just turned up and had the best two weeks of our lives.',
          name: 'Sarah and Tom',
          detail: 'Honeymoon in the Maldives',
          rating: 5,
          photo: '',
          alt: '',
        },
        {
          quote: 'First time abroad with three children and it was genuinely easy. Every question answered the same day.',
          name: 'The Whitfields',
          detail: 'Family trip to Florida',
          rating: 5,
          photo: '',
          alt: '',
        },
        {
          quote: 'The itinerary was spot on and nothing was left to chance. I would not book any other way now.',
          name: 'James P',
          detail: 'Safari in Kenya',
          rating: 5,
          photo: '',
          alt: '',
        },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Testimonials (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Testimonials',
        itemLabel: 'Testimonial',
        max: 24,
        fields: [
          { kind: 'textarea', key: 'quote', label: 'What they said', rows: 3, max: 400 },
          { kind: 'text', key: 'name', label: 'Their name', max: 80 },
          {
            kind: 'text',
            key: 'detail',
            label: 'Where or what for',
            max: 120,
            help: 'The line under their name. A trip, a place, a date.',
          },
          {
            kind: 'number',
            key: 'rating',
            label: 'Stars',
            min: 0,
            max: 5,
            step: 1,
            help: 'Out of five. Set it to 0 for no stars.',
          },
          { kind: 'image', key: 'photo', label: 'Photo' },
          { kind: 'text', key: 'alt', label: 'Photo alt text', max: 200 },
        ],
      },
      {
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        help: 'The quote, name and detail on every card. Blank follows the section.',
      },
      {
        kind: 'colour',
        key: 'cardColour',
        label: 'Card colour',
        help: 'The background of each card. Blank uses the site surface.',
      },
    ],
  },
  {
    /*
     * A SOUND CLIP IN THE BROWSER'S OWN PLAYER. A welcome message, a podcast
     * cut, a pronunciation. The player is the native <audio controls>, so there
     * is no script and nothing to style into working: the browser draws it.
     *
     * The source is a link, run through safeUrl like every other, and it does
     * not preload, so neither the editor redrawing on a keystroke nor a visitor
     * loading the page fetches the file until they press play.
     */
    type: 'audio',
    label: 'Audio',
    group: 'Media',
    icon: 'audio',
    description: 'A sound clip in the browser player, from a link.',
    defaults: { src: '', title: '', caption: '', textColour: '' },
    summarise: (props) => {
      const title = asString(props.title).trim();
      return title ? `Audio: ${firstWords(title, 5)}` : 'Audio';
    },
    fields: [
      {
        kind: 'url',
        key: 'src',
        label: 'Link to your audio',
        placeholder: 'https://.../welcome.mp3',
        help: 'A direct link to an MP3 or similar. Paste the address of the file itself, not a page it sits on.',
      },
      { kind: 'text', key: 'title', label: 'Title', max: 120, help: 'An optional line above the player.' },
      { kind: 'text', key: 'caption', label: 'Caption', max: 200 },
      {
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        help: 'The title and caption. Blank follows the section.',
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
      outline: false,
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
      { kind: 'toggle', key: 'outline', label: 'Outlined', group: 'colours', help: 'Draw the button colour as an outline round clear space, not a fill.' },
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
     * SEARCH.
     *
     * A box that looks through the site's OWN pages, not the web. It belongs in
     * Actions beside the menu and the buttons, because in practice it lives in a
     * header next to them. It carries no results itself: it is a plain form that
     * sends the visitor to /search, and the server builds the answer there with
     * no JavaScript on the page. See SearchBlock and the search branch of the
     * site route.
     */
    type: 'search',
    label: 'Search',
    group: 'Actions',
    icon: 'search',
    description: 'A box that searches your own pages.',
    defaults: { placeholder: 'Search', display: 'box', align: 'left' },
    summarise: () => 'Search',
    fields: [
      { kind: 'text', key: 'placeholder', label: 'Placeholder', max: 40, help: 'The faint words inside the empty box.' },
      {
        kind: 'select',
        key: 'display',
        label: 'Show as',
        options: [
          { value: 'box', label: 'A search box' },
          { value: 'icon', label: 'Just the magnifier' },
        ],
        help: 'The magnifier on its own links to the search page, for a tidy header.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS, group: 'layout' },
      { kind: 'colour', key: 'colour', label: 'Colour', group: 'colours', help: 'The magnifier tint, so it shows on a dark bar. Blank follows the header.' },
    ],
  },

  {
    /*
     * LIGHT / DARK SWITCH.
     *
     * The one control on a published site that flips the whole page between a
     * light and a dark version of the client's own colours. It belongs in
     * Actions beside the menu and the search, because that is where it lives: in
     * a header, to hand.
     *
     * Adding it is the OPT IN for dark mode. A site with a switch gets the dark
     * palette and starts following a visitor's system preference; a site without
     * one is never touched, whatever the visitor's system asks for. See
     * hasThemeToggle, darkThemeTokens and the ThemeToggleScript: this block is
     * also the ONLY thing on the whole platform that puts JavaScript on a
     * published page, and it is progressive, so the automatic half still works
     * with the script blocked.
     */
    type: 'theme-toggle',
    label: 'Light / dark',
    group: 'Actions',
    icon: 'theme',
    description: 'A switch that turns the whole site light or dark.',
    defaults: { display: 'switch', align: 'left' },
    summarise: () => 'Light / dark',
    fields: [
      {
        kind: 'select',
        key: 'display',
        label: 'Show as',
        options: [
          { value: 'switch', label: 'A sliding switch' },
          { value: 'icon', label: 'Just the moon' },
        ],
        help: 'The switch shows the sun and the moon; the moon on its own is tidier in a busy bar.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS, group: 'layout' },
      { kind: 'colour', key: 'colour', label: 'Colour', group: 'colours', help: 'The switch tint, so it shows on a dark bar. Blank follows the header.' },
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
      collapse: 'phone',
      uppercase: false,
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
          {
            kind: 'icon',
            key: 'icon',
            label: 'Icon',
            help: 'Optional. A small icon beside the link, for the icon-led menus. Leave blank for words only.',
          },
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
      /*
       * THE BURGER, AND WHEN IT APPEARS (Andy, 20 Aug 2026, from the Duda list).
       *
       * This was a toggle until that date, which could say "on phones" or "not
       * at all" and had no way to say the third thing: a burger at every width,
       * on purpose. That is a real design, not a fallback — several of the
       * luxury and editorial headers put everything behind one button and let
       * the logo have the bar to itself — and a toggle could not express it.
       *
       * lib/content/burger.ts reads both this and the old boolean, so a menu
       * saved before today keeps working and keeps its old answer.
       */
      {
        kind: 'select',
        key: 'collapse',
        label: 'Menu button',
        options: [
          { value: 'never', label: 'Never' },
          { value: 'phone', label: 'On phones' },
          { value: 'always', label: 'Always' },
        ],
        help:
          'On phones tucks the links behind a button where they will not fit. '
          + 'Always keeps them behind it at every width, which suits a header that is mostly logo.',
      },
      /*
       * The type of the links, so a header menu can match the brand rather than
       * inheriting the body font (Andy, 14 Aug 2026: you could not set a font on
       * the links before). Font and size are drawn from the same whitelists the
       * text toolbar uses, the site's own two fonts and the theme's sizes plus a
       * short fixed scale, so nothing off-brand or unsafe can reach the page.
       * Each defaults to following the header.
       */
      {
        kind: 'select',
        key: 'linkFont',
        label: 'Link font',
        options: [{ value: '', label: 'Site default' }, ...FONT_CHOICES.map((f) => ({ value: f.value, label: f.label }))],
        help: 'The typeface for the links. Site default follows your theme.',
      },
      {
        kind: 'select',
        key: 'linkSize',
        label: 'Link size',
        options: [{ value: '', label: 'Default' }, ...FONT_SIZES.map((s) => ({ value: s.value, label: s.label }))],
      },
      {
        kind: 'select',
        key: 'linkWeight',
        label: 'Link weight',
        options: [
          { value: '', label: 'Default' },
          { value: '400', label: 'Regular' },
          { value: '500', label: 'Medium' },
          { value: '600', label: 'Semibold' },
          { value: '700', label: 'Bold' },
        ],
      },
      { kind: 'colour', key: 'linkColour', label: 'Link colour', help: 'The colour of the links. Blank follows the header.' },
      { kind: 'toggle', key: 'uppercase', label: 'Uppercase links', help: 'Small capitals with a little letter-spacing, for the more formal headers.' },
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
      {
        kind: 'toggle',
        key: 'countUp',
        label: 'Count up on scroll',
        help: 'Plain whole numbers tick up from zero as the block scrolls in. A comma, a decimal or 24/7 stays as written, and it eases off for reduced motion.',
      },
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
      {
        kind: 'toggle',
        key: 'scroll',
        label: 'Scroll the logos',
        help: 'The row glides along on its own on the live site and pauses when someone hovers it. It holds still for anyone who prefers less motion. Good for more logos than fit in a row.',
      },
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
      textColour: '',
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
      {
        kind: 'colour',
        key: 'textColour',
        label: 'Text colour',
        help: 'The headings and the cells. Blank follows the section.',
      },
    ],
  },

  // --- Layout -----------------------------------------------------------
  {
    /*
     * A CONTAINER: COLUMNS INSIDE A COLUMN, ONE LEVEL DEEP.
     *
     * The content model is otherwise flat, a block being a leaf, and this is the
     * one deliberate exception, added 5 Aug 2026 for the side-by-side layouts a
     * single column cannot hold: an icon beside a paragraph, two small cards in
     * one column of a wider row, a label next to its value. Its columns live in
     * props.columns as ordinary Columns, so they carry the same widths, boxes and
     * blocks a section's columns do, and the renderer draws them with the very
     * same row and column CSS.
     *
     * BOUNDED ON PURPOSE. A container's inner blocks are leaves: there is no
     * container inside a container, which the picker and the drop both refuse.
     * That keeps the address a fixed grammar (see the note in lib/content/tree.ts)
     * rather than an unbounded nesting every tool in the editor would have to
     * learn.
     *
     * NO CONTENT FIELDS. What a container holds is set on the canvas, by dropping
     * blocks into its columns, so the pane carries only its own design box:
     * background, border, corners and spacing, exactly as a column does.
     */
    type: 'container',
    label: 'Inner container',
    group: 'Layout',
    icon: 'columns',
    description: 'Columns inside a column, for content side by side.',
    // The two starter columns are seeded by the factory with fresh ids, not
    // here: a literal here would hand every container the same column ids. gap
    // and stack are the container's own layout, read by the renderer.
    defaults: { columns: [], gap: 16, stack: 'mobile' },
    summarise: (props) => {
      const count = Array.isArray(props.columns) ? props.columns.length : 0;
      return `Inner container (${count} column${count === 1 ? '' : 's'})`;
    },
    fields: [
      {
        kind: 'number',
        key: 'gap',
        label: 'Space between columns',
        min: 0,
        max: 96,
        step: 2,
        group: 'layout',
        help: 'The gap between the inner columns, in pixels.',
      },
      {
        kind: 'select',
        key: 'stack',
        label: 'Stack into one column',
        group: 'layout',
        options: [
          { value: 'mobile', label: 'On phones' },
          { value: 'tablet', label: 'On tablets too' },
          { value: 'always', label: 'Always' },
        ],
        help: 'When the inner columns fall one above the other. Always suits a label beside its value.',
      },
    ],
  },
  {
    /*
     * THE GRID, asked for on 20 Aug 2026 alongside the rest of the Duda list.
     *
     * WHAT MAKES IT DIFFERENT FROM THE INNER CONTAINER, which is the question
     * anybody looking at both in the picker will ask. A container is ONE ROW of
     * columns you size by hand: two things side by side, and they stay side by
     * side. A grid is a number of tracks that cells FLOW INTO and wrap out of,
     * so nine cells in a three-across grid make three neat rows without anybody
     * building three containers. It is the right tool the moment the count of
     * things is not the count of columns.
     *
     * THREE COUNTS, ONE PER SCREEN, which is the "advanced" part and the thing a
     * plain card grid cannot do: four across on a desktop, two on a tablet, one
     * on a phone, each chosen rather than derived. A cell may also span more
     * than one track, so a featured item can be twice the width of its
     * neighbours without leaving the grid.
     *
     * The cells live in props.columns, the same shape a container uses, so the
     * sanitiser, the outline, the schema upgrade and the drag rules all treat it
     * the same way. See lib/content/inner-columns.ts, which is the one list that
     * says which blocks are made this way.
     */
    type: 'grid',
    label: 'Grid',
    group: 'Layout',
    icon: 'grid',
    description: 'Cells that flow into a set number of columns and wrap.',
    // The three starter cells are seeded by the factory with fresh ids, for the
    // same reason a container's two are: a literal here would hand every grid
    // the same cell ids.
    defaults: {
      columns: [],
      across: '3',
      acrossTablet: '2',
      acrossPhone: '1',
      gap: 16,
      align: 'top',
    },
    summarise: (props) => {
      const count = Array.isArray(props.columns) ? props.columns.length : 0;
      return `Grid (${count} cell${count === 1 ? '' : 's'})`;
    },
    fields: [
      {
        kind: 'select',
        key: 'across',
        label: 'Columns on a desktop',
        group: 'layout',
        options: ACROSS_OPTIONS,
      },
      {
        kind: 'select',
        key: 'acrossTablet',
        label: 'Columns on a tablet',
        group: 'layout',
        options: ACROSS_OPTIONS,
      },
      {
        kind: 'select',
        key: 'acrossPhone',
        label: 'Columns on a phone',
        group: 'layout',
        options: ACROSS_OPTIONS,
        help: 'One is usually right on a phone. Two suits small tiles like logos.',
      },
      {
        kind: 'number',
        key: 'gap',
        label: 'Space between cells',
        min: 0,
        max: 96,
        step: 2,
        group: 'layout',
        help: 'The gap between cells, in pixels. Applies both across and down.',
      },
      {
        kind: 'select',
        key: 'align',
        label: 'Cells line up',
        group: 'layout',
        options: [
          { value: 'top', label: 'At the top' },
          { value: 'centre', label: 'In the middle' },
          { value: 'bottom', label: 'At the bottom' },
          { value: 'stretch', label: 'Same height' },
        ],
        help: 'Same height is what makes a row of cards match when their words differ in length.',
      },
    ],
  },
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

  {
    /*
     * THE COPYRIGHT LINE, WITH A YEAR THAT KEEPS ITSELF, asked for on 20 Aug
     * 2026 from the Duda list.
     *
     * WHY IT IS NOT JUST A TEXT BLOCK, which is a fair question and has one
     * answer: the year. A copyright typed into a paragraph is correct on the day
     * somebody types it and wrong every January after. Across a few hundred
     * client sites that is a few hundred footers quietly saying 2024, and not one
     * client will notice their own. The year here is worked out when the page is
     * drawn, so it is right on 1 January with nobody touching anything.
     *
     * NO JAVASCRIPT DOES IT. A published page is server-rendered on every
     * request (force-dynamic), so the server knows the date and the browser is
     * handed a finished line. The usual scripted version writes the year in on
     * load, which means a visitor with no JavaScript sees a gap and a crawler
     * indexes one.
     *
     * A START YEAR IS OPTIONAL and gives a range, "2016 to 2026", which is what
     * an established agency usually wants. Left blank it is the current year on
     * its own. A start year in the future, or after this year, is ignored rather
     * than drawn backwards.
     */
    type: 'copyright',
    label: 'Copyright',
    group: 'Text',
    icon: 'copyright',
    description: 'A copyright line whose year looks after itself.',
    defaults: {
      owner: '',
      startYear: 0,
      symbol: 'symbol',
      suffix: 'All rights reserved.',
      size: 's',
      align: 'left',
    },
    summarise: (props) => {
      const owner = asString(props.owner);
      return owner ? `Copyright: ${owner}` : 'Copyright';
    },
    fields: [
      {
        kind: 'text',
        key: 'owner',
        label: 'Who owns it',
        max: 120,
        help: 'Your company name, as it appears on your paperwork.',
      },
      {
        kind: 'number',
        key: 'startYear',
        label: 'First year',
        min: 0,
        max: 2200,
        step: 1,
        help: 'Optional. Set it and the line reads as a range, like 2016 to 2026. Leave it at zero for this year alone.',
      },
      {
        kind: 'select',
        key: 'symbol',
        label: 'Symbol',
        options: [
          { value: 'symbol', label: '\u00A9' },
          { value: 'word', label: 'Copyright' },
          { value: 'both', label: '\u00A9 Copyright' },
          { value: 'none', label: 'No symbol' },
        ],
      },
      {
        kind: 'text',
        key: 'suffix',
        label: 'After the name',
        max: 160,
        help: 'The rest of the line. Company number and registered office go here if you show them.',
      },
      {
        kind: 'select',
        key: 'size',
        label: 'Size',
        group: 'layout',
        options: [
          { value: 's', label: 'Small' },
          { value: 'm', label: 'Normal' },
        ],
      },
      { kind: 'select', key: 'align', label: 'Alignment', group: 'layout', options: ALIGN_OPTIONS },
    ],
  },

  {
    /*
     * LONG TEXT, FOLDED, asked for on 20 Aug 2026 from the Duda list.
     *
     * THE WHOLE TEXT IS ALWAYS IN THE HTML, and only its DISPLAY is clamped.
     * That is the difference between this and the usual scripted read-more,
     * which fetches or reveals the rest on click: those hide the text from a
     * search engine, from a screen reader and from anybody with JavaScript off,
     * and on a page whose whole point is being found, hiding half the words is
     * an odd thing to do to yourself.
     *
     * NO JAVASCRIPT, which the published page could not run anyway. A hidden
     * checkbox and a label, the same shape the Tabs block uses for its panels:
     * the label toggles the input, and `:checked ~` in the stylesheet drops the
     * line clamp. The label is a real control, so it takes focus, works on Enter
     * and Space, and announces its own state.
     *
     * WHY NOT <details>. A closed <details> hides every child that is not the
     * summary, so there is no way to show the first four lines of a paragraph
     * inside one. Putting the text INSIDE the summary works visually and then
     * announces the entire paragraph as the button's name, which is worse than
     * the problem it solves.
     */
    type: 'read-more',
    label: 'Read more',
    group: 'Text',
    icon: 'read-more',
    description: 'Long text folded to a few lines, with a control to open it.',
    defaults: {
      html: '<p>Write the long version here. Only the first few lines show until somebody opens it, and the rest is still in the page for search engines and screen readers.</p>',
      lines: 4,
      moreLabel: 'Read more',
      lessLabel: 'Show less',
      fade: true,
      align: 'left',
    },
    summarise: (props) => {
      const words = asString(props.html).replace(/<[^>]*>/g, ' ').trim();
      return words ? `Read more: ${words.slice(0, 40)}` : 'Read more';
    },
    fields: [
      { kind: 'richtext', key: 'html', label: 'Text' },
      {
        kind: 'number',
        key: 'lines',
        label: 'Lines before folding',
        min: 1,
        max: 20,
        step: 1,
        group: 'layout',
        help: 'How much shows before somebody opens it. Three or four is usually right. Set it higher than the text you have written and there is nothing left to open.',
      },
      { kind: 'text', key: 'moreLabel', label: 'Open label', max: 40 },
      { kind: 'text', key: 'lessLabel', label: 'Close label', max: 40 },
      {
        kind: 'toggle',
        key: 'fade',
        label: 'Fade the last line',
        group: 'effects',
        help: 'Softens the cut, so it reads as folded rather than as text that stopped.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', group: 'layout', options: ALIGN_OPTIONS },
    ],
  },

  {
    /*
     * CLICK TO CHAT ON WHATSAPP, asked for on 20 Aug 2026 from the Duda list.
     *
     * WHATSAPP WAS ALREADY ONE ICON in the Social links row, which is right for
     * a footer of five icons and wrong for the thing a travel agency actually
     * wants: a button that opens a chat with a message already typed, so the
     * enquiry arrives with the page it came from attached.
     *
     * NO JAVASCRIPT. wa.me is a plain link, so this works the same as every
     * other block here.
     *
     * WHAT IT ADDS OVER A BUTTON WITH A wa.me ADDRESS PASTED IN: the number.
     * wa.me wants digits and nothing else, with the country code and no leading
     * zero, and every form a client will actually type breaks one of those. The
     * failure is invisible from our side — the link builds, the page publishes,
     * and the visitor gets "phone number shared via url is invalid". See
     * lib/content/whatsapp.ts, where the normalising is done and tested.
     *
     * A LEADING ZERO IS REFUSED, NOT REPAIRED. "01204 123456" needs the country
     * code, and we cannot know a client is in the UK. Dropping the zero would
     * make a link that looks right and reaches nobody.
     *
     * THE FLOATING LOOK IS A REAL OPTION rather than a gimmick: a bubble pinned
     * to the corner is how most people meet this button, and it costs nothing
     * because position: fixed needs no script.
     */
    type: 'whatsapp',
    label: 'WhatsApp',
    group: 'Actions',
    icon: 'whatsapp',
    description: 'A click-to-chat button, with the first message already written.',
    defaults: {
      phone: '',
      message: 'Hello, I am looking at your website and would like to ask about',
      label: 'Chat on WhatsApp',
      look: 'button',
      corner: 'right',
      align: 'left',
    },
    summarise: (props) => {
      const phone = asString(props.phone).trim();
      return phone ? `WhatsApp: ${phone}` : 'WhatsApp';
    },
    fields: [
      {
        kind: 'text',
        key: 'phone',
        label: 'Number',
        max: 24,
        placeholder: '+44 1204 123456',
        help: 'With the country code. A number starting with 0 will not work, because WhatsApp needs the international form.',
      },
      {
        kind: 'textarea',
        key: 'message',
        label: 'First message',
        max: 300,
        help: 'Already typed in for them when the chat opens. Leave it blank to open an empty chat.',
      },
      { kind: 'text', key: 'label', label: 'Button text', max: 40 },
      {
        kind: 'select',
        key: 'look',
        label: 'Look',
        group: 'layout',
        options: [
          { value: 'button', label: 'A button on the page' },
          { value: 'floating', label: 'A bubble in the corner' },
        ],
      },
      {
        kind: 'select',
        key: 'corner',
        label: 'Which corner',
        group: 'layout',
        options: [
          { value: 'right', label: 'Bottom right' },
          { value: 'left', label: 'Bottom left' },
        ],
        help: 'Only used by the bubble. Put it on the opposite side to anything else that floats.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', group: 'layout', options: ALIGN_OPTIONS },
    ],
  },

  {
    /*
     * A DISCOUNT CODE, asked for on 20 Aug 2026 from the Duda list.
     *
     * NO COPY BUTTON, AND THAT IS NOT A SHORTFALL. Copying to the clipboard
     * needs a script, and a published page here ships none. What it does instead
     * is better than it sounds: the code sits in a box with `user-select: all`,
     * so ONE click or tap selects the whole code, ready to copy. A copy button
     * saves a keystroke; this needs no JavaScript, works with none, and cannot
     * fail silently the way a clipboard call does when a browser refuses it.
     *
     * THE EXPIRY LOOKS AFTER ITSELF, the same reasoning as the Copyright block.
     * An offer that ended in March and is still on the page in July is a
     * customer ringing up to argue about it, and the client will not notice
     * because they never visit their own offers page. So the date is compared
     * when the page is drawn, and by default the whole thing stops showing once
     * it has passed. That is on by default because the failure it prevents is
     * expensive and the one it causes, a coupon vanishing early because somebody
     * typed the wrong date, is visible immediately in the editor.
     *
     * ON THE CANVAS IT ALWAYS SHOWS, expired or not. A client editing last
     * season's coupon has to be able to see the thing they are editing.
     */
    type: 'coupon',
    label: 'Coupon',
    group: 'Actions',
    icon: 'coupon',
    description: 'A discount code, with the small print and a date it ends.',
    defaults: {
      headline: '10% off your first booking',
      code: 'WELCOME10',
      body: 'Quote this code when you enquire and we will take it off your balance.',
      expires: '',
      hideExpired: true,
      terms: 'One code per booking. Not valid with any other offer.',
      buttonLabel: '',
      buttonHref: '',
      align: 'left',
    },
    summarise: (props) => {
      const code = asString(props.code).trim();
      return code ? `Coupon: ${code}` : 'Coupon';
    },
    fields: [
      { kind: 'text', key: 'headline', label: 'The offer', max: 120 },
      {
        kind: 'text',
        key: 'code',
        label: 'Code',
        max: 40,
        help: 'What a customer quotes. One click selects the whole thing on the page.',
      },
      { kind: 'textarea', key: 'body', label: 'How to use it', max: 300 },
      {
        kind: 'text',
        key: 'expires',
        label: 'Ends on',
        max: 10,
        placeholder: '2026-09-30',
        help: 'Year, month, day. Leave it blank for an offer with no end date.',
      },
      {
        kind: 'toggle',
        key: 'hideExpired',
        label: 'Stop showing it once it has ended',
        help: 'On by default. An offer that ended in March and is still on the page in July is an argument with a customer.',
      },
      { kind: 'text', key: 'terms', label: 'Small print', max: 300 },
      { kind: 'text', key: 'buttonLabel', label: 'Button', max: 40, group: 'layout' },
      { kind: 'url', key: 'buttonHref', label: 'Button link', group: 'layout' },
      { kind: 'select', key: 'align', label: 'Alignment', group: 'layout', options: ALIGN_OPTIONS },
    ],
  },

  {
    /*
     * SEVERAL BRANCHES, asked for on 20 Aug 2026 from the Duda list.
     *
     * WHY IT IS NOT THE LOCATION BLOCK REPEATED. That block FRAMES a map, which
     * is right for one address: a visitor sees where it is without leaving the
     * page. Six of them means six third-party page loads before a visitor has
     * even decided which branch they want, and six maps of six different towns
     * is not a picture anybody reads.
     *
     * So this lists the branches as cards, each with a directions LINK rather
     * than a frame. A link costs nothing until it is clicked, and clicking it
     * opens the maps app on a phone, which is what somebody hunting for their
     * nearest branch actually wants. See mapDirectionsUrl in lib/content/map.ts.
     *
     * THE PHONE AND EMAIL ARE REAL LINKS, tel: and mailto:, so a tap rings the
     * branch. That is what "Click To Call" means on the list this came from, and
     * it works here because the render path stopped throwing contact links away
     * earlier today.
     */
    type: 'locations',
    label: 'Multi Location',
    group: 'Actions',
    icon: 'map',
    description: 'Your branches, each with its address, phone and directions.',
    defaults: {
      across: '2',
      showDirections: true,
      items: [
        {
          name: 'Bolton',
          address: '',
          phone: '',
          email: '',
          hours: 'Mon to Sat, 9am to 5.30pm',
        },
        { name: 'Manchester', address: '', phone: '', email: '', hours: '' },
      ],
    },
    summarise: (props) => {
      const count = Array.isArray(props.items) ? props.items.length : 0;
      return `Locations (${count})`;
    },
    fields: [
      {
        kind: 'repeater',
        key: 'items',
        label: 'Branches',
        itemLabel: 'Branch',
        max: 24,
        fields: [
          { kind: 'text', key: 'name', label: 'Name', max: 80 },
          {
            kind: 'place',
            key: 'address',
            label: 'Address',
            max: 200,
            placeholder: 'Start typing an address',
            help: 'Pick it from the list so the directions link lands in the right place.',
          },
          { kind: 'text', key: 'phone', label: 'Phone', max: 40, placeholder: '01204 123456' },
          { kind: 'text', key: 'email', label: 'Email', max: 120, placeholder: 'bolton@example.com' },
          { kind: 'text', key: 'hours', label: 'Opening hours', max: 120 },
        ],
      },
      {
        kind: 'select',
        key: 'across',
        label: 'Columns',
        group: 'layout',
        options: ACROSS_OPTIONS,
        help: 'How many branches sit side by side. They stack on a phone whatever this says.',
      },
      {
        kind: 'toggle',
        key: 'showDirections',
        label: 'Show a directions link',
        group: 'layout',
        help: 'Opens the maps app on a phone. Only appears on a branch that has an address.',
      },
    ],
  },

  {
    /*
     * ONE ICON ON ITS OWN, asked for on 20 Aug 2026 from the Duda list.
     *
     * WHAT IT IS NOT. "Icon and text" already existed and is the right block
     * nine times out of ten, but it is an icon WITH a title and a line of copy,
     * and the way to get a bare icon out of it was to delete both and leave two
     * empty hosts behind. That is the sort of workaround a client finds and then
     * tells other clients about.
     *
     * IT IS A PICTURE, NOT A CHARACTER. Drawn from the Lucide set that
     * lib/content/icons.ts holds, parsed into real elements rather than put
     * through innerHTML, so an injected script is structurally impossible. Only
     * the ~300 bytes of the ONE chosen icon reaches a published page.
     *
     * SIZED IN PIXELS rather than from the type scale, because this is a picture
     * and a client placing one wants it a certain size on the page, not a
     * certain size relative to a paragraph that is not there.
     *
     * A LINK IS OPTIONAL, and when there is one the icon needs a name a screen
     * reader can read: an anchor whose only content is a decorative SVG is an
     * anchor that announces nothing. So the label field is required by the
     * renderer whenever a link is set, and ignored when there is not one, where
     * the icon really is decoration.
     */
    type: 'icon',
    label: 'Icon',
    group: 'Media',
    icon: 'sparkle',
    description: 'A single icon from the library, sized and coloured.',
    defaults: { icon: 'sparkles', size: 40, colour: '', href: '', label: '', align: 'left' },
    summarise: (props) => `Icon: ${asString(props.icon) || 'none'}`,
    fields: [
      { kind: 'icon', key: 'icon', label: 'Icon' },
      {
        kind: 'number',
        key: 'size',
        label: 'Size',
        min: 12,
        max: 200,
        step: 2,
        group: 'layout',
        help: 'In pixels, across and down.',
      },
      {
        kind: 'colour',
        key: 'colour',
        label: 'Colour',
        group: 'colours',
        help: 'Leave blank to follow the text around it.',
      },
      { kind: 'url', key: 'href', label: 'Link', placeholder: 'https://' },
      {
        kind: 'text',
        key: 'label',
        label: 'What the link is for',
        max: 80,
        help: 'Needed only when there is a link. A screen reader reads this, because an icon on its own says nothing.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', group: 'layout', options: ALIGN_OPTIONS },
    ],
  },

  {
    /*
     * A DECORATIVE SHAPE, asked for on 20 Aug 2026 from the Duda list.
     *
     * PURE DECORATION, AND SAID SO IN THE MARKUP. It carries aria-hidden, so a
     * screen reader walks straight past it. That is not a limitation to work
     * around later: a coloured circle behind a heading is not information, and
     * announcing it would be noise between the words that are.
     *
     * NOT THE SAME THING AS A SHAPE DIVIDER. A divider is the shaped EDGE
     * between two sections and belongs to the section (see
     * lib/content/dividers.ts). This is an object you place in a column, to sit
     * behind or beside something, which is what the reference sites use them for.
     *
     * DRAWN WITH CSS, not an SVG file and not a picture. A circle is a border
     * radius, a ring is a border, a square is a box: all of them scale to any
     * size with no file to load and no blur, and all of them take the client's
     * own colour rather than needing one baked in. The two that CSS cannot do
     * honestly, a triangle and a blob, are drawn with clip-path, which is the
     * same idea and still no file.
     */
    type: 'shape',
    label: 'Shape',
    group: 'Media',
    icon: 'shape',
    description: 'A circle, ring, square or blob, for decoration behind your content.',
    defaults: {
      shape: 'circle',
      size: 120,
      colour: '',
      opacity: 100,
      rotate: 0,
      align: 'left',
    },
    summarise: (props) => `Shape: ${asString(props.shape) || 'circle'}`,
    fields: [
      {
        kind: 'select',
        key: 'shape',
        label: 'Shape',
        options: [
          { value: 'circle', label: 'Circle' },
          { value: 'ring', label: 'Ring' },
          { value: 'square', label: 'Square' },
          { value: 'rounded', label: 'Rounded square' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'blob', label: 'Blob' },
        ],
      },
      {
        kind: 'number',
        key: 'size',
        label: 'Size',
        min: 16,
        max: 600,
        step: 4,
        group: 'layout',
        help: 'In pixels. It never grows past the column it is in.',
      },
      {
        kind: 'colour',
        key: 'colour',
        label: 'Colour',
        group: 'colours',
        help: 'Leave blank for your brand colour.',
      },
      {
        kind: 'number',
        key: 'opacity',
        label: 'Opacity',
        min: 5,
        max: 100,
        step: 5,
        group: 'effects',
        help: 'Below about 20 it reads as a wash behind your words rather than an object.',
      },
      {
        kind: 'number',
        key: 'rotate',
        label: 'Rotation',
        min: 0,
        max: 359,
        step: 5,
        group: 'effects',
        help: 'In degrees. Does nothing to a circle or a ring.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', group: 'layout', options: ALIGN_OPTIONS },
    ],
  },

  {
    /*
     * A FILE TO DOWNLOAD, asked for on 20 Aug 2026 from the Duda list.
     *
     * WHAT IT REPLACES. Until now the only way to put a brochure on a page was to
     * host it somewhere else and paste the address into a Button, which meant a
     * live page depending on a Dropbox link nobody was watching. The file lives
     * in the client's own media library now, so it cannot vanish from under the
     * page.
     *
     * FOUR PROPS FOR ONE CHOICE, written together when the file is picked: the
     * address, the original filename, the size and the format's name. The last
     * three are on the block rather than looked up while rendering, because the
     * alternative is a database read per file per visitor for the sake of
     * printing "2.4MB".
     *
     * TWO LOOKS, and they are not a style choice so much as two different jobs. A
     * CARD is a row with the format, the name, a line of explanation and the size,
     * which is what a page of downloads wants. A BUTTON is a single control, which
     * is what a hero or the end of a paragraph wants. The card is the default
     * because a lone download with no context is the commoner mistake.
     *
     * THE DOWNLOAD ATTRIBUTE IS A REQUEST, NOT A GUARANTEE. It only holds for a
     * same-origin file, and ours are on the blob store, so a browser may well
     * open a PDF in its own viewer instead. That is fine, and often what a visitor
     * wanted; what matters is that the link is a link, so it works with a
     * right-click, on a phone, and with JavaScript off.
     */
    type: 'file',
    label: 'File',
    group: 'Actions',
    icon: 'file',
    description: 'A brochure, terms or a price list, for a visitor to download.',
    defaults: {
      url: '',
      name: '',
      size: 0,
      format: '',
      title: '',
      description: '',
      look: 'card',
      align: 'left',
      newTab: true,
    },
    summarise: (props) => {
      const label = asString(props.title) || asString(props.name);
      return label ? `File: ${label}` : 'File';
    },
    fields: [
      {
        kind: 'file',
        key: 'url',
        label: 'File',
        nameKey: 'name',
        sizeKey: 'size',
        formatKey: 'format',
        help: 'PDF, Word, Excel, PowerPoint, CSV, text or a zip, up to 15MB.',
      },
      {
        kind: 'text',
        key: 'title',
        label: 'Title',
        max: 120,
        help: 'What a visitor sees. Leave it blank to show the file name.',
      },
      {
        kind: 'textarea',
        key: 'description',
        label: 'Description',
        max: 240,
        help: 'One line under the title, on the card look. Say what is in it and who it is for.',
      },
      {
        kind: 'select',
        key: 'look',
        label: 'Look',
        group: 'layout',
        options: [
          { value: 'card', label: 'Card' },
          { value: 'button', label: 'Button' },
        ],
      },
      { kind: 'select', key: 'align', label: 'Alignment', group: 'layout', options: ALIGN_OPTIONS },
      {
        kind: 'toggle',
        key: 'newTab',
        label: 'Open in a new tab',
        group: 'layout',
        help: 'On by default, so a visitor reading the file does not lose the page they were on.',
      },
    ],
  },

  {
    /*
     * THE TRAIL, WHERE THE CLIENT WANTS IT.
     *
     * READ THIS BEFORE CHANGING ANYTHING HERE. The trail is NOT opt-in. Every
     * nested published page already draws one automatically, between the header
     * and the content (components/render/Breadcrumb.tsx), because we emit
     * BreadcrumbList structured data for those pages and Google's guidance is
     * that markup must represent content a visitor can see. A page whose markup
     * claims a trail that is not on the page is a mismatch, and a mismatch is
     * what gets structured data ignored.
     *
     * This block does not turn the trail on. It MOVES it. A page carrying one
     * does not also get the automatic version (lib/content/breadcrumbs.ts,
     * hasBreadcrumbsBlock, asked by the published route), so a client can put the
     * trail inside a hero or under a banner without ever ending up with two of
     * them, or with none.
     *
     * THE CRUMBS ARE NOT STORED. They are filled in at render time from the
     * page's own address, so moving or renaming a page moves its trail with it. A
     * stored trail would be a second copy of the site's shape, quietly wrong the
     * first time anything moved.
     */
    type: 'breadcrumbs',
    label: 'Breadcrumbs',
    group: 'Layout',
    icon: 'crumbs',
    description: 'The trail back up to the home page. Moves the automatic one here.',
    // Blank colour means "follow the section", which is right nearly everywhere.
    defaults: { separator: 'slash', showHome: true, size: 's', align: 'left', colour: '' },
    summarise: () => 'Breadcrumbs',
    fields: [
      {
        kind: 'select',
        key: 'separator',
        label: 'Separator',
        group: 'layout',
        options: [
          { value: 'slash', label: 'Slash' },
          { value: 'chevron', label: 'Chevron' },
          { value: 'arrow', label: 'Arrow' },
          { value: 'dot', label: 'Dot' },
          { value: 'bullet', label: 'Bullet' },
        ],
      },
      {
        kind: 'toggle',
        key: 'showHome',
        label: 'Start at Home',
        group: 'layout',
        help: 'Off drops the first crumb, for a trail that already sits under a page title.',
      },
      {
        kind: 'select',
        key: 'size',
        label: 'Size',
        group: 'layout',
        options: [
          { value: 'xs', label: 'Small' },
          { value: 's', label: 'Normal' },
          { value: 'm', label: 'Large' },
        ],
      },
      { kind: 'select', key: 'align', label: 'Alignment', group: 'layout', options: ALIGN_OPTIONS },
      {
        kind: 'colour',
        key: 'colour',
        label: 'Text colour',
        group: 'colours',
        help: 'Leave blank to follow the section. Set it for a trail over a photograph.',
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
    // No default kind: it used to open on Opening Hours, so entering an ID
    // without touching the dropdown silently built an Opening Hours widget. Blank
    // shows "Choose a widget" until one is picked (or detected from the ID).
    defaults: { widget: '', widgetId: '' },
    summarise: (props) =>
      WIDGET_KINDS.find((kind) => kind.tag === props.widget)?.label ?? 'Widget',
    fields: [
      {
        kind: 'select',
        key: 'widget',
        label: 'Which widget',
        options: [
          { value: '', label: 'Choose a widget…' },
          ...WIDGET_KINDS.map((kind) => ({ value: kind.tag, label: kind.label })),
        ],
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
    /*
     * HTML, OPEN TO EVERY CLIENT SINCE 20 AUG 2026.
     *
     * Andy: "HTML needs to be available for anyone as that is how some of our
     * widgets get added." It was staff-only until then, and the reason was the
     * sanitiser rather than the block: a regex walk over pasted markup is how
     * mutation XSS gets in. Opening it meant building the parser-backed
     * sanitiser first (lib/content/sanitise-embed.ts), not removing a flag.
     *
     * A pasted Travelgenix embed now WORKS, which it would not have before even
     * with the gate off: the container's data-tg-* attributes survive and the
     * script tag survives, because its src is on our own origin. Anybody else's
     * script is still dropped. For a third-party widget the sealed iframe of
     * `embed-widget` remains the right door, and for one of ours the `widget`
     * block is still tidier than pasting code.
     */
    type: 'embed',
    label: 'HTML',
    group: 'Advanced',
    icon: 'code',
    description: 'Paste an embed code or your own HTML.',
    defaults: { html: '' },
    summarise: () => 'HTML',
    fields: [
      {
        kind: 'textarea',
        key: 'html',
        label: 'HTML',
        rows: 8,
        max: 20000,
        help:
          'Cleaned on save and again when the page draws. Travelgenix widget embed codes work as pasted. '
          + 'Scripts from anywhere else are removed, so for another company\'s widget use Embedded widget instead.',
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
