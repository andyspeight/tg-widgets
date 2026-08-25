'use server';

/**
 * The image bank: listing, recording an upload, importing a photo, tidying up.
 *
 * Same rules as every other action here. The tenant comes from the session and
 * never from an argument, and everything a caller sends is a suggestion.
 *
 * TWO THINGS IN THIS FILE ARE UNUSUAL AND BOTH ARE DELIBERATE
 *
 * There is no action that accepts image bytes. The upload goes from the browser
 * straight to the blob store, and the server's only part in it is minting a
 * short-lived token (app/api/media/upload/route.ts) and then recording what
 * happened. A serverless function has a 4.5MB request body limit, so any path
 * that carried the file through the server would refuse a photograph off a modern
 * phone. The widget suite hit this and solved it the same way in
 * api/upload-photo.js.
 *
 * And recordUploadAction does not believe the browser. It asks the store what it
 * actually holds and records that, because the browser is the one participant in
 * this flow whose claims nobody else witnessed.
 */

import { revalidatePath } from 'next/cache';

import { requireTenantId } from '../../lib/auth/session';
import {
  deleteMedia,
  findImportedProviderIds,
  getMediaItem,
  insertMedia,
  listMedia,
  setMediaAlt,
  setMediaVariants,
} from '../../lib/db/media';
import { blobConfigured, describeBlob, removeBlob } from '../../lib/media/blob';
import {
  assertPathnameForTenant,
  cleanFilename,
  MAX_UPLOAD_BYTES,
  type MediaKind,
  mediaKind,
  MEDIA_MIME,
  pixelDimension,
  plainText as text,
  tenantPrefix,
} from '../../lib/media/limits';
import {
  ORIENTATIONS,
  pexelsConfigured,
  searchPexels,
  type Orientation,
} from '../../lib/media/pexels';
import { importStockPhoto } from '../../lib/media/stock';
import type { MediaItem, MediaVariant, StockPhoto } from '../../lib/media/types';

export type MediaResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Opening the bank
// ---------------------------------------------------------------------------

export interface MediaPage {
  items: MediaItem[];
  hasMore: boolean;
  /** False when no blob store is connected, so the upload tab can say so. */
  canUpload: boolean;
  /** False when there is no Pexels key, so the photo tab can say so. */
  canSearchStock: boolean;
  /**
   * The prefix the browser must upload under.
   *
   * The store's client SDK needs a full pathname, and the browser has no other way
   * to know this tenant's id. Sending it is safe and is not the check: the token
   * route recomputes the prefix from the SESSION and refuses to mint a token for
   * anything outside it, so a browser that edits this value gets a refusal rather
   * than somebody else's storage. This exists so that an HONEST browser can build
   * a pathname that will be accepted.
   */
  uploadPrefix: string;
}

/**
 * One page of the bank, plus what this deployment can actually do.
 *
 * The two capability flags ride along with the listing rather than coming from a
 * second call. They cost nothing, they are needed at exactly the moment the
 * picker opens, and the alternative is either an extra round trip before the
 * dialog can draw itself or threading two booleans down through the whole editor
 * from a server component.
 */
export async function loadMediaAction(
  offset = 0,
  /*
   * Which half of the library to show. Undefined is everything, which is what
   * the settings screens and the duplicate path want; the picker passes 'image'
   * or 'file' so a client choosing a brochure is not scrolling past four hundred
   * photographs to find it. Narrowed to the two known words here rather than
   * passed through, because this argument crosses the wire from a browser.
   */
  kind?: MediaKind,
): Promise<MediaResult<MediaPage>> {
  try {
    const tenantId = await requireTenantId();
    const wanted = kind === 'image' || kind === 'file' ? kind : undefined;
    const { items, hasMore } = await listMedia(tenantId, { offset, kind: wanted });
    return {
      ok: true,
      data: {
        items,
        hasMore,
        canUpload: blobConfigured(),
        canSearchStock: pexelsConfigured(),
        uploadPrefix: tenantPrefix(tenantId),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: explain(error, kind === 'file' ? 'Could not open your files.' : 'Could not open your images.'),
    };
  }
}

// ---------------------------------------------------------------------------
// Recording an upload
// ---------------------------------------------------------------------------

/**
 * The URL shape a blob store hands back.
 *
 * Checked before the URL is used for anything, because this value arrives from
 * the browser and the next thing that happens to it is a server-side fetch. A
 * store URL is `https://<store>.public.blob.vercel-storage.com/<pathname>`, so
 * the host is what pins it down.
 */
const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^\s]+$/i;

