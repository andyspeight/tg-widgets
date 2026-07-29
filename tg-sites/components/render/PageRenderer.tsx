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
import type { Column, Page, Row, Section } from '../../lib/content/schema';
import { safeUrl } from '../../lib/content/sanitise';
import { BlockRenderer } from './BlockRenderer';

interface Editable {
  editable?: boolean;
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

export function PageRenderer({ page, editable = false }: { page: Page } & Editable): ReactElement {
  return (
    <div className="tgs-page" {...pathAttr(editable, 'page')}>
      {editable && <InsertPoint index={0} />}

      {page.sections.map((section, index) => (
        <Fragment key={section.id}>
          <SectionRenderer section={section} index={index} editable={editable} />
          {editable && <InsertPoint index={index + 1} />}
        </Fragment>
      ))}

      {editable && page.sections.length === 0 && (
        <div className="tgs-placeholder" style={{ margin: 32 }}>
          This page is empty. Add a section to get started.
        </div>
      )}
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
}: { section: Section; index: number } & Editable): ReactElement {
  const background = safeUrl(section.backgroundImage ?? '');

  return (
    <section
      className="tgs-section"
      data-tone={section.tone}
      data-width={section.width}
      style={{ '--tgs-pad': `${section.paddingY}px` } as CSSProperties}
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

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

export function RowRenderer({
  row,
  sectionIndex,
  index,
  editable = false,
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
  } as CSSProperties;

  return (
    <div
      className="tgs-row"
      style={style}
      data-gap={row.gap}
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
}: {
  column: Column;
  sectionIndex: number;
  rowIndex: number;
  index: number;
  isLast: boolean;
} & Editable): ReactElement {
  const path = `s${sectionIndex}r${rowIndex}c${index}`;

  return (
    <div className="tgs-col" data-align={column.align} {...pathAttr(editable, path)}>
      {column.blocks.map((block, blockIndex) => (
        <div
          key={block.id}
          className="tgs-block"
          data-align={typeof block.props?.align === 'string' ? block.props.align : undefined}
          {...pathAttr(editable, `${path}b${blockIndex}`)}
        >
          <BlockRenderer block={block} editable={editable} />
        </div>
      ))}

      {editable && column.blocks.length === 0 && (
        <div className="ed-empty-col" data-add={path}>
          Drop a block here
        </div>
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
