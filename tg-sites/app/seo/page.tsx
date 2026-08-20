import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

// editor.css FIRST, because it defines the --ed- tokens the other two are
// written in. Without it every var() on this screen resolves to nothing and the
// page renders as unstyled text, which is exactly the bug this import fixes.
import '../../components/editor/editor.css';
import '../../components/sites/sites.css';
import '../../components/seo/seo.css';
import { SeoDashboard, type PageReport } from '../../components/seo/SeoDashboard';
import { activeSite, currentUser } from '../../lib/auth/session';
import { listPagesForAudit } from '../../lib/db/pages';
import { countRedirects } from '../../lib/db/redirects';
import { getSettings } from '../../lib/db/settings';
import { getTenant, siteUrl } from '../../lib/db/tenants';
import { auditPage, auditSite } from '../../lib/seo/audit';

export const metadata: Metadata = {
  title: 'Search and AI visibility · Travelgenix Sites',
  robots: { index: false, follow: false },
};

/**
 * How this site is found, by search engines and by AI assistants.
 *
 * ITS OWN SCREEN RATHER THAN A PANEL IN THE EDITOR, because the question it
 * answers is about the whole site. "Which of my pages is letting me down" cannot
 * be asked from inside one page, and the single most important finding, an empty
 * company profile, is not about a page at all.
 *
 * EVERY NUMBER ON IT IS DERIVED, nothing is stored. There is no report table and
 * no nightly job, because a stored report is a report that can be out of date
 * while looking authoritative. It is computed from the published content on
 * every visit, so it is either right or the page did not load.
 *
 * See lib/seo/audit.ts for what is checked and why each check earns its place.
 */
export const dynamic = 'force-dynamic';

function Problem({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    // The token root, so even the error path is styled rather than bare text.
    <div className="sv-root" data-theme="light">
      <main className="sv-wrap">
        <div className="sv-error">
          <h1 className="sv-title">{heading}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

export default async function SeoPage() {
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
        <p>The database refused the connection, so there is nothing to report on yet.</p>
        <pre>{failure}</pre>
      </Problem>
    );
  }

  if (!user) redirect('/signin?next=%2Fseo');

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

  const [tenant, url, settings, pages, redirects] = await Promise.all([
    getTenant(site.tenantId),
    siteUrl(site.tenantId),
    getSettings(site.tenantId),
    listPagesForAudit(site.tenantId),
    countRedirects(site.tenantId),
  ]);

  const published = pages.filter((page) => page.published);

  const reports: PageReport[] = pages.map((page) => ({
    id: page.id,
    title: page.title,
    path: page.path,
    published: page.published,
    /*
     * An unpublished page is not audited at all, rather than audited and marked.
     * Its findings would be about a draft nobody can reach, and a list of things
     * to fix on a page that is not on the internet is work in the wrong order.
     */
    findings: page.published && page.content
      ? auditPage(page.content, page.title, settings)
      : [],
  }));

  return (
    // The token root and the light default, matching the settings screen. The
    // dashboard sets its own width, so no .sv-wrap to cap it at reading width.
    <div className="sv-root" data-theme="light">
      <SeoDashboard
        siteName={settings.companyName || tenant?.name || 'this site'}
        siteUrl={url}
        siteFindings={auditSite(settings, published.length)}
        redirects={redirects}
        pages={reports}
      />
    </div>
  );
}
