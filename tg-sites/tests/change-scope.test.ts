/**
 * The content-versus-structure classifier. Built on real, sanitised pages so the
 * fixtures are the exact shape a save produces, and the vocabulary it reads comes
 * from the real block definitions.
 */

import { describe, expect, it } from 'vitest';

import { changeScope, regionChangeScope } from '../lib/content/change-scope';
import { parsePage, parseRegion, type Page, type Region } from '../lib/content/schema';
import { sanitisePage, sanitiseRegion } from '../lib/content/sanitise-page';

/** A sanitised page holding the given blocks in one section, row and column. */
function pageWith(blocks: unknown[], extra: Record<string, unknown> = {}): Page {
  const parsed = parsePage({
    version: 1,
    id: 'page-1',
    title: 'Home',
    slug: '',
    seo: { noindex: false },
    sections: [
      {
        id: 'sec-1',
        tone: 'light',
        rows: [
          {
            id: 'row-1',
            columns: [{ id: 'col-1', width: 100, blocks }],
          },
        ],
        ...extra,
      },
    ],
  });
  if (!parsed.ok) throw new Error(`fixture will not parse: ${parsed.errors.join('; ')}`);
  return sanitisePage(parsed.page);
}

/** A deep, mutable clone, so a test can nudge one thing and compare. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The nth block's props in the single-column fixture, for a test to reach into. */
function props0(page: Page, index = 0): Record<string, unknown> {
  return page.sections[0].rows[0].columns[0].blocks[index].props;
}

const heading = (id: string, html: string) => ({
  id,
  type: 'heading',
  props: { html, level: 'h2', style: 'h3', align: 'left' },
});

const image = (id: string) => ({
  id,
  type: 'image',
  props: { src: 'https://cdn.test/a.jpg', alt: 'A beach', width: 800, height: 600, ratio: 'auto', radius: 'md' },
});

const button = (id: string) => ({
  id,
  type: 'button',
  props: { label: 'Enquire', href: '/contact', variant: 'primary', size: 'm', align: 'left', newTab: false },
});

describe('changeScope: content edits', () => {
  it('an identical page is neither structure nor SEO', () => {
    const page = pageWith([heading('h1', 'Hello')]);
    expect(changeScope(page, clone(page))).toEqual({ structure: false, seo: false });
  });

  it('editing heading text is content, not structure', () => {
    const before = pageWith([heading('h1', 'Hello')]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].props.html = 'Hello there';
    expect(changeScope(before, after).structure).toBe(false);
  });

  it('swapping a photo, which also changes its width and height, is content', () => {
    const before = pageWith([image('img')]);
    const after = clone(before);
    const props = after.sections[0].rows[0].columns[0].blocks[0].props;
    props.src = 'https://cdn.test/b.jpg';
    props.alt = 'A mountain';
    props.width = 1200;
    props.height = 800;
    expect(changeScope(before, after).structure).toBe(false);
  });

  it('editing a link is content', () => {
    const before = pageWith([button('btn')]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].props.href = '/enquiry';
    expect(changeScope(before, after).structure).toBe(false);
  });

  it('editing an existing list item is content', () => {
    const list = { id: 'l', type: 'list', props: { style: 'bullet', items: [{ text: 'One' }, { text: 'Two' }] } };
    const before = pageWith([list]);
    const after = clone(before);
    (props0(after).items as Array<{ text: string }>)[0].text = 'One thing';
    expect(changeScope(before, after).structure).toBe(false);
  });

  it('editing the words on a card is content', () => {
    const cards = {
      id: 'c',
      type: 'cards',
      props: {
        source: 'typed',
        columns: '3',
        items: [
          { src: '', alt: '', label: 'Greece', title: 'Islands', body: 'Seven nights.', linkLabel: 'See', linkHref: '' },
        ],
      },
    };
    const before = pageWith([cards]);
    const after = clone(before);
    (props0(after).items as Array<{ title: string }>)[0].title = 'The islands';
    expect(changeScope(before, after).structure).toBe(false);
  });
});

