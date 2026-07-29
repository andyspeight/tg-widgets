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

import { useEffect, useRef, useState } from 'react';
import type { Page, Row } from '../../lib/content/schema';
import { blockLabel, createRow } from '../../lib/content/factory';
import {
  type Path,
  type Reid,
  addRow,
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
import { Icon } from './Icon';
import { Menu } from './Menu';
import { LayoutThumb } from './LayoutPicker';
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
}

type DragItem =
  | { kind: 'section'; section: number }
  | { kind: 'block'; section: number; row: number; column: number; block: number };

// ---------------------------------------------------------------------------

export function Outline({ page, selectedKey, onSelect, onCommit, onPickBlock, onAddSection, newId }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [over, setOver] = useState<string | null>(null);

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

  function handleDrop(target: DragItem) {
    const source = drag;
    setDrag(null);
    setOver(null);
    if (!source || source.kind !== target.kind) return;

    if (source.kind === 'section' && target.kind === 'section') {
      if (source.section === target.section) return;
      onCommit((current) => moveSection(current, source.section, target.section));
      return;
    }

    if (source.kind === 'block' && target.kind === 'block') {
      const sameColumn =
        source.section === target.section &&
        source.row === target.row &&
        source.column === target.column;
      if (!sameColumn || source.block === target.block) return;
      onCommit((current) =>
        moveBlockWithinColumn(current, source.section, source.row, source.column, source.block, target.block),
      );
    }
  }

  return (
    <aside className="ed-outline" aria-label="Page outline">
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
              <div
                key={section.id}
                className={`ed-sec${over === dragKey ? ' is-dragover' : ''}`}
                data-open={isOpen}
                data-selected={selected}
                onDragOver={(event) => {
                  if (drag?.kind !== 'section') return;
                  event.preventDefault();
                  setOver(dragKey);
                }}
                onDragLeave={() => setOver((k) => (k === dragKey ? null : k))}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop({ kind: 'section', section: sectionIndex });
                }}
              >
                <div className="ed-sec-head">
                  <button
                    type="button"
                    className="ed-sec-toggle"
                    aria-expanded={isOpen}
                    draggable
                    onDragStart={() => setDrag({ kind: 'section', section: sectionIndex })}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    onClick={() => {
                      toggle(section.id);
                      onSelect({ kind: 'section', section: sectionIndex });
                    }}
                  >
                    <Icon name="chevron-right" size={16} className="ed-sec-chevron" />
                    <span className="ed-sec-name">{sectionName(section, sectionIndex)}</span>
                  </button>

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
                        drag={drag}
                        over={over}
                        setDrag={setDrag}
                        setOver={setOver}
                        onDropItem={handleDrop}
                        onSelect={onSelect}
                        onCommit={onCommit}
                        onPickBlock={onPickBlock}
                        newId={newId}
                      />
                    ))}

                    <AddRow onAdd={(preset) => onCommit((c) => addRow(c, sectionIndex, createRow(preset)))} />
                  </div>
                )}
              </div>
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
  drag,
  over,
  setDrag,
  setOver,
  onDropItem,
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
  drag: DragItem | null;
  over: string | null;
  setDrag: (item: DragItem | null) => void;
  setOver: (key: string | null) => void;
  onDropItem: (target: DragItem) => void;
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
              <div
                key={block.id}
                className={`ed-item${over === key ? ' is-dragover' : ''}`}
                data-selected={selectedKey === pathKey(path)}
                onDragOver={(event) => {
                  if (drag?.kind !== 'block') return;
                  event.preventDefault();
                  setOver(key);
                }}
                onDragLeave={() => setOver(over === key ? null : over)}
                onDrop={(event) => {
                  event.preventDefault();
                  onDropItem({
                    kind: 'block',
                    section: sectionIndex,
                    row: rowIndex,
                    column: columnIndex,
                    block: blockIndex,
                  });
                }}
              >
                <button
                  type="button"
                  className="ed-item-main"
                  draggable
                  onDragStart={() =>
                    setDrag({
                      kind: 'block',
                      section: sectionIndex,
                      row: rowIndex,
                      column: columnIndex,
                      block: blockIndex,
                    })
                  }
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onClick={() => onSelect(path)}
                >
                  <Icon name={definition?.icon ?? 'text'} size={16} className="ed-item-icon" />
                  <span className="ed-item-text">
                    <span className="ed-item-label">{blockLabel(block)}</span>
                    <span className="ed-item-kind">{definition?.label ?? block.type}</span>
                  </span>
                </button>

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
              </div>
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
