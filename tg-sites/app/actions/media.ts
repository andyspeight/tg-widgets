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
  insertMedia,
  listMedia,
  setMediaAlt,
} from '../../lib/db/media';
import { blobConfigured, copyIntoStore, describeBlob, removeBlob } from '../../lib/media/blob';
import {
  assertPathnameForTenant,
  cleanFilename,
  filenameStem,
  MAX_UPLOAD_BYTES,
  MEDIA_MIME,
  pixelDimension,
  plainText as text,
  tenantPrefix,
} from '../../lib/media/limits';
import {
  importableUrl,
  ORIENTATIONS,
  pexelsConfigured,
  searchPexels,
  type Orientation,
} from '../../lib/media/pexels';
import type { MediaItem, StockPhoto } from '../../lib/media/types';

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
export async function loadMediaAction(offset = 0): Promise<MediaResult<MediaPage>> {
  try {
    const tenantId = await requireTenantId();
    const { items, hasMore } = await listMedia(tenantId, { offset });
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
    return { ok: false, error: explain(error, 'Could not open your images.') };
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
      return { ok: false, error: 'That is not an uploaded image.' };
    }

    const stored = await describeBlob(url);
    if (!stored) {
      return {
        ok: false,
        error: 'That upload did not arrive. Try again, and if it keeps failing the file may not be an image.',
      };
    }

    // Throws if the object is not under this tenant's prefix.
    assertPathnameForTenant(stored.pathname, tenantId);

    if (stored.size > MAX_UPLOAD_BYTES) {
      // The object is in the store and is too big to keep, so it goes. Leaving it
      // would be an orphan nothing can reach and nothing will tidy.
      await removeBlob(url);
      return { ok: false, error: 'That image is larger than 15MB.' };
    }

    const item = await insertMedia(tenantId, {
      storageKey: stored.pathname,
      url,
      filename: cleanFilename(input?.filename, `image.${MEDIA_MIME[stored.contentType]}`),
      mime: stored.contentType,
      bytes: stored.size,
      width: pixelDimension(input?.width),
      height: pixelDimension(input?.height),
      alt: text(input?.alt, 300),
      source: 'upload',
      credit: {},
    });

    revalidatePath('/', 'layout');
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not save that image.') };
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

    // Throws unless the URL is on the provider's image host.
    const source = importableUrl(photo);

    const description = text(photo?.description, 300);
    const stem = filenameStem(description || `pexels-${String(photo?.id ?? 'photo')}`);
    const stored = await copyIntoStore(
      source,
      `${tenantPrefix(tenantId)}${stem}.jpg`,
      MAX_UPLOAD_BYTES,
    );

    const item = await insertMedia(tenantId, {
      storageKey: stored.pathname,
      url: stored.url,
      filename: `${stem}.${MEDIA_MIME[stored.contentType]}`,
      mime: stored.contentType,
      bytes: stored.size,
      width: pixelDimension(photo?.width),
      height: pixelDimension(photo?.height),
      /*
       * The provider's own description becomes the starting alt text.
       *
       * It is a real description of the picture, written by somebody who looked
       * at it, and it is very much better than the empty string a person in a
       * hurry leaves behind. Editable afterwards, because "Brown Rocks During
       * Golden Hour" is accurate and says nothing about why the picture is on
       * this page.
       */
      alt: description,
      source: 'pexels',
      credit: {
        photographer: photo?.credit?.photographer,
        photographerUrl: photo?.credit?.photographerUrl,
        providerUrl: photo?.credit?.providerUrl,
        providerId: photo?.credit?.providerId,
      },
    });

    revalidatePath('/', 'layout');
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not add that photo.') };
  }
}

// ---------------------------------------------------------------------------
// Editing and removing
// ---------------------------------------------------------------------------

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
