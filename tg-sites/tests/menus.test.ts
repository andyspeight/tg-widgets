/**
 * The menu's link styles and burger panels. The fifth and last slice of the
 * React Bits review (docs/react-bits-review.md, 15 Sep 2026): a pill or an
 * underline sweep on the links, and the whole screen or cards behind the burger.
 *
 * WHAT IS PINNED. That the page being drawn is marked as the current one by the
 * fill at the render boundary, from the route's address, never by the block, and
 * comes out as aria-current="page"; that the two styles and the two panels are
 * settings on the Menu block, read from closed lists; that the full screen is
 * never written on the editing canvas (it is a fixed overlay, and the canvas sits
 * inside the editor); that the only motion in the slice sits behind the
 * reduced-motion guard; that the header rises and the page stops scrolling while
 * the full screen is open; that the script makes the page inert and closes the
 * menu on Escape, before its reduced-motion return, and is pulled only by a
 * full-screen menu; and that the dressed presets ask for what they say.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor } from '../lib/content/blocks';
import { needsMotionScript } from '../lib/content/motion';
import { fillNavFolders, fillNavRegion, type NavPage } from '../lib/content/nav';
import { REGION_PRESETS } from '../lib/content/presets-region';
import type { Section } from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const css = read('app', 'globals.css');
const render = read('components', 'render', 'blocks.tsx');
const dispatch = read('components', 'render', 'BlockRenderer.tsx');
const script = read('public', 'tg-motion.js');
const siteRoute = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');
const previewRoute = read('app', 'preview', '[[...path]]', 'page.tsx');
const canvas = read('components', 'editor', 'Canvas.tsx');
const shell = read('components', 'editor', 'EditorShell.tsx');

/** Every block of a guard, brace matched, so a rule NEAR it cannot pass. */
function blocksOf(sheet: string, opener: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = sheet.indexOf(opener, from);
    if (start === -1) break;
    let depth = 1;
    let i = start + opener.length;
    for (; i < sheet.length && depth > 0; i += 1) {
      if (sheet[i] === '{') depth += 1;
      else if (sheet[i] === '}') depth -= 1;
    }
    out += `${sheet.slice(start + opener.length, i)}\n`;
    from = i;
  }
  return out;
}

const motionGuarded = blocksOf(css, '@media (prefers-reduced-motion: no-preference) {');

