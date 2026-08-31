/**
 * The collection loop's binding engine (Elementor gap #1, 31 Aug 2026).
 *
 * These pin the semantics of filling a designed card from one item: which tokens
 * resolve to what, that HTML context is escaped and attribute context is not, that a
 * container's inner blocks are reached, and that the template is never mutated.
 */

import { describe, expect, it } from 'vitest';

import { bindBlock, bindCardTemplate, type LoopItem } from '../lib/content/loop';
import type { FieldDef } from '../lib/content/collection-fields';
import type { Block } from '../lib/content/schema';

const price: FieldDef = { key: 'price', label: 'From', kind: 'price', required: false, choices: [], prefix: '£', suffix: '' };
const nights: FieldDef = { key: 'nights', label: 'Duration', kind: 'number', required: false, choices: [], prefix: '', suffix: ' nights' };

const item: LoopItem = {
  title: 'Seven nights in the fjords',
  summary: 'Sail the Norwegian coast',
  image: 'https://cdn/x/fjords.jpg',
  alt: 'A ship in a fjord',
  author: 'Andy',
  date: 'March 2026',
  tags: ['Cruise', 'Norway'],
  fields: { price: 1299, nights: 7 },
  href: '/tours/fjords',
};

const block = (type: string, props: Record<string, unknown>): Block => ({ type, props } as unknown as Block);
const propsOf = (b: Block) => (b as unknown as { props: Record<string, unknown> }).props;

describe('the loop fills a card from an item', () => {
  it('resolves the fixed-field tokens', () => {
    const out = propsOf(bindBlock(block('heading', { html: '{{title}}' }), item));
    expect(out.html).toBe('Seven nights in the fjords');
    expect(propsOf(bindBlock(block('text', { html: '{{summary}} by {{author}}, {{date}}' }), item)).html)
      .toBe('Sail the Norwegian coast by Andy, March 2026');
    expect(propsOf(bindBlock(block('text', { html: '{{tags}}' }), item)).html).toBe('Cruise, Norway');
  });

  it('resolves an image source and a link, raw (not HTML-escaped)', () => {
    expect(propsOf(bindBlock(block('image', { src: '{{image}}', alt: '{{alt}}' }), item)).src)
      .toBe('https://cdn/x/fjords.jpg');
    expect(propsOf(bindBlock(block('image', { src: '{{image}}', alt: '{{alt}}' }), item)).alt)
      .toBe('A ship in a fjord');
    expect(propsOf(bindBlock(block('button', { label: 'Read more', href: '{{link}}' }), item)).href)
      .toBe('/tours/fjords');
  });

  it('formats a declared field through its definition', () => {
    expect(propsOf(bindBlock(block('text', { html: 'From {{field:price}}' }), item, [price])).html)
      .toBe('From £1,299');
    expect(propsOf(bindBlock(block('heading', { html: '{{field:price}} · {{field:nights}}' }), item, [price, nights])).html)
      .toBe('£1,299 · 7 nights');
  });

  it('escapes a value in an HTML prop but not in an attribute prop', () => {
    const marks: LoopItem = { ...item, title: 'Marks & Spencer <sale>', href: '/x' };
    // In html: escaped, so the ampersand and angle brackets cannot become markup.
    expect(propsOf(bindBlock(block('heading', { html: '{{title}}' }), marks)).html)
      .toBe('Marks &amp; Spencer &lt;sale&gt;');
    // In a non-html prop: raw, left for the renderer's own sanitiser like a typed value.
    expect(propsOf(bindBlock(block('image', { alt: '{{title}}' }), marks)).alt)
      .toBe('Marks & Spencer <sale>');
  });

  it('drops an unknown token and a missing field to an empty string', () => {
    expect(propsOf(bindBlock(block('heading', { html: '{{titel}}' }), item)).html).toBe('');
    expect(propsOf(bindBlock(block('text', { html: 'From {{field:notdeclared}}' }), item, [price])).html).toBe('From ');
    // A field with no value on this item is empty, not a stray token.
    const noPrice: LoopItem = { ...item, fields: {} };
    expect(propsOf(bindBlock(block('text', { html: '{{field:price}}' }), noPrice, [price])).html).toBe('');
  });

  it('reaches the inner blocks of a container', () => {
    const card = block('container', {
      columns: [{ blocks: [block('heading', { html: '{{title}}' }), block('image', { src: '{{image}}' })] }],
    });
    const bound = propsOf(bindBlock(card, item));
    const inner = (bound.columns as Array<{ blocks: Block[] }>)[0].blocks;
    expect(propsOf(inner[0]).html).toBe('Seven nights in the fjords');
    expect(propsOf(inner[1]).src).toBe('https://cdn/x/fjords.jpg');
  });

  it('leaves a token-free string untouched and never mutates the template', () => {
    const label = block('text', { html: 'From' });
    const bound = bindBlock(label, item);
    expect(propsOf(bound).html).toBe('From');
    // The template object is not touched: the binding returns a fresh block.
    const tmpl = block('heading', { html: '{{title}}' });
    bindBlock(tmpl, item);
    expect(propsOf(tmpl).html).toBe('{{title}}');
  });

  it('binds a whole template, one block after another', () => {
    const template = [
      block('image', { src: '{{image}}', alt: '{{alt}}' }),
      block('heading', { html: '{{title}}' }),
      block('text', { html: 'From {{field:price}}' }),
      block('button', { label: 'See the tour', href: '{{link}}' }),
    ];
    const out = bindCardTemplate(template, item, [price]);
    expect(propsOf(out[0]).src).toBe('https://cdn/x/fjords.jpg');
    expect(propsOf(out[1]).html).toBe('Seven nights in the fjords');
    expect(propsOf(out[2]).html).toBe('From £1,299');
    expect(propsOf(out[3]).href).toBe('/tours/fjords');
  });
});
