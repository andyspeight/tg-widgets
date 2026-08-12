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
 *
 * ADD PAGE (Andy, 12 Aug 2026). A button at the top opens a small composer for
 * a name; onCreatePage makes the page and the shell navigates to it. A name is
 * asked for rather than made up, because the address is the name slugified and
 * two pages cannot share one, so a second "Untitled" would clash. The composer
 * is opened by a click, so focusing the box then is a real action, not a render
 * grabbing the page.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { filterPages, type PageLink } from '../../lib/editor/page-list';

// Re-exported so the shell and the standalone entry can keep importing the type
// from the component they hand it to. The type and the search behind it live in
// lib/editor/page-list so they can be tested without a DOM.
export type { PageLink };

export function PagesPanel({
  pages,
  currentId,
  onCreatePage,
}: {
  pages: readonly PageLink[];
  currentId: string | null;
  /**
   * Make a page with this name and open it. Resolves with an error to show in
   * the composer, or null on success, by which point the editor is navigating
   * to the new page. Optional so a caller without it simply shows no button.
   */
  onCreatePage?: (title: string) => Promise<string | null>;
}): ReactElement {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => filterPages(pages, query), [pages, query]);

  /** The Add page composer: closed, or open with a name being typed. */
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Focus the box when the composer opens, and only then: keyed on `adding`, so
  // typing in the search (which re-renders this panel) does not pull the caret
  // back here. Opening is a click, so this focus follows a real action.
  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  function closeComposer() {
    setAdding(false);
    setNewTitle('');
    setError(null);
  }

  async function submitNew(event: FormEvent) {
    event.preventDefault();
    if (!onCreatePage) return;
    const title = newTitle.trim();
    if (!title) {
      setError('Give the page a name.');
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onCreatePage(title);
    setBusy(false);
    // Success navigates away, so there is nothing to close. A failure stays put
    // with the reason, the commonest being an address already in use.
    if (failure) setError(failure);
  }

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

        {onCreatePage &&
          (adding ? (
            <form className="ed-pages__new" onSubmit={submitNew}>
              <input
                ref={nameRef}
                className="ed-input"
                value={newTitle}
                placeholder="Page name"
                aria-label="New page name"
                maxLength={200}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeComposer();
                }}
              />
              {error && (
                <p className="ed-pages__error" role="alert">
                  {error}
                </p>
              )}
              <div className="ed-pages__new-actions">
                <button type="button" className="ed-btn" onClick={closeComposer}>
                  Cancel
                </button>
                <button type="submit" className="ed-btn" data-variant="primary" disabled={busy}>
                  {busy ? 'Adding' : 'Add page'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="ed-pages__add"
              onClick={() => setAdding(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add page
            </button>
          ))}

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
