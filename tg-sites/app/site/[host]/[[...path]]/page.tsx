import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FontHead } from '../../../../components/render/FontHead';
import { PageRenderer, SectionRenderer } from '../../../../components/render/PageRenderer';
import { safeUrl } from '../../../../lib/content/sanitise';
import { RegionRenderer } from '../../../../components/render/RegionRenderer';
import { SiteBody, SiteHead } from '../../../../components/render/SiteHead';
import { WidgetScripts } from '../../../../components/render/WidgetScripts';
import { listFontFaces } from '../../../../lib/db/fonts';
import { getPublishedPage } from '../../../../lib/db/pages';
import { getPublishedRegions } from '../../../../lib/db/regions';
import { getPublishedItem, listPublished } from '../../../../lib/db/collections';
import { fillPageListings, itemAsCard, listingsIn } from '../../../../lib/content/listings';
import { getPublicSettings } from '../../../../lib/db/settings';
import { getPublicTheme } from '../../../../lib/db/theme';
import { resolveTenantByHostname } from '../../../../lib/db/tenants';
import { socialMetas } from '../../../../lib/settings/head';
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
  const [page, theme, faces, settings, regions] = await Promise.all([
    getPublishedPage(tenantId, (path ?? []).join('/')),
    getPublicTheme(tenantId),
    listFontFaces(tenantId),
    getPublicSettings(tenantId),
    getPublishedRegions(tenantId),
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

export default async function SitePage({ params }: Params) {
  const { host, path } = await params;

  const found = await load(host, path);
  if (!found) notFound();

  const slug = decodeURIComponent(host);
  const theme = themeTokens(found.theme, familiesFromFiles(found.faces)).style;

  return (
    <>
      {/*
        Icons, the manifest link and the analytics snippets. React hoists link,
        meta and script into the head from here, so it sits with the content it
        applies to rather than being threaded through a layout.
      */}
      <SiteHead settings={found.settings} />

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
      <RegionRenderer region={found.regions.header} theme={theme} />

      {found.page ? (
        <PageRenderer page={found.page.content} theme={theme} />
      ) : (
        <EntryRenderer entry={found.entry!} theme={theme} />
      )}

      <RegionRenderer region={found.regions.footer} theme={theme} />

      {/* One script per distinct widget across all three, rather than each tree
          emitting its own and fetching the same file up to three times. */}
      <WidgetScripts
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
