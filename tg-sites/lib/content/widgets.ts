/**
 * The Travelgenix widgets a page can carry, as a closed list.
 *
 * WHY THIS FILE IS A LIST AND NOT A TEXT BOX
 *
 * This is the same decision as the analytics setting, for the same reason. A
 * client could be asked to paste the embed snippet their widgets dashboard gives
 * them, and that snippet contains a script tag, which is a script tag on a live
 * travel site typed by whoever has the weakest password in the agency.
 *
 * So instead: the client picks a NAME from this list and gives an id. The script
 * address is built HERE, from a tag that is in this file, on an origin that is in
 * this file. Nothing the client types ever becomes a URL, let alone code. That is
 * what makes this block safe enough for a travel agent to use on their own,
 * rather than a staff-only escape hatch like the Embed block.
 *
 * WHERE THIS LIST COMES FROM, AND HOW IT DRIFTS
 *
 * public/index.html holds the widget suite's own registry: name, widgetTag and
 * sometimes scriptFile. This is a copy, because tg-sites is a separate Vercel
 * project and cannot read that file at runtime. A copy drifts, so
 * tests/content.test.ts reads the real registry off disk (both live in this
 * repo) and fails if a tag here has no matching script.
 *
 * THE SCRIPT NAME IS NOT ALWAYS widget-<tag>.js. Pricing Table is served from
 * /widget.js: it predates the naming convention and its registry entry carries
 * an explicit scriptFile. That was found by cross-checking rather than by
 * reading, and it is exactly the sort of thing that would have shipped as a 404
 * and a widget that never appears.
 */

/**
 * Where the widget scripts are served from.
 *
 * The branded alias rather than tg-widgets.vercel.app, which is the same
 * deployment. A client's published page should not show a vercel.app URL in its
 * source, and the alias is the one that survives a hosting change.
 */
export const WIDGET_ORIGIN = 'https://widgets.travelify.io';

export interface WidgetKind {
  /** The tag in the embed contract's data-tg-widget attribute. */
  tag: string;
  /** What it is called on the widgets dashboard. */
  label: string;
  /** The file under WIDGET_ORIGIN. Usually widget-<tag>.js, not always. */
  script: string;
  /** Grouped in the picker, because thirty-seven in one list is a wall. */
  group: 'Travel' | 'Content' | 'Trust' | 'Getting in touch' | 'Tools';
}

/**
 * The widgets that belong IN A COLUMN.
 *
 * Eight of the suite's forty-five are deliberately absent, and it is not an
 * oversight: Back to Top, Loader, Popup, Cookie Consent, WhatsApp Chat, Deal
 * Bar, Smart Section and Email Signature. The first six float or sit across the
 * whole site rather than in a column, Smart Section wraps content that already
 * exists, and Email Signature is not a website widget at all. Offering them here
 * would be a control that looks like it works and does nothing, which is the
 * rule this codebase keeps coming back to. They want a site-wide setting, and
 * that is a different job.
 */
