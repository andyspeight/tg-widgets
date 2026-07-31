/**
 * Turns a page tree into HTML.
 *
 * The same components render the published page and the editor preview. The
 * only difference is `editable`, which adds `data-path` hooks, empty-state
 * placeholders and column resize handles.
 *
 * There are NO event handlers in here. The editor attaches one delegated
 * listener to the canvas and reads `data-path` off the closest ancestor.
 * That keeps this whole file usable as a server component on the published
 * side, which is the point: the preview cannot drift from what ships.
 */

import { Fragment, type CSSProperties, type ReactElement } from 'react';
import type { Box, Column, Page, Row, Section } from '../../lib/content/schema';
import { safeUrl } from '../../lib/content/sanitise';
import { widgetScriptsFor, widgetTagsIn } from '../../lib/content/widgets';
import { BlockRenderer } from './BlockRenderer';

interface Editable {
  editable?: boolean;
  /**
   * The data-path of the block currently being typed into on the canvas.
   *
   * Passed down rather than looked up, because this file has no state and no
   * handlers by design. The block at this path renders an empty shell and the
   * editor owns its contents: see TextBlock's editingHost.
   */
  editingPath?: string | null;
}

/**
 * Emit `data-path` only in the editor.
 *
 * Passing `data-path={undefined}` would keep the attribute out of the DOM,
 * but it still ships as `"data-path":"$undefined"` in the RSC flight payload
 * on every node. Spreading nothing keeps the published response clean, which
 * matters against the 60KB initial-HTML budget.
 */
