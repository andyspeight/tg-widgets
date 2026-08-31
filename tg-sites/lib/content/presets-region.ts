/**
 * Headers and footers, in two sets.
 *
 * WHY TWO (Andy, 12 Aug 2026). The first cut put every arrangement under the
 * Designed tab, and Andy's read was fair: a logo beside a menu is a LAYOUT, not
 * a design, so calling it one undersells the tab. So the plain shapes moved to
 * where the page's layouts are, and Designed keeps the ones that are actually
 * designed: a tone, a rule, a call to action, a dark bar. You reach both the same
 * way, by editing the header or the footer on the canvas and pressing Add.
 *
 *   REGION_LAYOUTS   the bare shapes, on the Layouts tab. A start, not a look.
 *   REGION_PRESETS   the designed ones, on the Designed tab.
 *
 * BOTH ARE ORDINARY SECTION PRESETS. A region is sections, rows, columns and
 * blocks exactly as a page is, which is the decision the whole region feature
 * rests on, so neither needs machinery of its own. The only thing separating a
 * header preset from a page one is the `scope` on its category, which is what
 * stops a four-column footer being offered in the middle of a page.
 *
 * WHAT A HEADER GETS RIGHT THAT A HAND-BUILT ONE USUALLY DOES NOT
 *
 *   - The row is CENTRE aligned, so a tall logo and a one-line menu sit on the
 *     same line rather than the menu clinging to the top of the logo.
 *   - The section padding is small. A header with a page section's padding is a
 *     header that takes up a third of a phone screen.
 *   - The menu is on the RIGHT of its column, because that is where a menu goes
 *     when the logo is on the left, and the Menu block defaults to left.
 *   - Nothing is sticky or overlaid. Both are region settings rather than section
 *     ones, they apply to the whole header, and they are one tick box each in the
 *     properties pane. A preset that turned them on would be deciding something
 *     the client has not been asked about yet.
 *
 * WHAT MAKES THE DESIGNED ONES DESIGNED, given the colours all come from the
 * client's own theme: a TONE (a subtle tint or a dark band under the whole
 * thing), a hairline RULE between tiers, a call-to-action BUTTON picked out from
 * the menu, or a row of SOCIAL links. Small moves, but they are the difference
 * between a header that reads as furniture and one that reads as chosen. The
 * footers lean on the tones and a legal rule the same way.
 */

import type { PresetBlock, PresetRow, SectionPreset } from './preset-types';
import { CENTRED } from './preset-types';

/** A menu pushed to the right of its column, which is where a header wants it. */
const MENU_RIGHT = { align: 'right' } as const;

/** The links a site starts with. Same four the Menu block ships with. */
const LINKS = [
  { label: 'Home', href: '/', newTab: false },
  { label: 'Holidays', href: '/holidays', newTab: false },
  { label: 'About us', href: '/about', newTab: false },
  { label: 'Contact', href: '/contact', newTab: false },
];

/** A footer menu: a list of links rather than a nav bar, and never a burger. */
const FOOTER_MENU = { layout: 'column', collapse: 'never' } as const;

// ---------------------------------------------------------------------------
// The floating navbars, reproduced from Andy's references (19 Aug 2026)
//
// The modern navbar designs all share one shape: the logo, the menu and the
// button ride inside a single rounded bar floating on the page, not spread
// across the open width. Each is one boxed, flow-row column (see columnFlow and
// the floating-header rule in globals.css), and unlike the tone-based headers
// below, the colours are BAKED HEX from the reference itself, not theme tokens,
// so the client gets that exact look and then edits any of it. The wordmark is a
// heading the client types their own name into, or swaps for a logo image.
// ---------------------------------------------------------------------------

/** The padding inside every floating bar. Slim, so the pill stays a bar. */
const BAR_PAD = { top: 11, right: 26, bottom: 11, left: 26 } as const;

/** One column, its blocks in a row, centred: the floating-pill row shape. */
const BAR_ROW: Pick<PresetRow, 'widths' | 'columnFlow' | 'align'> = {
  widths: [1],
  columnFlow: ['row'],
  align: 'centre',
};

/** A wordmark logo, a heading in the bar's own ink, fixed size so it stays a
 *  wordmark rather than growing with the fluid type scale. */
function wordmark(text: string, colour: string): PresetBlock {
  return {
    type: 'heading',
    props: { html: text, level: 'h2', style: 'h5', textColour: colour, align: 'left', fluid: false },
  };
}

/** A bar menu in a baked link colour. Icons optional, for the icon-led bars,
 *  and small capitals for the formal and technical ones. */
