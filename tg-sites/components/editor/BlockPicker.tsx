'use client';

/**
 * The block picker.
 *
 * Opens from an empty column or the + on a column in the outline. Grouped by
 * category, staff-only blocks hidden unless the user is staff.
 */

import { useEffect, useRef, useState } from 'react';
import { blocksByGroup } from '../../lib/content/blocks';
import { Icon } from './Icon';

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
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focusing on open IS a real user action: the modal only exists because
  // they clicked to add a block. The rule about never focusing on render
  // applies to re-renders of persistent UI, not to a dialog appearing.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
    <div
      className="ed-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Add a block" ref={dialogRef}>
        <div className="ed-modal-head">
          <span>Add a block</span>
          <button type="button" className="ed-btn" data-variant="ghost" data-icon="true" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="ed-modal-body">
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
        </div>
      </div>
    </div>
  );
}
