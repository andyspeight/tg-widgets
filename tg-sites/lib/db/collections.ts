/**
 * Collections and their items: the blog, and anything else that is a list.
 *
 * THE TABLES HAVE BEEN THERE SINCE MIGRATION 0004 AND NOTHING HAS EVER READ OR
 * WRITTEN THEM. That is not neglect, it is the note at the top of that file: the
 * shape was settled early so its row level security was written by somebody with
 * the isolation rules fresh in mind rather than bolted on later. This is the
 * file that finally uses it, and no migration was needed to do so.
 *
 * Shaped like lib/db/pages.ts, because the job is the same job: a draft, a
 * published copy, and a public read that cannot see the draft.
 *
 * WHERE THE TRUTH LIVES, and the same answer pages.ts gives: THE COLUMNS WIN.
 * `slug` and `status` are columns because a uniqueness rule and a visibility
 * rule can only be enforced by the database if the database can see them. The
 * rest of an item is in `data`.
 *
 * HOW THE PUBLIC READ IS KEPT HONEST. `collection_items` has a renderer policy
 * of `tenant_id = current_tenant() AND status = 'published'`, written in 0004.
 * A draft post is invisible to the public role even with the right tenant set,
 * which is a database guarantee rather than a WHERE clause anybody has to
 * remember. That is why this file has no `status` filter in its public queries
 * and should never grow one: the absence is the point.
 */

import { parseItem, safeSlug, type CollectionItem } from '../content/collection';
import { sanitiseItem } from '../content/sanitise-page';
import { withPublicTenant, withTenant, type Tx } from './withTenant';

/** How many items a listing block will ever ask for. A guard, not a limit. */
export const MAX_LISTING_ITEMS = 60;

export interface Collection {
  id: string;
  key: string;
  name: string;
}

export interface ItemSummary {
  id: string;
  collectionId: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  /** True when the draft has moved on since the last publish. */
  hasUnpublishedChanges: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface ItemWithContent extends ItemSummary {
  item: CollectionItem;
  /** The collection it belongs to, so a caller can build its address. */
  collectionKey: string;
}

function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

/** The same unwrapping pages.ts does, and for the same reason. */
function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return null;
}

function hydrate(raw: unknown, where: string): CollectionItem {
  const parsed = parseItem(asObject(raw) ?? {});
  if (!parsed.ok) {
    throw new Error(`Stored content for ${where} will not parse: ${parsed.errors.join('; ')}`);
  }
  return parsed.item;
}

function toSummary(row: Record<string, unknown>): ItemSummary {
  return {
    id: String(row.id),
    collectionId: String(row.collection_id),
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    status: row.status as 'draft' | 'published',
    hasUnpublishedChanges: Boolean(row.has_unpublished_changes),
    publishedAt: row.published_at ? new Date(row.published_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * The columns every item read wants.
 *
 * `title` is pulled OUT of the jsonb rather than kept as a column, which is the
 * one place this differs from pages.ts. A page's title is a column because it is
 * also the h1 and the tab name and the thing the whole dashboard lists. An
 * item's title is one of six fields in a fixed shape, and adding a seventh
 * column to keep a copy of it would be a migration for a projection.
 */
function summary(tx: Tx) {
  return tx`
    id, collection_id, slug, status, published_at, updated_at,
    data->>'title' as title,
    (published_at is null or updated_at > published_at) as has_unpublished_changes
  `;
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export async function listCollections(tenantId: string): Promise<Collection[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`select id, key, name from public.collections order by name`;
    return rows.map((row) => ({
      id: String(row.id),
      key: String(row.key),
      name: String(row.name),
    }));
  });
}

/**
 * Make a collection.
 *
 * The key is not made unique here on purpose, the same call pages.ts makes about
 * slugs: a unique index already enforces it, and letting the database refuse
 * means two requests racing cannot both win.
 */
export async function createCollection(
  tenantId: string,
  input: { name: string; key?: string },
): Promise<Collection> {
  const name = input.name.trim() || 'Untitled';
  const key = safeSlug(input.key || name) || 'list';

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      insert into public.collections (tenant_id, key, name)
      values (${tenantId}::uuid, ${key}, ${name})
      returning id, key, name
    `;
    const row = rows[0] as Record<string, unknown>;
    return { id: String(row.id), key: String(row.key), name: String(row.name) };
  });
}

export async function deleteCollection(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    // The items go with it: `on delete cascade` on collection_items.collection_id.
    const rows = await tx`delete from public.collections where id = ${id}::uuid returning id`;
    return rows.length > 0;
  });
}

// ---------------------------------------------------------------------------
// Items, for the people who write them
// ---------------------------------------------------------------------------

/** Every item in a collection, newest first, for the writing screen. */
export async function listItems(
  tenantId: string,
  collectionId: string,
): Promise<ItemSummary[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select ${summary(tx)} from public.collection_items
      where collection_id = ${collectionId}::uuid
      order by coalesce(published_at, updated_at) desc, id desc
    `;
    return rows.map((row) => toSummary(row as Record<string, unknown>));
  });
}

