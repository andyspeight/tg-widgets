/**
 * Which blocks are typed into on the canvas.
 *
 * The contentEditable interaction itself is exercised only in the browser harness
 * (tools/verify-standalone.mjs), because it needs a real caret and a real
 * selection. What a plain-Node test CAN hold honest is the map that decides which
 * blocks are editable and how, and that each editable block's render marks its
 * host with the field the map names. Those two drifting apart is how an edit ends
 * up committed to the wrong prop.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { inlineEditableField } from '../lib/editor/inline-edit';

describe('which blocks are inline-editable', () => {
  it('makes a paragraph and a heading rich html fields', () => {
    expect(inlineEditableField('text')).toEqual({ field: 'html', rich: true, oneLine: false });
    expect(inlineEditableField('heading')).toEqual({ field: 'html', rich: true, oneLine: true });
  });

  it('makes a quote a plain text field, so it gets no formatting toolbar', () => {
    expect(inlineEditableField('quote')).toEqual({ field: 'text', rich: false, oneLine: false });
  });

  it('leaves every other block to the properties pane', () => {
    for (const type of ['image', 'list', 'icon-item', 'cards', 'button', 'table', 'map']) {
      expect(inlineEditableField(type)).toBeNull();
    }
  });
});

describe('the block render agrees with the inline-edit map', () => {
  const blocks = readFileSync(
    join(__dirname, '..', 'components', 'render', 'blocks.tsx'),
    'utf8',
  );

  it('marks the quote host with the field the map declares, as plain', () => {
    const field = inlineEditableField('quote');
    expect(field?.field).toBe('text');
    expect(field?.rich).toBe(false);
    // The QuoteBlock editing shell must carry the same field and be marked plain,
    // or Canvas would commit the quote's words to the wrong prop, or as markup.
    expect(blocks).toContain('data-rt-field="text"');
    expect(blocks).toContain('data-rt-plain=""');
  });
});
