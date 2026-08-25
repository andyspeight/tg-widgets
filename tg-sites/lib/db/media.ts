/**
 * The image bank: the rows, not the bytes.
 *
 * The pictures themselves live in a blob store and are served by its CDN. What
 * this table holds is which images belong to which client, what each one is
 * called, how big it is, its alt text and, for anything imported from a library,
 * who took it. That list is worth scoping even though the images are public: one
 * travel agency being able to enumerate another's photography is a leak whatever
 * the pictures are.
 *
 * Everything goes through withTenant or withPublicTenant, so the policies do the
 * scoping and there is no WHERE tenant_id in this file to get wrong.
 */

import 'server-only';

import {
  ALLOWED_DOCUMENT_MIME,
  ALLOWED_IMAGE_MIME,
  isAllowedMime,
  type MediaKind,
  type MediaMime,
} from '../media/limits';
import type { ImageSizes } from '../content/image-sizes';
import type { MediaCredit, MediaItem, MediaSource, MediaVariant } from '../media/types';
import { withPublicTenant, withTenant, type Tx } from './withTenant';

/**
 * The driver's json() wrapper, with the one cast it needs.
 *
 * Same helper as lib/db/theme.ts and lib/db/pages.ts, for the same reason:
 * postgres types the parameter as an index-signature shape and TypeScript will
 * not accept a concrete interface as one even when every value inside is plain
 * JSON.
 */
function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

/**
 * jsonb back out, tolerating a double-encoded value.
 *
 * Same guard as every other jsonb read here. A value written with
 * JSON.stringify instead of the driver's json() comes back as a quoted string,
 * and that bug lost a page's content once already.
 */
