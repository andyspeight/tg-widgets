import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

// Imported here as well as in SiteDashboard. The error paths below render
// .sv- classes without mounting the dashboard, and a bare unstyled error is a
// poor way to explain a misconfiguration.
import '../../components/sites/sites.css';
import { SiteDashboard } from '../../components/sites/SiteDashboard';
import { activeSite, currentUser } from '../../lib/auth/session';
import { listPages } from '../../lib/db/pages';
import { getTenant, siteUrl } from '../../lib/db/tenants';

export const metadata: Metadata = {
  title: 'Pages · Travelgenix Sites',
  robots: { index: false, follow: false },
};

/**
 * Never cached. The list of pages is the one thing on this screen that must
 * be true right now, and a stale one would show a page an agent has just
 * deleted.
 */
export const dynamic = 'force-dynamic';

export default async function SitesPage() {
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  let site: Awaited<ReturnType<typeof activeSite>> = null;
  let failure: string | null = null;

  try {
    user = await currentUser();
    // Only ask which site once there is somebody to ask about. Reversing these
    // would run a membership query for an anonymous request on every hit.
    if (user) site = await activeSite();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  // The database is not reachable. Almost always a missing DATABASE_URL, and
  // saying so beats a stack trace nobody can act on.
  if (failure) return <Unreachable detail={failure} />;

  // Not signed in, or signed in as somebody whose account has since gone.
  // Both end up at the same place, and ?next= brings them back here after.
  if (!user) redirect('/signin?next=%2Fsites');

  if (!site) {
    return (
      <Problem heading="No sites yet">
        <p>
          You are signed in as <code>{user.email}</code>, but this account is not
          a member of any site.
        </p>
        <p>
          Somebody with owner access has to add you to one. Until then there is
          nothing here to edit.
        </p>
      </Problem>
    );
  }

  const [tenant, url, pages] = await Promise.all([
    getTenant(site.tenantId),
    siteUrl(site.tenantId),
    listPages(site.tenantId),
  ]);

  return (
    <SiteDashboard
      account={{ email: user.email, name: user.name }}
      site={{ slug: site.slug, available: site.available }}
      siteName={tenant?.name ?? site.name}
      siteUrl={url}
      pages={pages}
    />
  );
}

// ---------------------------------------------------------------------------

function Unreachable({ detail }: { detail: string }) {
  const missingUrl = detail.includes('is not set');
  const wrongRole = detail.includes('connects as');

  return (
    <Problem heading="Cannot reach the database">
      {missingUrl && (
        <p>
          <code>DATABASE_URL</code> is not set for this environment. The
          walkthrough is in <code>tg-sites/db/SETUP.md</code>.
        </p>
      )}
      {wrongRole && (
        <p>
          The connection string is for the wrong role. It must connect as
          <code> tg_sites_app</code>, not as <code>postgres</code>, which
          bypasses row level security entirely.
        </p>
      )}
      {!missingUrl && !wrongRole && (
        <p>The database refused the connection. The message it gave is below.</p>
      )}
      <pre>{detail}</pre>
    </Problem>
  );
}

function Problem({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="sv-root" data-theme="light">
      <div className="sv-wrap">
        <div className="sv-error">
          <h2>{heading}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