export const WIDGET_KINDS: readonly WidgetKind[] = [
  // --- Travel -------------------------------------------------------------
  { tag: 'offers', label: 'Travel Offers', script: 'widget-offers.js', group: 'Travel' },
  { tag: 'offers-grid', label: 'Special Offers', script: 'widget-offers-grid.js', group: 'Travel' },
  { tag: 'spotlight', label: 'Destination Spotlight', script: 'widget-spotlight.js', group: 'Travel' },
  { tag: 'airport', label: 'Airport Spotlight', script: 'widget-airport.js', group: 'Travel' },
  { tag: 'attraction', label: 'Attraction Spotlight', script: 'widget-attraction.js', group: 'Travel' },
  { tag: 'carousel', label: 'Destination Carousel', script: 'widget-carousel.js', group: 'Travel' },
  { tag: 'travel-results-ai', label: 'Travel Results AI', script: 'widget-travel-results-ai.js', group: 'Travel' },
  { tag: 'trips', label: 'Group Trips', script: 'widget-trips.js', group: 'Travel' },
  { tag: 'worldmap', label: 'World Map', script: 'widget-worldmap.js', group: 'Travel' },
  { tag: 'flighttime', label: 'Flight Time and Distance', script: 'widget-flighttime.js', group: 'Travel' },
  { tag: 'weather', label: 'Weather', script: 'widget-weather.js', group: 'Travel' },
  { tag: 'currency', label: 'Currency Converter', script: 'widget-currency.js', group: 'Travel' },
  { tag: 'worldclock', label: 'World Clock', script: 'widget-worldclock.js', group: 'Travel' },

  // --- Trust --------------------------------------------------------------
  { tag: 'reviews', label: 'Reviews', script: 'widget-reviews.js', group: 'Trust' },
  { tag: 'testimonials', label: 'Testimonials', script: 'widget-testimonials.js', group: 'Trust' },
  { tag: 'logos', label: 'Logo Showcase', script: 'widget-logos.js', group: 'Trust' },
  { tag: 'statscounter', label: 'Stats Counter', script: 'widget-statscounter.js', group: 'Trust' },
  { tag: 'team', label: 'Team Showcase', script: 'widget-team.js', group: 'Trust' },

  // --- Getting in touch ---------------------------------------------------
  { tag: 'enquiry', label: 'Enquiry Form', script: 'widget-enquiry.js', group: 'Getting in touch' },
  { tag: 'enquirypro', label: 'Enquiry Pro', script: 'widget-enquirypro.js', group: 'Getting in touch' },
  { tag: 'form', label: 'Form', script: 'widget-form.js', group: 'Getting in touch' },
  { tag: 'appointment', label: 'Appointment Scheduler', script: 'widget-appointment.js', group: 'Getting in touch' },
  { tag: 'newsletter', label: 'Newsletter Signup', script: 'widget-newsletter.js', group: 'Getting in touch' },
  { tag: 'contact', label: 'Contact Card', script: 'widget-contact.js', group: 'Getting in touch' },
  { tag: 'hours', label: 'Opening Hours', script: 'widget-hours.js', group: 'Getting in touch' },
  { tag: 'mybooking', label: 'My Booking', script: 'widget-mybooking.js', group: 'Getting in touch' },

  // --- Content ------------------------------------------------------------
  { tag: 'faq', label: 'FAQ Accordion', script: 'widget-faq.js', group: 'Content' },
  { tag: 'events', label: 'Event Calendar', script: 'widget-events.js', group: 'Content' },
  { tag: 'maps', label: 'Maps', script: 'widget-maps.js', group: 'Content' },
  { tag: 'youtube', label: 'YouTube', script: 'widget-youtube.js', group: 'Content' },
  { tag: 'rss', label: 'RSS News Feed', script: 'widget-rss.js', group: 'Content' },
  { tag: 'textfx', label: 'Text FX', script: 'widget-textfx.js', group: 'Content' },
  { tag: 'prism', label: 'Prism', script: 'widget-prism.js', group: 'Content' },

  // --- Tools --------------------------------------------------------------
  // Pricing Table is the one whose script is not named after its tag. See the
  // header: it predates the convention and is served from /widget.js.
  { tag: 'pricing', label: 'Pricing Table', script: 'widget.js', group: 'Tools' },
  { tag: 'countdown', label: 'Countdown Timer', script: 'widget-countdown.js', group: 'Tools' },
  { tag: 'spinwheel', label: 'Spin the Wheel', script: 'widget-spinwheel.js', group: 'Tools' },
  { tag: 'share', label: 'Social Share', script: 'widget-share.js', group: 'Tools' },
  { tag: 'quote-pdf', label: 'Quote PDF', script: 'widget-quote-pdf.js', group: 'Tools' },
];

export const WIDGET_GROUPS = [
  'Travel',
  'Trust',
  'Getting in touch',
  'Content',
  'Tools',
] as const;

