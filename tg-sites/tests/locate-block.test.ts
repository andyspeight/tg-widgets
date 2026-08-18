/**
 * locateBlockById, the reverse of blockAtPath, is what a pinned comment leans on:
 * the pin stores a block's stable id, and this finds where that block sits now so
 * the panel can label it and jump to it. Tested here on a hand-built page.
 */

import { describe, expect, it } from 'vitest';

import { locateBlockById } from '../lib/content/tree';
import type { Page } from '../lib/content/schema';

const page = {
  version: 1,
  id: 'p',
  slug: '',
  title: 'T',
  seo: { noindex: false },
  sections: [
    {
      id: 'sec-1',
      rows: [
        {
          id: 'row-1',
          columns: [
            {
              id: 'col-1',
              blocks: [
                { id: 'blk-A', type: 'heading', props: {} },
                { id: 'blk-B', type: 'image', props: {} },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'sec-2',
      rows: [{ id: 'row-2', columns: [{ id: 'col-2', blocks: [{ id: 'blk-C', type: 'text', props: {} }] }] }],
    },
  ],
} as unknown as Page;

describe('locateBlockById', () => {
  it('finds a top-level block by its id, in any section', () => {
    expect(locateBlockById(page, 'blk-A')).toEqual({ kind: 'block', section: 0, row: 0, column: 0, block: 0 });
    expect(locateBlockById(page, 'blk-B')).toEqual({ kind: 'block', section: 0, row: 0, column: 0, block: 1 });
    expect(locateBlockById(page, 'blk-C')).toEqual({ kind: 'block', section: 1, row: 0, column: 0, block: 0 });
  });

  it('returns null for an id no block carries, which is a deleted element', () => {
    expect(locateBlockById(page, 'gone')).toBeNull();
  });
});