/** The declarations of the first rule whose selector line starts with `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const PAGES: NavPage[] = [
  { id: 'home', title: 'Home', slug: '', parentId: null, published: true },
  { id: 'hol', title: 'Holidays', slug: 'holidays', parentId: null, published: true },
  { id: 'italy', title: 'Italy', slug: 'italy', parentId: 'hol', published: true },
  { id: 'about', title: 'About', slug: 'about', parentId: null, published: true },
];

function navTree(items: Array<Record<string, unknown>>) {
  return {
    sections: [
      { id: 's', rows: [{ id: 'r', columns: [{ id: 'c', blocks: [{ id: 'b', type: 'nav', props: { items } }] }] }] },
    ],
  } as unknown as { sections: Section[] };
}

function itemsOf(tree: { sections: Section[] }): Array<Record<string, unknown>> {
  return (tree.sections[0].rows[0].columns[0].blocks[0].props as { items: Array<Record<string, unknown>> }).items;
}

// ---------------------------------------------------------------------------
// The current page, decided at the render boundary
// ---------------------------------------------------------------------------

describe('the current page', () => {
  const links = [
    { label: 'Home', href: '/' },
    { label: 'Holidays', href: '/holidays' },
    { label: 'About', href: '/about/' },
    { label: 'Elsewhere', href: 'https://example.com/about' },
  ];

  it('is marked on the link whose address is the page being drawn, and on no other', () => {
    const items = itemsOf(fillNavFolders(navTree(links), PAGES, 'about'));
    expect(items[2].current).toBe(true);
    expect(items[0].current).toBeUndefined();
    expect(items[1].current).toBeUndefined();
    // An external link is never the current page, whatever its path says.
    expect(items[3].current).toBeUndefined();
  });

  it('reads the home page as the empty address, so the Home link is current there', () => {
    const items = itemsOf(fillNavFolders(navTree(links), PAGES, ''));
    expect(items[0].current).toBe(true);
    expect(items[1].current).toBeUndefined();
  });

  it('marks a folder link current AND fills its children, on the folder page itself', () => {
    const items = itemsOf(fillNavFolders(navTree(links), PAGES, '/holidays/'));
    expect(items[1].current).toBe(true);
    expect(items[1].children).toEqual([{ label: 'Italy', href: '/holidays/italy' }]);
  });

  it('is not marked on a page inside the folder, only on the folder page', () => {
    const items = itemsOf(fillNavFolders(navTree(links), PAGES, 'holidays/italy'));
    expect(items[1].current).toBeUndefined();
    expect(items[1].children).toBeDefined();
  });

  it('returns the very same tree when no address is given and nothing is a folder', () => {
    const flat: NavPage[] = [{ id: 'a', title: 'A', slug: 'a', parentId: null, published: true }];
    const tree = navTree([{ label: 'A', href: '/a' }]);
    expect(fillNavFolders(tree, flat)).toBe(tree);
    expect(fillNavFolders(tree, flat, null)).toBe(tree);
    // And when the address matches nothing in the menu.
    expect(fillNavFolders(tree, flat, 'b')).toBe(tree);
  });

  it('does not mutate the tree it was given', () => {
    const tree = navTree([{ label: 'About', href: '/about' }]);
    fillNavFolders(tree, PAGES, 'about');
    expect(itemsOf(tree)[0].current).toBeUndefined();
  });

  it('reaches a header or footer through fillNavRegion too', () => {
    const region = navTree([{ label: 'About', href: '/about' }]);
    expect(itemsOf(fillNavRegion(region, PAGES, 'about')!)[0].current).toBe(true);
    expect(fillNavRegion(null, PAGES, 'about')).toBeNull();
  });

  it('renders as aria-current="page", which a screen reader announces', () => {
    expect(render).toContain("const current = bool(item, 'current');");
    expect(render).toContain("aria-current={current ? 'page' : undefined}");
  });

  it('is handed to the fill by both routes and by the editor canvas', () => {
    expect(siteRoute).toContain('fillNavRegion(found.regions.header, found.navPages, currentPath)');
    expect(siteRoute).toContain('fillNavFolders(found.page.content, found.navPages, currentPath)');
    expect(siteRoute).toContain('fillNavRegion(found.regions.footer, found.navPages, currentPath)');
    expect(previewRoute).toContain("fillNavRegion(found.regions.header, found.navPages, (path ?? []).join('/'))");
    expect(previewRoute).toContain("fillNavFolders(found.page.content, found.navPages, (path ?? []).join('/'))");
    expect(canvas).toContain('fillNavFolders(shownForVisitor, navPages, currentPath)');
    expect(canvas).toContain('fillNavFolders(content, navPages, currentPath)');
    // The editor works the address out with the site's own path rules.
    expect(shell).toContain('const currentPath = useMemo<string | null>(');
    expect(shell).toContain('.get(pageId) ?? null');
    expect(shell).toContain('currentPath={currentPath}');
  });
});

// ---------------------------------------------------------------------------
// The fields
// ---------------------------------------------------------------------------

describe('the menu fields', () => {
  it('offer three link styles and three panels, on the Menu block and nowhere new', () => {
    const style = blockDefinition('nav')!.fields.find((f) => f.key === 'style') as { options?: Array<{ value: string }> };
    expect(style.options!.map((o) => o.value)).toEqual(['plain', 'pill', 'underline']);
    const panel = blockDefinition('nav')!.fields.find((f) => f.key === 'panel') as { options?: Array<{ value: string }> };
    expect(panel.options!.map((o) => o.value)).toEqual(['panel', 'full', 'cards']);
    for (const type of ['pill-nav', 'staggered-menu', 'card-nav']) expect(blockDefinition(type), type).toBeUndefined();
  });

  it('default to what every menu was, so no stored menu changes', () => {
    expect(defaultPropsFor('nav').style).toBe('plain');
    expect(defaultPropsFor('nav').panel).toBe('panel');
  });

  it('are read from closed lists, and written only when they are something', () => {
    expect(render).toContain("const style = oneOf(props, 'style', ['plain', 'pill', 'underline'] as const, 'plain');");
    expect(render).toContain("const wanted = oneOf(props, 'panel', ['panel', 'full', 'cards'] as const, 'panel');");
    expect(render).toContain("data-style={style === 'plain' ? undefined : style}");
    // A panel only where there is a burger to open it.
    expect(render).toContain("data-panel={hasBurger(burger) && panel !== 'panel' ? panel : undefined}");
  });

  /*
   * LOAD-BEARING. The canvas is not an iframe: it sits inside the editor's own
   * page, so a fixed overlay opened there would cover the editor's tools. The
   * flag is editorCanvas, true through Preview too, for the same reason the
   * widget block reads it.
   */
  it('never write the full screen on the editing canvas', () => {
    expect(render).toContain("const panel = editing && wanted === 'full' ? 'panel' : wanted;");
    expect(dispatch).toContain('<NavBlock props={props} editing={editorCanvas} />');
  });
});

