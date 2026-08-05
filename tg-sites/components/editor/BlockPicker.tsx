'use client';

/**
 * The block picker.
 *
 * Opens from an empty column or the + on a column in the outline. Grouped by
 * category, staff-only blocks hidden unless the user is staff.
 */

import { useEffect, useRef, useState } from 'react';
import { blocksByGroup } from '../../lib/content/blocks';
import { BLOCK_DRAG_MIME } from '../../lib/content/tree';
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
  // Holds the pending "fade the modal" timer so dragend can cancel it. The fade
  // must not run synchronously inside dragstart — see the note on the card.
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /*
   * Clear the drag flag when the picker closes, for ANY reason. A successful
   * drop adds the block and closes the picker, which unmounts the dragged card
   * BEFORE its dragend can fire, so dragend alone cannot be trusted to clear the
   * flag. Left set, the flag keeps the scrim-fade CSS in force, so the next time
   * the picker opens it is faded to nothing and looks like it appears then
   * instantly hides (Andy hit exactly this, 5 Aug 2026).
   */
  useEffect(
    () => () => {
      clearTimeout(fadeTimer.current);
      delete document.body.dataset.tgDragging;
    },
    [],
  );

  // Escape, the scrim and the focus trap all belong to Modal. Modal also
  // moves focus to the first control, which here is the search box.

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
                  <button
                    key={definition.type}
                    type="button"
                    className="ed-block-card"
                    onClick={() => onPick(definition.type)}
                    /*
                     * DRAG THE SAME CARD ONTO THE CANVAS. Click still adds it to
                     * the column the picker was opened from; dragging lets you
                     * drop it exactly where you want instead. The type rides on
                     * the dataTransfer, and a flag on the body lets the modal
                     * recede so the canvas beneath it takes the drop. Andy asked
                     * for elements you can drag onto the canvas, 4 Aug 2026.
                     */
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(BLOCK_DRAG_MIME, definition.type);
                      event.dataTransfer.effectAllowed = 'copy';
                      /*
                       * Fade the modal on the NEXT tick, not here. The flag turns
                       * the scrim pointer-events:none, and the card being dragged
                       * lives inside that scrim: mutating the drag source's own
                       * container inside dragstart makes Chrome cancel the drag
                       * before it begins, which is exactly why clicking a card
                       * added it but dragging did nothing (found 5 Aug 2026, after
                       * the synthetic test passed but a real mouse drag did not).
                       * Deferring a tick lets the drag commit first.
                       */
                      fadeTimer.current = setTimeout(() => {
                        document.body.dataset.tgDragging = 'block';
                      }, 0);
                    }}
                    onDragEnd={() => {
                      clearTimeout(fadeTimer.current);
                      delete document.body.dataset.tgDragging;
                    }}
                  >
                    <span className="ed-block-card__icon">
                      <Icon name={definition.icon} size={18} />
                    </span>
                    <span>
                      <strong>{definition.label}</strong>
                      <small>{definition.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
    </Modal>
  );
}
