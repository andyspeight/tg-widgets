/**
 * Before and after.
 *
 * The reveal is pure CSS and settled by the browser, so the DOM behaviour (two
 * pictures, a resizable box at the start position, the before sized to the whole
 * frame) is proven in the standalone harness. What a unit test pins is the
 * registry: that the block exists, sits in Media, and seeds the labels and a
 * halfway start a client expects to find when they add it.
 */

import { describe, expect, it } from 'vitest';

import { blockDefinition, blocksByGroup, isKnownBlock } from '../lib/content/blocks';

describe('before and after is a registered block', () => {
  it('is known, sits in Media, and has its icon', () => {
    expect(isKnownBlock('before-after')).toBe(true);
    const def = blockDefinition('before-after');
    expect(def?.group).toBe('Media');
    expect(def?.label).toBe('Before & After');
    expect(def?.icon).toBe('compare');
  });

  it('appears in the picker, in the Media group', () => {
    const media = blocksByGroup(true).find((group) => group.group === 'Media');
    expect(media?.blocks.some((block) => block.type === 'before-after')).toBe(true);
  });

  it('seeds the two badges and a halfway start', () => {
    const def = blockDefinition('before-after');
    expect(def?.defaults.beforeLabel).toBe('Before');
    expect(def?.defaults.afterLabel).toBe('After');
    expect(def?.defaults.start).toBe(50);
    expect(def?.defaults.ratio).toBe('16/9');
  });

  it('offers a before image, an after image, and does not offer the auto shape', () => {
    const def = blockDefinition('before-after');
    const keys = (def?.fields ?? []).map((field) => field.key);
    expect(keys).toContain('before');
    expect(keys).toContain('after');
    const shape = def?.fields.find((field) => field.key === 'ratio');
    // A comparison needs a fixed shape so the two pictures line up: no 'Original'.
    const values = shape && shape.kind === 'select' ? shape.options.map((option) => option.value) : [];
    expect(values).not.toContain('auto');
  });
});
