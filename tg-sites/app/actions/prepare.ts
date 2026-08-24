'use server';

/**
 * Clean the markup for blocks the canvas has just made.
 *
 * WHY THE EDITOR NEEDS TO ASK. The renderer draws an imported design or an embed
 * from markup the server has already cleaned (lib/content/prepared.ts), and the
 * editor page hands it a map for everything the page arrived with. A block the
 * client makes AFTER that is not in it: inserting a designed section, pasting,
 * duplicating, undoing back to something deleted, or finishing an import. All
 * five land here, which is why the map is keyed by block id rather than by a
 * hash of the markup. A hash would save this trip for a duplicate and buy
 * nothing for the other four.
 *
 * WHAT IT IS NOT. It reads no row and writes none, so there is no tenant to
 * scope: the caller sends markup it already has and gets back the cleaned form
 * of that same markup. That also means the answer cannot leak anything the
 * caller did not already hold.
 *
 * IT STILL NEEDS A SESSION. Not for isolation but because parse5 and postcss on
 * a caller's own input is a CPU sink, and an open one is a free denial of
 * service. Signed in is the whole check, and the bounds below are the rest.
 */

import { currentUserId } from '../../lib/auth/session';
import { prepareBlock } from '../../lib/content/prepare-markup';
import { needsPreparing, type PreparedMap } from '../../lib/content/prepared';
import type { ActionResult } from './pages';

/** How many blocks one call may carry. A page of imported sections, generously. */
const MAX_BLOCKS = 60;
/** Per string, matching the bounds the cleaners hold themselves to. */
const MAX_HTML = 500_000;
const MAX_CSS = 500_000;

export interface PrepareRequest {
  id: string;
  type: string;
  html: string;
  css: string;
}

/**
 * Everything reaching this is a guess from the browser, so each field is checked
 * for SHAPE here and for CONTENT by the cleaners themselves. A request that is
 * malformed drops out rather than throwing, so one bad entry cannot cost a page
 * the other fifty-nine.
 */
function safeRequest(value: unknown): PrepareRequest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const id = typeof raw.id === 'string' ? raw.id.slice(0, 64) : '';
  const type = typeof raw.type === 'string' ? raw.type : '';
  if (!id || !needsPreparing(type)) return null;

  return {
    id,
    type,
    html: typeof raw.html === 'string' ? raw.html.slice(0, MAX_HTML) : '',
    css: typeof raw.css === 'string' ? raw.css.slice(0, MAX_CSS) : '',
  };
}

export async function prepareBlocksAction(blocks: unknown): Promise<ActionResult<PreparedMap>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Your session has ended. Sign in again to carry on.' };

  if (!Array.isArray(blocks)) return { ok: true, data: {} };

  const out: PreparedMap = {};
  for (const entry of blocks.slice(0, MAX_BLOCKS)) {
    const request = safeRequest(entry);
    if (!request) continue;

    // Shaped as a Block for prepareBlock, which is the same function the server
    // pages call. One cleaner, so the canvas cannot drift from the published page.
    const ready = prepareBlock({
      id: request.id,
      type: request.type,
      props: { html: request.html, css: request.css },
    } as Parameters<typeof prepareBlock>[0]);

    if (ready) out[request.id] = ready;
  }

  return { ok: true, data: out };
}
