/**
 * The Light / dark switch: the opt-in scan that turns dark mode on, and the dark
 * palette it emits. Both are pure, so they test without a DOM or a database.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hasThemeToggle } from '../lib/content/theme-toggle';
import { darkThemeTokens } from '../lib/theme/tokens';
import { parseTheme } from '../lib/theme/schema';
import { contrastRatio } from '../lib/theme/colour';

/** A tree of one section, one row, one column holding the given blocks. */
function treeWith(blocks: unknown[]): any {
  return { sections: [{ rows: [{ columns: [{ blocks }] }] }] };
}

describe('hasThemeToggle: the opt-in scan', () => {
  it('is false for nothing, and for a tree with no switch', () => {
    expect(hasThemeToggle(null)).toBe(false);
    expect(hasThemeToggle(undefined)).toBe(false);
    expect(hasThemeToggle(treeWith([{ type: 'nav' }, { type: 'search' }]))).toBe(false);
  });

  it('finds a switch sat directly in a bar', () => {
    expect(hasThemeToggle(treeWith([{ type: 'nav' }, { type: 'theme-toggle' }]))).toBe(true);
  });

  it('finds a switch tucked inside an inner container', () => {
    const container = {
      type: 'container',
      props: { columns: [{ blocks: [{ type: 'theme-toggle' }] }] },
    };
    expect(hasThemeToggle(treeWith([container]))).toBe(true);
  });

  it('does not choke on a container with no switch', () => {
    const container = {
      type: 'container',
      props: { columns: [{ blocks: [{ type: 'heading' }] }] },
    };
    expect(hasThemeToggle(treeWith([container]))).toBe(false);
  });
});

