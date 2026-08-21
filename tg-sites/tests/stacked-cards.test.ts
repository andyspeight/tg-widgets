/**
 * Stacked cards — recipe S3, sticky-stack.
 *
 * Andy, 21 Aug 2026, from Duda's Stacked Cards: "up to 6 cards that as you
 * scroll collapse one on top of the other, so once you reach the bottom there is
 * only one card in view."
 *
 * IT WAS ALREADY IN THE MOTION CATALOGUE. S3, tier 0, marked proven, with its
 * travel meaning recorded as COMPARISON — three ships, four room grades, five
 * tour styles — and the note that it "replaces the three-equal-cards row, which
 * is the single most common AI tell". Checking the catalogue before building was
 * the difference between one element and two implementations of one idea.
 *
 * THE BEHAVIOUR WAS MEASURED, not assumed: six cards land at 80, 94, 108, 122,
 * 136 and 150 and hold there while the page keeps scrolling. What the numbers
 * cannot hold onto is the runway, which took three attempts and where the two
 * wrong ones both look perfectly reasonable in a diff.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
const block = (() => {
  const start = render.indexOf('export function StackedCardsBlock');
  return render.slice(start, render.indexOf('\nexport function ', start + 1));
})();

/*
 * The component without its prose. This repo's own rule — "a source-text
 * assertion must strip comments first, or it reads the prose explaining a bug as
 * the bug" — and it caught this file twice over: the no-scroll-jacking check
 * below found the words "as you scroll" in the comment saying there is no scroll
 * handler.
 */
const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MAX = Number(/MAX_STACKED_CARDS = (\d+)/.exec(render)?.[1]);

describe('the block', () => {
  it('is registered, in Media', () => {
    expect(isKnownBlock('stacked-cards')).toBe(true);
    expect(blockDefinition('stacked-cards')!.group).toBe('Media');
  });

  it('caps at six, as Andy asked and the catalogue suggests', () => {
    expect(MAX).toBe(6);
    const items = blockDefinition('stacked-cards')!.fields.find((f) => f.key === 'items') as
      { max: number };
    expect(items.max).toBe(MAX);
    expect(block).toContain('.slice(0, MAX_STACKED_CARDS)');
  });

  it('can alternate which side the picture takes', () => {
    // Six cards the same way round reads as a list; alternating reads as a
    // sequence, which is what a comparison is.
    const side = blockDefinition('stacked-cards')!.fields.find((f) => f.key === 'side') as
      { options: Array<{ value: string }> };
    expect(side.options.map((o) => o.value)).toEqual(['right', 'left', 'alternate']);
    expect(block).toContain("side === 'alternate' ? (index % 2 === 0 ? 'right' : 'left') : side");
  });
});

describe('the stacking', () => {
  it('is sticky, with an offset that grows by card', () => {
    expect(css).toContain('position: sticky;');
    expect(css).toContain('top: calc(var(--tgs-stack-top) + var(--tgs-stack-i, 0) * var(--tgs-stack-step));');
  });

  it('passes the index down as one custom property, not six written-out rules', () => {
    /*
     * Unlike Tabs and Expanding cards, nothing here has to PAIR one element with
     * another — a card only needs to know how far down the pile it is — so the
     * enumerate-every-position pattern those two need would be noise here.
     */
    expect(block).toContain("'--tgs-stack-i': index");
    expect(css).not.toContain(".tgs-stack__card[data-index='0']");
  });

  it('needs every card opaque, or the deck shows through itself', () => {
    expect(block).toContain('background: cardColour');
    expect(defaultPropsFor('stacked-cards').cardColour).toBe('#ffffff');
  });

  it('does not scroll-jack', () => {
    // The catalogue's rule for every pinned recipe: the scrollbar stays real and
    // the browser stays in charge. Sticky does that; a scroll listener does not.
    // Against `code`, not `block`. See the note where `code` is defined.
    expect(code).not.toContain('addEventListener');
    expect(code).not.toContain('scrollTop');
    expect(code).not.toContain('onScroll');
  });
});

describe('the runway', () => {
  /*
   * THREE ATTEMPTS, AND THE TWO WRONG ONES BOTH LOOK FINE IN A DIFF.
   *
   * A sticky card only travels while there is page left below it. The last card
   * has nothing after it, so without a runway it stops wherever the page happens
   * to end: measured with six cards, it halted 89px short and the section
   * finished showing a deck AND a stray card.
   *
   * 1. `padding-bottom` on the stack. Adds scroll length and SHRINKS THE CONTENT
   *    BOX, and sticky is constrained to the content box. Every card squeezed
   *    into a flat pile at 93px, and adding more padding changed nothing because
   *    the padding was the cause.
   * 2. `margin-bottom` on the last card. Extends the container, but sticky keeps
   *    an element's MARGIN BOX inside the containing block, so the last card was
   *    pushed up by exactly its own margin and sailed past its stop.
   * 3. Its own empty element after the cards. Extends the content box, adds the
   *    scroll length, and belongs to no card.
   */
  it('is its own element, belonging to no card', () => {
    expect(block).toContain('className="tgs-stack__runway"');
    expect(css).toContain('.tgs-stack__runway {');
  });

  it('is hidden from a screen reader, being scroll length rather than content', () => {
    const runway = block.slice(block.indexOf('tgs-stack__runway'));
    expect(runway.slice(0, 120)).toContain('aria-hidden="true"');
  });

  it('is not padding on the stack', () => {
    // Attempt one. It squeezes the deck flat and looks like the offsets are wrong.
    const rule = css.slice(css.indexOf('.tgs-stack {'));
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('padding-bottom');
  });

  it('is not a margin on the last card', () => {
    // Attempt two. Sticky respects the margin box, so the card overshoots.
    expect(css).not.toContain('.tgs-stack__card:last-child { margin-bottom');
  });

  it('is as tall as a card, which is the travel the last one needs', () => {
    const rule = css.slice(css.indexOf('.tgs-stack__runway {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('height: var(--tgs-stack-h, 24rem);');
  });
});

describe('small screens and less motion', () => {
  it('becomes an ordinary column for anybody who asked for less motion', () => {
    // The catalogue's rule for pinned recipes: a pinned section becomes a normal
    // one. The cards are all still there, in order, just not gathering.
    expect(css).toContain('.tgs-stack__card { position: static; }');
  });

  it('keeps stacking on a phone, but in one column', () => {
    // The gathering is the point of the element and works just as well
    // vertically; half a phone screen of photograph beside two words does not.
    const phone = css.slice(css.indexOf('.tgs-stack__card {\n    grid-template-columns: 1fr;'));
    expect(phone.slice(0, 400)).toContain('grid-template-rows: 12rem auto;');
    expect(css).toContain('--tgs-stack-top: 3.5rem; --tgs-stack-step: 10px;');
  });
});