function pathAttr(editable: boolean, key: string): { 'data-path'?: string } {
  return editable ? { 'data-path': key } : {};
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PageRenderer({
  page,
  editable = false,
  editingPath = null,
  theme,
}: {
  page: Page;
  /**
   * The tenant's theme, already turned into custom properties by
   * lib/theme/tokens.ts.
   *
   * Optional, and omitting it is a real case rather than an oversight: the
   * fallbacks in globals.css are the same values the default theme derives to,
   * so a page rendered without one looks correct rather than unstyled.
   *
   * Custom properties in a style attribute, not a <style> tag. That keeps this
   * CSP clean with no style-src unsafe-inline, and it is the same mechanism the
   * column widths already use. It also means the editor canvas can carry a
   * client's theme with the identical object the published page uses, so the
   * preview cannot drift from what ships.
   */
  theme?: CSSProperties;
} & Editable): ReactElement {
  return (
    <div className="tgs-page" style={theme} {...pathAttr(editable, 'page')}>
      {editable && <InsertPoint index={0} />}

      {page.sections.map((section, index) => (
        <Fragment key={section.id}>
          <SectionRenderer
            section={section}
            index={index}
            editable={editable}
            editingPath={editingPath}
          />
          {editable && <InsertPoint index={index + 1} />}
        </Fragment>
      ))}

      {editable && page.sections.length === 0 && (
        <div className="tgs-placeholder" style={{ margin: 32 }}>
          This page is empty. Add a section to get started.
        </div>
      )}

      {/*
        THE WIDGET SCRIPTS, one per distinct widget on the page.

        Here rather than in the block, because the widget files auto-init on
        every matching container and carry a double-init guard: three Opening
        Hours blocks want one script and three containers, not three of each.

        NEVER IN THE EDITOR. The canvas re-renders on every keystroke, and the
        blocks draw a placeholder there anyway, so a script would be loading for
        containers that do not exist. It also keeps the editor from hammering the
        widget config API while somebody types.

        `defer`, which is what the embed contract specifies: it runs after the
        document is parsed, so it does not matter whether React hoists these into
        the head or leaves them here, the containers exist either way.

        The URL is built by lib/content/widgets.ts from a closed list. Nothing a
        client typed can reach this src, which is the whole reason the widget
        block can be theirs to use rather than staff-only.
      */}
      {!editable
        && widgetScriptsFor(widgetTagsIn(page)).map((src) => (
          <script key={src} src={src} defer />
        ))}
    </div>
  );
}

/**
 * The "Add Section" affordance that sits on the seam between two sections.
 *
 * Zero height and absolutely positioned, so it floats over the join without
 * pushing the sections apart. That matters more than it sounds: the canvas
 * has to stay pixel-accurate to what gets published, and a 24px strip
 * between every section would quietly make the preview a lie.
 *
 * No handler here. The canvas reads data-insert from a delegated click, which
 * is what keeps this file usable as a server component.
 */
function InsertPoint({ index }: { index: number }): ReactElement {
  return (
    <div className="ed-insert">
      <button type="button" className="ed-insert__btn" data-insert={index}>
        <span className="ed-insert__plus" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <span className="ed-insert__label">Add Section</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function SectionRenderer({
  section,
  index,
  editable = false,
  editingPath = null,
}: { section: Section; index: number } & Editable): ReactElement {
  const background = safeUrl(section.backgroundImage ?? '');

  return (
    <section
      className="tgs-section"
      data-tone={section.tone}
      data-width={section.width}
      style={{
        ...boxStyle(section.box),
        '--tgs-pad': `${section.paddingY}px`,
        '--tgs-min-h': `${section.minHeight}px`,
      } as CSSProperties}
      data-shadow={section.box.shadow}
      {...pathAttr(editable, `s${index}`)}
    >
      {background && (
        <>
          <img className="tgs-section__bg" src={background} alt="" aria-hidden="true" />
          <div className="tgs-section__scrim" aria-hidden="true" />
        </>
      )}
      <div className="tgs-section__inner">
        {section.rows.map((row, rowIndex) => (
          <RowRenderer
            key={row.id}
            row={row}
            sectionIndex={index}
            index={rowIndex}
            editable={editable}
            editingPath={editingPath}
          />
        ))}
        {editable && section.rows.length === 0 && (
          <div className="tgs-placeholder">This section has no rows yet</div>
        )}
      </div>

      {/*
        Drag the foot of a section to change its height.
        A button, not a bare div: it has to be reachable by keyboard, and the
        arrow keys in Canvas do the same job as the drag.
      */}
      {editable && (
        <button
          type="button"
          className="ed-vresize"
          data-vresize={`s${index}`}
          aria-label={`Space above and below this section, ${section.paddingY} pixels`}
          title="Drag to change the height"
        >
          <span className="ed-vresize__grip" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/**
 * A box style as custom properties.
 *
 * ALWAYS EMITS THE WHOLE SET, even the zeroes. Custom properties inherit, so
 * a column that left one out would silently pick up its section's value and
 * a padding set on the section would appear again inside every column.
 * Writing all of them at every level is what stops that.
 */
function boxStyle(box: Box): CSSProperties {
  return {
    '--tgs-pt': `${box.padding.top}px`,
    '--tgs-pr': `${box.padding.right}px`,
    '--tgs-pb': `${box.padding.bottom}px`,
    '--tgs-pl': `${box.padding.left}px`,
    '--tgs-radius': `${box.radius}px`,
    '--tgs-bw': `${box.borderWidth}px`,
    '--tgs-bc': box.borderColour ?? 'transparent',
    // 'transparent' rather than 'inherit': a column with no background of its
    // own should show the section behind it, not repaint it.
    '--tgs-bg': box.background ?? 'transparent',
  } as CSSProperties;
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

export function RowRenderer({
  row,
  sectionIndex,
  index,
  editable = false,
  editingPath = null,
}: { row: Row; sectionIndex: number; index: number } & Editable): ReactElement {
  /*
   * The dragged widths become a single custom property, for example
   * "37% 63%". CSS decides when to honour it: above the stacking breakpoint
   * it is the grid, below it the grid is 1fr and the widths are ignored.
   *
   * A custom property in the style attribute is not inline CSS in the sense
   * a CSP cares about, so this stays CSP clean with no style-src unsafe-inline.
   */
  const style = {
    '--tgs-cols': row.columns.map((column) => `${column.width}%`).join(' '),
    '--tgs-gap': `${row.gap}px`,
  } as CSSProperties;

  return (
    <div
      className="tgs-row"
      style={style}
      data-stack={row.stackBelow}
      data-reverse={row.reverseOnStack ? 'true' : undefined}
      {...pathAttr(editable, `s${sectionIndex}r${index}`)}
    >
      {row.columns.map((column, columnIndex) => (
        <ColumnRenderer
          key={column.id}
          column={column}
          sectionIndex={sectionIndex}
          rowIndex={index}
          index={columnIndex}
          isLast={columnIndex === row.columns.length - 1}
          editable={editable}
          editingPath={editingPath}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

export function ColumnRenderer({
  column,
  sectionIndex,
  rowIndex,
  index,
  isLast,
  editable = false,
  editingPath = null,
}: {
  column: Column;
  sectionIndex: number;
  rowIndex: number;
  index: number;
  isLast: boolean;
} & Editable): ReactElement {
  const path = `s${sectionIndex}r${rowIndex}c${index}`;

  return (
    <div
      className="tgs-col"
      data-align={column.align}
      /* Only when it is not the default, so the attribute selector in
         globals.css does the work and a stacked column stays plain markup. */
      data-flow={column.flow === 'row' ? 'row' : undefined}
      data-shadow={column.box.shadow}
      style={boxStyle(column.box)}
      {...pathAttr(editable, path)}
    >
      {column.blocks.map((block, blockIndex) => (
        <div
          key={block.id}
          className="tgs-block"
          data-align={typeof block.props?.align === 'string' ? block.props.align : undefined}
          {...pathAttr(editable, `${path}b${blockIndex}`)}
        >
          <BlockRenderer
            block={block}
            editable={editable}
            editingHost={editable && editingPath === `${path}b${blockIndex}`}
          />
        </div>
      ))}

      {/*
       * AN EMPTY COLUMN IS A COLUMN, NOT A BUTTON.
       *
       * The whole dashed area used to carry data-add, so clicking anywhere in an
       * empty column opened the block picker. That was right when a column had
       * nothing of its own to configure. It stopped being right on 30 Jul 2026,
       * when columns got padding presets and the rest of the style panel: a click
       * on a column now has to be able to mean "select this column", or the one
       * thing you cannot style is an empty one.
       *
       * So the dashed area is part of the column and selects it, and the plus in
       * the middle is the only thing that adds. Andy's call, and the same shape
       * every other builder uses.
       */
      editable && column.blocks.length === 0 && (
        <div className="ed-empty-col">
          <button
            type="button"
            className="ed-empty-col__add"
            data-add={path}
            aria-label="Add content to this column"
            title="Add content"
          >
            {/*
             * Inlined rather than imported from the editor's Icon set. This file
             * is deliberately dependency-light so it can be a server component on
             * the published side, and a static import of an editor component
             * would follow it into that bundle whether or not it renders. Same
             * 24x24 box and 2px round-capped stroke as the rest of the set.
             */}
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      )}

      {/*
       * A COLUMN WITH CONTENT IS STILL A COLUMN.
       *
       * Until now the plus only existed while the column was empty, so putting
       * one block in left no way to add a second from the canvas and no way to
       * click the column rather than the block inside it. Andy: "when i add text
       * (or anything) to a column, it stops being a column; it is just a block".
       * He was describing exactly that.
       *
       * Two things, both only while editing and both only visible on hover, so
       * they do not clutter a page somebody is reading:
       *
       *   the chip   selects the COLUMN. It carries no data-add, so the click
       *              falls through to the column's own data-path, which is how
       *              every other selection on this canvas works.
       *   the plus   adds another block, at the end, where the next one goes.
       */}
      {editable && column.blocks.length > 0 && (
        <>
          <span className="ed-col-chip" aria-hidden="true">
            Column
          </span>
          <button
            type="button"
            className="ed-col-append"
            data-add={path}
            aria-label="Add more content to this column"
            title="Add content"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </>
      )}

      {/*
       * The resize handle sits at the END of every column except the last,
       * absolutely positioned over the gap. Rendering it inside the column
       * rather than between columns keeps the grid to exactly one child per
       * column, so --tgs-cols still lines up.
       */}
      {editable && !isLast && (
        <div
          className="ed-resize"
          data-resize={`s${sectionIndex}r${rowIndex}:${index}`}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize column ${index + 1}`}
          tabIndex={0}
        />
      )}
    </div>
  );
}