// ---------------------------------------------------------------------------
// The stylesheet
// ---------------------------------------------------------------------------

describe('the link styles', () => {
  it('sit the current page in a pill and wash the link under the pointer, in the band\'s own tint', () => {
    expect(rule(".tgs-nav[data-style='pill'] .tgs-nav__link")).toContain('border-radius: 999px;');
    expect(rule(".tgs-nav[data-style='pill'] .tgs-nav__link[aria-current='page']")).toContain('var(--tgs-primary) 16%');
    expect(rule(".tgs-nav[data-style='pill'] .tgs-nav__link:hover")).toContain('var(--tgs-primary) 10%');
    // On a dark or accent bar the wash is the band's border tint, never a light patch.
    expect(css).toContain(".tgs-section[data-tone='dark'] .tgs-nav[data-style='pill'] .tgs-nav__link[aria-current='page'] {\n  background: var(--tgs-on-dark-border);");
    expect(css).toContain(".tgs-section[data-tone='accent'] .tgs-nav[data-style='pill'] .tgs-nav__link[aria-current='page'] {\n  background: var(--tgs-on-primary-border);");
  });

  it('draw the underline in from the left, out to the right, and keep it under the current page', () => {
    const line = rule(".tgs-nav[data-style='underline'] .tgs-nav__link::after");
    expect(line).toContain('transform: scaleX(0);');
    expect(line).toContain('transform-origin: right;');
    expect(css).toContain(".tgs-nav[data-style='underline'] .tgs-nav__link[aria-current='page']::after {\n  transform: scaleX(1);\n  transform-origin: left;");
    // The keyboard gets the line too.
    expect(css).toContain(".tgs-nav[data-style='underline'] .tgs-nav__link:focus-visible::after");
    // And the old text-decoration underline is off, or there would be two lines.
    expect(rule(".tgs-nav[data-style='underline'] .tgs-nav__link:hover")).toContain('text-decoration: none;');
  });

  it('only sweep where motion is welcome; with less asked for the line simply is or is not', () => {
    expect(motionGuarded).toContain(".tgs-nav[data-style='underline'] .tgs-nav__link::after {\n    transition: transform 0.28s");
    expect(count(css, "transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)")).toBe(1);
  });

  it('drop the underline inside a burger list, where a full-width line is a rule, not an underline', () => {
    expect(css).toContain(".tgs-nav[data-style='underline'] .tgs-nav__list--stacked .tgs-nav__link::after { display: none; }");
  });
});

describe('the full-screen panel', () => {
  const overlay = rule(".tgs-nav[data-panel='full'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked");

  it('is a fixed overlay over the whole viewport, keyed on the menu\'s own choice', () => {
    expect(overlay).toContain('position: fixed;');
    expect(overlay).toContain('inset: 0;');
    // The default panel's rule is untouched: still absolute, still not fixed (tests/burger.test.ts).
    expect(rule(".tgs-nav[data-burger='always'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked")).toContain('position: absolute');
  });

  it('puts the links at display size, on the link and not its item, so a folder\'s pages keep a reading size', () => {
    expect(rule(".tgs-nav[data-panel='full'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked > .tgs-nav__item > .tgs-nav__link")).toContain('font-size: clamp(2rem, 6vw, 4rem);');
    expect(rule(".tgs-nav[data-panel='full'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked .tgs-nav__sublink")).toContain('font-size: 1.1rem;');
  });

  it('keeps the cross above the overlay, so the control that opened it closes it', () => {
    const cross = rule(".tgs-nav[data-panel='full'] .tgs-nav__disclosure[open] > .tgs-nav__burger");
    expect(cross).toContain('z-index: 61;');
    expect(overlay).toContain('z-index: 60;');
  });

  it('raises the header and stops the page scrolling while it is open', () => {
    expect(css).toContain(".tgs-region[data-region='header']:has(.tgs-nav[data-panel='full'] .tgs-nav__disclosure[open]) {\n  z-index: 40;");
    expect(css).toContain("html:has(.tgs-nav[data-panel='full'] .tgs-nav__disclosure[open]) { overflow: hidden; }");
  });

  it('follows the band, so a dark bar opens a dark screen', () => {
    expect(css).toContain(".tgs-section[data-tone='dark'] .tgs-nav[data-panel='full'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked {\n  background: var(--tgs-surface-dark);");
    expect(css).toContain(".tgs-section[data-tone='accent'] .tgs-nav[data-panel='full'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked {\n  background: var(--tgs-primary);");
  });

  it('cascades the links in one beat apart, twelve beats for twelve links, only where motion is welcome', () => {
    expect(motionGuarded).toContain('animation: tgs-nav-cascade 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards;');
    expect(motionGuarded).toContain('animation: tgs-nav-full-in 0.3s ease-out;');
    for (let n = 2; n <= 12; n += 1) {
      expect(motionGuarded).toContain(`> .tgs-nav__item:nth-child(${n}) { animation-delay: ${(n - 1) * 55}ms; }`);
    }
    expect(count(css, 'animation: tgs-nav-cascade')).toBe(1);
    expect(css).toContain('@keyframes tgs-nav-cascade {');
    expect(css).toContain('@keyframes tgs-nav-full-in {');
  });
});

