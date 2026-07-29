'use server';

/**
 * Everything the editor is allowed to ask the database to do.
 *
 * A server action is a public HTTP endpoint with a nice syntax. Anyone can
 * call any of these with any arguments they like, so two rules hold
 * throughout and there are no exceptions to either:
 *
 *   1. THE TENANT IS NEVER AN ARGUMENT. It comes from the session, server
 *      side. If a caller could pass a tenant id, the entire row level
 *      security layer would reduce to "please pass your own id".
 *
 *   2. Every id from the caller is treated as a guess. Nothing here checks
 *      ownership by hand, because it does not need to: every query runs
 *      inside withTenant, so an id belonging to another tenant matches no
 *      row and comes back null. Failing closed is the default rather than
 *      something each function remembers to do.
 */

import { revalidatePath } from 'next/cache';

import { currentUserId } from '../../lib/auth/temporary';
import {
  createPage,
  deletePage,
  getPage,
  listPages,
  publishPage,
  saveDraft,
  unpublishPage,
  updatePageMeta,
  type PageSummary,
  type PageWithContent,
} from '../../lib/db/pages';
import { slugify } from '../../lib/content/slug';
import { chooseWorkspace, requireTenantId } from '../../lib/session';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Run an action and turn a thrown error into a message the editor can show.
 *
 * Server actions reject with an opaque "an error occurred" in production,
 * which is right for a stack trace and useless for "that slug is taken". The
 * cases worth naming are named; anything else stays generic on purpose.
 */
async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // Postgres unique violation. The only one this schema can raise on a page
  // is a duplicate slug under the same parent.
  if (message.includes('23505') || message.includes('duplicate key')) {
    return 'A page already has that address. Try a different one.';
  }
  if (message.includes('pages_slug_check') || message.includes('violates check constraint')) {
    return 'That address has characters it cannot use. Lowercase letters, numbers and hyphens only.';
  }
  if (message.startsWith('No workspace called')) return message;
  if (message.startsWith('Refusing to save')) return message;
  if (message.includes('own parent')) return 'A page cannot sit inside itself.';

  console.error('[tg-sites] action failed', error);
  return 'Something went wrong saving that. Nothing was changed.';
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listPagesAction(): Promise<ActionResult<PageSummary[]>> {
  return attempt(async () => listPages(await requireTenantId()));
}

export async function getPageAction(
  pageId: string,
): Promise<ActionResult<PageWithContent | null>> {
  return attempt(async () => getPage(await requireTenantId(), pageId));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createPageAction(input: {
  title: string;
  slug?: string;
  parentId?: string | null;
}): Promise<ActionResult<PageWithContent>> {
  const result = await attempt(async () =>
    createPage(await requireTenantId(), {
      title: String(input.title ?? '').slice(0, 200),
      slug: slugify(input.slug ?? input.title ?? ''),
      parentId: input.parentId ?? null,
    }),
  );

  if (result.ok) revalidatePath('/sites');
  return result;
}

export async function renamePageAction(
  pageId: string,
  changes: { title?: string; slug?: string },
): Promise<ActionResult<PageSummary | null>> {
  const result = await attempt(async () =>
    updatePageMeta(await requireTenantId(), pageId, {
      title: changes.title?.slice(0, 200),
      // Undefined leaves the slug alone. An empty string is a real value: it
      // is the home page. So the two cannot be collapsed.
      slug: changes.slug === undefined ? undefined : slugify(changes.slug),
    }),
  );

  if (result.ok) revalidatePath('/sites');
  return result;
}

export async function deletePageAction(pageId: string): Promise<ActionResult<boolean>> {
  const result = await attempt(async () => deletePage(await requireTenantId(), pageId));
  if (result.ok) revalidatePath('/sites');
  return result;
}

/**
 * Save the editor's draft.
 *
 * `page` arrives from the browser and is treated as hostile: saveDraft parses
 * it against the schema, normalises the column widths and runs the whole tree
 * through the sanitiser before a single byte reaches the database.
 */
export async function saveDraftAction(
  pageId: string,
  page: unknown,
): Promise<ActionResult<PageSummary | null>> {
  return attempt(async () =>
    saveDraft(await requireTenantId(), pageId, page, currentUserId() ?? undefined),
  );
}

export async function publishPageAction(
  pageId: string,
): Promise<ActionResult<PageSummary | null>> {
  const result = await attempt(async () =>
    publishPage(await requireTenantId(), pageId, currentUserId() ?? undefined),
  );

  if (result.ok) {
    revalidatePath('/sites');
    revalidatePath('/preview');
  }
  return result;
}

export async function unpublishPageAction(
  pageId: string,
): Promise<ActionResult<PageSummary | null>> {
  const result = await attempt(async () => unpublishPage(await requireTenantId(), pageId));

  if (result.ok) {
    revalidatePath('/sites');
    revalidatePath('/preview');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export async function chooseWorkspaceAction(slug: string): Promise<ActionResult<boolean>> {
  const ok = await chooseWorkspace(slug);
  if (!ok) return { ok: false, error: `No workspace called "${slug}".` };

  revalidatePath('/sites');
  return { ok: true, data: true };
}

// ---------------------------------------------------------------------------

// The slug helper lives in lib/content/slug.ts so the dialog and this
// action derive the same address from the same name.

