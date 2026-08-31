/**
 * The Grid block: cells that flow into a set number of tracks and wrap.
 *
 * WHY IT EXISTS ALONGSIDE THE INNER CONTAINER, which is the first question
 * anybody reading this will have. A container is ONE ROW of columns sized by
 * hand, so its column count is its content count. A grid's tracks come from a
 * NUMBER, the cells fall into them in order, and a tenth cell in a three-across
 * grid starts a fourth row on its own. Different layout model, different block.
 *
 * WHAT THESE TESTS PIN. The grid reuses the container's storage shape
 * (props.columns), and that reuse is exactly where a bug would hide: the
 * sanitiser, the change classifier, the schema upgrade and the outline all have
 * to reach a grid's cells the same way they reach a container's columns, and a
 * miss in any one of them is silent. lib/content/inner-columns.ts is the single
 * list that makes them agree, so the tests below check the list is actually
 * consulted rather than checking that a string was typed nine times.
 *
 * The three across counts and the per-cell span are the block's own logic and
 * are tested as the pure functions and CSS contracts they are.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blockDefinition,
  blocksByGroup,
  defaultPropsFor,
  isKnownBlock,
  type Field,
} from '../lib/content/blocks';
import { changeScope } from '../lib/content/change-scope';
import { createBlock, createPage } from '../lib/content/factory';
import { COLUMN_BLOCK_TYPES, MAX_GRID_CELLS, hasInnerColumns } from '../lib/content/inner-columns';
import { MAX_COLUMNS_PER_ROW, parsePage, type Page } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';
import {
  addBlock,
  addInnerBlock,
  addInnerColumn,
  containerColumns,
  removeInnerColumn,
  setInnerColumnSpan,
} from '../lib/content/tree';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** The values a select field offers. Only a select has options, hence the guard. */
function optionValues(field: Field | undefined): string[] {
  return field && 'options' in field ? field.options.map((option) => option.value) : [];
}

/** A fresh page with a grid at s0r0c0b0. */
function pageWithGrid(): Page {
  return addBlock(createPage(), 0, 0, 0, createBlock('grid'));
}

/** The grid's cells, read back off the tree. */
function cells(page: Page) {
  return containerColumns(page.sections[0].rows[0].columns[0].blocks[0]);
}

// ---------------------------------------------------------------------------

