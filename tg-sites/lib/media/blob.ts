/**
 * The only place the blob store is touched.
 *
 * Four functions, all thin. That is the whole point of the file: neither
 * blob.vercel-storage.com nor api.pexels.com is reachable from the environment
 * this was written in, so the code that cannot be run here is confined to one
 * place and everything around it is pure and tested. When the first upload
 * happens in production and something is wrong, this is the file to look at, and
 * it is short enough to read in one go.
 *
 * WHY VERCEL BLOB AND NOT SUPABASE STORAGE
 *
 * Reaching Supabase Storage from the server needs a service_role key, which
 * bypasses row level security completely. lib/db/client.ts exists to keep that
 * credential out of this application, and adding it back to hold some JPEGs
 * would undo the property db/isolation-check.sql proves. A blob store token can
 * write blobs and cannot see the database at all. The full reasoning is in
 * db/migrations/0011_media.sql.
 */

import 'server-only';

import { del, head, put } from '@vercel/blob';

import { pixelSizeOf, type PixelSize } from './dimensions';
import { isAllowedMime, type MediaMime } from './limits';

/**
 * The token, under either of the two names it arrives as.
 *
 * BLOB_READ_WRITE_TOKEN is what Vercel injects when a store is connected to a
 * project. The widget suite's store arrives as TG_Blob_READ_WRITE_TOKEN instead,
 * because a project with more than one store gets the store name as a prefix,
 * and api/upload-photo.js over there already reads both. If this project is
 * pointed at that same store, the second name is what turns up.
 *
 * Both are accepted so that connecting the store is the only step, rather than
 * connecting the store and then working out why the variable is named something
 * unexpected. The explicit one wins.
 */
export function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.TG_Blob_READ_WRITE_TOKEN;
}

/** Local alias, so the rest of this file reads the way it did. */
const token = blobToken;

/**
 * Whether uploads can work at all.
 *
 * Checked before anything is offered rather than discovered when a person has
 * already chosen a file. The screens use this to explain what is missing, in the
 * same shape as the sign-in page's `configured` flag, because "nothing happened"
 * is the worst possible answer to a button press.
 */
export function blobConfigured(): boolean {
  return Boolean(token());
}

/** Throw with something a person can act on, rather than an SDK error. */
function requireToken(): string {
  const value = token();
  if (!value) {
    throw new Error(
      'Image storage is not connected yet. Add a Blob store to this project in Vercel ' +
        'and redeploy, and uploads will start working.',
    );
  }
  return value;
}

/**
 * What the store says about an object, which is what gets recorded.
 *
 * THE BROWSER'S CLAIMS ARE NOT USED FOR THIS. The upload goes straight from the
 * browser to the store, so the server never sees the bytes and has only the
 * browser's word for what was uploaded. Asking the store closes that gap: the
 * size and content type recorded in the database are the stored object's own,
 * so a browser claiming a 200KB JPEG while uploading a 40MB one produces a row
 * that says 40MB and then fails the size constraint, rather than a library that
 * lies about what it holds.
 *
 * Null when there is no such object, which is the answer for a URL somebody made
 * up as much as for one that was deleted a moment ago.
 */
export async function describeBlob(url: string): Promise<{
  pathname: string;
  size: number;
  contentType: MediaMime;
} | null> {
  try {
    const blob = await head(url, { token: requireToken() });
    // The store reports the type it was given. If that is not one of the five,
    // the object is not something this product will serve, whatever it is.
    if (!isAllowedMime(blob.contentType)) return null;
    return { pathname: blob.pathname, size: blob.size, contentType: blob.contentType };
  } catch {
    // head() throws a BlobNotFoundError for a missing object and a network error
    // for a broken connection, and the caller's response is the same either way:
    // do not record a row. Distinguishing them would only produce a second error
    // message nobody can act on differently.
    return null;
  }
}

