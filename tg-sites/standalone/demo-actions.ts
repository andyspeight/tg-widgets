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
import type { PageSummary, PageWithContent, PublishRecord } from '../lib/db/pages';
import { parsePage, type Page } from '../lib/content/schema';

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

/**
 * Create a page. In-memory, so the review copy can add one and see it.
 *
 * The real one inserts a row and lets the database enforce a unique slug; here
 * there is one page and no table, so a new one is just a fresh summary. Enough
 * for the harness to prove the Add page composer calls through and gets an id
 * back. It navigates on success in the real app, which a static file cannot do,
 * so the browser check stops at the composer and does not complete a create.
 */
export async function createPageAction(input: {
  title: string;
  slug?: string;
  parentId?: string | null;
}): Promise<ActionResult<PageWithContent>> {
  const title = String(input.title ?? '').trim() || 'Untitled page';
  const made: PageWithContent = {
    id: 'demo-new',
    parentId: input.parentId ?? null,
    slug: (input.slug ?? title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    title,
    status: 'draft',
    hasUnpublishedChanges: true,
    publishedAt: null,
    updatedAt: new Date(),
    content: fixture({ version: 1, id: 'demo-new', slug: '', title, sections: [] }),
  };
  return { ok: true, data: made };
}

/**
 * Move a page into a folder, or back out to the top level. In-memory, so the
 * review copy can drag a row and have it stay.
 *
 * The panel moves the row on screen itself and only asks this to make it stick,
 * so there is nothing to persist here: it reports success and the drag holds.
 * The real one re-parents the row and writes redirects; a static file has no
 * table and no links to keep, so a plausible summary is all the panel needs back.
 */
export async function movePageAction(
  pageId: string,
  parentId: string | null,
): Promise<ActionResult<PageSummary | null>> {
  return { ok: true, data: { ...state, id: pageId, parentId } };
}

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

/**
 * Publishing, which since #239 also answers with anything the search listing was
 * filled in with on the way.
 *
 * THE DOUBLE FILLS NOTHING. The real one reads the page, asks a model and saves,
 * none of which this build has, and inventing a plausible title here would mean
 * the harness testing a panel the live editor might never show. An empty `filled`
 * is the honest answer and is also the commonest real one: a page whose client
 * wrote their own title and description has nothing to fill.
 */
export async function publishPageAction(
  _pageId: string,
): Promise<ActionResult<PublishOutcome>> {
  state.status = 'published';
  state.hasUnpublishedChanges = false;
  state.publishedAt = new Date();
  return { ok: true, data: { summary: { ...state }, filled: {}, altsFilled: 0 } };
}

/*
 * Version history, with two entries that exist from the start.
 *
 * Seeded rather than built up by publishing, because the interesting thing to
 * check in a browser is the LIST and the restore, and a harness that had to
 * publish twice before it could look at either would be testing the publish
 * button. Dated relative to nothing: the timestamps are fixed so a screenshot
 * taken tomorrow looks the same as one taken today.
 */
/**
 * A fixture page, or a thrown error.
 *
 * parsePage returns a discriminated union and the fixtures below are written by
 * hand, so the failure case is a typo in this file rather than anything a user
 * did. Throwing makes that a build failure instead of a fixture that silently
 * becomes undefined and a harness that checks nothing.
 */
function fixture(input: unknown): Page {
  const parsed = parsePage(input);
  if (!parsed.ok) throw new Error(`Bad demo fixture: ${parsed.errors.join('; ')}`);
  return parsed.page;
}

const HISTORY: Array<PublishRecord & { snapshot: Page }> = [
  {
    id: 'pub-2',
    userId: 'demo-user',
    title: 'Demo page',
    createdAt: new Date('2026-07-29T14:30:00Z'),
    snapshot: fixture({
      version: 1, id: 'demo', slug: '', title: 'Demo page', sections: [],
    }),
  },
  {
    id: 'pub-1',
    userId: 'someone-else',
    title: 'The version before that',
    createdAt: new Date('2026-07-27T09:05:00Z'),
    snapshot: fixture({
      version: 1, id: 'demo', slug: '', title: 'The version before that', sections: [],
    }),
  },
];

export async function listPublishesAction(
  _pageId: string,
): Promise<ActionResult<PublishRecord[]>> {
  return {
    ok: true,
    data: HISTORY.map(({ snapshot: _snapshot, ...row }) => ({ ...row })),
  };
}

export async function restorePublishAction(
  _pageId: string,
  publishId: string,
): Promise<ActionResult<PageWithContent | null>> {
  const found = HISTORY.find((row) => row.id === publishId);
  // Null rather than an error for an unknown id, which is what the real one
  // does when the version belongs to another page or has been pruned.
  if (!found) return { ok: true, data: null };

  return {
    ok: true,
    data: { ...state, title: found.snapshot.title, content: found.snapshot },
  };
}

// Compile-time proof that the doubles still match the real thing. If a real
// action gains an argument or changes its return type, this stops building.
import type { PublishOutcome } from '../app/actions/pages';
import type * as real from '../app/actions/pages';

const _createMatches = createPageAction satisfies typeof real.createPageAction;
const _moveMatches = movePageAction satisfies typeof real.movePageAction;
const _saveMatches = saveDraftAction satisfies typeof real.saveDraftAction;
const _publishMatches = publishPageAction satisfies typeof real.publishPageAction;
const _listMatches = listPublishesAction satisfies typeof real.listPublishesAction;
const _restoreMatches = restorePublishAction satisfies typeof real.restorePublishAction;
void _createMatches;
void _moveMatches;
void _saveMatches;
void _publishMatches;
void _listMatches;
void _restoreMatches;
