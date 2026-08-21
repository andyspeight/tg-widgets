/**
 * Screen carousel: pictures playing on a device.
 *
 * Andy, 20 Aug 2026, from Duda's Travelgenix Screen Carousel.
 *
 * WHAT IS WORTH TESTING. Not that a bezel is 14px — that is a look, and looks
 * are checked by opening them. What is worth pinning down is the handful of
 * decisions that would quietly stop being true:
 *
 *   1. The device is DRAWN, not a picture of a device. The day somebody
 *      "simplifies" this into a PNG it stops following the client's frame
 *      colour and starts shipping a photograph of somebody else's hardware.
 *   2. The screen shapes are the real ones. A 16/9 "laptop" reads as a
 *      television and everybody can tell without knowing why.
 *   3. It reuses the shared slideshow rather than growing a second one, which
 *      is the only reason it gets arrows, dots and a pause button for free.
 *   4. hasSlideshow knows about it. Without that the page never asks for
 *      /slideshow.js and the carousel silently loses its PAUSE BUTTON, which is
 *      not cosmetic: auto-moving content needs a way to stop it (WCAG 2.2.2).
 *   5. The frame is scenery and stays out of the accessibility tree.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { hasSlideshow } from '../lib/content/slideshow';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
/*
 * Sliced to the NEXT exported function, not to a named one. An earlier version
 * ended this slice at ButtonBlock and silently grew to include a whole other
 * block the day one was inserted between them, which made the empty-state
 * assertion below read the wrong component.
 */
const start = render.indexOf('export function ScreenCarouselBlock');
const block = render.slice(
  start,
  render.indexOf('\nexport function ', start + 1),
);

/** A page tree holding one block, for the hasSlideshow checks. */
function treeWith(type: string, props: Record<string, unknown>) {
  return {
    sections: [
      { id: 's', rows: [{ id: 'r', columns: [{ id: 'c', blocks: [{ id: 'b', type, props }] }] }] },
    ],
  } as never;
}

describe('the block', () => {
  it('is registered, in Media', () => {
    expect(isKnownBlock('screen-carousel')).toBe(true);
    expect(blockDefinition('screen-carousel')!.group).toBe('Media');
  });

  it('offers a laptop and a phone', () => {
    const field = blockDefinition('screen-carousel')!.fields.find((f) => f.key === 'device') as
      { options: Array<{ value: string }> };
    expect(field.options.map((o) => o.value)).toEqual(['laptop', 'phone']);
    expect(defaultPropsFor('screen-carousel').device).toBe('laptop');
  });
});

describe('the device is drawn rather than photographed', () => {
  it('ships no image of a device', () => {
    // A picture of a laptop would be one size, one colour and a file to ship,
    // and it could not follow the client's silver or graphite choice.
    expect(block).not.toMatch(/laptop\.(png|jpg|svg|webp)/i);
    expect(css).not.toMatch(/url\([^)]*(laptop|phone|device|macbook)/i);
  });

  it('follows the frame choice the client made, through custom properties', () => {
    expect(css).toContain(".tgs-screen[data-frame='dark'] {");
    const base = css.slice(css.indexOf('.tgs-screen {'));
    expect(base.slice(0, base.indexOf('}'))).toContain('--tgs-scr-bezel:');
  });

  /*
   * THE REAL SHAPES. 16/10 is a laptop; 16/9 is a television, and the
   * difference is one of those things everybody notices and nobody names.
   */
  it('uses the real screen shapes', () => {
    const glass = css.slice(css.indexOf('.tgs-screen__glass {'));
    expect(glass.slice(0, glass.indexOf('}'))).toContain('aspect-ratio: 16 / 10;');

    const phone = css.slice(css.indexOf(".tgs-screen[data-device='phone'] .tgs-screen__glass {"));
    expect(phone.slice(0, phone.indexOf('}'))).toContain('aspect-ratio: 9 / 19.5;');
  });

  it('stands the laptop on a base and does not stand the phone on one', () => {
    expect(css).toContain(".tgs-screen[data-device='phone'] .tgs-screen__base { display: none; }");
  });

  it('keeps the frame out of the accessibility tree', () => {
    // A bezel, a camera dot and a base are scenery. What a screen reader should
    // find in here is the pictures.
    const cam = block.slice(block.indexOf('tgs-screen__cam'));
    expect(cam.slice(0, 120)).toContain('aria-hidden="true"');
    const base = block.slice(block.indexOf('tgs-screen__base'));
    expect(base.slice(0, 120)).toContain('aria-hidden="true"');
  });
});

describe('it borrows the shared slideshow', () => {
  it('emits the same wrapper the Image block does', () => {
    // Which is the entire reason it gets arrows, dots and a pause button with
    // nothing added to public/slideshow.js.
    expect(block).toContain('className="tgs-slideshow"');
    expect(block).toContain('className="tgs-slideshow__slide"');
    expect(block).toContain("aria-roledescription=\"carousel\"");
  });

  it('does not invent a second cycle of its own', () => {
    expect(block).toContain('--tgs-ss-cycle');
    expect(css).not.toContain('@keyframes tgs-screen-');
  });

  it('draws one picture as a still screen, with no carousel around it', () => {
    // An auto-moving thing with a single frame would still ask for a pause
    // button nobody needs.
    expect(block).toContain('if (pictures.length === 1) {');
    expect(block).toContain('className="tgs-screen__shot"');
  });
});

describe('the page knows to fetch the slideshow script', () => {
  it('asks for it when more than one picture is chosen', () => {
    expect(
      hasSlideshow(treeWith('screen-carousel', { items: [{ src: 'a.jpg' }, { src: 'b.jpg' }] })),
    ).toBe(true);
  });

  it('does not ask for it for a still screen', () => {
    expect(hasSlideshow(treeWith('screen-carousel', { items: [{ src: 'a.jpg' }] }))).toBe(false);
  });

  it('and does not count a repeater row whose picture was never chosen', () => {
    // Matching the renderer's own filter. Two blank rows are not two slides.
    expect(
      hasSlideshow(treeWith('screen-carousel', { items: [{ src: 'a.jpg' }, { src: '' }, { src: '  ' }] })),
    ).toBe(false);
  });

  it('finds one inside a container, not only in an outer column', () => {
    /*
     * The walk read outer columns only until 20 Aug 2026, so a slideshow
     * dropped into a Container rendered, moved, and quietly had no pause
     * button. Nothing announced it, because a slideshow works without the
     * script by design.
     */
    const nested = {
      sections: [{
        id: 's',
        rows: [{
          id: 'r',
          columns: [{
            id: 'c',
            blocks: [{
              id: 'wrap',
              type: 'container',
              props: {
                columns: [{
                  blocks: [{ id: 'inner', type: 'screen-carousel', props: { items: [{ src: 'a.jpg' }, { src: 'b.jpg' }] } }],
                }],
              },
            }],
          }],
        }],
      }],
    } as never;
    expect(hasSlideshow(nested)).toBe(true);
  });
});

describe('the empty state', () => {
  it('is the device with an empty screen, not a grey box', () => {
    // A client who has just dropped this in wants to see the thing they chose.
    // An empty screen inside a real frame shows them what they are about to fill.
    expect(block).toContain('tgs-screen__empty');
    expect(block).not.toContain('tgs-placeholder');
  });
});
