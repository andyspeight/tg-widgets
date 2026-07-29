/**
 * Section layouts.
 *
 * What an agent picks from when they add a section. Each one is a shape:
 * a list of rows, and for each row the relative widths of its columns.
 *
 * The thumbnail in the picker is DRAWN FROM THIS DATA rather than being a
 * hand-made icon per layout, so the picture can never promise something the
 * layout does not build. Add an entry here and the picker gains a correct
 * thumbnail for free.
 *
 * ON THE ASYMMETRIC ONES
 * Andy's reference showed a couple of shapes with one tall cell beside two
 * stacked cells. Those need a row nested inside a column, which the content
 * model deliberately does not do. In practice they are the same thing as a
 * two-column row with two blocks in one side, because blocks in a column
 * already stack, so they are covered without changing the schema.
 */

export interface Layout {
  id: string;
  label: string;
  /** One entry per row. Each entry holds that row's relative column widths. */
  rows: number[][];
}

export const LAYOUTS: readonly Layout[] = [
  { id: 'full', label: 'Full width', rows: [[1]] },
  { id: 'two', label: 'Two columns', rows: [[1, 1]] },
  { id: 'stacked-2', label: 'Two rows', rows: [[1], [1]] },
  { id: 'three', label: 'Three columns', rows: [[1, 1, 1]] },
  { id: 'stacked-3', label: 'Three rows', rows: [[1], [1], [1]] },

  { id: 'sidebar-left', label: 'Narrow then wide', rows: [[1, 2]] },
  { id: 'sidebar-right', label: 'Wide then narrow', rows: [[2, 1]] },
  { id: 'header-two', label: 'Full width, then two', rows: [[1], [1, 1]] },
  { id: 'grid-2x2', label: 'Two by two', rows: [[1, 1], [1, 1]] },
  { id: 'two-footer', label: 'Two, then full width', rows: [[1, 1], [1]] },

  { id: 'four', label: 'Four columns', rows: [[1, 1, 1, 1]] },
  { id: 'header-three', label: 'Full width, then three', rows: [[1], [1, 1, 1]] },
];

export const DEFAULT_LAYOUT: Layout = LAYOUTS[0];

export function layoutById(id: string): Layout | undefined {
  return LAYOUTS.find((layout) => layout.id === id);
}

/**
 * Geometry for a thumbnail, in a 0..1 box.
 *
 * Returned as plain numbers so the drawing component stays dumb and this
 * stays testable without a DOM.
 */
export function layoutCells(
  layout: Layout,
  gap = 0.06,
): Array<{ x: number; y: number; width: number; height: number }> {
  const rowCount = layout.rows.length;
  const rowHeight = (1 - gap * (rowCount - 1)) / rowCount;
  const cells: Array<{ x: number; y: number; width: number; height: number }> = [];

  layout.rows.forEach((ratios, rowIndex) => {
    const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
    const available = 1 - gap * (ratios.length - 1);
    let x = 0;

    ratios.forEach((ratio) => {
      const width = (ratio / total) * available;
      cells.push({ x, y: rowIndex * (rowHeight + gap), width, height: rowHeight });
      x += width + gap;
    });
  });

  return cells;
}
