/**
 * Markup the SERVER has already cleaned, on its way to the renderer.
 *
 * WHY THIS EXISTS. Two blocks hold somebody else's markup: the imported design
 * and the embed. Both used to clean themselves at render time, which is the
 * right rule and the wrong place, because the editor canvas renders blocks in
 * the browser. Cleaning at render meant shipping the cleaners, so parse5 and
 * postcss sat in the editor's bundle purely so the canvas could re-check markup
 * the server had already checked. See task #94 for the measurements.
 *
 * WHY IT IS A SIDE CHANNEL RATHER THAN A PROP. The obvious shortcut is to hang
 * the cleaned strings on the block's own props and let the block read what it
 * already has. That would be a hole. Props come out of the database, so a row
 * carrying its own `__html` would be rendered verbatim, and a page arriving from
 * a restored snapshot or a hand-edited row would be trusted exactly where this
 * whole module exists not to trust it. A map threaded down beside the tree
 * cannot be forged by stored content, because no stored content ever reaches
 * it: the only thing that writes an entry is the server pass in
 * prepare-markup.ts, in the same request that renders it.
 *
 * WHY MISSING MEANS EMPTY, NEVER RAW. A block with no entry renders its
 * placeholder. That is the whole safety property, and it is STRICTER than the
 * old arrangement rather than looser: the browser no longer carries a sanitiser
 * at all, so it cannot render markup the server has not cleaned even if
 * something asks it to. A blank section is a bug you can see; a rendered
 * payload is not.
 *
 * KEYED BY BLOCK ID. A block the client has just made (inserting a designed
 * section, duplicating, undoing, pasting) has no entry yet, and asks the server
 * for one. One mechanism covers all of those, which is why this is not keyed by
 * a hash of the markup: a hash would save that round trip for a duplicate and
 * buy nothing for the other four.
 *
 * NO HEAVY IMPORTS HERE, on purpose. This module is read by the renderer, which
 * runs in the browser, so it holds the shape and the lookup and nothing else.
 * The cleaners live in prepare-markup.ts, which only the server imports.
 */

/** One block's cleaned markup. Both halves are ready to render as they are. */
export interface PreparedMarkup {
  /** Cleaned HTML. For an imported design, slots are still `{{tg:...}}`. */
  html: string;
  /** Scoped CSS, or '' where the block has none. */
  css: string;
}

/** Cleaned markup for a page's blocks, by block id. */
export type PreparedMap = Record<string, PreparedMarkup>;

/** The block types whose markup has to be prepared before it can be drawn. */
export const PREPARED_BLOCK_TYPES = ['imported', 'embed'] as const;

export type PreparedBlockType = (typeof PREPARED_BLOCK_TYPES)[number];

export function needsPreparing(type: unknown): type is PreparedBlockType {
  return typeof type === 'string' && (PREPARED_BLOCK_TYPES as readonly string[]).includes(type);
}

/**
 * One block's prepared markup, or null.
 *
 * TOTAL, and it checks the SHAPE rather than assuming it. The map crosses the
 * server-to-client boundary as JSON, so an entry that arrived malformed (an old
 * build, a truncated payload) must read as absent and draw the placeholder,
 * not throw halfway down a page.
 */
export function preparedFor(map: PreparedMap | undefined, blockId: string): PreparedMarkup | null {
  if (!map || typeof blockId !== 'string' || blockId === '') return null;

  const entry = map[blockId];
  if (!entry || typeof entry !== 'object') return null;

  const html = typeof entry.html === 'string' ? entry.html : '';
  const css = typeof entry.css === 'string' ? entry.css : '';
  if (html === '' && css === '') return null;

  return { html, css };
}

/** Every block id in a map, for the canvas to work out what it is missing. */
export function preparedIds(map: PreparedMap | undefined): Set<string> {
  return new Set(map ? Object.keys(map) : []);
}
