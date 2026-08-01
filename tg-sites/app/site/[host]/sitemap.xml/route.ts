import { listAllPublishedEntries } from '../../../../lib/db/collections';
import { listPublishedPaths } from '../../../../lib/db/pages';
import { resolveTenantByHostname } from '../../../../lib/db/tenants';
import { sitemapXml, type SitemapEntry } from '../../../../lib/seo/sitemap';

/**
 * /sitemap.xml on a client's own hostname.
 *
 * Same rewrite and the same routing rule as robots.txt next door: a literal
 * segment beats the catch-all page. There was no sitemap anywhere in the product
 * before 1 Aug 2026.
 *
 * PAGES AND COLLECTION ENTRIES IN ONE FILE, read in parallel. A blog entry is a
 * URL on the site like any other, and the commonest reason a new entry goes
 * unnoticed for a fortnight is that nothing told anybody it existed.
 *
 * A NOINDEX PAGE IS LEFT OUT. Listing a URL in a sitemap and then telling the
 * crawler not to index it is a contradiction: Google reports it as an error, and
 * the client sees a warning in Search Console about a page they deliberately
 * hid. The sitemap is what we would like crawled, so it should only contain
 * things we would like crawled.
 *
 * AN UNKNOWN HOSTNAME IS A 404, unlike robots.txt. The difference is that an
 * empty sitemap is a meaningful and wrong statement, "this site has no pages",
 * which a crawler may cache. Nothing at all is the honest answer.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ host: string }> },
) {
  const { host } = await params;
  const hostname = decodeURIComponent(host);
  const tenantId = await resolveTenantByHostname(hostname);

  if (!tenantId) return new Response('Not found', { status: 404 });

  const [pages, entries] = await Promise.all([
    listPublishedPaths(tenantId),
    listAllPublishedEntries(tenantId),
  ]);

  const all: SitemapEntry[] = [
    ...pages
      .filter((page) => !page.noindex)
      .map((page) => ({ path: page.path, updatedAt: page.updatedAt })),
    ...entries,
  ];

  return new Response(sitemapXml(`https://${hostname}`, all), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      /*
       * Ten minutes, and a day of stale-while-revalidate. Short enough that a
       * page published this morning is in the sitemap by lunchtime, long enough
       * that a crawler asking repeatedly does not query the database each time.
       */
      'cache-control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
    },
  });
}
