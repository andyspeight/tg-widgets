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
import { safeAnchor, safeColour, type Box, type Column, type Page, type Row, type Section } from '../../lib/content/schema';
import { dividerShape, normaliseDividerHeight, safeDivider, sectionFill } from '../../lib/content/dividers';
import { safeUrl } from '../../lib/content/sanitise';
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
  emptyNote = 'This page is empty. Add a section to get started.',
  theme,
  region = null,
}: {
  page: Page;
  /**
   * What the editor says when there is nothing here yet.
   *
   * A prop rather than a constant because this same renderer draws the site's
   * header and footer in the editor, wrapped as a page, and telling somebody
   * who has opened their header that "this page is empty" is the sort of small
   * wrongness that makes a product feel like scaffolding. The browser harness
   * caught exactly that.
   *
   * Only ever seen while editing: a published page with no sections renders
   * nothing at all.
   */
  emptyNote?: string;
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
  /**
   * Which region this tree is, when it is one.
   *
   * ONLY THE EDITOR PASSES THIS, and it is here so the canvas can show a header
   * as a header. A published header goes through RegionRenderer, which wraps it
   * in a real `<header class="tgs-page tgs-region" data-region="header">`; the
   * canvas renders the same sections through this component and got a bare
   * `.tgs-page`, so every rule keyed on a region missed it. The footer's
   * hairline was invisible in the editor from the day it shipped, and the
   * header's phone bar would have been too.
   *
   * `data-sticky` and `data-overlay` are DELIBERATELY not carried across. Those
   * two position the header against the document, and a canvas has no document
   * to stick to: honouring them here would lift the header out of the flow of a
   * preview that has nothing underneath it. They stay a property-pane setting
   * whose effect you see on the site.
   */
  region?: 'header' | 'footer' | null;
} & Editable): ReactElement {
  return (
    <div
      className={region ? 'tgs-page tgs-region' : 'tgs-page'}
      data-region={region ?? undefined}
      style={theme}
      {...pathAttr(editable, 'page')}
    >
      {editable && <InsertPoint index={0} />}

      {page.sections.map((section, index) => (
        <Fragment key={section.id}>
          <SectionRenderer
            section={section}
            index={index}
            editable={editable}
            editingPath={editingPath}
            /*
              A shaped edge is the BOUNDARY between two sections, so drawing one
              needs the colour on the other side of it. Only this component
              knows the order, so only this component can say. Undefined at
              either end means the page itself.
            */
            above={page.sections[index - 1]}
            below={page.sections[index + 1]}
          />
          {editable && <InsertPoint index={index + 1} />}
        </Fragment>
      ))}

      {editable && page.sections.length === 0 && (
        <div className="tgs-placeholder" style={{ margin: 32 }}>
          {emptyNote}
        </div>
      )}

      {/*
        THE WIDGET SCRIPTS ARE NOT HERE, and were until 31 Jul 2026.

        A header and a footer are separate trees that can hold widgets of their
        own, so a page emitting only its own scripts would miss theirs and each
        tree emitting its own would fetch the same file three times. Whoever
        assembles the whole document now collects the tags from all three and
        renders components/render/WidgetScripts.tsx once. See the note in that
        file. The editor renders none of it, for the same reason as before.
      */}
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
  above,
  below,
}: {
  section: Section;
  index: number;
  /** The sections either side, for the shaped edges. See SectionDivider. */
  above?: Section;
  below?: Section;
} & Editable): ReactElement {
  const background = safeUrl(section.backgroundImage ?? '');
  const video = safeUrl(section.backgroundVideo ?? '');
  /*
   * Reduced again here even though the schema already did it on the way in, the
   * same belt-and-braces every other stored string in this tree gets.
   *
   * It earns its place on the CANVAS rather than on a published page. The editor
   * holds a half-typed value between keystrokes, and "!!!" on its way to
   * something real reduces to a bare hyphen. Rendered raw that is `id="-"`,
   * which is a preview showing something the save would quietly correct.
   */
  const anchor = safeAnchor(section.anchor);

  return (
    <section
      className="tgs-section"
      /*
       * The name a link can point at.
       *
       * Slugified by the schema rather than validated here, and absent when
       * there is nothing usable, so an `id=""` never reaches the page. This is
       * the whole of in-page navigation: a button whose address is "#prices"
       * has somewhere to land only because of this attribute.
       */
      {...(anchor ? { id: anchor } : {})}
      data-tone={section.tone}
      data-width={section.width}
      style={{
        ...boxStyle(section.box),
        '--tgs-pad': `${section.paddingY}px`,
        '--tgs-min-h': `${section.minHeight}px`,
        '--tgs-scrim': section.overlay,
        // Only when a colour was chosen. Left unset, the scrim CSS falls back to
        // its own navy default, so a section that never picked one is untouched.
        ...(safeColour(section.overlayColour)
          ? { '--tgs-scrim-colour': safeColour(section.overlayColour) }
          : {}),
      } as CSSProperties}
      data-shadow={section.box.shadow}
      {...pathAttr(editable, `s${index}`)}
    >
      {/*
        THE PICTURE AND THE VIDEO ARE BOTH DRAWN WHEN BOTH ARE SET, with the
        video over the picture. That is what makes a background video safe to
        offer: a visitor who has asked their system for less motion gets the
        video hidden by one CSS rule and the picture showing through, rather
        than a blank band where a hero should be.

        NEVER IN THE EDITOR for the video. A file that reloads and restarts on
        every keystroke is not a preview, it is a distraction and a download.
        The poster still shows, which is what the section will look like to
        anybody who asked for less motion anyway.
      */}
      {background && (
        <img
          className="tgs-section__bg"
          src={background}
          alt=""
          aria-hidden="true"
          style={backgroundStyle(section)}
        />
      )}

      {video && !editable && (
        <video
          className="tgs-section__bg tgs-section__bg--video"
          src={video}
          poster={background || undefined}
          autoPlay
          muted
          loop
          playsInline
          // Decorative by definition: the words over it belong to the blocks
          // inside the section, never to the film.
          aria-hidden="true"
          tabIndex={-1}
        />
      )}

      {(background || video) && <div className="tgs-section__scrim" aria-hidden="true" />}

      {/*
        THE SHAPED EDGES. Each one sits OUTSIDE the section's own box, drawn in
        the section's background colour, so the colour reaches up into the
        section above or down into the one below. That is what makes the join
        look like one design rather than two rectangles touching.

        Drawn before the content so it can never sit over the words, and marked
        decorative because it is: it carries no meaning a reader would miss.
      */}
      <SectionDivider
        edge="top"
        shape={section.dividerTop}
        height={section.dividerHeight}
        fill={sectionFill(above)}
      />
      <SectionDivider
        edge="bottom"
        shape={section.dividerBottom}
        height={section.dividerHeight}
        fill={sectionFill(below)}
      />

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

/**
 * A stored background percentage, pinned to 0..max here as well as in the schema.
 *
 * The last gate before a number reaches the CSS. The editor holds a value
 * between a drag and a save, and a page written by a newer build could carry
 * anything, so the render clamps it again. Missing or not a number is the
 * default, which for the focus point is the middle and for an adjustment is the
 * picture untouched.
 */
function bgPercent(value: unknown, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, Math.round(n)));
}

