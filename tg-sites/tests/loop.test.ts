/**
 * The collection loop's binding engine (Elementor gap #1, 31 Aug 2026).
 *
 * These pin the semantics of filling a designed card from one item: which tokens
 * resolve to what, that HTML context is escaped and attribute context is not, that a
 * container's inner blocks are reached, and that the template is never mutated.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { bindBlock, bindCardTemplate, expandLoop, loopCardTemplate, type LoopItem } from '../lib/content/loop';
import { blockDefinition } from '../lib/content/blocks';
import { createBlock } from '../lib/content/factory';
import { hasInnerColumns } from '../lib/content/inner-columns';
import { fillLoops, listingKey, loopIn, loopsIn, type LoopData } from '../lib/content/listings';
import type { FieldDef } from '../lib/content/collection-fields';
import type { Block, Section } from '../lib/content/schema';

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
/** A section holding one row, one column, the given blocks: enough for a tree walk. */
const row = (...blocks: Block[]): Section =>
  ({ rows: [{ columns: [{ blocks }] }] } as unknown as Section);

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

describe('the loop expands a card over items', () => {
  const loopBlock = (template: Block[]): Block => block('loop', {
    source: 'collection', collection: 'tours', count: 6,
    columns: [{ blocks: template }],
  });
  const two: LoopItem[] = [
    { title: 'Fjords', image: 'https://cdn/a.jpg', fields: { price: 1299 }, href: '/tours/fjords' },
    { title: 'Amalfi', image: 'https://cdn/b.jpg', fields: { price: 1599 }, href: '/tours/amalfi' },
  ];

  it('reads the designed card from the first inner column', () => {
    const b = loopBlock([block('heading', { html: '{{title}}' })]);
    const template = loopCardTemplate(b);
    expect(template).toHaveLength(1);
    expect(propsOf(template[0]).html).toBe('{{title}}');
  });

  it('produces one bound, linked cell per item', () => {
    const b = loopBlock([block('heading', { html: '{{title}}' }), block('text', { html: 'From {{field:price}}' })]);
    const out = expandLoop(b, two, [price]);
    const cols = propsOf(out).columns as Array<{ blocks: Block[]; href: string }>;
    expect(cols).toHaveLength(2);
    expect(cols[0].href).toBe('/tours/fjords');
    expect(propsOf(cols[0].blocks[0]).html).toBe('Fjords');
    expect(propsOf(cols[0].blocks[1]).html).toBe('From £1,299');
    expect(cols[1].href).toBe('/tours/amalfi');
    expect(propsOf(cols[1].blocks[1]).html).toBe('From £1,599');
  });

  it('is empty when there are no items, and never touches the stored template', () => {
    const b = loopBlock([block('heading', { html: '{{title}}' })]);
    expect((propsOf(expandLoop(b, [], [])).columns as unknown[]).length).toBe(0);
    // The stored template column is untouched, so the next request re-expands cleanly.
    expandLoop(b, two, [price]);
    const stored = (propsOf(b).columns as Array<{ blocks: Block[] }>)[0].blocks;
    expect(propsOf(stored[0]).html).toBe('{{title}}');
  });

  it('carries each entry title as the whole-card link label', () => {
    const b = loopBlock([block('heading', { html: '{{title}}' })]);
    const cols = propsOf(expandLoop(b, two, [])).columns as Array<{ label: string }>;
    expect(cols[0].label).toBe('Fjords');
    expect(cols[1].label).toBe('Amalfi');
  });
});

describe('the loop block is registered and starts with a designed card', () => {
  it('is in the library and holds columns of its own', () => {
    expect(blockDefinition('loop')).toBeTruthy();
    expect(hasInnerColumns('loop')).toBe(true);
  });

  it('starts with exactly one column, a card of bound tokens', () => {
    const loop = createBlock('loop');
    const columns = (loop.props as { columns: Array<{ blocks: Block[] }> }).columns;
    expect(columns).toHaveLength(1);

    const cardBlocks = columns[0].blocks;
    const byType = (type: string) => cardBlocks.find((blk) => (blk as { type: string }).type === type);
    expect(propsOf(byType('image')!).src).toBe('{{image}}');
    expect(propsOf(byType('heading')!).html).toBe('{{title}}');
    expect(propsOf(byType('text')!).html).toBe('<p>{{summary}}</p>');
    expect(propsOf(byType('button')!).href).toBe('{{link}}');
  });
});

describe('reading a loop block into a request', () => {
  it('returns the collection query for a loop with a collection named', () => {
    const b = block('loop', { collection: 'tours', count: 9, order: 'oldest', columns: [] });
    expect(loopIn(b)).toEqual({
      collection: 'tours',
      count: 9,
      facts: 0,
      order: 'oldest',
      filter: null,
      sort: null,
    });
  });

  it('is null for a non-loop block, and for a loop with no collection', () => {
    expect(loopIn(block('cards', { source: 'collection', collection: 'tours' }))).toBeNull();
    expect(loopIn(block('loop', { collection: '' }))).toBeNull();
    expect(loopIn(block('loop', {}))).toBeNull();
  });

  it('clamps the count and falls back to newest for an unknown order', () => {
    expect(loopIn(block('loop', { collection: 'x', count: 500, order: 'sideways' }))?.count).toBe(60);
    expect(loopIn(block('loop', { collection: 'x', order: 'sideways' }))?.order).toBe('newest');
  });

  it('deduplicates two loops over the same query into one read', () => {
    const one = block('loop', { collection: 'tours', count: 3, order: 'newest' });
    const two = block('loop', { collection: 'tours', count: 8, order: 'newest' });
    const tree = { sections: [row(one, two)] } as unknown as { sections: Section[] };
    const requests = loopsIn([tree]);
    expect(requests).toHaveLength(1);
    // The larger of the two counts, so both cards are served from one read.
    expect(requests[0].count).toBe(8);
  });
});

