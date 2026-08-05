/**
 * A design box on every block, and the pane grouped into sections.
 *
 * Andy, 5 Aug 2026: every element needs a full suite of design options
 * (background, colours, border, radius, spacing, shadow), and the right-hand
 * pane should be sections with all but the first collapsed. Blocks had no box at
 * all before this, only sections and columns did. This is the review batch:
 * the box, the renderer and the pane grouping are built once, and applied to
 * four representative elements (text, image, cards, button) to shape the pattern.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition } from '../lib/content/blocks';
import { BlockSchema, EMPTY_BOX } from '../lib/content/schema';
import { createBlock } from '../lib/content/factory';
import { addBlock, updateBlockBox } from '../lib/content/tree';
import { createPage } from '../lib/content/factory';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('a block carries a design box, validated like a section box', () => {
  it('parses a block box, keeping safe values and dropping unsafe colours', () => {
    const parsed = BlockSchema.parse({
      id: 'b1',
      type: 'text',
      props: {},
      box: {
        padding: { top: 12, right: 12, bottom: 12, left: 12 },
        background: '#ff0000',
        borderWidth: 2,
        borderColour: 'red', // a named colour is not on the whitelist
        radius: 8,
        shadow: 'soft',
      },
    });
    expect(parsed.box?.background).toBe('#ff0000');
    expect(parsed.box?.borderWidth).toBe(2);
    expect(parsed.box?.radius).toBe(8);
    expect(parsed.box?.shadow).toBe('soft');
    // 'red' is neither hex, rgb, token nor keyword-we-allow, so it is dropped.
    expect(parsed.box?.borderColour).toBeUndefined();
  });

  it('leaves a block with no box as having no box, not an error', () => {
    const parsed = BlockSchema.parse({ id: 'b2', type: 'text', props: {} });
    expect(parsed.box).toBeUndefined();
  });

  it('a freshly created block starts with an empty box', () => {
    expect(createBlock('text').box).toEqual(EMPTY_BOX);
  });
});

describe('updateBlockBox replaces the box without touching props', () => {
  it('sets the box and leaves the props alone', () => {
    let page = createPage('Home', '/');
    page = addBlock(page, 0, 0, 0, createBlock('text'));
    const before = page.sections[0].rows[0].columns[0].blocks[0];
    const next = { ...EMPTY_BOX, background: '#123456', radius: 10 };
    page = updateBlockBox(page, 0, 0, 0, 0, next);
    const after = page.sections[0].rows[0].columns[0].blocks[0];
    expect(after.box).toEqual(next);
    expect(after.props).toEqual(before.props);
  });
});

describe('the review elements gained the right controls, grouped', () => {
  it('text has a text-colour control in the Colours group', () => {
    const text = blockDefinition('text');
    const tc = text?.fields.find((f) => f.key === 'textColour');
    expect(tc?.kind).toBe('colour');
    expect(tc?.group).toBe('colours');
  });

  it('image keeps its own border controls, grouped under Border', () => {
    const image = blockDefinition('image');
    for (const key of ['radius', 'corners', 'borderWidth', 'borderStyle', 'borderColour']) {
      expect(image?.fields.find((f) => f.key === key)?.group).toBe('border');
    }
  });

  it('button groups its own colours and alignment', () => {
    const button = blockDefinition('button');
    expect(button?.fields.find((f) => f.key === 'colour')?.group).toBe('colours');
    expect(button?.fields.find((f) => f.key === 'textColour')?.group).toBe('colours');
    expect(button?.fields.find((f) => f.key === 'align')?.group).toBe('layout');
  });
});

describe('the pane groups a review block and the renderer draws the box', () => {
  const props = source('components', 'editor', 'Properties.tsx');
  const renderer = source('components', 'render', 'PageRenderer.tsx');
  const css = source('app', 'globals.css');

  it('curates which box parts each review element offers', () => {
    // Image and cards keep their own border/radius, so the box does not repeat
    // it; button styles itself and takes no box.
    expect(props).toContain('const REVIEW_DESIGN');
    expect(props).toMatch(/image: \{ bg: true, padding: true, shadow: true \}/);
    expect(props).toMatch(/button: \{\}/);
  });

  it('renders each present group as a section with only the first open', () => {
    expect(props).toContain('<Group key={group} title={GROUP_LABELS[group]} defaultOpen={index === 0}>');
    expect(props).toContain("updateBlockBox(current, path.section, path.row, path.column, path.block, next)");
  });

  it('the renderer applies the box to the block wrapper, guarded and gated', () => {
    expect(renderer).toContain('const box = block.box ?? EMPTY_BOX');
    expect(renderer).toContain('const boxed = !boxIsEmpty(box)');
    expect(renderer).toContain("data-boxed={boxed ? '' : undefined}");
    expect(renderer).toContain('style={boxed || textColour ? style : undefined}');
  });

  it('the stylesheet only styles a block that has a box', () => {
    expect(css).toContain('.tgs-block[data-boxed]');
    expect(css).toContain(".tgs-block[data-boxed][data-shadow='strong']");
  });
});
