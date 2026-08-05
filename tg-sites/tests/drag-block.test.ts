/**
 * Dragging a block off the picker onto the canvas.
 *
 * Andy, 4 Aug 2026: on-page elements you can drag onto the canvas. The first
 * slice keeps the click-to-add and adds drag-to-place on the same cards: the
 * type rides on a private dataTransfer, the modal recedes so the canvas beneath
 * takes the drop, and the block lands in the column it was dropped on rather
 * than the one the picker was opened from. The drop-and-place is driven in a
 * browser (verify-standalone); these read the wiring from source, the same way
 * the other editor-interaction tests do, since the runner has no DOM.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BLOCK_DRAG_MIME } from '../lib/content/tree';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('a block can be dragged off the picker', () => {
  it('names one private drag type, shared so writer and reader cannot drift', () => {
    // A private MIME, so a stray text or file drag is never read as a block.
    expect(BLOCK_DRAG_MIME).toBe('application/x-tg-block');
  });

  it('makes every picker card draggable and writes the type on it', () => {
    const picker = read('components', 'editor', 'BlockPicker.tsx');
    expect(picker).toContain('draggable');
    expect(picker).toContain('event.dataTransfer.setData(BLOCK_DRAG_MIME, definition.type)');
    // The flag the modal watches to recede while a drag is in flight.
    expect(picker).toContain("document.body.dataset.tgDragging = 'block'");
    expect(picker).toContain('delete document.body.dataset.tgDragging');
  });

  it('defers the modal fade a tick so it does not cancel the drag', () => {
    // Mutating the drag source's own container (the scrim turns
    // pointer-events:none) inside dragstart makes Chrome cancel the drag before
    // it begins. The fade must run on the next tick, and dragend must cancel a
    // fade that never got to fire. This is the whole bug; lock it out.
    const picker = read('components', 'editor', 'BlockPicker.tsx');
    expect(picker).toMatch(/setTimeout\(\(\) => \{\s*document\.body\.dataset\.tgDragging = 'block';\s*\}, 0\)/);
    expect(picker).toContain('clearTimeout(fadeTimer.current)');
  });

  it('clears the drag flag when the picker unmounts, not only on dragend', () => {
    // A drop closes the picker, unmounting the card before its dragend fires. If
    // the flag is only cleared on dragend it sticks on, and the scrim-fade CSS
    // then makes every later open of the picker invisible. The unmount cleanup
    // is what stops that.
    const picker = read('components', 'editor', 'BlockPicker.tsx');
    expect(picker).toMatch(
      /useEffect\(\s*\(\) => \(\) => \{[\s\S]*?delete document\.body\.dataset\.tgDragging;[\s\S]*?\},\s*\[\],?\s*\)/,
    );
  });
});

describe('the canvas takes the drop', () => {
  const canvas = read('components', 'editor', 'Canvas.tsx');

  it('accepts a drop only for our own drag type', () => {
    expect(canvas).toContain('event.dataTransfer.types.includes(BLOCK_DRAG_MIME)');
    // preventDefault is what marks a drop zone; the comment says as much.
    expect(canvas).toContain('event.preventDefault()');
    expect(canvas).toContain('onDragOver={onDragOver}');
    expect(canvas).toContain('onDrop={onDrop}');
  });

  it('computes a precise insertion index from the pointer position', () => {
    // Before the first block whose middle is below the pointer, else appended.
    expect(canvas).toContain('event.clientY < r.top + r.height / 2');
    expect(canvas).toContain('let index = blockEls.length');
    // The drop inserts at that index, not always after the hovered block.
    expect(canvas).toContain('at: target.index');
  });

  it('shows a floating drop zone at the insertion point, and hides it after', () => {
    // A filled zone positioned imperatively, not a whole-column highlight.
    expect(canvas).toContain('slot.style.display');
    expect(canvas).toContain("dropSlotRef.current.style.display = 'none'");
    expect(canvas).toContain('<div ref={dropSlotRef} className="ed-drop-slot"');
  });
});

describe('the shell adds the dropped block where it landed', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');

  it('adds at the drop target and index, then closes the picker', () => {
    // The logic lives in addBlockAt now, shared by the canvas drop and the
    // palette; the canvas just passes onDropBlock={addBlockAt}.
    expect(shell).toContain('onDropBlock={addBlockAt}');
    const fn = shell.slice(shell.indexOf('const addBlockAt = useCallback('));
    const body = fn.slice(0, fn.indexOf('[page, commit],'));
    expect(body).toContain('setPicker(null)');
    expect(body).toContain('addBlock(current, target.section, target.row, target.column, createBlock(type), target.at)');
    // The new block is selected, so the pane opens on it as if you had added it.
    expect(body).toContain("kind: 'block'");
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
    // position: fixed so the canvas can place it from viewport rects.
    expect(css).toMatch(/\.ed-drop-slot \{[\s\S]*?position: fixed/);
  });
});
