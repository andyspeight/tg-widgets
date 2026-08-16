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

import { buildPageTree, descendantIds, filterPages, type PageLink } from '../lib/editor/page-list';

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

// ---------------------------------------------------------------------------

// A cheap recursive collector of ids, so a test can read the whole tree.
function idsInTree(nodes: ReturnType<typeof buildPageTree>): string[] {
  return nodes.flatMap((node) => [node.page.id, ...idsInTree(node.children)]);
}

describe('buildPageTree', () => {
  it('files a child under its parent and keeps the parent at the top, at depth 0', () => {
    const tree = buildPageTree(PAGES);
    // Four top-level pages: Home, About, Tours, Contact. Italy is filed inside.
    expect(tree.map((node) => node.page.id)).toEqual([
      'p-home',
      'p-about',
      'p-tours',
      'p-contact',
    ]);
    expect(tree.every((node) => node.depth === 0)).toBe(true);
    const tours = tree.find((node) => node.page.id === 'p-tours');
    expect(tours?.children.map((child) => child.page.id)).toEqual(['p-italy']);
    expect(tours?.children[0].depth).toBe(1);
  });

  it('leaves a page with no children as an empty branch, not a missing one', () => {
    const home = buildPageTree(PAGES).find((node) => node.page.id === 'p-home');
    expect(home?.children).toEqual([]);
  });

  it('surfaces a child whose parent is missing at the top level', () => {
    // The parent was deleted from under it (on delete set null is the real rule,
    // but a stale id could linger); it must still show, at the top, not vanish.
    const orphan: PageLink[] = [
      { id: 'p-x', title: 'Orphan', slug: 'x', status: 'draft', parentId: 'gone' },
    ];
    const tree = buildPageTree(orphan);
    expect(tree.map((node) => node.page.id)).toEqual(['p-x']);
    expect(tree[0].depth).toBe(0);
  });

  it('nests to any depth, each level one deeper than the last', () => {
    // The multi-tier change: a grandchild is drawn beneath its parent, not lifted.
    const deep: PageLink[] = [
      { id: 'a', title: 'A', slug: 'a', status: 'published', parentId: null },
      { id: 'b', title: 'B', slug: 'b', status: 'published', parentId: 'a' },
      { id: 'c', title: 'C', slug: 'c', status: 'published', parentId: 'b' },
      { id: 'd', title: 'D', slug: 'd', status: 'published', parentId: 'c' },
    ];
    const tree = buildPageTree(deep);
    expect(tree.map((node) => node.page.id)).toEqual(['a']);
    const b = tree[0].children[0];
    const c = b.children[0];
    const d = c.children[0];
    expect([tree[0].depth, b.depth, c.depth, d.depth]).toEqual([0, 1, 2, 3]);
    expect(d.page.id).toBe('d');
  });

  it('ends on a cycle rather than looping, and surfaces the pages caught in it', () => {
    // A <-> B, neither top level. Cannot happen through the UI, but a page you
    // cannot see is worse than one drawn in the wrong place, so both are surfaced.
    const cycle: PageLink[] = [
      { id: 'a', title: 'A', slug: 'a', status: 'draft', parentId: 'b' },
      { id: 'b', title: 'B', slug: 'b', status: 'draft', parentId: 'a' },
    ];
    expect(new Set(idsInTree(buildPageTree(cycle)))).toEqual(new Set(['a', 'b']));
  });

  it('preserves the incoming order at every level', () => {
    const two: PageLink[] = [
      { id: 'a', title: 'A', slug: 'a', status: 'draft', parentId: null },
      { id: 'b', title: 'B', slug: 'b', status: 'draft', parentId: 'a' },
      { id: 'c', title: 'C', slug: 'c', status: 'draft', parentId: 'a' },
    ];
    const tree = buildPageTree(two);
    expect(tree.map((node) => node.page.id)).toEqual(['a']);
    expect(tree[0].children.map((child) => child.page.id)).toEqual(['b', 'c']);
  });

  it('does not mutate the list it was given', () => {
    const before = PAGES.map((page) => page.id);
    buildPageTree(PAGES);
    expect(PAGES.map((page) => page.id)).toEqual(before);
  });

  it('comes back empty for an empty list, rather than throwing', () => {
    expect(buildPageTree([])).toEqual([]);
  });
});

