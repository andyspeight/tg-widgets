'use client';

/**
 * The Pages panel (Andy, 12 Aug 2026).
 *
 * The rail's Pages icon used to take you to the /sites screen, out of the
 * editor. Now it opens this panel in the same expanding column the outline
 * uses, listing the site's pages so you can jump straight from one to the
 * next without leaving the editor. Each row is a plain anchor to
 * /editor?page=<id>, the same full navigation the brand link makes, so the
 * page you pick loads fresh with its own draft.
 *
 * It shares the .ed-outline container (column, border, scroll, and the fold
 * behaviour), and adds its own list on top. The current page is marked and
 * the search filters by name or address, which is what makes a list of a
 * hundred-odd pages usable.
 */

import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { filterPages, type PageLink } from '../../lib/editor/page-list';

// Re-exported so the shell and the standalone entry can keep importing the type
// from the component they hand it to. The type and the search behind it live in
// lib/editor/page-list so they can be tested without a DOM.
export type { PageLink };

export function PagesPanel({
  pages,
  currentId,
}: {
  pages: readonly PageLink[];
  currentId: string | null;
}): ReactElement {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => filterPages(pages, query), [pages, query]);

  return (
    <aside className="ed-outline ed-pages" aria-label="Pages">
      {/*
        Head and search stay put while the list scrolls beneath them, so the
        search is still there a hundred pages down. One sticky block rather than
        two, so there is no head height to guess at for the search to sit below.
      */}
      <div className="ed-pages__top">
        <div className="ed-pages__head">
          <span className="ed-pages__title">Pages</span>
          <span className="ed-pages__count">{pages.length}</span>
        </div>

        <div className="ed-pages__search">
          <input
            className="ed-input"
            type="search"
            placeholder="Search pages"
            value={query}
            aria-label="Search pages"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="ed-pages__list">
        {shown.length === 0 ? (
          <p className="ed-pages__empty">
            {pages.length === 0 ? 'No pages yet.' : 'Nothing matches that.'}
          </p>
        ) : (
          shown.map((page) => (
            /*
             * A plain anchor, not next/link, for the two reasons the brand link
             * gives: leaving the current page should re-fetch fresh, and next/link
             * would drag Next's runtime into the standalone bundle that has none.
             */
            <a
              key={page.id}
              className="ed-pages__row"
              href={`/editor?page=${encodeURIComponent(page.id)}`}
              data-current={page.id === currentId ? '' : undefined}
              data-child={page.parentId ? '' : undefined}
              aria-current={page.id === currentId ? 'page' : undefined}
            >
              <span className="ed-pages__name">{page.title || 'Untitled'}</span>
              <span className="ed-pages__meta">
                <span className="ed-pages__slug">/{page.slug}</span>
                {page.status === 'draft' && <span className="ed-pages__badge">Draft</span>}
              </span>
            </a>
          ))
        )}
      </div>
    </aside>
  );
}
