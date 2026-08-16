import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumb } from '../../../../components/render/Breadcrumb';
import { FontHead } from '../../../../components/render/FontHead';
import { PageRenderer, SectionRenderer } from '../../../../components/render/PageRenderer';
import { safeUrl } from '../../../../lib/content/sanitise';
import { RegionRenderer } from '../../../../components/render/RegionRenderer';
import { SiteBody, SiteHead } from '../../../../components/render/SiteHead';
import { WidgetScripts } from '../../../../components/render/WidgetScripts';
import { SlideshowScript } from '../../../../components/render/SlideshowScript';
import { fillNavFolders, fillNavRegion } from '../../../../lib/content/nav';
import { listFontFaces } from '../../../../lib/db/fonts';
import { getPublishedPage, listPublishedNavPages } from '../../../../lib/db/pages';
import { resolveRedirect } from '../../../../lib/db/redirects';
import { getPublishedRegions } from '../../../../lib/db/regions';
import { getPublishedItem, listPublished } from '../../../../lib/db/collections';
import { fillPageListings, itemAsCard, listingsIn } from '../../../../lib/content/listings';
import { getPublicSettings } from '../../../../lib/db/settings';
import { getPublicTheme } from '../../../../lib/db/theme';
import { resolveTenantByHostname } from '../../../../lib/db/tenants';
import { socialMetas } from '../../../../lib/settings/head';
import { jsonLdScript, pageJsonLd, profileLinks } from '../../../../lib/seo/jsonld';
import { familiesFromFiles } from '../../../../lib/theme/fonts';
import { themeTokens } from '../../../../lib/theme/tokens';

