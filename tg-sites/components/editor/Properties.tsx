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

import { useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import type { Block, Box, Page, RegionName } from '../../lib/content/schema';
import {
  DEFAULT_DIVIDER_HEIGHT,
  DIVIDER_OPTIONS,
  MAX_DIVIDER_HEIGHT,
  MIN_DIVIDER_HEIGHT,
} from '../../lib/content/dividers';
import { safeSlug, safeTags, type FieldValue } from '../../lib/content/collection';
import { missingRequired, type FieldDef } from '../../lib/content/collection-fields';
import type { ItemMeta } from '../../lib/content/collection-page';
import {
  anchorInput,
  safeAnchor,
  EMPTY_BOX,
  MAX_BORDER,
  MAX_GAP,
  MAX_MIN_HEIGHT,
  MAX_PULL_UP,
  MAX_RADIUS,
  MIN_COLUMN_WIDTH,
  MOTION_ARRIVAL_RECIPES,
  MOTION_BACKGROUND_RECIPES,
  normaliseSectionPadding,
  PADDING_PRESETS,
  type MotionRecipe,
} from '../../lib/content/schema';
import {
  resolveAt,
  isOverridden,
  withOverride,
  clearOverride,
  INHERITS_FROM,
  TIER_LABEL,
  type Tier,
} from '../../lib/content/responsive';
import {
  clearTextSizing,
  FONT_SIZES,
  FONT_SIZE_GROUPS,
  hasInlineTextSizing,
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  MOTION_CHOICES,
  MOTION_INTENSITIES,
  normaliseLetterSpacing,
  normaliseLineHeight,
  normaliseRevealStyle,
  normaliseTextSize,
  REVEAL_STYLES,
} from '../../lib/content/styles';
import { BoxPanel, ColourField, Measure, PaddingBox, ScreenScope } from './BoxControls';
import { blockDefinition, type Field, type FieldGroup } from '../../lib/content/blocks';
import {
  type Path,
  pathKey,
  addColumn,
  addInnerColumn,
  blockAtPath,
  evenColumns,
  evenInnerColumns,
  moveColumn,
  removeColumn,
  removeInnerColumn,
  resizeColumnBoundary,
  resizeInnerColumnBoundary,
  updateColumn,
  updateRow,
  updateSection,
  updateBlockBoxAtPath,
  updateBlockPropsAtPath,
  updateBlockResponsiveAtPath,
  updateBlockHideOnAtPath,
  updateInnerColumn,
  containerColumns,
  setInnerColumnSpan,
} from '../../lib/content/tree';
import { hasInnerColumns, MAX_GRID_CELLS } from '../../lib/content/inner-columns';
import { ImageField } from '../media/ImageField';
import { FieldRenderer } from './Fields';
import { Icon } from './Icon';
import { ListingFilterFields } from './ListingFilterFields';
import { columnWord, sectionNameAt } from '../../lib/content/naming';
import { writeSeoAction } from '../../app/actions/ai';
import { rebuildImportAction } from '../../app/actions/import';
import { pageText } from '../../lib/seo/audit';

/**
 * The three alignments, for the tier-aware Alignment control on a text or heading
 * block. The same values and labels the registry's ALIGN_OPTIONS carries, kept
 * here because that one is a private const of the block library and this control
 * replaces it for these two block types.
 */
const ALIGN_CHOICES: Array<{ value: string; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'centre', label: 'Centre' },
  { value: 'right', label: 'Right' },
];

