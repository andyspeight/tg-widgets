'use client';

/**
 * The type panel: pick a style, set the five things about it.
 *
 * ONE STYLE AT A TIME, and that is the whole design decision here.
 *
 * Seven styles times five properties is thirty-five controls. Laid out at once
 * that is a wall, and every one of them looks equally important. So the styles
 * are a list you choose from and the controls belong to whichever is selected,
 * which is how Wix, Figma and every other type panel worth using does it.
 *
 * The list is not a set of labels either. Each row is rendered IN ITS OWN STYLE,
 * at a size that shows the relationship between them, so the list is the type
 * scale rather than a description of it. That is what makes "H3 is too close to
 * H2" something you notice rather than something you calculate.
 */

import { useState } from 'react';

import type { FontFamily } from '../../lib/db/fonts';
import { FALLBACK_STACK, resolveStack, type LibraryFont } from '../../lib/theme/fonts';
import { FontSelect, type FontOption } from './FontSelect';
import { FONTS, FONT_IDS } from '../../lib/theme/schema';
import {
  FONT_WEIGHTS,
  MAX_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MAX_TRACKING,
  MIN_FONT_SIZE,
  MIN_LINE_HEIGHT,
  MIN_TRACKING,
  TEXT_STYLES,
  TEXT_STYLE_LABEL,
  type TextStyle,
  type TextStyleId,
  type Typography,
} from '../../lib/theme/typography';

interface Props {
  typography: Typography;
  /** The tenant's imported and uploaded families. */
  library: FontFamily[];
  onChange: (id: TextStyleId, changes: Partial<TextStyle>) => void;
  /** Sets every heading style at once, which is the common first move. */
  onSetAllHeadings: (changes: Partial<TextStyle>) => void;
}

/** A sample per style, so the list reads as content rather than as a spec. */
const SAMPLE: Record<TextStyleId, string> = {
  h1: 'Ten nights in the Maldives',
  h2: 'Why book with us',
  h3: 'Overwater villas',
  h4: 'What is included',
  h5: 'Flights and transfers',
  h6: 'Small print',
  p: 'Talk to someone who has actually been. We build the trip around how you like to travel.',
};

