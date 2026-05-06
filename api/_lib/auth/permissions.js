/**
 * Permissions resolver.
 *
 * Single source of truth for "what is this user allowed to do, on which
 * Travelgenix products?". Used by:
 *   - /api/auth/signin to embed the permission set in the JWT
 *   - /api/auth/me to refresh permissions on demand
 *   - /api/identity/* admin endpoints to grant/revoke
 *   - any product API that wants to validate access without re-fetching
 *
 * Caching strategy:
 *   - When a permission is granted/revoked, the change must be felt by the
 *     user "instantly" (their next API call).
 *   - We cache the resolved permission set per user for 30 seconds in memory
 *     of a single Vercel function instance. This is well within the
 *     "feels instant" budget but spares Airtable from being hammered.
 *   - The Identity Console can additionally write a "permissions_changed"
 *     bump record to invalidate caches — out of scope for v1, in for v2.
 */

import { listRecords } from './airtable.js';
import { PERMISSIONS, PRODUCTS } from './schema.js';

// --- in-memory cache, keyed by userRecordId ---
const cache = new Map(); // userId -> { perms, fetchedAt }
const TTL_MS = 30_000;

/**
 * Returns a Map<productSlug, productRecordId>.
 * Cached for the lifetime of the function instance — Products table is a
 * tiny reference list that almost never changes.
 */
let productSlugByRecordIdMemo = null;
async function getProductSlugByRecordId() {
  if (productSlugByRecordIdMemo) return productSlugByRecordIdMemo;
  const records = await listRecords(PRODUCTS.tableId, { maxRecords: 100 });
  const map = new Map();
  for (const r of records) {
    const slug = r.fields[PRODUCTS.fields.productId];
    if (slug) map.set(r.id, slug);
  }
  productSlugByRecordIdMemo = map;
  return map;
}

/**
 * Resolve every active permission a user holds, joined to product slugs.
 *
 * @param {string} userRecordId
 * @param {object} [opts]
 * @param {boolean} [opts.bypassCache=false]
 * @returns {Promise<Array<{product: string, productRecordId: string, role: string, expiresAt: string|null}>>}
 *
 * NB: `product` is the slug like 'widget_suite'. Consumers should never
 * see the Airtable record ID — the slug is the stable contract.
 */
export async function resolveUserPermissions(userRecordId, { bypassCache = false } = {}) {
  if (!userRecordId) return [];

  if (!bypassCache) {
    const cached = cache.get(userRecordId);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.perms;
    }
  }

  // Filter on the linked-record field. Airtable formulas treat linked
  // record fields as arrays of record IDs — FIND() the user ID in the
  // array stringified form. Status must be 'active' AND not expired.
  const formula =
    `AND(` +
      `FIND('${userRecordId}', ARRAYJOIN({${PERMISSIONS.fields.user}})),` +
      `{${PERMISSIONS.fields.status}}='${PERMISSIONS.statuses.ACTIVE}',` +
      `OR({${PERMISSIONS.fields.expiresAt}}='', IS_AFTER({${PERMISSIONS.fields.expiresAt}}, NOW()))` +
    `)`;

  const records = await listRecords(PERMISSIONS.tableId, { formula, maxRecords: 100 });
  const slugMap = await getProductSlugByRecordId();

  const perms = [];
  for (const r of records) {
    const productLink = r.fields[PERMISSIONS.fields.product] || [];
    const productRecordId = productLink[0];
    if (!productRecordId) continue;
    const slug = slugMap.get(productRecordId);
    if (!slug) continue; // orphaned permission — ignore
    perms.push({
      product: slug,
      productRecordId,
      role: r.fields[PERMISSIONS.fields.role] || '',
      expiresAt: r.fields[PERMISSIONS.fields.expiresAt] || null
    });
  }

  cache.set(userRecordId, { perms, fetchedAt: Date.now() });
  return perms;
}

/**
 * Force-evict a user's cached permissions. Call this from grant/revoke
 * endpoints so the next read is fresh.
 */
export function invalidateUserPermissions(userRecordId) {
  cache.delete(userRecordId);
}

/**
 * Quick boolean check: does this user have ANY active permission for
 * the given product slug?
 */
export async function userCanAccessProduct(userRecordId, productSlug) {
  const perms = await resolveUserPermissions(userRecordId);
  return perms.some(p => p.product === productSlug);
}

/**
 * Lookup: what role does this user hold for this product? Returns null
 * if no active permission. Useful for finer-grained checks like
 * "can this user grant other permissions" (admin/owner only).
 */
export async function getUserRoleForProduct(userRecordId, productSlug) {
  const perms = await resolveUserPermissions(userRecordId);
  const match = perms.find(p => p.product === productSlug);
  return match ? match.role : null;
}

/**
 * Reset the product-slug memo. Used when the Products table is mutated
 * (a new product launched, an old one renamed). Rarely called.
 */
export function invalidateProductSlugMemo() {
  productSlugByRecordIdMemo = null;
}
