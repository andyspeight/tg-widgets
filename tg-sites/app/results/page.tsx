import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

// editor.css FIRST, because it defines the --ed- tokens the others are written
// in. Without it every var() on this screen resolves to nothing and the page
// renders as unstyled text, which is exactly the bug this import fixes.
import '../../components/editor/editor.css';
import '../../components/sites/sites.css';
import '../../components/results/results.css';
import { ResultsDashboard, type PageReport } from '../../components/results/ResultsDashboard';
import { activeSite, currentUser } from '../../lib/auth/session';
import { listPagesForAudit } from '../../lib/db/pages';
import { countRedirects } from '../../lib/db/redirects';
import { readEnquiryDays } from '../../lib/db/report';
import { getSettings } from '../../lib/db/settings';
import { getTenant, siteUrl } from '../../lib/db/tenants';
import { listVisitRows } from '../../lib/db/visits';
import { summariseEnquiries } from '../../lib/results/enquiries';
import { auditPage, auditSite } from '../../lib/seo/audit';
import { summariseVisits } from '../../lib/visits/summary';

export const metadata: Metadata = {
  title: 'Results · Travelgenix Sites',
  robots: { index: false, follow: false },
};

/**
 * The client's results: how findable the site is, who is reading it, what came
 * through the forms, and what to fix next, on one board.
 *
 * ITS OWN SCREEN, because the question it answers is about the whole site.
 * "Which of my pages is letting me down" cannot be asked from inside one page,
 * and the single most important finding, an empty company profile, is not
 * about a page at all. It replaced /seo on 16 Sep 2026 (that address forwards
 * here), taking the audit with it and adding the readers and the enquiries.
 *
 * EVERY NUMBER ON IT IS DERIVED on every visit: the audit from the published
 * content, the readers from the visit tally, the enquiries from the form rows.
 * There is no report table for this screen, because a stored report is a
 * report that can be out of date while looking authoritative.
 *
 * See lib/seo/audit.ts for what is checked and why each check earns its place,
 * lib/visits/summary.ts for the readers and lib/results/enquiries.ts for the
 * enquiries.
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

/** The window: thirty days unless ninety was asked for. Anything else is thirty. */
function windowDays(value: string | string[] | undefined): 30 | 90 {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '90' ? 90 : 30;
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  if (!user) redirect('/signin?next=%2Fresults');

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

  const days = windowDays((await searchParams).days);
  const now = new Date();

  const [tenant, url, settings, pages, redirects, visits, enquiries] = await Promise.all([
    getTenant(site.tenantId),
    siteUrl(site.tenantId),
    getSettings(site.tenantId),
    listPagesForAudit(site.tenantId),
    countRedirects(site.tenantId),
    /*
     * The tally and the enquiry counts are best effort on the way in and on the
     * way out: a database without the page_visits table yet shows an empty
     * summary rather than nothing. Twice the window is fetched so the window
     * has the one before it to compare with.
     */
    listVisitRows(site.tenantId, days * 2)
      .then((rows) => summariseVisits(rows, now, days))
      .catch((error: unknown) => {
        console.error('[results] visits', error instanceof Error ? error.message : String(error));
        return summariseVisits([], now, days);
      }),
    readEnquiryDays(site.tenantId, days)
      .then((rows) => summariseEnquiries(rows, now, days))
      .catch((error: unknown) => {
        console.error('[results] enquiries', error instanceof Error ? error.message : String(error));
        return summariseEnquiries([], now, days);
      }),
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
    // board sets its own width, so no .sv-wrap to cap it at reading width.
    <div className="sv-root" data-theme="light">
      <ResultsDashboard
        siteName={settings.companyName || tenant?.name || 'this site'}
        siteUrl={url}
        siteFindings={auditSite(settings, published.length)}
        redirects={redirects}
        pages={reports}
        visits={visits}
        enquiries={enquiries}
        days={days}
      />
    </div>
  );
}
