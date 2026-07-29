'use client';

/**
 * The properties pane.
 *
 * Shows fields for whatever is selected. Block fields come straight from the
 * registry, so a new block type needs no code here.
 *
 * Every edit passes a coalesce key to onCommit, so typing a heading is one
 * undo step rather than one per character.
 */

import type { Page } from '../../lib/content/schema';
import {
  MAX_GAP,
  MAX_MIN_HEIGHT,
  MIN_COLUMN_WIDTH,
  normaliseSectionPadding,
  SECTION_PADDING_PRESETS,
} from '../../lib/content/schema';
import { BoxPanel, Measure } from './BoxControls';
import { blockDefinition } from '../../lib/content/blocks';
import {
  type Path,
  addColumn,
  evenColumns,
  removeColumn,
  resizeColumnBoundary,
  updateColumn,
  updateRow,
  updateSection,
  updateBlockProps,
} from '../../lib/content/tree';
import { FieldRenderer } from './Fields';
import { Icon } from './Icon';
import { columnWord, sectionNameAt } from '../../lib/content/naming';

interface Props {
  page: Page;
  selected: Path | null;
  isStaff: boolean;
  onSelect: (path: Path | null) => void;
  onCommit: (next: (current: Page) => Page, coalesceKey?: string) => void;
  onBack: () => void;
}

export function Properties({ page, selected, isStaff, onCommit, onBack }: Props) {
  return (
    <aside className="ed-props" aria-label="Properties">
      <div className="ed-panel-head">
        <span className="ed-panel-title">{selected ? headingFor(selected, page) : 'Settings'}</span>
        <button
          type="button"
          className="ed-btn"
          data-variant="ghost"
          data-icon="true"
          onClick={onBack}
          aria-label="Back to the preview"
          title="Back to the preview"
        >
          <Icon name="chevron-right" size={18} style={{ transform: 'rotate(180deg)' }} />
        </button>
      </div>

      <div className="ed-panel-body">
        {!selected && (
          <p className="ed-empty-note">
            Select a section, row or block in the outline or the preview and its
            settings appear here.
          </p>
        )}

        {selected?.kind === 'page' && <PageFields page={page} onCommit={onCommit} />}

        {selected?.kind === 'section' && (
          <SectionFields page={page} index={selected.section} onCommit={onCommit} />
        )}

        {selected?.kind === 'row' && (
          <RowFields page={page} section={selected.section} row={selected.row} onCommit={onCommit} />
        )}

        {selected?.kind === 'column' && (
          <ColumnFields
            page={page}
            section={selected.section}
            row={selected.row}
            column={selected.column}
            onCommit={onCommit}
          />
        )}

        {selected?.kind === 'block' && (
          <BlockFields path={selected} page={page} isStaff={isStaff} onCommit={onCommit} />
        )}
      </div>
    </aside>
  );
}

/**
 * The header names the thing being edited in the agent's words. "BLOCK" told
 * them nothing; "Heading" tells them exactly what they clicked.
 */
function headingFor(path: Path, page: Page): string {
  switch (path.kind) {
    case 'page':
      return 'Page settings';
    case 'section':
      return sectionNameAt(page, path.section);
    case 'row':
      return 'Layout';
    case 'column': {
      const count = page.sections[path.section]?.rows[path.row]?.columns.length ?? 1;
      return columnWord(path.column, count);
    }
    case 'block': {
      const block =
        page.sections[path.section]?.rows[path.row]?.columns[path.column]?.blocks[path.block];
      return blockDefinition(block?.type ?? '')?.label ?? 'Content';
    }
  }
}

// ---------------------------------------------------------------------------

