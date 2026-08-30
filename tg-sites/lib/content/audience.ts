/**
 * Who a section is for: server-side personalisation, resolved at render.
 *
 * A published page is server-rendered per request (the site route is
 * force-dynamic, read through the read-only role), so a section can be shown or
 * hidden by what the REQUEST says about the visitor, in the initial HTML, with
 * no client flip and nothing for a cache to get wrong. This module is the PURE
 * half: the rule a section carries, made safe, and the decision. The signals it
 * decides against are read from the request elsewhere (lib/site/visitor-signals),
 * so nothing here imports next/headers and the whole thing unit-tests in Node.
 *
 * THE SHAPE. An audience is a small set of facets, ANDed together, each a
 * whitelist ORed within: a section for "visitors from the UK or Ireland, on a
 * phone" matches a phone visitor whose country is GB or IE. A facet left unset
 * does not constrain. `mode` flips the whole thing: 'show' draws the section only
 * for a match, 'hide' draws it for everyone EXCEPT a match, which is how a client
 * hides the newsletter sign-up from a returning visitor who already has it. An
 * audience with no facets constrains nothing and is dropped to undefined, so a
 * section without a real rule is exactly a section with no rule.
 *
 * A DEFAULT ALONGSIDE A TARGETED ONE is the intended pattern, and unknown geo is
 * what makes it work: a visitor whose country we cannot read fails a country
 * facet, so a "show to GB" hero hides for them and a "hide from GB" default hero
 * shows. Design both and everyone gets one.
 */

/** The traffic sources a referer is sorted into. Coarse on purpose. */
export const AUDIENCE_SOURCES = ['search', 'social', 'direct'] as const;
export type AudienceSource = (typeof AUDIENCE_SOURCES)[number];

/** The two device buckets a user-agent is sorted into. */
export const AUDIENCE_DEVICES = ['mobile', 'desktop'] as const;
export type AudienceDevice = (typeof AUDIENCE_DEVICES)[number];

/** New this visit versus seen before, from a first-party cookie. */
export const AUDIENCE_VISITORS = ['new', 'returning'] as const;
export type AudienceVisitor = (typeof AUDIENCE_VISITORS)[number];

/** Show the section only to a match, or hide it from a match. */
export type AudienceMode = 'show' | 'hide';

/**
 * A section's audience rule. Every facet optional; an absent facet does not
 * constrain. Countries are ISO 3166-1 alpha-2, uppercase.
 */
export interface Audience {
  mode: AudienceMode;
  countries?: string[];
  source?: AudienceSource[];
  device?: AudienceDevice;
  visitor?: AudienceVisitor;
}

/** What the request says about a visitor, the thing an audience decides against. */
export interface VisitorSignals {
  /** ISO 3166-1 alpha-2, uppercase, or null when geo is unknown. */
  country: string | null;
  source: AudienceSource;
  device: AudienceDevice;
  visitor: AudienceVisitor;
}

/** A sane default for when nothing about the request is known (dev, a bot). */
export const DEFAULT_VISITOR_SIGNALS: VisitorSignals = {
  country: null,
  source: 'direct',
  device: 'desktop',
  visitor: 'new',
};

/**
 * The first-party cookie that marks a returning visitor. Set by middleware on
 * the first visit and read on the next, so a first-ever visit reads as new. It
 * holds one character, no identifier and no personal data, and it lives here (in
 * the pure module) so both the edge middleware and the server reader can name it
 * without either importing the other's runtime.
 */
export const RETURNING_VISITOR_COOKIE = 'tgs_rv';

const COUNTRY = /^[A-Z]{2}$/;
// A rule targeting more countries than this is almost certainly a mistake or an
// attempt to bloat the stored JSON; the cap keeps an inline attribute honest.
const MAX_COUNTRIES = 60;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function whitelist<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of value) {
    const one = oneOf(entry, allowed);
    if (one && !seen.has(one)) {
      seen.add(one);
      out.push(one);
    }
  }
  return out.length ? out : undefined;
}

function countryList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const code = entry.trim().toUpperCase();
    if (COUNTRY.test(code) && !seen.has(code)) {
      seen.add(code);
      out.push(code);
      if (out.length >= MAX_COUNTRIES) break;
    }
  }
  return out.length ? out : undefined;
}

/**
 * A section's audience, made safe, or undefined when there is no real rule.
 *
 * Total and defensive, the way every stored-then-rendered value in this codebase
 * is: nonsense in, undefined out, never a throw. An audience whose facets all drop
 * away, or which is only a bare mode, carries no constraint, so it returns
 * undefined and the section renders for everyone exactly as an unruled one does.
 */
