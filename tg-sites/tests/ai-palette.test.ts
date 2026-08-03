/**
 * The builder's palette stays true to the registry.
 *
 * The palette is what the AI is told it may build from, and it is generated from
 * the block registry precisely so the two cannot drift. These guard that: every
 * block offered is real, the ones a model cannot safely invent are withheld, and
 * the field descriptions carry the facts a model needs to fill them (a select's
 * choices, a repeater's item shape). If a block is added or a field renamed, the
 * palette moves with it or these fail.
 */

import { describe, expect, it } from 'vitest';

import { BLOCKS, isKnownBlock } from '../lib/content/blocks';
import { blockPalette, paletteText, BUILDER_EXCLUDES } from '../lib/ai/palette';

describe('the builder palette', () => {
  it('offers only real blocks', () => {
    for (const entry of blockPalette()) {
      expect(isKnownBlock(entry.type), entry.type).toBe(true);
    }
  });

  it('is exactly the registry minus the blocklist', () => {
    expect(blockPalette().length).toBe(BLOCKS.length - BUILDER_EXCLUDES.size);
  });

  it('withholds the blocks a sentence cannot fill', () => {
    const types = new Set(blockPalette().map((entry) => entry.type));
    for (const excluded of BUILDER_EXCLUDES) {
      expect(types.has(excluded), excluded).toBe(false);
    }
    // The ones that need markup, code, a widget id or a collection.
    expect(types.has('imported')).toBe(false);
    expect(types.has('embed')).toBe(false);
    expect(types.has('widget')).toBe(false);
  });

  it('offers the everyday composable blocks', () => {
    const types = new Set(blockPalette().map((entry) => entry.type));
    for (const wanted of ['heading', 'text', 'image', 'button-group', 'icon-item', 'stats', 'steps']) {
      expect(types.has(wanted), wanted).toBe(true);
    }
  });

  it('tells the model a select\'s real choices', () => {
    const heading = blockPalette().find((entry) => entry.type === 'heading');
    const level = heading?.fields.find((field) => field.key === 'level');
    // The choices come from the registry, so "h2" being offered means h2 is real.
    expect(level?.accepts).toContain('h2');
  });

  it('describes a repeater by its item fields, one level down', () => {
    const stats = blockPalette().find((entry) => entry.type === 'stats');
    const items = stats?.fields.find((field) => field.key === 'items');
    expect(items?.item?.some((sub) => sub.key === 'value')).toBe(true);
    expect(items?.item?.some((sub) => sub.key === 'label')).toBe(true);
  });
});

describe('the palette as prompt text', () => {
  const text = paletteText();

  it('lists a block with its purpose and fields', () => {
    expect(text).toMatch(/- heading \(Heading\): /);
    expect(text).toContain('level: one of: h2, h3, h4');
  });

  it('indents a repeater\'s item fields under it', () => {
    // stats -> items -> value/label, nested deeper than the block's own fields.
    expect(text).toMatch(/\n {4}items: a list[\s\S]*?\n {8}value: /);
  });

  it('never mentions a withheld block', () => {
    for (const excluded of BUILDER_EXCLUDES) {
      expect(text.includes(`- ${excluded} (`)).toBe(false);
    }
  });
});
