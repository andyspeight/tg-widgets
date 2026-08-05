/**
 * The inner container: columns inside a column, one level deep.
 *
 * The content model is otherwise flat, so this is the one block whose content
 * is more content. These tests pin the parts a bug would be invisible in until
 * it was expensive: the path grammar a click and a drop both read, the deep
 * copy a duplicate depends on, the width repair and heading upgrade that run on
 * every read, and above all that a block dropped INTO a container is sanitised
 * the same as one in an ordinary column. That last is a security property: the
 * field-driven pass never looks inside props.columns, so if the container did
 * not descend, an inner text block would carry its markup straight past the
 * sanitiser.
 */

import { describe, expect, it } from 'vitest';

import { createBlock, createPage } from '../lib/content/factory';
import { blockDefinition, blocksByGroup, isKnownBlock } from '../lib/content/blocks';
import { EMPTY_BOX, parsePage, type Box } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';
import {
  addBlock,
  addInnerBlock,
  containerColumns,
  duplicateBlock,
  duplicateRow,
  parsePathKey,
  pathKey,
  removeInnerBlock,
  resolve,
  updateContainerColumns,
  updateInnerBlockBox,
  updateInnerBlockProps,
  type Path,
  type Reid,
} from '../lib/content/tree';

/** A deterministic id factory for the duplicate tests. */
function reider(): Reid {
  let n = 0;
  return (prefix) => `${prefix}_${n++}`;
}

/** A fresh page with a container at s0r0c0b0. */
function pageWithContainer() {
  let page = createPage();
  page = addBlock(page, 0, 0, 0, createBlock('container'));
  return page;
}

/** The container's inner columns, read back off the tree. */
function innerCols(page: ReturnType<typeof createPage>) {
  return containerColumns(page.sections[0].rows[0].columns[0].blocks[0]);
}

describe('the container is a registered block', () => {
  it('is known, sits in Layout, and is named for what Andy chose', () => {
    expect(isKnownBlock('container')).toBe(true);
    const def = blockDefinition('container');
    expect(def?.group).toBe('Layout');
    expect(def?.label).toBe('Inner container');
    expect(def?.icon).toBe('columns');
  });

  it('appears in the picker, in the Layout group', () => {
    const layout = blocksByGroup(true).find((group) => group.group === 'Layout');
    expect(layout?.blocks.some((block) => block.type === 'container')).toBe(true);
  });
});

describe('the factory seeds a container', () => {
  it('starts it with two equal empty columns', () => {
    const cols = containerColumns(createBlock('container'));
    expect(cols).toHaveLength(2);
    expect(cols[0].width).toBe(50);
    expect(cols[1].width).toBe(50);
    expect(cols[0].blocks).toEqual([]);
    expect(cols[1].blocks).toEqual([]);
  });

  it('mints fresh ids, so two containers never share a column id', () => {
    const a = containerColumns(createBlock('container'));
    const b = containerColumns(createBlock('container'));
    expect(a[0].id).not.toBe(a[1].id);
    expect(b[0].id).not.toBe(a[0].id);
    expect(b[1].id).not.toBe(a[1].id);
  });

  it('gives an ordinary block no columns', () => {
    expect(containerColumns(createBlock('text'))).toEqual([]);
  });
});

