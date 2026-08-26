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
import { isPermissionError, requireEitherCapability } from '../../lib/auth/capabilities';
import {
  createCollection,
  createItem,
  deleteCollection,
  deleteItem,
  getItem,
  listCollections,
  listItems,
  publishItem,
  reorderItems,
  saveItem,
  scheduleItem,
  unpublishItem,
  updateCollectionFields,
  updateCollectionLayout,
  type Collection,
  type ItemSummary,
  type ItemWithContent,
} from '../../lib/db/collections';
import {
  adoptDestination,
  listAdoptable,
  type AdoptionResult,
  type CorpusEntry,
} from '../../lib/db/reference';
import { REFERENCE_KINDS, type ReferenceKind } from '../../lib/content/reference';
import type { ActionResult } from './pages';

/**
 * The longest list of ids a reorder will accept.
 *
 * Not a limit on how many entries a collection may hold, which is unbounded:
 * this is the screen's own list, and MAX_LISTING_ITEMS is the most anything
 * shows at once. A longer list is not a client arranging their entries.
 */
const MAX_REORDER = 500;

async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

function explain(error: unknown): string {
  if (isPermissionError(error)) return error.message;

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
  /** A starter preset's fields, if one was picked. Parsed in the db layer. */
  fields?: unknown;
}): Promise<ActionResult<Collection>> {
  const result = await attempt(async () =>
    createCollection(await requireEitherCapability('collections', 'blog'), {
      name: String(input.name ?? '').slice(0, 120),
      key: input.key,
      fields: input.fields,
    }),
  );
  if (result.ok) revalidatePath('/collections');
  return result;
}

/**
 * Change how a collection's entries are laid out.
 *
 * The same revalidation the schema edit makes: the layout changes every
 * published entry in the collection at once, and none of those pages was
 * edited, so nothing else would know to refresh them.
 */
export async function updateCollectionLayoutAction(
  collectionId: string,
  layout: string,
): Promise<ActionResult<Collection | null>> {
  const result = await attempt(async () =>
    updateCollectionLayout(
      await requireEitherCapability('collections', 'blog'),
      collectionId,
      String(layout ?? ''),
    ),
  );
  if (result.ok) {
    revalidatePath('/collections');
    revalidatePath('/preview', 'layout');
  }
  return result;
}

/**
 * Change what fields a collection declares.
 *
 * REVALIDATES THE PREVIEW TREE as well as this screen, because a field
 * definition is not only a form: a card fed from this collection may show a
 * price or a number of nights, so adding or removing one changes pages nobody
 * edited. The same call publishing makes, and for the same reason.
 */
export async function updateCollectionFieldsAction(
  collectionId: string,
  fields: unknown,
): Promise<ActionResult<Collection | null>> {
  const result = await attempt(async () =>
    updateCollectionFields(
      await requireEitherCapability('collections', 'blog'),
      collectionId,
      fields,
    ),
  );
  if (result.ok) {
    revalidatePath('/collections');
    revalidatePath('/preview', 'layout');
  }
  return result;
}

export async function deleteCollectionAction(id: string): Promise<ActionResult<boolean>> {
  const result = await attempt(async () => deleteCollection(await requireEitherCapability('collections', 'blog'), id));
  if (result.ok) revalidatePath('/collections');
  return result;
}

export async function createItemAction(
  collectionId: string,
  title: string,
): Promise<ActionResult<ItemWithContent | null>> {
  const result = await attempt(async () =>
    createItem(await requireEitherCapability('collections', 'blog'), collectionId, String(title ?? '').slice(0, 200)),
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
      await requireEitherCapability('collections', 'blog'),
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
  const result = await attempt(async () => publishItem(await requireEitherCapability('collections', 'blog'), itemId));
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
    scheduleItem(await requireEitherCapability('collections', 'blog'), itemId, String(publishAt ?? '')),
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
  const result = await attempt(async () => unpublishItem(await requireEitherCapability('collections', 'blog'), itemId));
  if (result.ok) {
    revalidatePath('/collections');
    revalidatePath('/preview', 'layout');
  }
  return result;
}

/**
 * Put a collection's entries in the order somebody dragged them into.
 *
 * Takes the whole list rather than a move, for the reasons on reorderItems: a
 * swap describes a pair that may not still be neighbours by the time it lands,
 * and a full list is idempotent and repairs older gaps on the way through.
 */
export async function reorderItemsAction(
  collectionKey: string,
  orderedIds: string[],
): Promise<ActionResult<boolean>> {
  /*
   * Shape-checked here, ownership checked by the query.
   *
   * reorderItems scopes on tenant AND collection, so an id from anywhere else
   * updates no rows rather than being rejected. This cap is only against a list
   * long enough to be a nuisance.
   */
  if (!Array.isArray(orderedIds) || orderedIds.length > MAX_REORDER) {
    return { ok: false, error: 'That is not an order I can save.' };
  }

  const result = await attempt(async () =>
    reorderItems(
      await requireEitherCapability('collections', 'blog'),
      collectionKey,
      orderedIds,
    ),
  );

  if (result.ok) {
    revalidatePath('/collections');
    revalidatePath('/preview', 'layout');
  }
  // The count of rows moved is not interesting to the screen; that it worked is.
  return result.ok ? { ok: true, data: true } : result;
}

export async function deleteItemAction(itemId: string): Promise<ActionResult<boolean>> {
  const result = await attempt(async () => deleteItem(await requireEitherCapability('collections', 'blog'), itemId));
  if (result.ok) {
    revalidatePath('/collections');
    revalidatePath('/preview', 'layout');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Adopting a destination
//
// The corpus is shared by every client, so these two are the only place in the
// app where a read is not about this tenant's own content. The write very much
// is: adoptDestination creates a row in this tenant's collection, and the
// capability check below is the same one creating an entry by hand goes through.
// ---------------------------------------------------------------------------

export async function listAdoptableAction(options: {
  kind?: string;
  search?: string;
  limit?: number;
} = {}): Promise<ActionResult<CorpusEntry[]>> {
  /*
   * The kind is narrowed HERE rather than trusted from the browser, even though
   * listAdoptable narrows it again. Two reasons: the type at this boundary
   * should say what it means, and a caller passing something else gets an empty
   * filter rather than a thrown error, which is the right answer for a picker.
   */
  const kind = (REFERENCE_KINDS as readonly string[]).includes(String(options.kind))
    ? (options.kind as ReferenceKind)
    : undefined;

  return attempt(async () =>
    listAdoptable(await requireEitherCapability('collections', 'blog'), {
      kind,
      search: String(options.search ?? '').slice(0, 80),
      limit: Number(options.limit) || 50,
    }),
  );
}

export async function adoptDestinationAction(
  collectionId: string,
  kind: string,
  sourceId: string,
): Promise<ActionResult<AdoptionResult>> {
  const result = await attempt(async () =>
    adoptDestination(
      await requireEitherCapability('collections', 'blog'),
      String(collectionId ?? ''),
      String(kind ?? '') as ReferenceKind,
      String(sourceId ?? '').slice(0, 40),
    ),
  );
  if (result.ok && result.data.ok) revalidatePath('/collections');
  return result;
}
