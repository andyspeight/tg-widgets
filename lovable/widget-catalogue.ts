/**
 * Catalogue of Travelgenix widgets available through <TgWidget />.
 *
 * `description` is a one-line summary. `example` is a minimal, valid config you
 * can pass straight to <TgWidget type=... config={example} />. Configs are
 * per-widget — these examples are starting points, not the full schema. The
 * authoritative config for each widget is whatever its demo/editor page in the
 * suite produces (the JSON it writes to data-tg-config).
 */

import type { TgWidgetType } from './TgWidget';

export interface WidgetCatalogueEntry {
  type: TgWidgetType;
  name: string;
  description: string;
  /** A minimal config that renders something sensible. May be empty. */
  example: Record<string, unknown>;
}

export const WIDGET_CATALOGUE: WidgetCatalogueEntry[] = [
  {
    type: 'currency',
    name: 'Currency converter',
    description: 'Live travel-money converter with ECB rates and flags.',
    example: {
      heading: 'Currency converter',
      currencies: ['GBP', 'EUR', 'USD', 'AUD', 'THB'],
      defaultFrom: 'GBP',
      defaultTo: 'EUR',
      defaultAmount: 500,
      accent: '#0891B2',
      layout: 'card',
      showFlags: true,
      showRate: true,
    },
  },
  {
    type: 'weather',
    name: 'Destination weather',
    description: 'Climate, best-months and weather panel for a destination.',
    example: {
      layout: 'standard',
      brandColor: '#1B2B5B',
      accentColor: '#00B4D8',
      temperatureUnit: 'C',
      showFlag: true,
    },
  },
  {
    type: 'reviews',
    name: 'Reviews',
    description: 'Customer review wall with ratings and filtering.',
    example: { layout: 'grid', accent: '#0891B2' },
  },
  {
    type: 'testimonials',
    name: 'Testimonials',
    description: 'Rotating testimonial cards.',
    example: { layout: 'carousel' },
  },
  {
    type: 'faq',
    name: 'FAQ',
    description: 'Accordion FAQ with optional search.',
    example: { accent: '#0891B2' },
  },
  {
    type: 'countdown',
    name: 'Countdown',
    description: 'Countdown timer to a date (offers, departures, launches).',
    example: { theme: 'light' },
  },
  {
    type: 'logos',
    name: 'Logo wall',
    description: 'Supplier / partner logo strip.',
    example: { layout: 'strip' },
  },
  {
    type: 'enquiry',
    name: 'Enquiry form',
    description: 'Multi-step travel enquiry form.',
    example: {},
  },
  {
    type: 'newsletter',
    name: 'Newsletter signup',
    description: 'Email capture with double opt-in support.',
    example: {},
  },
  {
    type: 'offers',
    name: 'Offers',
    description: 'Holiday offers grid/list driven by the offers feed.',
    example: {},
  },
  {
    type: 'worldclock',
    name: 'World clock',
    description: 'Times across multiple destinations.',
    example: {},
  },
  {
    type: 'flighttime',
    name: 'Flight time',
    description: 'Estimated flight duration between two airports.',
    example: {},
  },
];

/** Every widget type, for pickers and validation. */
export const WIDGET_TYPES: TgWidgetType[] = [
  'airport',
  'appointment',
  'attraction',
  'backtotop',
  'carousel',
  'contact',
  'countdown',
  'currency',
  'dealbar',
  'enquiry',
  'enquirypro',
  'events',
  'faq',
  'flighttime',
  'hours',
  'loader',
  'logos',
  'maps',
  'mybooking',
  'newsletter',
  'offer-builder',
  'offer-card',
  'offer-page',
  'offers',
  'offers-grid',
  'popup',
  'quote-pdf',
  'reviews',
  'rss',
  'share',
  'spinwheel',
  'spotlight',
  'statscounter',
  'team',
  'testimonials',
  'textfx',
  'travel-results-ai',
  'weather',
  'whatsapp',
  'worldclock',
  'worldmap',
  'youtube',
];