describe('the inner-tree helpers reach the right column and block', () => {
  it('adds a block at the end, and at an index, in one inner column only', () => {
    let page = pageWithContainer();
    page = addInnerBlock(page, 0, 0, 0, 0, 0, createBlock('text'));
    page = addInnerBlock(page, 0, 0, 0, 0, 0, createBlock('button'));
    expect(innerCols(page)[0].blocks.map((b) => b.type)).toEqual(['text', 'button']);

    page = addInnerBlock(page, 0, 0, 0, 0, 0, createBlock('image'), 0);
    expect(innerCols(page)[0].blocks.map((b) => b.type)).toEqual(['image', 'text', 'button']);
    // The other inner column is untouched.
    expect(innerCols(page)[1].blocks).toEqual([]);
  });

  it('adds into the second inner column without disturbing the first', () => {
    let page = pageWithContainer();
    page = addInnerBlock(page, 0, 0, 0, 0, 1, createBlock('quote'));
    expect(innerCols(page)[0].blocks).toEqual([]);
    expect(innerCols(page)[1].blocks.map((b) => b.type)).toEqual(['quote']);
  });

  it('patches an inner block’s props and box, then removes it', () => {
    let page = pageWithContainer();
    page = addInnerBlock(page, 0, 0, 0, 0, 0, createBlock('text'));
    page = addInnerBlock(page, 0, 0, 0, 0, 0, createBlock('button'));

    page = updateInnerBlockProps(page, 0, 0, 0, 0, 0, 0, { html: '<p>changed</p>' });
    expect(innerCols(page)[0].blocks[0].props.html).toBe('<p>changed</p>');

    const box: Box = { ...EMPTY_BOX, radius: 8 };
    page = updateInnerBlockBox(page, 0, 0, 0, 0, 0, 1, box);
    expect(innerCols(page)[0].blocks[1].box?.radius).toBe(8);

    page = removeInnerBlock(page, 0, 0, 0, 0, 0, 0);
    expect(innerCols(page)[0].blocks.map((b) => b.type)).toEqual(['button']);
  });

  it('replaces the whole set of columns', () => {
    let page = pageWithContainer();
    const [first] = innerCols(page);
    page = updateContainerColumns(page, 0, 0, 0, 0, [first]);
    expect(innerCols(page)).toHaveLength(1);
  });

  it('returns a new page and never mutates the old one', () => {
    const before = pageWithContainer();
    const after = addInnerBlock(before, 0, 0, 0, 0, 0, createBlock('text'));
    expect(after).not.toBe(before);
    expect(containerColumns(before.sections[0].rows[0].columns[0].blocks[0])[0].blocks).toEqual([]);
  });
});

describe('the address grammar covers the inner nodes', () => {
  it('round-trips an inner column and an inner block', () => {
    const col: Path = { kind: 'inner-column', section: 0, row: 0, column: 0, block: 0, inner: 1 };
    const blk: Path = { kind: 'inner-block', section: 1, row: 2, column: 3, block: 0, inner: 1, innerBlock: 4 };

    expect(pathKey(col)).toBe('s0r0c0b0k1');
    expect(pathKey(blk)).toBe('s1r2c3b0k1i4');
    expect(parsePathKey('s0r0c0b0k1')).toEqual(col);
    expect(parsePathKey('s1r2c3b0k1i4')).toEqual(blk);
  });
});

describe('resolve reaches an inner node, and reports a stale one', () => {
  it('resolves the inner column and the inner block, null past the end', () => {
    let page = pageWithContainer();
    page = addInnerBlock(page, 0, 0, 0, 0, 0, createBlock('text'));

    const colPath: Path = { kind: 'inner-column', section: 0, row: 0, column: 0, block: 0, inner: 0 };
    const blockPath: Path = { kind: 'inner-block', section: 0, row: 0, column: 0, block: 0, inner: 0, innerBlock: 0 };

    expect((resolve(page, colPath) as { blocks: unknown[] }).blocks).toHaveLength(1);
    expect((resolve(page, blockPath) as { type: string }).type).toBe('text');

    expect(
      resolve(page, { kind: 'inner-block', section: 0, row: 0, column: 0, block: 0, inner: 0, innerBlock: 9 }),
    ).toBeNull();
    expect(
      resolve(page, { kind: 'inner-column', section: 0, row: 0, column: 0, block: 7, inner: 0 }),
    ).toBeNull();
  });
});

