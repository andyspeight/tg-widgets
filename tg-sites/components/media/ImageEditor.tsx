'use client';

/**
 * The image editor: focus point, adjustments, and a crop.
 *
 * WHY A FOCUS POINT. A picture set to fill a shape is cropped to it, and the
 * browser keeps the middle by default. For a portrait whose subject is off to
 * one side, or a landscape with a low horizon, the middle is the wrong thing to
 * hold onto. Clicking where the important part is sets object-position so the
 * crop keeps it. Andy asked for this on 3 Aug 2026.
 *
 * WHY A CROP AS WELL. The focus point is the quick tool: it decides what a
 * responsive shape keeps. The crop is the precise one: it says "the picture is
 * now exactly this rectangle". Andy asked for both, side by side, on 4 Aug 2026,
 * with standard aspect presets and a freeform box. They are two tabs here
 * because they answer two different questions, and a client reaches for one or
 * the other rather than both at once.
 *
 * NON-DESTRUCTIVE, ALL OF IT. Nothing rewrites the file. The focus point is a
 * percentage, the adjustments are CSS filters, and the crop is four insets plus
 * the shape it makes, all stored as plain numbers and applied at render. So
 * every edit undoes to the pixel, the original is never touched, and there is no
 * second copy to keep.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Modal } from '../ui/Modal';

/** The crop rectangle, as percentages of the source, plus its own pixel aspect. */
export interface CropRect {
  /** Top-left corner, per cent across and down. */
  x: number;
  y: number;
  /** Width and height, per cent of the source. */
  w: number;
  h: number;
  /**
   * The crop's width-to-height ratio in PIXELS, worked out here where the
   * picture's real shape is known. Stored so the renderer can give the crop its
   * shape without ever needing the source's own dimensions: the four insets
   * position the picture, this one number shapes the window onto it. 0 means no
   * crop worth drawing.
   */
  aspect: number;
}

export interface ImageEdit {
  /** Percentage across and down: 50/50 is the middle. */
  focusX: number;
  focusY: number;
  /** Percentages, 100 being the photograph untouched. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Present only where a crop is offered, which today is the image block. */
  crop?: CropRect;
}

export const IMAGE_EDIT_DEFAULTS: ImageEdit = {
  focusX: 50,
  focusY: 50,
  brightness: 100,
  contrast: 100,
  saturation: 100,
};

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 100, h: 100, aspect: 0 };

/** A whole number in range. The editor never lets a value leave its slider or frame. */
function pin(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** A number in a range, kept as a real (not rounded), for the crop maths. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** A crop is worth drawing only if it actually trims something off the source. */
function isCropped(crop: CropRect | undefined): crop is CropRect {
  return (
    !!crop &&
    crop.aspect > 0 &&
    (crop.x > 0 || crop.y > 0 || crop.w < 100 || crop.h < 100)
  );
}

/** The four aspect presets plus freeform, as a width-to-height pixel ratio. */
const CROP_ASPECTS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '9:16', ratio: 9 / 16 },
];

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
type Corner = (typeof CORNERS)[number];
/** The smallest a crop may be, in per cent, so a handle cannot invert the box. */
const MIN_CROP = 8;

