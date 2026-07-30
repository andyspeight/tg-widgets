import { redirect } from 'next/navigation';

import { EditorShell } from '../../components/editor/EditorShell';
import { activeSite, currentUserId } from '../../lib/auth/session';
import { getPage } from '../../lib/db/pages';

export const metadata = {
  title: 'Editor · Travelgenix Sites',
  // The editor must never be indexed, and it must never be framed. The
  // framing rule becomes a real frame-ancestors header once this sits
  // behind auth at sites.travelify.io.
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
  if (!(await currentUserId())) {
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
  const page = await getPage(site.tenantId, pageId);
  if (!page) redirect('/sites');

  return (
    <EditorShell
      // Staff tools are for Travelgenix people, not for a client's agent.
      // Owner is the closest thing the membership table has to that today; it
      // becomes a real staff flag on the user when there is one to read.
      isStaff={site.role === 'owner'}
      pageId={page.id}
      initialPage={page.content}
      initialStatus={page.status}
      initialHasUnpublishedChanges={page.hasUnpublishedChanges}
    />
  );
}
