import type { Metadata } from 'next';

// Imported here as well as in SiteDashboard. The error paths below render
// .sv- classes without mounting the dashboard, and a bare unstyled error is a
// poor way to explain a misconfiguration.
import '../../components/sites/sites.css';
import { SiteDashboard } from '../../components/sites/SiteDashboard';
import { AUTH_IS_NOT_BUILT_YET } from '../../lib/auth/temporary';
import { listPages } from '../../lib/db/pages';
import { getTenant, siteUrl } from '../../lib/db/tenants';
import { currentTenantId, currentWorkspace, DEFAULT_WORKSPACE } from '../../lib/session';

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
  const workspace = await currentWorkspace();

  let tenantId: string | null = null;
  let failure: string | null = null;

  try {
    tenantId = await currentTenantId();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  // The database is not reachable. Almost always a missing DATABASE_URL, and
  // saying so beats a stack trace nobody can act on.
  if (failure) return <Unreachable detail={failure} />;

  if (!tenantId) {
    return (
      <Problem heading={`No site called "${workspace}"`}>
        <p>
          The workspace this browser remembers does not exist in the database.
          It may have been renamed or removed.
        </p>
        <p>
          The seeded site is <code>{DEFAULT_WORKSPACE}</code>. Adding one is a
          row in <code>tenants</code> until there is a screen for it.
        </p>
      </Problem>
    );
  }

  const [tenant, url, pages] = await Promise.all([
    getTenant(tenantId),
    siteUrl(tenantId),
    listPages(tenantId),
  ]);

  return (
    <SiteDashboard
      workspace={workspace}
      siteName={tenant?.name ?? workspace}
      siteUrl={url}
      pages={pages}
      openAccess={AUTH_IS_NOT_BUILT_YET}
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
