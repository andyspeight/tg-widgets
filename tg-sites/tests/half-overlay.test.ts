/**
 * Half overlay: a picture beside a tinted panel, and a slider when there is more
 * than one.
 *
 * WHAT IS WORTH TESTING HERE, and it is not the layout — the two-column grid is
 * checked by looking at it in a browser, which is how the phone stacking and the
 * button colours were settled. What is tested here is the three things that fail
 * SILENTLY:
 *
 *   1. hasSlideshow. If it says no, the page never asks for /slideshow.js and the
 *      block loses its arrows, its dots and its PAUSE BUTTON, while still moving
 *      on its own. Nothing looks broken. Auto-moving content with no way to stop
 *      it fails WCAG 2.2.2, so this is an accessibility failure that presents as
 *      a styling choice.
 *   2. The count rule matching the renderer's. One slide is a static panel with
 *      no slideshow wrapper; asking for the script anyway is a wasted request,
 *      and not asking when there are two is the failure above.
 *   3. The wash never going so thin that white words stop being readable.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor } from '../lib/content/blocks';
import { hasSlideshow } from '../lib/content/slideshow';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');

// ---------------------------------------------------------------------------
// Fixtures: the smallest tree hasSlideshow will walk.
// ---------------------------------------------------------------------------

type Block = { id: string; type: string; props: Record<string, unknown> };

function tree(blocks: Block[]) {
  return {
    sections: [
      {
        id: 's1',
        rows: [{ id: 'r1', columns: [{ id: 'c1', width: 100, blocks }] }],
      },
    ],
  } as never;
}

/** A container holding blocks in its own inner column. */
function container(inner: Block[]): Block {
  return {
    id: 'wrap',
    type: 'container',
    props: { columns: [{ id: 'ic1', width: 100, blocks: inner }] },
  };
}

function halfOverlay(items: Array<Record<string, unknown>>): Block {
  return { id: 'ho', type: 'half-overlay', props: { items } };
}

