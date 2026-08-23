/**
 * Where a drag in the outline pane lands.
 *
 * The pane used to reorder blocks only WITHIN one column, and sections among
 * themselves, on native HTML5 drag and drop. Task #137 moves it onto the same
 * dnd-kit system the canvas uses and lifts the same-column restriction. These
 * drive the resolver in Node; the browser check drives the pane itself.
 */

import { describe, expect, it } from 'vitest';

import { createBlock, createPage, createRow, createSection } from '../lib/content/factory';
import { addBlock, addRow } from '../lib/content/tree';
import { resolveOutlineMove, outlineMoveLabel } from '../components/editor/outline-move';
import type { Page } from '../lib/content/schema';

/** A page whose one section holds a two-column row, with named blocks in each. */
const ROW = 1;

function twoColumns(): Page {
  let page = createPage();
  page = addRow(page, 0, createRow('1-1'));
  page = addBlock(page, 0, ROW, 0, { ...createBlock('heading'), id: 'a' });
  page = addBlock(page, 0, ROW, 0, { ...createBlock('text'), id: 'b' });
  page = addBlock(page, 0, ROW, 1, { ...createBlock('image'), id: 'c' });
  return page;
}

function idsIn(page: Page, row: number, column: number): string[] {
  return page.sections[0].rows[row].columns[column].blocks.map((b) => b.id);
}

describe('a block moves within its column', () => {
  it('reorders, which is what the pane could already do', () => {
    const page = twoColumns();
    const row = ROW;
    const next = resolveOutlineMove(
      page,
      { kind: 'block', section: 0, row, column: 0, block: 1 },
      { kind: 'block', section: 0, row, column: 0, block: 0 },
    );
    expect(next).not.toBeNull();
    expect(idsIn(next!, row, 0)).toEqual(['b', 'a']);
  });
});

describe('a block moves ACROSS columns, which is the point of this slice', () => {
  it('leaves the column it came from and joins the one it landed on', () => {
    const page = twoColumns();
    const row = ROW;
    const next = resolveOutlineMove(
      page,
      { kind: 'block', section: 0, row, column: 0, block: 0 },
      { kind: 'block', section: 0, row, column: 1, block: 0 },
    );
    expect(next).not.toBeNull();
    expect(idsIn(next!, row, 0)).toEqual(['b']);
    expect(idsIn(next!, row, 1)).toEqual(['a', 'c']);
  });

  it('lands at the position it was dropped on rather than at the end', () => {
    let page = twoColumns();
    const row = ROW;
    page = addBlock(page, 0, row, 1, { ...createBlock('quote'), id: 'd' });
    const next = resolveOutlineMove(
      page,
      { kind: 'block', section: 0, row, column: 0, block: 0 },
      { kind: 'block', section: 0, row, column: 1, block: 1 },
    );
    expect(idsIn(next!, row, 1)).toEqual(['c', 'a', 'd']);
  });
});

describe('a section moves among sections', () => {
  it('reorders them', () => {
    let page = createPage();
    page = { ...page, sections: [...page.sections, { ...createSection('1'), id: 'second' }] };
    const next = resolveOutlineMove(page, { kind: 'section', section: 1 }, { kind: 'section', section: 0 });
    expect(next).not.toBeNull();
    expect(next!.sections[0].id).toBe('second');
  });
});

describe('a drag that changes nothing answers null', () => {
  /*
   * Null rather than the same page, so the caller skips the commit. An undo step
   * that undoes nothing is worse than no step, and dropping a thing back where it
   * started is the commonest way to make one.
   */
  it('for a block dropped on itself', () => {
    const page = twoColumns();
    const row = ROW;
    const at = { kind: 'block' as const, section: 0, row, column: 0, block: 0 };
    expect(resolveOutlineMove(page, at, at)).toBeNull();
  });

  it('for a section dropped on itself', () => {
    const page = createPage();
    expect(resolveOutlineMove(page, { kind: 'section', section: 0 }, { kind: 'section', section: 0 })).toBeNull();
  });

  it('and for a section dropped on a block, which the collision filter never offers', () => {
    const page = twoColumns();
    const row = ROW;
    expect(
      resolveOutlineMove(
        page,
        { kind: 'section', section: 0 },
        { kind: 'block', section: 0, row, column: 0, block: 0 },
      ),
    ).toBeNull();
  });
});

describe('the landing is described in words, for the announcement #138 will speak', () => {
  it('counts from one, because a client does not count from nought', () => {
    expect(outlineMoveLabel({ kind: 'section', section: 2 })).toBe('position 3');
    expect(outlineMoveLabel({ kind: 'block', section: 0, row: 1, column: 0, block: 2 })).toBe(
      'row 2, column 1, position 3',
    );
  });
});
