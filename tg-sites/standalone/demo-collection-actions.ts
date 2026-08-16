/**
 * In-memory stand-ins for the collection actions, for the standalone build only.
 *
 * Same reasoning as standalone/demo-region-actions.ts: the real ones import a
 * Postgres driver and Next's cache, neither of which can exist in a file served
 * from a static host. THIS IS A TEST DOUBLE, NOT A SECOND PERSISTENCE PATH.
 * Nothing in the app imports it, and the editor is unchanged.
 *
 * The review copy edits pages, so the only two of these it ever calls are the
 * save and the publish the shell holds a reference to. The rest are here because
 * the module has to export them for the shapes below to check, and because a
 * double that answers half a module is a trap the first time somebody adds an
 * item screen to the review copy.
 *
 * The save VALIDATES FOR REAL, through parseItem and sanitiseItem, which is the
 * whole point of a double rather than a stub that answers yes. Content the real
 * save would refuse is refused here too, in the browser, where the harness can
 * see it.
 */

import type { ActionResult } from '../app/actions/pages';
import type { Collection, ItemSummary, ItemWithContent } from '../lib/db/collections';
import { emptyItem, parseItem, safeFutureTimestamp, safeSlug, type CollectionItem } from '../lib/content/collection';
import { sanitiseItem } from '../lib/content/sanitise-page';

interface Row {
  summary: ItemSummary;
  item: CollectionItem;
  collectionKey: string;
}

const collections: Collection[] = [{ id: 'demo-blog', key: 'blog', name: 'Blog' }];
const rows = new Map<string, Row>();

let nextId = 1;

function summaryOf(id: string, slug: string, status: 'draft' | 'published'): ItemSummary {
  const existing = rows.get(id)?.summary;
  return {
    id,
    collectionId: 'demo-blog',
    slug,
    title: rows.get(id)?.item.title ?? '',
    status,
    hasUnpublishedChanges: status !== 'published',
    scheduled: false,
    publishedAt: status === 'published' ? new Date() : (existing?.publishedAt ?? null),
    updatedAt: new Date(),
  };
}

export async function listCollectionsAction(): Promise<ActionResult<Collection[]>> {
  return { ok: true, data: [...collections] };
}

export async function listItemsAction(): Promise<ActionResult<ItemSummary[]>> {
  return { ok: true, data: [...rows.values()].map((row) => row.summary) };
}

export async function getItemAction(itemId: string): Promise<ActionResult<ItemWithContent | null>> {
  const row = rows.get(itemId);
  return { ok: true, data: row ? { ...row.summary, item: row.item, collectionKey: row.collectionKey } : null };
}

export async function createCollectionAction(input: {
  name: string;
  key?: string;
}): Promise<ActionResult<Collection>> {
  const name = String(input.name ?? '').trim() || 'Untitled';
  const made = { id: `demo-${nextId++}`, key: safeSlug(input.key || name) || 'list', name };
  collections.push(made);
  return { ok: true, data: made };
}

export async function deleteCollectionAction(id: string): Promise<ActionResult<boolean>> {
  const at = collections.findIndex((entry) => entry.id === id);
  if (at !== -1) collections.splice(at, 1);
  return { ok: true, data: at !== -1 };
}

export async function createItemAction(
  collectionId: string,
  title: string,
): Promise<ActionResult<ItemWithContent | null>> {
  const clean = String(title ?? '').trim() || 'Untitled';
  const id = `demo-item-${nextId++}`;
  const slug = safeSlug(clean) || 'untitled';

  rows.set(id, {
    summary: { ...summaryOf(id, slug, 'draft'), title: clean },
    item: { ...emptyItem(), title: clean },
    collectionKey: 'blog',
  });

  void collectionId;
  const row = rows.get(id)!;
  return { ok: true, data: { ...row.summary, item: row.item, collectionKey: row.collectionKey } };
}

export async function saveItemAction(
  itemId: string,
  content: unknown,
  slug: string,
): Promise<ActionResult<ItemSummary | null>> {
  const parsed = parseItem(content);
  if (!parsed.ok) {
    return { ok: false, error: `Refusing to save a malformed item: ${parsed.errors.join('; ')}` };
  }

  const clean = sanitiseItem(parsed.item);
  const address = safeSlug(slug) || safeSlug(clean.title) || 'untitled';
  const summary = { ...summaryOf(itemId, address, 'draft'), title: clean.title };

  rows.set(itemId, { summary, item: clean, collectionKey: 'blog' });
  return { ok: true, data: summary };
}

export async function publishItemAction(itemId: string): Promise<ActionResult<ItemSummary | null>> {
  const row = rows.get(itemId);
  if (!row) return { ok: true, data: null };

  const summary = { ...row.summary, status: 'published' as const, hasUnpublishedChanges: false, publishedAt: new Date() };
  rows.set(itemId, { ...row, summary });
  return { ok: true, data: summary };
}

export async function scheduleItemAction(
  itemId: string,
  publishAt: string,
): Promise<ActionResult<ItemSummary | null>> {
  // The same validation the real action makes, so the harness sees the same
  // refusal for a past time that the browser would get from the server.
  const when = safeFutureTimestamp(publishAt);
  if (!when) return { ok: false, error: 'Pick a time in the future to schedule it for.' };

  const row = rows.get(itemId);
  if (!row) return { ok: true, data: null };

  const summary = {
    ...row.summary,
    status: 'published' as const,
    hasUnpublishedChanges: false,
    scheduled: true,
    publishedAt: new Date(when),
  };
  rows.set(itemId, { ...row, summary });
  return { ok: true, data: summary };
}

export async function unpublishItemAction(itemId: string): Promise<ActionResult<ItemSummary | null>> {
  const row = rows.get(itemId);
  if (!row) return { ok: true, data: null };

  const summary = { ...row.summary, status: 'draft' as const, hasUnpublishedChanges: true, scheduled: false };
  rows.set(itemId, { ...row, summary });
  return { ok: true, data: summary };
}

export async function deleteItemAction(itemId: string): Promise<ActionResult<boolean>> {
  return { ok: true, data: rows.delete(itemId) };
}

// Compile-time proof that the doubles still match the real thing. If a real
// action gains an argument or changes its return type, this stops building.
import type * as real from '../app/actions/collections';

const _list = listCollectionsAction satisfies typeof real.listCollectionsAction;
const _items = listItemsAction satisfies typeof real.listItemsAction;
const _get = getItemAction satisfies typeof real.getItemAction;
const _newCollection = createCollectionAction satisfies typeof real.createCollectionAction;
const _dropCollection = deleteCollectionAction satisfies typeof real.deleteCollectionAction;
const _newItem = createItemAction satisfies typeof real.createItemAction;
const _save = saveItemAction satisfies typeof real.saveItemAction;
const _publish = publishItemAction satisfies typeof real.publishItemAction;
const _schedule = scheduleItemAction satisfies typeof real.scheduleItemAction;
const _unpublish = unpublishItemAction satisfies typeof real.unpublishItemAction;
const _dropItem = deleteItemAction satisfies typeof real.deleteItemAction;
void _list;
void _items;
void _get;
void _newCollection;
void _dropCollection;
void _newItem;
void _save;
void _publish;
void _schedule;
void _unpublish;
void _dropItem;
