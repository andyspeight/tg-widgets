/**
 * The 22 Aug punch list, held so none of its six fixes regress.
 *
 * Each came out of the four-agent review of the Coastwise demo: the heading
 * size trap, the undiscoverable slider tail, captions clipped in the phone
 * scroll region, two star colours on one site, derived theme colours drifting
 * from a committed brand, and a data typeface with nowhere to live.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BLOCKS } from '../lib/content/blocks';
import { parseTheme } from '../lib/theme/schema';
import { themeTokens } from '../lib/theme/tokens';
import { contrastRatio } from '../lib/theme/colour';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const css = source('app', 'globals.css');

// ---------------------------------------------------------------------------

describe('the heading size trap', () => {
  it('a fresh heading looks like the level it claims to be', () => {
    const def = BLOCKS.find((block) => block.type === 'heading');
    const defaults = def?.defaults as Record<string, unknown>;
    // level h2, style h3 is how seventeen pages of banners rendered small.
    expect(defaults.level).toBe(defaults.style);
  });

  it('the editor keeps style following level while the two agree', () => {
    const fields = source('components', 'editor', 'Fields.tsx');
    expect(fields).toContain("field.key === 'level' && onPatch && siblings && siblings.style === current");
    expect(fields).toContain('onPatch({ level: next, style: next })');
  });
});

describe('the slider tail is discoverable', () => {
  it('slide widths guarantee the next card peeks at every container width', () => {
    // Fixed widths divided some containers exactly; the min() cap cannot.
    expect(css).toContain("--tgs-slide: min(340px, calc((100% - 5.5rem) / 3))");
    expect(css).toContain("--tgs-slide: min(260px, calc((100% - 5.5rem) / 4))");
    expect(css).toContain("--tgs-slide: min(440px, calc((100% - 5.5rem) / 2))");
  });
});

describe('table captions clear the phone scroll region', () => {
  it('renders the caption as a figcaption outside the scroller', () => {
    const blocks = source('components', 'render', 'blocks.tsx');
    expect(blocks).toContain('<figure className="tgs-table__figure">');
    expect(blocks).toContain('<figcaption className="tgs-table__caption">');
    expect(blocks).not.toContain('<caption className="tgs-table__caption">');
  });
});

describe('one star colour', () => {
  it('the testimonial slider stars take the rating token, not their own amber', () => {
    expect(css).toContain(".tgs-tsl__star[data-on='true'] { fill: var(--tgs-star, var(--tgs-accent, #f0a13c)); }");
    expect(css).not.toContain('#f5a623');
  });
});

// ---------------------------------------------------------------------------

describe('claimed theme colours', () => {
  it('an override replaces the starting point, never the guard', () => {
    const theme = parseTheme({
      brand: '#1b333d',
      pageBackground: '#f2efe9',
      text: '#14181c',
      surfaceDark: '#1b333d',
      surfaceAlt: '#e7e2d8',
      textMuted: '#4e5960',
    });
    const { style } = themeTokens(theme, []);
    const tokens = style as Record<string, string>;
    // The committed Coastwise values all measure, so they pass straight through.
    expect(tokens['--tgs-surface-dark']).toBe('#1b333d');
    expect(tokens['--tgs-surface-alt']).toBe('#e7e2d8');
    expect(tokens['--tgs-text-muted']).toBe('#4e5960');
  });

  it('a light dark-band claim is honoured, and its text re-measures against it', () => {
    // The guard protects READABILITY, not darkness: readableOn picks the
    // band's text per band, so a pale claim simply gets dark text on it.
    const theme = parseTheme({ surfaceDark: '#dddddd' });
    const tokens = themeTokens(theme, []).style as Record<string, string>;
    expect(tokens['--tgs-surface-dark']).toBe('#dddddd');
    expect(contrastRatio(tokens['--tgs-text-invert'], '#dddddd')).toBeGreaterThanOrEqual(4.5);
  });

  it('a faint-band claim that breaks body text falls back to the derivation', () => {
    const claimed = parseTheme({ surfaceAlt: '#111111' });
    const derived = parseTheme({});
    const a = themeTokens(claimed, []).style as Record<string, string>;
    const b = themeTokens(derived, []).style as Record<string, string>;
    expect(a['--tgs-surface-alt']).toBe(b['--tgs-surface-alt']);
  });

  it('an empty theme derives exactly as it always did', () => {
    const theme = parseTheme({});
    expect(theme.surfaceDark).toBe('');
    expect(theme.surfaceAlt).toBe('');
    expect(theme.textMuted).toBe('');
    expect(theme.dataFamily).toBe('');
  });
});

describe('the data typeface', () => {
  it('emits its token only when the theme names one', () => {
    const without = themeTokens(parseTheme({}), []).style as Record<string, string>;
    expect(without['--tgs-font-data']).toBeUndefined();

    const withMono = themeTokens(parseTheme({ dataFamily: 'mono' }), []).style as Record<string, string>;
    expect(withMono['--tgs-font-data']).toBeTruthy();
  });

  it('key numbers and card labels are the consumers, inheriting when unset', () => {
    expect(css).toMatch(/\.tgs-stats__value \{[^}]*font-family: var\(--tgs-font-data, inherit\)/);
    expect(css).toMatch(/\.tgs-card__label \{[^}]*font-family: var\(--tgs-font-data, inherit\)/);
  });
});
