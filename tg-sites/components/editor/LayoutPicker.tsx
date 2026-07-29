'use client';

/**
 * "Choose a layout for your section."
 *
 * Shown whenever a section is added, from the canvas or from the outline.
 * Picking a shape first is how every builder an agent has used works, and it
 * saves them discovering the column controls before they have any content.
 *
 * The thumbnails are generated from the layout definitions, so a layout can
 * never show a picture of something other than what it builds.
 */

import { useEffect, useRef } from 'react';
import { LAYOUTS, layoutCells, type Layout } from '../../lib/content/layouts';
import { Icon } from './Icon';

export function LayoutThumb({ layout }: { layout: Layout }) {
  const cells = layoutCells(layout);

  return (
    <svg
      className="ed-thumb"
      viewBox="0 0 100 68"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {cells.map((cell, index) => (
        <rect
          key={index}
          x={cell.x * 100}
          y={cell.y * 68}
          width={cell.width * 100}
          height={cell.height * 68}
          rx={3}
        />
      ))}
    </svg>
  );
}

export function LayoutPicker({
  onPick,
  onClose,
}: {
  onPick: (layout: Layout) => void;
  onClose: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);

  // Focusing here is a real user action: the dialog only exists because they
  // clicked to add a section.
  useEffect(() => {
    first.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="ed-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="ed-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a layout for your section"
      >
        <div className="ed-modal-head">
          <span>Choose a layout for your section</span>
          <button
            type="button"
            className="ed-btn"
            data-variant="ghost"
            data-icon="true"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="ed-modal-body">
          <div className="ed-layout-grid">
            {LAYOUTS.map((layout, index) => (
              <button
                key={layout.id}
                ref={index === 0 ? first : undefined}
                type="button"
                className="ed-layout-card"
                onClick={() => onPick(layout)}
              >
                <LayoutThumb layout={layout} />
                <span>{layout.label}</span>
              </button>
            ))}
          </div>

          <p className="ed-help" style={{ marginTop: 16 }}>
            You can change any of this afterwards. Drag the edge between two
            columns in the preview to make one wider than the other.
          </p>
        </div>
      </div>
    </div>
  );
}
