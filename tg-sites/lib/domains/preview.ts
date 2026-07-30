/**
 * The domain client sites live on.
 *
 * WHY IT IS NOT A TRAVELIFY SUBDOMAIN, WHICH IS THE WHOLE POINT OF THIS FILE
 *
 * Site owners can put arbitrary script on their own site (see
 * app/actions/settings.ts). api/_lib/auth/cookie.js in the widget suite sets
 * tg_session on Domain=.travelify.io, shared by id, marketing, chat, widgets and
 * trends. Put a client's site on any *.travelify.io hostname and their script is
 * running inside that cookie's scope: HttpOnly stops it READING the token, and
 * SameSite=Lax still has the browser ATTACH the cookie to same-site requests, so the
 * script could act as the signed-in Travelify user against every other product's API
 * without ever seeing the credential.
 *
 * A separate REGISTRABLE domain is what fixes that, because cookie scope is per
 * registrable domain. travelgenixsites.com and travelify.io share nothing.
 * Andy chose it on 30 Jul 2026 after the exposure was raised. Wix, Webflow and
 * Shopify all do the same thing for the same reason: wixsite.com, webflow.io,
 * myshopify.com.
 *
 * The original schema in 0002_core_tables.sql reserved .tgsites.io, also a separate
 * registrable domain, and 0012 replaced that with sites.travelify.io while fixing a
 * different real bug in the same constraint. That was the mistake this file exists to
 * make hard to repeat.
 *
 * NOTHING OF OURS MAY EVER BE SERVED FROM THIS DOMAIN. No dashboard, no API, no
 * marketing page, no cookie. The moment something of ours sets a cookie here, this
 * whole file is decoration and every client's script is inside its scope.
 *
 * WHERE THIS VALUE IS WRITTEN DOWN TWICE
 *
 * Here, and in the domains_reserved_suffix check constraint, because a constraint
 * cannot import a module. tests/settings.test.ts reads the migrations and asserts the
 * two agree, which is the same drift-catching pattern used for the staff domains and
 * the media mime whitelist. It is precisely the check that would have caught a
 * constraint guarding a domain nobody owns.
 */

/** No leading dot. Compose with previewHostname or PREVIEW_DOT_SUFFIX. */
export const PREVIEW_SUFFIX = 'travelgenixsites.com';

/** For endsWith checks, so a host called eviltravelgenixsites.com cannot match. */
export const PREVIEW_DOT_SUFFIX = `.${PREVIEW_SUFFIX}` as const;

/**
 * Labels a client cannot have, however their slug is generated.
 *
 * A preview site at www.travelgenixsites.com would look like the apex, and one at
 * api or admin looks like infrastructure. None of these can arise from a tenant slug
 * today, because slugs are chosen by us, and "today" is doing a lot of work in that
 * sentence: the whole point of a reserved list is that it survives the day somebody
 * lets a client pick their own.
 */
export const RESERVED_LABELS = [
  'www',
  'api',
  'app',
  'admin',
  'mail',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'assets',
  'status',
  'support',
  'help',
  'billing',
  'login',
  'signin',
  'auth',
  'id',
  'preview',
  'staging',
  'test',
  'dev',
] as const;

/** The shape of one label: the same alphabet a tenant slug is held to. */
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Whether a label may be used for a preview hostname.
 *
 * Length 63 is the DNS limit on a single label, and the same ceiling the slug column
 * carries in 0002_core_tables.sql.
 */
export function isUsablePreviewLabel(label: unknown): label is string {
  if (typeof label !== 'string') return false;
  const clean = label.toLowerCase();
  if (clean.length < 2 || clean.length > 63) return false;
  if (!LABEL.test(clean)) return false;
  return !(RESERVED_LABELS as readonly string[]).includes(clean);
}

/** The preview hostname for a slug, or null when the slug cannot have one. */
export function previewHostname(slug: unknown): string | null {
  if (!isUsablePreviewLabel(slug)) return null;
  return `${slug.toLowerCase()}${PREVIEW_DOT_SUFFIX}`;
}

/**
 * Whether a hostname is one of ours-for-clients.
 *
 * True for the apex as well as for a subdomain, because middleware has to keep the
 * apex off the editor too. What the apex actually serves is a separate question and
 * the answer should be something cookieless.
 */
export function isPreviewHostname(host: unknown): boolean {
  if (typeof host !== 'string') return false;
  const clean = host.toLowerCase().split(':')[0];
  return clean === PREVIEW_SUFFIX || clean.endsWith(PREVIEW_DOT_SUFFIX);
}
