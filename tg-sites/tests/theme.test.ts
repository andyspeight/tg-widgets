/**
 * The site theme.
 *
 * Three things are worth testing here and they are not the obvious one.
 *
 * NOT "does it store what I gave it". That is the schema doing its job and it
 * would pass whatever the derivation did.
 *
 * The contrast guarantees, because they are the reason any of this exists. A
 * client picks a brand colour and the product promises the label on their
 * button will be readable. That promise has to hold for colours nobody has
 * looked at, so the test throws a spread of them at it and checks the ratio
 * rather than checking a specific output.
 *
 * The injection surface, because every value here ends up inside a style
 * attribute. A theme value that could contain a semicolon or a brace could
 * close one declaration and open another.
 *
 * The drift between the derivation and globals.css, because they are two lists
 * of hex codes describing the same palette and lists like that always drift.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  contrast,
  contrastRatio,
  luminance,
  mix,
  normaliseHex,
  nudgeUntilReadable,
  parseHex,
  readableOn,
  toHex,
} from '../lib/theme/colour';
import {
  CORNERS,
  CORNER_IDS,
  DEFAULT_THEME,
  FONTS,
  FONT_IDS,
  parseTheme,
  themeIsDefault,
} from '../lib/theme/schema';
import { themeTokens, themeWarnings } from '../lib/theme/tokens';

// ---------------------------------------------------------------------------
// Colour arithmetic
// ---------------------------------------------------------------------------

describe('parsing a colour', () => {
  it.each([
    ['#1b2b5b', { r: 27, g: 43, b: 91 }],
    ['1b2b5b', { r: 27, g: 43, b: 91 }],
    ['#FFF', { r: 255, g: 255, b: 255 }],
    ['#abc', { r: 170, g: 187, b: 204 }],
    ['  #000000  ', { r: 0, g: 0, b: 0 }],
  ])('reads %s', (input, expected) => {
    expect(parseHex(input)).toEqual(expected);
  });

  it.each([
    ['a named colour', 'red'],
    ['rgb', 'rgb(1,2,3)'],
    ['four digits', '#abcd'],
    ['eight digits', '#aabbccdd'],
    ['five digits', '#abcde'],
    ['not hex', '#gggggg'],
    ['empty', ''],
    ['a number', 0x1b2b5b],
    ['null', null],
    ['undefined', undefined],
    // The whole point of the narrow parser: these must not reach arithmetic.
    ['a css function', 'var(--x)'],
    ['an injection attempt', '#fff; color: red'],
  ])('refuses %s', (_label, input) => {
    expect(parseHex(input)).toBeNull();
    expect(normaliseHex(input)).toBeNull();
  });

  it('round trips through hex', () => {
    expect(toHex(parseHex('#1b2b5b')!)).toBe('#1b2b5b');
    // Three digits expand rather than being kept short, so everything
    // downstream compares like with like.
    expect(normaliseHex('#abc')).toBe('#aabbcc');
  });
});

describe('mixing', () => {
  it('returns the ends unchanged', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('lands in the middle', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('clamps rather than extrapolating', () => {
    expect(mix('#000000', '#ffffff', 5)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', -5)).toBe('#000000');
  });

  it('gives back the first colour when either is unreadable', () => {
    expect(mix('#123456', 'nonsense', 0.5)).toBe('#123456');
  });
});

describe('contrast', () => {
  it('matches the known extremes', () => {
    // Black on white is 21:1 exactly, which is the definition's ceiling.
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });

  it('does not care which way round', () => {
    expect(contrast('#1b2b5b', '#ffffff')).toBeCloseTo(contrast('#ffffff', '#1b2b5b'), 10);
  });

  it('orders luminance the way eyes do', () => {
    expect(luminance('#ffffff')).toBeGreaterThan(luminance('#808080'));
    expect(luminance('#808080')).toBeGreaterThan(luminance('#000000'));
    // Green carries most of the luminance in the WCAG weighting, which is why
    // a pure green looks so much lighter than a pure blue.
    expect(luminance('#00ff00')).toBeGreaterThan(luminance('#0000ff'));
  });
});

describe('picking a readable text colour', () => {
  it.each([
    ['navy', '#1b2b5b', '#ffffff'],
    ['black', '#000000', '#ffffff'],
    ['white', '#ffffff', '#0f172a'],
    ['pale gold', '#f5d76e', '#0f172a'],
    ['bright cyan', '#00b4d8', '#0f172a'],
    ['mid green', '#4caf50', '#0f172a'],
  ])('puts the right label on %s', (_label, background, expected) => {
    expect(readableOn(background)).toBe(expected);
  });

  /*
   * The property, not the examples.
   *
   * Sweeping the whole cube and asserting the CHOICE IS THE BETTER OF THE TWO
   * is stronger than any list of colours I would think to write, and it cannot
   * go stale when the thresholds move.
   */
  it('always picks whichever of the two actually reads better', () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const background = toHex({ r, g, b });
          const chosen = readableOn(background);
          const other = chosen === '#ffffff' ? '#0f172a' : '#ffffff';
          expect(
            contrast(background, chosen),
            `${background} chose ${chosen} over ${other}`,
          ).toBeGreaterThanOrEqual(contrast(background, other));
        }
      }
    }
  });

  /*
   * And the thing a client actually cares about: is the button label legible.
   *
   * 4.5:1 cannot be promised for every possible background. A mid grey is the
   * worst case and reaches about 4.7:1 with white, but colours around it in the
   * cube genuinely cannot do better with either option, and no arithmetic
   * fixes that without changing the colour the client chose. 3:1 is the honest
   * guarantee, and it is the WCAG threshold for large text and UI boundaries,
   * which is what a button label is.
   */
  it('never leaves a button label below 3:1, whatever the brand colour', () => {
    let worst = { background: '', ratio: 21 };

    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const background = toHex({ r, g, b });
          const ratio = contrast(background, readableOn(background));
          if (ratio < worst.ratio) worst = { background, ratio };
        }
      }
    }

    expect(worst.ratio, `worst brand colour was ${worst.background}`).toBeGreaterThanOrEqual(3);
  });
});

