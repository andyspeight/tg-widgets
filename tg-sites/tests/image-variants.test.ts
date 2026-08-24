/**
 * Which smaller copies of a picture are worth storing.
 *
 * The encoding needs a canvas and a real browser, so it is not tested here. The
 * DECISION needs neither, and the decision is where the mistakes are: a rule
 * that quietly upscales, or one that spends an object to save four kilobytes.
 *
 * Why this matters at all, measured on 23 Aug 2026 with npm run perf: a hero
 * image was 450 KB of a 482 KB page, and LCP landed at 2676 ms on slow 4G with
 * no server time in the measurement at all.
 */

import { describe, expect, it } from 'vitest';

import { MAX_IMAGE_EDGE } from '../lib/media/limits';
import { VARIANT_WIDTHS, variantWidthsFor } from '../lib/media/downscale';

describe('variantWidthsFor', () => {
  it('offers the full ladder for a big landscape photograph', () => {
    expect(variantWidthsFor(4000, 3000)).toEqual([400, 800, 1600]);
  });

  it('measures against the primary, not the original, for a tall portrait', () => {
    /*
     * The trap this exists for. A 3000x4000 portrait is capped by its 4000px
     * HEIGHT, so the stored primary is 1800 wide. Checking 1600 against the
     * original's 3000 would keep it, and it would be a 1600px copy of an 1800px
     * picture: a whole extra object to save a rounding error.
     */
    expect(variantWidthsFor(3000, 4000)).toEqual([400, 800]);
  });

  it('never offers a width at or above the picture it came from', () => {
    for (const [w, h] of [[900, 600], [450, 300], [380, 380], [1200, 800]] as const) {
      const primary = Math.round(w * (Math.max(w, h) > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / Math.max(w, h) : 1));
      for (const width of variantWidthsFor(w, h)) expect(width).toBeLessThan(primary);
    }
  });

  it('offers nothing for a picture already smaller than the smallest width', () => {
    expect(variantWidthsFor(450, 300)).toEqual([]);
    expect(variantWidthsFor(200, 200)).toEqual([]);
  });

  it('returns widths in ascending order, so an srcset can be built by walking it', () => {
    const widths = variantWidthsFor(4000, 3000);
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
  });

  it('survives nonsense rather than throwing, because an upload must not fail here', () => {
    expect(variantWidthsFor(0, 0)).toEqual([]);
    expect(variantWidthsFor(-1, 100)).toEqual([]);
    expect(variantWidthsFor(Number.NaN, 100)).toEqual([]);
    expect(variantWidthsFor(Number.POSITIVE_INFINITY, 100)).toEqual([]);
  });

  it('keeps the ladder ascending and below the cap, so the rules above stay meaningful', () => {
    expect([...VARIANT_WIDTHS].sort((a, b) => a - b)).toEqual([...VARIANT_WIDTHS]);
    for (const w of VARIANT_WIDTHS) expect(w).toBeLessThan(MAX_IMAGE_EDGE);
  });
});
