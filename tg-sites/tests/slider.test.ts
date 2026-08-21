/**
 * The Slider: the same cards, on a rail.
 *
 * WHAT IS WORTH TESTING. Almost nothing about a slide, because a slide IS a
 * card: the two blocks share renderCard, and everything about how a card looks
 * is already held by tests/cards.test.ts. What is worth holding here is the
 * three things that make this its own block rather than a copy:
 *
 *   1. That it really does share the drawing, rather than having grown a second
 *      copy of it that will drift.
 *   2. That the rail can be reached by a keyboard at all. A scrollable region
 *      nothing can focus is a WCAG failure and the only way to read a rail of
 *      cards with no links in them.
 *   3. That it does NOT collapse to one column on a phone. The grid does, and a
 *      rail that did would stop being a rail on the one device where swiping is
 *      the natural way to use it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { sanitisePage } from '../lib/content/sanitise-page';
import { createPage, createSectionFromLayout, newId } from '../lib/content/factory';
import { LAYOUTS } from '../lib/content/layouts';
import { parsePage } from '../lib/content/schema';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const blocksSource = source('components', 'render', 'blocks.tsx');
const css = source('app', 'globals.css');

// ---------------------------------------------------------------------------

describe('the Slider block', () => {
  const definition = blockDefinition('slider')!;

  it('is in the library, under Media, and belongs to the client', () => {
    expect(isKnownBlock('slider')).toBe(true);
    expect(definition.group).toBe('Media');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('slider');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  /*
   * FIVE, NOT THREE. A rail with three cards on a wide screen is a rail with
   * nothing to scroll, so the block would arrive looking broken. The grid's
   * three is right for a grid and wrong here.
   */
  it('arrives with enough slides to have something to scroll', () => {
    const items = defaultPropsFor('slider').items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.every((item) => typeof item.title === 'string' && item.title !== '')).toBe(true);
  });

  it('takes the same fields per slide as a card, so the two cannot drift apart', () => {
    const slide = definition.fields.find((field) => field.key === 'items');
    const card = blockDefinition('cards')!.fields.find((field) => field.key === 'items');
    expect(slide?.kind).toBe('repeater');
    expect(card?.kind).toBe('repeater');
    if (slide?.kind !== 'repeater' || card?.kind !== 'repeater') return;

    /*
     * ONE DELIBERATE DIFFERENCE, from 21 Aug 2026: a card may lead with an ICON
     * instead of a photograph (Duda's Fancy Grid), and a slide may not. A slide
     * is a photograph, and the slider hard-codes lead:'image' where it reuses
     * renderCard. Everything else still has to match, which is what this guards.
     */
    const CARD_ONLY = ['icon'];
    expect(slide.fields.map((field) => field.key).sort()).toEqual(
      card.fields.map((field) => field.key).filter((key) => !CARD_ONLY.includes(key)).sort(),
    );
  });

  it('offers a slide width instead of a column count, which is the real difference', () => {
    expect(definition.fields.some((field) => field.key === 'slideWidth')).toBe(true);
    expect(definition.fields.some((field) => field.key === 'columns')).toBe(false);
  });

  /*
   * ORIGINAL WAS REFUSED HERE UNTIL 20 AUG 2026, for a good reason: a card frame
   * is built around a fixed aspect ratio, so with no ratio the box has no height
   * and the picture inside collapses to nothing.
   *
   * It is offered now because that failure, fixed, IS the mosaic: Andy described
   * Duda's double row carousel as "a mosaic, so the images can be of different
   * heights in the same carousel". The fix is one rule giving the picture its own
   * height back, scoped to the rail, and it is asserted below rather than left to
   * trust — without it this option is a way for a client to make every picture
   * vanish.
   */
  it('offers an original picture shape, which is what makes two rows a mosaic', () => {
    const ratio = definition.fields.find((field) => field.key === 'ratio');
    expect(ratio?.kind === 'select' && ratio.options.map((o) => o.value)).toContain('auto');
  });

  it('and the stylesheet gives that frame its height back, or the picture vanishes', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    expect(css).toContain(".tgs-slider[data-ratio='auto'] .tgs-card__frame img { height: auto; }");
  });

  it('but the Cards grid still refuses it, because a ragged row helps nobody', () => {
    const ratio = blockDefinition('cards')!.fields.find((field) => field.key === 'ratio');
    expect(ratio?.kind === 'select' && ratio.options.map((o) => o.value)).not.toContain('auto');
  });

  it('its own defaults survive a parse and a sanitise', () => {
    const page = createPage('Test', 'test');
    const section = createSectionFromLayout(LAYOUTS[0]);
    section.rows[0].columns[0].blocks = [
      { id: newId('b'), type: 'slider', props: defaultPropsFor('slider') },
    ];
    page.sections = [section];

    const parsed = parsePage(page);
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true);
    if (!parsed.ok) return;

    const items = sanitisePage(parsed.page).sections[0].rows[0].columns[0].blocks[0].props
      .items as unknown[];
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it('sanitises a slide address, since it is the same repeater', () => {
    const page = createPage('Test', 'test');
    const section = createSectionFromLayout(LAYOUTS[0]);
    section.rows[0].columns[0].blocks = [{
      id: newId('b'),
      type: 'slider',
      // eslint-disable-next-line no-script-url
      props: { items: [{ title: 'Nope', linkHref: 'javascript:alert(1)' }] },
    }];
    page.sections = [section];

    const parsed = parsePage(page);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const items = sanitisePage(parsed.page).sections[0].rows[0].columns[0].blocks[0].props
      .items as Array<Record<string, unknown>>;
    expect(items[0].linkHref).toBe('');
  });
});

