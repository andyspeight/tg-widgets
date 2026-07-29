/**
 * In-memory stand-ins for the server actions, for the standalone build only.
 *
 * The standalone file runs from a static host with no network at all, so the
 * real actions cannot be bundled: they import a Postgres driver and Next's
 * cache. esbuild swaps this module in at their import path.
 *
 * THIS IS A TEST DOUBLE, NOT A SECOND PERSISTENCE PATH. Nothing in the app
 * imports it, and the editor is unchanged: it calls the same functions with
 * the same signatures and gets the same shapes back. The `satisfies` clauses
 * at the bottom are what make that a checked claim rather than a hope, so
 * changing an action's signature fails the typecheck here too.
 *
 * The page is held in a variable and lost when the tab closes, which is the
 * honest behaviour for a review copy of an editor.
 */

import type { ActionResult } from '../app/actions/pages';
import type { PageSummary } from '../lib/db/pages';
import { parsePage } from '../lib/content/schema';

const state: PageSummary = {
  id: 'demo',
  parentId: null,
  slug: '',
  title: 'Demo page',
  status: 'draft',
  hasUnpublishedChanges: true,
  publishedAt: null,
  updatedAt: new Date(),
};

/** A save that validates for real, so a broken tree still fails here. */
export async function saveDraftAction(
  _pageId: string,
  page: unknown,
): Promise<ActionResult<PageSummary | null>> {
  const parsed = parsePage(page);
  if (!parsed.ok) {
    return { ok: false, error: `Refusing to save a malformed page: ${parsed.errors.join('; ')}` };
  }

  state.title = parsed.page.title;
  state.slug = parsed.page.slug;
  state.hasUnpublishedChanges = true;
  state.updatedAt = new Date();
  return { ok: true, data: { ...state } };
}

export async function publishPageAction(
  _pageId: string,
): Promise<ActionResult<PageSummary | null>> {
  state.status = 'published';
  state.hasUnpublishedChanges = false;
  state.publishedAt = new Date();
  return { ok: true, data: { ...state } };
}

// Compile-time proof that the doubles still match the real thing. If a real
// action gains an argument or changes its return type, this stops building.
import type * as real from '../app/actions/pages';

const _saveMatches = saveDraftAction satisfies typeof real.saveDraftAction;
const _publishMatches = publishPageAction satisfies typeof real.publishPageAction;
void _saveMatches;
void _publishMatches;