function asCredit(value: unknown): MediaCredit {
  if (typeof value === 'string') {
    try {
      return asCredit(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const raw = value as Record<string, unknown>;
  const pick = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : undefined);

  return {
    photographer: pick('photographer'),
    photographerUrl: pick('photographerUrl'),
    providerUrl: pick('providerUrl'),
    providerId: pick('providerId'),
  };
}

/**
 * The variants column, read without trusting it.
 *
 * jsonb is free-form as far as Postgres is concerned, and this value was written
 * from a browser upload months ago and may have been anything since. Anything
 * that is not a usable {url,width,height} is dropped rather than repaired: a
 * variant with a bad width would be served to the wrong screen, and no variant
 * at all merely costs bytes.
 */
function asVariants(value: unknown): MediaVariant[] {
  if (!Array.isArray(value)) return [];

  const out: MediaVariant[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    const url = typeof v.url === 'string' ? v.url : '';
    const width = Number(v.width);
    const height = Number(v.height);
    if (!url || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) continue;
    out.push({ url, width: Math.round(width), height: Math.round(height), bytes: Number(v.bytes) || 0 });
  }
  // Ascending, so a caller can build an srcset by walking it.
  return out.sort((a, b) => a.width - b.width);
}

function toItem(row: Record<string, unknown>): MediaItem {
  return {
    id: String(row.id),
    url: String(row.url),
    storageKey: String(row.storage_key),
    filename: String(row.filename),
    mime: isAllowedMime(row.mime) ? row.mime : 'image/jpeg',
    bytes: Number(row.bytes),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    alt: row.alt == null ? '' : String(row.alt),
    source: row.source === 'pexels' ? 'pexels' : 'upload',
    credit: asCredit(row.credit),
    variants: asVariants(row.variants),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The bank, newest first.
 *
 * Paged, because this is the one table in the schema with no natural ceiling: a
 * tenant has one theme and a handful of fonts, and will have hundreds of images
 * within a year. The index on (tenant_id, created_at desc) exists for this query.
 *
 * Returns one more row than asked for and reports it as `hasMore`, rather than
 * running a second COUNT. The picker only needs to know whether to show another
 * page, and a count over a growing table to answer a yes-or-no question is work
 * nobody sees.
 */
export async function listMedia(
  tenantId: string,
  options: { limit?: number; offset?: number; kind?: MediaKind } = {},
): Promise<{ items: MediaItem[]; hasMore: boolean }> {
  const limit = Math.min(120, Math.max(1, Math.round(options.limit ?? 48)));
  const offset = Math.max(0, Math.round(options.offset ?? 0));

  /*
   * FILTERED IN SQL, not after the read, and that is not a micro-optimisation.
   * The paging is `limit + 1` to work out hasMore; filtering the page after it
   * came back would give a page of four items claiming there are more, and a
   * "Load more" that returns the same four.
   *
   * The list of types is ours, from lib/media/limits.ts, never anything a
   * caller typed. There is no kind COLUMN because the mime already says which a
   * row is, and a column would be a second copy that can disagree with it.
   */
  const mimes: string[] | null =
    options.kind === 'image'
      ? [...ALLOWED_IMAGE_MIME]
      : options.kind === 'file'
        ? [...ALLOWED_DOCUMENT_MIME]
        : null;

  return withTenant(tenantId, async (tx) => {
    const rows = mimes
      ? await tx`
          select id, url, storage_key, filename, mime, bytes, variants,
                 width, height, alt, source, credit, created_at
          from public.media
          where mime = any(${mimes})
          order by created_at desc, id desc
          limit ${limit + 1} offset ${offset}
        `
      : await tx`
          select id, url, storage_key, filename, mime, bytes, variants,
                 width, height, alt, source, credit, created_at
          from public.media
          order by created_at desc, id desc
          limit ${limit + 1} offset ${offset}
        `;

    const items = rows.slice(0, limit).map((row) => toItem(row as Record<string, unknown>));
    return { items, hasMore: rows.length > limit };
  });
}

/**
 * Every image a site has, oldest first, for copying the whole bank at once.
 *
 * Unpaged, unlike listMedia, and that is the point: a duplicate copies all of a
 * site's pictures or none of them, and a caller that had to page could copy a
 * library out from under itself as rows shifted between pages. A duplicate is a
 * rare, staff-run action, so reading the bank into memory once is the right
 * trade where the paged picker would be wrong.
 */
export async function listAllMedia(tenantId: string): Promise<MediaItem[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, url, storage_key, filename, mime, bytes, variants,
             width, height, alt, source, credit, created_at
      from public.media
      order by created_at, id
    `;
    return rows.map((row) => toItem(row as Record<string, unknown>));
  });
}

/**
 * One image, for the renderer.
 *
 * Read through the READ-ONLY role, because the caller is painting a published
 * page for somebody with no session. A page's image block stores a media id, and
 * this is what turns it into a URL and alt text.
 *
 * The id is checked here rather than trusted from the content. A malformed one
 * would reach Postgres as a failed uuid cast, which is a server error instead of
 * a missing picture.
 */
export async function getPublicMedia(
  tenantId: string,
  id: string,
): Promise<MediaItem | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, url, storage_key, filename, mime, bytes, variants,
             width, height, alt, source, credit, created_at
      from public.media where id = ${id} limit 1
    `;
    return rows.length ? toItem(rows[0] as Record<string, unknown>) : null;
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface NewMedia {
  /** The object's address in the store, as the store reported it. */
  storageKey: string;
  /** The public URL, as the store reported it. */
  url: string;
  filename: string;
  mime: MediaMime;
  bytes: number;
  width: number | null;
  height: number | null;
  alt: string;
  source: MediaSource;
  credit: MediaCredit;
  /**
   * Smaller copies, already uploaded and already verified against the store by
   * the caller. Optional: a stock import and any older caller has none.
   */
  variants?: MediaVariant[];
}

/**
 * Record an image that is already in the store.
 *
 * The order is deliberate and is the opposite of the delete path: the object goes
 * up first and the row is written second. An object with no row is invisible and
 * costs pennies. A row with no object is a broken picture on a client's live site.
 * So whichever way a failure lands, it lands on the harmless side.
 *
 * ON CONFLICT on (tenant_id, storage_key) rather than a plain insert, because the
 * browser can retry the recording step after a dropped connection and the same
 * object must not produce two rows. The store's random suffix means a genuine
 * second upload of the same file has a different key and is a different row, which
 * is right: somebody uploading the same photograph twice on purpose gets two.
 */
/**
 * Every stored size of each of these pictures, for a page that is about to render.
 *
 * ONE QUERY FOR THE WHOLE PAGE, not one per image. A homepage can carry twenty
 * pictures and this runs on every published page view, so a per-image lookup
 * would be twenty round trips to eu-west-2 inside the request a visitor is
 * waiting on.
 *
 * THE PRIMARY IS IN THE RESULT, as the largest candidate. The column holds only
 * the smaller copies, because that is what it is for, but a srcset needs every
 * candidate including the full-size one, and building it here means the renderer
 * never has to know that the row's own url is a special case.
 *
 * Through the READ-ONLY role, like everything else a visitor's request touches.
 * A url that belongs to another tenant simply does not come back: the policy
 * makes "no such image" and "not yours" the same answer.
 *
 * Bounded. A tree with a thousand image URLs is a malformed page rather than a
 * real one, and this is not the place to find that out slowly.
 */
const MAX_IMAGE_LOOKUP = 200;

export async function imageSizesForUrls(
  tenantId: string,
  urls: readonly string[],
): Promise<ImageSizes> {
  const wanted = [...new Set(urls.filter((u) => typeof u === 'string' && u !== ''))].slice(
    0,
    MAX_IMAGE_LOOKUP,
  );
  if (wanted.length === 0) return {};

  return withPublicTenant(tenantId, async (tx) => {
    const rows = await tx`
      select url, width, height, bytes, variants
        from public.media
       where url = any(${wanted as string[]})
    `;

    const out: ImageSizes = {};
    for (const raw of rows as Record<string, unknown>[]) {
      const url = String(raw.url);
      const width = raw.width == null ? 0 : Number(raw.width);
      const height = raw.height == null ? 0 : Number(raw.height);

      const sizes = asVariants(raw.variants);
      // The row's own file, as the largest candidate. Skipped when the row never
      // recorded its dimensions, because a candidate with no width is useless in
      // a srcset and a guessed one would be worse.
      if (width > 0 && height > 0) {
        sizes.push({ url, width, height, bytes: Number(raw.bytes) || 0 });
      }

      if (sizes.length > 1) out[url] = sizes.sort((a, b) => a.width - b.width);
    }

    return out;
  });
}

/**
 * Attach smaller copies to a picture that is already in the bank.
 *
 * SEPARATE FROM insertMedia because this is the backfill's path, not an upload's.
 * An upload knows every fact about the row at once; this knows one, and going
 * through the insert would mean reconstructing the rest from a client's word to
 * write it straight back over itself.
 *
 * The caller has already checked every url against the store and against this
 * tenant's prefix. Scoped to the tenant here as well, so a wrong id changes
 * nothing rather than another client's row.
 */
export async function setMediaVariants(
  tenantId: string,
  id: string,
  variants: readonly MediaVariant[],
): Promise<MediaItem | null> {
  // Same shape check the other single-row readers do, and for the same reason:
  // a malformed id is a bad request, not a database error, and Postgres raises
  // on a cast it cannot make.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.media
         set variants = ${json(tx, variants as MediaVariant[])}
       where id = ${id}
      returning id, url, storage_key, filename, mime, bytes, variants,
                width, height, alt, source, credit, created_at
    `;
    return rows.length ? toItem(rows[0] as Record<string, unknown>) : null;
  });
}

export async function insertMedia(tenantId: string, media: NewMedia): Promise<MediaItem> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      insert into public.media
        (tenant_id, storage_key, url, filename, mime, bytes, width, height, alt, source, credit, variants)
      values (
        ${tenantId}, ${media.storageKey}, ${media.url}, ${media.filename},
        ${media.mime}, ${media.bytes}, ${media.width}, ${media.height},
        ${media.alt}, ${media.source}, ${json(tx, media.credit)}, ${json(tx, media.variants ?? [])}
      )
      on conflict (tenant_id, storage_key) do update
        set url = excluded.url,
            filename = excluded.filename,
            mime = excluded.mime,
            bytes = excluded.bytes,
            width = excluded.width,
            height = excluded.height,
            alt = excluded.alt,
            source = excluded.source,
            credit = excluded.credit,
            variants = excluded.variants
      returning id, url, storage_key, filename, mime, bytes, variants,
                width, height, alt, source, credit, created_at
    `;
    return toItem(rows[0] as Record<string, unknown>);
  });
}

/**
 * One image, by id, scoped to this tenant.
 *
 * SEPARATE FROM listMedia because the caller that needs it, the alt text
 * assistant, has an id and wants one row. Reading the whole bank to find one
 * picture would be a query that grows with the client's library every time
 * somebody presses a button.
 *
 * The uuid shape is checked before the query for the same reason setMediaAlt
 * does it: a malformed id is a bad request, not a database error, and Postgres
 * raises on a cast it cannot make.
 *
 * Null covers "no such image" AND "belongs to another tenant", because the
 * policy makes them the same answer and a guessed id should confirm nothing.
 */
export async function getMediaItem(
  tenantId: string,
  id: string,
): Promise<MediaItem | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, url, storage_key, filename, mime, bytes, variants,
             width, height, alt, source, credit, created_at
      from public.media where id = ${id} limit 1
    `;
    return rows.length ? toItem(rows[0] as Record<string, unknown>) : null;
  });
}

/**
 * Change the alt text.
 *
 * The only editable field, on purpose. A filename is a record of what arrived and
 * renaming it would make the bank disagree with what somebody uploaded; the size
 * and dimensions are facts about the object; and the credit is a licensing term,
 * not a preference. Alt text is the one thing a person genuinely needs to be able
 * to improve later.
 */
export async function setMediaAlt(
  tenantId: string,
  id: string,
  alt: string,
): Promise<MediaItem | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      update public.media set alt = ${alt} where id = ${id}
      returning id, url, storage_key, filename, mime, bytes, variants,
                width, height, alt, source, credit, created_at
    `;
    return rows.length ? toItem(rows[0] as Record<string, unknown>) : null;
  });
}

