/**
 * Site settings: the things that are true of a whole site rather than of a page.
 *
 * TWO SHAPES, AND THE SPLIT IS THE SECURITY MODEL
 *
 * SiteSettings is what a client may change. StaffSettings is head and body HTML,
 * which only Travelgenix may change (Andy, 30 Jul 2026). They are parsed by
 * separate functions from separate database columns, so the action a client can
 * reach has no path to the second one. See db/migrations/0012_site_settings.sql
 * for why that is a column split rather than a field filter.
 *
 * ANALYTICS IS AN ID, NEVER A SNIPPET
 *
 * This is the decision that matters most in this file. The obvious design is a
 * textarea saying "paste your Google Tag Manager code", because that is what the
 * client will be sent by whoever set up their tracking. It is also a script tag
 * on a live travel site, typed by whoever has the weakest password in the agency.
 *
 * So the settings hold a container ID, matched against the format Google actually
 * issues, and lib/settings/head.ts GENERATES the snippet. A client can change
 * which measurement their pages report to. They cannot change what runs.
 *
 * Total, like every parser here: nonsense in, defaults out, never a throw. A
 * setting is decoration around content, and it must never be the reason a page
 * fails to render.
 */

import { z } from 'zod';

import { safeUrl } from '../content/sanitise';

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * A Google Tag Manager container id.
 *
 * GTM- then a short code. Anchored at both ends and uppercased before matching,
 * because a client will paste it with a stray space or in lower case and refusing
 * that would be pedantry rather than safety.
 */
const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/;

/**
 * A GA4 measurement id.
 *
 * G- then a code. The old UA- analytics ids are deliberately NOT accepted: those
 * properties stopped collecting data in 2023, so accepting one would give somebody
 * a settings screen that says tracking is on and a site that reports nothing. A
 * refusal they can act on beats a silence they cannot.
 */
const GA4_ID = /^G-[A-Z0-9]{6,12}$/;

/** An id, tidied and checked, or null. */
function analyticsId(pattern: RegExp) {
  return z
    .unknown()
    .transform((value) => {
      if (typeof value !== 'string') return null;
      // Whitespace out, uppercased: both are things a paste introduces and
      // neither changes which container is meant.
      const tidy = value.replace(/\s+/g, '').toUpperCase();
      if (!tidy) return null;
      return pattern.test(tidy) ? tidy : null;
    })
    .catch(null);
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * An image URL, or null.
 *
 * Through safeUrl, which allows https, http and a site-relative path and refuses
 * everything else. These end up in a link or meta tag on every page of a client's
 * site, so the same whitelist that guards an image block guards them.
 */
const imageUrl = z
  .unknown()
  .transform((value) => (typeof value === 'string' && value ? safeUrl(value) : null))
  .catch(null);

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

/**
 * The languages worth offering today.
 *
 * A stub, as asked for, but a stub that does ONE real thing: it sets the lang
 * attribute on the html element, which is currently hardcoded to en-GB. That
 * matters to a screen reader choosing a voice and to a browser offering to
 * translate, so even the stub earns its place rather than being a dead panel.
 *
 * A fixed list rather than free text, because this value goes into an attribute
 * and because a typo produces no error, just a page quietly claiming to be in a
 * language it is not.
 */
export const LOCALES = {
  'en-GB': 'English (United Kingdom)',
  'en-US': 'English (United States)',
  'fr-FR': 'French',
  'de-DE': 'German',
  'es-ES': 'Spanish',
  'it-IT': 'Italian',
  'nl-NL': 'Dutch',
  'pt-PT': 'Portuguese',
} as const;

export type Locale = keyof typeof LOCALES;
export const LOCALE_IDS = Object.keys(LOCALES) as Locale[];

export const DEFAULT_LOCALE: Locale = 'en-GB';

// ---------------------------------------------------------------------------
// Client-editable settings
// ---------------------------------------------------------------------------

export const SiteSettingsSchema = z.object({
  /** A Google Tag Manager container, or null. The snippet is generated. */
  gtmId: analyticsId(GTM_ID),
  /** A GA4 measurement id, or null. Also generated. */
  ga4Id: analyticsId(GA4_ID),

  /** The little icon in a browser tab. */
  faviconUrl: imageUrl,
  /** What appears when somebody shares a page. Per-page SEO can override it. */
  socialImageUrl: imageUrl,
  /** What appears when somebody saves the site to a phone home screen. */
  touchIconUrl: imageUrl,

  /**
   * The site's language.
   *
   * Falls back rather than failing, because an unknown code is far more likely to
   * be a hand-edited row than an attack, and a page in the wrong declared
   * language is better than no page.
   */
  locale: z
    .unknown()
    .transform((value) =>
      typeof value === 'string' && value in LOCALES ? (value as Locale) : DEFAULT_LOCALE,
    )
    .catch(DEFAULT_LOCALE),
});

export type SiteSettings = z.infer<typeof SiteSettingsSchema>;

export const DEFAULT_SETTINGS: SiteSettings = {
  gtmId: null,
  ga4Id: null,
  faviconUrl: null,
  socialImageUrl: null,
  touchIconUrl: null,
  locale: DEFAULT_LOCALE,
};

/** Settings from whatever came out of the database. Total. */
export function parseSettings(value: unknown): SiteSettings {
  const input = asObject(value);
  return SiteSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...input });
}

/** True when nothing has been set, so a screen can say so plainly. */
export function settingsAreEmpty(settings: SiteSettings): boolean {
  return (
    !settings.gtmId &&
    !settings.ga4Id &&
    !settings.faviconUrl &&
    !settings.socialImageUrl &&
    !settings.touchIconUrl &&
    settings.locale === DEFAULT_LOCALE
  );
}

// ---------------------------------------------------------------------------
// Staff-only settings
// ---------------------------------------------------------------------------

/**
 * 16KB each. Generous for a tag manager snippet or a chat widget, and a ceiling
 * so a paste accident cannot put a megabyte into every page of a site.
 */
export const MAX_RAW_HTML = 16_384;

/**
 * Raw HTML for the head and the end of the body.
 *
 * DELIBERATELY NOT SANITISED, and that is the whole point of it being staff-only.
 * A sanitised head injection would strip the script tag that is the only reason
 * anybody wants the field. So the protection is not the parser, it is who can
 * reach it: this is written by a Travelgenix action behind a staff check, and by
 * nothing a client can call.
 *
 * The only things done here are the ones that are never intentional: control
 * characters out, and a length cap.
 */
const rawHtml = z
  .unknown()
  .transform((value) => {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, MAX_RAW_HTML);
  })
  .catch('');

export const StaffSettingsSchema = z.object({
  /** Goes in the head, so it can carry meta tags and a tag manager. */
  headHtml: rawHtml,
  /** Goes at the end of the body, which is where a chat widget belongs. */
  bodyHtml: rawHtml,
});

export type StaffSettings = z.infer<typeof StaffSettingsSchema>;

export const DEFAULT_STAFF_SETTINGS: StaffSettings = { headHtml: '', bodyHtml: '' };

export function parseStaffSettings(value: unknown): StaffSettings {
  return StaffSettingsSchema.parse({ ...DEFAULT_STAFF_SETTINGS, ...asObject(value) });
}

// ---------------------------------------------------------------------------

/**
 * jsonb as an object, tolerating a double-encoded value.
 *
 * Same guard as every other jsonb read in this codebase. A value written with
 * JSON.stringify instead of the driver's json() comes back as a quoted string, and
 * that bug lost a page's content once already.
 */
function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}