function barNav(
  colour: string,
  items: ReadonlyArray<Record<string, unknown>> = LINKS,
  upper = false,
): PresetBlock {
  return {
    type: 'nav',
    props: { items, layout: 'row', collapse: 'phone', gap: 'm', linkColour: colour, uppercase: upper },
  };
}

/** The travel links with an icon each, for the icon-led bars. */
const ICON_LINKS = [
  { label: 'Home', href: '/', icon: 'home', newTab: false },
  { label: 'Holidays', href: '/holidays', icon: 'plane', newTab: false },
  { label: 'About us', href: '/about', icon: 'compass', newTab: false },
  { label: 'Contact', href: '/contact', icon: 'mail', newTab: false },
];

// ---------------------------------------------------------------------------
// The bare shapes, on the Layouts tab
// ---------------------------------------------------------------------------

export const REGION_LAYOUTS: readonly SectionPreset[] = [
  {
    id: 'layout-header-logo-menu',
    category: 'header',
    label: 'Logo left, menu right',
    description: 'The one most sites have. A picture on the left, the links on the right.',
    rows: [
      {
        widths: [1, 3],
        gap: 24,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } }],
          [{ type: 'nav', props: { items: LINKS, ...MENU_RIGHT } }],
        ],
      },
    ],
    section: { paddingY: 16, width: 'contained' },
  },
  {
    id: 'layout-header-centred',
    category: 'header',
    label: 'Centred logo, menu under it',
    description: 'A logo in the middle with the links on their own line below.',
    rows: [
      { widths: [1], columns: [[{ type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } }]] },
      { widths: [1], columns: [[{ type: 'nav', props: { items: LINKS, ...CENTRED } }]] },
    ],
    section: { paddingY: 24, width: 'contained' },
  },
  {
    id: 'layout-header-menu-only',
    category: 'header',
    label: 'Just the menu',
    description: 'Links across the middle and nothing else, for a site whose name is the page title.',
    rows: [{ widths: [1], columns: [[{ type: 'nav', props: { items: LINKS, ...CENTRED } }]] }],
    section: { paddingY: 16, width: 'contained' },
  },
  {
    id: 'layout-footer-simple',
    category: 'footer',
    label: 'Simple and centred',
    description: 'A logo, one row of links and the copyright. For a small site.',
    rows: [
      {
        widths: [1],
        columns: [
          [
            { type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } },
            { type: 'nav', props: { items: LINKS, collapse: 'never', ...CENTRED } },
            /*
              THE COPYRIGHT BLOCK, not a paragraph with a year typed into it
              (20 Aug 2026). Its year is worked out when the page is drawn, so a
              footer added today still reads correctly next January with nobody
              touching it. A typed one is right for four months and wrong for
              eight, on every site that ever used this preset.
            */
            { type: 'copyright', props: { owner: 'Your company name', suffix: 'ATOL protected. All rights reserved.', symbol: 'symbol', size: 's', align: 'centre' } },
          ],
        ],
      },
    ],
    section: { paddingY: 40 },
  },
  {
    id: 'layout-footer-columns',
    category: 'footer',
    label: 'Four columns',
    description: 'Your details and three lists of links, with nothing on them yet.',
    rows: [
      {
        widths: [2, 1, 1, 1],
        gap: 32,
        columns: [
          [
            { type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } },
            { type: 'text', props: { html: '<p>Your address, over two or three lines.</p><p>01234 567890</p>', size: 's' } },
          ],
          [
            { type: 'heading', props: { html: 'Holidays', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'Beach', href: '/beach', newTab: false },
              { label: 'City breaks', href: '/city-breaks', newTab: false },
              { label: 'Cruises', href: '/cruises', newTab: false },
            ] } },
          ],
          [
            { type: 'heading', props: { html: 'About', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'About us', href: '/about', newTab: false },
              { label: 'Reviews', href: '/reviews', newTab: false },
              { label: 'Contact', href: '/contact', newTab: false },
            ] } },
          ],
          [
            { type: 'heading', props: { html: 'Small print', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'Booking conditions', href: '/booking-conditions', newTab: false },
              { label: 'Privacy', href: '/privacy', newTab: false },
            ] } },
          ],
        ],
      },
    ],
    section: { paddingY: 48 },
  },
  {
    id: 'layout-footer-oneline',
    category: 'footer',
    label: 'One line',
    description: 'The leanest footer: a short row of links and the copyright, nothing else. For a one-page site.',
    rows: [
      {
        widths: [1],
        columns: [[
          { type: 'nav', props: { items: LINKS, collapse: 'never', ...CENTRED } },
          /* The copyright block, not a typed year: it looks after itself (see the simple footer). */
          { type: 'copyright', props: { owner: 'Your company name', suffix: 'ATOL protected. All rights reserved.', symbol: 'symbol', size: 's', align: 'centre' } },
        ]],
      },
    ],
    section: { paddingY: 24 },
  },
];

