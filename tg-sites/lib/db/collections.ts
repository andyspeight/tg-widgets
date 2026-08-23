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

import { parseItem, safeFutureTimestamp, safeSlug, type CollectionItem } from '../content/collection';
import {
  cleanFieldValues,
  fieldFacts,
  parseFieldDefs,
  type FieldDef,
} from '../content/collection-fields';
import { sanitiseItem } from '../content/sanitise-page';
import type { SearchDoc } from '../content/search';
import { pageText } from '../seo/audit';
import { withPublicTenant, withTenant, type Tx } from './withTenant';

/** How many items a listing block will ever ask for. A guard, not a limit. */
export const MAX_LISTING_ITEMS = 60;

export interface Collection {
  id: string;
  key: string;
  name: string;
  /**
   * The fields this collection declares its entries have, from the `fields`
   * column that has been sitting there since migration 0004. Empty for a blog,
   * and empty for every collection made before this existed.
   */
  fields: FieldDef[];
}

export interface ItemSummary {
  id: string;
  collectionId: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  /** True when the draft has moved on since the last publish. */
  hasUnpublishedChanges: boolean;
  /** Published, but its go-live time is still in the future, so the public
   *  cannot see it yet (migration 0020). The editor and this screen can. */
  scheduled: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface ItemWithContent extends ItemSummary {
  item: CollectionItem;
  /** The collection it belongs to, so a caller can build its address. */
  collectionKey: string;
  /**
   * What its collection declares its entries have. The editor needs these to
   * draw the form: an item's `fields` is a bag of keys, and these are what turn
   * a key into a label, an input and a place in the order.
   */
  collectionFields: FieldDef[];
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
    scheduled: Boolean(row.scheduled),
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
 *
 * `scheduled` is the same computation the renderer policy makes (migration
 * 0020): published, but with a go-live time still ahead, so the public cannot
 * see it yet. Computed here so the writing screen can, and can say so.
 */
function summary(tx: Tx) {
  return tx`
    id, collection_id, slug, status, published_at, updated_at,
    data->>'title' as title,
    (published_at is null or updated_at > published_at) as has_unpublished_changes,
    (status = 'published' and published_at is not null and published_at > now()) as scheduled
  `;
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

function toCollection(row: Record<string, unknown>): Collection {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    // asObject because the driver hands jsonb back as a value or as text
    // depending on the column, exactly as it does for `data` below.
    fields: parseFieldDefs(asObject(row.fields)),
  };
}

export async function listCollections(tenantId: string): Promise<Collection[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`select id, key, name, fields from public.collections order by name`;
    return rows.map((row) => toCollection(row as Record<string, unknown>));
  });
}

/**
 * Make a collection.
 *
 * The key is not made unique here on purpose, the same call pages.ts makes about
 * slugs: a unique index already enforces it, and letting the database refuse
 * means two requests racing cannot both win.
 *
 * The field definitions arrive from a starter preset the client picked, and go
 * through parseFieldDefs on the way in exactly as they will on the way out: the
 * screen sending them is a browser, so it is a guess like any other.
 */
