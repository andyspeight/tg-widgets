/**
 * The contextual toolbar's actions, tested as arithmetic on the tree.
 *
 * The toolbar itself is a React component checked in the browser harness. What
 * lives here is the part that decides WHICH actions an item has and what each
 * one does, which is pure and is where the mistakes hide: a first section
 * offering "move up", a last row still offering "delete" when a section must
 * keep one, a column offering a duplicate it has no op for. Those are caught by
 * reading the returned list, no DOM required.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { itemActions, itemLabel, type ItemActionId } from '../lib/content/item-actions';
import { SEED_PAGE } from '../lib/content/seed';
import { newId } from '../lib/content/factory';
import type { Path } from '../lib/content/tree';

const ids = (path: Path): ItemActionId[] => itemActions(SEED_PAGE, path).map((action) => action.id);

// SEED_PAGE, for reference: 3 sections. s0 is one row of two columns, the first
// holding four blocks. s1 is two rows. s2 is one row of one column, three
// blocks. Every bound the toolbar cares about is somewhere in there.

describe('which actions an item has', () => {
  it('gives the page root none: it is reached by breadcrumb, not by clicking', () => {
    expect(ids({ kind: 'page' })).toEqual([]);
  });

  it('offers a first section no move up, a last one no move down', () => {
    expect(ids({ kind: 'section', section: 0 })).toEqual(['edit', 'add', 'duplicate', 'down', 'delete']);
    expect(ids({ kind: 'section', section: 1 })).toEqual(['edit', 'add', 'duplicate', 'up', 'down', 'delete']);
    expect(ids({ kind: 'section', section: 2 })).toEqual(['edit', 'add', 'duplicate', 'up', 'delete']);
  });

  it('always ends on delete, so the destructive control is the one reached last', () => {
    for (let section = 0; section < SEED_PAGE.sections.length; section += 1) {
      const list = itemActions(SEED_PAGE, { kind: 'section', section });
      expect(list[list.length - 1]?.id).toBe('delete');
      expect(list[list.length - 1]?.danger).toBe(true);
    }
  });

  it('keeps a section at one row: the last row has no delete', () => {
    // s1 has two rows, so each can be deleted.
    expect(ids({ kind: 'row', section: 1, row: 0 })).toContain('delete');
    // s0 has one row, so it cannot.
    expect(ids({ kind: 'row', section: 0, row: 0 })).not.toContain('delete');
  });

  it('gives a column left and right rather than up and down, and no duplicate', () => {
    // s0 r0 has two columns.
    const left = itemActions(SEED_PAGE, { kind: 'column', section: 0, row: 0, column: 0 });
    const right = itemActions(SEED_PAGE, { kind: 'column', section: 0, row: 0, column: 1 });

    expect(left.map((a) => a.id)).not.toContain('duplicate');
    // The first column can go right but not left; the labels say which way.
    expect(left.find((a) => a.id === 'down')?.label).toBe('Move right');
    expect(left.find((a) => a.id === 'up')).toBeUndefined();
    expect(right.find((a) => a.id === 'up')?.label).toBe('Move left');
    expect(right.find((a) => a.id === 'down')).toBeUndefined();
  });

  it('gives a lone column no moves and no delete, only edit and add', () => {
    // s1 r0 has a single column.
    expect(ids({ kind: 'column', section: 1, row: 0, column: 0 })).toEqual(['edit', 'add']);
  });

  it('bounds a block by its place in the column, and always lets it be deleted', () => {
    // s0 r0 c0 has four blocks.
    const first = ids({ kind: 'block', section: 0, row: 0, column: 0, block: 0 });
    const last = ids({ kind: 'block', section: 0, row: 0, column: 0, block: 3 });

    expect(first).toEqual(['edit', 'add', 'duplicate', 'down', 'delete']);
    expect(last).toEqual(['edit', 'add', 'duplicate', 'up', 'delete']);
  });

  it('returns nothing for a path that does not resolve', () => {
    expect(itemActions(SEED_PAGE, { kind: 'section', section: 99 })).toEqual([]);
    expect(itemActions(SEED_PAGE, { kind: 'block', section: 0, row: 0, column: 0, block: 99 })).toEqual([]);
  });
});

describe('what an action does to the tree', () => {
  it('lands a duplicated section immediately after the original, with a fresh id', () => {
    const dup = itemActions(SEED_PAGE, { kind: 'section', section: 0 }).find((a) => a.id === 'duplicate');
    const next = dup!.run!(SEED_PAGE, newId);

    expect(next.sections.length).toBe(SEED_PAGE.sections.length + 1);
    expect(next.sections[1].id).not.toBe(SEED_PAGE.sections[0].id);
    // A copy, not a move: the original is still first.
    expect(next.sections[0].id).toBe(SEED_PAGE.sections[0].id);
  });

  it('moves a section up by swapping it with the one above', () => {
    const up = itemActions(SEED_PAGE, { kind: 'section', section: 1 }).find((a) => a.id === 'up');
    const next = up!.run!(SEED_PAGE, newId);

    expect(next.sections[0].id).toBe(SEED_PAGE.sections[1].id);
    expect(next.sections[1].id).toBe(SEED_PAGE.sections[0].id);
  });

  it('removes the block it is asked to, leaving the rest in order', () => {
    const del = itemActions(SEED_PAGE, { kind: 'block', section: 0, row: 0, column: 0, block: 1 })
      .find((a) => a.id === 'delete');
    const column = () => SEED_PAGE.sections[0].rows[0].columns[0].blocks;
    const before = column().map((b) => b.id);

    const next = del!.run!(SEED_PAGE, newId);
    const after = next.sections[0].rows[0].columns[0].blocks.map((b) => b.id);

    expect(after).toEqual([before[0], before[2], before[3]]);
    // The transform is pure: SEED_PAGE is untouched.
    expect(column().length).toBe(4);
  });
});

describe('the label tab', () => {
  it('names a block by its type, not the bare word Block', () => {
    expect(itemLabel({ kind: 'block', section: 0, row: 0, column: 0, block: 0 }, 'Image')).toBe('Image');
    expect(itemLabel({ kind: 'block', section: 0, row: 0, column: 0, block: 0 })).toBe('Block');
  });

  it('names the containers plainly', () => {
    expect(itemLabel({ kind: 'section', section: 0 })).toBe('Section');
    expect(itemLabel({ kind: 'row', section: 0, row: 0 })).toBe('Row');
    expect(itemLabel({ kind: 'column', section: 0, row: 0, column: 0 })).toBe('Column');
  });
});

describe('the icons resolve', () => {
  /*
   * item-actions names an editor Icon per action as a plain string, and
   * ItemToolbar casts it to IconName. A name with no drawing behind it renders
   * an empty button, which is the icon-set failure this project has hit before.
   * This holds the two lists together without a browser.
   */
  it('every action icon is a real editor icon', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'editor', 'Icon.tsx'), 'utf8');

    // Gather every icon this module can emit, across every kind and both bounds.
    const paths: Path[] = [
      { kind: 'section', section: 1 },
      { kind: 'row', section: 1, row: 0 },
      { kind: 'column', section: 0, row: 0, column: 0 },
      { kind: 'column', section: 0, row: 0, column: 1 },
      { kind: 'block', section: 0, row: 0, column: 0, block: 1 },
    ];
    const icons = new Set(paths.flatMap((path) => itemActions(SEED_PAGE, path).map((a) => a.icon)));
    expect(icons.size).toBeGreaterThan(5);

    for (const icon of icons) {
      // The PATHS map keys the icon set one per line at two-space indent, and a
      // hyphenated name is quoted ('arrow-up':) where a plain one is not (copy:).
      expect(new RegExp(`\\n  '?${icon}'?:`).test(source), `no editor icon "${icon}"`).toBe(true);
    }
  });
});

