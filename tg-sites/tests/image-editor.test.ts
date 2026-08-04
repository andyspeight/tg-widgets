/**
 * The image editor: the focus point and the three adjustments.
 *
 * Andy, 3 Aug 2026: "select the exact focus point of the image by clicking on
 * it and then saving", and editing tools for each image. This guards the answer
 * end to end.
 *
 * Two halves, tested the two ways this suite tests them. The pure halves run for
 * real: the block carries the five numbers, its src field asks for the editor,
 * and the save keeps the numbers a click sets rather than dropping them. The
 * renderer half is TSX that vitest is set to leave alone, so the wiring that
 * turns those numbers into object-position and a filter, AND CLAMPS THEM, is
 * read from source the same way the other renderer tests here are. It was also
 * driven in a real browser before shipping: click to set the point, save, and
 * watch the crop hold it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, type Field } from '../lib/content/blocks';
import { sanitiseBlock } from '../lib/content/sanitise-page';
import type { Block } from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------
// The block carries the five numbers, and asks for the editor
// ---------------------------------------------------------------------------

describe('the image block carries a focus point and adjustments', () => {
  const def = blockDefinition('image');

  it('defaults the focus to the middle and the adjustments to untouched', () => {
    expect(def?.defaults).toMatchObject({
      focusX: 50,
      focusY: 50,
      brightness: 100,
      contrast: 100,
      saturation: 100,
    });
  });

  it('turns the editor on from the src field, and from nothing else', () => {
    const fields: readonly Field[] = def?.fields ?? [];
    const owning = fields.filter(
      (f): f is Extract<Field, { kind: 'image' }> => f.kind === 'image' && f.focus === true,
    );
    // Exactly the picture. A caption or a link must not sprout an Edit button
    // that would edit numbers the block beneath it does not carry.
    expect(owning.map((f) => f.key)).toEqual(['src']);
  });
});

// ---------------------------------------------------------------------------
// The numbers a click sets survive the save
// ---------------------------------------------------------------------------

describe('the numbers a click sets survive the save', () => {
  const image = (props: Record<string, unknown>): Block =>
    ({ id: 'i1', type: 'image', props: { src: 'https://x/p.jpg', ...props } }) as Block;

  it('keeps a focus point and the adjustments, because they are the whole point', () => {
    const out = sanitiseBlock(
      image({ focusX: 20, focusY: 80, brightness: 120, contrast: 90, saturation: 140 }),
    );
    expect(out.props).toMatchObject({
      focusX: 20,
      focusY: 80,
      brightness: 120,
      contrast: 90,
      saturation: 140,
    });
  });

  /*
   * The save does NOT clamp them, on purpose, and the render does. These props
   * have no field, so the store copies them through as they arrive, exactly as
   * a picture's width and height already are; the render is the one boundary
   * that turns them into numbers and pins them to a range. So a hostile string
   * set on focusX is stored verbatim here and is still harmless, because the
   * page never reads it as anything but a clamped number. The renderer block
   * below proves that clamp exists.
   */
  it('stores an out-of-range or hostile value untouched, leaving it to the render', () => {
    const nasty = '40; background:url(javascript:alert(1))';
    const out = sanitiseBlock(image({ focusX: nasty }));
    expect(out.props.focusX).toBe(nasty);
  });
});

// ---------------------------------------------------------------------------
// The renderer turns the numbers into safe CSS
// ---------------------------------------------------------------------------

describe('the render pins every number and builds the CSS from it', () => {
  const source = read('components', 'render', 'blocks.tsx');
  // The clamp and the CSS live in one shared helper now, because more than one
  // picture carries these (the image block and a gallery tile), so the boundary
  // that makes them safe is asserted in one place.
  const helper = source.slice(source.indexOf('function pictureAdjustStyle'));
  const helperBody = helper.slice(0, helper.indexOf('\n}\n'));

  it('clamps the focus to a percentage and the adjustments to their range', () => {
    expect(helperBody).toContain('clamp(source.focusX, 0, 100, 50)');
    expect(helperBody).toContain('clamp(source.focusY, 0, 100, 50)');
    expect(helperBody).toContain('clamp(source.brightness, 0, 200, 100)');
    expect(helperBody).toContain('clamp(source.contrast, 0, 200, 100)');
    expect(helperBody).toContain('clamp(source.saturation, 0, 200, 100)');
  });

  it('drives object-position from the clamped focus, not from any stored string', () => {
    expect(helperBody).toMatch(/objectPosition: `\$\{focusX\}% \$\{focusY\}%`/);
  });

  it('emits a filter only for an adjustment that is actually off its default', () => {
    expect(helperBody).toContain('if (brightness !== 100) adjustments.push(`brightness(${brightness}%)`)');
    expect(helperBody).toContain('if (contrast !== 100) adjustments.push(`contrast(${contrast}%)`)');
    expect(helperBody).toContain('if (saturation !== 100) adjustments.push(`saturate(${saturation}%)`)');
    // Nothing off its default means no filter property at all, so an untouched
    // photograph carries no filter to compute.
    expect(helperBody).toMatch(/adjustments\.length \? \{ filter: adjustments\.join\(' '\) \} : \{\}/);
  });

  it('puts the built style on the image block and on every gallery tile', () => {
    // The image block folds it in beside objectFit; the gallery hangs it off the
    // tile it belongs to. Both go through the one helper above.
    expect(source).toContain('objectFit: fit, ...pictureAdjustStyle(props)');
    expect(source).toContain('style={imageStyle}');
    expect(source).toContain('style: pictureAdjustStyle(image)');
    expect(source).toContain('style={image.style}');
  });
});

