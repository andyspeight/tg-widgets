'use client';

/**
 * Spacing, size and style controls.
 *
 * ONE SET, USED BY BOTH SECTIONS AND COLUMNS. That is the whole point: Andy
 * asked for the same controls in both places, and the reliable way to get
 * that is for there to be one implementation rather than two that agree
 * today. The schema does the same thing with BoxSchema.
 */

import { useState, type CSSProperties } from 'react';

import {
  boxIsEmpty,
  EMPTY_BOX,
  MAX_BORDER,
  MAX_PADDING,
  MAX_RADIUS,
  PADDING_PRESETS,
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
          {/*
            CLAMPED ON BLUR, NOT ON EVERY KEYSTROKE.
            
            `min` and `max` on a number input are advice: the browser marks the
            field invalid and hands the value over anyway. So 900 typed into a
            0-to-100 box reached the canvas, and the canvas showed something the
            save would then quietly correct, which is the one thing this preview
            must never do. The browser suite caught it on the section overlay.

            On blur rather than on change for the same reason the viewport width
            box gives: clamping mid-keystroke turns the "4" on the way to "40"
            into the minimum and throws the caret to the end.
          */}
          <input
            id={id}
            className="ed-measure__input"
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            onBlur={(event) => {
              const typed = Number(event.target.value);
              const held = Number.isFinite(typed)
                ? Math.min(max, Math.max(min, Math.round(typed)))
                : min;
              if (held !== value) onChange(held);
            }}
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
 * Presets and four inputs arranged like the thing they describe.
 *
 * The diagram is the point. Four fields in a list called Top, Right, Bottom
 * and Left make you translate; four fields in the shape of a box do not.
 *
 * The link in the middle ties all four together, which is what most people
 * want most of the time and is the difference between one edit and four.
 *
 * THE PRESETS ARE WHY COLUMNS NOW MATCH SECTIONS. A section had a quick
 * None/S/M/L/XL row for its vertical padding and a column had only the four
 * numeric fields, so setting a comfortable inset on a column meant typing a
 * number four times or knowing to press the link button first. Andy asked for
 * the same padding options in both places on 30 Jul 2026. Putting them here
 * rather than in the column pane is what makes that true by construction: this
 * component is embedded in both, so neither can drift from the other, which is
 * the same reasoning as BoxSchema in the schema.
 *
 * They set all four sides, unlike a section's paddingY which is vertical only.
 * A section's left and right come from its content width, so vertical is the
 * only axis a preset can mean. A column is a box, and a column with a
 * background and no side padding has text against its edges.
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

  function preset(value: number) {
    onChange({ top: value, right: value, bottom: value, left: value });
    // A preset makes the four sides equal, so the link button has to agree.
    // Leaving it saying "separate" over four identical numbers is the same
    // inconsistency the toggle below already guards against in the other
    // direction.
    setLinked(true);
  }

  return (
    <div className="ed-pad">
      <span className="ed-label">Padding (inner spacing)</span>

      {/*
        Nothing is pressed when the sides are uneven, which is the honest answer:
        no preset describes 40/0/40/0, and lighting one up would claim otherwise.
        The numbers below still say exactly what it is.
      */}
      <div
        className="ed-segmented ed-pad__presets"
        role="group"
        aria-label="Padding presets"
        style={{ '--ed-seg-count': PADDING_PRESETS.length } as CSSProperties}
      >
        {PADDING_PRESETS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={uniform && padding.top === option.value}
            onClick={() => preset(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

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
