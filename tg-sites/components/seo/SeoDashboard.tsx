/**
 * Getting found: the search and AI visibility dashboard.
 *
 * A SERVER COMPONENT WITH NO STATE, which is unusual for a screen in this
 * product and is right here. Everything on it is derived from content that is
 * already in the database: there is nothing to type, nothing to save, and no
 * setting that lives only here. A client component would ship a bundle to
 * re-render a list that cannot change without a page being edited somewhere
 * else. The one authored motion moment, the score ring drawing in, is CSS, so
 * it needs no bundle and honours prefers-reduced-motion.
 *
 * EVERY NUMBER IS DERIVED, nothing is stored. The score, the counts and the
 * verdict are worked out from the same findings the list shows, so the headline
 * and the detail can never disagree. See lib/seo/audit.ts.
 *
 * EACH ISSUE CARRIES ITS OWN FIX, one button that lands the client on the exact
 * field. A site issue opens the right Settings tab, a page issue opens that
 * page in the editor. The point of the screen is not to describe the problem,
 * it is to remove it in one click.
 *
 * IT REPORTS ON THE PUBLISHED PAGE, NOT THE DRAFT. Telling somebody their page
 * is fine when the version on the internet is not is the one thing this screen
 * must never do, so a draft is listed apart and never scored.
 */

import Link from 'next/link';

import { type Finding, type Severity, tally } from '../../lib/seo/audit';

export interface PageReport {
  id: string;
  title: string;
  /** The address, without a leading slash. Empty string is the home page. */
  path: string;
  published: boolean;
  findings: Finding[];
}

/*
 * Where a fix lives. A site issue opens a Settings tab; a page issue opens the
 * page in the editor. `profile-missing` is a page finding that only exists
 * because the company name is empty, which the site-level `site-name-missing`
 * already reports, so it never reaches the list and needs no target of its own.
 */
const SETTINGS_TAB: Record<string, string> = {
  'site-name-missing': 'company',
  'site-about-missing': 'company',
  'contact-missing': 'contact',
  'contact-partial': 'contact',
  'social-image-missing': 'branding',
};

interface Issue {
  finding: Finding;
  source: 'site' | 'page';
  pageId?: string;
  pageTitle?: string;
}

function fixTarget(issue: Issue): { href: string; label: string } | null {
  const { finding } = issue;
  if (finding.severity === 'good') return null;
  if (finding.id in SETTINGS_TAB) {
    return { href: `/settings?tab=${SETTINGS_TAB[finding.id]}`, label: 'Fix in settings' };
  }
  if (finding.id === 'no-pages') return { href: '/', label: 'Publish a page' };
  if (issue.pageId) {
    return { href: `/editor?page=${encodeURIComponent(issue.pageId)}`, label: 'Fix on the page' };
  }
  return null;
}

const SEVERITY_RANK: Record<Severity, number> = { problem: 0, warning: 1, good: 2 };

// --- Icons. Lucide paths, one family, one stroke weight, never an emoji. ------

function Icon({ name, className }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    alert: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
    warn: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
    check: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
    page: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
    spark: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    globe: <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>,
    arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
    external: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
  };
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const SEVERITY_ICON: Record<Severity, string> = { problem: 'alert', warning: 'warn', good: 'check' };

