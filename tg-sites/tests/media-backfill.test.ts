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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('leaves a picture that already has every useful size', () => {
    const done = item({
      width: 1400, height: 1050,
      variants: [
        { url: 'https://cdn.test/a-400.webp', width: 400, height: 300, bytes: 9_000 },
        { url: 'https://cdn.test/a-800.webp', width: 800, height: 600, bytes: 30_000 },
      ],
    });
    expect(skipReason(done)).toBe('already has every useful size');
  });

  it('picks up a picture that is missing a rung the ladder now offers', () => {
    /*
     * THE REAL CASE, from backfilling a client's bank on 25 Aug 2026. Their
     * photographs are 1920px wide and had been given 400 and 800 only, because
     * the rule deciding the ladder was expressed in width when the saving is
     * quadratic in width. A phone at 3x on a 390px viewport needs about 1170
     * device pixels, found nothing between 800 and the 1920 original, and took
     * the original. Treating "has some copies" as "is finished" would have left
     * every one of them that way permanently.
     */
    const partial = item({
      width: 1920, height: 1080,
      variants: [
        { url: 'https://cdn.test/a-400.webp', width: 400, height: 225, bytes: 9_000 },
        { url: 'https://cdn.test/a-800.webp', width: 800, height: 450, bytes: 30_000 },
      ],
    });
    expect(skipReason(partial)).toBeNull();
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

describe('deleting a picture takes its smaller copies with it', () => {
  /*
   * The row is the ONLY record of where the variants are, so the moment it is
   * deleted their addresses are unrecoverable and the objects sit in the store
   * forever, paid for and unreachable. A backfill makes three per picture, so
   * the leak would be three times the size of the thing leaking.
   */
  it('returns the variants from the delete, so the caller can remove them', async () => {
    const { deleteMedia } = await import('../lib/db/media');
    expect(typeof deleteMedia).toBe('function');

    const source = readFileSync(resolve(__dirname, '..', 'lib/db/media.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The column has to be in the RETURNING clause or there is nothing to remove.
    expect(code).toMatch(/delete from public\.media[\s\S]{0,80}returning storage_key, url, variants/);
  });

  it('the delete action removes every variant, not just the primary', () => {
    const source = readFileSync(resolve(__dirname, '..', 'app/actions/media.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const action = code.slice(code.indexOf('deleteMediaAction'));
    expect(action).toContain('removed.variants.map');
    expect(action).toContain('removeBlob(variant.url)');
  });
});
