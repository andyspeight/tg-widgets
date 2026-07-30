/**
 * Turning site settings into the tags a rendered page needs.
 *
 * Pure. Takes settings and hands back plain descriptions of links, meta tags and
 * script snippets, so all of it is testable in Node and the React that renders it
 * has no decisions left to make. Same split as lib/theme/fonts.ts.
 *
 * WHY THE ANALYTICS SNIPPETS ARE BUILT HERE RATHER THAN STORED
 *
 * Because then a client cannot change what runs, only which container it reports
 * to. The settings hold `GTM-ABC1234`; this file holds the code. See the note at
 * the top of lib/settings/schema.ts.
 *
 * THE ONE THING THAT MAKES THAT SAFE, STATED PLAINLY: the ids are matched against
 * /^GTM-[A-Z0-9]{4,12}$/ and /^G-[A-Z0-9]{6,12}$/ before they get here, so neither
 * can contain a quote, an angle bracket, a semicolon or a backslash. That is why
 * interpolating one into a script string below is not an injection. The validation
 * IS the escaping, and the two must not be separated: if the patterns are ever
 * loosened, this file becomes the hole.
 */

import type { SiteSettings } from './schema';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

export interface LinkTag {
  rel: string;
  href: string;
  sizes?: string;
  type?: string;
}

/**
 * The favicon and the home screen icon.
 *
 * sizes="any" on the favicon rather than a list of exact sizes, because we do not
 * resize: the client uploads one image and the browser scales it. Claiming
 * sizes="16x16 32x32" for a 512px PNG would be a promise about bytes we have not
 * made. "any" is the honest answer and is what a modern browser prefers anyway.
 *
 * 180x180 IS claimed for the Apple touch icon, because that is the size iOS asks
 * for and the attribute is how it picks between candidates. It is a request for a
 * slot rather than an assertion about the file.
 */
export function iconLinks(settings: SiteSettings): LinkTag[] {
  const links: LinkTag[] = [];

  if (settings.faviconUrl) {
    links.push({ rel: 'icon', href: settings.faviconUrl, sizes: 'any' });
  }

  if (settings.touchIconUrl) {
    links.push({ rel: 'apple-touch-icon', href: settings.touchIconUrl, sizes: '180x180' });
  }

  /*
   * The manifest, only when there is an icon to put in it.
   *
   * An empty manifest makes Android offer to install a site as an app and then
   * show it with a screenshot of the page as its icon, which looks broken. No
   * icon, no manifest, no offer.
   */
  if (settings.touchIconUrl) {
    links.push({ rel: 'manifest', href: '/manifest.webmanifest' });
  }

  return links;
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export interface MetaTag {
  property?: string;
  name?: string;
  content: string;
}

/**
 * What a link to this page looks like when somebody pastes it somewhere.
 *
 * The page's own image wins over the site default, because a page about Santorini
 * should not share as the agency logo when somebody has chosen a photograph for
 * it. The site default is the floor, not the rule.
 *
 * og: uses `property` and twitter: uses `name`. They look interchangeable and are
 * not: Open Graph is RDFa and Twitter's cards are plain meta names, so swapping
 * them gives two tags that validate and neither of which is read.
 */
export function socialMetas(
  settings: SiteSettings,
  page: { title: string; description?: string | null; image?: string | null; url?: string | null },
): MetaTag[] {
  const metas: MetaTag[] = [];
  const image = page.image || settings.socialImageUrl;

  metas.push({ property: 'og:type', content: 'website' });
  metas.push({ property: 'og:title', content: page.title });
  if (page.description) metas.push({ property: 'og:description', content: page.description });
  if (page.url) metas.push({ property: 'og:url', content: page.url });
  metas.push({ property: 'og:locale', content: settings.locale.replace('-', '_') });

  if (image) {
    metas.push({ property: 'og:image', content: image });
    /*
     * summary_large_image only when there IS an image.
     *
     * Asking for the large card without one gives a card with a blank grey
     * rectangle where the picture should be, which looks worse than the plain
     * summary card the absence would have produced.
     */
    metas.push({ name: 'twitter:card', content: 'summary_large_image' });
    metas.push({ name: 'twitter:image', content: image });
  } else {
    metas.push({ name: 'twitter:card', content: 'summary' });
  }

  metas.push({ name: 'twitter:title', content: page.title });
  if (page.description) metas.push({ name: 'twitter:description', content: page.description });

  return metas;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface Analytics {
  /** Inline scripts for the head, in order. */
  headInline: string[];
  /** External scripts for the head. */
  headSrc: string[];
  /** Markup for the end of the body. The tag manager noscript fallback. */
  bodyMarkup: string[];
  /**
   * True when both GTM and GA4 are set.
   *
   * Not an error, and worth telling somebody about: the usual way to use both is
   * to configure Analytics INSIDE Tag Manager, and setting them here as well
   * loads the tag twice and double-counts every page view. The settings screen
   * says so; this flag is how it knows to.
   */
  bothConfigured: boolean;
}

export function analytics(settings: SiteSettings): Analytics {
  const headInline: string[] = [];
  const headSrc: string[] = [];
  const bodyMarkup: string[] = [];

  if (settings.gtmId) {
    const id = settings.gtmId;
    // Google's own snippet, with the id interpolated. Safe because of the format
    // check; see the note at the top of this file.
    headInline.push(
      `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});` +
        `var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';` +
        `j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;` +
        `f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');`,
    );
    /*
     * The noscript iframe belongs at the START of the body in Google's
     * instructions, and goes at the end here.
     *
     * It only exists for a visitor with JavaScript disabled, for whom nothing else
     * on the page is interactive either, so the position costs nothing measurable.
     * Putting it first would mean the renderer opening the body with an iframe,
     * which is a worse trade for every visitor who does have JavaScript.
     */
    bodyMarkup.push(
      `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" ` +
        `height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
    );
  }

  if (settings.ga4Id) {
    const id = settings.ga4Id;
    headSrc.push(`https://www.googletagmanager.com/gtag/js?id=${id}`);
    headInline.push(
      `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
        `gtag('js',new Date());gtag('config','${id}');`,
    );
  }

  return {
    headInline,
    headSrc,
    bodyMarkup,
    bothConfigured: Boolean(settings.gtmId && settings.ga4Id),
  };
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

/**
 * The web app manifest, for a site saved to an Android home screen.
 *
 * One icon, declared at 512x512 with purpose "any maskable". Android crops icons
 * to whatever shape the launcher uses, and without "maskable" it adds its own
 * white rounded square behind the image, so a logo with a transparent background
 * ends up in a box. Claiming maskable asks Android to trust our padding instead.
 *
 * display "minimal-ui" rather than "standalone": a travel site saved to a home
 * screen is still a website, and hiding the address bar entirely takes away the
 * back button and the padlock on something that takes payment details.
 */
export function manifest(settings: SiteSettings, siteName: string) {
  return {
    name: siteName,
    short_name: siteName.slice(0, 12),
    start_url: '/',
    display: 'minimal-ui',
    lang: settings.locale,
    icons: settings.touchIconUrl
      ? [
          {
            src: settings.touchIconUrl,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ]
      : [],
  };
}
