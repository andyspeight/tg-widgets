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

import { BLOCKS, blockDefinition } from '../lib/content/blocks';
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

  it('the fan-out gave heading and list a text colour', () => {
    for (const type of ['heading', 'list']) {
      const tc = blockDefinition(type)?.fields.find((f) => f.key === 'textColour');
      expect(tc?.kind).toBe('colour');
    }
  });
});

describe('the pane groups a review block and the renderer draws the box', () => {
  const props = source('components', 'editor', 'Properties.tsx');
  const renderer = source('components', 'render', 'PageRenderer.tsx');
  const css = source('app', 'globals.css');

  it('curates which box parts each element offers', () => {
    // Image and cards keep their own border/radius, so the box does not repeat
    // it; button styles itself and takes no box; text and the containers take all.
    expect(props).toContain('const BLOCK_DESIGN');
    expect(props).toMatch(/image: \{ bg: true, padding: true, shadow: true \}/);
    expect(props).toMatch(/button: \{\}/);
    expect(props).toContain('heading: FULL_BOX');
  });

  it('reads a field section off its key, border before colour', () => {
    // The whole fan-out rides on this: a block need not annotate its fields.
    expect(props).toContain('function inferGroup');
    expect(props).toMatch(/key\.startsWith\('border'\)\) return 'border'/);
    // Border is tested before the colour catch-all, or borderColour lands wrong.
    const borderAt = props.indexOf("startsWith('border')");
    const colourAt = props.indexOf('/colou?r/i.test(key)');
    expect(borderAt).toBeGreaterThan(-1);
    expect(borderAt).toBeLessThan(colourAt);
  });

  it('renders each present group as a section with only the first open', () => {
    expect(props).toContain('<Group key={group} title={GROUP_LABELS[group]} defaultOpen={index === 0}>');
    // The box commits through the path-dispatch helper now, so the one pane
    // serves a block in a column and a block inside a container alike.
    expect(props).toContain('updateBlockBoxAtPath(current, path, { ...box, ...part })');
    // Every element groups now: there is no flat-list escape hatch left.
    expect(props).not.toContain('definition.fields.map(renderField)');
  });

  it('the renderer applies the box to the block wrapper, guarded and gated', () => {
    expect(renderer).toContain('const box = block.box ?? EMPTY_BOX');
    expect(renderer).toContain('const boxed = !boxIsEmpty(box)');
    expect(renderer).toContain("data-boxed={boxed ? '' : undefined}");
    // The gate now also covers a per-screen text size AND line spacing, so a block
    // with only a size or spacing override still gets its inline custom properties.
    expect(renderer).toContain('style={styled ? style : undefined}');
    expect(renderer).toContain('Boolean(baseSize)');
    expect(renderer).toContain('Boolean(baseLineHeight)');
  });

  it('the stylesheet only styles a block that has a box', () => {
    expect(css).toContain('.tgs-block[data-boxed]');
    expect(css).toContain(".tgs-block[data-boxed][data-shadow='strong']");
  });
});

// ---------------------------------------------------------------------------

/**
 * A SEGMENTED CONTROL ONLY WHEN THE LABELS FIT.
 *
 * Andy, 26 Aug 2026, on a four-option Order control: "make it a dropdown, as
 * you can't read them as they are all truncated at the moment".
 *
 * The rule was the option count alone, four or fewer. That is right for Left /
 * Centre / Right and wrong as soon as the labels are words, and it was never
 * only that one control: twenty-one of the sixty-nine short selects in the
 * catalogue were truncating, the worst of them "Coloured pills, a different
 * colour each" inside a 95px button.
 *
 * The threshold is derived from the CSS rather than picked, so this checks BOTH
 * halves: that the code keys off label length, and that the CSS it was measured
 * against still says what it said. Widen the buttons and this fails, which is
 * the moment to re-derive the number rather than discover it in a screenshot.
 */
describe('a select renders as buttons only when its labels fit', () => {
  const fields = source('components', 'editor', 'Fields.tsx');
  const css = source('components', 'editor', 'editor.css');

  it('decides on the labels, not only on how many there are', () => {
    expect(fields).toContain('const SEGMENTED_MAX_LABEL = 11;');
    expect(fields).toContain('field.options.length <= 4 && fits');
    expect(fields).toContain('option.label.length <= SEGMENTED_MAX_LABEL');
  });

  it('and the CSS the eleven was measured against has not moved', () => {
    const rule = /\.ed-segmented \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule, '.ed-segmented has moved or gone').not.toBe('');
    /*
     * auto-fit with a floor is why the budget is a constant rather than a
     * function of the option count: the buttons WRAP onto another row instead
     * of shrinking, so a fifth of the panel is never what one of them gets.
     */
    expect(rule).toContain('repeat(auto-fit, minmax(56px, 1fr))');

    const button = /\.ed-segmented button \{([^}]*)\}/.exec(css)?.[1] ?? '';
    // The truncation itself. If this ever goes, long labels wrap or overflow
    // instead, and the whole reason for the threshold changes.
    expect(button).toContain('text-overflow: ellipsis');
    expect(button).toContain('font-size: var(--ed-text-sm)');
  });

  it('sends the Order control to a dropdown, which is what prompted this', () => {
    const cards = blockDefinition('cards');
    const order = cards?.fields.find((field) => field.key === 'order');
    expect(order, 'the cards block has no order field').toBeTruthy();
    if (!order || order.kind !== 'select') throw new Error('order is not a select');

    /*
     * Either rule sends it to a dropdown and it does not matter which. It began
     * as four options of twelve characters, which is the length rule; the
     * hand-set order made it five, which is the count rule. Asserting the
     * OUTCOME rather than the count means adding a sixth order does not fail a
     * test about label widths.
     */
    const segmented = order.options.length <= 4 && order.options.every((o) => o.label.length <= 11);
    expect(segmented, 'the Order control would render as truncated buttons').toBe(false);
  });

  it('and the length rule is doing real work, not just covering that one field', () => {
    /*
     * The rule earns its place across the catalogue or it is a special case
     * wearing a general name. These are selects short enough for buttons whose
     * labels are far too long for them, and every one was truncating before.
     */
    const longLabelled = BLOCKS.flatMap((block) =>
      block.fields
        .filter((field) => field.kind === 'select' && field.options.length <= 4)
        .filter((field) =>
          field.kind === 'select' && field.options.some((option) => option.label.length > 11),
        )
        .map((field) => `${block.type}.${field.key}`),
    );

    expect(longLabelled.length, 'no field needs the length rule any more').toBeGreaterThan(5);
  });
});
