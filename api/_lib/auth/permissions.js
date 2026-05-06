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
 * @param {string} userRecordId — required for cache key + log clarity
 * @param {string} userEmail    — the linked record's primary field value;
 *                                used by the Airtable formula because
 *                                ARRAYJOIN on a linked-record field renders
 *                                the primary field value, not the record ID
 * @param {object} [opts]
 * @param {boolean} [opts.bypassCache=false]
 * @returns {Promise<Array<{product: string, productRecordId: string, role: string, expiresAt: string|null}>>}
 *
 * NB: `product` is the slug like 'widget_suite'. Consumers should never
 * see the Airtable record ID — the slug is the stable contract.
 */
export async function resolveUserPermissions(userRecordId, userEmail, { bypassCache = false } = {}) {
  if (!userRecordId || !userEmail) return [];

  if (!bypassCache) {
    const cached = cache.get(userRecordId);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.perms;
    }
  }

  // Filter on the linked-record field. Subtlety: ARRAYJOIN of a linked
  // record field returns the joined PRIMARY field values of the linked
  // records (display strings), NOT the record IDs. The Users table's
  // primary field is Email, so we search for the user's email — escaped
  // for formula safety. Status must be 'active' AND not expired.
  //
  // Email is also normalised to lowercase by /api/auth/signin so a direct
  // case-sensitive match is correct here.
  const escapedEmail = String(userEmail).replace(/'/g, "\\'");
  const formula =
    `AND(` +
      `FIND('${escapedEmail}', ARRAYJOIN({${PERMISSIONS.fields.user}}))>0,` +
      `{${PERMISSIONS.fields.status}}='${PERMISSIONS.statuses.ACTIVE}',` +
      `OR(BLANK()={${PERMISSIONS.fields.expiresAt}}, IS_AFTER({${PERMISSIONS.fields.expiresAt}}, NOW()))` +
    `)`;

  let records;
  try {
    records = await listRecords(PERMISSIONS.tableId, { formula, maxRecords: 100 });
  } catch (err) {
    console.error('[permissions] resolveUserPermissions query failed', {
      userRecordId,
      formula,
      error: err.message
    });
    // Cache an empty result for a short window so we don't hammer a broken
    // dependency, but make it shorter than the success TTL so we recover
    // quickly when Airtable is back.
    cache.set(userRecordId, { perms: [], fetchedAt: Date.now() - (TTL_MS - 5_000) });
    return [];
  }
  const slugMap = await getProductSlugByRecordId();

  const perms = [];
  for (const r of records) {
    // Belt and braces: also confirm the linked user record ID matches the
    // session user. Should always be true given the email filter above
    // (emails are unique in the Users table) but cheap to verify.
    const userLink = r.fields[PERMISSIONS.fields.user] || [];
    if (!userLink.includes(userRecordId)) continue;

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
export async function userCanAccessProduct(userRecordId, userEmail, productSlug) {
  const perms = await resolveUserPermissions(userRecordId, userEmail);
  return perms.some(p => p.product === productSlug);
}

/**
 * Lookup: what role does this user hold for this product? Returns null
 * if no active permission. Useful for finer-grained checks like
 * "can this user grant other permissions" (admin/owner only).
 */
export async function getUserRoleForProduct(userRecordId, userEmail, productSlug) {
  const perms = await resolveUserPermissions(userRecordId, userEmail);
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
