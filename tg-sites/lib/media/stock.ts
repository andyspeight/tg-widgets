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
}