describe('the cards panel', () => {
  it('lays the links out as a grid of cards, each folder\'s pages beneath its card', () => {
    const grid = rule(".tgs-nav[data-panel='cards'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked");
    expect(grid).toContain('display: grid;');
    expect(grid).toContain('grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));');
    const card = rule(".tgs-nav[data-panel='cards'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked > .tgs-nav__item");
    expect(card).toContain('border: 1px solid var(--tgs-border);');
    expect(card).toContain('border-radius: var(--tgs-radius-md);');
  });

  it('answers the pointer and the keyboard alike', () => {
    expect(css).toContain(".tgs-nav[data-panel='cards'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked > .tgs-nav__item:focus-within {\n  border-color: var(--tgs-primary);");
  });
});

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

describe('tg-motion.js', () => {
  it('makes the page beneath a full-screen menu inert and closes it on Escape', () => {
    expect(script).toContain('function setUpFullMenu()');
    expect(script).toContain(`"[data-panel='full'] > .tgs-nav__disclosure"`);
    const bind = script.slice(script.indexOf('function bindFullMenu('), script.indexOf('var REDUCED'));
    expect(bind).toContain("kin[k].setAttribute('inert', '');");
    expect(bind).toContain("made[i].removeAttribute('inert');");
    expect(bind).toContain("if (event.key !== 'Escape' || !details.open) return;");
    expect(bind).toContain('details.open = false;');
    // Focus goes back to the button that opened it.
    expect(bind).toContain('if (summary && summary.focus) summary.focus();');
    // Wired on the native toggle, so a close from the cross restores the page too.
    expect(bind).toContain("details.addEventListener('toggle', function () {");
  });

  it('wires that up BEFORE the reduced-motion return, because it is the keyboard and not motion', () => {
    const reduced = script.indexOf('if (REDUCED && REDUCED.matches) return;');
    expect(script.indexOf('function setUpFullMenu()')).toBeLessThan(reduced);
    expect(script.indexOf('setUpFullMenu();')).toBeLessThan(reduced);
    // And everything that IS motion still sits after it.
    expect(reduced).toBeLessThan(script.indexOf('function setUpArrive'));
    expect(script).toContain("var VERSION = '1.4.0';");
  });

  it('is pulled onto a page by a full-screen menu, and by no other menu setting', () => {
    const withNav = (props: Record<string, unknown>) => ({
      sections: [{ id: 'a', rows: [{ columns: [{ blocks: [{ type: 'nav', props }] }] }] }],
    });
    expect(needsMotionScript(withNav({ panel: 'full' }))).toBe(true);
    expect(needsMotionScript(withNav({ panel: 'cards' }))).toBe(false);
    expect(needsMotionScript(withNav({ panel: 'panel' }))).toBe(false);
    expect(needsMotionScript(withNav({ style: 'pill' }))).toBe(false);
    expect(needsMotionScript(withNav({ style: 'underline' }))).toBe(false);
    expect(needsMotionScript(withNav({}))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The presets
// ---------------------------------------------------------------------------

describe('the dressed presets', () => {
  const byId = (id: string) => REGION_PRESETS.find((p) => p.id === id)!;
  const navOf = (id: string) => byId(id).rows[0].columns.flat().find((b) => b.type === 'nav')!.props!;

  it('give the bar with a button pills, the dark bar the underline, and add the full-screen header', () => {
    expect(navOf('header-cta-bar').style).toBe('pill');
    expect(navOf('header-dark-bar').style).toBe('underline');
    const full = byId('header-logo-full-menu');
    expect(full.category).toBe('header');
    expect(navOf('header-logo-full-menu').collapse).toBe('always');
    expect(navOf('header-logo-full-menu').panel).toBe('full');
  });

  it('leave every footer menu a plain list, so nothing in a footer ever opens a screen', () => {
    for (const preset of REGION_PRESETS.filter((p) => p.category === 'footer')) {
      for (const row of preset.rows) {
        for (const block of row.columns.flat()) {
          if (block.type !== 'nav') continue;
          expect(block.props?.panel, preset.id).toBeUndefined();
          expect(block.props?.style, preset.id).toBeUndefined();
        }
      }
    }
  });
});
