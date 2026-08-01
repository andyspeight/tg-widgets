/**
 * Three things that make a site easier to find, none of which asks the client
 * for anything new.
 *
 * WHAT EACH ONE IS ACTUALLY FOR, because on the surface they look unrelated.
 *
 *   sameAs is ENTITY RESOLUTION. It is how an engine confirms the business on
 *   this website is the same one as that Facebook page and that Tripadvisor
 *   listing, and an engine that cannot make that connection is one that
 *   declines to name the business in an answer. The addresses are already in a
 *   Social links block in the footer, so this costs the client nothing.
 *
 *   width and height on a picture are CUMULATIVE LAYOUT SHIFT. Without them an
 *   image left on the default Original shape reserves no space, everything
 *   below it jumps when it lands, and that is a ranking factor as well as being
 *   horrible to read.
 *
 *   the breadcrumb is a MATCH BETWEEN MARKUP AND PAGE. We emit BreadcrumbList
 *   for every nested page, and Google's guidance is that markup must represent
 *   visible content. Structured data with no visible counterpart is the shape
 *   of thing that gets structured data ignored.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePage } from '../lib/content/schema';
import { DEFAULT_SETTINGS } from '../lib/settings/schema';
import { organisationLd, pageJsonLd, profileLinks } from '../lib/seo/jsonld';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const ORIGIN = 'https://www.someagency.co.uk';
const SETTINGS = { ...DEFAULT_SETTINGS, companyName: 'Someshop Travel' };

function tree(blocks: Array<{ type: string; props: Record<string, unknown> }>) {
  const parsed = parsePage({
    version: 1,
    id: 'pg',
    title: 'A page',
    slug: '',
    seo: { noindex: false },
    sections: [
      {
        id: 's1',
        rows: [
          {
            id: 'r1',
            columns: [
              { id: 'c1', width: 100, blocks: blocks.map((b, i) => ({ id: `b${i}`, ...b })) },
            ],
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.page;
}

// ---------------------------------------------------------------------------
// sameAs
// ---------------------------------------------------------------------------

describe('the profiles gathered from a footer', () => {
  const footer = tree([
    {
      type: 'social',
      props: {
        items: [
          { network: 'facebook', href: 'https://facebook.com/someshop' },
          { network: 'tripadvisor', href: 'https://tripadvisor.co.uk/someshop' },
        ],
      },
    },
  ]);

  it('finds the addresses the client already filled in', () => {
    expect(profileLinks([footer])).toEqual([
      'https://facebook.com/someshop',
      'https://tripadvisor.co.uk/someshop',
    ]);
  });

  /*
   * THE ONE THAT WOULD BE WRONG RATHER THAN MERELY USELESS. The Social block
   * deliberately allows mailto: and tel:, because a follow us row usually ends
   * with an email and a phone number. Neither is a "reference Web page that
   * unambiguously indicates the identity of the item", which is what sameAs is
   * defined as, so putting one there is a claim that does not parse.
   */
  it('leaves out an email address and a phone number', () => {
    const mixed = tree([
      {
        type: 'social',
        props: {
          items: [
            { network: 'email', href: 'mailto:hello@someshop.co.uk' },
            { network: 'phone', href: 'tel:01234567890' },
            { network: 'facebook', href: 'https://facebook.com/someshop' },
          ],
        },
      },
    ]);

    expect(profileLinks([mixed])).toEqual(['https://facebook.com/someshop']);
  });

  it('reads the header and the page as well, not only the footer', () => {
    const header = tree([
      { type: 'social', props: { items: [{ network: 'x', href: 'https://x.com/someshop' }] } },
    ]);
    expect(profileLinks([header, null, footer])).toHaveLength(3);
  });

  it('lists an address once when it is in the header and the footer alike', () => {
    expect(profileLinks([footer, footer])).toHaveLength(2);
  });

  it('copes with a site that has no social block anywhere', () => {
    expect(profileLinks([null, undefined, tree([])])).toEqual([]);
  });
});

