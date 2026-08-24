/**
 * Describing the pictures nobody described (#239, second half).
 *
 * The rule that matters most is that this finds the SAME set the audit reports.
 * If the two walks disagree, a client is told a picture has no description and
 * the fill never reaches it, which is worse than either alone.
 */

import { describe, expect, it } from 'vitest';

import { applyAlts, imagesNeedingAlt, MAX_ALT } from '../lib/seo/alt-fill';
import { pageStats } from '../lib/seo/audit';
import { createBlock, createPage, createRow } from '../lib/content/factory';
import { addBlock, addRow, updateBlockPropsAtPath } from '../lib/content/tree';
import type { Page } from '../lib/content/schema';

const path = { kind: 'block' as const, section: 0, row: 0, column: 0, block: 0 };

function pageWith(props: Record<string, unknown>, type = 'image'): Page {
  let page = createPage();
  page = addBlock(page, 0, 0, 0, createBlock(type));
  return updateBlockPropsAtPath(page, path, props);
}

describe('finding the pictures with no description', () => {
  it('finds one on an ordinary block', () => {
    expect(imagesNeedingAlt(pageWith({ src: 'https://x.test/a.jpg', alt: '' })))
      .toEqual(['https://x.test/a.jpg']);
  });

  it('leaves alone one that already has a description', () => {
    expect(imagesNeedingAlt(pageWith({ src: 'https://x.test/a.jpg', alt: 'A quiet cove' })))
      .toEqual([]);
  });

  it('counts whitespace as no description, because a space is not one', () => {
    expect(imagesNeedingAlt(pageWith({ src: 'https://x.test/a.jpg', alt: '  ' })))
      .toEqual(['https://x.test/a.jpg']);
  });

  it('finds them inside a repeater, where most pictures on a page actually are', () => {
    // A gallery, a card row, a slider's slides and the logo strip all carry
    // their pictures as rows rather than as top-level props.
    const page = pageWith({
      items: [
        { src: 'https://x.test/one.jpg', alt: '' },
        { src: 'https://x.test/two.jpg', alt: 'Already described' },
        { src: 'https://x.test/three.jpg' },
      ],
    }, 'gallery');

    expect(imagesNeedingAlt(page).sort())
      .toEqual(['https://x.test/one.jpg', 'https://x.test/three.jpg']);
  });

  it('DEDUPES by address, so one picture used twice is one thing to describe', () => {
    const page = pageWith({
      src: 'https://x.test/a.jpg',
      alt: '',
      items: [{ src: 'https://x.test/a.jpg', alt: '' }],
    });
    expect(imagesNeedingAlt(page)).toEqual(['https://x.test/a.jpg']);
  });

  it('finds them inside an inner container', () => {
    const page = pageWith({
      columns: [{ blocks: [{ id: 'b', type: 'image', props: { src: 'https://x.test/in.jpg', alt: '' } }] }],
    }, 'container');
    expect(imagesNeedingAlt(page)).toEqual(['https://x.test/in.jpg']);
  });

  it('finds nothing on a page with no pictures', () => {
    expect(imagesNeedingAlt(createPage())).toEqual([]);
  });
});

describe('it agrees with the audit about what a picture is', () => {
  /*
   * THE PROPERTY THAT MATTERS MOST. The audit tells a client "three pictures
   * have no description". If this walk found two, one would be reported for ever
   * and never fixed, and the client would have no way to tell why.
   */
  it('finds exactly as many as the audit reports missing', () => {
    let page = createPage();
    page = addRow(page, 0, createRow('1-1'));
    page = addBlock(page, 0, 1, 0, createBlock('image'));
    page = updateBlockPropsAtPath(
      page,
      { kind: 'block', section: 0, row: 1, column: 0, block: 0 },
      { src: 'https://x.test/hero.jpg', alt: '' },
    );
    page = addBlock(page, 0, 1, 1, createBlock('gallery'));
    page = updateBlockPropsAtPath(
      page,
      { kind: 'block', section: 0, row: 1, column: 1, block: 0 },
      {
        items: [
          { src: 'https://x.test/one.jpg', alt: '' },
          { src: 'https://x.test/two.jpg', alt: 'Described' },
          { src: 'https://x.test/three.jpg', alt: '' },
        ],
      },
    );

    expect(imagesNeedingAlt(page)).toHaveLength(pageStats(page).imagesWithoutAlt);
  });
});

describe('writing the descriptions back', () => {
  it('fills every place a picture is used, from one answer', () => {
    const page = pageWith({
      src: 'https://x.test/a.jpg',
      alt: '',
      items: [{ src: 'https://x.test/a.jpg', alt: '' }],
    });
    const { page: next, filled } = applyAlts(page, new Map([['https://x.test/a.jpg', 'A quiet cove']]));

    const props = next.sections[0].rows[0].columns[0].blocks[0].props as Record<string, unknown>;
    expect(props.alt).toBe('A quiet cove');
    expect((props.items as Array<Record<string, unknown>>)[0].alt).toBe('A quiet cove');
    expect(filled).toBe(2);
  });

  it('never overwrites a description somebody wrote for this use', () => {
    const page = pageWith({ src: 'https://x.test/a.jpg', alt: 'What the client wrote' });
    const { page: next, filled } = applyAlts(page, new Map([['https://x.test/a.jpg', 'What we would write']]));

    expect((next.sections[0].rows[0].columns[0].blocks[0].props as Record<string, unknown>).alt)
      .toBe('What the client wrote');
    expect(filled).toBe(0);
  });

  it('hands back the very same page when nothing matched', () => {
    const page = pageWith({ src: 'https://x.test/a.jpg', alt: '' });
    expect(applyAlts(page, new Map()).page).toBe(page);
    expect(applyAlts(page, new Map([['https://x.test/other.jpg', 'x']])).page).toBe(page);
  });

  it('holds a description to the bank’s own cap', () => {
    const page = pageWith({ src: 'https://x.test/a.jpg', alt: '' });
    const long = 'a quiet cove with turquoise water '.repeat(20);
    const { page: next } = applyAlts(page, new Map([['https://x.test/a.jpg', long]]));

    const alt = (next.sections[0].rows[0].columns[0].blocks[0].props as Record<string, unknown>).alt as string;
    expect(alt.length).toBeLessThanOrEqual(MAX_ALT);
  });

  it('reaches inside an inner container', () => {
    const page = pageWith({
      columns: [{ blocks: [{ id: 'b', type: 'image', props: { src: 'https://x.test/in.jpg', alt: '' } }] }],
    }, 'container');
    const { page: next, filled } = applyAlts(page, new Map([['https://x.test/in.jpg', 'A harbour wall']]));

    const cols = (next.sections[0].rows[0].columns[0].blocks[0].props as Record<string, unknown>).columns as Array<{ blocks: Array<{ props: Record<string, unknown> }> }>;
    expect(cols[0].blocks[0].props.alt).toBe('A harbour wall');
    expect(filled).toBe(1);
  });
});
