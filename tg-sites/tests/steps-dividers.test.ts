/**
 * The Steps block and the shaped section edges.
 *
 * Two pieces of work from 1 Aug 2026, tested together because they share the
 * one thing worth being careful about: both put SVG on a page, and in both the
 * geometry is a closed list written by us while the client picks a name. That
 * is the same arrangement as the social icons and for the same reason, so the
 * checks that matter are the ones proving the list really is closed.
 *
 * The rest of what these two do is layout, which is a fact about laid-out
 * pixels and belongs in the browser harness. What is here is the data, the
 * reductions, and the handful of rendering decisions that can be read as source.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import {
  DEFAULT_DIVIDER_HEIGHT,
  DIVIDER_OPTIONS,
  DIVIDER_SHAPES,
  MAX_DIVIDER_HEIGHT,
  MIN_DIVIDER_HEIGHT,
  dividerShape,
  normaliseDividerHeight,
  safeDivider,
  sectionFill,
} from '../lib/content/dividers';
import { parsePage } from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

describe('the Steps block', () => {
  it('is in the registry, in with the other text', () => {
    expect(isKnownBlock('steps')).toBe(true);
    expect(blockDefinition('steps')?.group).toBe('Cards and lists');
  });

  it('arrives with steps already written, so it looks like what it is', () => {
    const items = defaultPropsFor('steps').items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const item of items) {
      expect(String(item.title).length).toBeGreaterThan(0);
    }
  });

  /*
   * AN `ol`, NOT A ROW OF DIVS, and that is the reason this is a block at all.
   * A screen reader announces "list, three items, item one of three", which is
   * the whole meaning of a sequence. Three cards side by side announce nothing.
   */
  it('is an ordered list, which is what makes it a sequence', () => {
    const source = read('components', 'render', 'blocks.tsx');
    const block = source.slice(source.indexOf('export function StepsBlock'));
    expect(block.slice(0, block.indexOf('\n}\n'))).toContain('<ol');
  });

  /*
   * THE NUMBERS ARE A CSS COUNTER, never stored text. A client who drags step
   * three above step two gets 1, 2, 3 with nothing to correct, and there is no
   * stored number to go stale. The renderer must therefore write no digits.
   */
  it('numbers itself from the CSS counter rather than from stored text', () => {
    const source = read('components', 'render', 'blocks.tsx');
    const block = source.slice(source.indexOf('export function StepsBlock'));
    const body = block.slice(0, block.indexOf('\n}\n'));

    expect(body).toContain('className="tgs-steps__marker"');
    // The marker is empty in the markup: nothing writes index + 1 into it.
    expect(body).not.toContain('index + 1');

    const css = read('app', 'globals.css');
    expect(css).toContain('counter-reset: tgs-step');
    expect(css).toContain('counter-increment: tgs-step');
    expect(css).toContain('content: counter(tgs-step)');
  });

  it('marks the number as decorative, since the list already says which item it is', () => {
    const source = read('components', 'render', 'blocks.tsx');
    const block = source.slice(source.indexOf('export function StepsBlock'));
    // aria-hidden on the marker span is the point; the optional marker colour
    // added a style attribute after it on 3 Aug 2026, so match the two parts
    // rather than the whole self-closing tag.
    const marker = block.slice(0, block.indexOf('\n}\n'));
    expect(marker).toMatch(/<span className="tgs-steps__marker" aria-hidden="true"/);
  });

  /*
   * THE LINE JOINS ONE STEP TO THE NEXT, so the last one must not have one
   * dangling off the end of the sequence.
   */
  it('draws no connector after the last step', () => {
    const css = read('app', 'globals.css');
    const rules = [...css.matchAll(/\.tgs-steps\[data-connector='true'\][^{]*::before/g)];

    /*
     * THE GUARD, AND IT IS NOT DECORATION. The first version of this sliced the
     * stylesheet between two comments and got the order wrong, so the slice was
     * empty, the loop never ran and the check passed while proving nothing. A
     * mutation probe that removed :not(:last-child) sailed through it. Asserting
     * the matches exist is what stops that happening twice.
     */
    expect(rules.length, 'no connector rules found, so this check sees nothing')
      .toBeGreaterThan(0);

    for (const match of rules) {
      expect(match[0], match[0]).toContain(':not(:last-child)');
    }
  });

  it('says what to do when there are no steps yet', () => {
    const source = read('components', 'render', 'blocks.tsx');
    const block = source.slice(source.indexOf('export function StepsBlock'));
    expect(block.slice(0, block.indexOf('\n}\n'))).toContain('Add the steps');
  });

  /*
   * Across becomes down on a phone, the same rule every row in the stylesheet
   * follows: four steps sharing 390px is four steps nobody can read.
   */
  it('stacks on a phone however it was set', () => {
    const css = read('app', 'globals.css');
    const phone = css.slice(css.indexOf('@container tgs-page (max-width: 767px) {\n  .tgs-steps'));
    expect(phone.slice(0, 400)).toContain(".tgs-steps[data-layout='across'] { display: block; }");
  });
});