describe('descendantIds', () => {
  it('collects every page beneath one, at any depth, excluding itself', () => {
    const pages: PageLink[] = [
      { id: 'a', title: 'A', slug: 'a', status: 'draft', parentId: null },
      { id: 'b', title: 'B', slug: 'b', status: 'draft', parentId: 'a' },
      { id: 'c', title: 'C', slug: 'c', status: 'draft', parentId: 'b' },
      { id: 'x', title: 'X', slug: 'x', status: 'draft', parentId: null },
    ];
    // This is what stops a page being dropped into its own branch.
    expect(descendantIds(pages, 'a')).toEqual(new Set(['b', 'c']));
    expect(descendantIds(pages, 'c')).toEqual(new Set());
    expect(descendantIds(pages, 'x')).toEqual(new Set());
  });

  it('ends on a cycle rather than looping for ever', () => {
    const pages: PageLink[] = [
      { id: 'a', title: 'A', slug: 'a', status: 'draft', parentId: 'b' },
      { id: 'b', title: 'B', slug: 'b', status: 'draft', parentId: 'a' },
    ];
    expect(descendantIds(pages, 'a')).toEqual(new Set(['b', 'a']));
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

  it('steps a filed page in by its depth, one rule for every level', () => {
    // Indentation is driven by the node's depth, not a one-level flag, so a page
    // nested three deep steps in three times.
    expect(panelSource).toContain("data-child={depth > 0 ? '' : undefined}");
    expect(panelSource).toContain("'--tree-depth': depth");
  });
});

describe('the draggable folder tree', () => {
  it('drags in its own DndContext, isolated from the canvas drag', () => {
    // The shell has one DndContext for the canvas; the panel gets its own so a
    // page drag and a block drag never read each other's data. Same activation
    // distance, so a plain click still opens the page.
    expect(panelSource).toContain('<DndContext');
    expect(panelSource).toContain('activationConstraint: { distance: 5 }');
  });

  it('lifts a row by its grip, so a click on the row still navigates', () => {
    // The drag listeners ride the grip alone, not the whole row, or every click
    // would start a drag and the anchor would never fire.
    expect(panelSource).toContain('{...drag.listeners}');
    expect(panelSource).toContain('{...drag.attributes}');
    expect(panelSource).toContain('className="ed-pages__grip"');
  });

  it('builds the drag transform by hand, not from @dnd-kit/utilities', () => {
    // That sub-package is not a dependency; importing it would break the build.
    // The translate is written out so the one dep this repo does carry is enough.
    // (The name may appear in a comment; what must not appear is the import.)
    expect(panelSource).not.toMatch(/from ['"]@dnd-kit\/utilities['"]/);
    expect(panelSource).toContain('translate(');
  });

  it('turns drag off while searching, on the browse view only', () => {
    // A hit deep in a folder shows in the flat search list, and filing into a
    // half-hidden structure is a trap, so search renders plain anchors.
    expect(panelSource).toContain('searching ?');
    expect(panelSource).toContain('<PageAnchor');
  });

  it('refuses to file a page inside its own branch, so the tree cannot loop', () => {
    expect(panelSource).toContain('descendantIds(list, activeId).has(target)');
    expect(panelSource).toContain("setMoveError('A page cannot go inside one of its own pages.')");
  });

  it('moves the row at once and puts it back if the server refuses', () => {
    // Optimistic: the list changes before the await, and reverts to the snapshot
    // taken before it on a failure, with the reason shown.
    expect(panelSource).toContain('const before = list;');
    expect(panelSource).toContain('await onMovePage(');
    expect(panelSource).toContain('setList(before);');
  });

  it('shows a top-level drop strip only while a drag is in flight', () => {
    expect(panelSource).toContain('<RootDropZone active={dragging != null} />');
  });
});

describe('the Add page composer', () => {
  it('shows the button only when a create handler is given', () => {
    // No handler, no button, so the region and item screens do not offer to add
    // a page from a place that has no list of its own to add to.
    expect(panelSource).toContain('onCreatePage &&');
  });

  it('refuses an empty name rather than making an Untitled that clashes', () => {
    expect(panelSource).toContain("setError('Give the page a name.')");
  });

  it('creates with the trimmed name, the chosen template, and the brief and picture for AI', () => {
    expect(panelSource).toContain('const title = newTitle.trim();');
    // Robust to further arguments: the call passes title then template, then the
    // AI brief and the picture id.
    expect(panelSource).toMatch(/onCreatePage\(\s*title,\s*template,/);
    expect(panelSource).toContain('wantsAi ? said : undefined');
    expect(panelSource).toContain('wantsAi ? imageId ?? undefined : undefined');
  });

  it('offers a template to start from, a radio group defaulting to blank', () => {
    // The picker in front of Add page: a real radio group so it announces itself
    // and moves on the arrow keys, opening on Blank so it builds nothing until a
    // designed page is chosen.
    expect(panelSource).toContain("useState('blank')");
    expect(panelSource).toContain('PAGE_TEMPLATES.map');
    expect(panelSource).toContain('role="radiogroup"');
  });

  it('offers describing the page with AI, which needs a brief or a picture', () => {
    // The one start that is not a ready-made page: a radio in the same group, a
    // brief box that only shows for it, and an optional picture through the same
    // media picker the image blocks use. A build needs one of the two.
    expect(panelSource).toContain('value="ai"');
    expect(panelSource).toContain("template === 'ai'");
    expect(panelSource).toContain('aria-label="Describe your page"');
    expect(panelSource).toContain('<MediaPicker');
    expect(panelSource).toContain('ed-pages__image-add');
    expect(panelSource).toContain("setError('Say what the page is for, or add a picture.')");
  });

  it('focuses the box only when the composer opens, not on every render', () => {
    // Keyed on `adding`, so typing in the search does not pull the caret back
    // here. A render-time focus would steal the cursor, which the house rules ban.
    expect(panelSource).toContain('if (adding) nameRef.current?.focus();');
    expect(panelSource).toMatch(/\}, \[adding\]\);/);
  });
});
