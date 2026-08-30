/**
 * Deciding whether a request is for the editor or for a client's website.
 *
 * ONE JOB, AND IT IS A STRING COMPARISON
 *
 * Everything in this application until now has lived on one hostname, so which
 * site a request meant was answered by the session. A client's own domain changes
 * that: the hostname IS the answer, and it has to be worked out before routing
 * rather than inside a page.
 *
 * So: app hostnames fall through to the editor, and everything else is rewritten
 * to /site/<hostname>/<path>, where the tenant is resolved and the published page
 * rendered. A rewrite rather than a redirect, so the visitor's URL stays their own.
 *
 * WHAT THIS FILE MUST NEVER DO
 *
 * Touch the database. Middleware runs on every request, before caching, in an
 * environment where the Postgres driver has no business being. resolveTenantByHostname
 * is a database call and belongs in the route, which runs on Node with a
 * connection pool. Importing lib/db from here would put a driver in the edge
 * bundle and a query in front of every static asset.
 *
 * That is why the decision here is deliberately crude: is this hostname ours, yes
 * or no. Whether an unknown hostname corresponds to a real site is the route's
 * question, and the route can answer it with a 404 that looks like a website
 * rather than a platform error.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { RETURNING_VISITOR_COOKIE } from './lib/content/audience';

/*
 * A pure module, deliberately. lib/domains/preview.ts has no imports at all, which
 * is what lets middleware use it: see the note above about what must never end up
 * in this bundle.
 */
import { PREVIEW_DOT_SUFFIX } from './lib/domains/preview';

/**
 * The hostnames that mean "the editor product".
 *
 * APP_HOSTNAMES is comma separated, for when this gets a real domain such as
 * sites.travelgenix.com. Everything below it is the set that is true without any
 * configuration, so a fresh deployment works before anybody sets a variable.
 */
function appHostnames(): string[] {
  const configured = (process.env.APP_HOSTNAMES ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return configured;
}

/**
 * Whether this host should see the editor rather than a client's site.
 *
 * vercel.app is included wholesale on purpose. Every preview deployment gets its
 * own generated hostname under it, and the alternative is a list nobody can keep
 * current: a branch deployed on Tuesday would render as a client site and 404,
 * which reads as the branch being broken.
 *
 * THE ONE THING THIS MUST NOT SWALLOW is the preview subdomains. Those are under
 * travelgenixsites.com and are genuine client sites, so they are excluded
 * explicitly, before the suffix checks, or a client's preview URL would land on
 * the Travelgenix front door.
 *
 * The suffix is a parameter with a default rather than a literal, so a test can
 * drive it, and the default comes from lib/domains/preview.ts rather than being
 * written out again here. It used to be a literal, which is how a guard elsewhere
 * ended up naming a domain nobody owned.
 */
export function isAppHost(host: string, reservedSuffix = PREVIEW_DOT_SUFFIX): boolean {
  const clean = host.toLowerCase().split(':')[0];

  // Checked first. A preview hostname is a client site whatever else it matches.
  if (clean.endsWith(reservedSuffix)) return false;

  if (clean === 'localhost' || clean === '127.0.0.1' || clean.endsWith('.localhost')) return true;
  if (clean.endsWith('.vercel.app')) return true;

  return appHostnames().includes(clean);
}

/**
 * Paths that belong to the platform whatever hostname asked for them.
 *
 * A client's site needs the font route and the image bank's blobs to work on their
 * own domain, and it needs the Next asset paths. Rewriting those into the site
 * renderer would break the page they are part of.
 */
/**
 * The behaviour scripts a published page loads by name, at the root.
 *
 * WHY THEY HAVE TO BE LISTED (25 Aug 2026). Everything on a client's hostname is
 * rewritten into the site renderer, and these are the four paths that must not
 * be. Without them `/tg-motion.js` on coastwise.travelgenixsites.com resolved to
 * /site/coastwise.travelgenixsites.com/tg-motion.js, which is not a page, so the
 * browser was handed a 404 HTML document with a JavaScript content type. Nothing
 * errored anywhere a client would see: motion simply did not move, the theme
 * toggle did not toggle, and the slideshow arrows did nothing.
 *
 * Exactly the same shape as the font 404 fixed earlier the same day, and the same
 * lesson: a static asset a client site loads by name needs saying so here.
 *
 * KEPT IN STEP WITH public/ BY A TEST. The matcher below has to repeat these as a
 * literal, because Next reads it at build time and cannot call a function, so the
 * two can drift. tests/site-assets.test.ts asserts that every root script in
 * public/ appears in both.
 */
export const SITE_ASSETS: readonly string[] = [
  '/tg-motion.js',
  '/slideshow.js',
  '/theme-toggle.js',
  '/no-right-click.js',
  '/cookie-consent.js',
];

function isPlatformPath(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/fonts/') ||
    pathname === '/favicon.ico' ||
    SITE_ASSETS.includes(pathname)
  );
}