/**
 * A client's website, on their own hostname.
 *
 * The thing the whole project exists for. Content is in the initial HTML
 * response, not injected by client JavaScript: there is no 'use client' anywhere
 * in this tree, so Next ships no bundle for the page content at all.
 *
 * WHERE THE TENANT COMES FROM, WHICH IS THE ONLY REAL DIFFERENCE FROM /preview
 *
 * The hostname, put in the path by middleware.ts. /preview answers the same
 * question from the session, because on a shared domain the hostname is ours and
 * cannot say which client is meant. Here it can, and it is the only thing that
 * does: nothing about a visitor's request is trusted except which host they asked
 * for, and that is resolved through resolve_tenant, the one SECURITY DEFINER
 * function in the database.
 *
 * Everything is read through the READ-ONLY role. A draft is invisible to it even
 * with the correct tenant set, so an unpublished page cannot appear here however
 * it is asked for. That is a database guarantee rather than a query I have to
 * remember to write.
 *
 * A HOSTNAME THAT RESOLVES TO NOTHING IS A 404, NOT AN ERROR PAGE. Somebody has
 * pointed DNS at us before their site exists, or after it was removed, and the
 * honest answer is that there is no site here.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ host: string; path?: string[] }> };

async function load(host: string, path: string[] | undefined) {
  const tenantId = await resolveTenantByHostname(decodeURIComponent(host));
  if (!tenantId) return null;

  /*
   * Five reads, in parallel, all through the read-only role.
   *
   * In parallel rather than in sequence because they are independent and this is
   * the request a visitor waits on. Sequentially it would be five round trips to
   * eu-west-2 before a byte of HTML. The header and the footer are one read
   * between them rather than two, for the same reason.
   */
  const [page, theme, faces, settings, regions, navPages] = await Promise.all([
    getPublishedPage(tenantId, (path ?? []).join('/')),
    getPublicTheme(tenantId),
    listFontFaces(tenantId),
    getPublicSettings(tenantId),
    getPublishedRegions(tenantId),
    /*
     * The site's published pages, so a Menu link that points at a folder can be
     * filled with the pages inside it. One more read on the request a visitor
     * waits on, so it rides the same Promise.all rather than adding a round trip.
     */
    listPublishedNavPages(tenantId),
  ]);

  const segments = (path ?? []).filter(Boolean);

  /*
   * NO PAGE AT THIS ADDRESS? TRY A COLLECTION.
   *
   * `/blog/ten-things-about-crete` is a collection key and an entry's address,
   * and it is looked up only AFTER the pages have said no. That order is the
   * whole rule: a real page always wins, so a client who makes a page at
   * /blog/something has not had it quietly shadowed by an entry of the same
   * name. Two segments exactly, because an entry has no children.
   */
  if (!page) {
    if (segments.length !== 2) return null;
    const entry = await getPublishedItem(tenantId, segments[0], segments[1]);
    if (!entry) return null;

    return {
      page: null,
      entry: { ...entry, collectionKey: segments[0], slug: segments[1] },
      theme,
      faces,
      settings,
      regions,
      navPages,
      tenantId,
    };
  }

  /*
   * The listing blocks, filled in before anything renders.
   *
   * One read per distinct collection across the header, the page and the footer,
   * for the largest count any block asked for, rather than one per block. See
   * lib/content/listings.ts for why this is not the block's own job.
   */
  const wanted = listingsIn([regions.header, page.content, regions.footer]);
  const listings = new Map<string, Array<Record<string, unknown>>>();

  if (wanted.length > 0) {
    const results = await Promise.all(
      wanted.map(async (request) => ({
        request,
        items: await listPublished(tenantId, request.collection, request.count),
      })),
    );
    for (const { request, items } of results) {
      listings.set(
        request.collection,
        items.map((row) => itemAsCard(row.item, request.collection, row.slug)),
      );
    }
  }

  return {
    page: { ...page, content: fillPageListings(page.content, listings) },
    entry: null,
    theme,
    faces,
    settings,
    regions,
    navPages,
    tenantId,
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { host, path } = await params;

  try {
    const found = await load(host, path);
    if (!found) return { title: 'Not found', robots: { index: false, follow: false } };

    /*
     * An entry has no SEO of its own, on purpose: its summary IS the search
     * description and its title is the title. Asking somebody to write the same
     * sentence twice is how one of the two ends up stale.
     */
    const seo = found.page
      ? found.page.content.seo
      : { title: undefined, description: found.entry!.item.summary, ogImage: found.entry!.item.image, canonical: undefined, noindex: false };
    const title = seo.title ?? (found.page ? found.page.title : found.entry!.item.title);
    const canonical = `https://${decodeURIComponent(host)}/${(path ?? []).join('/')}`.replace(
      /\/$/,
      '',
    );

    return {
      title,
      description: seo.description,
      robots: seo.noindex ? { index: false, follow: false } : undefined,
      alternates: { canonical: seo.canonical || canonical },
      /*
       * The social tags are built by lib/settings/head.ts and handed to Next's
       * metadata rather than rendered as tags, so Next can de-duplicate them
       * against anything else claiming the same property.
       */
      other: Object.fromEntries(
        socialMetas(found.settings, {
          title,
          description: seo.description,
          image: seo.ogImage,
          url: canonical,
        })
          .filter((meta) => meta.name)
          .map((meta) => [meta.name!, meta.content]),
      ),
      openGraph: {
        title,
        description: seo.description,
        url: canonical,
        locale: found.settings.locale.replace('-', '_'),
        images: seo.ogImage || found.settings.socialImageUrl
          ? [seo.ogImage || found.settings.socialImageUrl!]
          : undefined,
      },
    };
  } catch {
    // Metadata must never be the reason a page 500s.
    return { title: 'Travelgenix Sites' };
  }
}

/**
 * Nothing lives at this address. Does anything used to?
 *
 * THE LAST THING TRIED, AFTER PAGES AND AFTER COLLECTIONS, which is what keeps
 * it free: a request that reaches here was already going to be a 404, so the two
 * extra reads cost nothing anybody was waiting on. A live page always wins, so a
 * redirect can never shadow real content.
 *
 * A PERMANENT REDIRECT, NOT A TEMPORARY ONE. The distinction is the whole point.
 * A temporary redirect tells a search engine to keep the old address and check
 * back; a permanent one tells it the page has moved for good and to pass
 * whatever standing the old address had earned on to the new one. Getting this
 * wrong means the rename still costs the client their ranking, just more slowly.
 * permanentRedirect issues a 308, which Google treats exactly as it treats a 301.
 *
 * NOT IN MIDDLEWARE, though a redirect is the sort of thing that belongs there.
 * Middleware runs on every request, before caching, in an environment where the
 * Postgres driver has no business being, and this needs two queries. See the
 * note at the top of middleware.ts: that file must never touch the database.
 */
