/**
 * Expanding cards: a row of pictures where the one you click opens.
 *
 * Andy, 20 Aug 2026, from Duda's Travelgenix Expanding Cards.
 *
 * WHAT IS WORTH TESTING. The behaviour itself was checked in a browser — click
 * card three, card three opens and card one closes, with document.scripts.length
 * sitting at zero. What that check cannot pin down is the reasoning, and every
 * one of these can be broken by a change that still LOOKS right:
 *
 *   1. Radios, not buttons. One of a set and never none is what a radio group
 *      IS, and it brings arrow keys and an announced state for free.
 *   2. The radio group name has to carry the block id, or two of these on one
 *      page become a single group and opening a card in the first closes one in
 *      the second.
 *   3. `visibility: hidden` on a closed card's body, not opacity. Opacity alone
 *      leaves a keyboard landing on a button nobody can see inside a card that
 *      is not open.
 *   4. The open card's label has to stop taking clicks, or it sits over the
 *      button and swallows them.
 *   5. The CSS pairs one radio to one card by position, and the number of pairs
 *      has to match the cap the renderer applies.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
/*
 * Sliced to the NEXT exported function, not to a named one. This ended at
 * ButtonBlock until 21 Aug 2026 and silently widened the day three components
 * were inserted between them, so the no-buttons check below started reading the
 * Tooltip's button and failing. Third time this shape of bug has appeared;
 * screen-carousel and stacked-cards were the other two.
 */
const start = render.indexOf('export function ExpandingCardsBlock');
const block = render.slice(start, render.indexOf('\nexport function ', start + 1));

/** The cap the renderer applies, read from the source so the two cannot drift. */
const MAX = Number(/MAX_EXPANDING_CARDS = (\d+)/.exec(render)?.[1]);

describe('the block', () => {
  it('is registered, in Showcase', () => {
    expect(isKnownBlock('expanding-cards')).toBe(true);
    expect(blockDefinition('expanding-cards')!.group).toBe('Showcase');
  });

  it('arrives with four cards, so a client can see what it does', () => {
    expect((defaultPropsFor('expanding-cards').items as unknown[]).length).toBe(4);
  });

  /*
   * SIX IS A DESIGN LIMIT, not a technical one. Every card that is not open is a
   * strip a few centimetres wide with a word down it; past six there is not
   * enough room left for the open one to be worth opening.
   */
  it('caps the cards, and the field agrees with the renderer', () => {
    expect(MAX).toBe(6);
    const items = blockDefinition('expanding-cards')!.fields.find((f) => f.key === 'items') as
      { kind: string; max: number };
    expect(items.max).toBe(MAX);
  });

  it('will not let the shading go thin enough to lose the words', () => {
    const field = blockDefinition('expanding-cards')!.fields.find((f) => f.key === 'scrimStrength') as
      { min: number; max: number };
    expect(field.min).toBe(25);
    expect(defaultPropsFor('expanding-cards').scrimStrength as number).toBeGreaterThanOrEqual(field.min);
  });
});