describe('sameAs on the business', () => {
  it('carries the profiles when there are some', () => {
    const node = organisationLd(SETTINGS, ORIGIN, 'Someshop', ['https://facebook.com/someshop']);
    expect(node?.sameAs).toEqual(['https://facebook.com/someshop']);
  });

  /*
   * An empty array is not "nothing to say", it is "this business has a presence
   * nowhere", which is a claim we have no basis for. Dropped instead.
   */
  it('says nothing at all rather than claiming an empty list', () => {
    const node = organisationLd(SETTINGS, ORIGIN, 'Someshop', []);
    expect(node).not.toBeNull();
    expect('sameAs' in node!).toBe(false);
  });

  it('reaches the page nodes through pageJsonLd', () => {
    const nodes = pageJsonLd({
      origin: ORIGIN,
      url: ORIGIN,
      path: '',
      siteName: 'Someshop Travel',
      settings: SETTINGS,
      pageTitle: 'Home',
      sameAs: ['https://tripadvisor.co.uk/someshop'],
    });

    const business = nodes.find((node) => node['@type'] === 'TravelAgency');
    expect(business?.sameAs).toEqual(['https://tripadvisor.co.uk/someshop']);
  });
});

// ---------------------------------------------------------------------------
// The shape of a picture
// ---------------------------------------------------------------------------

describe('reserving the space a picture will take', () => {
  const source = read('components', 'render', 'blocks.tsx');
  const block = source.slice(source.indexOf('export function ImageBlock'));
  const body = block.slice(0, block.indexOf('\n}\n'));

  it('puts the dimensions on the tag, which is what reserves the space', () => {
    expect(body).toContain('width={measured ? width : undefined}');
    expect(body).toContain('height={measured ? height : undefined}');
  });

  /*
   * ONLY ON THE ORIGINAL SHAPE. Any other ratio already puts an aspect-ratio on
   * the frame, and the stored numbers are the shape of the FILE rather than of
   * the crop, so emitting them beside a 16/9 frame would describe a box that is
   * not on the page.
   */
  it('only when the shape is Original, since a crop already reserves its own', () => {
    expect(body).toContain("ratio === 'auto' && width > 0 && height > 0");
  });

  it('records the dimensions when a picture is chosen, in the same commit', () => {
    const field = read('components', 'media', 'ImageField.tsx');
    expect(field).toContain('patch.width = item.width;');
    expect(field).toContain('patch.height = item.height;');
    // One patch, so one undo takes the whole choice back.
    expect([...field.matchAll(/onPatch\(patch\)/g)]).toHaveLength(1);
  });

  /*
   * THE CSS THAT MAKES IT WORK, and without which the attributes are decoration.
   * A browser turns width and height into an aspect ratio only while one
   * dimension is auto, and the shared rule sets both to 100%.
   */
  it('lets a measured picture size itself, or the hint is overruled', () => {
    const css = read('app', 'globals.css');
    expect(css).toContain('.tgs-image img[width] { height: auto; }');
  });
});

// ---------------------------------------------------------------------------
// The breadcrumb
// ---------------------------------------------------------------------------

describe('the visible trail', () => {
  const source = read('components', 'render', 'Breadcrumb.tsx');

  it('draws nothing on the home page, where a trail of one is not a trail', () => {
    expect(source).toContain('if (segments.length === 0) return null;');
  });

  /*
   * The same derivation as breadcrumbLd in jsonld.ts, deliberately. Two sources
   * would be two things that can disagree, and disagreeing with the structured
   * data is the one outcome that makes a visible trail worse than none.
   */
  it('builds from the address, exactly as the structured data does', () => {
    const jsonld = read('lib', 'seo', 'jsonld.ts');
    for (const file of [source, jsonld]) {
      expect(file).toContain("const words = slug.replace(/-+/g, ' ').trim();");
    }
  });

  it('does not link the page somebody is already on', () => {
    expect(source).toContain('href: last ? null : walked');
    expect(source).toContain('aria-current="page"');
  });

  it('is a landmark a screen reader can skip, and an ordered list', () => {
    expect(source).toContain('aria-label="Breadcrumb"');
    expect(source).toContain('<ol>');
  });

  /*
   * The separator is drawn by CSS, so a screen reader reads the names and not a
   * row of slashes, and copying the trail copies the words.
   */
  /*
   * Scoped to the RENDERED markup, not the whole file. My first version checked
   * the file for a slash and found the Home crumb's own href, which is a legal
   * address rather than a separator. A source-text check has to be pointed at
   * the right text.
   */
  it('draws its separators in CSS rather than putting them in the markup', () => {
    const markup = source.slice(source.indexOf('return ('));
    expect(markup).not.toContain("{'/'}");
    expect(markup).not.toMatch(/>\s*\/\s*</);
    expect(read('app', 'globals.css')).toContain('.tgs-crumbs li + li::before');
  });

  it('is rendered by the published page rather than left to a block', () => {
    const route = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');
    expect(route).toContain('<Breadcrumb path={currentPath} pageTitle={pageTitle} />');
  });
});
