'use client';

/**
 * "Add a section", in three ways.
 *
 * Andy asked for these three on 30 Jul 2026, and the order is the order somebody
 * reaches for them:
 *
 *   Layouts   an empty shape to fill yourself. What this dialog used to be, and
 *             still the right answer when you know what you are building.
 *   Designed  a ready-made arrangement with content already in it, so you edit
 *             words rather than assemble a section. Categories down the side.
 *   AI        describe it and have it built. A stub, and it says so.
 *
 * The thumbnails on both of the first two are DRAWN FROM THE DEFINITIONS rather
 * than hand-made, so neither can show a picture of something it does not build.
 * LayoutThumb has done that since the layouts picker; PresetThumb does the same
 * from the preset's own rows and blocks.
 */

import { useRef, useState } from 'react';

import { LAYOUTS, layoutCells, type Layout } from '../../lib/content/layouts';
import {
  categoriesFor,
  presetBars,
  presetsIn,
  type PresetCategory,
  type PresetScope,
  type SectionPreset,
} from '../../lib/content/presets';
import { Modal } from '../ui/Modal';
import { Icon } from './Icon';

type Tab = 'layouts' | 'designed' | 'ai';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'layouts', label: 'Layouts' },
  { id: 'designed', label: 'Designed' },
  { id: 'ai', label: 'AI' },
];

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

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

/**
 * A wireframe of a designed section.
 *
 * Two tones rather than one, because a wall of identical grey bars says
 * "something goes here" and nothing else. Solid bars are headings and buttons,
 * pale ones are body text, which is enough for the eye to tell a centred
 * introduction from four columns of points at thumbnail size.
 */
export function PresetThumb({ preset }: { preset: SectionPreset }) {
  const bars = presetBars(preset);

  return (
    <svg
      className="ed-thumb ed-thumb--preset"
      viewBox="0 0 100 68"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {bars.map((bar, index) => (
        <rect
          key={index}
          x={bar.x * 100}
          y={bar.y * 68}
          width={bar.width * 100}
          height={bar.height * 68}
          rx={bar.pill ? 3 : 1}
          data-tone={bar.tone}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export function SectionPicker({
  scope = 'page',
  onPickLayout,
  onPickPreset,
  onClose,
}: {
  /**
   * Which screen this was opened from.
   *
   * A header preset and a page section are the same shape, so without this the
   * Designed tab would offer a four-column footer in the middle of an About
   * page, and offer "Three quotes" on the header screen. The editor knows which
   * it is editing, so it says.
   */
  scope?: PresetScope;
  onPickLayout: (layout: Layout) => void;
  onPickPreset: (preset: SectionPreset) => void;
  onClose: () => void;
}) {
  const categories = categoriesFor(scope);

  /*
   * DESIGNED FIRST WHEN THERE IS SOMETHING SHAPED LIKE WHAT YOU ARE BUILDING.
   *
   * Layouts leads on a page, because somebody adding their fifth section
   * usually knows the shape they want. On the header and footer screens the
   * opposite is true: a client is there once, at the start, and an empty
   * two-column row is not what they came for. Since 1 Aug 2026 there are
   * designed headers and footers to open on.
   */
  const [tab, setTab] = useState<Tab>(scope === 'page' ? 'layouts' : 'designed');
  const [category, setCategory] = useState<PresetCategory>(categories[0]?.id ?? 'blank');

  // Escape, the scrim, the focus trap and moving focus in all belong to Modal.
  const first = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      title="Add a section"
      description="Start from an empty shape, or from something already put together."
      size="large"
      onClose={onClose}
    >
      <div className="ed-tabs" role="tablist" aria-label="How to add a section">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="ed-tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'layouts' && (
        <>
          <div className="ed-layout-grid">
            {LAYOUTS.map((layout, index) => (
              <button
                key={layout.id}
                ref={index === 0 ? first : undefined}
                type="button"
                className="ed-layout-card"
                onClick={() => onPickLayout(layout)}
              >
                <LayoutThumb layout={layout} />
                <span>{layout.label}</span>
              </button>
            ))}
          </div>

          <p className="ed-modal__note">
            Every layout stacks into one column on a phone, whichever you pick.
            Drag the edge between two columns in the preview to make one wider
            than the other.
          </p>
        </>
      )}

      {tab === 'designed' && (
        <div className="ed-designed">
          {/*
            The category list is drawn even with one category in it. Hiding it
            until there are two would mean the panel changes shape the day a
            second one lands, and somebody would have to notice it needed to.
          */}
          <nav className="ed-designed__cats" aria-label="Section categories">
            {categories.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="ed-designed__cat"
                aria-current={category === entry.id}
                onClick={() => setCategory(entry.id)}
              >
                {entry.label}
                {/*
                  THE COUNT, because without it nobody knows there is more.
                  Fifteen designs, nine of which fit on a 1000px screen, and the
                  rest below the fold with only a half-clipped row hinting at
                  them. Andy asked on 30 Jul 2026 for seven designs to be added
                  that had already been built and shipped a few hours earlier: he
                  had seen what fitted and reasonably took it for the lot.
                */}
                <span className="ed-designed__count">{presetsIn(entry.id).length}</span>
              </button>
            ))}
          </nav>

          <div className="ed-preset-grid">
            {presetsIn(category).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="ed-preset-card"
                onClick={() => onPickPreset(preset)}
              >
                <PresetThumb preset={preset} />
                <span className="ed-preset-card__name">{preset.label}</span>
                <span className="ed-preset-card__what">{preset.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="ed-ai-stub">
          <Icon name="sparkle" size={28} />
          <h3>Describe the section you want</h3>
          <p>
            This is not built yet. When it is, you will be able to say what the
            section is for in your own words and have it put together, then edit
            it like any other.
          </p>
          {/*
            An honest stub with nothing to type into, rather than a disabled box
            that looks like it might work if you found the right words. Andy
            asked for a stub, so this says what it is.
          */}
          <p className="ed-ai-stub__meanwhile">
            In the meantime, Designed has ready-made sections and Layouts has
            empty ones.
          </p>
        </div>
      )}
    </Modal>
  );
}
