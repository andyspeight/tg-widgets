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
  isDocumentMime,
  isImageMime,
  mimeFromFilename,
  REENCODE_QUALITY,
  type MediaMime,
} from './limits';

/**
 * One smaller copy of the same picture, for an srcset.
 *
 * Generated in the browser from the SAME decoded bitmap as the primary, so a
 * variant costs one more canvas draw and one more encode rather than a second
 * decode of the file.
 */
export interface PreparedVariant {
  body: Blob;
  mime: MediaMime;
  filename: string;
  width: number;
  height: number;
}

/**
 * The widths worth storing, smallest first.
 *
 * WHY THESE FOUR AND NOT A CONTINUOUS LADDER. Every entry is a stored object, a
 * direct upload and a row of metadata, so the ladder is a cost, not a free win.
 * 400 covers a phone at 1x and a small card at 2x, 800 a phone at 2x and a
 * tablet, 1600 a laptop, and the primary (up to MAX_IMAGE_EDGE, 2400) covers a
 * desktop at 2x. A visitor on a 390px phone currently downloads the 2400px file,
 * which is the single largest thing on a published page.
 *
 * Never upscale: a width is only generated when it is genuinely smaller than the
 * picture we already have.
 */
export const VARIANT_WIDTHS = [400, 800, 1600] as const;

/**
 * How much smaller a variant has to be before it earns its storage.
 *
 * Generating a 1600px copy of a 1700px original saves almost nothing and costs a
 * whole object. A variant has to come in at or under this fraction of the
 * primary width to be worth keeping.
 */
const VARIANT_MAX_RATIO = 0.8;

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
  /**
   * Smaller copies for an srcset, largest-useful first. Possibly empty, and an
   * empty list is always safe: the renderer falls back to `body` alone, which is
   * exactly what every image uploaded before this existed already does.
   */
  variants: PreparedVariant[];
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
 * Which widths are worth generating for a picture of this size.
 *
 * PURE, AND EXPORTED SO IT CAN BE TESTED. The encoding around it needs a canvas
 * and a real browser; the decision does not, and the decision is where the
 * mistakes live. Two rules, both easy to get subtly wrong:
 *
 * 1. NEVER UPSCALE. The width to beat is the width of the PRIMARY, which is the
 *    original capped to MAX_IMAGE_EDGE on its longest edge, not the original's
 *    own width. A 3000x4000 portrait has a 4000px longest edge, so its primary
 *    is 1800 wide, and generating a "1600" variant of it would save almost
 *    nothing while a naive check against the original's 3000 would wave it
 *    through.
 * 2. EARN THE STORAGE. Every width is an object, an upload and a row, so a
 *    variant has to be meaningfully smaller than the primary to be worth having.
 */
export function variantWidthsFor(width: number, height: number): number[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];

  const longest = Math.max(width, height);
  const scale = longest > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longest : 1;
  const primaryWidth = Math.round(width * scale);

  return VARIANT_WIDTHS.filter((target) => target <= primaryWidth * VARIANT_MAX_RATIO);
}

/**
 * The smaller copies, drawn from a bitmap that is already decoded.
 *
 * BEST EFFORT, ALWAYS. Every failure here returns whatever succeeded so far,
 * including nothing. A missing variant costs a visitor some bytes; a variant
 * that throws would cost somebody their upload, and this file's whole posture is
 * that the second is far worse than the first.
 *
 * Does NOT close the bitmap. The caller still needs it for the primary.
 */
async function encodeVariants(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  stem: string,
): Promise<PreparedVariant[]> {
  const out: PreparedVariant[] = [];

  for (const target of variantWidthsFor(width, height)) {
    try {
      const scale = target / width;
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(bitmap, 0, 0, w, h);

      const encoded = await toBlob(canvas, 'image/webp', REENCODE_QUALITY);
      if (!encoded || !isImageMime(encoded.type)) continue;

      out.push({
        body: encoded,
        mime: encoded.type as MediaMime,
        filename: `${stem}-${w}.${MEDIA_MIME[encoded.type as MediaMime]}`,
        width: w,
        height: h,
      });
    } catch {
      // This width is simply not available. The next one may still be.
    }
  }

  return out;
}

/**
 * Get a file ready to upload.
 *
 * Never throws. Every failure path returns the original file, because the worst
 * outcome here is a slightly heavy image and the worst outcome of throwing is a
 * person who cannot add a picture.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const declared = isAllowedMime(file.type) ? file.type : mimeFromFilename(file.name);

  /*
   * A DOCUMENT GOES STRAIGHT THROUGH, untouched and unmeasured.
   *
   * Everything below this line is about pixels: createImageBitmap, a canvas, a
   * re-encode. Handed a PDF, createImageBitmap throws and the catch returns the
   * original, so a document would have survived by accident even without this
   * line. Relying on that would be relying on a failure path, and the day
   * somebody widens the catch a brochure would be quietly re-encoded as a JPEG.
   *
   * It also means the mime fallback below is honest. 'image/jpeg' is the right
   * guess for a picture whose type the browser did not report; it would be a lie
   * for a document, and the store would refuse the upload with a type mismatch
   * nobody could read.
   */
  if (declared && isDocumentMime(declared)) {
    return {
      body: file,
      mime: declared,
      filename: cleanFilename(file.name, 'file'),
      // No pixels. The column is nullable precisely for these rows.
      width: null,
      height: null,
      resized: false,
      variants: [],
    };
  }

  const original: PreparedImage = {
    body: file,
    // A browser that reports nothing usable still gets a guess from the name, and
    // failing that the store will refuse it, which is the correct outcome.
    mime: declared ?? 'image/jpeg',
    filename: cleanFilename(file.name),
    width: null,
    height: null,
    resized: false,
    /*
     * Empty, and every failure path below spreads this shape. That is the point:
     * a picture we could not decode, a GIF we refuse to touch, or a browser
     * without a canvas all end up with no variants and one perfectly good image,
     * which is exactly the behaviour every upload had before variants existed.
     */
    variants: [],
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
  const stem = cleanFilename(file.name).replace(/\.[a-z0-9]+$/i, '') || 'image';

  /*
   * Variants come off the bitmap BEFORE the branch below, because both branches
   * want them: a 900px photograph needs no resizing and still benefits from a
   * 400px copy on a phone. The bitmap stays open until the primary is done with
   * it.
   */
  const variants = await encodeVariants(bitmap, width, height, stem);
  const needsResize = longest > MAX_IMAGE_EDGE;
  const needsRecompress = file.size > RECOMPRESS_ABOVE_BYTES;

  if (!needsResize && !needsRecompress) {
    bitmap.close();
    // Nothing to do to the bytes, but the measurement and the smaller copies are
    // both still worth keeping.
    return { ...original, width, height, variants };
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

    /*
     * isImageMime, NOT isAllowedMime. This is checking what a CANVAS produced, and
     * a canvas produces pictures. Since 20 Aug the wider list also admits PDFs and
     * spreadsheets, so the broader check would now wave through a type this branch
     * could never legitimately see.
     */
    if (!encoded || !isImageMime(encoded.type)) {
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

    return {
      body: encoded,
      mime: encoded.type as MediaMime,
      filename: `${stem}.${MEDIA_MIME[encoded.type as MediaMime]}`,
      width: targetWidth,
      height: targetHeight,
      resized: true,
      variants,
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