async function gone(host: string, path: string[] | undefined): Promise<never> {
  const tenantId = await resolveTenantByHostname(decodeURIComponent(host));

  if (tenantId) {
    const moved = await resolveRedirect(tenantId, (path ?? []).join('/'));
    // The empty string is the home page, so this tests for null rather than
    // for falsiness.
    if (moved !== null) permanentRedirect(`/${moved}`);
  }

  notFound();
}

export default async function SitePage({ params }: Params) {
  const { host, path } = await params;

  const found = await load(host, path);
  if (!found) return gone(host, path);

  const slug = decodeURIComponent(host);
  const theme = themeTokens(found.theme, familiesFromFiles(found.faces)).style;

  /*
   * STRUCTURED DATA, which is the difference between an AI engine summarising
   * this page and NAMING the business in its answer. An engine has to resolve
   * the site to a particular entity before it will credit it, and until 1 Aug
   * 2026 there was none of this anywhere in the product.
   *
   * Built entirely from what the client has already given us: the company
   * profile in settings, the page's own title and address, the questions in an
   * accordion block. Nothing here is a new field somebody has to fill in, so
   * nothing here can disagree with the visible page, which is the failure that
   * gets structured data ignored as spam. See lib/seo/jsonld.ts.
   */
  const origin = `https://${slug}`;
  const currentPath = (path ?? []).join('/');
  const pageTitle = found.page ? found.page.title : found.entry!.item.title;

  const nodes = pageJsonLd({
    origin,
    url: `${origin}/${currentPath}`.replace(/\/$/, ''),
    path: currentPath,
    siteName: found.settings.companyName || pageTitle,
    settings: found.settings,
    pageTitle,
    page: found.page?.content ?? null,
    entry: found.entry
      ? {
          title: found.entry.item.title,
          summary: found.entry.item.summary,
          image: found.entry.item.image,
        }
      : null,
    publishedAt: found.entry?.publishedAt ?? null,
    /*
     * The client's own profiles, from the Social links blocks they already
     * built. The footer is where they nearly always live, but the header and the
     * page are read too rather than assuming: a site with its socials in a top
     * strip should not lose them.
     */
    sameAs: profileLinks([
      found.regions.header,
      found.page ? found.page.content : found.entry!.item,
      found.regions.footer,
    ]),
  });

  return (
    <>
      {/*
        Icons, the manifest link and the analytics snippets. React hoists link,
        meta and script into the head from here, so it sits with the content it
        applies to rather than being threaded through a layout.
      */}
      <SiteHead settings={found.settings} />

      {/*
        ONE SCRIPT TAG HOLDING EVERY NODE, rather than one tag each. The nodes
        reference one another by @id, and keeping them together is what lets an
        engine see the article, the questions and the business as one story
        rather than three unrelated claims that happen to share a page.

        dangerouslySetInnerHTML is the only way to put text inside a script tag
        from React, and jsonLdScript has already escaped the three characters
        that could end the tag early. See the note on it.
      */}
      {nodes.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(nodes) }}
        />
      )}

      {/* @font-face and the preloads, before the content, so the browser starts
          fetching the font while it is still reading the page. */}
      <FontHead tenantSlug={slug} files={found.faces} typography={found.theme.typography} />

      {/*
        The page's only h1. Section headings start at h2, which the heading
        block enforces by not offering h1 at all.

        AN ENTRY SHOWS ITS h1 rather than hiding it. A page's title is often
        repeated by a hero heading a few pixels below, which is why that one is
        for screen readers only. An entry's title is the article's title and
        there is nothing else on the page saying it.
      */}
      {found.page ? (
        <h1 className="tgs-sr-only">{found.page.title}</h1>
      ) : null}

      {/*
        THE HEADER, THE PAGE AND THE FOOTER ARE SIBLINGS, not nested.

        A wrapper around the three would put its `overflow-x: hidden` between a
        sticky header and the document, and an overflow ancestor is exactly what
        stops `position: sticky` sticking. Each carries the theme itself for the
        same reason: there is no shared parent to put it on.

        Each renders nothing at all when the client has never published one, so
        a site without a footer has no empty `<footer>` claiming a landmark.
      */}
      <RegionRenderer
        /* A Menu link that points at a folder is filled with the pages inside it
           here, the same place the Cards block's collection is filled: the block
           stays a plain component that never reads the page list. */
        region={fillNavRegion(found.regions.header, found.navPages)}
        theme={theme}
        /*
          The header goes see-through when the page opens with a section pulled up
          under it, so the picture runs behind the logo and the menu. Decided here
          because only this component can see both: the header and the page are
          siblings, so no rule on one can reach the other. An entry has no sections
          of its own to pull up, so it is a page-only question.
        */
        overlapped={Boolean(found.page && (found.page.content.sections[0]?.pullUp ?? 0) > 0)}
      />

      {/*
        THE TRAIL, AND THE REASON IT IS HERE RATHER THAN A BLOCK A CLIENT ADDS.
        We emit BreadcrumbList structured data for every nested page, and
        Google's guidance is that markup must represent VISIBLE content. Left to
        a block, the markup would be right on the pages somebody remembered and
        a mismatch everywhere else, which is worse than not emitting it at all.

        Between the header and the content, which is where a trail belongs, and
        it draws nothing on the home page.
      */}
      <Breadcrumb path={currentPath} pageTitle={pageTitle} />

      {found.page ? (
        <PageRenderer page={fillNavFolders(found.page.content, found.navPages)} theme={theme} />
      ) : (
        <EntryRenderer entry={found.entry!} theme={theme} />
      )}

      <RegionRenderer region={fillNavRegion(found.regions.footer, found.navPages)} theme={theme} />

      {/* One script per distinct widget across all three, rather than each tree
          emitting its own and fetching the same file up to three times. */}
      <WidgetScripts
        trees={[
          found.regions.header,
          found.page ? found.page.content : found.entry!.item,
          found.regions.footer,
        ]}
      />

      {/* And, once, the slideshow enhancer, if any of the three holds one. */}
      <SlideshowScript
        trees={[
          found.regions.header,
          found.page ? found.page.content : found.entry!.item,
          found.regions.footer,
        ]}
      />

      {/* The tag manager noscript fallback, and any custom body HTML. Last, so
          nothing here delays the content above it. */}
      <SiteBody settings={found.settings} />
    </>
  );
}