describe('it is built from radios, which is what buys the behaviour', () => {
  it('uses radio inputs rather than buttons', () => {
    expect(block).toContain('type="radio"');
    // A button would need a script to decide which card is open. A radio group
    // already means "one of these, and never none".
    expect(block).not.toContain('<button');
  });

  /*
   * THE ONE THAT BITES. Two of these on one page with the same group name is a
   * single radio group: opening a card in the first closes one in the second,
   * and nothing about the markup looks wrong.
   */
  it('names the group after the block, so two on a page stay apart', () => {
    expect(block).toContain('const name = `tgs-expand-${blockId}`;');
    expect(block).toContain('name={name}');
  });

  it('leaves the open card to the browser rather than controlling it', () => {
    // A controlled `checked` would mean the editor canvas snapping back to the
    // first card on every keystroke.
    expect(block).toContain('defaultChecked={index === 0}');
    expect(block).not.toMatch(/\schecked=\{/);
  });

  it('writes the position down rather than counting element types', () => {
    // :nth-of-type counts by ELEMENT type and pairs the wrong card with the
    // wrong radio the moment the markup grows another kind of child. Tabs was
    // caught by exactly this.
    expect(block).toContain('data-index={index}');
    expect(css).not.toContain('.tgs-expand__card:nth-of-type');
  });

  it('hides the radios without taking them out of the tab order', () => {
    expect(block).toContain('tgs-expand__radio tgs-sr-only');
    expect(css).toContain('.tgs-sr-only {');
  });
});

describe('the pairings', () => {
  const groups = [
    { what: 'the open card grows', sel: (i: number) => `.tgs-expand__radio[data-index='${i}']:checked ~ .tgs-expand__rail .tgs-expand__card[data-index='${i}'],` },
    { what: 'its body appears', sel: (i: number) => `.tgs-expand__radio[data-index='${i}']:checked ~ .tgs-expand__rail .tgs-expand__card[data-index='${i}'] .tgs-expand__body,` },
    { what: 'its label steps aside', sel: (i: number) => `.tgs-expand__radio[data-index='${i}']:checked ~ .tgs-expand__rail .tgs-expand__card[data-index='${i}'] .tgs-expand__hit,` },
  ];

  for (const group of groups) {
    it(`covers every position: ${group.what}`, () => {
      // One selector per card, up to the cap. A rule written for four cards and
      // a field that allows six is a card that silently never opens.
      for (let i = 0; i < MAX - 1; i += 1) {
        expect(css).toContain(group.sel(i));
      }
    });
  }

  it('and the last of each group closes the selector rather than trailing a comma', () => {
    const last = `.tgs-expand__radio[data-index='${MAX - 1}']:checked ~ .tgs-expand__rail .tgs-expand__card[data-index='${MAX - 1}'] {`;
    expect(css).toContain(last);
  });

  /*
   * THE FOCUS RING GOES ON THE CARD, because the thing that actually has focus
   * is a radio nobody can see. Without it, tabbing into the row moves focus with
   * no visible sign of where it went and the arrow keys start working for no
   * apparent reason.
   */
  it('shows focus on the card, since the radio is invisible', () => {
    expect(css).toContain(`.tgs-expand__radio[data-index='0']:focus-visible ~ .tgs-expand__rail .tgs-expand__card[data-index='0'],`);
  });
});

describe('a closed card', () => {
  it('takes its button out of the tab order rather than just fading it', () => {
    // Opacity alone would leave a keyboard landing on a button nobody can see,
    // inside a card that is not even open.
    const body = css.slice(css.indexOf('.tgs-expand__body {'));
    const rule = body.slice(0, body.indexOf('}'));
    expect(rule).toContain('visibility: hidden;');
  });

  it('reads its title up the strip rather than cut in half across it', () => {
    /*
     * A closed card is a few centimetres wide. Centre a horizontal title in
     * that and "Greek island hopping" becomes "k island ho", which tells a
     * visitor nothing and looks broken rather than deliberate.
     */
    const spine = css.slice(css.indexOf('.tgs-expand__spine {'));
    expect(spine.slice(0, spine.indexOf('}'))).toContain('writing-mode: vertical-rl;');
  });

  it('is clickable across the whole of itself', () => {
    // A narrow strip with a small button somewhere on it is a card most people
    // would not think to click.
    const hit = css.slice(css.indexOf('.tgs-expand__hit {'));
    const rule = hit.slice(0, hit.indexOf('}'));
    expect(rule).toContain('position: absolute;');
    expect(rule).toContain('inset: 0;');
  });
});

describe('an open card', () => {
  it('lets its button take the click back off the label', () => {
    const hit = css.slice(css.indexOf(`.tgs-expand__radio[data-index='0']:checked ~ .tgs-expand__rail .tgs-expand__card[data-index='0'] .tgs-expand__hit,`));
    expect(hit.slice(0, hit.indexOf('}'))).toContain('pointer-events: none;');
  });
});

describe('motion and small screens', () => {
  it('has one authored transition, and honours a request for less', () => {
    const card = css.slice(css.indexOf('.tgs-expand__card {'));
    expect(card.slice(0, card.indexOf('}'))).toContain('transition: flex-grow');

    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .tgs-expand__card'));
    expect(reduce.slice(0, 200)).toContain('transition: none;');
  });

  it('stacks down the page on a phone, with the titles the right way up', () => {
    // Six strips across a 390px screen is 60px each, which is not a card, it is
    // a fence.
    const phone = css.slice(css.indexOf('.tgs-expand__rail { flex-direction: column;'));
    expect(phone.slice(0, 600)).toContain('writing-mode: horizontal-tb;');
  });
});