/**
 * Copy a file from somewhere else into our own store.
 *
 * This is what a Pexels import does, and copying rather than linking is a
 * deliberate choice. A hotlinked photograph is a client's hero image that
 * disappears when a photographer deletes their upload or the provider changes a
 * URL, months later, with nobody watching. Storing our own copy costs a few
 * hundred kilobytes and means a published site depends on nothing but the store.
 *
 * The fetch is capped by reading the declared length first. A remote server can
 * lie about content-length, so the buffer is measured again after the read and
 * the caller checks it against the limit; this is only here to avoid pulling a
 * gigabyte before finding out.
 */
export async function copyIntoStore(
  sourceUrl: string,
  pathname: string,
  maxBytes: number,
): Promise<{
  url: string;
  pathname: string;
  size: number;
  contentType: MediaMime;
  /**
   * Measured from the bytes that were actually stored, or null when the format
   * is one dimensions.ts does not read.
   *
   * Here rather than left to the caller because this function is the only place
   * that ever holds the file. A caller that wanted the size afterwards would have
   * to fetch the object back to find out, and the one caller that did not ask
   * ended up writing down the provider's numbers for a different file entirely.
   */
  pixels: PixelSize | null;
}> {
  const response = await fetch(sourceUrl, {
    // No credentials, no cookies, no redirect chain to somewhere unexpected.
    redirect: 'follow',
    /*
     * Was `image/*` until 20 Aug 2026, when the media library gained documents.
     * The two callers are a Pexels import, which only ever asks for photographs,
     * and site duplication, which copies whatever a client already had — and
     * since that now includes a brochure, an image-only accept header would have
     * made a duplicated site lose its files. What is actually SERVED is decided
     * by the content-type check below, which reads the response rather than
     * asking politely, so widening the request narrows nothing.
     */
    headers: { accept: '*/*' },
  });

  if (!response.ok) {
    throw new Error(`That image could not be fetched (${response.status}).`);
  }

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('That image is too large to add.');
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!isAllowedMime(contentType)) {
    throw new Error('That is not a file type this product can serve.');
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('That image came back empty.');
  if (bytes.byteLength > maxBytes) throw new Error('That image is too large to add.');

  const stored = await put(pathname, bytes, {
    access: 'public',
    token: requireToken(),
    contentType,
    /*
     * The store adds its own random suffix, and that is wanted: importing the
     * same photograph twice should give two objects rather than an error or a
     * silent overwrite. It also means the pathname that comes back is not the one
     * that went in, which is why the RETURNED value is what the caller stores.
     */
    addRandomSuffix: true,
    /*
     * A YEAR, AND THE RANDOM SUFFIX ABOVE IS WHAT MAKES THAT SAFE.
     *
     * Every stored object gets a suffix the store chooses, so one address can
     * only ever serve one set of bytes: replacing a picture makes a new url
     * rather than new content at the old one. That is the same property that
     * lets /fonts be immutable, and it is the whole argument for a long cache.
     *
     * Added 25 Aug 2026 because we were taking whatever the SDK's default was
     * and PageSpeed reported roughly 1.8 MB of desktop savings under "use
     * efficient cache lifetimes", nearly all of it pictures.
     *
     * FORWARD ONLY. Headers are written when an object is stored, so this
     * reaches pictures uploaded from here on. Everything already in a bank keeps
     * the header it was given.
     */
    cacheControlMaxAge: 31536000,
  });

  return {
    url: stored.url,
    pathname: stored.pathname,
    size: bytes.byteLength,
    contentType,
    pixels: pixelSizeOf(bytes),
  };
}

/**
 * Remove an object.
 *
 * Never throws. Deleting an image is a two step operation, the row and the
 * object, and the row is the one that matters: an object with no row is invisible
 * and costs pennies, while a row with no object is a broken picture on a client's
 * live site. So the row is deleted first and this is allowed to fail quietly.
 */
export async function removeBlob(url: string): Promise<void> {
  try {
    await del(url, { token: requireToken() });
  } catch {
    // Deliberately swallowed. See above.
  }
}
