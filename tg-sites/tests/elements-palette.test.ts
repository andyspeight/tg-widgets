/**
 * The persistent elements palette in the left pane.
 *
 * Andy asked for the Elementor-style panel you drag elements from, rather than
 * opening the + picker first (5 Aug 2026). Because the panel sits beside the
 * canvas rather than over it, it needs NONE of the modal-fade the + picker does:
 * a card just writes the block type onto the drag and the canvas takes it, the
 * same proven path the outline's own drag uses. These read the wiring from
 * source, as the other editor-interaction suites do, since the runner has no DOM.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('the palette drags without the modal-fade fragility', () => {
  const palette = read('components', 'editor', 'ElementsPalette.tsx');

  it('makes every card a dnd-kit draggable carrying the block type', () => {
    // dnd-kit rather than native HTML5 drag now, so the same source works by
    // touch and keyboard. The type rides on the draggable's data, which the
    // shell reads back on drop.
    expect(palette).toContain('useDraggable');
    expect(palette).toContain('data: { paletteType: definition.type }');
  });

  it('never touches the body drag flag, since there is no modal to fade', () => {
    // The whole reason a side panel is the robust design: nothing to fade, so
    // nothing to mutate in dragstart and nothing to leave stuck.
    expect(palette).not.toContain('tgDragging');
    expect(palette).not.toContain('setTimeout');
  });

  it('also adds on click, so the panel is not drag-only', () => {
    expect(palette).toContain('onClick={() => onAdd(definition.type)}');
  });
});

describe('the left pane switches between the outline and the palette', () => {
  const outline = read('components', 'editor', 'Outline.tsx');

  it('renders tabs and the palette', () => {
    expect(outline).toContain('ed-lefttabs');
    expect(outline).toContain("setTab('elements')");
    expect(outline).toContain('<ElementsPalette isStaff={isStaff} onAdd={onAddElement} />');
  });

  it('defaults to the outline, so nothing changes until you ask for elements', () => {
    expect(outline).toMatch(/useState<'outline' \| 'elements'>\('outline'\)/);
  });
});

describe('the shell adds a dropped and a clicked element the one same way', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');

  it('drives the canvas drop through usePaletteDrop, off the same addBlockAt', () => {
    // The drop lands a block exactly as the picker and the click do: one
    // addBlockAt, reached now through the dnd-kit drop hook (via the shared
    // dropOnCanvas dispatcher, which also carries the move) rather than a native
    // onDrop on the canvas.
    expect(shell).toContain('usePaletteDrop(dropOnCanvas)');
    expect(shell).toContain("if (drag.kind === 'add') addBlockAt(target, drag.type)");
    expect(shell).toContain('const addBlockAt = useCallback(');
  });

  it('click-to-add lands in the selection, else the last column', () => {
    // After the selected block if one is selected, else appended to the column,
    // else the last column on the page.
    expect(shell).toContain('const addElement = useCallback(');
    expect(shell).toContain('at: selected.kind === \'block\' ? selected.block + 1 : undefined');
    expect(shell).toContain('onAddElement={addElement}');
  });

  it('passes staffness through so the palette hides staff-only blocks', () => {
    expect(shell).toContain('isStaff={isStaff}');
  });
});