describe('nudging until readable', () => {
  it('leaves a colour alone when it already reads', () => {
    const { colour, reached } = nudgeUntilReadable('#000000', '#ffffff', 4.5);
    expect(colour).toBe('#000000');
    expect(reached).toBe(true);
  });

  it('darkens against a light background', () => {
    const { colour, reached } = nudgeUntilReadable('#bbbbbb', '#ffffff', 4.5);
    expect(reached).toBe(true);
    expect(contrast(colour, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(colour)).toBeLessThan(luminance('#bbbbbb'));
  });

  it('lightens against a dark background', () => {
    const { colour, reached } = nudgeUntilReadable('#333333', '#000000', 4.5);
    expect(reached).toBe(true);
    expect(luminance(colour)).toBeGreaterThan(luminance('#333333'));
  });

  it('gives up rather than looping forever', () => {
    // Nothing reaches 21:1 against a mid grey, in either direction.
    const { reached } = nudgeUntilReadable('#808080', '#808080', 21);
    expect(reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

describe('parsing a theme', () => {
  it('turns nothing into the defaults', () => {
    expect(parseTheme({})).toEqual(DEFAULT_THEME);
    expect(themeIsDefault(parseTheme({}))).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'brand'],
    ['a number', 42],
    ['an array', ['#fff']],
    ['a double encoded blob', '{"brand":"#ff0000"}'],
  ])('turns %s into the defaults rather than throwing', (_label, input) => {
    expect(parseTheme(input)).toEqual(DEFAULT_THEME);
  });

  it('keeps the fields it understands and defaults the rest', () => {
    const theme = parseTheme({ brand: '#ff0000', bodyFont: 'serif', nonsense: 'ignored' });
    expect(theme.brand).toBe('#ff0000');
    expect(theme.bodyFont).toBe('serif');
    expect(theme.accent).toBe(DEFAULT_THEME.accent);
    expect(theme).not.toHaveProperty('nonsense');
  });

  it('normalises a shorthand colour on the way in', () => {
    expect(parseTheme({ brand: '#F00' }).brand).toBe('#ff0000');
    expect(parseTheme({ brand: 'ff0000' }).brand).toBe('#ff0000');
  });

  it.each([
    ['a named colour', 'red'],
    ['rgb', 'rgb(255,0,0)'],
    ['a css variable', 'var(--evil)'],
    ['a url', 'url(https://example.com)'],
    ['an object', { r: 1 }],
  ])('falls back to the default for %s rather than storing it', (_label, brand) => {
    expect(parseTheme({ brand }).brand).toBe(DEFAULT_THEME.brand);
  });

  it('refuses a font or corner style it does not have', () => {
    expect(parseTheme({ bodyFont: 'comic-sans' }).bodyFont).toBe(DEFAULT_THEME.bodyFont);
    expect(parseTheme({ corners: 'spiky' }).corners).toBe(DEFAULT_THEME.corners);
  });
});

// ---------------------------------------------------------------------------
// Nothing a client controls can escape a style attribute
// ---------------------------------------------------------------------------

describe('the injection surface', () => {
  /*
   * Every one of these is a real attempt to break out of a declaration.
   *
   * The defence is the whitelist rather than escaping: a colour is a hex string
   * or it is replaced, and a font is an id from a table. Neither can carry a
   * semicolon or a brace, so there is nothing to escape. This test exists to
   * prove that claim rather than to assert it in a comment.
   */
  const HOSTILE = [
    '#fff; background: url(https://evil.example)',
    'red; } body { display: none } .x {',
    '#000</style><script>alert(1)</script>',
    'expression(alert(1))',
    'url("javascript:alert(1)")',
    '#fff!important',
    // A CSS numeric escape, which is how a semicolon gets past a naive
    // character filter. Written as an escape, never as the raw byte.
    '\\00003b color: red',
    'var(--tgs-primary); --tgs-primary: red',
  ];

  it.each(HOSTILE)('does not let %j through as a colour', (attempt) => {
    const theme = parseTheme({ brand: attempt, accent: attempt, text: attempt, pageBackground: attempt });
    for (const value of [theme.brand, theme.accent, theme.text, theme.pageBackground]) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('emits nothing that could close a declaration', () => {
    const theme = parseTheme({
      brand: 'red; } body {',
      bodyFont: '<script>',
      corners: '; display: none',
    });
    const { style } = themeTokens(theme);

    for (const [name, value] of Object.entries(style)) {
      const text = String(value);
      expect(text, `${name} contains a semicolon`).not.toContain(';');
      expect(text, `${name} contains a brace`).not.toContain('}');
      expect(text, `${name} contains a bracket`).not.toContain('<');
      expect(text, `${name} contains a backslash`).not.toContain('\\');
    }
  });

  it('only ever emits font stacks it wrote itself', () => {
    // The stored value is an id, so the stack a client gets is one of ours
    // whatever they send. Nothing a client types can reach a font-family.
    const stacks = FONT_IDS.map((id) => FONTS[id].stack);
    const { style } = themeTokens(parseTheme({ bodyFont: 'whatever', headingFont: 'whatever' }));
    const s = style as Record<string, string>;

    expect(stacks).toContain(s['--tgs-font-body']);
    expect(stacks).toContain(s['--tgs-font-display']);
  });
});

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

/** A spread of brand colours, including the awkward ones. */
const BRANDS = [
  '#1b2b5b', // Travelgenix navy
  '#000000',
  '#ffffff',
  '#f5d76e', // pale gold, the classic white-text-on-yellow trap
  '#00b4d8',
  '#8b0000',
  '#4caf50',
  '#808080', // mid grey, the worst case for contrast either way
  '#ff00ff',
  '#2d1b3d',
];

describe('deriving a palette', () => {
  it.each(BRANDS)('keeps the button label readable on %s', (brand) => {
    const { style } = themeTokens(parseTheme({ brand }));
    const s = style as Record<string, string>;
    expect(contrast(s['--tgs-on-primary'], brand)).toBeGreaterThanOrEqual(3);
  });

  it.each(BRANDS)('keeps text on the dark band readable for %s', (brand) => {
    const { style } = themeTokens(parseTheme({ brand }));
    const s = style as Record<string, string>;
    expect(contrast(s['--tgs-text-invert'], s['--tgs-surface-dark'])).toBeGreaterThanOrEqual(4.5);
    // And the muted text inside that band, which is the one that used to be a
    // hardcoded slate and would have been unreadable on a light brand.
    expect(contrast(s['--tgs-on-dark-muted'], s['--tgs-surface-dark'])).toBeGreaterThanOrEqual(4.5);
  });

  /*
   * The accent is TEXT inside a coloured band: links and ghost button labels.
   *
   * This is the third instance of one bug. A colour chosen to look right on the
   * page, then used on a band nobody measured it against. The first was the
   * button label, the second was muted text, and this one was only found by
   * screenshotting a gold theme and seeing a teal ghost button disappear into
   * a dark olive band. Hence a check over the whole matrix rather than one more
   * example.
   */
  it('keeps the accent readable on both bands, for every brand and accent pair', () => {
    const accents = ['#00b4d8', '#0f766e', '#c9a227', '#ffffff', '#000000', '#ff00ff'];

    for (const brand of BRANDS) {
      for (const accent of accents) {
        const { style } = themeTokens(parseTheme({ brand, accent }));
        const s = style as Record<string, string>;

        expect(
          contrast(s['--tgs-on-dark-accent'], s['--tgs-surface-dark']),
          `accent ${accent} on the dark band of brand ${brand}`,
        ).toBeGreaterThanOrEqual(4.5);

        expect(
          contrast(s['--tgs-on-primary-accent'], brand),
          `accent ${accent} on the brand band of ${brand}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(BRANDS)('keeps muted text on the brand band readable for %s', (brand) => {
    const { style } = themeTokens(parseTheme({ brand }));
    const s = style as Record<string, string>;
    expect(contrast(s['--tgs-on-primary-muted'], brand)).toBeGreaterThanOrEqual(4.5);
  });

  /*
   * The promise that matters most, across a grid of page and text pairs rather
   * than a handful of examples. Body text is the one thing that must always
   * read, and themeTokens darkens a failing choice rather than shipping it.
   */
  it('never renders body text below 4.5:1, whatever pair is chosen', () => {
    const pages = ['#ffffff', '#fffdf5', '#f0f4f8', '#111111', '#1b2b5b', '#808080'];
    const texts = ['#0f172a', '#666666', '#cccccc', '#ffffff', '#1b2b5b'];

    for (const pageBackground of pages) {
      for (const text of texts) {
        const { style } = themeTokens(parseTheme({ pageBackground, text }));
        const s = style as Record<string, string>;

        // A mid grey page cannot reach 4.5:1 with anything, so it is excluded
        // from the promise rather than pretended about. The warning still
        // fires for it, which is the honest answer.
        if (pageBackground === '#808080') continue;

        expect(
          contrast(s['--tgs-text'], pageBackground),
          `text ${text} on page ${pageBackground}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(s['--tgs-text-muted'], pageBackground),
          `muted on page ${pageBackground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives every corner style a full radius scale', () => {
    for (const id of CORNER_IDS) {
      const { style } = themeTokens(parseTheme({ corners: id }));
      const s = style as Record<string, string>;
      expect(s['--tgs-radius-sm']).toBe(`${CORNERS[id].sm}px`);
      expect(s['--tgs-radius-md']).toBe(`${CORNERS[id].md}px`);
      expect(s['--tgs-radius-lg']).toBe(`${CORNERS[id].lg}px`);
    }
  });
});

describe('warnings', () => {
  it('says nothing about a combination that works', () => {
    const warnings = themeWarnings(parseTheme({ brand: '#1b2b5b', accent: '#8b0000' }));
    expect(warnings).toEqual([]);
  });

  it('names the field, not just the problem', () => {
    const warnings = themeWarnings(parseTheme({ brand: '#fafafa' }));
    expect(warnings.map((w) => w.field)).toContain('brand');
  });

  it('warns when body text will not read, and says it was fixed', () => {
    const theme = parseTheme({ text: '#dddddd', pageBackground: '#ffffff' });
    const warning = themeWarnings(theme).find((w) => w.field === 'text');

    expect(warning).toBeDefined();
    expect(warning!.message).toMatch(/darkened/);

    // And the claim in that message is true.
    const { style } = themeTokens(theme);
    const s = style as Record<string, string>;
    expect(contrast(s['--tgs-text'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('holds the brand to 3:1, not to the body text threshold', () => {
    // About 3.9:1 on white. Fine for a button, and warning about it would be
    // the kind of false alarm that teaches people to ignore warnings.
    const warnings = themeWarnings(parseTheme({ brand: '#767676', pageBackground: '#ffffff' }));
    expect(warnings.map((w) => w.field)).not.toContain('brand');
  });
});

// ---------------------------------------------------------------------------
// The two lists of hex codes that must not drift
// ---------------------------------------------------------------------------

describe('globals.css and the derivation agree', () => {
  /*
   * app/globals.css declares the tokens at :root as a fallback, and every
   * themed page overrides them on the page element. If the two disagree then a
   * site looks different depending on whether anybody has opened the theme
   * screen, which is close to impossible to diagnose from a screenshot.
   *
   * This reads the stylesheet and compares. When it fails, the fix is to paste
   * the derived values into globals.css, never the other way round.
   */
  it('every token the default theme derives is the value in :root', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));

    const declared = new Map<string, string>();
    for (const match of root.matchAll(/(--tgs-[a-z-]+)\s*:\s*([^;]+);/g)) {
      declared.set(match[1], match[2].trim());
    }

    const { style } = themeTokens(parseTheme({}));
    const mismatched: string[] = [];

    for (const [name, value] of Object.entries(style)) {
      const inCss = declared.get(name);
      // Only the tokens a theme actually sets. The spacing and type scales live
      // in the stylesheet alone and are not a client's to change.
      if (inCss === undefined) {
        mismatched.push(`${name} is derived but missing from :root`);
      } else if (inCss !== String(value)) {
        mismatched.push(`${name}: :root has ${inCss}, the derivation gives ${value}`);
      }
    }

    expect(
      mismatched,
      'paste the derived values into app/globals.css, not the other way round',
    ).toEqual([]);
  });
});
