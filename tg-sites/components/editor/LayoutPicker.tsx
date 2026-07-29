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

import { useRef } from 'react';
import { LAYOUTS, layoutCells, type Layout } from '../../lib/content/layouts';
import { Modal } from '../ui/Modal';

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
  // Escape, the scrim, the focus trap and moving focus in all belong to
  // Modal now. This component is a grid of layouts and nothing else.
  const first = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      title="Choose a layout"
      description="Every layout stacks into one column on a phone, whichever you pick."
      size="large"
      onClose={onClose}
    >
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

      <p className="ed-modal__note">
        You can change any of this afterwards. Drag the edge between two
        columns in the preview to make one wider than the other.
      </p>
    </Modal>
  );
}