describe('darkThemeTokens: the dark palette', () => {
  const theme = parseTheme({});
  const tokens = darkThemeTokens(theme);

  /*
   * EMITTED AND REMAPPED HAVE TO BE THE SAME SET, checked against the stylesheet
   * rather than against a list written here.
   *
   * This test used to name the six tokens of the day. That made it a record of
   * what existed, not a check that the two halves agree, and the two halves
   * failing to agree is the whole failure mode: a token emitted but never
   * remapped does nothing, and a token remapped but never emitted resolves to
   * an empty var() and takes the declaration with it. Deriving both sides means
   * adding a token to the palette without wiring it into the CSS fails here.
   */
  it('emits exactly the tokens the stylesheet swaps in, no more and no fewer', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    const remapped = new Set([...css.matchAll(/var\((--tgs-d-[a-z-]+)\)/g)].map((m) => m[1]));
    const emitted = new Set(Object.keys(tokens));

    for (const token of remapped) {
      expect(emitted.has(token), `${token} is swapped in by globals.css but nothing emits it`).toBe(true);
    }
    for (const token of emitted) {
      expect(remapped.has(token), `${token} is emitted but globals.css never swaps it in`).toBe(true);
    }
  });

  it('makes a dark page and light text on it', () => {
    // The page is genuinely dark: it beats white by a mile and is close to black.
    expect(contrastRatio(tokens['--tgs-d-surface'], '#ffffff')).toBeGreaterThan(10);
    // The text is genuinely light on that page.
    expect(contrastRatio(tokens['--tgs-d-surface'], tokens['--tgs-d-text'])).toBeGreaterThan(10);
  });

  it('keeps body and muted text readable, measured not assumed', () => {
    expect(contrastRatio(tokens['--tgs-d-text'], tokens['--tgs-d-surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens['--tgs-d-text-muted'], tokens['--tgs-d-surface'])).toBeGreaterThanOrEqual(4.5);
  });

  it('carries a trace of the brand rather than a flat grey, and stays dark for any brand', () => {
    // A hot-pink brand still yields a dark page, not a pink one.
    const pink = darkThemeTokens(parseTheme({ brand: '#ff2fb0' }));
    expect(contrastRatio(pink['--tgs-d-surface'], '#ffffff')).toBeGreaterThan(10);
    expect(contrastRatio(pink['--tgs-d-text'], pink['--tgs-d-surface'])).toBeGreaterThanOrEqual(4.5);
    // And the tint actually moves with the brand: navy and pink are not the same dark.
    expect(pink['--tgs-d-surface']).not.toBe(tokens['--tgs-d-surface']);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE BRAND ON A DARK PAGE, measured for every pairing the stylesheet makes.
 *
 * The dark palette originally remapped six tokens and left the brand alone, so
 * --tgs-primary kept the value that had been measured against the LIGHT page.
 * It is not only a fill: globals.css uses it as the colour of a body link, a
 * ghost button's label, a nav hover, an accordion title, a tab and a breadcrumb.
 * On a near-black page that is body text, and it was failing 4.5:1 for seven of
 * the eight brands below, most of them badly: a deep navy at 1.2:1, our own
 * default at 1.4:1.
 *
 * Nobody would have found that by looking. Our own default fails, so every
 * screenshot of dark mode looked internally consistent, and a client with a
 * navy brand would have shipped invisible links. It came out of diffing what
 * themeTokens emits against what the dark block remaps.
 *
 * SO THE GUARD IS A SWEEP, not a case. The brands are chosen to cover the ways
 * this breaks rather than to be pretty: very dark ones, because that is what
 * travel companies use and what fails as text; a mid tone, because that is where
 * neither white nor black fits as a label; a light one, because lifting it must
 * not push it off the top.
 */
describe('the brand stays readable once the page goes dark', () => {
  const BRANDS: Array<[string, string, string]> = [
    ['the Travelgenix default', '', ''],
    ['a deep navy', '#0c2340', '#0c2340'],
    ['a forest green with gold', '#14452f', '#c8a951'],
    ['a burgundy', '#5c0f2b', '#5c0f2b'],
    ['a near-black charcoal', '#1f2328', '#1f2328'],
    ['a teal with coral', '#0f5a6b', '#e2725b'],
    ['a bright coral', '#ff5a5f', '#ff5a5f'],
    ['a mid blue', '#2f6fd0', '#2f6fd0'],
    ['a pale sand, already light', '#e8dcc8', '#e8dcc8'],
    ['pure white', '#ffffff', '#ffffff'],
  ];

  /** Every foreground/background pair the dark stylesheet actually creates. */
  function pairs(t: Record<string, string>): Array<[string, string, string]> {
    const page = t['--tgs-d-surface'];
    const band = t['--tgs-d-primary'];
    return [
      ['a link or ghost button on the page', t['--tgs-d-primary'], page],
      ['the accent used as text on the page', t['--tgs-d-accent'], page],
      ['body text on the page', t['--tgs-d-text'], page],
      ['muted text on the page', t['--tgs-d-text-muted'], page],
      ['a button label on an accent band', t['--tgs-d-on-primary'], band],
      ['muted text on an accent band', t['--tgs-d-on-primary-muted'], band],
      ['a link on an accent band', t['--tgs-d-on-primary-accent'], band],
      ['a label on an accent-coloured button', t['--tgs-d-on-accent'], t['--tgs-d-accent']],
    ];
  }

  for (const [label, brand, accent] of BRANDS) {
    it(`clears body contrast everywhere for ${label}`, () => {
      const theme = parseTheme(brand ? { brand, accent } : {});
      const tokens = darkThemeTokens(theme);
      for (const [what, fg, bg] of pairs(tokens)) {
        expect(fg, `${what}: no colour emitted`).toBeTruthy();
        expect(
          contrastRatio(fg, bg),
          `${what} is ${contrastRatio(fg, bg)}:1 against ${bg}, and body text needs 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('lifts a dark brand rather than replacing it, keeping the hue', () => {
    const navy = darkThemeTokens(parseTheme({ brand: '#0c2340' }));
    const green = darkThemeTokens(parseTheme({ brand: '#14452f' }));
    // Still recognisably a blue and a green, not two greys converged on the same
    // safe value: the lift is a lightening, not a replacement.
    expect(navy['--tgs-d-primary']).not.toBe(green['--tgs-d-primary']);
    const [r, , b] = [1, 3, 5].map((i) => parseInt(navy['--tgs-d-primary'].slice(i, i + 2), 16));
    expect(b, 'the lifted navy has lost its blue').toBeGreaterThan(r);
    const [gr, gg] = [1, 3].map((i) => parseInt(green['--tgs-d-primary'].slice(i, i + 2), 16));
    expect(gg, 'the lifted green has lost its green').toBeGreaterThan(gr);
  });

  it('leaves a brand that already reads on black alone', () => {
    // A bright coral needs no help, so it must arrive unchanged rather than
    // being lightened towards pink for no reason.
    const coral = darkThemeTokens(parseTheme({ brand: '#ff5a5f' }));
    expect(coral['--tgs-d-primary']).toBe('#ff5a5f');
  });
});
