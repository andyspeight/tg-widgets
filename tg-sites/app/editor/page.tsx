import { redirect } from 'next/navigation';

import { EditorShell } from '../../components/editor/EditorShell';
import { AUTH_IS_NOT_BUILT_YET } from '../../lib/auth/temporary';
import { getPage } from '../../lib/db/pages';
import { currentTenantId } from '../../lib/session';

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
 *
 * `isStaff` is still hardcoded, because there is no auth. It becomes a
 * session lookup at the same time as everything else in lib/auth/temporary.
 */
export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageId } = await searchParams;
  if (!pageId) redirect('/sites');

  const tenantId = await currentTenantId();
  if (!tenantId) redirect('/sites');

  // Not found and not yours give the same answer here, deliberately. RLS
  // makes another tenant's page indistinguishable from one that does not
  // exist, so a guessed id confirms nothing.
  const page = await getPage(tenantId, pageId);
  if (!page) redirect('/sites');

  return (
    <EditorShell
      isStaff
      pageId={page.id}
      initialPage={page.content}
      initialStatus={page.status}
      initialHasUnpublishedChanges={page.hasUnpublishedChanges}
      openAccess={AUTH_IS_NOT_BUILT_YET}
    />
  );
}
