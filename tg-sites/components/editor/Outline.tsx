'use client';

/**
 * The outline pane.
 *
 * A tree of sections, rows, columns and blocks. This is where structure is
 * changed: add, delete, duplicate and reorder. The canvas is for selecting
 * and for dragging column widths, nothing else.
 *
 * Reordering works by drag AND by the up/down buttons, because a drag-only
 * tree is unusable with a keyboard and most of these clients are not mouse
 * enthusiasts.
 */

import { useState } from 'react';
import type { Page } from '../../lib/content/schema';
import { ROW_PRESETS, blockLabel, createRow, createSection } from '../../lib/content/factory';
import {
  type Path,
  type Reid,
  addRow,
  duplicateBlock,
  duplicateRow,
  duplicateSection,
  moveBlockWithinColumn,
  moveRow,
  moveSection,
  pathKey,
  removeBlock,
  removeRow,
  removeSection,
} from '../../lib/content/tree';
import { blockDefinition } from '../../lib/content/blocks';

interface Props {
  page: Page;
  selectedKey: string | null;
  onSelect: (path: Path) => void;
  onCommit: (next: (current: Page) => Page, coalesceKey?: string) => void;
  onPickBlock: (target: { section: number; row: number; column: number }) => void;
  newId: Reid;
}

type DragItem =
  | { kind: 'section'; section: number }
  | { kind: 'row'; section: number; row: number }
  | { kind: 'block'; section: number; row: number; column: number; block: number };

