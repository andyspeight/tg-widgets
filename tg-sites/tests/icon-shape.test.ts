/**
 * Two small elements from the Duda visuals list: one icon on its own, and a
 * decorative shape.
 *
 * BOTH ARE SMALL AND BOTH HAVE ONE THING WORTH PINNING.
 *
 * The icon's is that a LINKED icon needs a name. An anchor whose only content is
 * an aria-hidden SVG announces nothing to a screen reader and gives a keyboard
 * user a control with no idea what it does. The renderer refuses to draw the
 * link at all without a label, which is honest rather than broken.
 *
 * The shape's is that it never outgrows its column. A decorative object that
 * pushes a phone sideways is worse than no decoration.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { isIconName } from '../lib/content/icons';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------

describe('the Icon block', () => {
  const definition = blockDefinition('icon')!;

  it('is in the library, under Media, and belongs to the client', () => {
    expect(isKnownBlock('icon')).toBe(true);
    expect(definition.group).toBe('Media');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('icon');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  /* It opens on a real icon, not on nothing and not on a character. The set is
     drawn as outlines on a 24 by 24 grid; a typed star is the practice this
     whole library replaced. */
  it('arrives with a real icon already chosen', () => {
    expect(isIconName(defaultPropsFor('icon').icon)).toBe(true);
  });

  /*
   * "Icon and text" already existed and is the right block nine times out of
   * ten. This one exists because the way to get a bare icon out of that was to
   * delete the title and the body and leave two empty hosts behind.
   */
  it('is a different block from Icon and text, not a replacement', () => {
    expect(isKnownBlock('icon-item')).toBe(true);
    expect(blockDefinition('icon-item')?.label).toBe('Icon and text');
    expect(definition.label).toBe('Icon');
  });

  const renderer = source('components', 'render', 'blocks.tsx');

  /*
   * THE ACCESSIBILITY RULE, and the one thing here that could quietly ship
   * broken. Both halves are needed: a link with no label is drawn as a plain
   * icon rather than as an anchor nobody can identify.
   */
  it('only draws a link when there is a name to go with it', () => {
    // The condition moved into a `drawn` constant on 21 Aug 2026 when the icon
    // gained a pulse wrapper. Same rule, one line further up.
    expect(renderer).toContain('const drawn = href && label ? (');
    expect(renderer).toContain('aria-label={label}');
  });

  /*
   * THE PULSE GETS ITS OWN WRAPPER, and this is the assertion that keeps it
   * there. `.tgs-icon` is the ALIGNMENT box; turning it into an inline-flex to
   * hang a ring off would break centring and right alignment for every icon on
   * every site. No pulse, no extra element.
   */
  it('wraps the pulse rather than putting it on the alignment box', () => {
    expect(renderer).toContain("pulse === 'none' ? (");
    expect(renderer).toContain('className="tgs-icon__pulse"');
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    expect(css).not.toContain('.tgs-icon[data-pulse');
  });

  /*
   * `<ContentIcon />` is a JSX element whether or not the component returns null
   * from it, so testing the element for truthiness always passes and an unknown
   * name renders an empty box with no explanation.
   */
  it('asks whether the name is real before drawing, not after', () => {
    expect(renderer).toContain('if (!isIconName(name)) return <div className="tgs-placeholder">Choose an icon</div>;');
  });

  /* One number for both dimensions: ContentIcon draws itself 1em square, so the
     size arrives as a font size and the two cannot get out of step. */
  it('sizes with one number rather than a width and a height', () => {
    // Widened from 900 characters: the pulse wrapper and its note sit between
    // the two, and the rule being checked has not changed.
    expect(renderer).toMatch(/IconBlock[\s\S]{0,1400}fontSize: `\$\{size\}px`/);
  });
});

// ---------------------------------------------------------------------------

describe('the Shape block', () => {
  const definition = blockDefinition('shape')!;

  it('is in the library, under Media, and belongs to the client', () => {
    expect(isKnownBlock('shape')).toBe(true);
    expect(definition.group).toBe('Media');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('shape');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  it('offers the six shapes', () => {
    const field = definition.fields.find((f) => f.key === 'shape');
    expect(field && 'options' in field ? field.options.map((o) => o.value) : []).toEqual([
      'circle',
      'ring',
      'square',
      'rounded',
      'triangle',
      'blob',
    ]);
  });

  const css = source('app', 'globals.css');
  const renderer = source('components', 'render', 'blocks.tsx');

  /*
   * THE LOAD-BEARING LINE. The size is a request; without this a 600px shape on
   * a 320px phone pushes the page sideways, which is the one thing a decorative
   * object must never do.
   */
  it('never outgrows its column', () => {
    expect(css).toMatch(/\.tgs-shape__form \{[^}]*max-width: 100%/);
  });

  /* Drawn in CSS: no file to load, nothing to blur at any size, and the colour
     is the client's rather than baked into an asset. */
  it('is drawn in CSS rather than loaded as a file', () => {
    expect(css).toContain(".tgs-shape__form[data-shape='circle'] { border-radius: 50%; }");
    expect(css).toContain(".tgs-shape__form[data-shape='triangle'] { clip-path: polygon(50% 0, 100% 100%, 0 100%); }");
    expect(renderer).not.toMatch(/ShapeBlock[\s\S]{0,900}<img/);
  });

  /* A 400px ring drawn with the same hairline as a 40px one looks like a mistake. */
  it('scales a ring\'s thickness with the ring', () => {
    expect(css).toContain('border: calc(var(--tgs-shape-size, 120px) / 10) solid');
  });

  /*
   * DECORATION, AND SAID SO. A coloured circle behind a heading is not
   * information, and announcing it would put noise between the words that are.
   */
  it('hides itself from a screen reader', () => {
    // The block's own markup, found by anchoring on the class it renders rather
    // than on a character count from the function name.
    expect(renderer).toContain('<div className="tgs-shape__form" data-shape={shape} style={style} aria-hidden="true" />');
  });

  /* A circle and a ring look identical at every angle, so the transform is not
     written rather than written and wasted. */
  it('does not rotate the two shapes rotation cannot change', () => {
    expect(renderer).toContain("rotate && shape !== 'circle' && shape !== 'ring'");
  });
});
