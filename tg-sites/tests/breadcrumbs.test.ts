/**
 * The Breadcrumbs element, and the rule that keeps it honest.
 *
 * THE TRAIL WAS NEVER OPT-IN AND MUST NOT BECOME OPT-IN. Every nested published
 * page already draws one automatically (components/render/Breadcrumb.tsx),
 * because the same page emits BreadcrumbList structured data and Google's
 * guidance is that markup must represent content a visitor can see. A page whose
 * markup claims a trail that is not on the page is a mismatch, and a mismatch is
 * what gets structured data ignored.
 *
 * So this block does not turn a trail ON. It MOVES one. The property under test,
 * above any individual assertion: a page has EXACTLY ONE trail, whether or not
 * the client placed a block. Two would be a bug; none would be a worse one.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { crumbsFor, fillBreadcrumbs, hasBreadcrumbsBlock } from '../lib/content/breadcrumbs';
import { createBlock, createPage } from '../lib/content/factory';
import { parsePage, type Page } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';
import { addBlock, addInnerBlock, containerColumns } from '../lib/content/tree';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const blocks0 = (page: Page) => page.sections[0].rows[0].columns[0].blocks;

// ---------------------------------------------------------------------------

describe('the block', () => {
  const definition = blockDefinition('breadcrumbs')!;

  it('is in the library, under Layout, and belongs to the client', () => {
    expect(isKnownBlock('breadcrumbs')).toBe(true);
    expect(definition.group).toBe('Layout');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('breadcrumbs');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  /*
   * THE CRUMBS ARE NOT A FIELD, and that is the whole design. They are written
   * in at render time from the page's own address. A field would be a second
   * description of the site's shape: right the day it was typed, wrong the first
   * time anybody moved a page, and disagreeing with the structured data.
   */
  it('has no field for the crumbs themselves', () => {
    expect(definition.fields.some((field) => field.key === 'crumbs')).toBe(false);
    expect(defaultPropsFor('breadcrumbs')).not.toHaveProperty('crumbs');
  });
});

// ---------------------------------------------------------------------------

describe('the trail derived from an address', () => {
  it('walks the path, naming the last crumb with the real page title', () => {
    expect(crumbsFor('destinations/greece/crete', 'Crete holidays')).toEqual([
      { name: 'Home', href: '/' },
      { name: 'Destinations', href: '/destinations' },
      { name: 'Greece', href: '/destinations/greece' },
      // The page somebody is on: its real title, and not a link to itself.
      { name: 'Crete holidays', href: null },
    ]);
  });

  it('turns a slug back into words for the steps in between', () => {
    const crumbs = crumbsFor('greek-island-hopping/late-deals', 'Late deals');
    expect(crumbs[1].name).toBe('Greek island hopping');
  });

  /* A trail of one is not a trail. */
  it('is empty on the home page', () => {
    expect(crumbsFor('', 'Home')).toEqual([]);
    expect(crumbsFor('/', 'Home')).toEqual([]);
  });

  /*
   * IDENTICAL TO THE STRUCTURED DATA, which is the point. lib/seo/jsonld.ts
   * derives the in-between names the same way, and the two disagreeing is the
   * one outcome that makes a visible trail worse than no trail.
   */
  it('derives its names exactly as the structured data does', () => {
    const jsonld = source('lib', 'seo', 'jsonld.ts');
    const ours = source('lib', 'content', 'breadcrumbs.ts');
    const derivation = "const words = slug.replace(/-+/g, ' ').trim();";
    expect(jsonld).toContain(derivation);
    expect(ours).toContain(derivation);
  });
});

// ---------------------------------------------------------------------------