describe('the grid is a registered block', () => {
  const definition = blockDefinition('grid')!;

  it('is known, sits in Layout, and belongs to the client', () => {
    expect(isKnownBlock('grid')).toBe(true);
    expect(definition.group).toBe('Layout');
    // Not staff-only: a grid is a layout, and layouts are the client's.
    expect(definition.staffOnly).toBeUndefined();
    const layout = blocksByGroup(false).find((entry) => entry.group === 'Layout');
    expect(layout?.blocks.some((b) => b.type === 'grid')).toBe(true);
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('grid');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  /*
   * THE THREE COUNTS ARE THE "ADVANCED" PART. A plain card grid picks its own
   * tablet and phone counts; this one is asked. Without all three the block is
   * a card grid with extra steps.
   */
  it('asks for a count on each of the three screens, one to six', () => {
    for (const key of ['across', 'acrossTablet', 'acrossPhone']) {
      const field = definition.fields.find((f) => f.key === key);
      expect(field?.kind, key).toBe('select');
      expect(optionValues(field), key).toEqual(['1', '2', '3', '4', '5', '6']);
    }
  });

  it('starts three across on a desktop, narrowing to one on a phone', () => {
    const props = defaultPropsFor('grid');
    expect(props.across).toBe('3');
    expect(props.acrossTablet).toBe('2');
    expect(props.acrossPhone).toBe('1');
  });

  /*
   * "Same height" is the option that earns the block its keep: a row of cards
   * whose words differ in length looks wrong without it, and it is the thing
   * hand-built columns get wrong most often.
   */
  it('offers same-height cells, not only the three vertical positions', () => {
    expect(optionValues(definition.fields.find((f) => f.key === 'align'))).toEqual([
      'top',
      'centre',
      'bottom',
      'stretch',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('one list says which blocks hold columns', () => {
  /*
   * The point of lib/content/inner-columns.ts. Nine places ask this question and
   * the failure mode of missing one is quiet: a grid whose inner blocks skip the
   * sanitiser, or that never appears in the outline. These tests are cheap
   * insurance that the list is the thing being consulted.
   */
  it('holds the container, the grid and the loop, and nothing else', () => {
    // The loop joined on 31 Aug 2026: it stores its one designed card as a single
    // inner column, so it needs the same sanitiser, outline and upgrade recursion.
    expect([...COLUMN_BLOCK_TYPES].sort()).toEqual(['container', 'grid', 'loop']);
    expect(hasInnerColumns('grid')).toBe(true);
    expect(hasInnerColumns('container')).toBe(true);
    expect(hasInnerColumns('loop')).toBe(true);
    expect(hasInnerColumns('cards')).toBe(false);
    expect(hasInnerColumns(undefined)).toBe(false);
    expect(hasInnerColumns(42)).toBe(false);
  });

  it('is what the schema, the sanitiser and the editor all read', () => {
    for (const file of [
      ['lib', 'content', 'schema.ts'],
      ['lib', 'content', 'sanitise-page.ts'],
      ['lib', 'content', 'change-scope.ts'],
      ['lib', 'content', 'factory.ts'],
      ['components', 'editor', 'Outline.tsx'],
      ['components', 'editor', 'Properties.tsx'],
      ['components', 'editor', 'EditorShell.tsx'],
    ]) {
      expect(source(...file), file.join('/')).toContain('inner-columns');
    }

    /*
     * THE RENDERER IS THE ONE EXCEPTION, and deliberately so. Every other caller
     * asks "does this block hold columns?" and treats the answer the same way. The
     * renderer asks "WHICH kind?", because a container is a row of sized columns
     * and a grid is wrapping tracks, and that is the one question a shared list
     * cannot answer. So it branches on the two types by name.
     */
    const renderer = source('components', 'render', 'PageRenderer.tsx');
    expect(renderer).toContain("block.type === 'grid' ?");
    expect(renderer).toContain("block.type === 'container' ?");
  });
});

// ---------------------------------------------------------------------------

describe('the cells', () => {
  it('arrives with three, each with its own id and an empty blocks list', () => {
    const list = cells(pageWithGrid());
    expect(list).toHaveLength(3);
    expect(new Set(list.map((c) => c.id)).size).toBe(3);
    for (const cell of list) expect(cell.blocks).toEqual([]);
  });

  /*
   * TWELVE, NOT SIX. A row's six is the point at which a column is too narrow to
   * read, and that reasoning does not transfer: a grid WRAPS, so twelve cells
   * three across is four tidy rows rather than twelve unreadable slivers.
   */
  it('may grow to twelve, where a container still stops at six', () => {
    let page = pageWithGrid();
    for (let i = 0; i < 20; i += 1) page = addInnerColumn(page, 0, 0, 0, 0, MAX_GRID_CELLS);
    expect(cells(page)).toHaveLength(MAX_GRID_CELLS);
    expect(MAX_GRID_CELLS).toBeGreaterThan(MAX_COLUMNS_PER_ROW);

    // The default limit is untouched, so the container is exactly as it was.
    let container = addBlock(createPage(), 0, 0, 0, createBlock('container'));
    for (let i = 0; i < 20; i += 1) container = addInnerColumn(container, 0, 0, 0, 0);
    expect(containerColumns(container.sections[0].rows[0].columns[0].blocks[0])).toHaveLength(
      MAX_COLUMNS_PER_ROW,
    );
  });

  it('rescues the blocks of a removed cell into the one beside it', () => {
    let page = pageWithGrid();
    page = addInnerBlock(page, 0, 0, 0, 0, 1, createBlock('heading'));
    expect(cells(page)[1].blocks).toHaveLength(1);

    page = removeInnerColumn(page, 0, 0, 0, 0, 1);
    expect(cells(page)).toHaveLength(2);
    expect(cells(page)[0].blocks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('a cell that spans more than one track', () => {
  it('stores the span on the cell, so reordering carries it along', () => {
    const page = setInnerColumnSpan(pageWithGrid(), 0, 0, 0, 0, 1, 2);
    expect(cells(page)[1].span).toBe(2);
    // Only that cell. A span is not a shared property of the grid.
    expect(cells(page)[0].span).toBeUndefined();
    expect(cells(page)[2].span).toBeUndefined();
  });

  /*
   * BACK TO ONE REMOVES THE KEY rather than storing the default. A grid nobody
   * has given a featured cell then stores exactly what it stored before spans
   * existed, so the change classifier stays quiet on it.
   */
  it('drops the key when it goes back to one', () => {
    let page = setInnerColumnSpan(pageWithGrid(), 0, 0, 0, 0, 0, 3);
    expect(cells(page)[0].span).toBe(3);
    page = setInnerColumnSpan(page, 0, 0, 0, 0, 0, 1);
    expect('span' in cells(page)[0]).toBe(false);
  });

  it('clamps a silly number rather than inventing a track', () => {
    expect(cells(setInnerColumnSpan(pageWithGrid(), 0, 0, 0, 0, 0, 99))[0].span).toBe(
      MAX_COLUMNS_PER_ROW,
    );
    expect('span' in cells(setInnerColumnSpan(pageWithGrid(), 0, 0, 0, 0, 0, -4))[0]).toBe(false);
    expect(cells(setInnerColumnSpan(pageWithGrid(), 0, 0, 0, 0, 0, 2.4))[0].span).toBe(2);
  });

  it('survives a save and a read, because the schema knows about it', () => {
    const page = setInnerColumnSpan(pageWithGrid(), 0, 0, 0, 0, 1, 2);
    const parsed = parsePage(JSON.parse(JSON.stringify(page)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(containerColumns(parsed.page.sections[0].rows[0].columns[0].blocks[0])[1].span).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('the grid reaches the same machinery a container does', () => {
  /*
   * THE SECURITY PROPERTY, and the reason the grid could not simply be a new
   * renderer. The field-driven sanitiser pass never looks inside props.columns,
   * so if sanitiseBlock did not descend into a grid, a text block dropped into a
   * cell would carry its markup straight through to a live page.
   */
  it('sanitises a block dropped into a cell', () => {
    let page = pageWithGrid();
    page = addInnerBlock(page, 0, 0, 0, 0, 0, {
      id: 'blk-evil',
      type: 'text',
      props: { html: '<p>Hello<script>alert(1)</script></p>' },
    });

    const clean = sanitisePage(page);
    const html = String(containerColumns(clean.sections[0].rows[0].columns[0].blocks[0])[0].blocks[0].props.html);
    expect(html).not.toContain('<script');
    expect(html).toContain('Hello');
  });

  /*
   * A span is a LAYOUT change, so a content-only member must not be able to make
   * it. differsExcept(before, after, 'blocks') on each column is what catches it,
   * and it only runs at all because change-scope asks hasInnerColumns.
   */
  it('counts a span change as structure, not content', () => {
    const before = sanitisePage(pageWithGrid());
    const after = sanitisePage(setInnerColumnSpan(pageWithGrid(), 0, 0, 0, 0, 0, 2));
    // Same ids either side: both come from the same starting page.
    after.sections[0].rows[0].columns[0].blocks[0].id = before.sections[0].rows[0].columns[0].blocks[0].id;
    expect(changeScope(before, after).structure).toBe(true);
  });

  it('counts rewording a block inside a cell as content', () => {
    let page = pageWithGrid();
    page = addInnerBlock(page, 0, 0, 0, 0, 0, {
      id: 'blk-words',
      type: 'text',
      props: { html: '<p>Before</p>' },
    });
    const before = sanitisePage(page);

    const after = JSON.parse(JSON.stringify(before)) as Page;
    const cell = containerColumns(after.sections[0].rows[0].columns[0].blocks[0])[0];
    cell.blocks[0].props.html = '<p>After</p>';
    expect(changeScope(before, after).structure).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('what the stylesheet promises the renderer', () => {
  const css = source('app', 'globals.css');

  /*
   * COUNTS AS CUSTOM PROPERTIES, NOT CLASSES. One to six on each of three screens
   * is eighteen combinations, and eighteen classes is a stylesheet nobody can
   * hold in their head.
   */
  it('takes the track count from a custom property', () => {
    const rule = /\n\.tgs-grid \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('display: grid');
    expect(rule).toContain('repeat(var(--tgs-grid-across, var(--tgs-grid-d, 3)), minmax(0, 1fr))');
  });

  /*
   * KEYED OFF .tgs-page, the same container every other responsive rule uses, so
   * the editor's tablet and phone previews narrow honestly rather than reading
   * the real window width.
   */
  it('swaps that property at the tablet and phone widths, on the page container', () => {
    for (const [width, prop] of [
      ['1023px', '--tgs-grid-t'],
      ['767px', '--tgs-grid-p'],
    ]) {
      const block = new RegExp(
        `@container tgs-page \\(max-width: ${width}\\) \\{[^}]*\\.tgs-grid \\{[^}]*${prop}`,
      );
      expect(block.test(css), width).toBe(true);
    }
  });

  /*
   * The belt to the renderer's braces. The renderer clamps a span to the desktop
   * count; min() means even a stored value that outran the clamp cannot reach a
   * track nothing else does.
   */
  it('clamps a spanning cell to the tracks that actually exist', () => {
    const rule = /\n\.tgs-grid__cell \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('span min(var(--tgs-span, 1)');
  });

  it('has a rule for each of the four alignments', () => {
    for (const value of ['centre', 'bottom', 'stretch']) {
      expect(css, value).toContain(`.tgs-grid[data-align='${value}']`);
    }
    // Top is the base rule rather than a fourth selector.
    expect(/\n\.tgs-grid \{[^}]*align-items: start/.test(css)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('what the editor promises', () => {
  /*
   * A grid gets its OWN cells control. ContainerColumnsControl is width sliders
   * that must sum to 100 and an Even button to put them back, and a grid has no
   * widths at all, so showing it there would be three controls that do nothing.
   */
  it('gives the grid a cells control rather than the container width sliders', () => {
    const properties = source('components', 'editor', 'Properties.tsx');
    expect(properties).toContain('function GridCellsControl');
    expect(properties).toContain("block.type === 'grid' && (\n        <GridCellsControl");
    // The width-sliders control is for a container: not a grid (its own cells
    // control), and not a loop (one card column, nothing to add or remove).
    expect(properties).toContain("block.type !== 'grid' &&");
    expect(properties).toContain("block.type !== 'loop' &&");
    expect(properties).toContain('hasInnerColumns(block.type) && (\n          <ContainerColumnsControl');
  });

  /*
   * "Left" and "Right" are true of a container and false of a grid: the third of
   * nine cells is not on the right of anything, and that label would send a
   * client looking in the wrong place.
   */
  it('names a grid cell by number, never by which side it is on', () => {
    const outline = source('components', 'editor', 'Outline.tsx');
    expect(outline).toContain("block.type === 'grid' ? `Cell ${inner + 1}` : columnWord(inner, columns.length)");
  });

  /*
   * The renderer's own clamp, which the CSS min() then backs up. Read as source
   * because the alternative is standing a whole React tree up for one number.
   */
  it('clamps a span to the desktop count in the renderer too', () => {
    const renderer = source('components', 'render', 'PageRenderer.tsx');
    expect(renderer).toContain('return Math.min(across.desktop, Math.max(1, Math.round(n)));');
    expect(renderer).toContain("'--tgs-grid-d'");
    expect(renderer).toContain("'--tgs-grid-t'");
    expect(renderer).toContain("'--tgs-grid-p'");
  });

  /* A grid is a top-level block, the same rule a container has: no grid inside a
     grid, because the path grammar is one level deep by design. */
  it('refuses to nest one column-holding block inside another', () => {
    const shell = source('components', 'editor', 'EditorShell.tsx');
    expect(shell).toContain("const CONTAINER_ONLY: readonly string[] = ['container', 'grid'];");
  });
});
