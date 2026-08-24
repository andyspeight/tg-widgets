/**
 * The Table block.
 *
 * WHAT IS WORTH TESTING. Two things, and they are the two things that make this
 * a block rather than something an agent builds out of columns:
 *
 *   1. THE PARSER. The whole grid is one box of text, so every edge case a
 *      spreadsheet paste can carry lands here: ragged rows, blank lines, mixed
 *      separators, a range dragged out far too big. It is a pure function and
 *      it is the only real logic in the block.
 *   2. THE `scope` ATTRIBUTES. They are the entire accessibility story. Without
 *      them a screen reader reads twenty-four numbers with nothing to attach
 *      them to, and nothing about the page looks wrong while it does.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, parseTable } from '../lib/content/table';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------

describe('the block', () => {
  const definition = blockDefinition('table')!;

  it('is in the library, under Layout, and belongs to the client', () => {
    expect(isKnownBlock('table')).toBe(true);
    expect(definition.group).toBe('Layout');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('table');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  /*
   * ONE BOX, NOT A REPEATER INSIDE A REPEATER. The nested version is the obvious
   * editor and it is miserable: adding a column means opening every row and
   * putting a cell in the right place from memory.
   */
  it('takes the whole grid in one box rather than a repeater of repeaters', () => {
    const data = definition.fields.find((field) => field.key === 'data');
    expect(data?.kind).toBe('textarea');
    expect(definition.fields.some((field) => field.kind === 'repeater')).toBe(false);
  });

  it('arrives with a real table in it', () => {
    const rows = parseTable(defaultPropsFor('table').data);
    expect(rows.length).toBeGreaterThan(2);
    expect(rows[0].length).toBeGreaterThan(2);
    // Tab separated, which is what a spreadsheet puts on the clipboard.
    expect(String(defaultPropsFor('table').data)).toContain('\t');
  });

  it('counts its rows in the outline', () => {
    expect(definition.summarise?.({ data: 'a\tb\nc\td' })).toBe('Table (2 rows)');
    expect(definition.summarise?.({ data: 'a\tb' })).toBe('Table (1 row)');
    expect(definition.summarise?.({})).toBe('Table (0 rows)');
  });
});

// ---------------------------------------------------------------------------

