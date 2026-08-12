import { redirect } from 'next/navigation';

import { EditorShell } from '../../components/editor/EditorShell';
import { activeSite, currentUserId } from '../../lib/auth/session';
import { getPage, listPages } from '../../lib/db/pages';
import { getRegion } from '../../lib/db/regions';
import { getItem } from '../../lib/db/collections';
import { itemAsPage, itemMeta } from '../../lib/content/collection-page';
import { FontHead } from '../../components/render/FontHead';
import { listFontFaces } from '../../lib/db/fonts';
import { getTheme } from '../../lib/db/theme';
import { REGIONS, type RegionName } from '../../lib/content/schema';
import { regionAsPage } from '../../lib/content/region-page';
import { familiesFromFiles } from '../../lib/theme/fonts';
import { themeTokens } from '../../lib/theme/tokens';

export const metadata = {
  title: 'Editor · Travelgenix Sites',
  // The editor must never be indexed, and it must never be framed. The
  // framing rule becomes a real frame-ancestors header once this sits
  // behind auth on its own hostname.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The editor always edits a real page.
 *
 * There is no scratch mode. It was tempting, because the shell already had
 * one in localStorage, but two persistence paths means every save, undo and
 * publish has to work twice and only one of them ever gets exercised.
 *
 * SINCE 31 JUL 2026 IT ALSO EDITS THE HEADER AND THE FOOTER, at ?region=header
 * and ?region=footer. Those are sections, rows, columns and blocks exactly as a
 * page is, so the SAME shell edits them: the region's sections are wrapped as a
 * Page on the way in and unwrapped on the way out by
 * lib/content/region-page.ts, and the shell's `region` prop points its saves at
 * the region actions and hides the few controls a page has and a header does
 * not. Building a second editor for the difference would have meant two of
 * everything, with only one of them ever exercised.
 */
export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; region?: string; item?: string }>;
}) {
  const { page: pageId, region: regionParam, item: itemId } = await searchParams;

  /*
   * The guard comes first, before the page id is even looked at.
   *
   * Reversing these would mean an anonymous request could tell a real page id
   * from a made-up one by which way it was bounced, and a page id is a uuid
   * that appears in a URL an agent might paste anywhere.
   */
  const userId = await currentUserId();
  if (!userId) {
    const next = pageId
      ? `/signin?next=${encodeURIComponent(`/editor?page=${pageId}`)}`
      : regionParam
        ? `/signin?next=${encodeURIComponent(`/editor?region=${regionParam}`)}`
        : itemId
          ? `/signin?next=${encodeURIComponent(`/editor?item=${itemId}`)}`
          : '/signin?next=%2Fsites';
    redirect(next);
  }

  // A region name that is not one of the two goes back to the dashboard rather
  // than being passed down as a string somebody chose.
  const region: RegionName | null =
    regionParam && (REGIONS as readonly string[]).includes(regionParam)
      ? (regionParam as RegionName)
      : null;

  if (!pageId && !region && !itemId) redirect('/sites');

  const site = await activeSite();
  if (!site) redirect('/sites');

  // Theme, fonts and the site's page list in parallel with the content,
  // whichever kind it is: the canvas has to show the site in the client's own
  // colours, or the preview is a preview of a different site, and the rail's
  // Pages panel needs the list to let you jump between pages without leaving.
  const [theme, faces, sitePages] = await Promise.all([
    getTheme(site.tenantId),
    // The app role, not the renderer: the editor is behind sign-in and reads its
    // own tenant's library through the connection it already has.
    listFontFaces(site.tenantId, 'app'),
    listPages(site.tenantId),
  ]);

  const head = (
    <FontHead tenantSlug={site.slug} files={faces} typography={theme.typography} />
  );

  // Staff tools are for Travelgenix people, not for a client's agent. Owner is
  // the closest thing the membership table has to that today; it becomes a real
  // staff flag on the user when there is one to read.
  const shared = {
    isStaff: site.role === 'owner',
    siteTheme: themeTokens(theme, familiesFromFiles(faces)).style,
    // Cosmetic only: version history marks the entries this person published.
    // Nothing is gated on it.
    currentUserId: userId,
    // Just the little each row needs; the summaries carry dates and more, which
    // the panel does not show. See PageLink.
    pages: sitePages.map((summary) => ({
      id: summary.id,
      title: summary.title,
      slug: summary.slug,
      status: summary.status,
      parentId: summary.parentId,
    })),
  };

  if (region) {
    const record = await getRegion(site.tenantId, region);

    return (
      <>
        {head}
        <EditorShell
          {...shared}
          region={region}
          initialRegionFlags={{
            sticky: record.region.sticky,
            overlay: record.region.overlay,
          }}
          // Not a real page id and nothing looks it up. The shell wants one for
          // the page path it is not taking; see regionAsPage.
          pageId={`region-${region}`}
          initialPage={regionAsPage(record.region)}
          // A region has no status of its own. Published once means published
          // from then on, and only "are there newer changes" varies after that.
          initialStatus={record.publishedAt ? 'published' : 'draft'}
          initialHasUnpublishedChanges={record.hasUnpublishedChanges}
        />
      </>
    );
  }

  if (itemId) {
    /*
     * AN ENTRY IN A COLLECTION: a blog post, a destination guide.
     *
     * The third thing this screen edits, and the same arrangement as the second:
     * the entry's body is handed to the shell as a Page and the fields that are
     * not sections travel beside it. See lib/content/collection-page.ts.
     */
    const found = await getItem(site.tenantId, itemId);
    // Not found and not yours give the same answer, as everywhere else here.
    if (!found) redirect('/collections');

    return (
      <>
        {head}
        <EditorShell
          {...shared}
          itemId={found.id}
          initialItemMeta={itemMeta(found.item, found.slug)}
          pageId={found.id}
          initialPage={itemAsPage(found.item, found.id, found.slug)}
          initialStatus={found.status}
          initialHasUnpublishedChanges={found.hasUnpublishedChanges}
        />
      </>
    );
  }

  // Not found and not yours give the same answer here, deliberately. RLS
  // makes another tenant's page indistinguishable from one that does not
  // exist, so a guessed id confirms nothing.
  //
  // The header and footer come along too, so the canvas can draw the page inside
  // the chrome that wraps every page of the site. Read alongside the page rather
  // than after it, since none of the three waits on another. They are the site's
  // furniture here, shown not edited, so only their sections are wanted; the
  // region editor at ?region= is still where they are changed.
  const [page, headerRecord, footerRecord] = await Promise.all([
    getPage(site.tenantId, pageId!),
    getRegion(site.tenantId, 'header'),
    getRegion(site.tenantId, 'footer'),
  ]);
  if (!page) redirect('/sites');

  return (
    <>
      {/* The canvas shows the client's real typefaces, so the same rules the
          published page gets are needed here too. */}
      {head}

      <EditorShell
        {...shared}
        pageId={page.id}
        initialPage={page.content}
        initialStatus={page.status}
        initialHasUnpublishedChanges={page.hasUnpublishedChanges}
        chromeHeader={{
          content: regionAsPage(headerRecord.region),
          sticky: headerRecord.region.sticky,
          overlay: headerRecord.region.overlay,
          published: headerRecord.publishedAt != null,
          unpublished: headerRecord.hasUnpublishedChanges,
        }}
        chromeFooter={{
          content: regionAsPage(footerRecord.region),
          sticky: footerRecord.region.sticky,
          overlay: footerRecord.region.overlay,
          published: footerRecord.publishedAt != null,
          unpublished: footerRecord.hasUnpublishedChanges,
        }}
      />
    </>
  );
}
