/**
 * The testimonial slider.
 *
 * The rail is pure CSS and the stars are drawn, so the DOM behaviour (a rail of
 * cards, five filled stars on a five-star review) is proven in the standalone
 * harness. What a unit test pins is the registry: the block exists, sits in
 * Media, and arrives with example reviews so it is never a blank rail.
 */

import { describe, expect, it } from 'vitest';

import { blockDefinition, blocksByGroup, isKnownBlock } from '../lib/content/blocks';

describe('the testimonial slider is a registered block', () => {
  it('is known, sits in Media, and has its icon', () => {
    expect(isKnownBlock('testimonials')).toBe(true);
    const def = blockDefinition('testimonials');
    expect(def?.group).toBe('Media');
    expect(def?.label).toBe('Testimonial slider');
    expect(def?.icon).toBe('testimonial');
  });

  it('appears in the picker, in the Media group', () => {
    const media = blocksByGroup(true).find((group) => group.group === 'Media');
    expect(media?.blocks.some((block) => block.type === 'testimonials')).toBe(true);
  });

  it('arrives with three example reviews, each a full five stars', () => {
    const def = blockDefinition('testimonials');
    const items = def?.defaults.items as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(items)).toBe(true);
    expect(items?.length).toBe(3);
    for (const item of items ?? []) {
      expect(typeof item.quote).toBe('string');
      expect(item.quote).toBeTruthy();
      expect(item.rating).toBe(5);
    }
  });

  it('offers a quote, a photo, and a rating pinned to five', () => {
    const def = blockDefinition('testimonials');
    const repeater = def?.fields.find((field) => field.key === 'items');
    const childKeys = repeater && repeater.kind === 'repeater' ? repeater.fields.map((field) => field.key) : [];
    expect(childKeys).toContain('quote');
    expect(childKeys).toContain('photo');
    expect(childKeys).toContain('rating');
    const rating = repeater && repeater.kind === 'repeater' ? repeater.fields.find((field) => field.key === 'rating') : undefined;
    if (rating && rating.kind === 'number') expect(rating.max).toBe(5);
  });
});
