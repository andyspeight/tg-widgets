/**
 * GET /api/admin/packages/list
 *
 * Returns every package with a quick summary count of how many products
 * are included by default and how many are offered as add-ons. Powers
 * the Packages tab landing view (the list of cards).
 *
 * Auth: widget_suite owner or admin.
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
    // Pull both tables in parallel
    const [packageRecords, joinRecords] = await Promise.all([
      listAllRecords(PACKAGES.tableId),
      listAllRecords(PACKAGE_CATALOGUE.tableId),
    ]);

    // Index join records by package record id for O(1) lookup
    const joinsByPackage = new Map();
    for (const j of joinRecords) {
      const pkgIds = j.fields[PACKAGE_CATALOGUE.fields.package] || [];
      for (const pid of pkgIds) {
        if (!joinsByPackage.has(pid)) joinsByPackage.set(pid, []);
        joinsByPackage.get(pid).push(j);
      }
    }

    const packages = packageRecords
      .map((p) => {
        const joins = joinsByPackage.get(p.id) || [];
        const includedCount = joins.filter(
          (j) => !!j.fields[PACKAGE_CATALOGUE.fields.includedByDefault]
        ).length;
        const addOnCount = joins.filter(
          (j) => !!j.fields[PACKAGE_CATALOGUE.fields.availableAsAddOn]
        ).length;

        return {
          id: p.id,
          packageName: p.fields[PACKAGES.fields.packageName] || '',
          packageCode: p.fields[PACKAGES.fields.packageCode] || '',
          monthlyPrice: p.fields[PACKAGES.fields.monthlyPrice] ?? null,
          setupFee: p.fields[PACKAGES.fields.setupFee] ?? null,
          description: p.fields[PACKAGES.fields.description] || '',
          active: !!p.fields[PACKAGES.fields.active],
          sortOrder: p.fields[PACKAGES.fields.sortOrder] ?? 999,
          includedCount,
          addOnCount,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return res.status(200).json({ packages });
  } catch (err) {
    console.error('[admin/packages/list] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to load packages');
  }
}
