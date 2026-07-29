'use client';

/**
 * Spacing, size and style controls.
 *
 * ONE SET, USED BY BOTH SECTIONS AND COLUMNS. That is the whole point: Andy
 * asked for the same controls in both places, and the reliable way to get
 * that is for there to be one implementation rather than two that agree
 * today. The schema does the same thing with BoxSchema.
 */

import { useState } from 'react';

import {
  boxIsEmpty,
  EMPTY_BOX,
  MAX_BORDER,
  MAX_PADDING,
  MAX_RADIUS,
  safeColour,
  type Box,
  type Padding,
} from '../../lib/content/schema';
import { Icon } from './Icon';

type Side = keyof Padding;
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

// ---------------------------------------------------------------------------
// A number with a slider, an input and its unit
// ---------------------------------------------------------------------------

export function Measure({
  label,
  value,
  max,
  min = 0,
  step = 1,
  unit = 'px',
  hint,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  min?: number;
  step?: number;
  unit?: string;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const id = `m-${label.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <div className="ed-measure">
      <label className="ed-label" htmlFor={id}>
        {label}
      </label>

      <div className="ed-measure__row">
        {/*
          The slider and the number are two views of one value, both labelled
          by the same text. The slider is for finding a value, the box is for
          knowing it and for typing an exact one.
        */}
        <input
          className="ed-measure__slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={`${label}, slider`}
          onChange={(event) => onChange(Number(event.target.value))}
        />

        <span className="ed-measure__field">
          <input
            id={id}
            className="ed-measure__input"
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <span className="ed-measure__unit" aria-hidden="true">
            {unit}
          </span>
        </span>
      </div>

      {hint && <small className="ed-measure__hint">{hint}</small>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The padding box
// ---------------------------------------------------------------------------

/**
 * Four inputs arranged like the thing they describe.
 *
 * The diagram is the point. Four fields in a list called Top, Right, Bottom
 * and Left make you translate; four fields in the shape of a box do not.
 *
 * The link in the middle ties all four together, which is what most people
 * want most of the time and is the difference between one edit and four.
 */
export function PaddingBox({
  padding,
  onChange,
}: {
  padding: Padding;
  onChange: (padding: Padding) => void;
}) {
  const uniform = SIDES.every((side) => padding[side] === padding.top);
  const [linked, setLinked] = useState(uniform);

  function set(side: Side, next: number) {
    const clamped = Math.min(MAX_PADDING, Math.max(0, Math.round(next) || 0));
    onChange(
      linked
        ? { top: clamped, right: clamped, bottom: clamped, left: clamped }
        : { ...padding, [side]: clamped },
    );
  }

  return (
    <div className="ed-pad">
      <span className="ed-label">Padding (inner spacing)</span>

      <div className="ed-pad__box">
        {SIDES.map((side) => (
          <span className={`ed-pad__cell ed-pad__cell--${side}`} key={side}>
            <input
              className="ed-pad__input"
              type="number"
              min={0}
              max={MAX_PADDING}
              value={padding[side]}
              aria-label={`Padding ${side}`}
              onChange={(event) => set(side, Number(event.target.value))}
            />
          </span>
        ))}

        <button
          type="button"
          className="ed-pad__link"
          aria-pressed={linked}
          aria-label={linked ? 'Sides are linked, click to set them separately' : 'Sides are separate, click to link them'}
          title={linked ? 'All four sides together' : 'Each side on its own'}
          onClick={() => {
            const next = !linked;
            setLinked(next);
            // Linking has to actually make them equal, or the button would
            // claim a state the values contradict.
            if (next) {
              const value = padding.top;
              onChange({ top: value, right: value, bottom: value, left: value });
            }
          }}
        >
          <Icon name={linked ? 'link' : 'link-off'} size={16} />
        </button>
      </div>

      {/*
        The unit is stated once rather than on each of the four inputs, which
        would be four times the noise for one fact. Pixels only, deliberately:
        percentage padding resolves against the container's WIDTH even top and
        bottom, so the same "10%" is a huge gap on a wide section and nothing
        on a narrow one.
      */}
      <small className="ed-measure__hint">All four in pixels.</small>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * A swatch, a text field and a way back to nothing.
 *
 * "Nothing" is a real and common answer: a column usually has no background
 * of its own and shows the section behind it. A colour picker with no way to
 * clear it forces a choice that did not need making.
 */
export function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const id = `c-${label.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <div className="ed-colour">
      <label className="ed-label" htmlFor={id}>
        {label}
      </label>

      <div className="ed-colour__row">
        <input
          className="ed-colour__swatch"
          type="color"
          value={value && value.startsWith('#') ? value : '#ffffff'}
          aria-label={`${label}, colour picker`}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          id={id}
          className="ed-input"
          value={value ?? ''}
          placeholder="None"
          onChange={(event) => onChange(safeColour(event.target.value) ?? undefined)}
        />
        <button
          type="button"
          className="ed-btn"
          data-icon="true"
          data-variant="ghost"
          aria-label={`Clear ${label}`}
          title="Clear"
          disabled={!value}
          onClick={() => onChange(undefined)}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The whole panel
// ---------------------------------------------------------------------------

const SHADOWS = [
  { value: 'none', label: 'None' },
  { value: 'soft', label: 'Soft' },
  { value: 'medium', label: 'Medium' },
  { value: 'strong', label: 'Strong' },
] as const;

export function BoxPanel({
  box,
  onChange,
  /** Named so the reset button can say what it is resetting. */
  what,
}: {
  box: Box;
  onChange: (box: Box) => void;
  what: 'section' | 'column';
}) {
  const patch = (next: Partial<Box>) => onChange({ ...box, ...next });

  return (
    <>
      <PaddingBox padding={box.padding} onChange={(padding) => patch({ padding })} />

      <ColourField
        label="Background colour"
        value={box.background}
        onChange={(background) => patch({ background })}
      />

      <Measure
        label="Corner radius"
        value={box.radius}
        max={MAX_RADIUS}
        onChange={(radius) => patch({ radius })}
      />

      <Measure
        label="Border"
        value={box.borderWidth}
        max={MAX_BORDER}
        onChange={(borderWidth) => patch({ borderWidth })}
      />

      {/* Only worth asking for a colour once there is a border to colour. */}
      {box.borderWidth > 0 && (
        <ColourField
          label="Border colour"
          value={box.borderColour}
          onChange={(borderColour) => patch({ borderColour })}
        />
      )}

      <div className="ed-field">
        <label className="ed-label" htmlFor="box-shadow">
          Shadow
        </label>
        <select
          id="box-shadow"
          className="ed-input"
          value={box.shadow}
          onChange={(event) => patch({ shadow: event.target.value as Box['shadow'] })}
        >
          {SHADOWS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="ed-btn"
        data-variant="ghost"
        disabled={boxIsEmpty(box)}
        onClick={() => onChange({ ...EMPTY_BOX })}
      >
        <Icon name="undo" size={16} />
        Clear this {what}&apos;s styling
      </button>
    </>
  );
}
