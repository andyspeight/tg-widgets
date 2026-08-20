/**
 * The search results page, rendered on the server with no JavaScript.
 *
 * A visitor reaches it by submitting the Search block, which is a plain GET form
 * pointed at /search, so the query arrives in the URL and the answer is built
 * here before a byte of HTML is sent. The same box sits at the top of this page,
 * pre-filled, so the visitor who landed here from the bare magnifier has
 * somewhere to type and the one who mistyped can fix it without going back.
 *
 * NO AUTOFOCUS, on purpose: the same rule the widgets keep, drawing must not
 * grab the page. The box is there, filled with what was asked, and the visitor
 * clicks it when they mean to.
 *
 * The matched words in each snippet are wrapped in <mark>. The segmenting is
 * done in lib/content/search.ts, which builds no HTML, so nothing a page's own
 * text contains can reach the DOM as anything but escaped text through React.
 */
import type { CSSProperties, ReactElement } from 'react';

import type { SearchHit } from '../../lib/content/search';

export function SearchResults({
  query,
  hits,
  theme,
}: {
  query: string;
  hits: readonly SearchHit[];
  /** The tenant's theme as custom properties, so the tokens below resolve. */
  theme?: CSSProperties;
}): ReactElement {
  const trimmed = query.trim();

  return (
    <main className="tgs-page tgs-search-page" style={theme}>
      <section className="tgs-section" data-tone="light">
        <div className="tgs-section__inner tgs-search-page__inner">
          <form className="tgs-search-page__form" role="search" method="get" action="/search">
            <input
              className="tgs-search-page__input"
              type="search"
              name="q"
              defaultValue={trimmed}
              placeholder="Search this site"
              aria-label="Search this site"
            />
            <button className="tgs-search-page__submit" type="submit">
              Search
            </button>
          </form>

          {trimmed === '' ? (
            <p className="tgs-search-page__note">Type something above to search this site.</p>
          ) : hits.length === 0 ? (
            <p className="tgs-search-page__note">
              Nothing here matches &ldquo;{trimmed}&rdquo;. Try a different word.
            </p>
          ) : (
            <>
              <p className="tgs-search-page__count">
                {hits.length} {hits.length === 1 ? 'result' : 'results'} for &ldquo;{trimmed}&rdquo;
              </p>
              <ul className="tgs-search-page__list">
                {hits.map((hit) => (
                  <li key={hit.path} className="tgs-search-page__item">
                    <a className="tgs-search-page__link" href={`/${hit.path}`}>
                      {hit.title}
                    </a>
                    {hit.snippet.length > 0 && (
                      <p className="tgs-search-page__snippet">
                        {hit.snippet.map((segment, index) =>
                          segment.hit ? (
                            <mark key={index}>{segment.text}</mark>
                          ) : (
                            <span key={index}>{segment.text}</span>
                          ),
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
