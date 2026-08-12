/**
 * The rail's Pages panel: the list that lets you switch page without leaving
 * the editor (Andy, 12 Aug 2026).
 *
 * WHAT IS WORTH TESTING HERE. Two things, and they are different kinds.
 *
 *   The search   real behaviour, so a real test. filterPages is the one bit of
 *                logic on the panel, and "search the address as well as the
 *                name" is exactly what a later tidy-up drops without anyone
 *                noticing until a client's search comes up empty.
 *
 *   The row      a promise the source keeps, so a source test. Each row is a
 *                PLAIN anchor to /editor?page=<id>: plain because leaving the
 *                page should re-fetch fresh and because next/link would drag
 *                Next's runtime into the standalone bundle that has none, and
 *                the id goes through encodeURIComponent because a page id lands
 *                in a query string. Lose either and it still compiles.
 *
 * Whether a click actually loads the other page, and whether the current one is
 * marked on screen, is measured in the browser harness. Node can read an href;
 * only a browser can tell you the row you are on is lit and the list filtered
 * as you typed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { filterPages, type PageLink } from '../lib/editor/page-list';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const panelSource = source('components', 'editor', 'PagesPanel.tsx');

const PAGES: readonly PageLink[] = [
  { id: 'p-home', title: 'Home', slug: '', status: 'published', parentId: null },
  { id: 'p-about', title: 'About us', slug: 'about', status: 'published', parentId: null },
  { id: 'p-tours', title: 'Tours', slug: 'tours', status: 'published', parentId: null },
  { id: 'p-italy', title: 'Italy in autumn', slug: 'tours/italy', status: 'published', parentId: 'p-tours' },
  { id: 'p-contact', title: 'Contact', slug: 'contact', status: 'draft', parentId: null },
];

// ---------------------------------------------------------------------------

describe('filterPages', () => {
  it('shows every page when the search is empty', () => {
    expect(filterPages(PAGES, '')).toHaveLength(PAGES.length);
  });

  it('shows every page when the search is only spaces', () => {
    expect(filterPages(PAGES, '   ')).toHaveLength(PAGES.length);
  });

  it('matches on the page name', () => {
    const shown = filterPages(PAGES, 'about');
    expect(shown.map((page) => page.id)).toEqual(['p-about']);
  });

  it('ignores case', () => {
    expect(filterPages(PAGES, 'ITALY').map((page) => page.id)).toEqual(['p-italy']);
  });

  it('ignores space around the words', () => {
    expect(filterPages(PAGES, '  contact  ').map((page) => page.id)).toEqual(['p-contact']);
  });

  it('matches on the address, not just the name', () => {
    // "tours/italy" is the child's address; its name has no "tours" in it, so a
    // name-only search would miss it. The parent matches by name AND address.
    const shown = filterPages(PAGES, 'tours');
    expect(shown.map((page) => page.id)).toEqual(['p-tours', 'p-italy']);
  });

  it('comes back empty when nothing matches, rather than throwing', () => {
    expect(filterPages(PAGES, 'zzz')).toEqual([]);
  });

  it('does not mutate the list it was given', () => {
    const before = PAGES.map((page) => page.id);
    filterPages(PAGES, 'tours');
    expect(PAGES.map((page) => page.id)).toEqual(before);
  });
});

describe('each row is a plain, safe link to the page', () => {
  it('navigates to /editor?page= with the id encoded', () => {
    expect(panelSource).toContain('href={`/editor?page=${encodeURIComponent(page.id)}`}');
  });

  it('is a plain anchor, not next/link, so it re-fetches and the bundle stays clean', () => {
    expect(panelSource).not.toContain("from 'next/link'");
    expect(panelSource).not.toMatch(/<Link\b/);
  });

  it('marks the page you are on for the browser and the screen reader', () => {
    expect(panelSource).toContain("aria-current={page.id === currentId ? 'page' : undefined}");
    expect(panelSource).toContain("data-current={page.id === currentId ? '' : undefined}");
  });

  it('badges a page that is not yet published', () => {
    expect(panelSource).toContain("page.status === 'draft'");
  });

  it('indents a child under its parent', () => {
    expect(panelSource).toContain("data-child={page.parentId ? '' : undefined}");
  });
});