/**
 * An entry in a collection, rendered as an article.
 *
 * NOT A PAGE, and the difference is only what sits above the sections: a real
 * h1, the date it carries, and its picture. Everything below that is the same
 * SectionRenderer a page uses, drawn by the same PageRenderer, because an
 * entry's body IS sections. See lib/content/collection.ts.
 *
 * The date is a `<time>` with a machine-readable attribute, so it is a date to
 * anything reading the page rather than a string that happens to look like one.
 */
function EntryRenderer({
  entry,
  theme,
}: {
  entry: { item: import('../../../../lib/content/collection').CollectionItem };
  theme: React.CSSProperties;
}) {
  const { item } = entry;
  const image = safeUrl(item.image);

  return (
    <article className="tgs-page tgs-entry" style={theme}>
      <header className="tgs-entry__head">
        {item.date && (
          <p className="tgs-entry__date">
            <time dateTime={item.date}>{formatDate(item.date)}</time>
          </p>
        )}
        <h1 className="tgs-entry__title">{item.title}</h1>
        {item.summary && <p className="tgs-entry__summary">{item.summary}</p>}
        {image && (
          <div className="tgs-entry__image">
            <img src={image} alt={item.alt} decoding="async" />
          </div>
        )}
      </header>

      {item.sections.map((section, index) => (
        <SectionRenderer key={section.id} section={section} index={index} />
      ))}
    </article>
  );
}

/**
 * A stored YYYY-MM-DD as words.
 *
 * Built from the parts rather than through `new Date(...)`, deliberately. A
 * date-only string is parsed as UTC midnight and then formatted in the server's
 * zone, so anywhere west of Greenwich shows the day before. The date on an
 * article is a date, not an instant: see safeDate in lib/content/collection.ts.
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  const name = MONTHS[Number(month) - 1];
  if (!name) return value;
  return `${Number(day)} ${name} ${year}`;
}
