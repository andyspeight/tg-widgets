'use client';

/**
 * The block picker.
 *
 * Opens from an empty column or the + on a column in the outline. Grouped by
 * category, staff-only blocks hidden unless the user is staff.
 */

import { useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { blocksByGroup, type BlockDefinition } from '../../lib/content/blocks';
import { Icon } from './Icon';
import { Modal } from '../ui/Modal';

export function BlockPicker({
  isStaff,
  onPick,
  onClose,
  exclude,
}: {
  isStaff: boolean;
  onPick: (type: string) => void;
  onClose: () => void;
  /**
   * Block types to leave out, whatever the search says. Used when the picker
   * was opened from a container's inner column, which may not hold another
   * container: the model nests exactly one level. Absent means offer them all.
   */
  exclude?: readonly string[];
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Escape, the scrim and the focus trap all belong to Modal. Modal also
  // moves focus to the first control, which here is the search box.
  //
  // Dragging a card onto the canvas is a dnd-kit draggable now (see BlockCard),
  // the same source the elements palette uses. The DndContext up in EditorShell
  // fades this modal's scrim while a drag is live, so there is no per-card flag
  // to set here and nothing to leave stuck on unmount — the old native-drag
  // fade-on-a-timer fragility is gone with it (5 Aug 2026).

  const needle = query.trim().toLowerCase();
  const groups = blocksByGroup(isStaff)
    .map((group) => ({
      ...group,
      blocks: group.blocks.filter(
        (definition) =>
          !exclude?.includes(definition.type) &&
          (!needle ||
            definition.label.toLowerCase().includes(needle) ||
            definition.description.toLowerCase().includes(needle)),
      ),
    }))
    .filter((group) => group.blocks.length > 0);

  return (
    <Modal
      title="Add a block"
      description="Click to drop it in, or drag it onto the canvas to place it exactly."
      size="large"
      onClose={onClose}
    >
          <div className="ed-field">
            <input
              ref={searchRef}
              className="ed-input"
              type="search"
              placeholder="Search blocks"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {groups.length === 0 && <p className="ed-empty-note">Nothing matches “{query}”.</p>}

          {groups.map((group) => (
            <div key={group.group}>
              <p className="ed-group-title">{group.group}</p>
              <div className="ed-block-grid">
                {group.blocks.map((definition) => (
                  <BlockCard key={definition.type} definition={definition} onPick={onPick} />
                ))}
              </div>
            </div>
          ))}
    </Modal>
  );
}

/**
 * One draggable block card in the + picker.
 *
 * The same dnd-kit draggable the elements palette uses, so it works by touch and
 * keyboard as well as mouse. Click still adds the block to the column the picker
 * was opened from; dragging drops it exactly where you let go. The type rides on
 * the draggable's data, which the DndContext up in EditorShell reads back on
 * drop; that same context fades this modal's scrim while a drag is live so the
 * canvas beneath takes it. This replaces the old native-HTML5 drag, whose
 * modal-fade had to be deferred a tick or Chrome cancelled the drag (5 Aug
 * 2026) — dnd-kit carries none of that fragility.
 */
function BlockCard({
  definition,
  onPick,
}: {
  definition: BlockDefinition;
  onPick: (type: string) => void;
}) {
  const { setNodeRef, listeners, attributes } = useDraggable({
    id: `picker:${definition.type}`,
    data: { paletteType: definition.type },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className="ed-block-card"
      onClick={() => onPick(definition.type)}
      {...attributes}
      {...listeners}
    >
      <span className="ed-block-card__icon">
        <Icon name={definition.icon} size={18} />
      </span>
      <span>
        <strong>{definition.label}</strong>
        <small>{definition.description}</small>
      </span>
    </button>
  );
}
