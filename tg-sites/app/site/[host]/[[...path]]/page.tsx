import { cache } from 'react';
import { carriesOwnBanner } from '../../../../lib/content/collection-layout';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { Breadcrumb } from '../../../../components/render/Breadcrumb';
import { fillBreadcrumbs, hasBreadcrumbsBlock } from '../../../../lib/content/breadcrumbs';
import { mergePrepared, prepareSections } from '../../../../lib/content/prepare-markup';
import { imageUrlsIn } from '../../../../lib/content/image-sizes';
import { imageSizesForUrls } from '../../../../lib/db/media';
import { FontHead } from '../../../../components/render/FontHead';
import { PageRenderer, SectionRenderer } from '../../../../components/render/PageRenderer';
import { safeUrl } from '../../../../lib/content/sanitise';
import { RegionRenderer } from '../../../../components/render/RegionRenderer';
import { SiteBody, SiteHead } from '../../../../components/render/SiteHead';
import { WidgetScripts } from '../../../../components/render/WidgetScripts';
import { MotionScript } from '../../../../components/render/MotionScript';
import { NoRightClickScript } from '../../../../components/render/NoRightClickScript';
import { CookieConsent } from '../../../../components/render/CookieConsent';
import { FloatingWidgets } from '../../../../components/render/FloatingWidgets';
import { SlideshowScript } from '../../../../components/render/SlideshowScript';
import { ThemeToggleScript } from '../../../../components/render/ThemeToggleScript';
import { fillNavFolders, fillNavRegion } from '../../../../lib/content/nav';
import { listFontFaces } from '../../../../lib/db/fonts';
import { getPublishedPage, listPublishedForSearch, listPublishedNavPages } from '../../../../lib/db/pages';
import { searchDocs } from '../../../../lib/content/search';
import { hasThemeToggle } from '../../../../lib/content/theme-toggle';
import { SearchResults } from '../../../../components/render/SearchResults';
import { resolveRedirect } from '../../../../lib/db/redirects';
import { getPublishedRegions } from '../../../../lib/db/regions';
import {
  getPublishedItem,
  listPublishedByTag,
  listPublishedItemsForSearch,
  MAX_LISTING_ITEMS,
} from '../../../../lib/db/collections';
import { fillPageListings, fillPageLoops, itemAsCard } from '../../../../lib/content/listings';
import { resolveListings, resolveLoops } from '../../../../lib/db/listings';
import { tagArchivePath } from '../../../../lib/content/collection';
import { fieldFacts } from '../../../../lib/content/collection-fields';
import { DestinationPanel } from '../../../../components/render/DestinationPanel';
import { readingTime } from '../../../../lib/content/reading-time';
import { CardsBlock } from '../../../../components/render/blocks';
import { getPublicSettings } from '../../../../lib/db/settings';
import { personaliseSections } from '../../../../lib/content/personalise';
import { readVisitorSignals } from '../../../../lib/site/visitor-signals';
import { getPublicTheme } from '../../../../lib/db/theme';
import { getPublicTenantSlug, resolveTenantByHostname } from '../../../../lib/db/tenants';
import { socialMetas } from '../../../../lib/settings/head';
import { jsonLdScript, pageJsonLd, profileLinks } from '../../../../lib/seo/jsonld';
import { familiesFromFiles } from '../../../../lib/theme/fonts';
import { darkThemeTokens, themeTokens } from '../../../../lib/theme/tokens';

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