/*
 * The seams the toolbar depends on, read as source. The behaviour above is the
 * heart of it; these three are the wiring that, if it broke, would leave the
 * heart working and the feature gone.
 */
function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('the toolbar is wired into the editor', () => {
  it('shares one field renderer between the pane and the popover', () => {
    // Both the pane and the popover draw ItemOptions, so a field fixed in one is
    // fixed in both and the two cannot drift.
    expect(read('components', 'editor', 'Properties.tsx')).toContain('export function ItemOptions');
    expect(read('components', 'editor', 'ItemToolbar.tsx')).toContain("import { ItemOptions } from './Properties'");
  });

  it('mounts the toolbar for a canvas item and hands it the editing flag', () => {
    const shell = read('components', 'editor', 'EditorShell.tsx');
    expect(shell).toContain('<ItemToolbar');
    // Dropped while typing, so the pill does not offer Edit over the top of the
    // words you are already editing.
    expect(shell).toContain('editing={!!editing}');
    // Never on the page root, which is a breadcrumb thing rather than a canvas one.
    expect(shell).toContain("selected.kind !== 'page'");
  });

  it('keeps the standalone harness stubbing the import action', () => {
    /*
     * The import action reaches the editor bundle and pulls Postgres with it, so
     * the harness has to swap it. Missing this swap is what silently broke the
     * standalone build once already; this fails loudly if the swap is dropped.
     */
    const build = read('tools', 'build-standalone.mjs');
    expect(build).toContain('app\\/actions\\/import$');
    expect(build).toContain('demo-import-actions.ts');
  });
});