/** The kind with this tag, or undefined. The only way tags are resolved. */
export function widgetKind(tag: unknown): WidgetKind | undefined {
  return typeof tag === 'string'
    ? WIDGET_KINDS.find((kind) => kind.tag === tag)
    : undefined;
}

/**
 * The script URL for a tag, or null when the tag is not one of ours.
 *
 * NULL RATHER THAN A GUESS. Building `${WIDGET_ORIGIN}/widget-${tag}.js` from an
 * unknown tag would put whatever a client typed into a script src, which is the
 * whole thing this file exists to prevent. An unknown tag means no script, and
 * the renderer draws a placeholder instead.
 */
export function widgetScriptUrl(tag: unknown): string | null {
  const kind = widgetKind(tag);
  return kind ? `${WIDGET_ORIGIN}/${kind.script}` : null;
}

/**
 * The floating widgets that live in a site-wide SETTING rather than a column.
 *
 * These are the ones the excluded-8 note above sends here: they float or sit
 * across the whole site, so a client sets them once and the published shell
 * emits one container per enabled one on every page (see
 * components/render/FloatingWidgets.tsx). A CLOSED LIST, exactly like
 * WIDGET_KINDS and for the same reason: the tag decides a script src, so it can
 * only ever be one of these, never something a client typed. Kept DISJOINT from
 * WIDGET_KINDS, so a floating tag can never also be dropped in a column, which
 * would put two containers and two inits of the same widget on one page.
 *
 * Popup carries a large surface (eight layouts, six content types, page and
 * device targeting, scheduling). The panel exposes the announcement content use
 * of it, plus the full trigger vocabulary the widget already understands (load,
 * delay, scroll, exit intent, inactivity, pageviews, a click on a named element),
 * a page rule (show on or hide from named paths) and how often it shows. Who sees
 * it rides the shared audience control (personalisation v2). The content types
 * beyond the announcement, and scheduling, keep the widget's own defaults.
 */
export const FLOATING_WIDGET_TAGS = ['backtotop', 'whatsapp', 'dealbar', 'loader', 'popup'] as const;

export type FloatingWidgetTag = (typeof FLOATING_WIDGET_TAGS)[number];

/**
 * The script url for a floating widget. Takes a tag from the closed list above,
 * so `${WIDGET_ORIGIN}/widget-<tag>.js` is built only from a value we control.
 */
export function floatingWidgetScriptUrl(tag: FloatingWidgetTag): string {
  return `${WIDGET_ORIGIN}/widget-${tag}.js`;
}

/**
 * A widget config id, or null.
 *
 * The ids the widgets API issues are `tgw_` and then a short code. Checked so a
 * mistyped one is refused while it can still be corrected, rather than becoming
 * an empty box on a published page. Not a security boundary, since the id only
 * ever lands in an attribute the renderer escapes: it is an honesty boundary.
 */
const WIDGET_ID = /^tgw_[A-Za-z0-9_-]{4,64}$/;

export function safeWidgetId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tidy = value.trim();
  return WIDGET_ID.test(tidy) ? tidy : null;
}

/**
 * Every distinct script a page needs, in the order the widgets first appear.
 *
 * ONE SCRIPT PER TAG, however many blocks use it. Three Opening Hours widgets on
 * a page is one script and three containers: the widget files auto-init on every
 * matching container and carry a double-init guard, so loading the file twice
 * would be wasted bytes at best and a double-init race at worst.
 */
/** Every widget tag on a page, in document order, including repeats. */
export function widgetTagsIn(page: {
  sections: ReadonlyArray<{
    rows: ReadonlyArray<{
      columns: ReadonlyArray<{
        blocks: ReadonlyArray<{ type: string; props?: Record<string, unknown> }>;
      }>;
    }>;
  }>;
}): string[] {
  const tags: string[] = [];
  for (const section of page.sections) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (block.type !== 'widget') continue;
          const tag = block.props?.widget;
          if (typeof tag === 'string') tags.push(tag);
        }
      }
    }
  }
  return tags;
}

export function widgetScriptsFor(tags: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const tag of tags) {
    const url = widgetScriptUrl(tag);
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}