// ---------------------------------------------------------------------------
// Shaped edges: the closed list
// ---------------------------------------------------------------------------

describe('the divider shapes', () => {
  it('resolves a name to a shape, and nothing else to anything', () => {
    expect(dividerShape('curve')?.label).toBe('Curve');
    expect(dividerShape('swoosh')).toBeUndefined();
    expect(dividerShape('')).toBeUndefined();
    expect(dividerShape(null)).toBeUndefined();
    expect(dividerShape({ id: 'curve' })).toBeUndefined();
  });

  /*
   * A SHAPE THIS BUILD CANNOT DRAW BECOMES A STRAIGHT EDGE, which is the whole
   * forward-compatibility story: a section saved by a newer build naming a
   * shape added later still renders, minus the flourish, rather than crashing
   * or drawing an empty box.
   */
  it('reduces anything it cannot draw to no divider at all', () => {
    expect(safeDivider('wave')).toBe('wave');
    expect(safeDivider('a-shape-from-2027')).toBe('none');
    expect(safeDivider(undefined)).toBe('none');
    expect(safeDivider(42)).toBe('none');
  });

  it('has no two shapes sharing a name', () => {
    const ids = DIVIDER_SHAPES.map((shape) => shape.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /*
   * EVERY PATH IS FILLED AT THE BOTTOM of a 1200 by 100 box, because the top
   * edge reuses the same path flipped in CSS rather than a second set of
   * coordinates that could drift out of step. A path that did not start at the
   * bottom left and close would flip into something unrecognisable.
   */
  it('draws every shape the same way up, so one path can serve both edges', () => {
    for (const shape of DIVIDER_SHAPES) {
      expect(shape.path.startsWith('M0 100'), `${shape.id} does not start at the bottom left`).toBe(true);
      expect(shape.path.trimEnd().endsWith('Z'), `${shape.id} is not closed`).toBe(true);
    }
  });

  /*
   * The geometry is markup we wrote. A path is put straight into a `d`
   * attribute, so anything other than the numbers and letters of a path is the
   * mistake to catch.
   */
  it('has nothing in a path but path data', () => {
    for (const shape of DIVIDER_SHAPES) {
      expect(shape.path, shape.id).toMatch(/^[MLCQAZmlcqaz0-9 .,-]+$/);
    }
  });

  it('offers a straight edge first, then every shape, then blend', () => {
    expect(DIVIDER_OPTIONS[0].value).toBe('none');
    expect(DIVIDER_OPTIONS.slice(1, 1 + DIVIDER_SHAPES.length).map((option) => option.value))
      .toEqual(DIVIDER_SHAPES.map((shape) => shape.id));
    // Blend is not a shape, so it sits after the shapes rather than among them.
    expect(DIVIDER_OPTIONS[DIVIDER_OPTIONS.length - 1].value).toBe('blend');
  });
});

describe('how deep a divider is', () => {
  it('keeps a sensible one', () => {
    expect(normaliseDividerHeight(80)).toBe(80);
  });

  /*
   * min and max on a number input are advisory: the browser marks the field
   * invalid and hands the value over. Same clamp, same reason, as every other
   * measurement in this codebase.
   */
  it('pulls back one far outside the range', () => {
    expect(normaliseDividerHeight(9000)).toBe(MAX_DIVIDER_HEIGHT);
    expect(normaliseDividerHeight(-40)).toBe(MIN_DIVIDER_HEIGHT);
    expect(normaliseDividerHeight(0)).toBe(MIN_DIVIDER_HEIGHT);
  });

  it('falls back for anything that is not a number', () => {
    for (const value of ['tall', null, undefined, NaN, {}]) {
      expect(normaliseDividerHeight(value)).toBe(DEFAULT_DIVIDER_HEIGHT);
    }
  });
});

// ---------------------------------------------------------------------------
// The colour, which is the part that took two goes
// ---------------------------------------------------------------------------

describe('what colour a divider is drawn in', () => {
  /*
   * A SHAPED EDGE IS THE BOUNDARY BETWEEN TWO SECTIONS, so the shape belongs to
   * the section it owns and is painted in the colour of the one on the other
   * side. The first version had it the other way round, reaching out of its own
   * section into the next, and a 56px divider ate the entire 48px default
   * padding of the section below and sat on its heading.
   */
  it('takes the tone of the section it is naming', () => {
    expect(sectionFill({ tone: 'light' })).toBe('var(--tgs-surface)');
    expect(sectionFill({ tone: 'subtle' })).toBe('var(--tgs-surface-alt)');
    expect(sectionFill({ tone: 'dark' })).toBe('var(--tgs-surface-dark)');
    expect(sectionFill({ tone: 'accent' })).toBe('var(--tgs-primary)');
  });

  /*
   * A VARIABLE, NOT A HEX, so a divider follows the theme. Freezing today's
   * colour into the page is how a client who rebrands finds one shape left
   * behind in the old palette.
   */
  it('names a theme variable rather than freezing a colour into the page', () => {
    for (const tone of ['light', 'subtle', 'dark', 'accent']) {
      expect(sectionFill({ tone })).toMatch(/^var\(--tgs-/);
    }
  });

  it('lets a section colour of its own win, exactly as its background does', () => {
    expect(sectionFill({ tone: 'dark', box: { background: '#f2e3c9' } })).toBe('#f2e3c9');
  });

  /*
   * THE ONE THAT COST AN HOUR. boxStyle emits `--tgs-bg: transparent` on EVERY
   * section, set or not, so a CSS rule keyed on `[style*='--tgs-bg']` matched
   * all of them and painted every divider transparent. Nothing drew at all.
   * A colour cannot be asked whether it is transparent, so this function is
   * where the question gets answered.
   */
  it('treats a transparent background as no colour of its own', () => {
    expect(sectionFill({ tone: 'subtle', box: { background: 'transparent' } }))
      .toBe('var(--tgs-surface-alt)');
  });

  it('and the page itself at either end of the list', () => {
    expect(sectionFill(undefined)).toBe('var(--tgs-surface)');
    expect(sectionFill(null)).toBe('var(--tgs-surface)');
  });

  it('is set in the renderer, because no selector can reach the section next door', () => {
    const renderer = read('components', 'render', 'PageRenderer.tsx');
    expect(renderer).toContain('fill={sectionFill(above)}');
    // The hang branch (a header's own-colour wave) is the one exception; the
    // ordinary bottom edge still borrows the neighbour below.
    expect(renderer).toContain('fill={hangBottomDivider ? sectionFill(section) : sectionFill(below)}');
    expect(renderer).toContain('color: fill');

    // And the rule that did not work is gone, with the reason written down.
    const css = read('app', 'globals.css');
    expect(css).not.toContain(".tgs-section[style*='--tgs-bg'] > .tgs-section__divider");
  });

  /*
   * The divider sits above the section's background and its scrim and BELOW
   * .tgs-section__inner, which is already z-index 2. So even a divider set
   * deeper than the section's padding can never sit over the words.
   */
  it('sits under the content, whatever depth it is set to', () => {
    const css = read('app', 'globals.css');
    const rule = css.slice(css.indexOf('.tgs-section__divider {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('z-index: 1');
    expect(css).toContain('.tgs-section__inner {');
  });
});

// ---------------------------------------------------------------------------
// Blend, the edge that is a fade rather than a shape
// ---------------------------------------------------------------------------

/*
 * BLEND, added 4 Aug 2026. Andy wanted an edge where the adjoining colours fade
 * into each other so one section looks like it emerges from the next. It is not
 * a shape, so it has no path and is drawn as a gradient; the one thing that must
 * hold is that it is a legal stored name handled beside the shapes, and that its
 * gradient runs the right way at each edge.
 */
describe('the blend divider', () => {
  it('is a legal stored name, kept rather than reduced to a straight edge', () => {
    expect(safeDivider('blend')).toBe('blend');
  });

  it('is offered in the picker after the shapes', () => {
    expect(DIVIDER_OPTIONS.some((option) => option.value === 'blend')).toBe(true);
  });

  it('is drawn as a gradient, the neighbour fading to transparent, per edge', () => {
    const renderer = read('components', 'render', 'PageRenderer.tsx');
    // Handled beside the shapes, not through dividerShape, since it has no path.
    expect(renderer).toContain('if (name === BLEND_DIVIDER)');
    // Top: the neighbour above at the top of the band, fading down into this
    // section. Bottom: the reverse. Written per edge, not one path flipped.
    expect(renderer).toContain('`linear-gradient(to bottom, ${fill}, transparent)`');
    expect(renderer).toContain('`linear-gradient(to bottom, transparent, ${fill})`');
    // It reveals this section's own background, so the transparent end matters.
    expect(renderer).toContain('tgs-section__divider--blend');
  });

  it('opts out of the flip the SVG shapes use, so its direction stays as drawn', () => {
    const css = read('app', 'globals.css');
    expect(css).toContain(".tgs-section__divider--blend[data-edge='top'] { transform: none; }");
  });

  it('survives a parse on either edge', () => {
    const section = sectionWith({ dividerTop: 'blend', dividerBottom: 'blend' });
    expect(section.dividerTop).toBe('blend');
    expect(section.dividerBottom).toBe('blend');
  });
});

// ---------------------------------------------------------------------------
// Through the schema
// ---------------------------------------------------------------------------

function sectionWith(extra: Record<string, unknown>) {
  const parsed = parsePage({
    version: 1,
    id: 'p',
    title: 'T',
    slug: '',
    seo: { noindex: false },
    sections: [{ id: 's1', rows: [], ...extra }],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.page.sections[0];
}

describe('a stored section', () => {
  it('keeps the shapes it was given', () => {
    const section = sectionWith({ dividerTop: 'wave', dividerBottom: 'angle', dividerHeight: 72 });
    expect(section.dividerTop).toBe('wave');
    expect(section.dividerBottom).toBe('angle');
    expect(section.dividerHeight).toBe(72);
  });

  it('reduces a shape it has never heard of rather than refusing the page', () => {
    const section = sectionWith({ dividerTop: 'swoosh' });
    expect(section.dividerTop).toBe('none');
  });

  it('clamps a depth from outside the editor', () => {
    expect(sectionWith({ dividerHeight: 100_000 }).dividerHeight).toBe(MAX_DIVIDER_HEIGHT);
  });

  it('leaves a section that never asked for one alone', () => {
    const section = sectionWith({});
    expect(section.dividerTop ?? 'none').toBe('none');
    expect(section.dividerBottom ?? 'none').toBe('none');
  });
});