describe('finding a placed trail', () => {
  it('sees one sitting in an ordinary column', () => {
    const page = addBlock(createPage(), 0, 0, 0, createBlock('breadcrumbs'));
    expect(hasBreadcrumbsBlock(page)).toBe(true);
  });

  it('says no when there is none', () => {
    expect(hasBreadcrumbsBlock(createPage())).toBe(false);
    expect(hasBreadcrumbsBlock(null)).toBe(false);
    expect(hasBreadcrumbsBlock(undefined)).toBe(false);
  });

  /*
   * INSIDE A CONTAINER COUNTS. Dropping the trail into an inner column of a hero
   * is the commonest place a travel site would want it, and missing it would put
   * two trails on that page.
   */
  it('finds one nested inside a container', () => {
    let page = addBlock(createPage(), 0, 0, 0, createBlock('container'));
    page = addInnerBlock(page, 0, 0, 0, 0, 1, createBlock('breadcrumbs'));
    expect(hasBreadcrumbsBlock(page)).toBe(true);
  });

  it('finds one nested inside a grid cell', () => {
    let page = addBlock(createPage(), 0, 0, 0, createBlock('grid'));
    page = addInnerBlock(page, 0, 0, 0, 0, 2, createBlock('breadcrumbs'));
    expect(hasBreadcrumbsBlock(page)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('filling the trail at render time', () => {
  it('writes the crumbs into the block and leaves everything else alone', () => {
    const page = addBlock(createPage(), 0, 0, 0, createBlock('breadcrumbs'));
    const filled = fillBreadcrumbs(page, 'about/team', 'Our team');

    const props = blocks0(filled)[0].props as { crumbs?: unknown; separator?: unknown };
    expect(props.crumbs).toEqual([
      { name: 'Home', href: '/' },
      { name: 'About', href: '/about' },
      { name: 'Our team', href: null },
    ]);
    // The client's own choices are untouched.
    expect(props.separator).toBe('slash');
  });

  it('fills one inside a container too', () => {
    let page = addBlock(createPage(), 0, 0, 0, createBlock('container'));
    page = addInnerBlock(page, 0, 0, 0, 0, 0, createBlock('breadcrumbs'));
    const filled = fillBreadcrumbs(page, 'offers/summer', 'Summer offers');

    const inner = containerColumns(blocks0(filled)[0])[0].blocks[0];
    expect((inner.props as { crumbs?: unknown[] }).crumbs).toHaveLength(3);
  });

  /* Cheap for the pages that have no block, which is nearly all of them. */
  it('returns the same object when there is nothing to fill', () => {
    const page = createPage();
    expect(fillBreadcrumbs(page, 'a/b', 'B')).toBe(page);
  });

  it('fills an empty trail on the home page, so the block draws nothing', () => {
    const page = addBlock(createPage(), 0, 0, 0, createBlock('breadcrumbs'));
    const filled = fillBreadcrumbs(page, '', 'Home');
    expect((blocks0(filled)[0].props as { crumbs?: unknown[] }).crumbs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('a trail is never stored', () => {
  /*
   * The sanitiser drops crumbs on the way in. Not because the editor sends them
   * (it never sees a filled tree) but because an import or a hand-edited payload
   * can carry any key, and a stored trail is a second copy of the site's shape
   * that goes wrong the first time a page moves.
   */
  it('is dropped on save, however it got there', () => {
    const parsed = parsePage({
      version: 1,
      id: 'p1',
      title: 'Crete',
      slug: 'crete',
      seo: { noindex: false },
      sections: [
        {
          id: 's1',
          tone: 'light',
          rows: [
            {
              id: 'r1',
              columns: [
                {
                  id: 'c1',
                  width: 100,
                  blocks: [
                    {
                      id: 'b1',
                      type: 'breadcrumbs',
                      props: {
                        separator: 'chevron',
                        crumbs: [{ name: 'Somewhere else entirely', href: '/nope' }],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const props = blocks0(sanitisePage(parsed.page))[0].props;
    expect(props).not.toHaveProperty('crumbs');
    // The real settings survive.
    expect(props.separator).toBe('chevron');
  });
});

// ---------------------------------------------------------------------------

describe('exactly one trail on a page, never two and never none', () => {
  /*
   * THE RULE, read off the routes that enforce it. Asserted as source because
   * the alternative is standing a Next.js request up for a boolean, and this is
   * the invariant that a future edit is most likely to break by accident.
   */
  it('the published page stands the automatic trail down when a block is placed', () => {
    const route = source('app', 'site', '[host]', '[[...path]]', 'page.tsx');
    expect(route).toContain('const placedCrumbs = hasBreadcrumbsBlock(contentTree);');
    expect(route).toContain('{!found.archive && !placedCrumbs && (');
  });

  it('the published page fills the crumbs on a page and on a post', () => {
    const route = source('app', 'site', '[host]', '[[...path]]', 'page.tsx');
    // A post that stood the automatic trail down and then drew nothing would be
    // the one way this feature could LOSE a page its trail rather than move it.
    expect(route).toContain('item: fillBreadcrumbs(found.entry.item, currentPath, pageTitle)');
    expect(route).toContain('page={fillBreadcrumbs(');
  });

  it('the preview fills them too, so positioning one shows the real thing', () => {
    expect(source('app', 'preview', '[[...path]]', 'page.tsx')).toContain('fillBreadcrumbs(');
  });
});

// ---------------------------------------------------------------------------

describe('what the renderer and the stylesheet promise', () => {
  const css = source('app', 'globals.css');
  const renderer = source('components', 'render', 'blocks.tsx');

  /*
   * SEPARATORS ARE DRAWN, NOT WRITTEN. A separator character in the markup is
   * one a screen reader reads out between every step, and one a visitor copying
   * the trail takes with them.
   */
  it('draws the separator in CSS rather than putting it in the words', () => {
    for (const [name, glyph] of [
      ['chevron', '\\203A'],
      ['arrow', '\\2192'],
      ['dot', '\\00B7'],
      ['bullet', '\\2022'],
    ]) {
      expect(css, name).toContain(`[data-separator='${name}'] li + li::before { content: '${glyph}'; }`);
    }
  });

  it('shares its appearance with the automatic trail rather than restyling it', () => {
    expect(renderer).toContain('className="tgs-crumbs tgs-crumbs--block"');
  });

  it('marks the current page for a screen reader', () => {
    expect(renderer).toContain('aria-current="page"');
    expect(renderer).toContain('aria-label="Breadcrumb"');
  });

  /*
   * The canvas has no address, so an unfilled block shows a worked example
   * there. Without it a client would be positioning something invisible.
   */
  it('shows a sample on the canvas and nothing at all on a live home page', () => {
    expect(renderer).toContain('if (sample && !editing) return null;');
    expect(renderer).toContain("data-sample={sample ? 'true' : undefined}");
  });
});