describe('filling a tree of loops before it renders', () => {
  const tokenCard = () => [block('heading', { html: '{{title}}' }), block('button', { label: 'Go', href: '{{link}}' })];
  const items: LoopItem[] = [
    { title: 'Fjords', href: '/tours/fjords' },
    { title: 'Amalfi', href: '/tours/amalfi' },
  ];

  it('expands a loop block from the feed keyed to its request', () => {
    const loop = block('loop', { collection: 'tours', count: 6, order: 'newest', columns: [{ blocks: tokenCard() }] });
    const tree = { sections: [row(loop)] } as unknown as { sections: Section[] };
    const data: LoopData = new Map([[listingKey(loopIn(loop)!), { items, defs: [] }]]);

    const out = fillLoops(tree, data);
    const filled = out.sections[0].rows[0].columns[0].blocks[0];
    const cols = propsOf(filled).columns as Array<{ blocks: Block[]; href: string }>;
    expect(cols).toHaveLength(2);
    expect(cols[0].href).toBe('/tours/fjords');
    expect(propsOf(cols[0].blocks[0]).html).toBe('Fjords');
    expect(propsOf(cols[1].blocks[1]).href).toBe('/tours/amalfi');
  });

  it('returns the same tree when there is nothing to fill', () => {
    const loop = block('loop', { collection: 'tours', columns: [{ blocks: tokenCard() }] });
    const tree = { sections: [row(loop)] } as unknown as { sections: Section[] };
    expect(fillLoops(tree, new Map())).toBe(tree);
  });

  it('leaves a cards block untouched: a loop fill is not a listing fill', () => {
    const cards = block('cards', { source: 'collection', collection: 'tours', items: [] });
    const tree = { sections: [row(cards)] } as unknown as { sections: Section[] };
    const data: LoopData = new Map([['any-key', { items, defs: [] }]]);
    expect(fillLoops(tree, data).sections[0].rows[0].columns[0].blocks[0]).toBe(cards);
  });
});

const source = (...parts: string[]): string => readFileSync(join(__dirname, '..', ...parts), 'utf8');

describe('the whole-card link is valid and keyboard-safe', () => {
  const css = source('app', 'globals.css');

  it('covers the card with one anchor and lets inner links sit above it', () => {
    // The covering anchor is stretched over the cell, so a click anywhere on the
    // card opens the entry: the same one-anchor pattern the Cards block uses.
    expect(css).toContain('.tgs-loop__cell { position: relative; }');
    const link = /\.tgs-loop\[data-whole='true'\] \.tgs-loop__link \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(link).toContain('position: absolute');
    expect(link).toContain('inset: 0');
    // A bound button inside the card still responds, because interactive
    // descendants are lifted above the covering anchor.
    expect(css).toContain(".tgs-loop[data-whole='true'] .tgs-loop__cell button");
    expect(css).toContain(".tgs-loop[data-whole='true'] .tgs-loop__cell a:not(.tgs-loop__link)");
  });

  it('moves the focus ring to the card, inside the :has guard, like the Cards block', () => {
    const supports =
      [...css.matchAll(/@supports selector\(:has\(\*\)\) \{([\s\S]*?)\n\}/g)]
        .map((match) => match[1])
        .find((body) => body.includes('.tgs-loop__link')) ?? '';
    expect(supports, 'the loop @supports block has gone').not.toBe('');
    expect(supports).toContain(':has(.tgs-loop__link:focus-visible)');
    expect(supports).toContain('outline: 3px solid var(--tgs-accent)');
    expect(supports).toContain('.tgs-loop__link:focus-visible { outline: none; }');
  });
});

describe('the renderer draws an expanded loop, and edits an unexpanded one', () => {
  const renderer = source('components', 'render', 'PageRenderer.tsx');

  it('picks its face by whether the route has expanded the loop', () => {
    // Expanded (published/preview) draws the grid of linked cards; on the canvas
    // it keeps its one template column and is edited exactly as a container is.
    expect(renderer).toContain('loopExpanded(block) ? (');
    expect(renderer).toContain('<InnerLoop');
    expect(renderer).toContain('<LoopEmpty');
  });

  it('reuses the grid layout and lays a covering link over each card', () => {
    expect(renderer).toContain('className="tgs-grid tgs-loop"');
    expect(renderer).toContain('className="tgs-loop__link"');
    // The link's accessible name is the entry title carried on the cell.
    expect(renderer).toContain('aria-label={label || undefined}');
  });
});
