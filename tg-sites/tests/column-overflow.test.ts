/**
 * Content that sticks out of its own column.
 *
 * Bug #61 was raised on 31 Jul 2026 with a screenshot and parked: three
 * hypotheses were hand-tested in a browser and none reproduced. On 23 Aug it was
 * attacked differently — every block type in the registry, in all twelve section
 * layouts, at five widths, measured in a real browser for anything whose box
 * left its column. That is 60 combinations per block instead of three guesses,
 * and it found two genuine defects that hand-testing had missed.
 *
 * Neither is the image block, which measured clean everywhere, consistent with
 * the three failed hypotheses. Whether either is the one on Andy's screenshot is
 * still open: that needs his page.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

describe('key numbers stay inside their column', () => {
  /*
   * FIRST HALF. `repeat(4, 1fr)` reads as four equal quarters and is not: a 1fr
   * track's minimum is `auto`, so it will not shrink below its content. Four
   * large numbers in a narrow column pushed the whole list out of it — measured
   * 192px past a 255px column in a four-column section, 101px in a three, 41px
   * in a two. It scaled with the count, which is the signature.
   */
  it('lets its tracks shrink, and reflow when the column is narrow', () => {
    for (const n of ['2', '3', '4']) {
      const rule = css.slice(css.indexOf(`.tgs-stats[data-columns='${n}']`));
      expect(rule.slice(0, 120)).toContain('auto-fit');
      expect(rule.slice(0, 120)).toContain('minmax(min(100%,');
    }
    // The old form is what caused it, so it must not come back.
    expect(css).not.toContain(".tgs-stats[data-columns='4'] { grid-template-columns: repeat(4, 1fr); }");
  });

  /*
   * SECOND HALF, and the one that only appeared after the first was fixed: with
   * the tracks free to shrink the LIST fitted, and the number inside it did not.
   * "12,000+" at a flat 36px is about 205px of text in a 154px track, so the
   * little "+" was measured 51px outside the column with its own box entirely
   * inside it. A flat size in a track whose width depends on the section layout
   * cannot work.
   */
  it('caps the figure against its own track, not the page', () => {
    const m = css.slice(css.indexOf(".tgs-stats[data-size='m'] .tgs-stats__figure"));
    expect(m.slice(0, 120)).toContain('min(var(--tgs-h-l)');
    expect(m.slice(0, 120)).toContain('cqi');
    // cqi only answers to a container, so the item has to be one.
    expect(css).toContain('.tgs-stats__item { container-type: inline-size; }');
  });
});

describe('the laptop mockup stays inside its column', () => {
  /*
   * The base of a laptop is wider than its lid, and the drawing says so: 118%,
   * offset to sit under the screen. Nothing accounted for that extra 18%, so
   * wherever the lid filled its column the base hung 32px past it on each side
   * — in every layout, full width included. It was the only thing on the page
   * still leaving its column at 390px.
   */
  it('narrows the lid by exactly the base overhang', () => {
    expect(css).toContain('.tgs-screen__device { width: 84.7%;');
    // 84.7% x 118% is 100%: the proportions of the drawing are unchanged.
    expect(Math.round(84.7 * 1.18)).toBe(100);
  });

  it('leaves the phone alone, which has no base to make room for', () => {
    expect(css).toContain(".tgs-screen[data-device='phone'] .tgs-screen__device { width: 100%; }");
  });
});