// --- The score ring, an SVG the browser draws with no script. ----------------

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - score / 100);
  // Green when strong, amber in the middle, red when there is real work to do.
  const tone = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';

  return (
    <div className="seo2-score__ring" data-tone={tone}>
      <svg viewBox="0 0 128 128" width="128" height="128" aria-hidden="true">
        <circle className="seo2-score__track" cx="64" cy="64" r={radius} strokeWidth="10" fill="none" />
        <circle
          className="seo2-score__value"
          cx="64"
          cy="64"
          r={radius}
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          style={{
            strokeDasharray: circ,
            strokeDashoffset: offset,
            // The keyframe draws from empty to this value. A custom property so
            // the animation target is the real score, not a fixed guess.
            ['--seo2-dash' as string]: String(offset),
            ['--seo2-circ' as string]: String(circ),
          }}
        />
      </svg>
      <div className="seo2-score__num">
        <strong>{score}</strong>
        <span>/ 100</span>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  value,
  label,
  tone,
}: {
  icon: string;
  value: number | string;
  label: string;
  tone?: 'bad' | 'warn' | 'good';
}) {
  return (
    <div className="seo2-tile" data-tone={tone}>
      <span className="seo2-tile__icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="seo2-tile__value">{value}</span>
      <span className="seo2-tile__label">{label}</span>
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const target = fixTarget(issue);
  return (
    <li className="seo2-issue" data-severity={issue.finding.severity}>
      <span className="seo2-issue__icon" aria-hidden="true">
        <Icon name={SEVERITY_ICON[issue.finding.severity]} />
      </span>
      <div className="seo2-issue__body">
        <p className="seo2-issue__title">
          {issue.finding.title}
          <span className="seo2-issue__where">{issue.source === 'site' ? 'Your business' : issue.pageTitle}</span>
        </p>
        {issue.finding.fix && <p className="seo2-issue__fix">{issue.finding.fix}</p>}
      </div>
      {target && (
        <Link className="sv-btn seo2-issue__btn" data-variant="primary" href={target.href}>
          {target.label}
          <Icon name="arrow" className="seo2-btn__arrow" />
        </Link>
      )}
    </li>
  );
}

export function SeoDashboard({
  siteName,
  siteUrl,
  siteFindings,
  redirects,
  pages,
}: {
  siteName: string;
  siteUrl: string | null;
  siteFindings: Finding[];
  /** How many old addresses are still being forwarded. */
  redirects: number;
  pages: PageReport[];
}) {
  const published = pages.filter((page) => page.published);
  const unpublished = pages.filter((page) => !page.published);

  /*
   * Every finding that counts toward the score. The per-page `profile-missing`
   * is dropped: it is the same empty company name the site-level finding
   * already reports, once per page, and counting it forty times would sink a
   * score for one thing to fix.
   */
  const pageFindings = published.flatMap((page) =>
    page.findings.filter((finding) => finding.id !== 'profile-missing'),
  );
  const all = [...siteFindings, ...pageFindings];
  const good = all.filter((f) => f.severity === 'good').length;
  const problems = all.filter((f) => f.severity === 'problem').length;
  const warnings = all.filter((f) => f.severity === 'warning').length;
  const score = all.length ? Math.round((100 * good) / all.length) : 0;

  const verdict =
    score >= 90
      ? 'In great shape. A search engine and an AI assistant can see this site clearly.'
      : score >= 70
        ? 'Looking good. A few quick wins will make you easier to find.'
        : score >= 40
          ? 'Some real gains here. Work through the list below, worst first.'
          : 'A lot to gain. The fixes below are the difference between being found and not.';

  // The open issues, site first, then page, worst first, dropping the profile
  // duplicate. The list a client actually works down.
  const issues: Issue[] = [
    ...siteFindings.map((finding) => ({ finding, source: 'site' as const })),
    ...published.flatMap((page) =>
      page.findings
        .filter((finding) => finding.id !== 'profile-missing')
        .map((finding) => ({ finding, source: 'page' as const, pageId: page.id, pageTitle: page.title })),
    ),
  ]
    .filter((issue) => issue.finding.severity !== 'good')
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity];
      if (bySeverity !== 0) return bySeverity;
      // Site before page inside a tier: the business profile is why the pages
      // read the way they do, so it is the first thing worth fixing.
      return (a.source === 'site' ? 0 : 1) - (b.source === 'site' ? 0 : 1);
    });

  const readyPages = published.filter(
    (page) => tally(page.findings.filter((f) => f.id !== 'profile-missing')).problem === 0,
  ).length;

  // The good news, gathered for the "Working well" panel. Positive, and true.
  const wins: string[] = [];
  if (siteUrl) wins.push('Your robots file and sitemap are written for you and kept up to date.');
  if (siteFindings.some((f) => f.id === 'site-name-ok')) {
    wins.push('AI engines are told who you are, so they can name you in an answer.');
  }
  if (siteFindings.some((f) => f.id === 'contact-ok')) {
    wins.push('AI engines know where you are, how to reach you and when you are open.');
  }
  if (redirects > 0) {
    wins.push(
      redirects === 1
        ? 'One old address still leads to the right page, so older links keep working.'
        : `${redirects} old addresses still lead to the right pages, so older links keep working.`,
    );
  }
  if (readyPages > 0 && problems === 0) {
    wins.push('Every published page is clear of problems.');
  }

  return (
    <div className="seo2">
      <header className="seo2-head">
        <p className="sv-eyebrow">Getting found</p>
        <h1 className="seo2-title">Search and AI visibility</h1>
        <p className="seo2-lede">
          What a search engine and an AI assistant can see of {siteName}. Every number
          here is worked out from your own pages, so fixing it here fixes it for real.
        </p>
      </header>

      {/* The headline: one score, four numbers, all derived from the list below. */}
      <section className="seo2-hero" aria-label="Visibility summary">
        <div className="seo2-score">
          <ScoreRing score={score} />
          <div className="seo2-score__side">
            <p className="seo2-score__label">Visibility score</p>
            <p className="seo2-score__verdict">{verdict}</p>
          </div>
        </div>
        <div className="seo2-tiles">
          <StatTile icon="globe" value={published.length} label={published.length === 1 ? 'Page checked' : 'Pages checked'} />
          <StatTile icon="wrench" value={problems} label={problems === 1 ? 'Issue to fix' : 'Issues to fix'} tone={problems > 0 ? 'bad' : undefined} />
          <StatTile icon="spark" value={warnings} label={warnings === 1 ? 'Quick win' : 'Quick wins'} tone={warnings > 0 ? 'warn' : undefined} />
          <StatTile icon="check" value={`${readyPages}/${published.length || 0}`} label="Pages ready" tone={readyPages === published.length && published.length > 0 ? 'good' : undefined} />
        </div>
      </section>

      {/* The work, worst first, one button each. Or the reward for having none. */}
      <section className="seo2-panel">
        <div className="seo2-panel__head">
          <h2 className="seo2-panel__title">Fix these first</h2>
          {issues.length > 0 && (
            <span className="seo2-panel__count">{issues.length} {issues.length === 1 ? 'thing' : 'things'}</span>
          )}
        </div>

        {issues.length === 0 ? (
          <div className="seo2-clear">
            <span className="seo2-clear__mark" aria-hidden="true">
              <Icon name="check" />
            </span>
            <p className="seo2-clear__title">You are all set</p>
            <p className="seo2-clear__note">
              Nothing is holding this site back from search or AI right now. We will flag
              anything new the moment it appears.
            </p>
          </div>
        ) : (
          <ul className="seo2-issues">
            {issues.map((issue, index) => (
              <IssueRow key={`${issue.pageId ?? 'site'}-${issue.finding.id}-${index}`} issue={issue} />
            ))}
          </ul>
        )}
      </section>

      {/* The good news, so the screen is not only a list of faults. */}
      {wins.length > 0 && (
        <section className="seo2-panel">
          <h2 className="seo2-panel__title">Working well</h2>
          <ul className="seo2-wins">
            {wins.map((win) => (
              <li key={win} className="seo2-win">
                <span className="seo2-win__mark" aria-hidden="true">
                  <Icon name="check" />
                </span>
                <span>{win}</span>
              </li>
            ))}
          </ul>
          {siteUrl && (
            <p className="seo2-links">
              <a href={`${siteUrl}/robots.txt`} rel="noopener noreferrer" target="_blank">
                robots.txt <Icon name="external" className="seo2-links__ext" />
              </a>
              <a href={`${siteUrl}/sitemap.xml`} rel="noopener noreferrer" target="_blank">
                sitemap.xml <Icon name="external" className="seo2-links__ext" />
              </a>
            </p>
          )}
        </section>
      )}

      {/* The per-page view, for somebody who wants to go straight to a page. */}
      <section className="seo2-panel">
        <h2 className="seo2-panel__title">
          Every published page{published.length > 0 ? ` (${published.length})` : ''}
        </h2>
        {published.length === 0 ? (
          <p className="seo2-empty">
            Nothing is published yet, so there is nothing for a search engine to find.
          </p>
        ) : (
          <ul className="seo2-pages">
            {published.map((page) => {
              const counted = tally(page.findings.filter((f) => f.id !== 'profile-missing'));
              return (
                <li key={page.id} className="seo2-page">
                  <div className="seo2-page__main">
                    <span className="seo2-page__icon" aria-hidden="true"><Icon name="page" /></span>
                    <div>
                      <p className="seo2-page__title">{page.title}</p>
                      <p className="seo2-page__path">/{page.path}</p>
                    </div>
                  </div>
                  <div className="seo2-page__meta">
                    {counted.problem > 0 && <span className="seo2-chip" data-severity="problem">{counted.problem} to fix</span>}
                    {counted.problem === 0 && counted.warning > 0 && <span className="seo2-chip" data-severity="warning">{counted.warning} to improve</span>}
                    {counted.problem === 0 && counted.warning === 0 && <span className="seo2-chip" data-severity="good">Clear</span>}
                    <Link className="sv-btn" href={`/editor?page=${encodeURIComponent(page.id)}`}>Review</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {unpublished.length > 0 && (
          <p className="seo2-draftnote">
            {unpublished.length === 1 ? 'One page is' : `${unpublished.length} pages are`} still a
            draft, so nothing can find {unpublished.length === 1 ? 'it' : 'them'} yet. Drafts are
            checked once they are published.
          </p>
        )}
      </section>
    </div>
  );
}
