/**
 * Dragging an already-placed block to move it.
 *
 * The move reuses the whole palette-drag machinery from PR1: one dnd-kit context,
 * one drop-resolution hook (usePaletteDrop), one floating drop line. The only new
 * parts are a second drag SOURCE (a grip on the block's contextual toolbar) and a
 * second landing OP (moveBlockTo instead of addBlock). The shell tells the two
 * apart by which data the drag carries. These read the wiring from source, as the
 * other editor-interaction suites do; the tree op moveBlockTo itself is proved in
 * content.test.ts, and the drop is driven in a browser by verify-standalone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('a placed block is dragged by a handle in the gutter', () => {
  const toolbar = read('components', 'editor', 'ItemToolbar.tsx');

  it('makes the handle a dnd-kit draggable carrying the item’s address', () => {
    // The same source shape the palette uses, so it flows through the one context.
    // moveData carries the block's coordinates (or a section's index) and a label.
    expect(toolbar).toContain('useDraggable');
    expect(toolbar).toContain('data: moveData');
    expect(toolbar).toContain('{ moveFrom, moveLabel: label }');
    expect(toolbar).toContain('className="ed-drag-handle"');
  });

  it('offers the handle for a top-level block, never a container’s inner block', () => {
    // moveBlockTo speaks column coordinates; an inner block has no cross-container
    // mover yet, so it keeps its toolbar up/down and gets no handle. The draggable
    // is disabled rather than skipped, so the hook order never changes.
    expect(toolbar).toMatch(/const moveFrom =\s*\n?\s*selected\.kind === 'block'/);
    expect(toolbar).toContain('disabled: !moveData');
  });

  it('sits in the gutter to the item’s left, so it clears the words and toolbars', () => {
    // The whole reason it is a gutter handle, not a grip in the pill: a text or
    // heading block's formatting toolbar covers the pill and a pointer over the
    // words would start a move. Left of the content, it clears both.
    expect(toolbar).toContain('const handleX = Math.max(w.left + 2, r.left - HANDLE_SIZE - HANDLE_GAP)');
    expect(toolbar).toContain('left: anchor.handleX');
    // A handle on the toolbar overlay, never a native-draggable on the block body.
    expect(toolbar).not.toContain('draggable');
  });
});

describe('the shell tells a move from an add, and runs the right op', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');

  it('discriminates the two drags by their data, on one DndContext', () => {
    // A palette card carries paletteType; the grip carries moveFrom. onDragStart
    // builds one ActiveDrag from whichever is present.
    expect(shell).toContain('data?.paletteType');
    expect(shell).toContain('data?.moveFrom');
    expect(shell).toContain("kind: 'move'");
  });

  it('dispatches the one drop callback to add or to move', () => {
    // usePaletteDrop resolves the same target either way; the shell picks the op.
    const fn = shell.slice(shell.indexOf('const dropOnCanvas = useCallback('));
    const body = fn.slice(0, fn.indexOf('[addBlockAt, moveBlockAt],'));
    expect(body).toContain("if (drag.kind === 'add') addBlockAt(target, drag.type)");
    expect(body).toContain("else if (drag.kind === 'move') moveBlockAt(drag.from, target)");
  });

  it('moves through the tested tree op and refuses a container inner column', () => {
    const fn = shell.slice(shell.indexOf('const moveBlockAt = useCallback('));
    const body = fn.slice(0, fn.indexOf('[page, commit],'));
    // A drop onto a container's inner column is out of scope this slice, so it is
    // refused and the block stays put rather than being half-moved.
    expect(body).toContain('if (target.inner !== undefined) return;');
    expect(body).toContain('moveBlockTo(page, from, {');
    // Reselect by the block's own id in the moved tree, so the toolbar follows it
    // wherever moveBlockTo actually landed it, not an index we recomputed.
    expect(body).toContain('candidate.id === moving.id');
    expect(body).toContain("kind: 'block'");
  });

  it('imports the mover it is proven against', () => {
    // moveBlockTo is covered in content.test.ts (reorder within, and across
    // columns); wiring it here is what puts that behind the grip.
    expect(shell).toContain('moveBlockTo');
  });
});

describe('the move reuses the add’s ghost and drop line, with its own chip', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');

  it('draws a move chip in the same overlay, off the same drop slot', () => {
    expect(shell).toContain('<MoveGhost label={activeDrag.label} />');
    expect(shell).toContain('ref={paletteDrop.slotRef}');
  });

  it('keeps the toolbar and handle out of the drop point while a drag is live', () => {
    const css = read('components', 'editor', 'editor.css');
    expect(css).toContain('body[data-tg-dragging] .ed-drag-handle { pointer-events: none; }');
  });
});