export interface RecordUpload {
  /** The URL the store returned to the browser. */
  url: string;
  /** The original filename, for the listing. */
  filename?: string;
  /** Alt text, if the person typed it before the upload finished. */
  alt?: string;
  /** Pixel dimensions the browser measured on the way past. */
  width?: number;
  height?: number;
  /**
   * Smaller copies the browser encoded and uploaded alongside the primary.
   *
   * Claims, not facts, exactly like every other field here. Each one is checked
   * against the store before it is recorded.
   */
  variants?: Array<{ url?: string; width?: number; height?: number }>;
}

/**
 * The variants, checked the same way the primary is.
 *
 * SAME THREE CHECKS, AND FOR THE SAME REASONS. A variant url is a string a
 * browser sent, so it gets the store-url shape test, the store is asked what it
 * actually holds, and the pathname has to sit under this tenant's prefix. A
 * variant that fails any of them is DROPPED rather than raised: the primary is
 * already good, and the cost of dropping one is some extra bytes for a visitor,
 * where the cost of throwing is somebody losing an upload that actually worked.
 *
 * Width and height come from the browser because they are measurements the store
 * never made, the same reason the primary's do. The byte count comes from the
 * store, because the store is the one that knows.
 *
 * Bounded, so a crafted request cannot make this loop over a thousand
 * describeBlob calls.
 */
const MAX_VARIANTS = 6;

async function verifiedVariants(
  claimed: RecordUpload['variants'],
  tenantId: string,
  primaryUrl: string,
): Promise<MediaVariant[]> {
  if (!Array.isArray(claimed)) return [];

  const out: MediaVariant[] = [];
  const seen = new Set<string>([primaryUrl]);

  for (const raw of claimed.slice(0, MAX_VARIANTS)) {
    const url = String(raw?.url ?? '');
    const width = pixelDimension(raw?.width);
    const height = pixelDimension(raw?.height);

    if (!url || seen.has(url) || !BLOB_URL.test(url) || !width || !height) continue;

    try {
      const stored = await describeBlob(url);
      if (!stored) continue;
      // Throws for anything outside this tenant's prefix.
      assertPathnameForTenant(stored.pathname, tenantId);
      if (stored.size > MAX_UPLOAD_BYTES) continue;

      seen.add(url);
      out.push({ url, width, height, bytes: stored.size });
    } catch {
      // Not this tenant's, or the store could not answer. Dropped silently: the
      // picture still works, it just has one fewer size.
    }
  }

  return out.sort((a, b) => a.width - b.width);
}

/**
 * Write the row for an object that is already in the store.
 *
 * WHY THIS IS AN ACTION AND NOT THE STORE'S UPLOAD-COMPLETED WEBHOOK
 *
 * The blob SDK offers onUploadCompleted, a signed server-to-server callback, and
 * it is the more robust design on paper: it fires even if the browser is closed
 * the instant the upload finishes. It also cannot reach a development machine,
 * because the callback comes from the internet and localhost is not on it. That
 * means the recording step would be untestable anywhere except production, for a
 * feature whose whole job is to record things. The browser calling back is
 * testable everywhere and gives up very little: the failure mode is an object in
 * the store with no row, which is invisible and costs pennies.
 *
 * THREE CHECKS, AND WHAT EACH ONE IS FOR
 *
 * The URL has to look like a store URL, so this cannot be turned into a
 * general-purpose fetch of anything by anybody with a session.
 *
 * The store is asked what it holds, and its answer is what gets recorded. Size
 * and content type both come from there, so a browser claiming a small JPEG while
 * having uploaded something else produces a row describing what is really there.
 *
 * The pathname the store reports has to sit under this tenant's prefix. The token
 * route already refused to mint a token for anything else, so this is the second
 * of two; it is here because the first one guards a different request, and a
 * check that exists once guards one path.
 */