/**
 * Remove an image, returning its storage key so the object can go too.
 *
 * THE ROW GOES FIRST. That is why this returns the key rather than deleting the
 * object itself: the caller removes the row inside a scoped transaction, and only
 * then asks the store to drop the bytes. If the store call fails, the result is an
 * orphaned object nobody can see. If it were the other way round, a failure would
 * leave a row pointing at a picture that no longer loads, on a published page.
 *
 * Null when there was nothing to remove, which for a policy-scoped delete also
 * covers "belongs to another tenant". Those are the same answer on purpose: a
 * guessed id should confirm nothing.
 */
export async function deleteMedia(
  tenantId: string,
  id: string,
): Promise<{ storageKey: string; url: string; variants: MediaVariant[] } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      delete from public.media where id = ${id} returning storage_key, url, variants
    `;
    if (!rows.length) return null;
    const row = rows[0] as Record<string, unknown>;
    /*
     * The variants come back too, because the row is the only record of where
     * they are. Once it is gone their addresses are unrecoverable and the objects
     * sit in the store forever, paid for and unreachable.
     */
    return {
      storageKey: String(row.storage_key),
      url: String(row.url),
      variants: asVariants(row.variants),
    };
  });
}

/**
 * Whether this tenant already imported a given library photo.
 *
 * So the Pexels grid can mark what is already in the bank. Cheap: the credit
 * column is jsonb and this reads one key out of it, over a table already scoped
 * to one tenant.
 */
export async function findImportedProviderIds(
  tenantId: string,
  source: MediaSource,
): Promise<Set<string>> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select credit ->> 'providerId' as provider_id
      from public.media
      where source = ${source} and credit ? 'providerId'
    `;
    const ids = new Set<string>();
    for (const row of rows) {
      const value = (row as Record<string, unknown>).provider_id;
      if (typeof value === 'string' && value) ids.add(value);
    }
    return ids;
  });
}
