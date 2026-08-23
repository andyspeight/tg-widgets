'use client';

/**
 * Keep the canvas supplied with markup the server has cleaned.
 *
 * THE CANVAS HAS NO SANITISER, and that is the point of the whole arrangement
 * (lib/content/prepared.ts, task #94). So when the client makes a block holding
 * somebody else's markup, the canvas cannot draw it until the server has been
 * through it. This hook notices such a block and asks.
 *
 * SEEDED, NOT EMPTY. The editor page prepares everything the page arrived with
 * and passes it in, so an existing page draws its imported sections on the first
 * paint. Without that seed every one of them would flash a placeholder while a
 * round trip finished, which on a page built from imported designs is the whole
 * page flashing.
 *
 * ASKS ONCE PER VERSION OF A BLOCK, not once per block. `asked` holds a
 * fingerprint of the id AND the markup, because the two blocks that come through
 * here behave differently: an imported design's html and css are frozen at import
 * and only its slots are edited, but an EMBED is a field a client pastes into, so
 * its markup changes under the same id. Keyed on the id alone, an embed would be
 * asked about while it was still empty and never asked again, and it would sit
 * showing "Paste embed code" no matter what was pasted into it.
 *
 * DEBOUNCED, for the same reason. That paste is typed, and a request per
 * keystroke would be one parse of somebody's markup per keystroke. The wait also
 * coalesces a section arriving as several blocks at once into one call.
 */

import { useEffect, useRef, useState } from 'react';

import { prepareBlocksAction } from '../../app/actions/prepare';
import { hasInnerColumns } from '../../lib/content/inner-columns';
import { needsPreparing, type PreparedMap } from '../../lib/content/prepared';
import type { Block, Page } from '../../lib/content/schema';

/** How long a paste settles before it is sent. Short enough not to be felt. */
const SETTLE_MS = 250;

function str(props: Record<string, unknown> | undefined, key: string): string {
  const value = props?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * A block plus the markup it currently holds, in one short string.
 *
 * FNV-1a, which is a cache key and not a security boundary: the answer it fetches
 * is safe because the SERVER cleaned it, so the worst a collision could do is
 * draw the wrong design, and two independent 32-bit passes make that not happen.
 * The length goes in as well, which is free and rules out the easy collisions.
 */
function fingerprint(block: Block): string {
  const markup = `${str(block.props, 'html')}\u0000${str(block.props, 'css')}`;
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < markup.length; i += 1) {
    const code = markup.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x811c9dc5) >>> 0;
  }
  return `${block.id}:${markup.length}:${a.toString(36)}${b.toString(36)}`;
}

/**
 * Every block in the tree that holds borrowed markup, inner containers included.
 *
 * The nesting is not optional: an imported design dropped into a grid lives in
 * props.columns, where a walk over rows and columns alone never looks, and it
 * would sit there drawing its placeholder for ever.
 */
function borrowedBlocks(pages: readonly (Page | null | undefined)[]): Block[] {
  const found: Block[] = [];

  const walk = (blocks: readonly Block[] | undefined, depth: number): void => {
    if (!Array.isArray(blocks) || depth > 6) return;
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (needsPreparing(block.type)) found.push(block);

      if (!hasInnerColumns(block.type)) continue;
      const columns = (block.props as Record<string, unknown> | undefined)?.columns;
      if (!Array.isArray(columns)) continue;
      for (const column of columns) {
        if (column && typeof column === 'object') {
          walk((column as { blocks?: Block[] }).blocks, depth + 1);
        }
      }
    }
  };

  for (const page of pages) {
    for (const section of page?.sections ?? []) {
      for (const row of section?.rows ?? []) {
        for (const column of row?.columns ?? []) walk(column?.blocks, 0);
      }
    }
  }
  return found;
}

/**
 * TAKES EVERY TREE ON THE CANVAS, not just the page. The header and the footer
 * are drawn in their own bands above and below it, they can hold an imported
 * design exactly as a page can, and a hook that walked only the page would leave
 * those two drawing placeholders for ever.
 */
export function usePreparedMarkup(
  pages: readonly (Page | null | undefined)[],
  seed?: PreparedMap,
): PreparedMap {
  const [prepared, setPrepared] = useState<PreparedMap>(seed ?? {});
  /*
   * SEEDED AS ASKED, BY FINGERPRINT AND NOT BY ID.
   *
   * The editor page prepared everything the page arrived with, so those blocks
   * must not be asked about again. Marking them by id would be the obvious way
   * and would be wrong: an embed the client then pastes into keeps its id, so it
   * would count as answered for ever and sit showing its placeholder whatever was
   * pasted. On this first render the trees ARE the ones the seed was made from,
   * so their fingerprints are the ones the seed answers, and an edit after that
   * makes a fingerprint nothing has answered yet.
   */
  const asked = useRef<Set<string> | null>(null);
  if (asked.current === null) {
    const seeded = new Set<string>();
    const fromSeed = new Set(Object.keys(seed ?? {}));
    for (const block of borrowedBlocks(pages)) {
      if (fromSeed.has(block.id)) seeded.add(fingerprint(block));
    }
    asked.current = seeded;
  }

  // The dependency is the fingerprints, not the array: the caller builds a fresh
  // array every render, so depending on it directly would run this every time.
  const signature = borrowedBlocks(pages).map(fingerprint).join(',');

  useEffect(() => {
    const seen = asked.current!;
    const missing = borrowedBlocks(pages).filter((block) => !seen.has(fingerprint(block)));
    if (missing.length === 0) return;

    let live = true;
    const timer = setTimeout(() => {
      // Marked when the call goes, not when the effect runs, so a paste still
      // being typed is not marked as asked about by a request never sent.
      missing.forEach((block) => seen.add(fingerprint(block)));

      void prepareBlocksAction(
        missing.map((block) => ({
          id: block.id,
          type: block.type,
          html: str(block.props, 'html'),
          css: str(block.props, 'css'),
        })),
      ).then((result) => {
        if (!live || !result.ok) return;
        // Merged rather than replaced: another call may have landed first, and a
        // block deleted since is harmless where an entry that vanished is not.
        setPrepared((current) => ({ ...current, ...result.data }));
      });
    }, SETTLE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return prepared;
}
