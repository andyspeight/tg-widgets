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

  it('drops onto a column, after a block or appended to the column', () => {
    // A block drop lands after that block; a column drop appends.
    expect(canvas).toContain('at: path.block + 1');
    expect(canvas).toMatch(/kind === 'column'[\s\S]*?at: undefined/);
    expect(canvas).toContain('onDropBlock({ section: hit.section, row: hit.row, column: hit.column, at: hit.at }, type)');
  });

  it('highlights the column under the drag and clears it after', () => {
    expect(canvas).toContain("el.classList.add('ed-drop-target')");
    expect(canvas).toContain("dropElRef.current?.classList.remove('ed-drop-target')");
  });
});

describe('the shell adds the dropped block where it landed', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');

  it('adds at the drop target and index, then closes the picker', () => {
    const call = shell.slice(shell.indexOf('onDropBlock={'));
    const body = call.slice(0, call.indexOf('theme={siteTheme}'));
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

  it('marks the target column in the editor drag-over colour', () => {
    expect(css).toContain('.ed-canvas-frame .ed-drop-target');
    expect(css).toContain('outline: 2px dashed var(--ed-accent)');
  });
});
