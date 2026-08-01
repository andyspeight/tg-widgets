/**
 * The search and AI visibility report.
 *
 * A SERVER COMPONENT WITH NO STATE, which is unusual for a screen in this
 * product and is right here. Everything on it is derived from content that is
 * already in the database: there is nothing to type, nothing to save, and no
 * setting that lives only here. A client component would ship a bundle to
 * re-render a list that cannot change without a page being edited somewhere
 * else.
 *
 * ORDERED BY WHAT IS WORST, not by page name. A client opening this wants to
 * know where to start, and an alphabetical list buries the one broken page
 * between two fine ones. The site-wide findings come first for the same reason:
 * an empty company profile is why the whole site has no structured data, and
 * fixing forty page descriptions before fixing that would be forty jobs in the
 * wrong order.
 *
 * IT REPORTS ON THE PUBLISHED PAGE, NOT THE DRAFT. A draft with a lovely
 * description that has not been published is not findable, and telling somebody
 * their page is fine when the version on the internet is not is the one thing
 * this screen must never do. Pages that have never been published are listed
 * separately and said so.
 */

import Link from 'next/link';

import { type Finding, tally } from '../../lib/seo/audit';

export interface PageReport {
  id: string;
  title: string;
  /** The address, without a leading slash. Empty string is the home page. */
  path: string;
  published: boolean;
  findings: Finding[];
}

function Findings({ findings }: { findings: readonly Finding[] }) {
  // The good ones last: somebody is here to find what is wrong.
  const order = { problem: 0, warning: 1, good: 2 } as const;
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <ul className="seo-findings">
      {sorted.map((finding) => (
        <li key={finding.id} className="seo-finding" data-severity={finding.severity}>
          <span className="seo-finding__dot" aria-hidden="true" />
          <div>
            <p className="seo-finding__title">{finding.title}</p>
            {finding.fix && <p className="seo-finding__fix">{finding.fix}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Counts({ findings }: { findings: readonly Finding[] }) {
  const counted = tally(findings);

  return (
    <p className="seo-counts">
      {counted.problem > 0 && (
        <span className="seo-count" data-severity="problem">
          {counted.problem} to fix
        </span>
      )}
      {counted.warning > 0 && (
        <span className="seo-count" data-severity="warning">
          {counted.warning} worth doing
        </span>
      )}
      {counted.problem === 0 && counted.warning === 0 && (
        <span className="seo-count" data-severity="good">
          Nothing to fix
        </span>
      )}
    </p>
  );
}

export function SeoDashboard({
  siteName,
  siteUrl,
  siteFindings,
  pages,
}: {
  siteName: string;
  siteUrl: string | null;
  siteFindings: Finding[];
  pages: PageReport[];
}) {
  const published = pages.filter((page) => page.published);
  const unpublished = pages.filter((page) => !page.published);

  /*
   * Worst first. Ties keep their original order, which is the order pages came
   * out of the database, so the list does not reshuffle between visits for no
   * reason a client can see.
   */
  const ranked = [...published].sort((a, b) => {
    const at = tally(a.findings);
    const bt = tally(b.findings);
    return bt.problem - at.problem || bt.warning - at.warning;
  });

  return (
    <div className="seo-root">
      <header className="seo-head">
        <p className="sv-eyebrow">Being found</p>
        <h1 className="sv-title">Search and AI visibility</h1>
        <p className="seo-lede">
          What a search engine and an AI assistant can see of {siteName}. Everything
          here is worked out from your own pages, so fixing it here fixes it for real.
        </p>
      </header>

      <section className="seo-panel">
        <h2 className="seo-panel__title">This site</h2>
        <Counts findings={siteFindings} />
        <Findings findings={siteFindings} />
        {siteUrl && (
          <p className="seo-links">
            Crawlers read{' '}
            <a href={`${siteUrl}/robots.txt`} rel="noopener noreferrer" target="_blank">
              robots.txt
            </a>{' '}
            and{' '}
            <a href={`${siteUrl}/sitemap.xml`} rel="noopener noreferrer" target="_blank">
              sitemap.xml
            </a>
            . Both are written for you and kept up to date.
          </p>
        )}
      </section>

      <section className="seo-panel">
        <h2 className="seo-panel__title">
          Published pages{published.length > 0 ? ` (${published.length})` : ''}
        </h2>

        {ranked.length === 0 ? (
          <p className="sv-empty">
            Nothing is published yet, so there is nothing for a search engine to find.
          </p>
        ) : (
          <ul className="seo-pages">
            {ranked.map((page) => (
              <li key={page.id} className="seo-page">
                <div className="seo-page__head">
                  <div>
                    <h3 className="seo-page__title">{page.title}</h3>
                    <p className="seo-page__path">/{page.path}</p>
                  </div>
                  <div className="seo-page__right">
                    <Counts findings={page.findings} />
                    <Link className="sv-btn" href={`/editor?page=${encodeURIComponent(page.id)}`}>
                      Edit
                    </Link>
                  </div>
                </div>
                <Findings findings={page.findings} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        SAID SEPARATELY RATHER THAN SCORED. A draft is not findable however good
        its description is, and mixing the two lists would let somebody fix a
        page that nobody can reach and think they had done something.
      */}
      {unpublished.length > 0 && (
        <section className="seo-panel">
          <h2 className="seo-panel__title">Not published ({unpublished.length})</h2>
          <p className="seo-lede">
            These are not on the internet yet, so nothing can find them. They are not
            checked until they are published.
          </p>
          <ul className="seo-pages seo-pages--quiet">
            {unpublished.map((page) => (
              <li key={page.id} className="seo-page">
                <div className="seo-page__head">
                  <div>
                    <h3 className="seo-page__title">{page.title}</h3>
                    <p className="seo-page__path">/{page.path}</p>
                  </div>
                  <Link className="sv-btn" href={`/editor?page=${encodeURIComponent(page.id)}`}>
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
