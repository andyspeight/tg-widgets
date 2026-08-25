/**
 * Deciding which pictures in a bank are worth re-encoding.
 *
 * Why this exists: variants are made in the browser at upload, so every picture
 * that predates the feature has none. Measured on the live database the day it
 * shipped: 30 images, 30 with no variants, across 19 published pages. The srcset
 * work was live and doing nothing at all for an existing site.
 *
 * The planning is pure and tested here. The encoding needs a canvas and belongs
 * to the picker, which does it the same way a real upload does.
 */

import { describe, expect, it } from 'vitest';

import { backfillPlan, describePlan, skipReason } from '../lib/media/backfill';
import type { MediaItem } from '../lib/media/types';

function item(partial: Partial<MediaItem>): MediaItem {
  return {
    id: 'm', url: 'https://cdn.test/a.webp', storageKey: 'k', filename: 'a.webp',
    mime: 'image/webp', bytes: 400_000, width: 2400, height: 1600, alt: '',
    source: 'upload', credit: {}, variants: [], createdAt: new Date('2026-08-01'),
    ...partial,
  };
}

describe('skipReason', () => {
  it('takes a big image that has no smaller copies', () => {
    expect(skipReason(item({}))).toBeNull();
  });

  it('leaves a document alone', () => {
    expect(skipReason(item({ mime: 'application/pdf' }))).toBe('not an image');
  });

  it('leaves a picture that already has copies alone', () => {
    const done = item({
      variants: [{ url: 'https://cdn.test/a-800.webp', width: 800, height: 533, bytes: 30_000 }],
    });
    expect(skipReason(done)).toBe('already has smaller copies');
  });

  it('cannot plan for a row with no stored dimensions', () => {
    /*
     * The ladder is decided from the picture's size, so guessing would either
     * skip one that would have benefited or make copies bigger than the original.
     */
    expect(skipReason(item({ width: null, height: null }))).toBe('no stored dimensions');
  });

  it('leaves a picture that is already small enough', () => {
    expect(skipReason(item({ width: 420, height: 280 }))).toBe('already small enough');
  });
});

describe('backfillPlan', () => {
  it('separates the work from the rest and counts the files it would create', () => {
    const plan = backfillPlan([
      item({ id: 'big', width: 4000, height: 3000 }),
      item({ id: 'doc', mime: 'application/pdf' }),
      item({ id: 'small', width: 300, height: 200 }),
      item({ id: 'mid', width: 1200, height: 800 }),
    ]);

    expect(plan.candidates.map((c) => c.id)).toEqual(['big', 'mid']);
    expect(plan.skipped.map((s) => s.why).sort()).toEqual(['already small enough', 'not an image']);
    // big gives 400/800/1600, mid gives 400/800.
    expect(plan.variantCount).toBe(5);
  });

  it('puts the biggest pictures first, so a run stopped half way did the part that mattered', () => {
    const plan = backfillPlan([
      item({ id: 'mid', width: 1200, height: 800 }),
      item({ id: 'huge', width: 4000, height: 3000 }),
      item({ id: 'large', width: 2400, height: 1600 }),
    ]);
    expect(plan.candidates.map((c) => c.id)).toEqual(['huge', 'large', 'mid']);
  });

  it('survives an empty bank', () => {
    const plan = backfillPlan([]);
    expect(plan).toEqual({ candidates: [], skipped: [], variantCount: 0 });
  });
});

describe('describePlan', () => {
  it('says both numbers, because they differ by about three', () => {
    const plan = backfillPlan([item({ id: 'a', width: 4000, height: 3000 })]);
    expect(describePlan(plan)).toBe(
      '1 picture can be made smaller for phones, which means making 3 smaller copies.',
    );
  });

  it('distinguishes an empty bank from a bank that needs nothing', () => {
    expect(describePlan(backfillPlan([]))).toContain('no pictures in this bank yet');
    expect(describePlan(backfillPlan([item({ width: 300, height: 200 })]))).toContain(
      'already as small as it needs to be',
    );
  });
});