export function Outline({ page, selectedKey, onSelect, onCommit, onPickBlock, newId }: Props) {
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const isSelected = (path: Path) => selectedKey === pathKey(path);

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

    if (source.kind === 'row' && target.kind === 'row') {
      // Moving a row between sections is a bigger operation than a reorder
      // and is not wired up yet, so keep it inside its own section.
      if (source.section !== target.section || source.row === target.row) return;
      onCommit((current) => moveRow(current, source.section, source.row, target.row));
      return;
    }

    if (source.kind === 'block' && target.kind === 'block') {
      if (
        source.section !== target.section ||
        source.row !== target.row ||
        source.column !== target.column ||
        source.block === target.block
      ) {
        return;
      }
      onCommit((current) =>
        moveBlockWithinColumn(
          current,
          source.section,
          source.row,
          source.column,
          source.block,
          target.block,
        ),
      );
    }
  }

  return (
    <aside className="ed-outline" aria-label="Page outline">
      <div className="ed-panel-head">
        <span>Outline</span>
        <span className="ed-kbd">{page.sections.length} sections</span>
      </div>

      <div className="ed-panel-body" style={{ flex: 1 }}>
        <ul className="ed-tree">
          {page.sections.map((section, sectionIndex) => {
            const sectionPath: Path = { kind: 'section', section: sectionIndex };
            const dragKey = `sec:${sectionIndex}`;

            return (
              <li key={section.id}>
                <button
                  type="button"
                  className={`ed-node${over === dragKey ? ' is-dragover' : ''}`}
                  aria-current={isSelected(sectionPath)}
                  draggable
                  onDragStart={() => setDrag({ kind: 'section', section: sectionIndex })}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
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
                  onClick={() => onSelect(sectionPath)}
                >
                  <span className="ed-node__icon">▤</span>
                  <span className="ed-node__label">
                    {section.name || `Section ${sectionIndex + 1}`}
                  </span>
                  <span className="ed-node__tools">
                    <Tool
                      label="Move section up"
                      disabled={sectionIndex === 0}
                      onClick={() => onCommit((c) => moveSection(c, sectionIndex, sectionIndex - 1))}
                    >
                      ↑
                    </Tool>
                    <Tool
                      label="Move section down"
                      disabled={sectionIndex === page.sections.length - 1}
                      onClick={() => onCommit((c) => moveSection(c, sectionIndex, sectionIndex + 1))}
                    >
                      ↓
                    </Tool>
                    <Tool
                      label="Duplicate section"
                      onClick={() => onCommit((c) => duplicateSection(c, sectionIndex, newId))}
                    >
                      ⧉
                    </Tool>
                    <Tool
                      label="Delete section"
                      danger
                      onClick={() => onCommit((c) => removeSection(c, sectionIndex))}
                    >
                      ✕
                    </Tool>
                  </span>
                </button>

                <ul>
                  {section.rows.map((row, rowIndex) => {
                    const rowPath: Path = { kind: 'row', section: sectionIndex, row: rowIndex };
                    const rowKey = `row:${sectionIndex}:${rowIndex}`;

                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={`ed-node ed-depth-1${over === rowKey ? ' is-dragover' : ''}`}
                          aria-current={isSelected(rowPath)}
                          draggable
                          onDragStart={() => setDrag({ kind: 'row', section: sectionIndex, row: rowIndex })}
                          onDragEnd={() => { setDrag(null); setOver(null); }}
                          onDragOver={(event) => {
                            if (drag?.kind !== 'row') return;
                            event.preventDefault();
                            setOver(rowKey);
                          }}
                          onDragLeave={() => setOver((k) => (k === rowKey ? null : k))}
                          onDrop={(event) => {
                            event.preventDefault();
                            handleDrop({ kind: 'row', section: sectionIndex, row: rowIndex });
                          }}
                          onClick={() => onSelect(rowPath)}
                        >
                          <span className="ed-node__icon">▭</span>
                          <span className="ed-node__label">
                            Row · {row.columns.map((column) => `${Math.round(column.width)}%`).join(' / ')}
                          </span>
                          <span className="ed-node__tools">
                            <Tool
                              label="Move row up"
                              disabled={rowIndex === 0}
                              onClick={() => onCommit((c) => moveRow(c, sectionIndex, rowIndex, rowIndex - 1))}
                            >
                              ↑
                            </Tool>
                            <Tool
                              label="Move row down"
                              disabled={rowIndex === section.rows.length - 1}
                              onClick={() => onCommit((c) => moveRow(c, sectionIndex, rowIndex, rowIndex + 1))}
                            >
                              ↓
                            </Tool>
                            <Tool
                              label="Duplicate row"
                              onClick={() => onCommit((c) => duplicateRow(c, sectionIndex, rowIndex, newId))}
                            >
                              ⧉
                            </Tool>
                            <Tool
                              label="Delete row"
                              danger
                              onClick={() => onCommit((c) => removeRow(c, sectionIndex, rowIndex))}
                            >
                              ✕
                            </Tool>
                          </span>
                        </button>

                        <ul>
                          {row.columns.map((column, columnIndex) => {
                            const columnPath: Path = {
                              kind: 'column',
                              section: sectionIndex,
                              row: rowIndex,
                              column: columnIndex,
                            };

                            return (
                              <li key={column.id}>
                                <button
                                  type="button"
                                  className="ed-node ed-depth-2"
                                  aria-current={isSelected(columnPath)}
                                  onClick={() => onSelect(columnPath)}
                                >
                                  <span className="ed-node__icon">▯</span>
                                  <span className="ed-node__label">
                                    Column {columnIndex + 1} · {Math.round(column.width)}%
                                  </span>
                                  <span className="ed-node__tools">
                                    <Tool
                                      label="Add a block to this column"
                                      onClick={() =>
                                        onPickBlock({
                                          section: sectionIndex,
                                          row: rowIndex,
                                          column: columnIndex,
                                        })
                                      }
                                    >
                                      +
                                    </Tool>
                                  </span>
                                </button>

                                <ul>
                                  {column.blocks.map((block, blockIndex) => {
                                    const blockPath: Path = {
                                      kind: 'block',
                                      section: sectionIndex,
                                      row: rowIndex,
                                      column: columnIndex,
                                      block: blockIndex,
                                    };
                                    const blockKey = `blk:${sectionIndex}:${rowIndex}:${columnIndex}:${blockIndex}`;
                                    const definition = blockDefinition(block.type);

                                    return (
                                      <li key={block.id}>
                                        <button
                                          type="button"
                                          className={`ed-node ed-depth-3${over === blockKey ? ' is-dragover' : ''}`}
                                          aria-current={isSelected(blockPath)}
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
                                          onDragOver={(event) => {
                                            if (drag?.kind !== 'block') return;
                                            event.preventDefault();
                                            setOver(blockKey);
                                          }}
                                          onDragLeave={() => setOver((k) => (k === blockKey ? null : k))}
                                          onDrop={(event) => {
                                            event.preventDefault();
                                            handleDrop({
                                              kind: 'block',
                                              section: sectionIndex,
                                              row: rowIndex,
                                              column: columnIndex,
                                              block: blockIndex,
                                            });
                                          }}
                                          onClick={() => onSelect(blockPath)}
                                        >
                                          <span className="ed-node__icon">{definition?.icon ?? '?'}</span>
                                          <span className="ed-node__label">{blockLabel(block)}</span>
                                          <span className="ed-node__tools">
                                            <Tool
                                              label="Move block up"
                                              disabled={blockIndex === 0}
                                              onClick={() =>
                                                onCommit((c) =>
                                                  moveBlockWithinColumn(c, sectionIndex, rowIndex, columnIndex, blockIndex, blockIndex - 1),
                                                )
                                              }
                                            >
                                              ↑
                                            </Tool>
                                            <Tool
                                              label="Move block down"
                                              disabled={blockIndex === column.blocks.length - 1}
                                              onClick={() =>
                                                onCommit((c) =>
                                                  moveBlockWithinColumn(c, sectionIndex, rowIndex, columnIndex, blockIndex, blockIndex + 1),
                                                )
                                              }
                                            >
                                              ↓
                                            </Tool>
                                            <Tool
                                              label="Duplicate block"
                                              onClick={() =>
                                                onCommit((c) =>
                                                  duplicateBlock(c, sectionIndex, rowIndex, columnIndex, blockIndex, newId),
                                                )
                                              }
                                            >
                                              ⧉
                                            </Tool>
                                            <Tool
                                              label="Delete block"
                                              danger
                                              onClick={() =>
                                                onCommit((c) =>
                                                  removeBlock(c, sectionIndex, rowIndex, columnIndex, blockIndex),
                                                )
                                              }
                                            >
                                              ✕
                                            </Tool>
                                          </span>
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </li>
                            );
                          })}
                        </ul>

                        <div className="ed-add-row" style={{ paddingLeft: 28 }}>
                          <AddRowMenu
                            onAdd={(preset) =>
                              onCommit((c) => addRow(c, sectionIndex, createRow(preset), rowIndex + 1))
                            }
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>

        <div className="ed-add-row">
          <button
            type="button"
            className="ed-btn"
            style={{ flex: 1 }}
            onClick={() => onCommit((c) => ({ ...c, sections: [...c.sections, createSection('1')] }))}
          >
            + Add section
          </button>
        </div>
      </div>
    </aside>
  );
}

function Tool({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      className="ed-btn ed-btn-icon"
      aria-label={label}
      title={label}
      aria-disabled={disabled}
      data-variant={danger ? 'danger' : undefined}
      style={disabled ? { opacity: 0.35, pointerEvents: 'none' } : undefined}
      onClick={(event) => {
        // The tools sit inside the node button, so stop the click from also
        // changing the selection.
        event.stopPropagation();
        if (!disabled) onClick();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      {children}
    </span>
  );
}

function AddRowMenu({ onAdd }: { onAdd: (preset: string) => void }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="ed-btn" style={{ flex: 1 }} onClick={() => setOpen(true)}>
        + Add row
      </button>
    );
  }

  return (
    <div className="ed-segmented" style={{ flexDirection: 'column', width: '100%' }}>
      {ROW_PRESETS.map((preset) => (
        <button
          key={preset.preset}
          type="button"
          onClick={() => {
            onAdd(preset.preset);
            setOpen(false);
          }}
        >
          {preset.label}
        </button>
      ))}
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
