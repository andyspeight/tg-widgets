'use client';

/**
 * The block picker.
 *
 * Opens from an empty column or the + on a column in the outline. Grouped by
 * category, staff-only blocks hidden unless the user is staff.
 */

import { useRef, useState } from 'react';
import { blocksByGroup } from '../../lib/content/blocks';
import { Icon } from './Icon';
import { Modal } from '../ui/Modal';

export function BlockPicker({
  isStaff,
  onPick,
  onClose,
}: {
  isStaff: boolean;
  onPick: (type: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Escape, the scrim and the focus trap all belong to Modal. Modal also
  // moves focus to the first control, which here is the search box.

  const needle = query.trim().toLowerCase();
  const groups = blocksByGroup(isStaff)
    .map((group) => ({
      ...group,
      blocks: group.blocks.filter(
        (definition) =>
          !needle ||
          definition.label.toLowerCase().includes(needle) ||
          definition.description.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.blocks.length > 0);

  return (
    <Modal
      title="Add a block"
      description="Text, media, buttons and layout pieces. Search if you know what you want."
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
