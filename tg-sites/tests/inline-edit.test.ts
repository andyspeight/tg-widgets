/**
 * Which blocks are typed into on the canvas, and in which fields.
 *
 * The contentEditable interaction itself is exercised only in the browser harness
 * (tools/verify-standalone.mjs), because it needs a real caret and a real
 * selection. What a plain-Node test CAN hold honest is the map that decides which
 * blocks are editable and how, and that each editable block's render marks its
 * host(s) with the field(s) the map names. Those two drifting apart is how an
 * edit ends up committed to the wrong prop.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { inlineEditableFields, richInlineField } from '../lib/editor/inline-edit';

describe('which blocks are inline-editable', () => {
  it('makes a paragraph and a heading single rich html fields', () => {
    expect(inlineEditableFields('text')).toEqual([{ field: 'html', rich: true, oneLine: false }]);
    expect(inlineEditableFields('heading')).toEqual([{ field: 'html', rich: true, oneLine: true }]);
  });

  it('makes a quote a single plain text field, so it gets no formatting toolbar', () => {
    expect(inlineEditableFields('quote')).toEqual([{ field: 'text', rich: false, oneLine: false }]);
  });

  it('makes an icon item two plain fields, its title and its body', () => {
    expect(inlineEditableFields('icon-item')).toEqual([
      { field: 'title', rich: false, oneLine: true },
      { field: 'body', rich: false, oneLine: true },
    ]);
  });

  it('makes a list one plain oneLine field, its items, so it gets no toolbar', () => {
    // One nominal entry, because a list has a variable number of items: the shell
    // reads its length to know the block is editable and its plainness to raise no
    // toolbar. The per-item target lives on the hosts the render draws, not here.
    expect(inlineEditableFields('list')).toEqual([
      { field: 'items', rich: false, oneLine: true },
    ]);
  });

  it('leaves every other block to the properties pane', () => {
    for (const type of ['image', 'cards', 'button', 'table', 'map']) {
      expect(inlineEditableFields(type)).toEqual([]);
    }
  });
});

describe('the toolbar keys on the one rich field a block has', () => {
  it('is the paragraph and the heading, their sole field', () => {
    expect(richInlineField('text')).toEqual({ field: 'html', rich: true, oneLine: false });
    expect(richInlineField('heading')).toEqual({ field: 'html', rich: true, oneLine: true });
  });

  it('is nothing for a plain block, single or multi field', () => {
    // A quote is one plain field, an icon item is two: neither raises the toolbar,
    // because a rich field is only ever a block's sole field.
    expect(richInlineField('quote')).toBeNull();
    expect(richInlineField('icon-item')).toBeNull();
    expect(richInlineField('list')).toBeNull();
    expect(richInlineField('image')).toBeNull();
  });
});

describe('the block render agrees with the inline-edit map', () => {
  const blocks = readFileSync(
    join(__dirname, '..', 'components', 'render', 'blocks.tsx'),
    'utf8',
  );

  it('marks the quote host with the field the map declares, as plain', () => {
    const [field] = inlineEditableFields('quote');
    expect(field.field).toBe('text');
    expect(field.rich).toBe(false);
    // The QuoteBlock editing shell must carry the same field and be marked plain,
    // or Canvas would commit the quote's words to the wrong prop, or as markup.
    expect(blocks).toContain('data-rt-field="text"');
    expect(blocks).toContain('data-rt-plain=""');
  });

  it('marks the icon item with both fields the map declares, each plain', () => {
    const fields = inlineEditableFields('icon-item').map((f) => f.field);
    expect(fields).toEqual(['title', 'body']);
    // Two hosts, one per field, both plain, or the title and body would land in
    // the wrong prop or arrive as markup.
    expect(blocks).toContain('data-rt-field="title"');
    expect(blocks).toContain('data-rt-field="body"');
  });

  it('marks each list item host with its own indexed field, as a plain one-liner', () => {
    // The list host names the item by index, items.N.text, so Canvas seeds and
    // commits each item on its own. Plain and oneLine, because a list item is a
    // single plain string. If this drifts, a keystroke lands on the wrong item or
    // is read as markup.
    expect(blocks).toContain('data-rt-field={`items.${index}.text`}');
    expect(blocks).toContain('data-rt-oneline=""');
  });
});