const SLIDE = { title: 'Greece, island by island', body: 'Seven nights.', src: 'a.jpg' };

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe('the half overlay block', () => {
  it('is in the library, in Media beside the other moving things', () => {
    const definition = blockDefinition('half-overlay')!;
    expect(definition).toBeTruthy();
    expect(definition.group).toBe('Media');
  });

  it('offers both pictures, the side, and two buttons per slide', () => {
    const definition = blockDefinition('half-overlay')!;
    const repeater = definition.fields.find((f) => f.key === 'items') as
      { kind: string; fields: Array<{ key: string }> };

    expect(repeater.kind).toBe('repeater');
    const keys = repeater.fields.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'src', 'alt', 'panelSrc', 'panelAlt', 'side',
        'title', 'body',
        'primaryLabel', 'primaryHref', 'secondaryLabel', 'secondaryHref',
      ]),
    );
  });

  /*
   * THE WASH HAS A FLOOR AND THE FIELD ENFORCES IT. The words on the panel are
   * white, and white over a photograph at 20% of a colour is unreadable. Rather
   * than let a client discover that on a live page, the control will not go
   * there — which is the same principle as refusing a WhatsApp number we cannot
   * make sense of instead of building a link that reaches nobody.
   */
  it('will not let the panel wash go thin enough to lose the words', () => {
    const field = blockDefinition('half-overlay')!.fields.find((f) => f.key === 'tintOpacity') as
      { kind: string; min: number; max: number };

    expect(field.kind).toBe('number');
    expect(field.min).toBeGreaterThanOrEqual(40);
    expect(field.max).toBe(100);
  });

  it('starts with two slides, so a client sees it is a slider', () => {
    const items = defaultPropsFor('half-overlay').items as unknown[];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(1);
  });

  it('and its default wash is already above its own floor', () => {
    expect(defaultPropsFor('half-overlay').tintOpacity as number).toBeGreaterThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// Asking for the script
// ---------------------------------------------------------------------------

describe('hasSlideshow and the half overlay', () => {
  it('asks for the script when there is more than one slide', () => {
    expect(hasSlideshow(tree([halfOverlay([SLIDE, { ...SLIDE, title: 'Italy' }])]))).toBe(true);
  });

  it('does not when there is one, because one slide is a static panel', () => {
    expect(hasSlideshow(tree([halfOverlay([SLIDE])]))).toBe(false);
  });

  /*
   * THE COUNT HAS TO MATCH THE RENDERER'S FILTER. HalfOverlayBlock drops a slide
   * with nothing in it, so an empty row left in the repeater is not a blank panel
   * the visitor waits through. Counting raw rows here would ask for the script on
   * a block that draws one panel.
   */
  it('ignores empty rows left in the repeater, exactly as the renderer does', () => {
    expect(hasSlideshow(tree([halfOverlay([SLIDE, {}, { title: '', body: '' }])]))).toBe(false);
    expect(hasSlideshow(tree([halfOverlay([{}, {}])]))).toBe(false);
  });

  it('counts a picture-only slide, which is a real slide', () => {
    expect(hasSlideshow(tree([halfOverlay([{ src: 'a.jpg' }, { panelSrc: 'b.jpg' }])]))).toBe(true);
  });

  it('does not mistake a block of some other type for one', () => {
    expect(hasSlideshow(tree([{ id: 'x', type: 'cards', props: { items: [SLIDE, SLIDE] } }]))).toBe(false);
  });
});

describe('hasSlideshow and the image block', () => {
  // Unchanged behaviour, asserted so extending the walk cannot have cost it.
  it('still says yes to an image block with extra pictures', () => {
    expect(
      hasSlideshow(tree([{ id: 'i', type: 'image', props: { src: 'a.jpg', slides: [{ src: 'b.jpg' }] } }])),
    ).toBe(true);
  });

  it('still says no when the extra slides are blank', () => {
    expect(
      hasSlideshow(tree([{ id: 'i', type: 'image', props: { src: 'a.jpg', slides: [{ src: '' }, {}] } }])),
    ).toBe(false);
  });
});

describe('a slideshow inside a container', () => {
  /*
   * A FIX, NOT A NEW FEATURE. This walk read only the outer columns until 20 Aug
   * 2026, so a slideshow dropped into a Container or an Advanced Grid rendered,
   * moved, and quietly had no arrows, no dots and no pause button. Nothing
   * announced it, because a slideshow works without the script by design.
   */
  it('is found, so it still gets its arrows and its pause button', () => {
    expect(hasSlideshow(tree([container([halfOverlay([SLIDE, { ...SLIDE, title: 'Italy' }])])]))).toBe(true);
    expect(
      hasSlideshow(tree([container([{ id: 'i', type: 'image', props: { slides: [{ src: 'b.jpg' }] } }])])),
    ).toBe(true);
  });

  it('and one nested two deep is found too', () => {
    expect(hasSlideshow(tree([container([container([halfOverlay([SLIDE, SLIDE])])])]))).toBe(true);
  });

  it('without inventing one that is not there', () => {
    expect(hasSlideshow(tree([container([halfOverlay([SLIDE])])]))).toBe(false);
    expect(hasSlideshow(tree([container([])]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The markup and the stylesheet
// ---------------------------------------------------------------------------

describe('what gets drawn', () => {
  it('borrows the shared slideshow wrapper rather than inventing a second one', () => {
    // public/slideshow.js queries `.tgs-slideshow` and `.tgs-slideshow__slide`
    // and asks nothing about what is inside them, which is what makes the
    // arrows, dots and pause button free here.
    const block = render.slice(render.indexOf('export function HalfOverlayBlock'));
    expect(block).toContain('className="tgs-slideshow"');
    expect(block).toContain('className="tgs-slideshow__slide"');
    expect(block).toContain('--tgs-ss-cycle');
  });

  it('draws one slide with no slideshow wrapper at all', () => {
    const block = render.slice(render.indexOf('export function HalfOverlayBlock'));
    expect(block).toContain('if (look.solo) {');
  });

  /*
   * A slider of twelve slides would otherwise put twelve headings into the
   * document outline with eleven invisible at any moment, promising sections
   * that cannot be reached in order. A single panel is an ordinary feature block
   * and its title is a real heading.
   */
  it('makes the title a heading only when there is one panel', () => {
    expect(render).toContain("const Title = look.solo ? 'h2' : 'p';");
    // Styled by class, so the same design is the same size either way.
    expect(css).toContain('.tgs-halfover__title {');
  });

  it('is two halves that stack on a phone rather than shrinking', () => {
    const rule = css.slice(css.indexOf('.tgs-halfover {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('grid-template-columns: 1fr 1fr');

    const phone = css.slice(css.indexOf('@container tgs-page (max-width: 767px) {', css.indexOf('.tgs-halfover {')));
    expect(phone.slice(0, 900)).toContain('grid-template-columns: 1fr');
  });

  it('swaps the sides with order, so the reading order never changes', () => {
    // Not a second set of column rules: whichever way it is drawn, a screen
    // reader meets the picture and then the words.
    expect(css).toContain(".tgs-halfover[data-side='right'] .tgs-halfover__pic { order: 2; }");
  });

  it('puts the picture first on a phone whichever side it was given', () => {
    // Below the fold is not a side.
    expect(css).toContain(".tgs-halfover[data-side='right'] .tgs-halfover__pic { order: 0; }");
  });

  it('keeps the panel words light, whatever the theme is doing', () => {
    const panel = css.slice(css.indexOf('.tgs-halfover__panel {'));
    expect(panel.slice(0, panel.indexOf('}'))).toContain('color: #fff');
  });

  it('honours the line breaks a client typed into the paragraph', () => {
    const text = css.slice(css.indexOf('.tgs-halfover__text {'));
    expect(text.slice(0, text.indexOf('}'))).toContain('white-space: pre-line');
  });

  /*
   * WHITE, NOT THE THEME'S PRIMARY, when nobody has chosen a button colour. The
   * theme's is picked to work on the site's own background; this panel is never
   * that. The default came out as a dark navy button on a mid blue, which is
   * legible and looks like a mistake.
   */
  it('defaults the filled button to white on the tint rather than the theme colour', () => {
    const block = render.slice(render.indexOf('export function HalfOverlayBlock'));
    const slide = render.slice(render.indexOf('function halfOverlaySlide'), render.indexOf('export function HalfOverlayBlock'));
    expect(slide).toContain("colour: look.buttonColour || '#ffffff'");
    // A fixed dark label, because --tgs-text goes light in dark mode and would
    // vanish on a white button.
    expect(slide).toContain("textColour: look.buttonColour ? undefined : '#111418'");
    expect(block).toBeTruthy();
  });

  it('keeps the wash out of the accessibility tree, because it is paint', () => {
    const slide = render.slice(render.indexOf('function halfOverlaySlide'));
    const tint = slide.slice(slide.indexOf('className="tgs-halfover__tint"'));
    expect(tint.slice(0, 300)).toContain('aria-hidden="true"');
  });
});
