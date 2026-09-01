/**
 * How big a picture really is, read from its own header.
 *
 * WHY THIS EXISTS. A Pexels import stored the dimensions the provider's API
 * reported, which describe the ORIGINAL photograph, while the file we actually
 * keep is their `large2x` rendering at around 1880px. So a row could say 8192 by
 * 4608 above a 168KB file, and on 25 Aug 2026 six rows on a live site did.
 *
 * That was harmless until the srcset work made it load-bearing. The primary goes
 * into a srcset carrying its recorded width, so a browser was offered a candidate
 * claiming 8192w, chose it over the genuine 1600px copy, and drew an 1880px file
 * stretched. The metadata was not describing the thing it was attached to.
 *
 * NO DECODER, AND NONE NEEDED. Every format here writes its dimensions in a
 * header a few bytes in, so this reads them directly. That keeps the promise
 * lib/media/downscale.ts already makes about not taking on a native module, and
 * it means this runs anywhere: a server action, a script, a test.
 *
 * RETURNS NULL RATHER THAN GUESSING. A format it does not know, a truncated file
 * or anything malformed gives null, and the caller keeps whatever it had. A wrong
 * measurement is worse than no measurement, because a wrong one gets written down
 * and believed, which is the exact failure this file exists to correct.
 */

export interface PixelSize {
  width: number;
  height: number;
}

function ok(width: number, height: number): PixelSize | null {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

/** PNG: an IHDR chunk at a fixed offset, width then height, both big-endian. */
function png(b: Buffer): PixelSize | null {
  if (b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return ok(b.readUInt32BE(16), b.readUInt32BE(20));
}

/** GIF: a fixed header, and unusually for this file, little-endian. */
function gif(b: Buffer): PixelSize | null {
  if (b.length < 10) return null;
  const magic = b.toString('ascii', 0, 6);
  if (magic !== 'GIF87a' && magic !== 'GIF89a') return null;
  return ok(b.readUInt16LE(6), b.readUInt16LE(8));
}

/**
 * JPEG: walk the markers to the start-of-frame, which is the only one that
 * carries the size.
 *
 * SOF0 through SOF15, skipping C4, C8 and CC, which share the number range and
 * are not frames at all (Huffman tables, JPEG extensions, arithmetic coding).
 * Reading one of those as a frame is the classic way this parser goes wrong.
 */
function jpeg(b: Buffer): PixelSize | null {
  if (b.length < 4 || b.readUInt16BE(0) !== 0xffd8) return null;

  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // length(2) precision(1) height(2) width(2)
      return ok(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
    }
    const length = b.readUInt16BE(i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

/** WebP: a RIFF container holding one of three chunk types, each storing size differently. */
function webp(b: Buffer): PixelSize | null {
  if (b.length < 30) return null;
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;

  const chunk = b.toString('ascii', 12, 16);

  if (chunk === 'VP8X') {
    // Three-byte little-endian, stored one less than the real value.
    return ok(
      1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    );
  }

  if (chunk === 'VP8 ') {
    // Lossy: a keyframe start code, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return ok(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  }

  if (chunk === 'VP8L') {
    // Lossless: 14 bits each, packed across four bytes after the signature.
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return ok(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff));
  }

  return null;
}

/**
 * The size of a picture, or null if it cannot be read with certainty.
 *
 * Order is by what this product actually stores: uploads are re-encoded to WebP,
 * stock imports arrive as JPEG, and PNG is what a logo tends to be.
 */
export function pixelSizeOf(bytes: Buffer | Uint8Array | null | undefined): PixelSize | null {
  if (!bytes || bytes.length < 10) return null;
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  try {
    return webp(b) ?? jpeg(b) ?? png(b) ?? gif(b);
  } catch {
    // A truncated file walks off the end. Unknown is the honest answer.
    return null;
  }
}
