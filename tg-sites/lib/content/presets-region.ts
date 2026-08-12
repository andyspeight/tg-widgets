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

import type { SectionPreset } from './preset-types';
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
const FOOTER_MENU = { layout: 'column', collapse: false } as const;

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
            { type: 'nav', props: { items: LINKS, collapse: false, ...CENTRED } },
            { type: 'text', props: { html: '<p>Your company name. ATOL protected. All rights reserved.</p>', size: 's', ...CENTRED } },
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
];

// ---------------------------------------------------------------------------
// The designed ones, on the Designed tab
// ---------------------------------------------------------------------------

export const REGION_PRESETS: readonly SectionPreset[] = [
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
          { type: 'nav', props: { items: LINKS, collapse: false, ...CENTRED } },
          { type: 'social', props: { align: 'centre' } },
          { type: 'divider' },
          { type: 'text', props: { html: '<p>Your company name. ATOL protected. All rights reserved.</p>', size: 's', ...CENTRED } },
        ]],
      },
    ],
    section: { paddingY: 40, tone: 'subtle' },
  },
];
