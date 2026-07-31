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

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Page } from '../../lib/content/schema';
import {
  MAX_GAP,
  MAX_MIN_HEIGHT,
  MIN_COLUMN_WIDTH,
  normaliseSectionPadding,
  PADDING_PRESETS,
} from '../../lib/content/schema';
import { BoxPanel, Measure } from './BoxControls';
import { blockDefinition } from '../../lib/content/blocks';
import {
  type Path,
  pathKey,
  addColumn,
  evenColumns,
  removeColumn,
  resizeColumnBoundary,
  updateColumn,
  updateRow,
  updateSection,
  updateBlockProps,
} from '../../lib/content/tree';
import { ImageField } from '../media/ImageField';
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

/**
 * The chain from the page down to what is selected, each step selectable.
 *
 * WHY THIS EXISTS, and it is the second attempt at the problem.
 *
 * Clicking the canvas selects the innermost thing under the pointer, which is
 * almost always a block. So once a column has any content in it, there is
 * nowhere left to click to reach the COLUMN, and its width, padding, background
 * and border become unreachable. Andy reported exactly that on 30 Jul 2026, and
 * again after the first fix: "it still collapses, so you can't get to any of the
 * column settings".
 *
 * The first fix put a small label on the column that appeared on hover and could
 * be clicked. It worked, and a browser check proved it worked, and Andy still
 * could not find it: 60 by 19 pixels, only on hover, and styled exactly like the
 * badges that merely NAME what is selected. It read as a caption, not a control.
 *
 * This is the standard answer instead, and it fixes rows and sections too rather
 * than only columns: show where you are, and let people step up. Nothing to
 * hover, nothing to discover, and it cannot be covered by the content.
 */
function Breadcrumb({
  selected,
  page,
  onSelect,
}: {
  selected: Path;
  page: Page;
  onSelect: (path: Path) => void;
}) {
  const trail = ancestors(selected);
  // One step is just the thing itself, which is what the title already says.
  if (trail.length < 2) return null;

  return (
    <nav className="ed-crumbs" aria-label="Where this sits">
      {trail.map((path, index) => {
        const last = index === trail.length - 1;
        return (
          <span key={pathKey(path)}>
            {index > 0 && (
              <Icon name="chevron-right" size={12} className="ed-crumbs__sep" aria-hidden="true" />
            )}
            <button
              type="button"
              className="ed-crumbs__step"
              aria-current={last ? 'true' : undefined}
              onClick={() => onSelect(path)}
            >
              {crumbLabel(path, page)}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

/** Page, section, row, column, block: whichever of those the selection has. */
function ancestors(path: Path): Path[] {
  const trail: Path[] = [];
  if (path.kind === 'page') return [path];

  trail.push({ kind: 'section', section: path.section });
  if (path.kind === 'section') return trail;

  trail.push({ kind: 'row', section: path.section, row: path.row });
  if (path.kind === 'row') return trail;

  trail.push({ kind: 'column', section: path.section, row: path.row, column: path.column });
  if (path.kind === 'column') return trail;

  trail.push(path);
  return trail;
}

/**
 * Short labels, because the pane is 320px and a full heading would wrap to three
 * lines. The title underneath already says what the selected thing is in full.
 */
function crumbLabel(path: Path, page: Page): string {
  switch (path.kind) {
    case 'page':
      return 'Page';
    case 'section':
      return `Section ${path.section + 1}`;
    case 'row':
      return `Row ${path.row + 1}`;
    case 'column':
      return `Column ${path.column + 1}`;
    case 'block': {
      const block = page.sections[path.section]?.rows[path.row]?.columns[path.column]
        ?.blocks[path.block];
      return block ? (blockDefinition(block.type)?.label ?? 'Block') : 'Block';
    }
    default:
      return 'Item';
  }
}

export function Properties({ page, selected, isStaff, onSelect, onCommit, onBack }: Props) {
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
        {selected && <Breadcrumb selected={selected} page={page} onSelect={onSelect} />}

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
 * A collapsible group of related settings.
 *
 * The pane used to be ten controls in a flat list, which is fine to build and
 * miserable to scan: nothing tells you that tone and width are the same kind
 * of decision and padding is a different one. Groups give the pane a shape,
 * and closing the ones you are not using is the difference between a wall and
 * a tool.
 *
 * Open state lives here rather than in the parent because it is a property of
 * the panel, not of the page, and it should survive selecting a different
 * section.
 */
function Group({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="ed-group" data-open={open ? 'true' : 'false'}>
      <h3 className="ed-group__head">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
          {title}
        </button>
      </h3>
      {open && <div className="ed-group__body">{children}</div>}
    </section>
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
      <Group title="Name">
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

      </Group>

      <Group title="Layout">
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
      </Group>

      <Group title="Spacing and size">
      <Segmented
        label="Space above and below"
        value={String(section.paddingY)}
        options={PADDING_PRESETS.map((preset) => ({
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

      </Group>

      <Group title="Style" defaultOpen={false}>
        <BoxPanel
          what="section"
          box={section.box}
          onChange={(box) => set({ box }, `sec:${index}:box`)}
        />
      </Group>

      <Group title="Background image" defaultOpen={false}>

      <div className="ed-field">
        <label className="ed-label">Background image</label>
        {/*
          The same control as every other image, rather than the bare URL box this
          used to be. No alt text to fill: a background is decorative by definition,
          and the scrim over it means any text on top belongs to the blocks inside
          the section, not to the picture.
        */}
        <ImageField
          value={section.backgroundImage ?? ''}
          onChange={(url) => set({ backgroundImage: url }, `sec:${index}:bg`)}
        />
        <p className="ed-help">
          A dark scrim goes over it automatically so text still passes contrast.
        </p>
      </div>
      </Group>
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
          /*
           * The same commit, with more than one prop in it. updateBlockProps already
           * takes a patch, so this is the shape it wanted anyway. Used by the image
           * field to set the picture and its description together, which keeps undo
           * to one step for what a person did in one action.
           */
          onPatch={(patch) =>
            onCommit(
              (current) =>
                updateBlockProps(current, path.section, path.row, path.column, path.block, patch),
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
      {/*
        One track with equal segments, not N separate buttons.
        As five buttons this wrapped, so "XL" sat on its own line under the
        other four and the control stopped reading as one choice. Equal
        fractions of a single track cannot wrap and cannot mislead.
      */}
      <div
        className="ed-segmented"
        role="group"
        aria-label={label}
        style={{ '--ed-seg-count': options.length } as CSSProperties}
      >
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
