'use server';

/**
 * What a client may ask the database to do with a collection and its items.
 *
 * The same two rules as app/actions/pages.ts, and there are no exceptions:
 *
 *   1. THE TENANT IS NEVER AN ARGUMENT. It comes from the session, server side.
 *   2. Every id from the caller is a guess, and every query runs inside
 *      withTenant, so a guess matches no row rather than somebody else's.
 */

import { revalidatePath } from 'next/cache';

import { currentUserId, requireTenantId } from '../../lib/auth/session';
import {
  createCollection,
  createItem,
  deleteCollection,
  deleteItem,
  getItem,
  listCollections,
  listItems,
  publishItem,
  saveItem,
  scheduleItem,
  unpublishItem,
  type Collection,
  type ItemSummary,
  type ItemWithContent,
} from '../../lib/db/collections';
import type { ActionResult } from './pages';

async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('23505') || message.includes('duplicate key')) {
    // Two things in this schema are unique: a collection's short name within a
    // site, and an item's address within its collection.
    return message.includes('collections_tenant_id_key_key')
      ? 'A collection already uses that short name.'
      : 'Something in this collection already has that address.';
  }
  if (message.includes('violates check constraint')) {
    return 'That short name has characters it cannot use. Lowercase letters, numbers and hyphens only.';
  }
  if (message.startsWith('This account is not a member')) return message;
  if (message.startsWith('Your session has ended')) return message;
  if (message.startsWith('Refusing to save')) return message;
  if (message.startsWith('Pick a time in the future')) return message;

  console.error('[tg-sites] collection action failed', error);
  return 'Something went wrong saving that. Nothing was changed.';
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listCollectionsAction(): Promise<ActionResult<Collection[]>> {
  return attempt(async () => listCollections(await requireTenantId()));
}

export async function listItemsAction(
  collectionId: string,
): Promise<ActionResult<ItemSummary[]>> {
  return attempt(async () => listItems(await requireTenantId(), collectionId));
}

export async function getItemAction(
  itemId: string,
): Promise<ActionResult<ItemWithContent | null>> {
  return attempt(async () => getItem(await requireTenantId(), itemId));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createCollectionAction(input: {
  name: string;
  key?: string;
}): Promise<ActionResult<Collection>> {
  const result = await attempt(async () =>
    createCollection(await requireTenantId(), {
      name: String(input.name ?? '').slice(0, 120),
      key: input.key,
    }),
  );
  if (result.ok) revalidatePath('/collections');
  return result;
}

export async function deleteCollectionAction(id: string): Promise<ActionResult<boolean>> {
  const result = await attempt(async () => deleteCollection(await requireTenantId(), id));
  if (result.ok) revalidatePath('/collections');
  return result;
}

export async function createItemAction(
  collectionId: string,
  title: string,
): Promise<ActionResult<ItemWithContent | null>> {
  const result = await attempt(async () =>
    createItem(await requireTenantId(), collectionId, String(title ?? '').slice(0, 200)),
  );
  if (result.ok) revalidatePath('/collections');
  return result;
}

/**
 * Save an item's draft.
 *
 * `content` arrives from the browser and is treated as hostile: saveItem parses
 * it, normalises the column widths and runs the whole tree through the sanitiser
 * before a byte of it reaches the database.
 */
export async function saveItemAction(
  itemId: string,
  content: unknown,
  slug: string,
): Promise<ActionResult<ItemSummary | null>> {
  return attempt(async () =>
    saveItem(
      await requireTenantId(),
      itemId,
      content,
      String(slug ?? ''),
      (await currentUserId()) ?? undefined,
    ),
  );
}

/**
 * Publish.
 *
 * REVALIDATES THE WHOLE PREVIEW TREE, not one path. Publishing a post changes
 * the post's own page AND every listing block anywhere on the site that is fed
 * from its collection, and there is no way from here to know which pages those
 * are.
 */
export async function publishItemAction(itemId: string): Promise<ActionResult<ItemSummary | null>> {
  const result = await attempt(async () => publishItem(await requireTenantId(), itemId));
  if (result.ok) {
    revalidatePath('/collections');
    revalidatePath('/preview', 'layout');
  }
  return result;
}

/**
 * Schedule.
 *
 * The same revalidation publishing does, and for the same reason: a scheduled
 * post is published, so every listing that draws from its collection may change.
 * The renderer policy keeps it hidden until its moment, so nothing public shows
 * yet, but the writing screen's own view of it must update now. `publishAt` is a
 * string off the browser and is validated in the database layer, not trusted.
 */
export async function scheduleItemAction(
  itemId: string,
  publishAt: string,
): Promise<ActionResult<ItemSummary | null>> {
  const result = await attempt(async () =>
    scheduleItem(await requireTenantId(), itemId, String(publishAt ?? '')),
  );
  if (result.ok) {
    revalidatePath('/collections');
    revalidatePath('/preview', 'layout');
  }
  return result;
}

export async function unpublishItemAction(
  itemId: string,
): Promise<ActionResult<ItemSummary | null>> {
  const result = await attempt(async () => unpublishItem(await requireTenantId(), itemId));
  if (result.ok) {
    revalidatePath('/collections');
    revalidatePath('/preview', 'layout');
  }
  return result;
}

export async function deleteItemAction(itemId: string): Promise<ActionResult<boolean>> {
  const result = await attempt(async () => deleteItem(await requireTenantId(), itemId));
  if (result.ok) {
    revalidatePath('/collections');
    revalidatePath('/preview', 'layout');
  }
  return result;
}
