/**
 * Shifting images — three pictures that trade places.
 *
 * Andy, 21 Aug 2026, from Duda's Image Shifting: "three images that rotate to
 * promote the next one to the front, the images change size based on their
 * position in the rotation."
 *
 * THE SECOND HALF OF THAT SENTENCE IS THE DESIGN. The places carry the sizes,
 * not the pictures. A picture is large because of where it is standing, which is
 * what makes this read as three pictures moving rather than three pictures
 * resizing on the spot. Every assertion here protects some part of that.
 *
 * Measured in a browser: at rest the three sit at widths 619, 458 and 347 with
 * z-index 1, 2 and 3; a third of the way through the cycle each has taken the
 * next one's place exactly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
const block = (() => {
  const start = render.indexOf('export function ShiftingImagesBlock');
  return render.slice(start, render.indexOf('\nexport function ', start + 1));
})();
/** The component without its prose. This repo's rule; it has caught this suite twice. */
const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MAX = Number(/MAX_SHIFTING_IMAGES = (\d+)/.exec(render)?.[1]);

describe('the block', () => {
  it('is registered, in Showcase', () => {
    expect(isKnownBlock('shifting-images')).toBe(true);
    expect(blockDefinition('shifting-images')!.group).toBe('Showcase');
  });

  it('takes three pictures, because there are three places', () => {
    // A fourth would have nowhere to stand, and a fourth place makes the collage
    // a mess rather than a composition.
    expect(MAX).toBe(3);
    const items = blockDefinition('shifting-images')!.fields.find((f) => f.key === 'items') as
      { max: number };
    expect(items.max).toBe(MAX);
    expect((defaultPropsFor('shifting-images').items as unknown[]).length).toBe(3);
  });

  it('drops a picture that was never chosen rather than leaving a gap in the collage', () => {
    expect(code).toContain("picture.src !== ''");
  });
});

describe('the places carry the sizes', () => {
  it('has three places, each with its own position, scale and depth', () => {
    const frames = css.slice(css.indexOf('@keyframes tgs-shift-3'));
    const body = frames.slice(0, frames.indexOf('}\n\n'));
    expect(body).toContain('scale(1)');
    expect(body).toContain('scale(0.78)');
    expect(body).toContain('scale(0.58)');
    expect(body).toContain('z-index: 1');
    expect(body).toContain('z-index: 2');
    expect(body).toContain('z-index: 3');
  });

  it('gives every picture the same size in the markup', () => {
    /*
     * The whole point. If the sizes were per picture the rotation would be three
     * pictures resizing; because they are per place, a picture grows by moving.
     */
    const rule = css.slice(css.indexOf('.tgs-shift__pic {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toContain('width: 58%;');
    expect(code).not.toMatch(/width:\s*\$\{/);
  });

  it('holds each place, rather than drifting the whole way', () => {
    // A picture should be still while somebody reads it and move between places,
    // which is what the paired keyframe stops do.
    expect(css).toContain('0%,   28%');
    expect(css).toContain('33%,  61%');
    expect(css).toContain('66%,  94%');
  });
});

describe('the rotation', () => {
  it('offsets each picture by its share of the cycle', () => {
    expect(code).toContain("'--tgs-shift-cycle': `${count * interval}s`");
    expect(code).toContain('animationDelay');
  });

  /*
   * A NEGATIVE DELAY, and this is the one that would be "tidied" into a positive
   * one by somebody who had not seen it run. A positive delay leaves the second
   * and third pictures sitting in the first place until their turn comes round,
   * so the collage is wrong for the first few seconds of every page load.
   */
  it('starts each picture already in its own place', () => {
    expect(code).toContain('animationDelay: `calc(-1 * ${index} * var(--tgs-shift-cycle) / ${count})`');
  });

  it('has a second arrangement for two pictures', () => {
    // Two rotating through three places would leave a hole.
    expect(css).toContain(".tgs-shift[data-count='2'] .tgs-shift__pic { animation-name: tgs-shift-2; }");
    expect(css).toContain('@keyframes tgs-shift-2');
  });
});

describe('when it should not move', () => {
  it('is still and arranged on the editor canvas', () => {
    /*
     * Pictures sliding under the pointer fight the person trying to select one.
     * Still, but still a COLLAGE: each picture keeps the place its index gives
     * it, so a client sees the arrangement they are going to get rather than
     * three pictures piled on the origin.
     */
    expect(code).toContain("data-still={editing || count < 2 ? 'true' : undefined}");
    expect(css).toContain(".tgs-shift[data-still='true'] .tgs-shift__pic { animation: none; }");
    expect(css).toContain(".tgs-shift[data-still='true'] .tgs-shift__pic:nth-child(2)");
  });

  it('keeps the composition for anybody who asked for less motion', () => {
    // Only the trading stops. The arrangement is most of the design.
    const reduce = css.slice(css.indexOf('.tgs-shift__pic { animation: none; }\n  .tgs-shift .tgs-shift__pic:nth-child(1)'));
    expect(reduce.length).toBeGreaterThan(0);
    expect(reduce.slice(0, 400)).toContain('scale(0.58)');
  });
});

describe('it is not a slideshow, and borrows none of that machinery', () => {
  it('emits no slideshow wrapper', () => {
    // Every picture is on screen the whole time, so there is nothing to show and
    // hide, no current slide, and no pause button to argue about.
    expect(code).not.toContain('tgs-slideshow');
    expect(code).not.toContain('aria-roledescription');
  });
});