// ---------------------------------------------------------------------------
// The editor is offered, and only where it belongs
// ---------------------------------------------------------------------------

describe('the Edit button and the editor behind it are wired in', () => {
  it('offers Edit only when the field owns the numbers and can save them', () => {
    const field = read('components', 'media', 'ImageField.tsx');
    expect(field).toContain('const canEdit = Boolean(edit && onPatch)');
    expect(field).toMatch(/canEdit &&[\s\S]*?setEditing\(true\)/);
  });

  it("hands the editor the block's own numbers, read from the src field only", () => {
    const fields = read('components', 'editor', 'Fields.tsx');
    expect(fields).toContain('field.focus');
    expect(fields).toMatch(/focusX: numFrom\(siblings\?\.focusX, 50\)/);
    expect(fields).toMatch(/brightness: numFrom\(siblings\?\.brightness, 100\)/);
  });

  it('turns a click into a percentage of the picture and pins every value', () => {
    const editor = read('components', 'media', 'ImageEditor.tsx');
    // The click and drag turn a pointer position into a point on the picture.
    expect(editor).toContain('((clientX - box.left) / box.width) * 100');
    expect(editor).toContain('((clientY - box.top) / box.height) * 100');
    // And nothing it holds can leave its range before it is shown or saved.
    expect(editor).toContain('function pin(');
  });
});

// ---------------------------------------------------------------------------
// A gallery tile is a picture too
// ---------------------------------------------------------------------------

/*
 * Andy, 4 Aug 2026, having got the focus point on the image block and the
 * section background: the same on gallery tiles. A tile is cropped to a square,
 * so which part of a landscape or a portrait it keeps is exactly the choice the
 * focus point makes.
 */
describe('a gallery tile carries a focus point of its own', () => {
  it('asks for the editor from the tile image, the way the image block does', () => {
    const def = blockDefinition('gallery');
    const images = (def?.fields ?? []).find((f) => f.key === 'images');
    // The repeater's per-tile src field is the one that carries it.
    const tileFields = images && images.kind === 'repeater' ? images.fields : [];
    const src = tileFields.find((f) => f.key === 'src');
    expect(src && src.kind === 'image' && src.focus).toBe(true);
  });

  /*
   * THE REPEATER HANDS EACH FIELD ITS OWN ITEM. Without it, a tile's image field
   * would read the block for its focus point instead of the row it lives on, so
   * the editor would open at the default however that tile was already set, and
   * a saved focus would never show when it was reopened.
   */
  it('gives a tile field the rest of its own row to read', () => {
    const fields = read('components', 'editor', 'Fields.tsx');
    const repeater = fields.slice(fields.indexOf('function Repeater'));
    expect(repeater).toContain('siblings={item}');
  });

  it('keeps a tile\'s focus point and adjustments through the save', () => {
    const block = {
      id: 'g1',
      type: 'gallery',
      props: {
        images: [
          { src: 'https://x/a.jpg', alt: '', focusX: 30, focusY: 70, brightness: 115 },
          { src: 'https://x/b.jpg', alt: '' },
        ],
      },
    } as Block;
    const out = sanitiseBlock(block);
    const tiles = out.props.images as Array<Record<string, unknown>>;
    // The first tile keeps what a click set; the second, untouched, carries none.
    expect(tiles[0]).toMatchObject({ focusX: 30, focusY: 70, brightness: 115 });
    expect(tiles[1].focusX).toBeUndefined();
  });
});
