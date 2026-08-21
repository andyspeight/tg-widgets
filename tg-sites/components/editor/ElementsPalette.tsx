'use client';

/**
 * The elements palette.
 *
 * A panel of every block you can add, always to hand in the left pane, that you
 * drag onto the canvas to place. Andy asked for the Elementor-style panel you
 * drag from rather than opening the + picker first (5 Aug 2026).
 *
 * It sits BESIDE the canvas, not over it, which is the whole point: the drag
 * source and the page are both visible, so a card only has to write the block
 * type onto the drag and the canvas's own drop handling does the rest. There is
 * none of the modal-fade the + picker needs, and so none of its fragility.
 *
 * Clicking a card adds it too, to the selected column, or failing that the end
 * of the page, so the panel is not a mouse-only, drag-only dead end.
 */

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';

import { blockMatches, blocksByGroup, type BlockDefinition } from '../../lib/content/blocks';
import { Icon } from './Icon';

export function ElementsPalette({
  isStaff,
  onAdd,
}: {
  isStaff: boolean;
  /** Click-to-add. The panel decides nothing about where; the shell does. */
  onAdd: (type: string) => void;
}) {
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const groups = blocksByGroup(isStaff)
    .map((group) => ({
      ...group,
      blocks: group.blocks.filter((definition) => blockMatches(definition, needle)),
    }))
    .filter((group) => group.blocks.length > 0);

  return (
    <div className="ed-palette">
      <div className="ed-palette-search">
        <input
          className="ed-input"
          type="search"
          placeholder="Search elements"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <p className="ed-palette-hint">Drag an element onto the page, or click to add it.</p>

      <div className="ed-palette-body">
        {groups.length === 0 && <p className="ed-empty-note">Nothing matches “{query}”.</p>}

        {groups.map((group) => (
          <div key={group.group} className="ed-palette-group">
            <p className="ed-group-title">{group.group}</p>
            <div className="ed-palette-grid">
              {group.blocks.map((definition) => (
                <PaletteCard key={definition.type} definition={definition} onAdd={onAdd} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One draggable element card.
 *
 * Its own component because useDraggable is a hook, one per card. dnd-kit starts
 * a drag only once the pointer has passed the DndContext's activation distance,
 * so a plain click still adds the block. The card itself does not move; the drag
 * ghost is drawn by the DragOverlay up in EditorShell. Touch works for free,
 * which the old native-HTML5 drag never did, and the same hook carries the
 * keyboard and screen-reader wiring the accessibility pass builds on.
 */
function PaletteCard({
  definition,
  onAdd,
}: {
  definition: BlockDefinition;
  onAdd: (type: string) => void;
}) {
  const { setNodeRef, listeners, attributes } = useDraggable({
    id: `palette:${definition.type}`,
    data: { paletteType: definition.type },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className="ed-palette-card"
      title={definition.description}
      onClick={() => onAdd(definition.type)}
      {...attributes}
      {...listeners}
    >
      <span className="ed-palette-card__icon">
        <Icon name={definition.icon} size={18} />
      </span>
      <span className="ed-palette-card__label">{definition.label}</span>
    </button>
  );
}