describe('parsing what somebody pasted', () => {
  it('splits rows on lines and cells on tabs', () => {
    expect(parseTable('a\tb\tc\nd\te\tf')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('takes a pipe too, for somebody typing one out', () => {
    expect(parseTable('a | b | c\nd | e | f')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  /*
   * PER LINE, NOT PER BLOCK. A table half pasted and half typed still comes out
   * rectangular, which is the only outcome that renders and reads correctly.
   */
  it('decides per line, so a mixed table still comes out square', () => {
    expect(parseTable('a\tb\tc\nd | e | f')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('survives the Windows line ending a paste often carries', () => {
    expect(parseTable('a\tb\r\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('drops blank lines rather than drawing empty rows', () => {
    expect(parseTable('a\tb\n\n\nc\td\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  /*
   * PADDED TO THE WIDEST ROW. A ragged table renders with holes and reads badly
   * to a screen reader, which counts columns to say where it is. Somebody who
   * left the end of a line empty meant an empty cell.
   */
  it('pads a short row rather than leaving the table ragged', () => {
    expect(parseTable('a\tb\tc\nd')).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
    ]);
  });

  it('keeps an empty cell in the middle', () => {
    expect(parseTable('a\t\tc')).toEqual([['a', '', 'c']]);
  });

  it('trims the spaces a typed table collects', () => {
    expect(parseTable('  a  |  b  ')).toEqual([['a', 'b']]);
  });

  /*
   * A RANGE DRAGGED OUT BY ACCIDENT CAN BE ENORMOUS, and ten thousand rows is
   * not a table anybody meant to publish. Capped rather than refused: what they
   * pasted still appears, just not all of it.
   */
  it('caps a paste that ran away', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `row ${i}\tvalue`).join('\n');
    expect(parseTable(huge)).toHaveLength(MAX_TABLE_ROWS);

    const wide = Array.from({ length: 60 }, (_, i) => `c${i}`).join('\t');
    expect(parseTable(wide)[0]).toHaveLength(MAX_TABLE_COLUMNS);
  });

  it('answers with nothing rather than throwing on rubbish', () => {
    expect(parseTable(undefined)).toEqual([]);
    expect(parseTable(42)).toEqual([]);
    expect(parseTable('')).toEqual([]);
    expect(parseTable('   \n  \n ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('what makes it readable to a screen reader', () => {
  const blocks = source('components', 'render', 'blocks.tsx');
  const render = /export function TableBlock\(([\s\S]*?)\n\/\/ ---/.exec(blocks)?.[1] ?? '';

  it('there is a TableBlock to read at all', () => {
    expect(render.length).toBeGreaterThan(400);
  });

  /*
   * THE WHOLE ACCESSIBILITY STORY IS TWO ATTRIBUTES. Remove them and the page
   * looks identical and a screen reader reads a list of numbers attached to
   * nothing.
   */
  it('says which cells are column headings and which are row headings', () => {
    expect(render).toContain('<th key={index} scope="col">');
    expect(render).toContain('<th key={cellIndex} scope="row">');
  });

  it('uses a real table rather than divs pretending to be one', () => {
    expect(render).toContain('<table className="tgs-table"');
    expect(render).toContain('<thead>');
    expect(render).toContain('<tbody>');
    expect(render).not.toContain('role="table"');
  });

  it('the caption names the region and shows below it, outside the scroll', () => {
    /*
     * It used to be a <caption> inside the table, which scrolled sideways
     * with the table on a phone and was cut mid-word at the viewport edge
     * (the 21 Aug review). Now the visible text is a <figcaption> after the
     * scroll region, and the region itself is named by aria-label, so a
     * screen reader still hears what the table is on the way in.
     */
    expect(render).toContain('<figcaption className="tgs-table__caption">');
    expect(render).not.toContain('<caption ');
    expect(render).toContain('aria-label={caption ||');
  });

  /*
   * A TABLE WIDER THAN A PHONE HAS TO SCROLL, and a rendered page must never
   * scroll sideways, so it scrolls inside its own box. Focusable for the same
   * reason the slider's rail is.
   */
  it('scrolls inside its own box, which a keyboard can reach', () => {
    expect(render).toContain('className="tgs-table__scroll"');
    expect(render).toContain('tabIndex={0}');
    expect(render).toContain('role="region"');
    // Named by the caption when there is one, so two tables on a page are told
    // apart rather than both announced as "Table".
    expect(render).toContain("aria-label={caption || 'Table. Scroll sideways to see all of it.'}");
  });

  it('and shows where the focus went', () => {
    const css = source('app', 'globals.css');
    expect(css).toContain('.tgs-table__scroll:focus-visible {');
    expect(css).toContain('overscroll-behavior-x: contain');
  });

  it('the table refuses to squash, which is what makes the scroll box work', () => {
    const rule = /\n\.tgs-table \{([^}]*)\}/.exec(source('app', 'globals.css'))?.[1] ?? '';
    expect(rule).toContain('min-width: max-content');
    expect(rule).toContain('width: 100%');
  });

  /*
   * THE BUG THE TABLE EXPOSED, WHICH WAS NOT THE TABLE'S.
   *
   * A row set to reverse when it stacks becomes a COLUMN flex container on a
   * phone, and the two vertical alignment declarations it already carried,
   * `align-items: start` on the row and `align-self: center` on a centred
   * column, then meant "do not stretch ACROSS". Every column sized itself to its
   * widest content instead of to the row.
   *
   * Invisible until a block had an intrinsic width bigger than the screen. An
   * eight-column table on a 390px preview made its column 464px wide, pushed the
   * section past the viewport, and stopped the table's own scroll box from ever
   * scrolling, because the box had been given all the room it asked for.
   *
   * It is not a table problem. Any wide thing does it, which is worth
   * remembering next to the open report about images rendering wider than their
   * column (task #61).
   */
  it('a reversed stacked row still holds its columns to its own width', () => {
    const css = source('app', 'globals.css');
    /*
     * EVERY phone block, not the first one. The stylesheet has more than one
     * @container rule at this width and the order is nobody's promise: the Grid
     * block added one above this on 20 Aug and the "first match" reading of this
     * test failed on a change that had nothing to do with rows. So find the
     * block that actually carries the rule, which is the thing being claimed.
     */
    const phone = [...css.matchAll(/@container tgs-page \(max-width: 767px\) \{([\s\S]*?)\n\}/g)]
      .map((m) => m[1])
      .find((body) => body.includes(".tgs-row[data-reverse='true'] {")) ?? '';

    expect(phone, 'no phone block sets the reversed row up as a flex column').not.toBe('');
    expect(phone).toContain('align-items: stretch;');
    // The row's own align-items is not enough: a centred column overrides it
    // with align-self, and that has to be answered too.
    expect(phone).toContain(".tgs-row[data-reverse='true'] > .tgs-col { align-self: stretch; }");
  });

  it('draws no table at all when there is nothing to draw', () => {
    expect(render).toContain('Paste a table, one row per line');
  });
});
