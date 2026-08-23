import type { Metadata } from 'next';
import Link from 'next/link';

import '../../../components/sites/sites.css';
import { PageRenderer } from '../../../components/render/PageRenderer';
import { RegionRenderer } from '../../../components/render/RegionRenderer';
import { mergePrepared, prepareSections } from '../../../lib/content/prepare-markup';
import { WidgetScripts } from '../../../components/render/WidgetScripts';
import { MotionScript } from '../../../components/render/MotionScript';
import { SlideshowScript } from '../../../components/render/SlideshowScript';
import { FontHead } from '../../../components/render/FontHead';
import { listFontFaces } from '../../../lib/db/fonts';
import { getPublishedPage, listPublishedNavPages } from '../../../lib/db/pages';
import { getPublishedRegions } from '../../../lib/db/regions';
import { listPublished } from '../../../lib/db/collections';
import { fillPageListings, itemAsCard, listingKey, listingsIn } from '../../../lib/content/listings';
import { fillNavFolders, fillNavRegion } from '../../../lib/content/nav';
import { fillBreadcrumbs } from '../../../lib/content/breadcrumbs';
import { getPublicTheme } from '../../../lib/db/theme';
import { familiesFromFiles } from '../../../lib/theme/fonts';
import { themeTokens } from '../../../lib/theme/tokens';
import { activeSite } from '../../../lib/auth/session';

/**
 * The published site, rendered on the server.
 *
 * This is the property the whole project exists for: the content is in the
 * initial HTML response, not injected by client JavaScript. There is no
 * 'use client' anywhere in this tree, so Next ships no JS bundle for the
 * page content at all. View source and it is all there.
 *
 * It reads through withPublicTenant, which uses the read-only database role.
 * A draft is invisible to that role even with the correct tenant set, so an
 * unpublished page cannot appear here however it is asked for.
 *
 * Living under /preview because the editor and the sites share one domain for
 * now. On a client's own hostname this becomes the root route and the tenant
 * comes from the Host header. Nothing else about it changes.
 *
 * WHY THIS ONE NEEDS A SESSION
 *
 * Two separate questions, and only one of them is about permission. WHICH
 * tenant is being asked for is answered here by the session, because on a
 * shared domain there is nothing else to answer it with: the hostname is ours,
 * not the client's. WHAT can be seen is still answered by the renderer role,
 * which cannot see a draft even with the right tenant set.
 *
 * So this is a staff preview, and it says so rather than showing a sign-in
 * screen for content that is genuinely public. The public path is the client's
 * own hostname, and that is a later job.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ path?: string[] }> };

async function load(path: string[] | undefined) {
  const site = await activeSite();
  if (!site) return null;

  /*
   * Page and theme together, both through the read-only role.
   *
   * In parallel rather than in sequence: they are independent reads and this is
   * the request a visitor waits on. Both go through withPublicTenant, so a
   * theme cannot be read for a tenant the request is not scoped to, and neither
   * call can write anything.
   */
  const [page, theme, faces, regions, navPages] = await Promise.all([
    getPublishedPage(site.tenantId, (path ?? []).join('/')),
    getPublicTheme(site.tenantId),
    listFontFaces(site.tenantId),
    getPublishedRegions(site.tenantId),
    // The published pages, so a Menu link to a folder fills with the pages inside.
    listPublishedNavPages(site.tenantId),
  ]);

  if (!page) return null;

  /*
   * The listing blocks, filled in before anything renders. One read per distinct
   * collection across all three trees, for the largest count anybody asked for.
   * See lib/content/listings.ts for why this is not the block's own job.
   *
   * The entry pages themselves are not served here. /preview is a staff view of
   * a site on OUR hostname, and an entry lives at the client's own address; the
   * public route resolves those. The listing still shows, with links that work
   * once the site is on its own domain.
   */
  const wanted = listingsIn([regions.header, page.content, regions.footer]);
  const listings = new Map<string, Array<Record<string, unknown>>>();

  if (wanted.length > 0) {
    const results = await Promise.all(
      wanted.map(async (request) => ({
        request,
        listing: await listPublished(site.tenantId, request.collection, request.count),
      })),
    );
    for (const { request, listing } of results) {
      listings.set(
        // Keyed by the whole request, not the collection: two blocks narrowing
        // the same collection differently are two answers. See listingKey.
        listingKey(request),
        // The collection's own field definitions came back with its items, so
        // a card can carry a price and a number of nights without a second read.
        listing.items.map((row) => itemAsCard(row.item, request.collection, row.slug, listing.fields)),
      );
    }
  }

  return {
    page: { ...page, content: fillPageListings(page.content, listings) },
    theme,
    faces,
    regions,
    navPages,
    slug: site.slug,
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { path } = await params;

  try {
    const found = await load(path);
    if (!found) return { title: 'Not published', robots: { index: false, follow: false } };

    const { seo, title } = { seo: found.page.content.seo, title: found.page.title };
    return {
      title: seo.title ?? title,
      description: seo.description,
      robots: seo.noindex ? { index: false, follow: false } : undefined,
    };
  } catch {
    // Metadata must never be the reason a page 500s. The body below reports
    // the real problem in language someone can act on.
    return { title: 'Travelgenix Sites' };
  }
}

