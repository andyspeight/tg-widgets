import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

// Imported here as well as in SiteDashboard. The error paths below render
// .sv- classes without mounting the dashboard, and a bare unstyled error is a
// poor way to explain a misconfiguration.
import '../../components/sites/sites.css';
import { SiteDashboard } from '../../components/sites/SiteDashboard';
import { activeSite, currentUser } from '../../lib/auth/session';
import { isStaffEmail } from '../../lib/auth/staff';
import { listPageFill, listPages } from '../../lib/db/pages';
import { getSettings } from '../../lib/db/settings';
import { siteIsEmpty } from '../../lib/db/starters';
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

/*
 * A minute, for the duplicate action.
 *
 * Two things here are slow. duplicateSiteAction copies a whole site including
 * every image object one at a time, and an image-heavy site runs well past the
 * default limit. The AI site planner is the other: it runs on the build model
 * with thinking on, and its own budget has to sit inside this number so a slow
 * answer times out with a message rather than being killed without one. The rest of the route is unaffected: this is
 * a ceiling, not a reservation. A site so large it needs longer than this would
 * want a background job rather than a bigger number here.
 */
export const maxDuration = 120;

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

  /*
   * Five reads in parallel rather than three, since 1 Aug 2026. The last two
   * are for the starter wizard: whether it can still be offered, and what the
   * client has already told us so it asks nothing twice. Both are cheap and
   * neither depends on the others.
   */
  const [tenant, url, pages, canStart, settings, existingPages] = await Promise.all([
    getTenant(site.tenantId),
    siteUrl(site.tenantId),
    listPages(site.tenantId),
    siteIsEmpty(site.tenantId),
    getSettings(site.tenantId),
    // Which addresses are taken and which of them have work on them, so the AI
    // planner can say what it would leave alone before anybody presses build.
    listPageFill(site.tenantId),
  ]);

  return (
    <SiteDashboard
      account={{ email: user.email, name: user.name }}
      site={{ slug: site.slug, available: site.available }}
      siteName={tenant?.name ?? site.name}
      siteUrl={url}
      pages={pages}
      canStart={canStart}
      existingPages={existingPages}
      // Making a site is a staff job, the same gate as custom code and domains.
      // The action checks it too; this only decides whether the button is drawn.
      canCreateSite={isStaffEmail(user.email)}
      profile={{
        company: settings.companyName,
        town: settings.addressLocality,
        about: settings.companyAbout,
      }}
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
