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
import type { Page, RegionName } from '../../lib/content/schema';
import {
  DEFAULT_DIVIDER_HEIGHT,
  DIVIDER_OPTIONS,
  MAX_DIVIDER_HEIGHT,
  MIN_DIVIDER_HEIGHT,
} from '../../lib/content/dividers';
import { safeSlug } from '../../lib/content/collection';
import type { ItemMeta } from '../../lib/content/collection-page';
import {
  anchorInput,
  safeAnchor,
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
  moveColumn,
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
import { writeSeoAction } from '../../app/actions/ai';
import { pageText } from '../../lib/seo/audit';

interface Props {
  page: Page;
  selected: Path | null;
  isStaff: boolean;
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
   * True while the on-canvas options popover is open for this same item.
   *
   * The popover and this pane draw the SAME fields, and two live copies of every
   * control on the screen at once read as broken the moment one was touched. So
   * while the popover is up the pane steps aside and shows a short note instead:
   * one editing surface at a time. See EditorShell's optionsOpen.
   */
  editingOnCanvas?: boolean;
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
    default:
      return 'Item';
  }
}

export function Properties({
  page,
  selected,
  isStaff,
  onSelect,
  onCommit,
  onBack,
  region = null,
  regionFlags,
  onRegionFlags,
  isItem = false,
  itemMeta,
  onItemMeta,
  editingOnCanvas = false,
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
            onCommit={onCommit}
            region={region}
            regionFlags={regionFlags}
            onRegionFlags={onRegionFlags}
            isItem={isItem}
            itemMeta={itemMeta}
            onItemMeta={onItemMeta}
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
  onCommit,
  region = null,
  regionFlags,
  onRegionFlags,
  isItem = false,
  itemMeta,
  onItemMeta,
}: {
  page: Page;
  selected: Path | null;
  isStaff: boolean;
  onCommit: Props['onCommit'];
  region?: RegionName | null;
  regionFlags?: Props['regionFlags'];
  onRegionFlags?: Props['onRegionFlags'];
  isItem?: boolean;
  itemMeta?: Props['itemMeta'];
  onItemMeta?: Props['onItemMeta'];
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
            meta={itemMeta ?? { title: '', summary: '', image: '', alt: '', date: '', slug: '' }}
            onChange={onItemMeta}
          />
        ) : (
          <PageFields page={page} onCommit={onCommit} />
        ))}

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
}: {
  meta: ItemMeta;
  onChange?: (next: ItemMeta) => void;
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
    </>
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
          A scrim goes over it so text on top still passes contrast. How dark it
          is, below.
        </p>
      </div>

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
          /*
           * The whole prop bag, for the one field kind that needs a sibling.
           * An imported design's editable slots are decided by the design that
           * was pasted, so the 'imported' field has to read props.fields to know
           * what to draw. Every other kind ignores this.
           */
          siblings={block.props}
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
