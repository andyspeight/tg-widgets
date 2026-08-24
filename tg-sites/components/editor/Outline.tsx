'use client';

/**
 * The outline pane.
 *
 * WHAT CHANGED AND WHY
 * The first version drew the data model: Section, then Row, then Column,
 * then Block, four levels deep, every node carrying percentages and four
 * unlabelled icon buttons. Andy's verdict was that it would frighten a basic
 * user, and he was right. A travel agent does not think in columns and they
 * certainly do not think in 33.34%.
 *
 * So this shows their PAGE instead of our schema:
 *
 *   - Sections are cards, collapsed by default. The default state of the
 *     pane is now a short calm list of named parts of the page.
 *   - A section names itself from its first heading when nobody has named
 *     it, so the list reads "Greece, planned properly" not "Section 1".
 *   - Rows are never named. More than one shows as a hairline, nothing else.
 *   - Columns are not nodes. They are "Left" and "Right" group labels, and
 *     only when there is more than one.
 *   - Percentages are gone. Layout reads as "Two columns". The numbers live
 *     in the properties pane and on the canvas handles, where they are being
 *     deliberately adjusted rather than idly read.
 *   - Four hover-only icon buttons became one labelled menu, which also
 *     fixes the fact that hover does not exist on a tablet.
 */

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Block, Page, Row } from '../../lib/content/schema';
import type { OutlineDragItem } from './outline-move';
import { hasInnerColumns } from '../../lib/content/inner-columns';
import { blockLabel, createRow } from '../../lib/content/factory';
import {
  type Path,
  type Reid,
  addRow,
  containerColumns,
  duplicateBlock,
  duplicateSection,
  moveBlockWithinColumn,
  moveSection,
  pathKey,
  removeBlock,
  removeRow,
  removeSection,
} from '../../lib/content/tree';
import { blockDefinition } from '../../lib/content/blocks';
import {
  TONE_WORDS,
  columnWord,
  contentCount,
  layoutWords,
  sectionName,
} from '../../lib/content/naming';
import { ElementsPalette } from './ElementsPalette';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { LayoutThumb } from './SectionPicker';
import { LAYOUTS } from '../../lib/content/layouts';

/** The single-row layouts, which are the only ones that make sense as a row. */
const ROW_LAYOUTS = LAYOUTS.filter((layout) => layout.rows.length === 1);

interface Props {
  page: Page;
  selectedKey: string | null;
  onSelect: (path: Path) => void;
  onCommit: (next: (current: Page) => Page, coalesceKey?: string) => void;
  onPickBlock: (target: { section: number; row: number; column: number }) => void;
  onAddSection: () => void;
  newId: Reid;
  /** Staff see staff-only blocks in the elements palette, as in the + picker. */
  isStaff: boolean;
  /** Click-to-add from the elements palette. The shell decides where it lands. */
  onAddElement: (type: string) => void;
}

// ---------------------------------------------------------------------------

/**
 * A row something can be dropped on.
 *
 * ONE HOOK PER ROW, which is why this is a component rather than a few lines
 * inside the map: useDroppable is a hook and a hook cannot be called in a loop.
 *
 * The highlight comes from dnd-kit's own isOver rather than from state this pane
 * keeps, and that is the real change. The native version tracked the hovered row
 * itself through onDragOver and onDragLeave, a pair that fires in the wrong order
 * when the pointer crosses between two rows, so the row being left cleared the
 * highlight the row being entered had just set. The is-dragover class is the same
 * one; only who decides it has changed.
 */
function OutlineDropRow({
  id,
  item,
  className,
  open,
  selected,
  children,
}: {
  id: string;
  item: OutlineDragItem;
  className: string;
  open?: boolean;
  selected?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `odrop:${id}`, data: { outlineDrop: item } });
  return (
    <div
      ref={setNodeRef}
      className={`${className}${isOver ? ' is-dragover' : ''}`}
      data-open={open}
      data-selected={selected}
    >
      {children}
    </div>
  );
}

/**
 * The button that both selects a row and drags it.
 *
 * STILL A BUTTON, and still clickable. dnd-kit's PointerSensor up in EditorShell
 * starts a drag only once the pointer has moved 5px, so a plain click reaches
 * onClick exactly as before. That is the whole reason the handle can be the row's
 * own control rather than a separate grip: with native drag it could not, because
 * `draggable` swallowed the gesture from the first pixel.
 *
 * dnd-kit's attributes bring aria-roledescription and a described-by pointing at
 * its own instructions, which is groundwork for #138 rather than decoration.
 */
