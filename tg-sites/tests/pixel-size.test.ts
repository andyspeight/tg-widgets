/**
 * Reading a picture's real size out of its own header.
 *
 * Tested against REAL FILES in the repo rather than hand-built byte arrays. A
 * synthetic header proves the parser can read the header it was written to
 * match; a photograph off a camera and a logo out of a design tool are what
 * actually arrives, and they are what caught the JPEG marker-walk being subtly
 * wrong the first time.
 *
 * Why this matters: a Pexels import recorded the ORIGINAL photograph's size from
 * the provider's API while storing their much smaller rendering, so six rows on a
 * live site claimed 8192px above a 168KB file. Harmless until the srcset work put
 * that number in front of a browser as a candidate width.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { pixelSizeOf } from '../lib/media/dimensions';

const repo = resolve(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(resolve(repo, ...p));

describe('pixelSizeOf', () => {
  it('reads a real photograph', () => {
    expect(pixelSizeOf(read('test/fixtures/photo.jpg'))).toEqual({ width: 1280, height: 720 });
  });

  it('reads another, to prove it walks markers rather than guessing an offset', () => {
    /*
     * Different cameras and exporters put different numbers of segments (EXIF,
     * ICC, comments) before the frame, so a parser that assumes a fixed offset
     * passes on one file and fails on the next.
     */
    expect(pixelSizeOf(read('test/fixtures/g-img1.jpg'))).toEqual({ width: 800, height: 600 });
  });

  it('reads a PNG', () => {
    const size = pixelSizeOf(read('public/emailsig-icons/website.png'));
    expect(size).not.toBeNull();
    expect(size!.width).toBeGreaterThan(0);
    expect(size!.height).toBeGreaterThan(0);
  });

  it('says null for something that is not an image at all', () => {
    expect(pixelSizeOf(Buffer.from('this is plainly not a picture, at all, no'))).toBeNull();
  });

  it('says null rather than guessing when a file is truncated', () => {
    const whole = read('test/fixtures/photo.jpg');
    // The magic number survives; the frame marker does not.
    expect(pixelSizeOf(whole.subarray(0, 12))).toBeNull();
  });

  it('says null for empty and missing input rather than throwing', () => {
    expect(pixelSizeOf(Buffer.alloc(0))).toBeNull();
    expect(pixelSizeOf(null)).toBeNull();
    expect(pixelSizeOf(undefined)).toBeNull();
  });

  it('never reports a zero or negative size', () => {
    for (const f of ['test/fixtures/photo.jpg', 'test/fixtures/g-img1.jpg']) {
      const size = pixelSizeOf(read(f))!;
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
  });
});