describe('changeScope: structural edits', () => {
  it('adding a section is structure', () => {
    const before = pageWith([heading('h1', 'Hello')]);
    const after = clone(before);
    after.sections.push(clone(after.sections[0]));
    after.sections[1].id = 'sec-2';
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('removing a block is structure', () => {
    const before = pageWith([heading('h1', 'Hello'), button('btn')]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks.pop();
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('reordering blocks is structure', () => {
    const before = pageWith([heading('h1', 'Hello'), button('btn')]);
    const after = clone(before);
    const blocks = after.sections[0].rows[0].columns[0].blocks;
    blocks.reverse();
    expect(changeScope(before, after).structure).toBe(true);
  });

  it("changing a section's tone is structure", () => {
    const before = pageWith([heading('h1', 'Hello')]);
    const after = clone(before);
    after.sections[0].tone = 'dark';
    expect(changeScope(before, after).structure).toBe(true);
  });

  it("changing a block's box is structure", () => {
    const before = pageWith([heading('h1', 'Hello')]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].box = {
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
      radius: 0,
      borderWidth: 0,
      shadow: 'none',
      blur: 0,
    };
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('changing a design field (a heading level) is structure', () => {
    const before = pageWith([heading('h1', 'Hello')]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].props.level = 'h4';
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('changing an image radius is structure', () => {
    const before = pageWith([image('img')]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].props.radius = 'full';
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('changing a button variant is structure', () => {
    const before = pageWith([button('btn')]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].props.variant = 'ghost';
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('adding a list item is structure', () => {
    const list = { id: 'l', type: 'list', props: { style: 'bullet', items: [{ text: 'One' }] } };
    const before = pageWith([list]);
    const after = clone(before);
    (props0(after).items as Array<{ text: string }>).push({ text: 'Two' });
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('hiding a block on phones is structure', () => {
    const before = pageWith([heading('h1', 'Hello')]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].hideOn = ['phone'];
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('a per-screen override is structure', () => {
    const before = pageWith([heading('h1', 'Hello')]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].responsive = { phone: { align: 'centre' } };
    expect(changeScope(before, after).structure).toBe(true);
  });
});

describe('changeScope: SEO', () => {
  it('a search-description change is SEO, not structure', () => {
    const before = pageWith([heading('h1', 'Hello')]);
    const after = clone(before);
    after.seo = { ...after.seo, description: 'A warm welcome to our agency.' };
    expect(changeScope(before, after)).toEqual({ structure: false, seo: true });
  });
});

describe('regionChangeScope: a header or footer', () => {
  function regionWith(blocks: unknown[], extra: Record<string, unknown> = {}): Region {
    const parsed = parseRegion(
      {
        version: 1,
        sections: [
          { id: 'hs-1', tone: 'light', rows: [{ id: 'hr-1', columns: [{ id: 'hc-1', width: 100, blocks }] }] },
        ],
        ...extra,
      },
      'header',
    );
    if (!parsed.ok) throw new Error(`region fixture will not parse: ${parsed.errors.join('; ')}`);
    return sanitiseRegion(parsed.region);
  }

  it('editing a header link label is content, not structure', () => {
    const nav = { id: 'n', type: 'nav', props: { layout: 'row', items: [{ label: 'About', href: '/about' }] } };
    const before = regionWith([nav]);
    const after = clone(before);
    (after.sections[0].rows[0].columns[0].blocks[0].props.items as Array<{ label: string }>)[0].label = 'About us';
    expect(regionChangeScope(before, after).structure).toBe(false);
  });

  it('making the header sticky is structure', () => {
    const before = regionWith([]);
    const after = clone(before);
    after.sticky = true;
    expect(regionChangeScope(before, after).structure).toBe(true);
  });

  it('adding a section to the header is structure', () => {
    const before = regionWith([{ id: 'n', type: 'nav', props: { items: [] } }]);
    const after = clone(before);
    after.sections.push(clone(after.sections[0]));
    after.sections[1].id = 'hs-2';
    expect(regionChangeScope(before, after).structure).toBe(true);
  });
});

describe('changeScope: container', () => {
  const container = () => ({
    id: 'ctr',
    type: 'container',
    props: {
      gap: 16,
      stack: 'mobile',
      columns: [
        { id: 'ic-1', width: 50, blocks: [heading('ih', 'Inner')] },
        { id: 'ic-2', width: 50, blocks: [button('ib')] },
      ],
    },
  });

  it('editing text inside a container is content', () => {
    const before = pageWith([container()]);
    const after = clone(before);
    (props0(after).columns as Array<{ blocks: Array<{ props: Record<string, unknown> }> }>)[0].blocks[0].props.html =
      'Inner edited';
    expect(changeScope(before, after).structure).toBe(false);
  });

  it("changing the container's gap is structure", () => {
    const before = pageWith([container()]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].props.gap = 40;
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('adding an inner column is structure', () => {
    const before = pageWith([container()]);
    const after = clone(before);
    (props0(after).columns as unknown[]).push({ id: 'ic-3', width: 33, blocks: [] });
    expect(changeScope(before, after).structure).toBe(true);
  });
});

describe('changeScope: imported and staff-only', () => {
  const imported = () => ({
    id: 'imp',
    type: 'imported',
    props: {
      html: '<div data-slot="a">Hi</div>',
      css: '.x { color: red }',
      label: 'Hero',
      fields: [{ key: 'a', kind: 'text', label: 'A' }],
      content: { a: 'Hi' },
    },
  });

  it('editing an imported slot is content', () => {
    const before = pageWith([imported()]);
    const after = clone(before);
    (props0(after).content as Record<string, string>).a = 'Hello';
    expect(changeScope(before, after).structure).toBe(false);
  });

  it("editing an imported design's frozen html is structure", () => {
    const before = pageWith([imported()]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].props.html = '<div data-slot="a">Hacked</div>';
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('editing a staff-only embed block is structure', () => {
    const embed = { id: 'emb', type: 'embed', props: { html: '<b>old</b>' } };
    const before = pageWith([embed]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].props.html = '<b>new</b>';
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('any change to an unknown block type is structure', () => {
    const unknown = { id: 'u', type: 'from-the-future', props: { words: 'hello' } };
    const before = pageWith([unknown]);
    const after = clone(before);
    after.sections[0].rows[0].columns[0].blocks[0].props.words = 'goodbye';
    expect(changeScope(before, after).structure).toBe(true);
  });
});
