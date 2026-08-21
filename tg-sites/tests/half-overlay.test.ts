/**
 * Half overlay: a picture beside a tinted panel, and more than one is a slider.
 *
 * Andy, 20 Aug 2026, from Duda's Half Overlay Slider.
 *
 * WHAT IS WORTH TESTING, and it is not the layout — two grid columns are two
 * grid columns, and the browser check that went with this change confirmed the
 * halves match height, the side swaps, and one slide draws no slideshow chrome.
 * What can silently rot is the JOIN between this block and the slideshow it
 * borrows:
 *
 *   1. hasSlideshow has to agree with the renderer about what counts as a
 *      slider, in both directions. Too eager and every page fetches a script it
 *      does not need; too shy and a moving slideshow loses its PAUSE BUTTON,
 *      which is a WCAG 2.2.2 failure rather than a missing nicety.
 *   2. The markup has to keep the class names public/slideshow.js queries. That
 *      file was not touched for this block and must not need to be.
 *   3. The container recursion, which was a real bug fixed on the same day.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { hasSlideshow, type Tree } from '../lib/content/slideshow';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
const script = readFileSync(join(__dirname, '..', 'public', 'slideshow.js'), 'utf8');

// ---------------------------------------------------------------------------
// Fixtures: the smallest tree shapes hasSlideshow has to judge
// ---------------------------------------------------------------------------

function tree(blocks: unknown[]): Tree {
  return {
    sections: [
      { rows: [{ columns: [{ blocks }] }] },
    ],
  } as unknown as Tree;
}

/** A tree whose only slideshow is buried inside a container's inner column. */
function nested(blocks: unknown[]): Tree {
  return tree([
    { type: 'container', props: { columns: [{ blocks }] } },
  ]);
}

function slide(over: Record<string, unknown> = {}) {
  return { title: 'Greece', body: 'Seven nights.', src: '/a.jpg', ...over };
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe('the block', () => {
  it('is registered and lives with the other media', () => {
    expect(isKnownBlock('half-overlay')).toBe(true);
    expect(blockDefinition('half-overlay')!.group).toBe('Media');
  });

  it('arrives with two slides, so the client sees what it is', () => {
    const items = defaultPropsFor('half-overlay').items as unknown[];
    expect(items).toHaveLength(2);
  });

  it('alternates the picture side in its defaults, because that is how it reads', () => {
    const items = defaultPropsFor('half-overlay').items as Array<{ side: string }>;
    expect(items.map((item) => item.side)).toEqual(['left', 'right']);
  });

  /*
   * THE FLOOR ON THE WASH IS NOT A ROUND NUMBER PICKED FOR TIDINESS. White words
   * over a photograph need the colour between them to be doing real work, and
   * below about 40% a light patch in the picture takes the text with it. The
   * field will not go there, so a client cannot make their own panel unreadable.
   */
  it('will not let the panel wash go below the readable floor', () => {
    const field = blockDefinition('half-overlay')!.fields.find((f) => f.key === 'tintOpacity') as
      { min: number; max: number };
    expect(field.min).toBe(40);
    expect(field.max).toBe(100);
  });

  it('offers the same slideshow controls the Image block does', () => {
    const keys = blockDefinition('half-overlay')!.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['transition', 'interval', 'arrows', 'dots']));
  });
});

// ---------------------------------------------------------------------------
// Does the page ask for the script?
// ---------------------------------------------------------------------------

describe('hasSlideshow and the half-overlay block', () => {
  it('asks for the script when there is more than one slide', () => {
    expect(hasSlideshow(tree([{ type: 'half-overlay', props: { items: [slide(), slide()] } }]))).toBe(true);
  });

  /*
   * ONE SLIDE IS A STATIC PANEL. The renderer draws it with no `.tgs-slideshow`
   * wrapper at all, so a script tag here would fetch a file with nothing to
   * enhance.
   */
  it('does not ask for it for a single slide', () => {
    expect(hasSlideshow(tree([{ type: 'half-overlay', props: { items: [slide()] } }]))).toBe(false);
  });

  /*
   * AND THE COUNT MUST MATCH THE RENDERER'S FILTER. HalfOverlayBlock drops a
   * slide with nothing in it, so three rows where two are blank is a static
   * panel, not a slider. Counting raw rows here would be the two halves
   * disagreeing, which is exactly the failure this file exists to prevent.
   */
  it('counts only slides with something in them', () => {
    const items = [slide(), {}, { title: '', body: '', src: '', panelSrc: '' }];
    expect(hasSlideshow(tree([{ type: 'half-overlay', props: { items } }]))).toBe(false);
  });

  it('counts a slide that is only a picture', () => {
    const items = [{ src: '/a.jpg' }, { panelSrc: '/b.jpg' }];
    expect(hasSlideshow(tree([{ type: 'half-overlay', props: { items } }]))).toBe(true);
  });

  it('copes with a block whose items are missing or the wrong shape', () => {
    expect(hasSlideshow(tree([{ type: 'half-overlay', props: {} }]))).toBe(false);
    expect(hasSlideshow(tree([{ type: 'half-overlay', props: { items: 'two' } }]))).toBe(false);
    expect(hasSlideshow(tree([{ type: 'half-overlay' }]))).toBe(false);
  });
});

