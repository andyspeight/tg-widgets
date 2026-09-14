/**
 * Widget categories as the Travelify platform's directory expects them.
 *
 * Travelify filters its directory by exact string match against a controlled
 * list of its own, so every widget we expose over /api/v1/ must carry exactly
 * one of those strings. Our dashboard's own categories (Bookings, Events,
 * Engagement, Information, Lead Gen, Social Proof, Marketing, Compliance) are
 * a different taxonomy built for a travel-trade audience, and only "Content"
 * appears in both. This file is the translation layer, so the dashboard keeps
 * its own categories and neither side has to bend to the other.
 *
 * Mapped by widget id rather than by dashboard category on purpose: our
 * "Content" bucket alone spans Travel (Destination Spotlight), Video (YouTube)
 * and Content proper (FAQ), so a category-to-category map would be markedly
 * worse than a per-widget one.
 *
 * Known wrinkle (14 Sep 2026): Travelify's list has no home for our Bookings
 * (9 widgets) or Events (7) families, so both land in Travel and it now holds
 * 25 of the 56. We have asked Travelify to add "Bookings" and "Events" to
 * their filter tabs. If they agree, move those ids here and add the two
 * strings to TRAVELIFY_CATEGORIES; nothing else needs to change.
 */

/**
 * The controlled list, exactly as Travelify spells it. "All Widgets" is a
 * filter on their side rather than a category, so it never appears here.
 */
export const TRAVELIFY_CATEGORIES = Object.freeze([
  'Travel',
  'Travel Quotes',
  'Reviews',
  'E-Commerce',
  'Chat',
  'Forms',
  'Social',
  'Content',
  'Video',
  'Audio',
  'Other Tools',
]);

/** Returned for any widget missing from the map below. */
export const FALLBACK_CATEGORY = 'Other Tools';

export const PUBLIC_CATEGORY_BY_ID = Object.freeze({
  // Travel — destination content, live availability, and anything that sells
  // or services a trip. Includes the Bookings and Events families for now.
  spotlight: 'Travel',
  airport: 'Travel',
  attraction: 'Travel',
  weather: 'Travel',
  prayer: 'Travel',
  currency: 'Travel',
  worldclock: 'Travel',
  flighttime: 'Travel',
  maps: 'Travel',
  carousel: 'Travel',
  dealbar: 'Travel',
  mybooking: 'Travel',
  offers: 'Travel',
  'tti-offers': 'Travel',
  'special-offers': 'Travel',
  trips: 'Travel',
  tour: 'Travel',
  worldmap: 'Travel',
  tickets: 'Travel',
  nextevent: 'Travel',
  clubpicker: 'Travel',
  ticketsearch: 'Travel',
  ticketmonth: 'Travel',
  eventmenu: 'Travel',
  venueguide: 'Travel',

  // Travel Quotes — puts a priced itinerary in front of a customer.
  'quote-pdf': 'Travel Quotes',
  'travel-results-ai': 'Travel Quotes',

  // Reviews — third-party and first-party social proof.
  reviews: 'Reviews',
  testimonials: 'Reviews',

  // E-Commerce
  pricing: 'E-Commerce',

  // Chat
  whatsapp: 'Chat',

  // Forms — anything whose job is to capture a visitor's details.
  form: 'Forms',
  enquiry: 'Forms',
  enquirypro: 'Forms',
  appointment: 'Forms',
  newsletter: 'Forms',
  popup: 'Forms',

  // Social
  share: 'Social',

  // Content — page furniture and editorial blocks.
  faq: 'Content',
  rss: 'Content',
  prism: 'Content',
  textfx: 'Content',
  team: 'Content',
  logos: 'Content',
  statscounter: 'Content',
  'event-calendar': 'Content',
  smartsection: 'Content',

  // Video
  youtube: 'Video',

  // Audio — nothing in the suite belongs here yet.

  // Other Tools — site utilities with no better home.
  spinwheel: 'Other Tools',
  backtotop: 'Other Tools',
  loader: 'Other Tools',
  countdown: 'Other Tools',
  hours: 'Other Tools',
  emailsig: 'Other Tools',
  contact: 'Other Tools',
  consent: 'Other Tools',
});

/**
 * The Travelify category for a widget id.
 *
 * Falls back to "Other Tools" rather than throwing so a widget added to the
 * dashboard without updating this map still returns a contract-valid response.
 * The drift test fails on the missing entry, so the gap is caught in CI rather
 * than by Travelify.
 */
export function publicCategoryFor(widgetId) {
  return PUBLIC_CATEGORY_BY_ID[widgetId] || FALLBACK_CATEGORY;
}