export async function getItem(
  tenantId: string,
  itemId: string,
): Promise<ItemWithContent | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select ${summary(tx)}, data, c.key as collection_key
      from public.collection_items
      join public.collections c on c.id = collection_id
      where public.collection_items.id = ${itemId}::uuid
    `;
    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      ...toSummary(row),
      item: hydrate(row.data, `item ${String(row.id)}`),
      collectionKey: String(row.collection_key),
    };
  });
}

/**
 * Start a new entry in a collection.
 *
 * INSERT ... SELECT FROM collections, rather than INSERT ... VALUES, and that is
 * the security of it rather than a style choice.
 *
 * The collection id comes from the browser, so it is a guess. With VALUES, a
 * guess naming ANOTHER client's collection would be written: the WITH CHECK
 * policy only asks whether tenant_id is ours, and it would be, so the row would
 * go in pointing at a collection its owner cannot see. Nothing would ever render
 * it, but it would sit there until the other client deleted their collection and
 * cascaded it away, which is not a thing a client should be able to make happen
 * in somebody else's account.
 *
 * Selecting from `collections` puts the id through that table's own policy. A
 * collection belonging to somebody else is not visible, so the select finds
 * nothing, so nothing is inserted, and the caller gets null: the same answer a
 * collection that does not exist gives. Fails closed, with no extra round trip
 * and nothing for a future edit here to forget.
 */
export async function createItem(
  tenantId: string,
  collectionId: string,
  title: string,
): Promise<ItemWithContent | null> {
  const clean = title.trim() || 'Untitled';
  const slug = safeSlug(clean) || 'untitled';

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      insert into public.collection_items (tenant_id, collection_id, slug, data)
      select
        ${tenantId}::uuid,
        c.id,
        ${slug},
        ${json(tx, { version: 1, title: clean, summary: '', image: '', alt: '', date: '', sections: [] })}
      from public.collections c
      where c.id = ${collectionId}::uuid
      returning ${summary(tx)}, data
    `;
    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    const collection = await tx`select key from public.collections where id = ${collectionId}::uuid`;

    return {
      ...toSummary(row),
      item: hydrate(row.data, 'a new item'),
      collectionKey: String(collection[0]?.key ?? ''),
    };
  });
}

/**
 * Save the draft.
 *
 * Parsed and sanitised before a byte reaches the database, exactly as a page is.
 * The slug travels alongside because it is a column: it is what the address is
 * made of, and a uniqueness rule can only live where the database can see it.
 */
export async function saveItem(
  tenantId: string,
  itemId: string,
  input: unknown,
  slug: string,
  userId?: string,
): Promise<ItemSummary | null> {
  const parsed = parseItem(input);
  if (!parsed.ok) {
    throw new Error(`Refusing to save a malformed item: ${parsed.errors.join('; ')}`);
  }

  const clean = sanitiseItem(parsed.item);
  const address = safeSlug(slug) || safeSlug(clean.title) || 'untitled';
  void userId;

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.collection_items
      set data = ${json(tx, clean)}, slug = ${address}
      where id = ${itemId}::uuid
      returning ${summary(tx)}
    `;
    return rows.length ? toSummary(rows[0] as Record<string, unknown>) : null;
  });
}

export async function publishItem(
  tenantId: string,
  itemId: string,
): Promise<ItemSummary | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.collection_items
      set status = 'published', published_at = now()
      where id = ${itemId}::uuid
      returning ${summary(tx)}
    `;
    return rows.length ? toSummary(rows[0] as Record<string, unknown>) : null;
  });
}

export async function unpublishItem(
  tenantId: string,
  itemId: string,
): Promise<ItemSummary | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.collection_items set status = 'draft'
      where id = ${itemId}::uuid
      returning ${summary(tx)}
    `;
    return rows.length ? toSummary(rows[0] as Record<string, unknown>) : null;
  });
}

export async function deleteItem(tenantId: string, itemId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      delete from public.collection_items where id = ${itemId}::uuid returning id
    `;
    return rows.length > 0;
  });
}

// ---------------------------------------------------------------------------
// Items, for the people who read them
// ---------------------------------------------------------------------------

export interface PublishedItem {
  slug: string;
  item: CollectionItem;
  publishedAt: Date | null;
}

/**
 * Published items in a collection, newest first, for a listing block.
 *
 * THE READ-ONLY ROLE, AND NO STATUS FILTER. The renderer policy written in
 * migration 0004 is `tenant_id = current_tenant() AND status = 'published'`, so
 * a draft post is invisible to this connection whatever this query asks for.
 * Adding `where status = 'published'` here would look reassuring and would make
 * the guarantee harder to see: it would no longer be obvious that the database
 * is the thing enforcing it.
 */
export async function listPublished(
  tenantId: string,
  collectionKey: string,
  limit: number,
): Promise<PublishedItem[]> {
  const capped = Math.min(MAX_LISTING_ITEMS, Math.max(1, Math.floor(limit) || 1));

  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select i.slug, i.data, i.published_at
      from public.collection_items i
      join public.collections c on c.id = i.collection_id
      where c.key = ${collectionKey}
      order by i.published_at desc nulls last, i.id desc
      limit ${capped}
    `;

    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        slug: String(row.slug),
        item: hydrate(row.data, `${collectionKey}/${String(row.slug)}`),
        publishedAt: row.published_at ? new Date(row.published_at as string) : null,
      };
    });
  });
}

/**
 * One published item, by its collection key and its own address.
 *
 * What a visitor's request resolves to. Null when there is no such collection,
 * no such item, or the item is a draft, and the caller cannot tell those three
 * apart, which is right: a guessed address confirms nothing.
 */
export async function getPublishedItem(
  tenantId: string,
  collectionKey: string,
  slug: string,
): Promise<{ item: CollectionItem; publishedAt: Date | null } | null> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select i.data, i.published_at
      from public.collection_items i
      join public.collections c on c.id = i.collection_id
      where c.key = ${collectionKey} and i.slug = ${slug}
      limit 1
    `;
    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      item: hydrate(row.data, `${collectionKey}/${slug}`),
      publishedAt: row.published_at ? new Date(row.published_at as string) : null,
    };
  });
}