describe('hasSlideshow and the image block, which must still work', () => {
  it('still finds an image slideshow', () => {
    expect(hasSlideshow(tree([{ type: 'image', props: { slides: [{ src: '/b.jpg' }] } }]))).toBe(true);
  });

  it('still ignores an image whose extra slides are blank', () => {
    expect(hasSlideshow(tree([{ type: 'image', props: { slides: [{ src: '  ' }, {}] } }]))).toBe(false);
  });

  it('ignores a page with nothing on it', () => {
    expect(hasSlideshow(tree([{ type: 'text', props: { html: '<p>Hello</p>' } }]))).toBe(false);
    expect(hasSlideshow(null)).toBe(false);
    expect(hasSlideshow(undefined)).toBe(false);
  });
});

/*
 * THE RECURSION IS A FIX FOR A BUG THAT SHIPPED, and it is the kind nothing
 * reports. A slideshow inside a Container or an Advanced Grid rendered and moved
 * perfectly — it works without the script by design — and simply never got its
 * arrows, dots or pause button, because this walk only ever read the outer
 * columns. It looked like a styling choice.
 */
describe('a slideshow inside a container', () => {
  it('is found, for an image', () => {
    expect(hasSlideshow(nested([{ type: 'image', props: { slides: [{ src: '/b.jpg' }] } }]))).toBe(true);
  });

  it('is found, for a half overlay', () => {
    expect(hasSlideshow(nested([{ type: 'half-overlay', props: { items: [slide(), slide()] } }]))).toBe(true);
  });

  it('is found inside a grid too, which is the same shape', () => {
    const inGrid = tree([{ type: 'grid', props: { columns: [{ blocks: [{ type: 'image', props: { slides: [{ src: '/c.jpg' }] } }] }] } }]);
    expect(hasSlideshow(inGrid)).toBe(true);
  });

  it('and a container with nothing in it is still nothing', () => {
    expect(hasSlideshow(nested([]))).toBe(false);
    expect(hasSlideshow(tree([{ type: 'container', props: { columns: 'broken' } }]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The join to the script, which was not touched for this block
// ---------------------------------------------------------------------------

describe('it borrows the slideshow rather than inventing one', () => {
  it('emits the class names the script queries', () => {
    // The script asks for these two and nothing about what is inside them, which
    // is exactly what makes this block free to reuse it.
    expect(script).toContain("querySelectorAll('.tgs-slideshow')");
    expect(script).toContain("querySelectorAll('.tgs-slideshow__slide')");

    const block = render.slice(render.indexOf('export function HalfOverlayBlock'));
    expect(block).toContain('className="tgs-slideshow"');
    expect(block).toContain('className="tgs-slideshow__slide"');
  });

  it('carries the same data attributes the script and the CSS cycle read', () => {
    const block = render.slice(render.indexOf('export function HalfOverlayBlock'));
    for (const attr of ['data-transition', 'data-count', 'data-interval', 'data-dots', 'data-arrows']) {
      expect(block).toContain(attr);
    }
    expect(block).toContain('--tgs-ss-cycle');
  });

  it('names itself a carousel for a screen reader', () => {
    const block = render.slice(render.indexOf('export function HalfOverlayBlock'));
    expect(block).toContain('aria-roledescription="carousel"');
  });
});

// ---------------------------------------------------------------------------
// The two decisions in the renderer worth pinning down
// ---------------------------------------------------------------------------

describe('the title', () => {
  /*
   * A slider of twelve slides would put twelve headings in the document outline
   * with eleven invisible at any moment — an outline promising sections that
   * cannot be reached in order, which is worse for a screen reader than no
   * heading. A single panel is an ordinary feature block and gets a real one.
   */
  it('is a heading on a single panel and a paragraph in a slider', () => {
    const block = render.slice(render.indexOf('function halfOverlaySlide'));
    expect(block).toContain("const Title = look.solo ? 'h2' : 'p';");
  });

  it('is styled by class, so both spellings look the same', () => {
    // Without this the same design would come out at two different sizes
    // depending on how many slides somebody happened to add.
    expect(css).toContain('.tgs-halfover__title {');
    expect(css).not.toMatch(/\.tgs-halfover h2\s*\{/);
  });
});

describe('the panel', () => {
  it('draws the wash as its own element, between the picture and the words', () => {
    const block = render.slice(render.indexOf('function halfOverlaySlide'));
    expect(block).toContain('className="tgs-halfover__tint"');
    // It is paint. It must not be announced.
    const tint = block.slice(block.indexOf('className="tgs-halfover__tint"'));
    expect(tint.slice(0, tint.indexOf('/>'))).toContain('aria-hidden="true"');
  });

  it('works with no picture under it, which is a quieter design and not a fault', () => {
    const block = render.slice(render.indexOf('function halfOverlaySlide'));
    expect(block).toContain('{panelSrc && (');
  });
});

describe('the layout', () => {
  it('swaps sides with order, so the reading order never changes', () => {
    // A second set of column rules would move the markup and take a screen
    // reader's order with it.
    expect(css).toContain(".tgs-halfover[data-side='right'] .tgs-halfover__pic { order: 2; }");
  });

  it('stacks on a phone rather than shrinking to two thin columns', () => {
    const phone = css.slice(css.lastIndexOf('@container tgs-page (max-width: 767px)', css.indexOf('.tgs-halfover-wrap { --tgs-ho-h: auto; }')));
    expect(phone).toContain('grid-template-columns: 1fr;');
    // And the picture comes first whichever side it was told to take: below the
    // fold is not a side.
    expect(phone).toContain(".tgs-halfover[data-side='right'] .tgs-halfover__pic { order: 0; }");
  });

  it('gives both halves the same height, so a longer paragraph cannot break it', () => {
    expect(css).toContain('min-height: var(--tgs-ho-h);');
    expect(css).toContain('.tgs-halfover__pic img {');
    expect(css).toContain('object-fit: cover;');
  });
});

// ---------------------------------------------------------------------------
// Restored coverage
//
// These assertions existed, were lost when this file was rewritten on the same
// day, and are back because each one pins a real decision rather than restating
// the shape of the markup. Kept together with this note so the next person to
// tidy this file can see they were deliberate.
// ---------------------------------------------------------------------------

describe('the fields, in full', () => {
  it('offers both pictures, the side, and two buttons per slide', () => {
    const repeater = blockDefinition('half-overlay')!.fields.find((f) => f.key === 'items') as
      { kind: string; fields: Array<{ key: string }> };

    expect(repeater.kind).toBe('repeater');
    expect(repeater.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'src', 'alt', 'panelSrc', 'panelAlt', 'side',
        'title', 'body',
        'primaryLabel', 'primaryHref', 'secondaryLabel', 'secondaryHref',
      ]),
    );
  });

  it('and its default wash is already above its own floor', () => {
    // A default the field itself would reject is the sort of thing nobody
    // notices until a client drags the slider and cannot get back.
    expect(defaultPropsFor('half-overlay').tintOpacity as number).toBeGreaterThanOrEqual(40);
  });
});

describe('the buttons on the panel', () => {
  /*
   * WHITE, NOT THE THEME'S PRIMARY, when nobody has chosen a colour. The theme's
   * button colour is picked to work on the site's own background, and this panel
   * is never that: it is a wash of at least 40% of a colour chosen for this
   * block. The default navy came out as a dark button on a mid blue — legible,
   * and looking like a mistake.
   */
  it('default to white on the tint rather than to the theme colour', () => {
    const slide = render.slice(
      render.indexOf('function halfOverlaySlide'),
      render.indexOf('export function HalfOverlayBlock'),
    );
    expect(slide).toContain("colour: look.buttonColour || '#ffffff'");
  });

  it('and their label is a fixed dark, not a theme token', () => {
    // --tgs-text goes light in dark mode, which would leave a white button with
    // white words on it.
    const slide = render.slice(
      render.indexOf('function halfOverlaySlide'),
      render.indexOf('export function HalfOverlayBlock'),
    );
    expect(slide).toContain("textColour: look.buttonColour ? undefined : '#111418'");
  });
});

describe('the panel styling', () => {
  it('keeps the words light, whatever the theme is doing', () => {
    const panel = css.slice(css.indexOf('.tgs-halfover__panel {'));
    expect(panel.slice(0, panel.indexOf('}'))).toContain('color: #fff');
  });

  it('honours the line breaks a client typed into the paragraph', () => {
    // The paragraph is a textarea, so the breaks are theirs and not ours to
    // collapse.
    const text = css.slice(css.indexOf('.tgs-halfover__text {'));
    expect(text.slice(0, text.indexOf('}'))).toContain('white-space: pre-line');
  });
});

describe('the walk, at its edges', () => {
  it('finds a slideshow nested two containers deep', () => {
    const twoDeep = tree([
      { type: 'container', props: { columns: [{ blocks: [
        { type: 'container', props: { columns: [{ blocks: [
          { type: 'half-overlay', props: { items: [slide(), slide()] } },
        ] }] } },
      ] }] } },
    ]);
    expect(hasSlideshow(twoDeep)).toBe(true);
  });

  it('does not mistake another block that happens to have items', () => {
    // Cards carries an `items` array too. Keying off the array rather than the
    // type would put a script tag on most pages in the product.
    expect(hasSlideshow(tree([{ type: 'cards', props: { items: [slide(), slide()] } }]))).toBe(false);
  });
});
