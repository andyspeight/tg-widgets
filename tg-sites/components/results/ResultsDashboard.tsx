/**
 * Results: the client's dashboard. What the site is doing for them, on one
 * board, mostly as pictures.
 *
 * DIRECTION A OF THE MOCKUPS (16 Sep 2026, Andy: "go with your recommendation"):
 * a board of cards in varied sizes, two rings up top, four tiles with trends,
 * then the charts, with a plain sentence beside each big number saying what it
 * means, which is the habit borrowed from direction B. It replaces the "Search
 * and AI visibility" screen, whose audit, fix list, working-well list and
 * per-page list all live here now, and adds the readers (slice A of the Duda
 * visibility upgrade) and the enquiries. The AI visibility panels (share of
 * voice, the fifty questions, six months of history) arrive with slices B and
 * C; nothing here pretends they exist yet.
 *
 * A SERVER COMPONENT WITH NO STATE AND NO SCRIPT, like the screen it replaces:
 * everything is derived from content already in the database, the charts are
 * HTML, CSS and small inline SVG (components/seo/VisitCharts.tsx), and the two
 * authored movements (the rings drawing in, the columns rising) are CSS inside
 * a reduced-motion guard. Nothing here imports from Next, so the whole board
 * renders on its own for the browser smoke test.
 *
 * EVERY NUMBER IS DERIVED, nothing is stored for this screen. The health score
 * comes from the same findings the fix list shows, so the headline and the
 * detail can never disagree. The readers are counts only, nothing about
 * anybody. The enquiries are the rows on the Enquiries screen, counted.
 *
 * IT REPORTS ON THE PUBLISHED PAGE, NOT THE DRAFT: a draft is listed apart and
 * never scored, because telling somebody their page is fine when the version on
 * the internet is not is the one thing this screen must never do.
 */

import { type Finding, type Severity, tally } from '../../lib/seo/audit';
import { enquiryTile, type EnquirySummary } from '../../lib/results/enquiries';
import { readersView } from '../../lib/visits/chart';
import { AI_ENGINES } from '../../lib/visits/classify';
import type { VisitSummary } from '../../lib/visits/summary';
import { Bars, DailyColumns, Donut, EngineRoster, Tile } from '../seo/VisitCharts';

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
    arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
    external: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
    stats: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
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

// --- A ring, an SVG the browser draws in with no script. --------------------

function Ring({
  value,
  max,
  tone,
  label,
  sub,
}: {
  value: number;
  max: number;
  tone: 'good' | 'warn' | 'bad' | 'engines';
  label: string;
  sub: string;
}) {
  const radius = 54;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - (max > 0 ? Math.min(value, max) / max : 0));
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
            // the animation target is the real number, not a fixed guess.
            ['--seo2-dash' as string]: String(offset),
            ['--seo2-circ' as string]: String(circ),
          }}
        />
      </svg>
      <div className="seo2-score__num">
        <strong>{label}</strong>
        <span>{sub}</span>
      </div>
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
        <a className="sv-btn seo2-issue__btn" data-variant="primary" href={target.href}>
          {target.label}
          <Icon name="arrow" className="seo2-btn__arrow" />
        </a>
      )}
    </li>
  );
}

