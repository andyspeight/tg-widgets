/**
 * The card's silhouette, as distinct from its finish.
 *
 * Until 23 Aug 2026 the Cards block offered four finishes (plain, outlined,
 * raised, tinted) and every client's blog therefore had the same card wearing a
 * different coat. PRODUCT.md's third principle says that is a failure: if two
 * client sites feel interchangeable the design did not do its job. These are the
 * three shapes, and the invariants that keep them honest.
 *
 * WHAT IS CHECKED HERE AND WHAT IS NOT. Contrast over a photograph cannot be
 * asserted from source, so it was measured in a browser against a worst-case
 * image (a bright sky band and a light patch exactly where the words sit) and
 * the numbers are recorded in the commit. What this file holds is the structure
 * that produced those numbers, so a later edit cannot quietly undo it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BLOCKS } from '../lib/content/blocks';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const css = read('app', 'globals.css');
const render = read('components', 'render', 'blocks.tsx');
const cards = BLOCKS.find((block) => block.type === 'cards');

describe('the card design control', () => {
  it('offers three shapes and defaults to the one every site already has', () => {
    const field = cards?.fields.find((f) => f.key === 'design');
    expect(field?.kind).toBe('select');
    expect((field as { options: Array<{ value: string }> }).options.map((o) => o.value))
      .toEqual(['stacked', 'overlay', 'index']);
    // Nothing published moves: stacked is exactly what the block did before.
    expect((cards?.defaults as Record<string, unknown>).design).toBe('stacked');
  });

  it('is a separate question from the finish, and says so', () => {
    const design = cards?.fields.find((f) => f.key === 'design');
    const style = cards?.fields.find((f) => f.key === 'style');
    expect(design?.help).toContain('The style below is its finish');
    expect(style?.help).toContain('no box');
  });

  it('reaches the stylesheet as one attribute on the grid', () => {
    expect(render).toContain('data-design={design}');
    expect(render).toContain("oneOf(props, 'design', ['stacked', 'overlay', 'index'] as const, 'stacked')");
  });
});

describe('words on the picture', () => {
  /*
   * The defect this catches is the one that shipped in the first draft: the
   * frame carries an INLINE aspect-ratio from the ratio control, an inline
   * style beats the stylesheet, and the picture therefore stopped short of the
   * words and dropped them onto the page below the card. Measured at 1.29:1.
   */
  it('gives the frame no inline ratio, because the card owns its shape', () => {
    expect(render).toContain("options.design === 'overlay' ? undefined : ratioStyle(options.ratio)");
  });

  it('carries the contrast on the body, not down the card', () => {
    // A gradient measured down the card only works if you know where the words
    // ended up. The body hugs its own text, so a scrim on it tracks every line.
    expect(css).toContain(".tgs-cards[data-design='overlay'] .tgs-card__body::before");

    // Just that one declaration block, or the window runs on into the phone
    // rules where the CARD legitimately takes a min-height.
    const from = css.indexOf(".tgs-cards[data-design='overlay'] .tgs-card__body {");
    const body = css.slice(from, css.indexOf('\n}', from));
    // No min-height and no grow on the body, or it fills the card and the scrim
    // that tracks it covers the photograph completely.
    expect(body).toContain('flex: none');
    // The DECLARATION, not the word: the comment above it explains why there is
    // no min-height here, and a bare substring check matches the explanation.
    expect(body).not.toMatch(/^\s*min-height:/m);
  });

  it('takes the measured on-dark tokens rather than a flat white', () => {
    const from = css.indexOf(".tgs-cards[data-design='overlay'] .tgs-card__body {");
    const body = css.slice(from, css.indexOf('\n}', from));
    expect(body).toContain('--tgs-text: var(--tgs-text-invert)');
    expect(body).toContain('--tgs-text-muted: var(--tgs-on-dark-muted)');
  });

  /*
   * ANDY FOUND THIS ONE on the first screenshot: the words sat flush against
   * the edge of the photograph.
   *
   * A plain card has its side padding zeroed a few rules up, and that is right
   * for a plain card, which has no box to be indented from. This design breaks
   * the assumption: the finish draws no box, but the PICTURE is one.
   */
  it('insets the words from the edge of the picture, whatever the finish says', () => {
    const from = css.indexOf(".tgs-cards[data-design='overlay'] .tgs-card__body {");
    const body = css.slice(from, css.indexOf('\n}', from));
    expect(body).toMatch(/^\s*padding: var\(--tgs-space-l\);/m);
    // And it has to come after the rule that zeroes it, or it never applies.
    expect(from).toBeGreaterThan(css.indexOf(".tgs-cards[data-style='plain'] .tgs-card__body"));
  });

  it('keeps a long summary from eating the photograph', () => {
    expect(css).toContain(".tgs-cards[data-design='overlay'] .tgs-card__text");
    expect(css).toContain('-webkit-line-clamp: 2');
  });
});

describe('a list, date beside the words', () => {
  it('turns the grid into rows', () => {
    const rule = css.slice(css.indexOf(".tgs-cards[data-design='index'] {"));
    expect(rule.slice(0, 200)).toContain('display: block');
  });

  /*
   * A stacked card puts the date above the title, which is the eyebrow the
   * craft floor bans outright. This design moves the same element into its own
   * column, so the heading opens the row instead of following a label.
   */
  it('puts the date in a column rather than above the heading', () => {
    expect(css).toContain(".tgs-cards[data-design='index'] .tgs-card__label");
    const label = css.slice(css.indexOf(".tgs-cards[data-design='index'] .tgs-card__label"));
    expect(label.slice(0, 200)).toContain('grid-column: 1');
  });

  it('folds the whole row on a phone, not just the body inside it', () => {
    // Folding only the body left the picture beside the words for the row's
    // full height, squeezing titles into three-word lines on a 390px screen.
    const phone = css.slice(css.indexOf('@container tgs-page (max-width: 700px)'));
    expect(phone.slice(0, 1500)).toContain(".tgs-cards[data-design='index'] .tgs-card { flex-direction: column; }");
    expect(phone.slice(0, 1500)).toContain('order: -1');
  });

  it('hides the thumbnail when there is no picture to put in it', () => {
    // A text index should not carry a column of empty grey boxes.
    expect(css).toContain(".tgs-cards[data-design='index'] .tgs-card:has(.tgs-card__noimage) .tgs-card__frame { display: none; }");
  });
});
