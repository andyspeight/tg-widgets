/**
 * Auto-resize has to reach a size set on the WORDS, and the menu has to become a
 * burger before an iPad, not after it.
 *
 * BOTH BUGS CAME FROM THE SAME SCREENSHOT (Andy, 25 Aug 2026): a Coastwise hero
 * at 834px with the headline still at its desktop size on four lines, above a
 * header broken into three rows.
 *
 * The headline was sized through the toolbar, which writes an inline font-size on
 * a span. An inline style beats any selector, so the auto-resize clamp, which
 * styles the ELEMENT, never reached it. Measured in Chromium against the shipped
 * stylesheet: 100px at 1618, 1100, 834 and 390 alike, where the same size set on
 * the block went 100 / 99 / 75 / 62. And it was the only way to get there, because
 * the block-level control stops at 2.5rem.
 *
 * The header was a separate fault with the same trigger: the menu only collapsed
 * at 767px, and the editor's Tablet is 834px.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { fluidiseInlineSizes } from '../lib/content/fluid-text';

const css = readFileSync(resolve(__dirname, '..', 'app', 'globals.css'), 'utf8');

describe('a size set on the words', () => {
  it('is restated as the custom property the clamp reads', () => {
    const out = fluidiseInlineSizes('<span style="font-size: 100px">Big</span>');
    expect(out).toContain('--tgs-fs-w: 100px');
  });

  it('KEEPS the original size, which is the fallback if the rule ever goes', () => {
    const out = fluidiseInlineSizes('<span style="font-size: 100px">Big</span>');
    expect(out).toContain('font-size: 100px');
  });

  it('carries the other declarations through untouched', () => {
    const out = fluidiseInlineSizes('<span style="color: #fff; font-size: 72px">Hi</span>');
    expect(out).toContain('color: #fff');
    expect(out).toContain('--tgs-fs-w: 72px');
  });

  it('handles a theme token as happily as a pixel size', () => {
    const out = fluidiseInlineSizes('<span style="font-size: var(--tgs-h1-size)">Hi</span>');
    expect(out).toContain('--tgs-fs-w: var(--tgs-h1-size)');
  });

  it('is idempotent, so a second pass cannot double up', () => {
    const once = fluidiseInlineSizes('<span style="font-size: 100px">Big</span>');
    expect(fluidiseInlineSizes(once)).toBe(once);
  });

  it('leaves html with no inline size exactly as it was', () => {
    const plain = '<span style="color: #fff">Plain</span>';
    expect(fluidiseInlineSizes(plain)).toBe(plain);
    expect(fluidiseInlineSizes('Thirty-eight guests.')).toBe('Thirty-eight guests.');
  });
});

describe('the two clamps, which must not drift apart', () => {
  const wordRule = css.slice(css.indexOf("[style*='--tgs-fs-w']"));

  it('the word-level rule exists and reads the custom property', () => {
    expect(css).toContain(".tgs-block[data-fluid] .tgs-heading [style*='--tgs-fs-w']");
    expect(css).toContain(".tgs-block[data-fluid] .tgs-text [style*='--tgs-fs-w']");
  });

  it('uses the same floor and the same middle as the block-level rule', () => {
    // The block-level rule, which is the one this mirrors.
    expect(css).toMatch(/\.tgs-block\[data-fluid\] \.tgs-heading,/);
    expect(css).toMatch(/\* 0\.62\),\s*9cqi/);
    // And the word-level one, on the same two numbers.
    expect(wordRule).toMatch(/calc\(var\(--tgs-fs-w\) \* 0\.62\)/);
    expect(wordRule).toMatch(/9cqi/);
  });

  it('is !important, because that is the only way to beat an inline style', () => {
    expect(wordRule).toMatch(/var\(--tgs-fs-w\)\s*\)\s*!important/);
  });
});

describe('the menu becomes a burger before an iPad, not after it', () => {
  it('collapses at 1023px, the same line the rest of the tablet rules use', () => {
    const at = css.indexOf(".tgs-nav__list[data-collapse='true'] { display: none; }");
    expect(at, 'the collapse rule must still be there').toBeGreaterThan(-1);

    // The container query this rule sits inside is the nearest one above it.
    const queries = [...css.slice(0, at).matchAll(/@container tgs-page \(max-width: (\d+)px\)/g)];
    const enclosing = queries[queries.length - 1]?.[1];
    expect(enclosing, 'the nav must collapse below a laptop, not below a phone').toBe('1023');
  });

  it('still only collapses a menu whose owner asked for one', () => {
    expect(css).toContain(".tgs-nav__list[data-collapse='true']");
  });
});