export async function createCollection(
  tenantId: string,
  input: { name: string; key?: string; fields?: unknown },
): Promise<Collection> {
  const name = input.name.trim() || 'Untitled';
  const key = safeSlug(input.key || name) || 'list';
  const fields = parseFieldDefs(input.fields);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      insert into public.collections (tenant_id, key, name, fields)
      values (${tenantId}::uuid, ${key}, ${name}, ${json(tx, fields)})
      returning id, key, name, fields
    `;
    return toCollection(rows[0] as Record<string, unknown>);
  });
}

/**
 * Change what fields a collection declares.
 *
 * THE WHOLE LIST AT ONCE, not one field at a time, because the screen edits it
 * as a list and a partial write would leave a client's schema half applied if a
 * request failed between two of them.
 *
 * NOTHING IS DONE TO THE ITEMS. Deleting a definition leaves every item's stored
 * answer exactly where it was, invisible until a definition with that key exists
 * again; renaming a label changes no item at all, because items store by key.
 * That is the whole point of the key/label split, and it is why this is one
 * cheap UPDATE rather than a migration across two hundred rows.
 */
export async function updateCollectionFields(
  tenantId: string,
  collectionId: string,
  fields: unknown,
): Promise<Collection | null> {
  const clean = parseFieldDefs(fields);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.collections set fields = ${json(tx, clean)}
      where id = ${collectionId}::uuid
      returning id, key, name, fields
    `;
    return rows.length ? toCollection(rows[0] as Record<string, unknown>) : null;
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
      select ${summary(tx)}, data, c.key as collection_key, c.fields as collection_fields
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
      collectionFields: parseFieldDefs(asObject(row.collection_fields)),
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
        ${json(tx, {
          version: 1,
          title: clean,
          summary: '',
          image: '',
          alt: '',
          date: '',
          fields: {},
          sections: [],
        })}
      from public.collections c
      where c.id = ${collectionId}::uuid
      returning ${summary(tx)}, data
    `;
    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    const collection = await tx`
      select key, fields from public.collections where id = ${collectionId}::uuid
    `;

    return {
      ...toSummary(row),
      item: hydrate(row.data, 'a new item'),
      collectionKey: String(collection[0]?.key ?? ''),
      collectionFields: parseFieldDefs(asObject(collection[0]?.fields)),
    };
  });
}

/**
 * Save the draft.
 *
 * Parsed and sanitised before a byte reaches the database, exactly as a page is.
 * The slug travels alongside because it is a column: it is what the address is
 * made of, and a uniqueness rule can only live where the database can see it.
 *
 * THE DECLARED FIELDS ARE CLEANED AGAINST THE COLLECTION'S OWN DEFINITIONS, and
 * those are read here rather than sent from the browser. A definition that
 * arrived with the save would be a definition the sender chose, so "is this one
 * of the five choices" would be a question the answer got to set. Reading them
 * inside the same transaction as the write also means a save cannot be cleaned
 * against a schema that changed a moment ago.
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
    const owner = await tx`
      select c.fields
      from public.collection_items i
      join public.collections c on c.id = i.collection_id
      where i.id = ${itemId}::uuid
    `;
    // No row means no such item for this tenant, and the update below will
    // find nothing either. Falling through gives the caller the same null a
    // missing item has always given.
    const defs = parseFieldDefs(asObject(owner[0]?.fields));
    const data = { ...clean, fields: cleanFieldValues(defs, clean.fields) };

    const rows = await tx`
      update public.collection_items
      set data = ${json(tx, data)}, slug = ${address}
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

/**
 * Schedule a post to go live at a future moment.
 *
 * THE SAME ROW CHANGE AS publishItem, with one difference: published_at is set
 * to the chosen instant rather than now(). status becomes 'published' either
 * way, because a scheduled post IS published as far as the row is concerned.
 * What keeps it hidden is the renderer policy from migration 0020, which will
 * not show a published row whose published_at is still ahead. When that moment
 * passes the post appears on its own, with no cron and no second write: the very
 * next public read taken after the instant simply sees it.
 *
 * The time is checked here rather than trusted. safeFutureTimestamp refuses
 * anything that will not parse or is not in the future, because scheduling for a
 * moment already gone is a publish, and the caller has publishItem for that. A
 * refusal throws so the screen can say why, rather than silently publishing now.
 */
export async function scheduleItem(
  tenantId: string,
  itemId: string,
  publishAt: unknown,
): Promise<ItemSummary | null> {
  const when = safeFutureTimestamp(publishAt);
  if (!when) {
    throw new Error('Pick a time in the future to schedule it for.');
  }

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.collection_items
      set status = 'published', published_at = ${when}::timestamptz
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
 * A listing, and the schema its entries were written against.
 *
 * THE DEFINITIONS COME BACK WITH THE ITEMS, from the join that was already
 * there, so a card that shows a price and a number of nights still costs one
 * read per collection. Fetching them separately would have been a second round
 * trip per listing block, which is the exact thing lib/content/listings.ts
 * exists to avoid.
 *
 * Empty when the collection declares none, and empty when nothing is published,
 * because the fields ride on the same rows the items do. Neither case has a
 * card to put a fact on.
 */
export interface PublishedListing {
  fields: FieldDef[];
  items: PublishedItem[];
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
): Promise<PublishedListing> {
  const capped = Math.min(MAX_LISTING_ITEMS, Math.max(1, Math.floor(limit) || 1));

  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select i.slug, i.data, i.published_at, c.fields
      from public.collection_items i
      join public.collections c on c.id = i.collection_id
      where c.key = ${collectionKey}
      order by i.published_at desc nulls last, i.id desc
      limit ${capped}
    `;

    const items = rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        slug: String(row.slug),
        item: hydrate(row.data, `${collectionKey}/${String(row.slug)}`),
        publishedAt: row.published_at ? new Date(row.published_at as string) : null,
      };
    });

    // Every row carries the same collection, so the first one has the schema.
    const fields = parseFieldDefs(asObject((rows[0] as Record<string, unknown>)?.fields));
    return { fields, items };
  });
}

/**
 * Published items in a collection carrying a given tag, newest first.
 *
 * FILTERED IN JS, NOT IN SQL, and that is the tag being a display label. The URL
 * carries the tag's slug, but the stored tag is the words a client typed, so
 * "Family holidays" lives under /family-holidays. A jsonb match would ask for
 * the exact spelling and miss it. So the rows come back and safeSlug decides
 * each, and the first match's own spelling becomes the label, so the archive is
 * titled the way the client wrote the tag rather than the way a URL spells it.
 *
 * NULL WHEN NOTHING CARRIES THE TAG, which the route turns into a 404: an empty
 * archive is worse than no archive, and a guessed tag confirms nothing. The
 * read-only role and the renderer policy keep a draft out, exactly as
 * listPublished next door, so this needs no status filter either.
 */
export async function listPublishedByTag(
  tenantId: string,
  collectionKey: string,
  tagSlug: string,
  limit: number,
): Promise<{ label: string; fields: FieldDef[]; items: PublishedItem[] } | null> {
  const capped = Math.min(MAX_LISTING_ITEMS, Math.max(1, Math.floor(limit) || 1));

  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select i.slug, i.data, i.published_at, c.fields
      from public.collection_items i
      join public.collections c on c.id = i.collection_id
      where c.key = ${collectionKey}
      order by i.published_at desc nulls last, i.id desc
    `;

    // The same schema listPublished returns, so an archive's cards carry the
    // same facts the listing they came from does rather than losing them on
    // the way to a tag page.
    const fields = parseFieldDefs(asObject((rows[0] as Record<string, unknown>)?.fields));
    let label = '';
    const items: PublishedItem[] = [];
    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      const item = hydrate(row.data, `${collectionKey}/${String(row.slug)}`);
      const match = item.tags.find((tag) => safeSlug(tag) === tagSlug);
      if (!match) continue;
      // The client's own spelling, from the first post that carries it.
      if (!label) label = match;
      items.push({
        slug: String(row.slug),
        item,
        publishedAt: row.published_at ? new Date(row.published_at as string) : null,
      });
      if (items.length >= capped) break;
    }

    return label ? { label, fields, items } : null;
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
): Promise<{ item: CollectionItem; fields: FieldDef[]; publishedAt: Date | null } | null> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select i.data, i.published_at, c.fields
      from public.collection_items i
      join public.collections c on c.id = i.collection_id
      where c.key = ${collectionKey} and i.slug = ${slug}
      limit 1
    `;
    if (!rows.length) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      item: hydrate(row.data, `${collectionKey}/${slug}`),
      // From the join that was already here, so an entry's own page shows its
      // facts without a second read, exactly as a listing's cards do.
      fields: parseFieldDefs(asObject(row.fields)),
      publishedAt: row.published_at ? new Date(row.published_at as string) : null,
    };
  });
}

/** One published entry's address, for the sitemap. */
export interface PublishedEntryPath {
  /** collectionKey/slug, which is exactly how a visitor reaches it. */
  path: string;
  updatedAt: string | null;
}

/**
 * Every published entry across every collection, as addresses.
 *
 * ONE QUERY FOR THE WHOLE SITE rather than one per collection, because a sitemap
 * wants all of them and a site with six collections should not be six round
 * trips to eu-west-2.
 *
 * NO STATUS FILTER, and no limit either. The renderer policy from migration 0004
 * is what makes a draft invisible here, exactly as it is in listPublished next
 * door. The cap that function carries is there because a listing block asks for a
 * screenful; a sitemap asks for everything, so a cap would silently truncate a
 * blog and nothing would say so. MAX_SITEMAP_URLS in lib/seo/sitemap.ts is where
 * the honest limit lives, and it logs what it dropped.
 */
export async function listAllPublishedEntries(
  tenantId: string,
): Promise<PublishedEntryPath[]> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select c.key, i.slug, coalesce(i.updated_at, i.published_at) as changed_at
      from public.collection_items i
      join public.collections c on c.id = i.collection_id
      order by changed_at desc nulls last
    `;

    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        path: `${String(row.key)}/${String(row.slug)}`,
        updatedAt: row.changed_at ? new Date(String(row.changed_at)).toISOString() : null,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Items, for the site's own search
// ---------------------------------------------------------------------------

/**
 * How many posts a search reads.
 *
 * A CAP, AND AN HONEST ONE. lib/content/search.ts reads the whole corpus on the
 * request and scores it in memory, which is the right trade for a travel site of
 * tens of pages. A blog is the one part of a site that is not tens of anything:
 * one post a week for five years is 260, and every one of them is read WITH ITS
 * BODY, which the sitemap's query next door is not. So there is a ceiling, it is
 * newest-first, and past it the oldest posts are not searchable.
 *
 * 500 was chosen as the number a real client will not reach: at 500 posts a
 * search that reads them all is roughly the size of a large photograph, still
 * comfortably inside a request, and a client past it has a blog big enough to
 * deserve a proper index rather than a bigger number here.
 */
export const MAX_SEARCH_ITEMS = 500;

/**
 * Every published post, reduced to the two things a search reads.
 *
 * WHY THIS EXISTS. Site search read `public.pages` and nothing else, so a
 * visitor searching a travel site for "Crete" was not shown the post about
 * Crete. Found on 20 Aug 2026 while checking the Duda list's "Search Posts"
 * against what we already had, and it is the same shape of fault as a link that
 * saves and never renders: the feature looks present, answers, and quietly
 * leaves half the site out of the answer.
 *
 * SAME LIVE RULE AS THE POST'S OWN PAGE, FOR FREE. No status filter and no
 * published_at filter, exactly as listPublished above: the renderer policy
 * (0004, tightened by 0020) hides a draft AND a post scheduled for next Tuesday
 * from this connection. So a search cannot surface a post a visitor could not
 * open, and nobody had to remember to make that true.
 *
 * THE PATH IS collectionKey/slug, with no leading slash, which is the SearchDoc
 * convention and exactly the address the published route resolves.
 *
 * NO noindex CHECK, unlike the pages read. A page has SEO of its own and can be
 * marked noindex; an item has none (see lib/content/collection.ts — the columns
 * hold what a page keeps in its tree). Nothing to honour, so nothing pretended.
 */
export async function listPublishedItemsForSearch(tenantId: string): Promise<SearchDoc[]> {
  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select c.key, i.slug, i.data, c.fields
      from public.collection_items i
      join public.collections c on c.id = i.collection_id
      order by i.published_at desc nulls last, i.id desc
      limit ${MAX_SEARCH_ITEMS}
    `;

    /*
     * One schema per collection, worked out once rather than per row.
     *
     * Every entry in a collection shares its definitions, so parsing them for
     * all five hundred rows would be the same work five hundred times. Keyed by
     * the collection key, which is what each row already carries.
     */
    const schemas = new Map<string, FieldDef[]>();

    return (rows as Array<Record<string, unknown>>).map((row) => {
      const key = String(row.key);
      const slug = String(row.slug);
      const item = hydrate(row.data, `${key}/${slug}`);
      if (!schemas.has(key)) schemas.set(key, parseFieldDefs(asObject(row.fields)));

      /*
       * The summary leads, then the article, then the byline and the tags.
       *
       * That order is about the snippet, not the score. searchDocs cuts its
       * snippet around the FIRST match, so putting the prose first means a
       * result almost always shows a readable sentence; a post found only by its
       * tag still ranks, it just shows the end of the text. The summary going
       * before the body is the schema's own intent: it calls it "the line under
       * the title in a listing, and the search description".
       *
       * Tags and author are in there because a reader searching "Crete" should
       * find a post filed under Crete even if the words never appear in it, and
       * because "posts by Sarah" is a search people actually do.
       */
      const body = pageText(item, 8000);
      /*
       * The declared facts go in as "Board Half board", label and value both.
       *
       * BOTH HALVES, because people search either way: "half board" is the
       * value and "board basis" is close to the label, and a tour that answers
       * one should be found by the other. Formatted rather than raw, so a
       * price is searchable as £1,299 the way it is shown, and an unanswered
       * field contributes nothing at all.
       *
       * LAST, after the prose, for the same reason the tags are: searchDocs
       * cuts its snippet around the first match, so a result almost always
       * shows a readable sentence rather than a row of numbers.
       */
      const declared = fieldFacts(schemas.get(key) ?? [], item.fields)
        .map((fact) => `${fact.label} ${fact.value}`)
        .join(' ');
      const extras = [item.author, ...item.tags, declared].filter(Boolean).join(' ');
      const text = [item.summary, body, extras].filter(Boolean).join('\n');

      return {
        path: `${key}/${slug}`,
        title: item.title,
        text,
      };
    });
  });
}
