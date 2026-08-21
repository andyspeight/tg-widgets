/**
 * The 21 Aug batch: Scrolling Gallery, Popup Gallery, Tilted Carousel and
 * Flipping Boxes, all from Duda's Travelgenix list.
 *
 * THREE OF THE FOUR ARE SETTINGS, NOT ELEMENTS, and that is the decision most
 * worth protecting here. Duda ships a plain gallery, a scrolling gallery and a
 * popup gallery as three separate things, and a third carousel beside its other
 * two. Ours are a `layout`, a `lightbox` and a `tilt`, because a picker holding
 * three galleries makes a client choose before they know what they want, and all
 * three would share every other field anyway.
 *
 * The behaviour was checked in a browser: the lightbox opens, covers the
 * viewport after scrolling, and closes from the backdrop; the rail animates and
 * carries an aria-hidden duplicate; a flip card turns over and its button takes
 * the click. What a browser check cannot pin down is the reasoning, which is
 * what these are for.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');

/** A component's source, sliced to the NEXT exported function rather than a
 *  named one, so inserting a block between them cannot widen the slice. */
function componentSource(name: string): string {
  const start = render.indexOf(`export function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  return render.slice(start, render.indexOf('\nexport function ', start + 1));
}

// ---------------------------------------------------------------------------
// The Gallery gains two shapes
// ---------------------------------------------------------------------------

describe('the gallery', () => {
  it('offers a grid and a self-scrolling rail, on one element', () => {
    const layout = blockDefinition('gallery')!.fields.find((f) => f.key === 'layout') as
      { options: Array<{ value: string }> };
    expect(layout.options.map((o) => o.value)).toEqual(['grid', 'scroll']);
    expect(defaultPropsFor('gallery').layout).toBe('grid');
  });

  it('has the lightbox on by default', () => {
    // A gallery is pictures somebody wants to look at. Making them click a
    // setting first to get the obvious behaviour is the wrong default.
    expect(defaultPropsFor('gallery').lightbox).toBe(true);
  });

  it('duplicates the rail and hides the copy from a screen reader', () => {
    /*
     * A marquee that scrolls to its end and jumps back is the tell that it is a
     * trick; two copies translated by half the width loop seamlessly. The copy
     * is the same pictures, so it must not be read out twice.
     */
    const source = componentSource('GalleryBlock');
    expect(source).toContain('strip(false)');
    expect(source).toContain('strip(true)');
    expect(source).toContain("'aria-hidden': true as const");
    expect(css).toContain('@keyframes tgs-gallery-scroll');
  });

  it('gives the duplicate no lightbox of its own', () => {
    // Two checkboxes with one id would be a duplicate id and a control that
    // opens somebody else's picture.
    expect(componentSource('GalleryBlock')).toContain('lightbox && !copy');
  });

  it('stops the rail for a pointer AND for a keyboard', () => {
    // Hover alone would let a picture slide out from under a tab stop.
    expect(css).toContain('.tgs-gallery-marquee:hover .tgs-gallery--rail,');
    expect(css).toContain('.tgs-gallery-marquee:focus-within .tgs-gallery--rail { animation-play-state: paused; }');
  });

  it('drops the duplicate entirely for reduced motion, rather than leaving it silent', () => {
    const reduce = css.slice(css.indexOf('.tgs-gallery--rail { flex-wrap: wrap;'));
    expect(reduce.slice(0, 200)).toContain("[aria-hidden='true'] { display: none; }");
  });
});

describe('the lightbox', () => {
  /*
   * A REAL VIEWPORT OVERLAY, and worth asserting because an earlier note in this
   * repo claimed one was impossible from inside `.tgs-page`. Measured 21 Aug
   * 2026: container-type does NOT contain a fixed descendant.
   */
  it('is fixed to the viewport', () => {
    const rule = css.slice(css.indexOf('.tgs-gallery__lightbox {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('position: fixed;');
  });

  it('is not tabbable while it is closed', () => {
    /*
     * THE REASON THERE IS NO FOCUS TRAP. Trapping needs a script, so this is
     * built not to need one: closed, `visibility: hidden` takes the close button
     * out of the tab order and the accessibility tree, so a keyboard cannot land
     * inside a lightbox nobody opened.
     */
    const rule = css.slice(css.indexOf('.tgs-gallery__lightbox {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('visibility: hidden;');
    expect(css).toContain('.tgs-gallery__cb:checked ~ .tgs-gallery__lightbox {');
  });

  it('closes from the backdrop as well as the button', () => {
    // Clicking off a picture is what everybody tries first.
    const source = componentSource('GalleryBlock');
    expect(source).toContain('tgs-gallery__backdrop');
    const both = source.match(/htmlFor=\{`\$\{name\}-\$\{index\}`\}/g) ?? [];
    // The thumbnail, the backdrop and the close button all point at one checkbox.
    expect(both.length).toBe(3);
  });

  it('names both close controls for a screen reader', () => {
    const source = componentSource('GalleryBlock');
    expect(source.match(/aria-label="Close the picture"/g)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The tilt
// ---------------------------------------------------------------------------

describe('the tilted carousel', () => {
  it('is a setting on the Slider rather than a fourth carousel', () => {
    const tilt = blockDefinition('slider')!.fields.find((f) => f.key === 'tilt') as
      { options: Array<{ value: string }> };
    expect(tilt.options.map((o) => o.value)).toEqual(['none', 'gentle', 'strong']);
    expect(defaultPropsFor('slider').tilt).toBe('none');
  });

  it('and the default did not land on the Cards block by accident', () => {
    // It did, on the first attempt: the pattern matched Cards' defaults instead.
    // The suite caught it, and this keeps it caught.
    expect(defaultPropsFor('cards')).not.toHaveProperty('tilt');
  });

  it('reads the rail position in CSS rather than with a scroll listener', () => {
    /*
     * `animation-timeline: view(x)` is the same scroll-driven CSS the reveals and
     * the parallax already use. Where it is unsupported the keyframes never run
     * and the carousel is flat, which is the right failure and what the field
     * promises.
     */
    expect(css).toContain('animation-timeline: view(x);');
    expect(css).toContain('@keyframes tgs-slider-tilt');
  });

  it('puts the perspective on the rail, not on each card', () => {
    // Per-card perspective gives every card its own vanishing point and the row
    // splays instead of turning.
    const rule = css.slice(css.indexOf('.tgs-slider[data-tilt] {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('perspective:');
  });

  it('goes flat for anybody who asked for less motion', () => {
    expect(css).toContain('.tgs-slider[data-tilt] > .tgs-card { animation: none; transform: none; }');
  });
});

// ---------------------------------------------------------------------------
// Flipping boxes
// ---------------------------------------------------------------------------

describe('flipping boxes', () => {
  it('is registered, in Media', () => {
    expect(isKnownBlock('flip-cards')).toBe(true);
    expect(blockDefinition('flip-cards')!.group).toBe('Media');
  });

  /*
   * THE ONE THAT MATTERS. The usual build of this is hover only, which does not
   * exist on any phone and cannot be reached from a keyboard — between them,
   * most of the people a travel site is for.
   */
  it('turns over on a tap as well as a hover', () => {
    expect(componentSource('FlipCardsBlock')).toContain('type="checkbox"');
    expect(css).toContain('.tgs-flip__cb:checked ~ .tgs-flip__inner,');
    expect(css).toContain('.tgs-flip:hover .tgs-flip__inner { transform: rotateY(180deg); }');
  });

  it('keeps the back out of the tab order until the card is turned', () => {
    /*
     * backface-visibility stops you SEEING the back and does nothing about the
     * button on it being tabbable. Without the visibility rules a keyboard tabs
     * into a button on the far side of a card nobody has turned over.
     */
    const rule = css.slice(css.indexOf('.tgs-flip__backinner {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('visibility: hidden;');
    expect(css).toContain('.tgs-flip:hover .tgs-flip__inner .tgs-flip__backinner { visibility: visible; }');
  });

  it('still turns over for reduced motion, it just does it at once', () => {
    // Removing the flip entirely would leave the back unreachable.
    const reduce = css.slice(css.indexOf('.tgs-flip__inner { transition: none; }'));
    expect(reduce.length).toBeGreaterThan(0);
    expect(css).not.toContain('.tgs-flip__inner { transform: none');
  });

  it('gives every box the same height', () => {
    // They turn over in place, so a box that changed size would shove the row
    // about as somebody read it.
    const rule = css.slice(css.indexOf('.tgs-flip { perspective:'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('height: var(--tgs-flip-h)');
  });

  it('names the checkbox after the block, so two on a page stay apart', () => {
    expect(componentSource('FlipCardsBlock')).toContain('const name = `tgs-flip-${blockId}`;');
  });

  it('leaves the turned state to the browser', () => {
    const source = componentSource('FlipCardsBlock');
    expect(source).not.toMatch(/\schecked=\{/);
  });
});
