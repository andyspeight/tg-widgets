/**
 * GET /api/admin/onboarding/preview-entitlements?packageId=recXXX
 *
 * Returns the full grid of catalogue items with this package's default flags
 * applied. Used by Step 3 of the New Client wizard so it can render the grid
 * pre-ticked according to the package's defaults.
 *
 * Response shape mirrors what /api/admin/packages/get returns for the grid,
 * but framed for onboarding:
 *   {
 *     packageId,
 *     packageName,
 *     grid: [
 *       {
 *         catalogueItemId, productCode, productName, category, sortOrder,
 *         includedByDefault, availableAsAddOn, addOnMonthlyPrice
 *       }
 *     ],
 *     byCategory, categoryOrder
 *   }
 *
 * Auth: widget_suite owner or admin.
 */

import { requireAuth, requireProductAccess } from '../../_lib/auth/middleware.js';
import { getRecord, listAllRecords } from '../../_lib/auth/airtable.js';
import { jsonError } from '../../_lib/auth/http.js';
import {
  PRODUCTS,
  PERMISSIONS,
  CATALOGUE,
  PACKAGES,
  PACKAGE_CATALOGUE,
} from '../../_lib/auth/schema.js';

const REC_ID_RE = /^rec[A-Za-z0-9]{14}$/;

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

  const packageId = String(req.query?.packageId || '').trim();
  if (!REC_ID_RE.test(packageId)) {
    return jsonError(res, 400, 'invalid_package_id', 'packageId must be a valid record id');
  }

  try {
    const [pkg, catalogueRecords, joinRecords] = await Promise.all([
      getRecord(PACKAGES.tableId, packageId).catch((err) => {
        if (err?.status === 404) return null;
        throw err;
      }),
      listAllRecords(CATALOGUE.tableId),
      listAllRecords(PACKAGE_CATALOGUE.tableId),
    ]);

    if (!pkg) return jsonError(res, 404, 'package_not_found', 'No package with that id');

    // Build map: catalogueRecordId -> join row for this package
    const joinByCatalogueId = new Map();
    for (const j of joinRecords) {
      const pkgIds = j.fields[PACKAGE_CATALOGUE.fields.package] || [];
      if (!pkgIds.includes(packageId)) continue;
      const catIds = j.fields[PACKAGE_CATALOGUE.fields.catalogueItem] || [];
      for (const cid of catIds) joinByCatalogueId.set(cid, j);
    }

    const grid = catalogueRecords
      .filter((c) => !!c.fields[CATALOGUE.fields.active])
      .map((c) => {
        const join = joinByCatalogueId.get(c.id);
        return {
          catalogueItemId: c.id,
          productCode: c.fields[CATALOGUE.fields.productCode] || '',
          productName: c.fields[CATALOGUE.fields.productName] || '',
          category: c.fields[CATALOGUE.fields.category] || '',
          sortOrder: c.fields[CATALOGUE.fields.sortOrder] ?? 999,
          includedByDefault: join
            ? !!join.fields[PACKAGE_CATALOGUE.fields.includedByDefault]
            : false,
          availableAsAddOn: join
            ? !!join.fields[PACKAGE_CATALOGUE.fields.availableAsAddOn]
            : false,
          addOnMonthlyPrice:
            join?.fields[PACKAGE_CATALOGUE.fields.addOnMonthlyPrice] ?? null,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const byCategory = {};
    for (const cat of CATALOGUE.categoryOrder) byCategory[cat] = [];
    for (const row of grid) {
      if (!byCategory[row.category]) byCategory[row.category] = [];
      byCategory[row.category].push(row);
    }

    return res.status(200).json({
      packageId: pkg.id,
      packageName: pkg.fields[PACKAGES.fields.packageName] || '',
      packageCode: pkg.fields[PACKAGES.fields.packageCode] || '',
      monthlyPrice: pkg.fields[PACKAGES.fields.monthlyPrice] ?? null,
      setupFee: pkg.fields[PACKAGES.fields.setupFee] ?? null,
      grid,
      byCategory,
      categoryOrder: CATALOGUE.categoryOrder,
    });
  } catch (err) {
    console.error('[admin/onboarding/preview-entitlements] error:', err);
    return jsonError(res, 500, 'internal_error', 'Failed to load entitlement preview');
  }
}
