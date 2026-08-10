/**
 * Dragging a NEW block onto the canvas.
 *
 * Andy, 4 Aug 2026: on-page elements you can drag onto the canvas. The drag is a
 * dnd-kit draggable now, not native HTML5 drag, so the same card works by mouse,
 * touch and keyboard, and one DndContext up in EditorShell owns every drag on the
 * page. The type rides on the draggable's data; the drop maths (which column,
 * which gap, the floating slot) lives in usePaletteDrop so the context can reach
 * it; the block lands where it was dropped rather than where the picker opened.
 * The drop itself is driven in a browser (verify-standalone); these read the
 * wiring from source, the same way the other editor-interaction suites do, since
 * the runner has no DOM.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('a new block is a dnd-kit draggable, off the + picker', () => {
  const picker = read('components', 'editor', 'BlockPicker.tsx');

  it('makes every picker card a draggable carrying the block type', () => {
    // The same source shape the elements palette uses, so the type is read back
    // off the drop rather than off a private dataTransfer MIME.
    expect(picker).toContain('useDraggable');
    expect(picker).toContain('data: { paletteType: definition.type }');
    expect(picker).toContain('`picker:${definition.type}`');
  });

  it('still adds on click, so the picker is not drag-only', () => {
    expect(picker).toContain('onClick={() => onPick(definition.type)}');
  });

  it('keeps none of the old native-drag fade fragility', () => {
    // The whole 5 Aug 2026 bug was native drag: a private dataTransfer, and a
    // modal-fade deferred a tick or Chrome cancelled the drag. dnd-kit drives the
    // drag off the pointer, so there is no dataTransfer to write and no timer to
    // defer. If any of these creep back the fragility is back with them.
    expect(picker).not.toContain('dataTransfer');
    expect(picker).not.toContain('setTimeout');
    expect(picker).not.toContain('BLOCK_DRAG_MIME');
  });
});

describe('the drop maths finds the column, the gap and draws the slot', () => {
  const hook = read('components', 'editor', 'usePaletteDrop.ts');

  it('asks the document what is under the pointer', () => {
    // dnd-kit hands a viewport point; the hook resolves the column from it rather
    // than from a native event.target, which a keyboard or touch drag never has.
    expect(hook).toContain('document.elementFromPoint(clientX, clientY)');
  });

  it('computes a precise insertion index from the pointer', () => {
    // Before the first block whose middle is below the pointer, else appended.
    expect(hook).toContain('let index = blockEls.length');
    expect(hook).toContain('clientY < r.top + r.height / 2');
  });

  it('counts only the column’s own direct blocks, one level deep', () => {
    // A container is ONE block of its outer column; its inner blocks belong to the
    // inner column. The two separators (b for a column, i for an inner column) and
    // the exact-depth filter are what keep a nested block from being miscounted.
    expect(hook).toContain('const isBlock = new RegExp(');
    expect(hook).toContain("sep: 'b'");
    expect(hook).toContain("sep: 'i'");
  });

  it('shows the floating slot while over a column, hides it otherwise', () => {
    // A filled slot positioned imperatively at the gap, not a whole-column wash.
    expect(hook).toContain("slot.style.display = 'block'");
    expect(hook).toContain("slotRef.current.style.display = 'none'");
  });

  it('places at the target and index on drop, through the shell', () => {
    // end() hands the shell the same descriptor the click does: the resolved
    // target plus the gap index, so both land a block the one same way.
    expect(hook).toContain('onDropBlock({ ...drop.target, at: drop.index }, type)');
  });
});

describe('the shell owns the one drag context and the drop', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');

  it('wraps everything in a single pointer-activated DndContext', () => {
    // One context over both the drag source (palette or picker) and the canvas.
    // The activation distance is what lets a plain click still add the block.
    expect(shell).toContain('DndContext');
    expect(shell).toContain('PointerSensor');
    expect(shell).toContain('activationConstraint: { distance: 5 }');
  });

  it('drives the drop hook off the pointer plus how far it moved', () => {
    expect(shell).toContain('usePaletteDrop(addBlockAt)');
    expect(shell).toContain('paletteDrop.update(from.clientX + event.delta.x');
    expect(shell).toContain('ref={paletteDrop.slotRef}');
    expect(shell).toContain('<DragOverlay');
  });

  it('fades the + picker scrim while a drag is live, and clears it after', () => {
    // The picker's modal covers the canvas; the scrim must recede so the drop
    // reaches the page under it. Set once on start, cleared on BOTH end and
    // cancel, so it can never stick on and hide the next open of the picker.
    expect(shell).toContain("document.body.dataset.tgDragging = 'block'");
    const clears = shell.split('delete document.body.dataset.tgDragging').length - 1;
    expect(clears).toBeGreaterThanOrEqual(2);
  });

  it('adds at the drop target and index, closes the picker, selects the block', () => {
    const fn = shell.slice(shell.indexOf('const addBlockAt = useCallback('));
    const body = fn.slice(0, fn.indexOf('[page, commit],'));
    expect(body).toContain('setPicker(null)');
    expect(body).toContain(
      'addBlock(current, target.section, target.row, target.column, createBlock(type), target.at)',
    );
    // The new block is selected, so the pane opens on it as if you had added it.
    expect(body).toContain("kind: 'block'");
  });
});

describe('the canvas no longer runs a native drop of its own', () => {
  const canvas = read('components', 'editor', 'Canvas.tsx');

  it('has handed every drag concern to the dnd-kit context and the hook', () => {
    // The canvas used to carry onDragOver/onDrop and its own drop-slot ref off a
    // native dataTransfer. All of that moved out; if it reappears there are two
    // drag systems again, which is exactly what this PR removed.
    expect(canvas).not.toContain('dataTransfer');
    expect(canvas).not.toContain('onDragOver');
    expect(canvas).not.toContain('dropSlotRef');
  });
});

describe('the stylesheet recedes the modal and marks the drop', () => {
  const css = read('components', 'editor', 'editor.css');

  it('fades the modal to click-through while a block is dragged', () => {
    expect(css).toContain("body[data-tg-dragging='block'] .tg-scrim");
    expect(css).toContain('pointer-events: none');
  });

  it('draws a filled drop zone, hidden until a drag is over a column', () => {
    expect(css).toContain('.ed-drop-slot');
    expect(css).toContain('border: 2px solid var(--ed-accent)');
    // position: fixed so the hook can place it from viewport rects.
    expect(css).toMatch(/\.ed-drop-slot \{[\s\S]*?position: fixed/);
  });
});