export function ImageEditor({
  src,
  value,
  canCrop = false,
  onSave,
  onClose,
}: {
  src: string;
  value: Partial<ImageEdit>;
  /** Whether the Crop tab is offered. Only the image block sets it today. */
  canCrop?: boolean;
  onSave: (next: ImageEdit) => void;
  onClose: () => void;
}) {
  const [edit, setEdit] = useState<ImageEdit>({
    focusX: pin(value.focusX ?? 50, 100),
    focusY: pin(value.focusY ?? 50, 100),
    brightness: pin(value.brightness ?? 100, 200),
    contrast: pin(value.contrast ?? 100, 200),
    saturation: pin(value.saturation ?? 100, 200),
    crop: value.crop ?? FULL_CROP,
  });
  const [tab, setTab] = useState<'adjust' | 'crop'>('adjust');

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

  const set = (key: 'brightness' | 'contrast' | 'saturation') => (next: number) =>
    setEdit((current) => ({ ...current, [key]: next }));

  const untouched =
    edit.brightness === 100 && edit.contrast === 100 && edit.saturation === 100;

  const save = () => {
    // Crop rides along only where it is offered, so a section background or a
    // gallery tile never has a crop prop written onto it that its render ignores.
    const { crop, ...rest } = edit;
    onSave(canCrop ? { ...rest, crop } : rest);
  };

  return (
    <Modal
      title="Edit image"
      description={
        canCrop
          ? 'Set the focus point and the look under Adjust, or trim the picture under Crop.'
          : 'Click the picture to set what stays in view when a shape crops it, then adjust how it looks.'
      }
      size="large"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tg-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="tg-btn" data-variant="primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      {canCrop && (
        <div className="ed-imgedit__tabs" role="tablist" aria-label="Image editor">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'adjust'}
            className="ed-imgedit__tab"
            onClick={() => setTab('adjust')}
          >
            Adjust
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'crop'}
            className="ed-imgedit__tab"
            onClick={() => setTab('crop')}
          >
            Crop
          </button>
        </div>
      )}

      {tab === 'crop' && canCrop ? (
        <CropTab
          src={src}
          filter={filter}
          crop={edit.crop ?? FULL_CROP}
          onChange={(crop) => setEdit((current) => ({ ...current, crop }))}
        />
      ) : (
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
              // point. An enhancement, not the mechanism, so it goes AFTER the
              // point is set and is never allowed to throw into the console.
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
            <span
              className="ed-imgedit__dot"
              style={{ left: `${edit.focusX}%`, top: `${edit.focusY}%` }}
              aria-hidden="true"
            />
          </button>

          <div className="ed-imgedit__tools">
            <p className="ed-imgedit__hint">
              The focus point is where the picture is held when it is cropped.
              Drag it to the part that matters.
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
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The crop tab
// ---------------------------------------------------------------------------

function CropTab({
  src,
  filter,
  crop,
  onChange,
}: {
  src: string;
  filter: string;
  crop: CropRect;
  onChange: (crop: CropRect) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  // null is freeform. A number locks the crop to that width-to-height ratio.
  const [ratio, setRatio] = useState<number | null>(null);
  const drag = useRef<{ mode: 'move' | Corner; startX: number; startY: number; start: CropRect } | null>(
    null,
  );

  const box = () => {
    const b = frame.current?.getBoundingClientRect();
    return b && b.width > 0 && b.height > 0 ? b : null;
  };

  /*
   * Store a rect, tagging it with the pixel aspect the frame gives it.
   *
   * THE FRAME IS MEASURED ONCE PER GESTURE AND PASSED IN, never read again here.
   * Reading it a second time was the bug: the first getBoundingClientRect in a
   * handler could return a zero box (a picture still settling, an SVG with no
   * intrinsic size) while a second, a layout later, returned a real one, so the
   * rect was built against nothing and the aspect against something, and a 16:9
   * preset came out 2:1. One measurement means the rect and its aspect always
   * agree. A null frame stores nothing new, keeping the aspect it had.
   */
  const commit = (
    rect: { x: number; y: number; w: number; h: number },
    b: DOMRect | null,
  ) => {
    const aspect = b && b.height > 0 ? (rect.w * b.width) / (rect.h * b.height) : crop.aspect || 1;
    onChange({ ...rect, aspect });
  };

  /** The largest centred rect of a given pixel ratio, or the whole frame. */
  const presetRect = (target: number | null) => {
    const b = box();
    if (!b || target === null) {
      // Freeform keeps the current box; if it was full, start from a centred 80%.
      if (isCropped(crop)) return;
      commit({ x: 10, y: 10, w: 80, h: 80 }, b);
      return;
    }
    // target = pixelW / pixelH. In per cent, w/h = target * (FH / FW).
    const rel = target * (b.height / b.width);
    let w = 100;
    let h = w / rel;
    if (h > 100) {
      h = 100;
      w = h * rel;
    }
    commit({ x: (100 - w) / 2, y: (100 - h) / 2, w, h }, b);
  };

  const onMove = (event: ReactPointerEvent) => {
    const d = drag.current;
    const b = box();
    if (!d || !b) return;
    const dxp = ((event.clientX - d.startX) / b.width) * 100;
    const dyp = ((event.clientY - d.startY) / b.height) * 100;

    if (d.mode === 'move') {
      commit(
        {
          x: clamp(d.start.x + dxp, 0, 100 - d.start.w),
          y: clamp(d.start.y + dyp, 0, 100 - d.start.h),
          w: d.start.w,
          h: d.start.h,
        },
        b,
      );
      return;
    }

    // A corner resize: the opposite corner is the anchor and stays put.
    const right = d.start.x + d.start.w;
    const bottom = d.start.y + d.start.h;
    const west = d.mode === 'nw' || d.mode === 'sw';
    const north = d.mode === 'nw' || d.mode === 'ne';
    const ax = west ? right : d.start.x; // anchor x
    const ay = north ? bottom : d.start.y; // anchor y

    // Where the dragged corner is now, clamped to the frame.
    let cx = clamp((west ? d.start.x : right) + dxp, 0, 100);
    let cy = clamp((north ? d.start.y : bottom) + dyp, 0, 100);

    let w = Math.abs(cx - ax);
    let h = Math.abs(cy - ay);

    if (ratio !== null) {
      // Honour the width, derive the height from the locked ratio, then keep it
      // inside the frame by re-deriving the width if the height had to give.
      const rel = ratio * (b.height / b.width); // w/h in per cent terms
      h = w / rel;
      const maxH = north ? ay : 100 - ay;
      if (h > maxH) {
        h = maxH;
        w = h * rel;
      }
      const maxW = west ? ax : 100 - ax;
      if (w > maxW) {
        w = maxW;
        h = w / rel;
      }
      cx = west ? ax - w : ax + w;
      cy = north ? ay - h : ay + h;
    }

    w = Math.max(MIN_CROP, w);
    h = Math.max(MIN_CROP, h);
    const x = Math.min(ax, cx);
    const y = Math.min(ay, cy);
    commit(
      {
        x: clamp(x, 0, 100 - w),
        y: clamp(y, 0, 100 - h),
        w,
        h,
      },
      b,
    );
  };

  const start = (mode: 'move' | Corner) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { mode, startX: event.clientX, startY: event.clientY, start: crop };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety */
    }
  };
  const end = () => {
    drag.current = null;
  };

  const active = isCropped(crop);

  return (
    <div className="ed-imgedit">
      <div className="ed-imgedit__frame ed-imgedit__frame--crop" ref={frame}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" style={{ filter: filter || undefined }} />

        {active && (
          <div
            className="ed-crop__box"
            style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
            onPointerDown={start('move')}
            onPointerMove={onMove}
            onPointerUp={end}
            role="group"
            aria-label="Crop area, drag to move"
          >
            {CORNERS.map((corner) => (
              <span
                key={corner}
                className={`ed-crop__handle ed-crop__handle--${corner}`}
                onPointerDown={start(corner)}
                onPointerMove={onMove}
                onPointerUp={end}
                aria-hidden="true"
              />
            ))}
          </div>
        )}
      </div>

      <div className="ed-imgedit__tools">
        <p className="ed-imgedit__hint">
          Choose a shape or Free, then drag the box and its corners to trim the
          picture. Nothing is thrown away, so it undoes to the pixel.
        </p>

        <div className="ed-crop__aspects" role="group" aria-label="Crop shape">
          {CROP_ASPECTS.map((option) => (
            <button
              key={option.label}
              type="button"
              className="ed-crop__aspect"
              aria-pressed={ratio === option.ratio && active}
              onClick={() => {
                setRatio(option.ratio);
                presetRect(option.ratio);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="tg-btn"
          data-variant="ghost"
          disabled={!active}
          onClick={() => {
            setRatio(null);
            onChange(FULL_CROP);
          }}
        >
          Reset crop
        </button>
      </div>
    </div>
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
