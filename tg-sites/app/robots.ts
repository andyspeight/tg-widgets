import type { MetadataRoute } from 'next';

/**
 * The robots.txt for the PLATFORM's own hostname, and only that.
 *
 * Still a blanket disallow, and now for a settled reason rather than as the
 * stopgap this used to say it was. tg-sites.vercel.app and travelgenixsites.com
 * serve the dashboard, the editor, and every client's site a second time at
 * /site/<their-host>/. None of that should be indexed: the dashboard is behind a
 * login and would only ever surface as a sign in page, and the duplicated client
 * content harms THEIR ranking rather than ours.
 *
 * THIS IS NO LONGER WHAT A CLIENT SITE SERVES, which is the change of 1 Aug
 * 2026. Until then it effectively was the only robots.txt in the product, and a
 * client's own hostname served nothing at all: /robots.txt is not in
 * isPlatformPath, so middleware rewrote it into the page renderer and the
 * request 404d looking for a page whose slug was "robots.txt".
 *
 * app/site/[host]/robots.txt/route.ts answers on a client's hostname now, and it
 * allows everything including the AI crawlers. The rules for both are together
 * in lib/seo/robots.ts so the two opposite answers are visible on one screen and
 * neither can be changed without seeing the other.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
