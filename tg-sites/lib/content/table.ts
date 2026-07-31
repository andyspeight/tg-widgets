/**
 * Turning a pasted grid into rows of cells.
 *
 * IN lib/ RATHER THAN BESIDE THE COMPONENT, and that is the convention rather
 * than a preference: vitest.config.ts says tests import only from lib/ and never
 * from a .tsx, because tsconfig sets jsx:"preserve" for Next and the runner
 * cannot parse a component. Logic worth testing lives here, the same way
 * resolveVideo does. The first version of this sat in blocks.tsx and the test
 * for it would not import.
 */

/**
 * The most a pasted table may become.
 *
 * A range dragged out of a spreadsheet can be enormous by accident, and a table
 * with ten thousand rows in it is not a table anybody meant to publish: it is a
 * page that takes a second to render and a scroll nobody reaches the end of.
 * Capped rather than refused, so what they pasted still appears.
 */
export const MAX_TABLE_ROWS = 200;
export const MAX_TABLE_COLUMNS = 12;

/**
 * A pasted grid into rows of cells.
 *
 * TAB FIRST, PIPE SECOND, and decided PER LINE rather than for the whole block.
 * A tab is what a spreadsheet puts on the clipboard, which is how most of these
 * will arrive. A pipe is for somebody typing one out. Deciding per line means a
 * table half pasted and half typed still comes out rectangular.
 *
 * PADDED TO THE WIDEST ROW. A ragged table renders with holes in it and reads
 * badly to a screen reader, which counts columns to say where it is. Somebody
 * who left the end of a line empty meant an empty cell.
 *
 * Never throws. What arrives is a string a client typed into a box, or anything
 * at all if something else wrote the stored JSON.
 */
export function parseTable(raw: unknown): string[][] {
  if (typeof raw !== 'string') return [];

  const rows = raw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, MAX_TABLE_ROWS)
    .map((line) =>
      (line.includes('\t') ? line.split('\t') : line.split('|'))
        .map((cell) => cell.trim())
        .slice(0, MAX_TABLE_COLUMNS));

  if (rows.length === 0) return [];

  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array(width - row.length).fill('')]);
}
