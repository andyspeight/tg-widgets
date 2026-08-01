/**
 * Designed headers and footers.
 *
 * WHY THESE EXIST. The Header and Footer screens shipped on 31 Jul 2026 and a
 * client who opens either one meets a blank page. Every site needs both, almost
 * every site wants the same handful of arrangements, and asking somebody to
 * build a nav bar out of a two-column row and a Menu block is asking them to
 * design site chrome before they have designed a page.
 *
 * THEY ARE ORDINARY SECTION PRESETS. A region is sections, rows, columns and
 * blocks exactly as a page is, which is the decision the whole region feature
 * rests on, so a header preset needs no machinery of its own. The only thing
 * separating them from the page ones is the `scope` on their category, which is
 * what stops a four-column footer being offered in the middle of a page.
 *
 * WHAT A HEADER PRESET GETS RIGHT THAT A HAND-BUILT ONE USUALLY DOES NOT
 *
 *   - The row is CENTRE aligned, so a tall logo and a one-line menu sit on the
 *     same line rather than the menu clinging to the top of the logo.
 *   - The section padding is small. A header with a page section's padding is a
 *     header that takes up a third of a phone screen.
 *   - The menu is on the RIGHT of its column, because that is where a menu
 *     goes when the logo is on the left, and the Menu block defaults to left.
 *   - Nothing is sticky or overlaid. Both are region settings rather than
 *     section ones, they apply to the whole header, and they are one tick box
 *     each in the properties pane. A preset that turned them on would be making
 *     a decision the client has not been asked about yet.
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

export const REGION_PRESETS: readonly SectionPreset[] = [
  /*
   * -------------------------------------------------------------------------
   * Header
   * -------------------------------------------------------------------------
   */
  {
    id: 'header-logo-menu',
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
    id: 'header-logo-menu-button',
    category: 'header',
    label: 'Logo, menu and a button',
    description: 'The same, with one thing you want everybody to press.',
    rows: [
      {
        widths: [1, 3, 1],
        gap: 24,
        align: 'centre',
        columns: [
          [{ type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } }],
          [{ type: 'nav', props: { items: LINKS, ...MENU_RIGHT } }],
          [{ type: 'button', props: { label: 'Enquire', href: '/contact', align: 'right' } }],
        ],
      },
    ],
    section: { paddingY: 16, width: 'contained' },
  },

  {
    id: 'header-centred-logo',
    category: 'header',
    label: 'Centred logo, menu under it',
    description: 'A logo in the middle with the links on their own line below. Roomier, and more formal.',
    rows: [
      {
        widths: [1],
        columns: [
          [{ type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } }],
        ],
      },
      {
        widths: [1],
        columns: [[{ type: 'nav', props: { items: LINKS, ...CENTRED } }]],
      },
    ],
    section: { paddingY: 24, width: 'contained' },
  },

  {
    id: 'header-with-phone',
    category: 'header',
    label: 'Logo, phone number and a button',
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
    id: 'header-two-tier',
    category: 'header',
    label: 'A slim strip above the bar',
    description: 'A thin dark line for the phone number and opening hours, then the header under it.',
    rows: [
      {
        widths: [1, 1],
        gap: 16,
        align: 'centre',
        columns: [
          [
            {
              type: 'text',
              props: { html: '<p>Open Monday to Saturday, 9 until 5.30</p>', size: 's' },
            },
          ],
          [
            {
              type: 'text',
              props: { html: '<p>Call us on 01234 567890</p>', size: 's', align: 'right' },
            },
          ],
        ],
      },
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
    section: { paddingY: 12, width: 'contained' },
  },

  {
    id: 'header-menu-only',
    category: 'header',
    label: 'Just the menu',
    description: 'Links across the middle and nothing else. For a site whose name is the page title.',
    rows: [
      {
        widths: [1],
        columns: [[{ type: 'nav', props: { items: LINKS, ...CENTRED } }]],
      },
    ],
    section: { paddingY: 16, width: 'contained' },
  },

  /*
   * -------------------------------------------------------------------------
   * Footer
   * -------------------------------------------------------------------------
   *
   * The menus here are `layout: 'column'` and `collapse: false`, which is the
   * pair of settings that turns the Menu block from a nav bar into a list of
   * links. Collapse off matters: a footer column that became a burger on a
   * phone would hide the links somebody scrolled all the way down to find.
   */
  {
    id: 'footer-four-columns',
    category: 'footer',
    label: 'Four columns and a legal line',
    description: 'The standard big footer. Your details, three lists of links, small print underneath.',
    rows: [
      {
        widths: [2, 1, 1, 1],
        gap: 32,
        columns: [
          [
            { type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } },
            {
              type: 'text',
              props: {
                html: '<p>Your address, over two or three lines.</p><p>01234 567890<br />hello@yourshop.co.uk</p>',
                size: 's',
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'Holidays', style: 'h6', level: 'h3' } },
            {
              type: 'nav',
              props: {
                layout: 'column',
                collapse: false,
                items: [
                  { label: 'Beach', href: '/beach', newTab: false },
                  { label: 'City breaks', href: '/city-breaks', newTab: false },
                  { label: 'Cruises', href: '/cruises', newTab: false },
                  { label: 'Tailor made', href: '/tailor-made', newTab: false },
                ],
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'About', style: 'h6', level: 'h3' } },
            {
              type: 'nav',
              props: {
                layout: 'column',
                collapse: false,
                items: [
                  { label: 'About us', href: '/about', newTab: false },
                  { label: 'The team', href: '/team', newTab: false },
                  { label: 'Reviews', href: '/reviews', newTab: false },
                  { label: 'Contact', href: '/contact', newTab: false },
                ],
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'Small print', style: 'h6', level: 'h3' } },
            {
              type: 'nav',
              props: {
                layout: 'column',
                collapse: false,
                items: [
                  { label: 'Booking conditions', href: '/booking-conditions', newTab: false },
                  { label: 'Privacy', href: '/privacy', newTab: false },
                  { label: 'Cookies', href: '/cookies', newTab: false },
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
            { type: 'divider' },
            {
              type: 'text',
              props: {
                html: '<p>Your company name, registered in England. ATOL number here, ABTA number here.</p>',
                size: 's',
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 48, tone: 'subtle' },
  },

  {
    id: 'footer-simple-centred',
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
            {
              type: 'text',
              props: {
                html: '<p>Your company name. ATOL protected. All rights reserved.</p>',
                size: 's',
                ...CENTRED,
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 40 },
  },

  {
    id: 'footer-newsletter',
    category: 'footer',
    label: 'With a sign-up',
    description: 'A wide column for the newsletter, two lists of links beside it.',
    rows: [
      {
        widths: [2, 1, 1],
        gap: 40,
        columns: [
          [
            { type: 'heading', props: { html: 'The good ones, before everybody else', style: 'h5', level: 'h3' } },
            {
              type: 'text',
              props: {
                html: '<p>One email a month and nothing else. Add the Newsletter widget under this line.</p>',
                size: 's',
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'Holidays', style: 'h6', level: 'h3' } },
            {
              type: 'nav',
              props: {
                layout: 'column',
                collapse: false,
                items: [
                  { label: 'Beach', href: '/beach', newTab: false },
                  { label: 'City breaks', href: '/city-breaks', newTab: false },
                  { label: 'Cruises', href: '/cruises', newTab: false },
                ],
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'About', style: 'h6', level: 'h3' } },
            {
              type: 'nav',
              props: {
                layout: 'column',
                collapse: false,
                items: [
                  { label: 'About us', href: '/about', newTab: false },
                  { label: 'Contact', href: '/contact', newTab: false },
                  { label: 'Privacy', href: '/privacy', newTab: false },
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
            { type: 'divider' },
            {
              type: 'text',
              props: { html: '<p>Your company name. ATOL number here, ABTA number here.</p>', size: 's' },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 48, tone: 'subtle' },
  },

  {
    id: 'footer-contact-and-links',
    category: 'footer',
    label: 'Contact left, links right',
    description: 'Your address and hours on one side, two lists on the other.',
    rows: [
      {
        widths: [1, 1],
        gap: 48,
        columns: [
          [
            { type: 'heading', props: { html: 'Come and see us', style: 'h5', level: 'h3' } },
            {
              type: 'text',
              props: {
                html: '<p>Your address, over two or three lines.</p><p>Open Monday to Saturday, 9 until 5.30.</p><p>01234 567890</p>',
                size: 's',
              },
            },
          ],
          [
            {
              type: 'nav',
              props: {
                layout: 'column',
                collapse: false,
                align: 'right',
                items: [
                  { label: 'Holidays', href: '/holidays', newTab: false },
                  { label: 'About us', href: '/about', newTab: false },
                  { label: 'Reviews', href: '/reviews', newTab: false },
                  { label: 'Contact', href: '/contact', newTab: false },
                  { label: 'Booking conditions', href: '/booking-conditions', newTab: false },
                  { label: 'Privacy', href: '/privacy', newTab: false },
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
            { type: 'divider' },
            {
              type: 'text',
              props: { html: '<p>Your company name. ATOL number here, ABTA number here.</p>', size: 's' },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 48 },
  },

  {
    id: 'footer-dark',
    category: 'footer',
    label: 'Dark, with three lists',
    description: 'The same shape in the dark tone, which ends a light page cleanly.',
    rows: [
      {
        widths: [1, 1, 1],
        gap: 40,
        columns: [
          [
            { type: 'image', props: { ratio: 'auto', fit: 'contain', radius: 'none', alt: 'Your logo', href: '/' } },
            {
              type: 'text',
              props: { html: '<p>One line on who you are and how long you have been doing it.</p>', size: 's' },
            },
          ],
          [
            { type: 'heading', props: { html: 'Holidays', style: 'h6', level: 'h3' } },
            {
              type: 'nav',
              props: {
                layout: 'column',
                collapse: false,
                items: [
                  { label: 'Beach', href: '/beach', newTab: false },
                  { label: 'City breaks', href: '/city-breaks', newTab: false },
                  { label: 'Cruises', href: '/cruises', newTab: false },
                  { label: 'Tailor made', href: '/tailor-made', newTab: false },
                ],
              },
            },
          ],
          [
            { type: 'heading', props: { html: 'Get in touch', style: 'h6', level: 'h3' } },
            {
              type: 'text',
              props: {
                html: '<p>01234 567890</p><p>hello@yourshop.co.uk</p><p>Your address, over two lines.</p>',
                size: 's',
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
              type: 'text',
              props: {
                html: '<p>Your company name. ATOL number here, ABTA number here.</p>',
                size: 's',
                ...CENTRED,
              },
            },
          ],
        ],
      },
    ],
    section: { paddingY: 48, tone: 'dark' },
  },
];
