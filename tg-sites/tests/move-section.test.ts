/**
 * Dragging a whole section to reorder it.
 *
 * The same one dnd-kit context and the same measured gutter handle as a block
 * move, one level up: the handle on a selected SECTION carries its index, a
 * sibling resolver (useSectionDrop) finds the gap between sections and draws the
 * boundary line, and the shell runs moveSection. The tree op itself is proved in
 * content.test.ts; these read the wiring from source, and the drag is driven in a
 * browser by verify-standalone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('a section is dragged by the same handle, carrying its index', () => {
  const toolbar = read('components', 'editor', 'ItemToolbar.tsx');

  it('offers the handle for a section, carrying its index not column coordinates', () => {
    // moveData falls through to a section when the selection is one; the shell
    // reads moveSection to tell a section move from a block move.
    expect(toolbar).toContain('moveSection: selected.section, moveLabel: label');
  });
});

describe('the section resolver finds the gap and draws the boundary', () => {
  const hook = read('components', 'editor', 'useSectionDrop.ts');

  it('resolves the section under the pointer, and only a section', () => {
    expect(hook).toContain("'.tgs-section[data-path]'");
    expect(hook).toContain('document.elementFromPoint(clientX, clientY)');
    expect(hook).toContain("path.kind !== 'section'");
  });

  it('drops before the section above its middle, after it below', () => {
    expect(hook).toContain('const before = clientY < rect.top + rect.height / 2');
    expect(hook).toContain('const gap = before ? path.section : path.section + 1');
  });

  it('hands the shell the gap on drop, and draws a line while over one', () => {
    expect(hook).toContain('if (gap != null) onDrop(gap)');
    expect(hook).toContain("slot.style.display = 'block'");
  });
});

describe('the shell runs moveSection off the gap and reselects the section', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');

  it('distinguishes a section drag and drives the section resolver', () => {
    expect(shell).toContain("typeof data?.moveSection === 'number'");
    expect(shell).toContain("kind: 'move-section'");
    expect(shell).toContain('if (drag.kind === \'move-section\') sectionDrop.update(x, y)');
    expect(shell).toContain('useSectionDrop(dropSectionOnCanvas)');
  });

  it('turns the current-array gap into the argument moveSection wants', () => {
    const fn = shell.slice(shell.indexOf('const moveSectionAt = useCallback('));
    const body = fn.slice(0, fn.indexOf('[page, commit],'));
    // moveSection counts positions after the dragged section is lifted out, so a
    // gap past the section's own index shifts down by one.
    expect(body).toContain('const to = gap > from ? gap - 1 : gap');
    expect(body).toContain('moveSection(page, from, to)');
    // Reselect by the section's own id in the moved tree, so its handle follows.
    expect(body).toContain('candidate.id === moving.id');
    expect(body).toContain("kind: 'section'");
  });

  it('draws the boundary line off its own slot, and the move chip in the overlay', () => {
    expect(shell).toContain('ref={sectionDrop.slotRef}');
    expect(shell).toContain("activeDrag?.kind === 'move' || activeDrag?.kind === 'move-section'");
  });

  it('imports the section mover it is proven against', () => {
    // moveSection is covered in content.test.ts; wiring it here is what puts it
    // behind the handle.
    expect(shell).toContain('moveSection');
  });
});

describe('the section boundary line is styled', () => {
  const css = read('components', 'editor', 'editor.css');

  it('is a full-width accent bar, hidden until a section drag is over one', () => {
    expect(css).toContain('.ed-section-drop-slot');
    expect(css).toMatch(/\.ed-section-drop-slot \{[\s\S]*?position: fixed/);
    expect(css).toMatch(/\.ed-section-drop-slot \{[\s\S]*?background: var\(--ed-accent\)/);
  });
});