type Params = {
  params: Promise<{ host: string; path?: string[] }>;
  /*
   * The query string, for /search. Every other address ignores it, but a page
   * component that reads searchParams at all must declare it, and Next hands it
   * in the same awaited shape as params.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Whether this address is the search results page rather than a real page. */
function isSearchPath(path: string[] | undefined): boolean {
  const segments = (path ?? []).filter(Boolean);
  return segments.length === 1 && segments[0] === 'search';
}

/**
 * Everything a published address needs, fetched once per request.
 *
 * WRAPPED IN cache() AND THAT IS NOT A MICRO-OPTIMISATION. Next calls
 * generateMetadata and the page component in the SAME request, and both of them
 * call this. Without memoisation that is two tenant resolutions and two sets of
 * the six reads below, and each read is its own transaction that opens with a
 * begin, writes a set_config to name the tenant for RLS, runs its query and
 * commits. Twelve transactions to eu-west-2 where six would do, on every single
 * page view, before a byte of HTML leaves the server.
 *
 * It was measured rather than assumed: neither this file nor lib/db had a
 * cache() anywhere, and the one in lib/db/client.ts is a CONNECTION POOL, which
 * is a different thing that is easy to mistake for this at a glance.
 *
 * React's cache() memoises for the lifetime of one request and no longer, which
 * is exactly the scope wanted here. It must NOT become a longer-lived cache: a
 * published page has to reflect a publish immediately, and two visitors must
 * never share a tenant's data. Request scope is the whole safety argument.
 */
const load = cache(async function load(host: string, path: string[] | undefined) {
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
  const [page, theme, faces, settings, regions, navPages, tenantSlug] = await Promise.all([
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
    /*
     * The tenant's OWN slug, which is not the hostname and is what the font
     * route wants. Rides this Promise.all rather than adding a round trip.
     */
    getPublicTenantSlug(tenantId),
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
    /*
     * A TAG ARCHIVE: /{collectionKey}/tag/{tagSlug}, every post carrying the tag.
     * Three segments, the middle the literal "tag", and looked up only after the
     * pages have said no, exactly as an entry is. A collection with no such tag,
     * or nothing carrying it, is a 404 the same as any other guessed address.
     */
    if (segments.length === 3 && segments[1] === 'tag') {
      const tagged = await listPublishedByTag(tenantId, segments[0], segments[2], MAX_LISTING_ITEMS);
      if (!tagged) return null;

      return {
        page: null,
        entry: null,
        archive: {
          collectionKey: segments[0],
          tag: tagged.label,
          cards: tagged.items.map((row) =>
            itemAsCard(row.item, segments[0], row.slug, tagged.fields)),
        },
        theme,
        faces,
        settings,
        regions,
        navPages,
        tenantId,
        tenantSlug,
      };
    }

    if (segments.length !== 2) return null;
    const entry = await getPublishedItem(tenantId, segments[0], segments[1]);
    if (!entry) return null;

    return {
      page: null,
      entry: { ...entry, collectionKey: segments[0], slug: segments[1] },
      archive: null,
      theme,
      faces,
      settings,
      regions,
      navPages,
      tenantId,
      tenantSlug,
    };
  }

  /*
   * The listing blocks and the loop blocks, filled in before anything renders.
   *
   * One read per distinct collection across the header, the page and the footer,
   * for the largest count any block asked for, rather than one per block. The two
   * resolve in parallel: a listing pours a collection into a fixed card, a loop
   * into a card the client designed, but both read the same rows the same way.
   * See lib/content/listings.ts for why this is not the block's own job.
   */
  const trees = [regions.header, page.content, regions.footer];
  const [listings, loops] = await Promise.all([
    resolveListings(tenantId, trees),
    resolveLoops(tenantId, trees),
  ]);

  return {
    page: { ...page, content: fillPageLoops(fillPageListings(page.content, listings), loops) },
    entry: null,
    archive: null,
    theme,
    faces,
    settings,
    regions,
    navPages,
    tenantId,
    tenantSlug,
  };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { host, path } = await params;

  try {
    const found = await load(host, path);
    if (!found) {
      /*
       * The search results page, when no real page sits at /search. noindex,
       * for the same reason a tag archive is: a results view is a way to find
       * pages, not a page to rank, and letting it compete with the pages it
       * lists is the duplicate-content mistake. follow stays on, so an engine
       * still walks through to the pages.
       */
      if (isSearchPath(path)) return { title: 'Search', robots: { index: false, follow: true } };
      return { title: 'Not found', robots: { index: false, follow: false } };
    }

    /*
     * A TAG ARCHIVE is noindex: it is a way to find posts, not a page to rank,
     * and letting a thin filter view compete with the posts it lists is the
     * duplicate-content mistake the sitemap already avoids by leaving archives
     * out. follow stays on, so an engine still walks through to the posts.
     */
    if (found.archive) {
      const canonical = `https://${decodeURIComponent(host)}/${(path ?? []).join('/')}`.replace(/\/$/, '');
      return {
        title: `Posts tagged ${found.archive.tag}`,
        robots: { index: false, follow: true },
        alternates: { canonical },
      };
    }

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

export default async function SitePage({ params, searchParams }: Params) {
  const { host, path } = await params;

  const rawFound = await load(host, path);
  if (!rawFound) {
    /*
     * /search, but only when no real page lives there, so load has already had
     * its say and a client's own "search" page wins. The query rides in ?q= (a
     * GET form, see the Search block), and an empty or missing one renders the
     * page with its prompt rather than a 404.
     */
    if (isSearchPath(path)) {
      const query = await searchParams;
      const q = typeof query.q === 'string' ? query.q : Array.isArray(query.q) ? query.q[0] ?? '' : '';
      const data = await loadSearch(host, q);
      if (data) return renderSearchPage(host, data);
    }
    return gone(host, path);
  }

  const slug = decodeURIComponent(host);

  /*
   * SERVER-SIDE PERSONALISATION, resolved once here and applied to the tree
   * before anything else reads it. A section can carry an audience rule, and the
   * request says what the visitor is (country, device, traffic source, new
   * versus returning); the sections that fail the rule are dropped from the tree
   * NOW, so every derivation below (the hero and pull-up on sections[0], the
   * image preload set, the JSON-LD scan, the render) sees only what this visitor
   * sees, and the initial HTML carries exactly that. A shallow copy, never a
   * mutation of the cached load() result, so the metadata pass that shares it is
   * untouched and a crawler indexes the full page. See lib/content/audience.
   */
  const query = await searchParams;
  const utmCampaign =
    typeof query.utm_campaign === 'string'
      ? query.utm_campaign
      : Array.isArray(query.utm_campaign)
        ? query.utm_campaign[0] ?? null
        : null;
  const signals = await readVisitorSignals(slug, utmCampaign);
  const found = {
    ...rawFound,
    page: rawFound.page
      ? {
          ...rawFound.page,
          content: {
            ...rawFound.page.content,
            sections: personaliseSections(rawFound.page.content.sections, signals),
          },
        }
      : rawFound.page,
    entry: rawFound.entry
      ? {
          ...rawFound.entry,
          item: {
            ...rawFound.entry.item,
            sections: personaliseSections(rawFound.entry.item.sections, signals),
          },
        }
      : rawFound.entry,
  };

  /*
   * Dark mode is OPT IN: a page turns dark only when it actually carries a Light
   * / dark switch, in the header, the footer or the page's own body. When it
   * does, the dark palette rides on the same theme object (globals.css swaps it
   * in) and the switch is wired at the top of the render below. When it does not,
   * none of this is emitted and the page is byte for byte what it was, which is
   * the whole safety property: a visitor's system dark mode must never restyle a
   * site that did not ask for it. See hasThemeToggle and darkThemeTokens.
   */
  const scanTree = found.page ? found.page.content : found.entry ? found.entry.item : null;
  const dark =
    hasThemeToggle(found.regions.header) ||
    hasThemeToggle(scanTree) ||
    hasThemeToggle(found.regions.footer);
  const base = themeTokens(found.theme, familiesFromFiles(found.faces)).style;
  const theme = dark ? { ...base, ...darkThemeTokens(found.theme) } : base;

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
  const pageTitle = found.page
    ? found.page.title
    : found.entry
      ? found.entry.item.title
      : `Posts tagged ${found.archive!.tag}`;
  // The one tree a page or an entry carries and an archive does not: an archive
  // is a grid of OTHER posts, so it has no sections of its own. Null-safe
  // everywhere it is used below (a null region is already passed the same way),
  // so the archive drops out of the social-profile scan, the widget scripts and
  // the slideshow enhancer without any of them having to know it exists.
  const contentTree = found.page ? found.page.content : found.entry ? found.entry.item : null;

  /*
   * A page that carries its own header and footer (a home seeded from a
   * designed home) shows no site chrome, so the page is not double-headed.
   * Only a real page can opt out; a collection entry or archive always keeps
   * the site's header and footer.
   */
  const showChrome = found.page ? found.page.content.chrome !== false : true;

  /*
   * THE SERVER'S PASS OVER BORROWED MARKUP, once for all three trees.
   *
   * The imported design and the embed block hold somebody else's HTML, and the
   * cleaners that make it safe run here rather than in the components, so the
   * editor canvas can draw the same blocks without a parser in the browser (see
   * lib/content/prepared.ts, task #94). One map across the header, the content
   * and the footer because they share the block-id space and each of the three
   * renderers wants the same answer. Re-cleaned on every render, exactly as it
   * was when the components did it, so a restored snapshot or a hand-edited row
   * still lands on today's rules rather than the rules of the day it was saved.
   */
  /*
   * WHICH SIZES OF EACH PICTURE EXIST, in one query for the whole document.
   *
   * A block stores an address and nothing else, so the tree cannot know that the
   * same photograph is also stored at 400, 800 and 1600 pixels wide. That lives
   * on the media row, so it is read here and threaded beside the tree the way
   * `prepared` is, rather than written onto props where it would drift from the
   * bank. One query across all three trees, not one per image: a homepage can
   * carry twenty pictures and this runs on every published page view.
   *
   * Deliberately NOT inside load(): generateMetadata calls that too, and metadata
   * never renders an image, so putting it there would buy a query the social
   * card has no use for.
   *
   * An empty answer is the normal state for an older site and costs nothing: the
   * renderers fall back to a single src, which is what they did before variants
   * existed.
   */
  const imageSizes = await imageSizesForUrls(
    found.tenantId,
    imageUrlsIn([
      ...(found.regions.header?.sections ?? []),
      ...(contentTree?.sections ?? []),
      ...(found.regions.footer?.sections ?? []),
    ]),
  );

  const prepared = mergePrepared(
    prepareSections(found.regions.header?.sections, imageSizes),
    // The page's own tree, and the only one allowed to spend the eager slot.
    prepareSections(contentTree?.sections, imageSizes, { heroFirst: true }),
    prepareSections(found.regions.footer?.sections, imageSizes),
  );

  /*
   * Has the client PUT a trail on this page? If so the automatic one stands
   * down, so the page has exactly one either way. Read off the tree rather than
   * a flag on the row, because the block is content and a flag would be a second
   * copy that goes stale the moment somebody deletes it.
   */
  const placedCrumbs = hasBreadcrumbsBlock(contentTree);

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
      contentTree,
      found.regions.footer,
    ]),
  });

  return (
    <>
      {/*
        The Light / dark switch's flash guard and wiring, when the page carries a
        switch. First in the tree, so the guard runs before the content below it
        paints. Renders nothing at all otherwise, keeping the no-script promise.
      */}
      <ThemeToggleScript active={dark} />

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
      {/*
        THE TENANT'S SLUG, NOT THE HOSTNAME, and the difference was invisible and
        total. The font route takes a bare slug and builds the hostname itself,
        refusing anything with a dot on purpose so a slug cannot be dressed up as
        another domain. Handing it `slug`, which is decodeURIComponent(host),
        meant every font URL on every published page 404'd, and every client site
        was drawn in a fallback face rather than the typeface its design
        committed to. Nothing errored and no test caught it; the page simply
        looked slightly wrong forever.

        Found on 25 Aug 2026 because Andy noticed a headline wrapping onto two
        lines in the editor and one line live. The editor was right: it passes
        site.slug and always had.
      */}
      <FontHead tenantSlug={found.tenantSlug ?? slug} files={found.faces} typography={found.theme.typography} />

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
      {showChrome && (
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
      )}

      {/*
        THE TRAIL, AND THE REASON IT IS HERE RATHER THAN A BLOCK A CLIENT ADDS.
        We emit BreadcrumbList structured data for every nested page, and
        Google's guidance is that markup must represent VISIBLE content. Left to
        a block, the markup would be right on the pages somebody remembered and
        a mismatch everywhere else, which is worse than not emitting it at all.

        Between the header and the content, which is where a trail belongs, and
        it draws nothing on the home page.
      */}
      {/* Not on a tag archive: that is a filter view, not a place in the site's
          own tree, so there is no trail to draw to it.

          AND NOT WHEN THE PAGE CARRIES A BREADCRUMBS BLOCK. That block does not
          turn the trail on, it MOVES it: a client who wants the trail inside
          their hero puts one there, and this stops the page having two. Which is
          also why the block cannot be the only way to get a trail — a page
          nobody remembered would then have structured data claiming a breadcrumb
          that is not on the page, and that mismatch is what gets structured data
          ignored. See lib/content/breadcrumbs.ts. */}
      {!found.archive && !placedCrumbs && (
        <Breadcrumb path={currentPath} pageTitle={pageTitle} />
      )}

      {found.page ? (
        <PageRenderer
          page={fillBreadcrumbs(
            fillNavFolders(found.page.content, found.navPages),
            currentPath,
            pageTitle,
          )}
          theme={theme}
          prepared={prepared}
          sizes={imageSizes}
        />
      ) : found.entry ? (
        /* A post's own sections get the same fill. Without it a blog post
           carrying the block would stand the automatic trail down and then draw
           nothing, which is the one way this feature could lose a page its
           trail rather than move it. */
        <EntryRenderer
          entry={{
            ...found.entry,
            item: fillBreadcrumbs(found.entry.item, currentPath, pageTitle),
          }}
          theme={theme}
          prepared={prepared}
          sizes={imageSizes}
        />
      ) : (
        <ArchiveRenderer archive={found.archive!} theme={theme} />
      )}

      {showChrome && (
        <RegionRenderer
          region={fillNavRegion(found.regions.footer, found.navPages)}
          theme={theme}
          prepared={prepared}
          sizes={imageSizes}
        />
      )}

      {/* One script per distinct widget across all three, rather than each tree
          emitting its own and fetching the same file up to three times. */}
      <WidgetScripts
        trees={[
          found.regions.header,
          contentTree,
          found.regions.footer,
        ]}
      />

      {/* And, once, the slideshow enhancer, if any of the three holds one. */}
      <SlideshowScript
        trees={[
          found.regions.header,
          contentTree,
          found.regions.footer,
        ]}
      />

      {/* And the motion drift, on the rare page that carries a recipe needing one.
          Seven of the eight recipes are pure CSS and never reach this. */}
      <MotionScript
        trees={[
          found.regions.header,
          contentTree,
          found.regions.footer,
        ]}
      />

      {/* The tag manager noscript fallback, and any custom body HTML. Last, so
          nothing here delays the content above it. */}
      <NoRightClickScript settings={found.settings} />
      <CookieConsent settings={found.settings} />
      <FloatingWidgets settings={found.settings} signals={signals} />
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
  prepared,
  sizes,
}: {
  entry: {
    item: import('../../../../lib/content/collection').CollectionItem;
    /** The collection the post is in, so its tags can link to their archives. */
    collectionKey: string;
    /** What that collection declares, which is what turns its answers into
     *  a labelled row of facts. Empty for a blog. */
    fields: import('../../../../lib/content/collection-fields').FieldDef[];
    /** How the collection lays its entries out. See collection-layout.ts. */
    layout: import('../../../../lib/content/collection-layout').EntryLayout;
    /**
     * The corpus facts, when this entry is an adopted destination.
     *
     * Read on the JOIN in getPublishedItem rather than out of the item, because
     * the item holds the client's words and the corpus holds ours. Null for
     * every ordinary entry, which is nearly all of them.
     */
    reference: import('../../../../lib/content/reference').ReferenceFacts | null;
  };
  theme: React.CSSProperties;
  /** Markup the server has already cleaned. See lib/content/prepared.ts. */
  prepared?: import('../../../../lib/content/prepared').PreparedMap;
  /** Stored sizes by url. See lib/content/image-sizes.ts. */
  sizes?: import('../../../../lib/content/image-sizes').ImageSizes;
}) {
  const { item } = entry;
  const image = safeUrl(item.image);
  /*
   * THE HEADER STANDS DOWN WHEN THE CONTENT OPENS WITH ITS OWN BANNER, the same
   * way the automatic breadcrumb trail stands down for a breadcrumbs block.
   *
   * An adopted destination builds the banner the rest of the site uses: a
   * section with a background photograph, its own trail, an h1-styled heading
   * and a line of copy. Drawing the blog header as well gave the page two
   * openings, the second in a different type treatment, with a stray trail
   * above the picture and "3 min read" on a page about an island.
   */
  const ownBanner = carriesOwnBanner(item);
  /*
   * The facts this entry's collection declares, formatted into words.
   *
   * ALL OF THEM, unlike a card, which shows the first few. A card is a glance
   * inside a grid and has a fixed height to keep; this is the page somebody
   * opened to find these out, so holding any of them back would be answering
   * less than was asked.
   */
  const facts = fieldFacts(entry.fields, item.fields);
  /*
   * THE CORPUS'S OWN FACTS, when this entry was adopted from it rather than typed.
   * Null for every ordinary entry, which is most of them, so a blog post renders
   * exactly as it did. See lib/content/reference.ts.
   *
   * COMES FROM THE READ, NOT FROM THE ITEM. An earlier version looked in
   * `item.fields`, which is the client's own answers to their own collection's
   * questions, and would have found nothing there however many destinations had
   * been adopted. The facts live on the corpus row this entry points at.
   */
  const reference = entry.reference;
  // "By Jane Doe · 4 min read", each part only when it is there. Reading time is
  // worked out from the body, never stored: see lib/content/reading-time.ts.
  const minutes = readingTime(item.sections);
  const byline = [item.author, minutes > 0 ? `${minutes} min read` : '']
    .filter(Boolean)
    .join(' · ');

  return (
    /*
     * ONE ATTRIBUTE, AND THE STYLESHEET BUILDS THE REST.
     *
     * The three layouts draw the same markup in the same order, which is what
     * keeps one entry component honest about what an entry contains. A second
     * component per layout is how two of them drift apart the first time
     * somebody adds a field, and it would have put the picture in two places in
     * the document for the sake of moving it on the screen.
     */
    <article className="tgs-page tgs-entry" data-layout={entry.layout} style={theme}>
      {!ownBanner && (
      <header className="tgs-entry__head">
        {item.date && (
          <p className="tgs-entry__date">
            <time dateTime={item.date}>{formatDate(item.date)}</time>
          </p>
        )}
        <h1 className="tgs-entry__title">{item.title}</h1>
        {byline && <p className="tgs-entry__byline">{byline}</p>}
        {item.summary && <p className="tgs-entry__summary">{item.summary}</p>}

        {facts.length > 0 && (
          /*
           * ABOVE THE PICTURE, not below the article. Somebody who has opened a
           * tour is deciding, and the price and the length are the decision;
           * putting them under a thousand words would be making them scroll for
           * the answer they came for. A definition list for the same reason the
           * card uses one: these are labelled values, not loose numbers.
           */
          <dl className="tgs-entry__facts">
            {facts.map((fact) => (
              <div className="tgs-entry__fact" key={fact.key}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {item.tags.length > 0 && (
          <ul className="tgs-entry__tags">
            {item.tags.map((tag) => (
              <li key={tag}>
                {/* A link to the tag's archive: every post that shares it. The
                    pill styling moves onto the anchor so it still reads as a
                    pill, and gains a hover now that it goes somewhere. */}
                <a className="tgs-entry__tag" href={tagArchivePath(entry.collectionKey, tag)}>
                  {tag}
                </a>
              </li>
            ))}
          </ul>
        )}
        {image && (
          <div className="tgs-entry__image">
            <img src={image} alt={item.alt} decoding="async" />
          </div>
        )}
      </header>
      )}

      {/*
        THE CORPUS PANEL IS A BAND OF ITS OWN, NOT PART OF THE HEADER, and it was
        moved out here the day the magazine seed landed.

        In the "Picture first" layout the header IS the banner photograph: it has
        a min-height, its picture at inset 0 behind everything, and an explicit
        order on each child. .tgs-dest had no order, so it fell to 0 and a facts
        grid and a twelve-month chart drew straight over the photograph.

        Reading it as a band is also just truer. What sits in the header is the
        entry announcing itself, title and summary and picture. This is reference
        material about the place, which is a different thing that happens to come
        next, and giving it its own ground is what lets it look deliberate on
        every one of the three entry layouts rather than only on the flat one.
      */}
      {reference && (
        <div className="tgs-entry__reference">
          <DestinationPanel facts={reference} />
        </div>
      )}

      {item.sections.map((section, index) => (
        <SectionRenderer key={section.id} section={section} index={index} prepared={prepared} sizes={sizes} />
      ))}
    </article>
  );
}

/**
 * A tag's archive: every post carrying that tag, as a grid of cards.
 *
 * A SYSTEM PAGE, not one a client composed, so it is drawn here rather than out
 * of blocks: a heading naming the tag, then the same CardsBlock a listing uses,
 * handed the posts already resolved to cards. The cards carry their own tags, so
 * the grid reads exactly like any blog listing. noindex is set in the metadata,
 * because a tag archive is a way to FIND posts, not a page to rank in their place.
 */
function ArchiveRenderer({
  archive,
  theme,
}: {
  archive: { tag: string; cards: Array<Record<string, unknown>> };
  theme: React.CSSProperties;
}) {
  return (
    <main className="tgs-page tgs-archive" style={theme}>
      <header className="tgs-archive__head">
        <p className="tgs-archive__eyebrow">Tagged</p>
        <h1 className="tgs-archive__title">{archive.tag}</h1>
      </header>
      <CardsBlock props={{ items: archive.cards, columns: '3', gap: 'l' }} />
    </main>
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

/**
 * The search results page's own load, run ONLY when no real page lives at
 * /search, so a client who makes a page called "search" keeps it. It reads the
 * same shell a page reads (theme, fonts, header, footer, settings) plus the
 * whole searchable corpus — every published page AND every published blog post —
 * reduced to text and ranked in memory. See lib/content/search.ts,
 * listPublishedForSearch and listPublishedItemsForSearch.
 *
 * Below the page render on purpose: the page is the primary render, and its
 * widget and slideshow scans are the ones the tests read as "the public site".
 */
async function loadSearch(host: string, query: string) {
  const tenantId = await resolveTenantByHostname(decodeURIComponent(host));
  if (!tenantId) return null;

  const [theme, faces, settings, regions, navPages, pageDocs, postDocs, tenantSlug] =
    await Promise.all([
      getPublicTheme(tenantId),
      listFontFaces(tenantId),
      getPublicSettings(tenantId),
      getPublishedRegions(tenantId),
      listPublishedNavPages(tenantId),
      listPublishedForSearch(tenantId),
      listPublishedItemsForSearch(tenantId),
      // The slug the font route wants, which is not the hostname. See the note
      // on FontHead in this file.
      getPublicTenantSlug(tenantId),
    ]);

  /*
   * PAGES AND POSTS IN ONE CORPUS, ranked together with no thumb on the scale
   * for either. A post about Crete and a page about Crete are both answers to
   * "Crete", and which one is the better answer is a question the score is
   * already asking. Sorting posts below pages would be asserting that a page is
   * always more relevant, which on a travel site is often the opposite of true.
   */
  return {
    theme, faces, settings, regions, navPages, tenantSlug, query,
    hits: searchDocs([...pageDocs, ...postDocs], query),
  };
}

function renderSearchPage(host: string, data: NonNullable<Awaited<ReturnType<typeof loadSearch>>>) {
  const slug = decodeURIComponent(host);

  // The results page wears the same header and footer a page does, so it opts
  // into dark the same way: if either carries a switch, it turns dark too.
  const dark = hasThemeToggle(data.regions.header) || hasThemeToggle(data.regions.footer);
  const base = themeTokens(data.theme, familiesFromFiles(data.faces)).style;
  const theme = dark ? { ...base, ...darkThemeTokens(data.theme) } : base;

  return (
    <>
      <ThemeToggleScript active={dark} />
      <SiteHead settings={data.settings} />
      {/* The slug, not the hostname. See the note on the other FontHead above. */}
      <FontHead tenantSlug={data.tenantSlug ?? slug} files={data.faces} typography={data.theme.typography} />

      {/* The header and footer are siblings of the results, each carrying the
          theme itself, exactly as they are around a page. */}
      <RegionRenderer region={fillNavRegion(data.regions.header, data.navPages)} theme={theme} />
      <SearchResults query={data.query} hits={data.hits} theme={theme} />
      <RegionRenderer region={fillNavRegion(data.regions.footer, data.navPages)} theme={theme} />

      {/* The header and footer may still hold a widget or a slideshow, so the
          two enhancers scan them here as they do on a page. A search results
          page has no page-content tree of its own, so it is these two only. */}
      <WidgetScripts trees={[data.regions.header, data.regions.footer]} />
      <SlideshowScript trees={[data.regions.header, data.regions.footer]} />
      <MotionScript trees={[data.regions.header, data.regions.footer]} />
      <NoRightClickScript settings={data.settings} />
      <CookieConsent settings={data.settings} />
      <FloatingWidgets settings={data.settings} />
      <SiteBody settings={data.settings} />
    </>
  );
}
