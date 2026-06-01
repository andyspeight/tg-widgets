/**
 * GET /api/admin/catalogue/packages
 *
 * Returns the list of packages plus, for every catalogue item, which packages
 * currently include it by default. Powers the per-product package tick-boxes
 * on the Catalogue tab — the transpose of what the Packages tab edits.
 *
 * Both this endpoint and POST /api/admin/catalogue/set-package read and write
 * the SAME Package Catalogue join table that the Packages tab uses, so the two
 * screens stay perfectly in sync. The Catalogue page is just a product-centric
 * view of the same matrix.
 *
 * Response:
 *   {
 *     packages: [ { id, packageName, packageCode, sortOrder } ],   // sorted asc
 *     included: { [catalogueItemId]: [packageId, ...] }            // includedByDefault = true
 *   }
 *
 * Auth: requires widget_suite owner or admin.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { listAllRecords } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import { PRODUCTS, PERMISSIONS, PACKAGES, PACKAGE_CATALOGUE } from '../../_lib/auth/schema.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return jsonError(res, 405, 'method_not_allowed', 'GET only');
  }

  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  const role = requireProductAccess(
    ctx,
    PRODUCTS.slugs.WIDGET_SUITE,
    [PERMISSIONS.roles.OWNER, PERMISSIONS.roles.ADMIN],
    res
  );
  if (!role) return;

  try {
    const [packageRecords, joinRecords] = await Promise.all([
      listAllRecords(PACKAGES.tableId),
      listAllRecords(PACKAGE_CATALOGUE.tableId),
    ]);

    const packages = packageRecords
      .map((p) => ({
        id: p.id,
        packageName: p.fields[PACKAGES.fields.packageName] || '',
        packageCode: p.fields[PACKAGES.fields.packageCode] || '',
        active: !!p.fields[PACKAGES.fields.active],
        sortOrder: p.fields[PACKAGES.fields.sortOrder] ?? 999,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // catalogueItemId -> [packageId, ...] where includedByDefault is true
    const included = {};
    for (const j of joinRecords) {
      if (!j.fields[PACKAGE_CATALOGUE.fields.includedByDefault]) continue;
      const pkgIds = j.fields[PACKAGE_CATALOGUE.fields.package] || [];
      const catIds = j.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
      for (const cid of catIds) {
        if (!included[cid]) included[cid] = [];
        for (const pid of pkgIds) {
          if (!included[cid].includes(pid)) included[cid].push(pid);
        }
      }
    }

    return res.status(200).json({ packages, included });
  } catch (err) {
    console.error('[admin/catalogue/packages] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to load package matrix');
  }
}
