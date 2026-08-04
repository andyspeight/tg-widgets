/**
 * A shadow behind a heading, so it stays legible over a photograph.
 *
 * Andy, 4 Aug 2026: headings were getting lost on images, so give them a shadow,
 * for H1 to H6 and NOT paragraphs. It is a block-level choice, off by default, a
 * closed set of two strengths. The block half runs for real here (the fields,
 * the defaults, the save); the render and the stylesheet are read from source
 * the same way the other renderer tests are, and both were driven in a browser
 * before shipping. The one rule that must hold is that a paragraph never takes a
 * shadow, which the Text block's CSS scoping is what guarantees.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition } from '../lib/content/blocks';
import { sanitiseBlock } from '../lib/content/sanitise-page';
import type { Block } from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('the heading and text blocks offer a shadow', () => {
  it('offers it on the heading block, off by default', () => {
    const def = blockDefinition('heading');
    expect(def?.defaults).toMatchObject({ shadow: 'none' });
    const shadow = (def?.fields ?? []).find((f) => f.key === 'shadow');
    expect(shadow?.kind).toBe('select');
    if (shadow && shadow.kind === 'select') {
      expect(shadow.options.map((o) => o.value)).toEqual(['none', 'soft', 'strong']);
    }
  });

  it('offers it on the text block too, for the headings it may hold', () => {
    const def = blockDefinition('text');
    expect(def?.defaults).toMatchObject({ shadow: 'none' });
    const shadow = (def?.fields ?? []).find((f) => f.key === 'shadow');
    expect(shadow?.kind).toBe('select');
    // Labelled to say it is the headings, not the paragraphs, that take it.
    if (shadow && shadow.kind === 'select') {
      expect(shadow.label).toBe('Heading shadow');
    }
  });

  it('keeps the chosen strength through a save', () => {
    const out = sanitiseBlock({
      id: 'h1',
      type: 'heading',
      props: { html: 'Tailor-made Greece', level: 'h2', style: 'h1', shadow: 'strong' },
    } as Block);
    expect(out.props.shadow).toBe('strong');
  });
});

describe('the render puts the shadow on headings, never paragraphs', () => {
  const source = read('components', 'render', 'blocks.tsx');

  it('marks the heading block with its shadow', () => {
    const block = source.slice(source.indexOf('export function HeadingBlock'));
    const body = block.slice(0, block.indexOf('\n}\n'));
    expect(body).toContain("oneOf(props, 'shadow', ['none', 'soft', 'strong'] as const, 'none')");
    expect(body).toContain("data-shadow={shadow === 'none' ? undefined : shadow}");
  });

  it('marks the text block with a heading-scoped shadow, so paragraphs are spared', () => {
    const block = source.slice(source.indexOf('export function TextBlock'));
    const body = block.slice(0, block.indexOf('\n}\n'));
    expect(body).toContain("oneOf(props, 'shadow', ['none', 'soft', 'strong'] as const, 'none')");
    // A heading-specific attribute, because the CSS turns it into a shadow on the
    // block's h1-h6 only, not the block itself and not its paragraphs.
    expect(body).toContain('data-heading-shadow={headingShadow}');
  });
});

describe('the stylesheet shadows only headings', () => {
  const css = read('app', 'globals.css');

  it('has a soft and a strong strength', () => {
    expect(css).toContain("text-shadow: 0 1px 2px rgba(15, 23, 42, 0.35);");
    expect(css).toContain("text-shadow: 0 2px 8px rgba(15, 23, 42, 0.55);");
  });

  it('puts the heading block shadow on the heading tag itself', () => {
    expect(css).toContain(".tgs-heading[data-shadow='soft']");
    expect(css).toContain(".tgs-heading[data-shadow='strong']");
  });

  it('scopes the text block shadow to its headings, so a paragraph is left alone', () => {
    expect(css).toContain(".tgs-text[data-heading-shadow='soft'] :is(h1, h2, h3, h4, h5, h6)");
    expect(css).toContain(".tgs-text[data-heading-shadow='strong'] :is(h1, h2, h3, h4, h5, h6)");
    // The scoping is the whole promise: no rule shadows a bare .tgs-text p.
    expect(css).not.toMatch(/\.tgs-text\[data-heading-shadow[^\n]*\bp\b/);
  });
});
