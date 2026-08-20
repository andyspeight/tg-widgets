import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

// Imported here as well as in MembersScreen, for the same reason /sites does
// it: the error paths below render .sv- classes without mounting the screen,
// and a bare unstyled error explains a misconfiguration badly.
import '../../components/sites/sites.css';
import { MembersScreen } from '../../components/members/MembersScreen';
import { activeSite, currentUser } from '../../lib/auth/session';
import { isStaffEmail } from '../../lib/auth/staff';
import { listInvites, listMembers, siteDefaultPermissions } from '../../lib/db/members';

export const metadata: Metadata = {
  title: 'People · Travelgenix Sites',
  robots: { index: false, follow: false },
};

/**
 * Who can edit this site.
 *
 * Never cached. A membership that has just been revoked must not still be on
 * screen, and a colleague who has just joined should be.
 */
export const dynamic = 'force-dynamic';

function Problem({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="sv-wrap">
      <div className="sv-error">
        <h1 className="sv-title">{heading}</h1>
        {children}
      </div>
    </main>
  );
}

export default async function MembersPage() {
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  let site: Awaited<ReturnType<typeof activeSite>> = null;
  let failure: string | null = null;

  try {
    user = await currentUser();
    if (user) site = await activeSite();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (failure) {
    return (
      <Problem heading="Cannot reach the database">
        <p>The database refused the connection, so there is nobody to list.</p>
        <pre>{failure}</pre>
      </Problem>
    );
  }

  if (!user) redirect('/signin?next=%2Fmembers');

  if (!site) {
    return (
      <Problem heading="No sites yet">
        <p>
          You are signed in as <code>{user.email}</code>, but this account is not a
          member of any site.
        </p>
      </Problem>
    );
  }

  const [members, invites, defaultPermissions] = await Promise.all([
    listMembers(site.tenantId),
    listInvites(site.tenantId),
    siteDefaultPermissions(site.tenantId),
  ]);

  /*
   * WORKED OUT HERE AND SENT DOWN, and it decides only what is DRAWN. The
   * actions ask the same question again for themselves, because a prop is a
   * statement about a screen and a server action is a public endpoint.
   *
   * Staff count as owners for the same reason they can edit custom code: we
   * build these sites, and being locked out of a client's members list would
   * mean asking them to add us before we could help.
   */
  const canManage = site.role === 'owner' || isStaffEmail(user.email);

  return (
    <main className="sv-wrap">
      <MembersScreen
        account={{ email: user.email, name: user.name }}
        site={{ slug: site.slug, name: site.name, available: site.available }}
        members={members}
        invites={invites}
        canManage={canManage}
        meId={user.id}
        defaultPermissions={defaultPermissions}
      />
    </main>
  );
}