export default async function PublishedPage({ params }: Params) {
  const { path } = await params;

  let found: Awaited<ReturnType<typeof load>> = null;
  let failure: string | null = null;

  try {
    found = await load(path);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (failure) return <Notice heading="Cannot reach the database">{failure}</Notice>;

  if (!found) {
    const site = await activeSite();
    const where = (path ?? []).join('/');

    // No site at all means no session, or a session with no memberships.
    // Either way the answer is not "nothing is published here".
    if (!site) {
      return (
        <Notice heading="Sign in to preview a site">
          On this domain there is no way to tell which site you mean, so the
          preview reads it from whoever is signed in.
        </Notice>
      );
    }

    return (
      <Notice heading="Nothing published here yet">
        {where
          ? `${site.name} has no published page at /${where}.`
          : `${site.name} has no published home page.`}
      </Notice>
    );
  }

  const theme = themeTokens(found.theme, familiesFromFiles(found.faces)).style;


  /*

   * The server's pass over borrowed markup, once for all three trees. The same

   * call the published route makes, and for the same reason: the imported

   * design and the embed block are cleaned here so the renderer never needs a

   * parser. See lib/content/prepared.ts and task #94.

   */

  const prepared = mergePrepared(

    prepareSections(found.regions.header?.sections),

    prepareSections(found.page.content.sections),

    prepareSections(found.regions.footer?.sections),

  );

  return (
    <>
      {/* The page's only h1. Section headings start at h2, which the heading
          block enforces by not offering h1 at all. */}
      <h1 className="tgs-sr-only">{found.page.title}</h1>

      {/*
        The @font-face rules and the preloads. Before the content, so the browser
        starts fetching the font while it is still reading the page.
      */}
      <FontHead
        tenantSlug={found.slug}
        files={found.faces}
        typography={found.theme.typography}
      />

      {/* Header, page and footer as siblings rather than nested, and each
          carrying the theme itself. See the note on the public route: a wrapper
          would put an overflow ancestor between a sticky header and the
          document, which is what stops sticky sticking. */}
      <RegionRenderer
        region={fillNavRegion(found.regions.header, found.navPages)}
        theme={theme}
        // See-through when the page opens with a section pulled up under it, so
        // the preview shows the picture behind the header the way the site will.
        overlapped={(found.page.content.sections[0]?.pullUp ?? 0) > 0}
        prepared={prepared}
      />

      {/* The trail is filled here too, so a client positioning a Breadcrumbs
          block sees the real crumbs in preview rather than the canvas's worked
          example. The preview answers at the page's real address, so there is a
          genuine trail to build. */}
      <PageRenderer
        page={fillBreadcrumbs(
          fillNavFolders(found.page.content, found.navPages),
          (path ?? []).join('/'),
          found.page.title,
        )}
        theme={theme}
        prepared={prepared}
      />

      <RegionRenderer
        region={fillNavRegion(found.regions.footer, found.navPages)}
        theme={theme}
        prepared={prepared}
      />

      <WidgetScripts
        trees={[found.regions.header, found.page.content, found.regions.footer]}
      />
      <SlideshowScript
        trees={[found.regions.header, found.page.content, found.regions.footer]}
      />
      <MotionScript
        trees={[found.regions.header, found.page.content, found.regions.footer]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Deliberately plain, and deliberately not styled like the client's site.
 *
 * This is scaffolding talking, not the site. Dressing it up in the tenant's
 * theme would suggest the site is working when it is not.
 */
function Notice({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="sv-root" data-theme="light">
      <main className="tg-door" data-narrow="true">
        <h1 className="tg-door__title" data-small="true">{heading}</h1>
        <p className="tg-door__lede">{children}</p>
        <div className="tg-door__actions">
          <Link className="tg-btn" data-variant="primary" href="/sites">
            Back to your pages
          </Link>
        </div>
      </main>
    </div>
  );
}
