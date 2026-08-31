import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

// The error paths render .sv- classes without mounting a screen; an unstyled
// error explains a misconfiguration badly. Same note as /enquiries.
import '../../components/sites/sites.css';
import { activeSite, currentUser } from '../../lib/auth/session';
import { readMonthMetrics, readMonthReport } from '../../lib/db/report';
import {
  delta,
  deltaLabel,
  isFutureOrCurrent,
  monthRange,
  nextMonth,
  parseMonthKey,
  previousMonth,
  type Delta,
  type MonthMetrics,
} from '../../lib/content/report';

export const metadata: Metadata = {
  title: 'Report · Travelgenix Sites',
  robots: { index: false, follow: false },
};

/** Never cached: a report is this site's live activity for the month. */
export const dynamic = 'force-dynamic';

type Params = { searchParams: Promise<{ month?: string }> };

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

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One metric card: a big number, its label, and a change chip against last month. */
function Stat({ n, label, change }: { n: number; label: string; change: Delta }) {
  return (
    <div className="rep-card">
      <div className="rep-card__n">{n}</div>
      <div className="rep-card__label">{label}</div>
      <div className={`rep-delta rep-delta--${change.direction}`}>
        <span aria-hidden="true">
          {change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '—'}
        </span>{' '}
        {deltaLabel(change)} vs last month
      </div>
    </div>
  );
}

export default async function ReportPage({ searchParams }: Params) {
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
        <p>The database refused the connection, so there is nothing to report.</p>
        <pre>{failure}</pre>
      </Problem>
    );
  }

  if (!user) redirect('/signin?next=%2Freports');
  if (!site) redirect('/sites');

  const now = new Date();
  const { month: mParam } = await searchParams;
  const chosen = parseMonthKey(mParam, now);
  const range = monthRange(chosen.year, chosen.month);
  const prev = previousMonth(chosen.year, chosen.month);
  const prevRange = monthRange(prev.year, prev.month);
  const next = nextMonth(chosen.year, chosen.month);

  const [report, before] = await Promise.all([
    readMonthReport(site.tenantId, range.from, range.to),
    readMonthMetrics(site.tenantId, prevRange.from, prevRange.to),
  ]);

  const m: MonthMetrics = report.metrics;
  const contentPublished = m.pagesPublished + m.itemsPublished;
  const beforeContent = before.pagesPublished + before.itemsPublished;

  // Next is capped at the current month: there is no report for a month that has
  // not happened.
  const atNow = isFutureOrCurrent(next.year, next.month, now);
  const showingCurrentMonth = isFutureOrCurrent(chosen.year, chosen.month, now);

  return (
    <main className="sv-wrap">
      <header className="rep-head">
        <div>
          <h1 className="sv-title">Monthly report</h1>
          <p className="rep-sub">{site.name}</p>
        </div>
        <a className="sv-btn" href="/">
          Back to the site
        </a>
      </header>

      <div className="rep-months">
        <a className="sv-btn" href={`/reports?month=${prevRange.key}`} aria-label="Previous month">
          ← {prevRange.label}
        </a>
        <span className="rep-months__now">
          {range.label}
          {showingCurrentMonth && <span className="rep-months__partial"> so far</span>}
        </span>
        {atNow ? (
          <span className="sv-btn sv-btn--muted" aria-disabled="true">
            Next →
          </span>
        ) : (
          <a className="sv-btn" href={`/reports?month=${monthRange(next.year, next.month).key}`} aria-label="Next month">
            {monthRange(next.year, next.month).label} →
          </a>
        )}
      </div>

      <section className="rep-grid" aria-label="This month">
        <Stat n={m.enquiries} label="Enquiries" change={delta(m.enquiries, before.enquiries)} />
        <Stat n={contentPublished} label="Published" change={delta(contentPublished, beforeContent)} />
        <Stat n={m.pagesCreated} label="New pages" change={delta(m.pagesCreated, before.pagesCreated)} />
        <Stat n={m.mediaAdded} label="Images added" change={delta(m.mediaAdded, before.mediaAdded)} />
      </section>

      <p className="rep-note">
        Visitor numbers appear here once web analytics is switched on for your site. Until then
        this report covers what happened on your site: the enquiries you received and the work
        that went live.
      </p>

      <section className="rep-glance" aria-label="At a glance">
        <div>
          <strong>{report.totals.livePages}</strong> live page
          {report.totals.livePages === 1 ? '' : 's'}
        </div>
        <div>
          <strong>{report.totals.publishedEntries}</strong> published entr
          {report.totals.publishedEntries === 1 ? 'y' : 'ies'}
        </div>
        <div>
          <strong>{report.totals.totalEnquiries}</strong> enquir
          {report.totals.totalEnquiries === 1 ? 'y' : 'ies'} all time
          {report.totals.unreadEnquiries > 0 && (
            <span className="rep-glance__unread"> · {report.totals.unreadEnquiries} unread</span>
          )}
        </div>
      </section>

      <section aria-label="Enquiries this month">
        <h2 className="rep-h2">Enquiries in {range.label}</h2>
        {report.enquiries.length === 0 ? (
          <p className="rep-empty">No enquiries this month.</p>
        ) : (
          <ul className="rep-enq">
            {report.enquiries.map((enquiry) => (
              <li key={enquiry.id} className="rep-enq__row">
                <span className="rep-enq__name">{enquiry.formName}</span>
                <span className="rep-enq__path">{enquiry.path}</span>
                <span className="rep-enq__when">{when(enquiry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {report.enquiries.length > 0 && (
          <p className="rep-more">
            <a href="/enquiries">See every enquiry and its answers →</a>
          </p>
        )}
      </section>
    </main>
  );
}