// ---------------------------------------------------------------------------
// The designed ones, on the Designed tab
// ---------------------------------------------------------------------------

export const REGION_PRESETS: readonly SectionPreset[] = [
  /*
   * The floating navbars from Andy's references come first: the pill designs,
   * in their own baked colours, each still fully editable. The tone-based
   * headers follow, for a site that wants a bar that reads as furniture.
   */
  {
    id: 'header-lumiere',
    category: 'header',
    label: 'Lumière',
    description: 'A dark, quietly luxe bar with a violet glow rising from one end and a soft lavender button. For a brand that wants to feel considered.',
    rows: [
      {
        ...BAR_ROW,
        // The reference bar is not flat: a violet aura sits in its left end and
        // fades into the near-black. The box gradient carries it.
        columnBox: [{ gradient: { from: '#43306b', to: '#12101f', angle: 105 }, radius: 36, padding: BAR_PAD, shadow: 'medium' }],
        columns: [[
          wordmark('✦ Lumière', '#f4f3fb'),
          barNav('#c3c2d6'),
          { type: 'button', props: { label: "Let's talk  →", href: '/contact', variant: 'primary', colour: '#a99cf6', textColour: '#161233' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-natura',
    category: 'header',
    label: 'Natura',
    description: 'A calm cream bar with a search to hand. For a shop or a journal with a natural, unhurried feel.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ background: '#f2eee3', radius: 36, padding: BAR_PAD, borderWidth: 1, borderColour: '#e4ddcb' }],
        columns: [[
          wordmark('❋ NATURA', '#2c2a22'),
          barNav('#54503f'),
          // The olive disc from the reference, carrying the magnifier: the one
          // round filled control that gives the cream bar its focal point.
          {
            type: 'search',
            props: { display: 'icon', placeholder: 'Search', colour: '#fbfaf4' },
            box: { background: '#8b9153', radius: 64, padding: { top: 2, right: 2, bottom: 2, left: 2 } },
          },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-nexora',
    category: 'header',
    label: 'Nexora',
    description: 'A near-black bar with a bright outlined button. A confident, technical look that sits over a pale page.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ background: '#0b0f0b', radius: 28, padding: BAR_PAD, borderWidth: 1, borderColour: '#20301f' }],
        columns: [[
          wordmark('◈ NEXORA', '#eef3ee'),
          barNav('#9aa79a', LINKS, true),
          { type: 'button', props: { label: 'Get started', href: '/contact', variant: 'secondary', outline: true, colour: '#a3e635', textColour: '#a3e635' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    /*
     * The reference sheet carries TWO Nexora bars, and they are different
     * designs, not a recolour: this one is indigo with a star mark, plain-case
     * links and a solid violet button, where the other is black, uppercase and
     * outlined lime. Missing until Andy re-shared the screenshots on 20 Aug
     * 2026 and the count came up one short.
     */
    id: 'header-nexora-violet',
    category: 'header',
    label: 'Nexora, violet',
    description: 'The indigo Nexora: a star mark, a violet glow in the bar and a solid violet button. Softer than its black sibling.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ gradient: { from: '#2b2050', to: '#0e0c1a', angle: 75 }, radius: 30, padding: BAR_PAD, borderWidth: 1, borderColour: '#262043', shadow: 'medium' }],
        columns: [[
          wordmark('✦ NEXORA', '#f0eefc'),
          barNav('#b9b3d9'),
          { type: 'button', props: { label: "Let's talk  →", href: '/contact', variant: 'primary', colour: '#7c5cf0', textColour: '#ffffff' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-astrix',
    category: 'header',
    label: 'Astrix',
    description: 'A dark bar with a small icon beside every link and a teal outlined button. Playful, but ordered.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ background: '#0c1418', radius: 30, padding: BAR_PAD, borderWidth: 1, borderColour: '#123039' }],
        columns: [[
          wordmark('▲ ASTRIX', '#eafcff'),
          barNav('#7fdfe6', ICON_LINKS),
          { type: 'button', props: { label: 'Get started  ↗', href: '/contact', variant: 'secondary', outline: true, colour: '#2dd4bf', textColour: '#2dd4bf' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-soluna',
    category: 'header',
    label: 'Soluna',
    description: 'A warm cream bar with the search out in the open. Soft and welcoming, for a shop or a stay.',
    rows: [
      {
        ...BAR_ROW,
        // The cream warms towards peach along the bar, exactly as the
        // reference does: a wash, not a stripe.
        columnBox: [{ gradient: { from: '#f7f3eb', to: '#f1ddc3', angle: 100 }, radius: 36, padding: BAR_PAD, borderWidth: 1, borderColour: '#e7e0d0' }],
        columns: [[
          wordmark('❋ SOLUNA', '#2b2820'),
          barNav('#565043'),
          { type: 'search', props: { display: 'icon', placeholder: 'Search', colour: '#565043' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-velora',
    category: 'header',
    label: 'Velora',
    description: 'A dark bar with a gold wordmark and a solid gold button. Quiet luxury, for a villa or a private tour.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ background: '#151109', radius: 30, padding: BAR_PAD, shadow: 'medium' }],
        columns: [[
          wordmark('✦ VELORA', '#dcc389'),
          barNav('#b6ac98', LINKS, true),
          { type: 'search', props: { display: 'icon', placeholder: 'Search', colour: '#b6ac98' } },
          { type: 'button', props: { label: 'Start a project  →', href: '/contact', variant: 'primary', colour: '#e6d6a8', textColour: '#221a0b' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-aurea',
    category: 'header',
    label: 'Aurea',
    description: 'The same gold luxe in a cooler dark, closed with a solid gold button. Understated and sure of itself.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ background: '#100f16', radius: 30, padding: BAR_PAD, shadow: 'medium' }],
        columns: [[
          wordmark('◈ AUREA', '#e3c77a'),
          barNav('#a9a2b0', LINKS, true),
          // Filled gold, as the reference draws it: the outlined gold twin is
          // Nexora's move, and the two must not blur into one.
          { type: 'button', props: { label: 'Start a project', href: '/contact', variant: 'primary', colour: '#e3c77a', textColour: '#221c07' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-elevate',
    category: 'header',
    label: 'Elevate',
    description: 'A black bar that ends on one bright lime disc. Sharp and modern, for a studio or an agency.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ background: '#0a0a0a', radius: 30, padding: BAR_PAD }],
        columns: [[
          wordmark('ELEVATE', '#f6f6f6'),
          barNav('#e9e9e9', LINKS, true),
          /*
           * The lime disc IS the design: the reference bar has no text button,
           * just one bright circle at the end. The reference's disc holds its
           * menu; ours holds the search, because the menu is already in the
           * bar and a control that does nothing would be worse than faithful.
           */
          {
            type: 'search',
            props: { display: 'icon', placeholder: 'Search', colour: '#0a0a0a' },
            box: { background: '#c8f647', radius: 64, padding: { top: 2, right: 2, bottom: 2, left: 2 } },
          },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-verdant',
    category: 'header',
    label: 'Verdant',
    description: 'A deep forest bar with cream links and a fine outlined button. Grounded and natural, for the outdoors.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ background: '#122217', radius: 30, padding: BAR_PAD, borderWidth: 1, borderColour: '#1e3626' }],
        columns: [[
          wordmark('🌿 VERDANT', '#e9eed8'),
          barNav('#c3cdb4'),
          { type: 'button', props: { label: 'Enquire', href: '/contact', variant: 'secondary', outline: true, colour: '#cfe0a8', textColour: '#e9eed8' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-prisma',
    category: 'header',
    label: 'Prisma',
    description: 'A clean white bar whose right end is capped in solid purple. Bright and confident, for a portfolio or a launch.',
    rows: [
      {
        /*
         * TWO PILLS, NOT ONE: the reference bar's right end is a purple shape
         * holding the button, not a purple button on a white bar. A white
         * flow-row column beside a purple one, tight gap, draws exactly that
         * split-cap silhouette, and each half stays an ordinary column.
         */
        widths: [26, 6],
        gap: 4,
        align: 'centre',
        columnFlow: ['row', 'row'],
        columnBox: [
          { background: '#ffffff', radius: 30, padding: BAR_PAD, borderWidth: 1, borderColour: '#e6e6ef', shadow: 'soft' },
          { background: '#6d28d9', radius: 30, padding: { top: 8, right: 10, bottom: 8, left: 10 }, shadow: 'soft' },
        ],
        columns: [
          [
            wordmark('◇ PRISMA', '#191826'),
            barNav('#3f3d54', LINKS, true),
          ],
          [
            { type: 'button', props: { label: 'Hire me  ↗', href: '/contact', variant: 'ghost', size: 's', textColour: '#ffffff', align: 'centre' } },
          ],
        ],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-halo',
    category: 'header',
    label: 'H.',
    description: 'A soft pastel bar washing from pink to blue, the initial in a white disc and a clean white button. Light and creative.',
    rows: [
      {
        ...BAR_ROW,
        // Pink into pale blue, as the reference washes, with the initial set
        // in its own white disc: the wordmark is one letter and a full stop,
        // and the disc is what makes it a mark rather than a typo.
        columnBox: [{ gradient: { from: '#f6e2f1', to: '#dfe9fb', angle: 100 }, radius: 34, padding: BAR_PAD, borderWidth: 1, borderColour: '#ffffff' }],
        columns: [[
          {
            ...wordmark('H.', '#2c2740'),
            box: { background: '#ffffff', radius: 64, padding: { top: 6, right: 13, bottom: 6, left: 13 }, shadow: 'soft' },
          },
          barNav('#4a4560'),
          { type: 'button', props: { label: 'Hire me  ↗', href: '/contact', variant: 'primary', colour: '#ffffff', textColour: '#332e49' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-wanderlust',
    category: 'header',
    label: 'Wanderlust',
    description: 'A frosted glass bar made to float over your opening picture. Add it, then switch on "Sit over the hero" so the photo runs behind it.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ background: 'rgba(255,255,255,0.16)', blur: 14, radius: 30, padding: BAR_PAD, borderWidth: 1, borderColour: 'rgba(255,255,255,0.55)', shadow: 'soft' }],
        columns: [[
          wordmark('✈ WANDERLUST', '#0f2033'),
          barNav('#21344f'),
          { type: 'button', props: { label: 'Plan a trip  ↗', href: '/contact', variant: 'primary', colour: '#2563eb', textColour: '#ffffff' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-lumina',
    category: 'header',
    label: 'Lumina',
    description: 'A dark glass bar with an icon on every link, for floating over a moody hero. Turn on "Sit over the hero" once it is in.',
    rows: [
      {
        ...BAR_ROW,
        columnBox: [{ background: 'rgba(18,22,38,0.30)', blur: 16, radius: 30, padding: BAR_PAD, borderWidth: 1, borderColour: 'rgba(255,255,255,0.16)', shadow: 'medium' }],
        columns: [[
          wordmark('◆ LUMINA', '#f2f6ff'),
          // The links ride inside their OWN lighter glass pill, a frame within
          // the frame: the reference's most distinctive move.
          {
            ...barNav('#e6ebfa', ICON_LINKS),
            box: { background: 'rgba(255,255,255,0.10)', radius: 64, padding: { top: 7, right: 20, bottom: 7, left: 20 }, borderWidth: 1, borderColour: 'rgba(255,255,255,0.14)' },
          },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    /*
     * The two with a Light / dark switch. Adding either turns the whole site's
     * dark mode on: the page follows the visitor's system setting, and the switch
     * lets them override it. The BAR itself keeps its baked light look in both
     * modes, on purpose. It is a chosen design, the same as every bar above, and a
     * pale bar over dark content is a real and common one; it is the page behind
     * that turns over. A client who wants the bar to move with the theme swaps its
     * baked colours for theme tokens. See the Light / dark rules in globals.css.
     */
    id: 'header-m',
    category: 'header',
    label: 'm.',
    description: 'A clean white bar, the initial on a violet disc, an icon beside every link and a sun and moon switch. Turns the whole site light or dark.',
    rows: [
      {
        ...BAR_ROW,
        // White, as the reference is: the colour lives in the violet disc the
        // initial sits on, not in the bar.
        columnBox: [{ background: '#ffffff', radius: 30, padding: BAR_PAD, borderWidth: 1, borderColour: '#ececf2', shadow: 'soft' }],
        columns: [[
          {
            ...wordmark('m.', '#ffffff'),
            box: { background: '#8b5cf6', radius: 64, padding: { top: 6, right: 13, bottom: 6, left: 13 } },
          },
          barNav('#565c6b', ICON_LINKS),
          { type: 'theme-toggle', props: { display: 'switch', colour: '#1b2130' } },
        ]],
      },
    ],
    section: { paddingY: 20, width: 'wide' },
  },
  {
    id: 'header-moksha',
    category: 'header',
    label: 'MOKSHA',
    description: 'A white bar whose bottom edge is a soft wave, with a moon switch and one dark call to action. Calm and modern. Turns the whole site light or dark.',
    rows: [
      {
        /*
         * NOT A FLOATING PILL: the wavy bottom edge is the design, and it
         * belongs to the bar itself, so this one is a full-width white bar
         * whose section carries the wave divider. The divider hangs below in
         * the bar's own colour (see hangBottomDivider in the renderer), which
         * is exactly the reference's silhouette.
         */
        ...BAR_ROW,
        columns: [[
          wordmark('◗ MOKSHA', '#141414'),
          barNav('#3a3a3a', LINKS, true),
          { type: 'theme-toggle', props: { display: 'icon', colour: '#141414' } },
          { type: 'button', props: { label: 'Get the App', href: '/contact', variant: 'primary', colour: '#141414', textColour: '#ffffff' } },
        ]],
      },
    ],
    section: { paddingY: 14, width: 'wide', dividerBottom: 'wave', dividerHeight: 18 },
  },

  /*
   * Headers
   */
  {
    id: 'header-cta-bar',
    category: 'header',
    label: 'Bar with a button',
    description: 'A tinted bar, the menu on the right, and one thing you want everybody to press.',
    rows: [
      {
        widths: [1, 3, 1],
        gap: 24,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } }],
          [{ type: 'nav', props: { items: LINKS, ...MENU_RIGHT } }],
          [{ type: 'button', props: { label: 'Enquire', href: '/contact', variant: 'primary', align: 'right' } }],
        ],
      },
    ],
    section: { paddingY: 16, width: 'contained', tone: 'subtle' },
  },
  {
    id: 'header-centred-rule',
    category: 'header',
    label: 'Centred, with a rule',
    description: 'A logo in the middle, a hairline under it, then the links. Roomier, and more formal.',
    rows: [
      { widths: [1], columns: [[{ type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } }]] },
      { widths: [1], columns: [[{ type: 'divider' }]] },
      { widths: [1], columns: [[{ type: 'nav', props: { items: LINKS, ...CENTRED } }]] },
    ],
    section: { paddingY: 24, width: 'contained', tone: 'subtle' },
  },
  {
    id: 'header-phone-cta',
    category: 'header',
    label: 'Phone number and enquire',
    description: 'For a shop. The number is the point, so it sits next to the button.',
    rows: [
      {
        widths: [1, 2, 2],
        gap: 24,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } }],
          [{ type: 'nav', props: { items: LINKS, ...MENU_RIGHT } }],
          [
            {
              type: 'button-group',
              props: {
                align: 'right',
                buttons: [
                  { label: '01234 567890', href: 'tel:01234567890', variant: 'ghost' },
                  { label: 'Enquire', href: '/contact', variant: 'primary' },
                ],
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 16, width: 'wide' },
  },
  {
    id: 'header-dark-bar',
    category: 'header',
    label: 'Dark bar',
    description: 'The same shape in the dark tone, which sits well over a bright hero below it.',
    rows: [
      {
        widths: [1, 3, 1],
        gap: 24,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } }],
          [{ type: 'nav', props: { items: LINKS, ...MENU_RIGHT } }],
          [{ type: 'button', props: { label: 'Enquire', href: '/contact', variant: 'primary', align: 'right' } }],
        ],
      },
    ],
    section: { paddingY: 16, width: 'contained', tone: 'dark' },
  },
  {
    id: 'header-social-bar',
    category: 'header',
    label: 'Menu and socials',
    description: 'The bar with your social links picked out on the right, for a brand that lives on them.',
    rows: [
      {
        widths: [1, 3, 1],
        gap: 24,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } }],
          [{ type: 'nav', props: { items: LINKS, ...MENU_RIGHT } }],
          [{ type: 'social', props: { align: 'right', size: 's' } }],
        ],
      },
    ],
    section: { paddingY: 16, width: 'contained', tone: 'subtle' },
  },

  /*
   * Footers.
   *
   * The menus here are a column list rather than a nav bar, and never collapse to
   * a burger: a footer column that hid its links behind a tap would hide the ones
   * somebody scrolled all the way down to find.
   */
  {
    id: 'footer-tinted-four',
    category: 'footer',
    label: 'Four columns and a legal line',
    description: 'The standard big footer on a tint. Your details, three lists, small print underneath.',
    rows: [
      {
        widths: [2, 1, 1, 1],
        gap: 32,
        columns: [
          [
            { type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } },
            { type: 'text', props: { html: '<p>Your address, over two or three lines.</p><p>01234 567890<br />hello@yourshop.co.uk</p>', size: 's' } },
            { type: 'social', props: { style: 'circle', size: 's' } },
          ],
          [
            { type: 'heading', props: { html: 'Holidays', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'Beach', href: '/beach', newTab: false },
              { label: 'City breaks', href: '/city-breaks', newTab: false },
              { label: 'Cruises', href: '/cruises', newTab: false },
              { label: 'Tailor made', href: '/tailor-made', newTab: false },
            ] } },
          ],
          [
            { type: 'heading', props: { html: 'About', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'About us', href: '/about', newTab: false },
              { label: 'The team', href: '/team', newTab: false },
              { label: 'Reviews', href: '/reviews', newTab: false },
              { label: 'Contact', href: '/contact', newTab: false },
            ] } },
          ],
          [
            { type: 'heading', props: { html: 'Small print', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'Booking conditions', href: '/booking-conditions', newTab: false },
              { label: 'Privacy', href: '/privacy', newTab: false },
              { label: 'Cookies', href: '/cookies', newTab: false },
            ] } },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[
          { type: 'divider' },
          { type: 'text', props: { html: '<p>Your company name, registered in England. ATOL number here, ABTA number here.</p>', size: 's' } },
        ]],
      },
    ],
    section: { paddingY: 48, tone: 'subtle' },
  },
  {
    id: 'footer-signup',
    category: 'footer',
    label: 'With a sign-up',
    description: 'A wide column for the newsletter with a button, two lists of links beside it.',
    rows: [
      {
        widths: [2, 1, 1],
        gap: 40,
        columns: [
          [
            { type: 'heading', props: { html: 'The good ones, before everybody else', style: 'h5', level: 'h3' } },
            { type: 'text', props: { html: '<p>One email a month and nothing else. Add the Newsletter widget under this line.</p>', size: 's' } },
            { type: 'button', props: { label: 'Sign up', href: '/newsletter', variant: 'primary' } },
          ],
          [
            { type: 'heading', props: { html: 'Holidays', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'Beach', href: '/beach', newTab: false },
              { label: 'City breaks', href: '/city-breaks', newTab: false },
              { label: 'Cruises', href: '/cruises', newTab: false },
            ] } },
          ],
          [
            { type: 'heading', props: { html: 'About', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'About us', href: '/about', newTab: false },
              { label: 'Contact', href: '/contact', newTab: false },
              { label: 'Privacy', href: '/privacy', newTab: false },
            ] } },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[
          { type: 'divider' },
          { type: 'text', props: { html: '<p>Your company name. ATOL number here, ABTA number here.</p>', size: 's' } },
        ]],
      },
    ],
    section: { paddingY: 48, tone: 'subtle' },
  },
  {
    id: 'footer-dark-three',
    category: 'footer',
    label: 'Dark, with three lists',
    description: 'Three lists and your details in the dark tone, which ends a light page cleanly.',
    rows: [
      {
        widths: [1, 1, 1],
        gap: 40,
        columns: [
          [
            { type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } },
            { type: 'text', props: { html: '<p>One line on who you are and how long you have been doing it.</p>', size: 's' } },
          ],
          [
            { type: 'heading', props: { html: 'Holidays', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'Beach', href: '/beach', newTab: false },
              { label: 'City breaks', href: '/city-breaks', newTab: false },
              { label: 'Cruises', href: '/cruises', newTab: false },
              { label: 'Tailor made', href: '/tailor-made', newTab: false },
            ] } },
          ],
          [
            { type: 'heading', props: { html: 'Get in touch', style: 'h6', level: 'h3' } },
            { type: 'text', props: { html: '<p>01234 567890</p><p>hello@yourshop.co.uk</p><p>Your address, over two lines.</p>', size: 's' } },
            { type: 'social', props: { style: 'circle', size: 's' } },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[
          { type: 'text', props: { html: '<p>Your company name. ATOL number here, ABTA number here.</p>', size: 's', ...CENTRED } },
        ]],
      },
    ],
    section: { paddingY: 48, tone: 'dark' },
  },
  {
    id: 'footer-centred-social',
    category: 'footer',
    label: 'Centred, with socials',
    description: 'A logo, a row of links and your socials down the middle, then the copyright.',
    rows: [
      {
        widths: [1],
        columns: [[
          { type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } },
          { type: 'nav', props: { items: LINKS, collapse: 'never', ...CENTRED } },
          { type: 'social', props: { align: 'centre' } },
          { type: 'divider' },
          /* Same reasoning as the simple footer above: the year looks after itself. */
          { type: 'copyright', props: { owner: 'Your company name', suffix: 'ATOL protected. All rights reserved.', symbol: 'symbol', size: 's', align: 'centre' } },
        ]],
      },
    ],
    section: { paddingY: 40, tone: 'subtle' },
  },
  {
    id: 'footer-dark-signup',
    category: 'footer',
    label: 'Big, dark, with a sign-up',
    description: 'The premium ending: a newsletter with a button, two lists and your details, all on the dark tone.',
    rows: [
      {
        widths: [2, 1, 1, 1],
        gap: 40,
        columns: [
          [
            { type: 'heading', props: { html: 'Never miss the good ones', style: 'h5', level: 'h3' } },
            { type: 'text', props: { html: '<p>One email a month and nothing else. Add the Newsletter widget under this line.</p>', size: 's' } },
            { type: 'button', props: { label: 'Sign up', href: '/newsletter', variant: 'primary' } },
          ],
          [
            { type: 'heading', props: { html: 'Holidays', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'Beach', href: '/beach', newTab: false },
              { label: 'City breaks', href: '/city-breaks', newTab: false },
              { label: 'Cruises', href: '/cruises', newTab: false },
              { label: 'Tailor made', href: '/tailor-made', newTab: false },
            ] } },
          ],
          [
            { type: 'heading', props: { html: 'About', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'About us', href: '/about', newTab: false },
              { label: 'Reviews', href: '/reviews', newTab: false },
              { label: 'Contact', href: '/contact', newTab: false },
            ] } },
          ],
          [
            { type: 'heading', props: { html: 'Get in touch', style: 'h6', level: 'h3' } },
            { type: 'text', props: { html: '<p>01234 567890</p><p>hello@yourshop.co.uk</p>', size: 's' } },
            { type: 'social', props: { style: 'circle', size: 's' } },
          ],
        ],
      },
      {
        widths: [1],
        columns: [[
          { type: 'divider' },
          { type: 'text', props: { html: '<p>Your company name. ATOL number here, ABTA number here.</p>', size: 's' } },
        ]],
      },
    ],
    section: { paddingY: 56, tone: 'dark' },
  },
  {
    id: 'footer-cta',
    category: 'footer',
    label: 'Call to action, then links',
    description: 'A line that asks for the booking with a button, a rule, then your details and two lists.',
    rows: [
      {
        widths: [1],
        columns: [[
          { type: 'heading', props: { html: 'Ready to plan your next trip?', style: 'h5', level: 'h2', align: 'centre' } },
          { type: 'text', props: { html: '<p>Talk to a real person who has actually been there.</p>', size: 's', ...CENTRED } },
          { type: 'button', props: { label: 'Get in touch', href: '/contact', variant: 'primary', align: 'centre' } },
        ]],
      },
      {
        widths: [2, 1, 1],
        gap: 32,
        columns: [
          [
            { type: 'divider' },
            { type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } },
            { type: 'text', props: { html: '<p>Your address, over two lines.</p><p>01234 567890</p>', size: 's' } },
          ],
          [
            { type: 'divider' },
            { type: 'heading', props: { html: 'Explore', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'Beach', href: '/beach', newTab: false },
              { label: 'City breaks', href: '/city-breaks', newTab: false },
              { label: 'Cruises', href: '/cruises', newTab: false },
            ] } },
          ],
          [
            { type: 'divider' },
            { type: 'heading', props: { html: 'Company', style: 'h6', level: 'h3' } },
            { type: 'nav', props: { ...FOOTER_MENU, items: [
              { label: 'About us', href: '/about', newTab: false },
              { label: 'Privacy', href: '/privacy', newTab: false },
              { label: 'Contact', href: '/contact', newTab: false },
            ] } },
          ],
        ],
      },
    ],
    section: { paddingY: 48, tone: 'subtle' },
  },
  {
    id: 'footer-centred-dark',
    category: 'footer',
    label: 'Centred, dark',
    description: 'A logo, a row of links and your socials down the middle on the dark tone. A clean, quiet ending.',
    rows: [
      {
        widths: [1],
        columns: [[
          { type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } },
          { type: 'nav', props: { items: LINKS, collapse: 'never', ...CENTRED } },
          { type: 'social', props: { align: 'centre' } },
          { type: 'divider' },
          { type: 'copyright', props: { owner: 'Your company name', suffix: 'ATOL protected. All rights reserved.', symbol: 'symbol', size: 's', align: 'centre' } },
        ]],
      },
    ],
    section: { paddingY: 44, tone: 'dark' },
  },
];