/**
 * Whether a path is the internal site-render prefix.
 *
 * The rewrite target has to be a real, routable path, which means it is also a path
 * somebody can type: /site/www.theirdomain.co.uk/ on our own hostname renders their
 * home page. Published pages are public, so that is not a leak. It is somebody
 * else's content duplicated on our domain, which is an SEO problem for them.
 *
 * NOINDEX RATHER THAN A 404, after trying the 404 first.
 *
 * Blocking it solved the duplicate-content problem and took away the only way to
 * look at a client's rendered site before their DNS points anywhere, which is both
 * how this gets tested and how somebody on a support call sees what a client sees.
 * Duplicate content is a job for a robots header, not for a 404, so the path stays
 * open and tells search engines to ignore it.
 */
function isInternalSitePath(pathname: string): boolean {
  return pathname === '/site' || pathname.startsWith('/site/');
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const { pathname, search } = request.nextUrl;

  if (isPlatformPath(pathname)) return NextResponse.next();

  if (isAppHost(host)) {
    if (isInternalSitePath(pathname)) {
      // Reached directly rather than through the rewrite. Serve it, and keep it out
      // of every index: see the note above isInternalSitePath.
      const response = NextResponse.next();
      response.headers.set('x-robots-tag', 'noindex, nofollow');
      return response;
    }
    return NextResponse.next();
  }

  /*
   * The hostname goes in the PATH, not in a header.
   *
   * A header would work and would not be cacheable: Next keys its cache on the
   * URL, so two different client sites asking for / would be one cache entry and
   * whichever rendered first would be served to both. Putting the hostname in the
   * rewritten path makes each site a distinct URL and the caching correct by
   * construction.
   *
   * encodeURIComponent because a hostname is one path segment and must stay one.
   *
   * NOT /_site, which is the name to reach for and does not work. A folder whose
   * name starts with an underscore is a PRIVATE folder in the App Router and is
   * opted out of routing entirely, so the rewrite pointed at a route that did not
   * exist and every client site 404d. The build was clean, because a rewrite target
   * is a string and nothing checks it; the route simply was not in the manifest.
   */
  const url = request.nextUrl.clone();
  url.pathname = `/site/${encodeURIComponent(host.toLowerCase().split(':')[0])}${pathname}`;
  url.search = search;

  const response = NextResponse.rewrite(url);

  /*
   * MARK A RETURNING VISITOR, for the section-level personalisation the render
   * reads (lib/content/audience). Set on the first visit and read on the next,
   * so a first-ever visit reads as new. One character, no identifier and no
   * personal data: a functional first-party cookie, the same class as the site
   * and consent cookies, so it is set without gating on consent. Only when
   * absent, so a real returning visitor's marker is never refreshed away.
   */
  if (!request.cookies.get(RETURNING_VISITOR_COOKIE)) {
    response.cookies.set(RETURNING_VISITOR_COOKIE, '1', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    });
  }

  return response;
}

export const config = {
  /*
   * Everything except the paths above, which are excluded here as well as in the
   * function. Twice on purpose: the matcher keeps middleware from running at all
   * for an asset, which is the cheap win, and the function check is what makes the
   * behaviour testable without a request object.
   */
  matcher: ['/((?!_next/|api/|fonts/|favicon\\.ico|tg-motion\\.js|slideshow\\.js|theme-toggle\\.js|no-right-click\\.js|cookie-consent\\.js).*)'],
};