/**
 * The object-position and filter for a section's background picture.
 *
 * Focus drives object-position, so the part a client chose stays in view when
 * the section crops the picture. The three adjustments become a filter, and
 * because the background img sits UNDER the scrim and the content, darkening or
 * desaturating it never touches the words on top. A filter is emitted only for
 * an adjustment that is actually off its default, so an untouched picture
 * carries none.
 */
function backgroundStyle(section: Section): CSSProperties {
  const focusX = bgPercent(section.backgroundFocusX, 100, 50);
  const focusY = bgPercent(section.backgroundFocusY, 100, 50);
  const brightness = bgPercent(section.backgroundBrightness, 200, 100);
  const contrast = bgPercent(section.backgroundContrast, 200, 100);
  const saturation = bgPercent(section.backgroundSaturation, 200, 100);

  const adjustments: string[] = [];
  if (brightness !== 100) adjustments.push(`brightness(${brightness}%)`);
  if (contrast !== 100) adjustments.push(`contrast(${contrast}%)`);
  if (saturation !== 100) adjustments.push(`saturate(${saturation}%)`);

  return {
    objectPosition: `${focusX}% ${focusY}%`,
    ...(adjustments.length ? { filter: adjustments.join(' ') } : {}),
  };
}

/**
 * One shaped edge of a section.
 *
 * NOTHING AT ALL when the shape is 'none' or a name this build cannot draw, and
 * that second case is the forward-compatibility story: a section saved by a
 * newer build naming a shape added later renders a straight edge here rather
 * than an empty box or a crash.
 *
 * THE FILL IS `currentColor`, and app/globals.css sets that colour per tone on
 * this element. It has to be set rather than inherited: a dark section sets
 * `color` to its inverted text colour, so an inherited fill would draw the
 * divider in the text colour instead of the background one.
 *
 * preserveAspectRatio="none" is what lets one 1200-wide path stretch to any
 * section width while keeping the height it was given.
 */