export function parseAudience(value: unknown): Audience | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;

  const countries = countryList(o.countries);
  const source = whitelist(o.source, AUDIENCE_SOURCES);
  const device = oneOf(o.device, AUDIENCE_DEVICES);
  const visitor = oneOf(o.visitor, AUDIENCE_VISITORS);

  // No facet means no constraint, so there is nothing to store. mode alone is
  // not a rule.
  if (!countries && !source && !device && !visitor) return undefined;

  const mode: AudienceMode = o.mode === 'hide' ? 'hide' : 'show';
  const audience: Audience = { mode };
  if (countries) audience.countries = countries;
  if (source) audience.source = source;
  if (device) audience.device = device;
  if (visitor) audience.visitor = visitor;
  return audience;
}

/** True when the visitor matches every facet the audience sets (before mode). */
function audienceMatches(audience: Audience, signals: VisitorSignals): boolean {
  if (audience.countries) {
    if (signals.country === null || !audience.countries.includes(signals.country)) return false;
  }
  if (audience.source && !audience.source.includes(signals.source)) return false;
  if (audience.device && audience.device !== signals.device) return false;
  if (audience.visitor && audience.visitor !== signals.visitor) return false;
  return true;
}

/**
 * Whether a section with this audience is drawn for this visitor.
 *
 * No audience is always visible. Otherwise a 'show' rule is visible on a match
 * and a 'hide' rule is visible on a miss, which are the two halves a client
 * needs: target a section at an audience, or keep a section from one.
 */
export function sectionVisibleFor(
  audience: Audience | undefined,
  signals: VisitorSignals,
): boolean {
  if (!audience) return true;
  const matched = audienceMatches(audience, signals);
  return audience.mode === 'hide' ? !matched : matched;
}

/**
 * Keep only the sections this visitor should see.
 *
 * Generic and structural (any object carrying an optional `audience`), so it
 * filters a page's or a collection item's sections without this pure module
 * importing the content schema that imports it. The render calls it once on the
 * tree it is about to draw, so the initial HTML already holds only the sections
 * for this visitor and nothing is hidden with CSS after the fact.
 */
export function visibleSections<S extends { audience?: Audience }>(
  sections: readonly S[],
  signals: VisitorSignals,
): S[] {
  return sections.filter((section) => sectionVisibleFor(section.audience, signals));
}

// ---------------------------------------------------------------------------
// Pure classifiers, so the request reader (lib/site/visitor-signals) is a thin
// shell around next/headers and the interesting logic is tested here in Node.
// ---------------------------------------------------------------------------

// Hosts whose visits count as search or social. Matched on the registrable tail,
// so news.google.com and www.google.co.uk both read as search. Coarse by design:
// the buckets are search, social and everything-else-is-direct.
const SEARCH_HOSTS = [
  'google.',
  'bing.',
  'yahoo.',
  'duckduckgo.',
  'ecosia.',
  'baidu.',
  'yandex.',
  'startpage.',
  'qwant.',
  'ask.',
];
const SOCIAL_HOSTS = [
  'facebook.',
  'fb.',
  'instagram.',
  'linkedin.',
  'lnkd.',
  't.co',
  'twitter.',
  'x.com',
  'pinterest.',
  'reddit.',
  'youtube.',
  'youtu.be',
  'tiktok.',
  'whatsapp.',
  'wa.me',
  'snapchat.',
  'threads.',
];

/**
 * Sort a referer into search, social or direct, against the site's own host.
 *
 * No referer, an unparseable one, or one from the site itself is direct: an
 * internal click is not a fresh arrival from anywhere. Anything off the two host
 * lists is direct too, the safe default, so a rule keyed on search or social only
 * ever fires on a real one.
 */
export function classifySource(referer: string | null | undefined, selfHost?: string | null): AudienceSource {
  if (!referer) return 'direct';
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return 'direct';
  }
  if (!host) return 'direct';
  if (selfHost && host === selfHost.toLowerCase()) return 'direct';
  const hit = (list: string[]) => list.some((needle) => host === needle || host.includes(needle));
  if (hit(SEARCH_HOSTS)) return 'search';
  if (hit(SOCIAL_HOSTS)) return 'social';
  return 'direct';
}

// The token every mobile user-agent carries. Tablets read as desktop on purpose:
// the split is about layout and intent, and a tablet is closer to a desktop than
// a phone. "Mobi" is the token the HTML spec itself names for this test.
const MOBILE_UA = /Mobi|Android.+Mobile|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i;

/** Sort a user-agent into mobile or desktop. Absent or unknown is desktop. */
export function classifyDevice(userAgent: string | null | undefined): AudienceDevice {
  if (!userAgent) return 'desktop';
  return MOBILE_UA.test(userAgent) ? 'mobile' : 'desktop';
}

/** An ISO alpha-2 country from a header value, uppercased, or null. */
export function normaliseCountry(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return COUNTRY.test(code) ? code : null;
}
