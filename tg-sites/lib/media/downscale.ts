/**
 * Shrinking an image in the browser, before it is uploaded.
 *
 * WHY THIS EXISTS AT ALL
 *
 * A photograph off a current phone is four to eight megabytes and about 4000
 * pixels wide. Nothing on a website needs that: the widest a section ever renders
 * is the page maximum, so past about 2400px every extra pixel is bytes a visitor
 * pays for and cannot see. Left alone, a travel agency uploads twelve holiday
 * photographs at six megabytes each and their site becomes slow in a way nobody
 * will ever connect to the afternoon they added some pictures.
 *
 * The alternative is resizing on the server with sharp, which is a native module,
 * or on the fly through an image CDN. Doing it here costs no dependency, no
 * function invocation and no per-image fee, and it happens while somebody is
 * looking at a progress bar rather than while a visitor waits.
 *
 * WHAT IT WILL NOT DO
 *
 * It never makes an image bigger, it never touches a GIF, and if anything at all
 * goes wrong it returns the original file. A resize is an optimisation, and an
 * optimisation that can fail an upload is worse than no optimisation.
 *
 * BROWSER ONLY. No 'server-only' marker and no imports that carry one: this runs
 * in the picker.
 */

import {
  cleanFilename,
  isAllowedMime,
  MAX_IMAGE_EDGE,
  MEDIA_MIME,
  mimeFromFilename,
  REENCODE_QUALITY,
  type MediaMime,
} from './limits';

export interface PreparedImage {
  /** What to upload. The original file when nothing needed doing. */
  body: Blob;
  /** The type the store will be told, which is the type `body` really is. */
  mime: MediaMime;
  /** A filename with an extension matching `mime`. */
  filename: string;
  /** Measured, not claimed. Null only when the browser could not decode it. */
  width: number | null;
  height: number | null;
  /** True when the bytes were re-encoded, so the UI can say so honestly. */
  resized: boolean;
}

/**
 * Under this, leave it alone.
 *
 * Re-encoding a 200KB image that is already the right size gains nothing and can
 * lose: a carefully exported PNG logo run through a lossy encoder comes back
 * softer, and somebody will notice that on a header long before they notice a
 * hundred kilobytes.
 */
const RECOMPRESS_ABOVE_BYTES = 1_200_000;

/**
 * Get a file ready to upload.
 *
 * Never throws. Every failure path returns the original file, because the worst
 * outcome here is a slightly heavy image and the worst outcome of throwing is a
 * person who cannot add a picture.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const declared = isAllowedMime(file.type) ? file.type : mimeFromFilename(file.name);
  const original: PreparedImage = {
    body: file,
    // A browser that reports nothing usable still gets a guess from the name, and
    // failing that the store will refuse it, which is the correct outcome.
    mime: declared ?? 'image/jpeg',
    filename: cleanFilename(file.name),
    width: null,
    height: null,
    resized: false,
  };

  /*
   * A GIF is left completely alone.
   *
   * Drawing one to a canvas keeps the first frame and throws the animation away,
   * which for the one format people choose BECAUSE it moves is the worst possible
   * silent change.
   */
  if (declared === 'image/gif') return original;

  let bitmap: ImageBitmap;
  try {
    // from-image, so a photograph taken in portrait does not come out on its side.
    // EXIF orientation is metadata a canvas otherwise ignores completely.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return original;
  }

  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  const needsResize = longest > MAX_IMAGE_EDGE;
  const needsRecompress = file.size > RECOMPRESS_ABOVE_BYTES;

  if (!needsResize && !needsRecompress) {
    bitmap.close();
    // Nothing to do to the bytes, but the measurement is still worth keeping.
    return { ...original, width, height };
  }

  // Never upscale: a small image that is merely a heavy file gets recompressed at
  // its own size.
  const scale = needsResize ? MAX_IMAGE_EDGE / longest : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return { ...original, width, height };
    }

    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    /*
     * WebP, not JPEG.
     *
     * It is smaller at the same quality, it keeps transparency so a logo with a
     * cut-out background survives, and it is one of the five types the store and
     * the database already accept. Any browser with createImageBitmap has had
     * WebP encoding for years, and the check below covers the one that has not.
     */
    const encoded = await toBlob(canvas, 'image/webp', REENCODE_QUALITY);

    if (!encoded || !isAllowedMime(encoded.type)) {
      return { ...original, width, height };
    }

    /*
     * And only if it actually helped.
     *
     * Re-encoding can produce a LARGER file: a flat graphic saved as an optimised
     * PNG is already better compressed than a photographic codec will manage. If
     * the result is bigger, the original wins, and the measurement is kept either
     * way.
     */
    if (!needsResize && encoded.size >= file.size) {
      return { ...original, width, height };
    }

    const stem = cleanFilename(file.name).replace(/\.[a-z0-9]+$/i, '') || 'image';

    return {
      body: encoded,
      mime: encoded.type as MediaMime,
      filename: `${stem}.${MEDIA_MIME[encoded.type as MediaMime]}`,
      width: targetWidth,
      height: targetHeight,
      resized: true,
    };
  } catch {
    return { ...original, width, height };
  }
}

/** canvas.toBlob as a promise, because it is one of the last callback APIs left. */
function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}
