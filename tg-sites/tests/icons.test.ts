/**
 * The icon library.
 *
 * WHAT IS ACTUALLY AT RISK HERE, because it is not whether a plane looks like a
 * plane.
 *
 * The icons arrive as a 558KB JSON file in node_modules, and every one of them
 * is a string of SVG markup. Everything else in this codebase that draws SVG
 * draws markup we wrote by hand, precisely because SVG carries script; this is
 * the one place where the shapes come from somebody else's file, and that file
 * changes whenever the package is updated.
 *
 * So the load-bearing tests here are the two that make the difference between
 * "we looked at it once" and "it cannot happen":
 *
 *   1. THE WHOLE SET IS SCANNED against the element and attribute whitelist.
 *      Not a sample. If a future version of the package introduces a `<use>`,
 *      a `<style>` or an `href`, this suite says so on the day it lands rather
 *      than a client's page quietly losing a shape.
 *
 *   2. THE PARSER IS FED THINGS THE PACKAGE WOULD NEVER CONTAIN, because the
 *      point of parsing rather than using innerHTML is that a compromised file
 *      still cannot reach the DOM. A test that only ever runs real icons
 *      through it proves nothing about that.
 *
 * Everything else, search order and the emoji fallback, is behaviour a client
 * would notice, and is here because it is cheap rather than because it is
 * dangerous.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ICON_ATTRIBUTES,
  ICON_COUNT,
  ICON_ELEMENTS,
  ICON_NAMES,
  iconShapes,
  isIconName,
  parseIconBody,
  REACT_ATTRIBUTE_NAMES,
  safeIconName,
  searchIcons,
} from '../lib/content/icons';

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

describe('the library that arrived', () => {
  it('has the whole set in it, not a subset somebody trimmed', () => {
    expect(ICON_COUNT).toBeGreaterThan(1500);
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(ICON_COUNT);
  });

  it('draws the ones a travel agency will reach for first', () => {
    for (const name of [
      'plane-takeoff', 'luggage', 'hotel', 'bed-double', 'map-pin', 'ship',
      'sailboat', 'umbrella', 'sun', 'shield-check', 'utensils', 'phone',
    ]) {
      expect(iconShapes(name), name).not.toBeNull();
    }
  });

  /*
   * The 217 aliases are the old names of icons that have since been renamed.
   * They matter because somebody searching for a word they remember is exactly
   * who an alias is for, and because a page saved when the old name was current
   * must keep drawing.
   */
  it('still draws an icon that has since been renamed', () => {
    expect(iconShapes('alert-circle')).not.toBeNull();
    expect(isIconName('alert-circle')).toBe(true);
  });

  it('answers with nothing for a name it does not have', () => {
    expect(iconShapes('not-a-real-icon')).toBeNull();
    expect(iconShapes('')).toBeNull();
    expect(iconShapes(null)).toBeNull();
    expect(iconShapes(42)).toBeNull();
    // The one that matters for the fallback: an emoji is not an icon name, so
    // the renderer is told to print it rather than draw it.
    expect(iconShapes('★')).toBeNull();
    expect(iconShapes('🏖️')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The whole set against the whitelist
// ---------------------------------------------------------------------------

describe('every icon in the set, scanned', () => {
  const all = ICON_NAMES.map((name) => ({ name, shapes: iconShapes(name) }));

  it('parses to at least one shape, every one of them', () => {
    const empty = all.filter((entry) => entry.shapes === null).map((entry) => entry.name);
    expect(empty).toEqual([]);
  });

  /*
   * THE POINT OF THE WHOLE FILE. Between them the 1,817 icons use exactly five
   * elements and seventeen attributes, and the parser is written to that. A
   * package update that adds a `<use href="...">` would slip past a spot check
   * and be caught here.
   *
   * If this ever fails it is NOT a licence to widen the whitelist. Read the new
   * element first: `use`, `image`, `style`, `foreignObject` and `script` are all
   * ways to pull something else in, and none of them belongs in an icon.
   */
  it('uses no element and no attribute outside the whitelist', () => {
    const elements = new Set<string>();
    const attributes = new Set<string>();

    for (const { shapes } of all) {
      for (const shape of shapes ?? []) {
        elements.add(shape.element);
        for (const key of Object.keys(shape.attributes)) attributes.add(key);
      }
    }

    // A guard against the whole thing being vacuous: if the scan found nothing
    // the two expectations below would pass on empty sets.
    expect(elements.size).toBeGreaterThan(0);
    expect(attributes.size).toBeGreaterThan(0);

    for (const element of elements) expect(ICON_ELEMENTS, element).toContain(element);
    for (const attribute of attributes) expect(ICON_ATTRIBUTES, attribute).toContain(attribute);
  });

  it('carries no colour of its own, so an icon takes the colour of its text', () => {
    // stroke is the one every Lucide icon sets, and it is always currentColor.
    const wrong = all.flatMap(({ name, shapes }) =>
      (shapes ?? [])
        .filter((shape) => {
          const stroke = shape.attributes.stroke;
          return stroke !== undefined && stroke !== 'currentColor' && stroke !== 'none';
        })
        .map(() => name),
    );

    expect(wrong).toEqual([]);
  });

  /*
   * The two lists have to agree or an attribute is whitelisted and then dropped
   * by the component for want of a React spelling, which would lose a shape's
   * geometry and draw a mangled icon.
   */
  it('has a React spelling for every whitelisted attribute, and no more', () => {
    expect(Object.keys(REACT_ATTRIBUTE_NAMES).sort()).toEqual([...ICON_ATTRIBUTES].sort());
  });
});

// ---------------------------------------------------------------------------
// The parser, fed what the package would never contain
// ---------------------------------------------------------------------------

describe('the parser, on markup the package would never contain', () => {
  /*
   * THE WHOLE REASON THIS IS A PARSER AND NOT innerHTML. Everything above only
   * proves the file in node_modules is clean today. These prove it would not
   * matter if it were not, which is a different and much stronger claim, and
   * the only one that is still true after the next `npm update`.
   *
   * parseIconBody is exported separately from the name lookup precisely so it
   * can be handed these. A test that can only feed the parser real icons
   * cannot show anything about the case that matters.
   */
  it('throws away a script tag and keeps the shape beside it', () => {
    const shapes = parseIconBody('<path d="M0 0"/><script>alert(1)</script>');
    expect(shapes.map((shape) => shape.element)).toEqual(['path']);
  });

  it('throws away an element that could pull something else in', () => {
    // use, image, style and foreignObject are all ways to reach outside the
    // icon. None of them is on the list, so none of them survives.
    const shapes = parseIconBody('<use href="http://evil.test/x.svg"/><rect x="1"/><image href="x"/>');
    expect(shapes.map((shape) => shape.element)).toEqual(['rect']);
  });

  it('throws away an event handler while keeping the geometry', () => {
    const shapes = parseIconBody('<path d="M0 0" onload="alert(1)" onclick="x()"/>');
    expect(shapes[0].element).toBe('path');
    expect(Object.keys(shapes[0].attributes)).toEqual(['d']);
  });

  it('throws away a value trying to be a url or a script', () => {
    const shapes = parseIconBody('<path fill="url(#x)" stroke="javascript:alert(1)" d="M0 0"/>');
    expect(Object.keys(shapes[0].attributes)).toEqual(['d']);
  });

  it('throws away href and xlink:href, which are how an svg fetches', () => {
    const shapes = parseIconBody('<path href="http://evil.test" xlink:href="#x" d="M0 0"/>');
    expect(Object.keys(shapes[0].attributes)).toEqual(['d']);
  });

  it('is left with nothing at all when nothing was legal', () => {
    expect(parseIconBody('<script>alert(1)</script>')).toEqual([]);
    expect(parseIconBody('')).toEqual([]);
    expect(parseIconBody(null)).toEqual([]);
  });

  /*
   * And the same route the renderer actually takes: a name that resolves to a
   * body with no legal shape in it comes back as null rather than as an empty
   * SVG, so the caller can fall back to printing the value instead.
   */
  it('reports a name as undrawable rather than drawing an empty box', () => {
    expect(iconShapes('not-a-real-icon')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The renderer's one decision, read as source
// ---------------------------------------------------------------------------

describe('how the icon item chooses between a picture and a character', () => {
  const source = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
  const block = source.slice(source.indexOf('export function IconItemBlock'));
  /*
   * COMMENTS STRIPPED FIRST, and this one bit immediately. The note in the
   * renderer explaining the bug QUOTES the broken line, so a check looking for
   * the absence of that line found it in the explanation of why it is not
   * there. A source-text assertion has to read code or it is reading prose.
   */
  const body = block
    .slice(0, block.indexOf('\n}\n'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  /*
   * THE BUG THIS EXISTS FOR, written on 1 Aug 2026 and caught by the browser
   * harness rather than by anything here.
   *
   *   const drawn = <ContentIcon name={icon} />;
   *   ... data-kind={drawn ? 'icon' : 'character'}
   *   ... {drawn ?? icon}
   *
   * JSX builds an ELEMENT OBJECT whatever the component will later return, so
   * `drawn` is always truthy. Every value took the icon branch, ContentIcon
   * returned null for anything that was not a name, and a typed emoji rendered
   * as an empty box. On a client's existing site that is every icon they have.
   *
   * So the decision has to be asked of the icon set. Asserting the absence of
   * the broken shape as well as the presence of the right one, because the
   * broken shape is the one somebody would naturally write again.
   */
  it('asks the icon set, not a JSX element that is always truthy', () => {
    expect(body).toContain('const drawable = isIconName(icon);');
    expect(body).not.toMatch(/const drawn = <ContentIcon/);
  });

  it('prints the value as typed when it names no icon', () => {
    expect(body).toContain("data-kind={drawable ? 'icon' : 'character'}");
    expect(body).toContain(': icon}');
  });
});

// ---------------------------------------------------------------------------
// Names, and searching
// ---------------------------------------------------------------------------

describe('what gets stored', () => {
  it('keeps a name and a character alike, since both are legal', () => {
    expect(safeIconName('plane')).toBe('plane');
    expect(safeIconName('★')).toBe('★');
    expect(safeIconName('  plane  ')).toBe('plane');
  });

  it('is not a string, is not stored', () => {
    expect(safeIconName(null)).toBe('');
    expect(safeIconName({ icon: 'plane' })).toBe('');
  });

  it('caps the length, since no icon name is 200 characters', () => {
    expect(safeIconName('x'.repeat(500)).length).toBe(60);
  });
});

describe('searching', () => {
  /*
   * ORDER IS THE WHOLE VALUE. "car" must offer `car` before `shopping-cart`,
   * or the picker is a list of near misses with the answer somewhere below the
   * fold.
   */
  it('puts the exact name first, then what starts with it', () => {
    const results = searchIcons('car', 8);
    expect(results[0]).toBe('car');
    expect(results.indexOf('car')).toBeLessThan(results.indexOf('caravan'));
  });

  /*
   * THE SET SHIPS NO TAGS. Its metadata.json is empty, so without the synonym
   * map a travel agent searching for the most obvious word in their trade gets
   * nothing at all.
   */
  it('finds something for the words a travel agent would type', () => {
    for (const word of ['holiday', 'flight', 'cruise', 'protected', 'atol', 'transfer', 'deals']) {
      expect(searchIcons(word, 5).length, word).toBeGreaterThan(0);
    }
  });

  it('offers a plausible icon for holiday, which the set has no name for', () => {
    const results = searchIcons('holiday', 5);
    expect(results.some((name) => ['palmtree', 'tree-palm', 'sun', 'umbrella'].includes(name))).toBe(true);
  });

  it('never offers a name it cannot draw', () => {
    for (const word of ['holiday', 'atol', 'a', 'e', 'plane', '']) {
      for (const name of searchIcons(word, 40)) {
        expect(iconShapes(name), `${word} offered ${name}`).not.toBeNull();
      }
    }
  });

  it('repeats nothing, even when the synonyms and the names agree', () => {
    const results = searchIcons('luggage', 40);
    expect(new Set(results).size).toBe(results.length);
  });

  it('shows something rather than nothing before anything is typed', () => {
    expect(searchIcons('', 20).length).toBe(20);
  });

  it('stays within the limit it is given', () => {
    expect(searchIcons('a', 7).length).toBeLessThanOrEqual(7);
  });
});