function PageFields({ page, onCommit }: { page: Page; onCommit: Props['onCommit'] }) {
  const set = (patch: Partial<Page>, key: string) =>
    onCommit((current) => ({ ...current, ...patch }), key);

  const setSeo = (patch: Partial<Page['seo']>, key: string) =>
    onCommit((current) => ({ ...current, seo: { ...current.seo, ...patch } }), key);

  return (
    <>
      <div className="ed-field">
        <label className="ed-label">Page title</label>
        <input
          className="ed-input"
          value={page.title}
          onChange={(event) => set({ title: event.target.value }, 'page:title')}
        />
        <p className="ed-help">Also the page&apos;s only h1.</p>
      </div>

      <div className="ed-field">
        <label className="ed-label">Slug</label>
        <input
          className="ed-input"
          value={page.slug}
          placeholder="about-us"
          onChange={(event) =>
            set(
              {
                slug: event.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]+/g, '-')
                  .replace(/^-+|-+$/g, ''),
              },
              'page:slug',
            )
          }
        />
        <p className="ed-help">Blank means this is the home page.</p>
      </div>

      <div className="ed-field">
        <label className="ed-label">Search title</label>
        <input
          className="ed-input"
          maxLength={70}
          value={page.seo.title ?? ''}
          onChange={(event) => setSeo({ title: event.target.value }, 'seo:title')}
        />
        <p className="ed-help">{(page.seo.title ?? '').length} of 70 characters.</p>
      </div>

      <div className="ed-field">
        <label className="ed-label">Search description</label>
        <textarea
          className="ed-textarea"
          rows={3}
          maxLength={200}
          value={page.seo.description ?? ''}
          onChange={(event) => setSeo({ description: event.target.value }, 'seo:description')}
        />
        <p className="ed-help">{(page.seo.description ?? '').length} of 200 characters.</p>
      </div>

      <div className="ed-field">
        <label className="ed-toggle">
          <input
            type="checkbox"
            checked={page.seo.noindex}
            onChange={(event) => setSeo({ noindex: event.target.checked }, 'seo:noindex')}
          />
          <span>Hide from search engines</span>
        </label>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function SectionFields({
  page,
  index,
  onCommit,
}: {
  page: Page;
  index: number;
  onCommit: Props['onCommit'];
}) {
  const section = page.sections[index];
  if (!section) return null;

  const set = (patch: Parameters<typeof updateSection>[2], key: string) =>
    onCommit((current) => updateSection(current, index, patch), key);

  return (
    <>
      <div className="ed-field">
        <label className="ed-label">Name</label>
        <input
          className="ed-input"
          value={section.name ?? ''}
          placeholder={`Section ${index + 1}`}
          onChange={(event) => set({ name: event.target.value }, `sec:${index}:name`)}
        />
        <p className="ed-help">Shown in the outline only. Visitors never see it.</p>
      </div>

      <Segmented
        label="Background"
        value={section.tone}
        options={[
          { value: 'light', label: 'White' },
          { value: 'subtle', label: 'Tinted' },
          { value: 'dark', label: 'Dark' },
          { value: 'accent', label: 'Brand' },
        ]}
        onChange={(value) => set({ tone: value as typeof section.tone }, `sec:${index}:tone`)}
      />

      <Segmented
        label="Content width"
        value={section.width}
        options={[
          { value: 'narrow', label: 'Narrow' },
          { value: 'contained', label: 'Normal' },
          { value: 'wide', label: 'Wide' },
          { value: 'full', label: 'Full' },
        ]}
        onChange={(value) => set({ width: value as typeof section.width }, `sec:${index}:width`)}
      />

      {/*
        Presets plus a drag, not one or the other. The buttons are the quick
        answer and keep a site consistent; the drag is for when a section
        needs to be a particular height and no preset is it.
      */}
      <Segmented
        label="Space above and below"
        value={String(section.paddingY)}
        options={SECTION_PADDING_PRESETS.map((preset) => ({
          value: String(preset.value),
          label: preset.label,
        }))}
        onChange={(value) =>
          set({ paddingY: normaliseSectionPadding(Number(value)) }, `sec:${index}:pad`)
        }
      />

      <p className="ed-hint">
        {section.paddingY}px above and below. Drag the handle at the foot of the
        section to fine tune it.
      </p>

      <Measure
        label="Minimum height"
        value={section.minHeight}
        max={MAX_MIN_HEIGHT}
        step={10}
        hint="A floor, not a fixed height. A section with more content in it still grows."
        onChange={(minHeight) => set({ minHeight }, `sec:${index}:minh`)}
      />

      <BoxPanel
        what="section"
        box={section.box}
        onChange={(box) => set({ box }, `sec:${index}:box`)}
      />

      <div className="ed-field">
        <label className="ed-label">Background image</label>
        <input
          className="ed-input"
          value={section.backgroundImage ?? ''}
          placeholder="https://…"
          onChange={(event) => set({ backgroundImage: event.target.value }, `sec:${index}:bg`)}
        />
        <p className="ed-help">
          A dark scrim goes over it automatically so text still passes contrast.
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function RowFields({
  page,
  section,
  row,
  onCommit,
}: {
  page: Page;
  section: number;
  row: number;
  onCommit: Props['onCommit'];
}) {
  const node = page.sections[section]?.rows[row];
  if (!node) return null;

  const set = (patch: Parameters<typeof updateRow>[3], key: string) =>
    onCommit((current) => updateRow(current, section, row, patch), key);

  return (
    <>
      <div className="ed-field">
        <label className="ed-label">Column widths</label>
        <div className="ed-widths">
          {node.columns.map((column, index) => (
            <div className="ed-width-row" key={column.id}>
              <span>Column {index + 1}</span>
              <input
                type="range"
                min={MIN_COLUMN_WIDTH}
                max={100 - MIN_COLUMN_WIDTH * (node.columns.length - 1)}
                step={1}
                value={Math.round(column.width)}
                disabled={node.columns.length === 1}
                aria-label={`Column ${index + 1} width`}
                onChange={(event) => {
                  const delta = Number(event.target.value) - column.width;
                  // The slider drives the boundary to its right, or the one
                  // to its left for the last column, so the row always still
                  // sums to 100 without a second slider fighting it.
                  const boundary = index === node.columns.length - 1 ? index - 1 : index;
                  const signed = index === node.columns.length - 1 ? -delta : delta;
                  onCommit(
                    (current) => resizeColumnBoundary(current, section, row, boundary, signed),
                    `row:${section}:${row}:width`,
                  );
                }}
              />
              <output>{Math.round(column.width)}%</output>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            type="button"
            className="ed-btn"
            style={{ flex: 1 }}
            disabled={node.columns.length >= 6}
            onClick={() => onCommit((current) => addColumn(current, section, row))}
          >
            + Column
          </button>
          <button
            type="button"
            className="ed-btn"
            style={{ flex: 1 }}
            disabled={node.columns.length <= 1}
            onClick={() => onCommit((current) => removeColumn(current, section, row, node.columns.length - 1))}
          >
            − Column
          </button>
          <button
            type="button"
            className="ed-btn"
            style={{ flex: 1 }}
            disabled={node.columns.length <= 1}
            onClick={() => onCommit((current) => evenColumns(current, section, row))}
          >
            Even
          </button>
        </div>
        <p className="ed-help">
          Removing a column moves its blocks into the one beside it rather than
          deleting them.
        </p>
      </div>

      <Measure
        label="Spacing between columns"
        value={node.gap}
        max={MAX_GAP}
        step={2}
        onChange={(gap) => set({ gap }, `row:${section}:${row}:gap`)}
      />

      <Segmented
        label="Stack into one column"
        value={node.stackBelow}
        options={[
          { value: 'mobile', label: 'On phones' },
          { value: 'tablet', label: 'On tablets too' },
        ]}
        onChange={(value) =>
          set({ stackBelow: value as typeof node.stackBelow }, `row:${section}:${row}:stack`)
        }
      />
      <p className="ed-help" style={{ marginTop: -8, marginBottom: 14 }}>
        Columns always stack on small screens. That is what stops a layout
        becoming unreadable on a phone.
      </p>

      <div className="ed-field">
        <label className="ed-toggle">
          <input
            type="checkbox"
            checked={node.reverseOnStack}
            onChange={(event) =>
              set({ reverseOnStack: event.target.checked }, `row:${section}:${row}:reverse`)
            }
          />
          <span>Reverse the order when stacked</span>
        </label>
        <p className="ed-help">
          Useful when an image sits on the right but should lead on a phone.
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function ColumnFields({
  page,
  section,
  row,
  column,
  onCommit,
}: {
  page: Page;
  section: number;
  row: number;
  column: number;
  onCommit: Props['onCommit'];
}) {
  const node = page.sections[section]?.rows[row]?.columns[column];
  if (!node) return null;

  return (
    <>
      <div className="ed-field">
        <label className="ed-label">Width</label>
        <p className="ed-help" style={{ margin: 0 }}>
          {Math.round(node.width)}% of the row. Drag the edge in the preview, or
          use the sliders on the row.
        </p>
      </div>

      <Segmented
        label="Vertical alignment"
        value={node.align}
        options={[
          { value: 'top', label: 'Top' },
          { value: 'centre', label: 'Middle' },
          { value: 'bottom', label: 'Bottom' },
        ]}
        onChange={(value) =>
          onCommit(
            (current) =>
              updateColumn(current, section, row, column, { align: value as typeof node.align }),
            `col:${section}:${row}:${column}:align`,
          )
        }
      />

      {/* The same panel a section gets, from the same component. */}
      <BoxPanel
        what="column"
        box={node.box}
        onChange={(box) =>
          onCommit(
            (current) => updateColumn(current, section, row, column, { box }),
            `col:${section}:${row}:${column}:box`,
          )
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function BlockFields({
  path,
  page,
  isStaff,
  onCommit,
}: {
  path: Extract<Path, { kind: 'block' }>;
  page: Page;
  isStaff: boolean;
  onCommit: Props['onCommit'];
}) {
  const block = page.sections[path.section]?.rows[path.row]?.columns[path.column]?.blocks[path.block];
  if (!block) return null;

  const definition = blockDefinition(block.type);

  if (!definition) {
    return (
      <p className="ed-empty-note">
        This block ({block.type}) was made by a newer version of the editor, so
        its settings cannot be shown. It is safe to leave alone, and it will
        survive being saved.
      </p>
    );
  }

  if (definition.staffOnly && !isStaff) {
    return (
      <p className="ed-empty-note">
        This block is managed by Travelgenix. Get in touch if it needs changing.
      </p>
    );
  }

  return (
    <>
      <p className="ed-help" style={{ marginTop: 0, marginBottom: 14 }}>
        <strong>{definition.label}</strong> · {definition.description}
      </p>

      {definition.fields.map((field) => (
        <FieldRenderer
          key={field.key}
          field={field}
          value={block.props[field.key]}
          ownerId={block.id}
          onChange={(value) =>
            onCommit(
              (current) =>
                updateBlockProps(current, path.section, path.row, path.column, path.block, {
                  [field.key]: value,
                }),
              `blk:${block.id}:${field.key}`,
            )
          }
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ed-field">
      <label className="ed-label">{label}</label>
      <div className="ed-segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
