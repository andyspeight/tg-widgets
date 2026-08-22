/**
 * THE TWO STICKY-STACKS, compared 21 Aug 2026 because the merge commit flagged
 * that both existed. They stay separate on purpose: the S3 section recipe turns
 * an ordinary Cards grid into a deck as a motion setting, and the Stacked cards
 * element is a designed two-pane deck a client fills in. Different markup,
 * different owners, same physics.
 *
 * THE COMPARISON FOUND A BUG IN EACH, which is the whole argument for having
 * looked: each implementation had a fix the other lacked.
 *
 *   - S3 had NO RUNWAY, and without one it did not degrade, it did nothing:
 *     measured in Chromium, card three stopped 156px short of its stop and card
 *     four 303px, so the section drew a plain one-column list and no deck ever
 *     collected. A tier 0 "proven" recipe whose stated job is to replace the
 *     three-equal-cards row was quietly drawing exactly a list of equal cards.
 *   - The element ignored prefers-reduced-motion, which S3 has always honoured.
 *
 * This file holds the four halves so neither regresses to its 21 Aug state.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

/* The rules for each, sliced so an assertion cannot pass off the other's CSS. */
const s3 = css.slice(css.indexOf(".tgs-section[data-motion='S3']"), css.indexOf('S5 scrub-scale'));
const el = css.slice(css.indexOf('.tgs-stack {'), css.indexOf('Shifting images'));

describe('the S3 section recipe', () => {
  it('sticks its cards', () => {
    expect(s3).toContain('position: sticky;');
  });

  /*
   * A sticky card only travels while there is page left below it, and the last
   * card has nothing after it. The markup here is an ordinary Cards block, so
   * the runway cannot be an element; ::after on the grid is one.
   */
  it('has a runway, without which it draws a plain list and no deck at all', () => {
    expect(s3).toContain(".tgs-cards::after");
    const after = s3.slice(s3.indexOf('.tgs-cards::after'));
    expect(after.slice(0, after.indexOf('}'))).toContain('height: 70vh;');
  });

  it('stands down under reduced motion, as it always has', () => {
    // The whole recipe, runway included, sits inside no-preference.
    const before = css.slice(0, css.indexOf(".tgs-section[data-motion='S3'] .tgs-cards"));
    const media = before.lastIndexOf('@media (prefers-reduced-motion: no-preference)');
    expect(media).toBeGreaterThan(-1);
    // And nothing between that media query and the rules re-opens it.
    expect(before.slice(media)).not.toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('the Stacked cards element', () => {
  it('sticks its cards', () => {
    expect(el).toContain('position: sticky;');
  });

  it('has its runway element', () => {
    expect(el).toContain('.tgs-stack__runway');
  });

  /*
   * THE FIX THE COMPARISON GAVE THIS SIDE. Cards sliding over one another as
   * the page moves is what the preference is for, even though sticky never runs
   * a frame of its own. Expressed as an override rather than by wrapping the
   * live rules, so nothing changes for anybody who did not ask.
   */
  it('stands down under reduced motion, like the recipe always did', () => {
    const reduce = el.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(reduce).toBeGreaterThan(-1);
    const rules = el.slice(reduce);
    expect(rules).toContain('.tgs-stack__card { position: static; }');
    // The runway goes too, or the section ends with a screen of nothing.
    expect(rules).toContain('.tgs-stack__runway { display: none; }');
  });
});

describe('they stay two implementations, knowingly', () => {
  it('each comment points at the other, so a fix to one prompts a look at both', () => {
    expect(css).toContain('If you fix one, look at\n * the other.');
    expect(css).toContain('if you fix one, look at the other.');
  });

  it('phone layout puts the picture first for BOTH sides, so the body row grows', () => {
    // The 12rem-then-auto rows assume the picture occupies the first row. For
    // the default side (right) the body is first in markup, and without an
    // explicit order it was clipped inside the 12rem picture row while the
    // picture collapsed to nothing (Coastwise home deck, 21 Aug 2026).
    const phone = el.slice(el.indexOf('@container tgs-page (max-width: 767px)'));
    expect(phone).toContain(".tgs-stack__card .tgs-stack__pic { order: -1; }");
    expect(phone).not.toContain("[data-side='left'] .tgs-stack__pic { order: 0; }");
  });
});
