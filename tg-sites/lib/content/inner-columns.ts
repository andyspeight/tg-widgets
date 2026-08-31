/**
 * Which block types hold columns of their own.
 *
 * A LEAF MODULE ON PURPOSE. Nine places across the schema, the sanitiser, the
 * renderer and the editor need to ask this question, and one of them is
 * components/render/PageRenderer.tsx, which is deliberately kept free of the
 * registry and tree modules so none of that follows it into the published
 * page's bundle. So the answer lives here, with no imports at all, and every
 * caller reads the same list.
 *
 * IT USED TO BE THE STRING 'container', REPEATED. That was fine while the
 * container was the only block with columns inside it. Adding the Grid on
 * 20 Aug 2026 would have meant nine copies of `=== 'container' || === 'grid'`,
 * and the failure mode of missing one is the quiet sort: a grid whose inner
 * blocks skip the sanitiser, or never appear in the outline. Naming the set
 * once means the next block of this shape is a one-line change here.
 *
 * THE LOOP JOINED ON 31 Aug 2026 (Elementor gap #1). A loop stores its ONE
 * designed card as a single inner column, so a client designs the card in the
 * same nested editor a container uses, and the render (lib/content/loop.ts)
 * repeats that one design over a collection. Being in this set is what gives the
 * card's inner blocks the sanitiser, the outline and the props upgrade for free,
 * which is exactly the security-load-bearing recursion this list exists to spread.
 * Its render and its editor differ from a container's, and those two places name
 * 'loop' on their own; everything structural treats it the same.
 *
 * WHAT THEY SHARE: `props.columns` is an array of inner columns, each holding
 * its own blocks. What they do NOT share is how those columns are laid out,
 * which is the renderer's business: a container is a row of resizable columns,
 * a grid is tracks that wrap, a loop is one card repeated over a query.
 */

/** The block types whose `props.columns` holds inner columns. */
export const COLUMN_BLOCK_TYPES: ReadonlySet<string> = new Set(['container', 'grid', 'loop']);

/** Does this block type keep columns of its own inside its props? */
export function hasInnerColumns(type: unknown): boolean {
  return typeof type === 'string' && COLUMN_BLOCK_TYPES.has(type);
}

/**
 * How many cells one grid may hold.
 *
 * Twelve rather than the six a row is capped at, and the difference is that a
 * grid WRAPS. Six columns on one line is already the point at which each one is
 * too narrow to read, so a row stops there. A grid's count is not a share of one
 * line: twelve tiles three across is four tidy rows, and a gallery or a team page
 * wants exactly that. Twelve is where it stops because past it the answer is a
 * second grid, or a collection that repeats itself.
 */
export const MAX_GRID_CELLS = 12;
