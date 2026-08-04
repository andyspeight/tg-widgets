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
  presetThumb,
  presetsIn,
  stockPreviewUrl,
  type PresetCategory,
  type PresetScope,
  type SectionPreset,
} from '../../lib/content/presets';
import type { Section } from '../../lib/content/schema';
import { Modal } from '../ui/Modal';
import { ImportPanel } from './ImportPanel';
import { AiPanel } from './AiPanel';

type Tab = 'layouts' | 'designed' | 'ai' | 'import';

/*
 * Import is LAST, and that is not a judgement on it. The order is the order
 * somebody reaches for them, and an import is the thing you do once at the
 * start of a site rather than the thing you do on your fifth section.
 */
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'layouts', label: 'Layouts' },
  { id: 'designed', label: 'Designed' },
  { id: 'ai', label: 'AI' },
  { id: 'import', label: 'Import' },
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
 * Four bar tones rather than one, because a wall of identical grey bars says
 * "something goes here" and nothing else. Solid bars are headings and buttons,
 * pale ones are body text, mid ones are pictures, and a small square is an
 * icon, which is enough for the eye to tell a centred introduction from four
 * columns of points at thumbnail size.
 *
 * THE GROUND AND THE PANELS CAME WITH THE DESIGN PASS on 2 Aug 2026. A preset
 * can say its section is tinted and its columns are cards, and both were drawn
 * on the page and on neither of them here, so the whole Designed tab looked
 * like white paper whatever was on it. Three things are stacked now, back to
 * front: the section's own background, any card panels, then the content.
 */
export function PresetThumb({ preset }: { preset: SectionPreset }) {
  const { tone, panels, bars, background } = presetThumb(preset);

  /*
   * A clip id unique to this preset AND this bar, because every thumbnail on the
   * screen shares one document: `clip-3` on two presets would have the second
   * steal the first's shape. The preset id makes it the preset's own.
   */
  const clip = (index: number) => `tgphoto-${preset.id}-${index}`;

  return (
    <svg
      className="ed-thumb ed-thumb--preset"
      viewBox="0 0 100 68"
      data-section={tone}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {/* Full bleed, because a tinted section runs the width of the page. */}
      <rect x={0} y={0} width={100} height={68} data-tone="ground" />

      {/*
        The whole-section photograph, for an over-photo hero. Drawn over the
        ground and under everything else, clipped by the svg viewport. A slice
        fit fills the frame the way the real background does. If the photo
        library is not connected the image 404s and the dark ground shows, which
        is the section's tone and exactly the right fallback.
      */}
      {background && (
        <image
          href={stockPreviewUrl(background)}
          x={0}
          y={0}
          width={100}
          height={68}
          preserveAspectRatio="xMidYMid slice"
        />
      )}

      {panels.map((panel, index) => (
        <rect
          key={`panel-${index}`}
          x={panel.x * 100}
          y={panel.y * 68}
          width={panel.width * 100}
          height={panel.height * 68}
          rx={2}
          data-tone={panel.tone}
        />
      ))}

      {/* One clip per picture bar, so a photograph cannot bleed past its frame. */}
      <defs>
        {bars.map((bar, index) =>
          bar.query ? (
            <clipPath key={index} id={clip(index)}>
              <rect
                x={bar.x * 100}
                y={bar.y * 68}
                width={bar.width * 100}
                height={bar.height * 68}
                rx={1}
              />
            </clipPath>
          ) : null,
        )}
      </defs>

      {bars.map((bar, index) => (
        <g key={index}>
          {/*
            The grey frame first, ALWAYS, so it shows through when a picture has
            no query or the photo fails to load. The photograph, when there is
            one, is drawn on top and clipped to the frame.
          */}
          <rect
            x={bar.x * 100}
            y={bar.y * 68}
            width={bar.width * 100}
            height={bar.height * 68}
            rx={bar.pill ? 3 : bar.tone === 'icon' ? 2 : 1}
            data-tone={bar.tone}
          />
          {bar.query && (
            <image
              href={stockPreviewUrl(bar.query)}
              x={bar.x * 100}
              y={bar.y * 68}
              width={bar.width * 100}
              height={bar.height * 68}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clip(index)})`}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export function SectionPicker({
  scope = 'page',
  onPickLayout,
  onPickPreset,
  onPickImported,
  onPickBuilt,
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
  onPickPreset: (preset: SectionPreset) => void | Promise<void>;
  /** A whole design, cut into sections. Plural because one paste is often many. */
  onPickImported: (sections: Section[]) => void;
  /** One section, built by the AI from a description. */
  onPickBuilt: (section: Section) => void;
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
  /**
   * The design being added, while its photographs are fetched.
   *
   * A hero with a picture takes a moment on the way in, because the section is
   * built and its photograph pulled into the client's media before it lands.
   * Held here so that one card can show it is working, and the rest go quiet so
   * a second click cannot start a second insert into the same seam.
   */
  const [addingId, setAddingId] = useState<string | null>(null);

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
                // Disabled only while one is being added, so a slow photo fetch
                // cannot be double-started. onPickPreset may be async; awaiting it
                // keeps the working state up until the section is actually in.
                disabled={addingId !== null}
                aria-busy={addingId === preset.id}
                onClick={async () => {
                  setAddingId(preset.id);
                  try {
                    await onPickPreset(preset);
                  } finally {
                    setAddingId(null);
                  }
                }}
              >
                <PresetThumb preset={preset} />
                <span className="ed-preset-card__name">{preset.label}</span>
                <span className="ed-preset-card__what">
                  {addingId === preset.id ? 'Adding, and finding a photo…' : preset.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'import' && <ImportPanel onAdd={onPickImported} />}

      {tab === 'ai' && <AiPanel onBuilt={onPickBuilt} />}
    </Modal>
  );
}
