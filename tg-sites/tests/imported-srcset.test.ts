/**
 * An imported design's pictures get a srcset too.
 *
 * WHY THIS IS FIDDLY ENOUGH TO NEED ITS OWN FILE. An imported design keeps its
 * pictures as editable SLOTS: the markup says src="{{tg:i1}}" and the real
 * address lives in the block's content, substituted at render. So at cleaning
 * time there is no address to build a srcset from, and at substitution time
 * there is no way to add an attribute to a tag. The answer is that the cleaner
 * writes the ATTRIBUTE with a placeholder and the substitution fills its value,
 * which is the same operation it already performs for src.
 *
 * Measured before any of this: a four-picture template homepage transferred
 * 1582 KB and landed LCP at 8040 ms on slow 4G with no server time.
 */

import { describe, expect, it } from 'vitest';

import { cleanImportHtml } from '../lib/import/html';
import { applyImportContent, srcsetToken, type ImportField } from '../lib/import/slots';
import type { ImageSizes } from '../lib/content/image-sizes';

const FIELDS: ImportField[] = [
  { key: 'i1', kind: 'image', label: 'Hero', value: 'https://cdn.test/hero.webp' },
  { key: 't1', kind: 'text', label: 'Title', value: 'Rhodes' },
];

const SIZES: ImageSizes = {
  'https://cdn.test/hero.webp': [
    { url: 'https://cdn.test/hero-400.webp', width: 400, height: 225, bytes: 9000 },
    { url: 'https://cdn.test/hero-800.webp', width: 800, height: 450, bytes: 30_000 },
    { url: 'https://cdn.test/hero.webp', width: 2400, height: 1350, bytes: 400_000 },
  ],
};

describe('the cleaner writes the attribute', () => {
  it('gives a slot image a placeholder srcset when a caller asks', () => {
    const { html } = cleanImportHtml('<img src="{{tg:i1}}" alt="x">', { imageSizes: {} });
    expect(html).toContain(`srcset="${srcsetToken('i1')}"`);
    expect(html).toContain('sizes="100vw"');
  });

  it('writes nothing at all when no caller asked', () => {
    /*
     * The save path calls this with no options. Injecting there would bake a
     * placeholder into the client's stored markup, so their saved design would
     * stop being the thing they imported.
     */
    const { html } = cleanImportHtml('<img src="{{tg:i1}}" alt="x">');
    expect(html).not.toContain('tgset:');
    expect(html).not.toContain('srcset');
  });

  it('leaves a design that brought its own srcset alone', () => {
    const { html } = cleanImportHtml(
      '<img src="{{tg:i1}}" srcset="https://cdn.test/a.webp 400w" alt="x">',
      { imageSizes: SIZES },
    );
    expect(html).not.toContain('tgset:');
    expect((html.match(/srcset=/g) ?? []).length).toBe(1);
  });

  it('resolves a literal address immediately, without a placeholder', () => {
    const { html } = cleanImportHtml('<img src="https://cdn.test/hero.webp" alt="x">', {
      imageSizes: SIZES,
    });
    expect(html).toContain('hero-400.webp 400w');
    expect(html).not.toContain('tgset:');
  });

  it('ignores a src that merely contains a token rather than being one', () => {
    const { html } = cleanImportHtml('<img src="/a/{{tg:i1}}/b" alt="x">', { imageSizes: SIZES });
    expect(html).not.toContain('tgset:');
  });
});

describe('the substitution fills the value', () => {
  const markup = `<img src="{{tg:i1}}" srcset="${srcsetToken('i1')}" sizes="100vw">`;

  it('builds the srcset from the address the slot resolves to', () => {
    const out = applyImportContent(markup, { i1: 'https://cdn.test/hero.webp' }, FIELDS, SIZES);
    expect(out).toContain('https://cdn.test/hero-400.webp 400w');
    expect(out).toContain('https://cdn.test/hero-800.webp 800w');
    expect(out).toContain('src="https://cdn.test/hero.webp"');
    expect(out).not.toContain('tgset:');
  });

  it('empties the placeholder when nothing is known about that picture', () => {
    const out = applyImportContent(markup, { i1: 'https://cdn.test/other.webp' }, FIELDS, SIZES);
    expect(out).toContain('srcset=""');
    expect(out).not.toContain('tgset:');
  });

  it('empties the placeholder when no sizes were passed at all', () => {
    const out = applyImportContent(markup, { i1: 'https://cdn.test/hero.webp' }, FIELDS);
    expect(out).toContain('srcset=""');
    expect(out).not.toContain('tgset:');
  });

  it('never substitutes a placeholder that came out of a client\'s own words', () => {
    /*
     * THE ORDERING RULE, AND THE REASON IT IS THE WAY ROUND IT IS. The srcset
     * pass runs first, while the markup is still entirely ours. If it ran after
     * the main pass, a client whose text happened to contain this sequence would
     * have it replaced, which is exactly the re-reading the one-pass rule in
     * applyImportContent exists to prevent.
     */
    const out = applyImportContent(
      `<p>{{tg:t1}}</p>`,
      { t1: `look: ${srcsetToken('i1')}`, i1: 'https://cdn.test/hero.webp' },
      FIELDS,
      SIZES,
    );
    expect(out).toContain('tgset:i1');
    expect(out).not.toContain('hero-400.webp');
  });
});
