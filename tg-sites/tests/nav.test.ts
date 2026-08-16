/**
 * Folders fill the menu's dropdowns (Andy, 15 Aug 2026).
 *
 * The pure half of the feature: given the site's pages and a menu, work out
 * which menu links point at a folder and what goes in each dropdown. The render
 * and the CSS are checked in the browser harness; everything here is rows in and
 * a filled tree out, which is exactly what must not drift as the tree shape
 * changes around it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fillNavFolders, navFolders, navItemPath, type NavPage } from '../lib/content/nav';
import type { Section } from '../lib/content/schema';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const PAGES: NavPage[] = [
  { id: 'home', title: 'Home', slug: '', parentId: null, published: true },
  { id: 'tours', title: 'Tours', slug: 'tours', parentId: null, published: true },
  { id: 'italy', title: 'Italy in autumn', slug: 'italy', parentId: 'tours', published: true },
  { id: 'france', title: 'France by rail', slug: 'france', parentId: 'tours', published: true },
  { id: 'about', title: 'About us', slug: 'about', parentId: null, published: true },
];

// ---------------------------------------------------------------------------

describe('navItemPath', () => {
  it('reads a same-site path, slashes and all trimmed away', () => {
    expect(navItemPath('/tours')).toBe('tours');
    expect(navItemPath('/tours/')).toBe('tours');
    expect(navItemPath('/tours?ref=x')).toBe('tours');
    expect(navItemPath('/tours#top')).toBe('tours');
    expect(navItemPath('  /tours  ')).toBe('tours');
  });

  it('reads the home path as the empty string, a real address', () => {
    expect(navItemPath('/')).toBe('');
  });

  it('refuses anything that is not a same-site absolute path', () => {
    // A folder can only be named by an on-site path. These never become dropdowns.
    expect(navItemPath('tours')).toBeNull();
    expect(navItemPath('//evil.test/tours')).toBeNull();
    expect(navItemPath('https://example.com/tours')).toBeNull();
    expect(navItemPath('mailto:hi@example.com')).toBeNull();
    expect(navItemPath('#section')).toBeNull();
    expect(navItemPath('')).toBeNull();
    expect(navItemPath(undefined)).toBeNull();
    expect(navItemPath(42)).toBeNull();
  });
});

describe('navFolders', () => {
  it('finds a top-level page with children and lists them by their real address', () => {
    const folders = navFolders(PAGES);
    // Keyed by the folder's own address; the child href is the composed path, so
    // Italy under Tours is /tours/italy, not /italy.
    expect(folders.get('tours')).toEqual([
      { label: 'Italy in autumn', href: '/tours/italy' },
      { label: 'France by rail', href: '/tours/france' },
    ]);
  });

  it('is not a folder when a page has no children', () => {
    expect(navFolders(PAGES).has('about')).toBe(false);
  });

  it('keeps the incoming order of the children', () => {
    const swapped = [PAGES[0], PAGES[1], PAGES[3], PAGES[2], PAGES[4]];
    expect(navFolders(swapped).get('tours')?.map((c) => c.label)).toEqual([
      'France by rail',
      'Italy in autumn',
    ]);
  });

  it('leaves out an unpublished child, so a dropdown never links to a 404', () => {
    const withDraft: NavPage[] = [
      ...PAGES,
      { id: 'peru', title: 'Peru (draft)', slug: 'peru', parentId: 'tours', published: false },
    ];
    const children = navFolders(withDraft).get('tours');
    expect(children?.map((c) => c.label)).toEqual(['Italy in autumn', 'France by rail']);
  });

  it('is not a folder when every child is unpublished', () => {
    const pages: NavPage[] = [
      { id: 'p', title: 'Plans', slug: 'plans', parentId: null, published: true },
      { id: 'c', title: 'Draft', slug: 'draft', parentId: 'p', published: false },
    ];
    expect(navFolders(pages).has('plans')).toBe(false);
  });

  it('nests a dropdown to any depth, matching the multi-tier sidebar', () => {
    // A grandchild under a child. Italy is a folder in its own right, so it opens
    // a flyout of Rome; Tours carries the whole branch.
    const pages: NavPage[] = [
      { id: 'tours', title: 'Tours', slug: 'tours', parentId: null, published: true },
      { id: 'italy', title: 'Italy', slug: 'italy', parentId: 'tours', published: true },
      { id: 'rome', title: 'Rome', slug: 'rome', parentId: 'italy', published: true },
    ];
    const folders = navFolders(pages);
    expect(folders.get('tours')).toEqual([
      { label: 'Italy', href: '/tours/italy', children: [{ label: 'Rome', href: '/tours/italy/rome' }] },
    ]);
    // Italy is keyed by its own address too, so a link straight to it also opens.
    expect(folders.get('tours/italy')).toEqual([{ label: 'Rome', href: '/tours/italy/rome' }]);
  });

  it('leaves a leaf child without a children key, so a plain link stays plain', () => {
    // Only a page that actually holds others carries a nested flyout.
    const folders = navFolders(PAGES);
    expect(folders.get('tours')).toEqual([
      { label: 'Italy in autumn', href: '/tours/italy' },
      { label: 'France by rail', href: '/tours/france' },
    ]);
  });

  it('draws nothing from a draft folder, whose children have no address', () => {
    const pages: NavPage[] = [
      { id: 'f', title: 'Folder', slug: 'folder', parentId: null, published: false },
      { id: 'c', title: 'Child', slug: 'child', parentId: 'f', published: true },
    ];
    expect(navFolders(pages).size).toBe(0);
  });
});

// A one-nav-block tree, the least this walk needs to chew on.
function navTree(items: Array<Record<string, unknown>>): { sections: Section[] } {
  return {
    sections: [
      {
        id: 's1',
        rows: [{ id: 'r1', columns: [{ id: 'c1', blocks: [{ id: 'b1', type: 'nav', props: { items } }] }] }],
      },
    ],
  } as unknown as { sections: Section[] };
}

describe('fillNavFolders', () => {
  it('gives a folder link its children and leaves the others alone', () => {
    const tree = navTree([
      { label: 'Home', href: '/' },
      { label: 'Tours', href: '/tours' },
      { label: 'About', href: '/about' },
    ]);
    const filled = fillNavFolders(tree, PAGES);
    const items = (filled.sections[0].rows[0].columns[0].blocks[0].props as { items: Array<Record<string, unknown>> }).items;

    expect(items[1].children).toEqual([
      { label: 'Italy in autumn', href: '/tours/italy' },
      { label: 'France by rail', href: '/tours/france' },
    ]);
    // The plain links are untouched: no children key appears on them.
    expect(items[0].children).toBeUndefined();
    expect(items[2].children).toBeUndefined();
  });

  it('returns the very same tree when nothing is a folder', () => {
    const flat: NavPage[] = [
      { id: 'a', title: 'A', slug: 'a', parentId: null, published: true },
      { id: 'b', title: 'B', slug: 'b', parentId: null, published: true },
    ];
    const tree = navTree([{ label: 'A', href: '/a' }]);
    expect(fillNavFolders(tree, flat)).toBe(tree);
  });

  it('returns the very same tree when the menu points at no folder', () => {
    const tree = navTree([{ label: 'About', href: '/about' }]);
    expect(fillNavFolders(tree, PAGES)).toBe(tree);
  });

  it('does not mutate the tree it was given', () => {
    const tree = navTree([{ label: 'Tours', href: '/tours' }]);
    fillNavFolders(tree, PAGES);
    const original = (tree.sections[0].rows[0].columns[0].blocks[0].props as { items: Array<Record<string, unknown>> }).items;
    expect(original[0].children).toBeUndefined();
  });

  it('ignores a block that is not a menu', () => {
    const tree = {
      sections: [
        { id: 's', rows: [{ id: 'r', columns: [{ id: 'c', blocks: [{ id: 'b', type: 'text', props: { items: [{ href: '/tours' }] } }] }] }] },
      ],
    } as unknown as { sections: Section[] };
    expect(fillNavFolders(tree, PAGES)).toBe(tree);
  });
});

// The render and the wiring: promises the source keeps, so a source test. The
// dropdown behaviour itself is checked in the browser harness.
describe('the menu renders a folder as a dropdown', () => {
  const blocks = source('components', 'render', 'blocks.tsx');

  it('reads the injected children and marks a folder item', () => {
    expect(blocks).toContain("const children = list(item, 'children');");
    expect(blocks).toContain('tgs-nav__item--folder');
    expect(blocks).toContain('tgs-nav__submenu');
    expect(blocks).toContain('tgs-nav__sublink');
  });

  it('recurses, so a page inside a folder that holds pages opens its own flyout', () => {
    // The submenu is drawn by a function that calls itself for a sub-item that
    // carries its own children, marking it a folder with a side chevron.
    expect(blocks).toContain('navSubmenu(grandchildren');
    expect(blocks).toContain('tgs-nav__subitem--folder');
    expect(blocks).toContain('tgs-nav__subchev');
  });

  it('keeps the folder link a real link, so the parent page is still reachable', () => {
    // The chevron and submenu are added, but the <a href> to the folder stays.
    expect(blocks).toContain('className="tgs-nav__link"');
    expect(blocks).toContain('tgs-nav__chev');
  });

  it('reveals the dropdown on hover AND on keyboard focus, with no script', () => {
    // The browser harness reads the dropdown's link but does not reveal it: the
    // editor's chrome band is pointer-inert while editing. So the reveal rule is
    // asserted here. :focus-within is what makes it reachable by keyboard, and
    // the submenu must actually become visible, not merely fade its opacity.
    const css = source('app', 'globals.css');
    expect(css).toContain('.tgs-nav__item--folder:hover > .tgs-nav__submenu');
    expect(css).toContain('.tgs-nav__item--folder:focus-within > .tgs-nav__submenu');
    expect(css).toMatch(/:focus-within > \.tgs-nav__submenu[\s\S]*?visibility: visible/);
  });

  it('opens a nested flyout to the side, revealed the same way', () => {
    const css = source('app', 'globals.css');
    // A sub-folder's flyout opens off the side (left: 100%) and reveals on hover
    // and keyboard focus, so a deep menu fans out rather than marching downward.
    expect(css).toContain('.tgs-nav__subitem--folder > .tgs-nav__submenu');
    expect(css).toContain('left: 100%');
    expect(css).toContain('.tgs-nav__subitem--folder:focus-within > .tgs-nav__submenu');
  });
});

describe('the routes fill the menu before rendering it', () => {
  for (const route of [
    ['app', 'site', '[host]', '[[...path]]', 'page.tsx'],
    ['app', 'preview', '[[...path]]', 'page.tsx'],
  ] as const) {
    const text = source(...route);
    const label = route[1];

    it(`${label} reads the published pages and fills header, footer and page`, () => {
      expect(text).toContain('listPublishedNavPages');
      expect(text).toContain('fillNavRegion(found.regions.header');
      expect(text).toContain('fillNavRegion(found.regions.footer');
      expect(text).toContain('fillNavFolders(found.page.content');
    });

    it(`${label} loads the pages alongside the rest, not after`, () => {
      const parallel = /await Promise\.all\(\[([\s\S]*?)\]\);/.exec(text)?.[1] ?? '';
      expect(parallel).toContain('listPublishedNavPages');
    });
  }
});

describe('the editor canvas fills the menu at the render boundary', () => {
  const canvas = source('components', 'editor', 'Canvas.tsx');

  it('fills the framed tree and the chrome bands, so the tree it saves stays clean', () => {
    expect(canvas).toContain('fillNavFolders(page, navPages)');
    expect(canvas).toContain('fillNavFolders(content, navPages)');
  });
});