export async function recordUploadAction(input: RecordUpload): Promise<MediaResult<MediaItem>> {
  try {
    const tenantId = await requireTenantId();

    const url = String(input?.url ?? '');
    if (!BLOB_URL.test(url)) {
      return { ok: false, error: 'That is not an uploaded file.' };
    }

    const stored = await describeBlob(url);
    if (!stored) {
      return {
        ok: false,
        error:
          'That upload did not arrive. Try again, and if it keeps failing the file may not be a type we can serve.',
      };
    }

    // Throws if the object is not under this tenant's prefix.
    assertPathnameForTenant(stored.pathname, tenantId);

    /*
     * The kind is worked out from what the STORE says it holds, never from what
     * the browser claimed. It only decides wording and a filename fallback here,
     * but reading it off the browser's word would be the habit that eventually
     * decides something that matters.
     */
    const kind = mediaKind(stored.contentType);

    if (stored.size > MAX_UPLOAD_BYTES) {
      // The object is in the store and is too big to keep, so it goes. Leaving it
      // would be an orphan nothing can reach and nothing will tidy.
      await removeBlob(url);
      return {
        ok: false,
        // A document is not downscaled on its way past, so 15MB is a real wall
        // rather than one a photograph would have been shrunk under. Say so.
        error:
          kind === 'file'
            ? 'That file is larger than 15MB. Try a smaller export.'
            : 'That image is larger than 15MB.',
      };
    }

    const item = await insertMedia(tenantId, {
      storageKey: stored.pathname,
      url,
      filename: cleanFilename(input?.filename, `${kind}.${MEDIA_MIME[stored.contentType]}`),
      mime: stored.contentType,
      bytes: stored.size,
      width: pixelDimension(input?.width),
      height: pixelDimension(input?.height),
      alt: text(input?.alt, 300),
      source: 'upload',
      credit: {},
      /*
       * Only for images. A document has no sizes, and a browser claiming
       * otherwise should not cause a single describeBlob call.
       */
      variants: kind === 'file' ? [] : await verifiedVariants(input?.variants, tenantId, url),
    });

    revalidatePath('/', 'layout');
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not save that upload.') };
  }
}

// ---------------------------------------------------------------------------
// The photo library
// ---------------------------------------------------------------------------

export interface StockResults {
  photos: StockPhoto[];
  page: number;
  hasMore: boolean;
  total: number;
  /**
   * Provider ids this tenant already has, so the grid can mark them.
   *
   * Worth the extra query: a person searching "santorini" three times over a
   * fortnight has no other way to know they already imported the third result,
   * and a duplicate costs storage and shows up twice in the bank.
   */
  alreadyImported: string[];
}

export async function searchStockAction(input: {
  query?: string;
  page?: number;
  orientation?: string | null;
}): Promise<MediaResult<StockResults>> {
  try {
    const tenantId = await requireTenantId();

    const orientation =
      typeof input?.orientation === 'string' &&
      (ORIENTATIONS as readonly string[]).includes(input.orientation)
        ? (input.orientation as Orientation)
        : null;

    const [results, imported] = await Promise.all([
      searchPexels({
        query: String(input?.query ?? ''),
        page: Number(input?.page ?? 1),
        orientation,
      }),
      findImportedProviderIds(tenantId, 'pexels'),
    ]);

    return {
      ok: true,
      data: {
        photos: results.photos,
        page: results.page,
        hasMore: results.hasMore,
        total: results.total,
        alreadyImported: [...imported],
      },
    };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not search the photo library.') };
  }
}

/**
 * Copy a library photo into this tenant's own storage and bank.
 *
 * COPIED, NOT LINKED, and that is the decision worth defending. Linking is free
 * and Pexels permits it. It also means a client's hero image is a URL on somebody
 * else's CDN, pointing at a file a photographer can delete, on a site nobody is
 * watching. A few hundred kilobytes is a small price for a published page that
 * depends on nothing but our own store.
 *
 * The whole StockPhoto is passed rather than a URL, and importableUrl re-checks it
 * against the provider's own image host. That check is not ceremony: the next
 * thing that happens is a server-side fetch of that URL, so without it this action
 * is an open proxy for anybody with a session.
 */
export async function importStockAction(photo: StockPhoto): Promise<MediaResult<MediaItem>> {
  try {
    const tenantId = await requireTenantId();

    if (!blobConfigured()) {
      return {
        ok: false,
        error:
          'Image storage is not connected yet, so photos cannot be saved. ' +
          'Add a Blob store to this project in Vercel and redeploy.',
      };
    }

    // The import itself lives in lib/media/stock.ts, shared with the photo
    // fill that runs during a starter or template build. This action is the
    // session-facing door: it resolves the tenant and turns a throw into a
    // sentence.
    const item = await importStockPhoto(tenantId, photo);

    revalidatePath('/', 'layout');
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not add that photo.') };
  }
}

