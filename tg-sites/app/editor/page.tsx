import { redirect } from 'next/navigation';

import { EditorShell } from '../../components/editor/EditorShell';
import { activeSite, currentUserId } from '../../lib/auth/session';
import { getPage } from '../../lib/db/pages';
import { FontHead } from '../../components/render/FontHead';
import { listFontFaces } from '../../lib/db/fonts';
import { getTheme } from '../../lib/db/theme';
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
 */
export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageId } = await searchParams;

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
      : '/signin?next=%2Fsites';
    redirect(next);
  }

  if (!pageId) redirect('/sites');

  const site = await activeSite();
  if (!site) redirect('/sites');

  // Not found and not yours give the same answer here, deliberately. RLS
  // makes another tenant's page indistinguishable from one that does not
  // exist, so a guessed id confirms nothing.
  //
  // Theme alongside it, in parallel: the canvas has to show the site in the
  // client's own colours, or the preview is a preview of a different site.
  const [page, theme, faces] = await Promise.all([
    getPage(site.tenantId, pageId),
    getTheme(site.tenantId),
    // The app role, not the renderer: the editor is behind sign-in and reads its
    // own tenant's library through the connection it already has.
    listFontFaces(site.tenantId, 'app'),
  ]);
  if (!page) redirect('/sites');

  return (
    <>
      {/* The canvas shows the client's real typefaces, so the same rules the
          published page gets are needed here too. */}
      <FontHead tenantSlug={site.slug} files={faces} typography={theme.typography} />

      <EditorShell
      // Staff tools are for Travelgenix people, not for a client's agent.
      // Owner is the closest thing the membership table has to that today; it
      // becomes a real staff flag on the user when there is one to read.
      isStaff={site.role === 'owner'}
      pageId={page.id}
      initialPage={page.content}
      initialStatus={page.status}
      initialHasUnpublishedChanges={page.hasUnpublishedChanges}
        siteTheme={themeTokens(theme, familiesFromFiles(faces)).style}
        // Cosmetic only: version history marks the entries this person published.
        // Nothing is gated on it.
        currentUserId={userId}
      />
    </>
  );
}