interface Props {
  page: Page;
  selected: Path | null;
  isStaff: boolean;
  /**
   * Whether this member may restructure and restyle. Off for a content-only
   * client, whose block pane then shows only the Content group, the words, the
   * picture and the link, and drops the colour, border, spacing, layout and
   * effect panels they cannot use. The server refuses those changes either way
   * (lib/content/change-scope.ts); this keeps the pane honest about it.
   */
  canStructure: boolean;
  onSelect: (path: Path | null) => void;
  onCommit: (next: (current: Page) => Page, coalesceKey?: string) => void;
  onBack: () => void;
  /**
   * Set when this editor is on the site's header or footer rather than a page.
   *
   * The only thing it changes in here is the root of the tree: a page's root
   * carries a title, an address and a search listing, and a region's carries
   * neither of the first two and cannot have the third. Everything below the
   * root is identical, because a section in a header is a section.
   */
  region?: RegionName | null;
  regionFlags?: { sticky: boolean; overlay: boolean };
  onRegionFlags?: (next: { sticky: boolean; overlay: boolean }) => void;
  /**
   * Set when this editor is on an entry in a collection rather than a page.
   *
   * Same shape of change as `region`: the only thing it touches is the root of
   * the tree. A post has a summary, a picture and a date where a page has an
   * address and a search listing, and everything below the root is identical.
   */
  isItem?: boolean;
  itemMeta?: ItemMeta;
  onItemMeta?: (next: ItemMeta) => void;
  /**
   * What this entry's own collection declares its entries have, in the order
   * the collections screen put them in. Empty for a blog, and empty for every
   * collection made before collections had a schema of their own.
   */
  itemFields?: FieldDef[];
  /**
   * True while the on-canvas options popover is open for this same item.
   *
   * The popover and this pane draw the SAME fields, and two live copies of every
   * control on the screen at once read as broken the moment one was touched. So
   * while the popover is up the pane steps aside and shows a short note instead:
   * one editing surface at a time. See EditorShell's optionsOpen.
   */
  editingOnCanvas?: boolean;
  /** The screen size the device switcher is on, threaded to per-screen controls. */
  viewport?: Tier;
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
  region,
  onSelect,
}: {
  selected: Path;
  page: Page;
  region: RegionName | null;
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
              {crumbLabel(path, page, region)}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

/** Page, section, row, column, block, and a container's inner column and block. */
function ancestors(path: Path): Path[] {
  const trail: Path[] = [];
  if (path.kind === 'page') return [path];

  trail.push({ kind: 'section', section: path.section });
  if (path.kind === 'section') return trail;

  trail.push({ kind: 'row', section: path.section, row: path.row });
  if (path.kind === 'row') return trail;

  trail.push({ kind: 'column', section: path.section, row: path.row, column: path.column });
  if (path.kind === 'column') return trail;

  // The block, or the container that holds an inner node: either way this level
  // is a block at (section, row, column, block).
  trail.push({ kind: 'block', section: path.section, row: path.row, column: path.column, block: path.block });
  if (path.kind === 'block') return trail;

  trail.push({
    kind: 'inner-column',
    section: path.section,
    row: path.row,
    column: path.column,
    block: path.block,
    inner: path.inner,
  });
  if (path.kind === 'inner-column') return trail;

  trail.push(path);
  return trail;
}

/**
 * Short labels, because the pane is 320px and a full heading would wrap to three
 * lines. The title underneath already says what the selected thing is in full.
 */
function crumbLabel(path: Path, page: Page, region: RegionName | null): string {
  switch (path.kind) {
    case 'page':
      return region === 'header' ? 'Header' : region === 'footer' ? 'Footer' : 'Page';
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
    case 'inner-column':
      return `Column ${path.inner + 1}`;
    case 'inner-block': {
      const container = page.sections[path.section]?.rows[path.row]?.columns[path.column]
        ?.blocks[path.block];
      const inner = container ? containerColumns(container)[path.inner]?.blocks[path.innerBlock] : undefined;
      return inner ? (blockDefinition(inner.type)?.label ?? 'Block') : 'Block';
    }
    default:
      return 'Item';
  }
}

export function Properties({
  page,
  selected,
  isStaff,
  canStructure,
  onSelect,
  onCommit,
  onBack,
  region = null,
  regionFlags,
  onRegionFlags,
  isItem = false,
  itemMeta,
  onItemMeta,
  itemFields,
  editingOnCanvas = false,
  viewport = 'desktop',
}: Props) {
  return (
    <aside className="ed-props" aria-label="Properties">
      <div className="ed-panel-head">
        <span className="ed-panel-title">
          {selected ? headingFor(selected, page, region, isItem) : 'Settings'}
        </span>
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
        {selected && (
          <Breadcrumb selected={selected} page={page} region={region} onSelect={onSelect} />
        )}

        {!selected && (
          <p className="ed-empty-note">
            Select a section, row or block in the outline or the preview and its
            settings appear here.
          </p>
        )}

        {editingOnCanvas ? (
          <p className="ed-empty-note">
            You are editing this on the page. The options are open on the canvas,
            and anything you change there shows here too. Close them to bring the
            settings back to this panel.
          </p>
        ) : (
          <ItemOptions
            page={page}
            selected={selected}
            isStaff={isStaff}
            canStructure={canStructure}
            onCommit={onCommit}
            onSelect={onSelect}
            region={region}
            regionFlags={regionFlags}
            onRegionFlags={onRegionFlags}
            isItem={isItem}
            itemMeta={itemMeta}
            onItemMeta={onItemMeta}
            itemFields={itemFields}
            tier={viewport}
          />
        )}
      </div>
    </aside>
  );
}

/**
 * The fields for whatever is selected, and nothing around them.
 *
 * PULLED OUT OF THE PANE ON 2 AUG 2026 so the on-canvas toolbar can show the
 * same editors in a popover next to the item. Both surfaces render this, so a
 * new field or a fixed one appears in both at once and the two cannot drift. It
 * is deliberately just the body: no panel chrome, no heading, no breadcrumb,
 * because the popover frames it differently from the pane.
 */
export function ItemOptions({
  page,
  selected,
  isStaff,
  canStructure = true,
  onCommit,
  onSelect,
  region = null,
  regionFlags,
  onRegionFlags,
  isItem = false,
  itemMeta,
  onItemMeta,
  itemFields,
  tier = 'desktop',
}: {
  page: Page;
  selected: Path | null;
  isStaff: boolean;
  /**
   * Whether design controls are shown for a block. Defaults to on, so the
   * on-canvas popover and any other caller keep the whole pane; the main pane
   * passes the member's real capability down. See BlockFields.
   */
  canStructure?: boolean;
  onCommit: Props['onCommit'];
  /**
   * The screen size the device switcher is on, so a per-screen control edits the
   * right size. Defaults to desktop, which is the base, so a caller that has no
   * device switcher (or has not wired it yet) simply edits the base as before.
   */
  tier?: Tier;
  /**
   * Set in the main pane, absent on the on-canvas popover which has no selection
   * to hand back. Only the imported block's "Make editable" reads it, to show
   * the rebuilt section once the old block path is gone.
   */
  onSelect?: Props['onSelect'];
  region?: RegionName | null;
  regionFlags?: Props['regionFlags'];
  onRegionFlags?: Props['onRegionFlags'];
  isItem?: boolean;
  itemMeta?: Props['itemMeta'];
  onItemMeta?: Props['onItemMeta'];
  itemFields?: Props['itemFields'];
}) {
  return (
    <>
      {selected?.kind === 'page'
        && (region ? (
          <RegionFields
            region={region}
            flags={regionFlags ?? { sticky: false, overlay: false }}
            onChange={onRegionFlags}
          />
        ) : isItem ? (
          <ItemFields
            meta={
              itemMeta ?? {
                title: '',
                summary: '',
                image: '',
                alt: '',
                author: '',
                date: '',
                tags: [],
                fields: {},
                slug: '',
              }
            }
            onChange={onItemMeta}
            defs={itemFields ?? []}
          />
        ) : (
          <PageFields page={page} onCommit={onCommit} />
        ))}

      {selected?.kind === 'section' && (
        <SectionFields page={page} index={selected.section} onCommit={onCommit} tier={tier} />
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

      {selected?.kind === 'inner-column' && (
        <InnerColumnFields path={selected} page={page} onCommit={onCommit} />
      )}

      {/* A block and a block inside a container share the one pane: BlockFields
          reads and commits through the path, so it works either place. */}
      {(selected?.kind === 'block' || selected?.kind === 'inner-block') && (
        <BlockFields
          path={selected}
          page={page}
          isStaff={isStaff}
          canStructure={canStructure}
          onCommit={onCommit}
          onSelect={onSelect}
          tier={tier}
        />
      )}
    </>
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
function headingFor(
  path: Path,
  page: Page,
  region: RegionName | null,
  isItem = false,
): string {
  switch (path.kind) {
    case 'page':
      return region === 'header'
        ? 'Header settings'
        : region === 'footer'
          ? 'Footer settings'
          : isItem
            ? 'This entry'
            : 'Page settings';
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
    case 'inner-column': {
      const container =
        page.sections[path.section]?.rows[path.row]?.columns[path.column]?.blocks[path.block];
      const columns = container ? containerColumns(container) : [];
      return columnWord(path.inner, columns.length || 1);
    }
    case 'inner-block': {
      const container =
        page.sections[path.section]?.rows[path.row]?.columns[path.column]?.blocks[path.block];
      const inner = container ? containerColumns(container)[path.inner]?.blocks[path.innerBlock] : undefined;
      return blockDefinition(inner?.type ?? '')?.label ?? 'Content';
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * The root of a header or a footer.
 *
 * WHAT IS NOT HERE IS THE POINT. A page's root carries a title, an address and
 * a search listing. A header has none of those: it is not a URL, it is not
 * indexed on its own and its title is the word "Header". Showing those fields
 * greyed out would have been the lazy option; leaving them out says plainly
 * that this is a different kind of thing.
 *
 * A FOOTER GETS NO SETTINGS AT ALL, and that is honest rather than unfinished.
 * Sticky and overlay are both about a bar at the top of the screen, and a
 * footer at the top of the screen is not a footer.
 */
function RegionFields({
  region,
  flags,
  onChange,
}: {
  region: RegionName;
  flags: { sticky: boolean; overlay: boolean };
  onChange?: (next: { sticky: boolean; overlay: boolean }) => void;
}) {
  if (region === 'footer') {
    return (
      <p className="ed-empty-note">
        Your footer appears at the bottom of every page. Add sections to it just
        as you would to a page, and publish when you are happy with it.
      </p>
    );
  }

  return (
    <>
      <p className="ed-empty-note">
        Your header appears at the top of every page. Publishing it changes all
        of them at once.
      </p>

      <div className="ed-field">
        <label className="ed-toggle">
          <input
            type="checkbox"
            checked={flags.sticky}
            onChange={(event) => onChange?.({ ...flags, sticky: event.target.checked })}
          />
          <span>Stay on screen while scrolling</span>
        </label>
        <p className="ed-help">The header follows the visitor down the page.</p>
      </div>

      <div className="ed-field">
        <label className="ed-toggle">
          <input
            type="checkbox"
            checked={flags.overlay}
            onChange={(event) => onChange?.({ ...flags, overlay: event.target.checked })}
          />
          <span>Sit over the first section</span>
        </label>
        <p className="ed-help">
          For a page that opens with a big photograph. The header floats on top
          of it instead of pushing it down, so give the section behind it
          something to see and set the header text to suit.
        </p>
      </div>

      {/*
        Shown rather than prevented. The two settings are legitimate on their
        own and legitimate together, and the combination is simply worth
        knowing about before somebody publishes it to every page.
      */}
      {flags.sticky && flags.overlay && (
        <p className="ed-help">
          With both on, the header is pinned to the top of the window and
          everything scrolls underneath it.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The root of a blog post, or anything else in a collection.
 *
 * WHAT IS NOT HERE. No search title and no search description of its own: the
 * summary is both, because asking somebody to write the same sentence twice is
 * how one of them ends up stale. The title is not here either, for the same
 * reason it is not on a region: it is the box in the top bar.
 */
function ItemFields({
  meta,
  onChange,
  defs,
}: {
  meta: ItemMeta;
  onChange?: (next: ItemMeta) => void;
  defs: FieldDef[];
}) {
  const set = (patch: Partial<ItemMeta>) => onChange?.({ ...meta, ...patch });

  return (
    <>
      <div className="ed-field">
        <label className="ed-label">Address</label>
        <input
          className="ed-input"
          value={meta.slug}
          placeholder="ten-things-about-crete"
          /*
            Reduced as it is typed, the same as a section's anchor and for the
            same reason: this becomes part of a URL, and showing something the
            save will quietly correct is the one thing to avoid. Trailing hyphens
            survive the keystroke and go on blur, or the second word could never
            be started.
          */
          onChange={(event) =>
            set({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 120) })
          }
          onBlur={(event) => set({ slug: safeSlug(event.target.value) })}
        />
        <p className="ed-help">
          {meta.slug ? `Lives at /.../${meta.slug}` : 'Taken from the title if you leave it blank.'}
        </p>
      </div>

      <div className="ed-field">
        <label className="ed-label">Date</label>
        <input
          className="ed-input"
          type="date"
          value={meta.date}
          onChange={(event) => set({ date: event.target.value })}
        />
        <p className="ed-help">Shown on the card in a listing. Not when it was published.</p>
      </div>

      <div className="ed-field">
        <label className="ed-label">Author</label>
        <input
          className="ed-input"
          maxLength={120}
          value={meta.author}
          placeholder="Jane Doe"
          onChange={(event) => set({ author: event.target.value })}
        />
        <p className="ed-help">The byline, shown on the post and the card. Leave it blank for none.</p>
      </div>

      <div className="ed-field">
        <label className="ed-label">Summary</label>
        <textarea
          className="ed-textarea"
          rows={3}
          maxLength={400}
          value={meta.summary}
          onChange={(event) => set({ summary: event.target.value })}
        />
        <p className="ed-help">
          The line under the title in a listing, and what search engines show.
          {' '}{meta.summary.length} of 400 characters.
        </p>
      </div>

      <TagsField tags={meta.tags} onChange={(tags) => set({ tags })} />

      <div className="ed-field">
        <label className="ed-label">Picture</label>
        <ImageField value={meta.image} onChange={(url) => set({ image: url })} />
        <p className="ed-help">Shown on the card in a listing.</p>
      </div>

      <div className="ed-field">
        <label className="ed-label">Alt text</label>
        <input
          className="ed-input"
          maxLength={200}
          value={meta.alt}
          onChange={(event) => set({ alt: event.target.value })}
        />
        <p className="ed-help">Describe the picture for anyone who cannot see it.</p>
      </div>

      <DeclaredFields
        defs={defs}
        values={meta.fields}
        onChange={(fields) => set({ fields })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The fields this entry's own collection declares, as a form.
 *
 * THE FORM GENERATOR the collections table has been waiting for since migration
 * 0004. One control per definition, in the order the collections screen put them
 * in, keyed by the definition's key. Nothing here is a special case for a
 * particular collection: a Tours collection and a Destinations one draw the same
 * way from their own lists.
 *
 * NOTHING SHOWS FOR A COLLECTION THAT DECLARES NOTHING, which is a blog, and is
 * why this is the last thing in the panel rather than the first: the six fixed
 * fields above are what every entry has, and these are the extra a client asked
 * for.
 *
 * REQUIRED IS A PROMPT, NOT A LOCK. An empty required field says so under the
 * control and nothing else happens: a draft is allowed to be half written, and
 * a save that refused would lose the rest of it. The list of what is still
 * missing is what the publish button will eventually read.
 */
function DeclaredFields({
  defs,
  values,
  onChange,
}: {
  defs: FieldDef[];
  values: Record<string, FieldValue>;
  onChange: (next: Record<string, FieldValue>) => void;
}) {
  if (defs.length === 0) return null;

  const set = (key: string, value: FieldValue | undefined) => {
    const next = { ...values };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const missing = missingRequired(defs, values);

  return (
    <>
      {defs.map((def) => {
        const value = values[def.key];
        const empty = missing.some((field) => field.key === def.key);
        const id = `item-field-${def.key}`;

        return (
          <div className="ed-field" key={def.key}>
            <label className="ed-label" htmlFor={id}>
              {def.label}
            </label>

            {def.kind === 'longtext' && (
              <textarea
                id={id}
                className="ed-textarea"
                rows={3}
                maxLength={2000}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => set(def.key, event.target.value)}
              />
            )}

            {def.kind === 'choice' && (
              <select
                id={id}
                className="ed-select"
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => set(def.key, event.target.value)}
              >
                <option value="">Not set</option>
                {def.choices.map((choice) => (
                  <option value={choice} key={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            )}

            {def.kind === 'toggle' && (
              <label className="ed-toggle">
                <input
                  id={id}
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) => set(def.key, event.target.checked)}
                />
                <span>{value === true ? 'Yes' : 'No'}</span>
              </label>
            )}

            {def.kind === 'image' && (
              <ImageField
                value={typeof value === 'string' ? value : ''}
                onChange={(url) => set(def.key, url)}
              />
            )}

            {(def.kind === 'text' || def.kind === 'number' || def.kind === 'price'
              || def.kind === 'date') && (
              <input
                id={id}
                className="ed-input"
                /*
                 * A price is typed as a number, not as text with a currency in
                 * it: the site's own money formatting puts the symbol on at
                 * render, so storing "£1,299" would print it twice.
                 */
                type={def.kind === 'date' ? 'date' : def.kind === 'text' ? 'text' : 'number'}
                inputMode={def.kind === 'price' ? 'decimal' : undefined}
                step={def.kind === 'price' ? '0.01' : undefined}
                maxLength={def.kind === 'text' ? 200 : undefined}
                value={value === undefined ? '' : String(value)}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (def.kind === 'number' || def.kind === 'price') {
                    // Held as typed while the box has focus, so a half-typed
                    // "12." is not snapped to 12 under the caret. The save is
                    // what turns it into a number, through cleanFieldValues.
                    set(def.key, raw);
                    return;
                  }
                  set(def.key, raw);
                }}
              />
            )}

            {empty && <p className="ed-help" data-tone="warn">Asked for before publishing.</p>}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The tags on a post, edited as removable chips.
 *
 * A chip each, and an input to add the next. safeTags runs on every addition so
 * the pane can never hold a tag the save would refuse: a blank, a duplicate, one
 * past the length cap, or a thirteenth. Enter or a comma commits what has been
 * typed, so pasting "Crete, Rhodes, Kos" files three at once; Backspace on an
 * empty box removes the last chip, the usual shorthand. It shares the schema's
 * own helper, so what shows here and what is stored can never disagree.
 */
function TagsField({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    onChange(safeTags([...tags, raw]));
    setDraft('');
  };

  const removeAt = (index: number) => onChange(tags.filter((_, i) => i !== index));

  return (
    <div className="ed-field">
      <label className="ed-label">Tags</label>
      <div className="ed-tags">
        {tags.map((tag, index) => (
          <span key={`${tag}-${index}`} className="ed-tags__chip">
            {tag}
            <button
              type="button"
              className="ed-tags__x"
              aria-label={`Remove ${tag}`}
              onClick={() => removeAt(index)}
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
        <input
          className="ed-tags__input"
          value={draft}
          placeholder={tags.length ? 'Add another' : 'Crete, Family holidays'}
          onChange={(event) => {
            const value = event.target.value;
            // A comma means "that tag is done", so a paste of several at once
            // files each and leaves whatever trails the last comma in the box.
            if (value.includes(',')) {
              const parts = value.split(',');
              const trailing = parts.pop() ?? '';
              const additions = parts.map((part) => part.trim()).filter(Boolean);
              if (additions.length > 0) onChange(safeTags([...tags, ...additions]));
              setDraft(trailing);
            } else {
              setDraft(value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (draft.trim()) commit(draft);
            } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
              removeAt(tags.length - 1);
            }
          }}
          // A tag half-typed and then clicked away from is still meant, so it is
          // committed on blur rather than quietly lost.
          onBlur={() => { if (draft.trim()) commit(draft); }}
        />
      </div>
      <p className="ed-help">Group posts by topic. Press Enter or comma after each one.</p>
    </div>
  );
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

      {/*
        THE ASSISTANT WRITES BOTH FIELDS IN ONE COMMIT, which is why it sits
        above them rather than a button on each. A title and a description that
        were written separately say the same thing twice, and two commits would
        give the undo history two steps for one action, so undoing would leave
        half of it behind.

        It reads the DRAFT in front of the client, not the published page: the
        description they want is of what they are looking at.
      */}
      <SeoAssistant page={page} onWritten={(seo) => setSeo(seo, 'seo:assistant')} />

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

/**
 * Write these for me.
 *
 * READS THE DRAFT, NOT THE DATABASE. The page in front of the client may have
 * unsaved changes, and the description they want is of what they are looking at
 * rather than of what was last published. pageText walks the same tree the
 * canvas is rendering.
 *
 * BOTH FIELDS IN ONE COMMIT. A title and a description written separately end
 * up saying the same thing twice, and two commits would give the undo history
 * two steps for one action, so one undo would leave half the change behind.
 *
 * IT NEVER FOCUSES ANYTHING. The properties pane redraws on every keystroke and
 * this component redraws with it.
 */
function SeoAssistant({
  page,
  onWritten,
}: {
  page: Page;
  onWritten: (seo: { title: string; description: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  async function write() {
    setBusy(true);
    setFailed('');

    const result = await writeSeoAction({
      pageTitle: page.title,
      path: page.slug,
      text: pageText(page),
    });

    setBusy(false);
    if (!result.ok) {
      setFailed(result.error);
      return;
    }

    onWritten({ title: result.title, description: result.description });
  }

  return (
    <div className="ed-field">
      <button type="button" className="ed-btn" disabled={busy} onClick={() => void write()}>
        <Icon name="sparkle" size={14} />
        {busy ? 'Reading the page…' : 'Write these for me'}
      </button>
      {failed ? (
        <p className="ed-help" role="alert">{failed}</p>
      ) : (
        <p className="ed-help">
          Written from what is on this page, to the lengths Google actually shows.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SectionFields({
  page,
  index,
  onCommit,
  tier,
}: {
  page: Page;
  index: number;
  onCommit: Props['onCommit'];
  /** The screen size the device switcher is on: which size a per-screen control edits. */
  tier: Tier;
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
      {/*
        SPACE ABOVE AND BELOW, PER SCREEN. On desktop this sets the base, as it
        always did. On tablet or phone (the device switcher up top) it sets that
        size's own value, and the scope note underneath says so and offers a reset
        back to inheriting. The value shown is what the CURRENT size will actually
        take, resolved through the desktop-first fallback.
      */}
      <ScreenScope
        tier={tier}
        overridden={isOverridden(section.responsive, 'paddingY', tier)}
        onReset={() => {
          if (tier === 'desktop') return;
          set(
            { responsive: clearOverride(section.responsive, 'paddingY', tier) },
            `sec:${index}:pad:${tier}:reset`,
          );
        }}
      >
        <Segmented
          label="Space above and below"
          value={String(resolveAt(section.paddingY, section.responsive, 'paddingY', tier))}
          options={PADDING_PRESETS.map((preset) => ({
            value: String(preset.value),
            label: preset.label,
          }))}
          onChange={(value) => {
            const next = normaliseSectionPadding(Number(value));
            if (tier === 'desktop') set({ paddingY: next }, `sec:${index}:pad`);
            else set({ responsive: withOverride(section.responsive, 'paddingY', tier, next) }, `sec:${index}:pad:${tier}`);
          }}
        />
      </ScreenScope>

      <p className="ed-hint">
        {resolveAt(section.paddingY, section.responsive, 'paddingY', tier)}px above and below
        {tier !== 'desktop' ? ` on ${TIER_LABEL[tier].toLowerCase()}` : ''}. Drag the handle at
        the foot of the section to fine tune it.
      </p>

      <Measure
        label="Minimum height"
        value={section.minHeight}
        max={MAX_MIN_HEIGHT}
        step={10}
        hint="A floor, not a fixed height. A section with more content in it still grows."
        onChange={(minHeight) => set({ minHeight }, `sec:${index}:minh`)}
      />

      <Measure
        label="Overlap the section above"
        value={section.pullUp ?? 0}
        max={MAX_PULL_UP}
        step={4}
        hint="Slide this section up so it tucks under the one above it. The first section on a page slides up under the header, so a hero picture runs behind the logo and the menu, and the header goes see-through to let it show."
        onChange={(value) => set({ pullUp: value > 0 ? value : undefined }, `sec:${index}:pullup`)}
      />

      {/*
        HIDE THE WHOLE SECTION on the screen the device switcher is on, the same
        control a block has, on the same hideOn list. It stays on the canvas while
        editing so it can be selected again; it drops off the live layout and the
        preview at that screen's width.
      */}
      <HideOnField
        tier={tier}
        noun="section"
        hidden={(section.hideOn ?? []).includes(tier)}
        onChange={(hidden) => {
          const screens = new Set(section.hideOn ?? []);
          if (hidden) screens.add(tier);
          else screens.delete(tier);
          const next = [...screens];
          set({ hideOn: next.length ? next : undefined }, `sec:${index}:hideOn:${tier}`);
        }}
      />

      </Group>

      <Group title="Motion" defaultOpen={false}>
        {/*
          THE MOTION RECIPE, first in the group because it is the headline choice: it
          says how the whole section moves, where the switches below it are finer
          adjustments. Picking a recipe that drives the background clears parallax and
          Ken Burns, exactly as those two clear each other, because all three move the
          one picture and the render lets the recipe win.
        */}
        <div className="ed-field">
          <label className="ed-label" htmlFor={`ed-motion-${index}`}>
            Movement
          </label>
          <select
            id={`ed-motion-${index}`}
            className="ed-select"
            value={section.motion?.recipe ?? 'none'}
            onChange={(event) => {
              // Narrowed against the picker's own list rather than cast, so a value
              // that is not on offer cannot reach the model even from a crafted event.
              const recipe = MOTION_CHOICES.find((c) => c.value === event.target.value)?.value;
              if (!recipe || recipe === 'none') {
                set({ motion: undefined }, `sec:${index}:motion`);
                return;
              }
              const ownsBackground = MOTION_BACKGROUND_RECIPES.has(recipe satisfies MotionRecipe);
              const ownsArrival = MOTION_ARRIVAL_RECIPES.has(recipe satisfies MotionRecipe);
              set(
                {
                  motion: { recipe, intensity: section.motion?.intensity ?? 2 },
                  // Clear whatever this recipe takes over, so the pane never shows a
                  // switch ticked that the published page has stood down.
                  ...(ownsBackground ? { parallax: undefined, kenBurns: undefined } : {}),
                  ...(ownsArrival ? { reveal: undefined, revealStagger: undefined } : {}),
                },
                `sec:${index}:motion`,
              );
            }}
          >
            {MOTION_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <p className="ed-help" style={{ marginTop: 6 }}>
            How this section moves on its own. Pictures breathe drifts each picture in the
            section very slowly, each at its own pace. Background drifts moves the section&apos;s
            background picture instead, which suits a closing section at the foot of a page.
            Both stop for anyone who prefers less motion.
          </p>
        </div>
        {section.motion && (
          <div className="ed-field">
            <label className="ed-label" htmlFor={`ed-motion-intensity-${index}`}>
              How much
            </label>
            <select
              id={`ed-motion-intensity-${index}`}
              className="ed-select"
              value={String(section.motion.intensity)}
              onChange={(event) => {
                const band =
                  MOTION_INTENSITIES.find((b) => String(b.value) === event.target.value)?.value ?? 2;
                set(
                  { motion: { recipe: section.motion?.recipe ?? 'A5', intensity: band } },
                  `sec:${index}:motionIntensity`,
                );
              }}
            >
              {MOTION_INTENSITIES.map((band) => (
                <option key={band.value} value={String(band.value)}>
                  {band.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ed-field">
          <label className="ed-toggle">
            <input
              type="checkbox"
              checked={section.reveal === true}
              onChange={(event) =>
                set({ reveal: event.target.checked || undefined }, `sec:${index}:reveal`)
              }
            />
            <span>Reveal on scroll</span>
          </label>
          <p className="ed-help" style={{ marginTop: 6 }}>
            The section&apos;s content arrives into view as a visitor scrolls to it. It turns
            itself off on browsers that cannot do it and for anyone who prefers less motion, so
            it never gets in the way.
          </p>
        </div>
        {section.reveal === true && (
          <div className="ed-field">
            <label className="ed-label" htmlFor={`ed-reveal-style-${index}`}>
              Reveal style
            </label>
            <select
              id={`ed-reveal-style-${index}`}
              className="ed-select"
              value={normaliseRevealStyle(section.revealStyle)}
              onChange={(event) =>
                set(
                  { revealStyle: normaliseRevealStyle(event.target.value) },
                  `sec:${index}:revealStyle`,
                )
              }
            >
              {REVEAL_STYLES.map((style) => (
                <option key={style.value} value={style.value}>
                  {style.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {section.reveal === true && (
          <div className="ed-field">
            <label className="ed-toggle">
              <input
                type="checkbox"
                checked={section.revealStagger === true}
                onChange={(event) =>
                  set(
                    { revealStagger: event.target.checked || undefined },
                    `sec:${index}:revealStagger`,
                  )
                }
              />
              <span>Stagger the items</span>
            </label>
            <p className="ed-help" style={{ marginTop: 6 }}>
              The section&apos;s columns, or its cards, tiles or logos, arrive one after another
              rather than together. It rides on the reveal above, so it turns off with it and eases
              off for anyone who prefers less motion.
            </p>
          </div>
        )}
        <div className="ed-field">
          <label className="ed-toggle">
            <input
              type="checkbox"
              checked={section.hoverLift === true}
              onChange={(event) =>
                set({ hoverLift: event.target.checked || undefined }, `sec:${index}:hoverLift`)
              }
            />
            <span>Hover lift</span>
          </label>
          <p className="ed-help" style={{ marginTop: 6 }}>
            Cards and buttons in this section lift a touch as a visitor points at them. It
            eases off for anyone who prefers less motion, keeping a gentle shadow without the
            movement.
          </p>
        </div>
        <div className="ed-field">
          <label className="ed-toggle">
            <input
              type="checkbox"
              checked={section.hoverZoom === true}
              onChange={(event) =>
                set({ hoverZoom: event.target.checked || undefined }, `sec:${index}:hoverZoom`)
              }
            />
            <span>Image zoom</span>
          </label>
          <p className="ed-help" style={{ marginTop: 6 }}>
            Card pictures in this section zoom in gently as a visitor points at each card, the
            frame holding its edges. It eases off for anyone who prefers less motion.
          </p>
        </div>
        <div className="ed-field">
          <label className="ed-toggle">
            <input
              type="checkbox"
              checked={section.hoverTint === true}
              onChange={(event) =>
                set({ hoverTint: event.target.checked || undefined }, `sec:${index}:hoverTint`)
              }
            />
            <span>Hover tint</span>
          </label>
          <p className="ed-help" style={{ marginTop: 6 }}>
            Cards in this section wash in your brand colour as a visitor points at one. There is
            no movement in it, so it stays for everyone.
          </p>
        </div>
        <div className="ed-field">
          <label className="ed-toggle">
            <input
              type="checkbox"
              checked={section.gradient === true}
              onChange={(event) =>
                set({ gradient: event.target.checked || undefined }, `sec:${index}:gradient`)
              }
            />
            <span>Animated gradient background</span>
          </label>
          <p className="ed-help" style={{ marginTop: 6 }}>
            A slow, moving gradient behind the whole section, in your brand colours by
            default. It eases off for anyone who prefers less motion. Best with a dark
            tone so the words stay light.
          </p>
          {section.gradient === true && (
            <div style={{ marginTop: 8 }}>
              <ColourField
                label="Gradient colour one"
                value={section.gradientFrom}
                onChange={(colour) => set({ gradientFrom: colour }, `sec:${index}:gradientFrom`)}
              />
              <ColourField
                label="Gradient colour two"
                value={section.gradientTo}
                onChange={(colour) => set({ gradientTo: colour }, `sec:${index}:gradientTo`)}
              />
            </div>
          )}
        </div>
        <div className="ed-field">
          <label className="ed-toggle">
            <input
              type="checkbox"
              checked={section.parallax === true}
              onChange={(event) =>
                set(
                  event.target.checked ? { parallax: true, kenBurns: undefined } : { parallax: undefined },
                  `sec:${index}:parallax`,
                )
              }
            />
            <span>Parallax background</span>
          </label>
          <p className="ed-help" style={{ marginTop: 6 }}>
            This section&apos;s background picture drifts a little slower than the words as a
            visitor scrolls, for a sense of depth. It needs a still background picture, and it
            eases off for anyone who prefers less motion.
          </p>
        </div>
        {/*
          Ken Burns is the other background motion, and the two move the one picture,
          so turning either on clears the other. A slow, self-running drift and zoom
          rather than the scroll-linked parallax.
        */}
        <div className="ed-field">
          <label className="ed-toggle">
            <input
              type="checkbox"
              checked={section.kenBurns === true}
              onChange={(event) =>
                set(
                  event.target.checked ? { kenBurns: true, parallax: undefined } : { kenBurns: undefined },
                  `sec:${index}:kenBurns`,
                )
              }
            />
            <span>Slow zoom (Ken Burns)</span>
          </label>
          <p className="ed-help" style={{ marginTop: 6 }}>
            This section&apos;s background picture drifts and zooms slowly on its own, the way a
            still photo comes alive in a documentary. It needs a still background picture, works
            instead of parallax rather than with it, and eases off for anyone who prefers less
            motion.
          </p>
        </div>
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
          /*
            The Edit button and the focus point, on the background too. The
            editor writes its five numbers under generic keys (focusX,
            brightness and so on); a section keeps them under background-prefixed
            keys, because a section has plenty that is not its background, so the
            patch is remapped on the way in. No urlKey is passed, so the picker
            still sets the address through onChange above and this onPatch only
            ever carries an edit.
          */
          onPatch={(patch) =>
            set(
              {
                backgroundFocusX: patch.focusX as number,
                backgroundFocusY: patch.focusY as number,
                backgroundBrightness: patch.brightness as number,
                backgroundContrast: patch.contrast as number,
                backgroundSaturation: patch.saturation as number,
              },
              `sec:${index}:bg-edit`,
            )
          }
          edit={{
            focusX: section.backgroundFocusX ?? 50,
            focusY: section.backgroundFocusY ?? 50,
            brightness: section.backgroundBrightness ?? 100,
            contrast: section.backgroundContrast ?? 100,
            saturation: section.backgroundSaturation ?? 100,
          }}
        />
        <p className="ed-help">
          A scrim goes over it so text on top still passes contrast. How dark it
          is, below. Click Edit to set the focus point, the part kept when the
          section crops the picture on a narrow screen.
        </p>
      </div>

      {/*
        MORE THAN ONE PICTURE MAKES THE BACKGROUND A SLIDESHOW, added 4 Aug 2026.
        The hero cycling through several photographs, which is what Andy asked for
        first. Each row is the same chooser as the one above; the last, empty, is
        how another is added. No arrows or dots are offered because the section's
        own heading and buttons sit over the background. It plays on the canvas,
        so the preview cycles the same as the published page.
      */}
      <div className="ed-field">
        <label className="ed-label">More background images</label>
        {(section.backgroundSlides ?? []).map((slide, slideIndex) => (
          <ImageField
            key={`bgslide-${slideIndex}`}
            value={slide.src}
            onChange={(next) => {
              const slides = [...(section.backgroundSlides ?? [])];
              if (next) slides[slideIndex] = { ...slides[slideIndex], src: next };
              else slides.splice(slideIndex, 1);
              set({ backgroundSlides: slides }, `sec:${index}:bgslides`);
            }}
            /*
              Its own Edit button, focus point and adjustments, written back into
              this slide rather than the section, so every picture in the
              slideshow can be focused where it matters. No urlKey, so the picker
              still sets the address through onChange and this patch only ever
              carries an edit. No crop, the same as the single background.
            */
            onPatch={(patch) => {
              const slides = [...(section.backgroundSlides ?? [])];
              slides[slideIndex] = {
                ...slides[slideIndex],
                focusX: patch.focusX as number,
                focusY: patch.focusY as number,
                brightness: patch.brightness as number,
                contrast: patch.contrast as number,
                saturation: patch.saturation as number,
              };
              set({ backgroundSlides: slides }, `sec:${index}:bgslide-edit`);
            }}
            edit={{
              focusX: slide.focusX ?? 50,
              focusY: slide.focusY ?? 50,
              brightness: slide.brightness ?? 100,
              contrast: slide.contrast ?? 100,
              saturation: slide.saturation ?? 100,
            }}
          />
        ))}
        <ImageField
          key="bgslide-add"
          value=""
          onChange={(next) => {
            if (!next) return;
            set(
              { backgroundSlides: [...(section.backgroundSlides ?? []), { src: next }] },
              `sec:${index}:bgslides`,
            );
          }}
        />
        <p className="ed-help">
          Add another and the background cycles through them behind your heading
          and buttons. Each has its own Edit, so you can set the focus point and
          the look of every picture.
        </p>
      </div>

      {(section.backgroundImage ? 1 : 0) + (section.backgroundSlides?.length ?? 0) > 1 && (
        <>
          <Picker
            label="Transition"
            value={section.backgroundTransition ?? 'fade'}
            options={[
              { value: 'fade', label: 'Fade' },
              { value: 'slide', label: 'Slide' },
            ]}
            onChange={(value) =>
              set({ backgroundTransition: value as typeof section.backgroundTransition }, `sec:${index}:bgtrans`)
            }
          />
          <Measure
            label="Time on each"
            value={section.backgroundInterval ?? 5}
            min={2}
            max={15}
            step={1}
            unit="s"
            onChange={(value) => set({ backgroundInterval: value }, `sec:${index}:bgint`)}
          />
        </>
      )}

      <div className="ed-field">
        <label className="ed-label">Background video</label>
        <input
          className="ed-input"
          value={section.backgroundVideo ?? ''}
          placeholder="https://.../hero.mp4"
          onChange={(event) => set({ backgroundVideo: event.target.value }, `sec:${index}:video`)}
        />
        {/*
          The picture is not optional advice, it is what somebody sees when they
          have asked their system for less motion, and the editor should say so
          before they publish a blank band to those visitors.
        */}
        <p className="ed-help">
          A direct link to an .mp4 file. It plays silently and loops. Set a
          background image too: that is what shows for anyone who has asked for
          less movement, and it is the still while the film loads.
        </p>
      </div>

      <Measure
        label="Overlay"
        value={section.overlay}
        min={0}
        max={100}
        step={5}
        unit="%"
        onChange={(value) => set({ overlay: value }, `sec:${index}:overlay`)}
      />
      <p className="ed-help">
        0 leaves the picture alone. 60 is the setting that keeps white text
        readable over most photographs.
      </p>

      {/*
        The colour is only worth asking for once there is a scrim to colour, the
        same rule the border colour follows. Left as None it is the dark navy the
        scrim always was, so nobody has to set a colour to get the old look.
      */}
      {section.overlay > 0 && (
        <ColourField
          label="Overlay colour"
          value={section.overlayColour}
          onChange={(overlayColour) => set({ overlayColour }, `sec:${index}:overlaycol`)}
        />
      )}
      </Group>

      {/*
        THE SHAPED EDGES.
        Its own group, and shut by default, because most sections have straight
        edges and always will. A section with a background picture is told the
        edges do nothing rather than being offered a control that quietly has
        no effect: the shape is drawn in a flat colour and there is no honest
        way to extend a photograph into the section next door.
      */}
      <Group title="Shaped edges" defaultOpen={false}>
      <Picker
        label="Top edge"
        value={section.dividerTop ?? 'none'}
        options={DIVIDER_OPTIONS}
        onChange={(value) => set({ dividerTop: value }, `sec:${index}:dtop`)}
      />
      <Picker
        label="Bottom edge"
        value={section.dividerBottom ?? 'none'}
        options={DIVIDER_OPTIONS}
        onChange={(value) => set({ dividerBottom: value }, `sec:${index}:dbot`)}
      />
      <Measure
        label="How deep"
        value={section.dividerHeight ?? DEFAULT_DIVIDER_HEIGHT}
        min={MIN_DIVIDER_HEIGHT}
        max={MAX_DIVIDER_HEIGHT}
        onChange={(value) => set({ dividerHeight: value }, `sec:${index}:dh`)}
      />
      <p className="ed-help">
        The shape is the colour of the section next to it, reaching across the
        join. Set it on one side of a join or the other, not both, or you get
        two shapes stacked.
      </p>
      </Group>

      <Group title="Link to this section" defaultOpen={false}>
      <div className="ed-field">
        <label className="ed-label">Name</label>
        <input
          className="ed-input"
          value={section.anchor ?? ''}
          placeholder="prices"
          /*
            NORMALISED HERE AS WELL AS IN THE SCHEMA, because this value becomes
            an `id` on the canvas the moment it is typed. Left raw, "Our Prices"
            showed as id="Our Prices" in the preview and was stored as
            "our-prices", so the preview was showing something the save would
            quietly correct. The browser suite caught it.

            anchorInput while typing and safeAnchor on the way out: see the note
            on those two in schema.ts for why they are not the same function.
          */
          onChange={(event) =>
            set({ anchor: anchorInput(event.target.value) }, `sec:${index}:anchor`)
          }
          onBlur={(event) =>
            set({ anchor: safeAnchor(event.target.value) }, `sec:${index}:anchor:done`)
          }
        />
        <p className="ed-help">
          {section.anchor
            ? `A button pointing at #${section.anchor} jumps here.`
            : 'Give it a name and a button can jump straight to it, from this page or another.'}
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

      {/*
        TWO CONTROLS, ONE FIELD. Andy asked on 31 Jul 2026 for a way to stack a
        row's columns vertically. That is the same stored value as the
        breakpoint, not a second one: two fields both deciding whether a row is
        stacked can disagree, and then what you see depends on which was touched
        last. So "Always stacked" is stackBelow: 'always', and the breakpoint
        question is only asked when it still has an answer.
      */}
      <Segmented
        label="How the columns sit"
        value={node.stackBelow === 'always' ? 'always' : 'side'}
        options={[
          { value: 'side', label: 'Side by side' },
          { value: 'always', label: 'Stacked' },
        ]}
        onChange={(value) =>
          set(
            // Back to the default breakpoint when it goes side by side again,
            // rather than to whatever it was before, which nobody remembers.
            { stackBelow: value === 'always' ? 'always' : 'mobile' },
            `row:${section}:${row}:stack`,
          )
        }
      />

      {node.stackBelow !== 'always' && (
        <>
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
        </>
      )}

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

  const siblings = page.sections[section]?.rows[row]?.columns.length ?? 1;

  return (
    <>
      <div className="ed-field">
        <label className="ed-label">Width</label>
        <p className="ed-help" style={{ margin: 0 }}>
          {Math.round(node.width)}% of the row. Drag the edge in the preview, or
          use the sliders on the row.
        </p>
      </div>

      {/*
        Andy asked for this on 31 Jul 2026. The WIDTH TRAVELS WITH THE COLUMN:
        a 70/30 row whose wide column moves right becomes 30/70. Moving a hero's
        picture across and having it arrive a different width would not be a
        move, it would be a swap with something else.
      */}
      <div className="ed-field">
        <label className="ed-label">Order in the row</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="ed-btn"
            style={{ flex: 1 }}
            disabled={column === 0}
            onClick={() =>
              onCommit((current) => moveColumn(current, section, row, column, column - 1))
            }
          >
            <Icon name="arrow-left" size={16} /> Move left
          </button>
          <button
            type="button"
            className="ed-btn"
            style={{ flex: 1 }}
            disabled={column >= siblings - 1}
            onClick={() =>
              onCommit((current) => moveColumn(current, section, row, column, column + 1))
            }
          >
            Move right <Icon name="arrow-right" size={16} />
          </button>
        </div>
        <p className="ed-help">
          Column {column + 1} of {siblings}. Its width moves with it.
        </p>
      </div>

      {/*
        The same question as the row's, one level down: do the things inside sit
        one above the other, or beside each other. Asked for in the same breath.
      */}
      <Segmented
        label="How the content sits"
        value={node.flow}
        options={[
          { value: 'stacked', label: 'Stacked' },
          { value: 'row', label: 'Side by side' },
        ]}
        onChange={(value) =>
          onCommit(
            (current) =>
              updateColumn(current, section, row, column, { flow: value as typeof node.flow }),
            `col:${section}:${row}:${column}:flow`,
          )
        }
      />
      {node.flow === 'row' && (
        <p className="ed-help" style={{ marginTop: -8, marginBottom: 14 }}>
          Wraps to a second line when there is not enough width, and goes back to
          stacked on a phone.
        </p>
      )}

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

/**
 * A column inside a container.
 *
 * The same three controls a section column has that make sense one level down:
 * how the blocks inside it sit, how they align, and the design box. What it does
 * NOT have yet is width and order, because dragging the inner columns wider or
 * swapping them arrives with the inner resize in a later slice; until then the
 * two share the width evenly. Commits through updateInnerColumn, which writes
 * back into the container's props.columns.
 */
function InnerColumnFields({
  path,
  page,
  onCommit,
}: {
  path: Extract<Path, { kind: 'inner-column' }>;
  page: Page;
  onCommit: Props['onCommit'];
}) {
  const container = page.sections[path.section]?.rows[path.row]?.columns[path.column]?.blocks[path.block];
  const node = container ? containerColumns(container)[path.inner] : undefined;
  if (!node) return null;

  const base = `ic:${path.section}:${path.row}:${path.column}:${path.block}:${path.inner}`;
  const set = (patch: Parameters<typeof updateInnerColumn>[6], key: string) =>
    onCommit(
      (current) =>
        updateInnerColumn(current, path.section, path.row, path.column, path.block, path.inner, patch),
      key,
    );

  return (
    <>
      <p className="ed-help" style={{ marginTop: 0, marginBottom: 14 }}>
        A column inside a container. Drop a block into it, and style it here.
      </p>

      <Segmented
        label="How the content sits"
        value={node.flow}
        options={[
          { value: 'stacked', label: 'Stacked' },
          { value: 'row', label: 'Side by side' },
        ]}
        onChange={(value) => set({ flow: value as typeof node.flow }, `${base}:flow`)}
      />

      <Segmented
        label="Vertical alignment"
        value={node.align}
        options={[
          { value: 'top', label: 'Top' },
          { value: 'centre', label: 'Middle' },
          { value: 'bottom', label: 'Bottom' },
        ]}
        onChange={(value) => set({ align: value as typeof node.align }, `${base}:align`)}
      />

      <BoxPanel what="column" box={node.box} onChange={(box) => set({ box }, `${base}:box`)} />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The one control that turns a frozen import into native blocks.
 *
 * It calls the rebuild on the server, because the recogniser is parser backed
 * and has no business in this bundle, and swaps the whole section in one commit,
 * so the import it replaced is a single undo away. The client's current edits go
 * with it: the action reads them from the block's own props. On a design with
 * nothing to rebuild it says so and changes nothing, which is the honest answer
 * rather than an empty section.
 */
function RebuildImportButton({
  block,
  section,
  onCommit,
  onSelect,
}: {
  block: Block;
  section: number;
  onCommit: Props['onCommit'];
  onSelect?: Props['onSelect'];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rebuild = () => {
    setError(null);
    start(async () => {
      const result = await rebuildImportAction(block.props);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCommit((current) => ({
        ...current,
        sections: current.sections.map((entry, index) => (index === section ? result.section : entry)),
      }));
      // The old block path is gone; show the rebuilt section so the pane is not
      // left pointing at nothing. Absent on the on-canvas popover, which manages
      // its own selection.
      onSelect?.({ kind: 'section', section });
    });
  };

  return (
    <div className="ed-rebuild">
      <button type="button" className="ed-btn" data-variant="primary" disabled={pending} onClick={rebuild}>
        {pending ? 'Rebuilding' : 'Make editable'}
      </button>
      <p className="ed-help" style={{ marginTop: 8, marginBottom: 0 }}>
        Rebuilds this design as ordinary blocks, editable with every tool. It
        takes on your site&apos;s own look rather than the captured one, and one
        undo puts it back.
      </p>
      {error && <p className="ed-import__error">{error}</p>}
    </div>
  );
}

type BoxParts = { bg?: boolean; border?: boolean; radius?: boolean; padding?: boolean; shadow?: boolean };

/*
 * THE DESIGN BOX, ELEMENT BY ELEMENT. Which parts of the box each element offers,
 * curated so nothing is offered twice: an element that already has its own frame
 * border or corners (image, cards, video, gallery, slider) keeps them and takes
 * only the box parts it lacks. An element that styles itself rather than a box
 * around it, or is pure spacing, takes none (button, button-group, divider,
 * spacer, imported); it still gets grouped sections for its own settings.
 * Everything text-like or container-like takes the full box. Andy approved the
 * pattern on text/image/cards/button, then it went to the rest (5 Aug 2026).
 */
const FULL_BOX: BoxParts = { bg: true, border: true, radius: true, padding: true, shadow: true };
const BLOCK_DESIGN: Record<string, BoxParts> = {
  // Text and container elements: the whole box.
  text: FULL_BOX,
  heading: FULL_BOX,
  quote: FULL_BOX,
  list: FULL_BOX,
  'icon-item': FULL_BOX,
  accordion: FULL_BOX,
  tabs: FULL_BOX,
  steps: FULL_BOX,
  stats: FULL_BOX,
  table: FULL_BOX,
  nav: FULL_BOX,
  social: FULL_BOX,
  logos: FULL_BOX,
  widget: FULL_BOX,
  'embed-widget': FULL_BOX,
  embed: FULL_BOX,
  // A container is styled like a column: the whole box around its inner columns.
  container: FULL_BOX,
  // Media that already rounds its own frame: everything but the radius.
  image: { bg: true, padding: true, shadow: true },
  video: { bg: true, padding: true, shadow: true },
  map: { bg: true, padding: true, shadow: true },
  'before-after': { bg: true, padding: true, shadow: true },
  audio: { bg: true, padding: true, shadow: true },
  gallery: { bg: true, border: true, padding: true, shadow: true },
  slider: { bg: true, border: true, padding: true, shadow: true },
  cards: { bg: true, border: true, padding: true, shadow: true },
  // No block-level bg: the card colour is a field of its own, so a second
  // "Background colour" here would be the band behind the rail and just confuse
  // which one paints the cards. Border, padding and shadow frame the whole rail.
  testimonials: { border: true, padding: true, shadow: true },
  // Styles itself, or is pure spacing: no box, just grouped settings.
  button: {},
  'button-group': {},
  divider: {},
  spacer: {},
  imported: {},
};

/**
 * Which section a field belongs to. An explicit group on the field wins; failing
 * that it is read off the field's key, so a colour goes to Colours and an
 * alignment to Layout without every block having to say so. Border is checked
 * before colour, or a borderColour would land in Colours rather than with the
 * border it belongs to.
 */
function inferGroup(field: Field): FieldGroup {
  if (field.group) return field.group;
  const key = field.key;
  if (key === 'align' || key === 'gap' || key === 'spacing' || key === 'height' || key === 'columns') {
    return 'layout';
  }
  if (key === 'radius' || key === 'corners' || key.startsWith('border')) return 'border';
  if (key === 'shadow' || key === 'gradient') return 'effects';
  if (key === 'padding') return 'spacing';
  if (/colou?r/i.test(key)) return 'colours';
  return 'content';
}

/** The sections, in the order they appear. Content is first, so it is the open one. */
const GROUP_ORDER: FieldGroup[] = ['content', 'colours', 'border', 'spacing', 'layout', 'effects'];
const GROUP_LABELS: Record<FieldGroup, string> = {
  content: 'Content',
  colours: 'Colours',
  border: 'Border',
  spacing: 'Spacing',
  layout: 'Layout',
  effects: 'Effects',
};

const SHADOW_CHOICES = [
  { value: 'none', label: 'None' },
  { value: 'soft', label: 'Soft' },
  { value: 'medium', label: 'Medium' },
  { value: 'strong', label: 'Strong' },
];

/**
 * A container's inner columns: the width sliders and the add, remove and even
 * buttons, the same set a row has one level up. Modelled on RowFields, committing
 * through the inner-column helpers. The width also drags on the canvas; this is
 * the keyboard-and-precise way, and where a column is added or removed.
 */
function ContainerColumnsControl({
  block,
  path,
  onCommit,
}: {
  block: Block;
  path: Extract<Path, { kind: 'block' }>;
  onCommit: Props['onCommit'];
}) {
  const columns = containerColumns(block);
  if (!columns.length) return null;
  const { section: s, row: r, column: c, block: b } = path;

  return (
    <div className="ed-field">
      <label className="ed-label">Inner columns</label>
      <div className="ed-widths">
        {columns.map((col, index) => (
          <div className="ed-width-row" key={col.id}>
            <span>Column {index + 1}</span>
            <input
              type="range"
              min={MIN_COLUMN_WIDTH}
              max={100 - MIN_COLUMN_WIDTH * (columns.length - 1)}
              step={1}
              value={Math.round(col.width)}
              disabled={columns.length === 1}
              aria-label={`Inner column ${index + 1} width`}
              onChange={(event) => {
                const delta = Number(event.target.value) - col.width;
                // The slider drives the boundary to its right, or the one to its
                // left for the last column, so the widths still sum to 100.
                const boundary = index === columns.length - 1 ? index - 1 : index;
                const signed = index === columns.length - 1 ? -delta : delta;
                onCommit((current) => resizeInnerColumnBoundary(current, s, r, c, b, boundary, signed), `ic:${b}:width`);
              }}
            />
            <output>{Math.round(col.width)}%</output>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          type="button"
          className="ed-btn"
          style={{ flex: 1 }}
          disabled={columns.length >= 6}
          onClick={() => onCommit((current) => addInnerColumn(current, s, r, c, b))}
        >
          + Column
        </button>
        <button
          type="button"
          className="ed-btn"
          style={{ flex: 1 }}
          disabled={columns.length <= 1}
          onClick={() => onCommit((current) => removeInnerColumn(current, s, r, c, b, columns.length - 1))}
        >
          − Column
        </button>
        <button
          type="button"
          className="ed-btn"
          style={{ flex: 1 }}
          disabled={columns.length <= 1}
          onClick={() => onCommit((current) => evenInnerColumns(current, s, r, c, b))}
        >
          Even
        </button>
      </div>
      <p className="ed-help">
        Removing a column moves its blocks into the one beside it. You can also
        drag the edges in the preview.
      </p>
    </div>
  );
}

/**
 * A grid's cells: how many there are, and how wide each one is in tracks.
 *
 * NOT ContainerColumnsControl WITH A FLAG, for the same reason InnerGrid is not
 * InnerColumns with one. Every control in that one is about width as a
 * percentage: three sliders that must sum to 100, and an Even button to put them
 * back. A grid has no such thing. Its tracks come from the across count in the
 * Layout panel above, the cells drop into them in order, and the only width
 * question left is whether one cell should take more than one track.
 *
 * The span picker only appears when there is more than one track to span, since
 * "spans 1 of 1" is a control with one option.
 */
function GridCellsControl({
  block,
  path,
  onCommit,
}: {
  block: Block;
  path: Extract<Path, { kind: 'block' }>;
  onCommit: Props['onCommit'];
}) {
  const cells = containerColumns(block);
  if (!cells.length) return null;
  const { section: s, row: r, column: c, block: b } = path;

  // The desktop count, read the same way the renderer reads it, so the span
  // options offered are exactly the tracks that exist.
  const across = Math.min(6, Math.max(1, Math.round(Number(block.props.across) || 3)));

  return (
    <div className="ed-field">
      <label className="ed-label">Cells</label>

      {across > 1 && (
        <div className="ed-widths">
          {cells.map((cell, index) => (
            <div className="ed-width-row" key={cell.id}>
              <span>Cell {index + 1}</span>
              <select
                className="ed-select"
                aria-label={`Cell ${index + 1} width`}
                value={String(Math.min(across, cell.span ?? 1))}
                onChange={(event) =>
                  onCommit(
                    (current) => setInnerColumnSpan(current, s, r, c, b, index, Number(event.target.value)),
                    `gc:${b}:${index}:span`,
                  )
                }
              >
                {Array.from({ length: across }, (_, i) => i + 1).map((span) => (
                  <option key={span} value={span}>
                    {span === 1 ? '1 column' : `${span} columns`}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          type="button"
          className="ed-btn"
          style={{ flex: 1 }}
          disabled={cells.length >= MAX_GRID_CELLS}
          onClick={() => onCommit((current) => addInnerColumn(current, s, r, c, b, MAX_GRID_CELLS))}
        >
          + Cell
        </button>
        <button
          type="button"
          className="ed-btn"
          style={{ flex: 1 }}
          disabled={cells.length <= 1}
          onClick={() => onCommit((current) => removeInnerColumn(current, s, r, c, b, cells.length - 1))}
        >
          − Cell
        </button>
      </div>
      <p className="ed-help">
        Cells fill the grid in order and wrap onto a new line when they run out of
        room. Removing one moves its blocks into the cell beside it.
      </p>
    </div>
  );
}

/**
 * The Text size dropdown, per screen. Offers the site's own sizes and the fixed
 * scale, the very list the toolbar offers a phrase, plus one empty option: on
 * desktop it means "no size of my own, use the block's style", and on a smaller
 * screen "the same size as the screen above". The caller sets the base on desktop
 * and the override otherwise, so this is only the picker.
 */
function TextSizeField({
  tier,
  value,
  onChange,
}: {
  tier: Tier;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const id = `ed-text-size-${tier}`;
  const autoLabel =
    tier === 'desktop' ? 'Auto (the block style)' : `Same as ${TIER_LABEL[INHERITS_FROM[tier]]}`;
  return (
    <div className="ed-field">
      <label className="ed-label" htmlFor={id}>
        Text size
      </label>
      <select
        id={id}
        className="ed-select"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">{autoLabel}</option>
        {FONT_SIZE_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {FONT_SIZES.filter((size) => size.group === group).map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function LineSpacingField({
  tier,
  value,
  onChange,
}: {
  tier: Tier;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const id = `ed-line-spacing-${tier}`;
  const autoLabel =
    tier === 'desktop' ? 'Auto (the block style)' : `Same as ${TIER_LABEL[INHERITS_FROM[tier]]}`;
  return (
    <div className="ed-field">
      <label className="ed-label" htmlFor={id}>
        Line spacing
      </label>
      <select
        id={id}
        className="ed-select"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">{autoLabel}</option>
        {LINE_HEIGHTS.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function LetterSpacingField({
  tier,
  value,
  onChange,
}: {
  tier: Tier;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const id = `ed-letter-spacing-${tier}`;
  const autoLabel =
    tier === 'desktop' ? 'Auto (the block style)' : `Same as ${TIER_LABEL[INHERITS_FROM[tier]]}`;
  return (
    <div className="ed-field">
      <label className="ed-label" htmlFor={id}>
        Letter spacing
      </label>
      <select
        id={id}
        className="ed-select"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">{autoLabel}</option>
        {LETTER_SPACINGS.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FluidField({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="ed-field">
      <label className="ed-toggle">
        <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
        <span>Auto-resize with the screen</span>
      </label>
      <p className="ed-help" style={{ marginTop: 6 }}>
        Scales this text down on smaller screens, between its set size and about two thirds of
        it, so a headline stays in proportion without a size for each screen.
      </p>
    </div>
  );
}

/**
 * Hide this block on the screen the device switcher is on. One toggle, worded for
 * the current screen, so it always speaks about the screen being edited. The block
 * stays on the canvas here; it disappears on the live site and in preview.
 */
function HideOnField({
  tier,
  hidden,
  onChange,
  noun = 'block',
}: {
  tier: Tier;
  hidden: boolean;
  onChange: (hidden: boolean) => void;
  /** What is being hidden, for the help line: a block by default, or a section. */
  noun?: string;
}) {
  const screen = tier === 'desktop' ? 'desktop' : tier === 'tablet' ? 'tablet' : 'phone';
  const where = tier === 'desktop' ? 'on desktop' : `on ${screen}s`;
  return (
    <div className="ed-field">
      <label className="ed-toggle">
        <input type="checkbox" checked={hidden} onChange={(event) => onChange(event.target.checked)} />
        <span>Hide {where}</span>
      </label>
      <p className="ed-help" style={{ marginTop: 6 }}>
        Takes this {noun} off the {screen} layout on the live site. It stays on the other screens, and
        stays here on the canvas so you can bring it back.
      </p>
    </div>
  );
}

function BlockFields({
  path,
  page,
  isStaff,
  canStructure = true,
  onCommit,
  onSelect,
  tier = 'desktop',
}: {
  /*
   * A block in an ordinary column, OR a block inside a container's inner column.
   * The two share this whole pane: the reads and the commits go through the
   * path-dispatch helpers, so a card in a container styles exactly as one in a
   * section column, and the design-suite grouping below is written once.
   */
  path: Extract<Path, { kind: 'block' | 'inner-block' }>;
  page: Page;
  isStaff: boolean;
  /**
   * Whether the design groups are shown. Off for a content-only client, who
   * keeps the Content group, the words, the picture and the link, and loses the
   * colour, border, spacing, layout and effect panels. Defaults to on.
   */
  canStructure?: boolean;
  onCommit: Props['onCommit'];
  onSelect?: Props['onSelect'];
  /** The screen the device switcher is on, so Text size edits that size. */
  tier?: Tier;
}) {
  const block = blockAtPath(page, path);
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

  const renderField = (field: Field) => (
    <FieldRenderer
      key={field.key}
      field={field}
      value={block.props[field.key]}
      ownerId={block.id}
      /*
       * The whole prop bag, for the one field kind that needs a sibling. An
       * imported design's editable slots are decided by the design that was
       * pasted, so the 'imported' field reads props.fields. Others ignore it.
       */
      siblings={block.props}
      onChange={(value) =>
        onCommit(
          (current) => updateBlockPropsAtPath(current, path, { [field.key]: value }),
          `blk:${block.id}:${field.key}`,
        )
      }
      onPatch={(patch) =>
        onCommit((current) => updateBlockPropsAtPath(current, path, patch), `blk:${block.id}:${field.key}`)
      }
    />
  );

  const help = (
    <p className="ed-help" style={{ marginTop: 0, marginBottom: 14 }}>
      <strong>{definition.label}</strong> · {definition.description}
    </p>
  );

  const design = BLOCK_DESIGN[block.type];

  // Every element is grouped into sections now, Content first and open. A field's
  // section is read off its key unless it names one, and the box parts this
  // element takes drop into the same sections as its own fields.
  const groups = new Map<FieldGroup, ReactNode[]>();
  const add = (group: FieldGroup, node: ReactNode) => {
    const list = groups.get(group) ?? [];
    list.push(node);
    groups.set(group, list);
  };

  /*
   * NARROWING A COLLECTION GRID. Only for a Cards block actually drawing from a
   * collection: a grid somebody typed into has nothing to narrow, and showing
   * the controls there would be a promise the block cannot keep. Its options are
   * whatever the named collection declares, which is why this is not a registry
   * field like everything else on this pane. See ListingFilterFields.
   */
  if (block.type === 'cards' && block.props.source === 'collection') {
    add(
      'content',
      <ListingFilterFields
        key="listing-filter"
        collectionKey={typeof block.props.collection === 'string' ? block.props.collection : ''}
        props={block.props}
        onChange={(patch) =>
          onCommit((c) => updateBlockPropsAtPath(c, path, patch), `blk:${block.id}:listing-filter`)
        }
      />,
    );
  }

  definition.fields.forEach((field) => {
    // Text and heading get ONE tier-aware Alignment control below (the block's own
    // field on desktop, an override per screen), so drop the registry's base-only
    // align field for them rather than showing two alignment controls that could
    // disagree. Every other block keeps its field, unchanged.
    if (field.key === 'align' && (block.type === 'text' || block.type === 'heading')) return;
    add(inferGroup(field), renderField(field));
  });

  // TEXT SIZE, PER SCREEN. Only the blocks whose text the size chain governs, the
  // Text and Heading blocks (.tgs-text / .tgs-heading), offer it. On desktop it
  // sets the block's own base size; on tablet or phone it sets that screen's
  // override, so a headline can be dialled down on a phone without touching
  // desktop. The value shown is what the CURRENT screen will actually take,
  // resolved through the desktop-first fallback, and a scope note underneath says
  // which screen and offers a reset to inherit.
  if (block.type === 'text' || block.type === 'heading') {
    const base = normaliseTextSize(block.props.fontSize);
    const current = resolveAt<string | undefined>(base, block.responsive, 'fontSize', tier);
    const setSize = (value: string | undefined) => {
      if (tier === 'desktop') {
        onCommit((c) => updateBlockPropsAtPath(c, path, { fontSize: value }), `blk:${block.id}:fontSize`);
      } else {
        const next = value
          ? withOverride(block.responsive, 'fontSize', tier, value)
          : clearOverride(block.responsive, 'fontSize', tier);
        onCommit((c) => updateBlockResponsiveAtPath(c, path, next), `blk:${block.id}:fontSize:${tier}`);
      }
    };
    add(
      // With the block's own size control (style / size), which infers to Content,
      // the open group. Its own group would be shut by default and unfindable.
      'content',
      <ScreenScope
        key="text-size"
        tier={tier}
        overridden={isOverridden(block.responsive, 'fontSize', tier)}
        onReset={() => {
          if (tier === 'desktop') return;
          onCommit(
            (c) => updateBlockResponsiveAtPath(c, path, clearOverride(block.responsive, 'fontSize', tier)),
            `blk:${block.id}:fontSize:${tier}:reset`,
          );
        }}
      >
        <TextSizeField tier={tier} value={current} onChange={setSize} />
      </ScreenScope>,
    );

    // LINE SPACING, PER SCREEN. Sits beside the size and works the same way: on
    // desktop it sets the block's own base line spacing, on tablet or phone that
    // screen's override. Unitless, so tightening it pulls a heading whose words
    // are wrapped in a stack of oversized size spans back to the height of the
    // text you see, which is the trapped-space bug it exists to fix.
    const baseLh = normaliseLineHeight(block.props.lineHeight);
    const currentLh = resolveAt<string | undefined>(baseLh, block.responsive, 'lineHeight', tier);
    const setLineHeight = (value: string | undefined) => {
      if (tier === 'desktop') {
        onCommit((c) => updateBlockPropsAtPath(c, path, { lineHeight: value }), `blk:${block.id}:lineHeight`);
      } else {
        const next = value
          ? withOverride(block.responsive, 'lineHeight', tier, value)
          : clearOverride(block.responsive, 'lineHeight', tier);
        onCommit((c) => updateBlockResponsiveAtPath(c, path, next), `blk:${block.id}:lineHeight:${tier}`);
      }
    };
    add(
      'content',
      <ScreenScope
        key="line-spacing"
        tier={tier}
        overridden={isOverridden(block.responsive, 'lineHeight', tier)}
        onReset={() => {
          if (tier === 'desktop') return;
          onCommit(
            (c) => updateBlockResponsiveAtPath(c, path, clearOverride(block.responsive, 'lineHeight', tier)),
            `blk:${block.id}:lineHeight:${tier}:reset`,
          );
        }}
      >
        <LineSpacingField tier={tier} value={currentLh} onChange={setLineHeight} />
      </ScreenScope>,
    );

    // LETTER SPACING, PER SCREEN. The third of the same engine, beside the size
    // and the line spacing. On desktop it sets the block's own base tracking, on
    // tablet or phone that screen's override. In em, so it follows whatever size
    // the text lands at rather than holding a gap measured for the bigger one,
    // which is what makes it safe to sit next to a per-screen size at all.
    const baseLs = normaliseLetterSpacing(block.props.letterSpacing);
    const currentLs = resolveAt<string | undefined>(baseLs, block.responsive, 'letterSpacing', tier);
    const setLetterSpacing = (value: string | undefined) => {
      if (tier === 'desktop') {
        onCommit((c) => updateBlockPropsAtPath(c, path, { letterSpacing: value }), `blk:${block.id}:letterSpacing`);
      } else {
        const next = value
          ? withOverride(block.responsive, 'letterSpacing', tier, value)
          : clearOverride(block.responsive, 'letterSpacing', tier);
        onCommit((c) => updateBlockResponsiveAtPath(c, path, next), `blk:${block.id}:letterSpacing:${tier}`);
      }
    };
    add(
      'content',
      <ScreenScope
        key="letter-spacing"
        tier={tier}
        overridden={isOverridden(block.responsive, 'letterSpacing', tier)}
        onReset={() => {
          if (tier === 'desktop') return;
          onCommit(
            (c) => updateBlockResponsiveAtPath(c, path, clearOverride(block.responsive, 'letterSpacing', tier)),
            `blk:${block.id}:letterSpacing:${tier}:reset`,
          );
        }}
      >
        <LetterSpacingField tier={tier} value={currentLs} onChange={setLetterSpacing} />
      </ScreenScope>,
    );

    // ALIGNMENT, PER SCREEN. The block's own field on desktop, an override on
    // tablet or phone, so a paragraph can centre on a phone while it stays left on
    // desktop. This is the ONE alignment control for these blocks: the registry's
    // base-only one is dropped above, so the two never disagree. Left, centre and
    // right drive the block's text-align, a paragraph's margin and a button row's
    // justify together, the same three the base does. It sits in Layout, where the
    // base field sat, not with the size controls in Content.
    const alignBase = typeof block.props.align === 'string' ? block.props.align : 'left';
    const alignNow = resolveAt<string>(alignBase, block.responsive, 'align', tier);
    const setAlign = (value: string) => {
      if (tier === 'desktop') {
        onCommit((c) => updateBlockPropsAtPath(c, path, { align: value }), `blk:${block.id}:align`);
      } else {
        onCommit(
          (c) => updateBlockResponsiveAtPath(c, path, withOverride(block.responsive, 'align', tier, value)),
          `blk:${block.id}:align:${tier}`,
        );
      }
    };
    add(
      'layout',
      <ScreenScope
        key="align"
        tier={tier}
        overridden={isOverridden(block.responsive, 'align', tier)}
        onReset={() => {
          if (tier === 'desktop') return;
          onCommit(
            (c) => updateBlockResponsiveAtPath(c, path, clearOverride(block.responsive, 'align', tier)),
            `blk:${block.id}:align:${tier}:reset`,
          );
        }}
      >
        <Segmented label="Alignment" value={alignNow} options={ALIGN_CHOICES} onChange={setAlign} />
      </ScreenScope>,
    );

    // AUTO-RESIZE. Not per-screen: it IS the responsive behaviour, one toggle that
    // makes the text scale with the screen rather than holding a fixed size. Stored
    // as a plain flag; undefined when off so it does not linger on the block.
    add(
      'content',
      <FluidField
        key="fluid"
        value={block.props.fluid === true}
        onChange={(value) =>
          onCommit(
            (c) => updateBlockPropsAtPath(c, path, { fluid: value || undefined }),
            `blk:${block.id}:fluid`,
          )
        }
      />,
    );

    // CLEAR TEXT SIZING. Only when there is something to clear, so a clean heading
    // never shows it. Strips the fixed sizes off the words (a heading built from
    // the old size buttons can be eleven spans deep), which is what lets the size
    // and auto-resize controls above take effect on the whole block again.
    if (hasInlineTextSizing(block.props.html)) {
      add(
        'content',
        <div className="ed-field" key="clear-sizing">
          <button
            type="button"
            className="ed-btn"
            onClick={() =>
              onCommit(
                (c) =>
                  updateBlockPropsAtPath(c, path, {
                    html: clearTextSizing(typeof block.props.html === 'string' ? block.props.html : ''),
                  }),
                `blk:${block.id}:clearsize`,
              )
            }
          >
            Clear text sizing
          </button>
          <p className="ed-help" style={{ marginTop: 6 }}>
            Removes fixed sizes set on individual words, so the size and auto-resize
            controls take effect on the whole block.
          </p>
        </div>,
      );
    }
  }

  // The box is a sibling of props, so it commits through updateBlockBox. Only an
  // element that takes box parts adds any of these; the rest are grouped fields
  // alone. Computed unconditionally, since patchBox is referenced either way.
  const box = block.box ?? EMPTY_BOX;
  const patchBox = (part: Partial<Box>) =>
    onCommit(
      (current) => updateBlockBoxAtPath(current, path, { ...box, ...part }),
      `blk:${block.id}:box`,
    );

  if (design?.bg) {
    add(
      'colours',
      <ColourField
        key="box-bg"
        label="Background colour"
        value={box.background}
        onChange={(background) => patchBox({ background })}
      />,
    );
  }
  if (design?.border) {
    add(
      'border',
      <Measure
        key="box-bw"
        label="Border width"
        value={box.borderWidth}
        max={MAX_BORDER}
        onChange={(borderWidth) => patchBox({ borderWidth })}
      />,
    );
    add(
      'border',
      <ColourField
        key="box-bc"
        label="Border colour"
        value={box.borderColour}
        onChange={(borderColour) => patchBox({ borderColour })}
      />,
    );
  }
  if (design?.radius) {
    add(
      'border',
      <Measure
        key="box-r"
        label="Corner radius"
        value={box.radius}
        max={MAX_RADIUS}
        onChange={(radius) => patchBox({ radius })}
      />,
    );
  }
  if (design?.padding) {
    add('spacing', <PaddingBox key="box-p" padding={box.padding} onChange={(padding) => patchBox({ padding })} />);
  }
  if (design?.shadow) {
    add(
      'effects',
      <Picker
        key="box-s"
        label="Shadow"
        value={box.shadow}
        options={SHADOW_CHOICES}
        onChange={(shadow) => patchBox({ shadow: shadow as Box['shadow'] })}
      />,
    );
  }

  // SHOW / HIDE PER SCREEN. One toggle, for every block, that hides it on the
  // screen the device switcher is on. Not a style override but a list of the
  // screens the block is hidden on, all three treated alike, so a block hides on
  // desktop as easily as on a phone. It stays on the canvas while editing (the
  // attribute is published-only) so it can always be selected again; the help says
  // where it goes.
  const hideOn = block.hideOn ?? [];
  const setHidden = (hidden: boolean) => {
    const screens = new Set(hideOn);
    if (hidden) screens.add(tier);
    else screens.delete(tier);
    const next = [...screens];
    onCommit(
      (c) => updateBlockHideOnAtPath(c, path, next.length ? next : undefined),
      `blk:${block.id}:hideOn:${tier}`,
    );
  };
  add('layout', <HideOnField key="hide-on" tier={tier} hidden={hideOn.includes(tier)} onChange={setHidden} />);

  // A content-only member keeps the Content group, the words, the picture and
  // the link, and loses the design panels they cannot save anyway.
  const ordered = GROUP_ORDER.filter((group) => groups.get(group)?.length).filter(
    (group) => canStructure || group === 'content',
  );

  return (
    <>
      {help}
      {/* Rebuilding an import swaps the whole SECTION it sits in, which only
          makes sense for a top-level block, never one nested in a container.
          Structural, so a content-only member does not get the button. */}
      {canStructure && block.type === 'imported' && path.kind === 'block' && (
        <RebuildImportButton block={block} section={path.section} onCommit={onCommit} onSelect={onSelect} />
      )}
      {/* The columns inside a container, or the cells inside a grid. Two
          controls rather than one with a flag, because the two layouts have
          nothing in common to control: a container's columns have widths you
          drag, a grid's cells have no width at all, only how many tracks each
          one spans. Both are structural, so both are hidden from a content-only
          member, and both are only ever top-level blocks so the path is a
          'block' one here. */}
      {canStructure && path.kind === 'block' && block.type === 'grid' && (
        <GridCellsControl block={block} path={path} onCommit={onCommit} />
      )}
      {canStructure && path.kind === 'block' && block.type !== 'grid' && hasInnerColumns(block.type) && (
        <ContainerColumnsControl block={block} path={path} onCommit={onCommit} />
      )}
      {ordered.map((group, index) => (
        <Group key={group} title={GROUP_LABELS[group]} defaultOpen={index === 0}>
          {groups.get(group)}
        </Group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * A dropdown, for a choice with more options than a segmented track can hold.
 *
 * FOUR IS THE LINE, and it is the same line components/editor/Fields.tsx draws
 * for a block's own select fields: four or fewer reads better as buttons, more
 * than four in one track gives each one about fifty pixels and "Straight" does
 * not fit in fifty pixels. The shaped edges have six each, which is what made
 * this necessary.
 */
function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ed-field">
      <label className="ed-label">{label}</label>
      <select
        className="ed-select"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

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