// ---------------------------------------------------------------------------
// Editing and removing
// ---------------------------------------------------------------------------

/**
 * Attach smaller copies to a picture that is already in the bank.
 *
 * THE BACKFILL'S ONLY WRITE. Variants are encoded in the browser, so a picture
 * uploaded before that existed has none: 30 images on the live database the day
 * the feature shipped, 30 without. The srcset work was live and doing nothing for
 * any existing page. The picker re-encodes them the same way an upload does and
 * calls this once per picture.
 *
 * EVERY VARIANT IS CHECKED AGAINST THE STORE, through the same verifiedVariants
 * the upload path uses. That is the rule this file already keeps and it applies
 * with more force here, not less: this call names a row that already exists and
 * says what its pictures are, so believing the browser would let a session point
 * a client's image at anything shaped like a store url.
 *
 * REFUSES TO OVERWRITE. A picture that already has copies is left exactly as it
 * is. The backfill plans around those anyway, so reaching this means two runs
 * overlapped or a request was replayed, and in both cases the copies already
 * recorded are the ones the store actually holds.
 */
export async function recordVariantsAction(
  id: string,
  variants: RecordUpload['variants'],
): Promise<MediaResult<MediaItem | null>> {
  try {
    const tenantId = await requireTenantId();

    const existing = await getMediaItem(tenantId, String(id ?? ''));
    if (!existing) return { ok: false, error: 'That picture is not in this bank.' };
    if (existing.variants.length > 0) return { ok: true, data: existing };

    const checked = await verifiedVariants(variants, tenantId, existing.url);
    if (checked.length === 0) {
      return {
        ok: false,
        error: 'None of those smaller copies arrived in the store, so nothing was recorded.',
      };
    }

    const saved = await setMediaVariants(tenantId, existing.id, checked);
    revalidatePath('/', 'layout');
    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not record those smaller copies.') };
  }
}

export async function setMediaAltAction(
  id: string,
  alt: string,
): Promise<MediaResult<MediaItem | null>> {
  try {
    const tenantId = await requireTenantId();
    const item = await setMediaAlt(tenantId, String(id ?? ''), text(alt, 300));
    if (item) revalidatePath('/', 'layout');
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not save that description.') };
  }
}

/**
 * Remove an image from the bank, and then from the store.
 *
 * THAT ORDER MATTERS. The row goes first, inside a policy-scoped transaction, and
 * the object only after the row is definitely gone. Deleting the object first and
 * then failing to delete the row would leave a live page pointing at a picture
 * that no longer loads. This way round, the worst case is bytes in a store with
 * nothing referring to them.
 *
 * Note what this does NOT do: it does not go through the pages of the site looking
 * for uses. A published page holds the URL it was published with, so removing an
 * image from the bank does not silently blank a live page, and a draft that used
 * it will show a missing picture the next time somebody opens it. Rewriting
 * content on a delete is not undoable, and this is.
 */
export async function deleteMediaAction(id: string): Promise<MediaResult<{ id: string }>> {
  try {
    const tenantId = await requireTenantId();

    const removed = await deleteMedia(tenantId, String(id ?? ''));
    if (!removed) {
      // Also the answer for another tenant's id. Same answer on purpose: a
      // guessed id confirms nothing.
      return { ok: false, error: 'That image is not in your library.' };
    }

    await removeBlob(removed.url);

    revalidatePath('/', 'layout');
    return { ok: true, data: { id: String(id) } };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not remove that image.') };
  }
}

// ---------------------------------------------------------------------------

function explain(error: unknown, generic: string): string {
  const message = error instanceof Error ? error.message : String(error);

  // Worth showing as written: each of these names something a person can act on.
  if (message.startsWith('Your session has ended')) return message;
  if (message.startsWith('This account is not a member')) return message;
  if (message.startsWith('Image storage is not connected')) return message;
  if (message.startsWith('The photo library')) return message;
  if (message.includes('does not belong to this site')) return message;
  if (message.includes('is too large')) return message;
  if (message.includes('could not be fetched')) return message;
  if (message.includes('came back empty')) return message;

  console.error('[tg-sites] media action failed', error);
  return generic;
}