function Card({
  span,
  title,
  sub,
  right,
  children,
  label,
}: {
  span: number;
  title?: string;
  sub?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <section className="rs-card" data-span={span} aria-label={label ?? title}>
      {title && (
        <div className="rs-card__head">
          <div>
            <h2 className="rs-card__title">{title}</h2>
            {sub && <p className="rs-card__sub">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function ResultsDashboard({
  siteName,
  siteUrl,
  siteFindings,
  redirects,
  pages,
  visits,
  enquiries,
  days,
}: {
  siteName: string;
  siteUrl: string | null;
  siteFindings: Finding[];
  /** How many old addresses are still being forwarded. */
  redirects: number;
  pages: PageReport[];
  /** Who has been reading the site. Empty (never null) when the tally could not be read. */
  visits: VisitSummary;
  enquiries: EnquirySummary;
  /** The window shown: 30 or 90 days. */
  days: 30 | 90;
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
  const score = all.length ? Math.round((100 * good) / all.length) : 0;
  const tone = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';

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

  // The sentence beside the health ring. Plain, and true.
  const verdict =
    score >= 90
      ? 'In great shape. A search engine and an AI assistant can see this site clearly.'
      : score >= 70
        ? issues.length === 1
          ? 'Looking good. One quick fix would take you higher.'
          : `Looking good. ${issues.length} quick fixes would take you higher.`
        : score >= 40
          ? 'Some real gains here. Work through the list below, worst first.'
          : 'A lot to gain. The fixes below are the difference between being found and not.';

  const readyPages = published.filter(
    (page) => tally(page.findings.filter((f) => f.id !== 'profile-missing')).problem === 0,
  ).length;

  // The good news, gathered for the "Working well" card. Positive, and true.
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

  // The readers. A 90-day window has no whole window before it to compare with
  // (the tally keeps 90 days), so the tiles explain themselves instead.
  const compare = days === 30;
  const view = readersView(visits);
  const counting = visits.firstDay !== null;
  const tiles = [
    ...view.tiles
      .filter((tile) => tile.key !== 'searchCrawler')
      .map((tile) => (compare ? tile : { ...tile, delta: null })),
    enquiryTile(enquiries, compare && enquiries.firstDay !== null && enquiries.firstDay < enquiries.from),
  ];
  const engineTotal = AI_ENGINES.length;
  const enginesSentence =
    view.enginesSeen === 0
      ? counting
        ? 'No AI engine has read your pages in this window yet. New sites are usually found within a couple of weeks.'
        : 'Once people and engines start reading your pages, this is where you will see which AI engines have found you.'
      : view.enginesSeen === 1
        ? 'One AI engine has read your pages. Being read is what gets you recommended.'
        : `${view.enginesSeen} AI engines have read your pages. Being read is what gets you recommended.`;
  const searchLine =
    visits.families.search > 0
      ? ` Google and Bing came ${visits.families.search.toLocaleString('en-GB')} times between them.`
      : '';

  return (
    <div className="seo2 rs">
      <header className="rs-head">
        <div className="rs-head__text">
          <p className="sv-eyebrow">Results</p>
          <h1 className="seo2-title">{siteName}</h1>
          <p className="seo2-lede">
            {view.range}.{' '}
            {compare ? `Compared with the ${days} days before.` : `The last ${days} days.`}
            {view.since ? ` ${view.since}.` : ''}
          </p>
        </div>
        <div className="rs-head__actions">
          <nav className="rs-range" aria-label="Window">
            <a href="/results?days=30" aria-current={days === 30 ? 'page' : undefined}>30 days</a>
            <a href="/results?days=90" aria-current={days === 90 ? 'page' : undefined}>90 days</a>
          </nav>
          <a className="sv-btn" href="/reports">
            <Icon name="stats" />
            Monthly report
          </a>
        </div>
      </header>

      <div className="rs-grid">
        {/* The two rings: how findable the site is, and how many AI engines have found it. */}
        <Card span={5} label="Site health and AI engines">
          <div className="rs-hero__block">
            <Ring value={score} max={100} tone={tone} label={String(score)} sub="of 100" />
            <div className="rs-hero__text">
              <p className="seo2-score__label">Site health</p>
              <p className="rs-hero__lead">{verdict}</p>
              <p className="rs-hero__note">Worked out from your published pages, so fixing it here fixes it for real.</p>
            </div>
          </div>
          <div className="rs-hero__rule" />
          <div className="rs-hero__block">
            <Ring value={view.enginesSeen} max={engineTotal} tone="engines" label={`${view.enginesSeen}`} sub={`of ${engineTotal}`} />
            <div className="rs-hero__text">
              <p className="seo2-score__label">AI engines that have found you</p>
              <p className="rs-hero__lead">{enginesSentence}</p>
              {searchLine && <p className="rs-hero__note">{searchLine.trim()}</p>}
            </div>
          </div>
        </Card>

        {/* The four numbers, each with its own trend. */}
        <div className="rs-tiles">
          {tiles.map((tile) => (
            <Tile key={tile.key} tile={tile} />
          ))}
        </div>

        {counting ? (
          <>
            <Card span={8} label="Day by day">
              <DailyColumns daily={view.daily} days={days} />
            </Card>
            <Card span={4} label="AI engines that have found you">
              <EngineRoster engines={view.engines} seen={view.enginesSeen} />
            </Card>
          </>
        ) : (
          <Card span={12} title="Who is reading your site" sub="Nothing counted yet">
            <p className="viz-empty__note">
              From now on every visit to a published page is counted here: the people
              reading it, the ones an AI assistant sent, and the crawlers behind ChatGPT,
              Perplexity, Google and the rest. Numbers only, nothing about anybody.
            </p>
          </Card>
        )}

        {/* The work, worst first, one button each. Or the reward for having none. */}
        <Card
          span={counting ? 5 : 6}
          title="Fix these first"
          sub={issues.length === 0 ? 'Nothing is holding this site back.' : `${issues.length} ${issues.length === 1 ? 'thing' : 'things'}, worst first.`}
        >
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
            <ul className="seo2-issues rs-issues">
              {issues.slice(0, 4).map((issue, index) => (
                <IssueRow key={`${issue.pageId ?? 'site'}-${issue.finding.id}-${index}`} issue={issue} />
              ))}
            </ul>
          )}
          {issues.length > 4 && (
            <p className="rs-card__more">
              {issues.length - 4} more {issues.length - 4 === 1 ? 'is' : 'are'} listed against the pages below.
            </p>
          )}
        </Card>

        {/* The good news, so the board is not only a list of faults. */}
        <Card span={counting ? 4 : 6} title="Working well">
          {wins.length === 0 ? (
            <p className="seo2-empty">Publish a page and fill in your business details, and the wins start here.</p>
          ) : (
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
          )}
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
        </Card>

        {counting && (
          <>
            <Card span={3} label="Who read your pages">
              <Donut donut={view.donut} />
            </Card>
            <Card span={4} label="Sent by an AI assistant">
              <Bars
                title="Sent by an AI assistant"
                sub="Where the people an assistant sent came from."
                bars={view.assistants}
                series={2}
                unit="people"
                empty="Nobody has arrived from an AI assistant yet. When one recommends you, it shows up here."
              />
            </Card>
            <Card span={4} label="Pages people read most">
              <Bars
                title="Pages people read most"
                sub="Where your readers actually went."
                bars={view.topVisited}
                series={1}
                unit="reads"
                empty="No page has been read by a person in this window."
              />
            </Card>
            <Card span={4} label="Pages the AI engines read most">
              <Bars
                title="Pages the AI engines read most"
                sub="What the engines are paying attention to."
                bars={view.topCrawled}
                series={3}
                unit="visits"
                empty="No page has been read by a crawler in this window."
              />
            </Card>
            <Card span={4} label="Crawlers by name">
              <Bars
                title="Crawlers by name"
                sub="How often each engine read your pages, search and AI alike."
                bars={view.crawlers}
                series={3}
                unit="visits"
                empty="No crawler has read the site in this window yet. The AI ones usually take a few days to find a new site."
                showFamily
              />
            </Card>
          </>
        )}

        {/* The per-page view, for somebody who wants to go straight to a page. */}
        <Card
          span={counting ? 8 : 12}
          title={`Every published page${published.length > 0 ? ` (${published.length})` : ''}`}
          sub="Each page checked against what a search engine and an AI assistant look for."
        >
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
                      <a className="sv-btn" href={`/editor?page=${encodeURIComponent(page.id)}`}>Review</a>
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
        </Card>
      </div>
    </div>
  );
}
