/**
 * Copying a whole site into another one.
 *
 * A site is a tenant, so a duplicate is a new tenant (see createTenant in
 * tenants.ts) plus a deep copy of everything the source owns. This file is where
 * that copy lives. It grows a slice at a time: the media first, then the pages
 * and regions, then collections and fonts, each reusing the map the media copy
 * returns to repoint the images embedded in the content.
 *
 * TWO TENANTS, NEVER ONE TRANSACTION. withTenant refuses to open a second tenant
 * inside the first (lib/db/withTenant.ts), which is the rule that stops a
 * cross-tenant write happening by accident, and it applies here too. So every
 * copy is a read from the source in its own scope, held in memory, then a write
 * into the destination in its own scope. The write side is atomic; the read side
 * is just a prior step.
 */

import 'server-only';

import { copyIntoStore } from '../media/blob';
import { isAllowedMime, MAX_UPLOAD_BYTES, storagePathFor, type MediaMime } from '../media/limits';
import type { MediaItem } from '../media/types';
import { insertMedia, listAllMedia, type NewMedia } from './media';
import { withTenant } from './withTenant';

/**
 * The destination row for one copied image.
 *
 * Pure, so the split of where each field comes from is tested without a store: the
 * type and the byte count are the STORED object's own facts, straight off the copy
 * the store just made, while the label, dimensions, alt text and credit are
 * metadata the store never knew and are carried across from the source row. The
 * key and the url are the new object's, which is the whole point of an own-copy.
 */
export function copiedMediaRow(
  item: MediaItem,
  stored: { url: string; pathname: string; size: number; contentType: MediaMime },
): NewMedia {
  return {
    storageKey: stored.pathname,
    url: stored.url,
    filename: item.filename,
    mime: stored.contentType,
    bytes: stored.size,
    width: item.width,
    height: item.height,
    alt: item.alt,
    source: item.source,
    credit: item.credit,
  };
}

/**
 * Copy every image a site has into another site's own storage.
 *
 * OWN COPIES, NOT SHARED URLS. Each picture is re-uploaded into the destination
 * tenant's own prefix and gets its own blob object, so the two sites share
 * nothing: deleting or replacing an image on one can never break the other. This
 * is the isolation Andy chose over the cheaper option of pointing both sites at
 * one URL. copyIntoStore is the same copy a Pexels import already does.
 *
 * THREE PHASES, because a blob copy is slow network I/O that has no business
 * holding a transaction open, and because the two tenants cannot share one:
 *   1. read the whole source bank in the source's scope,
 *   2. copy each object into the destination's store, no database open,
 *   3. write all the destination rows in one destination transaction.
 * insertMedia opens its own withTenant, but for the same tenant and role it
 * reuses the one this opens, so the whole bank commits together or not at all. A
 * failure in phase three rolls the rows back and leaves a few orphaned objects,
 * which cost pennies and are the harmless side to fail on; the clone is a draft
 * the orchestrator can delete and remake.
 *
 * Returns the old-url to new-url map, which the later content slices use to
 * repoint every image embedded in the copied pages, regions and items. An empty
 * bank returns an empty map and touches the store not at all.
 */
export async function copyMediaToTenant(
  sourceTenantId: string,
  destTenantId: string,
): Promise<Map<string, string>> {
  const sources = await listAllMedia(sourceTenantId);
  if (sources.length === 0) return new Map();

  const copied: Array<{ fromUrl: string; row: NewMedia }> = [];

  for (const item of sources) {
    // The extension only; storagePathFor files it under the DESTINATION's prefix,
    // which is what keeps a copy out of the source tenant's storage.
    const mime: MediaMime = isAllowedMime(item.mime) ? item.mime : 'image/jpeg';
    const stored = await copyIntoStore(
      item.url,
      storagePathFor(destTenantId, item.filename, mime),
      MAX_UPLOAD_BYTES,
    );
    copied.push({ fromUrl: item.url, row: copiedMediaRow(item, stored) });
  }

  await withTenant(destTenantId, async () => {
    for (const { row } of copied) {
      await insertMedia(destTenantId, row);
    }
  });

  return new Map(copied.map(({ fromUrl, row }) => [fromUrl, row.url]));
}
