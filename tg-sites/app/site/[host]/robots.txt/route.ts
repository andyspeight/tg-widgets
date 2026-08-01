import { resolveTenantByHostname } from '../../../../lib/db/tenants';
import { robotsTxt } from '../../../../lib/seo/robots';

/**
 * /robots.txt on a client's own hostname.
 *
 * REACHED THROUGH THE SAME REWRITE AS EVERY OTHER PATH. middleware.ts turns
 * `https://www.someagency.co.uk/robots.txt` into `/site/www.someagency.co.uk/
 * robots.txt`, and a literal route segment beats the optional catch-all page
 * beside it, so this handler answers rather than the page renderer going looking
 * for a page whose slug is "robots.txt". That lookup, and the 404 it produced,
 * is exactly what was happening until 1 Aug 2026.
 *
 * A HOSTNAME THAT RESOLVES TO NO TENANT GETS A DISALLOW, not a 404. Somebody has
 * pointed DNS at us before their site exists, and for the days or weeks that
 * takes, the honest instruction to a crawler is "there is nothing here yet, do
 * not index it". A 404 robots.txt is read by most crawlers as permission to
 * crawl everything, which is the opposite of what an unfinished site wants.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ host: string }> },
) {
  const { host } = await params;
  const hostname = decodeURIComponent(host);
  const tenantId = await resolveTenantByHostname(hostname);

  const body = tenantId
    ? robotsTxt(`https://${hostname}`)
    : 'User-agent: *\nDisallow: /\n';

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      /*
       * An hour at the edge, a day while it is being refreshed. A robots.txt
       * changes when the platform's rules change, which is roughly never, and
       * this is a file every crawler asks for before every crawl.
       */
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
