/**
 * Importing one stock photograph into a tenant's own media.
 *
 * EXTRACTED FROM importStockAction so the photo fill (lib/media/photo-fill.ts)
 * can import pictures during a starter or template build, where there is no
 * request-bound session to ask: the tenant is explicit here, and the ACTION
 * remains the door that resolves it from the session. Same body either way, so
 * a photograph imported by the fill is indistinguishable from one imported by
 * hand: copied into the store under the tenant's prefix, recorded with its
 * provider credit, and its description carried as the starting alt text.
 */

import { insertMedia } from '../db/media';
import { copyIntoStore } from './blob';
import { filenameStem, MAX_UPLOAD_BYTES, MEDIA_MIME, pixelDimension, plainText, tenantPrefix } from './limits';
import { importableUrl } from './pexels';
import type { MediaItem, StockPhoto } from './types';

export async function importStockPhoto(tenantId: string, photo: StockPhoto): Promise<MediaItem> {
  // Throws unless the URL is on the provider's image host.
  const source = importableUrl(photo);

  const description = plainText(photo?.description, 300);
  const stem = filenameStem(description || `pexels-${String(photo?.id ?? 'photo')}`);
  const stored = await copyIntoStore(
    source,
    `${tenantPrefix(tenantId)}${stem}.jpg`,
    MAX_UPLOAD_BYTES,
  );

  return insertMedia(tenantId, {
    storageKey: stored.pathname,
    url: stored.url,
    filename: `${stem}.${MEDIA_MIME[stored.contentType]}`,
    mime: stored.contentType,
    bytes: stored.size,
    /*
     * MEASURED FROM THE FILE WE KEPT, not taken from the provider's word about a
     * different one.
     *
     * The API describes the ORIGINAL photograph, often several thousand pixels
     * wide, while what is fetched and stored is Pexels' own `large2x` rendering
     * at around 1880. Recording the first while holding the second put six rows
     * on a live site claiming 8192 by 4608 above a 168KB file. That was dormant
     * until a srcset started quoting the recorded width to browsers as a
     * candidate: one would choose the "8192" primary over a genuine 1600px copy
     * and draw the smaller file stretched.
     *
     * The provider's numbers stay as the fallback, because a picture whose header
     * cannot be read is still better described by an approximate aspect ratio
     * than by nothing. Same posture as the rest of this pipeline: measure what
     * you have, and only believe someone else when you cannot.
     */
    width: stored.pixels?.width ?? pixelDimension(photo?.width),
    height: stored.pixels?.height ?? pixelDimension(photo?.height),
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
}