describe('duplicating a container copies its inner tree deeply', () => {
  it('gives the copy fresh inner column and block ids, same content', () => {
    let page = pageWithContainer();
    page = addInnerBlock(page, 0, 0, 0, 0, 0, createBlock('text'));

    page = duplicateBlock(page, 0, 0, 0, 0, reider());
    const blocks = page.sections[0].rows[0].columns[0].blocks;
    expect(blocks).toHaveLength(2);

    const origin = containerColumns(blocks[0]);
    const copy = containerColumns(blocks[1]);

    expect(blocks[1].id).not.toBe(blocks[0].id);
    expect(copy[0].id).not.toBe(origin[0].id);
    expect(copy[1].id).not.toBe(origin[1].id);
    expect(copy[0].blocks[0].id).not.toBe(origin[0].blocks[0].id);
    // The words survive the copy even though the ids do not.
    expect(copy[0].blocks[0].type).toBe('text');
    // And the copy is a separate object, not the original shared.
    expect(copy[0].blocks[0]).not.toBe(origin[0].blocks[0]);
  });

  it('reids a container carried inside a duplicated row', () => {
    let page = pageWithContainer();
    page = addInnerBlock(page, 0, 0, 0, 0, 0, createBlock('text'));

    page = duplicateRow(page, 0, 0, reider());
    const rows = page.sections[0].rows;
    expect(rows).toHaveLength(2);

    const origin = containerColumns(rows[0].columns[0].blocks[0]);
    const copy = containerColumns(rows[1].columns[0].blocks[0]);
    expect(copy[0].id).not.toBe(origin[0].id);
    expect(copy[0].blocks[0].id).not.toBe(origin[0].blocks[0].id);
  });
});

describe('a stored container is repaired on the way in', () => {
  function rawWithInnerColumns(columns: unknown[]) {
    return {
      version: 1,
      id: 'p1',
      title: 'Test',
      slug: '',
      seo: { noindex: false },
      sections: [
        {
          id: 's1',
          tone: 'light',
          width: 'contained',
          paddingY: 48,
          minHeight: 0,
          overlay: 60,
          box: EMPTY_BOX,
          rows: [
            {
              id: 'r1',
              gap: 16,
              stackBelow: 'mobile',
              reverseOnStack: false,
              columns: [
                {
                  id: 'c1',
                  width: 100,
                  align: 'top',
                  flow: 'stacked',
                  box: EMPTY_BOX,
                  blocks: [{ id: 'b1', type: 'container', box: EMPTY_BOX, props: { columns } }],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  it('normalises inner column widths so they sum to 100', () => {
    const result = parsePage(
      rawWithInnerColumns([
        { id: 'k1', width: 70, align: 'top', flow: 'stacked', box: EMPTY_BOX, blocks: [] },
        { id: 'k2', width: 10, align: 'top', flow: 'stacked', box: EMPTY_BOX, blocks: [] },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cols = containerColumns(result.page.sections[0].rows[0].columns[0].blocks[0]);
    const sum = cols[0].width + cols[1].width;
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.01);
  });

  it('upgrades an inner heading from plain text to html', () => {
    const result = parsePage(
      rawWithInnerColumns([
        {
          id: 'k1',
          width: 100,
          align: 'top',
          flow: 'stacked',
          box: EMPTY_BOX,
          blocks: [{ id: 'ih1', type: 'heading', props: { text: 'Hello', level: 'h2', style: 'h3', align: 'left' } }],
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cols = containerColumns(result.page.sections[0].rows[0].columns[0].blocks[0]);
    expect(cols[0].blocks[0].props.html).toBe('Hello');
  });
});

describe('sanitising descends into a container (the security property)', () => {
  it('strips a script from a block dropped inside a container', () => {
    let page = pageWithContainer();
    const evil = {
      id: 'evil1',
      type: 'text',
      props: { html: '<p>keep me</p><script>alert(1)</script>' },
      box: EMPTY_BOX,
    };
    // Cast: this is exactly the shape addInnerBlock stores, minus the strict
    // Block type only because the test is handing it a hostile literal.
    page = addInnerBlock(page, 0, 0, 0, 0, 0, evil as never);

    const cleaned = sanitisePage(page);
    const html = containerColumns(cleaned.sections[0].rows[0].columns[0].blocks[0])[0].blocks[0].props
      .html as string;
    expect(html).toContain('keep me');
    expect(html).not.toContain('<script');
  });

  it('drops an unsafe colour off an inner column’s box', () => {
    let page = pageWithContainer();
    const cols = innerCols(page);
    const tampered = { ...cols[0], box: { ...cols[0].box, background: 'url(https://evil.example)' } };
    page = updateContainerColumns(page, 0, 0, 0, 0, [tampered, cols[1]]);

    const cleaned = sanitisePage(page);
    const box = containerColumns(cleaned.sections[0].rows[0].columns[0].blocks[0])[0].box;
    expect(box.background).toBeUndefined();
  });
});