function OutlineDragHandle({
  id,
  item,
  label,
  className,
  onClick,
  expanded,
  children,
}: {
  id: string;
  item: OutlineDragItem;
  label: string;
  className: string;
  onClick: () => void;
  expanded?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, listeners, attributes } = useDraggable({
    id: `odrag:${id}`,
    data: { outlineDrag: item, moveLabel: label },
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={className}
      aria-expanded={expanded}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

export function Outline({
  page,
  selectedKey,
  onSelect,
  onCommit,
  onPickBlock,
  onAddSection,
  newId,
  isStaff,
  onAddElement,
}: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  /** Which face of the left pane: the page tree, or the elements to drag from. */
  const [tab, setTab] = useState<'outline' | 'elements'>('outline');

  /*
   * Selecting something on the canvas has to reveal it here, otherwise the
   * two panes disagree about what is being edited. Opening only ever adds,
   * so this never closes a section the agent opened themselves.
   */
  useEffect(() => {
    if (!selectedKey) return;
    const match = selectedKey.match(/^s(\d+)/);
    if (!match) return;
    const id = page.sections[Number(match[1])]?.id;
    if (!id) return;
    setOpen((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, [selectedKey, page]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <aside className="ed-outline" aria-label="Page outline">
      <div className="ed-lefttabs" role="tablist" aria-label="Left panel">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'outline'}
          className="ed-lefttab"
          onClick={() => setTab('outline')}
        >
          Outline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'elements'}
          className="ed-lefttab"
          onClick={() => setTab('elements')}
        >
          Elements
        </button>
      </div>

      {tab === 'elements' ? (
        <ElementsPalette isStaff={isStaff} onAdd={onAddElement} />
      ) : (
        <>
      <div className="ed-panel-head">
        <span className="ed-panel-title">Page</span>
        <span className="ed-panel-sub">
          {page.sections.length} section{page.sections.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="ed-panel-body" style={{ flex: 1 }}>
        <div className="ed-sections">
          {page.sections.map((section, sectionIndex) => {
            const isOpen = open.has(section.id);
            const selected = selectedKey === pathKey({ kind: 'section', section: sectionIndex });
            const dragKey = `sec:${sectionIndex}`;
            const blocks = contentCount(section);

            return (
              <OutlineDropRow
                key={section.id}
                id={dragKey}
                item={{ kind: 'section', section: sectionIndex }}
                className="ed-sec"
                open={isOpen}
                selected={selected}
              >
                <div className="ed-sec-head">
                  <OutlineDragHandle
                    id={dragKey}
                    item={{ kind: 'section', section: sectionIndex }}
                    label={sectionName(section, sectionIndex)}
                    className="ed-sec-toggle"
                    expanded={isOpen}
                    onClick={() => {
                      toggle(section.id);
                      onSelect({ kind: 'section', section: sectionIndex });
                    }}
                  >
                    <Icon name="chevron-right" size={16} className="ed-sec-chevron" />
                    <span className="ed-sec-name">{sectionName(section, sectionIndex)}</span>
                  </OutlineDragHandle>

                  <Menu
                    label={`Options for ${sectionName(section, sectionIndex)}`}
                    items={[
                      {
                        icon: 'arrow-up',
                        label: 'Move up',
                        disabled: sectionIndex === 0,
                        onClick: () => onCommit((c) => moveSection(c, sectionIndex, sectionIndex - 1)),
                      },
                      {
                        icon: 'arrow-down',
                        label: 'Move down',
                        disabled: sectionIndex === page.sections.length - 1,
                        onClick: () => onCommit((c) => moveSection(c, sectionIndex, sectionIndex + 1)),
                      },
                      {
                        icon: 'copy',
                        label: 'Duplicate',
                        onClick: () => onCommit((c) => duplicateSection(c, sectionIndex, newId)),
                      },
                      { separator: true },
                      {
                        icon: 'trash',
                        label: 'Delete section',
                        danger: true,
                        onClick: () => onCommit((c) => removeSection(c, sectionIndex)),
                      },
                    ]}
                  />
                </div>

                <div className="ed-sec-meta">
                  <span className="ed-chip">
                    <span className="ed-chip__dot" data-tone={section.tone} />
                    {TONE_WORDS[section.tone]}
                  </span>
                  <span>{layoutWords(section)}</span>
                  {!isOpen && (
                    <span>
                      · {blocks} item{blocks === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {isOpen && (
                  <div className="ed-sec-body">
                    {section.rows.map((row, rowIndex) => (
                      <Band
                        key={row.id}
                        row={row}
                        sectionIndex={sectionIndex}
                        rowIndex={rowIndex}
                        canRemove={section.rows.length > 1}
                        selectedKey={selectedKey}
                        onSelect={onSelect}
                        onCommit={onCommit}
                        onPickBlock={onPickBlock}
                        newId={newId}
                      />
                    ))}

                    <AddRow onAdd={(preset) => onCommit((c) => addRow(c, sectionIndex, createRow(preset)))} />
                  </div>
                )}
              </OutlineDropRow>
            );
          })}
        </div>
      </div>

      <div className="ed-outline-foot">
        <button
          type="button"
          className="ed-btn"
          data-variant="secondary"
          style={{ width: '100%' }}
          onClick={onAddSection}
        >
          <Icon name="plus" size={16} />
          Add a section
        </button>
      </div>
        </>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// A row, which never calls itself a row
// ---------------------------------------------------------------------------

function Band({
  row,
  sectionIndex,
  rowIndex,
  canRemove,
  selectedKey,
  onSelect,
  onCommit,
  onPickBlock,
  newId,
}: {
  row: Row;
  sectionIndex: number;
  rowIndex: number;
  canRemove: boolean;
  selectedKey: string | null;
  onSelect: (path: Path) => void;
  onCommit: Props['onCommit'];
  onPickBlock: Props['onPickBlock'];
  newId: Reid;
}) {
  const multi = row.columns.length > 1;

  return (
    <div className="ed-rowgroup">
      {row.columns.map((column, columnIndex) => (
        <div className="ed-side" key={column.id}>
          {/*
            The column label selects the column.
            It used to be a caption and nothing more, which was fine while a
            column had no settings of its own. Now it has padding, background,
            corners, border and shadow, and there was no obvious way to reach
            any of them: clicking a column on the canvas selects the block
            inside it. A label that does nothing next to a panel you cannot
            open is worse than no label.
          */}
          {multi && (
            <div className="ed-side-label">
              <button
                type="button"
                className="ed-side-btn"
                aria-pressed={
                  selectedKey === pathKey({ kind: 'column', section: sectionIndex, row: rowIndex, column: columnIndex })
                }
                onClick={() =>
                  onSelect({ kind: 'column', section: sectionIndex, row: rowIndex, column: columnIndex })
                }
              >
                {columnWord(columnIndex, row.columns.length)}
              </button>
            </div>
          )}

          {column.blocks.map((block, blockIndex) => {
            const path: Path = {
              kind: 'block',
              section: sectionIndex,
              row: rowIndex,
              column: columnIndex,
              block: blockIndex,
            };
            const key = `blk:${sectionIndex}:${rowIndex}:${columnIndex}:${blockIndex}`;
            const definition = blockDefinition(block.type);

            return (
              <Fragment key={block.id}>
              <OutlineDropRow
                id={key}
                item={{
                  kind: 'block',
                  section: sectionIndex,
                  row: rowIndex,
                  column: columnIndex,
                  block: blockIndex,
                }}
                className="ed-item"
                selected={selectedKey === pathKey(path)}
              >
                <OutlineDragHandle
                  id={key}
                  item={{
                    kind: 'block',
                    section: sectionIndex,
                    row: rowIndex,
                    column: columnIndex,
                    block: blockIndex,
                  }}
                  label={blockLabel(block)}
                  className="ed-item-main"
                  onClick={() => onSelect(path)}
                >
                  <Icon name={definition?.icon ?? 'text'} size={16} className="ed-item-icon" />
                  <span className="ed-item-text">
                    <span className="ed-item-label">{blockLabel(block)}</span>
                    <span className="ed-item-kind">{definition?.label ?? block.type}</span>
                  </span>
                </OutlineDragHandle>

                <Menu
                  label={`Options for ${blockLabel(block)}`}
                  items={[
                    {
                      icon: 'arrow-up',
                      label: 'Move up',
                      disabled: blockIndex === 0,
                      onClick: () =>
                        onCommit((c) =>
                          moveBlockWithinColumn(c, sectionIndex, rowIndex, columnIndex, blockIndex, blockIndex - 1),
                        ),
                    },
                    {
                      icon: 'arrow-down',
                      label: 'Move down',
                      disabled: blockIndex === column.blocks.length - 1,
                      onClick: () =>
                        onCommit((c) =>
                          moveBlockWithinColumn(c, sectionIndex, rowIndex, columnIndex, blockIndex, blockIndex + 1),
                        ),
                    },
                    {
                      icon: 'copy',
                      label: 'Duplicate',
                      onClick: () =>
                        onCommit((c) => duplicateBlock(c, sectionIndex, rowIndex, columnIndex, blockIndex, newId)),
                    },
                    { separator: true },
                    {
                      icon: 'trash',
                      label: 'Delete',
                      danger: true,
                      onClick: () =>
                        onCommit((c) => removeBlock(c, sectionIndex, rowIndex, columnIndex, blockIndex)),
                    },
                  ]}
                />
              </OutlineDropRow>

              {/* A container opens up: its inner columns and blocks are listed
                  under it, each one selectable so the outline reaches them. */}
              {hasInnerColumns(block.type) && (
                <ContainerBranch
                  block={block}
                  section={sectionIndex}
                  row={rowIndex}
                  column={columnIndex}
                  blockIndex={blockIndex}
                  selectedKey={selectedKey}
                  onSelect={onSelect}
                />
              )}
              </Fragment>
            );
          })}

          <button
            type="button"
            className="ed-add"
            onClick={() => onPickBlock({ section: sectionIndex, row: rowIndex, column: columnIndex })}
          >
            <Icon name="plus" size={16} />
            Add content
          </button>
        </div>
      ))}

      {canRemove && (
        <button
          type="button"
          className="ed-row-remove"
          onClick={() => onCommit((c) => removeRow(c, sectionIndex, rowIndex))}
        >
          <Icon name="trash" size={14} />
          Remove this row
        </button>
      )}
    </div>
  );
}

/**
 * A container, opened up in the outline.
 *
 * The one block whose content is more content, so it is the one block the
 * outline descends into: its inner columns become "Left"/"Right" labels the same
 * as a row's do, and its inner blocks become nested, selectable rows. Select-only
 * on purpose. Reordering and the menus stay on the canvas toolbar, which the
 * inner nodes already have; the outline's job here is to make them reachable and
 * to show what is where.
 */
function ContainerBranch({
  block,
  section,
  row,
  column,
  blockIndex,
  selectedKey,
  onSelect,
}: {
  block: Block;
  section: number;
  row: number;
  column: number;
  blockIndex: number;
  selectedKey: string | null;
  onSelect: (path: Path) => void;
}) {
  const columns = containerColumns(block);
  if (!columns.length) return null;
  const multi = columns.length > 1;

  /*
   * "Left" and "Right" are true of a container and false of a grid. A container
   * is one line of columns, so a position word is the clearest name there is. A
   * grid's cells WRAP, so the third of nine is not on the right of anything, and
   * naming it "Right" would send a client looking in the wrong place. Numbers
   * are the only honest label for a cell.
   */
  const label = (inner: number) =>
    block.type === 'grid' ? `Cell ${inner + 1}` : columnWord(inner, columns.length);

  return (
    <div className="ed-subtree">
      {columns.map((col, inner) => (
        <div className="ed-subcol" key={col.id}>
          {multi && (
            <button
              type="button"
              className="ed-side-btn ed-subcol-label"
              aria-pressed={
                selectedKey === pathKey({ kind: 'inner-column', section, row, column, block: blockIndex, inner })
              }
              onClick={() =>
                onSelect({ kind: 'inner-column', section, row, column, block: blockIndex, inner })
              }
            >
              {label(inner)}
            </button>
          )}

          {col.blocks.map((inblock, innerBlock) => {
            const definition = blockDefinition(inblock.type);
            const path: Path = { kind: 'inner-block', section, row, column, block: blockIndex, inner, innerBlock };
            return (
              <button
                key={inblock.id}
                type="button"
                className="ed-subitem"
                data-selected={selectedKey === pathKey(path)}
                onClick={() => onSelect(path)}
              >
                <Icon name={definition?.icon ?? 'text'} size={14} className="ed-item-icon" />
                <span className="ed-item-label">{blockLabel(inblock)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Adding a row of columns inside an existing section.
 *
 * Shows the same generated thumbnails as the section layout picker, so the
 * two ways of choosing a shape look like the same idea rather than two
 * unrelated controls.
 */
function AddRow({ onAdd }: { onAdd: (preset: string) => void }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="ed-add" onClick={() => setOpen(true)}>
        <Icon name="columns" size={16} />
        Add columns
      </button>
    );
  }

  return (
    <div className="ed-rowpick">
      {ROW_LAYOUTS.map((layout) => (
        <button
          key={layout.id}
          type="button"
          className="ed-rowpick__item"
          title={layout.label}
          aria-label={layout.label}
          onClick={() => {
            onAdd(layout.rows[0].join('-'));
            setOpen(false);
          }}
        >
          <LayoutThumb layout={layout} />
        </button>
      ))}
      <button type="button" className="ed-rowpick__cancel" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