function SectionDivider({
  edge,
  shape,
  height,
  fill,
}: {
  edge: 'top' | 'bottom';
  shape: string | undefined;
  height: number | undefined;
  /** The colour of the section on the other side of this edge. */
  fill: string;
}): ReactElement | null {
  const found = dividerShape(safeDivider(shape));
  if (!found) return null;

  return (
    <div
      className="tgs-section__divider"
      data-edge={edge}
      aria-hidden="true"
      /*
       * THE COLOUR IS SET HERE RATHER THAN IN CSS, and it has to be. The value
       * comes from the section NEXT DOOR, which no selector can reach: CSS has
       * no previous-sibling combinator and, even for the next one, no way to
       * read another element's computed background into this one. It is also
       * why boxStyle's `--tgs-bg: transparent` cannot be used, since that is
       * emitted on every section whether a colour was chosen or not.
       */
      style={{ height: `${normaliseDividerHeight(height)}px`, color: fill }}
    >
      <svg viewBox="0 0 1200 100" preserveAspectRatio="none" focusable="false">
        <path d={found.path} />
      </svg>
    </div>
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
  editingPath = null,
}: { row: Row; sectionIndex: number; index: number } & Editable): ReactElement {
  /*
   * The dragged widths become a single custom property, for example
   * "minmax(0, 37fr) minmax(0, 63fr)". CSS decides when to honour it: above
   * the stacking breakpoint it is the grid, below it the grid is 1fr and the
   * widths are ignored.
   *
   * FRACTIONS RATHER THAN PERCENTAGES, and the difference is a bug that shipped.
   * This wrote "37% 63%", and a percentage in a grid template resolves against
   * the WHOLE content box, so the gap between the columns was then added on top:
   * every multi-column row was wider than its own container by exactly the total
   * gap. Three columns 24px apart overhung by 48px, four by 72px, and the last
   * column in every card grid was clipped. Nobody saw a scrollbar because
   * `.tgs-page` sets `overflow-x: hidden`, which is a rule about a page never
   * scrolling sideways and quietly hid this as well. A fraction divides what is
   * LEFT after the gaps, which is what the widths meant all along.
   *
   * minmax(0, Nfr) rather than plain Nfr, because a bare fr track has an `auto`
   * minimum and a long unbroken word, a wide image or a table would push the
   * track past its share and put the overflow back.
   *
   * A custom property in the style attribute is not inline CSS in the sense
   * a CSP cares about, so this stays CSP clean with no style-src unsafe-inline.
   */
  const style = {
    '--tgs-cols': row.columns.map((column) => `minmax(0, ${column.width}fr)`).join(' '),
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
