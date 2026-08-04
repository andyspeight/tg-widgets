'use client';

/**
 * The image editor: where a client sets what stays in view when a picture is
 * cropped, and adjusts how it looks.
 *
 * WHY A FOCUS POINT. A picture set to fill a shape is cropped to it, and the
 * browser keeps the middle by default. For a portrait whose subject is off to
 * one side, or a landscape with a low horizon, the middle is the wrong thing to
 * hold onto. Clicking where the important part is sets object-position so the
 * crop keeps it, on every shape and every screen. Andy asked for this on 3 Aug
 * 2026: "select the exact focus point of the image by clicking on it".
 *
 * NON-DESTRUCTIVE, ALL OF IT. Nothing here rewrites the file. The focus point is
 * a percentage and the adjustments are CSS filters, both stored as plain numbers
 * on the block and applied at render. So every edit undoes to the pixel, the
 * original is never touched, and there is no second copy to keep.
 *
 * The full picture is shown, not a crop, because the job here is to say where
 * the important part IS. What a given shape then makes of it is on the page,
 * where the shape is known; here there is only the picture and a marker on it.
 */

import { useRef, useState } from 'react';

import { Modal } from '../ui/Modal';

export interface ImageEdit {
  /** Percentage across and down: 50/50 is the middle. */
  focusX: number;
  focusY: number;
  /** Percentages, 100 being the photograph untouched. */
  brightness: number;
  contrast: number;
  saturation: number;
}

export const IMAGE_EDIT_DEFAULTS: ImageEdit = {
  focusX: 50,
  focusY: 50,
  brightness: 100,
  contrast: 100,
  saturation: 100,
};

/** A whole number in range. The editor never lets a value leave its slider or frame. */
function pin(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
}

export function ImageEditor({
  src,
  value,
  onSave,
  onClose,
}: {
  src: string;
  value: Partial<ImageEdit>;
  onSave: (next: ImageEdit) => void;
  onClose: () => void;
}) {
  const [edit, setEdit] = useState<ImageEdit>({
    focusX: pin(value.focusX ?? 50, 100),
    focusY: pin(value.focusY ?? 50, 100),
    brightness: pin(value.brightness ?? 100, 200),
    contrast: pin(value.contrast ?? 100, 200),
    saturation: pin(value.saturation ?? 100, 200),
  });

  const frame = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);

  /** Turn a pointer position into a focus point, as a percentage of the picture. */
  const focusFrom = (clientX: number, clientY: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    setEdit((current) => ({
      ...current,
      focusX: pin(((clientX - box.left) / box.width) * 100, 100),
      focusY: pin(((clientY - box.top) / box.height) * 100, 100),
    }));
  };

  const filter = [
    edit.brightness !== 100 ? `brightness(${edit.brightness}%)` : '',
    edit.contrast !== 100 ? `contrast(${edit.contrast}%)` : '',
    edit.saturation !== 100 ? `saturate(${edit.saturation}%)` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const set = (key: keyof ImageEdit) => (next: number) =>
    setEdit((current) => ({ ...current, [key]: next }));

  const untouched =
    edit.brightness === 100 && edit.contrast === 100 && edit.saturation === 100;

  return (
    <Modal
      title="Edit image"
      description="Click the picture to set what stays in view when a shape crops it, then adjust how it looks."
      size="large"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tg-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tg-btn"
            data-variant="primary"
            onClick={() => onSave(edit)}
          >
            Save
          </button>
        </>
      }
    >
      <div className="ed-imgedit">
        <button
          type="button"
          ref={frame}
          className="ed-imgedit__frame"
          aria-label="Set the focus point by clicking the picture"
          onPointerDown={(event) => {
            dragging.current = true;
            focusFrom(event.clientX, event.clientY);
            // Capture keeps a drag that wanders off the picture updating the
            // point. It is an enhancement, not the mechanism, so it goes AFTER
            // the point is set and it is never allowed to throw: a browser that
            // refuses the capture (or a pointer id it will not take) must not
            // turn a click into an unhandled error in the console.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* capture is a nicety; the click already registered */
            }
          }}
          onPointerMove={(event) => {
            if (dragging.current) focusFrom(event.clientX, event.clientY);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" style={{ filter: filter || undefined }} />
          {/* The marker sits ON the focus point, pointer-events off so a click on
              it still lands on the frame and moves it rather than being eaten. */}
          <span
            className="ed-imgedit__dot"
            style={{ left: `${edit.focusX}%`, top: `${edit.focusY}%` }}
            aria-hidden="true"
          />
        </button>

        <div className="ed-imgedit__tools">
          <p className="ed-imgedit__hint">
            The focus point is where the picture is held when it is cropped. Drag
            it to the part that matters.
          </p>

          <Slider label="Brightness" value={edit.brightness} onChange={set('brightness')} />
          <Slider label="Contrast" value={edit.contrast} onChange={set('contrast')} />
          <Slider label="Saturation" value={edit.saturation} onChange={set('saturation')} />

          <button
            type="button"
            className="tg-btn"
            data-variant="ghost"
            disabled={untouched}
            onClick={() =>
              setEdit((current) => ({ ...current, brightness: 100, contrast: 100, saturation: 100 }))
            }
          >
            Reset adjustments
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="ed-imgedit__slider">
      <span className="ed-imgedit__slider-top">
        {label}
        <span className="ed-imgedit__slider-val">{value}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={200}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
