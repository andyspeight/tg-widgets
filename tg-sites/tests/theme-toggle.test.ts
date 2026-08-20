/**
 * The Light / dark switch: the opt-in scan that turns dark mode on, and the dark
 * palette it emits. Both are pure, so they test without a DOM or a database.
 */

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

  it('emits exactly the six switchable tokens', () => {
    expect(Object.keys(tokens).sort()).toEqual(
      [
        '--tgs-d-border',
        '--tgs-d-border-strong',
        '--tgs-d-surface',
        '--tgs-d-surface-alt',
        '--tgs-d-text',
        '--tgs-d-text-muted',
      ].sort(),
    );
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