// ---------------------------------------------------------------------------

describe('it really is the same card', () => {
  const render = /export function SliderBlock\(([\s\S]*?)\n\/\/ ---/.exec(blocksSource)?.[1] ?? '';

  it('there is a SliderBlock to read at all', () => {
    expect(render.length).toBeGreaterThan(400);
  });

  /*
   * THE POINT OF THE WHOLE ARRANGEMENT. A second copy of the card markup would
   * look identical on the day it was written and different six weeks later.
   */
  it('draws its slides with the grid’s own renderCard', () => {
    expect(render).toContain('renderCard(card, index,');
    // And no markup of its own for a slide.
    expect(render).not.toContain('<article');
  });

  it('carries the cards class as well, so every card rule already applies', () => {
    expect(render).toContain('className="tgs-cards tgs-slider"');
  });

  it('shows a placeholder rather than an empty rail', () => {
    expect(render).toContain('Add some slides');
  });
});

// ---------------------------------------------------------------------------

describe('the rail', () => {
  const render = /export function SliderBlock\(([\s\S]*?)\n\/\/ ---/.exec(blocksSource)?.[1] ?? '';

  /*
   * A SCROLLABLE REGION A KEYBOARD CANNOT REACH IS A WCAG FAILURE, and for a
   * rail of cards with no links in them it is the only way to read past the
   * first two. One extra tab stop, and it is named so it is not a mystery.
   */
  it('can be reached by a keyboard, and says what it is when it is', () => {
    expect(render).toContain('tabIndex={0}');
    expect(render).toContain('role="group"');
    expect(render).toContain('aria-label="Slides. Scroll sideways to see more."');
  });

  it('and shows where the focus went', () => {
    expect(css).toContain('.tgs-slider:focus-visible {');
    const ring = css.slice(css.indexOf('.tgs-slider:focus-visible {'));
    expect(ring.slice(0, 200)).toContain('outline: 3px solid var(--tgs-accent)');
  });

  it('is a rail rather than a grid, and snaps', () => {
    const rule = /\n\.tgs-slider \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('grid-auto-flow: column');
    expect(rule).toContain('overflow-x: auto');
    expect(rule).toContain('scroll-snap-type: x mandatory');
    // A swipe that runs out of rail must not start dragging the page behind it.
    expect(rule).toContain('overscroll-behavior-x: contain');
    expect(css).toContain('.tgs-slider > .tgs-card { scroll-snap-align: start; }');
  });

  /*
   * THE ONE THAT WOULD BREAK IT SILENTLY. The grid comes down to one column on a
   * phone. A rail must not: sideways is the entire point, and the phone is where
   * swiping is the natural way to use it.
   */
  it('stays a rail on a phone, where the grid becomes one column', () => {
    /*
     * `includes`, NOT `slice(indexOf(...))`. The first version of this sliced
     * from indexOf and asserted the result was not empty, and indexOf answers
     * -1 when it finds nothing, so the slice was the last character of the file
     * and the check passed with the rule deleted. It was caught by deleting the
     * rule on purpose, which is the only way that class of mistake ever is.
     */
    expect(
      css.includes('.tgs-slider { grid-auto-flow: column; grid-template-columns: none; }'),
      'the phone rule for the rail has gone',
    ).toBe(true);

    // And the rule that collapses cards names its column counts, so it cannot
    // reach a slider, which has none.
    expect(css).toContain(".tgs-cards[data-columns='3'],");
    expect(css).not.toMatch(/\n\s*\.tgs-cards \{ grid-template-columns: 1fr; \}/);
  });

  it('narrows the slides on a phone so the next one still peeks in', () => {
    expect(css).toContain(".tgs-slider[data-slide='medium'] { --tgs-slide: 76%; }");
  });

  it('has a scrollbar somebody can see before they have scrolled', () => {
    // The whole affordance on a desktop is "this moves", and an overlay
    // scrollbar that appears after the first scroll is too late to be a hint.
    expect(css).toContain('scrollbar-width: thin');
    expect(css).toContain('.tgs-slider::-webkit-scrollbar { height: 8px; }');
  });
});

// ---------------------------------------------------------------------------
// Two rows, and how loudly the rail says "this moves"
//
// Andy, 20 Aug 2026, from Duda's Double Row Carousel and Scrollbar Carousel.
// Both are settings on this one block rather than two more blocks: four
// near-identical carousels in the picker is how a library becomes hard to
// choose from, and it would be four things to keep working.
// ---------------------------------------------------------------------------

const sliderCss = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

describe('two rows on one rail', () => {
  it('is a setting, not a second block', () => {
    expect(isKnownBlock('double-row-carousel')).toBe(false);
    const rows = blockDefinition('slider')!.fields.find((f) => f.key === 'rows');
    expect(rows?.kind).toBe('select');
    expect(rows?.kind === 'select' && rows.options.map((o) => o.value)).toEqual(['1', '2']);
  });

  it('defaults to one, so no existing slider changes shape', () => {
    expect(defaultPropsFor('slider').rows).toBe('1');
  });

  it('fills downwards then across, so a pair travels together', () => {
    /*
     * Two explicit rows plus the column auto-flow the rail already has is what
     * puts card one above card two. Two separate rails would drift apart the
     * moment anybody touched one of them.
     */
    const rule = sliderCss.slice(sliderCss.indexOf(".tgs-slider[data-rows='2'] {"));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('grid-template-rows: auto auto;');
  });

  it('lets each card be its own height, which is what makes it a mosaic', () => {
    // Without this every card in a row stretches to the tallest and a short one
    // grows a band of empty space under its text.
    const rule = sliderCss.slice(sliderCss.indexOf(".tgs-slider[data-rows='2'] {"));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('align-items: start;');
  });
});

describe('the bold scroll bar', () => {
  it('is a setting on the same block, with the thin one still the default', () => {
    const bar = blockDefinition('slider')!.fields.find((f) => f.key === 'scrollbar');
    expect(bar?.kind === 'select' && bar.options.map((o) => o.value)).toEqual(['thin', 'bar']);
    expect(defaultPropsFor('slider').scrollbar).toBe('thin');
  });

  /*
   * STILL THE BROWSER'S OWN SCROLLBAR. A div drawn to look like one would need a
   * script to move it, would not drag, would not take a keyboard, and would have
   * to be kept in step with the real scroll position by hand.
   */
  it('styles the real scrollbar rather than drawing a fake one', () => {
    expect(sliderCss).toContain(".tgs-slider[data-scrollbar='bar']::-webkit-scrollbar {");
    expect(sliderCss).toContain(".tgs-slider[data-scrollbar='bar']::-webkit-scrollbar-thumb {");
    // Firefox has no pseudo-elements for this, so the two-value shorthand is the
    // only way it hears about the colours at all.
    const base = sliderCss.slice(sliderCss.indexOf(".tgs-slider[data-scrollbar='bar'] {"));
    expect(base.slice(0, base.indexOf('}'))).toContain('scrollbar-color:');
  });
});

describe('the edge fade', () => {
  /*
   * A FIXED FADE WOULD BE A LIE AT BOTH ENDS: on the right it stays once you
   * have reached the end, on the left it is there before you have started. So
   * the two ends are driven by the scroll position itself.
   */
  it('follows the scroll rather than sitting still', () => {
    expect(sliderCss).toContain('animation-timeline: scroll(self inline);');
    expect(sliderCss).toContain('@keyframes tgs-rail-fade');
  });

  it('registers its two lengths, or they would jump instead of sliding', () => {
    // An unregistered custom property does not interpolate: it flips at the
    // halfway mark, which reads as a bug rather than a fade.
    expect(sliderCss).toContain('@property --tgs-rail-l');
    expect(sliderCss).toContain('@property --tgs-rail-r');
    const prop = sliderCss.slice(sliderCss.indexOf('@property --tgs-rail-l'));
    expect(prop.slice(0, prop.indexOf('}'))).toContain("syntax: '<length>'");
  });

  /*
   * THE GUARD IS THE POINT OF THIS ONE. An unguarded `animation-timeline` in a
   * browser without scroll timelines does not fall back to nothing: it falls
   * back to a TIME-BASED animation, so the fade would slide from one edge to the
   * other on a loop while the rail sat still. Far worse than no fade.
   */
  it('is inside @supports, so an older browser gets no fade rather than a timed one', () => {
    const guard = sliderCss.indexOf('@supports (animation-timeline: scroll())');
    expect(guard).toBeGreaterThan(-1);

    const fade = sliderCss.indexOf('animation-timeline: scroll(self inline);');
    expect(fade).toBeGreaterThan(guard);
    // And inside the same block, not merely after it.
    expect(sliderCss.slice(guard, fade)).not.toContain('\n}\n');
  });
});

describe('the mosaic needs the frame to have a height', () => {
  it('gives the picture its own height back on the Original shape', () => {
    // A card frame is built around a fixed aspect ratio. With no ratio the box
    // has no height and the picture collapses to nothing, which is why Original
    // used to be refused here. One rule turns that failure into the feature.
    expect(sliderCss).toContain(".tgs-slider[data-ratio='auto'] .tgs-card__frame img { height: auto; }");
  });

  it('and the renderer names the shape so that rule can find it', () => {
    const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
    // The whole function, not up to the first </div>: that one belongs to the
    // empty-state placeholder and closes long before the rail is written.
    const from = render.indexOf('export function SliderBlock');
    const slider = render.slice(from, render.indexOf('export function ', from + 10));
    expect(slider).toContain('data-ratio={ratio}');
  });
});
