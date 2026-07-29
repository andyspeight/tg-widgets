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

// ---------------------------------------------------------------------------
// Editor field definitions
// ---------------------------------------------------------------------------

export type SelectOption = { value: string; label: string };

export type Field =
  | { kind: 'text'; key: string; label: string; placeholder?: string; max?: number; help?: string }
  | { kind: 'textarea'; key: string; label: string; rows?: number; max?: number; help?: string }
  | { kind: 'richtext'; key: string; label: string; help?: string }
  | { kind: 'url'; key: string; label: string; placeholder?: string; help?: string }
  | { kind: 'image'; key: string; label: string; help?: string }
  | { kind: 'select'; key: string; label: string; options: SelectOption[]; help?: string }
  | { kind: 'toggle'; key: string; label: string; help?: string }
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; help?: string }
  | { kind: 'repeater'; key: string; label: string; itemLabel: string; max?: number; fields: Field[]; help?: string };

export type BlockGroup = 'Text' | 'Media' | 'Actions' | 'Layout' | 'Advanced';

export interface BlockDefinition {
  type: string;
  label: string;
  group: BlockGroup;
  /** Single character or emoji shown in the block picker and outline. */
  icon: string;
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
    icon: 'H',
    description: 'A section or sub-section title.',
    defaults: { text: 'A new heading', level: 'h2', size: 'm', align: 'left' },
    summarise: (props) => asString(props.text) || 'Heading',
    fields: [
      { kind: 'text', key: 'text', label: 'Text', max: 200 },
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
        key: 'size',
        label: 'Size',
        options: [
          { value: 's', label: 'Small' },
          { value: 'm', label: 'Medium' },
          { value: 'l', label: 'Large' },
          { value: 'xl', label: 'Display' },
        ],
        help: 'Visual size only. It does not change the heading level.',
      },
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS },
    ],
  },
  {
    type: 'text',
    label: 'Text',
    group: 'Text',
    icon: '¶',
    description: 'A paragraph or a few. Bold, italics, links and lists.',
    defaults: {
      html: '<p>Write something here. Keep it plain and say the useful thing first.</p>',
      align: 'left',
      size: 'm',
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
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS },
    ],
  },
  {
    type: 'quote',
    label: 'Quote',
    group: 'Text',
    icon: '“',
    description: 'A pulled-out quotation with an attribution.',
    defaults: { text: 'Something worth repeating.', attribution: '', role: '' },
    summarise: (props) => firstWords(asString(props.text), 5) || 'Quote',
    fields: [
      { kind: 'textarea', key: 'text', label: 'Quote', rows: 3, max: 500 },
      { kind: 'text', key: 'attribution', label: 'Who said it', max: 80 },
      { kind: 'text', key: 'role', label: 'Their role', max: 80 },
    ],
  },
  {
    type: 'list',
    label: 'List',
    group: 'Text',
    icon: '•',
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
    icon: '◆',
    description: 'An icon with a short title and a line of copy.',
    defaults: { icon: '★', title: 'A benefit', body: 'One sentence on why it matters.' },
    summarise: (props) => asString(props.title) || 'Icon and text',
    fields: [
      { kind: 'text', key: 'icon', label: 'Icon', max: 4, help: 'A single character or emoji.' },
      { kind: 'text', key: 'title', label: 'Title', max: 80 },
      { kind: 'textarea', key: 'body', label: 'Body', rows: 3, max: 300 },
    ],
  },

  // --- Media ------------------------------------------------------------
  {
    type: 'image',
    label: 'Image',
    group: 'Media',
    icon: '▣',
    description: 'A picture, with the alt text search engines and screen readers need.',
    defaults: { src: '', alt: '', ratio: 'auto', fit: 'cover', radius: 'md', caption: '', href: '' },
    summarise: (props) => asString(props.alt) || asString(props.caption) || 'Image',
    fields: [
      { kind: 'image', key: 'src', label: 'Image' },
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
      { kind: 'select', key: 'radius', label: 'Corners', options: RADIUS_OPTIONS },
      { kind: 'text', key: 'caption', label: 'Caption', max: 200 },
      { kind: 'url', key: 'href', label: 'Links to', placeholder: 'https://' },
    ],
  },
  {
    type: 'video',
    label: 'Video',
    group: 'Media',
    icon: '▶',
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
    icon: '⊞',
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
          { kind: 'image', key: 'src', label: 'Image' },
          { kind: 'text', key: 'alt', label: 'Alt text', max: 200 },
        ],
      },
    ],
  },

  // --- Actions ----------------------------------------------------------
  {
    type: 'button',
    label: 'Button',
    group: 'Actions',
    icon: '▭',
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
      { kind: 'select', key: 'align', label: 'Alignment', options: ALIGN_OPTIONS },
      { kind: 'toggle', key: 'newTab', label: 'Open in a new tab' },
    ],
  },
  {
    type: 'button-group',
    label: 'Button group',
    group: 'Actions',
    icon: '▭▭',
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
          { kind: 'toggle', key: 'newTab', label: 'New tab' },
        ],
      },
    ],
  },

  // --- Layout -----------------------------------------------------------
  {
    type: 'divider',
    label: 'Divider',
    group: 'Layout',
    icon: '─',
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
    icon: '↕',
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
    type: 'embed',
    label: 'Embed code',
    group: 'Advanced',
    icon: '&lt;&gt;',
    description: 'Raw HTML. Travelgenix staff only.',
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
