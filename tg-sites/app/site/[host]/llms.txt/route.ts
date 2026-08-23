import { listAllPublishedEntries } from '../../../../lib/db/collections';
import { listPublishedPaths } from '../../../../lib/db/pages';
import { getSettings } from '../../../../lib/db/settings';
import { resolveTenantByHostname } from '../../../../lib/db/tenants';
import { llmsTxt, type LlmsEntry, type LlmsPage } from '../../../../lib/seo/llms';

/**
 * /llms.txt on a client's own hostname.
 *
 * The third of the three files a machine asks for, beside robots.txt and
 * sitemap.xml, and reached by the same rewrite and the same routing rule: a
 * literal segment beats the catch-all page, so this answers rather than the page
 * renderer going looking for a page whose slug is "llms.txt".
 *
 * WHAT IT ADDS THAT THE OTHER TWO DO NOT. robots.txt says what a crawler MAY
 * read. sitemap.xml says what EXISTS. Neither says what any of it is ABOUT, so
 * an assistant asked "who runs small-ship voyages around the Hebrides" has to
 * infer the answer from whatever it happened to crawl. This is the site saying
 * it plainly: who the company is, where they are, and what each page covers.
 *
 * A 404 FOR AN UNKNOWN HOSTNAME, matching sitemap.xml rather than robots.txt.
 * The distinction those two already draw applies here unchanged: a robots.txt
 * has a meaningful thing to say about a site that does not exist yet ("do not
 * index this"), and this does not. An empty llms.txt would assert that a real
 * company has no pages, which is worse than saying nothing.
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

  // Three reads in parallel, the same shape the sitemap uses for its two. None
  // depends on another, and this is a crawler rather than a visitor.
  const [settings, pages, entries] = await Promise.all([
    getSettings(tenantId),
    listPublishedPaths(tenantId),
    listAllPublishedEntries(tenantId),
  ]);

  const listedPages: LlmsPage[] = pages.map((page) => ({
    path: page.path,
    title: page.title,
    description: page.description,
    noindex: page.noindex,
  }));

  const listedEntries: LlmsEntry[] = entries.map((entry) => ({
    collection: entry.collection,
    slug: entry.path.slice(entry.collection.length + 1),
    title: entry.title,
  }));

  return new Response(llmsTxt(`https://${hostname}`, settings, listedPages, listedEntries), {
    headers: {
      /*
       * text/plain, which is what the convention asks for and what every fetcher
       * will accept. It is Markdown inside, but serving it as text/markdown would
       * make some clients offer to download it rather than read it.
       */
      'content-type': 'text/plain; charset=utf-8',
      // The sitemap's cache exactly: a page published this morning appears by
      // lunchtime, and a crawler asking repeatedly does not query each time.
      'cache-control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
    },
  });
}