export function TypePanel({ typography, library, onChange, onSetAllHeadings }: Props) {
  const [selected, setSelected] = useState<TextStyleId>('h1');
  const style = typography[selected];

  const fonts: LibraryFont[] = library.map((font) => ({
    slug: font.slug,
    family: font.family,
    fallback: font.fallback,
    weights: font.weights,
  }));

  /** What a style will actually render in, for the sample and the select. */
  const stackFor = (id: TextStyleId) =>
    resolveStack(typography[id].family, fonts, typography.p.family);

  /**
   * Which weights the chosen font actually has.
   *
   * A custom family is stored at the weights that were imported, and offering
   * 700 for a family that only has 400 means picking it does nothing visible.
   * A system stack has no such limit, because the operating system synthesises
   * what it does not have.
   */
  /*
   * The options both typeface controls offer, built once.
   *
   * They were two copies of the same optgroup markup before, which is two places
   * to add a font to. Building the list here also means the STACK travels with
   * each option, so the dropdown can draw every row in its own typeface without
   * knowing anything about where a font came from.
   */
  const familyOptions: FontOption[] = [
    ...library.map((font) => ({
      value: font.slug,
      label: font.family,
      // The real family name: these are imported, so the page has @font-face rules
      // for them. Falling back to the font's own category, not to sans, so a serif
      // does not flash as a sans on the way in.
      stack: `'${font.family}', ${FALLBACK_STACK[font.fallback]}`,
      group: 'Your fonts',
    })),
    ...FONT_IDS.map((id) => ({
      value: id,
      label: FONTS[id].label,
      stack: FONTS[id].stack,
      group: 'Already on every device',
    })),
  ];

  const availableWeights = (() => {
    const ref = style.family ?? typography.p.family;
    const custom = library.find((font) => font.slug === ref);
    return custom && custom.weights.length > 0 ? custom.weights : [...FONT_WEIGHTS];
  })();

  return (
    <>
      <section className="tv-group">
        <h2 className="tv-group__title">Text styles</h2>

        {/*
          The scale, shown at a fraction of its real size.
          Full size would make H1 alone taller than the panel; the point is the
          relationship between the seven, and that survives scaling.
        */}
        <div className="tp-list" role="tablist" aria-label="Text style">
          {TEXT_STYLES.map((id) => {
            const s = typography[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected === id}
                className="tp-row"
                data-selected={selected === id ? 'true' : undefined}
                onClick={() => setSelected(id)}
              >
                <span className="tp-row__name">{TEXT_STYLE_LABEL[id]}</span>
                <span
                  className="tp-row__sample"
                  style={{
                    fontFamily: stackFor(id),
                    fontWeight: s.weight,
                    // Scaled into the panel. 0.42 keeps a 48px H1 at 20px, which
                    // is still clearly the biggest thing in the list.
                    fontSize: `${Math.max(11, Math.round(s.size * 0.42))}px`,
                    letterSpacing: `${s.tracking / 100}em`,
                  }}
                >
                  {SAMPLE[id]}
                </span>
                <span className="tp-row__spec">
                  {s.size}
                  <span aria-hidden="true">px</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="tv-group">
        <h2 className="tv-group__title">{TEXT_STYLE_LABEL[selected]}</h2>

        <div className="tv-field">
          <label className="tv-field__label" id="style-family-label">
            Typeface
          </label>
          {/*
            Every row drawn in the typeface it names, which is what a font picker
            is for and what a native select could never do: font-family on an
            <option> is ignored by Safari and by Chrome on macOS.
          */}
          <FontSelect
            id="style-family"
            labelledBy="style-family-label"
            value={style.family ?? ''}
            options={[
              /*
                The inherit option only for headings. Offering "same as paragraph"
                on the paragraph itself would be a circular choice.

                Drawn in whatever the paragraph currently resolves to, so the row
                shows what choosing it would actually give you rather than being
                the one row set in the UI font.
              */
              ...(selected === 'p'
                ? []
                : [
                    {
                      value: '',
                      label: 'Same as paragraph',
                      stack: stackFor('p'),
                    },
                  ]),
              ...familyOptions,
            ]}
            onChange={(value) => onChange(selected, { family: value || null })}
          />

          {library.length === 0 && (
            <p className="tv-field__help">
              Add a Google font or upload your own on the Fonts tab and it appears
              here.
            </p>
          )}
        </div>

        <div className="tv-field">
          <label className="tv-field__label" htmlFor="style-weight">
            Weight
          </label>
          <select
            className="tv-select"
            id="style-weight"
            value={style.weight}
            onChange={(event) => onChange(selected, { weight: Number(event.target.value) })}
          >
            {availableWeights.map((weight) => (
              <option key={weight} value={weight}>
                {weight === 400 ? 'Regular' : weight === 500 ? 'Medium' : weight === 600 ? 'Semibold' : 'Bold'}
                {' '}
                {weight}
              </option>
            ))}
          </select>
          {availableWeights.length < FONT_WEIGHTS.length && (
            <p className="tv-field__help">
              Only the weights this font was imported with. Others would be faked
              by the browser and look wrong.
            </p>
          )}
        </div>

        <Slider
          id="style-size"
          label="Size"
          suffix="px"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          step={1}
          value={style.size}
          help={
            selected === 'p'
              ? 'Body copy. Every other size on the page is judged against this one.'
              : undefined
          }
          onChange={(size) => onChange(selected, { size })}
        />

        <Slider
          id="style-leading"
          label="Line height"
          min={MIN_LINE_HEIGHT}
          max={MAX_LINE_HEIGHT}
          step={0.05}
          value={style.lineHeight}
          help="Tighter suits a heading, looser suits a paragraph."
          onChange={(lineHeight) => onChange(selected, { lineHeight })}
        />

        <Slider
          id="style-tracking"
          label="Letter spacing"
          min={MIN_TRACKING}
          max={MAX_TRACKING}
          step={1}
          value={style.tracking}
          help="Large text usually wants a little less. Negative tightens it."
          onChange={(tracking) => onChange(selected, { tracking })}
        />
      </section>

      <section className="tv-group">
        <h2 className="tv-group__title">All at once</h2>
        <p className="tv-note">
          Setting the six heading styles together is usually the first thing you
          want, and adjusting one of them afterwards still works.
        </p>

        <div className="tv-field">
          <label className="tv-field__label" id="all-headings-label">
            Typeface for every heading
          </label>
          <FontSelect
            id="all-headings"
            labelledBy="all-headings-label"
            /*
             * Never bound to a value, hence the placeholder.
             *
             * It is an action, not a setting: the six styles it writes to can
             * differ from each other afterwards, so there is no single current
             * value it could honestly show. The old select faked this with a
             * disabled first option and a selectedIndex reset; passing a value
             * that matches nothing is the same idea without the sleight of hand.
             */
            value="__none__"
            placeholder="Choose a typeface"
            options={[
              { value: '', label: 'Same as paragraph', stack: stackFor('p') },
              ...familyOptions,
            ]}
            onChange={(value) => onSetAllHeadings({ family: value || null })}
          />
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * A range and a number box for the same value.
 *
 * Both, because they are for different jobs. Dragging is how you find a size by
 * looking at it, which is how type is actually chosen. Typing is how you match a
 * value from a brand guide, and no amount of dragging hits 42 reliably.
 */
function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  help,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  help?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="tv-field">
      <div className="tp-slider__head">
        <label className="tv-field__label" htmlFor={id}>
          {label}
        </label>
        <div className="tp-slider__value">
          <input
            className="tp-number"
            id={`${id}-number`}
            type="number"
            inputMode="decimal"
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={`${label}, exact value`}
            onChange={(event) => {
              const next = Number(event.target.value);
              // Clamped here as well as in the schema. Without it, typing 400 in
              // the size box shows 400 in the preview until a save comes back
              // and silently corrects it to 96, which reads as the save failing.
              if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
            }}
          />
          {suffix && <span className="tp-slider__suffix">{suffix}</span>}
        </div>
      </div>

      <input
        className="tp-range"
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />

      {help && <p className="tv-field__help">{help}</p>}
    </div>
  );
}
